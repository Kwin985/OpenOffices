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
