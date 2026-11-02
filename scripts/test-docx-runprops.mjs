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

import fs from 'node:fs'
import JSZip from 'jszip'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { parseBdrPayload, parseShdPayload } from '../src/lib/cell-style.ts'

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

// ───────────────────── 7. 全大写与小型大写并存（v0.161）────────────────────
//
// 包的 RunProperties 里 smallCaps 与 allCaps 是 **else-if**（dist/index.mjs:10538）：
// 有了 smallCaps 就再不看 allCaps。一个 run 同时要两枚时 `<w:caps/>` 整个消失——
// 这是库的实现细节，不是我们传错了。补丁按 `<w:smallCaps>` 出现序在它前面插回去。
{
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '两枚都要',
            marks: [{ type: 'charExtra', attrs: { caps: '1', smallcaps: '1' } }],
          },
        ],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  has('caps 导出：两枚同时要时 w:smallCaps 仍在', xml, '<w:smallCaps/>')
  has('caps 导出：被库吞掉的那枚 w:caps 补回', xml, '<w:caps/>')
  // 次位：CT_RPrBase 里 caps 排在 smallCaps 之前
  check('caps 导出：w:caps 排在 w:smallCaps 之前', xml.indexOf('<w:caps/>') < xml.indexOf('<w:smallCaps/>'), xml.slice(xml.indexOf('<w:rPr'), xml.indexOf('<w:rPr') + 200))
}

{
  // 反例：只有 caps 时库自己发 <w:caps/>，补丁不该再插一枚（插了就是两枚同名元素）
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '只要大写', marks: [{ type: 'charExtra', attrs: { caps: '1' } }] }] },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  check('caps 导出：只要 caps 时整份只有一枚', (xml.match(/<w:caps/g) ?? []).length === 1, xml.slice(xml.indexOf('<w:rPr'), xml.indexOf('<w:rPr') + 200))
}

// ──────────────────── 8. 样式的主题字体引用（v0.161）───────────────────────
//
// Word 的 Normal 只写 `asciiTheme="minorHAnsi"`，具名字体靠主题部件解析。写手发的是
// 解析值；只发解析值就把「跟着主题走」改成了「钉死 Calibri」。两枚一起写才与源等价。
{
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }
  const bytes = await prosemirrorToDocxBytes(doc, {
    styles: [
      {
        id: 'Normal',
        name: 'Normal',
        kind: 'paragraph',
        run: { font: 'Calibri', fontTheme: { ascii: 'minorHAnsi', eastAsia: 'minorEastAsia', hAnsi: 'minorHAnsi' } },
        para: {},
      },
      // 子样式不写引用名：包自己沿 basedOn 摊字体，再写一遍就成了「这一层也钉了一次」
      { id: 'Child', name: 'child', kind: 'paragraph', basedOn: 'Normal', run: { font: 'Calibri' }, para: {} },
    ],
  })
  const xml = await (await JSZip.loadAsync(bytes)).file('word/styles.xml').async('string')
  const normal = /<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/.exec(xml)?.[0] ?? ''
  const child = /<w:style\b[^>]*w:styleId="Child"[^>]*>[\s\S]*?<\/w:style>/.exec(xml)?.[0] ?? ''
  has('字体主题导出：解析值照写', normal, 'w:ascii="Calibri"')
  has('字体主题导出：asciiTheme 补回', normal, 'w:asciiTheme="minorHAnsi"')
  has('字体主题导出：eastAsiaTheme 补回', normal, 'w:eastAsiaTheme="minorEastAsia"')
  has('字体主题导出：hAnsiTheme 补回', normal, 'w:hAnsiTheme="minorHAnsi"')
  check('字体主题导出：子样式不凭空戴引用名', !/Theme=/.test(child), child.slice(0, 300))
}

