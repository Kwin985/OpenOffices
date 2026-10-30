// docx 运行属性长尾的端到端验证（Node 侧）
//
// 这一份钉的是 v0.138 接上的那批字符级属性：主题字体（asciiTheme 一族）、
// rFonts@hint 的含混字符分段、w:pos / w:kern 的屏上语义，以及 cs / szCs / lang
// 三件套随 data-* 进模型那条路。为什么值得单独立脚本：
//
//   1. 它们全部**不在主链路的既有往返测试里**——fidelity 的导入侧与 docx.ts 的
//      导出侧之间夹着一个 TipTap 编辑器，Node 里起不来，中间的 HTML 形状只能在这钉。
//   2. 语料（313 份真件）已经不在盘上，覆盖率量具的分子这轮只剩夹具一条腿——
//      那么夹具就必须自己把"每个属性的屏上后果"写死，而不是只写"读进去了"。
//   3. 主题字体是这批里屏上后果最大的一条：Word 的 Normal 样式只写 asciiTheme，
//      不解析整篇掉回浏览器默认字体。这条值得一条真断言。
//
// 三组：主题字体 → hint 分段 → pos/kern/复杂文字三件套。每组都有反例
// （不解析 / 不切 / 不补的那种形状），只测正面等于自说自话。

import JSZip from 'jszip'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { prosemirrorToDocxBytes } from '../src/lib/docx.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const has = (name, html, sub) => check(name, html.includes(sub), `HTML 里找不到 ${JSON.stringify(sub)}`)

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'

const THEME =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme>` +
  `<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface="等线 Light"/><a:cs typeface="Arial"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="等线"/><a:cs typeface="Times New Roman"/></a:minorFont>` +
  `</a:fontScheme></a:themeElements></a:theme>`

/** 造一份最小 docx：一个段落挂 pStyle，run 的 rPr 由调用方给全 */
async function importDocx(styles, runRPr, text = '正文文字') {
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="S"/></w:pPr>` +
      `<w:r><w:rPr>${runRPr}</w:rPr><w:t>${text}</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
  )
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">${styles}</w:styles>`)
  zip.file('word/theme/theme1.xml', THEME)
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const r = await docxToHtmlFidelity(bytes)
  if (r.blocks === 0) throw new Error('夹具没拆出块，导入没跑起来')
  return r.html
}

const styleWith = (rPr) =>
  `<w:style w:type="paragraph" w:styleId="S"><w:name w:val="S"/>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:style>`

// ───────────────────────── 1. 主题字体 ─────────────────────────

{
  // minorHAnsi 是最常见的形态：Normal 样式整枚 rFonts 只有三个 theme 引用
  const html = await importDocx(styleWith('<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi"/>'), '')
  has('主题：minorHAnsi 解析成 theme 的 minor latin', html, "font-family: 'Calibri'")
  has('主题：minorEastAsia 解析成 theme 的 minor ea', html, "'等线'")
}

{
  const html = await importDocx(styleWith('<w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia"/>'), '')
  has('主题：majorHAnsi 走 majorFont 槽（Calibri Light）', html, "'Calibri Light'")
  has('主题：majorEastAsia 走 majorFont 的 ea 槽', html, "'等线 Light'")
}

{
  // 显式写了的不被主题盖掉——"只填缺的"
  const html = await importDocx(styleWith('<w:rFonts w:asciiTheme="minorHAnsi" w:ascii="Times New Roman"/>'), '')
  has('主题：显式 ascii 压过 asciiTheme', html, "'Times New Roman'")
  check('主题：被压住的主题字体不出现', !html.includes('Calibri'))
}

{
  // 没有 theme1.xml：不炸，也不瞎编字体
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="S"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
  )
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">${styleWith('<w:rFonts w:asciiTheme="minorHAnsi"/>')}</w:styles>`)
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const r = await docxToHtmlFidelity(bytes)
  check('主题：没有 theme1.xml 不解析也不炸', r.blocks > 0 && !r.html.includes('font-family'), `blocks=${r.blocks}`)
}

