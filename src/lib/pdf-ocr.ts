// PDF OCR（v0.232）：本地识别，数据不出本机。
//
// tesseract.js 默认从 jsdelivr CDN 下载 worker/core/traineddata——那等于把用户文件
// 相关的识别请求发出去，违背本项目「数据不出本机」的底线。这里把三样全部钉到本地：
//   · workerPath / corePath → /tessdata/ 下从 node_modules 同步的 WASM core
//   · langPath → /tessdata/ 下的 eng/chi_sim.traineddata.gz
// 资源由 scripts/copy-pdfjs-assets.mjs 在 dev/build 前同步（public/tessdata 已 gitignore）。
//
// 第一版只做「边渲染边 OCR」：当前页 canvas → 识别 → 结果交给调用方写进文字层缓存。

import { createWorker, type Worker } from 'tesseract.js'

export type OcrLang = 'eng' | 'chi_sim'

export const OCR_LANGS: { value: OcrLang; label: string }[] = [
  { value: 'chi_sim', label: '中文' },
  { value: 'eng', label: '英文' },
]

/** 三样资源的本地路径；全部同源，绝不触网 */
export const OCR_LOCAL_PATHS = {
  workerPath: '/tessdata/worker.min.js',
  // 传目录而非具体 js：让 getCore 按设备 SIMD 能力选 lstm / simd-lstm / relaxedsimd-lstm
  corePath: '/tessdata/',
  langPath: '/tessdata',
} as const

let worker: Worker | null = null
let workerLang: OcrLang | null = null

/** 拿到（必要时重建）本地 worker；换语言要重新 loadLanguage */
async function getWorker(lang: OcrLang): Promise<Worker> {
  if (worker && workerLang === lang) return worker
  if (worker) {
    await worker.terminate()
    worker = null
  }
  const w = await createWorker(lang, 1, {
    ...OCR_LOCAL_PATHS,
    gzip: true,
    logger: () => {},
  })
  worker = w
  workerLang = lang
  return w
}

/** 回收 worker（切标签/关页时调用，别让 WASM 常驻吃内存） */
export async function disposeOcrWorker(): Promise<void> {
  if (!worker) return
  const w = worker
  worker = null
  workerLang = null
  await w.terminate()
}

export interface OcrPageResult {
  text: string
  /** 置信度（0–100），如实呈给用户，别假装 100% 可靠 */
  confidence: number
  lang: OcrLang
}

/**
 * 识别一张 canvas。canvas 由 PdfViewer 按当前 scale 渲染好传进来——
 * 放大渲染能明显提升小字识别率，所以这里不再二次缩放。
 */
export async function recognizeCanvas(canvas: HTMLCanvasElement, lang: OcrLang): Promise<OcrPageResult> {
  const w = await getWorker(lang)
  const { data } = await w.recognize(canvas)
  return {
    text: (data.text ?? '').trim(),
    confidence: typeof data.confidence === 'number' ? Math.round(data.confidence) : 0,
    lang,
  }
}

/**
 * OCR 文本 → PageText 形状（与 pdfjs 的文字层缓存同构），让它直接进搜索索引。
 * OCR 没有逐-item 几何，整页当一条 item；命中定位退化为「跳到该页」，
 * 不强造 bItem/bOff 的假坐标——那是「看得见搜得到」与「能精确高亮」的边界。
 */
export function ocrToPageText(text: string): { items: string[]; full: string; starts: number[] } {
  const items = text ? [text] : []
  return { items, full: text, starts: items.length ? [0] : [] }
}

/** 检测一页是否已有文字层（有就不该再 OCR——重复识别只会覆盖原文字） */
export function hasTextLayer(items: string[]): boolean {
  return items.some((s) => s.trim().length > 0)
}
