import assert from "node:assert/strict";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Logger } from "../src/logger.ts";
import { forward, requestHeaders, rewriteLocation, stripCookieDomain, upstreamPath, type ForwardTarget } from "../src/proxy.ts";

const silent: Logger = { error() {}, warn() {}, info() {}, verbose() {} };

describe("upstreamPath", () => {
  const base = new URL("http://erp-dev:8000");

  it("keeps the query string as is", () => {
    const url = "/sap/opu/odata/sap/API/Items?$filter=Name%20eq%20'A%20B'&$top=10";
    assert.equal(upstreamPath(base, url), url);
  });

  it("adds sap-client if missing", () => {
    assert.equal(upstreamPath(base, "/sap/x", "100"), "/sap/x?sap-client=100");
    assert.equal(upstreamPath(base, "/sap/x?a=1", "100"), "/sap/x?a=1&sap-client=100");
    assert.equal(upstreamPath(base, "/sap/x?sap-client=200", "100"), "/sap/x?sap-client=200");
  });

  it("prepends the destination path", () => {
    assert.equal(upstreamPath(new URL("http://erp:8000/base/"), "/sap/x"), "/base/sap/x");
  });
});

describe("header rewriting", () => {
  it("drops hop-by-hop headers and sets the backend host", () => {
    const headers = requestHeaders(
      {
        host: "localhost:8080",
        connection: "keep-alive, x-custom-hop",
        "x-custom-hop": "1",
        "proxy-authorization": "Bearer from-browser",
        "x-csrf-token": "Fetch",
        authorization: "Basic browser",
      },
      "erp-dev:8000",
      { authorization: "Basic env" },
    );
    assert.deepEqual(headers, { host: "erp-dev:8000", "x-csrf-token": "Fetch", authorization: "Basic env" });
  });

  it("makes backend redirects relative", () => {
    const origin = "http://erp-dev:8000";
    assert.equal(rewriteLocation("http://erp-dev:8000/sap/bc/ui5?x=1", origin), "/sap/bc/ui5?x=1");
    assert.equal(rewriteLocation("HTTP://ERP-DEV:8000", origin), "/");
    assert.equal(rewriteLocation("http://erp-dev:80001/x", origin), "http://erp-dev:80001/x");
    assert.equal(rewriteLocation("https://idp.example.com/login", origin), "https://idp.example.com/login");
    assert.equal(rewriteLocation("/relative", origin), "/relative");
  });

  it("strips the cookie domain", () => {
    assert.equal(
      stripCookieDomain("SAP_SESSIONID_ERP_100=abc; path=/; domain=.corp.local; HttpOnly"),
      "SAP_SESSIONID_ERP_100=abc; path=/; HttpOnly",
    );
  });
});

describe("forward via HTTP proxy", () => {
  let proxy: http.Server;
  let devServer: http.Server;
  let devUrl: string;
  let received: { url?: string; headers: http.IncomingHttpHeaders; body: string } | undefined;
  let target: ForwardTarget;

  const listen = async (server: http.Server) => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  };

  before(async () => {
    // Plays the Connectivity proxy: receives the absolute URI and answers like the backend.
    proxy = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received = { url: req.url, headers: req.headers, body };
        res.writeHead(302, {
          location: "http://erp-dev:8000/sap/next",
          "set-cookie": ["SAP_SESSIONID=abc; path=/; domain=erp-dev", "sap-usercontext=sap-client=100; path=/"],
          "content-type": "text/plain",
        });
        res.end("backend says hi");
      });
    });
    const proxyPort = await listen(proxy);
    target = {
      url: new URL("http://erp-dev:8000"),
      hop: {
        protocol: "http:",
        host: "127.0.0.1",
        port: proxyPort,
        viaProxy: true,
        headers: { "proxy-authorization": "Bearer token", "sap-connectivity-scc-location_id": "WEIG" },
      },
      headers: { authorization: "Basic env" },
      sapClient: "100",
    };
    devServer = http.createServer((req: IncomingMessage, res: ServerResponse) => forward(req, res, target, silent));
    devUrl = `http://127.0.0.1:${await listen(devServer)}`;
  });

  after(() => {
    proxy.close();
    devServer.close();
  });

  it("sends a proxy request with connectivity headers and rewrites the response", async () => {
    const response = await fetch(`${devUrl}/sap/opu/odata/sap/API/Items?$top=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "abc" },
      body: '{"a":1}',
      redirect: "manual",
    });

    assert.equal(received?.url, "http://erp-dev:8000/sap/opu/odata/sap/API/Items?$top=1&sap-client=100");
    assert.equal(received?.headers.host, "erp-dev:8000");
    assert.equal(received?.headers["proxy-authorization"], "Bearer token");
    assert.equal(received?.headers["sap-connectivity-scc-location_id"], "WEIG");
    assert.equal(received?.headers.authorization, "Basic env");
    assert.equal(received?.headers["x-csrf-token"], "abc");
    assert.equal(received?.body, '{"a":1}');

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/sap/next");
    assert.deepEqual(response.headers.getSetCookie(), ["SAP_SESSIONID=abc; path=/", "sap-usercontext=sap-client=100; path=/"]);
    assert.equal(await response.text(), "backend says hi");
  });

  it("answers 502 if the upstream is unreachable", async () => {
    const closed = http.createServer();
    const port = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));
    const unreachable = { ...target, hop: { ...target.hop, port } };
    const server = http.createServer((req, res) => forward(req, res, unreachable, silent));
    const serverPort = await listen(server);
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/sap/x`);
      assert.equal(response.status, 502);
      assert.match(await response.text(), /ECONNREFUSED/);
    } finally {
      server.close();
    }
  });
});
