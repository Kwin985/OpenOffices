// v0.213 守卫：钉住 pptx 保真账的模块副本目录 materialize 不删任何文件。
// 根因链：跑批脚本反复 materialize 同一目录，原实现 fs.rmSync(recursive) 每次删
// 130 文件，沙箱守卫按 turn 累计（SAFE_DELETE_BULK_CONFIRM_REQUIRED，阈值 50）
// 拦下 → 子脚本 REPORT|失败 → 跑批「跑成 0/2」→ 外层 FAIL。单跑文件少不触发，
// 表现为连续多轮「单跑 2/2、全量 0/2」的假失败。
// 修复：materialize 只覆盖写、不删除。git show 原始字节覆盖会自动擦掉上一轮
// injectProbe 注入的探针，下一轮重新注入不会重复——这是否决「缓存复用」的关键。
// 跑法：node scripts/test-pptx-materialize.mjs（纯 Node 内置模块）
import { readFileSync } from 'node:fs'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const src = read('../scripts/fidelity-report-pptx.mjs')
const runner = read('../scripts/test-pptx-corpus.mjs')

// ── ① materialize 不删任何文件 ───────────────────────────────
const body = src.slice(src.indexOf('function materialize'), src.indexOf('const RECORDER'))
const codeLines = body.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
check('materialize 无 rmSync 调用', !/rmSync\s*\(/.test(codeLines))
check('materialize 无 unlink/unlinkSync 调用', !/unlinkSync\s*\(|fs\.unlink\s*\(/.test(codeLines))
check('materialize 无 rmdir 调用', !/rmdirSync\s*\(/.test(codeLines))
check('materialize 只 mkdir + 覆盖写', /mkdirSync\(dir/.test(body) && /writeFileSync\(path\.join\(dir, rel\), bytes\)/.test(body))
check('注释写明沙箱守卫根因', /SAFE_DELETE_BULK_CONFIRM_REQUIRED/.test(src))
check('注释写明按 turn 累计阈值 50', /turn 累计删除数[\s\S]{0,80}阈值 50|scope.*turn.*50/.test(src))
check('注释写明覆盖写会擦掉探针', /覆盖[\s\S]{0,200}探针|原始字节覆盖[\s\S]{0,120}注入/.test(src))

// ── ② 诊断改动仍在（SKIP 行可见）──────────────────────────────
check('跑批测试提取 SKIP 行', /startsWith\('SKIP'\)/.test(runner))

// ── ③ 账本口径未变（脚本仍从 REF 取源码、仍注入探针）─────────
check('materialize 仍从 git show REF 取副本', /git\(\['show', `\$\{REF\}:\$\{f\}`\]\)/.test(body))
check('探针注入仍在', /injectProbe/.test(src))
check('注入目标仍是 MOD_DIR 的 pptx-import.ts', /injectProbe\(path\.join\(MOD_DIR, 'pptx-import\.ts'\)/.test(src))

console.log(`pptx-materialize: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
