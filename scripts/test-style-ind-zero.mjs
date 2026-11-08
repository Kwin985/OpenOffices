// v0.185 样式链显式零缩进断言。
//
// `w:ind/@w:left="0"` 不是「没有缩进」，是 Word 里**压掉上一层样式链继承**的声明。
// 读手 `styleList()` 里 `if (left) para.marginLeftPx = …` 把 0 当 falsy 吞掉，
// 写手对 Normal 内建样式根本不发 <w:ind>，于是往返账上 `ind|left` / `ind|right`
// 各挂一笔 value（源值 0 没写回）。
//
// 本轮：读手只认**这一枚样式自己 pPr 的属性表**（不沿 styleView 继承、不发新探针），
// 写手按 styleId 在 styles.xml 的 pPr 里按 CT_PPrBase 序补回那枚显式 0。
//
// 跑法：npx vite-node scripts/test-style-ind-zero.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, pageSetupOf, patchStyleIndZeros, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)
const base = await docxToDocMeta(srcBytes)
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pmDoc = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()

async function writeStyles(styles = fid.styles) {
  const merged = {
    ...base,
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
    ...(fid.section ? { page: { ...base.page, ...pageSetupOf(fid.section) } } : {}),
    styles,
  }
  const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged))
  return await out.file('word/styles.xml').async('string')
}
const normalOf = (xml) => /<w:style\b[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/.exec(xml)?.[0] ?? ''
const reportHeadOf = (xml) => /<w:style\b[^>]*w:styleId="ReportHead"[\s\S]*?<\/w:style>/.exec(xml)?.[0] ?? ''
const withNormal = (patch) => fid.styles.map((s) => (s.id === 'Normal' ? { ...s, para: { ...s.para, ...patch } } : s))

// ---- 1. 读手：只认本层自己写过的显式 0 ------------------------------------
{
  const normal = fid.styles.find((s) => s.id === 'Normal')
  const head = fid.styles.find((s) => s.id === 'ReportHead')
  check('读手：Normal 带两枚显式零标记', normal?.para?.indLeftZero === true && normal?.para?.indRightZero === true)
  eq('读手：屏上左缩进仍不设（0 不进模型）', normal?.para?.marginLeftPx, undefined)
  eq('读手：屏上右缩进仍不设', normal?.para?.marginRightPx, undefined)
  // ReportHead 是 basedOn Normal 的子样式，父层那枚 0 不能被摊到子层
  eq('读手：子样式不继承父层的显式 0（只认本层）', head?.para?.indLeftZero, undefined)
  eq('读手：子样式右缩进同理', head?.para?.indRightZero, undefined)
  eq('读手：子样式自己的 420 仍走屏上链', head?.para?.marginLeftPx !== undefined, true)
  const charStyle = fid.styles.find((s) => s.kind === 'character')
  eq('读手：字符样式不带显式零标记', charStyle?.para?.indLeftZero, undefined)
}

// ---- 2. 读手：无源值不凭空造 / 新式写法不误记 -----------------------------
async function fidFrom(parts) {
  const z = new JSZip()
  for (const [p, c] of parts) z.file(p, c)
  const b = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  return docxToHtmlFidelity(b)
}
{
  const parts = fixtureParts()
  const styles = parts.get('word/styles.xml') ?? ''
  parts.set('word/styles.xml', styles.replace('<w:ind w:left="0" w:right="0"/>', '<w:ind w:left="420" w:right="210"/>'))
  const f2 = await fidFrom(parts)
  const n2 = f2.styles.find((s) => s.id === 'Normal')
  eq('无显式 0 时 Normal 不带左标记', n2?.para?.indLeftZero, undefined)
  eq('无显式 0 时 Normal 不带右标记', n2?.para?.indRightZero, undefined)
  check('显式 420 仍走屏上链', n2?.para?.marginLeftPx !== undefined)
}
{
  const parts = fixtureParts()
  const styles = parts.get('word/styles.xml') ?? ''
  // w:start/w:end 是另一套写法，本轮只认 w:left/w:right 字面（账本上的对名不同）
  parts.set('word/styles.xml', styles.replace('<w:ind w:left="0" w:right="0"/>', '<w:ind w:start="0" w:end="0"/>'))
  const f3 = await fidFrom(parts)
  const n3 = f3.styles.find((s) => s.id === 'Normal')
  eq('新式 w:start="0" 不误记成 indLeftZero', n3?.para?.indLeftZero, undefined)
  eq('新式 w:end="0" 不误记成 indRightZero', n3?.para?.indRightZero, undefined)
}

// ---- 3. 写出包：两对 value → kept ------------------------------------------
const outXml = await writeStyles()
{
  const n = normalOf(outXml)
  const head = reportHeadOf(outXml)
  check('写手：Normal 的 pPr 出现显式零 w:ind', /<w:ind w:left="0" w:right="0"\/>/.test(n))
  eq('写手：Normal 的 pPr 只有一枚 w:ind', (n.match(/<w:ind\b/g) ?? []).length, 1)
  const iSpacing = n.indexOf('<w:spacing'), iInd = n.indexOf('<w:ind')
  check('写手：w:ind 按 CT_PPrBase 序排在 spacing 之后', iSpacing >= 0 && iInd > iSpacing)
  check('写手：ReportHead 仍是源值 420', /<w:ind w:left="420"\/>/.test(head))
  eq('写手：ReportHead 没被补上 0', /w:(left|right)="0"/.test(head), false)
  check('写手：写出包里源值 "0" 在场（ind|left / ind|right 修好）', /w:left="0"/.test(outXml) && /w:right="0"/.test(outXml))
}

// ---- 4. 变体：按 styleId 对位 / 两枚独立 / 不覆盖既有值 --------------------
{
  const onlyLeft = await writeStyles(withNormal({ indRightZero: false }))
  const n = normalOf(onlyLeft)
  check('变体：只留 left 时只补 w:left="0"', /<w:ind w:left="0"\/>/.test(n) && !/w:right="0"/.test(n))
}
{
  const onlyRight = await writeStyles(withNormal({ indLeftZero: false }))
  const n = normalOf(onlyRight)
  check('变体：只留 right 时只补 w:right="0"', /<w:ind w:right="0"\/>/.test(n) && !/w:left="0"/.test(n))
}
{
  const none = await writeStyles(withNormal({ indLeftZero: false, indRightZero: false }))
  eq('变体：无源值不凭空造 w:ind', /<w:ind\b/.test(normalOf(none)), false)
  check('变体：其余样式不受影响', /<w:ind w:left="420"\/>/.test(reportHeadOf(none)))
}
{
  // 模拟用户改过缩进：写手自己会为 Normal 发一枚带 w:left 的 w:ind，
  // 补丁只能补缺的那一枚属性，不能覆盖、更不能追加第二枚同名属性
  const changed = await writeStyles(withNormal({ marginLeftPx: 20 }))
  const n = normalOf(changed)
  check('变体：用户改过的 w:left 不被 0 覆盖', !/w:left="0"/.test(n) && /w:left="\d+"/.test(n))
  check('变体：仍补回右显式 0', /w:right="0"/.test(n))
  eq('变体：w:left 只出现一次（merge 不追加）', (n.match(/w:left=/g) ?? []).length, 1)
  eq('变体：整块只有一枚 w:ind', (n.match(/<w:ind\b/g) ?? []).length, 1)
}

// ---- 5. 纯函数边界 ---------------------------------------------------------
{
  const both = { left: true, right: true }
  const plain = (inner) => `<w:pPr>${inner}</w:pPr>`
  eq('纯函数：没有 pPr 就原样返回', patchStyleIndZeros('<w:style><w:name w:val="a"/></w:style>', both), '<w:style><w:name w:val="a"/></w:style>')
  eq('纯函数：两枚都不给就原样返回', patchStyleIndZeros(plain('<w:spacing/>'), {}), plain('<w:spacing/>'))
  const self = patchStyleIndZeros('<w:pPr/>', both)
  check('纯函数：自闭合 pPr 换成有内容形态', /<w:pPr><w:ind w:left="0" w:right="0"\/><\/w:pPr>/.test(self))
  const withJc = patchStyleIndZeros(plain('<w:jc w:val="center"/>'), both)
  check('纯函数：无 ind 时插在 jc 之前', withJc.indexOf('<w:ind') < withJc.indexOf('<w:jc'))
  const withRPr = patchStyleIndZeros(plain('<w:rPr><w:b/></w:rPr>'), both)
  check('纯函数：无 ind 时插在 rPr 之前', withRPr.indexOf('<w:ind') < withRPr.indexOf('<w:rPr'))
  const withSp = patchStyleIndZeros(plain('<w:spacing w:after="0"/>'), both)
  check('纯函数：只有 spacing 时追加在它之后', withSp.indexOf('<w:ind') > withSp.indexOf('<w:spacing'))
  const existing = patchStyleIndZeros(plain('<w:ind w:left="720"/>'), both)
  check('纯函数：已有 w:ind 只补缺属性', /<w:ind w:left="720" w:right="0"\/>/.test(existing))
  eq('纯函数：已有同名属性不追加第二枚', (existing.match(/w:left=/g) ?? []).length, 1)
  const already = plain('<w:ind w:left="0" w:right="0"/>')
  eq('纯函数：两枚已在场时整块原样', patchStyleIndZeros(already, both), already)
  const partial = patchStyleIndZeros(plain('<w:spacing/>'), { right: true })
  check('纯函数：只给 right 时只出 w:right', /<w:ind w:right="0"\/>/.test(partial) && !/w:left=/.test(partial))
}

// ---- 6. 源码级纪律 ---------------------------------------------------------
{
  const r = read('../src/lib/docx-fidelity.ts')
  const w = read('../src/lib/docx.ts')
  check('读手：归属判断用 info.pPr（不是继承后的 view.pPr）', /const ownInd = find\(info\.pPr, 'w:ind'\)/.test(r))
  check('读手：直接读属性表、不走 attr/attrL 漏斗', /\(a\['w:left'\] \?\? a\['left'\]\) === '0'/.test(r))
  check('写手：props 从 para 的两枚标记组装', /s\.para\?\.indLeftZero \|\| s\.para\?\.indRightZero/.test(w))
  check('写手：补丁挂在 patchStylesXml 的 styleId 回调里', /if \(p\.indZeros\) out = patchStyleIndZeros\(out, p\.indZeros\)/.test(w))
  check('写手：位次名单含 rPr/sectPr（CT_PPrBase 序）', /'rPr', 'sectPr', 'pPrChange'/.test(w))
  check('写手：已有同名属性走不覆盖过滤', /\.filter\(\(a\) => !new RegExp\(/.test(w))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
