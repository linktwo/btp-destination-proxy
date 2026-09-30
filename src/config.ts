export interface BackendConfig {
  /** Request path forwarded to the destination, including everything below it. */
  path: string;
  /** Name of the BTP destination. */
  destination: string;
  /** SAP client added as sap-client query parameter. Overrides the destination's sap-client property. */
  client?: string;
}

export interface ProxyConfig {
  /** Backends. A request goes to the one with the longest matching path. */
  backends: BackendConfig[];
  /** Destination service instance used to look up the destinations. */
  destinationService: string;
  destinationServiceKey: string;
  /** Connectivity service instance. Required for OnPremise destinations. */
  connectivityService?: string;
  connectivityServiceKey: string;
  /** CF app with SSH enabled that the tunnel runs through. Required for OnPremise destinations. */
  tunnelApp?: string;
  /** File with backend credentials, relative to the project root. */
  envFile: string;
}

const DEFAULT_SERVICE_KEY = "local-dev";

type Values = Record<string, unknown>;

export function parseConfig(raw: unknown): ProxyConfig {
  if (raw !== undefined && !isObject(raw)) throw new Error("configuration must be an object");
  const values = (raw ?? {}) as Values;

  const legacy = ["destination", "paths", "client"].filter((key) => key in values);
  if (legacy.length > 0) {
    throw new Error(
      `configuration.${legacy.join(", configuration.")} moved into configuration.backend, ` +
        "e.g. backend: [{ path: /sap, destination: ERP_DEV, client: '100' }]",
    );
  }

  return {
    backends: parseBackends(values.backend),
    destinationService: required(values, "destinationService", "configuration"),
    destinationServiceKey: optional(values, "destinationServiceKey", "configuration") ?? DEFAULT_SERVICE_KEY,
    connectivityService: optional(values, "connectivityService", "configuration"),
    connectivityServiceKey: optional(values, "connectivityServiceKey", "configuration") ?? DEFAULT_SERVICE_KEY,
    tunnelApp: optional(values, "tunnelApp", "configuration"),
    envFile: optional(values, "envFile", "configuration") ?? ".env",
  };
}

function parseBackends(value: unknown): BackendConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("configuration.backend must be a list with at least one entry { path, destination }");
  }
  const backends = value.map((entry: unknown, index): BackendConfig => {
    const prefix = `configuration.backend[${index}]`;
    if (!isObject(entry)) throw new Error(`${prefix} must be an object { path, destination }`);
    const path = required(entry, "path", prefix);
    if (!path.startsWith("/")) throw new Error(`${prefix}.path must start with "/", got ${JSON.stringify(path)}`);
    return {
      path: path.length > 1 ? path.replace(/\/+$/, "") : path,
      destination: required(entry, "destination", prefix),
      client: optional(entry, "client", prefix),
    };
  });

  const seen = new Set<string>();
  for (const { path } of backends) {
    if (seen.has(path)) throw new Error(`configuration.backend contains the path ${path} more than once`);
    seen.add(path);
  }
  return backends;
}

/** The backend with the longest path that matches `url`. */
export function findBackend(backends: BackendConfig[], url: string): BackendConfig | undefined {
  let match: BackendConfig | undefined;
  for (const backend of backends) {
    if (matchesPath(backend.path, url) && (!match || backend.path.length > match.path.length)) match = backend;
  }
  return match;
}

/** True if `url` is `path` or below it. */
export function matchesPath(path: string, url: string): boolean {
  if (path === "/") return true;
  if (!url.startsWith(path)) return false;
  const next = url.charAt(path.length);
  return next === "" || next === "/" || next === "?" || next === ";";
}

function isObject(value: unknown): value is Values {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optional(values: Values, key: string, prefix: string): string | undefined {
  const value = values[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${prefix}.${key} must be a string`);
  return String(value);
}

function required(values: Values, key: string, prefix: string): string {
  const value = optional(values, key, prefix);
  if (value === undefined) throw new Error(`${prefix}.${key} is required`);
  return value;
}
