import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeCfFailure, parseServiceKey } from "../src/cf.ts";

describe("parseServiceKey", () => {
  it("reads cf CLI v8 output with credentials wrapper", () => {
    const output = `Getting key local-dev for service instance my-connectivity as dev@example.com...

{
  "credentials": {
    "clientid": "sb-123",
    "onpremise_proxy_host": "connectivityproxy.internal.cf.eu10.hana.ondemand.com"
  }
}
`;
    assert.deepEqual(parseServiceKey(output), {
      clientid: "sb-123",
      onpremise_proxy_host: "connectivityproxy.internal.cf.eu10.hana.ondemand.com",
    });
  });

  it("reads older output without wrapper", () => {
    assert.deepEqual(parseServiceKey('Getting key...\n\n{ "clientid": "sb-123" }'), { clientid: "sb-123" });
  });

  it("fails without JSON", () => {
    assert.throws(() => parseServiceKey("FAILED"), /no JSON/);
  });
});

describe("describeCfFailure", () => {
  it("explains an expired login", () => {
    assert.match(describeCfFailure(["ssh", "app"], "Not logged in. Use 'cf login' to log in.\nFAILED"), /Run `cf login`/);
  });

  it("includes the last output lines", () => {
    assert.equal(
      describeCfFailure(["ssh", "app"], "Error opening SSH connection: ssh: handshake failed\nFAILED\n"),
      "cf ssh app failed: Error opening SSH connection: ssh: handshake failed | FAILED",
    );
  });
});
