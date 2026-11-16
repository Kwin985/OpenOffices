// v0.190 断言：写手补丁链循环内最后一处动态正则收干净。
//
// v0.186 收 `tagWithAttrs`/`retag`、v0.187 收 `mergeTagAttrs` 等三处、
// v0.189 收两处物化数组；剩下 `patchBorderBlocks` 里按边名编译的
// `edgeRe`（每块每 chunk 一次 `new RegExp`）。本轮换成 `findEdgeTag`
// 字符串定位，`legacyEdgeScan:true` 复刻改前路径供 A/B。
//
// 跑法：npx vite-node scripts/test-edge-scan.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  docxToDocMeta, findEdgeTag, pageSetupOf, prosemirrorToDocxBytes,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

function normalizePart(name, text) {
  if (name === 'docProps/core.xml') return text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
  return text.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
}

async function main() {
  // ── ① 纯函数：与改前正则等价 ──────────────────────────────────────
  const blk = '<w:pBdr><w:top w:val="single" w:sz="4"/><w:left w:val="dashed"/><w:top w:val="double"/></w:pBdr>'
  eq('命中第一枚 top', findEdgeTag(blk, 'top'), { at: 8, xml: '<w:top w:val="single" w:sz="4"/>' })
  eq('按名字各命中各的边', findEdgeTag(blk, 'left')?.xml, '<w:left w:val="dashed"/>')
  eq('不存在的边返回 undefined', findEdgeTag(blk, 'bottom'), undefined)
  eq('自闭合无属性', findEdgeTag('<w:pBdr><w:top/></w:pBdr>', 'top')?.xml, '<w:top/>')
  eq('有内容开标签', findEdgeTag('<w:pBdr><w:top></w:top></w:pBdr>', 'top')?.xml, '<w:top>')
  eq('换行分隔属性也算边界', findEdgeTag('<w:pBdr><w:top\nw:val="single"/></w:pBdr>', 'top')?.xml?.includes('w:val'), true)
  eq('标签名不会被前缀误命中', findEdgeTag('<w:pBdr><w:topper w:val="x"/><w:top w:val="y"/></w:pBdr>', 'top')?.xml,
    '<w:top w:val="y"/>')
  eq('只有相似前缀时找不到', findEdgeTag('<w:pBdr><w:topper/></w:pBdr>', 'top'), undefined)
  eq('空串块不炸', findEdgeTag('', 'top'), undefined)
  eq('edge 里的正则元字符按字面处理（不当模式）', findEdgeTag('<w:pBdr><w:top.*/></w:pBdr>', 'top.*')?.xml, '<w:top.*/>')
  eq('正则元字符不会误命中别的边', findEdgeTag('<w:pBdr><w:topper/></w:pBdr>', 'top.*'), undefined)

  // ── ② 端到端：两腿逐部件归一后逐字相同 ───────────────────────────
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
  const full = async (legacy) => {
    const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged, { legacyEdgeScan: legacy }))
    const names = Object.keys(out.files).filter((n) => !out.files[n].dir).sort()
    const rows = []
    for (const n of names) rows.push(`${n}\u0000${normalizePart(n, await out.file(n).async('string'))}`)
    return rows.join('\u0001')
  }
  const a = await full(true), b = await full(false)
  check('两腿逐部件字符串归一后逐字相同', a === b, a === b ? '' : `长度 ${a.length} vs ${b.length}`)
  check('夹具确实走到 pBdr 补丁（非空产出）', b.includes('word/document.xml') && b.includes('<w:pBdr'))

  // ── ③ 源码级：零动态正则、对照腿只差一个参数 ─────────────────────
  const w = read('../src/lib/docx.ts')
  check('定位是导出的独立纯函数', /export function findEdgeTag\(block: string, edge: string\)/.test(w))
  check('入口有 legacyEdgeScan 开关', /legacyEdgeScan\?: boolean/.test(w) && /legacyEdgeScan = !!opts\?\.legacyEdgeScan/.test(w))
  check('产品路径走 findEdgeTag', /: findEdgeTag\(block, edge\)/.test(w))
  check('对照腿复刻改前的 new RegExp', w.includes('const re = new RegExp(`<w:${edge}(?=[\\\\s/>])[^>]*>`)'))
  check('模块级单变量（与其它对照腿并列）', /^let legacyEdgeScan = false$/m.test(w))
  check('替换不再用 String.replace 吃正则', !/block\.replace\(edgeRe/.test(w))
  check('插入用 slice 拼接（避免 $& 展开）', /block\.slice\(0, hit\.at\) \+ mergeTagAttrs\(hit\.xml, attrs\)/.test(w))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
