#!/usr/bin/env node
import { spawn } from "node:child_process";
import { parseCliArgs, quoteWindowsArg, USAGE, UsageError } from "./cli-args.ts";
import type { Logger } from "./logger.ts";
import { startProxyServer } from "./server.ts";
import { MIDDLEWARE_NAME, readMiddlewareConfiguration } from "./ui5-config.ts";

function consoleLogger(verbose: boolean): Logger {
  const line = (level: string, message: string) => `${level} ${MIDDLEWARE_NAME} ${message}`;
  return {
    error: (message) => console.error(line("error", message)),
    warn: (message) => console.warn(line("warn", message)),
    info: (message) => console.log(line("info", message)),
    verbose: verbose ? (message) => console.log(line("verb", message)) : () => {},
  };
}

function run(command: string[], env: NodeJS.ProcessEnv): Promise<number> {
  // On Windows, npm installs tools like fiori as .cmd files, which only start through a shell.
  const child =
    process.platform === "win32"
      ? spawn(command.map(quoteWindowsArg).join(" "), { stdio: "inherit", shell: true, env })
      : spawn(command[0], command.slice(1), { stdio: "inherit", env });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (args === "help") {
    console.log(USAGE);
    return 0;
  }

  const log = consoleLogger(args.verbose);
  const server = await startProxyServer({ configuration: readMiddlewareConfiguration(args.config), port: args.port, log });
  log.info(`Proxy listening on ${server.url}`);
  try {
    return await run(args.command, { ...process.env, BTP_PROXY_URL: server.url });
  } finally {
    await server.close();
  }
}

// process.exit also closes the tunnel (see shutdown.ts).
main().then(
  (code) => process.exit(code),
  (error: Error) => {
    console.error(`error ${MIDDLEWARE_NAME} ${error.message}`);
    process.exit(1);
  },
);
