# 会话地图（Session map）

- 日期：2026-11-09
- 相关：[2026-10-07-group-chat](2026-10-07-group-chat.md)、[2026-11-04-local-agents](2026-11-04-local-agents.md)

## 为什么

一个 Bot 背后不只有一个会话：私聊是一串段（parts），它在每个群里各有一份成员会话，群自身还有自己的会话，团队还可能有一个 DSH Agent 和它的子会话。用户编排时要能一眼看清「这个角色现在有几条线在跑」，并且能一步点到 DSH 原生会话里看工具调用和轨迹。

## 数据

| 分组 | 来源 | 说明 |
|---|---|---|
| 私聊 | `bot.sessionId`（当前段）+ `bot.parts`（旧段） | 段数 = 首段 id、旧段、当前段去重后的数量 |
| 群里的成员会话 | `room.memberSessions[botId]` | host 的 state 视图新增该字段；成员还没在该群说过话的群不显示 |
| 群自身会话 | `room.sessionId` + `room.ownParts` | 群公告、群记忆、relay 跑的那条 |
| DSH Agent | `state.agents[].sessions` | 团队级，每个 Bot 的地图都列 |

状态：**进行中** = `ctx.sessions.list.byId[id].running` 或 `useSessionStatus` 报 running；**空闲** = 在 Host 会话列表里但没在跑；**已归档** = 不在 Host 列表（旧段换走了，或会话已归档）。时间取 `updatedAt`。

## 界面

- 入口在**详情抽屉顶部那排圆按钮**里（齿轮 / 会话地图 / ⋯ / 分享 / ×），`details-drawer.js` 的 `top` 行，用同样的 `bt-round` 尺寸和 `LayersIcon`；群设置的「Sessions」卡里另有一行。
- 这排按钮是插件和桌面 App 共用的组件（App 的 `app/ui/src/app.js` 直接渲染插件的 `Overlays`/`HeaderPill`），所以改一处两边同时生效。App 的 actions 从 `teamActions()` 拼出，`openMap`/`closeMap` 要在 `app/ui/src/team.js` 里补上，否则按钮按约定不渲染。
- 「在 DSH 中打开」由能力开关 `canOpenInDsh` 控制：DSH 侧为 true，App 侧为 false（App 没有 DSH 原生会话视图），App 里只留「复制 id」。开关由宿主显式传入，不嗅探环境。
- 标题栏那个自绘座位已删除（避免双入口），`utilities` 插槽也不再注册：shadow 条目无法再声明 shell 已经声明的子槽（runtime 会拒绝）。
- 面板按上面的四组分节（群的地图只有「群自身会话」和「本群成员会话」两节）；每行显示名称、来源、短 session id、段数、最近活动时间、状态，以及 `Open in DSH`、`Copy id` 两个操作。
- 不在 roster 里的普通 DSH Agent 会话没有入口，保持现状。

## 打开与返回

`openRawSession(id)` 与 `openAgentSession` 走同一套机制：`setPlain(true)` 后切到该 Session，撤掉 Bot 的对话层，显示 shell 自己的会话视图。Bot 自己的会话 id 不是 Agent 会话，所以 surface 用一个 `rawSession` 标记维持 plain，直到离开该视图；离开后自动恢复 Bot 皮肤。

返回：左栏底部的 `Back to Bot`（`mode === 'bot' && plain` 时显示；Agent 模式仍是原来的「回 DS Bot」按钮），回到打开地图的那个 Bot 或群，目标不在了就回主 Bot。

## 不做（v1）

- 段历史内容的内嵌预览。
- 独立轮询：`sessions.list` 与 `useSessionStatus` 是 DSH 的 live store，状态随宿主推送更新。
