import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { cfNotFound, describeCfFailure } from "./cf.ts";
import type { Logger } from "./logger.ts";

const LOCAL_HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 30_000;
const RETRY_COOLDOWN_MS = 5_000;
const OUTPUT_LINES = 20;

export interface TunnelOptions {
  /** CF app with SSH enabled. */
  app: string;
  remoteHost: string;
  remotePort: number;
  log: Logger;
}

/**
 * `cf ssh -N -L` port forwarding, opened on first use.
 * If the tunnel closes, the next call to endpoint() opens it again.
 */
export class SshTunnel {
  readonly #options: TunnelOptions;
  #child?: ChildProcess;
  #ready?: Promise<number>;
  #lastFailure?: { at: number; error: Error };
  #stopped = false;

  constructor(options: TunnelOptions) {
    this.#options = options;
  }

  endpoint(): Promise<{ host: string; port: number }> {
    if (this.#stopped) return Promise.reject(new Error("Tunnel is stopped"));
    if (!this.#ready) {
      // Don't spawn cf ssh for every request while the tunnel keeps failing, e.g. after the cf login expired.
      const failure = this.#lastFailure;
      if (failure && Date.now() - failure.at < RETRY_COOLDOWN_MS) return Promise.reject(failure.error);
      const ready = this.#start();
      this.#ready = ready;
      ready.catch((error: Error) => {
        if (this.#ready === ready) this.#ready = undefined;
        this.#lastFailure = { at: Date.now(), error };
      });
    }
    return this.#ready.then((port) => ({ host: LOCAL_HOST, port }));
  }

  /** Closes the tunnel. Synchronous, so it also works in a process "exit" handler. */
  stop(): void {
    this.#stopped = true;
    if (this.#child) kill(this.#child);
  }

  async #start(): Promise<number> {
    const { app, remoteHost, remotePort, log } = this.#options;
    const port = await freePort();
    const args = ["ssh", app, "-N", "-L", `${LOCAL_HOST}:${port}:${remoteHost}:${remotePort}`];
    log.info(`Opening tunnel: cf ${args.join(" ")}`);

    const child = spawn("cf", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.#child = child;
    const output: string[] = [];
    const collect = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        log.verbose(`[cf ssh] ${line}`);
        output.push(line);
        if (output.length > OUTPUT_LINES) output.shift();
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    let open = false;
    const aborted = new AbortController();
    const exited = new Promise<never>((_, reject) => {
      child.once("error", (error: NodeJS.ErrnoException) => {
        aborted.abort();
        reject(error.code === "ENOENT" ? cfNotFound() : error);
      });
      child.once("exit", (code) => reject(new Error(describeCfFailure(args, output.join("\n") || `exit code ${code}`))));
    });
    child.once("exit", (code) => {
      aborted.abort();
      if (this.#child === child) this.#child = undefined;
      if (!open || this.#stopped) return;
      this.#ready = undefined;
      log.warn(`Tunnel closed (exit code ${code}). It reopens with the next request.`);
    });

    try {
      await Promise.race([waitForPort(port, READY_TIMEOUT_MS, aborted.signal), exited]);
    } catch (error) {
      kill(child);
      throw error;
    }
    open = true;
    log.info(`Tunnel open: ${LOCAL_HOST}:${port} -> ${remoteHost}:${remotePort} via ${app}`);
    return port;
  }
}

function kill(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    // cf.exe may be a shim (e.g. Chocolatey) that starts the real CLI as a child. Kill the whole tree.
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // Already gone.
    }
  } else {
    child.kill();
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, LOCAL_HOST, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port: number, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted) {
    if (await canConnect(port)) return;
    if (Date.now() > deadline) throw new Error(`Tunnel did not open within ${timeoutMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, LOCAL_HOST);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
