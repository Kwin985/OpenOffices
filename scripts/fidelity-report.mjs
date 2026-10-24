// 属性级保真覆盖率生成器。
//
// 它量的不是「实现了多少命令」，而是：真件里一共有哪些「元素|属性」字面，读手在真实导入那一趟里
// 主动按名查过其中多少枚。分子来自运行时探针（注入在 ooxml.ts 的 attr / attrL 两枚漏斗上——整条
// 读入链按名取属性只走这两处），分母来自同一趟里用我们自己的解析器对部件全树的遍历。
// 产品源一行不改：模块层从 git rev 取出一份一次性副本，注入只发生在副本上。
//
//   pnpm exec vite-node scripts/fidelity-report.mjs --corpus D:/docs            # 出一份报告
//   pnpm exec vite-node scripts/fidelity-report.mjs --clist tmp/clist.txt       # 或按清单
//   ... --selftest        用内置夹具证明分子语义（不依赖任何语料）
//   ... --clean-pass      再跑一遍不带探针的副本，证明观察者不扰动产品
//   ... --mut no-attrL    变异档：故意漏注入一枚漏斗，覆盖率必须下降
//   ... --synth           语料是合成重建件（scripts/gen-docx-fidelity-corpus.mjs 按
//                         docs/fidelity-universe.json 的冻结计数 1/100 缩放生成）：
//                         与旧账「按对」可比、「按字面」不可比，报告里播出处节
//
// 报告里不许出现任何文件路径或文件名：语料是每个人的本地件，公开的只有聚合数字。
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import JSZip from 'jszip'

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i < 0 ? dflt : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

const REPO = path.resolve(import.meta.dirname, '..')
const REF = flag('ref', 'HEAD')
const OUT_DIR = path.resolve(REPO, flag('out', 'docs'))
const MOD_DIR = path.resolve(REPO, flag('tmp', 'tmp/fidelity-mod'))
const LIMIT = Number(flag('limit', '0'))
const MUT = flag('mut', '')
const CLIST_FILE = flag('clist', '')
const CORPUS = flag('corpus', '')
const SYNTH = has('synth')

// 读手真正吃进去的部件：分母只算这些，别把没打算读的部件算成丢账
const PARTS = [
  'word/document.xml',
  'word/styles.xml',
  'word/numbering.xml',
  'word/footnotes.xml',
  'word/endnotes.xml',
  'word/comments.xml',
  'word/commentsExtended.xml',
]
// Word 自己的存档流水号：零渲染语义也不进 UI，按名字规则归到噪音档而不是「丢账」
const NOISE = /^(rsid[A-Za-z]*|paraId|textId)$/

// ---- 1b. 内置夹具（--selftest）---------------------------------------------
//
// 分子语义不依赖任何语料：这一份 document.xml 里每枚属性都是我亲手放的，所以「探针应当看到哪些、
// 应当看不到哪些」可以事先写死。MUST_SEE 是读手真会按名查问的，MUST_NOT_SEE 是我故意放进去、
// 而读手（按源码现状）确实一寸都不查的——两边都断言才叫量具，只断一边等于自说自话。
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
// v0.145：图片（docPr/cNvPr/blip）与浮动族的命名空间
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
// 1x1 透明 PNG（图片段的关系与媒体目标）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// v0.142：clrScheme 与 fontScheme 并列。dk1/lt1 写成 sysClr（真件里 windowText/window
// 的常驻形态，lastClr 兜底）——合成语料那侧全用 srgbClr（宇宙里没有 sysClr|val），
// 这一分支只有夹具走，两边合起来才把 readThemeColors 的两条路都盖到。
const FIXTURE_THEME =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
  `<a:themeElements><a:clrScheme name="Office">` +
  `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
  `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
  `</a:clrScheme><a:fontScheme>` +
  `<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface="等线 Light"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="等线"/></a:minorFont>` +
  `</a:fontScheme></a:themeElements></a:theme>`

const FIXTURE_STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W}">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  `<w:name w:val="Normal"/><w:pPr><w:spacing w:line="276" w:lineRule="auto" w:before="0" w:after="0"/>` +
  `<w:ind w:left="0" w:right="0"/></w:pPr>` +
  // v0.138：Word 的 Normal 只写主题引用，不写具名字体——主题解析那一链就从这里过
  `<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
  `</w:style>` +
  `<w:style w:type="paragraph" w:styleId="ReportHead"><w:name w:val="report head"/>` +
  `<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/><w:ind w:left="420"/></w:pPr>` +
  `</w:style>` +
  // v0.146：潜在样式族——Word 样式库门面账。容器六属性全带 + 两条 lsdException
  // （第一条六属性全带，第二条只带四枚——缺的两枚不写，onOff 三态分得开）
  `<w:latentStyles w:count="2" w:defLockedState="0" w:defUIPriority="99" w:defSemiHidden="0"` +
  ` w:defUnhideWhenUsed="0" w:defQFormat="0">` +
  `<w:lsdException w:name="heading 1" w:uiPriority="9" w:semiHidden="0" w:unhideWhenUsed="0" w:qFormat="1" w:locked="0"/>` +
  `<w:lsdException w:name="Default Paragraph Font" w:uiPriority="1" w:semiHidden="1" w:unhideWhenUsed="1"/>` +
  `</w:latentStyles>` +
  // v0.146：样式元数据三枚——Report 段落样式带 customStyle=1，link 指配对的 ReportChar，
  // uiPriority=9；ReportChar 是字符样式（link 回指 Report）；Plain 三枚都不带（负形态）
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Report"><w:name w:val="report"/>` +
  `<w:basedOn w:val="Normal"/><w:link w:val="ReportChar"/><w:uiPriority w:val="9"/></w:style>` +
  `<w:style w:type="character" w:styleId="ReportChar"><w:name w:val="report char"/>` +
  `<w:basedOn w:val="Normal"/><w:link w:val="Report"/><w:uiPriority w:val="9"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="plain"/></w:style>` +
  `</w:styles>`

