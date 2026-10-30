/**
 * Browser-half test for `dsh-rea`, runnable without a browser.
 *
 *   node D:\REA-tool\plugin\dsh-rea\test\client.mjs [--render]
 *
 * Reproduces what the DSH client module loader does:
 *   1. evaluates lib/client.js as a classic script with a `window.__ModuleLoader__`
 *      stub that captures `{ id, factory }`,
 *   2. calls the factory with a `require` shim (react from test/vendor),
 *   3. checks the module exports `{ name, inject, apply }` and that `apply`
 *      registers exactly one `settings.section` entry with the expected options,
 *   4. optionally renders the section once (ReactDOMServer) to prove the
 *      component does not crash before the first fetch resolves.
 *
 * No network, no host, no DSH process is involved.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');
const manifest = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'));

const require_ = createRequire(import.meta.url);
// React is a browser seed-table entry at runtime (it is not in node_modules), so
// this test keeps a dev-only copy under test/vendor for the render check.
const resolveFrom = [
  join(PLUGIN, 'test', 'vendor'),
  PLUGIN,
  process.env.DSH_PROFILE_DIR,
  'C:\\Users\\Administrator\\.dsh\\profiles\\desktop',
].filter(Boolean);

function resolveModule(specifier) {
  const attempts = [specifier, ...resolveFrom.map((root) => join(root, 'node_modules', specifier))];
  for (const attempt of attempts) {
    try {
      return require_(attempt);
    } catch {
      /* try the next root */
    }
  }
  return null;
}

let failures = 0;
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: ok === true, detail });
  if (ok !== true) failures += 1;
};

// ---- 1. classic-script evaluation + factory call ----------------------------
let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec;
    },
  },
};

const source = readFileSync(join(PLUGIN, 'lib', 'client.js'), 'utf8');
try {
  // eslint-disable-next-line no-new-func -- intentionally mirrors the browser loader
  new Function(source)();
} catch (cause) {
  check('bundle evaluates', false, String(cause?.message ?? cause));
}

check('bundle registers exactly one module', captured !== null);
check('module id equals package name', captured?.id === manifest.name, `${captured?.id} vs ${manifest.name}`);
check('solution exports ./client', manifest.exports?.['./client'] === './lib/client.js');

const react = resolveModule('react');
check('react resolvable for the test', react !== null);

let moduleExports = null;
if (captured !== null && react !== null) {
  const shim = (specifier) => {
    if (specifier === 'react') return react;
    const found = resolveModule(specifier);
    if (found === null) throw new Error(`require(${specifier}) is not available in this test environment`);
    return found;
  };
  try {
    moduleExports = captured.factory(shim);
  } catch (cause) {
    check('factory returns exports', false, String(cause?.message ?? cause));
  }
}

check('exports name', moduleExports?.name === manifest.name, String(moduleExports?.name));
check('exports inject [slots, locale]', Array.isArray(moduleExports?.inject) && moduleExports.inject.join(',') === 'slots,locale', String(moduleExports?.inject));
check('exports apply', typeof moduleExports?.apply === 'function');

// ---- 2. apply() against a stub client context -------------------------------
let registered = null;
let dictionaries = null;
const effects = [];
const ctx = {
  effect(fn, label) {
    effects.push(label);
    if (typeof fn === 'function') fn();
    return () => {};
  },
  locale: {
    register(namespace, table) {
      dictionaries = { namespace, table };
      return () => {};
    },
    bind() {
      return (key) => `t:${key}`;
    },
  },
  slots: {
    inject(slot, producer) {
      const iterator = typeof producer === 'function' ? producer() : null;
      if (iterator !== null && typeof iterator.next === 'function') return iterator.next().value;
      return undefined;
    },
    register(options, component) {
      registered = { options, component };
      return () => {};
    },
  },
};

try {
  moduleExports?.apply(ctx);
} catch (cause) {
  check('apply runs against a stub context', false, String(cause?.message ?? cause));
}

check('apply registers one settings.section entry', registered !== null);
check('slot name is settings.section', registered?.options?.name === 'settings.section', String(registered?.options?.name));
check('section id is rea', registered?.options?.id === 'rea', String(registered?.options?.id));
check('section order is a number', Number.isInteger(registered?.options?.order), String(registered?.options?.order));
check('label is a thunk', typeof registered?.options?.label === 'function', String(registered?.options?.label?.()));
check('inject() provides the translator', typeof registered?.options?.inject === 'function' && typeof registered.options.inject().t === 'function');
check('component is a function', typeof registered?.component === 'function');
check('dictionaries registered', dictionaries?.namespace === manifest.name && typeof dictionaries.table?.zh === 'object');
check('effects declared', effects.length >= 1, effects.join(', '));

// ---- 3. optional render -----------------------------------------------------
if (process.argv.includes('--render') && registered !== null && react !== null) {
  const server = resolveModule('react-dom/server');
  if (server === null) {
    check('react-dom/server available for --render', false, 'not installed under test/vendor');
  } else {
    globalThis.fetch = undefined;
    try {
      const html = server.renderToStaticMarkup(react.createElement(registered.component, { t: (key) => key, close: () => {} }));
      check('section renders its loading state', html.includes('dsh-rea-root') && html.includes('loading'), `${html.length} bytes`);
    } catch (cause) {
      check('section renders its loading state', false, String(cause?.message ?? cause));
    }
  }
}

process.stdout.write('\ndsh-rea browser-half test\n');
for (const result of results) {
  process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}  ${result.label}${result.detail ? `  — ${result.detail}` : ''}\n`);
}
process.stdout.write(`\n${results.length - failures}/${results.length} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);