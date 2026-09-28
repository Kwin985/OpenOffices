// 打印排版的实测层：把将要上纸的那份 DOM 量一遍，行高/表头高/表名行都从真排版里读回来，
// 换算交给 sheet-print-setup 的纯函数（simulatePrintPages / planSheetFit）。
// 为什么不能按载荷算行高：新建的表一条 rowHeights 都没有（默认行高由字体现算），
// 声明过的行高又只是**下限**（写 20px 实测 21px），长文字那一行会自己撑到几百像素——
// 而 CSS zoom 之后的行高不等于线性折算，所以只能在**最终缩放**之下量。
import type { BandMeasure, SheetFit, SheetMeasure } from './sheet-print-setup'

function h(el: Element): number {
  return el.getBoundingClientRect().height
}

/** 一张表的网格从哪里开始：section 的第一个列带。空表与"打印区域里没有格子"的那两张没有 */
function firstBand(section: Element): Element | null {
  return section.querySelector(':scope > .sheet-print-band')
}

function bandOf(band: Element): BandMeasure {
  const table = band.querySelector(':scope > table')
  const thead = table?.querySelector(':scope > thead')
  const rows = table ? Array.from(table.querySelectorAll(':scope > tbody > tr')) : []
  return {
    // 重复表头每占一页就要付一次，所以它单独记一行
    theadPx: thead ? h(thead) : 0,
    rowsPx: rows.map(h),
    tablePx: table ? h(table) : 0,
  }
}

/** 读回每张表的实测高。**按 <section> 的表序**返回，没有网格的那几张占一格 null——
 *  少了这一格对齐，plans[i] 就会配到另一张表的实测上，压出来的缩放也是错的 */
export function measureSheetPrint(root: HTMLElement): (SheetMeasure | null)[] {
  return Array.from(root.querySelectorAll(':scope > section')).map((section) => {
    const start = firstBand(section)
    if (!start) return null
    const bands = Array.from(section.querySelectorAll(':scope > .sheet-print-band'))
    // 表名那一行连同它的下边距：量"第一带从哪儿起"最老实，不必逐个选择器去猜 margin 折叠
    const headPx = Math.max(
      0,
      start.getBoundingClientRect().top - section.getBoundingClientRect().top,
    )
    return { sectionHeadPx: headPx, bands: bands.map(bandOf) }
  })
}

/** 把量出来的留白写回**量它的那一份 DOM**：第一页的留白给 section（表名与第一带要一起居中，
 *  才叫"这张表上下居中"），后面每一带自己起一页，就各自在自己那一页居中 */
export function applyVerticalPads(root: HTMLElement, fits: (SheetFit | null)[]): void {
  const sections = Array.from(root.querySelectorAll<HTMLElement>(':scope > section'))
  fits.forEach((fit, i) => {
    const section = sections[i]
    if (!fit || !section) return
    if (fit.sectionPadPx > 0) section.style.paddingTop = `${fit.sectionPadPx}px`
    if (!fit.bandPadPx.length) return
    Array.from(section.querySelectorAll(':scope > .sheet-print-band')).forEach((band, bi) => {
      const pad = fit.bandPadPx[bi] ?? 0
      if (pad > 0) (band as HTMLElement).style.paddingTop = `${pad}px`
    })
  })
}