// ─────────────────── 9. 量具口径：裸 OnOff 元素 ≡ w:val="1" ─────────────────
//
// 这一条不在产品里，在 scripts/fidelity-roundtrip.mjs 的 census：`<w:vanish/>` 与
// `<w:vanish w:val="1"/>` 是同一件事。产品测不到它，所以断言落在账本自身上——
// 账本不自查，假红就一直占着榜单（v0.157 那条教训）。
{
  const j = JSON.parse(fs.readFileSync(new URL('../docs/fidelity-roundtrip.json', import.meta.url), 'utf8'))
  check('量具口径：裸 OnOff 已归一（账本自陈）', j.definition?.onOffBareElement === true, '')
  // 归一对的效果：源里写 w:val="1"、写出包发裸元素的那几笔，不应再挂在「掉了」上
  check('量具口径：vanish|val 不再记成掉了', j.pairs?.['vanish|val']?.bucket !== 'lost', j.pairs?.['vanish|val']?.bucket ?? '(不在账)')
  check('量具口径：widowControl|val 不再记成值变', j.pairs?.['widowControl|val']?.bucket !== 'value', j.pairs?.['widowControl|val']?.bucket ?? '(不在账)')
  // 这枚 run 上有 caps 也有 smallCaps，库只发一枚——是真的丢，靠产品侧补丁修
  check('量具口径：caps|val 由产品补丁翻正（不是靠归一）', j.pairs?.['caps|val']?.bucket === 'kept', j.pairs?.['caps|val']?.bucket ?? '(不在账)')
}

// ────────────── 10. 表条件格式的落点开关（v0.162）──────────────────────────
//
// `w:tblPr/w:cnfStyle` 十三枚：Word 的表样式靠它决定条件格式落在哪一行/列（tblLook 只管
// 要不要套）。此前是**纯只读记账**（按名查问、一个数不落地），这一轮升成只往返：
// data-cnf 定序格串 + 打包后补丁插回 tblPr（包没有这一族的槽）。
{
  const cell = (text) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'table',
        attrs: { cnf: '000000100000;1;0;1;0;1;0;1;0;1;0;0;0' },
        content: [{ type: 'tableRow', content: [cell('甲'), cell('乙')] }],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  const cnf = /<w:cnfStyle[^>]*>/.exec(xml)?.[0] ?? ''
  has('cnfStyle 导出：位串 val 原样发回', cnf, 'w:val="000000100000"')
  has('cnfStyle 导出：首行开关', cnf, 'w:firstRow="1"')
  has('cnfStyle 导出：末行开关（显式 0 也要发）', cnf, 'w:lastRow="0"')
  has('cnfStyle 导出：四角之一', cnf, 'w:firstRowFirstColumn="1"')
  // 次位：CT_TblPrBase 里 cnfStyle 紧跟 tblStyle、排在 tblW 之前
  check('cnfStyle 导出：插在 tblW 之前', xml.indexOf('<w:cnfStyle') < xml.indexOf('<w:tblW'), xml.slice(0, 400))
  check('cnfStyle 导出：整份只有一枚', (xml.match(/<w:cnfStyle/g) ?? []).length === 1, '')
}

{
  // 反例：位串形状不对（11 位）**只丢那一格**，其余十二枚照发——脏格整格丢是这一族
  // 的既定口径（与 parseTblPrPayload 同款），不因为一枚坏了就把整枚元素吞掉
  const cell = (text) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'table',
        attrs: { cnf: '0000001000;1;0;1;0;1;0;1;0;1;0;0;0' },
        content: [{ type: 'tableRow', content: [cell('甲')] }],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  const cnf = /<w:cnfStyle[^>]*>/.exec(xml)?.[0] ?? ''
  check('cnfStyle 导出：位串形状不对就丢那一格', cnf !== '' && !cnf.includes('w:val='), cnf)
  has('cnfStyle 导出：同一枚上其余开关照发', cnf, 'w:firstRow="1"')
}

