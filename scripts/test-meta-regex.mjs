// v0.196 断言：写手最后两处动态正则收干净（core.xml 五格 + sectPr 数值属性）。
//
// 与改前算法严格对撞：twipsAttrOf 按属性名找第一枚**纯数字**值（非数字不算
// 匹配、继续往后找），parseCoreProps 取第一枚匹配、内容为空就跳过这一格。
// 两腿由 docxToDocMeta 的 legacyMetaRegex 开关切换，产品路径恒为字符串定位。
//
// 跑法：npx vite-node scripts/test-meta-regex.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { fixtureParts } from './lib/fixture.mjs'
import {
  docxToDocMeta, legacyParseCoreProps, legacyTwipsAttrOf, parseCoreProps, twipsAttrOf,
} from '../src/lib/docx.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

async function main() {
  // ── ① twipsAttrOf 逐字对撞 ──────────────────────────────────────────
  const twCases = [
    ['<w:pgSz w:w="11906" w:h="16838"/>', 'w'],
    ['<w:pgSz w:w="11906" w:h="16838"/>', 'h'],
    ['<w:pgSz/>', 'w'],
    ['', 'w'],
    [undefined, 'w'],
    ['<w:pgSz w:w="0"/>', 'w'],
    ['<w:pgSz w:w="-5"/>', 'w'],
    ['<w:pgSz w:w="12pt"/>', 'w'],
    ['<w:pgSz w:w="abc" w:w="11906"/>', 'w'],
    ['<w:pgSz w:w=" 12 "/>', 'w'],
    ['<w:pgSz w:w="11906"/>junk<w:pgSz w:w="9999"/>', 'w'],
    ['<w:pgMar w:top="1440" w:top="2000"/>', 'top'],
  ]
  for (const [xml, attr] of twCases) {
    eq(`twipsAttrOf(${JSON.stringify(xml)}, ${attr}) 与改前一致`, twipsAttrOf(xml, attr), legacyTwipsAttrOf(xml, attr))
  }
  check('twipsAttrOf 换算成毫米', Math.abs((twipsAttrOf('<w:pgSz w:w="1440"/>', 'w') ?? 0) - 25.4) < 1e-9)

  // ── ② parseCoreProps 逐字对撞 ───────────────────────────────────────
  const coreCases = [
    '',
    '  ',
    '<cp:coreProperties><dc:title>标题</dc:title></cp:coreProperties>',
    '<cp:coreProperties><dc:title></dc:title><dc:creator>张三</dc:creator></cp:coreProperties>',
    '<dc:title xml:lang="zh">带属性的开标签</dc:title><dc:subject>主题</dc:subject>',
    '<dc:title>A &amp; B &lt;C&gt;</dc:title><cp:keywords>甲,乙</cp:keywords><dc:description>说明</dc:description>',
    '<dc:title>&#x4E2D;&#x6587;</dc:title>',
    '<dc:title>未闭合',
    '<dc:creator>   </dc:creator>',
    '<dc:title>第一个</dc:title><dc:title>第二个</dc:title>',
    '<dc:title/><dc:creator>作者</dc:creator>',
  ]
  for (const xml of coreCases) {
    eq(`parseCoreProps(${JSON.stringify(xml).slice(0, 60)}) 与改前一致`, parseCoreProps(xml), legacyParseCoreProps(xml))
  }
  eq('五格齐读', parseCoreProps(
    '<dc:title>T</dc:title><dc:subject>S</dc:subject><dc:creator>C</dc:creator>' +
    '<cp:keywords>K</cp:keywords><dc:description>D</dc:description>'),
  { title: 'T', subject: 'S', creator: 'C', keywords: 'K', description: 'D' })

  // ── ③ docxToDocMeta 两腿同源 ────────────────────────────────────────
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  // 夹具本身不带 docProps/core.xml，补一份才能真跑到 parseCoreProps 那条分支
  z.file('docProps/core.xml',
    '<cp:coreProperties><dc:title>标题 A &amp; B</dc:title><dc:subject>主题</dc:subject>' +
    '<dc:creator>张三</dc:creator><cp:keywords>甲,乙</cp:keywords><dc:description>说明</dc:description></cp:coreProperties>')
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const fast = await docxToDocMeta(bytes)
  const slow = await docxToDocMeta(bytes, undefined, { legacyMetaRegex: true })
  eq('两腿 DocMeta 逐字相同', JSON.stringify(fast), JSON.stringify(slow))
  check('夹具确实读到文档属性（非空夹具）', Object.keys(fast.docProps ?? {}).length > 0)
  check('夹具确实读到页面尺寸（非空夹具）', !!fast.page?.size || !!fast.page?.w)

  // ── ④ 源码级：产品路径零动态正则 ────────────────────────────────────
  const w = read('../src/lib/docx.ts')
  const bodyOf = (name) => {
    const at = w.indexOf(`export function ${name}(`)
    if (at < 0) return ''
    return w.slice(at, w.indexOf('\n}', at) + 2)
  }
  check('parseCoreProps 函数体没有 new RegExp', !/new RegExp/.test(bodyOf('parseCoreProps')))
  check('twipsAttrOf 函数体没有 new RegExp', !/new RegExp/.test(bodyOf('twipsAttrOf')))
  check('对照腿保留在产品代码里（供同进程 A/B）', /export function legacyParseCoreProps\(/.test(w) && /export function legacyTwipsAttrOf\(/.test(w))
  check('开关只影响 docxToDocMeta 的两处解析', (w.match(/opts\?\.legacyMetaRegex/g) ?? []).length === 2)
  check('入口第 3 个可选参数接开关', /opts\?: \{ legacyMetaRegex\?: boolean \}/.test(w))
  check('不改读手（docx-fidelity.ts 不在本轮改动面）', /export function parseCoreProps\(xml: string\)/.test(w))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
