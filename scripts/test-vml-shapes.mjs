// v0.196 断言：VML 老式形状整段字面往返（判断修正 + rId 重映射 + 三道守卫）。
//
// D55 记的「模型无槽、写手发不出 w:pict」只说明不能靠包原生槽重建，
// 不等于搬不回来：读手把 <w:pict>/<w:object> 展平成一行占位文字，写手侧
// 从源包按段落边界留下整段字面、重映射 image rId 后替换占位段即可。
//
// 口径：写出包根自己已声明 xmlns:v / xmlns:o / xmlns:w10（docx 包默认带），
// 所以贴回去不是未声明前缀的坏件；但同号 rId 在写出包里指向完全不同的部件
// （源 rId1=image、写出包 rId1=styles.xml），必须按关系类型重映射。
//
// 跑法：npx vite-node scripts/test-vml-shapes.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML, DOMParser as XmlParser } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  docxToDocMeta, pageSetupOf, patchVmlShapes, prosemirrorToDocxBytes, vmlShapesOf,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const mkBytes = async (files) => {
  const z = new JSZip()
  for (const [p, c] of Object.entries(files)) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const partOf = async (b, p) => (await JSZip.loadAsync(b)).file(p)?.async('string') ?? ''
const parasOf = (s) => [...s.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) => m[0])
const vmlParas = (s) => parasOf(s).filter((p) => /<w:pict|<w:object/.test(p))

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word"'
const docWith = (root, body) => `<w:document ${root}><w:body>${body}</w:body></w:document>`
const PLACEHOLDER = '<w:p><w:r><w:t>〔嵌入对象，内容未提取〕</w:t></w:r></w:p>'

