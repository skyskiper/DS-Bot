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
  **已验证**：`user-questions/request` 会 emit（dispatch 行）；`groupQuestionsSync` 触发点可用
  （页面内 `state` 200 且执行）；`ctx.get('userQuestions')` 为 object、`waits` 为 Map；卡片渲染代码
  （`cells.js` 的 `group-question` 分支）已就绪；兜底同步逻辑四检通过。
  **待真机验证**：一次真实轮次里的 `waits` 条目、房间 ledger 的 `group-question` 行、群里卡片渲染、
  点「打开会话」作答后切「已回答」。
  **复现配方**：`cp -Rc ~/.ds-bot /tmp/gq-src` → `cp -Rc /tmp/gq-src/profiles/ds-bot
  /tmp/gq-src/profiles/desktop` → `DSH_E2E_SOURCE=/tmp/gq-src node dev/ui-e2e.mjs serve --keep`
  （只重启隔离实例；用完 `pkill -f "ui-e2e.mjs serve"` + `rm -rf /tmp/gq-src`）。
  结论：**除「真实轮次触发」外整条链路要素都在**（emit 有、sync 触发点可用、卡片渲染代码就绪），
  但要拿到「waits 有条目 → 群里落卡 → 作答 → 结算」的端到端证据，必须在有真实模型轮次的环境里做一次。
  下一步（阶段二）：按「只给路径」方案交付，并把「真实触发一次」单列为开放项；若要做隔离端到端，
  需要把 credentials 服务里的 octo 条目只读复制进副本 home（不允许复制明文密钥到日志/仓库）。
## 群问题卡：四条根因（2026-11-13，最后一条是真正的拦路虎）

1. **`waits` 只收定时提问**：`UserQuestionService.waits` 只在 `askTimed` 里写入；
   cua 的「应用访问」走无超时 `ask`，**永远不进 waits**——靠轮询 waits 出卡是死路。
2. **`groupQuestionsSync` 取 callId 取错**：内层 Map 的 **key** 才是 callId，value 是
   `TimedQuestionWait`（没有 id 字段）；要用 `calls.keys()`。
3. **`appNameOf` 的 null key**：`src/host/computer/index.js` 的 `appNameOf(key)` 直接
   `key.startsWith(...)`，历史/副本数据里可能有 null key，state 因此抛
   `Cannot read properties of null (reading 'startsWith')`；已加守卫返回 `'an app'`。
4. **请求到不了群观察者（真正原因）**：`MODULES` 里 `groupQuestions` 在 `computer` 之前 install，
   两者都 `prepend`，而 cordis 的 `prepend` 是 `unshift`（`cordis/src/events.ts:264`）——
   **后注册的排前面**；`computerConsent`（`computer/index.js:674`）命中 cua 的 `cua-app-access`
   后**直接 return 答案、不调 `next()`**，waterfall 到此结束（`events.ts` 注释原话：不调 next 的
   监听器否决后面的链）。所以之前「探针文件从不生成」不是 DSH 没派发，是它被本插件自己吃掉。
   同一个 module 还有第二条路径更彻底：前置 gate（`computer/index.js` 的 `computerGate` →
   `driverConsent`）在应用已认识时**根本不发 DSH 请求**，只画自己的卡。
   → 结论：群卡要从 **DS Bot 自己的 `askAppAccess`** 处 raise，在那张卡被 resolve 处 settle，
   不能只依赖 `user-questions/request`。
   实现：`computer/index.js` 调 `rt.noteAppAccessAsk` / `rt.noteAppAccessDone`，
   `group-questions.js` 提供这两个钩子（提交 `5247a59d`）。

### 同一条链上顺手修掉的三个坑（`5247a59d`）

- **兜底会当场结算卡**：`groupQuestionsSync` 原本把「不在 waits 里」当成「问题没了」，
  而无超时 ask 从来不在 waits 里——第一次 `state` 读（客户端 `pull()` 每 1.5 s 一次，
  `client/index.js:265`）就把刚出的卡结算成「已回答」。现在只结算 `source === 'waits'` 的记录。
- **无超时 ask 的 questionId 是常量**：原用 `questions[0].id`（= `cua-app-access`），
  同一会话第二个问题被 `settled` 挡掉、永不出卡；改为 `cua-app-access-<uuid>`。
