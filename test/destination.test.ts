import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDestination } from "../src/destination.ts";

const NOW = 1_000_000;

describe("parseDestination", () => {
  it("reads an OnPremise destination without authentication", () => {
    const { destination, warnings } = parseDestination(
      {
        owner: { SubaccountId: "sub", InstanceId: null },
        destinationConfiguration: {
          Name: "ERP_DEV",
          Type: "HTTP",
          URL: "http://erp-dev:8000",
          Authentication: "NoAuthentication",
          ProxyType: "OnPremise",
          CloudConnectorLocationId: "WEIG",
          "sap-client": "100",
        },
      },
      NOW,
    );
    assert.deepEqual(warnings, []);
    assert.equal(destination.name, "ERP_DEV");
    assert.equal(destination.url.origin, "http://erp-dev:8000");
    assert.equal(destination.proxyType, "OnPremise");
    assert.equal(destination.locationId, "WEIG");
    assert.equal(destination.sapClient, "100");
    assert.equal(destination.authHeader, undefined);
    assert.equal(destination.expiresAt, NOW + 5 * 60_000);
  });

  it("uses the auth token resolved by the destination service", () => {
    const { destination } = parseDestination(
      {
        destinationConfiguration: { Name: "API", URL: "https://api.example.com/v1", Authentication: "OAuth2ClientCredentials" },
        authTokens: [{ type: "bearer", value: "abc", expires_in: "120", http_header: { key: "Authorization", value: "Bearer abc" } }],
      },
      NOW,
    );
    assert.equal(destination.proxyType, "Internet");
    assert.deepEqual(destination.authHeader, { key: "Authorization", value: "Bearer abc" });
    assert.equal(destination.expiresAt, NOW + 60_000, "looked up again a minute before the token expires");
  });

  it("warns about principal propagation and token errors", () => {
    const { destination, warnings } = parseDestination(
      {
        destinationConfiguration: { Name: "ERP_PP", URL: "http://erp:8000", Authentication: "PrincipalPropagation", ProxyType: "OnPremise" },
        authTokens: [{ type: "", error: "no user token" }],
      },
      NOW,
    );
    assert.equal(destination.authHeader, undefined);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /PrincipalPropagation/);
    assert.match(warnings[1], /no user token/);
  });

  it("rejects responses without usable URL", () => {
    assert.throws(() => parseDestination({}, NOW), /no destinationConfiguration/);
    assert.throws(() => parseDestination({ destinationConfiguration: { Name: "X" } }, NOW), /has no URL/);
    assert.throws(() => parseDestination({ destinationConfiguration: { Name: "X", URL: "erp:8000" } }, NOW), /invalid URL/);
  });
});
