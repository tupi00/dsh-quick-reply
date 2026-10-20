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
  `${body}\nreturn { quoteText, quoteExcerpt, mergeDraft, turnRefLine, quoteInsert }`,
)()
const { quoteText, quoteExcerpt, mergeDraft, turnRefLine, quoteInsert } = helpers

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

console.log(`\n${passed} passed`)
