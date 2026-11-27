// v0.241 守卫：OCR worker 生命周期（卸载回收 + 异步结果守卫）。
// 跑法：npx vite-node scripts/test-ocr-lifecycle.mjs

import fs from 'node:fs'

const ok = []
const bad = []
const check = (n, c, extra = '') => (c ? ok : bad).push(n + (c || !extra ? '' : ` — ${extra}`))

const viewer = fs.readFileSync(new URL('../src/components/PdfViewer.tsx', import.meta.url), 'utf8')
const ocr = fs.readFileSync(new URL('../src/lib/pdf-ocr.ts', import.meta.url), 'utf8')
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// ① 构建链：OCR 资源同步必须在 build 里（public/tessdata 是 gitignored 的重建资源）
check('build 脚本先同步资源', pkg.scripts.build.startsWith('node scripts/copy-pdfjs-assets.mjs'))
check('dev 脚本先同步资源', pkg.scripts.dev.startsWith('node scripts/copy-pdfjs-assets.mjs'))
check('tauri beforeBuild 走 pnpm build', /"beforeBuildCommand": "pnpm build"/.test(fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')))
check('同步脚本含 OCR 资源', fs.readFileSync(new URL('../scripts/copy-pdfjs-assets.mjs', import.meta.url), 'utf8').includes('tessdata'))

// ② worker 全部钉本地（零网络）
for (const k of ['workerPath', 'corePath', 'langPath']) {
  check(`${k} 指本地 tessdata`, ocr.includes(`${k}: '/tessdata`), k)
}
check('关闭按钮也回收 worker', viewer.includes('void disposeOcrWorker()'))

// ③ 卸载回收：在 aliveRef 那个 effect 里
const i = viewer.indexOf('aliveRef.current = false')
const chunk = viewer.slice(i, i + 320)
check('卸载时回收 OCR worker', chunk.includes('disposeOcrWorker()'), chunk.slice(0, 200))
check('回收重复调用安全（模块置空守卫）', /export async function disposeOcrWorker\(\)[\s\S]{0,180}if \(!worker\) return/.test(ocr))

// ④ 异步结果守卫：识别期间切标签不往卸载组件写
const j = viewer.indexOf('const res = await recognizeCanvas(canvas, ocrLang)')
const after = viewer.slice(j, j + 220)
check('异步识别结果有 alive 守卫', after.includes('if (!aliveRef.current) return'), after.slice(0, 180))

for (const n of ok) console.log(`  ✓ ${n}`)
for (const n of bad) console.log(`  ✗ ${n}`)
console.log(`\nOCR 生命周期：${ok.length} 通过 / ${bad.length} 失败`)
if (bad.length) process.exit(1)