// v0.142：编号部件。numId=1 指 abstractNumId=0：0 层是子弹（·/左对齐），1 层是小写
// 字母（模板 "%2."/居中对齐）；num 上再挂一枚 startOverride=3——读手要把「这一串从
// 第 3 号起」读出来（<ol start="3">），lvlOverride|ilvl 与 startOverride|val 两对由此上账。
const FIXTURE_NUMBERING =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:numbering xmlns:w="${W}">` +
  // v0.145：multiLevelType——编号定义的身份属性（读+warn 记账，不进 PM 模型）
  `<w:abstractNum w:abstractNumId="0" w:multiLevelType="hybridMultilevel">` +
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="·"/><w:lvlJc w:val="left"/></w:lvl>` +
  `<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="center"/></w:lvl>` +
  `</w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/>` +
  `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num>` +
  `</w:numbering>`

const FIXTURE_DOC =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  // v0.145：图片与浮动族要 wp/a/pic/r 四个命名空间（docPr/cNvPr/blip）
  `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
  `<w:p w:rsidR="00A1" w:rsidRDefault="00A2" w:rsidP="00B3">` +
  `<w:pPr><w:pStyle w:val="ReportHead"/>` +
  `<w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto" w:beforeAutospacing="0" w:afterAutospacing="0"/>` +
  `<w:ind w:left="420" w:right="210" w:firstLineChars="200" w:hangingChars="0"/>` +
  `<w:jc w:val="both"/>` +
  `<w:pBdr><w:top w:val="single" w:sz="8" w:space="1" w:color="FF0000"/>` +
  `<w:left w:val="dotted" w:sz="4" w:space="2" w:color="00FF00"/>` +
  `<w:bottom w:val="dashed" w:sz="6" w:space="4" w:color="0000FF"/>` +
  `<w:right w:val="double" w:sz="6" w:space="3" w:color="FFFF00"/></w:pBdr></w:pPr>` +
  `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hint="eastAsia" w:cs="Arial"/>` +
  `<w:sz w:val="24"/><w:szCs w:val="28"/><w:b w:val="0"/>` +
  // v0.143：复杂文字粗斜与小型大写（iCs/bCs 只往返，smallCaps 屏上走 font-variant-caps）
  `<w:iCs/><w:bCs/><w:smallCaps/>` +
  `<w:lang w:val="en-US" w:eastAsia="zh-CN"/><w:kern w:val="2"/><w:pos w:val="12"/></w:rPr>` +
  `<w:t xml:space="preserve"> 带空白的正文 </w:t></w:r></w:p>` +
  // v0.142：主题色 run（accent1 + tint/shade 双戴）与图案底纹段（pct25 前景 FF0000/背景 FFFFFF）
  `<w:p><w:pPr><w:shd w:val="pct25" w:color="FF0000" w:fill="FFFFFF"/></w:pPr>` +
  `<w:r><w:rPr><w:color w:val="FF0000" w:themeColor="accent1" w:themeTint="99" w:themeShade="BF"/></w:rPr>` +
  `<w:t>主题色与图案底纹</w:t></w:r></w:p>` +
  // v0.142：编号段——0 层子弹（符面 ·），与 numId=1 的 startOverride=3 无关（子弹不看起始号）
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
  `<w:r><w:t>列表项</w:t></w:r></w:p>` +
  // v0.143：分页四件套（只往返不屏现）——四件全开 + widowControl 显式关各一枚
  `<w:p><w:pPr><w:pageBreakBefore/><w:keepNext/><w:keepLines/><w:widowControl w:val="1"/></w:pPr>` +
  `<w:r><w:t>分页四件套</w:t></w:r></w:p>` +
  `<w:p><w:pPr><w:widowControl w:val="0"/></w:pPr><w:r><w:t>显式关孤行</w:t></w:r></w:p>` +
  // v0.144：制表位三档（档位/缇/前导符）+ 一个 clear 清除档（不带 pos/leader）
  `<w:p><w:pPr><w:tabs>` +
  `<w:tab w:val="left" w:pos="720" w:leader="dot"/>` +
  `<w:tab w:val="center" w:pos="2880"/>` +
  `<w:tab w:val="right" w:pos="5760" w:leader="middleDot"/>` +
  `<w:tab w:val="clear" w:pos="720"/></w:tabs></w:pPr>` +
  `<w:r><w:t>制表位</w:t></w:r></w:p>` +
  // v0.145：图片的替代文本——docPr@descr（画布级）与 pic:cNvPr@descr（图形级）两处都读，
  // descr 优先、name 兜底。r:embed 指向 selftest zip 里的 media/image1.png
  `<w:p><w:r><w:drawing>` +
  `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/>` +
  `<wp:docPr id="1" name="图片 1" descr="画布级替代文本"/>` +
  `<a:graphic><a:graphicData uri="${PIC}">` +
  `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="cNv 名" descr="图形级替代文本"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
  `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
  // v0.145：段落浮动框架——absolute 形态（x/y 在场，无 xAlign/yAlign），十二枚全上账
  `<w:p><w:pPr><w:framePr w:x="720" w:y="1440" w:w="2880" w:h="720" w:hRule="exact"` +
  ` w:hSpace="12" w:vSpace="24" w:hAnchor="page" w:vAnchor="text" w:wrap="around" w:anchorLock="1"/></w:pPr>` +
  `<w:r><w:t>浮动框架段</w:t></w:r></w:p>` +
  // v0.145：浮动表——tblpPr 十枚（属性无前缀）。tblpPr 在 tblPr 里排 tblStyle 之后
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>` +
  `<w:tblpPr tblpX="10" tblpXSpec="absolute" tblpY="10" vertAnchor="top" horzAnchor="page"` +
  ` topFromText="0" leftFromText="108" bottomFromText="0" rightFromText="108" overlap="never"/>` +
  `<w:tblW w:w="5000" w:type="dxa"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>` +
  `<w:p><w:r><w:t>浮动表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
  // v0.146：书签区间——单段一枚（起终点夹住 run）+ 跨段一枚（本段开、下一段关，
  // 段末续挂每段各包一枚 span）。空书签（起终点相邻）不产 span，是记账内的已知边界
  `<w:p><w:bookmarkStart w:id="7" w:name="_Toc7"/><w:r><w:t>书签正文</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>` +
  `<w:p><w:bookmarkStart w:id="9" w:name="_Cross"/><w:r><w:t>跨段前</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>跨段后</w:t></w:r><w:bookmarkEnd w:id="9"/></w:p>` +
  // v0.146：复杂文字语言与字符缩放（同 run）——w:lang 的 bidi 只管 cs 字族，
  // w:w 是百分比（元素名叫 w、属性叫 val）
  `<w:p><w:r><w:rPr><w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/><w:w w:val="150"/></w:rPr>` +
  `<w:t>复杂文字</w:t></w:r></w:p>` +
  // v0.146：表级边框 space——两行两列六边都带边框，space 只写在 top=1 / insideH=2 /
  // insideV=3 三枚上（分摊口径：外层四边贴外圈格、insideH/insideV 贴相邻两格，
  // 仅当该边边框真回落到表级时才挂——格内无 tcBorders，六边全回落）
  `<w:tbl><w:tblPr><w:tblBorders>` +
  `<w:top w:val="single" w:sz="4" w:space="1" w:color="000000"/>` +
  `<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
  `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
  `<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
  `<w:insideH w:val="single" w:sz="4" w:space="2" w:color="000000"/>` +
  `<w:insideV w:val="single" w:sz="4" w:space="3" w:color="000000"/>` +
  `</w:tblBorders></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>` +
  `<w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc>` +
  `<w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr>` +
  `<w:tr><w:tc><w:p><w:r><w:t>丙</w:t></w:r></w:p></w:tc>` +
  `<w:tc><w:p><w:r><w:t>丁</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
  `<w:sectPr><w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>` +
  `<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>` +
  `</w:body></w:document>`

