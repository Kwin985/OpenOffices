// v0.203：pptx 多输入对照的口径与自包含验证。
//
// 最关键的一条：stdout 的「已查问」是**字面次数**，拿它除以「分母对」会算出
// 113.1% 这种荒唐数。汇总必须用 JSON 里的 distinct 对
// （consultedPairs / meaningfulPairs）。这个测试把口径钉死，并确认批量跑批
// 不覆盖 docs/ 主账本、报告只写文件名。
//
// 跑法：node scripts/test-pptx-corpus.mjs

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const cli = path.join(REPO, 'node_modules/vite-node/dist/cli.mjs')
const script = path.join(REPO, 'scripts/pptx-corpus.mjs')
const source = path.join(REPO, 'scripts/pptx-corpus.mjs')
const MAIN = path.join(REPO, 'docs/pptx-fidelity.md')
const TEST_OUT = 'tmp/pptx-corpus-test/report.md'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const md5 = (p) => createHash('md5').update(fs.readFileSync(p)).digest('hex')

// ---- 1. 口径写进代码：distinct 对而非字面次数 ----
const src = fs.readFileSync(source, 'utf8')
check('汇总用 coverage.consultedPairs', src.includes("j.coverage.consultedPairs"))
check('汇总用 totals.meaningfulPairs', src.includes("j.totals.meaningfulPairs"))
check('合计分子是 consultedPairs', src.includes("sum('consultedPairs')"))
check('报告写明字面次数不可混用', src.includes('混用会算出 >100%'))
check('报告写明 18% 不是读手退化', src.includes('不能读成「读手退化」'))
check('外部真件有独立出口', src.includes("argv.indexOf(`--${name}`)") && src.includes('CORPUS'))
check('单件账本落 tmp 不覆盖主账本', src.includes("tmp/pptx-corpus-report"))

// ---- 2. 行为：自包含跑 2 份（不带 --no-gen，干净 clone 也能跑） ----
const before = fs.existsSync(MAIN) ? md5(MAIN) : ''
const r = spawnSync(process.execPath, [
  cli, 'scripts/pptx-corpus.mjs', '--limit', '2', '--out', TEST_OUT,
], { cwd: REPO, encoding: 'utf8', timeout: 420_000, maxBuffer: 16 * 1024 * 1024 })
const text = (r.stdout || '') + (r.stderr || '')
// 诊断：SKIP 行才是真因，但它在 stdout 靠前、slice(-2) 只会截到末尾的汇总，
// 把「跑成 0/2」显示出来却看不到为什么。全量长跑里子脚本偶发 0/2 时，
// 这一行能区分「夹具没生成」「assertAtRef 挡了」「tmp 目录冲突」三种情况。
const skips = text.split('\n').filter((l) => l.startsWith('SKIP'))
const detail = skips.length ? skips.join(' | ').slice(0, 400)
  : text.trim().split('\n').slice(-3).join(' ').slice(0, 160)
check('跑批跑成', r.status === 0, detail)
check('两份都跑成', /跑成 2\/2/.test(r.stdout || ''))
const total = (r.stdout || '').match(/合计 (\d+)\/(\d+)（([\d.]+)%）/)
check('输出有合计三元组', !!total)
if (total) {
  const [n, d, p] = [Number(total[1]), Number(total[2]), Number(total[3])]
  check('合计分子不超过分母（口径没串）', n <= d, `${n}/${d}`)
  check('合计百分比在 0–100', p >= 0 && p <= 100, `${p}%`)
  check('合计百分比与分子分母相符', Math.abs((n / d) * 100 - p) < 0.15)
}
const report = path.join(REPO, TEST_OUT)
if (fs.existsSync(report)) {
  const md = fs.readFileSync(report, 'utf8')
  check('报告有汇总 / 逐份 / 反复没被查问 / 边界四节',
    ['## 汇总', '## 逐份', '## 反复没被查问', '## 边界'].every((s) => md.includes(s)))
  check('报告写明分母不同不可并排比', md.includes('都不可直接比较'))
  check('报告只写文件名不带绝对路径', !/[A-Za-z]:[\\/]OpenOffices/.test(md))
} else {
  check('报告落盘', false)
}
check('主账本逐字节未动', fs.existsSync(MAIN) && md5(MAIN) === before)

console.log(`pptx-corpus: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
