import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesPath, parseConfig } from "../src/config.ts";

describe("parseConfig", () => {
  it("applies defaults", () => {
    const config = parseConfig({ destination: "ERP", destinationService: "my-destination" });
    assert.deepEqual(config, {
      destination: "ERP",
      destinationService: "my-destination",
      destinationServiceKey: "local-dev",
      connectivityService: undefined,
      connectivityServiceKey: "local-dev",
      tunnelApp: undefined,
      paths: ["/sap"],
      client: undefined,
      envFile: ".env",
    });
  });

  it("accepts a numeric client and a single path", () => {
    const config = parseConfig({ destination: "ERP", destinationService: "d", client: 100, paths: "/sap/opu/" });
    assert.equal(config.client, "100");
    assert.deepEqual(config.paths, ["/sap/opu"]);
  });

  it("rejects missing required values", () => {
    assert.throws(() => parseConfig({ destinationService: "d" }), /configuration\.destination is required/);
    assert.throws(() => parseConfig(undefined), /configuration\.destination is required/);
  });

  it("rejects paths without leading slash", () => {
    assert.throws(() => parseConfig({ destination: "ERP", destinationService: "d", paths: ["sap"] }), /must start with/);
  });
});

describe("matchesPath", () => {
  it("matches the path and everything below it", () => {
    assert.ok(matchesPath(["/sap"], "/sap"));
    assert.ok(matchesPath(["/sap"], "/sap/opu/odata/sap/API/$metadata"));
    assert.ok(matchesPath(["/sap"], "/sap?sap-client=100"));
    assert.ok(matchesPath(["/sap/opu"], "/sap/opu;o=LOCAL/x"));
  });

  it("does not match paths that only share a prefix", () => {
    assert.ok(!matchesPath(["/sap"], "/sapui5/resources"));
    assert.ok(!matchesPath(["/sap"], "/resources/sap/ui/core"));
  });
});
