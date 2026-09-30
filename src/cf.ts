import { execFile } from "node:child_process";

export type Credentials = Record<string, unknown>;

/** Runs the cf CLI with the developer's current login and target. Resolves with stdout. */
export function runCf(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("cf", args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return reject(cfNotFound());
      reject(new Error(describeCfFailure(args, `${stdout}\n${stderr}`)));
    });
  });
}

export function cfNotFound(): Error {
  return new Error("cf CLI not found on PATH. Install it from https://github.com/cloudfoundry/cli");
}

export function describeCfFailure(args: string[], output: string): string {
  if (/not logged in/i.test(output)) {
    return "Not logged in to Cloud Foundry. Run `cf login` and target the space with the service instances.";
  }
  const tail = output.trim().split(/\r?\n/).slice(-5).join(" | ");
  return `cf ${args.join(" ")} failed${tail ? `: ${tail}` : ""}`;
}

/** Extracts the credentials from `cf service-key` output (a text header followed by JSON). */
export function parseServiceKey(output: string): Credentials {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("cf service-key returned no JSON");
  const json = JSON.parse(output.slice(start)) as Credentials;
  // cf CLI v8 wraps the credentials, older versions print them directly.
  const credentials = json.credentials;
  return credentials && typeof credentials === "object" ? (credentials as Credentials) : json;
}

export async function readServiceKey(instance: string, key: string): Promise<Credentials> {
  try {
    return parseServiceKey(await runCf(["service-key", instance, key]));
  } catch (error) {
    const message = (error as Error).message;
    if (/not found/i.test(message)) {
      throw new Error(`${message}\nCreate the key with: cf create-service-key ${instance} ${key}`);
    }
    throw error;
  }
}

export function credential(credentials: Credentials, name: string, instance: string): string {
  const value = credentials[name];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Service key of "${instance}" has no "${name}". Only client secret keys are supported.`);
  }
  return value;
}
