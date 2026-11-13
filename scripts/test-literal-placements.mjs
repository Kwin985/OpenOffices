// v0.195 断言：正文长尾清尾（formProt / rtlGutter / proofErr / w:sdt 壳四对）。
//
// 四类残片形状不同但都是「包不会自己发、读手只读记账」，统一成一条
// 「源包字面片按锚点贴回」通道：before/after/beforeParagraph/afterParagraph。
// sectPr 两枚按 CT_SectPr 标准序贴回（不复刻夹具把 formProt 塞在 pgNumType
// 与 pgMar 之间的非法位次），sdt 壳按结果文字认领段落前后贴回。
//
// 口径：comments|Ignorable 不做——写出包 comments.xml 根自己就发了
// mc:Ignorable="w14"，账本 lost 是普查口径，不是真丢件（假红比真红更坏）。
//
// 跑法：npx vite-node scripts/test-literal-placements.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  docxToDocMeta, literalPlacementsOf, pageSetupOf, patchLiteralPlacements, prosemirrorToDocxBytes,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const mkBytes = async (files) => {
  const z = new JSZip()
  for (const [p, c] of Object.entries(files)) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const partOf = async (b, p) => (await JSZip.loadAsync(b)).file(p)?.async('string') ?? ''

const SECT = '<w:sectPr><w:pgNumType w:start="3"/><w:rtlGutter w:val="1"/>' +
  '<w:formProt w:val="1"/><w:pgMar w:top="1440"/></w:sectPr>'