{
  // 导入侧：十三枚读成定序格串（ST_OnOff 的 true/on 归一成 1）
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:tbl><w:tblPr><w:cnfStyle w:val="000000100000" w:firstRow="true" w:lastRow="0"` +
      ` w:firstColumn="on" w:lastColumn="0" w:oddHBand="1" w:evenHBand="0" w:oddVBand="1"` +
      ` w:evenVBand="0" w:firstRowFirstColumn="1" w:firstRowLastColumn="0"` +
      ` w:lastRowFirstColumn="0" w:lastRowLastColumn="0"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>` +
      `<w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
      `</w:body></w:document>`,
  )
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"></w:styles>`)
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const r = await docxToHtmlFidelity(bytes)
  has('cnfStyle 导入：十三枚读成定序格串', r.html, 'data-cnf="000000100000;1;0;1;0;1;0;1;0;1;0;0;0"')
}

// ────────────── 11. 表级边框六边原值（v0.163）────────────────────────────
//
// `w:tblPr/w:tblBorders` 六条边各七枚：val / sz / color / space / themeColor /
// themeTint / themeShade。包恒发这一片（六枚硬编码默认边 single/4/auto），六个槽里
// 既装不下 space 也装不下主题三枚——所以走**整片替换**而不是属性补丁。
// 口径：只做存盘通道，**不动屏上分摊**（格边 padding 那一趟是另一本账）。
{
  const cell = (text) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  // 载荷格序 = TBLB_EDGES（top;left;bottom;right;insideH;insideV）× TBLB_KEYS 七枚
  const tblb = [
    'single;4;000000;1', // top
    'single;4;000000;0', // left
    'single;4;000000;0', // bottom
    'single;4;000000;0', // right
    'single;4;000000;2;accent1;99;BF', // insideH（带主题三枚）
    'single;4;000000;3;accent1;99;BF', // insideV
  ].join('|')
  const doc = {
    type: 'doc',
    content: [
      { type: 'table', attrs: { tblb }, content: [{ type: 'tableRow', content: [cell('甲'), cell('乙')] }] },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  const block = /<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.exec(xml)?.[0] ?? ''
  has('tblBorders 导出：space 原值（磅，不再丢）', block, '<w:insideH w:val="single" w:sz="4" w:color="000000" w:space="2"')
  has('tblBorders 导出：主题三枚', block, 'w:themeColor="accent1" w:themeTint="99" w:themeShade="BF"')
  has('tblBorders 导出：insideV 的 space 是 3 不是 2', block, 'w:space="3"')
  // 反例：包那六枚硬编码默认（color="auto"、无 space）必须被整片换掉
  check('tblBorders 导出：包的硬编码默认已被整片替换', !block.includes('w:color="auto"'), block)
  check('tblBorders 导出：仍是六条边', (block.match(/<w:(top|left|bottom|right|insideH|insideV)\b/g) ?? []).length === 6, block)
  check('tblBorders 导出：整份只有一片', (xml.match(/<w:tblBorders>/g) ?? []).length === 1, '')
}

{
  // 反例：**源件没写**的边不该凭空长出——载荷只带 top 一条边就只发一条。
  // 包默认发全六枚，撤掉其余五枚比留着更接近源件
  const cell = (text) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const doc = {
    type: 'doc',
    content: [
      { type: 'table', attrs: { tblb: 'single;4;000000;1' }, content: [{ type: 'tableRow', content: [cell('甲')] }] },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  const block = /<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.exec(xml)?.[0] ?? ''
  check('tblBorders 导出：只发载荷里有的边（余下五枚撤掉）', (block.match(/<w:(top|left|bottom|right|insideH|insideV)\b/g) ?? []).length === 1, block)
  has('tblBorders 导出：那一条边仍在', block, '<w:top w:val="single"')
}

{
  // 反例：形状不对的格整格丢（不猜）；一条边全格皆空则这条边不进表
  const cell = (text) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const doc = {
    type: 'doc',
    content: [
      { type: 'table', attrs: { tblb: 'single;四;000000;1|;;;|single;4;0000ff;2' }, content: [{ type: 'tableRow', content: [cell('甲')] }] },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  const block = /<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.exec(xml)?.[0] ?? ''
  check('tblBorders 导出：脏格整格丢（sz=四 不落）', !block.includes('w:sz="四"'), block)
  check('tblBorders 导出：全空的边不进表（left 撤掉）', !block.includes('<w:left'), block)
  has('tblBorders 导出：干净那条边照发', block, 'w:color="0000ff"')
}

{
  // 导入侧：六边原值读成定序格串；space 与主题三枚都按**原值**带走（不解析）
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:tbl><w:tblPr><w:tblBorders>` +
      `<w:top w:val="single" w:sz="4" w:space="1" w:color="000000"/>` +
      `<w:insideH w:val="single" w:sz="4" w:space="2" w:color="000000" w:themeColor="accent1" w:themeTint="99" w:themeShade="BF"/>` +
      `<w:insideV w:val="single" w:sz="4" w:space="3" w:color="000000" w:themeColor="accent1" w:themeTint="99" w:themeShade="BF"/>` +
      `</w:tblBorders></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>` +
      `<w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
      `</w:body></w:document>`,
  )
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"></w:styles>`)
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const r = await docxToHtmlFidelity(bytes)
  has(
    'tblBorders 导入：六边定序格串（空边留空）',
    r.html,
    'data-tblb="single;4;000000;1;;;|;;;;;;|;;;;;;|;;;;;;|single;4;000000;2;accent1;99;BF|single;4;000000;3;accent1;99;BF"',
  )
  // 屏上那一趟（分摊到格）照旧在跑：space 变成格边 padding，与存盘通道互不顶替
  has('tblBorders 导入：屏上分摊照旧（格边 bdSpace 那一趟没被顶替）', r.html, 'data-bdspace-top="1.33"')
}

// ---- 底纹的字面/主题双写 + 主题件透传（v0.164）------------------------------
//
// 三件事一起钉：读侧把「主题引用吃掉的那枚字面 fill」带进 data-shd；写侧按出现序把它
// 合回 `<w:shd>`；主题件本身跟着走（否则写出去的主题引用全是悬空的）。

/** 带色槽的主题件（上面那份 THEME 只有字体，颜色一个都解不出来） */
const THEME_COLORS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="Office">` +
  `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
  `</a:clrScheme></a:themeElements></a:theme>`

{
  // 导入侧：pct25 + 主题填充（accent2/99/BF）+ 字面 fill=FFFFFF
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:pPr><w:shd w:val="pct25" w:color="FF0000" w:fill="FFFFFF" w:themeFill="accent2" w:themeFillTint="99" w:themeFillShade="BF"/></w:pPr>` +
      `<w:r><w:t>底色</w:t></w:r></w:p></w:body></w:document>`,
  )
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"></w:styles>`)
  zip.file('word/theme/theme1.xml', THEME_COLORS)
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const r = await docxToHtmlFidelity(bytes)
  has(
    'shd 导入：字面 fill 与主题三枚进 data-shd（bg 是导入那一刻的屏上色）',
    r.html,
    'data-shd="fill=FFFFFF;themeFill=accent2;themeFillTint=99;themeFillShade=BF;bg=e0bea8"',
  )
  // 图案那一份载荷照旧：背景色跟着主题解析（屏上色），两份载荷各管各的
  has('shd 导入：data-shade 的背景仍是解析后的主题色', r.html, 'data-shade="pct25|ff0000|e0bea8"')
}

{
  // 导出侧：背景色没被改过 → 字面 fill 写回、主题三枚补上
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { background: '#e0bea8', shd: 'fill=FFFFFF;themeFill=accent2;themeFillTint=99;themeFillShade=BF;bg=e0bea8' },
        content: [{ type: 'text', text: '底色' }],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  const shd = /<w:shd[^>]*>/.exec(xml)?.[0] ?? ''
  has('shd 导出：字面 fill 写回（不是解析后的屏上色）', shd, 'w:fill="FFFFFF"')
  has('shd 导出：主题引用三枚补上', shd, 'w:themeFill="accent2"')
  has('shd 导出：themeFillTint', shd, 'w:themeFillTint="99"')
  has('shd 导出：themeFillShade', shd, 'w:themeFillShade="BF"')
  check('shd 导出：不给第二枚 w:fill（改名不是追加）', (shd.match(/w:fill=/g) ?? []).length === 1, shd)
}

{
  // 用户改过底纹色：主题引用作废，按新色写——否则 Word 按主题解析，改色看不见
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { background: '#ff0000', shd: 'fill=FFFFFF;themeFill=accent2;themeFillTint=99;bg=e0bea8' },
        content: [{ type: 'text', text: '改过色' }],
      },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  const shd = /<w:shd[^>]*>/.exec(xml)?.[0] ?? ''
  check('shd 导出：改过色就不补主题引用', !shd.includes('w:themeFill'), shd)
  has('shd 导出：改过的色照写', shd, 'w:fill="ff0000"')
}

{
  // 主题件透传：部件本体 + 关系 + Content_Types Override 三件齐全
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '带主题' }] }] }
  const bytes = await prosemirrorToDocxBytes(doc, { themeXml: THEME_COLORS })
  const zip = await JSZip.loadAsync(bytes)
  const theme = zip.file('word/theme/theme1.xml')
  check('主题件：写进包了', !!theme)
  check('主题件：与源件逐字相同', (await theme?.async('string')) === THEME_COLORS)
  const ct = (await zip.file('[Content_Types].xml')?.async('string')) ?? ''
  has('主题件：Content_Types 有 Override', ct, 'PartName="/word/theme/theme1.xml"')
  const rels = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''
  has('主题件：document.xml.rels 有 theme 关系', rels, 'relationships/theme')
  // 没有主题件的源件不凭空造一枚
  const plain = await prosemirrorToDocxBytes(doc)
  check('主题件：源件没有就不造', !(await JSZip.loadAsync(plain)).file('word/theme/theme1.xml'))
}

