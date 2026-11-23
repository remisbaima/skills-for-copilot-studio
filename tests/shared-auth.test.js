const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const vm = require("node:vm");

const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID = "51f81489-12ee-4a9e-aaae-a2591f45987d";
const SCOPE = "https://api.powerplatform.com/.default";

function loadSharedAuth({ env = {}, accounts = [], silentResult = null } = {}) {
  const resolved = path.resolve(__dirname, "..", "scripts", "src", "shared-auth.js");
  const localRequire = createRequire(resolved);
  const logs = [];
  let interactiveCalls = 0, deviceCodeCalls = 0, silentCalls = 0;

  class MockPCA {
    getTokenCache() { return { getAllAccounts: async () => accounts }; }
    async acquireTokenSilent(req) { silentCalls++; return typeof silentResult === "function" ? silentResult(req) : silentResult; }
    async acquireTokenInteractive() { interactiveCalls++; throw new Error("unexpected interactive"); }
    async acquireTokenByDeviceCode() { deviceCodeCalls++; throw new Error("unexpected device-code"); }
  }

  const mod = { exports: {} };
  const proc = {
    env: { ...env },
    stderr: { write: (m) => logs.push(String(m)) },
    stdout: { write() { throw new Error("unexpected stdout write"); } },
  };
  const ctx = vm.createContext({
    require: (id) => id === "@azure/msal-node" ? { PublicClientApplication: MockPCA }
      : id === "./msal-cache" ? { createCachePlugin: async () => ({}) }
      : id === "./shared-utils" ? { log: (m) => logs.push(String(m)) }
      : localRequire(id),
    module: mod, exports: mod.exports, process: proc,
  });
  vm.runInContext(fs.readFileSync(resolved, "utf8"), ctx, { filename: "scripts/src/shared-auth.js" });
  return { auth: mod.exports, env: proc.env, logs, stats: () => ({ interactiveCalls, deviceCodeCalls, silentCalls }) };
}

function loadBundle(bundleRelPath) {
  const resolved = path.resolve(__dirname, "..", bundleRelPath);
  const localRequire = createRequire(resolved);
  let src = fs.readFileSync(resolved, "utf8").replace(/^#!.*\n/, "");
  src = src.slice(src.indexOf("\n") + 1);
  const entry = /\nmain\(\)(?:\.catch\([^\n]*\))?;(?=\s*(?:\/\*! Bundled license information:[\s\S]*\*\/)?\s*$)/;
  assert.ok(entry.test(src), `${bundleRelPath}: entrypoint must exist`);

  const proc = { argv: ["node", resolved], env: {}, stderr: { write() {} }, stdout: { write() { throw new Error("unexpected stdout"); } }, exit() {} };
  const ctx = vm.createContext({
    require: (id) => (id === "@azure/msal-node-extensions" || id === "keytar" || id === "vscode-jsonrpc") ? {} : localRequire(id),
    module: { exports: {} }, process: proc, URL, AbortSignal, Buffer, setTimeout, clearTimeout, console,
    __dirname: path.dirname(resolved), __filename: resolved,
  });
  vm.runInContext(src.replace(entry, "\n"), ctx, { filename: bundleRelPath });
  return { sharedAuth: vm.runInContext("require_shared_auth()", ctx), parseArgs: vm.runInContext("parseArgs", ctx), proc };
}

test("isNonInteractiveAuth recognizes truthy CPS_NON_INTERACTIVE values only", () => {
  const { auth, env } = loadSharedAuth();
  for (const val of [undefined, "", "0", "false", "no"]) {
    if (val === undefined) delete env.CPS_NON_INTERACTIVE; else env.CPS_NON_INTERACTIVE = val;
    assert.equal(auth.isNonInteractiveAuth(), false);
  }
  for (const val of ["1", "true", "TRUE", " 1 "]) {
    env.CPS_NON_INTERACTIVE = val;
    assert.equal(auth.isNonInteractiveAuth(), true);
  }
});

test("non-interactive mode rejects interactive, device-code, and uncached getOrAcquireToken", async () => {
  const { auth, logs, stats } = loadSharedAuth({ env: { CPS_NON_INTERACTIVE: "1" } });
  await assert.rejects(auth.acquireTokenInteractive(TENANT, CLIENT_ID, [SCOPE]), /non-interactive mode \(interactive login disabled\)/);
  await assert.rejects(auth.acquireTokenDeviceCode(TENANT, CLIENT_ID, [SCOPE]), /non-interactive mode \(device-code login disabled\)/);
  await assert.rejects(auth.getOrAcquireToken(TENANT, CLIENT_ID, [SCOPE], "Power Platform API"), /non-interactive mode \(interactive login disabled\)/);
  assert.deepEqual(stats(), { interactiveCalls: 0, deviceCodeCalls: 0, silentCalls: 0 });
  assert.equal(logs.some((l) => l.includes("starting interactive login")), false);
});

test("getOrAcquireToken returns cached silent token in non-interactive mode", async () => {
  const { auth, stats } = loadSharedAuth({
    env: { CPS_NON_INTERACTIVE: "true" },
    accounts: [{ homeAccountId: "acct-1", tenantId: TENANT, username: "user@contoso.com" }],
    silentResult: (req) => ({ accessToken: "tok", expiresOn: new Date("2030-01-01T00:00:00Z"), scopes: req.scopes, account: req.account }),
  });
  assert.equal((await auth.getOrAcquireToken(TENANT, CLIENT_ID, [SCOPE], "Power Platform API")).accessToken, "tok");
  assert.deepEqual(stats(), { interactiveCalls: 0, deviceCodeCalls: 0, silentCalls: 1 });
});

for (const [bundle, argv] of [
  ["scripts/manage-agent.bundle.js", ["node", "manage-agent.bundle.js", "push", "--non-interactive"]],
  ["scripts/chat-with-agent.bundle.js", ["node", "chat-with-agent.bundle.js", "hello", "--non-interactive"]],
  ["scripts/eval-api.bundle.js", ["node", "eval-api.bundle.js", "list-runs", "--non-interactive"]],
]) {
  test(`${bundle}: --non-interactive enables guard and blocks login flows`, async () => {
    const { sharedAuth, parseArgs, proc } = loadBundle(bundle);
    proc.argv = argv;
    assert.equal(parseArgs().nonInteractive, true);
    assert.equal(proc.env.CPS_NON_INTERACTIVE, "1");
    await assert.rejects(sharedAuth.acquireTokenInteractive(TENANT, CLIENT_ID, [SCOPE]), /interactive login disabled/);
    await assert.rejects(sharedAuth.acquireTokenDeviceCode(TENANT, CLIENT_ID, [SCOPE]), /device-code login disabled/);
  });
}
