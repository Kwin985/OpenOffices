// PDF「真·原地改字」（v0.129）
//
// PDF 的内容流里没有"文字层"这回事：一页是一串「在这个坐标画这个字形」。所以改一个字的
// 正统做法只有三步，Acrobat/WPS 的编辑工具也是这么干的：
//   1. 把原字形那块用底色盖住
//   2. 把新文字用同一个字号画回原基线
//   3. 嵌一个字体进去（否则中文全是方块）
//
// 三条最要紧的取舍，都写在这里：
//   - **盖原字形用的是采样来的底色**，不是写死白色。原文字后面若是图片或彩色底，
//     白块会露馅；底色默认从已渲染的 canvas 上按文字框上下外圈采样（见 sampleBackdrop）。
//   - **嵌字体只在新文字含非 ASCII 时发生**。纯英文/数字改动用内置 Helvetica，
//     文件体积零增长。中文那一趟才去读系统字体（9~20MB）并 subset，落盘只多几 KB。
//   - **字形会变**。原文件用的字体（常常是子集嵌入的）取不出来，只能拿系统字体顶。
//     这是所有 PDF 编辑器都有的代价，界面上要说清。
//
// 坐标：全程用**未旋转 PDF 空间（原点左下、y 向上）**。这不是随手选的——
// pdf.js 的 TextItem.transform 由 `Util.transform(ctm, Util.transform(textMatrix, tsm))`
// 得出，而 ctm 从单位矩阵起只受内容流 `cm` 影响，页面的 /Rotate 不掺和；
// pdf-lib 的 drawText/drawRectangle 又是直接往内容流追加裸算子（PDFPage.pushOperators
// 不做任何旋转变换）。两者的坐标空间因此天然一致，可以直接透传，不用换算。
// 只有"显示空间的虚线框"要走一遍 fromDisplayRect——那是给人看的，不是给 PDF 看的。

// v0.198：这里只留类型。顶层若静态 import pdf-lib 的运行时值，Vite 会把整个库
// 钉进主 chunk，并让调用方那两处 `await import('pdf-lib')` 退化成
// INEFFECTIVE_DYNAMIC_IMPORT。PDFDocument 由调用方动态加载后传进来，本模块只在
// 真正要改字时取 rgb（同一个模块缓存，零额外下载）。
import type { PDFDocument, PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readBytes } from './fs'
import { fromDisplayRect, type PdfRect, type Rot } from './pdf-geo'

/** 一次「改字」的全部信息 */
export interface TextEdit {
  page: number
  /** 未旋转 PDF 空间的文字起点 x（左） */
  x: number
  /** 基线 y（PDF 空间） */
  y: number
  /** 字号（pt） */
  size: number
  /** 显示空间的包围盒（与页面上画的虚线框同一个矩形）：写回时转成未旋转空间去盖底色 */
  rect: PdfRect
  rot: Rot
  /** 新文字 */
  text: string
  /** #rrggbb，从渲染结果采样来的底色 */
  bg: string
  /** 原文，界面上列出来让人知道改的是什么 */
  from: string
}

// ───────────────── 字体 ─────────────────

interface CjkFont {
  bytes: Uint8Array
  name: string
}

/**
 * 系统里中文字体的候选次序。
 *
 * ttf 排在 ttc 前面不是偏好，是硬约束：pdf-lib 走 `fontkit.create(bytes)`，
 * 对 `ttcf` 魔数的集合它返回的是 TrueTypeCollection 而不是单字体，缺 `.layout()`。
 * 所以 ttc 也能用，但得靠下面那个 wrapper 把它拆成第一个字体。
 * 命中即止；全不在就交回 null——那一趟只能改英文。
 */