// 读手按名查问过的（源码里 spacing / ind / jc / pStyle / rFonts / sz / b / 顶边 都走 attr 或 attrL）
const MUST_SEE = [
  'pStyle|val',
  'spacing|before',
  'spacing|after',
  'spacing|line',
  'spacing|lineRule',
  'ind|left',
  'ind|right',
  'ind|firstLineChars',
  'jc|val',
  'top|val',
  'top|sz',
  'top|space',
  'rFonts|ascii',
  'rFonts|eastAsia',
  'sz|val',
  'b|val',
  // v0.138：主题引用、hint、cs、szCs、lang、kern、pos 这一批都在读手里有按名查问处
  'rFonts|asciiTheme',
  'rFonts|hAnsiTheme',
  'rFonts|eastAsiaTheme',
  'rFonts|hint',
  'rFonts|cs',
  'szCs|val',
  'lang|val',
  'lang|eastAsia',
  'kern|val',
  'pos|val',
  // v0.142：主题色（clrScheme 的 srgbClr/sysClr 两分支 + w:color 的 themeColor/Tint/Shade）、
  // 图案底纹三件套（val/color/fill）、编号的符面与对齐（lvlText/lvlJc）与起始号改写
  // （lvlOverride/startOverride）。下面每一枚都能在夹具里指出唯一一处 XML。
  'srgbClr|val',
  'sysClr|lastClr',
  'color|themeColor',
  'color|themeTint',
  'color|themeShade',
  'shd|val',
  'shd|color',
  'shd|fill',
  'lvlText|val',
  'lvlJc|val',
  'startOverride|val',
  'lvlOverride|ilvl',
  // v0.143：ind 的字符档（hangingChars/rightChars）与 pBdr 四边的 space。
  // hangingChars 在夹具里值是 0（查问发生、不产生 CSS——「0 距离」与「没声明」同路），
  // 非零分支由合成语料 02-tables/01-body 的实例在普查腿踩
  'ind|hangingChars',
  'ind|rightChars',
  'top|space',
  'right|space',
  'bottom|space',
  'left|space',
  // v0.143 D2-3/D2-4：复杂文字粗斜、小型大写与分页四件套。iCs/bCs 只往返
  // （CSS 无「只对 cs 字族」的开关），smallCaps 屏上走 font-variant-caps，
  // 四件套屏上不兑现——七枚都只为存盘不丢
  'iCs|val',
  'bCs|val',
  'smallCaps|val',
  'pageBreakBefore|val',
  'keepNext|val',
  'keepLines|val',
  'widowControl|val',
  // v0.144：制表位三枚（档位/缇/前导符）。leader 的 middleDot 是 ST_TabTlc 唯一驼峰值
  // （小写归一查表映射回规范名）；clear 档无 pos/leader，是「到此清除继承制表位」
  'tab|val',
  'tab|pos',
  'tab|leader',
  // v0.145：替代文本（docPr 画布级 + pic:cNvPr 图形级，descr 优先 name 兜底）、
  // 浮动框架十二枚（framePr 的属性带 w: 前缀，与 tblpPr 的无前缀不同）、
  // 表格浮动十枚（tblpPr 属性**无前缀**，ECMA-376 CT_TblPPr——attrL 按 local name 才命中）、
  // 编号定义身份（探针键是「元素名|属性名」——multiLevelType 挂在 abstractNum 上）
  'docPr|descr',
  'cNvPr|descr',
  'framePr|x',
  'framePr|y',
  'framePr|w',
  'framePr|h',
  'framePr|hRule',
  'framePr|hSpace',
  'framePr|vSpace',
  'framePr|hAnchor',
  'framePr|vAnchor',
  'framePr|wrap',
  'framePr|anchorLock',
  'tblpPr|tblpX',
  'tblpPr|tblpXSpec',
  'tblpPr|tblpY',
  'tblpPr|vertAnchor',
  'tblpPr|horzAnchor',
  'tblpPr|topFromText',
  'tblpPr|leftFromText',
  'tblpPr|bottomFromText',
  'tblpPr|rightFromText',
  'tblpPr|overlap',
  'abstractNum|multiLevelType',
  // v0.146 D5：潜在样式族 12 对（w:latentStyles 容器六属性 + w:lsdException 六属性）、
  // 书签三对（bookmarkStart 的 id/name 与 bookmarkEnd 的 id——区间内容包成
  // span[data-oo-bookmark] 由书签 mark 接住）、复杂文字语言（w:lang 的 bidi 只管
  // cs 字族）、字符缩放（元素名叫 w、属性叫 val）、样式元数据三枚（uiPriority/link
  // 是 w:style 的子元素、customStyle 长在 w:style 自己身上）、表级边框 space 的
  // insideH/insideV 两对（外层四边的 space 键 v0.143 随 pBdr 已上账）
  'latentStyles|count',
  'latentStyles|defLockedState',
  'latentStyles|defUIPriority',
  'latentStyles|defSemiHidden',
  'latentStyles|defUnhideWhenUsed',
  'latentStyles|defQFormat',
  'lsdException|name',
  'lsdException|uiPriority',
  'lsdException|semiHidden',
  'lsdException|unhideWhenUsed',
  'lsdException|qFormat',
  'lsdException|locked',
  'bookmarkStart|id',
  'bookmarkStart|name',
  'bookmarkEnd|id',
  'lang|bidi',
  'w|val',
  'uiPriority|val',
  'link|val',
  'style|customStyle',
  'insideH|space',
  'insideV|space',
]
// 我放进夹具而读手一寸不查的：beforeAutospacing / afterAutospacing 在源码里没有查问处；
// t 的 xml:space 是**裁定不查**——escText 无条件保留空白（连续空格第二个起换 nbsp），
// 强于 preserve 所需，查了也没有第二行代码可写；
// pgSz|orient 与 pgMar|gutter 走 docxToDocMeta 另一条路，不在本读手的账上。
// （v0.143 注：ind|hangingChars 与 left|space 曾在此列——那一轮起 hangingChars 进了
// paraCss 的负 text-indent 分支、pBdr 四边 space 进了 padding，两枚移入 MUST_SEE）
const MUST_NOT_SEE = [
  'spacing|beforeAutospacing',
  'spacing|afterAutospacing',
  't|space',
  'pgSz|orient',
  'pgMar|gutter',
]

