// 写手 post-pack 链的性能判据（v0.178，v0.179 改为自包含对照腿）。
//
// 热点：`prosemirrorToDocxBytes` 里十余个补丁各自 `JSZip.loadAsync(bytes)` →
// 读一个部件 → 改 → `zip.generateAsync()` 重压整包。带图片的件每次保存要解包/压包
// 十余遍。v0.178 把这一串收成「一次解包、共享 zip、一次打包」。
//
// 判据有两条，缺一不可：
//   ① 同进程 A/B：改前腿与产品源同一份代码，只把「共享会话」关掉，交替顺序跑，
//      各 10 样本取中位。跨进程绝对值随机器负载浮动，不能相减。
//   ② 语义等价：两腿产出的 zip **逐部件字符串**完全相同（部件名集合也相同）。
//      只比时间不比输出，等于没证明「优化没改坏文件」。
//
// 为什么不再用手搓的 `git archive HEAD src/lib` 副本（v0.179 修）：
// 那个副本在 v0.178 提交后就与产品源不同步了——HEAD 已经是优化后的版本，
// 而后续轮次还会往写手加新功能（v0.179 的 a:ln），两腿差的东西越来越多，
// 语义等价会假红。现在对照腿由脚本从**当前产品源**生成，只做三处机械改写
// 把 PackSession 退回「每个补丁各自解包/打包」，其余差异一律为零。
//
// 跑法：npx vite-node scripts/bench-docx-pack.mjs
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const url = (p) => `file:///${p.replace(/\\/g, '/')}`
const ROUNDS = 10

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 把产品源的写手退回「每个补丁各自解包/打包」，生成对照腿。三处机械改写，逐条验数。 */
function legacyWriter() {
  const dir = path.join(REPO, 'tmp/bench-pack-legacy')
  const libDir = path.join(dir, 'src/lib')
  fs.mkdirSync(libDir, { recursive: true })
  fs.cpSync(path.join(REPO, 'src/lib'), libDir, { recursive: true })
  const file = path.join(libDir, 'docx.ts')
  let s = fs.readFileSync(file, 'utf8')
  // v0.183：补丁数随轮次增长（v0.182 加了 patchColsOnOff 后硬编码的 13 就过期了）。
  // 第一处改写按产品源动态取数，第二处要求「读写配对」与它相等，第三处恒为 1。
  let patchCount = 0
  const swap = (from, to, expected) => {
    const n = s.split(from).length - 1
    if (expected === 'auto') {
      if (!patchCount) patchCount = n
      expected = patchCount
    }
    if (n !== expected) throw new Error(`对照腿改写失败：期望 ${expected} 处，实际 ${n} 处 — ${from.slice(0, 60)}`)
    s = s.split(from).join(to)
  }
  // ① 每个补丁独立解包（不再共享 sess.zip）
  swap(
    '  const zip = sess ? sess.zip : await loadZipOf(bytes)',
    "  const { default: JSZip } = await import('jszip')\n  const zip = await JSZip.loadAsync(bytes)",
    'auto',
  )
  // ② 每个补丁独立重压整包
  swap(
    '  return finishPatch(bytes, zip, sess)',
    "  const buf = (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer\n  return new Uint8Array(buf)",
    'auto',
  )
  // ③ 主链末尾不再统一打包，直接交回最后一枚补丁的产物
  const tail = `  await attachThemePart(withPgNum, meta?.themeXml, sess)
  // v0.178：链上所有改动都落在 sess.zip 里；没改动就原样放回 Packer 的字节，
  // 有改动才 generate 一次。两腿逐部件字符串必须完全一致（scripts/bench-docx-pack.mjs）
  if (!sess.touched) return out
  const buf = (await sess.zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer
  return new Uint8Array(buf)`
  swap(
    tail,
    `  const withTheme = await attachThemePart(withPgNum, meta?.themeXml, sess)
  return withTheme`,
    1,
  )
  fs.writeFileSync(file, s)
  return file
}

// 夹具 → 读手 → HTML → PM：与 fidelity-roundtrip.mjs 的装配逐句对应
const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(
  await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }),
)

const reader = await import(url(path.join(REPO, 'src/lib/docx-fidelity.ts')))
const { docExtensions } = await import(url(path.join(REPO, 'src/lib/doc-schema.ts')))
const productWriter = await import(url(path.join(REPO, 'src/lib/docx.ts')))
const oldWriter = await import(url(legacyWriter()))

const fid = await reader.docxToHtmlFidelity(srcBytes)
const meta = await productWriter.docxToDocMeta(srcBytes)
const merged = {
  ...meta,
  ...(fid.styles?.length ? { styles: fid.styles } : {}),
  ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
  ...(fid.numbering ? { numbering: fid.numbering } : {}),
  ...(fid.section ? { page: { ...meta.page, ...productWriter.pageSetupOf(fid.section) } } : {}),
  ...(fid.background ? { background: fid.background } : {}),
  ...(fid.comments.length ? { comments: fid.comments } : {}),
}
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pmDoc = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()

// 解包成「部件名 → 字符串」的有序签名，压缩字节/时间戳不参与比较
function normalizePart(name, text) {
  if (name === 'docProps/core.xml') {
    return text.replace(
      /(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g,
      '$1TS$2',
    )
  }
  // docx 包给超链接发随机 rId；只归一带字母/连字符的，保留 rId1 这类序号
  return text.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
}

async function partsSignature(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()
  const out = []
  for (const n of names) out.push(`${n}\u0000${normalizePart(n, await zip.file(n).async('string'))}`)
  return out.join('\u0001')
}

const OLD = await partsSignature(await oldWriter.prosemirrorToDocxBytes(pmDoc, merged))
const NEW = await partsSignature(await productWriter.prosemirrorToDocxBytes(pmDoc, merged))
console.log(`语义等价（逐部件字符串）：${OLD === NEW ? '✓ 相同' : '✗ 不同'}`)
if (OLD !== NEW) {
  const a = OLD.split('\u0001'), b = NEW.split('\u0001')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue
    console.log(`  首个差异在第 ${i} 个部件：${(a[i] ?? '(缺)').slice(0, 120)} / ${(b[i] ?? '(缺)').slice(0, 120)}`)
    break
  }
}

// 交替顺序，避免「先跑的腿吃冷缓存」这一类偏差
const legs = [
  { name: '改前（每个补丁各自解包）', fn: oldWriter.prosemirrorToDocxBytes },
  { name: '本轮（一次解包/一次打包）', fn: productWriter.prosemirrorToDocxBytes },
]
const times = legs.map(() => [])
for (const { fn } of legs) { await fn(pmDoc, merged); await fn(pmDoc, merged) }
for (let r = 0; r < ROUNDS; r++) {
  const order = r % 2 === 0 ? [0, 1] : [1, 0]
  for (const i of order) {
    const t = performance.now()
    await legs[i].fn(pmDoc, merged)
    times[i].push(performance.now() - t)
  }
}
const m = times.map(median)
console.log('')
for (let i = 0; i < legs.length; i++) {
  console.log(`${legs[i].name.padEnd(30)} ${m[i].toFixed(1)}ms（${ROUNDS} 趟中位）`)
}
const drop = ((m[0] - m[1]) / m[0]) * 100
console.log(`变化 ${drop >= 0 ? '−' : '+'}${Math.abs(drop).toFixed(1)}%`)

if (OLD !== NEW) process.exitCode = 1
