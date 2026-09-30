import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";

export const MIDDLEWARE_NAME = "btp-destination-proxy";

interface Ui5Document {
  server?: { customMiddleware?: Array<{ name?: unknown; configuration?: unknown } | null> };
}

/** Reads the configuration of the btp-destination-proxy middleware from a UI5 YAML file. */
export function readMiddlewareConfiguration(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${file} not found. Pass the UI5 YAML file with --config.`);
    throw error;
  }
  return findMiddlewareConfiguration(text, file);
}

/** UI5 YAML files can hold several documents (project, extensions). The first one with the middleware wins. */
export function findMiddlewareConfiguration(text: string, file: string): unknown {
  for (const document of parseAllDocuments(text)) {
    const [error] = document.errors;
    if (error) throw new Error(`${file}: ${error.message}`);
    const json = document.toJS() as Ui5Document | null;
    const entry = json?.server?.customMiddleware?.find((middleware) => middleware?.name === MIDDLEWARE_NAME);
    if (entry) return entry.configuration;
  }
  throw new Error(`${file} has no server.customMiddleware entry "${MIDDLEWARE_NAME}"`);
}