const FONT_CANDIDATES: [string, string][] = [
  ['C:/Windows/Fonts/simhei.ttf', '中易黑体'],
  ['C:/Windows/Fonts/simkai.ttf', '中易楷体'],
  ['C:/Windows/Fonts/simfang.ttf', '中易仿宋'],
  ['C:/Windows/Fonts/msyh.ttc', '微软雅黑'],
  ['C:/Windows/Fonts/simsun.ttc', '中易宋体'],
  ['C:/Windows/Fonts/deng.ttf', '等线'],
]

let fontCache: CjkFont | null | undefined

/** 读一份中文字体进来。只读一次，之后复用（同一份文档里改多少字都共用） */
export async function loadCjkFont(): Promise<CjkFont | null> {
  if (fontCache !== undefined) return fontCache
  for (const [p, name] of FONT_CANDIDATES) {
    try {
      const bytes = await readBytes(p)
      // 字体文件至少几百 KB；更小的要么是占位要么读坏了
      if (bytes && bytes.length > 200_000) {
        fontCache = { bytes, name }
        return fontCache
      }
    } catch {
      /* 不存在、无权限、或不是字体：试下一个 */
    }
  }
  fontCache = null
  return null
}

/** 拆 TTC 的 fontkit 包装。`create` 拿到集合对象时取第一个字体，其余原样透传 */
const collectionSafeFontkit = {
  ...fontkit,
  create: (bytes: Uint8Array, postscriptName?: string) => {
    const f = fontkit.create(bytes, postscriptName)
    const maybe = f as { fonts?: unknown[] }
    if (maybe && Array.isArray(maybe.fonts) && maybe.fonts.length > 0) {
      return maybe.fonts[0]
    }
    return f
  },
}

// ───────────────── 底色采样 ─────────────────

/**
 * 从已渲染的 canvas 上取文字框周边的颜色。
 *
 * 取的是文字框**上外圈与下外圈**各一条窄带（避开字形），不是框内——框内是字。
 * 两条带子的像素一起按出现次数取众数，比取平均稳：平均会把抗锯齿的灰边混进来，
 * 盖出来是一块脏灰。
 *
 * 上下都没有可采样的带子（文字贴在页边上）时退到页面四角。
 */
export function sampleBackdrop(
  canvas: HTMLCanvasElement | null,
  dpr: number,
  scale: number,
  rect: PdfRect,
): string {
  const fallback = '#ffffff'
  if (!canvas) return fallback
  const ctx = canvas.getContext('2d')
  if (!ctx) return fallback
  const W = canvas.width
  const H = canvas.height
  if (!W || !H) return fallback

  // 显示空间（CSS px）→ canvas 像素
  const x0 = Math.max(0, Math.floor(rect.x * scale * dpr))
  const x1 = Math.min(W, Math.ceil((rect.x + rect.w) * scale * dpr))
  const y0 = Math.max(0, Math.floor(rect.y * scale * dpr))
  const y1 = Math.min(H, Math.ceil((rect.y + rect.h) * scale * dpr))
  if (x1 <= x0 || y1 <= y0) return fallback

  const band = Math.max(1, Math.round(2 * scale * dpr))
  const counts = new Map<number, number>()
  const tally = (data: Uint8ClampedArray) => {
    for (let i = 0; i < data.length; i += 4) {
      // 全透明的像素没有底色可言，跳过
      if (data[i + 3] < 250) continue
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const bands: [number, number, number, number][] = []
  if (y0 - band >= 0) bands.push([x0, y0 - band, x1, y0])
  if (y1 + band <= H) bands.push([x0, y1, x1, y1 + band])
  // 上下都贴边：拿整页四角兜底
  if (!bands.length) {
    bands.push([0, 0, Math.min(8, W), Math.min(8, H)])
    bands.push([Math.max(0, W - 8), Math.max(0, H - 8), W, H])
  }
  for (const [bx0, by0, bx1, by1] of bands) {
    const w = bx1 - bx0
    const h = by1 - by0
    if (w <= 0 || h <= 0) continue
    tally(ctx.getImageData(bx0, by0, w, h).data)
  }
  if (!counts.size) return fallback
  let bestKey = 0xffffff
  let bestN = -1
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n
      bestKey = k
    }
  }
  return `#${bestKey.toString(16).padStart(6, '0')}`
}

