// 写手 post-pack 链的性能判据（v0.178）。
//
// 热点：`prosemirrorToDocxBytes` 里十余个补丁各自 `JSZip.loadAsync(bytes)` →
// 读一个部件 → 改 → `zip.generateAsync()` 重压整包。带图片的件每次保存要解包/压包
// 十余遍。本轮把这一串收成「一次解包、共享 zip、一次打包」。
//
// 判据有两条，缺一不可：
//   ① 同进程 A/B：改前副本（HEAD 的 src/lib）与产品源，同一份 PM/meta 交替顺序跑，
//      各 10 样本取中位。跨进程绝对值随机器负载浮动，不能相减。
//   ② 语义等价：两腿产出的 zip **逐部件字符串**完全相同（部件名集合也相同）。
//      只比时间不比输出，等于没证明「优化没改坏文件」。
//
// 跑法（副本由 git archive 生成，脚本不碰 git）：
//   mkdir -p tmp/bench-pack-old && git archive HEAD src/lib | tar -x -C tmp/bench-pack-old
//   npx vite-node scripts/bench-docx-pack.mjs
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

// 夹具 → 读手 → HTML → PM：与 fidelity-roundtrip.mjs 的装配逐句对应
const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(
  await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }),
)

const reader = await import(url(path.join(REPO, 'src/lib/docx-fidelity.ts')))
const { docExtensions } = await import(url(path.join(REPO, 'src/lib/doc-schema.ts')))
const productWriter = await import(url(path.join(REPO, 'src/lib/docx.ts')))
const oldWriter = await import(url(path.join(REPO, 'tmp/bench-pack-old/src/lib/docx.ts')))

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

// 解包成「部件名 → 字符串」的有序签名。压缩字节、时间戳与包的随机关系号不参与比较
// （与保真账本同一口径：rId 要归一、docPr/@id 不归一）。这三样两腿天然不同，
// 混进签名会让「语义等价」永远假红。
function normalizePart(name, text) {
  if (name === 'docProps/core.xml') {
    return text.replace(
      /(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g,
      '$1TS$2',
    )
  }
  // docx 包给超链接发随机 rId（`rId8iboh-sm2mkm6uvkx0akl`）；只归一带字母/连字符的，
  // 保留 `rId1` 这类序号——编号顺序若变了仍能被签名抓到
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
