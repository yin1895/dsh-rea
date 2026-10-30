/**
 * `dsh-rea` core: every filesystem/process operation the settings page can ask
 * for, with no Cordis dependency at all. `lib/index.js` only wires these
 * functions to an HTTP route; `test/run.mjs` drives them offline.
 *
 * Single source of truth: D:\REA-tool\config\rea.env.json
 *   variables / pathPrepend / launcher / node  -> REA child process environment
 *   mcp                                        -> MCP advertisement policy
 * The CLI wrappers (D:\REA-tool\bin\*), the MCP bridge and this plugin all read
 * and write that one file, so nothing is configured twice.
 *
 * Every exported function answers a plain JSON-serialisable object and never
 * throws; failures become `{ ok: false, error: "..." }`.
 *
 * @module dsh-rea/core
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Machine-wide REA home created for this installation. */
export const DEFAULT_HOME = 'D:\\REA-tool';
/** REA home override for a moved installation. */
export const HOME_ENV = 'REA_TOOL_HOME';

/** Resolved REA home (no trailing separator). */
export function reaHome(env = process.env) {
  const configured = env[HOME_ENV];
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim().replace(/[\\/]+$/, '');
  return DEFAULT_HOME;
}

/** The one configuration file. */
export function configPath(env = process.env) {
  return join(reaHome(env), 'config', 'rea.env.json');
}

/** Default layout inside the REA home. */
export function layout(home = DEFAULT_HOME) {
  return {
    home,
    config: join(home, 'config', 'rea.env.json'),
    cmdEnv: join(home, 'config', 'rea.env.cmd'),
    logs: join(home, 'logs'),
    work: join(home, 'work'),
    evidence: join(home, 'evidence'),
    samples: join(home, 'samples'),
    bin: join(home, 'bin'),
    engines: join(home, 'engines'),
    tools: join(home, 'tools'),
    plugin: join(home, 'plugin', 'dsh-rea'),
    node: join(home, 'node', 'node.exe'),
    launcher: join(home, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'),
  };
}

// --------------------------------------------------------------------- config

/** Read + validate the config file. */
export function readConfig(env = process.env) {
  const file = configPath(env);
  if (!existsSync(file)) {
    return { ok: false, error: `config file not found: ${file}`, file };
  }
  try {
    const text = readFileSync(file, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'config root must be a JSON object', file };
    }
    return { ok: true, file, config: parsed };
  } catch (cause) {
    return { ok: false, error: `cannot read ${file}: ${cause?.message ?? cause}`, file };
  }
}

/** Write the config atomically, keeping one `.bak` of the previous content. */
export function writeConfig(config, env = process.env) {
  const file = configPath(env);
  try {
    mkdirSync(dirname(file), { recursive: true });
    const body = `${JSON.stringify(config, null, 2)}\n`;
    if (existsSync(file)) {
      const backup = `${file}.bak`;
      try {
        writeFileSync(backup, readFileSync(file), 'utf8');
      } catch {
        /* a missing backup never blocks the write */
      }
    }
    const temp = `${file}.tmp-${process.pid}`;
    writeFileSync(temp, body, 'utf8');
    renameSync(temp, file);
    return { ok: true, file, bytes: Buffer.byteLength(body) };
  } catch (cause) {
    return { ok: false, error: `cannot write ${file}: ${cause?.message ?? cause}` };
  }
}

/** Variable names the settings page may edit. */
const EDITABLE_VARIABLES = new Set([
  'GHIDRA_INSTALL_DIR',
  'JAVA_HOME',
  'REA_ANALYSIS_PROVIDER',
  'REA_ADB_PATH',
  'REA_APKTOOL_COMMAND',
  'REA_BROWSER_EXECUTABLE',
  'REA_JADX_MCP_JAR',
  'REA_ILSPY_CMD_PATH',
  'REA_MCP_INPUT_SCHEMA_PROFILE',
  'REA_MCP_OUTPUT_SCHEMA_PROFILE',
  'REA_LOG_LEVEL',
  'REA_IDA_MCP_CONFIG',
  'REA_JEB_MCP_URL',
  'REA_GHIDRA_STARTUP_TIMEOUT_MS',
]);

