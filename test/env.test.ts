import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { basicAuthFromEnv, readEnvFile } from "../src/env.ts";

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString("base64")}`;

describe("readEnvFile", () => {
  it("parses the file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "btp-proxy-")), ".env");
    writeFileSync(file, "# backend\nBTP_PROXY_USER=DEVELOPER\nBTP_PROXY_PASSWORD=\"p@ss#word\"\n");
    assert.deepEqual(readEnvFile(file), { BTP_PROXY_USER: "DEVELOPER", BTP_PROXY_PASSWORD: "p@ss#word" });
  });

  it("returns nothing for a missing file", () => {
    assert.deepEqual(readEnvFile(join(tmpdir(), "does-not-exist", ".env")), {});
  });
});

describe("basicAuthFromEnv", () => {
  it("builds a basic auth header", () => {
    assert.equal(basicAuthFromEnv({ BTP_PROXY_USER: "DEV", BTP_PROXY_PASSWORD: "secret" }, {}), basic("DEV:secret"));
  });

  it("prefers real environment variables", () => {
    assert.equal(
      basicAuthFromEnv({ BTP_PROXY_USER: "FILE", BTP_PROXY_PASSWORD: "file" }, { BTP_PROXY_USER: "ENV", BTP_PROXY_PASSWORD: "env" }),
      basic("ENV:env"),
    );
  });

  it("returns nothing without credentials", () => {
    assert.equal(basicAuthFromEnv({}, {}), undefined);
  });

  it("rejects a user without password", () => {
    assert.throws(() => basicAuthFromEnv({ BTP_PROXY_USER: "DEV" }, {}), /Set both/);
  });
});
