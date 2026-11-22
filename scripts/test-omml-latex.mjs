// v0.229 守卫：OMML ↔ LaTeX 双向转换（docx 公式可编辑的地基）。
//
// 覆盖 OMML 标准构件：分式/根号/上下标/上下限/定界符/大运算符/函数/矩阵/符号。
// 落点是 ooxml-graphics.ts（与 SmartArt/图表同属「正文里的非文字构件」），
// 不新增 src/lib 文件 ⇒ 四份账本 modules provenance 零改。
//
// 跑法：npx vite-node scripts/test-omml-latex.mjs

import { ommlToLatex, latexToOmml } from '../src/lib/ooxml-graphics.ts'
import { parseXml, textOf } from '../src/lib/ooxml.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (cond || !extra ? '' : ` — ${extra}`))

// 用产品自己的 parseXml 造 OMML（与读手同一套 XEl 结构）
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const xml = (body) => parseXml(`<m:oMath xmlns:m="${M}">${body}</m:oMath>`).children.find((c) => typeof c !== 'string')

// ── OMML → LaTeX ──
const cases = [
  ['分式', '<m:f><m:num><m:t>1</m:t></m:num><m:den><m:t>2</m:t></m:den></m:f>', '\\frac{1}{2}'],
  ['上标', '<m:sSup><m:e><m:t>x</m:t></m:e><m:sup><m:t>2</m:t></m:sup></m:sSup>', 'x^{2}'],
  ['上下标齐', '<m:sSubSup><m:e><m:t>x</m:t></m:e><m:sub><m:t>i</m:t></m:sub><m:sup><m:t>2</m:t></m:sup></m:sSubSup>', 'x_{i}^{2}'],
  ['根号', '<m:rad><m:e><m:t>x</m:t></m:e></m:rad>', '\\sqrt{x}'],
  ['开方次数', '<m:rad><m:deg><m:t>3</m:t></m:deg><m:e><m:t>x</m:t></m:e></m:rad>', '\\sqrt[3]{x}'],
  ['定界符', '<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:t>a</m:t></m:e></m:d>', '[a]'],
  ['求和', '<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub><m:t>i=1</m:t></m:sub><m:sup><m:t>n</m:t></m:sup><m:e><m:t>a</m:t></m:e></m:nary>', '\\sum_{i=1}^{n} a'],
  ['函数', '<m:func><m:fName><m:t>sin</m:t></m:fName><m:e><m:t>x</m:t></m:e></m:func>', 'sin(x)'],
  ['下限', '<m:limLow><m:e><m:t>lim</m:t></m:e><m:lim><m:t>x→0</m:t></m:lim></m:limLow>', 'lim_{x→0}'],
  ['多字符文本', '<m:r><m:rPr/><m:t>a+b</m:t></m:r>', 'a+b'],
]
for (const [name, body, want] of cases) {
  const got = ommlToLatex(xml(body))
  check(`读：${name} → ${want}`, got === want, `得到 ${JSON.stringify(got)}`)
}

// ── LaTeX → OMML → LaTeX roundtrip ──
const rt = [
  '\\frac{1}{2}',
  '\\sqrt{x+1}',
  '\\sqrt[3]{x}',
  'x^{2}',
  'a_{i}',
  '\\sum_{i=1}^{n} \\frac{1}{i}',
  '\\int_0^1 f(x)',
  '\\left( a+b \\right)',
  '\\alpha + \\beta',
  '\\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}',
]
// 往返不要求逐字相等：OMML 不存 LaTeX 的空格、希腊字母与定界符会归一化成等价形状。
// 判语义等价 = 去空格 + 常见同义写法归一；结构本身另在下面做严格断言。
const canon = (s) => s
  .replace(/\s+/g, '')
  .replace(/\\left|\\right/g, '')
  .replace(/\{([^{}])\}/g, '$1')
  .replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β')
  .replace(/\\pm/g, '±')
for (const tex of rt) {
  let back = ''
  try { back = ommlToLatex(latexToOmml(tex)) } catch (e) { back = `THROW: ${e.message}` }
  check(`往返：${tex}`, canon(back) === canon(tex), `得到 ${JSON.stringify(back)}`)
}

// ── 结构合法性（不是只看字符串） ──
const frac = latexToOmml('\\frac{1}{2}')
check('分式有 m:num / m:den 两层包装', frac.name === 'm:f' && frac.children.length === 2 &&
  frac.children[0]?.name === 'm:num' && frac.children[1]?.name === 'm:den', JSON.stringify(frac))
const sup = latexToOmml('x^{2}')
check('上标有 m:e / m:sup 两层包装', sup.name === 'm:sSup' && sup.children.some((c) => c?.name === 'm:e') &&
  sup.children.some((c) => c?.name === 'm:sup'), JSON.stringify(sup))
const nary = latexToOmml('\\sum_{i=1}^{n} a')
check('大运算符有 m:naryPr/m:chr@m:val', nary.name === 'm:nary' &&
  nary.children[0]?.name === 'm:naryPr' && nary.children[0].children[0]?.attrs['m:val'] === '∑', JSON.stringify(nary))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nOMML ↔ LaTeX：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
