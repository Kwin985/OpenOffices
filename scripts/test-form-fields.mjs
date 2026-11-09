// v0.189 断言：Word 表单域整片字面往返。
//
// 源件一个表单域是五枚连续 run：begin(带 ffData) / instrText / separate /
// 结果文字 / end。读手展平成结果文字，模型与 docx 包都没有表单域的槽；
// 写手侧从源包按字面整片搬回（正则读的部件不进保真账，读手早查问过
// fldChar 与 ffData 全族，零新增查问对）。
//
// 跑法：npx vite-node scripts/test-form-fields.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  docxToDocMeta, formFieldsOf, pageSetupOf, patchFormFields, prosemirrorToDocxBytes,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

async function zipBytes(parts) {
  const z = new JSZip()
  for (const [p, c] of parts) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const tags = (s, re) => [...s.matchAll(re)].map((m) => m[0])

const FF = (text, extra = '') =>
  `<w:p><w:r><w:fldChar w:fldCharType="begin" w:fldLock="1"><w:ffData>` +
  `<w:name w:val="Text1"/>${extra}</w:ffData></w:fldChar></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:t>${text}</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`

async function main() {
  const parts = fixtureParts()
  const bytes = await zipBytes(parts)
  const srcDoc = parts.get('word/document.xml') ?? ''

  // ── ① 纯函数：提取边界 ──────────────────────────────────────────────
  const got = formFieldsOf(srcDoc)
  eq('夹具里正好一个表单域', got.length, 1)
  const f = got[0]
  eq('结果文字', f.text, '表单里的字')
  check('before 含 begin/ffData/instrText/separate 三枚 run',
    /fldCharType="begin"/.test(f.before) && f.before.includes('<w:ffData>')
      && f.before.includes('<w:instrText') && /fldCharType="separate"/.test(f.before))
  check('after 是 end 那一枚 run', /<w:r><w:fldChar[^>]*fldCharType="end"[^>]*\/><\/w:r>/.test(f.after))
  check('before 不含结果文字的 run', !f.before.includes('表单里的字'))
  check('after 不含结果文字的 run', !f.after.includes('表单里的字'))
  eq('没有 ffData 的段落不产域', formFieldsOf('<w:p><w:r><w:t>普通段落</w:t></w:r></w:p>').length, 0)
  eq('缺 separate 的半截域跳过', formFieldsOf(srcDoc.replace(/<w:fldChar w:fldCharType="separate"\/>/, '')).length, 0)
  eq('缺 end 的半截域跳过', formFieldsOf(srcDoc.replace(/<w:fldChar w:fldCharType="end"\/>/, '')).length, 0)
  eq('空串输入不炸', formFieldsOf('').length, 0)
  const two = formFieldsOf(`<w:p>前</w:p>${FF('甲')}${FF('乙')}<w:p>后</w:p>`)
  eq('两个域按出现序分别提取', two.length, 2)
  eq('第一个域的结果文字', two[0]?.text, '甲')
  eq('第二个域的结果文字', two[1]?.text, '乙')
  check('不跨段吞 run（before 不含上一个段落）', !two[0].before.includes('<w:p>前'))
  check('不跨段吞 run（after 不含下一个段落）', !two[1].after.includes('<w:p>后'))
  const attrRun = formFieldsOf(FF('丙').replace(/<w:r>/g, '<w:r w:rsidR="A1">'))
  eq('带属性的 run 也能提取', attrRun.length, 1)
  eq('带属性时结果文字不丢', attrRun[0]?.text, '丙')
  check('ffData 里的属性原样留在 before', formFieldsOf(FF('丁', '<w:appearance w:val="normal"/>'))[0].before.includes('w:appearance'))

  // ── ② 端到端：写出包的五枚 run ─────────────────────────────────────
  const fid = await docxToHtmlFidelity(bytes)
  const meta = await docxToDocMeta(bytes)
  eq('meta 带 formFields', meta.formFields?.length, 1)
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
    ...(fid.background ? { background: fid.background } : {}),
    ...(fid.comments.length ? { comments: fid.comments } : {}),
  }
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()
  const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged))
  const outDoc = await out.file('word/document.xml').async('string')
  const outFlds = tags(outDoc, /<w:fldChar\b[^>]*>/g)
  eq('写出包三枚 fldChar 全回来', outFlds.length, 3)
  check('三态 begin/separate/end 齐全',
    outFlds.some((t) => t.includes('begin')) && outFlds.some((t) => t.includes('separate')) && outFlds.some((t) => t.includes('end')))
  check('域锁 w:fldLock 回来', outDoc.includes('w:fldLock="1"'))
  check('ffData 整片回来（名字/外观/默认值/上限）',
    outDoc.includes('<w:name w:val="Text1"/>') && outDoc.includes('<w:appearance w:val="normal"/>')
      && outDoc.includes('<w:default w:val="默认"/>') && outDoc.includes('<w:maxLength w:val="10"/>'))
  check('域代码 instrText 回来', outDoc.includes(' FORMTEXT '))
  const outPara = (() => {
    const i = outDoc.indexOf('表单里的字')
    return outDoc.slice(outDoc.lastIndexOf('<w:p>', i), outDoc.indexOf('</w:p>', i) + 6)
  })()
  const srcPara = (() => {
    const i = srcDoc.indexOf('表单里的字')
    return srcDoc.slice(srcDoc.lastIndexOf('<w:p>', i), srcDoc.indexOf('</w:p>', i) + 6)
  })()
  check('写出段落以 begin 开头、end 收尾',
    /^<w:p><w:r><w:fldChar[^>]*fldCharType="begin"/.test(outPara) && /fldCharType="end"[^>]*\/><\/w:r><\/w:p>$/.test(outPara))
  check('结果文字仍在 separate 与 end 之间',
    outPara.indexOf('fldCharType="separate"') < outPara.indexOf('表单里的字')
      && outPara.indexOf('表单里的字') < outPara.indexOf('fldCharType="end"'))
  const norm = (s) => s.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, '').replace(/ xml:space="preserve"/g, '')
  check('域壳字面与源件逐字相同（剥掉包发的 rPr 与 xml:space）', norm(srcPara) === norm(outPara))

  // ── ③ 三道守卫 ────────────────────────────────────────────────────
  const bare = await zipBytes(new Map([['word/document.xml', `<w:document>${FF('甲')}</w:document>`]]))
  eq('幂等：写出包已有 fldChar 就整笔不动', await patchFormFields(bare, got), bare)
  const plain = `<w:document><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:document>`
  const plainBytes = await zipBytes(new Map([['word/document.xml', plain]]))
  eq('陈旧守卫：结果文字认不出就不插', await patchFormFields(plainBytes, [{ ...f, text: '用户改过的字' }]), plainBytes)
  const hit = await patchFormFields(plainBytes, [{ ...f, text: '甲' }])
  const hitXml = await (await JSZip.loadAsync(hit)).file('word/document.xml').async('string')
  check('认得出时贴回五枚 run', (hitXml.match(/<w:r>/g) ?? []).length === 5 && hitXml.includes('<w:ffData>'))
  const twoBytes = await zipBytes(new Map([['word/document.xml',
    `<w:document><w:p><w:r><w:t>甲</w:t></w:r></w:p><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:document>`]]))
  const twoHit = await (await JSZip.loadAsync(await patchFormFields(twoBytes, two))).file('word/document.xml').async('string')
  eq('两个域各插一次，不重叠', (twoHit.match(/<w:ffData>/g) ?? []).length, 2)
  check('两个域的结果文字仍各自在壳里',
    twoHit.indexOf('甲') < twoHit.indexOf('乙') && twoHit.indexOf('fldCharType="end"', twoHit.indexOf('甲')) < twoHit.indexOf('乙'))

  // ── ④ 源码级：通道与纪律 ──────────────────────────────────────────
  const w = read('../src/lib/docx.ts')
  const r = read('../src/lib/docx-fidelity.ts')
  check('提取是独立纯函数（可直接钉边界）', /export function formFieldsOf\(docXml: string\)/.test(w))
  check('提取走 docxToDocMeta（写手侧，不碰读手）', /const formFields = formFieldsOf\(docXml\)/.test(w) && /out\.formFields = formFields/.test(w))
  check('读手源码没被本轮改动（v0.155 的只读记账注释仍在）', r.includes('整族只读记账'))
  check('DocMeta 有 formFields 字段', /formFields\?: \{ before: string; after: string; text: string \}\[\]/.test(w))
  check('主链挂 withFf，逐笔接上一笔', /const withFf = await patchFormFields\(withDocPr, meta\?\.formFields, sess\)/.test(w))
  check('两条出口都接 withFf（不绕过）', /patchTcPr\(withFf,/.test(w) && /: withFf/.test(w))
  check('幂等守卫在补丁入口', /if \(xml\.includes\('<w:fldChar'\)\) return bytes/.test(w))
  check('陈旧守卫按结果文字认领', /const needle = `>\$\{f\.text\}<\/w:t>`/.test(w))
  check('插入区间按 cursor 单调前进', /if \(st < cursor \|\| en < 0 \|\| en < t\) continue/.test(w))
  check('只贴验过 ffData 的片', /!f\.before\.includes\('<w:ffData>'\)/.test(w))
  check('边界限定在单个段落内', w.includes('docXml.matchAll(/<w:p(?:\\s[^>]*)?>[\\s\\S]*?<\\/w:p>/g)'))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
