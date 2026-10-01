import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";

/**
 * True for host names that a website can't point to this machine via DNS rebinding: localhost and IP addresses.
 * `host` is a Host header value, optionally with port.
 */
export function isLocalHost(host: string): boolean {
  const match = /^(?:\[([0-9a-f:.]+)\]|([a-z0-9.-]+))(?::\d{1,5})?$/i.exec(host);
  if (!match) return false;
  if (match[1]) return isIP(match[1]) === 6;
  const name = match[2].toLowerCase();
  return name === "localhost" || name.endsWith(".localhost") || isIP(name) === 4;
}

/**
 * Why a request must not reach the backend, or undefined if it may. The proxy adds backend credentials, so it only
 * accepts requests addressed to localhost or an IP address (against DNS rebinding) and, if the browser sends an
 * Origin, from the same origin (against cross-site requests).
 */
export function rejectionReason(headers: IncomingHttpHeaders): string | undefined {
  const host = headers.host ?? headers[":authority"];
  if (typeof host !== "string" || !isLocalHost(host)) {
    return `Host ${JSON.stringify(host ?? "")} is not allowed. Open the app via localhost or an IP address.`;
  }
  const { origin } = headers;
  if (origin !== undefined && originHost(origin) !== host.toLowerCase()) {
    return `Cross-origin request from ${origin} is not allowed.`;
  }
  return undefined;
}

function originHost(origin: string): string | undefined {
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}