async function main() {
  const w = read('../src/lib/docx.ts')

  // ── ① 提取纯函数边界 ────────────────────────────────────────────────
  // 源包：rId1=image。写出包：rId1=styles、image 换成了 rId7（模拟包重建关系表）
  const rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  const outRels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/x.png"/>'
  const pict = '<w:p><w:r><w:pict><v:shape id="S1"/><v:imagedata r:id="rId1"/></w:pict></w:r></w:p>'
  const obj = '<w:p><w:r><w:object w:dxaOrig="5486"><o:OLEObject ShapeID="S1"/></w:object></w:r></w:p>'
  const doc = docWith(NS, pict + obj)
  const got = vmlShapesOf(doc, rels)
  eq('提取两段（pict + object）', got.length, 2)
  eq('只把指向 image 的 rId 记进 imageRIds', got.map((s) => s.imageRIds), [['rId1'], []])
  eq('整段字面原样保留', got[0].literal, pict)
  eq('非 VML 段不收', vmlShapesOf(docWith(NS, '<w:p><w:r><w:t>正文</w:t></w:r></w:p>'), rels), [])
  eq('不指向 image 的 rId 不进重映射表',
    vmlShapesOf(docWith(NS, '<w:p><w:r><w:pict><v:imagedata r:id="rId9"/></w:pict></w:r></w:p>'), rels)[0].imageRIds, [])
  // 非贪婪 <w:p> 会截断 VML 文字框内嵌段落：半截片没有闭标签，宁可跳过
  const nested = '<w:p><w:r><w:pict><v:textbox><w:txbxContent><w:p><w:r><w:t>内嵌</w:t></w:r></w:p>' +
    '</w:txbxContent></v:textbox></w:pict></w:r></w:p>'
  check('内嵌段落的半截片跳过（不贴坏件）', vmlShapesOf(docWith(NS, nested), rels).length === 0)
  eq('空 rels 时仍收段，只是不重映射', vmlShapesOf(doc, '')[0].imageRIds, [])

  // ── ② 补丁边界（最小 zip，逐条守卫）──────────────────────────────────
  const base = { 'word/document.xml': docWith(NS, PLACEHOLDER), 'word/_rels/document.xml.rels': outRels }
  const bytes = await mkBytes(base)
  check('空 items 返回同一枚 bytes', (await patchVmlShapes(bytes, undefined)) === bytes)
  check('空数组返回同一枚 bytes', (await patchVmlShapes(bytes, [])) === bytes)
  const filled = await patchVmlShapes(bytes, got)
  const filledDoc = await partOf(filled, 'word/document.xml')
  check('两段都贴回', filledDoc.includes('<v:shape id="S1"/>') && filledDoc.includes('<w:object'))
  check('占位段被替换掉（不留下多余空行）', !filledDoc.includes('内容未提取〕'))
  check('rId 按关系类型重映射到 rId7', filledDoc.includes('r:id="rId7"') && !filledDoc.includes('r:id="rId1"'))
  check('幂等：再跑一次整笔不动', (await patchVmlShapes(filled, got)) === filled)
  // ① 已有 VML 壳
  const already = await mkBytes({ 'word/document.xml': docWith(NS, pict + PLACEHOLDER), 'word/_rels/document.xml.rels': outRels })
  check('写出包已有 w:pict 就整笔不动', (await patchVmlShapes(already, got)) === already)
  // ② 根缺命名空间
  const noNs = await mkBytes({ 'word/document.xml': docWith('xmlns:w="urn:w"', PLACEHOLDER), 'word/_rels/document.xml.rels': outRels })
  check('根没声明 v/o/w10 就跳过（防坏 XML）', (await patchVmlShapes(noNs, got)) === noNs)
  // ③ image 关系缺失：带 rId 的段跳过，object 段仍贴
  const noImg = await mkBytes({ 'word/document.xml': docWith(NS, PLACEHOLDER), 'word/_rels/document.xml.rels': '' })
  const noImgDoc = await partOf(await patchVmlShapes(noImg, got), 'word/document.xml')
  check('没有 image 关系就跳过带 r:id 的段', !noImgDoc.includes('<v:shape'))
  check('没有 image 关系时 object 段仍贴回', noImgDoc.includes('<w:object'))
  // 锚点缺失
  const noAnchor = await mkBytes({ 'word/document.xml': docWith(NS, '<w:p><w:r><w:t>正文</w:t></w:r></w:p>'), 'word/_rels/document.xml.rels': outRels })
  check('占位段认不出就整笔不贴', (await patchVmlShapes(noAnchor, got)) === noAnchor)

  // ── ③ 产品链端到端 ──────────────────────────────────────────────────
  const parts = fixtureParts()
  const z = new JSZip()
  for (const [p, c] of parts) z.file(p, c)
  const fixture = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const fid = await docxToHtmlFidelity(fixture)
  const meta = await docxToDocMeta(fixture)
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
    ...(fid.background ? { background: fid.background } : {}),
    ...(fid.comments.length ? { comments: fid.comments } : {}),
  }
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()
  const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged))
  const srcDoc = parts.get('word/document.xml') ?? ''
  const outDoc = await out.file('word/document.xml').async('string')
  const prodRels = await out.file('word/_rels/document.xml.rels').async('string')
  const srcP = vmlParas(srcDoc)
  const outP = vmlParas(outDoc)
  eq('产品链：三段 VML 全回来', [srcP.length, outP.length], [3, 3])
  check('产品链：占位文字不在写出包里', !outDoc.includes('内容未提取〕'))
  const imgRid = [...prodRels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0]).find((t) => /Type="[^"]*\/image"/.test(t))?.match(/Id="([^"]+)"/)?.[1] ?? ''
  check('写出包有 image 关系', !!imgRid)
  check('写出包里不再出现源 rId1 的 VML 引用', !outP.some((p) => /r:id="rId1"/.test(p)))
  check('写出包的 VML 引用指向 image 关系', outP.some((p) => p.includes(`r:id="${imgRid}"`)))
  let same = true
  for (let i = 0; i < srcP.length; i++) {
    const expected = srcP[i].split('r:id="rId1"').join(`r:id="${imgRid}"`)
    if (expected !== outP[i]) same = false
  }
  check('三段逐字与源件相同（仅 rId 重映射）', same)
  const dom = new XmlParser().parseFromString(outDoc, 'text/xml')
  eq('写出包 XML 可解析、零 parsererror', [dom.documentElement?.tagName, dom.querySelectorAll('parsererror').length], ['w:document', 0])
  eq('meta.vmlShapes 三段', meta.vmlShapes?.length, 3)
  eq('meta 里 imageRIds 按段记录', meta.vmlShapes?.map((s) => s.imageRIds), [['rId1'], ['rId1'], []])
  const again = await patchVmlShapes(new Uint8Array(await out.generateAsync({ type: 'arraybuffer', compression: 'STORE' })), meta.vmlShapes)
  eq('产品链产物再跑补丁逐字不变', await partOf(again, 'word/document.xml'), outDoc)

  // ── ④ 源码级：判断修正 + 三道守卫 + 动态链 ──────────────────────────
  check('判断修正写明「不能靠包原生槽 ≠ 搬不回来」', /不等于.*搬不回来|不能靠包的/.test(w))
  check('三道守卫：幂等', /xml\.includes\('<w:pict'\) \|\| xml\.includes\('<w:object'\)/.test(w))
  check('三道守卫：命名空间', /!root\.includes\('xmlns:v='\) \|\| !root\.includes\('xmlns:o='\) \|\| !root\.includes\('xmlns:w10='\)/.test(w))
  check('三道守卫：rId 映射不到就跳过该段', /if \(it\.imageRIds\.length && !targetRId\) continue/.test(w))
  check('锚点用读手生成的占位文字', /xml\.indexOf\('内容未提取〕'\)/.test(w))
  check('重映射按关系类型找 image（不按同号）', w.includes('Type="[^"]*\\/image"') && w.includes('outImageRId'))
  check('提取从已读的 relsText 取（零新增部件读）', /const vmlShapes = vmlShapesOf\(docXml, relsText\)/.test(w))
  check('主链挂 withVml，逐笔接上一笔', /const withVml = await patchVmlShapes\(withPlacements, meta\?\.vmlShapes, sess\)/.test(w) && /patchTcPr\(withVml,| : withVml/.test(w))
  // 动态链校验只取主链区间（withCols → withNumStart）；withSpace 是边框纯函数、
  // withKid 是局部插值，都不在补丁链里，不该拿来参与校验。
  const defs = [...w.matchAll(/^  const (with[A-Z]\w*) =/gm)].map((m) => ({ name: m[1], at: m.index }))
  const from = defs.findIndex((d) => d.name === 'withCols')
  const to = defs.findIndex((d) => d.name === 'withNumStart')
  const core = defs.slice(from, to + 1)
  let chainOk = from >= 0 && to > from
  for (let i = 1; i < core.length; i++) {
    const seg = w.slice(core[i].at, i + 1 < core.length ? core[i + 1].at : core[i].at + 700)
    if (!seg.includes(core[i - 1].name)) chainOk = false
  }
  check('核心补丁链每笔输入 = 上一笔输出（含 withVml）', chainOk && core.some((d) => d.name === 'withVml'))
  check('没新增 lib 文件（纯函数放在已有 docx.ts）', !w.includes("readText('word/comments.xml')"))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
