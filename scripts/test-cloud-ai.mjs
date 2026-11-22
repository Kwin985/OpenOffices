// v0.229 断言：Writer AI 面板的纯逻辑与调用形状（不联网、不消耗额度）。
//
// 真正的模型调用已用一次性探针实测过（models.list 14 个模型、chat 返回「收到」）；
// 这份守卫钉的是容易回归的静态规矩：system 消息必须是第一条、只走流式、
// 正文进 user 不进 system、错误码翻译、过长正文截断、面板的插入前形状。
//
// 跑法：npx vite-node scripts/test-cloud-ai.mjs

import fs from 'node:fs'

const { AI_ACTION_SYSTEM, AI_ACTION_LABEL, prepareAiSource, aiErrorMessage } = await import('../src/lib/cloud-ai.ts')

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (cond || !extra ? '' : ` — ${extra}`))

check('三个动作的提示词都是 system 规则，不含用户占位符', Object.values(AI_ACTION_SYSTEM).every((s) => !s.includes('${') && s.length > 10))
check('三个动作都有中文标签', Object.keys(AI_ACTION_LABEL).length === 3 && Object.values(AI_ACTION_LABEL).every(Boolean))
check('空白正文不外送', prepareAiSource('  \n\t ') === '')
check('过长正文截到 12000 字', prepareAiSource('甲'.repeat(20000)).length === 12000)
check('控制符被剥掉', prepareAiSource('甲\u0000乙\u001f丙') === '甲乙丙')
check('auth_ 不诱导重新登录', aiErrorMessage({ error: { code: 'auth_origin_mismatch' } }).includes('域名或授权不匹配'))
check('quota_ 给出稍后重试', aiErrorMessage({ error: { code: 'quota_exceeded' } }).includes('稍后'))
check('stream 中断保留已有内容', aiErrorMessage({ error: { code: 'gateway_stream_interrupted' } }).includes('已保留已有内容'))
check('request_ 建议换模型', aiErrorMessage({ error: { code: 'request_bad_model' } }).includes('换一个模型'))

const src = fs.readFileSync(new URL('../src/lib/cloud-ai.ts', import.meta.url), 'utf8')
check('只发 SDK 原生调用，不手拼 /.cloud/ 路径', !/fetch\s*\(\s*['"`]\/\.cloud\//.test(src) && src.includes('@tencent-ai/workbuddy-cloud-sdk'))
check('chat 调用一定有 system 且排第一', /messages:\s*\[\s*\{\s*role:\s*'system',\s*content:\s*AI_ACTION_SYSTEM\[action\]\s*\},\s*\{\s*role:\s*'user'/.test(src))
check('chat 调用带 stream: true', /chat\.completions\.create\(\{[\s\S]*?stream:\s*true/.test(src))
check('一次性的三个动作不传 conversationId', !src.includes('conversationId'))

const ui = fs.readFileSync(new URL('../src/components/DocEditor.tsx', import.meta.url), 'utf8')
check('工具条有 AI 入口', ui.includes("btn('AI', openAi"))
check('打开面板时抓的是当前选区', /editor\.state\.doc\.textBetween\(from, to/.test(ui))
check('生成中可以停止（AbortController）', ui.includes('aiAbort.current?.abort()') && src.includes('signal'))
check('未生成出结果时插入按钮禁用', ui.includes('onClick={aiInsert} disabled={!aiOut.trim()}'))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nWriter AI：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
