const fs = require('fs');
const cp = require('child_process');
const p = require('path');
const os = require('os');
const { persistEnvironment } = require('./setup-env');

// __dirname is the hooks/ directory; the plugin root is one level up
const r = p.resolve(__dirname, '..');
const d = process.env.CLAUDE_PLUGIN_DATA || process.env.COPILOT_PLUGIN_DATA || process.env.PLUGIN_DATA;
const e = process.env.CLAUDE_ENV_FILE;
const isAntigravity = process.argv.includes('--antigravity');

if (!r || !d) {
  if (isAntigravity) {
    process.stdout.write('{}');
  }
  process.exit(0);
}

const src = p.join(r, 'scripts', 'native-deps.json');
const dst = p.join(d, 'package.json');

function hasInstalledDeps(dataDir, desiredText) {
  try {
    if (fs.readFileSync(dst, 'utf8') !== desiredText) return false;
  } catch {
    return false;
  }
  let deps = [];
  try {
    deps = Object.keys(JSON.parse(desiredText)?.dependencies || {});
  } catch {
    return false;
  }
  const nmDir = p.join(dataDir, 'node_modules');
  return deps.every((pkg) => fs.existsSync(p.join(nmDir, ...pkg.split('/'), 'package.json')));
}

const desired = fs.readFileSync(src, 'utf8');
if (!hasInstalledDeps(d, desired)) {
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(dst, desired);
  try {
    cp.execSync('npm install --omit=dev --no-audit --no-fund', {
      cwd: d,
      stdio: ['ignore', process.stderr, process.stderr],
    });
  } catch (err) {
    try {
      fs.rmSync(dst, { force: true });
    } catch {}
    throw err;
  }
}

var pd = p.join(os.homedir(), '.copilot-studio-cli');
fs.mkdirSync(pd, { recursive: true });
fs.writeFileSync(
  p.join(pd, 'plugin-paths.json'),
  JSON.stringify({ pluginData: d, pluginRoot: r })
);

if (e) {
  persistEnvironment(e, d, r);
}

if (isAntigravity) {
  process.stdout.write('{}');
}
