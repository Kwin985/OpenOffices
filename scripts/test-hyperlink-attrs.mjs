// v0.191 断言：超链接壳的 `w:tooltip` / `w:tgtFrame` 从模型回填。
//
// 与前面几轮「写手侧从源包正则搬字面」不同：读手 v0.155 早把两枚属性兑现
// 成 HTML `<a title/target>`，TipTap 的 link mark 自带这两格，只是
// `ExternalHyperlink` 只收 `link`。所以写手从**模型**登记，用户改过
// title/target 就写回新值——屏上替身能认回，是真双向。
//
// 跑法：npx vite-node scripts/test-hyperlink-attrs.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  docxToDocMeta, pageSetupOf, patchHyperlinkAttrs, prosemirrorToDocxBytes,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

async function zipBytes(map) {
  const z = new JSZip()
  for (const [p, c] of map) z.file(p, c)
  return new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
}
const docOf = async (b) => (await (await JSZip.loadAsync(b)).file('word/document.xml').async('string'))
const HL = (tag, text) => `<w:p>${tag}<w:r><w:t>${text}</w:t></w:r></w:hyperlink></w:p>`

async function main() {
  // ── ① 补丁纯行为：按出现序、缺则追加、已有不叠 ────────────────────
  const bare = await zipBytes(new Map([['word/document.xml',
    `<w:document>${HL('<w:hyperlink r:id="rId1">', '甲')}${HL('<w:hyperlink r:id="rId2">', '乙')}</w:document>`]]))
  const xml0 = await docOf(bare)
  eq('没有载荷就不动', await patchHyperlinkAttrs(bare, undefined), bare)
  eq('载荷两枚都空就不动', await patchHyperlinkAttrs(bare, [{}, {}]), bare)
  const hit = await docOf(await patchHyperlinkAttrs(bare, [
    { tip: '提示一' }, { tip: '提示二', frame: 'frame2' },
  ]))
  check('两枚链接各按出现序补自己的属性',
    /<w:hyperlink r:id="rId1"[^>]*w:tooltip="提示一"[^>]*>/.test(hit)
      && /<w:hyperlink r:id="rId2"[^>]*w:tooltip="提示二"[^>]*w:tgtFrame="frame2"[^>]*>/.test(hit))
  check('第一枚只有 tooltip', /<w:hyperlink[^>]*w:tooltip="提示一"[^>]*>/.test(hit) && !/w:tgtFrame="frame1"/.test(hit))
  check('第二枚两枚都有', /<w:hyperlink[^>]*w:tooltip="提示二"[^>]*w:tgtFrame="frame2"[^>]*>/.test(hit))
  check('绝不追加第二枚同名属性', (hit.match(/w:tooltip=/g) ?? []).length === 2)
  const already = await zipBytes(new Map([['word/document.xml',
    `<w:document>${HL('<w:hyperlink r:id="rId1" w:tooltip="旧值">', '甲')}</w:document>`]]))
  const changed = await docOf(await patchHyperlinkAttrs(already, [{ tip: '新值' }]))
  check('已有同名属性只改值、不叠第二枚',
    changed.includes('w:tooltip="新值"') && (changed.match(/w:tooltip=/g) ?? []).length === 1)
  const escaped = await docOf(await patchHyperlinkAttrs(bare, [{ tip: 'A&B<"', frame: 'x&y' }]))
  check('载荷按 XML 转义（不写坏属性串）', escaped.includes('w:tooltip="A&amp;B&lt;&quot;"') && escaped.includes('w:tgtFrame="x&amp;y"'))
  eq('重复跑幂等（值不变）', await docOf(await patchHyperlinkAttrs(await patchHyperlinkAttrs(bare, [{ tip: '甲' }]), [{ tip: '甲' }])),
    await docOf(await patchHyperlinkAttrs(bare, [{ tip: '甲' }])))
  check('xml0 是干净基线（没被改到）', !xml0.includes('w:tooltip'))

  // ── ② 端到端：夹具写出包 ──────────────────────────────────────────
  const parts = fixtureParts()
  const z = new JSZip()
  for (const [p, c] of parts) z.file(p, c)
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
  const outDoc = await docOf(await prosemirrorToDocxBytes(pmDoc, merged))
  const blocks = [...outDoc.matchAll(/<w:hyperlink\b[^>]*>[\s\S]*?<\/w:hyperlink>/g)].map((m) => m[0])
  eq('写出包两枚链接', blocks.length, 2)
  check('第二枚的 tooltip / tgtFrame 都回来',
    blocks[1].includes('w:tooltip="悬停提示"') && blocks[1].includes('w:tgtFrame="blank"'))
  check('源件没写过的第一枚不凭空补属性', !blocks[0].includes('w:tooltip') && !blocks[0].includes('w:tgtFrame'))
  check('`_blank` 默认值没被当成源件显式帧目标', !outDoc.includes('w:tgtFrame="_blank"'))

  // ── ③ 真双向：改 PM 的 link mark，写回新值 ────────────────────────
  const changedPm = JSON.parse(JSON.stringify(pmDoc))
  const walk = (n) => {
    if (n.marks) for (const m of n.marks) if (m.type === 'link') {
      m.attrs.title = '用户改的提示'
      m.attrs.target = 'myframe'
    }
    for (const k of n.content ?? []) walk(k)
  }
  walk(changedPm)
  const out2 = await docOf(await prosemirrorToDocxBytes(changedPm, merged))
  check('用户改过的 title/target 写回新值（不是源包旧字面）',
    out2.includes('w:tooltip="用户改的提示"') && out2.includes('w:tgtFrame="myframe"'))
  check('旧字面没混进来', !out2.includes('w:tooltip="悬停提示"'))

  // ── ④ 源码级：模型登记、主链接线 ─────────────────────────────────
  const w = read('../src/lib/docx.ts')
  const r = read('../src/lib/docx-fidelity.ts')
  check('从模型取 title/target（不是源包正则）',
    /const tip = markAttr\(child, 'link', 'title'\)/.test(w)
      && /const frame = markAttr\(child, 'link', 'target'\)/.test(w)
      && /dt\?\.linkExtras\.push\(/.test(w))
  check('`_blank` 默认值守卫', /frame && frame !== '_blank'/.test(w))
  check('补丁是导出的独立函数', /export async function patchHyperlinkAttrs\(/.test(w))
  check('复用 tagWithAttrs 同名改值/追加', /const next = tagWithAttrs\(m\[0\], kv\)/.test(w))
  check('主链挂 withLink，逐笔接上一笔', /const withLink = await patchHyperlinkAttrs\(withLit, dt\.linkExtras, sess\)/.test(w))
  // 链尾变量名每加一支补丁就过期，改「每笔输入 = 上一笔输出」的动态校验（v0.190 同款）
  const chainOk = (src) => {
    const defs = [...src.matchAll(/^  const (with[A-Z]\w*) =/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }))
    const a = defs.findIndex((d) => d.name === 'withLink'), b = defs.findIndex((d) => d.name === 'withNumStart')
    if (a < 0 || b <= a) return false
    const core = defs.slice(a, b + 1)
    return core.every((d, i) => i === 0 || src.slice(d.at, i + 1 < core.length ? core[i + 1].at : d.at + 600).includes(core[i - 1].name))
  }
  check('写手：withLink 是主链上的一笔', /const withLink = await patchHyperlinkAttrs\(withLit,/.test(w))
  check('写手：后续补丁逐笔接上一笔（动态校验）', chainOk(w))
  check('读手零改动（v0.155 的兑现注释仍在）', /HTML 的 title 与 target 正好是这两个含义/.test(r))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
