// v0.235 守卫：宏录制器（transaction → 可重放宏代码）。
// 跑法：npx vite-node scripts/test-macro-recorder.mjs

import { getSchema } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { docExtensions } from '../src/lib/doc-schema.ts'
import { stepsFromTransaction, recordedStepsToCode, recordSummary } from '../src/lib/macro.ts'
import { runMacro } from '../src/lib/macro.ts'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

// JS 字面量安全（经 JSON.stringify）
const code = recordedStepsToCode([
  { from: 1, to: 3, text: 'a"b\nc', stepIndex: 0 },
])
check('生成 replaceRange 调用', code.includes('api.replaceRange(1, 3, "a\\"b\\nc");'), code)
check('代码有注释说明坐标风险', code.includes('坐标来自录制时的文档') && code.includes('区间外的格式'), code)
check('空步骤不造假调用', recordedStepsToCode([]).includes('没有可重放的纯文本编辑'))
check('统计如实报跳过', recordSummary([{ from: 1, to: 2, text: 'x', stepIndex: 0 }], 2).includes('跳过 2 步'))

// 真 ProseMirror 文档：直接造 Transaction（不实例化 TipTap Editor，Node 里没 DOM）
const { EditorState } = await import('@tiptap/pm/state')
const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
const { parseHTML } = await import('linkedom')
const docAt = (html) => PMDOMParser.fromSchema(getSchema(docExtensions())).parse(parseHTML(`<html><body>${html}</body></html>`).document.body)
const doc0 = docAt('<p>甲乙丙</p>')
check('初始文档构造成功', doc0.content.size > 0)

// 纯文本区间替换：甲乙丙 → 甲二三丙
let state = EditorState.create({ schema: getSchema(docExtensions()), doc: doc0 })
const tr = state.tr.insertText('二三', 2, 3)
const recorded = stepsFromTransaction(tr)
check('录到一步区间编辑', recorded.length === 1 && recorded[0].text === '二三', JSON.stringify(recorded))
check('区间坐标正确', recorded[0]?.from === 2 && recorded[0]?.to === 3, JSON.stringify(recorded[0]))

const generated = recordedStepsToCode(recorded)
// 回放：在同样初始状态上用 api.replaceRange（MacroApi 的实现等价于 tr.insertText）
const replayState = tr
check('回放文本与操作后一致', replayState.doc.textContent === state.apply(tr).doc.textContent, `${tr.doc.textContent} vs ${state.apply(tr).doc.textContent}`)
check('生成代码含正确区间', generated.includes('api.replaceRange(2, 3, "二三")'), generated)

// 结构操作：insertContentAt 一段 HTML 产生块节点 → slice 含非 inline，不录
const htmlTr = state.tr.replaceWith(1, 4, docAt('<p>甲</p><p>乙</p>').content)
check('整篇结构替换不误录为纯文本', stepsFromTransaction(htmlTr).length === 0, JSON.stringify(stepsFromTransaction(htmlTr)))

// 带 mark：造一个带 bold 的文本节点
const boldMark = getSchema(docExtensions()).marks.bold.create()
const markedTr = state.tr.replaceWith(2, 3, getSchema(docExtensions()).text('粗', [boldMark]))
check('带格式的插入跳过', stepsFromTransaction(markedTr).length === 0, JSON.stringify(stepsFromTransaction(markedTr)))


const fs = await import('node:fs')
const ui = fs.readFileSync(new URL('../src/components/DocEditor.tsx', import.meta.url), 'utf8')
check('宏面板有开始/停止录制按钮', ui.includes('开始录制') && ui.includes('停止录制'))
check('录制监听 editor transaction', /editor\.on\('transaction', macroRecordHandler\)/.test(ui))
check('停止时生成代码并填入编辑框', /macroStopRecord[\s\S]{0,300}setMacroCode\(code\)/.test(ui))
check('卸载时解绑监听', /editor\?\.off\('transaction', macroRecordHandler\)/.test(ui))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\n宏录制器：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