const PATH_VARIABLES = new Set([
  'GHIDRA_INSTALL_DIR',
  'JAVA_HOME',
  'REA_ADB_PATH',
  'REA_APKTOOL_COMMAND',
  'REA_BROWSER_EXECUTABLE',
  'REA_JADX_MCP_JAR',
  'REA_ILSPY_CMD_PATH',
  'REA_IDA_MCP_CONFIG',
]);

const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
const SCHEMA_PROFILES = new Set(['full', 'off']);
const INPUT_PROFILES = new Set(['full', 'compact']);

function absoluteOrNull(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const candidate = value.trim();
  if (!/^[A-Za-z]:[\\/]|^\\\\|^\//.test(candidate)) return null;
  return candidate;
}

/**
 * Apply a settings patch.
 *
 * `patch.variables` merges key-by-key into `variables` (an empty string deletes
 * the key). `patch.mcp` merges into the MCP policy. `patch.launcher` /
 * `patch.node` must be absolute paths that exist.
 */
export function applySettingsPatch(patch, env = process.env) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'patch must be a JSON object' };
  }
  const current = readConfig(env);
  if (current.ok !== true) return current;
  const config = current.config;
  const changed = [];
  const rejected = [];

  if (patch.variables !== undefined) {
    if (patch.variables === null || typeof patch.variables !== 'object' || Array.isArray(patch.variables)) {
      return { ok: false, error: 'patch.variables must be a JSON object' };
    }
    const variables = { ...(config.variables ?? {}) };
    for (const [name, rawValue] of Object.entries(patch.variables)) {
      if (!EDITABLE_VARIABLES.has(name)) {
        rejected.push({ setting: name, reason: 'not an editable REA setting' });
        continue;
      }
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (value === '') {
        if (name in variables) {
          delete variables[name];
          changed.push(`${name} (cleared)`);
        }
        continue;
      }
      if (PATH_VARIABLES.has(name) && absoluteOrNull(value) === null) {
        rejected.push({ setting: name, reason: 'must be an absolute path' });
        continue;
      }
      if (name === 'REA_LOG_LEVEL' && !LOG_LEVELS.has(value)) {
        rejected.push({ setting: name, reason: `must be one of ${[...LOG_LEVELS].join(', ')}` });
        continue;
      }
      if (name === 'REA_MCP_OUTPUT_SCHEMA_PROFILE' && !SCHEMA_PROFILES.has(value)) {
        rejected.push({ setting: name, reason: 'must be full or off' });
        continue;
      }
      if (name === 'REA_MCP_INPUT_SCHEMA_PROFILE' && !INPUT_PROFILES.has(value)) {
        rejected.push({ setting: name, reason: 'must be full or compact' });
        continue;
      }
      if (variables[name] !== value) {
        variables[name] = value;
        changed.push(`${name} = ${value}`);
      }
    }
    config.variables = variables;
  }

  if (patch.launcher !== undefined) {
    const launcher = absoluteOrNull(patch.launcher);
    if (launcher === null) return { ok: false, error: 'launcher must be an absolute path' };
    if (!existsSync(launcher)) return { ok: false, error: `launcher not found: ${launcher}` };
    config.launcher = launcher;
    changed.push(`launcher = ${launcher}`);
  }

  if (patch.node !== undefined) {
    const node = absoluteOrNull(patch.node);
    if (node === null) return { ok: false, error: 'node must be an absolute path' };
    if (!existsSync(node)) return { ok: false, error: `node not found: ${node}` };
    config.node = node;
    changed.push(`node = ${node}`);
  }

  if (patch.mcp !== undefined) {
    if (patch.mcp === null || typeof patch.mcp !== 'object' || Array.isArray(patch.mcp)) {
      return { ok: false, error: 'patch.mcp must be a JSON object' };
    }
    const mcp = { ...(config.mcp ?? {}) };
    if (patch.mcp.directTools !== undefined) {
      const list = patch.mcp.directTools;
      if (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string')) {
        return { ok: false, error: 'mcp.directTools must be an array of tool names' };
      }
      const cleaned = [...new Set(list.map((entry) => entry.trim()).filter(Boolean))];
      if (cleaned.length > 40) return { ok: false, error: 'at most 40 direct tools may be advertised' };
      mcp.directTools = cleaned;
      changed.push(`mcp.directTools (${cleaned.length})`);
    }
    if (patch.mcp.stripOutputSchema !== undefined) {
      if (typeof patch.mcp.stripOutputSchema !== 'boolean') return { ok: false, error: 'mcp.stripOutputSchema must be a boolean' };
      mcp.stripOutputSchema = patch.mcp.stripOutputSchema;
      changed.push(`mcp.stripOutputSchema = ${patch.mcp.stripOutputSchema}`);
    }
    for (const [key, min, max] of [
      ['searchLimit', 1, 200],
      ['maxSummaryChars', 20, 400],
      ['catalogTimeoutMs', 1000, 600000],
    ]) {
      if (patch.mcp[key] !== undefined) {
        const value = patch.mcp[key];
        if (!Number.isInteger(value) || value < min || value > max) {
          return { ok: false, error: `mcp.${key} must be an integer between ${min} and ${max}` };
        }
        mcp[key] = value;
        changed.push(`mcp.${key} = ${value}`);
      }
    }
    config.mcp = mcp;
  }

  if (rejected.length > 0) return { ok: false, error: 'some settings were rejected', rejected };
  if (changed.length === 0) return { ok: true, changed: [], note: 'nothing to change' };
  const written = writeConfig(config, env);
  if (written.ok !== true) return written;
  return { ok: true, changed, file: written.file };
}

