export type SlideLayout = 'title' | 'bullets' | 'image' | 'blank'

export type SlideTransition = 'fade' | 'push' | 'wipe' | 'split'

export const TRANSITION_NAMES: Record<SlideTransition, string> = {
  fade: '淡入',
  push: '推入',
  wipe: '擦除',
  split: '劈开',
}

export interface MasterRect {
  x: number
  y: number
  w: number
  h: number
}

export interface MasterStyle {
  bg?: string // 纯色背景 #rrggbb
  bgImage?: string // 背景图 data URI
  titleColor?: string
  bodyColor?: string
  titleRect?: MasterRect
  bodyRect?: MasterRect
}

export interface Slide {
  id: string
  layout: SlideLayout
  title: string
  body: string
  image?: string // data URI
  notes?: string // 演讲者备注
  bg?: string // 单页纯色背景覆盖
  transition?: SlideTransition // 切页动画，未设=无
}

export interface DeckTheme {
  id: string
  name: string
  bg: string
  fg: string
  accent: string
}

export interface Deck {
  app: 'openoffices'
  kind: 'deck'
  version: 1
  title: string
  theme: string
  slides: Slide[]
  master?: MasterStyle
}

export const THEMES: DeckTheme[] = [
  { id: 'default', name: '简洁白', bg: '#ffffff', fg: '#1f2329', accent: '#2c66d4' },
  { id: 'dark', name: '深夜蓝', bg: '#141a2b', fg: '#e8ecf5', accent: '#5b8cff' },
  { id: 'gray', name: '商务灰', bg: '#f2f3f5', fg: '#33383f', accent: '#4e5969' },
  { id: 'warm', name: '暖阳橙', bg: '#fff8ef', fg: '#4a3520', accent: '#e8732a' },
  { id: 'green', name: '墨绿青', bg: '#f0f7f2', fg: '#1e3a2b', accent: '#21a366' },
  { id: 'rose', name: '樱桃红', bg: '#fff5f5', fg: '#4a1f24', accent: '#d43c4f' },
]

export function themeOf(id: string): DeckTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export const LAYOUT_NAMES: Record<SlideLayout, string> = {
  title: '标题页',
  bullets: '内容页',
  image: '图片页',
  blank: '空白页',
}

let seq = 0
export function newId(): string {
  seq += 1
  return `s${Date.now().toString(36)}${seq}`
}

export function newSlide(layout: SlideLayout = 'bullets'): Slide {
  return {
    id: newId(),
    layout,
    title: layout === 'title' ? '演示文稿标题' : '',
    body: layout === 'title' ? '副标题 / 日期 / 作者' : '',
  }
}

export function emptyDeck(): Deck {
  return {
    app: 'openoffices',
    kind: 'deck',
    version: 1,
    title: '未命名演示',
    theme: 'default',
    slides: [newSlide('title'), newSlide('bullets')],
  }
}

export function bodyLines(slide: Slide): string[] {
  return slide.body.split(/\r?\n/).filter((l) => l.trim().length > 0)
}

function isTransition(v: unknown): v is SlideTransition {
  return typeof v === 'string' && v in TRANSITION_NAMES
}

export function serializeDeck(deck: Deck): string {
  return JSON.stringify(deck, null, 2)
}

function parseRect(v: unknown): MasterRect | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const r = v as Record<string, unknown>
  const n = [r.x, r.y, r.w, r.h].map((k) => (typeof k === 'number' && Number.isFinite(k) ? k : NaN))
  return n.every((k) => !Number.isNaN(k)) ? { x: n[0], y: n[1], w: n[2], h: n[3] } : undefined
}

function parseMaster(v: unknown): MasterStyle | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const m = v as Record<string, unknown>
  const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : undefined)
  const out: MasterStyle = {
    bg: str('bg'),
    bgImage: str('bgImage'),
    titleColor: str('titleColor'),
    bodyColor: str('bodyColor'),
    titleRect: parseRect(m.titleRect),
    bodyRect: parseRect(m.bodyRect),
  }
  return Object.values(out).some((x) => x !== undefined) ? out : undefined
}

export function parseDeck(text: string): Deck {
  const raw = JSON.parse(text) as Partial<Deck>
  if (raw.app !== 'openoffices' || raw.kind !== 'deck' || !Array.isArray(raw.slides)) {
    throw new Error('不是有效的 OpenOffices 演示文件（.opd）')
  }
  const deck: Deck = {
    app: 'openoffices',
    kind: 'deck',
    version: 1,
    title: typeof raw.title === 'string' ? raw.title : '未命名演示',
    theme: typeof raw.theme === 'string' ? raw.theme : 'default',
    slides: raw.slides.map((s) => ({
      id: typeof s.id === 'string' ? s.id : newId(),
      layout: (['title', 'bullets', 'image', 'blank'] as string[]).includes(s.layout ?? '')
        ? s.layout!
        : 'bullets',
      title: typeof s.title === 'string' ? s.title : '',
      body: typeof s.body === 'string' ? s.body : '',
      image: typeof s.image === 'string' ? s.image : undefined,
      notes: typeof s.notes === 'string' ? s.notes : undefined,
      bg: typeof s.bg === 'string' ? s.bg : undefined,
      transition: isTransition(s.transition) ? s.transition : undefined,
    })),
  }
  const master = parseMaster(raw.master)
  if (master) deck.master = master
  return deck
}
