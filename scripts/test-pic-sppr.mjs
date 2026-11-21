// v0.219：图片四片合法余量的往返验证（Node 侧）。
//
// `pic:spPr` 的填充组、`a:ln` 的子填充、`a:custGeom`、`pic:blipFill@rotWithShape`
// 从 v0.155 起只按名记账（屏上零兑现、模型零载荷、docx 包无构造器），往返后写手
// 一律发 `<a:noFill/>` 与 `prstGeom rect`。本测试验证 picSppr 通道按 docPr id
// 把这几片换回源件字面，**同时**不动用户能改的东西（xfrm / bwMode / a:ln 属性）。
//
// 分档的意义也在这里：同族的颜色变换（gradFill 被塞进 pic:blipFill）、a:ext（没
// 套 extLst）、scene3d/sp3d（被塞进 effectLst）都在非法位，不该被这一通道带出来
// ——下面有一条反例专盯这件事。
import JSZip from 'jszip'
import { fixtureParts } from '../scripts/lib/fixture.mjs'
import { picSpprsOf } from '../src/lib/docx.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}

const fixtureSrc = async () => {
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

// ① 提取：源包里有两只图片带余量（图 1：填充+线填充；图 3：custGeom+blipFill 旋转）
let items
{
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const xml = await z.file('word/document.xml').async('string')
  items = picSpprsOf(xml)
  check('提取到图片余量', items.length >= 2, `实际 ${items.length}`)
  const first = items.find((i) => i.docPrId === '7')
  const third = items.find((i) => i.docPrId === '11')
  check('图 1 认出（docPr 7）', !!first)
  check('图 1 的 spPr 填充是 gradFill', !!first && /^<a:gradFill\b/.test(first.fill ?? ''),
    first?.fill?.slice(0, 40))
  check('图 1 的线填充带颜色变换',
    !!first && /lumMod val="50000"/.test(first.lnFill ?? '') && /<a:shade val="50000"/.test(first.lnFill ?? ''),
    first?.lnFill?.slice(0, 80))
  check('图 1 没有 custGeom', !!first && first.custGeom === undefined)
  check('图 3 认出（docPr 11）', !!third)
  check('图 3 的 custGeom 整段带路径', !!third && /<a:path\b[^>]*\bpath="moveTo/.test(third.custGeom ?? ''),
    third?.custGeom?.slice(0, 60))
  check('图 3 的 blipFill 旋转 = 1', third?.blipRot === '1', third?.blipRot)
  check('内部 noFill 不当作填充记账', items.every((i) => !(i.fill ?? '').startsWith('<a:noFill')))
}

// ② 走产品真链路：源包 → 读手 → HTML → PM → 写手（meta 带 picSppr）
let outXml, meta
{
  const { docxToHtmlFidelity } = await import('../src/lib/docx-fidelity.ts')
  const writer = await import('../src/lib/docx.ts')
  const { getSchema } = await import('@tiptap/core')
  const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
  const { parseHTML } = await import('linkedom')
  const { docExtensions } = await import('../src/lib/doc-schema.ts')

  const srcBytes = await fixtureSrc()
  const fid = await docxToHtmlFidelity(srcBytes)
  meta = await writer.docxToDocMeta(srcBytes)
  check('meta 带 picSppr', !!meta.picSppr?.length, `实际 ${meta.picSppr?.length}`)

  const schema = getSchema(docExtensions())
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
  const outBytes = await writer.prosemirrorToDocxBytes(pmDoc, meta)
  const outZip = await JSZip.loadAsync(outBytes)
  outXml = await outZip.file('word/document.xml').async('string')

  // 灌进去了
  check('写出包含 spPr 渐变填充', /<pic:spPr\b[^>]*>[\s\S]*?<a:gradFill>/.test(outXml))
  check('写出包含两枚色标', (outXml.match(/<a:gs pos=/g) || []).length === 2,
    `实际 ${(outXml.match(/<a:gs pos=/g) || []).length}`)
  check('写出包含线填充的颜色变换',
    outXml.includes('<a:lumMod val="50000"/>') && outXml.includes('<a:shade val="50000"/>'))
  check('写出包含 lum 的明暗两档',
    /<a:lum bright="40000" contrast="60000"\/>/.test(outXml))
  check('写出包含 custGeom 路径', /<a:custGeom>[\s\S]*?<a:path\b[^>]*path="moveTo\(0,0\) lnTo\(1000,1000\)"/.test(outXml))
  check('写出包含 blipFill 旋转', /<pic:blipFill rotWithShape="1">/.test(outXml))

  // 不动用户能改的东西
  check('xfrm 的旋转翻转仍在', /<a:xfrm rot="5400000" flipH="1" flipV="0">/.test(outXml))
  check('bwMode 仍是源件的 gray', /<pic:spPr bwMode="gray">/.test(outXml))
  check('a:ln 的 cap/cmpd 未被覆盖', /<a:ln w="9525" cap="flat" cmpd="sng">/.test(outXml))

  // 计数守卫：换的是内容不是结构
  check('pic:pic 仍是 3 枚', (outXml.match(/<pic:pic\b/g) || []).length === 3,
    `实际 ${(outXml.match(/<pic:pic\b/g) || []).length}`)
  check('pic:spPr 仍是 3 枚', (outXml.match(/<pic:spPr\b/g) || []).length === 3,
    `实际 ${(outXml.match(/<pic:spPr\b/g) || []).length}`)
  check('wp:docPr 仍是 5 枚', (outXml.match(/<wp:docPr/g) || []).length === 5,
    `实际 ${(outXml.match(/<wp:docPr/g) || []).length}`)

  // 位次：填充组在 geometry 之后、a:ln 之前（CT_ShapeProperties）；a:ln 的填充是首子元素
  {
    const sp = /<pic:spPr bwMode="gray">[\s\S]*?<\/pic:spPr>/.exec(outXml)?.[0] ?? ''
    const gAt = sp.indexOf('</a:prstGeom>')
    const fAt = sp.indexOf('<a:gradFill>')
    const lAt = sp.indexOf('<a:ln ')
    check('填充组位次合法（geometry → fill → ln）', gAt >= 0 && gAt < fAt && fAt < lAt,
      `g=${gAt} f=${fAt} l=${lAt}`)
    const ln = /<a:ln w="9525" cap="flat" cmpd="sng">([\s\S]*?)<\/a:ln>/.exec(sp)?.[1] ?? ''
    check('a:ln 的填充是首子元素', /^<a:solidFill>/.test(ln), ln.slice(0, 40))
  }
  // 同槽二选一：custGeom 与 prstGeom 不许共存
  {
    const sp = /<pic:spPr bwMode="auto"><a:xfrm rot="5400000"[\s\S]*?<\/pic:spPr>/.exec(outXml)?.[0] ?? ''
    check('custGeom 与 prstGeom 不同时在场',
      sp.includes('<a:custGeom>') && !sp.includes('<a:prstGeom'))
  }
  // 反例口径：非法位那几族不该被带出来
  check('反例：非法位的 props3d 未被带出', !outXml.includes('<a:props3d'))
  check('反例：非法位的 sp3d 未被带出', !outXml.includes('<a:sp3d'))
  check('反例：非法位的裸 a:ext uri 未被带出', !/<a:ext uri="\{1234/.test(outXml))

  // ③ 反例：docPr id 对不上就跳过（宁缺毋滥）
  const badMeta = { ...meta, picSppr: meta.picSppr.map((i) => ({ ...i, docPrId: '999' })) }
  const writer2 = writer
  const pmDoc2 = pmDoc
  const outBad = await writer2.prosemirrorToDocxBytes(pmDoc2, badMeta)
  const xb = await (await JSZip.loadAsync(outBad)).file('word/document.xml').async('string')
  check('反例：docPr 对不上就不贴', !xb.includes('<a:gradFill>') && !xb.includes('<a:custGeom>'))

  // ④ 幂等：把已成型的写出包再补一趟，document.xml 逐字节不变
  // （不比对两趟写手的产物——docx 包每次给 drawing 分随机 id，那一层不是本通道的事）
  const again = await writer.patchPicSppr(outBytes, meta.picSppr)
  const xa = await (await JSZip.loadAsync(again)).file('word/document.xml').async('string')
  check('二次补片 document.xml 不变', xa === outXml)
}

console.log(`pic-sppr: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
