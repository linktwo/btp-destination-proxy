import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMiddlewareConfiguration } from "../src/ui5-config.ts";

const ui5Local = `specVersion: "3.0"
metadata:
  name: ztm.wtlgr
type: application
server:
  customMiddleware:
    - name: fiori-tools-proxy
      afterMiddleware: compression
      configuration:
        ui5:
          path: [/resources]
          url: https://ui5.sap.com
    - name: btp-destination-proxy
      afterMiddleware: compression
      configuration:
        destinationService: my-destination
        backend:
          - path: /sap
            destination: WEIGS01
---
specVersion: "3.0"
kind: extension
type: server-middleware
metadata:
  name: some-local-middleware
middleware:
  path: lib/middleware.js
`;

describe("findMiddlewareConfiguration", () => {
  it("returns the configuration of the btp-destination-proxy entry", () => {
    assert.deepEqual(findMiddlewareConfiguration(ui5Local, "ui5-local.yaml"), {
      destinationService: "my-destination",
      backend: [{ path: "/sap", destination: "WEIGS01" }],
    });
  });

  it("fails if the middleware is not configured", () => {
    assert.throws(
      () => findMiddlewareConfiguration("specVersion: '3.0'\ntype: application\n", "ui5.yaml"),
      /ui5\.yaml has no server\.customMiddleware entry "btp-destination-proxy"/,
    );
  });

  it("reports YAML errors with the file name", () => {
    assert.throws(() => findMiddlewareConfiguration("server:\n  customMiddleware: [\n", "broken.yaml"), /^Error: broken\.yaml: /);
  });
});
