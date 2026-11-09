// v0.180 线端族往返断言：第一次为「包连构造器都没有」的子元素建插入通道。
//
// 形状：CT_LineProperties（<a:ln>）的四枚子元素 prstDash / miter / headEnd /
// tailEnd 既不是属性、也不是包发得出的壳——v0.179 的 outline 槽只让 <a:ln> 这枚
// 父壳发得出来。本轮在 post-pack 的单个 w:drawing 块内，按 schema 序把它们插在
// `</a:ln>` 之前（fill → prstDash → miter → headEnd → tailEnd）。
//
// 不碰的三件事：wp:anchor 锚点表、mc:AlternateContent / wp14 扩展、a:effectLst
// 那一整片（19 对，下一族的事）。零新模型槽、零新漏斗。
//
// 走完整链路：夹具 docx → 读手 HTML（data-img）→ TipTap schema → PM → 写手
// → 解包逐块对撞。跑法：npx vite-node scripts/test-line-ends.mjs

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
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 源件 → 读手载荷 ---------------------------------------------------
const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)
const shells = [...fid.html.matchAll(/<img[^>]*data-img="([^"]*)"/g)].map((m) => m[1]).map(parseImgPayload)

const ends = shells.find((k) => k.heType !== undefined)
const mit = shells.find((k) => k.miterLim !== undefined)
check('读手：线端族载荷落在带 a:headEnd 的那一块', !!ends)
check('读手：miter 载荷落在另一块（按块对位，不混）', !!mit && mit !== ends)
eq('读手：prstDash/@val', ends?.dashVal, 'dash')
eq('读手：headEnd 三枚', [ends?.heType, ends?.heW, ends?.heLen].join(','), 'triangle,med,sm')
eq('读手：tailEnd 三枚', [ends?.teType, ends?.teW, ends?.teLen].join(','), 'arrow,lg,lg')
eq('读手：miter/@lim', mit?.miterLim, '800000')
check('读手：六枚新键都过了载荷合法性（无 ; / =）',
  ['dashVal', 'heType', 'heW', 'heLen', 'teType', 'teW', 'teLen'].every((k) => ends?.[k] !== undefined))

// ---- 2. 写手 → 写出包逐块对撞 --------------------------------------------
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pm = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
const meta = await docxToDocMeta(srcBytes)
const outBytes = await prosemirrorToDocxBytes(pm, meta)
const outXml = await (await JSZip.loadAsync(outBytes)).file('word/document.xml').async('string')
const boxes = [...outXml.matchAll(/<a:ln\b[^>]*\/>|<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/g)].map((m) => m[0])

eq('写手：a:ln 块数（夹具两处带线宽的图）', boxes.length, 2)
const withEnds = boxes.find((b) => b.includes('<a:headEnd'))
const withMit = boxes.find((b) => b.includes('<a:miter'))
check('写手：线端插在带载荷的那一块', !!withEnds)
check('写手：miter 插在另一块', !!withMit && withMit !== withEnds)

const order = (b) => [...b.matchAll(/<a:(noFill|prstDash|miter|headEnd|tailEnd)\b/g)].map((m) => m[1])
eq('写手：CT_LineProperties 子元素序（fill → dash → head → tail）',
  order(withEnds ?? '').join(' > '), 'noFill > prstDash > headEnd > tailEnd')
eq('写手：另一块序（fill → miter）', order(withMit ?? '').join(' > '), 'noFill > miter')

const tagOf = (t) => [...outXml.matchAll(new RegExp(`<a:${t}\\b[^>]*>`, 'g'))].map((m) => m[0])
eq('写手：prstDash 原值', tagOf('prstDash')[0], '<a:prstDash val="dash"/>')
eq('写手：headEnd 原值', tagOf('headEnd')[0], '<a:headEnd type="triangle" w="med" len="sm"/>')
eq('写手：tailEnd 原值', tagOf('tailEnd')[0], '<a:tailEnd type="arrow" w="lg" len="lg"/>')
eq('写手：miter 原值', tagOf('miter')[0], '<a:miter lim="800000"/>')
for (const t of ['prstDash', 'miter', 'headEnd', 'tailEnd'])
  eq(`写手：${t} 只插一枚（幂等）`, tagOf(t).length, 1)
check('写手：包发的 a:noFill 没被顶掉', (outXml.match(/<a:noFill\s*\/>/g) ?? []).length >= 2)

// ---- 3. 纪律（源码级）----------------------------------------------------
{
  const reader = read('../src/lib/docx-fidelity.ts')
  const writer = read('../src/lib/docx.ts')
  const lineSeg = reader.slice(reader.indexOf("for (const [prefix, tag] of [['he', 'headEnd']"), reader.indexOf("for (const [prefix, tag] of [['he', 'headEnd']") + 900)
  check('读手：新读点走 attrL 单漏斗', /attrL\(end, n\)/.test(lineSeg) && !/attrNum\(/.test(lineSeg))
  check('读手：DRAWING_SHELL_ATTRS 同源清单仍在',
    /headEnd: \['type', 'w', 'len'\]/.test(reader) && /tailEnd: \['type', 'w', 'len'\]/.test(reader)
      && /prstDash: \['val'\]/.test(reader))
  check('写手：用 tagWithAttrs 生成自闭合子元素（不手搓属性串）',
    /lineKids\.map\(\(\[tag, a\]\) => tagWithAttrs\(`<a:\$\{tag\}\/>`, a\)\)/.test(writer))
  check('写手：带幂等守卫（已有同名元素则改属性而非再插）',
    /lineKids\.some\(\(\[tag\]\) => box\.includes\(`<a:\$\{tag\}`\)\)/.test(writer)
      && /retag\(chunk, `a:\$\{tag\}`, a\)/.test(writer))
  check('写手：自闭合与有内容两态都处理',
    /box\.endsWith\('\/>'\)/.test(writer) && /lastIndexOf\('<\/a:ln>'\)/.test(writer))
  check('纪律：没碰 wp:anchor 锚点表 / mc:AlternateContent / wp14',
    !/mc:AlternateContent|wp14:sizeRel/.test(writer.slice(writer.indexOf('async function patchImgXml'), writer.indexOf('async function patchImgXml') + 9000)))
  // v0.188：blocks 数组改成惰性迭代器，分块对位与计数闸门的纪律不变
  check('纪律：插入只在单个 w:drawing 块内（沿用分块对位）',
    /const DRAWING_RE = \/<w:drawing>/.test(writer)
      && /xml\.matchAll\(DRAWING_RE\)/.test(writer)
      && /if \(i !== shells\.length\) return bytes/.test(writer))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
