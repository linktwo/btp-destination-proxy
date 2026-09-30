import type { IncomingMessage, ServerResponse } from "node:http";
import { matchesPath, parseConfig } from "./config.ts";
import { DestinationResolver, type Destination } from "./destination.ts";
import { basicAuthFromEnv, readEnvFile, USER_VARIABLE } from "./env.ts";
import type { Logger } from "./logger.ts";
import { forward } from "./proxy.ts";
import { onShutdown } from "./shutdown.ts";
import { directHop, SshTunnelTransport, type Hop, type OnPremiseTransport } from "./transport.ts";

interface MiddlewareParameters {
  log: Logger;
  options: { configuration?: unknown };
}

type Request = IncomingMessage & { originalUrl?: string };
type Next = (error?: unknown) => void;

/** UI5 Tooling custom middleware (specVersion 3.0). */
export default async function btpDestinationProxy({ log, options }: MiddlewareParameters) {
  const config = parseConfig(options.configuration);
  const basicAuth = basicAuthFromEnv(readEnvFile(config.envFile));
  const destinations = new DestinationResolver({
    name: config.destination,
    service: config.destinationService,
    serviceKey: config.destinationServiceKey,
    log,
  });

  let transport: OnPremiseTransport | undefined;
  const onPremise = (): OnPremiseTransport => {
    if (!config.connectivityService || !config.tunnelApp) {
      throw new Error(
        `Destination "${config.destination}" is OnPremise: configuration.connectivityService and configuration.tunnelApp are required`,
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
    destination.proxyType === "OnPremise" ? onPremise().hop(destination) : Promise.resolve(directHop(destination.url));

  // Resolve the destination and open the tunnel in the background, so both are ready when the app sends its first request.
  destinations
    .get()
    .then(async (destination) => {
      await hopFor(destination);
      log.info(
        `${config.paths.join(", ")} -> destination "${destination.name}" (${destination.proxyType}, ${destination.url.origin}), ` +
          `backend auth: ${describeAuth(destination, basicAuth)}`,
      );
    })
    .catch((error: Error) => log.warn(`Not ready yet, retrying with the first request: ${error.message}`));

  return async function btpDestinationProxyMiddleware(req: Request, res: ServerResponse, next: Next): Promise<void> {
    if (!matchesPath(config.paths, req.originalUrl ?? req.url ?? "/")) return next();
    try {
      const destination = await destinations.get();
      const hop = await hopFor(destination);
      forward(
        req,
        res,
        {
          url: destination.url,
          hop,
          headers: backendAuthHeaders(destination, basicAuth),
          sapClient: config.client ?? destination.sapClient,
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

/** Destination credentials win over .env, which wins over what the browser sends. */
function backendAuthHeaders(destination: Destination, basicAuth: string | undefined): Record<string, string> {
  if (destination.authHeader) return { [destination.authHeader.key.toLowerCase()]: destination.authHeader.value };
  if (basicAuth) return { authorization: basicAuth };
  return {};
}

function describeAuth(destination: Destination, basicAuth: string | undefined): string {
  if (destination.authHeader) return `from destination (${destination.authentication})`;
  if (basicAuth) return `basic auth from ${USER_VARIABLE}`;
  return "passed through from the browser";
}
