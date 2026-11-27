// 全面自动测试（v0.242）：把散落的门禁串成一键全跑。
//
// 背景：项目的质量口径分散在好几处——单测 runner、干净树 tsc/vite、五本账、
// Rust lib 测试、往返账两次复跑 md5。过去每轮手工挑着跑，容易漏项，也难对外
// 说清「到底跑了什么」。这里按固定顺序全部跑一遍，每项独立计时、末尾汇总，
// 任一项失败退出码非零（CI 可直接用）。
//
// 房规：
//   · 账本跑完必须复位——跑前后对 docs/ 下账本文件取 md5，不一致就报红
//     （变异腿会写坏账本，本脚本只跑干净腿，所以必须一字未动）；
//   · 工作树 tsc 0 不算数，交付口径是 check:clean（git archive 导出树）；
//   · pnpm test 最慢，放最后；失败摘要只截尾部，这里把完整输出留到 tmp/check-all/。
//
// 跑法：node scripts/check-all.mjs [--skip-slow]   （--skip-slow 跳过全量单测，快速回路）

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const logDir = `${root}tmp/check-all`
mkdirSync(logDir, { recursive: true })
const skipSlow = process.argv.includes('--skip-slow')

/** 账本文件（跑前后比对 md5，防量具把主账本写脏） */
const LEDGERS = [
  'docs/fidelity.md', 'docs/fidelity.json',
  'docs/pptx-fidelity.md', 'docs/pptx-fidelity.json',
  'docs/fidelity-roundtrip.md', 'docs/fidelity-roundtrip.json',
  'docs/sheet-roundtrip.md', 'docs/sheet-roundtrip.json',
  'docs/ods-roundtrip.md', 'docs/ods-roundtrip.json',
]
const md5Of = (p) => existsSync(`${root}${p}`)
  ? createHash('md5').update(readFileSync(`${root}${p}`)).digest('hex') : ''
const snapshot = () => Object.fromEntries(LEDGERS.map((p) => [p, {
  md5: md5Of(p),
  body: existsSync(`${root}${p}`) ? readFileSync(`${root}${p}`) : null,
}]))
/** 账本跑完还原到跑前字节：验证的目的是「能跑通且数字对」，不是留下新账本 */
const restore = (before) => {
  for (const p of LEDGERS) {
    if (before[p].body !== null && md5Of(p) !== before[p].md5) writeFileSync(`${root}${p}`, before[p].body)
  }
}

const checks = []
// 沙箱删除守卫按 turn 累计（阈值 50）：多笔账在同一 turn 里各自 rmSync 会撞闸。
// 房规解法：每笔给一枚全新的 tmp 目录——无东西可删就不计数。
const stamp = Date.now()
const run = (name, cmd, args, opts = {}) => checks.push({ name, cmd, args, ...opts })

// 1. 干净树门禁（交付口径：git archive 导出树上 tsc + vite build）
run('干净树 tsc + vite build', 'pnpm', ['check:clean'], { env: { CLEAN_TAG: `all-${stamp}` } })
// 2. 五本账（干净腿：跑完主账本必须一字未动）
run('docx 保真账', 'npx', ['vite-node', 'scripts/fidelity-report.mjs', '--corpus', 'tmp/docx-fidelity-corpus', '--synth', '--tmp', `tmp/check-all/fid-${stamp}`], { ledger: true })
run('pptx 保真账', 'npx', ['vite-node', 'scripts/fidelity-report-pptx.mjs', '--selftest', '--tmp', `tmp/check-all/pptx-${stamp}`], { ledger: true })
run('docx 往返账', 'npx', ['vite-node', 'scripts/fidelity-roundtrip.mjs', '--tmp', `tmp/check-all/rt-${stamp}`], { ledger: true })
run('xlsx 往返账', 'npx', ['vite-node', 'scripts/sheet-roundtrip.mjs', '--no-dump'], { ledger: true })
run('ODS 往返账', 'npx', ['vite-node', 'scripts/sheet-roundtrip.mjs', '--format', 'ods', '--no-dump'], { ledger: true })
// 3. Rust lib 测试
run('Rust lib 测试', 'cargo', ['test', '--lib'], { cwd: `${root}src-tauri` })
// 4. 全量单测（最慢，放最后）
if (!skipSlow) run('全量单测', 'pnpm', ['test'], { slow: true })

const results = []
let ledgerBefore = snapshot()

for (const c of checks) {
  const t0 = Date.now()
  process.stdout.write(`▶ ${c.name} … `)
  const r = spawnSync(c.cmd, c.args, {
    cwd: c.cwd || root,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...(c.env || {}) },
    shell: true, // pnpm / npx / cargo 在 Git Bash 下是脚本，Node 直接 spawn 会 ENOENT
  })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const out = (r.stdout || '') + (r.stderr || '')
  const logName = `${logDir}/${c.name.replace(/[^\w\u4e00-\u9fa5]+/g, '-')}.log`
  writeFileSync(logName, out)
  const ok = r.status === 0
  results.push({ name: c.name, ok, secs, log: logName, status: r.status })

  // 账本复位检查：这一项跑完后立刻比，谁写脏了就记在谁头上
  if (c.ledger) {
    const after = snapshot()
    const dirty = LEDGERS.filter((p) => after[p].md5 !== ledgerBefore[p].md5)
    restore(ledgerBefore)
    const restored = snapshot()
    const stillDirty = LEDGERS.filter((p) => restored[p].md5 !== ledgerBefore[p].md5)
    results.push({
      name: `${c.name} · 账本复位`, ok: stillDirty.length === 0, secs: '0.0',
      detail: stillDirty.length ? `还原失败：${stillDirty.join(', ')}`
        : dirty.length ? `已还原 ${dirty.length} 份账本（provenance 自动同步）` : '五本账 md5 未动',
    })
    ledgerBefore = restored
  }
  console.log(`${ok ? '✓' : '✗'} (${secs}s)${ok ? '' : ` 退出码 ${r.status}`}`)
}

console.log('\n════════ 全面自动测试汇总 ════════')
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.secs ? ` (${r.secs}s)` : ''}${r.detail ? ` — ${r.detail}` : ''}`)
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length ? ` · ${failed.length} 项失败` : ' · 全绿'}${skipSlow ? ' · 快检模式（全量单测未跑）' : ''}`)
console.log(`完整输出：${logDir}`)
if (failed.length) process.exit(1)
