// v0.236 守卫：邮件合并纯函数（CSV 解析 + «列名» 占位符替换）。
// 跑法：npx vite-node scripts/test-mail-merge.mjs

import { parseMergeSource, mergeFieldsOf, mergeOne, mergeAll } from '../src/lib/templates.ts'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

// CSV 解析
const basic = parseMergeSource('姓名,部门,分数\n张三,研发,90\n李四,市场,85')
check('列名', JSON.stringify(basic.fields) === JSON.stringify(['姓名', '部门', '分数']), JSON.stringify(basic.fields))
check('行数', basic.rows.length === 2)
check('首行数据', basic.rows[0]['姓名'] === '张三' && basic.rows[0]['分数'] === '90')
check('无告警', basic.warnings.length === 0)

// 引号内的逗号与转义
const quoted = parseMergeSource('name,note\n"张三","喜欢,编程"\n"李四","说""你好"""')
check('引号内逗号不拆列', quoted.rows[0].note === '喜欢,编程', JSON.stringify(quoted.rows[0]))
check('双引号转义', quoted.rows[1].note === '说"你好"', JSON.stringify(quoted.rows[1]))

// 制表符
const tsv = parseMergeSource('姓名\t部门\n张三\t研发', true)
check('TSV 分隔', tsv.fields.join() === '姓名,部门' && tsv.rows[0]['部门'] === '研发', JSON.stringify(tsv))

// 空数据 / 只有表头
check('空文本 → 空源', parseMergeSource('').rows.length === 0)
check('只有表头 → 零行', parseMergeSource('姓名,部门').rows.length === 0)
// 缺列/多列告警
const ragged = parseMergeSource('a,b\n1\n2,3,4')
check('缺列告警', ragged.warnings.some((w) => w.includes('列数不足')), JSON.stringify(ragged.warnings))
check('多列告警', ragged.warnings.some((w) => w.includes('列数超出')), JSON.stringify(ragged.warnings))

// 占位符
check('找占位符（去重、保序）', JSON.stringify(mergeFieldsOf('«姓名» 你好 «部门» «姓名»')) === JSON.stringify(['姓名', '部门']))
check('没占位符返回空', mergeFieldsOf('普通正文').length === 0)
check('替换一行', mergeOne('«姓名»在«部门»', { 姓名: '张三', 部门: '研发' }) === '张三在研发')
check('没提供的值保留占位符', mergeOne('«姓名»和«未知»', { 姓名: '张三' }) === '张三和«未知»')

// 批量
const tpl = '尊敬的«姓名»：您在«部门»的考核得分为«分数»。'
const all = mergeAll(tpl, basic)
check('批量行数', all.results.length === 2)
check('首份内容', all.results[0] === '尊敬的张三：您在研发的考核得分为90。', all.results[0])
check('次份内容', all.results[1] === '尊敬的李四：您在市场的考核得分为85。', all.results[1])
check('无缺失字段', all.missing.length === 0)
const miss = mergeAll('«姓名» / «电话»', basic)
check('缺失字段如实报', miss.missing.join() === '电话', JSON.stringify(miss.missing))
check('缺失字段保留占位', miss.results[0] === '张三 / «电话»', miss.results[0])


const fs = await import('node:fs')
const ui = fs.readFileSync(new URL('../src/components/DocEditor.tsx', import.meta.url), 'utf8')
check('工具条有「合并」入口', ui.includes("btn('合并'"))
check('面板有解析/插入/批量三入口', ui.includes('onClick={mergeSource}') && ui.includes('插入 «列» 占位符') && ui.includes('onClick={() => void mergeExport()}'))
check('批量生成选目录写 odoc', ui.includes('pickDirectory()') && ui.includes('.odoc') && ui.includes('writeText('))
check('每份带 ODOC_HEADER 与最新 meta', /ODOC_HEADER, content, meta: metaRef\.current/.test(ui))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n邮件合并：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
