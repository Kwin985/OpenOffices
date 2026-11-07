// v0.180 共享 zip 会话断言。
//
// 钉三件事：① 会话的 read 带缓存（同一部件只解压一次、缺件返回空串）；
// ② 会话是**可选参数**——不传仍走原来的各自解包路径，A/B 两腿同源；
// ③ DocEditor 打开 .docx 时两个入口都接上了同一枚会话。
// 跑法：npx vite-node scripts/test-docx-zip-session.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToDocMeta, openDocxZip } from '../src/lib/docx.ts'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const parts = fixtureParts()
const zip = new JSZip()
for (const [p, c] of parts) zip.file(p, c)
const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))

// ---- 1. 会话本身 ---------------------------------------------------------
{
  const s = await openDocxZip(bytes)
  // 直接数会话那个 zip 实例的 file() 调用：缓存命中时 read 根本不会再碰 zip。
  // 不给 JSZip.prototype 打补丁——同一 part 会被重复包装，计数会翻倍（假红）。
  const z = s.zip
  const origFile = z.file.bind(z)
  let fileCalls = 0
  z.file = (...args) => { fileCalls++; return origFile(...args) }

  const a = await s.read('word/document.xml')
  const b = await s.read('word/document.xml')
  eq('同一部件两次 read 返回同一份文本', a, b)
  eq('第二次 read 命中缓存（未再碰 zip）', fileCalls, 1)
  check('会话暴露 zip 实例给读手 f.load', !!z && typeof z === 'object')
  eq('缺件返回空串', await s.read('word/不存在.xml'), '')
  eq('缺件只查了一次 zip', fileCalls, 2)
  await s.read('word/styles.xml')
  eq('另一部件各查一次', fileCalls, 3)
  await s.read('word/document.xml')
  eq('回头再读旧部件仍命中缓存', fileCalls, 3)
}

// ---- 2. 两腿语义等价（不传 = 旧路径，传 = 会话路径）--------------------
{
  const sig = (m, f) => JSON.stringify([
    m, f.html, f.blocks, f.comments, f.warnings, f.styles,
    f.section, f.background, f.numbering, f.latentStyles,
  ])
  const mOld = await docxToDocMeta(bytes)
  const fOld = await docxToHtmlFidelity(bytes)
  const s = await openDocxZip(bytes)
  const mNew = await docxToDocMeta(bytes, s)
  const fNew = await docxToHtmlFidelity(bytes, 0, s)
  check('meta 逐字相同', JSON.stringify(mOld) === JSON.stringify(mNew))
  check('读手产出逐字相同', sig(mOld, fOld) === sig(mNew, fNew))
  check('读手仍认得出块（没因共享 zip 丢内容）', fNew.blocks > 0)
}

// ---- 3. 源码级纪律 -------------------------------------------------------
{
  const writer = read('../src/lib/docx.ts')
  const reader = read('../src/lib/docx-fidelity.ts')
  const ui = read('../src/components/DocEditor.tsx')
  check('会话导出且 read 带 Map 缓存',
    /export async function openDocxZip/.test(writer) && /const cache = new Map<string, string>\(\)/.test(writer))
  check('两个入口的 shared 都是可选参数',
    /bytes: Uint8Array, shared\?: DocxZipSession/.test(writer)
      && /shared\?: \{ zip: unknown; read\(name: string\): Promise<string> \}/.test(reader))
  check('不传 session 时保留旧路径（各自 loadAsync）',
    /else \{\s*const \{ default: JSZip \} = await import\('jszip'\)/.test(writer)
      && /else \{\s*const \{ default: JSZip \} = await import\('jszip'\)/.test(reader))
  check('meta 的 theme1.xml 也走共享 read（不再自己解压一次）',
    /const themeXml = await readText\('word\/theme\/theme1\.xml'\)/.test(writer))
  check('DocEditor 建一枚会话并透传给两个入口',
    /const zipSession = await openDocxZip\(bytes\)/.test(ui)
      && /docxToDocMeta\(bytes, zipSession\)/.test(ui)
      && /docxToHtmlFidelity\(bytes, 0, zipSession\)/.test(ui))
  check('读手不反向 import 写手的新类型（会话按结构化形状收）',
    !/from '\.\/docx'[\s\S]{0,200}DocxZipSession/.test(reader))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
