// v0.199：多夹具对照的「口径假红」分档 + pptx 账外部输入不覆盖主账本。
//
// 跑法：node scripts/test-corpus-alias.mjs
// 纯函数走行为断言；两处接线是产品脚本里的字符串契约，用源码级断言钉住
// （与仓库其余 test 脚本同一形态，改写法时不用追着改一整串字面量）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { aliasNote, isKnownAlias, aliasKeys } from './lib/known-alias.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}

// ---- 1. 名单本身：只收已逐对诊断过的同义表示 ----
const keys = aliasKeys()
check('名单恰好 4 枚', keys.length === 4, `实际 ${keys.length}`)
for (const k of [
  'tblLook|firstRow',
  'tblLook|lastRow',
  'tblLook|firstColumn',
  'tblLook|lastColumn',
]) {
  check(`${k} 命中`, isKnownAlias(k))
  check(`${k} 说明提到 w:val`, /w:val/.test(aliasNote(k)))
}
for (const k of ['trHeight|val', 'tblLook|val', 'bodyPr|anchor', '']) {
  check(`${k || '(空)'} 不误命中`, !isKnownAlias(k))
  check(`${k || '(空)'} 说明为空`, aliasNote(k) === '')
}

// ---- 2. 对照报告真的把名单接进去了 ----
const corpus = readFileSync(`${root}scripts/roundtrip-corpus.mjs`, 'utf8')
check('roundtrip-corpus import 名单', corpus.includes("from './lib/known-alias.mjs'"))
check('报告表头有口径列', /\| 对 \| 掉了的份数 \| 值变的份数 \| 口径 \|/.test(corpus))
check('报告用 aliasNote 标注', corpus.includes('aliasNote(k)'))
check('报告统计 aliasHit', corpus.includes('keys.filter(isKnownAlias)'))
check('报告说明跨夹具复现不等于真丢', corpus.includes('跨夹具复现 ≠ 真丢'))

// ---- 3. pptx 账：外部语料默认落 tmp，主账本路径仍是 fixture mode ----
const pptx = readFileSync(`${root}scripts/fidelity-report-pptx.mjs`, 'utf8')
check('定义了 EXTERNAL 判定', /const EXTERNAL = argv\.includes\('--corpus'\) \|\| argv\.includes\('--clist'\)/.test(pptx))
check('外部语料默认 out 是 tmp', /flag\('out', EXTERNAL \? 'tmp\/pptx-fidelity-corpus' : 'docs'\)/.test(pptx))
check('主账本仍可由 fixture mode 写 docs', pptx.includes("EXTERNAL ? 'tmp/pptx-fidelity-corpus' : 'docs'"))
check('EXTERNAL 定义在 OUT_DIR 之前', pptx.indexOf('const EXTERNAL') < pptx.indexOf('const OUT_DIR'))
check('corpus mode 报告有不可比说明', pptx.includes('not comparable') && pptx.includes('never overwrite the main ledger'))

console.log(`corpus-alias: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
console.log(`断言明细 ${ok.length + bad.length} 条`)
if (bad.length) process.exitCode = 1
