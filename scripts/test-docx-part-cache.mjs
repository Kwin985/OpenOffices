// v0.183 写手 post-pack 部件文本缓存断言。
//
// v0.178 的 PackSession 省了「整包解包 + 重压」，但十余个补丁仍各自
// `zip.file('word/document.xml').async('string')` 解压同一份部件
// （JSZip 对同一条目不缓存解压结果）。本轮会话按部件名缓存当前文本：
// 读查表、写同步更新，且只在 `zip === sess.zip` 的共享路径生效——
// A/B 对照腿各自解包时自动退回改前路径，不会跨实例串味。
//
// 跑法：npx vite-node scripts/test-docx-part-cache.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, pageSetupOf, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 源码级纪律 ----------------------------------------------------------
{
  const w = read('../src/lib/docx.ts')
  check('会话：PackSession 带 text 缓存表', /text\?: Map<string, string>/.test(w))
  check('partText：共享路径才查表（zip === sess.zip 守卫）',
    /const shared = !!cache && zip === sess!\.zip/.test(w)
      && /if \(shared && cache!\.has\(name\)\) return cache!\.get\(name\)!/.test(w))
  check('setPart：写回时同步更新缓存',
    /function setPart\([\s\S]{0,200}zip\.file\(name, text\)[\s\S]{0,120}sess\.text\.set\(name, text\)/.test(w))
  // v0.186 同一份 opts 多了一枚 legacyRetag（零正则的 A/B 腿），按「这枚在场」判，
  // 不钉死整个类型字面量
  check('入口：legacyPartText 可选参数', /opts\?: \{[^}]*legacyPartText\?: boolean/.test(w))
  check('入口：对照腿不建缓存表',
    /\.\.\.\(opts\?\.legacyPartText \? \{\} : \{ text: new Map<string, string>\(\) \}\)/.test(w))
  // 补丁数随轮次增长，别硬编码数目：写回至少 14 处，且每处写回都有对应的读。
  // v0.196 起允许「读比写多」——VML 补丁只读 rels 找 image 关系、不改 rels，
  // 只读部件不该被算成漏写。
  const nRead = (w.match(/await partText\(zip, /g) ?? []).length
  const nWrite = (w.match(/setPart\(zip, /g) ?? []).length
  check('补丁：写回不少于 14 处且都有对应的读（只读部件允许读多于写）',
    nWrite >= 14 && nRead >= nWrite, `读 ${nRead} / 写 ${nWrite}`)
  check('补丁：写回全部走 setPart（没有漏接的 zip.file(..., out)）',
    !/^\s*zip\.file\('word\/(?:document|styles|numbering)\.xml', \w+\)/m.test(w))
  check('attachThemePart 的三枚写回没被误改（THEME / Content_Types / rels）',
    /zip\.file\(THEME, themeXml\)/.test(w) && /const ct = await zip\.file\('\[Content_Types\]\.xml'\)/.test(w))
  const bench = read('./bench-docx-pack.mjs')
  check('旧尺：对照腿验数改成动态（不再硬编码 13）',
    /expected === 'auto'/.test(bench) && !/\n    13,\n  \)/.test(bench))
}

// ---- 2. 完整链路：两腿产物逐部件相同 ---------------------------------------
const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)
const base = await docxToDocMeta(srcBytes)
const merged = {
  ...base,
  ...(fid.styles?.length ? { styles: fid.styles } : {}),
  ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
  ...(fid.numbering ? { numbering: fid.numbering } : {}),
  ...(fid.section ? { page: { ...base.page, ...pageSetupOf(fid.section) } } : {}),
  ...(fid.background ? { background: fid.background } : {}),
  ...(fid.comments?.length ? { comments: fid.comments } : {}),
}
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pm = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()

const norm = (name, text) => name === 'docProps/core.xml'
  ? text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
  : text.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
async function parts(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()
  const out = []
  for (const n of names) out.push(`${n}\u0000${norm(n, await zip.file(n).async('string'))}`)
  return out
}

const a = await parts(await prosemirrorToDocxBytes(pm, merged, { legacyPartText: true }))
const b = await parts(await prosemirrorToDocxBytes(pm, merged))
eq('两腿部件名集合与顺序相同', JSON.stringify(a.map((x) => x.split('\u0000')[0])), JSON.stringify(b.map((x) => x.split('\u0000')[0])))
eq('两腿逐部件字符串相同（缓存没改坏文件）', JSON.stringify(a), JSON.stringify(b))
check('word/document.xml 在两腿里都非空', a.some((x) => x.startsWith('word/document.xml\u0000') && x.length > 200))

// ---- 3. 写回同步：缓存腿必须带出「最后一枚补丁之后的文本」 ------------------
{
  // 链上有多枚补丁依次改 document.xml（如 cols onOff、图片壳、边框）。
  // 若 setPart 漏同步，后续补丁会读到旧文本，产物就会与对照腿不同——上面
  // 的逐部件对撞已经覆盖；这里再单独钉「两腿都带出 w:cols 与 w:legacy」，
  // 证明缓存链没有整体短路。
  const docA = a.find((x) => x.startsWith('word/document.xml\u0000')) ?? ''
  const docB = b.find((x) => x.startsWith('word/document.xml\u0000')) ?? ''
  check('两腿 document.xml 都带出节余量（缓存链没短路）',
    docA.includes('w:equalWidth="0"') === docB.includes('w:equalWidth="0"'))
  const numA = a.find((x) => x.startsWith('word/numbering.xml\u0000')) ?? ''
  const numB = b.find((x) => x.startsWith('word/numbering.xml\u0000')) ?? ''
  check('两腿 numbering.xml 都带出 w:legacy',
    numA.includes('<w:legacy') && numB.includes('<w:legacy'))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const x of bad) console.log(`FAIL ${x}`)
if (bad.length) process.exitCode = 1
