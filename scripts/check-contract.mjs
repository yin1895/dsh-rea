/**
 * Packaging contract check — the failure modes that are silent at runtime.
 *
 *   node scripts/check-contract.mjs
 *
 * Needs neither DSH nor REA: it reads this package's own files.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok === true) {
    process.stdout.write(`PASS  ${label}\n`);
    return;
  }
  failures += 1;
  process.stdout.write(`FAIL  ${label}${detail ? `  — ${detail}` : ''}\n`);
};

const manifest = JSON.parse(read('package.json'));
const patch = read('cordis.patch.yml');
const client = read('lib/client.js');
const host = read('lib/index.js');

// 1. manifest
check('name and version present', typeof manifest.name === 'string' && typeof manifest.version === 'string');
check('bundle patch declared', manifest.dsh?.bundle?.patch === './cordis.patch.yml');
check('browser half declared as web', manifest.dsh?.client?.platform === 'web');
check('exports["./client"] exists', manifest.exports?.['./client'] === './lib/client.js');
check('runtime target declared', typeof manifest.dshTarget === 'string' || typeof manifest.engines?.dsh === 'string');
check(
  'peer dependencies stay minimal',
  Object.keys(manifest.peerDependencies ?? {}).join(',') === '@deepseek-ai/cordis',
  Object.keys(manifest.peerDependencies ?? {}).join(','),
);
check('the client bundle is a committed artifact', client.includes('window.__ModuleLoader__.load'));

// 2. the silent-404 rule: a row must use the bare package name
const rowIds = [...patch.matchAll(/-\s*id:\s*([^\s]+)\s*\n\s*name:\s*'?"?([^'"\n]+)'?"?/g)].map((match) => ({
  id: match[1],
  name: match[2].trim(),
}));
check('patch declares rows', rowIds.length >= 2, JSON.stringify(rowIds));
for (const row of rowIds) {
  const isLocalPackage = !row.name.startsWith('@deepseek-ai/');
  if (isLocalPackage) {
    check(`row "${row.id}" mounts the bare package name`, row.name === manifest.name, `${row.name} vs ${manifest.name}`);
  }
}
check('patch mounts the MCP row with a server name', /serverName:\s*rea/.test(patch));
check('patch points the MCP row at the bundled bridge', patch.includes('bridge\\index.mjs'));
check('MCP row does not break harness startup', /failOnStartupError:\s*false/.test(patch));

// 3. browser half registration shape
check('client bundle id equals the package name', client.includes(`id: '${manifest.name}'`));
check('client injects slots and locale', /inject = \['slots', 'locale'\]/.test(client));
check("client registers the settings.section slot", client.includes("'settings.section'"));
check('client requires react only', (client.match(/require\('([^']+)'\)/g) ?? []).length === 1, (client.match(/require\('([^']+)'\)/g) ?? []).join(','));

// 4. host half gates
check('host half refuses requests without the guard header', host.includes('GUARD_HEADER'));
check('host half checks Sec-Fetch-Site', host.includes('sec-fetch-site'));
check('host half compares Origin with Host', host.includes('origin'));
check('host half bounds the request body', /MAX_BODY_BYTES/.test(host));
check('host half degrades when webServer is missing', host.includes("ctx.get('webServer')"));

process.stdout.write(`\n${failures === 0 ? 'contract OK' : `${failures} contract violation(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);