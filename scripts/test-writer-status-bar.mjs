// v0.180 Writer 可交互状态栏断言。
//
// 钉三件事：① 条目表与数值口径是纯函数（不碰 Date / Intl / editor）；
// ② 显示口径转调既有单一事实源（fail-msg / print-preview / view-zoom），不复制第二份；
// ③ 组件只做接线，且预览态与打印态都藏掉这一条。
// 跑法：npx vite-node scripts/test-writer-status-bar.mjs

import fs from 'node:fs'
import {
  statusBarItems, statusBarMessage, statusBarPages, statusBarZoomText,
  formatCountsText, formatPagesText,
} from '../src/lib/status-bar.ts'
import { estimatePages } from '../src/lib/print-preview.ts'
import { zoomPct } from '../src/lib/view-zoom.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const base = {
  status: '', savedAtText: '', words: 1234, chars: 5678,
  docH: 900, pageH: 1123, marginTop: 96, marginBottom: 96,
  zoom: 1, revOn: false, spellOn: false, previewOpen: false, histOpen: false,
}

// ---- 1. 纯数值 / 文案 -----------------------------------------------------
eq('计数文案不依赖 locale（无千分位）', formatCountsText(1234, 5678), '字数 1234 · 字符 5678')
eq('计数：负数归零', formatCountsText(-5, Number.NaN), '字数 0 · 字符 0')
eq('计数：小数取整', formatCountsText(1.6, 2.4), '字数 2 · 字符 2')
eq('页数文案', formatPagesText(3), '约 3 页 · 预览')
eq('缩放百分比复用 view-zoom', statusBarZoomText(1.5), zoomPct(1.5))
eq('状态首行与提示来自 fail-msg', statusBarMessage('第一行\n第二行说明').text, '第一行')
eq('状态提示取第二行', statusBarMessage('第一行\n第二行说明').tip, '第二行说明')
eq('单行状态没有提示', statusBarMessage('正在保存').tip, '')
eq('页数与 estimatePages 同源', statusBarPages(base), estimatePages(900, 1123, 96, 96))
eq('版心非正时至少一页', statusBarPages({ ...base, pageH: 100, marginTop: 80, marginBottom: 80 }), 1)

// ---- 2. 条目表 -----------------------------------------------------------
{
  const items = statusBarItems(base)
  eq('无消息时 8 枚条目', items.length, 8)
  eq('条目顺序', items.map((i) => i.id).join(','),
    'counts,pages,revision,spell,history,zoomOut,zoomValue,zoomIn')
  eq('只有 counts 左侧留弹性空白', items.filter((i) => i.pushLeft).map((i) => i.id).join(','), 'counts')
  eq('统计文案', items.find((i) => i.id === 'counts').label, '字数 1234 · 字符 5678')
  eq('页数条目指向打印预览', items.find((i) => i.id === 'pages').action, 'togglePreview')
  eq('缩放三枚的动作', items.slice(-3).map((i) => i.action).join(','), 'zoomOut,zoomReset,zoomIn')
  eq('缩放中间那枚显示百分比', items.find((i) => i.id === 'zoomValue').label, '100%')
  check('静态条目没有 action（不会渲染成可点按钮）',
    items.filter((i) => i.kind === 'counts' || i.kind === 'message').every((i) => !i.action))

  const all = statusBarItems({
    ...base, status: '正在加载…', savedAtText: '10:09:11',
    revOn: true, spellOn: true, previewOpen: true, histOpen: true, zoom: 2,
  })
  eq('消息优先于自动保存时间', all.map((i) => i.id).join(','),
    'message,counts,pages,revision,spell,history,zoomOut,zoomValue,zoomIn')
  eq('消息内容', all[0].label, '正在加载…')
  check('四个开态都高亮', ['pages', 'revision', 'spell', 'history'].every((id) => all.find((i) => i.id === id)?.active === true))
  eq('缩放值随状态变', all.find((i) => i.id === 'zoomValue').label, '200%')

  const saved = statusBarItems({ ...base, savedAtText: '10:09:11' })
  eq('自动保存时间由调用方传入（纯函数不碰 Date）', saved[0].label, '已自动保存 10:09:11')
  eq('自动保存那枚指向历史版本', saved[0].action, 'openHistory')

  const A = new Set(['openHistory', 'togglePreview', 'toggleRevision', 'toggleSpell', 'zoomOut', 'zoomIn', 'zoomReset'])
  check('所有 action 都在允许集合内', all.filter((i) => i.action).every((i) => A.has(i.action)))
}

// ---- 3. 纪律（源码级）----------------------------------------------------
{
  const lib = read('../src/lib/status-bar.ts')
  const ui = read('../src/components/DocEditor.tsx')
  const css = read('../src/index.css')
  // 注释里会提到这些名字，只查非注释代码行
  const libCode = lib.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*|\*\/)/.test(l)).join('\n')
  check('lib 代码不碰 Date / Intl / toLocaleTimeString',
    !/Date\b|Intl\.|toLocaleTimeString/.test(libCode))
  check('lib 转调三个单一事实源',
    /statusText\(status\)/.test(lib) && /statusTip\(status\)/.test(lib)
      && /estimatePages\(s\.docH/.test(lib) && /zoomPct\(zoom\)/.test(lib))
  check('lib 不自己复制页数算法（没有 Math.ceil）', !/Math\.ceil/.test(lib))
  check('组件接线：statusBarItems 构造状态', /const statusItems = statusBarItems\(\{/.test(ui))
  check('组件接线：runStatus 覆盖全部 7 个 action',
    ['openHistory', 'togglePreview', 'toggleRevision', 'toggleSpell', 'zoomOut', 'zoomIn', 'zoomReset']
      .every((a) => new RegExp(`case '${a}':`).test(ui)))
  check('组件接线：状态栏是 editor-pane 直接子级（ctxMenu 之前）',
    /<div className="doc-status-bar">[\s\S]{0,900}<\/div>\s*\{ctxMenu && \(/.test(ui))
  check('组件接线：静态条目渲染成 span 而非 disabled button',
    /className="doc-status-item is-static"/.test(ui) && !/disabled=\{!it\.action\}/.test(ui))
  // 别处的内联面板仍用 editor-status / editor-hint 这两个类名（样式标签），
  // 所以只查旧状态栏那三段独有的组合
  check('工具条尾三段旧 span 已移走',
    !/\{status && \(/.test(ui)
      && !/\{!status && autoSavedAt && \(/.test(ui)
      && !/字数 \{counts\.words\}/.test(ui))
  check('CSS：状态栏 flex 固定高度、有弹性空白',
    /\.doc-status-bar \{[\s\S]{0,300}flex: 0 0 auto/.test(css) && /\.doc-status-grow \{/.test(css))
  check('CSS：预览态通配规则仍在（新直接子级自动藏）',
    /\.editor-pane\.is-preview > :not\(\.doc-body\)/.test(css))
  check('CSS：打印态显式 display:none（不留 28px 空位）',
    /@media print \{[\s\S]*?\.doc-status-bar \{\s*display: none !important;/.test(css))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
