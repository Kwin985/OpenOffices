// 打印导出公共链路：把任意 DOM 作为“打印覆盖层”挂到 body，临时注入打印样式
// （放开外壳视口裁剪、打印时只留覆盖层、纸张尺寸走 Rust 侧 PrintSettings），
// 调 WebView2 PrintToPdf 落盘后清理。
import { invoke } from '@tauri-apps/api/core'

export interface PrintOpts {
  /** 追加的打印专用 CSS，通常是 @page{margin:…}；纸张尺寸请传 pageSizeInches */
  pageStyle?: string
  /** 页边距（英寸），幻灯片全出血传 0；不传用 Rust 侧默认 */
  marginsInches?: number
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
      margins: opts.marginsInches ?? null,
      page: opts.pageSizeInches ?? null,
    })
  } finally {
    style.remove()
    host.remove()
  }
}
