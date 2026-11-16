// v0.188 两族断言：`wp:docPr` 的 id/name 回填 + 文档属性读写链。
//
// ① 源包 5 枚 docPr 各有 id/name，WPS 形状与艺术字被读手展平成文字后没有
//    `data-img` 载荷，包发出 `id="1" name=""` 空壳。写手侧从源包正则提取
//    （不进保真账），`patchDocPr` 按出现序前缀对位改回去。
// ② `new Document` 原先把 creator/title 硬编码成 OpenOffices，导入别人的文档
//    另存一次就把原作者与标题冲掉。五格走包原生槽，编辑器面板可改。
//
// 跑法：npx vite-node scripts/test-docpr-props.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  DEFAULT_DOC_PROPS, docPropsOf, docxToDocMeta, pageSetupOf,
  parseCoreProps, patchDocPr, prosemirrorToDocxBytes,
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
async function writeParts(parts = fixtureParts(), metaPatch = {}) {
  const bytes = await zipBytes(parts)
  const fid = await docxToHtmlFidelity(bytes)
  const meta = { ...(await docxToDocMeta(bytes)), ...metaPatch }
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
  }
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()
  const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged))
  return {
    meta,
    doc: await out.file('word/document.xml').async('string'),
    core: (await out.file('docProps/core.xml')?.async('string')) ?? '',
  }
}
const docPrOf = (xml) =>
  [...xml.matchAll(/<wp:docPr\b[^>]*>/g)].map((m) => ({
    id: /\bid="([^"]*)"/.exec(m[0])?.[1] ?? '',
    name: /\bname="([^"]*)"/.exec(m[0])?.[1] ?? '',
  }))

// ---- 1. docPr：源值按出现序带回 --------------------------------------------
const base = await writeParts()
{
  const src = docPrOf(fixtureParts().get('word/document.xml') ?? '')
  const out = docPrOf(base.doc)
  eq('源包 5 枚 docPr', src.length, 5)
  eq('写出包 5 枚 docPr', out.length, 5)
  eq('id 序列逐枚回到源值', out.map((x) => x.id).join(','), src.map((x) => x.id).join(','))
  eq('name 序列逐枚回到源值', out.map((x) => x.name).join(','), src.map((x) => x.name).join(','))
  eq('写出包不再有 id="1" 空壳', out.filter((x) => x.id === '1').length, 0)
  eq('写出包不再有 name=""', out.filter((x) => !x.name).length, 0)
  eq('meta.docPrShells 按出现序', base.meta.docPrShells?.map((x) => x.id).join(','), '7,8,9,11,12')
  eq('每枚标签只有一枚 id', base.doc.match(/<wp:docPr\b[^>]*>/g).every((t) => (t.match(/\bid=/g) ?? []).length === 1), true)
}
{
  const parts = fixtureParts()
  parts.set('word/document.xml', (parts.get('word/document.xml') ?? '').replace('id="9" name="形状 1"', 'id="42" name="改过的形状"'))
  const v = await writeParts(parts)
  check('变体：源 id/name 换了，写出跟着变', docPrOf(v.doc).some((x) => x.id === '42' && x.name === '改过的形状'))
}
async function patched(xml, shells) {
  const outBytes = await patchDocPr(await zipBytes(new Map([['word/document.xml', xml]])), shells)
  return (await (await JSZip.loadAsync(outBytes)).file('word/document.xml').async('string'))
}
{
  const plain = '<w:document><wp:docPr id="1" name=""/><wp:docPr id="1" name=""/></w:document>'
  eq('纯函数：空 shells 原样返回', await patched(plain, []), plain)
  eq('纯函数：按出现序改值', docPrOf(await patched(plain, [{ id: '7', name: 'A' }, { id: '9', name: 'B' }])).map((x) => `${x.id}/${x.name}`).join(','), '7/A,9/B')
  eq('纯函数：写出比源多的 docPr 保持包的默认值',
    docPrOf(await patched(plain, [{ id: '7', name: 'A' }])).map((x) => x.id).join(','), '7,1')
  eq('纯函数：源里空串占位不把名字抹掉',
    docPrOf(await patched(plain, [{ id: '', name: '' }])).map((x) => `${x.id}/${x.name}`).join(','), '1/,1/')
  eq('纯函数：标签缺 name 时追加一枚（不追加第二枚）',
    /<wp:docPr id="7" name="A"\/>/.test(await patched('<wp:docPr id="1"/>', [{ id: '7', name: 'A' }])), true)
}

