// v0.210 守卫：钉住真件回归的数字与「主账本不被覆盖」的界线。
// 真件报告是手写汇总，跑批脚本会在未来复跑；这里只钉「数字在场 + 边界声明在场 +
// 主账本仍是夹具口径」，任一侧被改动即红，防止有人拿真件结果覆盖主账本或悄悄改数。
// 跑法：node scripts/test-real-corpus.mjs（纯 Node 内置模块）
import { readFileSync } from 'node:fs'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const report = read('../docs/real-corpus-report.md')
const corpus = read('../docs/real-corpus.md')
const rt = read('../docs/fidelity-roundtrip.json')
const fidelity = read('../docs/fidelity.json')
const sheet = read('../docs/sheet-roundtrip.json')

// ── ① 真件数字在场 ──────────────────────────────────────────
check('docx 真件往返 68.5% 在场', /673（68\.5%）/.test(report))
check('docx 真件保真 85.8% 在场', /85\.8%/.test(report))
check('xlsx 真件 32.0% 在场', /33（32\.0%）/.test(report))
check('逐份表 8 份全跑成', /跑成 \| 8/.test(corpus) && /跳过 \| 0/.test(corpus))

// ── ② 四族定性结论在场 ──────────────────────────────────────
// 表格里族名被反引号包着、判定在下一列，按「族名在场 + 该行判定在场」两半检查。
for (const [name, key, verdict] of [
  ['cols 假红', 'cols\\|num/space', '假红，不碰'],
  ['docGrid 单独立项', 'docGrid\\|charSpace', '需单独立项'],
  ['bookmark 引用图不碰', 'bookmarkStart/End\\|id/name', '按纪律不碰'],
  ['kern 单独立项', 'kern\\|val', '需单独立项'],
]) {
  const row = report.split('\n').find((l) => l.includes('`' + key + '`'))
  check(name + ' 在场', !!row && row.includes(verdict), row ? row.slice(0, 90) : '未找到族行')
}

// ── ③ 主账本仍是夹具口径，没被真件覆盖 ──────────────────────
check('往返主账本仍是 548/619', /"kept"\s*:\s*548/.test(rt) || /548/.test(rt))
check('保真主账本 modules 字段在', /"modules"/.test(fidelity))
check('xlsx 主账本仍是 65 对地板', /"total"\s*:\s*65/.test(sheet) || /65/.test(sheet))
check('报告声明未覆盖主账本', /主账本.*未被覆盖|一律未被覆盖/.test(report))

// ── ④ 隐私边界 ──────────────────────────────────────────────
check('报告只写副本编号不写原始路径', !/C:\\Users|Desktop/.test(report) && !/C:\\Users|Desktop/.test(corpus))

console.log(`real-corpus: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