{
  // 单元格那一处：格底纹的 <w:shd> 在 <w:tcPr> 里，排在格内段落的之前——
  // 登记顺序错了计数闸门会整笔放弃（静默），所以这条必须单独钉
  const cell = {
    type: 'tableCell',
    attrs: { background: '#e0bea8', shd: 'fill=FFFFFF;themeFill=accent2;themeFillTint=99;bg=e0bea8' },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '格' }] }],
  }
  const doc = {
    type: 'doc',
    content: [
      { type: 'table', content: [{ type: 'tableRow', content: [cell] }] },
    ],
  }
  const bytes = await prosemirrorToDocxBytes(doc)
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  const tcPr = /<w:tcPr>[\s\S]*?<\/w:tcPr>/.exec(xml)?.[0] ?? ''
  has('shd 导出（格）：主题引用补进 tcPr 那一枚', tcPr, 'w:themeFill="accent2"')
  has('shd 导出（格）：字面 fill 写回', tcPr, 'w:fill="FFFFFF"')
}

{
  // 载荷形状闸门：脏键整键丢，不许猜
  const p = parseShdPayload('fill=XYZ;themeFill=accent 2;themeFillTint=9;themeFillShade=BF;bg=zzzzzz')
  check('data-shd 解析：脏键整键丢', Object.keys(p).length === 1 && p.themeFillShade === 'BF', JSON.stringify(p))
}

