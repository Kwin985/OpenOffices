// pdf.js 渲染中文/西文缺嵌入字体时需要 cmaps 与 standard_fonts 资源目录。
// 不入库（public/pdfjs 已 gitignore），dev/build 前从 node_modules 同步。
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dst = `${root}public/pdfjs`
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts']) {
  cpSync(`${root}node_modules/pdfjs-dist/${dir}`, `${dst}/${dir}`, { recursive: true })
}
console.log('pdfjs 资源已同步 → public/pdfjs')
