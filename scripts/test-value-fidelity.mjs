// v0.184 两族「值变」修复断言：`color|val` 与 `lvlJc|val`。
//
// 这两对不是「掉了」，是**名字在、值不对**：
//   - color|val：源件 `FF0000` + 主题三枚并存，读手只把主题解析后的屏上色
//     `adbbd4` 放进了模型，字面色原值没存 → 写出包 w:val 成了解析色。
//   - lvlJc|val：读手把 `w:lvlJc` 存进 LvlDef 走屏上链，但 numbering.xml
//     补丁链的 DocxLvlMeta 没带这一枚，包恒发 start → 源件 center 被冲掉。
//
// 两族都**不新增 attr/attrL 查问**（复用已有 val()/attr() 的结果），
// 所以保真账的查问集合应该与 HEAD 逐字节相同。
//
// 跑法：npx vite-node scripts/test-value-fidelity.mjs

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

const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)
const base = await docxToDocMeta(srcBytes)
const merged = {
  ...base,
  ...(fid.numbering ? { numbering: fid.numbering } : {}),
  ...(fid.styles?.length ? { styles: fid.styles } : {}),
  ...(fid.section ? { page: { ...base.page, ...pageSetupOf(fid.section) } } : {}),
}
const schema = getSchema(docExtensions())

async function writeOut(pm) {
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const parsed = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
  const doc = pm ?? parsed
  const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(doc, merged))
  return {
    doc: await out.file('word/document.xml').async('string'),
    num: await out.file('word/numbering.xml').async('string'),
  }
}

// ---- 1. 读手载荷 ----------------------------------------------------------
{
  const raw = /data-ctheme="([^"]*)"/.exec(fid.html)?.[1] ?? ''
  const bits = raw.split(';')
  eq('读手：data-ctheme 扩成 5 格', bits.length, 5)
  eq('读手：主题 ref 原值', bits[0], 'accent1')
  eq('读手：字面字色原值（小写、不带 #）', bits[3], 'ff0000')
  eq('读手：导入屏上色基准', bits[4], 'adbbd4')
  const lvl0 = fid.numbering?.defs?.[0]?.levels?.['0']
  const lvl1 = fid.numbering?.defs?.[0]?.levels?.['1']
  eq('读手：lvlJc 升成带值载荷（ilvl=0）', lvl0?.lvlJc, 'left')
  eq('读手：lvlJc 升成带值载荷（ilvl=1，原值不归一）', lvl1?.lvlJc, 'center')
}

// ---- 2. 写出包：两族都回到源值 --------------------------------------------
const out = await writeOut()
{
  const colorTag = /<w:color\b[^>]*w:themeColor="accent1"[^>]*\/>/.exec(out.doc)?.[0] ?? ''
  eq('写手：w:color/@w:val 回到源件字面值', /\sw:val="([^"]*)"/.exec(colorTag)?.[1], 'ff0000')
  check('写手：主题三枚仍在（字面色与引用共存）',
    colorTag.includes('w:themeTint="99"') && colorTag.includes('w:themeShade="BF"'))
  eq('写手：w:val 只出现一次（merge 改值，不是追加）',
    (colorTag.match(/\sw:val=/g) ?? []).length, 1)
  check('写手：写出包里不再有解析色 adbbd4 当 w:val',
    !/<w:color\b[^>]*w:val="adbbd4"/.test(out.doc))

  // 包会发多枚 ilvl=0 的内置层，按块对位，别取全文第一枚
  const blocks = [...out.num.matchAll(/<w:lvl\b[^>]*>[\s\S]*?<\/w:lvl>/g)].map((m) => m[0])
  const vals = blocks.map((b) => /<w:lvlJc\b[^>]*w:val="([^"]*)"/.exec(b)?.[1]).filter(Boolean)
  check('写手：w:lvlJc center 回到源件那一层', vals.includes('center'))
  check('写手：w:lvlJc left 仍在（start≡left 归一口径）', vals.includes('left') || vals.includes('start'))
  eq('写手：带 center 的层只有一块', blocks.filter((b) => /<w:lvlJc\b[^>]*w:val="center"/.test(b)).length, 1)
}

