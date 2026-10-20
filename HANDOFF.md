# HANDOFF · 交接文档

给「接下这个仓库的人」看。使用者看 [README.md](./README.md)，这里记的是：现在什么状态、为什么这么写、宿主改版时先查哪里、下一步该干什么。

最后更新：2026-10-20 · 版本 **1.2.0** · HEAD `e818c98`

---

## 1. 一句话现状

`@local/quick-reply`：DSH Web 界面的「引用回复」插件，两个入口（选中助手正文 / 侧栏会话行的引号按钮），都只填草稿、不发送。

**能跑，测试全绿**：

| 项 | 命令 | 当前结果 |
|---|---|---|
| 纯函数单测 | `node test/helpers.test.mjs` | `21 passed` |
| 语法检查 | `node --check client.js` | 通过 |
| 语法检查 | `node --check index.js` | 通过 |

视觉行为**只能在浏览器里看**，单测覆盖不到（见第 6 节）。

## 2. 装在哪、怎么生效

本机以 **link 方式**挂进 desktop profile，不是复制：

```
C:\Users\tupi\.dsh\profiles\desktop\package.json
  dependencies:  "@local/quick-reply": "link:F:/DSH产出/QuickReply"
  dsh.profile.bundles: [ … , "@local/quick-reply", … ]
```

- 源码目录 = 生效版本，改完 `client.js` 后**刷新网页**（Ctrl+Shift+R）即可；若刷新后还是旧行为，说明宿主按 URL 缓存了模块，**重启 DSH 应用**。改 `index.js`（宿主半边）或 `cordis.patch.yml` 一定要重启。
- 别人的安装方式见 README「安装」一节（`plugin_manager install_bundle` 或手写 `link:` 依赖）。

## 3. 文件地图

| 文件 | 作用 | 改它的风险 |
|---|---|---|
| `client.js`（763 行） | **全部逻辑**：选区缓存、浮条、桥、侧栏按钮、样式 | 主战场 |
| `index.js` | 宿主半边，空实现（`export function apply(ctx){ void ctx }`） | 低。`exports` 指向它，别删 |
| `cordis.patch.yml` | 向 Cordis 注入 `id: quick-reply` 的插件条目 | 低，改 id 会变成另一个插件 |
| `package.json` | 包元数据 + `dsh.bundle` / `dsh.client` 声明 | 中。`dsh.client.inject` 决定能 require 到哪些宿主包 |
| `locale/*.json` | 插件列表里的标题与描述（**元数据**，不是界面文案） | 低 |
| `test/helpers.test.mjs` | 用 `// >>>PURE-HELPERS` 标记从 `client.js` 抠纯函数跑 | 别让纯函数区碰 DOM/React |
| `icon.svg` | 插件图标 | 低 |

界面文案有两套：`ctx.locale.register` 注册的 `zh`/`en` 字典（在 `client.js` 底部），以及 `tr()` 的兜底字典。改文案两边都要看。

## 4. 架构：为什么是三处插槽

```
shell.overlay                        ← 浮条本体（root 作用域）
    │  点「引用回复」时向桥要 inputActions / 当前草稿
    ▼
conversation.input.dock              ← ComposerBridge（不渲染任何东西）
    │  只有这里能同时拿到 inputActions + 当前草稿 + 当前会话聊天快照
    ▼
sidebar.workspaces.session.row.action ← 侧栏引号按钮（root 作用域）
       只能「记待办 + 切会话」，真正的填草稿仍由桥完成
```

三条关键取舍，改代码前先读：

1. **必须缓存选区**：点按钮的 `mousedown` 会清掉页面选区，所以在 `selectionchange` 里先把「文本 / 轮次 / 屏幕坐标 / Range」记进 `selectionStore`（`requestAnimationFrame` 合帧，拖选不重渲染），点按钮时用缓存。
2. **锚点取 `selection.focusNode` 而不是 `range` 末尾**：选区分方向，从下往上拖时 `range` 终点在文本上面，会把卡片甩到选区开头。`focusPointOf()` 在焦点处收一个零宽 `Range` 取坐标，才是鼠标松开那一点。
3. **侧栏按钮不跨会话读历史**：它只 `pendingQuoteStore.set(sessionId)` + `ctx.uiWorkspace.openSession()`，桥跟着会话重挂，等新会话历史加载完再填。代价是用户会看到一次会话切换——这是刻意的，换掉它等于让插件去 retain 别人的会话历史（出错面大得多）。

## 5. 宿主契约清单（升级 DSH 后先查这几处）

改宿主版本后如果插件「按钮不出现」，按这张表逐个核对：