// ───────────────────────── 2. hint 的含混字符分段 ─────────────────────────

const MIX = 'A“α”аZ' // 拉丁 + 中文弯引号 + 希腊 + 西里尔
const RF = '<w:rFonts w:ascii="Calibri" w:eastAsia="宋体" w:hint="eastAsia"/>'

{
  const html = await importDocx(styleWith(''), RF, MIX)
  // 含混字符相邻时按设计合并成一段（少一个 span 是一个少一处切换，不是漏段）
  const spans = [...html.matchAll(/<span style="([^"]*)"[^>]*>([^<]*)<\/span>/g)].map((m) => ({
    css: m[1],
    text: m[2],
  }))
  const eaSpans = spans.filter((s) => /^font-family: '宋体'/.test(s.css))
  const latinSpans = spans.filter((s) => /^font-family: 'Calibri'/.test(s.css))
  check('hint：含混字符合并成一段', eaSpans.length === 1, `东亚段=${eaSpans.length}`)
  check('hint：非含混字符各走拉丁栈', latinSpans.length === 2, `拉丁段=${latinSpans.length}`)
  // 四枚含混字符都真的落在东亚段里（相邻合并，故同段）
  for (const ch of ['“', '”', 'α', 'а']) {
    check(`hint：${ch} 落在东亚段`, eaSpans[0]?.text.includes(ch) ?? false, `东亚段文本=[${eaSpans.map((s) => s.text).join('')}]`)
  }
  // 拉丁段里不该出现含混字符
  check('hint：拉丁段只含 A 与 Z', latinSpans.every((s) => /^[AZ]+$/.test(s.text)), `拉丁段=[${latinSpans.map((s) => s.text).join('')}]`)
}

{
  // hint=default：浏览器默认行为就是拉丁优先，不该切段
  const html = await importDocx(styleWith(''), '<w:rFonts w:ascii="Calibri" w:eastAsia="宋体" w:hint="default"/>', MIX)
  const n = (html.match(/<span/g) ?? []).length
  check('hint：default 不切段', n === 1, `span 数=${n}`)
}

{
  // 只有 eastAsia 一枚（ascii 缺）：没有可换的序，不切
  const html = await importDocx(styleWith(''), '<w:rFonts w:eastAsia="宋体" w:hint="eastAsia"/>', MIX)
  const n = (html.match(/<span/g) ?? []).length
  check('hint：只有一族字体不切段', n === 1, `span 数=${n}`)
}

{
  // 两族同名：换了序等于没换，不切
  const html = await importDocx(styleWith(''), '<w:rFonts w:ascii="宋体" w:eastAsia="宋体" w:hint="eastAsia"/>', MIX)
  const n = (html.match(/<span/g) ?? []).length
  check('hint：两族同名不切段', n === 1, `span 数=${n}`)
}

// ───────────────────────── 3. pos / kern / 复杂文字三件套 ─────────────────────────

{
  const html = await importDocx(styleWith(''), '<w:position w:val="24"/>')
  has('pos：正升 → vertical-align', html, 'vertical-align: 16px') // 24 半点 = 12pt = 16px
}

{
  const html = await importDocx(styleWith(''), '<w:position w:val="-16"/>')
  has('pos：负降 → vertical-align', html, 'vertical-align: -10.67px') // -16 半点 = -8pt
}

{
  const html = await importDocx(styleWith(''), '<w:kern w:val="0"/>')
  has('kern：0 → font-kerning: none', html, 'font-kerning: none')
}

{
  const html = await importDocx(styleWith(''), '<w:kern w:val="20"/>')
  has('kern：正数 → font-kerning: normal', html, 'font-kerning: normal')
}

