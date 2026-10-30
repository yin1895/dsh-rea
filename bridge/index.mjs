#!/usr/bin/env node
/**
 * REA -> DeepSeek Harness MCP bridge with progressive tool disclosure.
 *
 * Part of the `dsh-rea` DSH plugin (D:\REA-tool\plugin\dsh-rea). The plugin's
 * bundle patch mounts this file as the `rea` MCP server, and the plugin's
 * settings page owns the configuration this bridge reads:
 *
 *   D:\REA-tool\config\rea.env.json
 *     variables / pathPrepend / launcher / node        -> REA child environment
 *     mcp.directTools, mcp.stripOutputSchema, mcp.*    -> advertisement policy
 *
 * Problem
 * -------
 * REA advertises ~170 tools whose definitions total ~1.95 MB (~510k tokens with
 * an o200k tokenizer). DeepSeek Harness re-sends every registered tool's name,
 * description and input schema on every request, so registering the catalog
 * verbatim does not fit in a 300k-token window. ~78% of that payload is
 * `outputSchema`. REA 6.8.0 now implements `REA_MCP_OUTPUT_SCHEMA_PROFILE=off`
 * and `REA_MCP_INPUT_SCHEMA_PROFILE=compact`, which this bridge also sets on the
 * child; the bridge still owns tool *disclosure*, because even a trimmed
 * 170-tool catalog is re-sent on every request.
 *
 * Neither side can trim the catalog on its own: `@deepseek-ai/dsh-mcp-client`
 * has no include/exclude tool filter, and REA has none either.
 *
 * Solution
 * --------
 * A transparent MCP stdio bridge that keeps REA's *complete* capability set
 * reachable while advertising only a few tools:
 *
 *   - `rea_catalog`  browse/search REA's real catalog, or fetch one tool's
 *                    full input schema on demand
 *   - `rea_call`     invoke any REA tool by its real name with real arguments
 *   - `directTools`  (optional, config.json) a few hot tools advertised natively
 *                    so common work needs no extra round trip
 *
 * Every REA tool stays callable, including tools added by a future REA release:
 * nothing here is hardcoded against a version. Only the *advertisement* shrinks.
 *
 * All other JSON-RPC traffic (initialize, prompts, resources, completions,
 * notifications) passes through byte-for-byte.
 *
 * Installation and engines
 * ------------------------
 * REA lives in D:\REA-tool (see D:\REA-tool\README.md). The launcher is resolved
 * from, in order:
 *
 *   1. REA_MCP_LAUNCHER            (explicit override)
 *   2. D:\REA-tool\config\rea.env.json -> launcher
 *   3. D:\REA-tool\node_modules\rea-agents\scripts\rea.mjs
 *   4. a global npm install beside the node running this bridge, plus nvm4w roots
 *
 * Every analysis engine is injected into the REA child from
 * D:\REA-tool\config\rea.env.json (`variables` + `pathPrepend`), so Ghidra, the
 * JDK, jadx-headless-mcp, Apktool, adb, Chromium and ilspycmd are all available
 * no matter which environment the Harness process inherited. The inherited
 * environment still wins per variable inside REA, and these injected values
 * intentionally take precedence over the ambient PATH/GHIDRA values so that a
 * stale machine-wide setting cannot shadow the D:\REA-tool install.
 *
 * Maintenance: updating REA needs no change here. Point 3 or
 * `npm install --prefix D:\REA-tool rea-agents@latest` is enough, because the
 * launcher is resolved at startup.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.REA_MCP_BRIDGE_CONFIG ?? join(HERE, 'config.json');

/** D:\REA-tool: this machine's REA installation and analysis engines. */
const ENGINE_TOOL_HOME = process.env.REA_TOOL_HOME ?? 'D:\\REA-tool';
const ENGINE_ENV_FILE = join(ENGINE_TOOL_HOME, 'config', 'rea.env.json');

const log = (message) => process.stderr.write(`[rea-bridge] ${message}\n`);

// ---------------------------------------------------------------- configuration

const DEFAULTS = {
  directTools: [],
  stripOutputSchema: true,
  searchLimit: 25,
  maxSummaryChars: 110,
  catalogTimeoutMs: 120000,
};

