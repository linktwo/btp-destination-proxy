import http, { type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import https from "node:https";
import type { Logger } from "./logger.ts";
import type { Hop } from "./transport.ts";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface ForwardTarget {
  /** Destination URL. Its path is prepended to the request path. */
  url: URL;
  hop: Hop;
  /** Headers that replace the incoming ones, e.g. backend authorization. Names in lower case. */
  headers?: Record<string, string>;
  sapClient?: string;
  onProxyAuthRejected?: () => void;
  /** Fail with 504 if the upstream connection stays idle this long. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/**
 * Request path on the backend. Leaves the request's query string untouched and appends sap-client and the query
 * parameters of the destination URL, unless the request already has them.
 */
export function upstreamPath(base: URL, requestUrl: string, sapClient?: string): string {
  let path = `${base.pathname.replace(/\/+$/, "")}${requestUrl}`;
  const queryStart = path.indexOf("?");
  const present = new Set(new URLSearchParams(queryStart < 0 ? "" : path.slice(queryStart + 1)).keys());
  const append = (name: string, value: string) => {
    path += `${path.includes("?") ? "&" : "?"}${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  };
  if (sapClient && !present.has("sap-client")) {
    append("sap-client", sapClient);
    present.add("sap-client");
  }
  for (const [name, value] of base.searchParams) {
    if (!present.has(name)) append(name, value);
  }
  return path;
}

function withoutHopByHop(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const connectionTokens = String(headers.connection ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase());
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || connectionTokens.includes(name)) continue;
    result[name] = value;
  }
  return result;
}

export function requestHeaders(incoming: IncomingHttpHeaders, host: string, overrides: Record<string, string> = {}): OutgoingHttpHeaders {
  const headers = withoutHopByHop(incoming);
  headers.host = host;
  return Object.assign(headers, overrides);
}

export function responseHeaders(incoming: IncomingHttpHeaders, backendOrigin: string): OutgoingHttpHeaders {
  const headers = withoutHopByHop(incoming);
  if (typeof headers.location === "string") headers.location = rewriteLocation(headers.location, backendOrigin);
  if (Array.isArray(headers["set-cookie"])) headers["set-cookie"] = headers["set-cookie"].map(stripCookieDomain);
  return headers;
}

/** Makes redirects to the backend relative, so the browser stays on the local dev server. */
export function rewriteLocation(location: string, backendOrigin: string): string {
  if (!location.toLowerCase().startsWith(backendOrigin.toLowerCase())) return location;
  const rest = location.slice(backendOrigin.length);
  if (rest === "") return "/";
  return /^[/?#]/.test(rest) ? rest : location;
}

/** The browser drops cookies whose Domain doesn't match localhost. */
export function stripCookieDomain(cookie: string): string {
  return cookie.replace(/;\s*domain=[^;]*/gi, "");
}

export function forward(req: IncomingMessage & { originalUrl?: string }, res: ServerResponse, target: ForwardTarget, log: Logger): void {
  const { url, hop } = target;
  const path = upstreamPath(url, req.originalUrl ?? req.url ?? "/", target.sapClient);
  const client = hop.protocol === "https:" ? https : http;
  let aborted = false;
  const fail = (status: number, message: string) => {
    log.error(`${req.method} ${path} failed: ${message}`);
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    res.end(`btp-destination-proxy: ${message}`);
  };

  const upstream = client.request(
    {
      host: hop.host,
      port: hop.port,
      method: req.method,
      path: hop.viaProxy ? `${url.origin}${path}` : path,
      headers: requestHeaders(req.headers, url.host, { ...target.headers, ...hop.headers }),
    },
    (response) => {
      const status = response.statusCode ?? 502;
      log.verbose(`${req.method} ${path} -> ${status}`);
      if (status === 407 && hop.viaProxy) {
        // The browser doesn't use a proxy and can't handle 407. The next request gets a new token.
        target.onProxyAuthRejected?.();
        response.resume();
        fail(502, "The Connectivity proxy rejected the token (407). Repeat the request.");
        return;
      }
      res.writeHead(status, responseHeaders(response.headers, url.origin));
      response.pipe(res);
    },
  );

  const timeoutMs = target.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  upstream.setTimeout(timeoutMs, () => {
    upstream.destroy(Object.assign(new Error(`No response within ${timeoutMs / 1000}s`), { code: "ETIMEDOUT" }));
  });

  upstream.on("error", (error: NodeJS.ErrnoException) => {
    if (aborted) return;
    if (res.headersSent) {
      log.error(`${req.method} ${path} failed: ${error.message}`);
      res.destroy(error);
      return;
    }
    fail(error.code === "ETIMEDOUT" ? 504 : 502, error.message);
  });

  res.on("close", () => {
    if (res.writableFinished) return;
    aborted = true;
    upstream.destroy();
  });

  req.pipe(upstream);
}
