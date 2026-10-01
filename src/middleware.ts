import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { backendAuthHeaders, describeAuth } from "./auth.ts";
import { findBackend, parseConfig } from "./config.ts";
import { DestinationService, type Destination } from "./destination.ts";
import { basicAuthFromEnv, readEnvFile } from "./env.ts";
import type { Logger } from "./logger.ts";
import { forward } from "./proxy.ts";
import { rejectionReason } from "./request-guard.ts";
import { onShutdown } from "./shutdown.ts";
import { directHop, SshTunnelTransport, type Hop, type OnPremiseTransport } from "./transport.ts";

interface MiddlewareParameters {
  log: Logger;
  options: { configuration?: unknown };
  middlewareUtil?: { getProject?: () => { getRootPath(): string } | undefined };
}

type Request = IncomingMessage & { originalUrl?: string };
type Next = (error?: unknown) => void;

export type ProxyHandler = (req: Request, res: ServerResponse, next: Next) => Promise<void>;

/** UI5 Tooling custom middleware (specVersion 3.0). */
export default function btpDestinationProxy({ log, options, middlewareUtil }: MiddlewareParameters): Promise<ProxyHandler> {
  const rootPath = middlewareUtil?.getProject?.()?.getRootPath() ?? process.cwd();
  return createProxyHandler({ log, configuration: options.configuration, rootPath });
}

/** The middleware without UI5 Tooling. `rootPath` is the project root that the .env file is relative to. */
export async function createProxyHandler(options: { log: Logger; configuration: unknown; rootPath: string }): Promise<ProxyHandler> {
  const { log, rootPath } = options;
  const config = parseConfig(options.configuration);
  const basicAuth = basicAuthFromEnv(readEnvFile(resolve(rootPath, config.envFile)));
  const destinations = new DestinationService({
    service: config.destinationService,
    serviceKey: config.destinationServiceKey,
    log,
  });

  // One tunnel for all OnPremise destinations. The Connectivity proxy routes by virtual host and location ID.
  let transport: OnPremiseTransport | undefined;
  const onPremise = (destination: Destination): OnPremiseTransport => {
    if (!config.connectivityService || !config.tunnelApp) {
      throw new Error(
        `Destination "${destination.name}" is OnPremise: configuration.connectivityService and configuration.tunnelApp are required`,
      );
    }
    if (!transport) {
      transport = new SshTunnelTransport({
        connectivityService: config.connectivityService,
        connectivityServiceKey: config.connectivityServiceKey,
        tunnelApp: config.tunnelApp,
        log,
      });
      onShutdown(() => transport?.close());
    }
    return transport;
  };
  const hopFor = (destination: Destination): Promise<Hop> =>
    destination.proxyType === "OnPremise" ? onPremise(destination).hop(destination) : Promise.resolve(directHop(destination.url));

  // Resolve the destinations and open the tunnel in the background, so both are ready when the app sends its first request.
  for (const backend of config.backends) {
    destinations
      .get(backend.destination)
      .then(async (destination) => {
        await hopFor(destination);
        log.info(
          `${backend.path} -> destination "${destination.name}" (${destination.proxyType}, ${destination.url.origin}), ` +
            `backend auth: ${describeAuth(destination, basicAuth)}`,
        );
      })
      .catch((error: Error) => log.warn(`${backend.path} not ready yet, retrying with the first request: ${error.message}`));
  }

  return async function btpDestinationProxyMiddleware(req: Request, res: ServerResponse, next: Next): Promise<void> {
    const backend = findBackend(config.backends, req.originalUrl ?? req.url ?? "/");
    if (!backend) return next();
    const rejected = rejectionReason(req.headers);
    if (rejected) {
      log.warn(`${req.method} ${req.originalUrl ?? req.url} rejected: ${rejected}`);
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end(`btp-destination-proxy: ${rejected}`);
      return;
    }
    try {
      const destination = await destinations.get(backend.destination);
      const hop = await hopFor(destination);
      forward(
        req,
        res,
        {
          url: destination.url,
          hop,
          headers: backendAuthHeaders(destination, req.headers.authorization, basicAuth),
          sapClient: backend.client ?? destination.sapClient,
          onProxyAuthRejected: () => transport?.proxyAuthRejected(),
        },
        log,
      );
    } catch (error) {
      const message = (error as Error).message;
      log.error(message);
      if (res.headersSent) return void res.destroy();
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`btp-destination-proxy: ${message}`);
    }
  };
}

