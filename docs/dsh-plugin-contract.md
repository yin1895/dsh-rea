# DSH plugin contract — what this package relies on

Verified against DeepSeek Harness `0.2.1-rc.3` on Windows x64, by reading the shipped
runtime sources and by loading this plugin into four profiles. Every claim below cost a
debugging session; keep it in sync when bumping `dshTarget`.

## Manifest

| Requirement | Why |
| --- | --- |
| `name` + `version` | manifest floor |
| `dsh.bundle.patch` → `./cordis.patch.yml` | the layer that mounts React rows |
| `dsh.client.platform: "web"` | only accepted platform; declares a browser half |
| `exports["./client"]` **must exist** | `dsh-client-modules` throws `declares dsh.client but exports no "./client" bundle` otherwise |
| row mounted under the **bare package name** | `exactPackageSpecifier()` returns `undefined` for subpath/`file:`/scheme specifiers, so a row that is not an exact package name never gets a browser half → `/plugins/<name>/client.js` 404s and the page silently never appears |
| `peerDependencies` only `@deepseek-ai/cordis` | every other service is reached through `ctx.get(...)`; extra peers with exact versions trip the compatibility preflight and DSH denies the plugin |
| `dshTarget` (or `engines.dsh`) | declares the runtime this package was built for |

`dsh.client.inject` exists for module rows your bundle `require()`s that are not baseline
seeds. This bundle requires only `react`, which is a seed, so it declares nothing.

## Host half

- Entry: `export const name` + `export function apply(ctx)` (Cordis namespace plugin).
- The web server is reached defensively: `ctx.get('webServer')`, and a missing service
  degrades instead of failing activation.
- Route: `ctx.effect(function* () { yield webserver.register({ kind: 'prefix', path, handler }) })`.
  `register` returns a disposer, and a duplicate path throws.
- **`webServer.register` has no authentication or origin policy.** Route owners gate their own
  requests; this plugin requires the `x-dsh-rea: 1` header, rejects `Sec-Fetch-Site` other
  than `same-origin`/`none`, and compares `Origin`'s host with `Host`.
- No plugin-visible API starts or stops an individual MCP server, so the REA server is mounted
  through a normal `@deepseek-ai/dsh-mcp-client` row instead of being managed at runtime.

## Browser half

- Classic script, no ESM, no JSX, no bundler:
  `window.__ModuleLoader__.load({ id: <package name>, factory: (require) => module.exports })`.
- `id` must equal the package name.
- React comes from `require('react')`; `React.createElement` only.
- Settings page:
  `ctx.slots.inject('settings.section', function* () { yield ctx.slots.register({ name: 'settings.section', id, order, label: () => t('nav'), inject: () => ({ t }) }, Section) })`
  with `inject = ['slots', 'locale']` and `ctx.locale.register(NS, { zh, en })`.
- There is **no icon option** for a settings section; the shell renders its own default.
- Transport: plain same-origin `fetch` of the plugin's own prefix route. The harness does
  **not** build client bundles on install — `lib/client.js` is a committed artifact.

## Composition

- A profile composes: `dsh.profile.bundles` (in `<profile>/package.json`) → each bundle's
  patch → the profile's own `cordis.patch.yml` → **`$DSH_HOME/cordis.patch.yml` last**.
  The home layer therefore wins over everything, which is why this project keeps no REA row
  there: a duplicate `rea-mcp` row would silently shadow the plugin's.
- Verify offline with `dsh --profile <name> --dump-config`. Electron-managed profiles
  (`desktop`) refuse that command; use a CLI-managed profile to inspect the same composer.
- `failOnStartupError: false` on the MCP row keeps the harness startable when REA or its
  configuration is broken: tools are absent, the settings page reports it.

## Deployment hazard

Never place a junction/symlink at `<profile>/node_modules/dsh-rea`. A later `pnpm install`
inside that profile can follow the link and delete the plugin source tree — this happened
once here and destroyed the working copy. `scripts/rea-deploy-plugin.ps1` copies instead.