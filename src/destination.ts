import { credential, readServiceKey } from "./cf.ts";
import type { Logger } from "./logger.ts";
import { ClientCredentialsToken } from "./token.ts";

export interface Destination {
  name: string;
  url: URL;
  /** "OnPremise" or "Internet" */
  proxyType: string;
  authentication: string;
  locationId?: string;
  sapClient?: string;
  /** Header the destination service resolved for the backend, e.g. basic auth or an OAuth bearer token. */
  authHeader?: { key: string; value: string };
  /** When the resolved destination must be looked up again. */
  expiresAt: number;
}

interface AuthToken {
  type?: string;
  expires_in?: string | number;
  error?: string;
  http_header?: { key?: string; value?: string };
}

const CACHE_MS = 5 * 60_000;
const REFRESH_MARGIN_MS = 60_000;

/** Parses a response of the destination service "find destination" API. */
export function parseDestination(body: unknown, now: number): { destination: Destination; warnings: string[] } {
  const response = (body ?? {}) as { destinationConfiguration?: Record<string, unknown>; authTokens?: AuthToken[] };
  const config = response.destinationConfiguration;
  if (!config || typeof config !== "object") throw new Error("Destination service returned no destinationConfiguration");

  const text = (key: string): string | undefined => {
    const value = config[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const name = text("Name") ?? "(unnamed)";
  const rawUrl = text("URL");
  if (!rawUrl) throw new Error(`Destination "${name}" has no URL`);
  let url: URL | undefined;
  try {
    url = new URL(rawUrl);
  } catch {
    // Handled below.
  }
  if (url?.protocol !== "http:" && url?.protocol !== "https:") {
    throw new Error(`Destination "${name}" has an invalid URL: ${rawUrl}`);
  }

  const warnings: string[] = [];
  const authentication = text("Authentication") ?? "NoAuthentication";
  if (authentication === "PrincipalPropagation") {
    warnings.push(
      `Destination "${name}" uses PrincipalPropagation, which is not supported yet. ` +
        "Requests use basic auth from .env or the browser instead.",
    );
  }

  let expiresAt = now + CACHE_MS;
  let authHeader: Destination["authHeader"];
  for (const token of response.authTokens ?? []) {
    if (token.error) {
      warnings.push(`Destination "${name}" returned an auth token error: ${token.error}`);
      continue;
    }
    const { key, value } = token.http_header ?? {};
    if (!key || !value) continue;
    authHeader = { key, value };
    const seconds = Number(token.expires_in);
    if (seconds > 0) expiresAt = Math.min(expiresAt, now + Math.max(seconds * 1000 - REFRESH_MARGIN_MS, 0));
    break;
  }

  return {
    destination: {
      name,
      url,
      proxyType: text("ProxyType") ?? "Internet",
      authentication,
      locationId: text("CloudConnectorLocationId"),
      sapClient: text("sap-client"),
      authHeader,
      expiresAt,
    },
    warnings,
  };
}

interface DestinationServiceOptions {
  service: string;
  serviceKey: string;
  log: Logger;
}

/** Looks up destinations via one destination service instance and caches the results. */
export class DestinationService {
  readonly #options: DestinationServiceOptions;
  #client?: Promise<{ uri: string; token: ClientCredentialsToken }>;
  readonly #cached = new Map<string, Destination>();
  readonly #pending = new Map<string, Promise<Destination>>();
  readonly #warned = new Set<string>();

  constructor(options: DestinationServiceOptions) {
    this.#options = options;
  }

  get(name: string): Promise<Destination> {
    const cached = this.#cached.get(name);
    if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached);
    let pending = this.#pending.get(name);
    if (!pending) {
      pending = this.#fetch(name).finally(() => this.#pending.delete(name));
      this.#pending.set(name, pending);
    }
    return pending;
  }

  #connect(): Promise<{ uri: string; token: ClientCredentialsToken }> {
    const { service, serviceKey } = this.#options;
    this.#client ??= readServiceKey(service, serviceKey).then(
      (credentials) => ({
        uri: credential(credentials, "uri", service),
        token: new ClientCredentialsToken(
          credential(credentials, "url", service),
          credential(credentials, "clientid", service),
          credential(credentials, "clientsecret", service),
        ),
      }),
      (error: unknown) => {
        this.#client = undefined;
        throw error;
      },
    );
    return this.#client;
  }

  async #fetch(name: string): Promise<Destination> {
    const { service, log } = this.#options;
    const { uri, token } = await this.#connect();
    const url = `${uri.replace(/\/+$/, "")}/destination-configuration/v1/destinations/${encodeURIComponent(name)}`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${await token.get()}`, accept: "application/json" } });
    if (response.status === 401) token.invalidate();
    if (response.status === 404) {
      throw new Error(`Destination "${name}" not found, neither at subaccount level nor in service instance "${service}"`);
    }
    if (!response.ok) {
      throw new Error(`Destination service returned ${response.status} for "${name}": ${(await response.text()).slice(0, 300)}`);
    }

    const { destination, warnings } = parseDestination(await response.json(), Date.now());
    if (!this.#warned.has(name)) {
      for (const warning of warnings) log.warn(warning);
      this.#warned.add(name);
    }
    log.verbose(`Resolved destination "${name}": ${destination.proxyType} ${destination.url.origin}`);
    this.#cached.set(name, destination);
    return destination;
  }
}