const md5 = (s) => createHash('md5').update(s).digest('hex')
const local = (n) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n)
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

function git(args, buf) {
  return execFileSync('git', args, { cwd: REPO, encoding: buf ? 'utf8' : null, maxBuffer: 128 * 1024 * 1024 })
}

// ---- 1. 语料清单 ------------------------------------------------------------

function corpusList() {
  let list = []
  if (CLIST_FILE) {
    list = fs
      .readFileSync(path.resolve(REPO, CLIST_FILE), 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => (/^\/([a-zA-Z])\//.test(p) ? p.replace(/^\/([a-zA-Z])\//, (m, d) => d.toUpperCase() + ':/') : p))
  } else {
    if (!CORPUS) throw new Error('要么给 --corpus <目录>，要么给 --clist <清单文件>')
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'target', '__pycache__'].includes(e.name)) continue
          walk(path.join(dir, e.name))
        } else if (/\.docx$/i.test(e.name) && !e.name.startsWith('~$')) {
          list.push(path.join(dir, e.name))
        }
      }
    }
    walk(path.resolve(CORPUS))
  }
  list.sort()
  return LIMIT > 0 ? list.slice(0, LIMIT) : list
}

// ---- 2. 一次性模块副本 + 探针注入 -------------------------------------------

function materialize(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  let files
  try {
    files = git(['ls-files', 'src/lib'], true).split(/\r?\n/).filter((s) => /\.(ts|tsx)$/.test(s))
  } catch {
    files = []
  }
  let fromGit = files.length > 0
  if (!fromGit) {
    files = fs
      .readdirSync(path.join(REPO, 'src/lib'))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => `src/lib/${f}`)
  }
  for (const f of files) {
    const rel = f.replace(/^src\/lib\//, '')
    const bytes = fromGit ? git(['show', `${REF}:${f}`]) : fs.readFileSync(path.join(REPO, f))
    fs.writeFileSync(path.join(dir, rel), bytes)
  }
  return { count: files.length, fromGit }
}

const RECORDER = `
// ---- 探针注入块（只写记录，不改任何返回值）----
const __seen = new Map<string, number>()
export const __PROBE = {
  seen: __seen,
  key(parentName: string, attrName: string): string {
    const lp = parentName.includes(':') ? parentName.slice(parentName.indexOf(':') + 1) : parentName
    const la = attrName.includes(':') ? attrName.slice(attrName.indexOf(':') + 1) : attrName
    return lp + '|' + la
  },
  note(parentName: string, attrName: string) {
    const k = this.key(parentName, attrName)
    __seen.set(k, (__seen.get(k) ?? 0) + 1)
  },
}

`

function injectProbe(file, mut) {
  let src = fs.readFileSync(file, 'utf8')
  const inj = [
    {
      id: 'attr',
      skip: mut === 'no-attr',
      find: 'export function attr(el: XEl | undefined, name: string): string | undefined {\n  return el?.attrs[name]',
      put: 'export function attr(el: XEl | undefined, name: string): string | undefined {\n  if (el) __PROBE.note(el.name, name)\n  return el?.attrs[name]',
    },
    {
      id: 'attrL',
      skip: mut === 'no-attrL',
      find: 'export function attrL(el: XEl | undefined, name: string): string | undefined {\n  if (!el) return undefined',
      put: 'export function attrL(el: XEl | undefined, name: string): string | undefined {\n  if (!el) return undefined\n  __PROBE.note(el.name, name)',
    },
  ]
  const anchor = "\nimport "
  // ooxml.ts 自己一枚 import 都没有（迷你解析器不吃依赖），所以 lastIndexOf 落空时按「第一行之后」插
  const i0 = src.lastIndexOf(anchor)
  const nl = src.indexOf('\n', i0 < 0 ? 0 : i0 + 1)
  if (nl < 0) throw new Error('注入中止：找不到 import 尾部')
  src = src.slice(0, nl + 1) + RECORDER + src.slice(nl + 1)
  const applied = []
  for (const x of inj) {
    if (x.skip) continue
    const hits = src.split(x.find).length - 1
    if (hits !== 1) throw new Error(`注入锚点 ${x.id} 命中 ${hits} 次（应为 1）`)
    src = src.replace(x.find, x.put)
    applied.push(x.id)
  }
  // 注入的那一行绝不能以 ( 或 [ 开头：它前面是 `if (!el) return undefined`，而「换行 + (」在 ASI 下
  // 是上一行的续写，会被读成 return undefined(__PROBE.note(...)) —— 报 "undefined is not a function"，
  // 且只在那枚件走到 attrL 时才抛。等价腿（只一边错=0）是抓住它的闸，见 README 的量具坑一节。
  fs.writeFileSync(file, src, 'utf8')
  return applied
}

