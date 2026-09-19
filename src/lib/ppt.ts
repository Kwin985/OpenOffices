export type SlideLayout = 'title' | 'bullets' | 'image' | 'blank'

export interface Slide {
  id: string
  layout: SlideLayout
  title: string
  body: string
  image?: string // data URI
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

export function serializeDeck(deck: Deck): string {
  return JSON.stringify(deck, null, 2)
}

export function parseDeck(text: string): Deck {
  const raw = JSON.parse(text) as Partial<Deck>
  if (raw.app !== 'openoffices' || raw.kind !== 'deck' || !Array.isArray(raw.slides)) {
    throw new Error('不是有效的 OpenOffices 演示文件（.opd）')
  }
  return {
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
    })),
  }
}
