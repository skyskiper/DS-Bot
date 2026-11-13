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

### 「需我处理」里的待处理项从哪来（2026-11-13，查过，不是缺陷）

真机上出现过一次误判：群卡已经「已回答。」，侧栏「需我处理」还挂着「测试丙 等你回答」。
查清了：那一项**不是 cua 的提问**，是 测试丙 **自己聊天**里一张没回答的 `ask_user` 卡
（侧栏那行下面的预览文字是它的问题「我接下来重点做什么？」）。

- `state.questions` 只有 `ask_user` 工具写（`src/host/tools.js:733`），会话被换掉时由
  `parts.js` 迁走；cua 的应用访问（`askAppAccess`）和群问题卡都**不写** `state.questions`
  （`grep state.questions src/host/computer/index.js src/host/group-questions.js` = 0 行），
  它的卡在 `pendingAsks`，侧栏那一栏根本不显示它。
- 那张 ask_user 卡按设计等用户回答：`ask_user` 会 `concludeTurn()` 结束当轮，之后**用户
  往那个会话发下一条消息**时才清（`src/host/turns.js:931`）。测试脚本一直在群里发消息，
  没再进 测试丙 自己的聊天，所以它一直挂着——这是对的，不是漏清。
- 验证配方（不用起 App）：`python3 -c` 读 `<home>/bot/state.json` 的 `questions` 键，
  再对一下 bot/room 的 session id；cua 的提问不会出现在这里。

### 怎么用测试通道跑一遍验证

```sh
cd "/Users/xialingpeng/DS Bot/test-channel"
bin/run.sh          # 备环境 → 造数据 → 五步 → 判据 → 证据 → 清场
```
证据落 `~/.ds-bot-test/bot/test-runs/<时间戳>/`（同时在 `test-channel/evidence/` 留副本），
判据是 `report.md` 里的 PASS/FAIL。窗口一律隐藏 + 挪到屏外；要新帧截图时借左虚拟屏
`(-1920,-51)`，截完立刻收回（`bin/guard-window.sh`）。

### 进主干之后：哪些改动热更就能用，哪些要重启 App（2026-11-13）

这两类在真机上生效方式不同，别再混着说：

- **client 部分（`ds-bot/src/client/*` → 生成的 `client.js`）**：热更即可。改完
  `node scripts/build-client.mjs` 生成新的 `client.js`，已打开的页面由 `dsh-client-hmr`
  换掉（或刷新一次）。这次进主干的部分是：群卡按钮走 `openSession(botId)`（`cells.js`）、
  已回答状态的匹配字段。**不需要重启进程。**
- **host 部分（`ds-bot/index.js`、`src/host/*`）**：必须**重启 App**（或 DSH）才会加载，
  因为 host 代码在进程启动时装进去，热更换不到。这次进主干的部分是：
  `user-questions/request` 的事件监听与结算（`group-questions.js`）、`appAccessAsk/Done`
  钩子（`computer/index.js`）、`appNameOf` 的 null key 守卫、群行文案（`groups.js`）。
- 只 build 不重启 = 界面变了、行为没变；只重启不 build = 行为变了、界面还是旧的。
  判断现场跑的是哪一版，用 `report.md` 里那种 `<host 提交> / <client 提交>` 两段式写法。

### 顶部 goal 横幅压住消息区（2026-11-13，纯 client）

**现象**：群里设了 goal 之后，顶部那颗悬浮 pod（pill 40px + goal 条 30px，实测整块 72px）
压在转录上，首条消息被盖住；用户原话「半透明压在消息上、下面文字透出来」。

**根因（不是留白不够）**：真正的滚动容器不是我们以为的那层。
```
EvIC1a_scroll   transform 内容层：clientHeight == scrollHeight（2791/2791、4537/4537）
                overflow: visible  → 它自己从不裁剪内容
EvIC1a_root     overflow: clip    → 真正裁剪的是这层
```
所以在 `EvIC1a_scroll` 上加 `margin-top` 只移动布局盒、绘制起点不动：改后首条仍从
视口 ~120 处开始画，残留约 13px 重叠（第二版被测试通道判「部分通过」就是这个原因）。
原规则 `body[data-bt-goal] … _scroll{padding-top:90px}` 只把「滚到顶部时的第一条」挪开，
往下滚内容照样穿。

**改法（`ds-bot/src/client/styles.js`，只一条规则）**
```css
body[data-bt-goal] [class*="_scroll"] > [class*="_column"]{padding-top:calc(84px + env(safe-area-inset-top,0px))!important}
```
- 84px = 实测 pod 72px + pod 自身间隙；
- 加在**内容列**上而不是容器上：`_column` 随内容走，任何滚动位置内容都从 pod 下面开始；
- `_scroll` 上那条 `margin-top` / `padding-top` 已删，**不要再加回来**（两处叠加会把首条推太低）。

**判据**（测试通道的口径，别用 `scrollHeight > clientHeight` 判可滚，那层恒等）
1. 裁剪容器用 `EvIC1a_root` / `wSkVaW_viewArea`；
2. 在「滚到顶部」和「滚到中间」各取一组数：`气泡顶 y − pod 底 y ≥ 0`（pod 底 ≈ 窗口 y 122）；
3. 用例必须包含**左对齐的 Bot 消息**从 pod 下穿过（右对齐的填充消息本来就不压 pod，验不出来）；
4. 反向断言：加 padding 后 `_column` 的 `scrollHeight` 不被压小、最后一条不被裁。

