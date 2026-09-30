export interface ProxyConfig {
  /** Name of the BTP destination. */
  destination: string;
  /** Destination service instance used to look up the destination. */
  destinationService: string;
  destinationServiceKey: string;
  /** Connectivity service instance. Required for OnPremise destinations. */
  connectivityService?: string;
  connectivityServiceKey: string;
  /** CF app with SSH enabled that the tunnel runs through. Required for OnPremise destinations. */
  tunnelApp?: string;
  /** Request paths forwarded to the destination. */
  paths: string[];
  /** SAP client added as sap-client query parameter. Overrides the destination's sap-client property. */
  client?: string;
  /** File with backend credentials, relative to the project root. */
  envFile: string;
}

const DEFAULT_SERVICE_KEY = "local-dev";

export function parseConfig(raw: unknown): ProxyConfig {
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) {
    throw new Error("configuration must be an object");
  }
  const values = (raw ?? {}) as Record<string, unknown>;

  const optional = (key: string): string | undefined => {
    const value = values[key];
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`configuration.${key} must be a string`);
    }
    return String(value);
  };
  const required = (key: string): string => {
    const value = optional(key);
    if (value === undefined) throw new Error(`configuration.${key} is required`);
    return value;
  };

  return {
    destination: required("destination"),
    destinationService: required("destinationService"),
    destinationServiceKey: optional("destinationServiceKey") ?? DEFAULT_SERVICE_KEY,
    connectivityService: optional("connectivityService"),
    connectivityServiceKey: optional("connectivityServiceKey") ?? DEFAULT_SERVICE_KEY,
    tunnelApp: optional("tunnelApp"),
    paths: parsePaths(values.paths),
    client: optional("client"),
    envFile: optional("envFile") ?? ".env",
  };
}

function parsePaths(value: unknown): string[] {
  if (value === undefined || value === null) return ["/sap"];
  const paths = Array.isArray(value) ? value : [value];
  if (paths.length === 0) throw new Error("configuration.paths must not be empty");
  return paths.map((path) => {
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error(`configuration.paths entries must start with "/", got ${JSON.stringify(path)}`);
    }
    return path.length > 1 ? path.replace(/\/+$/, "") : path;
  });
}

/** True if `url` is one of `paths` or below one of them. */
export function matchesPath(paths: string[], url: string): boolean {
  return paths.some((path) => {
    if (path === "/") return true;
    if (!url.startsWith(path)) return false;
    const next = url.charAt(path.length);
    return next === "" || next === "/" || next === "?" || next === ";";
  });
}
