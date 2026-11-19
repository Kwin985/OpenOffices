// v0.212 守卫：钉住 run-tests 的每份超时 ≥ 该测试内部 spawn 的超时。
// 否则外层先 SIGTERM、内层还在等，表现为「全量末尾某份 FAIL、单跑全 PASS」，
// 连续几轮污染门禁数字（pptx-corpus / collab 踩过）。
// 跑法：node scripts/test-runner-timeout.mjs（纯 Node 内置模块）
import { readFileSync } from 'node:fs'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const runner = read('../scripts/run-tests.mjs')
// 从 runner 的 TIMEOUTS 表里取值
const toOf = (name) => {
  const m = runner.match(new RegExp(`\\['${name}',\\s*(\\d+(?:_\\d+)*)\\],?`))
  return m ? Number(m[1].replace(/_/g, '')) : null
}
// 从各测试内部 spawnSync 的 timeout 取值
const innerOf = (file) => {
  const src = read(`../scripts/${file}`)
  const m = src.match(/timeout:\s*(\d+(?:_\d+)*)/)
  return m ? Number(m[1].replace(/_/g, '')) : null
}
const DEFAULT = 180_000
check('runner 有 per-test 超时表', /const TIMEOUTS = new Map/.test(runner))
check('runner 用 TIMEOUTS.get 而非写死 180s', /TIMEOUTS\.get\(f\) \?\? 180_000/.test(runner))

for (const [file, name] of [
  ['test-pptx-corpus.mjs', 'test-pptx-corpus.mjs'],
  ['test-collab.mjs', 'test-collab.mjs'],
]) {
  const outer = toOf(name) ?? DEFAULT
  const inner = innerOf(file)
  check(`${file} 内部超时可读`, inner !== null, `inner=${inner}`)
  check(`${file} 外层 ≥ 内层`, outer >= (inner ?? 0), `outer=${outer} inner=${inner}`)
}
check('pptx-corpus 超时按内部声明放宽', (toOf('test-pptx-corpus.mjs') ?? 0) > DEFAULT)
check('collab 超时按内部声明放宽', (toOf('test-collab.mjs') ?? 0) > DEFAULT)

console.log(`runner-timeout: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
