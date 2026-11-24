// v0.232 守卫：PDF 本地 OCR 的路径纪律（零网络）、结果接入、资源同步。
// 跑法：npx vite-node scripts/test-pdf-ocr.mjs

import fs from 'node:fs'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

const { OCR_LOCAL_PATHS, ocrToPageText, hasTextLayer, OCR_LANGS, disposeOcrWorker } = await import('../src/lib/pdf-ocr.ts')

// 零网络：三样资源全指本地同源路径，不能出现 http/CDN
const paths = JSON.stringify(OCR_LOCAL_PATHS)
check('worker/core/lang 全本地', !/https?:|\/\/cdn|jsdelivr|unpkg/.test(paths), paths)
check('worker 路径在 tessdata 下', OCR_LOCAL_PATHS.workerPath === '/tessdata/worker.min.js')
check('core 用目录（按 SIMD 选变体）', OCR_LOCAL_PATHS.corePath === '/tessdata/')
check('语言包路径在 tessdata 下', OCR_LOCAL_PATHS.langPath === '/tessdata')
check('中英双语可选', OCR_LANGS.map((l) => l.value).join() === 'chi_sim,eng')

// OCR 结果 → PageText 同构（搜索索引直接吃）
const t = ocrToPageText('第一行\n第二行')
check('整页一条 item', t.items.length === 1 && t.items[0] === '第一行\n第二行')
check('full 与 items 一致', t.full === t.items[0])
check('starts 从 0 起', JSON.stringify(t.starts) === '[0]')
check('空文本不造假 item', ocrToPageText('').items.length === 0)
check('有文字层判定', hasTextLayer(['', '  ']) === false && hasTextLayer(['中文']) === true)
check('worker 回收接口存在', typeof disposeOcrWorker === 'function')

// 资源同步脚本：把 core/worker/语言包从 node_modules 搬到 public（全本地）
const sync = fs.readFileSync(new URL('../scripts/copy-pdfjs-assets.mjs', import.meta.url), 'utf8')
check('同步脚本搬 WASM core', sync.includes('tesseract-core-lstm.wasm'))
check('同步脚本搬 worker', sync.includes('worker.min.js'))
check('同步脚本搬中英语言包', sync.includes("['eng', '4.0.0_best_int']") && sync.includes("['chi_sim', '4.0.0_best_int']") && sync.includes('${lang}.traineddata.gz'))
check('语言包走 best_int（小体积）', sync.includes('4.0.0_best_int'))
const gitignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')
check('public/tessdata 不入库', gitignore.includes('/public/tessdata'))

// UI 接线
const ui = fs.readFileSync(new URL('../src/components/PdfViewer.tsx', import.meta.url), 'utf8')
check('工具条有 OCR 按钮', ui.includes("btn('◉ OCR'"))
check('识别调用本地封装', ui.includes('recognizeCanvas(canvas, ocrLang)'))
check('结果写进搜索缓存 pageTexts', /pageTexts\.current\.set\(curPage, ocrToPageText\(res\.text\)\)/.test(ui))
check('不覆盖已有文字层', /hasTextLayer\(existing\.items\)/.test(ui))
check('关闭时回收 worker', /void disposeOcrWorker\(\)/.test(ui))
check('如实显示置信度', ui.includes('置信度 ${res.confidence}%'))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nPDF 本地 OCR：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
