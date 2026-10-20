/**
 * 浏览器端插件：选中助手正文后，一键「引用回复」。
 *
 * 只有一个功能，挂在宿主已经分配好空间的槽位上：
 *   conversation.input.dock —— 输入框卡片上方的那一排。
 *   选中助手正文后，这里出现一行：一句提示 + 一个「引用回复」按钮。
 *
 * 行为：把选中的文字变成 Markdown 引用块，填进输入框草稿，不自动发送。
 * 发不发、发什么，用户自己按回车。原文会用高亮标出来，方便对照。
 *
 * 为什么不自己往页面中间塞浮条：宿主规范要求插件只用官方槽位，
 * 不要读别人的 DOM 去算位置。输入框上方是官方给的常驻空间，稳。
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
      // 输入框上方：一行提示 + 一个按钮
      `.${CLS}_bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 0}`,
      `.${CLS}_hint{font-size:12px;line-height:1;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap;padding-right:2px}`,
      `.${CLS}_btn{height:26px;padding:0 10px;font-size:12px;line-height:1;font-family:inherit;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));background:transparent;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}`,
      `.${CLS}_btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}`,
      `.${CLS}_btn:focus-visible{outline:2px solid var(--dsw-alias-button-info-fill,#4183c4);outline-offset:1px}`,
      `.${CLS}_primary{background:var(--dsw-alias-button-info-fill,#4183c4);border-color:transparent;color:var(--dsw-alias-bg-base,#fff)}`,
      `.${CLS}_primary:hover{background:var(--dsw-alias-button-info-hover,#3b76b0)}`,
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
    // <<<PURE-HELPERS<<<

    // ------------------------------------------------------------------
    // 选区状态：document 上监听 selectionchange，缓存「用户选中了哪段助手正文」。
    // 为什么必须缓存：点按钮时 mousedown 会把页面选区清掉，所以要在那之前记住文本。
    // ------------------------------------------------------------------
    const selectionStore = {
      snapshot: { text: '', key: '', turn: 0 },
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
        if (prev.text === next.text && prev.key === next.key && prev.turn === next.turn) return
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
      const empty = { text: '', key: '', turn: 0, range: null }
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
        selectionStore.set({ text: next.text, key: next.key, turn: next.turn })
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
     * 取文案：正常由宿主注入的 t(key, params)，极端情况下回落到内置中文，
     * 避免正文直接炸出英文 key。params 用来填「第 {turn} 轮」这类占位符。
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
      const fallback = zh[key] || key
      if (params === undefined) return fallback
      return fallback.replace(/\{(\w+)\}/g, (whole, name) =>
        params[name] === undefined ? whole : String(params[name]),
      )
    }

    /** 输入框上方那条：选中助手正文后出现。 */
    function SelectionBar(props) {
      const { input, inputActions, t } = props
      const selection = useSelection()
      const draft = input && typeof input.draft === 'string' ? input.draft : ''
      if (!selection.text || !inputActions) return null

      /** 引用：拼成 Markdown 引用块 + 出处标注，填进草稿，收工。 */
      const apply = () => {
        fillDraft(inputActions, draft, quoteInsert(selection.text, selection.turn))
        // 填完就把缓存清掉，避免按钮条继续挂着；高亮留着给用户回看
        highlightPinned = true
        selectionStore.set({ text: '', key: '', turn: 0 })
      }

      return h(
        'div',
        {
          className: `${CLS}_bar`,
          // 保住页面选区：否则按下按钮的瞬间选区被清空，这条 bar 会自己消失
          onMouseDown: (event) => event.preventDefault(),
        },
        h(
          'span',
          { className: `${CLS}_hint` },
          selection.turn > 0 ? tr(t, 'selectedTurn', { turn: selection.turn }) : tr(t, 'selected'),
        ),
        h(
          'button',
          { type: 'button', className: `${CLS}_btn ${CLS}_primary`, onClick: apply },
          tr(t, 'quote'),
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
    }

    const en = {
      selected: 'Text selected',
      selectedTurn: 'Text selected in turn {turn}',
      quote: 'Quote',
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quick-reply: dictionaries')
        ctx.effect(() => insertStyles(), 'quick-reply: styles')
        ctx.effect(() => {
          document.addEventListener('selectionchange', scheduleSync)
          return () => document.removeEventListener('selectionchange', scheduleSync)
        }, 'quick-reply: selection listener')

        // 输入框上方那一条（唯一的挂载点）
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'quick-reply-bar',
              order: 60,
              locale: NS,
            },
            SelectionBar,
          ),
        )
      },
    }
  },
})