// --------------------------------------------------------------------- probing

/** Run a command with a hard timeout; never throws. */
export function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  const env = options.env ?? process.env;
  const cwd = options.cwd;
  return new Promise((resolvePromise) => {
    let settled = false;
    let child;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };
    try {
      child = spawn(command, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (cause) {
      finish({ ok: false, code: null, stdout: '', stderr: String(cause?.message ?? cause), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    const cap = options.maxBytes ?? 8 * 1024 * 1024;
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < cap) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < cap) stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ ok: false, code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on('error', (cause) => {
      clearTimeout(timer);
      finish({ ok: false, code: null, stdout, stderr: String(cause?.message ?? cause), timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, code, stdout, stderr, timedOut: false });
    });
  });
}

/** Environment for every REA child process: config variables + PATH prepends. */
export function reaEnvFromConfig(config, base = process.env) {
  const env = { ...base };
  const variables = config?.variables ?? {};
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === 'string' && value.length > 0) env[name] = value;
  }
  const prepend = Array.isArray(config?.pathPrepend) ? config.pathPrepend.filter((entry) => typeof entry === 'string') : [];
  if (prepend.length > 0) {
    const key = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'Path';
    const current = String(env[key] ?? '').split(';').filter(Boolean);
    const missing = prepend.filter((entry) => !current.includes(entry));
    if (missing.length > 0) env[key] = [...missing, ...current].join(';');
  }
  return env;
}

