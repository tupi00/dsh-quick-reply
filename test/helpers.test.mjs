/**
 * 纯逻辑小测：把 client.js 里两个标记之间的 helper 抠出来跑，
 * 不启动浏览器、不碰 React。npm test 就是 node test/helpers.test.mjs。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')
const start = source.indexOf('// >>>PURE-HELPERS')
const end = source.indexOf('// <<<PURE-HELPERS<<<')
assert.ok(start !== -1 && end !== -1, 'client.js 里找不到 PURE-HELPERS 标记')

const body = source.slice(source.indexOf('\n', start) + 1, source.lastIndexOf('\n', end))
const helpers = new Function(
  `${body}\nreturn { quoteText, quoteExcerpt, mergeDraft, turnRefLine, lineRefLine, quoteInsert, quoteBody, matchKey, quoteStillInDraft, prunePinned, assistantText, lastAssistantAnswer, lastAssistantText, lastAssistantTurn }`,
)()
const {
  quoteText,
  quoteExcerpt,
  mergeDraft,
  turnRefLine,
  lineRefLine,
  quoteInsert,
  quoteBody,
  matchKey,
  quoteStillInDraft,
  prunePinned,
  assistantText,
  lastAssistantAnswer,
  lastAssistantText,
  lastAssistantTurn,
} = helpers

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`ok  ${name}`)
}

test('quoteText 每行加 > ', () => {
  assert.equal(quoteText('第一行\n第二行'), '> 第一行\n> 第二行')
})

test('quoteText 处理 CRLF', () => {
  assert.equal(quoteText('a\r\nb'), '> a\n> b')
})

test('quoteExcerpt 短文本原样返回', () => {
  assert.equal(quoteExcerpt('一句话'), '一句话')
  assert.equal(quoteExcerpt('两行\n也够短'), '两行\n也够短')
})

test('quoteExcerpt 超过两行就截断并加省略标记', () => {
  assert.equal(quoteExcerpt('第一行\n第二行\n第三行'), '第一行\n第二行…（略）')
})

test('quoteExcerpt 单行超长按字数截断', () => {
  const long = '字'.repeat(500)
  const out = quoteExcerpt(long)
  assert.ok(out.length < 140, `截断后应当明显变短，实际 ${out.length}`)
  assert.ok(out.endsWith('…（略）'))
})

test('quoteExcerpt 空输入返回空串', () => {
  assert.equal(quoteExcerpt(''), '')
  assert.equal(quoteExcerpt('   \n  '), '')
  assert.equal(quoteExcerpt(undefined), '')
})

test('mergeDraft 空草稿直接用插入内容', () => {
  assert.equal(mergeDraft('', '你好'), '你好')
  assert.equal(mergeDraft('   \n', '你好'), '你好')
  assert.equal(mergeDraft(undefined, '你好'), '你好')
})

test('mergeDraft 保留已有草稿并空一行', () => {
  assert.equal(mergeDraft('我正在写', '> 引用'), '我正在写\n\n> 引用')
  assert.equal(mergeDraft('我正在写  \n\n', '> 引用'), '我正在写\n\n> 引用')
})

test('turnRefLine 只在拿到合法轮次号时给标注', () => {
  assert.equal(turnRefLine(3), '（引用自第3轮回答）')
  assert.equal(turnRefLine('12'), '（引用自第12轮回答）')
  // 拿不到 / 不合理就返回空串，不拼出「第0轮」「第undefined轮」这种半截话
  assert.equal(turnRefLine(0), '')
  assert.equal(turnRefLine(undefined), '')
  assert.equal(turnRefLine(null), '')
  assert.equal(turnRefLine('abc'), '')
  assert.equal(turnRefLine(-2), '')
})

test('quoteInsert 出处标注紧跟在引用最后一行后面，不再单独占一行', () => {
  assert.equal(
    quoteInsert('第一行\n第二行', 7),
    '> 第一行\n> 第二行 （引用自第7轮回答）\n',
  )
})

test('quoteInsert 末尾留一个换行，光标落在引用块下面一行', () => {
  const out = quoteInsert('一段话', 3)
  assert.ok(out.endsWith('）\n'), JSON.stringify(out))
  assert.equal(out.split('\n').length, 2, '引用一行 + 末尾换行 = 两段')
})

test('quoteInsert 截断后仍然带出处标注', () => {
  const out = quoteInsert('a\nb\nc', 2)
  assert.ok(out.startsWith('> a\n> b…（略）'), out)
  assert.ok(out.endsWith('（引用自第2轮回答）\n'), out)
})

test('quoteInsert 没有轮次号时只给引用（也要留末尾换行）', () => {
  assert.equal(quoteInsert('只有一段', 0), '> 只有一段\n')
  assert.equal(quoteInsert('只有一段', undefined), '> 只有一段\n')
})

test('quoteInsert 的空内容仍保留出处标注（不该整块消失）', () => {
  assert.equal(quoteInsert('', 5), '>  （引用自第5轮回答）\n')
})

test('lineRefLine 只在拿到合法行号时给标注', () => {
  assert.equal(lineRefLine(79), '（引用自第79行）')
  assert.equal(lineRefLine('79'), '（引用自第79行）')
  assert.equal(lineRefLine(0), '')
  assert.equal(lineRefLine(undefined), '')
  assert.equal(lineRefLine(-3), '')
  assert.equal(lineRefLine(1.5), '')
})

test('quoteInsert 走行号出处（聊天区外选中的文字）', () => {
  assert.equal(quoteInsert('data-chat-turn', 0, 79), '> data-chat-turn （引用自第79行）\n')
  // 两者都给时轮次优先：轮次是更强的坐标
  assert.equal(quoteInsert('某段话', 3, 79), '> 某段话 （引用自第3轮回答）\n')
  // 都没有就不写半截标注
  assert.equal(quoteInsert('某段话', 0, 0), '> 某段话\n')
})

// ---- 高亮跟着草稿走：引用被删掉，原文就不该继续亮 ----

test('quoteBody 就是 quoteInsert 里那段原文（两边必须是同一个文本）', () => {
  assert.equal(quoteBody('一段话'), '> 一段话')
  const insert = quoteInsert('一段话', 5)
  assert.ok(insert.startsWith(quoteBody('一段话')), 'quoteInsert 开头应该正好是 quoteBody')
})

test('quoteBody 跟着截断走，长文本不会被误判成「草稿里没有」', () => {
  const long = '第一行\n第二行\n第三行很长很长很长'
  assert.ok(quoteBody(long).includes('…（略）'), '超过 2 行要截断')
  assert.ok(quoteInsert(long, 2).includes(quoteBody(long)))
})

test('matchKey 只留字，标点空白都不算', () => {
  assert.equal(matchKey('比原版多了第 2、3 条和'), '比原版多了第23条和')
  assert.equal(matchKey('> a-b_c!'), 'abc')
  assert.equal(matchKey(undefined), '')
})

test('quoteStillInDraft：草稿里还有这段字就算在', () => {
  const text = '比原版多了第 2、3 条和'
  assert.equal(quoteStillInDraft(text, '> 比原版多了第 2、3 条和 （引用自第25轮回答）\n'), true)
  // 用户改了标点、加了空格，仍然算在（只比字）
  assert.equal(quoteStillInDraft(text, '> 比原版多了第2.3条和，然后呢'), true)
  // 删掉引用就没了
  assert.equal(quoteStillInDraft(text, ''), false)
  assert.equal(quoteStillInDraft(text, '别的问题'), false)
  // 空引用永远不算在（否则空文本会匹配一切）
  assert.equal(quoteStillInDraft('', '任意草稿'), false)
})

test('prunePinned 只留下草稿里还在的引用', () => {
  const kept = { text: '还在的引用', range: {} }
  const gone = { text: '删掉的引用', range: {} }
  const out = prunePinned([kept, gone], '> 还在的引用 （引用自第3轮回答）')
  assert.equal(out.length, 1)
  assert.equal(out[0], kept)
  // 草稿被清空（发送后）→ 一条都不留
  assert.equal(prunePinned([kept, gone], '').length, 0)
  // 脏输入不该炸
  assert.deepEqual(prunePinned(null, 'x'), [])
  assert.deepEqual(prunePinned([null, undefined], 'x'), [])
})

// ---- 侧栏引用：从聊天快照里挑「最后一条说完了的助手回答」 ----

/** 造一个助手步骤节点，blocks 里塞几个块。 */
function step(turn, status, blocks) {
  return { kind: 'assistant-step', data: { turn, status, blocks } }
}

