const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const BUNDLES = [
  "scripts/manage-agent.bundle.js",
  "scripts/chat-with-agent.bundle.js",
  "scripts/eval-api.bundle.js",
];

function runBundleBanner(bundleRelPath, { env = {}, homeDir }) {
  const resolved = path.resolve(__dirname, "..", bundleRelPath);
  const firstLine = fs.readFileSync(resolved, "utf8").split(/\r?\n/, 1)[0];
  assert.ok(firstLine.includes("_initPaths"), `${bundleRelPath}: expected native-deps banner on line 1`);

  let initPathsCalls = 0;
  const proc = { env: { ...env } };
  const context = vm.createContext({
    process: proc,
    require(id) {
      if (id === "os") return { homedir: () => homeDir };
      if (id === "module") return { _initPaths: () => { initPathsCalls += 1; } };
      return require(id);
    },
  });
  vm.runInContext(firstLine, context, { filename: `${bundleRelPath}#banner` });
  return { nodePath: proc.env.NODE_PATH || "", initPathsCalls };
}

for (const bundle of BUNDLES) {
  test(`${bundle}: banner resolves CLAUDE_PLUGIN_DATA, COPILOT_PLUGIN_DATA, PLUGIN_DATA, and plugin-paths.json fallback`, (t) => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-banner-"));
    t.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

    const fallbackData = path.join(tmpHome, "fallback-data");
    const registryDir = path.join(tmpHome, ".copilot-studio-cli");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, "plugin-paths.json"),
      JSON.stringify({ pluginData: fallbackData, pluginRoot: tmpHome })
    );

    // 1. Explicit PLUGIN_DATA takes precedence over plugin-paths.json.
    const agyData = path.join(tmpHome, "agy-data");
    const rPlugin = runBundleBanner(bundle, {
      homeDir: tmpHome,
      env: { PLUGIN_DATA: agyData },
    });
    assert.equal(rPlugin.initPathsCalls, 1);
    assert.equal(rPlugin.nodePath, path.join(agyData, "node_modules"));

    // 2. Explicit COPILOT_PLUGIN_DATA takes precedence over PLUGIN_DATA and fallback.
    const copilotData = path.join(tmpHome, "copilot-data");
    const rCopilot = runBundleBanner(bundle, {
      homeDir: tmpHome,
      env: { COPILOT_PLUGIN_DATA: copilotData, PLUGIN_DATA: agyData },
    });
    assert.equal(rCopilot.initPathsCalls, 1);
    assert.equal(rCopilot.nodePath, path.join(copilotData, "node_modules"));

    // 3. Explicit CLAUDE_PLUGIN_DATA takes highest precedence.
    const claudeData = path.join(tmpHome, "claude-data");
    const rClaude = runBundleBanner(bundle, {
      homeDir: tmpHome,
      env: { CLAUDE_PLUGIN_DATA: claudeData, COPILOT_PLUGIN_DATA: copilotData, PLUGIN_DATA: agyData },
    });
    assert.equal(rClaude.initPathsCalls, 1);
    assert.equal(rClaude.nodePath, path.join(claudeData, "node_modules"));

    // 4. Falls back to plugin-paths.json when all env vars are unset.
    const rFallback = runBundleBanner(bundle, { homeDir: tmpHome, env: {} });
    assert.equal(rFallback.initPathsCalls, 1);
    assert.equal(rFallback.nodePath, path.join(fallbackData, "node_modules"));
  });
}