// ───────────────── 写回 ─────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  )
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** 这段文字需不需要中文字体：只要出现非 ASCII 字符就要 */
function needsCjk(text: string): boolean {
  return /[^\x00-\x7f]/.test(text)
}

export interface TextEditResult {
  /** 真正落进去的条数 */
  applied: number
  /** 是否嵌了中文字体（界面上要提示"落盘会变大几 KB"） */
  fontEmbedded: boolean
  /** 没能写进去的页（页号越界之类） */
  skipped: number[]
}

/**
 * 把一串「改字」落进 pdf-lib 文档。
 *
 * 逐条做：先按底色盖住原字形的包围盒，再把新文字画回原基线。
 * 同一份中文字体全程只嵌一次（subset 之后只带用到的字形，通常几 KB）。
 */
export async function applyTextEdits(
  pdoc: PDFDocument,
  edits: TextEdit[],
): Promise<TextEditResult> {
  const res: TextEditResult = { applied: 0, fontEmbedded: false, skipped: [] }
  if (!edits.length) return res
  const { rgb } = await import('pdf-lib')
  const pages = pdoc.getPages()
  // 字体是懒加载的：整批都是纯英文就一个字节都不读
  let cjk: PDFFont | null | undefined
  let fontkitRegistered = false

  for (const e of edits) {
    const pg = pages[e.page - 1]
    if (!pg) {
      res.skipped.push(e.page)
      continue
    }
    const text = e.text
    if (!text) continue

    // —— 字体：纯 ASCII 用内置 Helvetica（零体积），含中文才去嵌 ——
    let font: PDFFont
    if (needsCjk(text)) {
      if (cjk === undefined) {
        const loaded = await loadCjkFont()
        if (!loaded) {
          // 系统里没有中文字体：这一条只能跳过，不能拿 Helvetica 画中文（满页方块）
          res.skipped.push(e.page)
          continue
        }
        if (!fontkitRegistered) {
          pdoc.registerFontkit(collectionSafeFontkit as unknown as typeof fontkit)
          fontkitRegistered = true
        }
        try {
          // subset：只带这篇文档用到的字形。整份 simhei 有 9.7MB，
          // subset 之后改十个字也只多几 KB——这是"真改字"在体积上唯一可行的路
          cjk = await pdoc.embedFont(loaded.bytes, { subset: true })
          res.fontEmbedded = true
        } catch {
          cjk = null
          res.skipped.push(e.page)
          continue
        }
      } else if (cjk === null) {
        res.skipped.push(e.page)
        continue
      }
      font = cjk
    } else {
      font = await pdoc.embedFont('Helvetica')
    }

    // —— 盖住原字形 ——
    // 显示空间的框 → 未旋转空间 → 左下原点。fromDisplayRect 管前两步，最后一步是翻 y
    const base = pg.getSize()
    const u = fromDisplayRect(e.rect, e.rot, { w: base.width, h: base.height })
    const coverY = base.height - u.y - u.h
    const [br, bgc, bb] = hexToRgb(e.bg)
    pg.drawRectangle({
      x: u.x,
      y: coverY,
      width: u.w,
      height: u.h,
      color: rgb(br, bgc, bb),
    })

    // —— 把新文字画回原基线 ——
    // x/y/size 直接来自 pdf.js 的 textTransform，未旋转空间，与 drawText 同空间
    const [fr, fg, fb] = hexToRgb('#000000')
    pg.drawText(text, {
      x: e.x,
      y: e.y,
      size: e.size,
      font,
      color: rgb(fr, fg, fb),
    })
    res.applied++
  }
  return res
}

/** 新文字比原文长多少（pt）。正数表示会往右溢出、可能压到相邻的字 */
export function overflowPt(newW: number, rect: PdfRect): number {
  return newW - rect.w
}
