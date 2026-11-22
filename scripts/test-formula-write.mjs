// v0.229 守卫：公式 LaTeX → OMML 经写手回写 docx。
// 跑法：npx vite-node scripts/test-formula-write.mjs

import JSZip from 'jszip'

const { prosemirrorToDocxBytes } = await import('../src/lib/docx.ts')
const { docExtensions } = await import('../src/lib/doc-schema.ts')
const { getSchema } = await import('@tiptap/core')
const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
const { parseHTML } = await import('linkedom')

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (cond || !extra ? '' : ` — ${extra}`))

const schema = getSchema(docExtensions())
const toPm = (html) => {
  const { document } = parseHTML(`<html><body>${html}</body></html>`)
  return PMDOMParser.fromSchema(schema).parse(document.body).toJSON()
}

async function written(html) {
  const bytes = await prosemirrorToDocxBytes(toPm(html))
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  return xml
}

const fracXml = await written('<p>前<span data-oo-formula="\\frac{1}{2}"></span>后</p>')
check('写：分式落成 m:oMath', fracXml.includes('<m:oMath') || fracXml.includes('<m:oMathPara'), fracXml.slice(0, 400))
check('写：有 m:f / m:num / m:den 结构', fracXml.includes('<m:f>') && fracXml.includes('<m:num>') && fracXml.includes('<m:den>'), fracXml.slice(0, 500))
check('写：占位串不残留', !fracXml.includes('OOFORMULA'), fracXml.slice(0, 400))
check('写：前后正文还在', fracXml.includes('前') && fracXml.includes('后'), fracXml.slice(0, 400))

const radXml = await written('<p><span data-oo-formula="\\sqrt[3]{x+1}"></span></p>')
check('写：带次根号结构完整', radXml.includes('<m:rad>') && radXml.includes('<m:deg>') && radXml.includes('<m:e>'), radXml.slice(0, 500))

const sumXml = await written('<p><span data-oo-formula="\\sum_{i=1}^{n} \\frac{1}{i}"></span></p>')
check('写：大运算符 + 分式嵌套', sumXml.includes('<m:nary>') && sumXml.includes('<m:chr') && sumXml.includes('<m:f>'), sumXml.slice(0, 500))

// 多个公式按序认领，不串行
const multiXml = await written('<p><span data-oo-formula="x^{2}"></span>与<span data-oo-formula="a_{i}"></span></p>')
check('写：两枚公式各自成形', (multiXml.match(/<m:oMath/g) ?? []).length === 2 && multiXml.includes('<m:sSup>') && multiXml.includes('<m:sSub>'), multiXml.slice(0, 600))

// 没有公式时补丁零动作
const plainXml = await written('<p>普通正文</p>')
check('反例：无公式时不发 m:oMath', !plainXml.includes('m:oMath'), plainXml.slice(0, 300))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n公式写手：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