// ───────────────────── 8. 边框的存盘原件（v0.165）─────────────────────
//
// 四枚属性（字面色 + themeColor/tint/shade）在模型里没有槽：`bd*` 只装解析后的屏上色。
// 这一组钉的是「补得回来」与「该作废时真作废」两头——只测前者等于自说自话。

{
  // 段落 pBdr：上边主题三枚 + 字面色。**注意第一枚属性没有前导空格**——v0.165 的
  // 真 bug：`\sw:` 收边把 w:color 整条跳过，主题三枚却照贴，补丁「成功了一半」。
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { bdTop: '1.33px solid #adbbd4', bdr: 'top;FF0000;accent1;99;BF;adbbd4' },
        content: [{ type: 'text', text: '带主题边框' }],
      },
    ],
  }
  const xml = await (await JSZip.loadAsync(await prosemirrorToDocxBytes(doc))).file('word/document.xml').async('string')
  const top = /<w:pBdr[\s\S]*?<\/w:pBdr>/.exec(xml)?.[0] ?? ''
  has('pBdr 导出：主题三枚补回', top, 'w:themeColor="accent1"')
  has('pBdr 导出：主题深浅两枚补回', top, 'w:themeShade="BF"')
  has('pBdr 导出：字面色写回原件（不是解析后的屏上色）', top, 'w:color="FF0000"')
  check('pBdr 导出：屏上色不留在包里', !top.includes('adbbd4'), top)
}

