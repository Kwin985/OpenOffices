// v0.192 断言：批注身份链第四枚 `w:initials` 从模型回填。
//
// `DocComment.initials` 与读手 v0.154 的解析早就有，包 `ICommentOptions.initials`
// 也是原生槽，只差写手 `anchored.map` 没传——导入别人的 docx 另存一次，作者姓名
// 缩写就没了。本轮补的是「模型已有字段、写手没接」，不是新建槽、不是源包字面搬回。
//
// 跑法：npx vite-node scripts/test-comment-initials.mjs

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
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

async function main() {
  const parts = fixtureParts()
  const z = new JSZip()
  for (const [p, c] of parts) z.file(p, c)
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const fid = await docxToHtmlFidelity(bytes)
  const meta = await docxToDocMeta(bytes)
  // 写手主链用的是 fid.comments（docxToHtmlFidelity 读 comments.xml），
  // docxToDocMeta 只解 sectPr/rels/core.xml，不带批注——别拿它当读手判据
  eq('读手已把 initials 带进 fid.comments', fid.comments?.[0]?.initials, 'ZS')
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
  const write = async (m) => {
    const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, m))
    const f = out.file('word/comments.xml')
    return f ? await f.async('string') : ''
  }

  // ── ① 端到端：写出包带回原值 ─────────────────────────────────────
  const outXml = await write(merged)
  check('写出包有批注部件', outXml.length > 0)
  check('w:initials="ZS" 回来', /<w:comment\b[^>]*w:initials="ZS"/.test(outXml))
  const commentTags = [...outXml.matchAll(/<w:comment\b[^>]*>/g)].map((m) => m[0])
  check('作者与缩写同在一条批注上（属性顺序无关）',
    commentTags.some((t) => t.includes('w:author="张三"') && t.includes('w:initials="ZS"')))
  check('每枚批注只有一枚 initials', (outXml.match(/w:initials=/g) ?? []).length === 1)

  // ── ② 真双向：改模型里的 initials ────────────────────────────────
  const edited = {
    ...merged,
    comments: (merged.comments ?? []).map((c) => ({ ...c, initials: 'QQ' })),
  }
  const out2 = await write(edited)
  check('用户改过的 initials 写回新值', out2.includes('w:initials="QQ"') && !out2.includes('w:initials="ZS"'))
  const removed = {
    ...merged,
    comments: (merged.comments ?? []).map(({ initials: _i, ...c }) => c),
  }
  const out3 = await write(removed)
  check('没写 initials 时不凭空造一枚', !out3.includes('w:initials'))

  // ── ③ 源码级：模型字段、包原生槽、读手零改动 ─────────────────────
  const w = read('../src/lib/docx.ts')
  const r = read('../src/lib/docx-fidelity.ts')
  check('写手把 initials 传给包', /\.\.\.\(c\.initials \? \{ initials: c\.initials \} : \{\}\)/.test(w))
  check('不传缺省值（没写就不发）', /c\.initials \?/.test(w) && !/initials: c\.initials \|\|/.test(w))
  check('DocComment 有 initials 字段', /initials\?: string/.test(w))
  check('读手零改动（v0.154 的解析仍在）', /const initials = attr\(c, 'w:initials'\)/.test(r))
  const dts = read('../node_modules/.pnpm/docx@9.7.1/node_modules/docx/dist/index.d.ts')
  check('包 ICommentOptions 确有 initials 原生槽（类型面核实）',
    /export declare type ICommentOptions = \{[\s\S]*?initials\?: string/.test(dts))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
