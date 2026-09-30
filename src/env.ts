import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const USER_VARIABLE = "BTP_PROXY_USER";
export const PASSWORD_VARIABLE = "BTP_PROXY_PASSWORD";

/** Reads a .env file. A missing file is not an error. */
export function readEnvFile(file: string): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(resolve(file), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/**
 * Builds a basic auth header from BTP_PROXY_USER and BTP_PROXY_PASSWORD.
 * Real environment variables take precedence over the .env file.
 */
export function basicAuthFromEnv(
  file: Record<string, string | undefined>,
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  const user = environment[USER_VARIABLE] ?? file[USER_VARIABLE];
  const password = environment[PASSWORD_VARIABLE] ?? file[PASSWORD_VARIABLE];
  if (!user && !password) return undefined;
  if (!user || !password) throw new Error(`Set both ${USER_VARIABLE} and ${PASSWORD_VARIABLE}, or neither.`);
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}
