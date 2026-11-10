// v0.191 基准：pptx 表格单元格文本「零数组」。
//
// 判据：① 两腿同源、只差 `legacyTblText` 一个参数，Deck 稳定序列化逐字相同；
// ② 同进程交替顺序各 10 样本取中位；③ 纯函数段用逐字符 hash 对撞（只累加长度
// 会假绿）；端到端若被 XML 解析盖住，如实写「噪声内」，不冒充整链收益。
//
// 夹具来自产品真出口 deckToPptxBytes。
// 跑法：npx vite-node scripts/bench-pptx-tabletext.mjs

import { performance } from 'node:perf_hooks'
import { emptyDeck, newSlide } from '../src/lib/ppt.ts'
import { deckToPptxBytes } from '../src/lib/pptx-export.ts'
import { pptxBytesToDeck, tableCellText } from '../src/lib/pptx-import.ts'

const ROUNDS = 10
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const stable = (v, key = '') => {
  if (key === 'id') return '<id>'
  if (v instanceof Map) return ['Map', [...v.entries()].map(([k, x]) => [k, stable(x)])]
  if (Array.isArray(v)) return v.map((x) => stable(x))
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k], k)]))
  return v
}

function fixture(rows, cols, linesPerCell) {
  const slide = newSlide('blank')
  slide.shapes = [{
    id: 'tbl1', kind: 'table', x: 40, y: 40, w: 600, h: 400,
    table: {
      rows: Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) =>
          Array.from({ length: linesPerCell }, (_, l) => `第${r + 1}行${c + 1}列第${l + 1}段`).join('\n'))),
      hasHeader: true,
    },
  }]
  return { ...emptyDeck(), slides: [slide] }
}

console.log('端到端（夹具来自 deckToPptxBytes，含原生表格）')
for (const [rows, cols, lines] of [[3, 3, 1], [20, 4, 3], [60, 6, 5]]) {
  const bytes = await deckToPptxBytes(fixture(rows, cols, lines))
  const legs = [
    { name: '改前（摊平数组）', fn: () => pptxBytesToDeck(bytes, { legacyTblText: true }) },
    { name: '本轮（单次前序）', fn: () => pptxBytesToDeck(bytes) },
  ]
  const A = stable(await legs[0].fn()), B = stable(await legs[1].fn())
  const same = JSON.stringify(A) === JSON.stringify(B)
  console.log(`${String(rows).padStart(2)} 行 × ${cols} 列  语义等价：${same ? '✓ 逐字相同' : '✗ 不同'}`)
  if (!same) process.exitCode = 1
  for (const l of legs) { await l.fn(); await l.fn() }
  const times = legs.map(() => [])
  for (let r = 0; r < ROUNDS; r++) {
    for (const i of (r % 2 === 0 ? [0, 1, 1, 0] : [1, 0, 0, 1])) {
      const t = performance.now()
      await legs[i].fn()
      times[i].push(performance.now() - t)
    }
  }
  const ma = median(times[0]), mb = median(times[1])
  console.log(`   ${ma.toFixed(1)} → ${mb.toFixed(1)}ms  降幅 ${(((ma - mb) / ma) * 100).toFixed(1)}%（噪声内属正常）`)
}

// ---- 纯函数段：只比「一个单元格里所有 a:t 拼成串」这一件事 --------------------
const el = (localName, kids = [], direct = '') => ({ name: `a:${localName}`, localName, attrs: {}, kids, direct })
const t = (s) => el('t', [], s)
const textOfLocal = (e) => {
  if (e._text !== undefined) return e._text
  let s = e.direct
  for (const k of e.kids) s += textOfLocal(k)
  e._text = s
  return s
}
const legacyCellText = (tc) => {
  const out = []
  const walk = (n) => { for (const c of n.kids) { if (c.localName === 't') out.push(c); walk(c) } }
  walk(tc)
  return out.map(textOfLocal).join('').trim()
}
const hashStr = (s, h) => { for (let j = 0; j < s.length; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619); return h | 0 }

const cell = (paras, runs) => el('tc', Array.from({ length: paras }, (_, p) =>
  el('p', Array.from({ length: runs }, (_, r) => t(`段${p}符${r}`)))))

console.log('\n纯函数段（同一批单元格，摊平数组 vs 单次前序）')
for (const [paras, runs, reps] of [[5, 4, 500], [20, 8, 150], [60, 12, 40]]) {
  // 两腿各用一份**独立且同形**的预构造池：树构造不进计时，textOf 的 _text
  // 缓存也不会因为共用树而让后跑的一腿白捡便宜（教训㉔：两腿同源只差一件事）
  const poolA = Array.from({ length: reps }, () => cell(paras, runs))
  const poolB = Array.from({ length: reps }, () => cell(paras, runs))
  const run = (fn, pool) => { let sink = 0; for (const tc of pool) sink = (sink + hashStr(fn(tc), 2166136261)) | 0; return sink }
  const a = run(legacyCellText, poolA), b = run(tableCellText, poolB)
  if (a !== b) { console.log(`  结果不等价！${a} vs ${b}`); process.exitCode = 1; continue }
  for (const [fn, pool] of [[legacyCellText, poolA], [tableCellText, poolB]]) { run(fn, pool); run(fn, pool) }
  const t0 = [], t1 = []
  for (let r = 0; r < 20; r++) {
    let s = performance.now(); run(legacyCellText, poolA); t0.push(performance.now() - s)
    s = performance.now(); run(tableCellText, poolB); t1.push(performance.now() - s)
    s = performance.now(); run(tableCellText, poolB); t1.push(performance.now() - s)
    s = performance.now(); run(legacyCellText, poolA); t0.push(performance.now() - s)
  }
  const m0 = median(t0), m1 = median(t1)
  console.log(`${String(paras).padStart(2)} 段 × ${String(runs).padStart(2)} 符 × ${String(reps).padStart(3)} 趟  ` +
    `${m0.toFixed(1)} → ${m1.toFixed(1)}ms  降幅 ${(((m0 - m1) / m0) * 100).toFixed(1)}%  | 逐字符 hash 一致 ✓`)
}
