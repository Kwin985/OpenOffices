// v0.229 守卫：docx 读手把 OMML 发成可编辑公式节点（不再是线性文本）。
// 跑法：npx vite-node scripts/test-formula-read.mjs

import JSZip from 'jszip'

const { DOMParser } = await import('@xmldom/xmldom')
const probe = new DOMParser().parseFromString('<r><a/></r>', 'text/xml')
Object.defineProperty(Object.getPrototypeOf(probe.documentElement), 'children', {
  configurable: true,
  get() {
    const out = []
    const ns = this.childNodes
    for (let i = 0; i < (ns?.length ?? 0); i++) if (ns[i].nodeType === 1) out.push(ns[i])
    return out
  },
})
globalThis.DOMParser = DOMParser

const { docxToHtmlFidelity } = await import('../src/lib/docx-fidelity.ts')
const { docExtensions } = await import('../src/lib/doc-schema.ts')
const { getSchema } = await import('@tiptap/core')
const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
const { parseHTML } = await import('linkedom')

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (cond || !extra ? '' : ` — ${extra}`))

const schema = getSchema(docExtensions())
check('schema 有 formula 节点', !!schema.nodes.formula)

async function docWith(body) {
  const z = new JSZip()
  const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
  z.file('word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="${NS}" xmlns:m="${M}"><w:body><w:p>${body}</w:p></w:body></w:document>`)
  z.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="${NS}"/>`)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}

const frac = await docWith('<m:oMath><m:f><m:num><m:t>1</m:t></m:num><m:den><m:t>2</m:t></m:den></m:f></m:oMath>')
const r = await docxToHtmlFidelity(frac)
check('读：分式发 data-oo-formula', r.html.includes('data-oo-formula="\\frac{1}{2}"'), r.html.slice(0, 300))
check('读：不再发旧的「线性化」告警', !r.warnings.some((w) => w.includes('线性化')), JSON.stringify(r.warnings))

// HTML → PM 模型，属性要能被节点接住
const pm = PMDOMParser.fromSchema(schema).parse(parseHTML(`<html><body>${r.html}</body></html>`).document.body).toJSON()
const walk = (n) => (n.content ?? []).flatMap((c) => (c.type === 'formula' ? [c] : walk(c)))
const formulas = walk(pm)
check('模型：公式节点接住 LaTeX', formulas.length === 1 && formulas[0].attrs.latex === '\\frac{1}{2}', JSON.stringify(formulas))

// 复杂式子
const complex = await docWith('<m:oMath><m:rad><m:deg><m:t>3</m:t></m:deg><m:e><m:t>x+1</m:t></m:e></m:rad></m:oMath>')
const rc = await docxToHtmlFidelity(complex)
check('读：带次根号保结构', rc.html.includes('data-oo-formula="\\sqrt[3]{x+1}"'), rc.html.slice(0, 300))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n公式读手：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
