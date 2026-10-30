/**
 * Offline test for the `dsh-rea` host half.
 *
 *   node D:\REA-tool\plugin\dsh-rea\test\run.mjs
 *
 * Drives lib/core.js and lib/index.js without Cordis, a web server, or a running
 * Harness: configuration round-trip, engine presence, the route gates and the
 * shipped-artifact wiring are all checked against the real machine.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');

const { applySettingsPatch, configPath, enginePresence, overview, readConfig, reaHome, resolveFolder, verify } =
  await import(new URL('../lib/core.js', import.meta.url));
const { createHandler, GUARD_HEADER, ROUTE_PREFIX, name, shippedDefaults } = await import(
  new URL('../lib/index.js', import.meta.url)
);

let failures = 0;
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: ok === true, detail });
  if (ok !== true) failures += 1;
};

// ---- 1. config file ---------------------------------------------------------
const config = readConfig();
check('config readable', config.ok === true, config.ok === true ? config.file : config.error);
check('config path is the single source of truth', configPath() === join(reaHome(), 'config', 'rea.env.json'), configPath());

// ---- 2. engine presence -----------------------------------------------------
const engines = enginePresence(config.ok === true ? config.config : {});
const present = engines.filter((engine) => engine.present).map((engine) => engine.id);
const missing = engines.filter((engine) => !engine.present).map((engine) => engine.id);
check('engines probed', engines.length >= 8, `present: ${present.join(', ')} | missing: ${missing.join(', ') || 'none'}`);

// ---- 3. overview ------------------------------------------------------------
const view = await overview();
check('overview ok', view.ok === true, `version=${view.reaVersion} launcher=${view.launcherExists}`);
check('overview reports folders', Array.isArray(view.folders) && view.folders.length > 0);
check('overview reports mcp policy', Array.isArray(view.mcp?.directTools) && view.mcp.directTools.length > 0, (view.mcp?.directTools ?? []).join(', '));

// ---- 4. settings patch round-trip ------------------------------------------
const before = readConfig().config;
const markerKey = 'REA_LOG_LEVEL';
const original = before.variables?.[markerKey];
const applied = applySettingsPatch({ variables: { [markerKey]: 'error' } });
check('patch applies', applied.ok === true, JSON.stringify(applied.changed ?? applied.error));
check('patch is persisted', readConfig().config?.variables?.[markerKey] === 'error');
const restored = applySettingsPatch({ variables: { [markerKey]: original ?? '' } });
check('patch restores previous value', restored.ok === true, String(original ?? '(unset)'));
const rejected = applySettingsPatch({ variables: { NOPE_SETTING: 'x' } });
check('unknown setting rejected', rejected.ok === false, JSON.stringify(rejected.rejected ?? rejected.error));
const badPath = applySettingsPatch({ variables: { GHIDRA_INSTALL_DIR: 'relative/path' } });
check('relative path rejected', badPath.ok === false, String(badPath.error));
const badLevel = applySettingsPatch({ variables: { REA_LOG_LEVEL: 'loud' } });
check('invalid log level rejected', badLevel.ok === false, JSON.stringify(badLevel.rejected ?? badLevel.error));
const badTools = applySettingsPatch({ mcp: { directTools: 'not-an-array' } });
check('invalid directTools rejected', badTools.ok === false, String(badTools.error));
check('folder resolution is inside the REA home', String(resolveFolder('logs')).startsWith(reaHome()), String(resolveFolder('logs')));
check('unknown folder resolves to null', resolveFolder('nope') === null);

// ---- 5. route handler -------------------------------------------------------
const handler = createHandler(() => {});
const call = (method, url, headers = {}, body) =>
  new Promise((resolvePromise) => {
    const req = {
      method,
      url,
      headers,
      on(event, listener) {
        if (event === 'data' && body !== undefined) listener(Buffer.from(JSON.stringify(body)));
        if (event === 'end') listener();
        return req;
      },
      destroy() {},
    };
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      end(text) {
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        resolvePromise({ status: this.statusCode, body: parsed });
      },
    };
    void handler(req, res);
  });

const forbidden = await call('GET', ROUTE_PREFIX + '/overview');
check('missing guard header refused', forbidden.status === 403, `status=${forbidden.status}`);

const unknown = await call('GET', ROUTE_PREFIX + '/nope', { [GUARD_HEADER]: '1' });
check('unknown endpoint 404s', unknown.status === 404, `status=${unknown.status}`);

const overviewResponse = await call('GET', ROUTE_PREFIX + '/overview', { [GUARD_HEADER]: '1' });
check('GET /overview answers', overviewResponse.status === 200 && overviewResponse.body?.ok === true, `status=${overviewResponse.status}`);

const saveResponse = await call(
  'POST',
  ROUTE_PREFIX + '/save',
  { [GUARD_HEADER]: '1', 'content-type': 'application/json' },
  { patch: { mcp: { searchLimit: 25 } } },
);
check('POST /save answers', saveResponse.status === 200 && saveResponse.body?.ok === true, `status=${saveResponse.status} ${JSON.stringify(saveResponse.body?.changed ?? saveResponse.body?.error)}`);

const rejectedResponse = await call(
  'POST',
  ROUTE_PREFIX + '/save',
  { [GUARD_HEADER]: '1', 'content-type': 'application/json' },
  { patch: { variables: { NOPE: 'x' } } },
);
check('POST /save refuses unknown settings with 400', rejectedResponse.status === 400, `status=${rejectedResponse.status}`);

const revealResponse = await call(
  'POST',
  ROUTE_PREFIX + '/reveal',
  { [GUARD_HEADER]: '1', 'content-type': 'application/json' },
  { folder: 'nope' },
);
check('POST /reveal refuses an unknown folder', revealResponse.status === 400, `status=${revealResponse.status}`);

// ---- 6. verify (bounded engine probe) --------------------------------------
const verification = await verify();
check('verify returns steps', Array.isArray(verification.steps) && verification.steps.length > 0, `allPassed=${verification.ok} steps=${verification.steps?.length ?? 0}`);

// ---- 7. shipped artifacts ---------------------------------------------------
const client = readFileSync(join(PLUGIN, 'lib', 'client.js'), 'utf8');
check('client bundle loads through the module loader', client.includes('window.__ModuleLoader__.load'));
check('client bundle id equals package name', client.includes(`id: '${name}'`), name);
const manifest = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'));
check('client export declared', manifest.exports['./client'] === './lib/client.js');
check('patch declared', manifest.dsh.bundle.patch === './cordis.patch.yml');
const patch = readFileSync(join(PLUGIN, 'cordis.patch.yml'), 'utf8');
check('patch mounts the bare-name row', /id:\s*dsh-rea\b/.test(patch));
check('patch mounts the REA MCP row', /serverName:\s*rea/.test(patch) && patch.includes('bridge\\index.mjs'));
check('bridge file present', readFileSync(join(PLUGIN, 'bridge', 'index.mjs'), 'utf8').includes('REA -> DeepSeek Harness MCP bridge'));

// ---- report -----------------------------------------------------------------
const defaults = shippedDefaults();
process.stdout.write('\ndsh-rea offline test\n');
process.stdout.write(`home      : ${defaults.home}\n`);
process.stdout.write(`config    : ${defaults.configFile}\n`);
process.stdout.write(`endpoints : ${defaults.endpoints.join(', ')}\n\n`);
for (const result of results) {
  process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}  ${result.label}${result.detail ? `  — ${result.detail}` : ''}\n`);
}
process.stdout.write(`\n${results.length - failures}/${results.length} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);