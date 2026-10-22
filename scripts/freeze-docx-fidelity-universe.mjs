// 一次性：把 docs/fidelity.json（v0.138 时代那一跑，313 件真件语料）冻结成
// docs/fidelity-universe.json —— 合成语料生成器的固定输入。
// 冻结后 fidelity.json 会被后续重跑覆盖，宇宙留在库里保证「同一份语料可重建」。
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const d = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/fidelity.json'), 'utf8'))

const bucketOf = new Map()
for (const lst of ['consulted', 'neverConsulted', 'noise']) {
  for (const [k, v] of d[lst]) bucketOf.set(k, { bucket: lst, count: v })
}

const pairs = [...bucketOf.entries()]
  .map(([pair, { bucket, count }]) => ({ pair, count, bucket }))
  .sort((a, b) => (a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : 0))

const universe = {
  what: 'DOCX 属性级覆盖率量具的「宇宙」：旧跑（313 件真件语料）见过的全部 element|attribute 对及其字面计数',
  source: 'docs/fidelity.json @ 040dffb（v0.138 时代那一跑；此后 fidelity.json 会被重跑覆盖，宇宙由此文件固定）',
  scale: 100,
  scaleNote: '合成语料按 count/100 均匀缩放（max(1, round(c/100))）：按对覆盖率不受影响；按字面覆盖率与旧值同权重结构，偏差约 0.9%（缩放取整所致），fidelity.md 已如实标注',
  measured: d.measured,
  oldTotals: d.totals,
  oldCoverage: d.coverage,
  pairs,
}

fs.writeFileSync(path.join(REPO, 'docs/fidelity-universe.json'), JSON.stringify(universe, null, 2) + '\n', 'utf8')
console.log(`宇宙冻结：${pairs.length} 对，字面和 ${pairs.reduce((a, p) => a + p.count, 0)}`)
