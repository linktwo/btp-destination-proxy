import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBackend, matchesPath, parseConfig } from "../src/config.ts";

const base = { destinationService: "my-destination" };

describe("parseConfig", () => {
  it("applies defaults", () => {
    const config = parseConfig({ ...base, backend: [{ path: "/sap", destination: "ERP" }] });
    assert.deepEqual(config, {
      backends: [{ path: "/sap", destination: "ERP", client: undefined }],
      destinationService: "my-destination",
      destinationServiceKey: "local-dev",
      connectivityService: undefined,
      connectivityServiceKey: "local-dev",
      tunnelApp: undefined,
      envFile: ".env",
    });
  });

  it("reads several backends with numeric client and trailing slash", () => {
    const config = parseConfig({
      ...base,
      backend: [
        { path: "/sap", destination: "ERP" },
        { path: "/sap/opu/odata/sap/ZOTHER_SRV/", destination: "OTHER", client: 200 },
      ],
    });
    assert.deepEqual(config.backends, [
      { path: "/sap", destination: "ERP", client: undefined },
      { path: "/sap/opu/odata/sap/ZOTHER_SRV", destination: "OTHER", client: "200" },
    ]);
  });

  it("requires a backend list", () => {
    assert.throws(() => parseConfig(base), /configuration\.backend must be a list/);
    assert.throws(() => parseConfig({ ...base, backend: [] }), /configuration\.backend must be a list/);
    assert.throws(() => parseConfig({ ...base, backend: { path: "/sap", destination: "ERP" } }), /must be a list/);
  });

  it("validates backend entries", () => {
    assert.throws(() => parseConfig({ ...base, backend: ["/sap"] }), /backend\[0\] must be an object/);
    assert.throws(() => parseConfig({ ...base, backend: [{ path: "/sap" }] }), /backend\[0\]\.destination is required/);
    assert.throws(() => parseConfig({ ...base, backend: [{ path: "sap", destination: "ERP" }] }), /backend\[0\]\.path must start with/);
    assert.throws(
      () =>
        parseConfig({
          ...base,
          backend: [
            { path: "/sap", destination: "ERP" },
            { path: "/sap/", destination: "OTHER" },
          ],
        }),
      /path \/sap more than once/,
    );
  });

  it("requires the destination service", () => {
    assert.throws(() => parseConfig({ backend: [{ path: "/sap", destination: "ERP" }] }), /configuration\.destinationService is required/);
  });

  it("explains the old configuration shape", () => {
    assert.throws(
      () => parseConfig({ ...base, destination: "ERP", paths: ["/sap"] }),
      /configuration\.destination, configuration\.paths moved into configuration\.backend/,
    );
  });
});

describe("findBackend", () => {
  const backends = [
    { path: "/sap", destination: "ERP" },
    { path: "/sap/opu/odata/sap/ZOTHER_SRV", destination: "OTHER" },
  ];

  it("picks the longest matching path, whatever the order", () => {
    assert.equal(findBackend(backends, "/sap/opu/odata/sap/ZOTHER_SRV/$metadata")?.destination, "OTHER");
    assert.equal(findBackend([...backends].reverse(), "/sap/opu/odata/sap/ZOTHER_SRV/$metadata")?.destination, "OTHER");
    assert.equal(findBackend(backends, "/sap/opu/odata/sap/ZOTHER_SRV_V2/$metadata")?.destination, "ERP");
  });

  it("returns nothing for other paths", () => {
    assert.equal(findBackend(backends, "/resources/sap-ui-core.js"), undefined);
  });
});

describe("matchesPath", () => {
  it("matches the path and everything below it", () => {
    assert.ok(matchesPath("/sap", "/sap"));
    assert.ok(matchesPath("/sap", "/sap/opu/odata/sap/API/$metadata"));
    assert.ok(matchesPath("/sap", "/sap?sap-client=100"));
    assert.ok(matchesPath("/sap/opu", "/sap/opu;o=LOCAL/x"));
    assert.ok(matchesPath("/", "/anything"));
  });

  it("does not match paths that only share a prefix", () => {
    assert.ok(!matchesPath("/sap", "/sapui5/resources"));
    assert.ok(!matchesPath("/sap", "/resources/sap/ui/core"));
  });
});
