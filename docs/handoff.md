# 接手说明（跨机器 / 多 agent）

给另一个 agent 或另一台机器用：读完这一页再动手。

## 仓库与分支

- fork：`https://github.com/skyskiper/DS-Bot.git`；上游：`https://github.com/Fei2411/DS-Bot.git`
- `personal/main` = 我们的主干（当前 `826ed493`，已推 fork）。所有任务从它切分支、再合回它。
- `main` 只镜像上游，不掺自己的改动。
- 需求分支（`feat/*`、`fix/*`、`chore/*`）**不推 fork**，合入主干后即可删。

## 项目结构

- `ds-bot/`：DSH 插件本体（`src/client` 界面、`src/host` 宿主逻辑、`test/`）。
- `app/`：桌面 App（Electron 外壳，`app/ui` 是 App 自己的界面，与插件共用部分组件）。
- `ds-bot/dev/`：开发脚本（`self-host.sh`、`ui-e2e.mjs`、`bench.sh`、`check-secrets.sh`）。
- 本机私有脚本一律 `*.local.sh`（模板 `*.example`，已被 `.gitignore` 忽略）。

## 当前状态（2026-11-12）

- 上游 `v0.3.5`（`405ee8bb`）已全量合并：`62909d67` → `personal/main` = `826ed493`。
- 版本号 `0.4.0-202611121135`（`app/package.json`、`ds-bot/package.json`；`electron-builder.yml` 的 `bundleShortVersion=0.4.0`、`bundleVersion=<时间戳>`）。
- 桌面 App 已装 0.4.0（`/Applications/DS Bot.app`，Apple Development 签名）。
- 我们的定制功能（合并后全部保留）：群自定义头像、部门树（`state.departments`）+ 主 Bot 磁贴、会话地图、图片翻页（含 Markdown 正文图）、群卡片五态（ledger 行渲染）、卡片答案持久化、UI E2E 通道。
- 已知有意分歧：上游 `sections` UI 不接（只留 `state.sections` 字段），见 `/Users/xialingpeng/DS Bot/STATUS.md`。
- 已知技术债（错误渲染）：工具失败在 DSH 自己的行里显示成 `Error: [object Object]`（宿主侧用
  `String(error)` 拼的），我们的 `ToolCell` 只画动作动词、不画错误正文，所以还没法用我们自己的文案替代。
  现在只在群 ledger/群消息里补了可读摘要（`kind:'stalled'` 带工具名与等待时长）；宿主侧未修。
- 已知技术债：`app/ui/src/chat.js` 只用 `cells.js` 的 `ChatRows`，没有 `GroupReplies`/`RelayEvent`，
  所以桌面 App 自己那套 UI（启动/团队页那套界面代码）里没有群审批行。群聊目前走 DSH web
  （`app.asar/node_modules/ds-bot/client.js`），不受影响；一旦群聊改由 `app/ui` 渲染，群审批按钮会消失，
  需要先把群行渲染搬过去或复用 `RelayEvent`。

## 硬规则（违反会被打回）

1. 一个任务一个分支，一个 owner；不与他人共用工作树。
2. 完成标准：`npm run build`、`node scripts/build-client.mjs --check`、`npm run lint` 0 errors、`npm test` 失败集合与基线一致。
   - 测基线：先清所有 `DS_BOT_*`，并 `env -u DS_BOT_APP`；当前基线 2240 条 / 2237 pass / 0 fail / 3 skipped。
3. **不改 DSH 本体**，不把功能做进 DSH 的包里。
4. **不自行重启 DSH**（用户自己决定时机）；纯 UI 改动 build 后刷新即可，host 改动需一次重启。
5. 替换/安装 App：包、校验、命令全部就绪 → **停下等用户同意** → 用 `app/scripts/swap-install-job.example` 起的 launchd job 安装 → 装完立即删旧副本（`swap-app.sh --tidy`）。**不要手写安装脚本**（漏 `launchctl remove` 会被 launchd 每 10 秒重跑）。
6. 打包：Node 22；`before-pack` 的 sha256 校验必须过；`sign-app.sh` 自动从钥匙串取 `Apple Development`。
7. 敏感数据：证书/私钥/账号不入仓；日志里的带 token URL、`/Users/<name>` 绝对路径不进提交。

## 验收工具

- UI E2E：`node dev/ui-e2e.mjs serve` 打印带 token 的 URL；另开 `node dev/ui-e2e.mjs image-paging --attach <url>`（12 条）或 `markdown-paging`（16 条）。
- 群卡片/卡片答案：`ds-bot/test/group-card.test.js`、`card-answers.test.js`。
- 宿主行为：`ds-bot/test/groups.test.js`、`rounds.test.js`。

## 接手后先做的事

1. `git log --oneline -5` 确认在 `826ed493`；`git status` 干净。
2. 跑一次基线：`env -u DS_BOT_APP npm test`（先清 `DS_BOT_*`）。
3. 读 `/Users/xialingpeng/DS Bot/STATUS.md`（本机文件，不在仓库里）。
4. 再按用户的下一步指令开工；不要主动重启 DSH、不要主动替换 App。