/**
 * Bridge knobs come from the `mcp` block of the one machine-wide REA config
 * file (D:\REA-tool\config\rea.env.json, the same file the host plugin and the
 * CLI wrappers read). A sibling config.json still works for older setups.
 */
function loadConfig() {
  const sources = [ENGINE_ENV_FILE, CONFIG_PATH].filter((candidate) => existsSync(candidate));
  let raw = {};
  for (const source of sources) {
    try {
      const parsed = JSON.parse(readFileSync(source, 'utf8'));
      if (parsed && typeof parsed.mcp === 'object' && parsed.mcp !== null) {
        raw = { ...raw, ...parsed.mcp };
        log(`bridge config: mcp block of ${source}`);
      } else if (parsed && typeof parsed.directTools !== 'undefined' && source === CONFIG_PATH) {
        raw = { ...raw, ...parsed };
        log(`bridge config: legacy ${source}`);
      }
    } catch (cause) {
      log(`cannot parse ${source}: ${cause.message}`);
    }
  }
  if (sources.length === 0) {
    log(`no config at ${ENGINE_ENV_FILE} or ${CONFIG_PATH}; using defaults`);
  }
  const config = { ...DEFAULTS, ...raw };
  config.directTools = Array.isArray(config.directTools) ? config.directTools : [];
  config.directSet = new Set(config.directTools);
  return config;
}

// ------------------------------------------------------------ launcher lookup

/**
 * Resolve the installed REA MCP launcher without pinning a version.
 *
 * The bridge may be started by nvm4w's node or by Harness's own bundled node,
 * and those have different global roots. nvm4w also keeps one global directory
 * per installed version, so every candidate version directory is probed too.
 * Updating REA with `npm i -g rea-agents@latest` therefore needs no edit here.
 */
/**
 * Load the machine's REA engine configuration (D:\REA-tool\config\rea.env.json).
 *
 * REA resolves its reverse-engineering engines from the environment only (there
 * is no config file), and Harness never inherits the operator's shell profile.
 * Without this, every native/Android/managed operation would answer
 * `provider_unavailable`. One JSON file is shared with
 * D:\REA-tool\bin\rea.cmd and D:\REA-tool\config\rea.env.ps1, so all three
 * entry points agree.
 *
 * Missing or malformed file: log once and fall back to an empty injection,
 * which leaves the inherited environment untouched.
 */
let engineEnvState = null;
function loadEngineEnv() {
  if (engineEnvState) return engineEnvState;
  const file = process.env.REA_TOOL_ENV_FILE ?? ENGINE_ENV_FILE;
  const fallback = { file, loaded: false, launcher: null, node: null, vars: {}, pathPrepend: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const vars = {};
    for (const [name, value] of Object.entries(parsed.variables ?? {})) {
      if (typeof value === 'string' && value.length > 0) vars[name] = value;
    }
    for (const [name, value] of Object.entries(parsed.extraVariables ?? {})) {
      if (typeof value === 'string' && value.length > 0) vars[name] = value;
    }
    const launcher = typeof parsed.launcher === 'string' && existsSync(parsed.launcher) ? parsed.launcher : null;
    const node = typeof parsed.node === 'string' && existsSync(parsed.node) ? parsed.node : null;
    const pathPrepend = Array.isArray(parsed.pathPrepend)
      ? parsed.pathPrepend.filter((entry) => typeof entry === 'string' && entry.length > 0)
      : [];
    engineEnvState = { file, loaded: true, launcher, node, vars, pathPrepend };
    log(`engine env: ${file} (${Object.keys(vars).length} variables, ${pathPrepend.length} path entries)`);
  } catch (cause) {
    engineEnvState = fallback;
    log(`engine env: ${file} unreadable (${cause.message}); using the inherited environment`);
  }
  return engineEnvState;
}

/** Put the D:\REA-tool engine directories ahead of the inherited PATH. */
function withEnginePath(env, dirs) {
  if (dirs.length === 0) return env;
  const key = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'Path';
  const current = String(env[key] ?? '').split(';').filter(Boolean);
  const missing = dirs.filter((dir) => !current.includes(dir));
  if (missing.length > 0) env[key] = [...missing, ...current].join(';');
  return env;
}

