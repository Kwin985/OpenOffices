// v0.233 守卫：docx 水印读写闭环（header 里的 VML 形状）。
// 跑法：npx vite-node scripts/test-watermark.mjs

import JSZip from 'jszip'

const {
  watermarkVmlRun,
  watermarkFromHeaderXml,
  prosemirrorToDocxBytes,
  docxToDocMeta,
} = await import('../src/lib/docx.ts')
const { docExtensions } = await import('../src/lib/doc-schema.ts')
const { getSchema } = await import('@tiptap/core')
const { DOMParser } = await import('@tiptap/pm/model')
const { parseHTML } = await import('linkedom')

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

// 生成的 VML 形状要带 Word 认的那几样：shapetype、textpath@string、半透明、斜角、居中
const vml = watermarkVmlRun('机密')
check('有 shapetype 与 textpath', vml.includes('_x0000_t136') && vml.includes('<v:textpath'))
check('水印文字进 string 属性', vml.includes('string="机密"'))
check('斜角 + 半透明 + 居中', vml.includes('rotation:315') && vml.includes('opacity=".5"') && vml.includes('mso-position-horizontal:center'))
check('无水印时不发形状', typeof watermarkVmlRun === 'function' && !watermarkFromHeaderXml(''))

// 解析：从 VML 形状拿回文字，含 XML 实体
check('解析水印文字', watermarkFromHeaderXml(vml) === '机密', watermarkFromHeaderXml(vml))
check('解析 XML 实体', watermarkFromHeaderXml('<v:textpath string="A&amp;B&lt;C"/>') === 'A&B<C')
check('没 v:textpath 返回空', watermarkFromHeaderXml('<w:p/>') === '')

// 写手 → 读手闭环
const schema = getSchema(docExtensions())
const pm = DOMParser.fromSchema(schema).parse(parseHTML('<html><body><p>正文</p></body></html>').document.body).toJSON()
const bytes = await prosemirrorToDocxBytes(pm, { watermark: '草稿' })
const zip = await JSZip.loadAsync(bytes)
const headerNames = Object.keys(zip.files).filter((n) => /^word\/header\d+\.xml$/.test(n))
check('写手发了 header 部件（只水印、无 headerText）', headerNames.length > 0, headerNames.join())
const hxml = headerNames.length ? await zip.file(headerNames[0]).async('string') : ''
check('header 里有水印 VML', hxml.includes('string="草稿"'), hxml.slice(0, 300))
check('header 根带 v/o 命名空间', hxml.includes('xmlns:v=') && hxml.includes('xmlns:o='), hxml.slice(0, 200))

const meta = await docxToDocMeta(bytes)
check('读手拿回水印', meta.watermark === '草稿', JSON.stringify(meta.watermark))

// 与 headerText 共存
const bytes2 = await prosemirrorToDocxBytes(pm, { watermark: '机密', headerText: '页眉文字' })
const zip2 = await JSZip.loadAsync(bytes2)
const h2 = await zip2.file('word/header1.xml').async('string')
check('水印与页眉文字共存', h2.includes('string="机密"') && h2.includes('页眉文字'), h2.slice(0, 400))
const meta2 = await docxToDocMeta(bytes2)
check('共存时两者都读回', meta2.watermark === '机密' && meta2.headerText === '页眉文字', JSON.stringify(meta2))

// 无水印时零动作
const plain = await prosemirrorToDocxBytes(pm)
const zp = await JSZip.loadAsync(plain)
check('无水印不发 header', !Object.keys(zp.files).some((n) => /^word\/header\d+\.xml$/.test(n)))


// UI 接线：属性面板可改水印（DocMeta 整体 JSON 存 .odoc，无需额外通道）
const fs = await import('node:fs')
const ui = fs.readFileSync(new URL('../src/components/DocEditor.tsx', import.meta.url), 'utf8')
check('属性面板有水印输入', ui.includes('patchMeta({ watermark: e.target.value || undefined })'))
check('水印提示写明 VML 与双向', ui.includes('VML') && ui.includes('Word/WPS'))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n水印读写：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
