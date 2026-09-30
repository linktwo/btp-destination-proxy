import type { Destination } from "./destination.ts";
import { USER_VARIABLE } from "./env.ts";

/**
 * Backend credentials, in this order: from the destination, sent by the client (browser popup, deploy tool),
 * from .env. The .env credentials only fill in for requests without credentials.
 */
export function backendAuthHeaders(
  destination: Destination,
  clientAuthorization: string | undefined,
  basicAuth: string | undefined,
): Record<string, string> {
  if (destination.authHeader) return { [destination.authHeader.key.toLowerCase()]: destination.authHeader.value };
  if (clientAuthorization || !basicAuth) return {};
  return { authorization: basicAuth };
}

export function describeAuth(destination: Destination, basicAuth: string | undefined): string {
  if (destination.authHeader) return `from destination (${destination.authentication})`;
  if (basicAuth) return `sent by the client, otherwise basic auth from ${USER_VARIABLE}`;
  return "sent by the client (e.g. browser popup)";
}
