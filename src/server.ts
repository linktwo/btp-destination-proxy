import http from "node:http";
import type { Logger } from "./logger.ts";
import btpDestinationProxy from "./middleware.ts";

export const LOCAL_HOST = "127.0.0.1";

export interface ProxyServer {
  url: string;
  close(): Promise<void>;
}

/** Runs the middleware in a plain HTTP server, without UI5 Tooling. Only reachable from this machine. */
export async function startProxyServer(options: { configuration: unknown; port: number; log: Logger }): Promise<ProxyServer> {
  const { configuration, port, log } = options;
  const handler = await btpDestinationProxy({ log, options: { configuration } });
  const server = http.createServer((req, res) => {
    void handler(req, res, () => {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`btp-destination-proxy: no backend configured for ${req.url}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "EADDRINUSE" ? new Error(`Port ${port} is already in use. Choose another one with --port.`) : error),
    );
    server.listen(port, LOCAL_HOST, () => resolve());
  });

  return {
    url: `http://${LOCAL_HOST}:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