async function main() {
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const fid = await docxToHtmlFidelity(bytes)
  const meta = await docxToDocMeta(bytes)
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
  const out = await prosemirrorToDocxBytes(pmDoc, merged)
  const docXml = await partOf(out, 'word/document.xml')
  const sect = /<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/.exec(docXml)?.[0] ?? ''

  // ── ① 端到端：四枚在位、位次合法 ─────────────────────────────────
  check('formProt 回到 sectPr', sect.includes('<w:formProt w:val="1"/>'))
  check('rtlGutter 回到 sectPr', sect.includes('<w:rtlGutter w:val="1"/>'))
  check('按 CT_SectPr 标准序：cols 之后、docGrid 之前',
    sect.indexOf('<w:formProt') > sect.indexOf('</w:cols>') &&
    sect.indexOf('<w:rtlGutter') > sect.indexOf('<w:formProt') &&
    sect.indexOf('<w:rtlGutter') < sect.indexOf('<w:docGrid'))
  check('不复刻夹具非法位次（没插在 pgMar 之前）',
    sect.indexOf('<w:pgMar') < sect.indexOf('<w:formProt'))
  check('proofErr 回到 body', /<w:proofErr w:type="spellStart"\/>/.test(docXml))
  check('w:sdt 壳完整包住段落',
    /<w:sdt><w:sdtPr><w:id w:val="42"\/><\/w:sdtPr><w:sdtContent>[\s\S]*?控件里的字[\s\S]*?<\/w:sdtContent><\/w:sdt>/.test(docXml))
  check('meta 带 5 条指令（sdt 壳两条）', meta.literalPlacements?.length === 5)
  check('不含 comments.xml 指令（写出包自己已发 mc:Ignorable）',
    !meta.literalPlacements?.some((x) => x.part !== 'word/document.xml'))

  // ── ② 纯函数边界 ─────────────────────────────────────────────────
  eq('缺 sectPr 就不生成这两条', literalPlacementsOf('<w:p/>').filter((x) => x.guard.includes('formProt')).length, 0)
  eq('缺 proofErr 就不生成这一条', literalPlacementsOf(SECT).filter((x) => x.guard === '<w:proofErr').length, 0)
  eq('空 xml 不炸', literalPlacementsOf(''), [])
  eq('formProt 锚点候选含 cols/pgNumType/pgSz',
    literalPlacementsOf(SECT).find((x) => x.guard === '<w:formProt')?.anchor,
    ['</w:cols>', '<w:pgNumType', '</w:pgSz>'])
  eq('rtlGutter 插在 docGrid 之前',
    literalPlacementsOf(SECT).find((x) => x.guard === '<w:rtlGutter')?.mode, 'before')
  const sdtXml = '<w:p><w:t>控件里的字</w:t></w:p>' +
    '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:p><w:t>控件里的字2</w:t></w:p></w:sdtContent></w:sdt>'
  const sdtInst = literalPlacementsOf(sdtXml).filter((x) => x.guard.startsWith('<w:sdt') || x.guard === '</w:sdt>')
  eq('sdt 壳是开闭两条', sdtInst.length, 2)
  eq('开壳按结果文字认领段落', sdtInst[0].anchor, ['>控件里的字2</w:t>'])

  // ── ③ 补丁边界：四种 mode / 幂等 / 守卫 ───────────────────────────
  const baseFiles = { 'word/document.xml': '<w:document><w:p><w:t>甲</w:t></w:p><w:p><w:t>乙</w:t></w:p></w:document>' }
  const base = await mkBytes(baseFiles)
  check('空 items 返回同一枚 bytes', (await patchLiteralPlacements(base, undefined)) === base)
  const inst = [
    { part: 'word/document.xml', anchor: ['甲</w:t>'], mode: 'before', literal: '<A/>', guard: '<A/>' },
    { part: 'word/document.xml', anchor: ['<w:p>'], mode: 'after', literal: '<B/>', guard: '<B/>' },
    { part: 'word/document.xml', anchor: ['>乙</w:t>'], mode: 'beforeParagraph', literal: '<C/>', guard: '<C/>' },
    { part: 'word/document.xml', anchor: ['>乙</w:t>'], mode: 'afterParagraph', literal: '<D/>', guard: '<D/>' },
  ]
  const once = await partOf(await patchLiteralPlacements(base, inst), 'word/document.xml')
  check('before 插在锚点前', once.includes('<A/>甲</w:t>'))
  check('after 插在锚点后', once.includes('<w:p><B/>'))
  check('beforeParagraph 插在段落开标签前', once.includes('<C/><w:p><w:t>乙</w:t>'))
  check('afterParagraph 插在段落闭标签后', once.includes('</w:p><D/>'))
  const onceBytes = await patchLiteralPlacements(base, inst)
  check('幂等：再跑一次返回同一枚 bytes', (await patchLiteralPlacements(onceBytes, inst)) === onceBytes)
  const noAnchor = [{ part: 'word/document.xml', anchor: ['<NEVER>'], mode: 'before', literal: '<E/>', guard: '<E/>' }]
  check('锚点认不出就跳过', (await patchLiteralPlacements(base, noAnchor)) === base)
  const missingPart = [{ part: 'word/nope.xml', anchor: ['x'], mode: 'before', literal: '<E/>', guard: '<E/>' }]
  check('部件不存在就跳过', (await patchLiteralPlacements(base, missingPart)) === base)
  const guarded = await mkBytes({ 'word/document.xml': '<w:document><A/></w:document>' })
  check('guard 已在场就不叠第二枚',
    (await patchLiteralPlacements(guarded, inst.slice(0, 1))) === guarded)

  // ── ④ 源码级接线 ────────────────────────────────────────────────
  const w = read('../src/lib/docx.ts')
  check('DocMeta 有 literalPlacements 字段', /literalPlacements\?: LiteralPlacement\[\]/.test(w))
  // v0.196：链尾又插了 withVml，改成动态链校验（每个输入 = 上一笔输出），
  // 以后再插新补丁只要接上就不再红。
  check('主链挂 withPlacements',
    /const withPlacements = await patchLiteralPlacements\(withFeat, meta\?\.literalPlacements, sess\)/.test(w))
  const defs = [...w.matchAll(/^  const (with[A-Z]\w*) =/gm)].map((m) => ({ name: m[1], at: m.index }))
  const from = defs.findIndex((d) => d.name === 'withCols')
  const to = defs.findIndex((d) => d.name === 'withNumStart')
  const core = defs.slice(from, to + 1)
  let chainOk = from >= 0 && to > from
  for (let i = 1; i < core.length; i++) {
    const seg = w.slice(core[i].at, i + 1 < core.length ? core[i + 1].at : core[i].at + 700)
    if (!seg.includes(core[i - 1].name)) chainOk = false
  }
  check('核心补丁链逐笔接上一笔（含 withVml）', chainOk && core.some((d) => d.name === 'withVml'))
  check('meta 构造从 document.xml 正则提取',
    /const literalPlacements = literalPlacementsOf\(docXml\)/.test(w) && /out\.literalPlacements = literalPlacements/.test(w))
  check('四种 mode 都在补丁里',
    ["it.mode === 'before'", "it.mode === 'after'", "it.mode === 'afterParagraph'", 'beforeParagraph：往回找']
      .every((s) => w.includes(s)))
  check('CT_SectPr 标准序口径写进注释', /CT_SectPr 序里非法/.test(w))
  check('不再多读 comments.xml 部件（写出包自己已发 mc:Ignorable）',
    !w.includes("readText('word/comments.xml')"))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
