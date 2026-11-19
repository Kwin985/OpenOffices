// v0.211 守卫：钉住 xlsx styles 架构限制的口径分档与「夹具账不受影响」的界线。
// 跑法：node scripts/test-xlsx-styles-caveats.mjs（纯 Node 内置模块）
import { readFileSync } from 'node:fs'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const src = read('../scripts/sheet-roundtrip.mjs')
const fixture = read('../docs/sheet-roundtrip.md')
// 不读 tmp/real-xlsx/：那是运行时产物，干净 clone 上没有，测试必须自包含。
// 真件口径改查已入库的 docs/real-corpus-report.md + 脚本里的 CAVEATS 内容。
const real = read('../docs/real-corpus-report.md')
const gap = read('../docs/xlsx-styles-gap.md')

// ── ① CAVEATS 登记了架构限制族 ──────────────────────────────
for (const key of ['fgColor|theme', 'fgColor|tint', 'cellStyle|name', 'tableStyle|name', 'numFmt|formatCode']) {
  check(`CAVEATS 登记 ${key}`, new RegExp(`'${key.replace(/\|/g, '\\|')}':`).test(src))
}

// ── ② 只标非 kept：修复当年夹具账被误标的坑 ─────────────────
check('渲染层只给非 kept 挂标注', /r\.bucket === 'kept' \? '' :/.test(src))
check('夹具账 cellStyle 未被误标', !/\| `cellStyle\|name`[^\n]*已知口径/.test(fixture))
check('夹具账 color|theme 未被误标', !/\| `color\|theme`[^\n]*已知口径/.test(fixture))

// ── ③ 真件口径已在入库报告与账本渲染层固化 ──────────────────
check('真件账 32% 已在报告在场', /33（32\.0%）/.test(real))
check('报告点名 styles.xml 60 对留 5 对', /60 对只留 5 对/.test(real))
check('账本渲染层支持逐对口径列', /\*\*已知口径\*\*：\$\{note\}/.test(src))
check('账本渲染层边界段有已知口径节', /\*\*已知口径\*\*（逐对诊断过/.test(src))

// ── ④ v0.212 补证：rgb 族是孤儿假红，不是架构限制 ────────────
check('fgColor|rgb 改判为孤儿样式', /fgColor\|rgb[\s\S]{0,100}孤儿样式/.test(src))
check('color|rgb 定性非架构限制', /color\|rgb[\s\S]{0,120}非架构限制/.test(src))
check('indexed 定性点名 crate 无 Indexed', /Indexed 变体/.test(src))
check('诊断文档有各节 rgb/theme 分布表', /fonts[\s\S]{0,200}dxfs[\s\S]{0,200}cellXfs/.test(gap))
check('诊断文档点了孤儿样式同族 co2', /孤儿列样式 `co2`|孤儿样式.*co2/.test(gap))

// ── ⑤ 诊断文档钉死根因与不可行方向 ──────────────────────────
for (const [name, re] of [
  ['整份搬 styles 不可行', /整份搬 styles\.xml[\s\S]{0,100}必错位|搬了必错位/],
  ['tint 任意浮点写不回', /任意浮点[\s\S]{0,80}写不回|无法逐字节还原/],
  ['cellStyle 无写 API', /只写死 Normal[\s\S]{0,60}无公共写 API/],
  ['索引丢失是根', /原始下标被丢弃|索引丢失/],
]) check(name + ' 在场', re.test(gap))

console.log(`xlsx-styles-caveats: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
