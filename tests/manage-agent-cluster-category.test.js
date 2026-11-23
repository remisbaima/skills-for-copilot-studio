const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const vm = require("node:vm");

function loadManageHelpers(relPath) {
  const resolved = path.resolve(__dirname, "..", relPath);
  const localRequire = createRequire(resolved);
  let src = fs.readFileSync(resolved, "utf8");
  if (relPath.endsWith(".bundle.js")) src = src.slice(src.indexOf("\n") + 1);
  const entry = /\nmain\(\);(?=\s*(?:\/\*! Bundled license information:[\s\S]*\*\/)?\s*$)/;
  assert.ok(entry.test(src), `${relPath}: entrypoint must exist`);

  const ctx = vm.createContext({
    require: (id) => id === "./shared-auth" ? { VSCODE_CLIENT_ID: "cid" }
      : id === "@azure/msal-node-extensions" || id === "keytar" || id === "vscode-jsonrpc" ? {}
      : id === "./shared-utils" ? { log() {}, die(m) { throw new Error(m); } }
      : localRequire(id),
    module: { exports: {} },
    process: { env: {}, stderr: { write() {} }, stdout: { write() {} } },
    URL, AbortSignal, Buffer,
  });
  vm.runInContext(src.replace(entry, "\n"), ctx, { filename: relPath });
  return vm.runInContext("({ resolveClusterCategory, buildSyncRequest })", ctx);
}

for (const relPath of ["scripts/src/manage-agent.js", "scripts/manage-agent.bundle.js"]) {
  test(`${relPath}: resolves PascalCase, camelCase, numeric string, and zero ClusterCategory`, (t) => {
    const { resolveClusterCategory, buildSyncRequest } = loadManageHelpers(relPath);

    assert.equal(resolveClusterCategory({ AccountInfo: { ClusterCategory: 5 } }), 5);
    assert.equal(resolveClusterCategory({ AccountInfo: { clusterCategory: 6 } }), 6);
    assert.equal(resolveClusterCategory({ AccountInfo: { ClusterCategory: "5" } }), 5);
    assert.equal(resolveClusterCategory({ AccountInfo: { ClusterCategory: 0 } }), 0);
    assert.equal(resolveClusterCategory({ ClusterCategory: 7 }), 7);
    assert.equal(resolveClusterCategory({ AccountInfo: { ClusterCategory: "invalid" } }), undefined);
    assert.equal(resolveClusterCategory(null), undefined);

    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "cluster-cat-"));
    t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
    fs.mkdirSync(path.join(ws, ".mcs"));
    fs.writeFileSync(path.join(ws, ".mcs", "conn.json"), JSON.stringify({
      AgentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      EnvironmentId: "11111111-2222-3333-4444-555555555555",
      DataverseEndpoint: "https://org.crm.dynamics.com",
      AgentManagementEndpoint: "https://example.island.powerapps.com",
      AccountInfo: { TenantId: "11111111-2222-3333-4444-555555555555", ClusterCategory: 5 },
    }));
    const req = buildSyncRequest(
      { workspace: ws },
      { copilotStudio: { accessToken: "t1" }, dataverse: { accessToken: "t2" } }
    );
    assert.equal(req.accountInfo.clusterCategory, 5);
  });
}
