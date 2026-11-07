// v0.181 ODT 导入「两棵主树只物化一次」的结构断言。
//
// 钉三件事：① 不传 opts（缓存腿）与 `{cacheDesc:false}`（改前腿）在多种夹具上
// 输出逐字相同；② sdoc 缺失、空文档等边界不崩；③ 源码纪律（findLocal 早停、
// 只缓存 cdoc/sdoc、对照腿不预物化、不碰别的模块）。
// 跑法：npx vite-node scripts/test-odt-desc.mjs

import fs from 'node:fs'
import JSZip from 'jszip'

const { DOMParser } = await import('@xmldom/xmldom')
const probe = new DOMParser().parseFromString('<r><a/><b/></r>', 'text/xml')
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

const { prosemirrorToOdtBytes, odtToHtml } = await import('../src/lib/odt.ts')

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const sig = (o) => JSON.stringify([o.html, o.meta, o.warnings])

async function fixture(n, { dropStyles = false } = {}) {
  const content = []
  for (let i = 0; i < n; i++) content.push(p(`第 ${i + 1} 段 ODT ${'ABC123'.repeat(3)}`))
  const bytes = await prosemirrorToOdtBytes({ type: 'doc', content })
  const zip = await JSZip.loadAsync(bytes)
  if (dropStyles) zip.remove('styles.xml')
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' }))
}

// ---- 1. 两腿语义等价 -----------------------------------------------------
for (const [name, bytes] of [
  ['空文档', await fixture(0)],
  ['单段', await fixture(1)],
  ['12 段', await fixture(12)],
  ['无 styles.xml', await fixture(5, { dropStyles: true })],
]) {
  const a = await odtToHtml(bytes, { cacheDesc: false })
  const b = await odtToHtml(bytes)
  check(`${name}：两腿输出逐字相同`, sig(a) === sig(b))
  check(`${name}：HTML 非空`, b.html.length > 0 || name === '空文档')
}

// ---- 2. 缓存确实少查了 ---------------------------------------------------
{
  let calls = 0
  for (const obj of [probe.documentElement, probe]) {
    let proto = Object.getPrototypeOf(obj)
    while (proto && proto !== Object.prototype) {
      if (Object.prototype.hasOwnProperty.call(proto, 'getElementsByTagName')) {
        const orig = proto.getElementsByTagName
        proto.getElementsByTagName = function (n) {
          if (n === '*') calls++
          return orig.call(this, n)
        }
        break
      }
      proto = Object.getPrototypeOf(proto)
    }
  }
  const bytes = await fixture(6)
  calls = 0
  await odtToHtml(bytes, { cacheDesc: false })
  const before = calls
  calls = 0
  await odtToHtml(bytes)
  const after = calls
  check(`改前/本轮查询次数下降（${before} → ${after}）`, after < before)
  eq('本轮 cdoc+sdoc 各只物化一次（其余子树不缓存，合计 8 次）', after, 8)
}

// ---- 3. 源码纪律 ---------------------------------------------------------
{
  const src = read('../src/lib/odt.ts')
  // 注释里会写「不再 Array.from」「WeakMap 是纯亏损」这些字面，反向判据只查代码行
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')
  // 只取 findLocal 函数体（到第一个行首 `}` 为止），别把下一个函数的 Array.from 算进来
  const findSeg = /function findLocal[\s\S]*?\n}/.exec(code)?.[0] ?? ''
  check('findLocal 改成早停（不再 Array.from 物化整棵子树）',
    /const all = el\.getElementsByTagName\('\*'\)[\s\S]{0,160}for \(let i = 0; i < all\.length; i\+\+\)/.test(src)
      && !/Array\.from/.test(findSeg))
  check('签名带可选 cacheDesc（不传走缓存路径）',
    /opts\?: \{ cacheDesc\?: boolean \}/.test(src))
  check('缓存腿预物化 cdoc / sdoc，对照腿不预物化',
    /const cdocAll = opts\?\.cacheDesc === false \? null : descOf\(cdoc\)/.test(src)
      && /const sdocAll = opts\?\.cacheDesc === false \|\| !sdoc \? null : descOf\(sdoc\)/.test(src))
  check('allDescOf 只在传入 cache 时复用，其余每次现查',
    /const allDescOf = \(el: Element \| Document, cache\?: Element\[\] \| null\): Element\[\] => cache \?\? descOf\(el\)/.test(src))
  check('cdoc / sdoc / [cdoc,sdoc] 循环都传了缓存',
    /allDescOf\(cdoc, cdocAll\)/.test(src)
      && /allDescOf\(sdoc, sdocAll\)/.test(src)
      && /allDescOf\(d, d === cdoc \? cdocAll : sdocAll\)/.test(src))
  check('没有给只查一次的子树挂 WeakMap', !/WeakMap/.test(code))
  check('odtToHtml 体内不再直接 Array.from(...getElementsByTagName(\'*\'))',
    !/Array\.from\([^()]*?\.getElementsByTagName\('\*'\)\)/.test(src.slice(src.indexOf('export async function odtToHtml') + 700)))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
