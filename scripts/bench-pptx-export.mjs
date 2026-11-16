// pptx 导出「只写回真改过的 slide」的性能判据（v0.182）。
//
// 热点：`deckToPptxBytes` 在 `pptx.write()` 之后解包注入动画/alt；旧写法对
// **进了循环但内容没变**的 slide 也 `zip.file(name, xml)` 写回。JSZip 对未被
// 替换的条目会复用原有压缩数据，替换过就得重新 DEFLATE；末尾那次
// `generateAsync` 因此把整包（含媒体、theme、其它 slide）重压一遍。
//
// 判据两条（沿用本仓库范式）：
//   ① **两腿同源、只差一个参数**：`{legacyWriteBack:true}` 是改前路径，
//      不传是本轮路径。不依赖手工 git archive 副本（v0.179 那种会过期）。
//   ② **语义等价**：两腿 zip 的部件名集合 + 逐部件字符串逐字相同
//      （`docProps/core.xml` 的写入时间戳两腿天然不同，按既有口径排除）。
//
// 夹具：N 页 blank slide 带 `anim:'fade'`（needsTiming 为真）但正文/形状为空，
// 所以 `transitionXml`/`revealOrder` 都不产出注入片段——正是「进循环但没改」。
//
// 跑法：npx vite-node scripts/bench-pptx-export.mjs

import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { emptyDeck, newSlide } from '../src/lib/ppt.ts'
import { deckToPptxBytes } from '../src/lib/pptx-export.ts'

const ROUNDS = 10
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function fixture(n) {
  const slides = []
  for (let i = 0; i < n; i++) {
    const s = newSlide('blank')
    s.anim = 'fade' // 只为了让 needsTiming 为真
    s.advClick = true
    slides.push(s)
  }
  return { ...emptyDeck(), slides }
}

/** 逐部件签名：排除 core.xml 的写入时间戳（两腿各自 write()，天然不同） */
async function partsSignature(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()
  const out = []
  for (const n of names) {
    if (n === 'docProps/core.xml') continue
    out.push(`${n}\u0000${await zip.file(n).async('string')}`)
  }
  return out.join('\u0001')
}

const legs = [
  { name: '改前（没改的 slide 也写回）', times: [], fn: (d) => deckToPptxBytes(d, { legacyWriteBack: true }) },
  { name: '本轮（只写回真改过的）', times: [], fn: (d) => deckToPptxBytes(d) },
]

for (const n of [4, 24, 80]) {
  const deck = fixture(n)
  await legs[0].fn(deck)
  await legs[1].fn(deck)

  const a = await legs[0].fn(deck)
  const b = await legs[1].fn(deck)
  const same = (await partsSignature(a)) === (await partsSignature(b))
  console.log(`N=${String(n).padStart(2)} 页  语义等价（逐部件）：${same ? '✓ 逐字相同' : '✗ 不同'}`)
  if (!same) process.exitCode = 1

  for (let r = 0; r < ROUNDS; r++) {
    for (const leg of r % 2 ? legs : [...legs].reverse()) {
      const t = performance.now()
      await leg.fn(deck)
      leg.times.push(performance.now() - t)
    }
  }
  const [oldM, newM] = legs.map((l) => median(l.times))
  legs.forEach((l) => { l.times = [] })
  console.log(`   端到端中位  ${oldM.toFixed(1)} → ${newM.toFixed(1)}ms  (${((oldM - newM) / oldM * 100).toFixed(1)}% 降幅)`)
}
