const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const vm = require("node:vm");

const TENANT_LOWER = "11111111-2222-3333-4444-555555555555";
const TENANT_UPPER = TENANT_LOWER.toUpperCase();
const CLIENT_ID = "51f81489-12ee-4a9e-aaae-a2591f45987d";
const SCOPE = "https://api.powerplatform.com/.default";

function loadSharedAuth(accounts, silentResult) {
  const resolved = path.resolve(__dirname, "..", "scripts", "src", "shared-auth.js");
  const localRequire = createRequire(resolved);
  let appCreations = 0, silentCalls = 0;

  class MockPCA {
    constructor() { appCreations++; }
    getTokenCache() { return { getAllAccounts: async () => accounts }; }
    async acquireTokenSilent(req) { silentCalls++; return silentResult(req); }
  }

  const mod = { exports: {} };
  const ctx = vm.createContext({
    require: (id) => id === "@azure/msal-node" ? { PublicClientApplication: MockPCA }
      : id === "./msal-cache" ? { createCachePlugin: async () => ({}) }
      : id === "./shared-utils" ? { log() {} }
      : localRequire(id),
    module: mod, exports: mod.exports,
    process: { env: {}, stderr: { write() {} }, stdout: { write() {} } },
  });
  vm.runInContext(fs.readFileSync(resolved, "utf8"), ctx, { filename: "scripts/src/shared-auth.js" });
  return { auth: mod.exports, stats: () => ({ appCreations, silentCalls }) };
}

test("acquireTokenSilent matches tenantId case-insensitively and reuses singleton", async () => {
  const { auth, stats } = loadSharedAuth(
    [
      { homeAccountId: "malformed" },
      { homeAccountId: "other", tenantId: "99999999-9999-9999-9999-999999999999" },
      { homeAccountId: "acct-1", tenantId: TENANT_UPPER, username: "user@contoso.com" },
    ],
    (req) => ({ accessToken: "tok", expiresOn: new Date("2030-01-01T00:00:00Z"), scopes: req.scopes, account: req.account })
  );

  assert.equal((await auth.acquireTokenSilent(TENANT_LOWER, CLIENT_ID, [SCOPE]))?.account?.homeAccountId, "acct-1");
  assert.equal((await auth.acquireTokenSilent(TENANT_UPPER, CLIENT_ID, [SCOPE]))?.accessToken, "tok");
  assert.deepEqual(stats(), { appCreations: 1, silentCalls: 2 });
  assert.equal(await auth.acquireTokenSilent("22222222-2222-2222-2222-222222222222", CLIENT_ID, [SCOPE]), null);
  assert.equal(await auth.acquireTokenSilent("", CLIENT_ID, [SCOPE]), null);
});

for (const bundle of ["scripts/manage-agent.bundle.js", "scripts/chat-with-agent.bundle.js", "scripts/eval-api.bundle.js"]) {
  test(`${bundle}: normalizes tenantId comparison`, () => {
    const src = fs.readFileSync(path.resolve(__dirname, "..", bundle), "utf8");
    assert.equal(src.includes("a.tenantId === tenantId"), false);
  });
}