**第二道兜底（2026-11-13，同一个提交）**：pod 换成不透明底 —— 转录上的玻璃底在这套合成下
没有模糊可依，字会透出来；`body[data-bt-goal] .bt-island{background:var(--bt-main);backdrop-filter:none}`
只换底色，圆角/边框/阴影/尺寸/位置都不动。

**验证状态（2026-11-13 10:30 收口）**
- **顶部已验**（测试通道，`f12d0e39`）：`scrollerTop=40 podBottom=123 首条气泡 top=213` → **gap = 90px**；
  `_column padding-top=84px`、`_scroll margin-top=0`（只有一处生效）；`bubbleCount=25`、
  `_column scrollHeight=1241` 没被压小。
- **「滚到中间」未验成（环境限制，不是代码问题）**：这个 transcript 是 transform 滚动，
  脚本设 `scrollTop` 内容不动；CDP 真实 `mouseWheel` 在隐藏/虚拟屏窗口下无回执、调用挂住（已 kill）。
  所以「滚到中间时左对齐 Bot 消息不从 pod 下穿过」**没有证据**，按未验处理。
- 因为滚动中途的穿透无法用留白根治，最终以**不透明底**兜底：它不依赖滚动位置。

**不要再做的事**：不要试图用 `margin`/`padding` 解决这个 transform 滚动层的穿透——
`_scroll` 不裁剪（`overflow:visible`，`clientHeight==scrollHeight`），改它只挪布局盒。
留白只解决「滚到顶部时的第一条」，别的交给不透明底。

**FF 之后的生效方式（兜底话术）**：这次只改 client，`git -C "DS Bot/DS-Bot-stable" merge --ff-only`
会替换工作树里的 `client.js`，已打开的页面由 `dsh-client-hmr` 自动换入；若没自动刷新，
让用户按一次 **Cmd+R** 即可——**不需要重启 App，也不需要重装**。

### 窗口位置：现算、显示器感知、没有持久化（2026-11-13）

出现「窗口跑到另一块屏」时，先怀疑**外部操作**（AX / 脚本 / 别的实例），不要怀疑我们的恢复逻辑。

- DS Bot 的 userData（`~/Library/Application Support/DS Bot/`）里只有 `start-frame.json`
  （`themeSource` / `motion`），**没有任何坐标文件**；`main-window-state.json` 是
  `~/Library/Application Support/dsh-desktop/` 下的，那是 CuoCuo（Electron app name `dsh-desktop`），
  不是 DS Bot。判断归属别猜：`lsof -n | grep main-window-state.json` 看是哪个进程。
- 主窗矩形是现算的（`app/src/start-window.mjs`）：
  ```js
  mainBounds() {
    if (!this.#open()) return centred(clampInto({ x: 0, y: 0, ...MAIN_SIZE }, screen.getPrimaryDisplay().workArea), …)
    const start = this.#window.getNormalBounds()
    return mainRect(start, screen.getDisplayMatching(start).workArea)   // 跟着窗口所在那块屏
  }
  mainRect(start, area) { … return clampInto({ … }, area) }             // 夹进那块屏的 workArea
  ```
  单测见 `app/test/start-window.test.mjs`（含负坐标工作区的用例）。
- **不要给窗口加坐标持久化。** 那会引入「存屏内局部坐标 + 换屏后按另一块屏重放」的 bug：
  `(-1920,-51) + (0,30) = (-1920,-21)` 就是这么算出来的（CuoCuo / DSH Desktop 踩过）。
- 要坐实「谁在什么时候搬了窗口」，只能靠巡检日志
  （`test-channel/bin/dgqa-window-watch.sh` → `~/.ds-bot-test/bot/test-runs/window-watch.log`，
  每 30 秒记一次，只记录不处置；取的必须是**面积最大的那个窗口**，别取到小弹层）。

### 全量测试在这台机器上会随负载抖动（2026-11-13）

`npm test` 偶尔会多红 3 条：`a Bot Session gets the team tools in its own scope`、
`browser-frame refuses when browsers are off`、`the newest released bot declares the verified DSH`。
**单独跑都绿**，成对跑也绿；机器空闲时整套跑两次都是 `1 fail`（只有基线那条
`the provider mounts…`）。23:07 时这台机 load 15–20，另一个 node 测试 worker 占 130%。

- 判据：**失败集合以「空闲时整套跑」为准**；负载高时多出来的红不算回归。
- 不要在干净 checkout 里直接跑基线做对照：fresh worktree 会稳定红 4 条（`client.js is the build…`、
  `link.js is the build…`、`phone.test.js`），那是产物缺失，不是行为差异。
- **build-link 的坑**：干净 checkout 上 `npm run build` 会在 `link/src/keys.ts` 解析
  `@noble/curves/ed25519` 失败，需要在 `../link` 里链上 `node_modules`；client 那半没问题。

### 话题消息取不到文本时（2026-11-13 已知取舍）

`ledger` 与 `room.log` 都取不到该 seq 时，`topic-thread` 仍返回这一行，`text: null`。
客户端渲染成 `—`（`aria-label="text unavailable"`），**不丢行、不画空气泡**。ledger 是 append-only，
现实中很难撞到；这是取舍，不是缺陷。

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