{
  const html = await importDocx(styleWith(''), '<w:position w:val="24"/><w:vertAlign w:val="superscript"/>')
  // Word 按 vertAlign 渲染，pos 不兑现
  check('pos：与上下标同时出现时不兑现', !html.includes('vertical-align') && html.includes('<sup>'), html.slice(0, 200))
}

{
  const html = await importDocx(styleWith(''), '<w:rFonts w:ascii="Calibri" w:cs="Arial"/><w:szCs w:val="28"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/>')
  has('cs：rFonts@cs 随 data-cs 进模型', html, 'data-cs="Arial"')
  has('szCs：随 data-szcs 进模型', html, 'data-szcs="28"')
  has('lang：w:lang@val 随 data-lang 进模型', html, 'data-lang="en-US"')
  has('lang：w:lang@eastAsia 随 data-lang-ea 进模型', html, 'data-lang-ea="zh-CN"')
}

{
  // 没有这些属性时一个 data-* 都不发（免得满屏空壳 mark）
  const html = await importDocx(styleWith(''), '<w:sz w:val="24"/>')
  check('没有复杂文字账时不发 data-*', !/data-(cs|szcs|lang)/.test(html), html.slice(0, 200))
}

{
  // t|space 的裁定：空白无条件保留（escText 把连续空格第二个起换 nbsp），
  // 强于 xml:space="preserve" 所需——所以那一属性从不被按名查问（夹具已断言之）
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:r><w:t xml:space="preserve">  带空白的正文  </w:t></w:r></w:p></w:body></w:document>`,
  )
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"/></w:styles>`)
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const r = await docxToHtmlFidelity(bytes)
  has('空白：连续空格活着（nbsp）', r.html, '\u00a0')
  has('空白：首尾空白不丢', r.html, '带空白的正文')
}

// ───────────────────────── 4. 导出侧：charExtra mark → rPr ─────────────────────────
//
// 往返的另一半。链是：fidelity 发 data-* → charExtra mark 接住（真机那一步）→
// docx.ts 读 mark 属性写 rPr。这里钉最后一步，也钉两处**库的真值闸**：
// w:kern 与 w:spacing 一样，0 过不了 `if (options.kern)` 那道门（与 lsTw=0 同一族，
// 见 docx.ts 字符间距那段注）——所以"关掉字偶距"这一档写不回纸，由断言钉成会红的形状。

{
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [
              { type: 'textStyle', attrs: { fontFamily: 'Calibri, 宋体' } },
              { type: 'charExtra', attrs: { cs: 'Arial', hint: 'eastasia', szcs: 28, lang: 'en-US', langEa: 'zh-CN', pos: 24, kern: 20 } },
            ],
          },
        ],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  has('导出：cs 写回 rFonts@cs', xml, 'w:cs="Arial"')
  has('导出：hint 写回 rFonts@hint', xml, 'w:hint="eastAsia"')
  has('导出：fontFamily 仍拆 ascii/eastAsia', xml, 'w:eastAsia="宋体"')
  has('导出：szcs 写回 w:szCs（库外槽）', xml, 'w:szCs w:val="28"')
  has('导出：lang 写回 w:lang@val', xml, 'w:val="en-US"')
  has('导出：langEa 写回 w:lang@eastAsia', xml, 'w:eastAsia="zh-CN"')
  has('导出：pos 写回 w:position', xml, 'w:position w:val="24"')
  has('导出：kern 写回 w:kern', xml, 'w:kern w:val="20"')
}

{
  // 库的真值闸：kern=0 写不回纸（`if (options.kern)`），与 characterSpacing=0 同族
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'x', marks: [{ type: 'charExtra', attrs: { kern: 0 } }] },
        ],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  check('导出：kern=0 过不了库的真值闸（同 lsTw=0 一族）', !xml.includes('w:kern'), '')
}

{
  // 没有 charExtra 时导出形状与本轮之前逐字一致（不因新链多发属性）
  const doc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'y' }] }],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  check('导出：没有 charExtra 不发 rFonts', !xml.includes('<w:rFonts'), '')
}