function resolveLauncher() {
  const candidates = [];
  if (process.env.REA_MCP_LAUNCHER) candidates.push(process.env.REA_MCP_LAUNCHER);

  // The local D:\REA-tool installation, then the shared engine configuration.
  candidates.push(join(ENGINE_TOOL_HOME, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'));
  if (loadEngineEnv().launcher) candidates.push(loadEngineEnv().launcher);

  const nodeDir = dirname(process.execPath);
  // npm global root beside the node running this bridge (covers nvm4w + POSIX).
  candidates.push(join(nodeDir, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'));
  candidates.push(join(nodeDir, '..', 'lib', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'));

  // nvm4w layout: <nvm root>/vX.Y.Z/node_modules, plus the active symlink.
  const nvmRoots = [
    process.env.NVM_HOME,
    process.env.NVM_ROOT,
    join(homedir(), 'AppData', 'Local', 'nvm'),
  ].filter(Boolean);
  for (const root of nvmRoots) {
    candidates.push(join(root, 'nodejs', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'));
    try {
      for (const entry of readdirSync(root)) {
        if (!entry.startsWith('v')) continue;
        candidates.push(join(root, entry, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'));
      }
    } catch { /* nvm root absent: skip */ }
  }

  // Common explicit locations, last.
  candidates.push('C:\\nvm4w\\nodejs\\node_modules\\rea-agents\\scripts\\rea.mjs');
  candidates.push(join(homedir(), '.npm-global', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'));

  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;

  log('cannot find rea-agents/scripts/rea.mjs.');
  log('Install it with `npm install -g rea-agents@latest`, or set REA_MCP_LAUNCHER.');
  log(`looked in:\n  ${candidates.filter(Boolean).join('\n  ')}`);
  process.exit(1);
}

// ------------------------------------------------------------ meta-tool schema

const CATALOG_TOOL = {
  name: 'rea_catalog',
  title: 'REA tool catalog',
  description:
    'Browse the full REA reverse-engineering tool catalog. REA ships ~170 tools; they are kept out of the ' +
    'always-visible tool list to save context, and every one of them is callable through `rea_call`.\n\n' +
    'Three modes:\n' +
    '  - no arguments: index of tool families with counts and examples.\n' +
    '  - `query`: search tool names and descriptions (space-separated terms are ANDed), returning name, ' +
    'summary and argument names.\n' +
    '  - `name`: that one tool\'s full description and input schema, which is what you need before `rea_call`.\n\n' +
    'Typical flow: rea_catalog {query} -> rea_catalog {name} -> rea_call {tool, args}.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search terms matched against tool names and descriptions, e.g. "decompile function".',
      },
      name: {
        type: 'string',
        description: 'Exact tool name. Returns that tool\'s full description and input schema.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'Maximum results for a query search.',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

const CALL_TOOL = {
  name: 'rea_call',
  title: 'Call any REA tool',
  description:
    'Invoke any REA tool by its real name, including tools not shown in the current tool list. ' +
    'Use `rea_catalog` to discover a tool name and read its input schema first; `args` must match that schema.\n\n' +
    'The result is REA\'s own MCP result, returned unchanged. Errors from REA (unknown tool, invalid ' +
    'arguments, missing provider) are surfaced as-is rather than being masked.',
  inputSchema: {
    type: 'object',
    properties: {
      tool: { type: 'string', description: 'Exact REA tool name, e.g. "binary_session".' },
      args: {
        type: 'object',
        description: 'Arguments object for that tool. Omit or pass {} for tools that take no arguments.',
        additionalProperties: true,
      },
    },
    required: ['tool'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
};

// ------------------------------------------------------------------ utilities

const summarise = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const stop = cut.lastIndexOf('. ');
  return `${stop > max * 0.5 ? cut.slice(0, stop + 1) : cut}…`;
};

/** Derive tool families from name prefixes, so the index adapts to any version. */
function deriveFamilies(tools) {
  const families = new Map();
  for (const tool of tools) {
    const parts = tool.name.split('_');
    const key = parts.length > 1 ? parts[0] : tool.name;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(tool.name);
  }
  return [...families.entries()].sort((a, b) => b[1].length - a[1].length);
}

const textResult = (text) => ({ content: [{ type: 'text', text }] });

/**
 * Pick the node binary that owns the resolved launcher.
 *
 * Harness starts this bridge with its own bundled node, while REA is usually
 * installed under nvm4w's node. Running REA with the node that owns its global
 * install keeps the two consistent, and falls back to the current executable.
 */
function resolveNodeFor(launcher) {
  if (process.env.REA_MCP_NODE) return process.env.REA_MCP_NODE;
  // The D:\REA-tool installation pins its own Node (REA 6.8.0 needs 24.22.1+).
  // Read it lazily: this helper runs before ENGINE_STATE is initialised.
  const pinned = loadEngineEnv().node;
  if (pinned && existsSync(pinned)) return pinned;
  const marker = join('node_modules', 'rea-agents');
  const index = launcher.lastIndexOf(marker);
  if (index !== -1) {
    // launcher.slice(0, index) is the directory that holds node_modules/, which
    // is also the directory that holds that node's executable.
    const ownerDir = launcher.slice(0, index).replace(/[\\/]+$/, '');
    for (const name of ['node.exe', 'node']) {
      const candidate = join(ownerDir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return process.execPath;
}

// ------------------------------------------------------------------- process

const config = loadConfig();
const launcher = resolveLauncher();
const nodeBinary = resolveNodeFor(launcher);
const statsMode = process.argv.includes('--stats');

log(`launcher: ${launcher}`);
log(`node: ${nodeBinary}`);

/**
 * Analysis-engine prerequisites injected into the REA child process.
 *
 * Two layers:
 *   1. the inherited environment (lowest precedence, copied verbatim), then
 *   2. every variable from D:\REA-tool\config\rea.env.json, which therefore
 *      overrides a stale machine-wide GHIDRA_INSTALL_DIR/JAVA_HOME.
 *
 * `GHIDRA_INSTALL_DIR` must point at the root of an extracted Ghidra 12.1.x
 * release (REA checks <dir>/Ghidra/application.properties and
 * <dir>/support/analyzeHeadless.bat); `JAVA_HOME` must be a 64-bit JDK 21+.
 * An operator can still override the whole file with REA_TOOL_ENV_FILE, or one
 * variable by editing D:\REA-tool\config\rea.env.json.
 */
const ENGINE_STATE = loadEngineEnv();
const ENGINE_ENV = withEnginePath({ ...process.env, ...ENGINE_STATE.vars }, ENGINE_STATE.pathPrepend);

const child = spawn(nodeBinary, [launcher, 'mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  env: ENGINE_ENV,
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { child.kill(); } catch { /* already gone */ }
  process.exit(code);
}
child.on('error', (cause) => { log(`failed to start REA: ${cause.message}`); shutdown(1); });
child.on('exit', (code, signal) => { log(`REA exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`); shutdown(code ?? 1); });
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const writeToChild = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
const writeToClient = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

// ---- upstream request/response plumbing -------------------------------------

const upstreamPending = new Map(); // id -> resolve/reject
let nextUpstreamId = 1;

/**
 * `_meta` envelope captured from the client's own requests.
 *
 * Harness negotiates protocol revision 2026-07-28, which requires every request
 * to carry `io.modelcontextprotocol/protocolVersion` and
 * `io.modelcontextprotocol/clientCapabilities` in `params._meta`. Bridge-originated
 * requests (the catalog fetch, and re-issued tools/call for meta-tools) must
 * repeat that envelope or REA rejects them as malformed.
 */
let clientMeta;

function captureMeta(params) {
  const meta = params?._meta;
  if (meta && typeof meta === 'object') clientMeta = meta;
}

/**
 * Whether bridge-synthesized results need the 2026-07-28 `resultType` stamp.
 *
 * DeepSeek Harness negotiates protocol revision 2026-07-28 (`versionNegotiation:
 * { mode: "auto" }` probes FIRST_MODERN_PROTOCOL_VERSION first), and its codec
 * then rejects every `tools/call` result without `resultType`. REA's own results
 * already carry the stamp because its SDK replies in the same revision; only the
 * bridge's locally built results (`rea_catalog`, `rea_call`) need it.
 *
 * The negotiated revision is not reliably observable from the proxied traffic
 * (negotiation may complete without a visible initialize), so the stamp is
 * applied unconditionally: 2025-era clients ignore unknown result fields, while
 * 2026-07-28 clients require it.
 */
const stampResultType = (result) => {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...result, resultType: 'complete' };
  }
  return result;
};

function callUpstream(method, params, timeoutMs) {
  const id = `rea-bridge-${nextUpstreamId++}`;
  const merged = { ...(params ?? {}) };
  // Bridge-owned requests must repeat the client's envelope under the strict
  // revision, but never on initialize (REA rejects that combination).
  if (clientMeta !== undefined && merged._meta === undefined && method !== 'initialize') {
    merged._meta = clientMeta;
  }
  return new Promise((resolve, reject) => {
    const timer = timeoutMs
      ? setTimeout(() => {
          upstreamPending.delete(id);
          reject(new Error(`${method} timed out after ${timeoutMs} ms`));
        }, timeoutMs)
      : null;
    upstreamPending.set(id, (message) => {
      if (timer) clearTimeout(timer);
      if (message.error) reject(new Error(`${method} failed: ${message.error.message ?? JSON.stringify(message.error)}`));
      else resolve(message.result);
    });
    writeToChild({ jsonrpc: '2.0', id, method, params: merged });
  });
}

let catalog = null;

/** Project one upstream tool definition for advertisement. */
const projectTool = (tool) => {
  const projected = { ...tool };
  if (config.stripOutputSchema) delete projected.outputSchema;
  return projected;
};

const advertisedTools = () => [
  CATALOG_TOOL,
  CALL_TOOL,
  ...(catalog ?? []).filter((tool) => config.directSet.has(tool.name)).map(projectTool),
];

/**
 * Ensure the catalog is available for meta-tool calls.
 *
 * Normal operation fills it from the client's own tools/list exchange, so this
 * only has to act if a meta-tool is called before that reply arrives.
 */
async function fetchCatalog() {
  if (catalog) return catalog;
  const tools = [];
  let cursor;
  do {
    const result = await callUpstream('tools/list', cursor ? { cursor } : {}, config.catalogTimeoutMs);
    for (const tool of result?.tools ?? []) tools.push(tool);
    cursor = result?.nextCursor;
  } while (cursor);
  catalog = tools;
  log(`cached ${tools.length} REA tools (bridge-initiated fetch)`);
  return tools;
}

// ---- meta-tool handlers -----------------------------------------------------

function handleCatalog(args) {
  const tools = catalog ?? [];
  if (args?.name) {
    const tool = tools.find((candidate) => candidate.name === args.name);
    if (!tool) {
      const near = tools
        .filter((candidate) => candidate.name.includes(String(args.name)))
        .slice(0, 8)
        .map((candidate) => candidate.name);
      return textResult(
        `No REA tool named "${args.name}".${near.length ? ` Similar: ${near.join(', ')}` : ''}\n` +
          `Use rea_catalog with a query to search all ${tools.length} tools.`,
      );
    }
    return textResult(
      `# ${tool.name}\n${tool.title ? `(${tool.title})\n` : ''}\n` +
        `${tool.description ?? '(no description)'}\n\n` +
        `## Input schema\n\`\`\`json\n${JSON.stringify(tool.inputSchema ?? {}, null, 2)}\n\`\`\``,
    );
  }

  if (args?.query) {
    const terms = String(args.query).toLowerCase().split(/\s+/).filter(Boolean);
    const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : config.searchLimit;
    // Require every term first; if that finds nothing, fall back to ranking tools
    // that match any term, so a too-specific query still leads somewhere useful.
    const rank = (requireAll) => {
      const scored = [];
      for (const tool of tools) {
        const name = tool.name.toLowerCase();
        const haystack = `${name} ${tool.description ?? ''}`.toLowerCase();
        const hits = terms.filter((term) => haystack.includes(term)).length;
        if (requireAll ? hits !== terms.length : hits === 0) continue;
        const nameHits = terms.filter((term) => name.includes(term)).length;
        scored.push({ tool, score: nameHits * 100 + hits * 10 });
      }
      return scored;
    };
    let scored = rank(true);
    let relaxed = false;
    if (scored.length === 0 && terms.length > 1) {
      scored = rank(false);
      relaxed = scored.length > 0;
    }
    scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
    const shown = scored.slice(0, limit);
    if (shown.length === 0) {
      return textResult(`No REA tool matches "${args.query}" among ${tools.length} tools. Try fewer or broader terms.`);
    }
    const lines = shown.map(({ tool }) => {
      const params = Object.keys(tool.inputSchema?.properties ?? {});
      const required = new Set(tool.inputSchema?.required ?? []);
      const argText = params.length
        ? ` args: ${params.map((p) => (required.has(p) ? `${p}*` : p)).join(', ')}`
        : ' args: none';
      return `- ${tool.name}${argText}\n    ${summarise(tool.description, config.maxSummaryChars)}`;
    });
    return textResult(
      `${shown.length} of ${scored.length} matching tools (${tools.length} total; * = required).\n` +
        (relaxed ? `No tool matched every term, so these match at least one.\n` : '') +
        `Fetch a schema with rea_catalog {name}, then call it with rea_call.\n\n${lines.join('\n')}`,
    );
  }

  const families = deriveFamilies(tools);
  const lines = families
    .slice(0, 30)
    .map(([key, names]) => `- ${key} (${names.length}): ${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''}`);
  return textResult(
    `REA exposes ${tools.length} tools, grouped by family. All are callable through rea_call.\n` +
      `Search with rea_catalog {query: "..."} — space-separated terms are ANDed.\n\n${lines.join('\n')}` +
      (families.length > 30 ? `\n… ${families.length - 30} more families; use a query to narrow.` : ''),
  );
}

async function handleCall(args) {
  const tool = args?.tool;
  if (typeof tool !== 'string' || tool.length === 0) {
    return { content: [{ type: 'text', text: 'rea_call requires a "tool" string.' }], isError: true };
  }
  if (catalog && !catalog.some((candidate) => candidate.name === tool)) {
    log(`rea_call: "${tool}" is not in the cached catalog; forwarding anyway`);
  }
  return callUpstream('tools/call', { name: tool, arguments: args?.args ?? {} });
}

// ---- framing ----------------------------------------------------------------

/** Newline-delimited JSON-RPC, tolerant of very large single frames. */
function readLines(stream, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line.trim().length > 0) onLine(line);
    }
  });
  stream.on('end', () => {
    const line = buffer.trim();
    if (line.length > 0) onLine(line);
  });
}

// ---- client -> upstream -----------------------------------------------------

/**
 * Client `tools/list` requests awaiting REA's reply, keyed by request id.
 *
 * The client's own request is forwarded verbatim so that protocol negotiation
 * (including the 2026-07-28 `_meta` envelope) stays REA's business. Only the
 * *response* is rewritten, which keeps this bridge independent of the revision
 * Harness happens to negotiate.
 */
const clientListRequests = new Map(); // id -> original params (for pagination)

/** Fetch any remaining pages with the same envelope the client used. */
async function collectRemainingPages(params, firstPage) {
  const tools = [...(firstPage?.tools ?? [])];
  let cursor = firstPage?.nextCursor;
  while (cursor) {
    const result = await callUpstream('tools/list', { ...params, cursor }, config.catalogTimeoutMs);
    for (const tool of result?.tools ?? []) tools.push(tool);
    cursor = result?.nextCursor;
  }
  return tools;
}

async function handleClientMessage(line, message) {
  // Remember the client's `_meta` envelope so bridge-owned requests (catalog
  // pages, meta-tool calls) can repeat it under the strict revision.
  captureMeta(message?.params);

  // tools/list: forward the client's request, rewrite only the response.
  if (message?.method === 'tools/list') {
    if (message.id === undefined || message.id === null) {
      child.stdin.write(`${line}\n`);
      return;
    }
    clientListRequests.set(message.id, message.params ?? {});
    child.stdin.write(`${line}\n`);
    return;
  }

  // tools/call: intercept the meta-tools, forward everything else verbatim.
  if (message?.method === 'tools/call') {
    const id = message.id ?? null;
    const name = message.params?.name;
    if (name !== CATALOG_TOOL.name && name !== CALL_TOOL.name) {
      child.stdin.write(`${line}\n`);
      return;
    }
    if (id === null) return; // notification-style call: nothing to answer
    try {
      if (name === CATALOG_TOOL.name) {
        await fetchCatalog();
        writeToClient({ jsonrpc: '2.0', id, result: stampResultType(handleCatalog(message.params?.arguments)) });
      } else {
        writeToClient({ jsonrpc: '2.0', id, result: stampResultType(await handleCall(message.params?.arguments)) });
      }
    } catch (cause) {
      log(`${name} failed: ${cause.message}`);
      writeToClient({
        jsonrpc: '2.0',
        id,
        result: stampResultType({
          content: [{ type: 'text', text: `${name} failed: ${cause.message}` }],
          isError: true,
        }),
      });
    }
    return;
  }

  // initialize: strip _meta. REA's own initialize handler rejects it with
  // "Method not found", while every later request requires the envelope.
  if (message?.method === 'initialize' && message.params?._meta !== undefined) {
    const { _meta, ...params } = message.params;
    writeToChild({ ...message, params });
    return;
  }

  // initialize, prompts, resources, completions, notifications: pass through.
  child.stdin.write(`${line}\n`);
}

readLines(process.stdin, (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    child.stdin.write(`${line}\n`);
    return;
  }
  handleClientMessage(line, message).catch((cause) => log(`client handler failed: ${cause.message}`));
});

// ---- upstream -> client -----------------------------------------------------

async function handleUpstreamMessage(line, message) {
  const id = message?.id;

  // A pending bridge-owned request (catalog page, meta-tool call).
  const handler = id !== undefined ? upstreamPending.get(id) : undefined;
  if (handler) {
    upstreamPending.delete(id);
    handler(message);
    return;
  }

  // REA's reply to a client tools/list: cache the full catalog, rewrite the reply.
  if (id !== undefined && clientListRequests.has(id) && Array.isArray(message?.result?.tools)) {
    const params = clientListRequests.get(id);
    clientListRequests.delete(id);
    try {
      const tools = await collectRemainingPages(params, message.result);
      catalog = tools;
      log(`cached ${tools.length} REA tools`);
      writeToClient({
        ...message,
        result: { ...message.result, tools: advertisedTools() },
      });
    } catch (cause) {
      log(`catalog fetch failed: ${cause.message}`);
      writeToClient({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: `REA catalog unavailable: ${cause.message}` },
      });
    }
    return;
  }

  // REA invalidated its tool list: drop the cache and let the client re-list.
  if (message?.method === 'notifications/tools/list_changed') {
    catalog = null;
    log('REA tool list changed; cache invalidated');
  }

  process.stdout.write(`${line}\n`);
}

readLines(child.stdout, (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${line}\n`);
    return;
  }
  handleUpstreamMessage(line, message).catch((cause) => log(`upstream handler failed: ${cause.message}`));
});

process.stdin.on('end', () => shutdown(0));

// ---- stats mode -------------------------------------------------------------

if (statsMode) {
  (async () => {
    await callUpstream('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'rea-bridge-stats', version: '1.0.0' },
    }, config.catalogTimeoutMs);
    writeToChild({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const tools = await fetchCatalog();
    const advertised = advertisedTools();
    const fullBytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
    const advertisedBytes = Buffer.byteLength(JSON.stringify(advertised), 'utf8');
    process.stdout.write(
      `launcher: ${launcher}\n` +
        `upstream tools: ${tools.length} (${fullBytes} bytes if advertised verbatim)\n` +
        `advertised tools: ${advertised.length} (${advertisedBytes} bytes)\n` +
        `  meta: ${CATALOG_TOOL.name}, ${CALL_TOOL.name}\n` +
        `  direct: ${config.directTools.join(', ') || '(none)'}\n` +
        `reduction: ${(100 * (1 - advertisedBytes / fullBytes)).toFixed(1)}%\n` +
        `advertised names:\n  ${advertised.map((tool) => tool.name).join('\n  ')}\n`,
    );
    shutdown(0);
  })().catch((cause) => { log(`stats failed: ${cause.message}`); shutdown(1); });
}
