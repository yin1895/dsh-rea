# dsh-rea

REA（[Reverse Engineer Anything](https://github.com/morluto/rea)）的 **DeepSeek Harness 插件**：
安装一次，就同时得到 REA 的 MCP 服务器、渐进式披露桥接，以及设置面板里的 REA 配置页。
REA 的全部配置集中在**一份**文件里（`<REA home>/config/rea.env.json`），不再散落到各个客户端。

- 目标运行时：DSH `0.2.1-rc.3`（Windows x64）
- 插件挂载的两行：`dsh-rea`（宿主半侧 + 配置页）、`rea-mcp`（REA MCP 服务器 → 包内桥接）
- 已验证：离线核心 29 项、真实 HTTP 19 项、浏览器半侧 17 项、端到端引擎自检 10/10、229 个 REA 工具可达

## 安装

```powershell
# 1) 装进 profile（会自动写入 dependencies 与 dsh.profile.bundles）
dsh plugin --profile desktop add github:<owner>/dsh-rea
#    本地目录安装：dsh plugin --profile desktop add file:D:/REA-tool/plugin/dsh-rea
#    再确认 profiles\<name>\package.json 的 dsh.profile.bundles 里有 "dsh-rea"

# 2) 重启 DSH，打开 设置 → REA
```

从源码改完之后重新投放（**复制**而非 junction，见下方注意事项）：

```powershell
pwsh -File scripts/rea-deploy-plugin.ps1 -Profile @('desktop')
```

## 配置页能做什么

- **总览**：REA 版本、固定 Node、启动器、配置文件路径、工具目录数量、可用 provider
- **引擎表**：`GHIDRA_INSTALL_DIR`、`JAVA_HOME`、`REA_JADX_MCP_JAR`、`REA_APKTOOL_COMMAND`、`REA_ADB_PATH`、`REA_BROWSER_EXECUTABLE`、`REA_ILSPY_CMD_PATH` 逐项就绪状态
- **运行体检**：`rea doctor --format json`，列出未通过项、分类与修复建议
- **快速验证**：Node / REA / Apktool / adb / 托管样本 / Ghidra headless / 原生反编译器 / JDK 共 15 步
- **编辑并保存**：引擎路径与 `REA_LOG_LEVEL`、`REA_ANALYSIS_PROVIDER` 等开关；写前留 `.bak`，写入走临时文件 + 原子替换；每个变量单独校验
- **常驻工具（directTools）**：编辑每次请求都会广告的工具清单（上限 40）
- **同步到系统**：重新生成 `config\rea.env.cmd` 并发布用户级环境变量
- **更新 REA**：对 `<REA home>` 执行 `npm install rea-agents@latest`
- **打开目录**：REA 主目录 / 配置 / 日志 / 样本 / 引擎 / 工具 / 插件

## 传输与安全

浏览器半侧只做同源 `fetch`，宿主半侧在 `webServer` 上注册 `/dsh-rea` 前缀路由。
`webServer.register` 本身没有鉴权，所以每个请求都要过三道闸门：

1. `x-dsh-rea: 1` 头必须存在
2. `Sec-Fetch-Site` 若存在，必须是 `same-origin` 或 `none`
3. `Origin` 若存在，其 host 必须等于 `Host`

POST 必须有 `application/json`，请求体上限 64 KiB。端点：`GET /overview`、`POST /doctor|/verify|/save|/sync|/update|/reveal`。

## 仓库结构

```
lib/index.js                宿主半侧：Cordis 入口、/dsh-rea 路由、三道闸门
lib/core.js                 纯逻辑：配置读写、doctor、引擎探测、更新、同步（零 cordis 依赖）
lib/client.js               浏览器半侧：手写产物（无构建、无 JSX），settings.section 页面
bridge/index.mjs            渐进式披露 MCP 桥接：小 directTools 列表 + rea_catalog + rea_call
cordis.patch.yml            bundle patch：dsh-rea 行 + rea-mcp 行
test/run.mjs                离线核心与路由测试（29 项）
test/http.mjs               真实 HTTP 网关测试（19 项）
test/client.mjs             浏览器半侧测试，--render 会真的渲染一次（17 项）
scripts/                    命令行包装、环境同步/发布、端到端自检、profile 投放脚本
config/rea.env.example.json 唯一配置文件的样例
docs/dsh-plugin-contract.md 本包依赖的 DSH 插件契约（都是踩坑换来的）
```

## 自检

```powershell
npm run check                      # 打包契约 21 项（不需要 DSH / REA）
npm run check:bridge               # 桥接能完成 MCP initialize 握手（不需要 REA）
npm test                           # 核心与路由 29 项（需要本机 REA 配置）
npm run test:http                  # 真实 http 服务器 19 项
npm run test:client                # 浏览器半侧 17 项（--render 真渲染；需 test/vendor 里的 react）
npm run smoke                      # 桥接 + 真实 REA 工具往返
pwsh -File scripts/rea-selftest.ps1  # 引擎端到端：10 步
```

`npm run check` 与 `npm run check:bridge` 在 CI 上跑（`.github/workflows/checks.yml`）：它们专门盯两个
运行时才暴露、失败时又完全无声的接线错误——缺 `exports["./client"]`、以及行没挂裸包名。
行为测试需要本机装有 REA，留在本地跑。

## 设计约束（踩过的坑）

- **裸包名挂载是硬要求**：`dsh-client-modules` 用精确 package specifier 反查包，只挂子路径的包拿不到浏览器半侧，`/plugins/dsh-rea/client.js` 会 404，设置页什么都不显示。
- **客户端产物不会在安装时构建**：`lib/client.js` 必须是提交好的成品；本包手写产物，不需要 esbuild/tsdown。
- **peerDependencies 只留 `@deepseek-ai/cordis`**，其余走 `peerDependenciesMeta.optional`。多声明精确版本会被兼容性预检拦下，DSH 直接拒绝加载。
- **`failOnStartupError: false`**：REA 坏掉时工具缺席、配置页报错，但 Harness 照常启动。
- **宿主层不要重复注册 `rea-mcp`**：`$DSH_HOME/cordis.patch.yml` 最后生效，会静默盖掉插件的行。
- **不要在 profile 的 `node_modules` 里放 junction**：该 profile 之后任何一次 `pnpm install` 都可能顺着链接删掉目标，把插件源码整棵删掉（本项目真发生过一次）。用 `scripts/rea-deploy-plugin.ps1` 复制投放。

## 只有插件管理 REA

非插件侧的 REA 注册已全部清除，包括 16 个客户端（Claude Code、Codex、Cursor、Gemini CLI、
Antigravity、Copilot CLI、Qwen Code、Kimi、VS Code、Windsurf、WorkBuddy、Grok Build、
Hermes、OpenCode、ZCode、Claude Desktop）、6 处 skill 安装、独立的桥接目录，以及 32 个
REA 备份产物——都可从 `logs/rea-removed/` 归档里找回。REA 自己的 `doctor` 现在对每个客户端
报告 `missing`，只有 DSH 侧由本插件承担。

## 相关

- REA 本体：https://github.com/morluto/rea （npm `rea-agents`，MIT）
- DSH 插件契约笔记：[docs/dsh-plugin-contract.md](docs/dsh-plugin-contract.md)

## 许可

MIT，见 [LICENSE](LICENSE)。