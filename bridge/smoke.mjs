/**
 * Interactive smoke test for the REA <-> DSH bridge.
 *
 * Keeps stdin open (like a real MCP client) instead of piping a file, because a
 * closed stdin legitimately ends the bridge. Reports the advertised catalog size,
 * meta-tool behavior, and whether a real REA tool call round-trips.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(HERE, 'index.mjs');

const child = spawn(process.execPath, [BRIDGE], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderrText = '';
child.stderr.on('data', (chunk) => { stderrText += chunk; });

const responses = new Map();
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).replace(/\r$/, '');
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id !== undefined) responses.set(String(message.id), message);
  }
});

const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);

/**
 * Mirror what DeepSeek Harness sends when it negotiates protocol revision
 * 2026-07-28: every request carries a `_meta` envelope with the negotiated
 * protocol version and the client's capabilities. REA rejects requests without
 * it under that revision, so the bridge must repeat it on bridge-owned requests.
 */
const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': { tools: {} },
  'io.modelcontextprotocol/clientInfo': { name: 'smoke', version: '1.0.0' },
};
const withMeta = (method, params = {}) => ({ ...params, _meta: META });

async function waitFor(id, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (responses.has(String(id))) return responses.get(String(id));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for id=${id}`);
}

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

try {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: withMeta('initialize', { protocolVersion: '2026-07-28', capabilities: { tools: {} }, clientInfo: { name: 'smoke', version: '1.0' } }) });
  const init = await waitFor(1);
  console.log('initialize ->', init.result?.serverInfo, '| protocol:', init.result?.protocolVersion);

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: withMeta('tools/list') });
  const list = await waitFor(2);
  const tools = list.result.tools;
  console.log('\ntools/list ->');
  console.log('  advertised tools:', tools.length);
  console.log('  advertised bytes:', bytes(tools));
  console.log('  names:', tools.map((t) => t.name).join(', '));
  console.log('  any outputSchema advertised:', tools.some((t) => t.outputSchema));

  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: withMeta('tools/call', { name: 'rea_catalog', arguments: {} }) });
  const index = await waitFor(3);
  const indexText = index.result.content[0].text;
  console.log('\nrea_catalog (index) ->', indexText.split('\n').slice(0, 4).join(' | '));
  console.log('  resultType:', index.result.resultType, '(required by protocol 2026-07-28)');

  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: withMeta('tools/call', { name: 'rea_catalog', arguments: { query: 'decompile function' } }) });
  const search = await waitFor(4);
  console.log('\nrea_catalog (query) ->');
  console.log(search.result.content[0].text.split('\n').slice(0, 8).join('\n'));

  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: withMeta('tools/call', { name: 'rea_catalog', arguments: { name: 'binary_session' } }) });
  const schema = await waitFor(5);
  console.log('\nrea_catalog (schema) ->');
  console.log(schema.result.content[0].text.split('\n').slice(0, 12).join('\n'));

  // Prove a tool that is NOT advertised is still fully callable.
  send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: withMeta('tools/call', { name: 'rea_call', arguments: { tool: 'list_adb_devices', args: {} } }) });
  const proxied = await waitFor(6);
  const proxiedText = proxied.result?.content?.[0]?.text ?? JSON.stringify(proxied.result).slice(0, 300);
  console.log('\nrea_call(list_adb_devices) [never advertised] ->');
  console.log('  isError:', proxied.result?.isError ?? false);
  console.log('  resultType (bridge-stamped):', proxied.result?.resultType);
  console.log(' ', proxiedText.split('\n').slice(0, 6).join('\n  '));

  // Unknown tool must surface REA's own error rather than being masked.
  send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: withMeta('tools/call', { name: 'rea_call', arguments: { tool: 'definitely_not_a_rea_tool', args: {} } }) });
  const bad = await waitFor(7);
  console.log('\nrea_call(unknown tool) -> isError:', bad.result?.isError ?? false);
  console.log(' ', String(bad.result?.content?.[0]?.text ?? '').split('\n')[0].slice(0, 200));

  console.log('\n--- bridge stderr ---');
  console.log(stderrText.trim() || '(empty)');
} catch (cause) {
  console.error('SMOKE TEST FAILED:', cause.message);
  console.error('stderr:', stderrText);
  process.exitCode = 1;
} finally {
  child.kill();
}

