/**
 * Host-half HTTP test for `dsh-rea`.
 *
 *   node D:\REA-tool\plugin\dsh-rea\test\http.mjs [--doctor] [--open]
 *
 * Mounts the real `/dsh-rea` prefix route on a local http server and drives it
 * with the same request shape the browser half uses (fetch + the `x-dsh-rea`
 * guard header + same-origin credentials), so the route, the JSON envelopes and
 * the request gates are validated outside DSH.
 *
 * `--doctor` additionally runs the slow `rea doctor` path; `--open` performs a
 * real "reveal in Explorer" call (which opens a window).
 */
import { createServer } from 'node:http';

const { createHandler, ROUTE_PREFIX, GUARD_HEADER, name } = await import(new URL('../lib/index.js', import.meta.url));
const { configPath } = await import(new URL('../lib/core.js', import.meta.url));

let failures = 0;
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: ok === true, detail });
  if (ok !== true) failures += 1;
};

const handler = createHandler(() => {});
const server = createServer((req, res) => {
  if (typeof req.url === 'string' && req.url.startsWith(ROUTE_PREFIX)) {
    void handler(req, res);
    return;
  }
  res.statusCode = 404;
  res.end('{"ok":false,"error":"outside the plugin route"}');
});

await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
const { port } = server.address();
const base = `http://127.0.0.1:${port}${ROUTE_PREFIX}`;

const call = async (method, path, { json, guard = true, contentType = 'application/json' } = {}) => {
  const headers = { accept: 'application/json' };
  if (guard) headers[GUARD_HEADER] = '1';
  const init = { method, headers };
  if (json !== undefined) {
    headers['content-type'] = contentType;
    init.body = JSON.stringify(json);
  }
  const response = await fetch(base + path, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

// ---- gates ------------------------------------------------------------------
const noGuard = await call('GET', '/overview', { guard: false });
check('missing guard header -> 403', noGuard.status === 403, `status=${noGuard.status}`);

const outside = await fetch(`http://127.0.0.1:${port}/somewhere-else`, { headers: { [GUARD_HEADER]: '1' } });
check('outside the prefix -> 404', outside.status === 404, `status=${outside.status}`);

const badContentType = await call('POST', '/save', { json: {}, contentType: 'text/plain' });
check('wrong content-type -> 415', badContentType.status === 415, `status=${badContentType.status}`);

const unknown = await call('GET', '/nope');
check('unknown endpoint -> 404', unknown.status === 404, `status=${unknown.status}`);

// ---- overview ---------------------------------------------------------------
const overview = await call('GET', '/overview');
check('GET /overview -> 200 ok', overview.status === 200 && overview.body?.ok === true, `status=${overview.status}`);
check('overview names the REA home', typeof overview.body?.home === 'string' && overview.body.home.length > 2, String(overview.body?.home));
check('overview reads the one config file', overview.body?.configFile === configPath(), String(overview.body?.configFile));
check('overview reports engines', Array.isArray(overview.body?.engines) && overview.body.engines.length >= 8, `${overview.body?.engines?.length ?? 0} entries`);
check('overview reports the MCP policy', Array.isArray(overview.body?.mcp?.directTools), `${overview.body?.mcp?.directTools?.length ?? 0} direct tools`);
check('overview reports folders', Array.isArray(overview.body?.folders) && overview.body.folders.length > 0);
check('overview reports the installed REA version', typeof overview.body?.reaVersion === 'string', String(overview.body?.reaVersion));

// ---- save -------------------------------------------------------------------
const before = await call('GET', '/overview');
const currentLimit = before.body?.mcp?.searchLimit ?? 25;
const save = await call('POST', '/save', { json: { patch: { mcp: { searchLimit: currentLimit } } } });
check(
  'POST /save accepts a valid patch',
  save.status === 200 && save.body?.ok === true,
  `status=${save.status} ${JSON.stringify(save.body?.changed ?? save.body?.error)}`,
);

const rejected = await call('POST', '/save', { json: { patch: { variables: { NOT_A_SETTING: 'x' } } } });
check('POST /save rejects unknown settings', rejected.status === 400 && rejected.body?.ok === false, `status=${rejected.status}`);

const badPath = await call('POST', '/save', { json: { patch: { variables: { GHIDRA_INSTALL_DIR: 'no/slash' } } } });
check('POST /save rejects a relative path', badPath.status === 400, `status=${badPath.status}`);

// ---- reveal -----------------------------------------------------------------
const badFolder = await call('POST', '/reveal', { json: { folder: 'nope' } });
check('POST /reveal rejects an unknown folder', badFolder.status === 400, `status=${badFolder.status}`);

const missing = await call('POST', '/reveal', { json: { path: 'D:\\definitely-not-here-4242' } });
check('POST /reveal reports a missing path', missing.status === 400 && /not found/i.test(String(missing.body?.error)), `status=${missing.status} ${missing.body?.error}`);

if (process.argv.includes('--open')) {
  const opened = await call('POST', '/reveal', { json: { folder: 'logs' } });
  check('POST /reveal opens the log folder', opened.status === 200 && opened.body?.ok === true, JSON.stringify(opened.body));
}

// ---- verify (bounded engine probes) ----------------------------------------
const verify = await call('POST', '/verify', { json: {} });
check('POST /verify answers', verify.status === 200 && Array.isArray(verify.body?.steps), `${verify.body?.steps?.length ?? 0} steps`);
check('verify reports a verdict', typeof verify.body?.allPassed === 'boolean', String(verify.body?.allPassed));
check(
  'verify covers the configured engines',
  (verify.body?.steps ?? []).some((step) => step.id === 'GHIDRA_INSTALL_DIR'),
  (verify.body?.steps ?? []).map((step) => step.id).join(', '),
);

// ---- doctor (slow, opt-in) --------------------------------------------------
if (process.argv.includes('--doctor')) {
  const doctor = await call('POST', '/doctor', { json: {} });
  check('POST /doctor answers', doctor.status === 200 && doctor.body?.ok === true, `status=${doctor.status} ${doctor.body?.error ?? ''}`);
  check('doctor lists providers', Array.isArray(doctor.body?.providers) && doctor.body.providers.length > 0, `${doctor.body?.providers?.length ?? 0} providers`);
  const counts = doctor.body?.counts;
  check('doctor reports the tool catalog size', typeof counts?.mcp_tools === 'number', `${counts?.mcp_tools ?? '?'} tools`);
  check('doctor reports failures as data', Array.isArray(doctor.body?.failures), doctor.body?.failures?.map((entry) => entry.name).join(', '));
}

server.close();

process.stdout.write(`\ndsh-rea host route test  (${name} at ${ROUTE_PREFIX}, port ${port})\n`);
for (const result of results) {
  process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}  ${result.label}${result.detail ? `  — ${result.detail}` : ''}\n`);
}
process.stdout.write(`\n${results.length - failures}/${results.length} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);