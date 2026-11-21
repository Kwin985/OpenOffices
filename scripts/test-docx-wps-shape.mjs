// v0.218：wps 文本框形状壳往返的端到端验证（Node 侧）。
//
// CT_WordprocessingShape 文本框：正文被读进模型（屏上看得到），但 wps 形状壳
// （style/cNvSpPr/spPr/bodyPr 19 枚）此前无槽、写手只发 pic:pic 占位——往返后
// 壳丢。本测试验证 wpsShapes 通道按 docPr id 把 graphicData 占位换成 wps 形状，
// 且不重复 docPr/drawing（这是第一版整段换 <w:p> 踩过的坑）。
import JSZip from 'jszip'
import { fixtureParts } from '../scripts/lib/fixture.mjs'
import { wpsShapesOf } from '../src/lib/docx.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}

// ① 提取：fixture 里有「文本框正文」和「艺术字」两只 wps 形状
let shapes
{
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const xml = await z.file('word/document.xml').async('string')
  shapes = wpsShapesOf(xml)
  check('提取到 wps 形状', shapes.length >= 1, `实际 ${shapes.length}`)
  const tb = shapes.find((s) => s.text === '文本框正文')
  check('文本框正文被认作一只形状', !!tb)
  check('bodyPr 19 枚属性在字面里', tb && (tb.bodyPrAttrs.match(/="/g) || []).length >= 19,
    tb ? `bodyPrAttrs=${tb.bodyPrAttrs.slice(0, 80)}` : '无形状')
  check('提取的是 graphicData 不是整段 w:p', !!tb && tb.literal.startsWith('<a:graphicData') && !tb.literal.startsWith('<w:p'))
  check('带 docPr id 供对位', !!tb && tb.docPrId === '9', tb?.docPrId)
  check('literal 补了 wps uri', !!tb && tb.literal.includes('wordprocessingShape'))
}

// ② 走产品真链路：源包 → 读手 → HTML → PM → 写手（meta 带 wpsShapes）
{
  const { docxToHtmlFidelity } = await import('../src/lib/docx-fidelity.ts')
  const writer = await import('../src/lib/docx.ts')
  const { getSchema } = await import('@tiptap/core')
  const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
  const { parseHTML } = await import('linkedom')
  const { docExtensions } = await import('../src/lib/doc-schema.ts')

  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const srcBytes = await z.generateAsync({ type: 'uint8array' })
  const fid = await docxToHtmlFidelity(srcBytes)
  const meta = await writer.docxToDocMeta(srcBytes)
  check('meta 带 wpsShapes', !!meta.wpsShapes?.length, `实际 ${meta.wpsShapes?.length}`)

  const schema = getSchema(docExtensions())
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
  const outBytes = await writer.prosemirrorToDocxBytes(pmDoc, meta)
  const outZip = await JSZip.loadAsync(outBytes)
  const outXml = await outZip.file('word/document.xml').async('string')

  check('写出包含 wps:wsp', outXml.includes('<wps:wsp'))
  check('写出包含 wps:bodyPr', outXml.includes('<wps:bodyPr'))
  check('bodyPr 19 枚属性写回', (outXml.match(/<wps:bodyPr\b[^>]*>/)?.[0].match(/="/g) || []).length >= 19)
  // 关键回归：整段换 w:p 会让这两个计数各 +2
  check('docPr 仍是 5 枚（未重复）', (outXml.match(/<wp:docPr/g) || []).length === 5,
    `实际 ${(outXml.match(/<wp:docPr/g) || []).length}`)
  check('drawing 仍是 5 枚（未重复）', (outXml.match(/<w:drawing>/g) || []).length === 5,
    `实际 ${(outXml.match(/<w:drawing>/g) || []).length}`)
  check('正文只出现一次（未重复）', (outXml.match(/文本框正文/g) || []).length === 1,
    `出现 ${(outXml.match(/文本框正文/g) || []).length} 次`)

  // ③ 反例：docPr id 对不上就跳过这一只（宁缺毋滥）
  const badMeta = { ...meta, wpsShapes: [{ ...meta.wpsShapes[0], docPrId: '999' }] }
  const outBad = await writer.prosemirrorToDocxBytes(pmDoc, badMeta)
  const zb = await JSZip.loadAsync(outBad)
  const xb = await zb.file('word/document.xml').async('string')
  check('反例：docPr 对不上就不贴', !xb.includes('<wps:wsp'))
}

console.log(`docx-wps-shape: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
