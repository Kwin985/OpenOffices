import { memo, type CSSProperties } from 'react'
import {
  bodyLines,
  themeOf,
  type BulletAnim,
  type MasterRect,
  type MasterStyle,
  type Slide,
} from '../lib/ppt'

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

export default memo(function StaticSlide({
  slide,
  themeId,
  master,
  big,
  visibleLines,
  anim,
}: {
  slide: Slide
  themeId: string
  master?: MasterStyle
  big?: boolean
  visibleLines?: number // 仅显示前 N 条要点（放映逐条揭示）
  anim?: BulletAnim // 最新揭示那条的入场效果
}) {
  const t = themeOf(themeId)
  const lines = bodyLines(slide)
  const shown = visibleLines === undefined ? lines : lines.slice(0, visibleLines)
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
            {shown.length > 0 && (
              <ul className="ppt-st-list">
                {shown.map((l, i) => (
                  <li
                    key={i}
                    className={
                      visibleLines !== undefined && anim && i === shown.length - 1
                        ? `ppt-item-in ppt-in-${anim}`
                        : undefined
                    }
                  >
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
})