// ---- 2. 文档属性纯函数 ------------------------------------------------------
{
  eq('parseCoreProps：空串给空对象', JSON.stringify(parseCoreProps('')), '{}')
  const full = '<cp:coreProperties><dc:title>季度报告</dc:title><dc:creator>张三</dc:creator>' +
    '<dc:subject>评审</dc:subject><cp:keywords>docx, 往返</cp:keywords><dc:description>备注</dc:description></cp:coreProperties>'
  const p = parseCoreProps(full)
  eq('五格都读出来', [p.title, p.creator, p.subject, p.keywords, p.description].join('|'), '季度报告|张三|评审|docx, 往返|备注')
  eq('实体还原（&amp; 最后解）', parseCoreProps('<dc:title>A &amp; B &lt;C&gt;</dc:title>').title, 'A & B <C>')
  eq('数字实体', parseCoreProps('<dc:title>&#x4e2d;&#25991;</dc:title>').title, '中文')
  eq('缺字段不落空串', JSON.stringify(parseCoreProps('<dc:title>只有标题</dc:title>')), JSON.stringify({ title: '只有标题' }))
  eq('空元素不落字段', JSON.stringify(parseCoreProps('<dc:title>  </dc:title>')), '{}')
  eq('docPropsOf：无 meta 用缺省', docPropsOf(undefined).creator, 'OpenOffices')
  eq('docPropsOf：源值覆盖缺省', docPropsOf({ docProps: { creator: '李四' } }).creator, '李四')
  eq('docPropsOf：源没说的仍补缺省', docPropsOf({ docProps: { creator: '李四' } }).title, DEFAULT_DOC_PROPS.title)
}

// ---- 3. 文档属性端到端 ------------------------------------------------------
{
  const parts = fixtureParts()
  parts.set('docProps/core.xml',
    '<?xml version="1.0"?><cp:coreProperties><dc:title>源件标题</dc:title><dc:creator>原作者</dc:creator>' +
    '<dc:subject>源件主题</dc:subject><cp:keywords>k1,k2</cp:keywords><dc:description>源件备注</dc:description></cp:coreProperties>')
  const v = await writeParts(parts)
  eq('meta 从 core.xml 读出源值', v.meta.docProps?.title, '源件标题')
  check('写出 core.xml 保留源标题（不再硬编码）', /<dc:title>源件标题<\/dc:title>/.test(v.core))
  check('写出 core.xml 保留源作者', /<dc:creator>原作者<\/dc:creator>/.test(v.core))
  check('写出 core.xml 保留主题/关键词/备注',
    /源件主题/.test(v.core) && /k1,k2/.test(v.core) && /源件备注/.test(v.core))
  const edited = await writeParts(parts, { docProps: { title: '用户改的标题', creator: '新作者' } })
  check('用户改过的属性写回 core.xml', /用户改的标题/.test(edited.core) && /新作者/.test(edited.core))
  const noCore = await writeParts()
  check('源件没有 core.xml 时回落到缺省', /OpenOffices/.test(noCore.core))
}

// ---- 4. 源码级接线 ----------------------------------------------------------
{
  const w = read('../src/lib/docx.ts')
  const ui = read('../src/components/DocEditor.tsx')
  const css = read('../src/index.css')
  check('docPrShells 从源包正则提取（不进保真账）', /const docPrShells = \[\.\.\.docXml\.matchAll\(\/<wp:docPr/.test(w))
  check('主链挂 patchDocPr', /const withDocPr = await patchDocPr\(withRev, meta\?\.docPrShells, sess\)/.test(w))
  // v0.190：动态链校验，不钉链尾变量名（见 test-bookmark-ids.mjs）
  const chainOk = (src) => {
    const defs = [...src.matchAll(/^  const (with[A-Z]\w*) =/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }))
    const a = defs.findIndex((d) => d.name === 'withBm'), b = defs.findIndex((d) => d.name === 'withNumStart')
    if (a < 0 || b <= a) return false
    const core = defs.slice(a, b + 1)
    return core.every((d, i) => i === 0 || src.slice(d.at, i + 1 < core.length ? core[i + 1].at : d.at + 600).includes(core[i - 1].name))
  }
  check('后续补丁接 withDocPr 不绕过它（动态链校验）', chainOk(w))
  check('patchDocPr 复用 tagWithAttrs 改值', /const next = tagWithAttrs\(tag, kv\)/.test(w))
  // 只收窄到 Document 构造的那一段：DEFAULT_DOC_PROPS 里那两枚字面量是回落值，
  // 不算「构造里硬编码」，别把整份文件的 'OpenOffices' 都算进来
  const ctor = w.slice(w.indexOf('const doc = new Document({'), w.indexOf('features: { updateFields: true }'))
  check('Document 构造走 docPropsOf 而不是硬编码', /const coreProps = docPropsOf\(meta\)/.test(w)
    && /creator: coreProps\.creator/.test(ctor) && !/OpenOffices/.test(ctor))
  check('工具条有文档属性按钮', /btn\('文档属性'/.test(ui))
  check('面板五格可编辑并回写 meta', /propsOpen/.test(ui) && (/\[key\]: v \|\| undefined/.test(ui)) && /patchMeta\(\{ docProps: next \}\)/.test(ui))
  check('面板占位显示缺省值', /docPropsOf\(meta\)\[key\]/.test(ui))
  check('CSS 有面板换行规则', /\.doc-props-panel/.test(css))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