/** Strip REA's optional leading log lines, then parse the JSON envelope. */
export function parseJsonEnvelope(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Read the installed REA package version without starting a process. */
export function installedVersion(env = process.env) {
  const manifest = join(reaHome(env), 'node_modules', 'rea-agents', 'package.json');
  if (!existsSync(manifest)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Which of the configured files/hosts actually exist right now. */
export function enginePresence(config, env = process.env) {
  const variables = config?.variables ?? {};
  const check = (label, value, kind = 'path') => {
    const present = typeof value === 'string' && value.length > 0 && existsSync(value);
    let resolved = kind;
    if (present && kind === 'path') {
      try {
        resolved = statSync(value).isDirectory() ? 'dir' : 'file';
      } catch {
        resolved = 'unknown';
      }
    }
    return { id: label, label, setting: label, value: value ?? null, present, kind: resolved };
  };
  const home = reaHome(env);
  const node = config?.node ?? join(home, 'node', 'node.exe');
  const launcher = config?.launcher ?? join(home, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs');
  return [
    { id: 'node', label: 'Node (pinned)', value: node, present: existsSync(node), kind: 'file' },
    { id: 'rea', label: 'REA launcher', value: launcher, present: existsSync(launcher), kind: 'file' },
    check('GHIDRA_INSTALL_DIR', variables.GHIDRA_INSTALL_DIR),
    check('JAVA_HOME', variables.JAVA_HOME),
    check('REA_JADX_MCP_JAR', variables.REA_JADX_MCP_JAR),
    check('REA_APKTOOL_COMMAND', variables.REA_APKTOOL_COMMAND),
    check('REA_ADB_PATH', variables.REA_ADB_PATH),
    check('REA_BROWSER_EXECUTABLE', variables.REA_BROWSER_EXECUTABLE),
    check('REA_ILSPY_CMD_PATH', variables.REA_ILSPY_CMD_PATH),
  ];
}

/** Everything the settings page renders on first paint. */
export async function overview(env = process.env) {
  const home = reaHome(env);
  const paths = layout(home);
  const current = readConfig(env);
  const config = current.ok === true ? current.config : {};
  const version = installedVersion(env);
  const pluginPatch = join(paths.plugin, 'cordis.patch.yml');
  return {
    ok: true,
    home,
    configFile: current.file,
    configReadable: current.ok === true,
    configError: current.ok === true ? null : current.error,
    node: config.node ?? paths.node,
    launcher: config.launcher ?? paths.launcher,
    launcherExists: existsSync(config.launcher ?? paths.launcher),
    reaVersion: version,
    pluginPath: paths.plugin,
    pluginPatch,
    pluginPatchExists: existsSync(pluginPatch),
    variables: config.variables ?? {},
    mcp: config.mcp ?? {},
    engineNotes: config.engineNotes ?? {},
    engines: enginePresence(config, env),
    folders: [
      { id: 'home', label: 'REA home', path: home, exists: existsSync(home) },
      { id: 'config', label: 'Config', path: dirname(current.file), exists: existsSync(dirname(current.file)) },
      { id: 'logs', label: 'Logs', path: paths.logs, exists: existsSync(paths.logs) },
      { id: 'samples', label: 'Samples', path: paths.samples, exists: existsSync(paths.samples) },
      { id: 'engines', label: 'Engines', path: paths.engines, exists: existsSync(paths.engines) },
      { id: 'tools', label: 'Tools', path: paths.tools, exists: existsSync(paths.tools) },
      { id: 'plugin', label: 'Plugin', path: paths.plugin, exists: existsSync(paths.plugin) },
    ],
  };
}

/**
 * Run `rea doctor --format json` and reduce it to what a settings page shows.
 * Doctor is the authority here: it validates every engine path, the Node
 * version, the Ghidra/Java pairing and the client registrations.
 */
export async function doctor(env = process.env, options = {}) {
  const current = readConfig(env);
  if (current.ok !== true) return { ok: false, error: current.error };
  const config = current.config;
  const paths = layout(reaHome(env));
  const node = config.node ?? paths.node;
  const launcher = config.launcher ?? paths.launcher;
  if (!existsSync(node)) return { ok: false, error: `pinned node not found: ${node}` };
  if (!existsSync(launcher)) return { ok: false, error: `REA launcher not found: ${launcher}` };

  const result = await run(node, [launcher, 'doctor', '--format', 'json'], {
    env: reaEnvFromConfig(config, env),
    timeoutMs: options.timeoutMs ?? 240000,
    maxBytes: 16 * 1024 * 1024,
  });
  const payload = parseJsonEnvelope(result.stdout) ?? parseJsonEnvelope(result.stderr);
  if (payload === null) {
    return {
      ok: false,
      error: result.timedOut ? 'doctor timed out' : 'doctor produced no JSON envelope',
      exitCode: result.code,
      tail: (result.stdout || result.stderr || '').slice(-1200),
    };
  }
  const scopeChecks = Array.isArray(payload.scope_checks) ? payload.scope_checks : [];
  const providers = (Array.isArray(payload.providerInspections) ? payload.providerInspections : []).map((entry) => ({
    id: entry.id,
    configured: entry.configured === true,
    available: entry.available === true,
    version: entry.providerVersion ?? null,
    checks: (Array.isArray(entry.checks) ? entry.checks : []).map((check) => ({
      name: check.name,
      ok: check.ok === true,
      detail: check.detail ?? null,
      classification: check.classification ?? null,
      remediation: check.remediation ?? null,
    })),
  }));
  const failures = scopeChecks
    .filter((check) => check.ok !== true)
    .map((check) => ({
      name: check.name,
      classification: check.classification ?? null,
      detail: check.detail ?? null,
      remediation: check.remediation ?? null,
    }));
  return {
    ok: true,
    healthy: payload.healthy === true,
    environmentHealthy: payload.environment_healthy === true,
    providers,
    availableProviders: Array.isArray(payload.availableProviders) ? payload.availableProviders : [],
    failures,
    counts: payload.identity?.catalog?.counts ?? null,
    scope: payload.scope ?? null,
    skill: payload.identity?.skill ?? null,
    generatedAt: new Date().toISOString(),
  };
}

/** Fast, engine-by-engine verification that needs no analysis target. */
export async function verify(env = process.env, options = {}) {
  const current = readConfig(env);
  if (current.ok !== true) return { ok: false, error: current.error };
  const config = current.config;
  const paths = layout(reaHome(env));
  const node = config.node ?? paths.node;
  const launcher = config.launcher ?? paths.launcher;
  const childEnv = reaEnvFromConfig(config, env);
  const steps = [];
  const push = (step) => steps.push(step);

  push({ id: 'node', ok: existsSync(node), detail: node });

  const reaVersion = await run(node, [launcher, '--version'], { env: childEnv, timeoutMs: 60000 });
  push({ id: 'rea', ok: reaVersion.ok, detail: (reaVersion.stdout || reaVersion.stderr || '').trim().slice(0, 120) });

  for (const entry of enginePresence(config, env)) {
    if (entry.id === 'node' || entry.id === 'rea') continue;
    push({ id: entry.id, ok: entry.present, detail: entry.value ?? '(unset)' });
  }

  const apktool = await run(node, [launcher, 'inspect-apktool-client', '--format', 'json'], { env: childEnv, timeoutMs: 120000 });
  const apktoolJson = parseJsonEnvelope(apktool.stdout);
  push({
    id: 'apktool-probe',
    ok: apktoolJson?.normalized_result?.client?.version !== undefined || apktool.ok,
    detail: apktoolJson?.normalized_result?.client?.version ?? (apktool.stderr || '').slice(0, 160),
  });

  const adb = await run(node, [launcher, 'inspect-adb-client', '--format', 'json'], { env: childEnv, timeoutMs: 120000 });
  const adbJson = parseJsonEnvelope(adb.stdout);
  push({
    id: 'adb-probe',
    ok: adbJson?.normalized_result?.client?.binary_path !== undefined || adb.ok,
    detail: adbJson?.normalized_result?.client?.version ?? (adb.stderr || '').slice(0, 160),
  });

  const sample = join(paths.samples, 'managed-System.netfx.dll');
  const managed = await run(node, [launcher, 'inspect-managed-artifact', sample, '--format', 'json'], {
    env: childEnv,
    timeoutMs: 180000,
  });
  const managedJson = parseJsonEnvelope(managed.stdout);
  push({
    id: 'managed-sample',
    ok: managedJson !== null || !existsSync(sample),
    detail: managedJson?.provider?.id
      ? `provider ${managedJson.provider.id}`
      : existsSync(sample)
        ? (managed.stderr || '').slice(0, 160)
        : 'sample absent',
  });

  const ghidraDir = config.variables?.GHIDRA_INSTALL_DIR;
  if (typeof ghidraDir === 'string' && ghidraDir.length > 0) {
    push({
      id: 'ghidra-headless',
      ok: existsSync(join(ghidraDir, 'support', 'analyzeHeadless.bat')),
      detail: join(ghidraDir, 'support', 'analyzeHeadless.bat'),
    });
    push({
      id: 'ghidra-decompiler',
      ok: existsSync(join(ghidraDir, 'Ghidra', 'Features', 'Decompiler', 'os', 'win_x86_64', 'decompile.exe')),
      detail: 'native decompiler for win32/x64',
    });
  }
  const javaHome = config.variables?.JAVA_HOME;
  if (typeof javaHome === 'string' && javaHome.length > 0) {
    push({ id: 'java', ok: existsSync(join(javaHome, 'bin', 'java.exe')), detail: join(javaHome, 'bin', 'java.exe') });
  }

  return { ok: steps.every((step) => step.ok), steps, generatedAt: new Date().toISOString() };
}

/** Regenerate config\rea.env.cmd and re-publish the user-level variables. */
export async function syncEnvironment(env = process.env) {
  const home = reaHome(env);
  const scripts = [
    ['cmd-env', join(home, 'bin', 'rea-sync-env.ps1')],
    ['user-env', join(home, 'bin', 'rea-set-user-env.ps1')],
  ];
  const steps = [];
  for (const [id, script] of scripts) {
    if (!existsSync(script)) {
      steps.push({ id, ok: false, detail: `missing ${script}` });
      continue;
    }
    const result = await run('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      env,
      timeoutMs: 120000,
    });
    const tail = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? 'ok';
    steps.push({ id, ok: result.ok, detail: result.ok ? tail : `${tail}` });
  }
  return { ok: steps.every((step) => step.ok), steps };
}

/** `npm install rea-agents@latest` into the REA home. */
export async function updateRea(env = process.env) {
  const home = reaHome(env);
  const npm = join(home, 'node', 'npm.cmd');
  const npmCmd = existsSync(npm) ? npm : 'npm';
  const result = await run(npmCmd, ['install', '--prefix', home, 'rea-agents@latest', '--no-audit', '--no-fund'], {
    env,
    timeoutMs: 900000,
    maxBytes: 4 * 1024 * 1024,
  });
  return {
    ok: result.ok,
    version: installedVersion(env),
    exitCode: result.code,
    timedOut: result.timedOut,
    tail: `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).slice(-12).join('\n'),
  };
}

/** Open a folder or file in the OS file manager (host half only). */
export async function reveal(target, env = process.env) {
  const candidate = absoluteOrNull(target);
  if (candidate === null) return { ok: false, error: 'target must be an absolute path' };
  if (!existsSync(candidate)) return { ok: false, error: `not found: ${candidate}` };
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' && statSync(candidate).isFile() ? ['/select,', candidate] : [candidate];
  const result = await run(command, args, { env, timeoutMs: 20000 });
  // explorer.exe exits non-zero even on success; only a spawn failure is reported.
  return { ok: result.timedOut !== true, target: candidate };
}

/** Resolve a folder id from `overview().folders` to a path. */
export function resolveFolder(id, env = process.env) {
  const paths = layout(reaHome(env));
  const table = {
    home: paths.home,
    config: dirname(paths.config),
    logs: paths.logs,
    samples: paths.samples,
    engines: paths.engines,
    tools: paths.tools,
    plugin: paths.plugin,
    work: paths.work,
    evidence: paths.evidence,
  };
  if (!(id in table)) return null;
  return resolve(table[id]);
}