// ---- 3. 陈旧守卫：用户改过色就不回填旧字面值 -------------------------------
{
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const parsed = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n.marks) && n.marks.some((m) => m.type === 'charExtra' && m.attrs?.ctheme)) {
      const ts = n.marks.find((m) => m.type === 'textStyle')
      if (ts?.attrs) ts.attrs.color = '#00ff00'
    }
    for (const k of n.content ?? []) walk(k)
  }
  walk(parsed)
  const changed = await writeOut(parsed)
  const colorTag = /<w:color\b[^>]*w:themeColor="accent1"[^>]*\/>/.exec(changed.doc)?.[0] ?? ''
  check('陈旧守卫：改过色后不回填源件 ff0000', !colorTag.includes('w:val="ff0000"'))
  check('陈旧守卫：改过色后写的是用户新色', colorTag.includes('w:val="00ff00"'))
}

// ---- 4. 源码纪律 ----------------------------------------------------------
{
  const r = read('../src/lib/docx-fidelity.ts')
  const w = read('../src/lib/docx.ts')
  check('读手：字面色复用既有 attr 查问，不新开漏斗',
    /const v = \(attr\(colorEl, 'w:val'\) \?\? ''\)\.toLowerCase\(\)/.test(r)
      && /o\.colorLit = v\.replace/.test(r))
  check('读手：lvlJc 复用既有 val 查问', /const lvlJcRaw = val\(l, 'w:lvlJc'\)/.test(r))
  check('写手：colorLits 走 mergeTagAttrs 同名改值（不追加）',
    /async function patchColorLits/.test(w) && /mergeTagAttrs\(m\[0\], add\)/.test(w)
      && !/patchElemAttrs\([^)]*'color'[^)]*colorLits/.test(w))
  check('写手：colorThemes / colorLits 同一次登记、共用闸门',
    /dt\?\.colorThemes\.push\(themeAttrs\(thc, tht, ths\)\)[\s\S]{0,320}dt\?\.colorLits\.push/.test(w))
  check('写手：lvlJc 是改值分支（包恒发该元素）',
    /if \(m\.lvlJc\) \{[\s\S]{0,240}inner\.replace\(\/\(<\[\\w:\]\*lvlJc/.test(w)
      || /if \(m\.lvlJc\) \{/.test(w) && /insertKid\(frag, \['pPr', 'rPr'\]\)/.test(w))
  check('写手：主链在 colorThemes 之后调用 patchColorLits',
    /const withColorLit = await patchColorLits\(withColor, dt\.colorLits, sess\)/.test(w))
}

// ---- 5. 无源值不凭空造 -----------------------------------------------------
{
  const parts = fixtureParts()
  const doc = parts.get('word/document.xml') ?? ''
  parts.set('word/document.xml', doc.replace(/<w:color w:val="FF0000"[^>]*\/>/, '<w:color w:val="112233"/>'))
  const num = parts.get('word/numbering.xml') ?? ''
  parts.set('word/numbering.xml', num.replace(/<w:lvlJc w:val="center"\/>/, ''))
  const z2 = new JSZip()
  for (const [p, c] of parts) z2.file(p, c)
  const b2 = new Uint8Array(await z2.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const f2 = await docxToHtmlFidelity(b2)
  const raw2 = /data-ctheme="([^"]*)"/.exec(f2.html)?.[1] ?? ''
  eq('无主题时载荷仍是 5 格但主题槽为空', raw2.split(';')[0], '')
  eq('无主题时字面字色原值照存', raw2.split(';')[3], '112233')
  check('无 lvlJc 源值时读手不带 center',
    !f2.numbering?.defs?.[0]?.levels?.['1']?.lvlJc)
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
