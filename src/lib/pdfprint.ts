// 打印导出公共链路：把任意 DOM 作为“打印覆盖层”挂到 body，临时注入打印样式
// （放开外壳视口裁剪、打印时只留覆盖层、纸张/边距由这份作业自己声明完整），
// 调 WebView2 PrintToPdf 落盘后清理。
import { invoke } from '@tauri-apps/api/core'

export interface PrintOpts {
  /** 追加的打印专用 CSS（会排在本次作业自己那份 @page 之后）；纸张尺寸请传 pageSizeInches */
  pageStyle?: string
  /** 页边距（英寸），四边同值；要逐边不同请传 marginsSides */
  marginsInches?: number
  /** 四边页边距（英寸，top/right/bottom/left）；CSS @page 与 PrintSettings 都按这组数说 */
  marginsSides?: [number, number, number, number]
  /** 最终纸面宽高（英寸）——要横向就传宽>高，别再自己换位：
   *  "竖版边长 + Orientation 转置"这套换算只在 Rust 侧做一次，这里同时照写成 CSS @page size */
  pageSizeInches?: [number, number]
}

async function twoFrames(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
}

/** 边距的兜底默认与 Rust 侧 PrintSettings 的 None 分支同一套数；这里显式算出来，
 *  好让 CSS @page 与 PrintSettings 说同一句话（不去禁用别人的样式表：一张 <style> 里既有 @page
 *  也有正文样式，整张禁用会把打印样式一起带走——实测演示会印成无底色的 1 页） */
const DEFAULT_MARGINS: [number, number, number, number] = [0.5, 0.6, 0.5, 0.6]

export function printMarginsInches(opts: PrintOpts): [number, number, number, number] {
  if (opts.marginsSides) return opts.marginsSides
  if (opts.marginsInches !== undefined) {
    const m = opts.marginsInches
    return [m, m, m, m]
  }
  return DEFAULT_MARGINS
}

/** 空白所有页眉页脚位：文档标签那份 @page 带着 @top-center/@bottom-center 的页眉页码，
 *  它和我们各自的 @page 块会按文档序合并，后写的说话——所以这里逐个位复位成 normal */
const PAGE_BOXES = [
  '@top-left',
  '@top-center',
  '@top-right',
  '@top-left-corner',
  '@top-right-corner',
  '@bottom-left',
  '@bottom-center',
  '@bottom-right',
  '@bottom-left-corner',
  '@bottom-right-corner',
  '@left-top',
  '@left-middle',
  '@left-bottom',
  '@right-top',
  '@right-middle',
  '@right-bottom',
]

/** 本次打印作业的 @page：纸张、边距、页眉页脚位全都自己说一遍，不吃别人留在 head 里的那份。
 *  实测（WebView2 150）：导过一次 A4 竖版文档后紧接着导演示，会得到 MediaBox 540×960 的**竖版纸**
 *  ——文档那份 @page 常驻 head（#oo-page-rule 还要给页眉页脚用），PrintToPdf 连它的 size 一起认，
 *  幻灯片就被压成纸中间一条带。 */
export function ownPageRule(opts: PrintOpts): string {
  const m = printMarginsInches(opts)
  const size = opts.pageSizeInches ? `size:${opts.pageSizeInches[0]}in ${opts.pageSizeInches[1]}in;` : ''
  const boxes = PAGE_BOXES.map((b) => `${b}{content:normal;}`).join('')
  // 基档复位还不够：文档那份常驻规则可能带着 `@page:first` 的首页页眉（b39），而 `:first` 的排名高于基 `@page`，
  // 只说基档的话第 1 页会把文档的首页页眉抄到表格/演示的纸上。覆盖层的这份后挂进 head，故表格自己的
  // `@page:first`（opts.pageStyle，排在后面）照旧说话。
  return `@page{ ${size} margin:${m[0]}in ${m[1]}in ${m[2]}in ${m[3]}in; ${boxes} } @page:first{ ${boxes} }`
}

// 等待覆盖层内所有图片解码完成，避免 PDF 丢图
async function waitImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    imgs.map((im) => (im.complete ? Promise.resolve() : im.decode().catch(() => undefined))),
  )
}

/** 量高度要的是真排版，而覆盖层在屏幕上被 `#oof-print-host{display:none}` 藏着（只有打印态才显示），
 *  量出来全是 0。这里另开一个屏幕外的量尺容器：同一套正文样式（表格、zoom、换行后的行高都算数），
 *  只是不带 @media print 与 @page 那组规则——它们改的是可见性、分页与纸面，不改任何一行的高。
 *  量完即摘；被量的那份 DOM 还是原封不动交给导出那条腿 */
export async function measurePrintLayout<T>(
  overlay: HTMLElement,
  read: (root: HTMLElement) => T,
): Promise<T> {
  const host = document.createElement('div')
  host.id = 'oof-print-measure'
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:2000px;background:#fff;'
  host.appendChild(overlay)
  document.body.appendChild(host)
  try {
    await twoFrames()
    return read(overlay)
  } finally {
    host.remove()
  }
}

export async function exportPdfWithOverlay(
  filePath: string,
  overlay: HTMLElement,
  opts: PrintOpts = {},
): Promise<void> {
  overlay.classList.add('oof-print-root')
  const host = document.createElement('div')
  host.id = 'oof-print-host'
  host.appendChild(overlay)
  document.body.appendChild(host)

  const style = document.createElement('style')
  style.textContent = `
    #oof-print-host{ display:none; }
    .oof-print-root{ display:block; }
    @media print {
      /* 应用外壳的 html,body{height:100%;overflow:hidden} 会把打印裁成一屏，必须放开才能分页 */
      html, body{ height:auto !important; overflow:visible !important; }
      /* 纸上不该带着外壳的主题色：body{background:var(--bg)} 会把整页铺成浅灰蓝
         （暗色主题更是一页黑底），而自绘网格/幻灯片没有一整块白底去盖它。
         元素自己声明的颜色（单元格底色、字色）照旧说话，这里只兜住"没人管的地方" */
      html, body{ background:#fff !important; color:#111 !important; }
      body > *:not(#oof-print-host){ display:none !important; }
      #oof-print-host{ display:block !important; }
      /* 豁免 index.css 的 body *{visibility:hidden} 文档打印规则 */
      #oof-print-host, #oof-print-host *{ visibility: visible !important; }
    }
    ${ownPageRule(opts)}
    ${opts.pageStyle ?? ''}
  `
  document.head.appendChild(style)
  try {
    await waitImages(overlay)
    await twoFrames()
    await invoke('export_pdf', {
      filePath,
      // 边距两处同说同一组数：CSS @page（上面那份）与 PrintSettings。
      // 不传 null 让 Rust 兜默认，否则两边说的不是一套数，谁赢就成了运气
      margins: printMarginsInches(opts),
      page: opts.pageSizeInches ?? null,
    })
  } finally {
    style.remove()
    host.remove()
  }
}
