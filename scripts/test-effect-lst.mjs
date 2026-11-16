// v0.181 a:effectLst 效果整片往返断言。
//
// 与 v0.180 的区别：那一轮在**已有父壳 `<a:ln>` 内部**按 CT_LineProperties 序插
// 子元素；这一轮要新建**整片** `<a:effectLst>`，且它是 `a:ln` 的**兄弟**（按
// CT_ShapeProperties 排在 a:ln 之后、scene3d/sp3d/extLst 之前）。两处位次不同，
// 锚点表不能共用——这是 D40 明确写下的纪律。
//
// 切片：只做 outerShdw(5) / glow(1) / reflection(13) 三枚自闭合效果元素 = 19 对。
// 不做 scene3d/sp3d/props3d：夹具把它们塞进 effectLst 内部，按 schema 非法；
// 也不在 glow 里写 `<a:schemeClr>`，否则 schemeClr|val 会从 lost 变 value。
//
// 走完整链路：夹具 docx → 读手 HTML（data-img）→ TipTap schema → PM → 写手
// → 解包逐块对撞。跑法：npx vite-node scripts/test-effect-lst.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'
import { EFFECT_ATTRS, effectKey, parseImgPayload } from '../src/lib/cell-style.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 清单单一事实源 ---------------------------------------------------
{
  eq('效果族三枚、属性共 19 枚', EFFECT_ATTRS.reduce((n, x) => n + x.attrs.length, 0), 19)
  eq('标签顺序', EFFECT_ATTRS.map((x) => x.tag).join(','), 'outerShdw,glow,reflection')
  eq('键名规则', effectKey('rf', 'endPos'), 'rfEndPos')
  eq('键名规则（首字母大写不影响余下 camelCase）', effectKey('os', 'blurRad'), 'osBlurRad')
  const reader = read('../src/lib/docx-fidelity.ts')
  const writer = read('../src/lib/docx.ts')
  check('读手引用共享清单（不自己抄一份）', /EFFECT_ATTRS/.test(reader) && /effectKey\(prefix, n\)/.test(reader))
  check('写手引用共享清单', /EFFECT_ATTRS/.test(writer) && /effectKey\(prefix, n\)/.test(writer))
  check('读手新读点走 attrL 单漏斗',
    /const v = attrL\(el, n\)/.test(reader.slice(reader.indexOf('for (const { prefix, tag, attrs } of EFFECT_ATTRS'), reader.indexOf('for (const { prefix, tag, attrs } of EFFECT_ATTRS') + 500)))
}

// ---- 2. 源件 → 读手载荷 ---------------------------------------------------
const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)
const shells = [...fid.html.matchAll(/<img[^>]*data-img="([^"]*)"/g)].map((m) => m[1]).map(parseImgPayload)
const fx = shells.find((k) => k.osAlgn !== undefined)

{
  check('读手：效果载荷落在带 a:effectLst 的那一块', !!fx)
  const want = {}
  for (const { prefix, attrs } of EFFECT_ATTRS) for (const n of attrs) want[effectKey(prefix, n)] = true
  eq('读手：19 枚键全在载荷里', Object.keys(want).filter((k) => fx?.[k] !== undefined).length, 19)
  eq('outerShdw 五枚原值', ['osAlgn', 'osBlurRad', 'osDir', 'osDist', 'osRotWithShape'].map((k) => fx?.[k]).join(','), 'tl,63500,5400000,38100,0')
  eq('glow 半径', fx?.glRad, '63500')
  eq('reflection 十三枚首尾', [fx?.rfAlgn, fx?.rfBlurRad, fx?.rfSx, fx?.rfSy].join(','), 'bl,6350,100000,100000')
}

// ---- 3. 写手 → 写出包 ----------------------------------------------------
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pm = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
const outBytes = await prosemirrorToDocxBytes(pm, await docxToDocMeta(srcBytes))
const outXml = await (await JSZip.loadAsync(outBytes)).file('word/document.xml').async('string')

{
  const lists = [...outXml.matchAll(/<a:effectLst\b[\s\S]*?<\/a:effectLst>/g)].map((m) => m[0])
  eq('写手：effectLst 只插一片（幂等）', lists.length, 1)
  const frag = lists[0] ?? ''
  // 排除整片自己的开标签（<a:effectLst> 不是子元素）
  const tags = [...frag.matchAll(/<a:([A-Za-z]+)\b/g)].map((m) => m[1]).filter((t) => t !== 'effectLst')
  eq('写手：子元素顺序 outerShdw → glow → reflection', tags.join(' > '), 'outerShdw > glow > reflection')
  eq('写手：outerShdw 原值', /<a:outerShdw\b[^>]*\/>/.exec(frag)?.[0], '<a:outerShdw algn="tl" blurRad="63500" dir="5400000" dist="38100" rotWithShape="0"/>')
  eq('写手：glow 自闭合（不带 schemeClr，避免 value 桶）', /<a:glow\b[^>]*\/>/.exec(frag)?.[0], '<a:glow rad="63500"/>')
  eq('写手：reflection 十三枚原值', /<a:reflection\b[^>]*\/>/.exec(frag)?.[0],
    '<a:reflection algn="bl" blurRad="6350" dir="5400000" dist="0" endA="1000" endPos="10000" fadeDir="5400000" kx="0" ky="0" stA="0" stPos="0" sx="100000" sy="100000"/>')
  // 位次：effectLst 必须是 a:ln 的兄弟、在它之后
  const spPr = [...outXml.matchAll(/<pic:spPr\b[^>]*>[\s\S]*?<\/pic:spPr>/g)].map((m) => m[0]).find((b) => b.includes('<a:effectLst')) ?? ''
  const lnEnd = spPr.indexOf('</a:ln>')
  const fxStart = spPr.indexOf('<a:effectLst')
  check('写手：effectLst 在 </a:ln> 之后（兄弟，不是子元素）', lnEnd >= 0 && fxStart > lnEnd)
  eq('写手：effectLst 在 </pic:spPr> 之前', fxStart < spPr.lastIndexOf('</pic:spPr>'), true)
  check('写手：没有复刻三维族（结构非法）', !/<a:(scene3d|sp3d|props3d)\b/.test(outXml))
}

// ---- 4. 纪律（源码级）----------------------------------------------------
{
  const writer = read('../src/lib/docx.ts')
  const reader = read('../src/lib/docx-fidelity.ts')
  const seg = writer.slice(writer.indexOf('v0.181：a:effectLst 整片'), writer.indexOf('v0.181：a:effectLst 整片') + 2200)
  check('写手：另起一张锚点表（找排在 effectLst 之后的兄弟）',
    /a:scene3d', 'a:sp3d', 'a:extLst', 'a:spLocks'/.test(seg))
  check('写手：退化到 </pic:spPr> 之前', /lastIndexOf\('<\/pic:spPr>'\)/.test(seg))
  check('写手：带幂等守卫（已有整片改为改属性）', /box\.includes\('<a:effectLst'\)/.test(seg))
  check('写手：用 tagWithAttrs 生成自闭合子元素', /tagWithAttrs\(`<a:\$\{tag\}\/>`, a\)/.test(seg))
  check('纪律：没有碰 wp:anchor 锚点表 / mc:AlternateContent / wp14',
    !/mc:AlternateContent|wp14:sizeRel/.test(seg))
  check('查问清单同源：DRAWING_SHELL_ATTRS 仍含三族',
    /outerShdw: \['algn', 'blurRad', 'dir', 'dist', 'rotWithShape'\]/.test(reader)
      && /glow: \['rad'\]/.test(reader) && /reflection: \[/.test(reader))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
