// v0.207 守卫：钉住「xlsx 行高载荷是整数像素」这条数据契约，防止 roadmap:173 的
// 历史假红被当成真缺陷、引出一套改字节的 post-pack 补丁。
//
// 证据链（三处必须同时成立，缺一则这条判断失效）：
//   ① 前端写手 univer-io.ts 把行高 Math.round 后写进 RowDatum.h；
//   ② 前端 RowDatum 类型只有 h/hd 两个整数字段，读侧的 ah（自适应渲染高度）不回流；
//   ③ Rust 写手注释不再声称「非整被截断、字节漂移」。
// 跑法：node scripts/test-xlsx-row-height.mjs（纯 Node 内置模块，不依赖未入库文件）
import { readFileSync } from 'node:fs'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
// core.autocrlf=true 下 checkout 的文件是 CRLF，按 '\n' 的匹配先归一（v0.206 教训）
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const io = read('../src/lib/univer-io.ts')
const rs = read('../src-tauri/src/xlsx.rs')
const road = read('../docs/roadmap.md')

// ── ① 前端写侧 round ────────────────────────────────────────
check('写侧 RowDatum.h 用 Math.round(px)', /rowData\[k\] = \{ h: Math\.round\(px\) \}/.test(io))
check('RowDatum 类型只有整数字段 h/hd', /type RowDatum = \{ h\?: number; hd\?: number \}/.test(io))

// ── ② 读侧 ah 不回流进载荷 ──────────────────────────────────
// 读侧把 ah 收进 rowHeights 是给界面态的；界面再写出时经写侧 round 又变整数。
// 断言读写两路分工没被改掉：读侧仍有 `v.ia ? v.ah : v.h`，写侧仍只写 h。
check('读侧仍区分自适应行 ah', /const px = v\?\.ia \? v\.ah : v\?\.h/.test(io))
check('写侧不写 ah', !/h: [^}]*\.ah/.test(io.slice(io.indexOf('type RowDatum'), io.indexOf('type RowDatum') + 2600)))

// ── ③ Rust 侧注释与代码 ─────────────────────────────────────
const rsWindow = rs.slice(rs.indexOf('列宽/行高：载荷即像素'), rs.indexOf('列宽/行高：载荷即像素') + 900)
check('Rust 注释已澄清 as u32 不截值', /as u32` \*\*不会截值\*\*/.test(rsWindow))
check('Rust 注释指向前端 round 数据契约', /Math\.round\(px\)/.test(rsWindow))
// 旧句只在「旧注释说「…」」的历史引用里出现是允许的；判据是它不再作为当前结论
// （即不出现在"这一路不是无损的"这类当下陈述中）。
check('Rust 注释不再把漂移当当前结论', !/不是无损的/.test(rsWindow))
check('写手仍是 set_row_height_pixels', /set_row_height_pixels\(\*r, \(\*px as u32\)\.max\(1\)\)/.test(rs))

// ── ④ roadmap 就地澄清 ──────────────────────────────────────
check('roadmap:173 已标注澄清', /显式行高在字节上会漂[\s\S]{0,400}v0\.207/.test(road))

console.log(`xlsx-row-height: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
