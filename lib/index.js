/**
 * `dsh-rea` host half.
 *
 * Two jobs:
 *
 *  1. Keep the browser half discoverable. dsh-client-modules resolves a Loader
 *     row to its package by exact package specifier, so this package must be
 *     mounted under its bare name for /plugins/dsh-rea/client.js to exist. This
 *     module *is* that bare-name row.
 *  2. Serve the settings page's transport: a `/dsh-rea` prefix route on the
 *     webServer service. `webServer.register` has no authentication or origin
 *     policy of its own, so every request passes three gates here (guard header,
 *     Sec-Fetch-Site, Origin/Host agreement) before any core function runs.
 *
 * All logic lives in ./core.js, which has no Cordis dependency and is exercised
 * offline by test/run.mjs, test/http.mjs and test/client.mjs.
 *
 * @module dsh-rea
 */
import {
  applySettingsPatch,
  configPath,
  doctor,
  overview,
  readConfig,
  reaHome,
  resolveFolder,
  reveal,
  syncEnvironment,
  updateRea,
  verify,
} from './core.js';

/** Plugin name = package name = browser module id. */
export const name = 'dsh-rea';
/** No services are injected: the route is installed defensively via ctx.get. */
export const inject = [];

/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/dsh-rea';
/** Custom header every request must carry (defence against CSRF-style driving). */
export const GUARD_HEADER = 'x-dsh-rea';
/** Reject request bodies above this size. */
const MAX_BODY_BYTES = 64 * 1024;

/** Management endpoints, in the order the settings page uses them. */
const ENDPOINTS = [
  { method: 'GET', path: '/overview', label: 'overview', timeoutMs: 30000, run: (body, env) => overview(env) },
  { method: 'POST', path: '/doctor', label: 'doctor', timeoutMs: 300000, run: (body, env) => doctor(env) },
  {
    // A failing engine is a *report*, not a failed request: the page needs the
    // per-engine table even when some engine is missing, so `ok` stays true and
    // the verdict travels in `allPassed`.
    method: 'POST',
    path: '/verify',
    label: 'verify',
    timeoutMs: 300000,
    run: async (body, env) => {
      const result = await verify(env);
      if (!Array.isArray(result.steps)) return result;
      return { ok: true, allPassed: result.ok === true, steps: result.steps, generatedAt: result.generatedAt };
    },
  },
  {
    method: 'POST',
    path: '/save',
    label: 'save',
    timeoutMs: 60000,
    run: (body, env) => applySettingsPatch(body.patch, env),
  },
  { method: 'POST', path: '/sync', label: 'sync', timeoutMs: 180000, run: (body, env) => syncEnvironment(env) },
  { method: 'POST', path: '/update', label: 'update', timeoutMs: 900000, run: (body, env) => updateRea(env) },
  {
    method: 'POST',
    path: '/reveal',
    label: 'reveal',
    timeoutMs: 30000,
    run: async (body, env) => {
      if (typeof body.folder === 'string') {
        const folder = resolveFolder(body.folder, env);
        if (folder === null) return { ok: false, error: `unknown folder: ${body.folder}`, unknownFolder: true, status: 400 };
        return reveal(folder, env);
      }
      if (typeof body.path === 'string') return reveal(body.path, env);
      return { ok: false, error: 'body must contain folder or path', status: 400 };
    },
  },
];

/** Find the descriptor for a request, or null. */
export function matchRoute(method, pathname) {
  const relative = pathname.startsWith(ROUTE_PREFIX) ? pathname.slice(ROUTE_PREFIX.length) : null;
  if (relative === null) return null;
  const clean = relative.split('?')[0].replace(/\/+$/, '') || '/';
  return ENDPOINTS.find((endpoint) => endpoint.path === clean && endpoint.method === method.toUpperCase()) ?? null;
}

/** Does the request carry the guard header and a same-origin shape? */
export function guardRequest(req) {
  const headers = req.headers ?? {};
  if (headers[GUARD_HEADER] !== '1') return false;
  const site = headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false;
  const origin = headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      return false;
    }
    const expected = headers.host;
    if (typeof expected === 'string' && host !== expected) return false;
  }
  return true;
}

