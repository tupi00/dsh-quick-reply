/**
 * 浏览器端插件：选中助手正文后，鼠标旁边冒出一张「引用回复」小卡片。
 *
 * 宿主给了两个位置：
 *   shell.overlay           —— 整个窗口最上层、不随聊天滚动的一块浮层（本插件用它）。
 *   conversation.input.dock —— 输入框卡片上方那一排（本插件只用它来拿 inputActions，不渲染东西）。
 *
 * 为什么浮层要分两处：shell.overlay 是 root 作用域，拿不到输入框的 inputActions；
 * 而 dock 能拿到。所以 dock 里挂一个「只存 props 不渲染」的桥，浮条点按钮时从桥里取。
 *
 * 行为：把选中的文字变成 Markdown 引用块，填进输入框草稿，不自动发送。
 * 发不发、发什么，用户自己按回车。原文会用高亮标出来，方便对照。
 */
window.__ModuleLoader__.load({
  id: '@local/quick-reply',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 本插件自己的文案命名空间。 */
    const NS = 'quick-reply'

    /** 按钮条的 class 前缀，避免和宿主样式撞名。 */
    const CLS = 'dshQR'

    /** 引用高亮的名字：CSS 里的 ::highlight() 和 CSS.highlights 必须用同一个键，改要一起改。 */
    const HL_NAME = 'dshQR-quote'

    /**
     * 本插件要注入的样式表文本。
     *
     * 名字别叫 CSS：那会和浏览器全局的 CSS 对象（CSS.highlights）撞名，
     * 遮蔽之后 CSS.highlights 永远是 undefined，引用高亮会静默失效。
     */
    const STYLE_TEXT = [
      // 选区旁的浮层卡片：位置由组件按鼠标坐标算好，这里只管长相。
      `.${CLS}_float{position:fixed;z-index:40;display:flex;align-items:center;gap:6px;padding:5px 6px 5px 10px;border-radius:10px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));box-shadow:0 6px 24px rgba(0,0,0,.18);white-space:nowrap;pointer-events:auto}`,
      `.${CLS}_hint{font-size:12px;line-height:1;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap;padding-right:2px}`,
      `.${CLS}_btn{height:26px;padding:0 10px;font-size:12px;line-height:1;font-family:inherit;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));background:transparent;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}`,
      `.${CLS}_btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}`,
      `.${CLS}_btn:focus-visible{outline:2px solid var(--dsw-alias-button-info-fill,#4183c4);outline-offset:1px}`,
      `.${CLS}_primary{background:var(--dsw-alias-button-info-fill,#4183c4);border-color:transparent;color:var(--dsw-alias-bg-base,#fff)}`,
      `.${CLS}_primary:hover{background:var(--dsw-alias-button-info-hover,#3b76b0)}`,
      // 侧栏会话行末尾的悬停按钮：和宿主自带的「归档 / 置顶」并排。尺寸、颜色、
      // 悬停行为都照抄宿主（16x16、三级文字色、悬停变主文字色、不铺底色），
      // 否则一眼就能看出是外挂的。宿主那条规则在 ui-workspace 的 .iconButton 里。
      `.${CLS}_rowBtn{border-radius:var(--dsw-radius-xs,4px);cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary,#8a8f98);background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}`,
      `.${CLS}_rowBtn:hover{color:var(--dsw-alias-label-primary,inherit)}`,
      `.${CLS}_rowBtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4183c4));outline-offset:-2px}`,
      // 输入框上方那个「只传数据、不画东西」的桥，渲染出来是个空壳。宿主给 dock 的每项
      // 都套了一层带 data-slot 的容器，而 composerStack 有 6px 的 gap —— 空壳会白白撑出
      // 一条缝，把输入框整体往上推。这里把空的项藏掉，长什么样都不影响布局。
      `[data-slot="conversation.input.dock"]:empty{display:none!important}`,
      // 引用原文高亮：用 CSS Custom Highlight API，不改宿主 DOM，所以不会打乱 React 的渲染。
      `::highlight(${HL_NAME}){background-color:var(--dsw-alias-state-business-primary-a20,rgba(77,107,254,.28));color:inherit}`,
    ].join('\n')


    // 以下纯函数会被 test/helpers.test.mjs 抠出来单测，别在这里用 DOM/React。
    // >>>PURE-HELPERS
    /** 引用默认最多留几行 / 几字，超了就截断。 */
    const QUOTE_MAX_LINES = 2
    const QUOTE_MAX_CHARS = 120

    /** 把选中的多行文字变成 Markdown 引用块。 */
    function quoteText(text) {
      return String(text)
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n')
    }

    /**
     * 截断引用：只引用前几行、前几十字，后面用「…（略）」带过。
     *
     * 为什么默认截断：用户选中一整段回答时，把整段塞进草稿会把输入框撑爆，
     * 也不方便接着写。原文仍然高亮着，想看全文回到消息里看就行。
     * 先按行截，再按字数截 —— 两条限制都过一遍，避免「一行超长」绕过行数限制。
     */
    function quoteExcerpt(text, maxLines = QUOTE_MAX_LINES, maxChars = QUOTE_MAX_CHARS) {
      const normalized = String(text === undefined || text === null ? '' : text).replace(/\r\n/g, '\n').trim()
      if (!normalized) return ''
      const lines = normalized.split('\n')
      let clipped = lines.slice(0, maxLines).join('\n')
      let truncated = lines.length > maxLines
      if (clipped.length > maxChars) {
        clipped = clipped.slice(0, maxChars)
        truncated = true
      }
      // 收尾去掉空白，免得「…（略）」前面空一格
      clipped = clipped.replace(/\s+$/, '')
      return truncated ? clipped + '…（略）' : clipped
    }

    /**
     * 生成「这段话出自第几轮」的标注行。
     *
     * 为什么需要它：引用块本身只是纯文本，模型分不清「同一句话在历史里出现两次」时
     * 用户指的是哪一处。补一行轮次，模型就有了可核对的坐标。
     * 轮次号直接用宿主给的 data-chat-turn，和界面右侧「轮次导航」显示的第 N 轮一致，
     * 用户看到的和模型看到的不会对不上。
     */
    function turnRefLine(turn) {
      const value = Number(turn)
      if (!Number.isSafeInteger(value) || value <= 0) return ''
      return '（引用自第' + value + '轮回答）'
    }

    /**
     * 拼出最终要塞进草稿的整块内容：引用原文，出处标注紧跟在最后一行引用后面。
     *
     * 为什么出处不单独占一行：单独一行会把引用块撑成两段，视觉上像两件事；
     * 跟在引用末尾「> 原文 （引用自第3轮回答）」读起来是一个整体，
     * 模型解析时也会把出处当成这条引用的脚注，不会误以为是新的一段。
     *
     * 末尾补一个换行：用户点「引用回复」是为了接着问问题，
     * 让光标落在引用块下面那行，用户直接打字就是自己的问题，
     * 不会把字接在「）」后面。拿不到轮次号时只给引用，不留半截标注。
     */
    function quoteInsert(text, turn) {
      const quoted = quoteText(quoteExcerpt(text))
      const ref = turnRefLine(turn)
      return (ref ? quoted + ' ' + ref : quoted) + '\n'
    }

    /** 新草稿 = 原草稿（保留用户已经写的内容）+ 空一行 + 本次要插入的文字。 */
    function mergeDraft(draft, insert) {
      const base = typeof draft === 'string' ? draft.replace(/\s+$/, '') : ''
      if (!base) return insert
      return base + '\n\n' + insert
    }

    /** 把一个助手步骤里的文字块拼成纯文本（思考、工具调用、图片都不算正文）。 */
    function assistantText(blocks) {
      if (!Array.isArray(blocks)) return ''
      return blocks
        .filter((block) => block && block.kind === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim()
    }

    /**
     * 从聊天快照里找「最后一条已经说完的助手回答」，连它属于第几轮一起返回。
     *
     * 为什么跳过 status === 'running'：那一步还在往外吐字，引一半会被截断，
     * 用户拿去追问时模型看到的是半句话。宁可等它说完。
     * 为什么要轮次号：侧栏引用的是「整个会话的最后一条回答」，用户没法像选区那样
     * 一眼看到它来自第几轮，补上轮次号模型才有坐标。
     * 返回 {text, turn}，找不到就是 {'', 0}——调用方据此决定要不要填草稿。
     */
    function lastAssistantAnswer(snapshot) {
      const empty = { text: '', turn: 0 }
      if (!snapshot || !Array.isArray(snapshot.order)) return empty
      const nodes = snapshot.nodes
      if (!nodes || typeof nodes.get !== 'function') return empty
      for (let i = snapshot.order.length - 1; i >= 0; i -= 1) {
        const node = nodes.get(snapshot.order[i])
        if (!node || node.kind !== 'assistant-step') continue
        const data = node.data || {}
        if (data.status === 'running') continue
        const text = assistantText(data.blocks)
        if (!text) continue
        const turn = Number(data.turn)
        return { text, turn: Number.isSafeInteger(turn) && turn > 0 ? turn : 0 }
      }
      return empty
    }

    /** 只取文字（给 React selector 用：基本类型才不会因为对象换新引用而反复重渲染）。 */
    function lastAssistantText(snapshot) {
      return lastAssistantAnswer(snapshot).text
    }

    /** 只取轮次号（同上）。 */
    function lastAssistantTurn(snapshot) {
      return lastAssistantAnswer(snapshot).turn
    }
    // <<<PURE-HELPERS<<<

    // ------------------------------------------------------------------
    // 选区状态：document 上监听 selectionchange，缓存「用户选中了哪段助手正文」。
    // 为什么必须缓存：点按钮时 mousedown 会把页面选区清掉，所以要在那之前记住文本。
    // ------------------------------------------------------------------
    const selectionStore = {
      // anchor = 选区末尾在屏幕上的坐标，浮条据此贴着鼠标/文字出现。
      snapshot: { text: '', key: '', turn: 0, anchor: null },
      listeners: new Set(),
      subscribe(fn) {
        selectionStore.listeners.add(fn)
        return () => {
          selectionStore.listeners.delete(fn)
        }
      },
      getSnapshot() {
        return selectionStore.snapshot
      },
      set(next) {
        const prev = selectionStore.snapshot
        const sameAnchor =
          (prev.anchor === null && next.anchor === null) ||
          (prev.anchor !== null &&
            next.anchor !== null &&
            prev.anchor.x === next.anchor.x &&
            prev.anchor.y === next.anchor.y)
        if (prev.text === next.text && prev.key === next.key && prev.turn === next.turn && sameAnchor) return
        selectionStore.snapshot = next
        for (const fn of selectionStore.listeners) fn()
      },
    }

    /** 文本节点取父元素；元素本身原样返回。 */
    function elementOf(node) {
      if (!node) return null
      return node.nodeType === 1 ? node : node.parentElement
    }

    /**
     * 读当前页面选区。只接受「起点和终点在同一个 assistant-step 节点里」的选区：
     * 这样用户自己的提问、工具卡片、思考过程都不会被带进来。
     */
    function readSelection() {
      const empty = { text: '', key: '', turn: 0, range: null, anchor: null }
      const selection = typeof window !== 'undefined' ? window.getSelection() : null
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return empty
      const range = selection.getRangeAt(0)
      const startEl = elementOf(range.startContainer)
      const endEl = elementOf(range.endContainer)
      if (!startEl || !endEl) return empty
      const startNode = startEl.closest('[data-chat-flow-kind]')
      const endNode = endEl.closest('[data-chat-flow-kind]')
      if (!startNode || startNode !== endNode) return empty
      if (startNode.getAttribute('data-chat-flow-kind') !== 'assistant-step') return empty
      const text = String(selection.toString() || '').trim()
      if (!text) return empty
      // 轮次号由宿主写在同一个 div 上（data-chat-turn），用来给模型一个「这段话在哪」的坐标
      const turn = Number(startNode.getAttribute('data-chat-turn'))
      return {
        text,
        key: startNode.getAttribute('data-chat-node-key') || '',
        turn: Number.isSafeInteger(turn) && turn > 0 ? turn : 0,
        range,
        anchor: anchorOf(selection, range),
      }
    }

    /**
     * 取「鼠标松开那一点」的屏幕坐标，用来决定浮条放哪。
     *
     * 为什么看 focus 而不是 range 的最后一截：
     *   选区分方向。从下往上拖选时，range 的终点在文档里是上面那行，
     *   取它就会把卡片放到选区开头，离鼠标很远（用户实测反馈「有点太远」）。
     *   而 selection.focusNode/focusOffset 永远停在鼠标松开的那一端——
     *   不管是正拖还是反拖，往那里收一个零宽 Range 就能拿到精确坐标。
     * 拿不到 focus 坐标时（比如键盘选择、节点已不在渲染树）再退回 range 末尾。
     */
    function anchorOf(selection, range) {
      const focus = focusPointOf(selection)
      if (focus) return focus
      if (!range) return null
      try {
        const rects = range.getClientRects()
        const last = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
        if (!last) return null
        return { x: last.right, y: last.bottom }
      } catch {
        return null
      }
    }

    /** 把选区焦点收成一个零宽 Range，取它在屏幕上的坐标（就是光标/鼠标所在的那点）。 */
    function focusPointOf(selection) {
      if (!selection || !selection.focusNode) return null
      try {
        const caret = document.createRange()
        caret.setStart(selection.focusNode, selection.focusOffset)
        caret.collapse(true)
        const rect = caret.getBoundingClientRect()
        if (!rect) return null
        // 节点不在渲染树里时 rect 全是 0，这种坐标用了反而把卡片扔到左上角
        if (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0) return null
        return { x: rect.right || rect.left, y: rect.bottom || rect.top }
      } catch {
        return null
      }
    }

    /**
     * 给「原文」加高亮（CSS Custom Highlight API）。
     *
     * 为什么用这套 API 而不是包一层 <mark>：宿主是 React 渲染的，我们改它的 DOM
     * 会在下一次重渲染时被抹掉，还可能打乱 diff。Highlight 只登记范围，不碰 DOM。
     * 不支持这套 API 的浏览器上静默跳过——功能不受影响，只是少了视觉提示。
     */
    function applyHighlight(range) {
      const registry = typeof CSS !== 'undefined' && CSS !== null ? CSS.highlights : null
      if (!registry || typeof Highlight !== 'function' || !range) return
      try {
        registry.set(HL_NAME, new Highlight(range))
      } catch {
        /* 范围已经被重渲染换掉时 set 可能抛错，忽略即可 */
      }
    }

    /** 撤掉高亮（选区消失、且不是刚填完草稿留下的钉子时调用）。 */
    function clearHighlight() {
      const registry = typeof CSS !== 'undefined' && CSS !== null ? CSS.highlights : null
      if (!registry || typeof registry.delete !== 'function') return
      try {
        registry.delete(HL_NAME)
      } catch {
        /* 没有就算了 */
      }
    }

    /**
     * 填完草稿后页面选区会被输入框抢走焦点，高亮却应该留着——
     * 让用户还能看见「我刚才引用的是哪一段」。所以这里打个钉子，
     * 等下一次真的选中新文字时再换掉。
     */
    let highlightPinned = false

    /** 选区变化后合并成一帧再更新，避免拖选过程中疯狂重渲染。 */
    let rafId = 0
    function scheduleSync() {
      if (rafId !== 0) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        const next = readSelection()
        if (next.text) {
          highlightPinned = false
          applyHighlight(next.range)
        } else if (!highlightPinned) {
          clearHighlight()
        }
        selectionStore.set({ text: next.text, key: next.key, turn: next.turn, anchor: next.anchor })
      })
    }

    /**
     * 把本插件的样式插进页面。
     *
     * 为什么不用 ctx.styles：那是「动态插件」沙箱里才有的参数，装进 profile 的普通插件
     * 拿不到（宿主客户端上下文里没有 styles 这个服务）。宿主自己的客户端插件也是这么干的：
     * 自己 createElement('style') 塞进 head，并打上 data-plugin 方便排查与卸载。
     */
    function insertStyles() {
      if (typeof document === 'undefined') return () => {}
      const tagId = '@local/quick-reply/client.css'
      const existing = document.querySelector(`style[data-plugin-css="${tagId}"]`)
      if (existing === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = '@local/quick-reply'
        tag.dataset.pluginCss = tagId
        tag.textContent = STYLE_TEXT
        document.head.appendChild(tag)
        return () => tag.remove()
      }
      return () => {}
    }

    /** 焦点送回输入框，用户看一眼就能直接回车。拿不到就静默跳过。 */
    function focusComposer() {
      try {
        const host = document.querySelector('[data-composer-card] [contenteditable="true"]')
        if (host && typeof host.focus === 'function') host.focus()
      } catch {
        /* 宿主结构变了也不该影响填草稿本身 */
      }
    }

    /**
     * 把文字填进草稿区（保留原有内容），不提交。
     *
     * 填完后把光标送到草稿末尾：用户点「引用回复」就是为了在引用后面接着说话，
     * focus() 默认可能把光标放在开头，这里明确移到最后一个字符之后。
     * 用 Selection API 对 contenteditable 做位移，做不到就退回单纯 focus。
     */
    function fillDraft(inputActions, draft, insert) {
      if (!inputActions || typeof inputActions.setDraft !== 'function') return
      try {
        inputActions.setDraft(mergeDraft(draft, insert))
        focusComposer()
        caretToEnd()
      } catch {
        /* 草稿接口异常时保持安静，不打断会话 */
      }
    }

    /** 把当前活动元素（输入框）里的光标移到内容末尾。 */
    function caretToEnd() {
      try {
        const host = typeof document !== 'undefined' ? document.activeElement : null
        if (!host || !host.isContentEditable) return
        const selection = window.getSelection()
        if (!selection) return
        const range = document.createRange()
        range.selectNodeContents(host)
        range.collapse(false) // false = 收拢到末尾
        selection.removeAllRanges()
        selection.addRange(range)
      } catch {
        /* 光标位置拿不到就算了，focus 已经保证输入框是活的 */
      }
    }

    // ------------------------------------------------------------------
    // React 侧
    // ------------------------------------------------------------------
    /** 订阅上面的选区缓存。 */
    function useSelection() {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(selectionStore.subscribe, selectionStore.getSnapshot)
      }
      const [value, setValue] = React.useState(selectionStore.getSnapshot())
      React.useEffect(() => {
        const unsub = selectionStore.subscribe(() => setValue(selectionStore.getSnapshot()))
        setValue(selectionStore.getSnapshot())
        return unsub
      }, [])
      return value
    }

    /**
     * 取文案：正常由宿主注入的 t(key, params)，极端情况下回落到内置字典，
     * 避免正文直接炸出英文 key。params 用来填「第 {turn} 轮」这类占位符。
     *
     * 为什么还要看 document.lang：浮条挂在 shell.overlay（root 作用域），
     * 那里宿主的注册契约里没有 locale 字段，拿不到 t。这时按页面语言挑中/英，
     * 总比英文用户看到中文强。
     */
    function tr(t, key, params) {
      if (typeof t === 'function') {
        try {
          const value = params === undefined ? t(key) : t(key, params)
          if (typeof value === 'string' && value) return value
        } catch {
          /* 落到下面 */
        }
      }
      const lang = typeof document !== 'undefined' ? String(document.documentElement.lang || '') : ''
      const fallback = (lang.toLowerCase().startsWith('en') ? en[key] : zh[key]) || zh[key] || key
      if (params === undefined) return fallback
      return fallback.replace(/\{(\w+)\}/g, (whole, name) =>
        params[name] === undefined ? whole : String(params[name]),
      )
    }

    /**
     * 只存 props、不渲染任何东西的「桥」。
     *
     * 为什么需要它：浮条挂在 shell.overlay（窗口最上层、root 作用域），那里拿不到
     * 输入框的 inputActions 和当前草稿；而 conversation.input.dock 拿得到。
     * 所以在 dock 里挂一个空组件，把这两样东西存到模块变量里，浮条点按钮时来取。
     *
     * 侧栏那个按钮也靠这座桥：它挂在 root 作用域，既没有 inputActions 也读不到
     * 聊天记录。它只负责把「要引用哪个会话」写进 pendingQuoteStore，
     * 真正的取文字 + 填草稿在这里做——因为这里能同时拿到两样东西。
     */
    const composerBridge = { inputActions: null, draft: '' }

    /**
     * 侧栏点了引用、等着填草稿的会话 id；null 表示没有待办。
     *
     * 为什么做成一个小 store 而不是普通变量：侧栏按钮和输入框不在同一棵 React 树里，
     * 按钮把会话 id 写进来时，桥那边必须被通知到才会重新渲染、才会去填草稿。
     * 用普通变量的话，桥的依赖项（sessionId / 最后一条回答）都没变，
     * effect 根本不会重跑，点了就像没反应。
     */
    const pendingQuoteStore = {
      value: null,
      listeners: new Set(),
      subscribe(fn) {
        pendingQuoteStore.listeners.add(fn)
        return () => {
          pendingQuoteStore.listeners.delete(fn)
        }
      },
      getSnapshot() {
        return pendingQuoteStore.value
      },
      set(next) {
        if (pendingQuoteStore.value === next) return
        pendingQuoteStore.value = next
        for (const fn of pendingQuoteStore.listeners) fn()
      },
    }

    /** 订阅「有没有待引用的会话」。 */
    function usePendingQuote() {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(pendingQuoteStore.subscribe, pendingQuoteStore.getSnapshot)
      }
      const [value, setValue] = React.useState(pendingQuoteStore.getSnapshot())
      React.useEffect(() => pendingQuoteStore.subscribe(() => setValue(pendingQuoteStore.getSnapshot())), [])
      return value
    }

    // 给「拿不到 useChat」的情况准备一个空壳 hook。
    // 为什么也要占一个 hook：React 要求每次渲染的 hook 数量和顺序一致，
    // 直接 `props.useChat ? props.useChat(x) : null` 会让两边的 hook 数不同，
    // 一旦宿主某次没传 useChat，组件就整棵炸掉。空壳同样只调一次 useSyncExternalStore。
    const noopSubscribe = () => () => {}
    const noopSnapshot = () => undefined
    function useNoChat() {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(noopSubscribe, noopSnapshot)
      }
      return undefined
    }

    function ComposerBridge(props) {
      const { input, inputActions, sessionId, session } = props
      const useChatHook = typeof props.useChat === 'function' ? props.useChat : useNoChat
      // 取「最后一条说完了的助手回答」：侧栏引用要引的就是它
      const lastText = useChatHook(lastAssistantText) || ''
      const lastTurn = useChatHook(lastAssistantTurn) || 0
      // 侧栏刚点了哪个会话（null = 没待办）。订阅它，按钮一写进来这里就会重渲染。
      const pending = usePendingQuote()

      // 每次渲染都刷新一次，保证点按钮时拿到的是最新草稿
      React.useEffect(() => {
        composerBridge.inputActions = inputActions || null
        composerBridge.draft = input && typeof input.draft === 'string' ? input.draft : ''
      })

      // 侧栏点了引用 → 已经切到那个会话 → 等它最后一条回答出现，填进草稿
      React.useEffect(() => {
        if (pending === null) return
        if (sessionId !== pending) return
        if (!lastText) {
          // 历史还在加载（openState 还不是 open）就先等着；
          // 但如果这个会话已经打开完了却一条回答都没有，就别把待办永远挂着
          if (session && session.openState === 'open') pendingQuoteStore.set(null)
          return
        }
        pendingQuoteStore.set(null)
        fillDraft(inputActions, input && input.draft, quoteInsert(lastText, lastTurn))
      }, [pending, sessionId, session, lastText, lastTurn, inputActions, input])

      // 桥被卸载（切会话、输入框重挂）时清空，避免浮条拿到过期引用
      React.useEffect(
        () => () => {
          composerBridge.inputActions = null
          composerBridge.draft = ''
        },
        [],
      )
      return null
    }

    /**
     * 侧栏会话行末尾的「引用最后一条回答」按钮。
     *
     * 为什么只写一个标记就返回：这个槽位是 root 作用域，拿不到输入框也读不到聊天，
     * 唯一能做的是「切换会话 + 留个待办」。真正的填草稿由 ComposerBridge 完成
     * （它跟着会话一起重挂，正好能等到新会话的历史加载完）。
     */
    function SidebarQuoteButton(props) {
      const { sessionId, displayTitle, quoteLastAnswer, t } = props
      const label = tr(t, 'quoteLast')
      return h(
        'button',
        {
          type: 'button',
          className: `${CLS}_rowBtn`,
          title: label,
          'aria-label': displayTitle ? label + '：' + displayTitle : label,
          onClick: () => {
            if (typeof quoteLastAnswer === 'function') quoteLastAnswer(sessionId)
          },
        },
        // 一个引号图标，跟宿主自带的 16px 图标同一视觉重量
        h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('path', {
            d: 'M3 4.5h6M3 8h6M3 11.5h3.5',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
          }),
          h('path', {
            d: 'M12.2 6.2c.9.5 1.4 1.3 1.4 2.3 0 1.4-1.1 2.5-2.5 2.5',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeDasharray: '0.1 2.2',
          }),
        ),
      )
    }

    /** 鼠标旁边那张小卡片：选中助手正文后出现。 */
    function SelectionFloat(props) {
      const selection = useSelection()
      const hostRef = React.useRef(null)
      const [pos, setPos] = React.useState(null)

      /**
       * 位置在「渲染后」算：卡片宽度要先量出来，才能判断贴到窗口右边时该不该往回缩。
       * 用 layoutEffect 在浏览器绘制前算完，用户看不到跳一下。
       */
      React.useLayoutEffect(() => {
        if (!selection.text) {
          setPos(null)
          return
        }
        const el = hostRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const gap = 8
        const anchor = selection.anchor
        const x = anchor ? anchor.x : 16
        const y = anchor ? anchor.y : 16
        // 卡片「尾」（右缘）对齐字尾：左缘 = 字尾坐标 - 卡片宽。
        // 头对齐会把整张卡片甩到选区右边，离用户正在看的字隔开一段；尾对齐则卡片
        // 缩在文字下方、右缘与字尾齐平，视线不用跳。
        let left = x - rect.width
        let top = y + gap
        // 左边放不下（字尾已经贴着窗口左缘）才翻成头对齐
        if (left < gap) left = x + gap
        // 下边放不下就翻到字的上面
        if (top + rect.height > window.innerHeight - gap) top = y - rect.height - gap
        // 最后再夹进窗口，别因为窗口太窄/太矮溢出
        left = Math.max(gap, Math.min(left, window.innerWidth - rect.width - gap))
        top = Math.max(gap, Math.min(top, window.innerHeight - rect.height - gap))
        setPos({ left, top })
      }, [selection.text, selection.anchor && selection.anchor.x, selection.anchor && selection.anchor.y])

      if (!selection.text) return null

      /** 引用：拼成 Markdown 引用块 + 出处标注，填进草稿，收工。 */
      const apply = () => {
        fillDraft(composerBridge.inputActions, composerBridge.draft, quoteInsert(selection.text, selection.turn))
        // 填完就把缓存清掉，避免卡片继续挂着；高亮留着给用户回看
        highlightPinned = true
        selectionStore.set({ text: '', key: '', turn: 0, anchor: null })
        // 兜底：万一焦点没进输入框，页面选区还在，selectionchange 会把卡片又拉回来。
        // 这时候主动清掉选区；高亮是独立的 Range，不受影响。
        try {
          const active = document.activeElement
          const sel = window.getSelection()
          if (sel && !sel.isCollapsed && !(active && active.isContentEditable)) sel.removeAllRanges()
        } catch {
          /* 清不掉就算了，下次点别处也会消失 */
        }
      }

      return h(
        'div',
        {
          ref: hostRef,
          className: `${CLS}_float`,
          // 位置算好之前先放到屏幕外，避免在左上角闪一下
          style: pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { left: '-9999px', top: '0px' },
          // 保住页面选区：否则按下按钮的瞬间选区被清空，卡片会自己消失
          onMouseDown: (event) => event.preventDefault(),
        },
        h(
          'span',
          { className: `${CLS}_hint` },
          selection.turn > 0 ? tr(props.t, 'selectedTurn', { turn: selection.turn }) : tr(props.t, 'selected'),
        ),
        h(
          'button',
          { type: 'button', className: `${CLS}_btn ${CLS}_primary`, onClick: apply },
          tr(props.t, 'quote'),
        ),
      )
    }

    // ------------------------------------------------------------------
    // 文案
    // ------------------------------------------------------------------
    const zh = {
      selected: '已选中文字',
      selectedTurn: '已选中第 {turn} 轮的文字',
      quote: '引用回复',
      quoteLast: '引用最后一条回答',
    }

    const en = {
      selected: 'Text selected',
      selectedTurn: 'Text selected in turn {turn}',
      quote: 'Quote',
      quoteLast: 'Quote the last answer',
    }

    return {
      // uiWorkspace：侧栏按钮要用它切会话（openSession）。
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quick-reply: dictionaries')
        ctx.effect(() => insertStyles(), 'quick-reply: styles')
        ctx.effect(() => {
          document.addEventListener('selectionchange', scheduleSync)
          // 聊天滚动 / 窗口缩放时选区矩形会变，重算一次位置，让卡片跟着文字走
          window.addEventListener('scroll', scheduleSync, true)
          window.addEventListener('resize', scheduleSync)
          return () => {
            document.removeEventListener('selectionchange', scheduleSync)
            window.removeEventListener('scroll', scheduleSync, true)
            window.removeEventListener('resize', scheduleSync)
          }
        }, 'quick-reply: selection listener')

        // 桥：只取 inputActions / 草稿，不渲染（见 ComposerBridge 注释）
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'quick-reply-bridge',
              order: 60,
            },
            ComposerBridge,
          ),
        )

        // 浮条：挂在窗口最上层，位置由选区坐标决定
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'quick-reply-float',
              order: 0,
            },
            SelectionFloat,
          ),
        )

        // 侧栏会话行末尾的「引用最后一条回答」按钮。
        // 行为：先切到那个会话，再让 ComposerBridge 把它的最后一条回答填进草稿。
        // 为什么不直接在这里读：这个槽位是 root 作用域，没有 inputActions，
        // 也读不到聊天快照；桥跟着会话重挂，天然能等到历史加载完。
        ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.row.action',
              id: 'quick-reply-row-quote',
              order: 150,
              locale: NS,
              inject: () => ({
                quoteLastAnswer: (sessionId) => {
                  if (!sessionId) return
                  // 先记待办再切会话：切换是异步的，桥会在新会话挂载后读到它
                  pendingQuoteStore.set(sessionId)
                  try {
                    ctx.uiWorkspace.openSession(sessionId)
                  } catch {
                    pendingQuoteStore.set(null)
                  }
                },
              }),
            },
            SidebarQuoteButton,
          ),
        )
      },
    }
  },
})
