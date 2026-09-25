// 打印导出公共链路：把任意 DOM 作为“打印覆盖层”挂到 body，临时注入打印样式
// （放开外壳视口裁剪、打印时只留覆盖层、纸张尺寸走 Rust 侧 PrintSettings），
// 调 WebView2 PrintToPdf 落盘后清理。
import { invoke } from '@tauri-apps/api/core'

export interface PrintOpts {
  /** 追加的打印专用 CSS，通常是 @page{margin:…}；纸张尺寸请传 pageSizeInches */
  pageStyle?: string
  /** 页边距（英寸），四边同值；要逐边不同请传 marginsSides */
  marginsInches?: number
  /** 四边页边距（英寸，top/right/bottom/left）；PrintSettings 的边距优先于 CSS @page margin */
  marginsSides?: [number, number, number, number]
  /** 纸张宽高（英寸）；@page size 在 PrintToPdf 里不可靠，须显式指定 */
  pageSizeInches?: [number, number]
}

async function twoFrames(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
}

// 等待覆盖层内所有图片解码完成，避免 PDF 丢图
async function waitImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    imgs.map((im) => (im.complete ? Promise.resolve() : im.decode().catch(() => undefined))),
  )
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
    ${opts.pageStyle ?? ''}
  `
  document.head.appendChild(style)
  try {
    await waitImages(overlay)
    await twoFrames()
    await invoke('export_pdf', {
      filePath,
      margins:
        opts.marginsSides ??
        (opts.marginsInches === undefined ? null : [opts.marginsInches, opts.marginsInches, opts.marginsInches, opts.marginsInches]),
      page: opts.pageSizeInches ?? null,
    })
  } finally {
    style.remove()
    host.remove()
  }
}
