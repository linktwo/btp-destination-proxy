import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCliArgs, quoteWindowsArg } from "../src/cli-args.ts";

describe("parseCliArgs", () => {
  it("applies defaults and keeps the command with its own options", () => {
    assert.deepEqual(parseCliArgs(["exec", "--", "fiori", "deploy", "--config", "ui5-deploy-local.yaml", "-y"]), {
      config: "ui5-local.yaml",
      port: 3001,
      verbose: false,
      command: ["fiori", "deploy", "--config", "ui5-deploy-local.yaml", "-y"],
    });
  });

  it("reads options", () => {
    const args = parseCliArgs(["exec", "-c", "ui5-onprem.yaml", "--port", "4711", "--verbose", "--", "npm", "run", "deploy"]);
    assert.deepEqual(args, { config: "ui5-onprem.yaml", port: 4711, verbose: true, command: ["npm", "run", "deploy"] });
  });

  it("shows help", () => {
    assert.equal(parseCliArgs(["--help"]), "help");
    assert.equal(parseCliArgs(["exec", "-h", "--", "x"]), "help");
  });

  it("rejects wrong usage", () => {
    assert.throws(() => parseCliArgs([]), /Missing command: exec/);
    assert.throws(() => parseCliArgs(["serve"]), /Unknown command: serve/);
    assert.throws(() => parseCliArgs(["exec"]), /Missing the command to run/);
    assert.throws(() => parseCliArgs(["exec", "--"]), /Missing the command to run/);
    assert.throws(() => parseCliArgs(["exec", "--port", "http", "--", "x"]), /Invalid port: http/);
    assert.throws(() => parseCliArgs(["exec", "--unknown", "--", "x"]), /Unknown option/);
  });
});

describe("quoteWindowsArg", () => {
  it("leaves simple arguments alone", () => {
    assert.equal(quoteWindowsArg("fiori"), "fiori");
    assert.equal(quoteWindowsArg("--config=ui5-deploy-local.yaml"), "--config=ui5-deploy-local.yaml");
    assert.equal(quoteWindowsArg("C:\\dir\\file.yaml"), "C:\\dir\\file.yaml");
  });

  it("quotes spaces and shell characters", () => {
    assert.equal(quoteWindowsArg("Weight Ticket List"), '"Weight Ticket List"');
    assert.equal(quoteWindowsArg("a&b"), '"a&b"');
    assert.equal(quoteWindowsArg(""), '""');
  });

  it("escapes quotes and trailing backslashes", () => {
    assert.equal(quoteWindowsArg('say "hi"'), '"say \\"hi\\""');
    assert.equal(quoteWindowsArg("C:\\my dir\\"), '"C:\\my dir\\\\"');
  });
});
