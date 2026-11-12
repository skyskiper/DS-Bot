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
- 群问题卡·隔离取证结论（2026-11-13 凌晨，最终）：
  1. **`user-questions/request` 确实 emit**：注入一次 ask 时 `internal/dispatch` 观测到
     `{"kind":"dispatch","type":"waterfall","args":2,"thisArg":"object"}`，此前「事件到不了」的结论作废
     （当时并没有真的 ask 发生）。`hasFilter:false` 是探针用了 `Symbol.for('cordis.filter')`、
     而 carrier 用的是 `Context.filter`，该项不作数。
  2. **注入式 ask 会被立刻结束**：`groupQuestionsSync` 的触发点（`channel.js:259`，`case 'state'`）
     已用页面内 `fetch('/api/bot',{endpoint:'state'})` 实测 200 且执行（返回含 `revision`），
     但房间 ledger 的 `group-question` 仍为 0 —— 因为 `waits` 一直是空：注入的 ask 在 waterfall 内
     被拒（`assertLiveRoot`：该成员会话此刻没有在跑的轮次），我们的 `.catch` 吞掉了错误。
  3. **隔离实例跑不了模型**（本条是取证的天花板）：真实 App 进程（端口反查 pid=85545，正是 Web GUI
     65101 的宿主）环境里 `OCTO_API_KEY` 命中 **0**；`~/.ds-bot/bot/secrets.json` 的 `secrets` 是
     list，唯一的键名是 `IM_WEIXIN_9C1EF6_TOKEN`。副本 home 里模型侧因此报
     `MISSING_CREDENTIAL: llm-pi-ai: no credential for provider route "octo"`（ledger notice 原文），
     轮次 1 秒内失败、`inflight turns: []`。
  结论：**除「真实轮次触发」外整条链路要素都在**（emit 有、sync 触发点可用、卡片渲染代码就绪），
  但要拿到「waits 有条目 → 群里落卡 → 作答 → 结算」的端到端证据，必须在有真实模型轮次的环境里做一次。
  下一步（阶段二）：按「只给路径」方案交付，并把「真实触发一次」单列为开放项；若要做隔离端到端，
  需要把 credentials 服务里的 octo 条目只读复制进副本 home（不允许复制明文密钥到日志/仓库）。
- 已知技术债（群问题卡读 pending）：群成员待答的提问从 `ctx.get('userQuestions').waits` 读取——那是
  DSH `UserQuestionService` 的 **TS private** 字段（`packages/interaction/user-questions/src/index.ts`），
  没有公开 API。读取做了结构探测 + try/catch，拿不到就静默不出卡，不影响 state。上游一旦提供公开 API
  立刻替换。另：`user-questions/request` 的事件派发为什么到不了本插件（装配/事件名/global/prepend/
  加载源都已排除，探针从未生成），仍列为待排查，下一步看 `internal/dispatch` 观察者与 `internal/listener`
  的 bail 链、`scopeTarget(agent, agent)` 的 filter 对比。
- 已知取舍（群问题卡）：群里接管的用户提问（cua 的「应用访问」）**不设任何超时**，没人回答那张卡
  会让该成员那一轮一直挂着（用户明确选择：有入口就不用替他判死）。以后若出现僵尸轮次，加事件驱动
  清理（例如用户在该群发新消息时把上一轮未答的卡标失效），**不要加定时器**。
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
