import { parseArgs } from "node:util";

export const DEFAULT_PORT = 3001;

export const USAGE = `Usage: btp-destination-proxy exec [options] -- <command> [args...]

Starts the proxy on http://127.0.0.1:<port>, runs <command> and stops the proxy when the command ends.
The backends are read from the btp-destination-proxy middleware in a UI5 YAML file.
The command gets the proxy URL in the environment variable BTP_PROXY_URL.

Options:
  -c, --config <file>  UI5 YAML file with the middleware configuration (default: ui5-local.yaml)
  -p, --port <port>    Local port of the proxy (default: ${DEFAULT_PORT})
      --verbose        Log every forwarded request
  -h, --help           Show this help

Example:
  btp-destination-proxy exec -- fiori deploy --config ui5-deploy-local.yaml`;

export interface CliArgs {
  config: string;
  port: number;
  verbose: boolean;
  command: string[];
}

export class UsageError extends Error {}

export function parseCliArgs(argv: string[]): CliArgs | "help" {
  const separator = argv.indexOf("--");
  const own = separator < 0 ? argv : argv.slice(0, separator);
  const command = separator < 0 ? [] : argv.slice(separator + 1);

  let parsed;
  try {
    parsed = parseArgs({
      args: own,
      allowPositionals: true,
      options: {
        config: { type: "string", short: "c" },
        port: { type: "string", short: "p" },
        verbose: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) return "help";
  if (positionals.length !== 1 || positionals[0] !== "exec") {
    throw new UsageError(positionals.length === 0 ? "Missing command: exec" : `Unknown command: ${positionals.join(" ")}`);
  }
  if (command.length === 0) throw new UsageError("Missing the command to run after --");

  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError(`Invalid port: ${values.port}`);

  return { config: values.config ?? "ui5-local.yaml", port, verbose: values.verbose ?? false, command };
}

/** Quotes an argument for cmd.exe, following the rules Node.js and most Windows programs use to split arguments. */
export function quoteWindowsArg(arg: string): string {
  if (/^[\w\-.,:/\\=@+]+$/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}