| 依赖 | 用途 | 代码位置 |
|---|---|---|
| 插槽 `shell.overlay` | 浮条挂载 | `apply()` 里 `ctx.slots.inject('shell.overlay', …)` |
| 插槽 `conversation.input.dock` | 桥挂载 | 同上 |
| 插槽 `sidebar.workspaces.session.row.action` | 侧栏按钮 | 同上 |
| 注入服务 `slots` / `locale` / `uiWorkspace` | `inject: [...]` 声明 | `return { inject: [...] }` |
| `[data-chat-flow-kind="assistant-step"]` | 判定选区是不是助手正文 | `readSelection()` |
| `[data-chat-turn]` | 取轮次号（出处标注） | `readSelection()` |
| `[data-chat-node-key]` | 缓存的选区键 | `readSelection()` |
| `[data-composer-card] [contenteditable="true"]` | 填完草稿后把焦点送回去 | `focusComposer()` |
| dock props：`input` / `inputActions` / `sessionId` / `session` / `useChat` | 桥的全部输入 | `ComposerBridge(props)` |
| 侧栏行 props：`sessionId` / `displayTitle` / `t` | 侧栏按钮 | `SidebarQuoteButton(props)` |

宿主改版最坏的结果是**按钮不出现**，不会弄坏聊天——这是设计约束，请保持。

## 6. 已知坑（踩过的，别再踩）

- **`useChat` 缺失时必须调空壳 hook**：`props.useChat ? props.useChat(x) : null` 会让两次渲染的 hook 数量不同，整棵组件直接炸。现在用 `useNoChat()` 占位，别改回去。
- **样式表常量不能叫 `CSS`**：会遮蔽浏览器全局 `CSS`，`CSS.highlights` 变 `undefined`，高亮静默失效。现在叫 `STYLE_TEXT`。
- **浮层拿不到 `t`**：`shell.overlay` 的注册契约没有 `locale` 字段，所以浮条文案靠 `document.documentElement.lang` 猜中/英；侧栏按钮能拿到宿主 `t`。这是取舍，不是遗漏。
- **卡片位置必须在 `useLayoutEffect` 里算**：要先量出卡片宽度才能决定右缘对齐、是否翻到上方。位置没好之前放 `left:-9999px`，避免在左上角闪一下。
- **点按钮的 `mousedown` 必须 `preventDefault()`**，否则选区在按下瞬间消失、卡片自己关掉。
- **`highlightPinned`**：填完草稿后选区被输入框抢走，但高亮要留着给用户回看；下一次真的选中新文字才换掉。
- **纯函数区**（`// >>>PURE-HELPERS` 到 `// <<<PURE-HELPERS<<<`）里不许出现 DOM / React，否则 `test/helpers.test.mjs` 抠出来会跑不起来。

## 7. 在浏览器里调它

1. 打开 DSH Web（`http://127.0.0.1:4632`），F12。
2. 确认插件已加载：控制台搜 `@local/quick-reply` 相关报错；`document.querySelector('style[data-plugin-css="@local/quick-reply/client.css"]')` 应存在。
3. 复现选区：选中一段助手正文 → 控制台执行 `CSS.highlights.get('dshQR-quote')` 应有值。
4. 侧栏按钮不出现：先确认那个会话行是不是归档/空白会话（宿主对这类行不渲染动作按钮）。
5. 卸载验证：插件管理器禁用后，`style` 标签、`dshQR*` 节点都应消失。

## 8. 下一步待办（按优先级）

**P0 · 对外发布前要有**
- [ ] README 和本文件补「**适配的 DSH 版本**」。现在只写了「平台 web」，装到老版本上失效没有任何提示，公开项目这是第一个 issue。建议在 `package.json` 加一个 `dsh.client.minHostVersion`（若宿主支持）或在 README 顶部写死实测版本号。
- [ ] 补 `CHANGELOG.md`（历史已在 git log：v1.1.0 `a6e2a77`、v1.2.0 `e818c98`，倒着补三条即可）。
- [ ] 加一条 GitHub Actions：`node test/helpers.test.mjs` + `node --check`。零依赖、不联网，30 秒跑完。

**P1 · 真实存在的小问题**
- [ ] `quoteExcerpt()` 用 `slice(0, maxChars)` 截断，可能切断代理对（emoji / 生僻字）变乱码字符。改成按码点截。
- [ ] 卸载时没有清 `CSS.highlights` 里的 `dshQR-quote` 条目（`apply()` 里缺一个 cleanup effect）。无害，但卸载后 registry 里留个悬空条目。
- [ ] `package.json` 缺 `scripts.test`（StepFold 有），开发者得记命令。

**P2 · 功能候选（先问需求再动）**
- [ ] `QUOTE_MAX_LINES` / `QUOTE_MAX_CHARS` 写死（2 行 / 120 字），没有设置项。
- [ ] 没有「引用全文」入口（README 已列为已知限制）。
- [ ] 侧栏只引「最后一条已结束的回答」，不支持选第几条。

## 9. 发布流程

1. 改 `package.json` 的 `version`（当前 1.2.0）。
2. README 里对应描述同步（行为细节、已知限制两节最常改）。
3. 跑第 1 节那三条命令，全绿。
4. `git commit` → `git tag vX.Y.Z` → 推到 `origin`（`git@github.com:tupi00/dsh-quick-reply.git`），GitHub 上发 Release。
5. 通知使用者重启/刷新。

> 本机提醒：受限沙箱下 `ssh` 会报 `fatal error - couldn't create signal pipe, Win32 error 5`，`git push` 需要 `danger-full-access` 权限，或改用 HTTPS + token。

## 10. 许可

MIT（见 `LICENSE`）。
