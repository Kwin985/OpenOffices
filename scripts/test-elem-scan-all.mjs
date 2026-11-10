// v0.193 断言：写手补丁链剩余六处「先数一遍再逐块改」的物化数组 → 惰性迭代。
//
// v0.188–v0.192 已陆续收掉 patchImgXml / patchNumOverrides / patchBorderBlocks /
// patchElemAttrs；本轮收掉 patchParaProps / patchBeforeElem / patchColorLits /
// patchShdAttrs / patchTrPr / patchTcPr，七处共用 `legacyElemScan` 对照腿。
// 数量闸门从「循环前 opens.length !== extras.length」搬进循环头：
// 块数不足 / 多出一块都照旧整笔不动，已拼的局部串不写盘。
//
// 跑法：npx vite-node scripts/test-elem-scan-all.mjs

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
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

function normalizePart(name, text) {
  if (name === 'docProps/core.xml') return text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
  return text.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
}

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

  // ── ① 两腿逐部件归一逐字相同（唯一硬闸）────────────────────────────
  const full = async (legacy) => {
    const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged, { legacyElemScan: legacy }))
    const names = Object.keys(out.files).filter((n) => !out.files[n].dir).sort()
    const rows = []
    for (const n of names) rows.push(`${n}\u0000${normalizePart(n, await out.file(n).async('string'))}`)
    return rows.join('\u0001')
  }
  const a = await full(true), b = await full(false)
  check('两腿逐部件字符串归一后逐字相同', a === b, a === b ? '' : `长度 ${a.length} vs ${b.length}`)
  check('夹具非空（确实走到写手补丁链）', b.includes('word/document.xml') && b.includes('<w:tbl>'))

  // ── ② 源码级：六处同款、闸门搬进循环头 ────────────────────────────
  const w = read('../src/lib/docx.ts')
  const lazyLine = '(legacyElemScan ? [...xml.matchAll(re)] : xml.matchAll(re))[Symbol.iterator]()'
  check('六处都换成惰性迭代器', (w.split(lazyLine).length - 1) === 6,
    `实际 ${w.split(lazyLine).length - 1} 处`)
  check('v0.192 的 patchElemAttrs 也还由同一开关控制',
    /const opens: Iterable<RegExpMatchArray> = legacyElemScan \? \[\.\.\.xml\.matchAll\(re\)\] : xml\.matchAll\(re\)/.test(w))
  check('六处循环上界是 <= extras.length（多跑一次对账）',
    (w.match(/for \(let i = 0; i <= extras\.length; i\+\+\)/g) ?? []).length === 6)
  check('块数不足 / 多出都整笔不动',
    (w.match(/if \(next\.done\) \{ if \(i < extras\.length\) return bytes; break \}/g) ?? []).length === 6 &&
    (w.match(/if \(i === extras\.length\) return bytes/g) ?? []).length === 6)
  check('循环前的裸长度闸门已收干净', !/if \(opens\.length !== extras\.length\)|if \(rows\.length !== extras\.length\)/.test(w))
  check('六处循环内不再有下标数组访问', !/opens\[i\]|rows\[i\]/.test(w))
  check('入口只设一次开关', /legacyElemScan = !!opts\?\.legacyElemScan/.test(w))
  check('模块级单变量，与其它对照腿互不干扰',
    /^let legacyElemScan = false$/m.test(w) && /^let legacyBlockScan = false$/m.test(w) && /^let legacyEdgeScan = false$/m.test(w))
  check('没有裸物化数组（剩余的 [...matchAll] 都在三元对照腿里）',
    !/const (?:opens|rows|blocks)(?::[^=]*)? = \[\.\.\.xml\.matchAll/.test(w))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
