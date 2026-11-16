import { memo, type CSSProperties } from 'react'
import {
  bodyLines,
  revealSets,
  themeOf,
  type AnimDir,
  type BulletAnim,
  type MasterRect,
  type MasterStyle,
  type RevealState,
  type Slide,
  type SlideShape,
} from '../lib/ppt'
import { useSlideChartPng } from '../lib/slide-chart'

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

// StaticSlide 固定 1280px 宽承载 10 英寸页（720pt）：1pt = 16/9 px
const PX_PER_PT = 16 / 9
// 分数坐标 → 渲染像素：图表按这个尺寸现渲，放映时才不会糊
const SLIDE_PX_W = 1280
const SLIDE_PX_H = 720

// 形状盒子的底色/边框（v0.108）：缩略图/放映/PDF 三端同一份像素换算
function boxFace(sh: { fill?: string; outline?: string; outlineW?: number }): CSSProperties {
  return {
    background: sh.fill,
    border: sh.outline
      ? `${((sh.outlineW ?? 1) * PX_PER_PT).toFixed(2)}px solid ${sh.outline}`
      : undefined,
    boxSizing: 'border-box',
  }
}

const inClsOf = (anim: BulletAnim, dir: AnimDir) =>
  anim === 'fade' ? 'ppt-in-fade' : `ppt-in-${anim}-${dir}`

/**
 * 表格形状（v0.127）：原生 <table> 而不是画成一张图——
 * 放映时文字可选可缩放，且导出 PDF 时文字是真文字。
 * 表头行按强调色铺底；格线可关（t.border=false）。
 */
