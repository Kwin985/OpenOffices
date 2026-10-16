import { Extension } from '@tiptap/core'

/**
 * 列表符面（ODF 是 `text:list-level-style-bullet@text:bullet-char`，OOXML 那头的对应物是 `w:sym`）。
 *
 * 为什么这一层先前放不下：裸 `bulletList` 不吃 `ul` 上的 `style` 与 `data-*`，
 * 保真导入发出的 `list-style-type:'◆'` 在 `setContent` 那一刻就被剥掉——
 * 屏上看到过一次，模型里没有，更谈不上写回 ODT。
 *
 * 为什么走「全局属性」而不是 `BulletList.extend`：后者要 `import { BulletList } from '@tiptap/extension-list'`，
 * 而那枚包只经 `@tiptap/starter-kit` 传递、不在 `package.json` 直接依赖榜里（本仓 CI 为漏声明依赖断过一次，
 * 补声明过 `@tiptap/core`/`@tiptap/extensions`）；`addGlobalAttributes({ types: ['bulletList'] })` 落在同一枚节点型上，
 * 既不用撤 StarterKit 那枚，也没有同名并存的警告。
 *
 * 存的形状是符面字符本身（原样，可多字符），不是 CSS 片段：屏上包装成 `list-style-type:'X'`，
 * ODT 包装成 `text:bullet-char="X"`，两头各自拼。
 *
 * 第二枚 `bulletFont` 存的是那一层的专字（ODF 的 `style:font-name`，OOXML 那头的对应物是 `w:rFonts`）：
 * 它走 `data-oo-bullet-font` 而不走行内 `font-family`——后者挂在 `<ul>` 上会把 `li` 正文的字族一同拖走
 * （b45 的 S 族读数），而只换符面的那条 `::marker` 规则通道在 ODT 这头还没有出规则的地方。
 * 所以这一层先把「档里写着哪一口字体」存住，屏上照宿主默认画。
 */

/** 宿主默认的那几个关键字不是「档里写了自定义符面」，读回来折成 null */
const CSS_DEFAULTS = new Set(['disc', 'circle', 'square', 'none', 'inherit', 'initial', 'unset'])

/** CSS 串里 `\X` 就是 X 本身；DOM 读回来的序列化串靠它才写得出引号（`"` → `"\""`），所以剥引号后还得还原。 */
function cssUnescape(body: string): string {
  return body.replace(/\\([\s\S])/g, (_m, c: string) => c)
}

/** 与 cssUnescape 配对：单引号串里的 `'` 与 `\` 必须转义，否则整条声明被浏览器丢掉 */
function cssEscapeChar(ch: string): string {
  return ch.replace(/['\\]/g, (c) => '\\' + c)
}

/** CSS 的 `<string>` 或关键字 → 符面字符：去引号、还原转义、折关键字，其余原样当字面。
 * 模型不设闸（引号、反斜杠、私有区都照收）——拒发是读手那一层的取舍，不是这一层的。 */
export function bulletCharFromCss(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  const q = s.charAt(0)
  if ((q === `'` || q === '"') && s.length >= 2 && s.charAt(s.length - 1) === q) {
    const body = cssUnescape(s.slice(1, s.length - 1))
    return body || null
  }
  return CSS_DEFAULTS.has(s.toLowerCase()) ? null : s
}

export const BulletChar = Extension.create({
  name: 'bulletChar',

  addGlobalAttributes() {
    return [
      {
        types: ['bulletList'],
        attributes: {
          bulletChar: {
            default: null,
            parseHTML: (el) => bulletCharFromCss(el.style?.listStyleType),
            renderHTML: (attrs) =>
              attrs.bulletChar ? { style: `list-style-type:'${cssEscapeChar(attrs.bulletChar)}'` } : {},
          },
          bulletFont: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-oo-bullet-font') || null,
            renderHTML: (attrs) => (attrs.bulletFont ? { 'data-oo-bullet-font': attrs.bulletFont } : {}),
          },
        },
      },
    ]
  },
})
