// Writer 标尺（v0.179）的结构断言。
//
// 标尺最容易错的是「0 点在哪」和「拖完写回的是不是同一个量」：这两件事
// 纯数值，Node 侧直接钉；UI 接线用源码级断言（关着时不遍历全文、打印/预览
// 都把标尺藏掉、滑块写回走 setIndent 单一出口）。
import fs from 'node:fs'
import {
  rulerTicks,
  rulerVerticalTicks,
  rulerIndentMarks,
  rulerIndentFromDrag,
} from '../src/lib/ruler.ts'

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const ok = []
const bad = []
const check = (name, cond, detail) => (cond ? ok : bad).push(detail ? `${name} — ${detail}` : name)
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want),
  JSON.stringify(got) === JSON.stringify(want) ? '' : `得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)

const MM_PX = 96 / 25.4
const G = { contentWidthPx: 166 * MM_PX, mmPx: MM_PX, maxIndentPx: 320 }

// ───────────────────── 1. 刻度 ─────────────────────
{
  const t = rulerTicks(G)
  eq('刻度：0 点在版心左边缘', t[0], { at: 0, major: true, label: '0' })
  eq('刻度：每 2mm 一小格', t[1].at, Math.round(2 * MM_PX * 100) / 100)
  eq('刻度：第 5 格是 1cm 大格', t[5].major, true)
  eq('刻度：1cm 标签', t[5].label, '1')
  check('刻度：全在版心宽内', t.every((x) => x.at <= G.contentWidthPx + 0.001))
  check('刻度：大格标签是厘米数不是毫米', t.filter((x) => x.major).every((x) => /^\d+$/.test(x.label)))
  eq('刻度：非有限宽度给空', rulerTicks({ ...G, contentWidthPx: Number.NaN }), [])
  eq('刻度：mmPx 为 0 给空', rulerTicks({ ...G, mmPx: 0 }), [])
  eq('刻度：负宽度给空', rulerTicks({ ...G, contentWidthPx: -1 }), [])
  eq('垂直刻度复用同一函数', rulerVerticalTicks(20 * MM_PX, MM_PX).length, rulerTicks({ ...G, contentWidthPx: 20 * MM_PX }).length)
}

// ───────────────────── 2. 缩进标记 ─────────────────────
{
  eq('标记：全 0 时首行/左在 0、右在版心右边缘',
    rulerIndentMarks({}, G), { firstLine: 0, left: 0, right: G.contentWidthPx })
  const m = rulerIndentMarks({ indentLeft: 32, indentFirst: 32, indentRight: 40 }, G)
  eq('标记：左缩进', m.left, 32)
  eq('标记：首行 = 左 + 首行缩进', m.firstLine, 64)
  eq('标记：右缩进从右边缘往里', m.right, G.contentWidthPx - 40)
  check('标记：右不会跑到左的左边', m.right >= m.left)
  const over = rulerIndentMarks({ indentLeft: 99999 }, G)
  check('标记：超上限夹住', over.left <= 320)
  eq('标记：脏值按 0', rulerIndentMarks({ indentFirst: Number.NaN }, G).firstLine, 0)
}

// ───────────────────── 3. 拖动换算 ─────────────────────
{
  const m = rulerIndentMarks({}, G)
  const d = rulerIndentFromDrag('first', 10 * MM_PX, m, G)
  // 吸附到 1mm：10mm → 10 * MM_PX
  eq('拖动：首行吸附到 1mm 网格', d.indentFirst, 10 * MM_PX)
  eq('拖动：左缩进不变', d.indentLeft, 0)
  eq('拖动：三枚属性一次全给', Object.keys(d).sort(), ['indentFirst', 'indentLeft', 'indentRight'])

  const dl = rulerIndentFromDrag('left', 20 * MM_PX, rulerIndentMarks({ indentLeft: 32, indentFirst: 32 }, G), G)
  // 拖「左」时首行相对偏移保持 32
  eq('拖动：左标记移动，首行相对偏移保持', dl.indentFirst, 32)
  check('拖动：左缩进落在网格上', Math.abs(dl.indentLeft / MM_PX - Math.round(dl.indentLeft / MM_PX)) < 1e-6)

  const dr = rulerIndentFromDrag('right', G.contentWidthPx - 8 * MM_PX, m, G)
  check('拖动：右缩进按「离右边缘多远」算', dr.indentRight > 0 && dr.indentRight < 40)
  eq('拖动：越界夹在版心内', rulerIndentFromDrag('first', -100, m, G).indentFirst, 0)
  eq('拖动：非法 handle 返回 null', rulerIndentFromDrag('nope', 10, m, G), null)
  eq('拖动：非有限位置返回 null', rulerIndentFromDrag('first', Number.NaN, m, G), null)
}

// ───────────────────── 4. 接线纪律 ─────────────────────
{
  const src = read('../src/components/DocEditor.tsx')
  const css = read('../src/index.css')
  const lib = read('../src/lib/ruler.ts')
  check('接线：纯函数从 lib 导入', /from '\.\.\/lib\/ruler'/.test(src))
  check('接线：标尺只在打开时渲染（关着不遍历）',
    /rulerOn\s*&&\s*\(/.test(src) || /\{rulerOn &&/.test(src))
  check('接线：三枚滑块写回走 setIndent 单一出口',
    /setIndent\(/.test(src) && /rulerIndentFromDrag/.test(src))
  check('接线：0 点用版心几何（effPx.left / contentWidth）',
    /effPx\.left/.test(src) && /rulerTicks\(/.test(src))
  check('接线：垂直刻度走 lib 的专用函数', /rulerVerticalTicks\(/.test(src))
  const rulerCalc = src.slice(src.indexOf('const rulerGeom'), src.indexOf('const paraBorders'))
  check('接线：paragraph 优先、heading 兜底（不展开覆盖）',
    /rulerPara\.indentFirst \?\? rulerHead\.indentFirst/.test(rulerCalc)
      && !/\{\s*\.\.\.editor\.getAttributes\('paragraph'\)/.test(rulerCalc))
  check('接线：标尺挂在 doc-page 内（随 zoom 一起缩放）',
    /className="doc-page"[\s\S]{0,900}doc-ruler-h/.test(src))
  check('CSS：预览态隐藏标尺', /is-preview[\s\S]{0,300}doc-ruler/.test(css))
  check('CSS：打印态隐藏标尺', /@media print[\s\S]{0,4000}doc-ruler/.test(css))
  check('纯函数：lib 不 import React / DOM',
    !/from 'react|document\.|window\./.test(lib))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