- **客户端「已回答」匹配错字段**：`cells.js` 用 `requestId` 比对，但 `groups.js` 的 `rowOf`
  不放 `requestId` 出来 → 两边都是 undefined，任何一条回答行会标记同屏所有卡；改用 `questionId`。

### 群卡按钮必须落在可作答的视图（2026-11-13，真机验出的缺陷）

可作答的 `PendingAppAccess` 只在 **DS Bot 自己的聊天面**渲染（`client/computer.js` 的
`AppAccessDock` 挂在 `conversation.input.dock`，`AppAccessCall` 挂在会话里），shell 的
**raw 视图不画它**。原来群卡唯一按钮走 `openRawSession(sessionId)`，点进去是一张点不动的卡，
用户根本没法作答。现在按钮走 `openSession(botId)`（等同侧栏点这个 Bot），**raw 只做兜底**，
仅当该 Bot 已不在 roster、没有聊天面可开时使用。回归用例：
`test/group-question-client.test.js`「the group card opens the Bot chat that can answer,
not the raw Session」——点群卡按钮后，目标视图里必须真的画出 Deny / This time / Always。

## 真机收口方案（群问题卡，一次打完）

前提：`groupQuestionsSync` 与卡片渲染在 **host + client**，所以「群里出卡」要**装了新包的 App** 才看得见；
仓库 link 只让 DSH 页面拿到新代码，App 里是包内 `client.js`。

1. **打新包**（不需要用户同意；约 1 分钟 Node 22 + 2 分钟 pack）
   - `git worktree add /tmp/dsb-<commit> origin/personal/main`（或交付分支）；
   - `cd app && npm install`（`npm ci` 会因 lock 缺 `ws@8.22.2` 失败）→
     `ELECTRON_BUILDER_CACHE=/tmp/eb-cache DS_BOT_RUNTIME_CACHE=/tmp/dsb-runtime-cache npm run dist`；
   - 判据：`/tmp/dsb-<commit>/DS Bot.app` + zip 生成；包内 `client.js` 的 sha256 与仓库一致；
     `swap-app.sh --stage "/tmp/…/DS Bot.app"` 输出 `nothing was changed`。
2. **安装覆盖 `/Applications/DS Bot.app`** —— **唯一必须用户同意的一步**（会退出当前 App 一次）。
   - 用 `app/scripts/swap-install-job.example` 起的 launchd job（不要手写脚本、不要 `launchctl submit` 裸跑）；
   - 判据：装完 `--tidy` 后 `/Applications` 只有一个 `DS Bot.app`、`codesign --verify --deep --strict` exit 0。
3. **造一次真实 ask**（不需要用户同意；App 重启后由我执行）
   - 选一个**该会话没授权过**的应用：在群里让某成员调 `cua.getApp("<未授权应用>")`；
   - 判据：`~/.ds-bot/bot/question-probe.jsonl` 出现 `kind:"dispatch"`，且 `waits` 从 `Map(0)` 变 `Map(1)`。
4. **群里出卡**（自动；判据看 ledger 不看 UI）
   - 判据：`grep '"kind":"group-question"' ~/.ds-bot/bot/ledger/group-session-*.jsonl` 有行（含 `sessionId`/`botId`），
     随后群里可见「{name} 在自己的会话里等你回答。」+「打开 {name} 的会话」。
5. **点「打开会话」作答**（脚本点，不用用户；不需要额外授权）
   - 这版 App 里 cua 的应用访问**没有 DSH 原生卡**：请求由 DS Bot 接管，画的是 DS Bot 的卡
     （`src/client/computer.js` 的 `PendingAppAccess`），按钮是 **Deny / This time / Always**，
     出现在**那个 Bot 自己的会话**里。
   - 判据：点 **This time** → 只写内存里的会话决策（重建数据就干净）；点 Always 会写
     `bot.computer.apps` 进 state.json，第二次就不出卡了。
   - macOS TCC 是另一回事：测试 App 换了 bundle id，系统视作另一个 App；真去控制应用时可能弹
     辅助功能/屏幕录制授权（只能人点）。验「出卡→作答→切已回答」不需要它。
6. **卡片切「已回答」**
   - 判据：`grep '"kind":"group-question-answer"'` 出现，对应 `questionId`；群里卡片按钮消失、显示「Answered.」。

已知取舍：群卡不设超时（无人回答则那一轮一直挂着）；要清理只做事件驱动（用户在该群发新消息时把上一轮未答的卡标失效），不加定时器。

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