// ───────────────── 5. w:sym 与 w:u 的主题三枚（v0.159，run 级补丁位）─────────────────
//
// 这两枚是同一笔机制债的两半：包都不给槽。
//   w:sym —— 包里有原生 SymbolRun（发 <w:sym w:char w:font>），只是读手此前把符号当
//            普通文字发出去，往返账上 `sym|char`/`sym|font` 两笔都是「掉了」
//   w:u 的主题三枚 —— 包的 underline 只有 {type,color}，themeColor/themeTint/Shade
//            包外无槽，只能打包后按 <w:u> 出现序补（**计数闸门**：条数对不上整笔放弃）
// 顺带钉住「字面色与主题色是两个槽」这件事：此前写手把解析出来的色写进 w:color，
// 往返账上记着 ff0000 → b4c7e7 那一笔值变。

{
  // 导入侧：w:sym 的 char/font 原值要进模型（载荷 `char;font`）
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r></w:p>` +
      `</w:body></w:document>`,
  )
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"></w:styles>`)
  const r = await docxToHtmlFidelity(new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' })))
  has('sym 导入：char/font 进 data-sym 载荷', r.html, 'data-sym="F0FC;Wingdings"')
  has('sym 导入：字符本身仍在正文里', r.html, '&#xF0FC;')
}

{
  // 导入侧：w:u 的字面色与主题三枚分格装（第二格屏上色、第三格字面色、后三格主题）
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:r><w:rPr><w:u w:val="single" w:color="FF0000" w:themeColor="accent1" w:themeTint="99"/></w:rPr>` +
      `<w:t>下划线</w:t></w:r></w:p></w:body></w:document>`,
  )
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"></w:styles>`)
  const r = await docxToHtmlFidelity(new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' })))
  has('u 导入：六格载荷（线型;屏上色;字面色;主题;tint;shade）', r.html, 'data-u="single;#ff0000;ff0000;accent1;99;"')
}

{
  // 导出侧：data-sym → 真的 <w:sym>（不是 w:t + rFonts）
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '\uf0fc', marks: [{ type: 'charExtra', attrs: { sym: 'F0FC;Wingdings' } }] }],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  has('sym 导出：发回 w:sym 元素', xml, '<w:sym ')
  has('sym 导出：w:char 是原始码位', xml, 'w:char="F0FC"')
  has('sym 导出：w:font 是符号字体', xml, 'w:font="Wingdings"')
  check('sym 导出：不再退化成普通文字', !xml.includes('w:t>\uf0fc'), '')
}

{
  // 反例：多字符时不发 w:sym（一枚 w:sym 只表达一个码点，硬发会吞字）
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'AB', marks: [{ type: 'charExtra', attrs: { sym: 'F0FC;Wingdings' } }] }],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  check('sym 导出：多字符退化为普通文字', !xml.includes('<w:sym'), '')
  has('sym 导出：多字符时字还在', xml, 'AB')
}

{
  // 导出侧：data-u 的主题三枚无槽 → patchUTheme 补进 <w:u> 开标签
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '下划线',
            marks: [
              { type: 'underline' },
              { type: 'charExtra', attrs: { u: 'single;#ff0000;ff0000;accent1;99;' } },
            ],
          },
        ],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  has('u 导出：字面走 w:color（原生槽）', xml, 'w:color="FF0000"')
  has('u 导出：主题引用补回 w:themeColor', xml, 'w:themeColor="accent1"')
  has('u 导出：主题深浅补回 w:themeTint', xml, 'w:themeTint="99"')
}

{
  // 反例：只有主题没有字面时不该凭空写出 w:color（那会把主题钉死成一个色）
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'underline' }, { type: 'charExtra', attrs: { u: 'single;#b4c7e7;;accent1;;' } }],
          },
        ],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  check('u 导出：无字面时不写 w:color', !/w:u [^>]*w:color/.test(xml), '')
  has('u 导出：主题照样补回', xml, 'w:themeColor="accent1"')
}

