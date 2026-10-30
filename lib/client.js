/*!
 * dsh-rea — browser half (settings.section: REA)
 *
 * One page in Settings that owns the whole REA configuration: engine presence,
 * doctor results, the editable engine/env paths, the MCP advertisement policy,
 * REA updates, and "open this folder" shortcuts. Every host interaction goes
 * through the plugin's own `/dsh-rea` prefix route (same-origin fetch with the
 * `x-dsh-rea` guard header), so this bundle needs no cordis service beyond
 * `slots` and `locale`.
 *
 * Hand-written artifact: no build tool, no JSX, only React.createElement. The
 * module id must equal package.json's name, and the factory is the browser
 * module loader's contract.
 */
(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: 'dsh-rea',
    factory: function (require) {
      var module = { exports: {} };
      var exports = module.exports;

      var React = require('react');

      var NS = 'dsh-rea';
      var ROUTE = '/dsh-rea';
      var GUARD = 'x-dsh-rea';
      var h = React.createElement;

      // ─── 1. 文案 ─────────────────────────────────────────────────────────────
      var zh = {
        nav: 'REA 逆向',
        title: 'REA（Reverse Engineer Anything）',
        intro: '此页是 REA 的唯一配置入口：引擎路径、MCP 工具披露策略、体检与更新都写回 D:\\REA-tool\\config\\rea.env.json，命令行与 MCP 桥接读同一份文件。',
        loading: '正在读取 REA 配置…',
        actions: '操作',
        refresh: '重新读取',
        doctor: '运行体检',
        verify: '快速验证',
        save: '保存设置',
        sync: '同步到系统',
        update: '更新 REA',
        reveal: '打开目录',
        home: 'REA 主目录',
        config: '配置文件',
        version: 'REA 版本',
        node: '固定 Node',
        launcher: '启动器',
        engines: '引擎与工具',
        present: '就绪',
        missing: '缺失',
        settings: '引擎路径与开关',
        directTools: '常驻工具（directTools，逗号或换行分隔）',
        directToolsHint: '只有这些 REA 工具会出现在每次请求的工具清单里；其余 200+ 工具仍可通过 rea_catalog / rea_call 调用。',
        folders: '目录',
        open: '打开',
        failures: '体检未通过项',
        none: '无',
        counts: '工具目录',
        providers: '可用 provider',
        healthy: '环境健康',
        unhealthy: '环境有问题',
        running: '执行中…',
        done: '完成',
        failed: '失败',
        saved: '已保存',
        emptyVar: '（留空即删除该变量）',
        reloadHint: '改动启动器或 Node 后，下次启动 DSH 生效。',
      };

      var en = {
        nav: 'REA',
        title: 'REA (Reverse Engineer Anything)',
        intro: 'The single configuration surface for REA. Engine paths, MCP advertisement policy, health checks and updates all write back to D:\\REA-tool\\config\\rea.env.json, which the CLI and the MCP bridge read too.',
        loading: 'Reading REA configuration…',
        actions: 'Actions',
        refresh: 'Reload',
        doctor: 'Run doctor',
        verify: 'Quick verify',
        save: 'Save settings',
        sync: 'Sync to system',
        update: 'Update REA',
        reveal: 'Open folder',
        home: 'REA home',
        config: 'Config file',
        version: 'REA version',
        node: 'Pinned Node',
        launcher: 'Launcher',
        engines: 'Engines and tools',
        present: 'ready',
        missing: 'missing',
        settings: 'Engine paths and switches',
        directTools: 'Always-advertised tools (directTools, comma or newline separated)',
        directToolsHint: 'Only these REA tools appear in the per-request tool list; the remaining 200+ stay callable through rea_catalog / rea_call.',
        folders: 'Folders',
        open: 'Open',
        failures: 'Failing doctor checks',
        none: 'none',
        counts: 'Tool catalog',
        providers: 'Available providers',
        healthy: 'environment healthy',
        unhealthy: 'environment has problems',
        running: 'working…',
        done: 'done',
        failed: 'failed',
        saved: 'saved',
        emptyVar: '(empty clears the variable)',
        reloadHint: 'Launcher and Node changes apply on the next DSH start.',
      };

      // ─── 2. 样式 ─────────────────────────────────────────────────────────────
      var CSS_ID = 'dsh-rea-styles';
      var CSS = [
        '.dsh-rea-root{display:flex;flex-direction:column;gap:14px;padding:4px 2px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}',
        '.dsh-rea-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
        '.dsh-rea-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px}',
        '.dsh-rea-meta{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0;font-size:12px;line-height:18px}',
        '.dsh-rea-meta dt{color:var(--dsw-alias-label-tertiary)}',
        '.dsh-rea-meta dd{margin:0;font-family:ui-monospace,monospace;word-break:break-all}',
        '.dsh-rea-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
        '.dsh-rea-btn{box-sizing:border-box;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
        '.dsh-rea-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsh-rea-btn:disabled{opacity:.4;cursor:default}',
        '.dsh-rea-btn--primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
        '.dsh-rea-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}',
        '.dsh-rea-card>h4{margin:0;font-size:13px;font-weight:500}',
        '.dsh-rea-table{width:100%;border-collapse:collapse;font-size:12px;line-height:18px}',
        '.dsh-rea-table th{text-align:left;color:var(--dsw-alias-label-tertiary);font-weight:500;padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
        '.dsh-rea-table td{padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}',
        '.dsh-rea-mono{font-family:ui-monospace,monospace;word-break:break-all}',
        '.dsh-rea-badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;line-height:16px}',
        '.dsh-rea-ok{background:var(--dsw-alias-state-success-bg);color:var(--dsw-alias-label-primary)}',
        '.dsh-rea-bad{background:var(--dsw-alias-state-error-bg);color:var(--dsw-alias-state-error-primary)}',
        '.dsh-rea-form{display:grid;grid-template-columns:minmax(200px,auto) minmax(0,1fr);gap:6px 10px;align-items:center}',
        '.dsh-rea-form label{color:var(--dsw-alias-label-secondary);font-size:12px;font-family:ui-monospace,monospace}',
        '.dsh-rea-input,.dsh-rea-area{box-sizing:border-box;width:100%;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
        '.dsh-rea-input:focus,.dsh-rea-area:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
        '.dsh-rea-area{min-height:96px;font-family:ui-monospace,monospace;resize:vertical}',
        '.dsh-rea-status{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
        '.dsh-rea-pre{margin:0;max-height:220px;overflow:auto;padding:8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all}',
      ].join('\n');

      function ensureCss() {
        if (typeof document === 'undefined') return;
        if (document.getElementById(CSS_ID) !== null) return;
        var element = document.createElement('style');
        element.id = CSS_ID;
        element.textContent = CSS;
        document.head.append(element);
      }

      // ─── 3. 宿主通道 ─────────────────────────────────────────────────────────
      function makeApi() {
        function call(path, options) {
          var opts = options || {};
          var headers = { accept: 'application/json' };
          headers[GUARD] = '1';
          var init = { method: opts.method || 'GET', headers: headers, credentials: 'same-origin' };
          if (opts.json !== undefined) {
            headers['content-type'] = 'application/json';
            init.body = JSON.stringify(opts.json);
          }
          var controller = typeof AbortController === 'function' ? new AbortController() : null;
          var timeout = opts.timeoutMs || 60000;
          var timer = null;
          if (controller !== null) {
            init.signal = controller.signal;
            timer = setTimeout(function () { controller.abort(); }, timeout);
          }
          return fetch(ROUTE + path, init)
            .then(function (res) {
              return res.json().catch(function () { return null; }).then(function (body) {
                var ok = res.ok === true && body !== null && typeof body === 'object' && body.ok === true;
                return { ok: ok, status: res.status, body: body };
              });
            })
            .catch(function (error) {
              var message = String((error && error.message) || error);
              if (controller !== null && controller.signal.aborted) message = 'request timed out';
              return { ok: false, status: 0, body: { ok: false, error: message } };
            })
            .then(function (result) {
              if (timer !== null) clearTimeout(timer);
              return result;
            });
        }
        return { call: call };
      }

      // ─── 4. 小组件 ───────────────────────────────────────────────────────────
      function Badge(props) {
        return h('span', { className: 'dsh-rea-badge ' + (props.ok ? 'dsh-rea-ok' : 'dsh-rea-bad') }, props.text);
      }

      function Meta(props) {
        var rows = props.rows.filter(function (row) { return row.value !== null && row.value !== undefined && row.value !== ''; });
        if (rows.length === 0) return null;
        return h('dl', { className: 'dsh-rea-meta' }, rows.flatMap(function (row, index) {
          return [
            h('dt', { key: 'k' + index }, row.label),
            h('dd', { key: 'v' + index }, String(row.value)),
          ];
        }));
      }

      function EngineTable(props) {
        var t = props.t;
        return h('table', { className: 'dsh-rea-table' }, [
          h('thead', { key: 'head' }, h('tr', null, [
            h('th', { key: 'n' }, 'id'),
            h('th', { key: 'p' }, ''),
            h('th', { key: 'v' }, 'path / detail'),
          ])),
          h('tbody', { key: 'body' }, props.engines.map(function (engine, index) {
            return h('tr', { key: index }, [
              h('td', { key: 'n', className: 'dsh-rea-mono' }, engine.label || engine.id),
              h('td', { key: 's' }, h(Badge, { ok: engine.present, text: engine.present ? t('present') : t('missing') })),
              h('td', { key: 'v', className: 'dsh-rea-mono' }, engine.value || t('none')),
            ]);
          })),
        ]);
      }

      // ─── 5. 页面 ─────────────────────────────────────────────────────────────
      function Section(props) {
        var t = typeof props.t === 'function' ? props.t : function (key) { return key; };
        var useState = React.useState;
        var useEffect = React.useEffect;
        var useRef = React.useRef;

        ensureCss();

        var apiRef = useRef(null);
        if (apiRef.current === null) apiRef.current = makeApi();

        var dataHook = useState(null);
        var data = dataHook[0];
        var setData = dataHook[1];
        var busyHook = useState('');
        var busy = busyHook[0];
        var setBusy = busyHook[1];
        var statusHook = useState(null);
        var status = statusHook[0];
        var setStatus = statusHook[1];
        var doctorHook = useState(null);
        var doctorInfo = doctorHook[0];
        var setDoctorInfo = doctorHook[1];
        var verifyHook = useState(null);
        var verifyInfo = verifyHook[0];
        var setVerifyInfo = verifyHook[1];
        var formHook = useState({ vars: {}, directTools: '' });
        var form = formHook[0];
        var setForm = formHook[1];
        var aliveRef = useRef(true);

        useEffect(function () {
          aliveRef.current = true;
          return function () { aliveRef.current = false; };
        }, []);

        function load() {
          setBusy('load');
          return apiRef.current.call('/overview').then(function (result) {
            if (!aliveRef.current) return;
            setBusy('');
            if (result.ok !== true) {
              setStatus({ kind: 'error', text: result.body && result.body.error ? result.body.error : 'unavailable' });
              return;
            }
            var body = result.body;
            setData(body);
            setStatus(null);
            var variables = body.variables || {};
            setForm({
              vars: {
                GHIDRA_INSTALL_DIR: variables.GHIDRA_INSTALL_DIR || '',
                JAVA_HOME: variables.JAVA_HOME || '',
                REA_JADX_MCP_JAR: variables.REA_JADX_MCP_JAR || '',
                REA_APKTOOL_COMMAND: variables.REA_APKTOOL_COMMAND || '',
                REA_ADB_PATH: variables.REA_ADB_PATH || '',
                REA_BROWSER_EXECUTABLE: variables.REA_BROWSER_EXECUTABLE || '',
                REA_ILSPY_CMD_PATH: variables.REA_ILSPY_CMD_PATH || '',
                REA_LOG_LEVEL: variables.REA_LOG_LEVEL || '',
              },
              directTools: ((body.mcp && body.mcp.directTools) || []).join(', '),
            });
          });
        }

        useEffect(function () { void load(); }, []);

        function action(name, path, payload, timeoutMs, apply) {
          setBusy(name);
          setStatus({ kind: 'info', text: t('running') });
          return apiRef.current.call(path, { method: 'POST', json: payload || {}, timeoutMs: timeoutMs }).then(function (result) {
            if (!aliveRef.current) return;
            setBusy('');
            if (result.ok !== true) {
              setStatus({ kind: 'error', text: (result.body && result.body.error) || t('failed') });
              return;
            }
            if (typeof apply === 'function') apply(result.body);
            setStatus({ kind: 'info', text: t('done') });
          });
        }

        function runDoctor() {
          return action('doctor', '/doctor', {}, 300000, function (body) { setDoctorInfo(body); });
        }

        function runVerify() {
          return action('verify', '/verify', {}, 300000, function (body) { setVerifyInfo(body); });
        }

        function save() {
          var variables = {};
          Object.keys(form.vars).forEach(function (key) { variables[key] = form.vars[key]; });
          var tools = form.directTools
            .split(/[\n,]/)
            .map(function (entry) { return entry.trim(); })
            .filter(Boolean);
          return apiRef.current
            .call('/save', { method: 'POST', json: { patch: { variables: variables, mcp: { directTools: tools } } }, timeoutMs: 60000 })
            .then(function (result) {
              if (!aliveRef.current) return;
              if (result.ok !== true) {
                var body = result.body || {};
                var detail = body.rejected ? ' ' + body.rejected.map(function (item) { return item.setting + ': ' + item.reason; }).join('; ') : '';
                setStatus({ kind: 'error', text: (body.error || t('failed')) + detail });
                return;
              }
              setStatus({ kind: 'info', text: t('saved') + ': ' + ((result.body.changed || []).join(', ') || t('none')) });
              void load();
            });
        }

        function setVar(name, value) {
          setForm(function (previous) {
            var next = { vars: {}, directTools: previous.directTools };
            Object.keys(previous.vars).forEach(function (key) { next.vars[key] = previous.vars[key]; });
            next.vars[name] = value;
            return next;
          });
        }

        if (data === null) {
          return h('div', { className: 'dsh-rea-root' }, h('p', { className: 'dsh-rea-hint' }, t('loading')));
        }

        var mcpTools = (data.mcp && data.mcp.directTools) || [];
        var counts = doctorInfo && doctorInfo.counts ? doctorInfo.counts : null;
        var failures = doctorInfo && Array.isArray(doctorInfo.failures) ? doctorInfo.failures : [];

        return h('div', { className: 'dsh-rea-root' }, [
          h('p', { className: 'dsh-rea-hint', key: 'intro' }, t('intro')),

          h('div', { className: 'dsh-rea-bar', key: 'actions' }, [
            h('button', { key: 'refresh', type: 'button', className: 'dsh-rea-btn', disabled: busy !== '', onClick: function () { void load(); } }, t('refresh')),
            h('button', { key: 'doctor', type: 'button', className: 'dsh-rea-btn dsh-rea-btn--primary', disabled: busy !== '', onClick: function () { void runDoctor(); } }, t('doctor')),
            h('button', { key: 'verify', type: 'button', className: 'dsh-rea-btn', disabled: busy !== '', onClick: function () { void runVerify(); } }, t('verify')),
            h('button', { key: 'save', type: 'button', className: 'dsh-rea-btn', disabled: busy !== '', onClick: function () { void save(); } }, t('save')),
            h('button', { key: 'sync', type: 'button', className: 'dsh-rea-btn', disabled: busy !== '', onClick: function () { void action('sync', '/sync', {}, 180000); } }, t('sync')),
            h('button', { key: 'update', type: 'button', className: 'dsh-rea-btn', disabled: busy !== '', onClick: function () { void action('update', '/update', {}, 900000, function (body) { setStatus({ kind: 'info', text: 'rea-agents ' + (body.version || '?') }); }); } }, t('update')),
          ]),

          status !== null ? h('p', { className: status.kind === 'error' ? 'dsh-rea-error' : 'dsh-rea-status', key: 'status' }, busy !== '' ? t('running') + ' ' + busy : status.text) : null,

          h('div', { className: 'dsh-rea-card', key: 'facts' }, [
            h('h4', { key: 'h' }, t('title')),
            h(Meta, {
              key: 'meta',
              rows: [
                { label: t('version'), value: data.reaVersion || '(unknown)' },
                { label: t('home'), value: data.home },
                { label: t('config'), value: data.configFile + (data.configReadable ? '' : '  ⚠ ' + (data.configError || '')) },
                { label: t('node'), value: data.node },
                { label: t('launcher'), value: (data.launcherExists ? '' : '⚠ ') + data.launcher },
                { label: t('counts'), value: counts ? counts.mcp_tools + ' tools / ' + counts.cli_commands + ' commands / ' + counts.mcp_prompts + ' prompts' : null },
                { label: t('providers'), value: doctorInfo && doctorInfo.availableProviders && doctorInfo.availableProviders.length ? doctorInfo.availableProviders.join(', ') : null },
              ],
            }),
          ]),

          h('div', { className: 'dsh-rea-card', key: 'engines' }, [
            h('h4', { key: 'h' }, t('engines')),
            h(EngineTable, { key: 'table', t: t, engines: data.engines }),
          ]),

          verifyInfo !== null
            ? h('div', { className: 'dsh-rea-card', key: 'verify' }, [
                h('h4', { key: 'h' }, t('verify')),
                h('table', { className: 'dsh-rea-table', key: 't' }, [
                  h('thead', { key: 'head' }, h('tr', null, [h('th', { key: 'a' }, 'id'), h('th', { key: 'b' }, ''), h('th', { key: 'c' }, 'detail')])),
                  h('tbody', { key: 'body' }, verifyInfo.steps.map(function (step, index) {
                    return h('tr', { key: index }, [
                      h('td', { key: 'a', className: 'dsh-rea-mono' }, step.id),
                      h('td', { key: 'b' }, h(Badge, { ok: step.ok, text: step.ok ? t('present') : t('missing') })),
                      h('td', { key: 'c', className: 'dsh-rea-mono' }, step.detail || ''),
                    ]);
                  })),
                ]),
              ])
            : null,

          doctorInfo !== null
            ? h('div', { className: 'dsh-rea-card', key: 'doctor' }, [
                h('h4', { key: 'h' }, t('doctor') + ' — ' + (doctorInfo.healthy === true ? t('healthy') : t('unhealthy'))),
                failures.length === 0
                  ? h('p', { className: 'dsh-rea-hint', key: 'ok' }, t('none'))
                  : h('table', { className: 'dsh-rea-table', key: 't' }, [
                      h('thead', { key: 'head' }, h('tr', null, [h('th', { key: 'a' }, 'check'), h('th', { key: 'b' }, 'class'), h('th', { key: 'c' }, 'detail')])),
                      h('tbody', { key: 'body' }, failures.map(function (failure, index) {
                        return h('tr', { key: index }, [
                          h('td', { key: 'a', className: 'dsh-rea-mono' }, failure.name),
                          h('td', { key: 'b' }, failure.classification || ''),
                          h('td', { key: 'c', className: 'dsh-rea-mono' }, failure.detail || failure.remediation || ''),
                        ]);
                      })),
                    ]),
              ])
            : null,

          h('div', { className: 'dsh-rea-card', key: 'settings' }, [
            h('h4', { key: 'h' }, t('settings')),
            h('div', { className: 'dsh-rea-form', key: 'form' }, Object.keys(form.vars).flatMap(function (key) {
              return [
                h('label', { key: 'l' + key, htmlFor: 'dsh-rea-' + key }, key),
                h('input', {
                  key: 'i' + key,
                  id: 'dsh-rea-' + key,
                  className: 'dsh-rea-input',
                  type: 'text',
                  spellCheck: false,
                  value: form.vars[key],
                  placeholder: t('emptyVar'),
                  onChange: function (event) { setVar(key, event.target.value); },
                }),
              ];
            })),
            h('p', { className: 'dsh-rea-hint', key: 'hint' }, t('emptyVar')),
            h('label', { key: 'dl', htmlFor: 'dsh-rea-direct-tools' }, t('directTools')),
            h('textarea', {
              key: 'dt',
              id: 'dsh-rea-direct-tools',
              className: 'dsh-rea-area',
              spellCheck: false,
              value: form.directTools,
              onChange: function (event) {
                var value = event.target.value;
                setForm(function (previous) { return { vars: previous.vars, directTools: value }; });
              },
            }),
            h('p', { className: 'dsh-rea-hint', key: 'dthint' }, t('directToolsHint') + ' (' + mcpTools.length + ')'),
            h('p', { className: 'dsh-rea-hint', key: 'reload' }, t('reloadHint')),
          ]),

          h('div', { className: 'dsh-rea-card', key: 'folders' }, [
            h('h4', { key: 'h' }, t('folders')),
            h('div', { className: 'dsh-rea-bar', key: 'bar' }, data.folders
              .filter(function (folder) { return folder.exists; })
              .map(function (folder) {
                return h('button', {
                  key: folder.id,
                  type: 'button',
                  className: 'dsh-rea-btn',
                  disabled: busy !== '',
                  title: folder.path,
                  onClick: function () { void action('reveal-' + folder.id, '/reveal', { folder: folder.id }, 30000); },
                }, (folder.label || folder.id) + ' · ' + t('open'));
              })),
          ]),
        ]);
      }

      // ─── 6. cordis 装配 ──────────────────────────────────────────────────────
      var inject = ['slots', 'locale'];

      function apply(ctx) {
        ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, 'dsh-rea: dictionaries');
        var t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.section', function* register() {
          yield ctx.slots.register(
            {
              name: 'settings.section',
              id: 'rea',
              order: 45,
              label: function () { return t('nav'); },
              inject: function () { return { t: t }; },
            },
            Section,
          );
        });
      }

      module.exports = { name: 'dsh-rea', inject: inject, apply: apply };
      return module.exports;
    },
  });
})();