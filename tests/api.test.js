const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const API_BUNDLE = path.join(ROOT, "scripts", "api.bundle.js");
const MANAGE_BUNDLE = path.join(ROOT, "scripts", "manage-agent.bundle.js");

test("api.bundle.js exports clean CJS contract without mutating NODE_PATH", () => {
  const prevNodePath = process.env.NODE_PATH;
  delete require.cache[require.resolve(API_BUNDLE)];
  const api = require(API_BUNDLE);

  assert.equal(process.env.NODE_PATH, prevNodePath);
  assert.deepEqual(api.CAPABILITIES, {
    apiVersion: 1,
    nonInteractiveAuth: true,
    caseInsensitiveTenant: true,
    pascalCaseClusterCategory: true,
    stderrAuthLogging: true,
  });

  assert.equal(typeof api.yaml.load, "function");
  assert.equal(typeof api.yaml.dump, "function");
  assert.equal(typeof api.loadSchema, "function");
  assert.equal(typeof api.getDefinitions, "function");
  assert.equal(typeof api.getValidKindsFromOneOf, "function");
  assert.equal(typeof api.validateYaml, "function");
  assert.equal(typeof api.loadAdaptiveCardSchema, "function");
  assert.equal(typeof api.getAdaptiveCardDefinitions, "function");
  assert.equal(typeof api.listConnectorFiles, "function");
  assert.equal(typeof api.loadConnector, "function");
  assert.equal(typeof api.getCopilotStudioConnectionUrl, "function");
  assert.equal(typeof api.acquireTokenSilent, "function");
  assert.equal(typeof api.acquireTokenInteractive, "function");
  assert.equal(typeof api.getIslandResourceId, "function");
  assert.equal(typeof api.VSCODE_CLIENT_ID, "string");
});

test("api.bundle.js validateYaml, schema, Adaptive Card, connector, and connection URL helpers work cleanly", (t) => {
  const api = require(API_BUNDLE);
  const defs = api.getDefinitions(api.loadSchema());
  assert.ok(api.getValidKindsFromOneOf("DialogAction", defs).length > 0);
  const acDefs = api.getAdaptiveCardDefinitions(api.loadAdaptiveCardSchema());
  assert.ok(Object.keys(acDefs).length > 0);

  const connectors = api.listConnectorFiles();
  assert.ok(connectors.length > 0);
  const connDoc = api.loadConnector(connectors[0]);
  assert.ok(connDoc && typeof connDoc === "object");

  const validFixture = path.join(ROOT, "evals", "fixtures", "basic-agent", "topics", "Greeting.topic.mcs.yml");
  const okRes = api.validateYaml(validFixture, defs);
  assert.equal(okRes.ok, true);
  assert.equal(okRes.failures, 0);
  assert.ok(Array.isArray(okRes.messages) && okRes.messages.length > 0);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cps-api-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const badPath = path.join(tmpDir, "bad.mcs.yml");
  fs.writeFileSync(badPath, "foo: bar\n", "utf8");
  const failRes = api.validateYaml(badPath, defs);
  assert.equal(failRes.ok, false);
  assert.ok(failRes.failures > 0);
  assert.ok(failRes.messages.some((m) => m.includes("[FAIL]")));

  const missingRes = api.validateYaml(path.join(tmpDir, "missing.mcs.yml"), defs);
  assert.equal(missingRes.ok, false);
  assert.equal(missingRes.failures, 1);

  const url = api.getCopilotStudioConnectionUrl({
    environmentId: "11111111-2222-3333-4444-555555555555",
    schemaName: "cr_testbot",
    cloud: "Prod",
  });
  assert.ok(url.startsWith("https://") && url.includes("cr_testbot"));
});

test("shared-auth configures MSAL loggerCallback to stderr without touching stdout", async () => {
  const resolved = path.join(ROOT, "scripts", "src", "shared-auth.js");
  const localRequire = createRequire(resolved);
  const stderrLogs = [];
  let capturedConfig = null;

  class MockPCA {
    constructor(cfg) { capturedConfig = cfg; }
    getTokenCache() { return { getAllAccounts: async () => [] }; }
  }

  const mod = { exports: {} };
  const ctx = vm.createContext({
    require: (id) => id === "@azure/msal-node" ? { PublicClientApplication: MockPCA, LogLevel: { Warning: 1 } }
      : id === "./msal-cache" ? { createCachePlugin: async () => ({}) }
      : id === "./shared-utils" ? { log: (m) => stderrLogs.push(String(m)) }
      : localRequire(id),
    module: mod,
    exports: mod.exports,
    process: {
      env: {},
      stderr: { write: (m) => stderrLogs.push(String(m)) },
      stdout: { write() { throw new Error("unexpected stdout write"); } },
    },
  });
  vm.runInContext(fs.readFileSync(resolved, "utf8"), ctx, { filename: "scripts/src/shared-auth.js" });

  await mod.exports.createMsalApp("11111111-2222-3333-4444-555555555555", "cid");
  assert.equal(capturedConfig.system.loggerOptions.piiLoggingEnabled, false);
  assert.equal(capturedConfig.system.loggerOptions.logLevel, 1);
  capturedConfig.system.loggerOptions.loggerCallback(1, "msal warning");
  assert.deepEqual(stderrLogs, ["msal warning"]);
});

test("msal-cache resolves @azure/msal-node-extensions via CLAUDE_PLUGIN_DATA createRequire fallback", (t) => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "cps-plugin-data-"));
  t.after(() => fs.rmSync(tmpData, { recursive: true, force: true }));
  const pkgDir = path.join(tmpData, "node_modules", "@azure", "msal-node-extensions");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(tmpData, "package.json"), JSON.stringify({ name: "native-deps" }), "utf8");
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "@azure/msal-node-extensions", main: "index.js" }), "utf8");
  fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = { sentinel: 'loaded-via-createRequire' };\n", "utf8");

  const resolved = path.join(ROOT, "scripts", "src", "msal-cache.js");
  const localRequire = createRequire(resolved);
  const mod = { exports: {} };
  const ctx = vm.createContext({
    require: (id) => {
      if (id === "@azure/msal-node-extensions") {
        throw Object.assign(new Error("Cannot find module"), { code: "MODULE_NOT_FOUND" });
      }
      return localRequire(id);
    },
    module: mod,
    exports: mod.exports,
    process: { env: { CLAUDE_PLUGIN_DATA: tmpData } },
  });
  vm.runInContext(fs.readFileSync(resolved, "utf8"), ctx, { filename: "scripts/src/msal-cache.js" });

  assert.equal(mod.exports.loadMsalExtensions().sentinel, "loaded-via-createRequire");
});

test("manage-agent.bundle.js --capabilities returns structured JSON contract", () => {
  const out = execFileSync(process.execPath, [MANAGE_BUNDLE, "--capabilities"], {
    encoding: "utf8",
    env: { ...process.env, CPS_TENANT_ID: "not-a-uuid" },
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.status, "ok");
  assert.deepEqual(parsed.capabilities, {
    apiVersion: 1,
    nonInteractiveAuth: true,
    caseInsensitiveTenant: true,
    pascalCaseClusterCategory: true,
    stderrAuthLogging: true,
  });
});
