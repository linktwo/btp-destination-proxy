import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLocalHost, rejectionReason } from "../src/request-guard.ts";

describe("isLocalHost", () => {
  it("accepts localhost and IP addresses", () => {
    for (const host of ["localhost", "localhost:8080", "LOCALHOST:8080", "app.localhost:8080", "127.0.0.1:3001", "192.168.1.20:8080", "[::1]:8080", "[::1]"]) {
      assert.equal(isLocalHost(host), true, host);
    }
  });

  it("rejects other host names, which DNS rebinding could point to this machine", () => {
    for (const host of ["evil.example.com", "evil.example.com:8080", "localhost.evil.example.com", "evil.com@127.0.0.1", "127.0.0.1/x", "[evil]:80", ""]) {
      assert.equal(isLocalHost(host), false, host);
    }
  });
});

describe("rejectionReason", () => {
  it("accepts same-origin requests and requests without Origin", () => {
    assert.equal(rejectionReason({ host: "localhost:8080" }), undefined);
    assert.equal(rejectionReason({ host: "localhost:8080", origin: "http://localhost:8080" }), undefined);
    assert.equal(rejectionReason({ host: "127.0.0.1:3001" }), undefined);
  });

  it("rejects foreign hosts", () => {
    assert.match(rejectionReason({ host: "evil.example.com:8080" }) ?? "", /Host "evil.example.com:8080" is not allowed/);
    assert.match(rejectionReason({}) ?? "", /Host "" is not allowed/);
  });

  it("rejects cross-origin requests", () => {
    assert.match(rejectionReason({ host: "localhost:8080", origin: "https://evil.example.com" }) ?? "", /Cross-origin/);
    assert.match(rejectionReason({ host: "localhost:8080", origin: "http://localhost:9090" }) ?? "", /Cross-origin/);
    assert.match(rejectionReason({ host: "localhost:8080", origin: "null" }) ?? "", /Cross-origin/);
  });
});