// 读手副本再导出探针：脚本只从 reader.__PROBE 取账，不另开一份 ooxml.ts 的导入。
// 为什么必须这样——vite-node 下同一个 .ts 文件按不同路径形状导入是两个模块实例
// （实测：入口脚本按绝对路径 `E:/…/ooxml.ts` 动态导入 vs docx-fidelity.ts 内按
// './ooxml' 相对导入，`__PROBE.seen` 是两个不同的 Map，脚本读的那份永远是空的；
// 入口按相对路径导入学能合上，但那是路径形状的巧合）。再导出把「读到读手那一份」
// 变成模块图的基本保证：reader.__PROBE 就是读手自己 import 的那个 __PROBE。
function injectReaderReexport(file) {
  let src = fs.readFileSync(file, 'utf8')
  const anchor = "} from './table-cond'\n"
  const hits = src.split(anchor).length - 1
  if (hits !== 1) throw new Error(`再导出锚点命中 ${hits} 次（应为 1）`)
  src = src.replace(anchor, anchor + "export { __PROBE } from './ooxml'\n")
  fs.writeFileSync(file, src, 'utf8')
  return 'reader.__PROBE(再导出)'
}

// ---- 3. 一趟读手 + 一份分母 --------------------------------------------------

function errClass(e) {
  const m = String(e && e.message ? e.message : e)
  if (/Corrupted zip|End of data reached|unexpected end|invalid stored|compressed data|not a Zip/i.test(m)) return 'unreadable-zip'
  if (/缺 word\/document\.xml/.test(m)) return 'no-document-xml'
  // 任何引号里的东西都可能是路径，公开产物里一律抹掉
  return m.replace(/['"`][^'"`]*['"`]/g, "''").slice(0, 48)
}

function countAttrsOurParser(parseXml, root) {
  const pairs = new Map()
  let total = 0
  const visit = (el) => {
    const p = local(el.name)
    for (const k of Object.keys(el.attrs)) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) continue
      const key = `${p}|${local(k)}`
      pairs.set(key, (pairs.get(key) ?? 0) + 1)
      total++
    }
    for (const c of el.children) if (typeof c !== 'string') visit(c)
  }
  visit(root)
  return { pairs, total }
}

async function runSelftest(reader) {
  const seen = reader.__PROBE.seen
  const zip = new JSZip()
  zip.file('word/document.xml', FIXTURE_DOC)
  zip.file('word/styles.xml', FIXTURE_STYLES)
  zip.file('word/theme/theme1.xml', FIXTURE_THEME)
  zip.file('word/numbering.xml', FIXTURE_NUMBERING)
  // v0.145：图片段的关系与媒体目标（docPr/cNvPr 的 descr 靠这条链读出来）
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
      `</Relationships>`,
  )
  zip.file('word/media/image1.png', Buffer.from(PNG_B64, 'base64'))
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  seen.clear()
  const out = await reader.docxToHtmlFidelity(bytes)
  const got = new Set(seen.keys())
  const fails = []
  for (const k of MUST_SEE) if (!got.has(k)) fails.push(`应看到而没看到 ${k}`)
  for (const k of MUST_NOT_SEE) if (got.has(k)) fails.push(`不该看到却看到 ${k}`)
  // 夹具必须真的产出了内容，否则上面的断言是在空转
  if (!(out.blocks > 0)) fails.push('夹具 blocks=0，导入根本没跑起来')
  if (!out.html.includes('带空白的正文')) fails.push('夹具正文没进 HTML')
  let notes = 0
  for (const v of seen.values()) notes += v
  console.log(`SELFTEST|夹具 查问对=${got.size} 查问次数=${notes} blocks=${out.blocks}`)
  console.log(`SELFTEST|看到的全部键 ${[...got].sort().join(' ')}`)
  if (fails.length) {
    for (const f of fails) console.log(`SELFTEST|FAIL ${f}`)
    throw new Error(`夹具自检 ${fails.length} 条不通过`)
  }
  console.log(`SELFTEST|双向断言通过 应看到 ${MUST_SEE.length} 枚全命中，不该看到 ${MUST_NOT_SEE.length} 枚全落空`)
  seen.clear()
}

async function main() {
  const t0 = Date.now()
  const { count: modFiles, fromGit } = materialize(MOD_DIR)
  const applied = injectProbe(path.join(MOD_DIR, 'ooxml.ts'), MUT)
  applied.push(injectReaderReexport(path.join(MOD_DIR, 'docx-fidelity.ts')))
  const reader = await import(`${path.join(MOD_DIR, 'docx-fidelity.ts').replace(/\\/g, '/')}`)
  const { parseXml } = await import(`${path.join(MOD_DIR, 'ooxml.ts').replace(/\\/g, '/')}`)
  const seen = reader.__PROBE.seen

  if (has('selftest')) await runSelftest(reader)

  let files = []
  try {
    files = corpusList()
  } catch (e) {
    if (!has('selftest')) throw e
    console.log('REPORT|没给语料，只跑 --selftest 就到此为止')
    return
  }

  let clean = null
  if (has('clean-pass')) {
    const CLEAN_DIR = path.resolve(REPO, 'tmp/fidelity-clean')
    materialize(CLEAN_DIR)
    clean = await import(`${path.join(CLEAN_DIR, 'docx-fidelity.ts').replace(/\\/g, '/')}`)
  }

  const pairs = new Map()
  const partTotals = {}
  let bytesTotal = 0
  let ok = 0
  const errs = new Map()
  let eqSame = 0
  let eqDiff = 0
  let eqErrBoth = 0
  let eqErrOne = 0
  let idx = 0

  for (const f of files) {
    idx++
    let bytes
    try {
      bytes = new Uint8Array(fs.readFileSync(f))
    } catch (e) {
      errs.set(errClass(e), (errs.get(errClass(e)) ?? 0) + 1)
      continue
    }
    bytesTotal += bytes.length
    // 分子：读手在真实导入里的按名查问
    let html
    let firstErr = ''
    try {
      html = (await reader.docxToHtmlFidelity(bytes)).html
      ok++
    } catch (e) {
      const k = errClass(e)
      firstErr = k
      errs.set(k, (errs.get(k) ?? 0) + 1)
    }
    if (clean) {
      let ch
      try {
        ch = (await clean.docxToHtmlFidelity(bytes)).html
      } catch (e) {
        ch = `ERR:${errClass(e)}`
      }
      const probeOk = html !== undefined
      const cleanOk = !String(ch).startsWith('ERR:')
      if (probeOk && cleanOk) {
        if (md5(html) === md5(ch)) eqSame++
        else eqDiff++
      } else if (!probeOk && !cleanOk) {
        // 两边都失败：错类相同才算「同一件事失败两次」，不同就是扰动
        if (String(ch).slice(4) === firstErr) eqErrBoth++
        else eqDiff++
      } else {
        eqErrOne++
      }
    }
    // 分母：同一件、同一套部件，用我们自己的解析器全树数一遍属性字面
    try {
      const zip = await JSZip.loadAsync(bytes)
      for (const p of PARTS) {
        const entry = zip.file(p)
        if (!entry) continue
        const { pairs: pp, total } = countAttrsOurParser(parseXml, parseXml(await entry.async('string')))
        partTotals[p] = (partTotals[p] ?? 0) + total
        for (const [k, v] of pp) pairs.set(k, (pairs.get(k) ?? 0) + v)
      }
    } catch (e) {
      errs.set(`census:${errClass(e)}`, (errs.get(`census:${errClass(e)}`) ?? 0) + 1)
    }
    if (idx % 50 === 0) process.stderr.write(`  … ${idx}/${files.length}\n`)
  }

  const totalOcc = sum(Object.fromEntries(pairs))
  const noise = {}
  const covered = {}
  const uncovered = {}
  for (const [k, v] of pairs) {
    const attr = k.split('|')[1]
    if (NOISE.test(attr)) noise[k] = v
    else if (seen.has(k)) covered[k] = v
    else uncovered[k] = v
  }
  const meaningful = sum(covered) + sum(uncovered)
  const byElement = new Map()
  for (const [k, v] of Object.entries(uncovered)) {
    const p = k.split('|')[0]
    byElement.set(p, (byElement.get(p) ?? 0) + v)
  }

  // 合成语料腿：与冻结宇宙自比——701 对该不该一对不缺、字面该多接近缩放期望。
  // 这一块只回答「重建得像不像旧账」，不参与覆盖率计算
  let synth = null
  if (SYNTH) {
    const uniPath = path.join(REPO, 'docs/fidelity-universe.json')
    const uni = JSON.parse(fs.readFileSync(uniPath, 'utf8'))
    const want = new Map(uni.pairs.map((p) => [p.pair, Math.max(1, Math.round(p.count / uni.scale))]))
    const missing = [...want.keys()].filter((k) => !pairs.has(k))
    const extra = [...pairs.keys()].filter((k) => !want.has(k))
    const wantSum = sum(Object.fromEntries(want))
    const gotSum = [...pairs.values()].reduce((a, b) => a + b, 0)
    synth = {
      rebuiltBy: 'scripts/gen-docx-fidelity-corpus.mjs',
      universe: 'docs/fidelity-universe.json',
      universePairs: uni.pairs.length,
      universeLiterals: uni.pairs.reduce((a, p) => a + p.count, 0),
      scale: uni.scale,
      pairsPresent: uni.pairs.length - missing.length,
      pairsMissing: missing.length,
      pairsExtra: extra.length,
      pairsMissingList: missing.sort().slice(0, 20),
      scaledLiteralSum: wantSum,
      // 缩放这一步自己抬了多少：裸 count/100 与「取整 + max(1,·)」之差
      rawScaledSum: uni.pairs.reduce((a, p) => a + p.count / uni.scale, 0),
      scaleInflationPct: (wantSum / (uni.pairs.reduce((a, p) => a + p.count / uni.scale, 0)) - 1) * 100,
      actualLiteralSum: gotSum,
      literalDriftPct: (gotSum / wantSum - 1) * 100,
      comparableByPair: true,
      comparableByOccurrence: false,
      note:
        '按对覆盖率与旧账（313 件真件语料）可比；按字面不可比——重建按 count/100 缩放，' +
        '取整与 max(1,·) 会把稀有对抬起来（见「scaling step itself」那一行），另有少量承重包裹属性（bitmap 链的 r:embed/extent/docPr、numbering 关联的 ' +
        'abstractNumId 等）在包裹处顺带出现；末行是「实测 vs 缩放期望」，与缩放那行基准不同，别混读',
    }
  }

  const data = {
    measured: { ref: REF, source: fromGit ? `git:${REF}` : 'worktree', modules: modFiles, injections: applied },
    corpus: SYNTH
      ? {
          files: files.length,
          readable: ok,
          unreadable: files.length - ok,
          bytes: bytesTotal,
          scopeParts: PARTS,
          synthetic: true,
          rebuiltBy: 'scripts/gen-docx-fidelity-corpus.mjs',
          universe: 'docs/fidelity-universe.json',
        }
      : { files: files.length, readable: ok, unreadable: files.length - ok, bytes: bytesTotal, scopeParts: PARTS },
    totals: {
      distinctPairs: pairs.size,
      occurrences: totalOcc,
      noisePairs: Object.keys(noise).length,
      noiseOccurrences: sum(noise),
      meaningfulPairs: Object.keys(covered).length + Object.keys(uncovered).length,
      meaningfulOccurrences: meaningful,
    },
    coverage: {
      byPair: Object.keys(covered).length / (Object.keys(covered).length + Object.keys(uncovered).length),
      byOccurrence: sum(covered) / meaningful,
      consultedPairs: Object.keys(covered).length,
      consultedOccurrences: sum(covered),
      neverConsultedPairs: Object.keys(uncovered).length,
      neverConsultedOccurrences: sum(uncovered),
    },
    consulted: sorted(covered),
    neverConsulted: sorted(uncovered),
    noise: sorted(noise),
    neverConsultedByElement: [...byElement.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    partTotals,
    errors: Object.fromEntries(errs),
  }
  if (clean) data.equivalence = { identical: eqSame, differing: eqDiff, bothFailed: eqErrBoth, onlyOneFailed: eqErrOne }
  if (synth) data.synth = synth

  const mdPath = path.join(OUT_DIR, 'fidelity.md')
  const jsonPath = path.join(OUT_DIR, 'fidelity.json')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
  fs.writeFileSync(mdPath, renderMd(data), 'utf8')

  console.log(
    `REPORT|ref=${REF} 件=${files.length} 读成=${ok} 分母对=${pairs.size} 字面=${totalOcc} ` +
      `噪音=${sum(noise)} 有效=${meaningful} 已查问=${sum(covered)}`,
  )
  console.log(
    `REPORT|覆盖率 按对=${(data.coverage.byPair * 100).toFixed(1)}% 按字面=${(data.coverage.byOccurrence * 100).toFixed(1)}% ` +
      `注入=[${applied.join(',')}] 探针记录对=${seen.size} 用时=${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
  if (clean) console.log(`REPORT|等价腿 相同=${eqSame} 不同=${eqDiff} 两边同错=${eqErrBoth} 只一边错=${eqErrOne}`)
  console.log(`REPORT|写盘 ${path.relative(REPO, mdPath).replace(/\\/g, '/')} 与 ${path.relative(REPO, jsonPath).replace(/\\/g, '/')}`)
  console.log(`REPORT|md5 md=${md5(fs.readFileSync(mdPath, 'utf8'))} json=${md5(fs.readFileSync(jsonPath, 'utf8'))}`)
}

function sorted(o) {
  return Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`
}

function n(x) {
  return x.toLocaleString('en-US')
}

function renderMd(d) {
  const row = (arr, i) => `\`${arr[i][0]}\` | ${n(arr[i][1])}`
  const L = []
  L.push('# DOCX fidelity: attribute-level coverage report')
  L.push('')
  L.push(
    'This report is generated by `scripts/fidelity-report.mjs`. It is **not** a count of implemented',
  )
  L.push(
    'commands: it compares every `element|attribute` literal that real .docx files put on the wire',
  )
  L.push(
    'against the lookups our import path actually performs on them, at run time. A pair counts as',
  )
  L.push(
    '*consulted* only if the reader asked for it by name while a real import was running.',
  )
  L.push('')
  L.push('## How to read the numbers')
  L.push('')
  L.push('| Tier | Meaning | Why it is its own tier |')
  L.push('|---|---|---|')
  L.push(
    '| **consulted** | the reader looked the pair up by name during import | not proof it changed the output — see caveats |',
  )
  L.push(
    '| **never consulted** | the pair appears in real files and no code path asks for it | the actionable list: fidelity we do not claim |',
  )
  L.push(
    '| **noise** | `rsid*`, `paraId`, `textId` | Word\'s save-session bookkeeping: no rendering and no UI meaning |',
  )
  L.push('')
  L.push(
    `Measured on the committed product at \`${d.measured.ref}\` (\`${d.measured.source}\`, ${d.measured.modules} modules,`,
  )
  L.push(
    `probe injected at ${d.measured.injections.length} points: ${d.measured.injections.join(', ')}).`,
  )
  L.push('')
  L.push('## Headline')
  L.push('')
  L.push('| | pairs | attribute literals |')
  L.push('|---|---:|---:|')
  L.push(`| In scope (7 parts, ${d.corpus.readable} readable files) | ${n(d.totals.distinctPairs)} | ${n(d.totals.occurrences)} |`)
  L.push(`| Word save-session noise | ${n(d.totals.noisePairs)} | ${n(d.totals.noiseOccurrences)} |`)
  L.push(`| Meaningful universe | ${n(d.totals.meaningfulPairs)} | ${n(d.totals.meaningfulOccurrences)} |`)
  L.push(`| Consulted | ${n(d.coverage.consultedPairs)} | ${n(d.coverage.consultedOccurrences)} |`)
  L.push(`| Never consulted | ${n(d.coverage.neverConsultedPairs)} | ${n(d.coverage.neverConsultedOccurrences)} |`)
  L.push('')
  L.push(
    `**Coverage: ${pct(d.coverage.byPair)} of distinct pairs, ${pct(d.coverage.byOccurrence)} of meaningful literals.**`,
  )
  L.push('')
  L.push(
    `The corpus held ${n(d.corpus.files)} ${d.synth ? 'synthetic ' : ''}.docx files (${
      d.corpus.bytes < 1048576 ? `${(d.corpus.bytes / 1024).toFixed(0)} KiB` : `${(d.corpus.bytes / 1048576).toFixed(0)} MiB`
    }); ${d.corpus.unreadable} were`,
  )
  L.push('unreadable as archives and are reported by failure class only, never by name.')
  L.push('')
  if (d.synth) {
    const s = d.synth
    L.push('## Corpus provenance — this is a synthetic rebuild')
    L.push('')
    L.push(
      'The 313-file real corpus this ledger was first measured on is not in the repository (it is',
    )
    L.push(
      "everyone's local documents). What you are reading was measured on a **synthetic corpus**:",
    )
    L.push(
      `${n(s.universePairs)} element|attribute pairs with their literal counts, frozen from the original`,
    )
    L.push(
      `run into \`${s.universe}\` and rebuilt at 1/${s.scale} scale by \`${s.rebuiltBy}\`.`,
    )
    L.push('')
    L.push('| rebuild check | value |')
    L.push('|---|---:|')
    L.push(`| universe pairs present in the corpus | ${n(s.pairsPresent)} / ${n(s.universePairs)} |`)
    L.push(`| pairs missing / extra | ${n(s.pairsMissing)} / ${n(s.pairsExtra)} |`)
    L.push(
      `| literals: scaling step itself (raw ÷ ${s.scale} → rounded, min 1) | ${n(Math.round(s.rawScaledSum))} → ${n(s.scaledLiteralSum)} ` +
        `(${s.scaleInflationPct >= 0 ? '+' : ''}${s.scaleInflationPct.toFixed(2)}%) |`,
    )
    L.push(
      `| literals: scaled expectation vs actual rebuild | ${n(s.scaledLiteralSum)} vs ${n(s.actualLiteralSum)} ` +
        `(${s.literalDriftPct >= 0 ? '+' : ''}${s.literalDriftPct.toFixed(2)}%) |`,
    )
    L.push('')
    L.push(
      `**By-pair coverage is comparable with the original run; by-literal coverage is not.** ${s.note}`,
    )
    L.push('')
  }
  L.push('## Never consulted — largest first')
  L.push('')
  L.push('| `element|attribute` | literals |')
  L.push('|---|---:|')
  for (let i = 0; i < Math.min(30, d.neverConsulted.length); i++) L.push(`| ${row(d.neverConsulted, i)} |`)
  L.push('')
  L.push('## Which elements the missing literals sit on')
  L.push('')
  L.push('| element | never-consulted literals |')
  L.push('|---|---:|')
  for (let i = 0; i < Math.min(20, d.neverConsultedByElement.length); i++) {
    L.push(`| \`${d.neverConsultedByElement[i][0]}\` | ${n(d.neverConsultedByElement[i][1])} |`)
  }
  L.push('')
  L.push('## Consulted — the work already paid for')
  L.push('')
  L.push('| `element|attribute` | literals |')
  L.push('|---|---:|')
  for (let i = 0; i < Math.min(30, d.consulted.length); i++) L.push(`| ${row(d.consulted, i)} |`)
  L.push('')
  L.push('## Caveats, stated before anyone reads them off')
  L.push('')
  L.push(
    '- **consulted is not "landed on screen".** A pair can be looked up and then dropped (we read',
  )
  L.push(
    '  `w:top/@w:space` only to warn) or carried by a merge and never read (`w:ind/@w:hangingChars`).',
  )
  L.push(
    '  The second column of that table is the next round of work, not a claim of visual parity.',
  )
  L.push(
    '- **never consulted is not "visibly wrong".** `w:szCs` drives complex script, `xml:space` drives',
  )
  L.push(
    '  whitespace our tokenizer already keeps, `w:lang` drives spellcheck. Each row needs its own',
  )
  L.push(
    '  verdict against real Word before it becomes a bug.',
  )
  L.push(
    '- **the numerator needs a corpus, the claim does not.** Nothing here depends on a specific',
  )
  L.push(
    '  document: rerun with `--selftest` for a fixture whose lookups are known in advance.',
  )
  L.push('')
  L.push('## Reproduce')
  L.push('')
  L.push('```sh')
  L.push('pnpm exec vite-node scripts/fidelity-report.mjs --corpus /path/to/docx')
  L.push('pnpm exec vite-node scripts/fidelity-report.mjs --corpus /path/to/docx --selftest --clean-pass')
  L.push('python3 scripts/fidelity-census.py        # independent denominator, second parser')
  L.push('')
  L.push('# 真件语料不在库时：先按冻结宇宙重建合成语料，再跑同一套腿')
  L.push('node scripts/gen-docx-fidelity-corpus.mjs')
  L.push(
    'pnpm exec vite-node scripts/fidelity-report.mjs --clist tmp/docx-fidelity-corpus/clist.txt --selftest --clean-pass --synth',
  )
  L.push('python3 scripts/fidelity-census.py --clist tmp/docx-fidelity-corpus/clist.txt')
  L.push('```')
  L.push('')
  L.push('The report is deterministic: same corpus list and same source revision give byte-identical')
  L.push('output, so a diff of `docs/fidelity.md` is a diff of fidelity, not of a timestamp.')
  L.push('')
  L.push('## Evidence that the instrument works')
  L.push('')
  L.push('| leg | what it proves |')
  L.push('|---|---|')
  L.push('| `--selftest` | the probe sees exactly the lookups a fixture dictates, including the pairs we deliberately do not read |')
  L.push('| `--clean-pass` | the patched copy and an unpatched copy emit byte-identical HTML for every readable file: the observer does not perturb the product |')
  L.push('| `--mut no-attrL` | coverage drops: the numerator really comes from run-time lookups, not from a name list in the source |')
  L.push('| `scripts/fidelity-census.py` | a second, different XML parser (Python `xml.etree`) counts the same denominator |')
  if (d.equivalence) {
    L.push('')
    L.push(
      `Last run: identical=${d.equivalence.identical}, differing=${d.equivalence.differing}, both-failed=${d.equivalence.bothFailed}, only-one-failed=${d.equivalence.onlyOneFailed}.`,
    )
  }
  L.push('')
  return L.join('\n')
}

main().catch((e) => {
  console.error(`REPORT|失败 ${String(e && e.message ? e.message : e).slice(0, 200)}`)
  process.exitCode = 1
})