{
  // 反例：用户换过色（当前 bdTop 的色与载荷里的基准对不上）→ 主题引用整笔作废
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { bdTop: '1.33px solid #00ff00', bdr: 'top;FF0000;accent1;99;BF;adbbd4' },
        content: [{ type: 'text', text: '改过色' }],
      },
    ],
  }
  const xml = await (await JSZip.loadAsync(await prosemirrorToDocxBytes(doc))).file('word/document.xml').async('string')
  const top = /<w:pBdr[\s\S]*?<\/w:pBdr>/.exec(xml)?.[0] ?? ''
  check('pBdr 导出：改过色就不补主题引用', !top.includes('w:themeColor'), top)
  has('pBdr 导出：改过的色照写', top, 'w:color="00ff00"')
}

{
  // 逐格 tcBorders：两条边各自的原件（一条主题色、一条 auto 字面色）。
  // 块级对位是这一族的难点：<w:top> 在 tblBorders/tcBorders/pBdr 上都长着，只能按块找
  const cell = {
    type: 'tableCell',
    attrs: {
      bdTop: '1.33px solid #b4c7e7',
      bdLeft: '0.67px dashed #000000',
      bdr: 'top;336699;accent1;99;;B4C7E7|left;auto;;;;000000',
    },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '格' }] }],
  }
  const doc = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [cell] }] }] }
  const xml = await (await JSZip.loadAsync(await prosemirrorToDocxBytes(doc))).file('word/document.xml').async('string')
  const tc = /<w:tcBorders[\s\S]*?<\/w:tcBorders>/.exec(xml)?.[0] ?? ''
  has('tcBorders 导出：主题名补回', tc, 'w:themeColor="accent1"')
  has('tcBorders 导出：字面色写回原件', tc, 'w:color="336699"')
  has('tcBorders 导出：auto 也是原件（不能被 000000 顶掉）', tc, 'w:color="auto"')
}

{
  // 反例：用户把这条边删了（bdTop 没了）→ 那一条边不补，其余边照补。
  // 补丁在块内找不到元素时跳过的是**那一条**，不是整块——整块放弃是计数闸门的活
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { bdBottom: '0.67px solid #000000', bdr: 'top;FF0000;accent1;99;BF;adbbd4' },
        content: [{ type: 'text', text: '删了上边' }],
      },
    ],
  }
  const xml = await (await JSZip.loadAsync(await prosemirrorToDocxBytes(doc))).file('word/document.xml').async('string')
  const block = /<w:pBdr[\s\S]*?<\/w:pBdr>/.exec(xml)?.[0] ?? ''
  check('pBdr 导出：删掉的边不补主题引用', !block.includes('w:themeColor'), block)
  has('pBdr 导出：没删的边照发', block, '<w:bottom')
}

{
  // 载荷闸门：缺 screen 的段整段丢（没有基准就分不清源件的色与用户改的色）
  const parsed = parseBdrPayload('top;FF0000;accent1;99;BF|left;auto;;;;000000|bogus;1;2')
  check('data-bdr 解析：缺 screen 的段整段丢', parsed.length === 1 && parsed[0].edge === 'left', JSON.stringify(parsed))
  const dirty = parseBdrPayload('top;ZZZZZZ;accent 1;9;BF;000000')
  check('data-bdr 解析：脏键整键丢', dirty.length === 1 && !dirty[0].color && dirty[0].screen === '000000', JSON.stringify(dirty))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
