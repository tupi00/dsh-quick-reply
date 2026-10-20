# dsh-quick-reply · 引用回复

给 DeepSeek Harness（下称 DSH）Web 界面用的一个小插件：**在助手的回答里选中一段文字，输入框上方会出现一个「引用回复」按钮。点一下，就把这段文字变成 Markdown 引用块填进草稿，不自动发送。**

只做这一件事。没有悬浮球、没有侧栏、没有快捷键冲突。

---

## 它解决什么问题

长对话里想追问某一句时，常见做法是把那句话复制下来、粘进输入框、手动加 `>`、再补出处。四步，还容易粘错。

这个插件把它压成一步：选中 → 点「引用回复」→ 草稿里出现

```markdown
> 你选中的那两行文字…（略）  （引用自第7轮回答）

```

光标已经落在引用块下面那一行，直接写问题就行。

---

## 行为细节

- **选中范围有限制**：只认「起点和终点都在同一条助手消息正文里」的选区。选中你自己的提问、工具调用卡片、思考过程、系统提示，按钮都不会出现——避免引错东西。
- **引用会自动截断**：默认只留前 **2 行 / 最多 120 字**，超出部分用 `…（略）` 标记。原因是一整段回答塞进草稿会把输入框撑爆，也不方便接着写。原文仍然高亮着，想看全文回消息里看。
- **带上出处**：引用块最后跟一行 `（引用自第N轮回答）`。模型看到的只是纯文本、没有消息 ID，同一句话在历史里出现两次时它会分不清——轮次号给它一个可核对的坐标。这个 N 直接读宿主写在消息外层 div 上的 `data-chat-turn`，和界面右侧「轮次导航」显示的第几轮是同一个数字。
- **原文高亮**：用 [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API) 标记选中的原文。不改宿主 DOM，所以不会和 React 的重渲染打架；浏览器不支持时静默跳过，功能不受影响，只是少了视觉提示。
- **只填草稿，绝不发送**：发不发、发什么，由你按回车决定。
- **保留已有草稿**：如果输入框里已经写了东西，引用的内容会接在后面，前面空一行。

---

## 安装

### 前提

- DSH 桌面端（Electron）或 `dsh web`，且 Web 界面能正常打开。
- 插件通过 DSH 的插件管理器以**本地包**方式安装，不需要联网。

### 方式一：插件管理器（推荐）

在 DSH 里让 agent 执行：

```
plugin_manager install_bundle  target = <本仓库的绝对路径>
```

装完后 **重启 DSH 应用**（宿主进程的模块缓存按 URL 记，重载不会重新求值），再刷新网页。

### 方式二：手动挂到 profile

把本目录放到任意位置，然后在 profile 的 `package.json` 里加一条依赖：

```json
{
  "dependencies": {
    "@local/quick-reply": "link:<本仓库的绝对路径>"
  }
}
```

并把 `@local/quick-reply` 追加到 `bundles` 列表末尾，重启 DSH。

### 验证装好了没有

刷新页面后，选中任意一条助手回答里的文字。输入框上方出现「已选中第 N 轮的文字 · 引用回复」＝装好了。

没出现的话按顺序查：

1. 打开控制台，看有没有 `@local/quick-reply` 相关的加载错误；
2. 在 DSH 里查插件列表，确认它是启用状态；
3. 确认选中的**确实是助手消息正文**（不是工具输出、不是思考过程、不是你自己的提问）。

---

## 卸载

插件管理器里禁用/移除，或从 profile 的 `package.json` 里删掉依赖与 `bundles` 条目，然后重启 DSH。

---

## 技术说明

### 挂在哪

挂载点是宿主官方槽位 **`conversation.input.dock`**——输入框卡片上方那一整行。宿主保证这块空间归 dock 条目所有，插件不需要、也不应该去读别人的 DOM 算位置。

### 文件结构

```
QuickReply/
├── package.json        # 包元数据 + dsh.client 声明（平台、注入依赖）
├── cordis.patch.yml    # Cordis 加载补丁：insert 一个 id=quick-reply 的插件
├── index.js            # Host 半边（空实现；本插件纯客户端，留入口给以后扩展）
├── client.js           # 浏览器半边：全部逻辑都在这里
├── locale/zh.json      # 插件列表里的标题与描述
├── locale/en.json
├── icon.svg
└── test/helpers.test.mjs  # 纯函数单测（不启浏览器）
```

### 关键实现点

- **宿主插槽 props**：dock 条目能拿到 `inputActions`（`setDraft` / `submit` 等）与 `useInput`，所以填草稿走的是宿主自己的草稿接口，不是去模拟键盘。
- **为什么要缓存选区**：点击按钮的 `mousedown` 会把页面选区清空，所以插件在 `selectionchange` 里先把「选中了哪段、属于第几轮」记下来（用 `requestAnimationFrame` 合帧，拖选时不会疯狂重渲染），点按钮时用的是缓存。
- **按钮上 `onMouseDown: preventDefault()`**：同样是为了保住选区，避免按钮条在按下的瞬间自己消失。
- **填完把光标送到末尾**：`focus()` 的默认落点不保证在末尾，所以用 Selection API 把 range 收拢到 contenteditable 的末尾。
- **样式自己插 `<style>` 标签**：装进 profile 的普通插件拿不到动态插件沙箱里的 `styles` 服务，宿主自带的客户端插件也是自己插 style 标签的。颜色一律用 `--dsw-alias-*` 设计令牌，跟随主题。
- **不用 `require` 引 DSH 客户端包**：插件只依赖宿主注入的 `ctx`、`React`，符合宿主对插件的要求。

### 开发

```bash
# 纯函数单测（不需要浏览器）
node test/helpers.test.mjs

# 语法检查
node --check client.js
node --check index.js
```

`test/helpers.test.mjs` 会用标记 `// >>>PURE-HELPERS` 从 `client.js` 里把纯函数抠出来跑，所以那几个函数里不能出现 DOM / React 调用。

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 只引用助手正文 | 选中你自己的提问、工具输出、思考过程不会出现按钮。这是有意的。 |
| 引用永远截断 | 目前没有「引用全文」入口。需要整段时手动选中复制。 |
| 依赖宿主 DOM 语义属性 | 选区判定依赖 `[data-chat-flow-kind="assistant-step"]` 和 `[data-chat-turn]`。宿主改版时插件最多失效（按钮不出现），不会弄坏聊天。 |
| 没有配置项 | 截断行数/字数写死在 `client.js` 顶部（`QUOTE_MAX_LINES` / `QUOTE_MAX_CHARS`），改完需重新加载插件。 |
| 仅 Web 界面 | 宿主声明 `platform: "web"`。 |

---

## 许可

MIT
