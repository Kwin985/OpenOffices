// v0.178 图片壳整族往返断言（承接 v0.177 的 wp:anchor）。
//
// 这一族的共同形状：**包发得出壳，只是属性漏接或元素名不同**。
//   wp:inline   包发（不发 anchorId/editId）
//   a:srcRect   包发空壳（不发 t/r/b/l）
//   a:xfrm      包发（不发 rot/flipH/flipV）
//   wp:wrapNone 包恒发；源件说四周环绕时整片换成 wp:wrapSquare wrapText=…
// 所以四族都是「按载荷改属性 / 整片换一枚」，零插元素、零 schema 锚点表——
// 与 D37 顺延里那 275 对「模型无槽、要整族设计」的不是一回事。
//
// 走完整链路：夹具 docx → 读手 HTML → TipTap schema → PM → 写手 → 解包逐枚对撞。
// 跑法：npx vite-node scripts/test-image-shell.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'
import { parseImgPayload } from '../src/lib/cell-style.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)

// ---- 1. 读手载荷 ---------------------------------------------------------
const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)
const shells = [...fid.html.matchAll(/<img[^>]*data-img="([^"]*)"/g)].map((m) => m[1]).map(parseImgPayload)

{
  const withId = shells.find((k) => k.anId !== undefined)
  check('读手：wp:inline 两个流水号进载荷', !!withId)
  eq('读手：anchorId 原值', withId?.anId, '00000001')
  eq('读手：editId 原值', withId?.anEdit, '00000002')

  const withSr = shells.find((k) => k.srT !== undefined)
  check('读手：a:srcRect 四边进载荷', !!withSr)
  eq('读手：裁剪四边', [withSr?.srT, withSr?.srR, withSr?.srB, withSr?.srL].join(','), '25000,0,10000,5000')

  const withXf = shells.find((k) => k.xfRot !== undefined)
  check('读手：a:xfrm 变换三枚进载荷', !!withXf)
  eq('读手：rot 六万分之一度', withXf?.xfRot, '5400000')
  eq('读手：翻转两枚', [withXf?.xfFlipH, withXf?.xfFlipV].join(','), '1,0')

  const withWrap = shells.find((k) => k.wrapText !== undefined)
  check('读手：环绕档位进载荷', !!withWrap)
  eq('读手：wrapText', withWrap?.wrapText, 'bothSides')
}

// ---- 2. 完整链路 → 写手 ---------------------------------------------------
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pmDoc = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
const meta = await docxToDocMeta(srcBytes)
const outBytes = await prosemirrorToDocxBytes(pmDoc, meta)
const outXml = await (await JSZip.loadAsync(outBytes)).file('word/document.xml').async('string')

{
  const inlineTags = [...outXml.matchAll(/<wp:inline\b([^>]*)>/g)].map((m) => m[1])
  const a = (n) => new RegExp(`\\b${n}="([^"]*)"`)
  check('写手：wp:inline 仍在（没被误换成 anchor）', inlineTags.length > 0)
  const idTag = inlineTags.find((t) => a('anchorId').test(t))
  eq('写手：wp:inline/@anchorId 原值', a('anchorId').exec(idTag ?? '')?.[1], '00000001')
  eq('写手：wp:inline/@editId 原值', a('editId').exec(idTag ?? '')?.[1], '00000002')

  // 按 <w:drawing> 块对位：载荷只属于源件那一块，别的块必须仍是空壳。
  // 全文取第一枚会拿到无载荷的那一块（v0.178 写作时踩过一次），这里逐块断言
  const blocks = [...outXml.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)].map((m) => m[0])
  eq('写手：drawing 块数', blocks.length, 5)

  const srTags = [...outXml.matchAll(/<a:srcRect\b([^>]*)\/>/g)].map((m) => m[1])
  const srHit = srTags.find((t) => a('t').test(t)) ?? ''
  eq('写手：带载荷那一块的 a:srcRect/@t', a('t').exec(srHit)?.[1], '25000')
  eq('写手：a:srcRect/@r', a('r').exec(srHit)?.[1], '0')
  eq('写手：a:srcRect/@b', a('b').exec(srHit)?.[1], '10000')
  eq('写手：a:srcRect/@l', a('l').exec(srHit)?.[1], '5000')
  eq('写手：只有一块的 srcRect 带属性', srTags.filter((t) => a('t').test(t)).length, 1)

  const xfTags = [...outXml.matchAll(/<a:xfrm\b([^>]*)>/g)].map((m) => m[1])
  const xfHit = xfTags.find((t) => a('rot').test(t)) ?? ''
  eq('写手：带载荷那一块的 a:xfrm/@rot', a('rot').exec(xfHit)?.[1], '5400000')
  eq('写手：a:xfrm/@flipH', a('flipH').exec(xfHit)?.[1], '1')
  eq('写手：a:xfrm/@flipV', a('flipV').exec(xfHit)?.[1], '0')
  eq('写手：只有一块的 xfrm 带变换', xfTags.filter((t) => a('rot').test(t)).length, 1)

  const wrap = /<wp:wrapSquare\b([^>]*)\/>/.exec(outXml)?.[1] ?? ''
  eq('写手：wrapNone 整片换成 wrapSquare', /wrapText="([^"]*)"/.exec(wrap)?.[1], 'bothSides')
  eq('写手：wrapSquare 只出现一次', (outXml.match(/<wp:wrapSquare\b/g) ?? []).length, 1)
  // 包对每枚浮动图无条件 push wrapNone：不带环绕载荷的那一块留着它（源件也没说过
  // 别的环绕档），带载荷的那一块换成 wrapSquare。两块都按载荷各说各的话
  eq('写手：另一枚浮动图仍是 wrapNone', (outXml.match(/<wp:wrapNone\s*\/>/g) ?? []).length, 1)
}

// ---- 3. 纪律：只改属性/整片换，不插新元素、不碰 unrelated drawing -------------
{
  const reader = fs.readFileSync(new URL('../src/lib/docx-fidelity.ts', import.meta.url), 'utf8')
  const writer = fs.readFileSync(new URL('../src/lib/docx.ts', import.meta.url), 'utf8')
  check('接线：变换三枚走 attrL 单漏斗（与屏上同一处，变异腿不动）',
    /\['xfRot', 'rot'\], \['xfFlipH', 'flipH'\], \['xfFlipV', 'flipV'\]/.test(reader)
      && /attrL\(xfrm, n\)/.test(reader))
  check('接线：环绕档位走 attrL 单漏斗', /attrL\(wrapSq, 'wrapText'\)/.test(reader))
  check('接线：四族都用 retag 改属性', writer.includes("retag(chunk, 'wp:inline', boxId)")
    && writer.includes("retag(chunk, 'a:srcRect', sr)") && writer.includes("retag(chunk, 'a:xfrm', xf)"))
  check('接线：环绕是整片换（不是追加第二枚同名元素）',
    /function retagWrap[\s\S]{0,220}\.replace\(\/<wp:wrapNone/.test(writer)
      && writer.includes('chunk = retagWrap(chunk, kv.wrapText)'))
  check('接线：环绕只在浮动图这一支做', /if \(kv\.anKind === 'anchor'\) \{[\s\S]{0,1400}kv\.wrapText/.test(writer))
  check('纪律：没有为这一族新开插元素通道', !/wp:sizeRelH|mc:AlternateContent/.test(writer))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
