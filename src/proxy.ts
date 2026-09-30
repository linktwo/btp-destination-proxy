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
}

/** Request path on the backend. Leaves the query string untouched apart from adding sap-client. */
export function upstreamPath(base: URL, requestUrl: string, sapClient?: string): string {
  let path = `${base.pathname.replace(/\/+$/, "")}${requestUrl}`;
  if (sapClient && !/[?&]sap-client=/.test(path)) {
    path += `${path.includes("?") ? "&" : "?"}sap-client=${encodeURIComponent(sapClient)}`;
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
      if (status === 407) target.onProxyAuthRejected?.();
      log.verbose(`${req.method} ${path} -> ${status}`);
      res.writeHead(status, responseHeaders(response.headers, url.origin));
      response.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    if (aborted) return;
    log.error(`${req.method} ${path} failed: ${error.message}`);
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`btp-destination-proxy: ${error.message}`);
  });

  res.on("close", () => {
    if (res.writableFinished) return;
    aborted = true;
    upstream.destroy();
  });

  req.pipe(upstream);
}