/** 造一个最小的聊天快照：order 是 key 顺序，nodes.get(key) 取节点。 */
function snapshotOf(entries) {
  const map = new Map(entries)
  return { order: entries.map(([key]) => key), nodes: { get: (key) => map.get(key) } }
}

test('assistantText 只拼正文文字块', () => {
  assert.equal(
    assistantText([
      { kind: 'text', text: '第一段' },
      { kind: 'reasoning', text: '想一想' },
      { kind: 'tool-call', text: '跑个命令' },
      { kind: 'text', text: '第二段' },
    ]),
    '第一段\n第二段',
  )
  // 空块 / 不是数组都该安静返回空串，不能抛
  assert.equal(assistantText([]), '')
  assert.equal(assistantText(undefined), '')
  assert.equal(assistantText([{ kind: 'text', text: 42 }]), '')
})

test('lastAssistantAnswer 取最后一条已结束的助手回答', () => {
  const snapshot = snapshotOf([
    ['a', step(1, 'settled', [{ kind: 'text', text: '第一轮回答' }])],
    ['u', { kind: 'user', data: {} }],
    ['b', step(2, 'settled', [{ kind: 'text', text: '第二轮回答' }])],
  ])
  assert.deepEqual(lastAssistantAnswer(snapshot), { text: '第二轮回答', turn: 2 })
})

