# 话题条：一次启动窗口要做完的检查清单

前提：测试 App 在虚拟屏上跑，只起一次。每一步「失败」都表示**当场停手**、截图 + 存 DOM 片段，
不改代码、不重试。

## 0. 起之前（30 秒）
1. 快照正式 App 的 bounds（面积最大的窗口）与 pid，写进 evidence；
2. 起测试 App（`git -C DS-Bot-test-wt checkout <commit>` 后由 `bin/launch.sh` 起）；
3. 起完立刻再快照一次：**bounds/pid 必须与第 1 步一致**，不一致就停手并恢复。

## 1. D4 展开/收起（约 2 分钟）
- 进「话题测试」群：状态条应在输入框上方，`getBoundingClientRect().height === 32`；
- 点「Collapse」：高度变 `24`，只剩 `#N` 和一个点，文字数 ≤ 3；
- 点「Expand」：回到 `32`；
- 失败证据：两条 rect（展开/收起）+ 截图。

## 2. D3 入口计数与行序（约 3 分钟）
- 造 2 个活跃话题 + 1 个归档（用 `topic_record` / `topic_state`，走 `DS_BOT_TEST=1` 的 `topic-call`）；
- 入口文案 `textContent` **全等** `Topics · 2 active · 0 archived`（示例，按实际数字）；
- 展开后行序：活跃（新→旧）→ 待排 → 归档（时间倒序）→ `#Other` 置底；
- 失败证据：`textContent` 原文 + 每行的 `data-state`。

## 3. D8/D9 回执与徽标（约 3 分钟）
- 让管家 `topic_record {title, fromSeq}` 指向一条用户消息；
- 该消息下方出现 `→ Recorded as #N`（逐字比对，含箭头与空格）；
- 一条 Bot 回复带 `#N` 徽标；点徽标能取到 `topic-source` 的原文并显示「Source message」+ 发言人 + 时间；
- 失败证据：两条气泡的 `textContent` + 徽标 `data-num`。

## 4. D11 子话题标签（约 2 分钟）
- 给 `#1` 加一个 detail 子话题，标题「回退用例」；
- 子话题消息右侧标签逐字等于 `#1.3 回退用例`，**不得出现 `##`**；
- 失败证据：标签 `textContent` 原文。

## 5. D17 位满重开（约 3 分钟）
- 造 3 个活跃 + 1 个归档，展开列表点归档行的「重开」；
- 行副标题变 `已申请重开 · 待排`、按钮变「取消」、顶部提示条逐字等于「活跃已满 3，重开会进 pending，不会丢」；
- 点「取消」回到原状态；
- 失败证据：三处 `textContent` + 截图。

## 6. D19 不挡输入（约 2 分钟）
- 展开状态条，取三组 rect：`barRect.bottom <= composerRect.top`、末条消息 `rect.bottom <= barRect.top`；
- 点输入框输入一句，确认字符出现在 composer 内（截图）；
- 失败证据：三组 rect 数值 + 截图。

## 7. 收尾（必做）
- 再快照正式 App 的 bounds/pid，与第 0 步比对，**必须完全一致**；
- 停测试 App，`pgrep` 无残留；
- 把 evidence 目录（截图 + rect 文本 + `state.json` 里 `room.topics` 片段）贴进报告。
