import { credential, readServiceKey } from "./cf.ts";
import type { Destination } from "./destination.ts";
import type { Logger } from "./logger.ts";
import { ClientCredentialsToken } from "./token.ts";
import { SshTunnel } from "./tunnel.ts";

/** Where to send the upstream request. */
export interface Hop {
  protocol: "http:" | "https:";
  host: string;
  port: number;
  /** Send the request to an HTTP proxy, with the absolute destination URL as request target. */
  viaProxy: boolean;
  /** Extra request headers, e.g. Proxy-Authorization. Names in lower case. */
  headers: Record<string, string>;
}

/** Gets requests for OnPremise destinations into BTP. The SSH tunnel is one way, a relay app could be another. */
export interface OnPremiseTransport {
  hop(destination: Destination): Promise<Hop>;
  /** Called when the Connectivity proxy answered 407. */
  proxyAuthRejected(): void;
  close(): void;
}

/** Internet destinations need no transport. */
export function directHop(url: URL): Hop {
  const https = url.protocol === "https:";
  return {
    protocol: https ? "https:" : "http:",
    host: url.hostname,
    port: Number(url.port) || (https ? 443 : 80),
    viaProxy: false,
    headers: {},
  };
}

interface SshTransportOptions {
  connectivityService: string;
  connectivityServiceKey: string;
  tunnelApp: string;
  log: Logger;
}

/** Reaches the Connectivity proxy through `cf ssh -L` via an SSH-enabled CF app. */
export class SshTunnelTransport implements OnPremiseTransport {
  readonly #options: SshTransportOptions;
  #setup?: Promise<{ tunnel: SshTunnel; token: ClientCredentialsToken }>;
  #tunnel?: SshTunnel;
  #token?: ClientCredentialsToken;

  constructor(options: SshTransportOptions) {
    this.#options = options;
  }

  async hop(destination: Destination): Promise<Hop> {
    if (destination.url.protocol !== "http:") {
      throw new Error(
        `OnPremise destination "${destination.name}" must use an http:// URL. ` +
          "Cloud apps address the Cloud Connector virtual host via HTTP; HTTPS to the backend is configured in the Cloud Connector.",
      );
    }
    const { tunnel, token } = await this.#connect();
    const [endpoint, bearer] = await Promise.all([tunnel.endpoint(), token.get()]);
    const headers: Record<string, string> = { "proxy-authorization": `Bearer ${bearer}` };
    if (destination.locationId) headers["sap-connectivity-scc-location_id"] = destination.locationId;
    return { protocol: "http:", host: endpoint.host, port: endpoint.port, viaProxy: true, headers };
  }

  proxyAuthRejected(): void {
    this.#token?.invalidate();
  }

  close(): void {
    this.#tunnel?.stop();
  }

  #connect(): Promise<{ tunnel: SshTunnel; token: ClientCredentialsToken }> {
    const { connectivityService: service, connectivityServiceKey, tunnelApp, log } = this.#options;
    this.#setup ??= readServiceKey(service, connectivityServiceKey).then(
      (credentials) => {
        const port = credentials.onpremise_proxy_http_port ?? credentials.onpremise_proxy_port;
        const tokenUrl = typeof credentials.token_service_url === "string" ? credentials.token_service_url : credentials.url;
        this.#token = new ClientCredentialsToken(
          typeof tokenUrl === "string" ? tokenUrl : credential(credentials, "token_service_url", service),
          credential(credentials, "clientid", service),
          credential(credentials, "clientsecret", service),
        );
        this.#tunnel = new SshTunnel({
          app: tunnelApp,
          remoteHost: credential(credentials, "onpremise_proxy_host", service),
          remotePort: Number(port) || 20003,
          log,
        });
        return { tunnel: this.#tunnel, token: this.#token };
      },
      (error: unknown) => {
        this.#setup = undefined;
        throw error;
      },
    );
    return this.#setup;
  }
}