test('lastAssistantAnswer 跳过还在跑的那一步', () => {
  const snapshot = snapshotOf([
    ['a', step(1, 'settled', [{ kind: 'text', text: '已经说完的' }])],
    ['b', step(2, 'running', [{ kind: 'text', text: '才说到一半' }])],
  ])
  // 引一半会被截断，宁可用上一条完整的
  assert.deepEqual(lastAssistantAnswer(snapshot), { text: '已经说完的', turn: 1 })
})

test('lastAssistantAnswer 跳过只有工具调用的步骤', () => {
  const snapshot = snapshotOf([
    ['a', step(1, 'settled', [{ kind: 'text', text: '真正的回答' }])],
    ['b', step(1, 'settled', [{ kind: 'tool-call', text: 'read' }])],
  ])
  assert.deepEqual(lastAssistantAnswer(snapshot), { text: '真正的回答', turn: 1 })
})

test('lastAssistantAnswer 找不到时返回空（会话还没回答过）', () => {
  assert.deepEqual(lastAssistantAnswer(snapshotOf([])), { text: '', turn: 0 })
  assert.deepEqual(lastAssistantAnswer(undefined), { text: '', turn: 0 })
  assert.deepEqual(lastAssistantAnswer({ order: [], nodes: { get: () => undefined } }), {
    text: '',
    turn: 0,
  })
})

test('lastAssistantAnswer 轮次号不合法时只丢轮次号、文字照留', () => {
  const snapshot = snapshotOf([['a', step('x', 'settled', [{ kind: 'text', text: '回答' }])]])
  assert.deepEqual(lastAssistantAnswer(snapshot), { text: '回答', turn: 0 })
})

test('lastAssistantText / lastAssistantTurn 只返回基本类型（供 selector 用）', () => {
  const snapshot = snapshotOf([['a', step(3, 'settled', [{ kind: 'text', text: '答案' }])]])
  assert.equal(lastAssistantText(snapshot), '答案')
  assert.equal(lastAssistantTurn(snapshot), 3)
  assert.equal(lastAssistantText(undefined), '')
  assert.equal(lastAssistantTurn(undefined), 0)
})

console.log(`\n${passed} passed`)
