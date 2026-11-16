// v0.182 pptx 导出「只写回真改过的 slide」断言。
//
// 最要紧的一条：优化不能把**真有动画**的页漏掉。`transition:'fade'` 的页
// 必须仍产出 `<p:transition>`；没改的页只是不再回写，内容一个字不动。
// 跑法：npx vite-node scripts/test-pptx-export.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { emptyDeck, newSlide } from '../src/lib/ppt.ts'
import { deckToPptxBytes } from '../src/lib/pptx-export.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

async function parts(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()
  const out = {}
  for (const n of names) {
    if (n === 'docProps/core.xml') continue // 写入时间戳两腿天然不同
    out[n] = await zip.file(n).async('string')
  }
  return out
}
const sig = (p) => JSON.stringify(p)

function quietDeck(n) {
  const slides = []
  for (let i = 0; i < n; i++) {
    const s = newSlide('blank')
    s.anim = 'fade' // needsTiming 真，但正文/形状空 → 没有注入片段
    s.advClick = true
    slides.push(s)
  }
  return { ...emptyDeck(), slides }
}

// ---- 1. 两腿语义等价 -----------------------------------------------------
{
  const d = quietDeck(6)
  const oldP = await parts(await deckToPptxBytes(d, { legacyWriteBack: true }))
  const newP = await parts(await deckToPptxBytes(d))
  check('改前/本轮：部件名集合相同', Object.keys(oldP).join(',') === Object.keys(newP).join(','))
  check('改前/本轮：逐部件字符串逐字相同', sig(oldP) === sig(newP))
  check('没改的 slide 内容一个字不动', /<p:sld\b/.test(newP['ppt/slides/slide1.xml'] ?? ''))
}

// ---- 2. 真注入没被漏掉 ---------------------------------------------------
{
  const a = newSlide('blank')
  a.transition = 'fade' // 第一页真有切页动画
  const d = { ...quietDeck(2), slides: [a, ...quietDeck(2).slides] }
  const oldP = await parts(await deckToPptxBytes(d, { legacyWriteBack: true }))
  const newP = await parts(await deckToPptxBytes(d))
  check('真注入：本轮 slide1 仍含 <p:transition>', /<p:transition\b/.test(newP['ppt/slides/slide1.xml'] ?? ''))
  check('真注入：与改前逐字相同', sig(oldP) === sig(newP))
  eq('真注入：fade 档位', /<p:fade\s*\/>/.test(newP['ppt/slides/slide1.xml'] ?? ''), true)
  check('没改的 slide2 不含 transition', !/<p:transition\b/.test(newP['ppt/slides/slide2.xml'] ?? ''))
}

// ---- 3. 源码纪律 ---------------------------------------------------------
{
  const src = read('../src/lib/pptx-export.ts')
  check('签名带可选 legacyWriteBack（产品路径不传）',
    /opts\?: \{ legacyWriteBack\?: boolean \}/.test(src))
  check('只写回真改过的（next !== original）', /if \(next !== original \|\| opts\?\.legacyWriteBack\) zip\.file\(name, next\)/.test(src))
  check('原文先留一份，injectDescr/bandRow 后才比较',
    /const original = await file\.async\('string'\)[\s\S]{0,80}let xml = original/.test(src))
  check('旧写法只在对照腿保留（不再无条件 else 写回）', !/else zip\.file\(name, xml\)/.test(src))
  check('注入仍在 </p:sld> 之前', /xml\.replace\('<\/p:sld>', `\$\{inject\}<\/p:sld>`\)/.test(src))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