/** Write a JSON response. */
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? { ok: false, error: 'no payload' });
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/** Read a bounded request body; resolves to `{}` when there is none. */
export function readJsonBody(req) {
  return new Promise((resolvePromise) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolvePromise(value);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish({ ok: false, error: 'request body too large', status: 413 });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        finish({ ok: true, body: {} });
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') {
        finish({ ok: true, body: {} });
        return;
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          finish({ ok: false, error: 'request body must be a JSON object', status: 400 });
          return;
        }
        finish({ ok: true, body: parsed });
      } catch (cause) {
        finish({ ok: false, error: `invalid JSON body: ${cause?.message ?? cause}`, status: 400 });
      }
    });
    req.on('error', (cause) => finish({ ok: false, error: String(cause?.message ?? cause), status: 400 }));
  });
}

/**
 * Build the route handler. `logger` may be undefined; it only records problems,
 * it never changes a response.
 */
export function createHandler(logger) {
  const note = (message) => {
    try {
      logger?.(message);
    } catch {
      /* logging must never break a response */
    }
  };

  return async function handler(req, res) {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = typeof req.url === 'string' ? req.url : '/';

    if (!url.startsWith(ROUTE_PREFIX)) {
      sendJson(res, 404, { ok: false, error: `outside ${ROUTE_PREFIX}` });
      return;
    }
    if (!guardRequest(req)) {
      note(`refused ${method} ${url}: guard header or origin check failed`);
      sendJson(res, 403, { ok: false, error: `missing or invalid ${GUARD_HEADER} request guard` });
      return;
    }

    const descriptor = matchRoute(method, url);
    if (descriptor === null) {
      sendJson(res, 404, { ok: false, error: `no such endpoint: ${method} ${url.split('?')[0]}` });
      return;
    }

    let body = {};
    if (method === 'POST') {
      const contentType = String(req.headers?.['content-type'] ?? '');
      if (!contentType.toLowerCase().includes('application/json')) {
        sendJson(res, 415, { ok: false, error: 'POST requires content-type: application/json' });
        return;
      }
      const parsed = await readJsonBody(req);
      if (parsed.ok !== true) {
        sendJson(res, parsed.status ?? 400, { ok: false, error: parsed.error });
        return;
      }
      body = parsed.body;
    }

    try {
      const result = await descriptor.run(body, process.env);
      const status = typeof result?.status === 'number' ? result.status : result?.ok === false ? 400 : 200;
      if (result !== null && typeof result === 'object' && 'status' in result) delete result.status;
      if (status >= 400) note(`${descriptor.label} failed: ${result?.error ?? 'unknown error'}`);
      sendJson(res, status, { endpoint: descriptor.label, ...result });
    } catch (cause) {
      const message = String(cause?.message ?? cause);
      note(`${descriptor.label} threw: ${message}`);
      sendJson(res, 500, { ok: false, endpoint: descriptor.label, error: message });
    }
  };
}

/** Facts the settings page and diagnostics show about this package. */
export function shippedDefaults() {
  return {
    name,
    route: ROUTE_PREFIX,
    guardHeader: GUARD_HEADER,
    home: reaHome(),
    configFile: configPath(),
    bridge: new URL('../bridge/index.mjs', import.meta.url).pathname.replace(/^\//, ''),
    endpoints: ENDPOINTS.map((endpoint) => `${endpoint.method} ${ROUTE_PREFIX}${endpoint.path}`),
  };
}

/**
 * Install the prefix route on the webServer service. Degrades quietly when the
 * service is absent (the MCP half keeps working) instead of failing activation.
 */
export function installRoute(ctx, logger) {
  let webserver = null;
  try {
    webserver = ctx.get('webServer');
  } catch (cause) {
    logger?.(`webServer unavailable: ${String(cause?.message ?? cause)}`);
  }
  if (webserver === null || webserver === undefined || typeof webserver.register !== 'function') {
    logger?.(`webServer service unavailable; ${ROUTE_PREFIX} is not served`);
    return null;
  }
  const handler = createHandler(logger);
  try {
    ctx.effect(function* registerRoute() {
      yield webserver.register({ kind: 'prefix', path: ROUTE_PREFIX, handler });
    }, 'dsh-rea route');
    logger?.(`registered ${ROUTE_PREFIX} (bright: REA settings page transport)`);
    return handler;
  } catch (cause) {
    logger?.(`cannot register ${ROUTE_PREFIX}: ${String(cause?.message ?? cause)}`);
    return null;
  }
}

/** Cordis entry point for the bare-name row. */
export function apply(ctx) {
  const logger = typeof ctx?.logger?.info === 'function' ? (message) => ctx.logger.info(`[dsh-rea] ${message}`) : undefined;
  installRoute(ctx, logger);
}

export { readConfig };