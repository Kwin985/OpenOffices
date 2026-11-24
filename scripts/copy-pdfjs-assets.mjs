// pdf.js 渲染中文/西文缺嵌入字体时需要 cmaps 与 standard_fonts 资源目录。
// 不入库（public/pdfjs 已 gitignore），dev/build 前从 node_modules 同步。
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dst = `${root}public/pdfjs`
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts']) {
  cpSync(`${root}node_modules/pdfjs-dist/${dir}`, `${dst}/${dir}`, { recursive: true })
}
console.log('pdfjs 资源已同步 → public/pdfjs')

// 拼写检查的大词典与 node_modules/word-list/words.txt 逐字节相同，属可重建的第三方数据，
// 不入库（public/dict 已 gitignore）。dev/build 前顺手同步，缺包时跳过——spell.ts 会退化到内置错词表。
const dictSrc = `${root}node_modules/word-list/words.txt`
if (existsSync(dictSrc)) {
  mkdirSync(`${root}public/dict`, { recursive: true })
  cpSync(dictSrc, `${root}public/dict/en-words.txt`)
  console.log('拼写词典已同步 → public/dict/en-words.txt')
} else {
  console.log('未找到 word-list，跳过拼写词典（拼写检查将用内置错词表）')
}

// OCR 资源（v0.232）：tesseract 的 WASM core 与中英语言包从 node_modules 同步到 public。
// 不入库（public/tessdata 已 gitignore），dev/build 前同步；这样 worker/core/langPath 全指本地，
// 识别时零网络请求——守住「数据不出本机」的底线。
// pnpm 严格结构下 core 不在顶层：从 tesseract.js 的 node_modules 找，再退到顶层
const { readdirSync } = await import('node:fs')
const coreCandidates = [
  `${root}node_modules/tesseract.js/node_modules/tesseract.js-core`,
  `${root}node_modules/tesseract.js-core`,
]
const pnpmRoot = `${root}node_modules/.pnpm`
if (existsSync(pnpmRoot)) {
  for (const d of readdirSync(pnpmRoot)) {
    if (d.startsWith('tesseract.js-core@')) coreCandidates.push(`${pnpmRoot}/${d}/node_modules/tesseract.js-core`)
  }
}
const tesseractCore = coreCandidates.find((p) => existsSync(p)) ?? ''
const ocrDst = `${root}public/tessdata`
if (existsSync(tesseractCore)) {
  mkdirSync(ocrDst, { recursive: true })
  for (const f of [
    'tesseract-core-lstm.js', 'tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm.js',
    'tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.js', 'tesseract-core-relaxedsimd-lstm.wasm', 'tesseract-core-relaxedsimd-lstm.wasm.js',
  ]) {
    const src = `${tesseractCore}/${f}`
    if (existsSync(src)) cpSync(src, `${ocrDst}/${f}`)
  }
  // worker 脚本本身也放本地（默认走 Blob URL，这里显式指定同源路径）
  const workerSrc = `${root}node_modules/tesseract.js/dist/worker.min.js`
  if (existsSync(workerSrc)) cpSync(workerSrc, `${ocrDst}/worker.min.js`)
  // worker 脚本本身也放本地（默认走 Blob URL，这里显式指定同源路径）
  // 语言包：best_int 版（约 eng 4MB / chi_sim 10MB），解压后给 tesseract worker 用
  for (const [lang, dir] of [
    ['eng', '4.0.0_best_int'],
    ['chi_sim', '4.0.0_best_int'],
  ]) {
    const base = [`${root}node_modules/tesseract.js/node_modules/@tesseract.js-data/${lang}`, `${root}node_modules/@tesseract.js-data/${lang}`].find((p) => existsSync(p)) ?? ''
    const src = `${base}/${dir}/${lang}.traineddata.gz`
    if (existsSync(src)) cpSync(src, `${ocrDst}/${lang}.traineddata.gz`)
  }
  console.log('OCR 资源已同步 → public/tessdata（本地识别，零网络）')
} else {
  console.log('未找到 tesseract.js-core，跳过 OCR 资源同步（OCR 按钮将不可用）')
}