const TableShape = memo(function TableShape({
  sh,
  box,
  phase,
  fg,
  accent,
}: {
  sh: SlideShape
  box: CSSProperties
  phase: string
  fg: string
  accent: string
}) {
  const t = sh.table
  if (!t) return null
  const line = t.border === false ? 'none' : '1px solid rgba(128,128,128,0.45)'
  // v0.140：导入的列宽/行高是比例，直接当 CSS 百分比用（长度对不上就整组不用，退回等分/自适应）
  const colW = t.colW && t.colW.length === (t.rows.reduce((m, r) => Math.max(m, r.length), 0)) ? t.colW : undefined
  const rowH = t.rowH && t.rowH.length === t.rows.length ? t.rowH : undefined
  // 隔行底纹（bandRow）： PowerPoint 数的是第 2、4、6…行；深浅主题都能用的一层中性罩
  const band = t.bandRow ? 'rgba(127,127,127,0.14)' : undefined
  return (
    <div className={`ppt-shape-table${phase ? ` ${phase}` : ''}`} style={{ ...box, ...boxFace(sh) }}>
      <table
        style={{
          width: '100%',
          height: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          fontSize: `${(t.sizePt ?? 14) / 18}em`,
          color: fg,
        }}
      >
        {colW && (
          <colgroup>
            {colW.map((f, ci) => (
              <col key={ci} style={{ width: `${(f * 100).toFixed(2)}%` }} />
            ))}
          </colgroup>
        )}
        <tbody>
          {t.rows.map((row, ri) => (
            <tr key={ri} style={rowH ? { height: `${(rowH[ri] * 100).toFixed(2)}%` } : undefined}>
              {row.map((cell, ci) => {
                const head = t.hasHeader && ri === 0
                const style: CSSProperties = {
                  border: line,
                  padding: '0.2em 0.4em',
                  textAlign: head ? 'center' : 'left',
                  fontWeight: head ? 600 : undefined,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }
                if (head) {
                  style.background = t.headerFill ?? accent
                  style.color = '#ffffff'
                } else if (band && ri % 2 === 1) style.background = band
                return head ? (
                  <th key={ci} style={style}>
                    {cell}
                  </th>
                ) : (
                  <td key={ci} style={style}>
                    {cell}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

/**
 * 图表形状（v0.127）：图是现渲的 PNG，所以这里挂订阅等它渲好。
 * 没渲好之前画一枚占位框——宁可让人看见「这里本该有图」，也不要闪一张错图。
 */
const ChartShape = memo(function ChartShape({
  sh,
  box,
  phase,
}: {
  sh: SlideShape
  box: CSSProperties
  phase: string
}) {
  const w = Math.max(64, Math.round(sh.w * SLIDE_PX_W))
  const h = Math.max(64, Math.round(sh.h * SLIDE_PX_H))
  const png = useSlideChartPng(sh, w, h)
  if (png) {
    return (
      <img
        className={`ppt-shape-img${phase ? ` ${phase}` : ''}`}
        src={png}
        alt=""
        style={{ ...box, ...boxFace(sh) }}
      />
    )
  }
  return (
    <div
      className={`ppt-shape-chart-hollow${phase ? ` ${phase}` : ''}`}
      style={{ ...box, ...boxFace(sh) }}
    />
  )
})

export default memo(function StaticSlide({
  slide,
  themeId,
  master,
  big,
  reveal,
}: {
  slide: Slide
  themeId: string
  master?: MasterStyle
  big?: boolean
  /** 放映揭示进度（缩略图/导出不传 = 全部显示） */
  reveal?: RevealState
}) {
  const t = themeOf(themeId)
  const lines = bodyLines(slide)
  // v0.115：揭示不再是「前 n 条」这种前缀算法——次序可调之后第 3 击可能揭示的是第 2 个形状，
  // 所以真名单由 revealSets 按同一份 revealOrder 还原；不传 reveal（缩略图/导出）= 全部显示
  const sets = reveal ? revealSets(slide, reveal) : undefined
  const lineClass = (i: number): string | undefined => {
    if (!sets || !slide.anim) return undefined
    if (sets.exitedLines.has(i)) return 'ppt-item-out ppt-out-fade' // 出场只有淡出一档（BULLET_EXIT_NAMES）
    if (reveal?.fresh?.kind === 'line' && sets.freshLine === i)
      return `ppt-item-in ${inClsOf(reveal.fresh.anim, reveal.fresh.dir)}`
    return sets.lines.has(i) ? undefined : 'ppt-anim-hide'
  }
  const cls = `ppt-slide-static${big ? ' ppt-slide-big' : ''} ppt-sl-${slide.layout}`
  const fg = master?.bodyColor ?? t.fg
  const accent = master?.titleColor ?? t.accent
  const style: CSSProperties = master?.bgImage
    ? {
        backgroundImage: `url(${master.bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        color: fg,
      }
    : { background: slide.bg ?? master?.bg ?? t.bg, color: fg }
  const abs = (r?: MasterRect): CSSProperties | undefined =>
    r ? { position: 'absolute', left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) } : undefined
  const pad: CSSProperties | undefined = master?.titleRect || master?.bodyRect ? { padding: 0 } : undefined
  return (
    <div className={cls} style={{ ...style, ...pad }}>
      {slide.layout === 'title' ? (
        <div className="ppt-st-title-wrap" style={abs(master?.titleRect)}>
          <div className="ppt-st-title" style={{ color: accent }}>{slide.title}</div>
          <div className="ppt-st-sub">{slide.body}</div>
        </div>
      ) : (
        <>
          {slide.title && (
            <div className="ppt-st-title" style={{ ...abs(master?.titleRect), color: accent }}>
              {slide.title}
            </div>
          )}
          <div className="ppt-st-content" style={abs(master?.bodyRect)}>
            {slide.layout === 'image' && slide.image && (
              <img className="ppt-st-img" src={slide.image} alt="" />
            )}
            {lines.length > 0 && (
              <ul className="ppt-st-list">
                {lines.map((l, i) => (
                  <li key={i} className={lineClass(i)}>
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {/* 自由形状层（v0.107）：绝对定位叠加在版式槽之上；字号按 18pt≡1em 与槽位同一比例缩放；
          v0.108 起盒子带底色/边框（数组序即层叠序，后画在上） */}
      {(slide.shapes ?? []).map((sh, si) => {
        const box: CSSProperties = {
          position: 'absolute',
          left: pct(sh.x),
          top: pct(sh.y),
          width: pct(sh.w),
          height: pct(sh.h),
        }
        // 形状同样进逐条序列（v0.111）：没轮到的藏起来，刚轮到的播入场，退场的播出场。
        // v0.115：参与逐条的只限带动画的形状（没有动画的形状恒显示），而「轮到谁」
        // 由揭示序说了算，不再等于它在数组里的位置
        const animated = !!sh.anim
        const exited = !!sets && animated && sets.exitedShapes.has(si)
        const revealed = !sets || !animated || sets.shapes.has(si)
        const notYet = revealed === false && !exited
        const fresh =
          !!sets &&
          animated &&
          !exited &&
          reveal?.fresh?.kind === 'shape' &&
          sets.freshShape === si
        const phase = [
          exited ? 'ppt-item-out ppt-out-fade' : '',
          fresh ? `ppt-item-in ${inClsOf(reveal!.fresh!.anim, reveal!.fresh!.dir)}` : '',
          notYet ? 'ppt-anim-hide' : '',
        ]
          .filter(Boolean)
          .join(' ')
        if (sh.kind === 'image' && sh.image) {
          return (
            <img
              key={sh.id}
              className={`ppt-shape-img${phase ? ` ${phase}` : ''}`}
              src={sh.image}
              alt=""
              style={{ ...box, ...boxFace(sh) }}
            />
          )
        }
        if (sh.kind === 'text' && sh.text) {
          // v0.140：斜体/下划线/垂直锚点/不换行 + 导入的主题字族。
          // 锚点用弹性盒表达（块内文本没有 CSS 的垂直对齐），不换行压过默认的 pre-wrap
          const anchorJustify =
            sh.anchor === 'middle' ? 'center' : sh.anchor === 'bottom' ? 'flex-end' : undefined
          return (
            <div
              key={sh.id}
              className={`ppt-shape-text${phase ? ` ${phase}` : ''}`}
              style={{
                ...box,
                ...boxFace(sh),
                color: sh.color ?? fg,
                fontSize: `${(sh.sizePt ?? 18) / 18}em`,
                fontWeight: sh.bold ? 700 : undefined,
                fontStyle: sh.italic ? 'italic' : undefined,
                textDecoration: sh.underline ? 'underline' : undefined,
                textAlign: sh.align,
                ...(anchorJustify
                  ? { display: 'flex', flexDirection: 'column', justifyContent: anchorJustify }
                  : {}),
                ...(sh.wrap === false ? { whiteSpace: 'nowrap' } : {}),
                ...(master?.minorFont ? { fontFamily: master.minorFont } : {}),
              }}
            >
              {sh.text}
            </div>
          )
        }
        if (sh.kind === 'table' && sh.table) {
          return (
            <TableShape key={sh.id} sh={sh} box={box} phase={phase} fg={fg} accent={accent} />
          )
        }
        if (sh.kind === 'chart' && sh.chart) {
          return <ChartShape key={sh.id} sh={sh} box={box} phase={phase} />
        }
        return null
      })}
    </div>
  )
})
