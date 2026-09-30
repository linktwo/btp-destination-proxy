import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backendAuthHeaders } from "../src/auth.ts";
import type { Destination } from "../src/destination.ts";

const destination: Destination = {
  name: "ERP",
  url: new URL("http://erp:8000"),
  proxyType: "OnPremise",
  authentication: "NoAuthentication",
  expiresAt: 0,
};
const withCredentials: Destination = {
  ...destination,
  authentication: "BasicAuthentication",
  authHeader: { key: "Authorization", value: "Basic destination" },
};

describe("backendAuthHeaders", () => {
  it("uses destination credentials over everything else", () => {
    assert.deepEqual(backendAuthHeaders(withCredentials, "Basic client", "Basic env"), { authorization: "Basic destination" });
  });

  it("keeps credentials sent by the client over .env", () => {
    assert.deepEqual(backendAuthHeaders(destination, "Basic deploy-user", "Basic env"), {});
  });

  it("fills in .env credentials for requests without credentials", () => {
    assert.deepEqual(backendAuthHeaders(destination, undefined, "Basic env"), { authorization: "Basic env" });
  });

  it("adds nothing without any credentials", () => {
    assert.deepEqual(backendAuthHeaders(destination, undefined, undefined), {});
  });
});
