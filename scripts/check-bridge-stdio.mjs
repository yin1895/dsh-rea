/**
 * Offline bridge check: does the packaged bridge start and complete an MCP
 * `initialize` handshake without a REA installation?
 *
 *   node scripts/check-bridge-stdio.mjs
 *
 * `initialize` is answered by the bridge itself, so this runs on a bare runner;
 * the REA child process is only spawned for tools/list and tools/call, which is
 * what bridge/smoke.mjs covers on a machine that has REA installed.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridge = join(ROOT, 'bridge', 'index.mjs');

const child = spawn(process.execPath, [bridge], { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString('utf8');
});
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8');
});

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'contract-check', version: '0' } },
});

const deadline = Date.now() + 20000;
const waitFor = async () => {
  while (Date.now() < deadline) {
    const line = stdout.split('\n').find((entry) => entry.trim() !== '' && entry.includes('"id":1'));
    if (line !== undefined) return line;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
  }
  return null;
};

const line = await waitFor();
try {
  child.stdin.end();
} catch {
  /* already closed */
}
child.kill();

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok === true) {
    process.stdout.write(`PASS  ${label}\n`);
    return;
  }
  failures += 1;
  process.stdout.write(`FAIL  ${label}${detail ? `  — ${detail}` : ''}\n`);
};

check('bridge answered initialize', line !== null, `stderr: ${stderr.trim().split('\n').slice(-1)[0] ?? ''}`);
if (line !== null) {
  let reply = null;
  try {
    reply = JSON.parse(line);
  } catch {
    reply = null;
  }
  check('reply is valid JSON-RPC', reply?.jsonrpc === '2.0');
  check('no protocol error', reply?.error === undefined, JSON.stringify(reply?.error));
  check('server info present', typeof reply?.result?.serverInfo?.name === 'string', JSON.stringify(reply?.result?.serverInfo));
  check('tools capability advertised', reply?.result?.capabilities?.tools !== undefined);
}

process.stdout.write(`\n${failures === 0 ? 'bridge OK' : `${failures} bridge violation(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);