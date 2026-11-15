// v0.205：Impress 动画刷（纯函数 + UI 接线）。
// 跑法：npx vite-node scripts/test-ppt-anim-brush.mjs

import fs from 'node:fs'
import { emptyDeck, newSlide, pickSlideAnim, applySlideAnim, slideAnimSummary } from '../src/lib/ppt.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)

function deck() {
  const d = emptyDeck()
  const a = newSlide('bullets')
  a.title = '源页'
  a.body = '甲\n乙'
  a.notes = '不该被刷走'
  a.transition = 'fade'
  a.anim = 'wipe'
  a.animDir = 'right'
  a.exitAnim = 'fade'
  a.autoAdvance = 5
  a.advClick = false
  a.animDur = 700
  a.animOrder = ['l0', 'l1']
  a.shapes = [{ id: 'src', kind: 'text', x: 0.1, y: 0.1, w: 0.3, h: 0.2, text: '源形状' }]
  const b = newSlide('title')
  b.title = '目标一'
  b.body = '丙'
  b.transition = 'push'
  b.anim = 'fade'
  b.notes = '保留'
  b.shapes = [{ id: 'dst', kind: 'text', x: 0.2, y: 0.2, w: 0.3, h: 0.2, text: '目标形状' }]
  const c = newSlide('blank')
  c.title = '目标二'
  d.slides = [a, b, c]
  return d
}

// ---- 1. 只取动画字段 ----
const d = deck()
const anim = pickSlideAnim(d.slides[0])
eq('七枚字段', Object.keys(anim).length, 7)
eq('切页', anim.transition, 'fade')
eq('要点动画', anim.anim, 'wipe')
eq('方向', anim.animDir, 'right')
eq('退场', anim.exitAnim, 'fade')
eq('自动换页', anim.autoAdvance, 5)
eq('点击不换页', anim.advClick, false)
eq('时长', anim.animDur, 700)
check('不取内容字段', !('title' in anim) && !('body' in anim) && !('notes' in anim) &&
  !('shapes' in anim) && !('animOrder' in anim) && !('id' in anim) && !('bg' in anim))

// ---- 2. 刷到单页：不可变 + 内容保留 ----
const before = JSON.stringify(d)
const r = applySlideAnim(d, anim, [1])
check('返回新 deck', r !== d)
check('原 deck 一寸未动', JSON.stringify(d) === before)
check('未刷的页保持原引用', r.slides[0] === d.slides[0] && r.slides[2] === d.slides[2])
check('目标页换了引用', r.slides[1] !== d.slides[1])
const t = r.slides[1]
eq('目标页切页被刷', t.transition, 'fade')
eq('目标页要点动画被刷', t.anim, 'wipe')
eq('目标页方向被刷', t.animDir, 'right')
eq('目标页退场被刷', t.exitAnim, 'fade')
eq('目标页自动换页被刷', t.autoAdvance, 5)
eq('目标页点击标志被刷', t.advClick, false)
eq('目标页时长被刷', t.animDur, 700)
eq('目标页标题没动', t.title, '目标一')
eq('目标页正文没动', t.body, '丙')
eq('目标页备注没动', t.notes, '保留')
check('目标页形状没动', t.shapes?.[0]?.id === 'dst' && t.shapes?.[0]?.text === '目标形状')
check('不复制源页 animOrder', !t.animOrder || t.animOrder.length === 0)
check('不复制源页形状', t.shapes?.[0]?.text !== '源形状')

// ---- 3. 刷空设置会清掉目标页旧值 ----
const emptyAnim = pickSlideAnim(d.slides[2])
const cleared = applySlideAnim(d, emptyAnim, [0, 1])
check('空设置确实清空目标页', cleared.slides[1].transition === undefined && cleared.slides[1].anim === undefined)
eq('未刷的第三页不动', cleared.slides[2].title, '目标二')
check('清空的页仍是新引用', cleared.slides[1] !== d.slides[1])

// ---- 4. 多目标 / 空目标 / 越界 ----
const multi = applySlideAnim(d, anim, [0, 2])
eq('多目标：第三页被刷', multi.slides[2].transition, 'fade')
eq('多目标：未列的第二页不动', multi.slides[1].transition, 'push')
const none = applySlideAnim(d, anim, [])
check('空目标仍返回新 deck', none !== d)
check('空目标各页原引用', none.slides.every((s, i) => s === d.slides[i]))
const oob = applySlideAnim(d, anim, [99, -1])
check('越界目标无害', oob.slides.every((s, i) => s === d.slides[i]))

// ---- 5. 摘要 ----
check('摘要列出切页与时长', /淡入/.test(slideAnimSummary(anim)) && /700ms/.test(slideAnimSummary(anim)))
check('空设置摘要是明确提示', /没有动画设置/.test(slideAnimSummary(emptyAnim)))

// ---- 6. UI 接线（源码级，防止只写纯函数忘了接） ----
const ui = fs.readFileSync(new URL('../src/components/PptEditor.tsx', import.meta.url), 'utf8')
check('导入 pickSlideAnim', ui.includes('pickSlideAnim'))
check('导入 applySlideAnim', ui.includes('applySlideAnim'))
check('有 animBrush 状态', /useState<SlideAnimFields \| null>/.test(ui))
check('工具栏有动画刷按钮', ui.includes('动画刷'))
check('缩略图点击走刷子判断', /if \(animBrush\)[\s\S]{0,120}brushApply\(/.test(ui))
check('替换走 edit 统一标脏', /brushApply[\s\S]{0,300}edit\(/.test(ui))
check('Esc 能退出刷子模式', /Escape[\s\S]{0,400}setAnimBrush\(null\)/.test(ui))
const model = fs.readFileSync(new URL('../src/lib/ppt.ts', import.meta.url), 'utf8')
const fnBody = model.slice(model.indexOf('export function applySlideAnim'), model.indexOf('export function slideAnimSummary'))
check('applySlideAnim 函数体不碰 animOrder', !fnBody.includes('animOrder'))

console.log(`ppt-anim-brush: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