// ───────────────────────── 5. 文字色的主题三枚（v0.160）─────────────────────────
//
// 与 w:u 那一族同一条机制债的另一半：包发 w:color 时只写 w:val，主题三枚包外无槽，
// 走同一个补丁位（patchElemAttrs 换了 tag）。两组：导出侧补回 + 导入侧带出原值。
// 反例同样要钉：没有字面色时（模型里没有 textStyle.color）补丁无从附着——
// 「只有主题引用、没有字面值」的那一段会整族掉，这是已知的边界，不是静默写坏。

{
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '主题色正文',
            marks: [
              { type: 'textStyle', attrs: { color: '#adbbd4' } },
              { type: 'charExtra', attrs: { ctheme: 'accent1;99;BF' } },
            ],
          },
        ],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  has('ctheme 导出：字的解析值落在 w:color@val', xml, '<w:color w:val="adbbd4"')
  has('ctheme 导出：主题引用补回 w:themeColor', xml, 'w:themeColor="accent1"')
  has('ctheme 导出：主题深浅两枚一起补', xml, 'w:themeTint="99"')
  has('ctheme 导出：themeShade 也补', xml, 'w:themeShade="BF"')
}

{
  // 反例：没有 textStyle.color 时包不发 w:color，补丁无处附着——不凭空造元素
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'charExtra', attrs: { ctheme: 'accent1;;' } }] }],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  check('ctheme 导出：无字面色时不凭空写 w:color', !xml.includes('<w:color'), '')
}

{
  // 导入侧：主题部件里没有 clrScheme（这份 THEME 只有 fontScheme），主题解析不出来，
  // 但**引用名照样要带出去**——解析与带值是两件事（v0.150 起的老纪律）
  const html = await importDocx(styleWith(''), '<w:color w:val="ff0000" w:themeColor="accent1" w:themeTint="99"/>')
  has('ctheme 导入：主题引用随载荷带出', html, 'data-ctheme="accent1;99;"')
  has('ctheme 导入：解析不出主题时字面值兜底', html, 'color: #ff0000')
}

// ───────────────────────── 6. 缩进的字符档（v0.160）─────────────────────────
//
// CT_Ind 上 firstLineChars / hangingChars 是「按字符数」的那套记法，屏上按字号折成
// px 兑现、存盘写回**原值**。两枚是**同一枚元素的两个属性**，所以走带 ind 前缀的
// ppr 载荷键、由 pprOrder 并进包自己那一枚 <w:ind>（再插一枚会被 Word 丢掉前一枚）。

{
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { ppr: 'indFirstLineChars=200;indHangingChars=0' },
        content: [{ type: 'text', text: '按字符缩进' }],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  has('ind 导出：字符档写回 w:ind', xml, 'w:firstLineChars="200"')
  has('ind 导出：hangingChars=0 也写回（0 是真值）', xml, 'w:hangingChars="0"')
  // 同一枚元素：不能出现两个 <w:ind>
  check('ind 导出：pPr 里只有一枚 w:ind', (xml.match(/<w:ind/g) ?? []).length === 1, `实际 ${(xml.match(/<w:ind/g) ?? []).length} 枚`)
}

{
  // 包自己发的那一枚 w:ind 带着 left（模型算出来的缩进）时，字符档**并进去**而不是另起一枚
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { indentLeft: 40, ppr: 'indFirstLineChars=200' },
        content: [{ type: 'text', text: '两档合并' }],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  const ind = /<w:ind[^>]*>/.exec(xml)?.[0] ?? ''
  check('ind 导出：合并后仍只有一枚 w:ind', (xml.match(/<w:ind/g) ?? []).length === 1, ind)
  has('ind 导出：原有的 w:left 保住', ind, 'w:left="600"')
  has('ind 导出：字符档并进同一枚', ind, 'w:firstLineChars="200"')
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
