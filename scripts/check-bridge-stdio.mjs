/**
 * Bridge check: does the packaged bridge start, complete an MCP handshake and
 * advertise the progressive-disclosure catalog?
 *
 *   node scripts/check-bridge-stdio.mjs [--require-rea] [--timeout-ms 120000]
 *
 * The bridge relays `initialize` to its REA child, so it needs a REA installation
 * reachable the same way the plugin finds it (an explicit REA_MCP_LAUNCHER, the
 * config file, or a global install beside the running Node). CI installs
 * rea-agents globally and passes --require-rea; without REA the check reports a
 * skip instead of a failure unless that flag is set.
 *
 * What it proves, beyond "it starts":
 *   - the bridge answers the handshake at all (relaying REA's own reply),
 *   - tools/list advertises only the small direct list plus the meta tools,
 *     which is the whole point of the bridge: REA's ~230-tool catalog must not be
 *     re-sent on every request,
 *   - rea_catalog / rea_call exist so the rest of the catalog stays reachable.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE = join(ROOT, 'bridge', 'index.mjs');
/**
 * Mirror what DeepSeek Harness sends when it negotiates revision 2026-07-28:
 * every request carries a `_meta` envelope with the negotiated version and the
 * client capabilities. REA ignores requests without it under that revision.
 */
const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': { tools: {} },
  'io.modelcontextprotocol/clientInfo': { name: 'bridge-check', version: '0' },
};
const withMeta = (params = {}) => ({ ...params, _meta: META });

const requireRea = process.argv.includes('--require-rea');
const timeoutIndex = process.argv.indexOf('--timeout-ms');
const timeoutMs = timeoutIndex >= 0 ? Number(process.argv[timeoutIndex + 1]) : 90000;

let failures = 0;
let skips = 0;
const check = (label, ok, detail = '') => {
  if (ok === true) {
    process.stdout.write(`PASS  ${label}\n`);
    return;
  }
  failures += 1;
  process.stdout.write(`FAIL  ${label}${detail ? `  — ${detail}` : ''}\n`);
};
const skip = (label, detail) => {
  skips += 1;
  process.stdout.write(`SKIP  ${label}${detail ? `  — ${detail}` : ''}\n`);
};

const child = spawn(process.execPath, [BRIDGE], { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString('utf8');
});
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8');
});

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
const replies = new Map();
const deadline = Date.now() + timeoutMs;

/** Collect replies until every id in `ids` has arrived (or the deadline passes). */
const pump = async (ids) => {
  while (Date.now() < deadline) {
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || !trimmed.startsWith('{')) continue;
      let message = null;
      try {
        message = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (message.id !== undefined && !replies.has(message.id)) replies.set(message.id, message);
    }
    if (ids.every((id) => replies.has(id))) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
  }
};

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: withMeta({ protocolVersion: '2026-07-28', capabilities: { tools: {} }, clientInfo: { name: 'bridge-check', version: '0' } }),
});
await pump([1]);

const initialized = replies.get(1);
if (initialized === undefined) {
  const tail = stderr.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
  if (requireRea) check('bridge answers the handshake', false, tail);
  else skip('bridge handshake', `no REA reachable: ${tail}`);
} else {
  check('bridge answers the handshake', initialized.jsonrpc === '2.0' && initialized.error === undefined, JSON.stringify(initialized.error));
  check('server info is present', typeof initialized.result?.serverInfo?.name === 'string', JSON.stringify(initialized.result?.serverInfo));
  check('tools capability advertised', initialized.result?.capabilities?.tools !== undefined);

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: withMeta() });
  await pump([2]);

  const listed = replies.get(2);
  if (listed === undefined) {
    check('tools/list answered', false, 'no reply before the timeout');
  } else {
    const names = (listed.result?.tools ?? []).map((tool) => tool.name);
    check('tools/list answered', listed.error === undefined, JSON.stringify(listed.error));
    check('meta tools are advertised', names.includes('rea_catalog') && names.includes('rea_call'), names.join(', '));
    check(
      'the full REA catalog is NOT advertised',
      names.length > 0 && names.length <= 40,
      `${names.length} tools advertised`,
    );
    check('advertised tools carry input schemas', (listed.result?.tools ?? []).every((tool) => tool.inputSchema !== undefined));
    process.stdout.write(`      advertised: ${names.join(', ')}\n`);
  }
}

try {
  child.stdin.end();
} catch {
  /* already closed */
}
child.kill();

const summary = failures === 0 ? (skips > 0 ? 'bridge skipped (no REA)' : 'bridge OK') : `${failures} violation(s)`;
process.stdout.write(`\n${summary}\n`);
process.exit(failures === 0 ? 0 : 1);