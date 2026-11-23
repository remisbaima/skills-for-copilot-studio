/**
 * msal-cache.js — Shared MSAL cache plugin using OS-native secure storage.
 *
 * Uses @azure/msal-node-extensions to persist MSAL's token cache via the
 * platform's credential manager (Keychain on macOS, DPAPI on Windows,
 * libsecret on Linux).
 *
 * The cache file lives at ~/.copilot-studio-cli/<account>.cache.json.
 */

const fs = require("fs");
const { createRequire } = require("module");
const path = require("path");
const os = require("os");

const CACHE_DIR = path.join(os.homedir(), ".copilot-studio-cli");
const SERVICE_NAME = "copilot-studio-cli";

function resolvePluginDataDir() {
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA;
  try {
    const raw = fs.readFileSync(path.join(CACHE_DIR, "plugin-paths.json"), "utf8");
    return JSON.parse(raw)?.pluginData || "";
  } catch {
    return "";
  }
}

function loadMsalExtensions() {
  try {
    return require("@azure/msal-node-extensions");
  } catch (err) {
    if (err?.code !== "MODULE_NOT_FOUND") throw err;
    const pluginData = resolvePluginDataDir();
    if (!pluginData) throw err;
    return createRequire(path.join(pluginData, "package.json"))("@azure/msal-node-extensions");
  }
}

async function createCachePlugin(accountName) {
  const { PersistenceCreator, PersistenceCachePlugin, DataProtectionScope } = loadMsalExtensions();
  const cachePath = path.join(CACHE_DIR, `${accountName}.cache.json`);
  const persistence = await PersistenceCreator.createPersistence({
    cachePath,
    dataProtectionScope: DataProtectionScope.CurrentUser,
    serviceName: SERVICE_NAME,
    accountName,
    usePlaintextFileOnLinux: true,
  });
  return new PersistenceCachePlugin(persistence);
}

module.exports = { createCachePlugin, loadMsalExtensions };
