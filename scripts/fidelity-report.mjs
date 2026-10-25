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
// v0.149：VML 图片壳（w:pict 那一支）要 v/o 两个命名空间
const V = 'urn:schemas-microsoft-com:vml'
const O = 'urn:schemas-microsoft-com:office:office'
// v0.150：兼容性族（mc:AlternateContent/mc:Choice）与根上的 mc:Ignorable
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
// v0.151：形状壳（wps:wsp/cNvSpPr/txbx/bodyPr）
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
// v0.153：遗留环绕 w10:wrap（Word 97-2003 那一套，与 VML 同住 w:pict 里）
const W10 = 'urn:schemas-microsoft-com:office:word'
// v0.154：批注两份部件（w14:paraId 与 w15:commentEx）
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
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
  // v0.152：根上的 mc:Ignorable（只读记账——「这个部件里哪些命名空间的扩展可以安全
  // 忽略」的声明，与 document 根上那一枚同族）
  `<w:styles xmlns:w="${W}" xmlns:mc="${MC}" mc:Ignorable="w14 w15">` +
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
  // v0.150：样式身份两枚——Report 带 next（后续段落样式）与 rsid（修订会话号），
  // ReportChar 只带 rsid；Plain 两枚都不带（负形态）
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Report"><w:name w:val="report"/>` +
  `<w:basedOn w:val="Normal"/><w:next w:val="ReportHead"/><w:link w:val="ReportChar"/><w:uiPriority w:val="9"/>` +
  `<w:rsid w:val="00A1"/></w:style>` +
  `<w:style w:type="character" w:styleId="ReportChar"><w:name w:val="report char"/>` +
  `<w:basedOn w:val="Normal"/><w:link w:val="Report"/><w:uiPriority w:val="9"/><w:rsid w:val="00B2"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="plain"/></w:style>` +
  `</w:styles>`

// v0.142：编号部件。numId=1 指 abstractNumId=0：0 层是子弹（·/左对齐），1 层是小写
// 字母（模板 "%2."/居中对齐）；num 上再挂一枚 startOverride=3——读手要把「这一串从
// 第 3 号起」读出来（<ol start="3">），lvlOverride|ilvl 与 startOverride|val 两对由此上账。
// v0.150：定义账六枚——nsid/tmpl 两枚身份（multiLevelType 从属性形态改回**子元素**
// 形态：v0.145 那版写成 abstractNum 身上的属性，读手查的是一枚不存在的属性，那 9 个
// 字面从来没进过分子），lvl 上加 tentative/tplc 两枚属性与 suff 一枚子元素
// v0.152：分页后重新编号总闸 restartNumberingAfterBreak（**开标签上的属性**，按 local
// name 收——Word 与 docx 库发的都是 w15: 前缀，这里放 w: 形态，两种都该认得来）、
// w:num 上的 durableId（只读记账）、根上的 mc:Ignorable（只读记账）
const FIXTURE_NUMBERING =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:numbering xmlns:w="${W}" xmlns:mc="${MC}" mc:Ignorable="w14">` +
  `<w:abstractNum w:abstractNumId="0" w:restartNumberingAfterBreak="0">` +
  `<w:nsid w:val="00A1B2C3"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="0A0B0C"/>` +
  `<w:lvl w:ilvl="0" w:tentative="1" w:tplc="0409001F">` +
  `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:suff w:val="nothing"/><w:lvlText w:val="·"/><w:lvlJc w:val="left"/></w:lvl>` +
  `<w:lvl w:ilvl="1" w:tentative="0" w:tplc="0409001D">` +
  `<w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:suff w:val="tab"/><w:lvlText w:val="%2."/><w:lvlJc w:val="center"/></w:lvl>` +
  `</w:abstractNum>` +
  `<w:num w:numId="1" w:durableId="3C7B9A2E"><w:abstractNumId w:val="0"/>` +
  `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num>` +
  `</w:numbering>`

const FIXTURE_DOC =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  // v0.145：图片与浮动族要 wp/a/pic/r 四个命名空间（docPr/cNvPr/blip）
  // v0.150：兼容性族再要一个 mc（AlternateContent/Choice 与根上的 mc:Ignorable）
  // v0.151：形状壳要 wps（wsp/cNvSpPr/txbx/bodyPr）
  `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"` +
  // v0.153：w10 是 w10:wrap（遗留环绕）的命名空间
  ` xmlns:v="${V}" xmlns:o="${O}" xmlns:mc="${MC}" xmlns:wps="${WPS}" xmlns:w10="${W10}"` +
  ` mc:Ignorable="w14"><w:body>` +
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
  // v0.151：基线升降的元素名修正——CT_RPr 里没有 w:pos 这枚元素，Word 与 docx 库发的
  // 都是 w:position（ST_SignedTwipsPerMil）。v0.142 起夹具一直放 w:pos、MUST_SEE 一直
  // 断言 pos|val——夹具与读手在错误的名字上互锁自证，而宇宙里根本没有这对；position|val
  // （338 字面）因此从没进过分子，屏上的 vertical-align 升降对真实件一次都没生效
  `<w:lang w:val="en-US" w:eastAsia="zh-CN"/><w:kern w:val="2"/><w:position w:val="12"/>` +
  // v0.152：全大写（caps，屏上 text-transform: uppercase）与字符边框四枚（bdr，
  // 屏上 CSS border——sz 是八分之一磅、space 是磅，两枚都要换算）。两枚都是包有
  // 原生槽的读写属性（IRunOptions.allCaps / IRunOptions.border）
  `<w:caps w:val="true"/><w:bdr w:val="single" w:sz="8" w:space="0" w:color="FF0000"/></w:rPr>` +
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
  // v0.148：同一段扩成完整的容器壳——wp:inline 四边避让、wp:effectExtent 四边、
  // wp:cNvGraphicFramePr/a:graphicFrameLocks、pic:cNvPicPr/a:picLocks、xfrm 的 off+ext、
  // a:prstGeom 档位（元素序按 CT_Inline / CT_GraphicalObject 的 schema，错序 Word 会报坏件）
  `<w:p><w:r><w:drawing>` +
  // v0.150：wp:inline 的两个流水号（anchorId/editId）与 a:blip 的 cstate（打印才出图）
  `<wp:inline distT="114300" distB="0" distL="114300" distR="0" anchorId="00000001" editId="00000002">` +
  `<wp:extent cx="914400" cy="914400"/>` +
  `<wp:effectExtent l="19050" t="9525" r="0" b="0"/>` +
  `<wp:docPr id="7" name="图片 1" descr="画布级替代文本"/>` +
  `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
  `<a:graphic><a:graphicData uri="${PIC}">` +
  `<pic:pic><pic:nvPicPr><pic:cNvPr id="3" name="cNv 名" descr="图形级替代文本"/>` +
  // v0.149：a:picLocks 的箭头锁（与纵横比锁同一枚元素两个属性）、pic:spPr 的黑白模式
  `<pic:cNvPicPr><a:picLocks noChangeAspect="0" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr>` +
  // v0.150：blip 的 cstate（「只在打印时出图」那档）
  `<pic:blipFill><a:blip r:embed="rId1" cstate="print"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr bwMode="gray"><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
  // v0.152：渐变填充的两枚色标（a:gs 的 pos，千分比）——只记第一枚，一条 gradFill 里
  // 常有好几枚 gs，位置序列说明渐变形状，全挂撑爆 HTML
  `<a:gradFill><a:gsLst>` +
  `<a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>` +
  `<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>` +
  `</a:gsLst></a:gradFill>` +
  // v0.150：a:ext 的 uri（扩展点身份）、a:ln 的线宽与 a:lumMod 的亮度调制
  // v0.152：a:ln 再带 cap（线端档）与 cmpd（复合线型）两枚；schemeClr 里再住
  // a:lum 的 bright/contrast 与 a:shade 的压暗档位（与 lumMod/lumOff 同族）
  `<a:ext uri="{1234-5678-9ABC-DEF0}"/><a:ln w="9525" cap="flat" cmpd="sng"><a:solidFill><a:schemeClr val="accent1">` +
  `<a:lumMod val="50000"/><a:lum bright="40000" contrast="60000"/><a:shade val="50000"/></a:schemeClr></a:solidFill></a:ln>` +
  // v0.151：schemeClr 的槽位名（宇宙最大单对）、a:lumOff 的明度偏移（与 lumMod 同住
  // schemeClr 里）、a:miter 的斜接限制（a:ln 的子元素）。fill/line 两处引用分开查
  `<a:ext uri="{1234-5678-9ABC-DEF1}"/><a:ln w="9525"><a:solidFill><a:schemeClr val="accent2">` +
  `<a:lumMod val="50000"/><a:lumOff val="50000"/></a:schemeClr></a:solidFill><a:miter lim="800000"/></a:ln>` +
  `</pic:spPr></pic:pic>` +
  `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
  // v0.148：浮动图（wp:anchor）——simplePos 的绝对坐标与 positionH/V 的基准。
  // 一个 w:drawing 里 inline 与 anchor 二选一，所以另开一段；写侧只发内嵌图，
  // 这一层壳读了写不回（审计里的已知边界），但读手查问照样进分子
  `<w:p><w:r><w:drawing>` +
  // v0.149：六枚闸门（allowOverlap / behindDoc / layoutInCell / locked / relativeHeight /
  // simplePos）——写侧只发内嵌图，这一层壳读了写不回，但读手查问照样进分子
  `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" allowOverlap="1"` +
  ` behindDoc="0" layoutInCell="1" locked="0" relativeHeight="1">` +
  `<wp:simplePos x="360" y="720"/>` +
  `<wp:positionH relativeFrom="page"><wp:posOffset>360</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="margin"><wp:posOffset>720</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="914400" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
  `<wp:docPr id="8" name="浮动图"/><wp:cNvGraphicFramePr/>` +
  `<a:graphic><a:graphicData uri="${PIC}">` +
  `<pic:pic><pic:nvPicPr><pic:cNvPr id="4" name="浮动图"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>` +
  // v0.154：a:srcRect——blipFill 的**源裁剪框**（从原图哪一块取像素），四条边是千分比
  // （25000 = 25%）。与 VML 的 crop 是同一件事的两代写法，屏上都走 clip-path: inset
  `<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect t="25000" r="0" b="10000" l="5000"/>` +
  `<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
  `</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>` +
  // v0.149：VML 图片壳（w:pict 那一支）——位图字节在 v:imagedata 上，其余是壳：
  // v:shape 七枚（id/spid/spt/type/coordsize/filled/stroked，gfxdata 裁定不收）、
  // o:lock 两枚（aspectratio/ext，VML 的 o: 前缀走 attrL）、v:imagedata 的 o:title、
  // v:fill 两枚（on/focussize）、v:stroke 三枚（on/joinstyle/weight）。
  // 元素序按 VML 的规矩：imagedata 打头、其后 lock/fill/stroke/path
  `<w:p><w:r><w:pict><v:shape id="_x0000_s1026" spid="_x0000_s1027" spt="75" type="#_x0000_t75"` +
  // v0.150：shape 身上的 path 缓存串与 fillcolor（Word 没装字体时靠 path 画异形）
  ` coordsize="1000,1000" filled="t" stroked="f" style="width:100pt;height:50pt"` +
  ` path="m0,0 l100,0 e" fillcolor="#ffc0cb"` +
  // v0.153：shape 余量十枚——adj（调节值）、alt（替代文本）、bullet（项目符号图形）、
  // connectortype（连接线类型）、coordorigin（坐标原点）、ole（OLE 对象开关）、
  // preferrelative（优先相对坐标），加描边的色与宽
  ` adj="0.5" alt="老式形状" bullet="f" connectortype="straight" coordorigin="0,0"` +
  ` ole="f" preferrelative="t" anchorId="A0" strokecolor="#00ff00" strokeweight="2pt">` +
  // v0.153：imagedata 的裁剪四边——这一族是 VML 壳里唯一落到 CSS 的（clip-path:inset）
  `<v:imagedata r:id="rId1" o:title="老式图的标题" croptop="0.1" cropright="0.2" cropbottom="5%" cropleft="0"/>` +
  // v0.150：o:useLocalDpi（按本机 DPI 量尺寸）与 o:attr（扩展点名值对）
  `<o:useLocalDpi val="0"/><o:attr name="x" val="y"/>` +
  // v0.153：o:lock 补 shapetype（锁在哪个模板上）
  `<o:lock aspectratio="f" ext="edit" shapetype="t"/>` +
  // v0.151：v:stroke 补描边色与斜接限制两枚（与 on/joinstyle/weight 同元素）
  // v0.153：再补 dashstyle（虚线样式）、startarrow/endarrow（箭头）、endcap（端帽）
  `<v:fill on="t" focussize="0,0" type="gradient" color2="#00ff00" colors="0% #fff,100% #000"` +
  ` ext="view" focus="50%" focusposition="0,0" id="fill1" opacity="0.5" opacity2="1"` +
  ` recolor="t" rotate="t" title="填充标题"/>` +
  `<v:stroke on="t" joinstyle="round" weight="1pt" color="#000080" miterlimit="8"` +
  ` dashstyle="dash" endarrow="block" endcap="round" startarrow="oval"/>` +
  // v0.153：渐变取景框（v:fillRect 上下、v:fillToRect 四边）与线性渐变角度（v:lin）
  `<v:fillRect b="0" t="0"/><v:fillToRect b="0" l="0" r="0" t="0"/><v:lin ang="45" scaled="0"/>` +
  // v0.153：VML 阴影十三枚——没有颜色可挂（CSS 的 box-shadow 要有色），只按名查问
  `<v:shadow on="t" val="0.5" algn="tl" blurRad="2pt" dir="2700000" dist="3pt" kx="0" ky="0"` +
  ` offset="2pt,2pt" opacity="0.5" origin="0,0" sx="1" sy="1"/>` +
  // v0.153：三维旋转与隐藏线宽
  `<v:rot lat="0" lon="0" rev="0"/><v:hiddenLine w="1pt"/>` +
  // v0.153：公式与手柄（v:f 的 eqn、v:h 的坐标与活动范围）
  `<v:formulas><v:f eqn="sum 0 0 0"/></v:formulas>` +
  `<v:handles><v:h position="0,0" xrange="0,10" yrange="0,10"/></v:handles>` +
  // v0.153：遗留环绕（w10:wrap 的四枚）与连线锁
  `<w10:wrap anchorx="margin" anchory="page" side="left" type="square"/>` +
  `<o:cxnSpLocks noChangeShapeType="1"/>` +
  // v0.150：图元几何族——v:path 的盒子（w/h）与两枚顶点（v:pt 的 x/y）、
  // v:gd 的公式与名、v:cxn 的连线角、v:pos 的手柄位置。只读记账：
  // 每族只记「枚数 + 首枚值」，全挂会把 HTML 撑爆
  // v0.151：v:path 再带 connectangles/connectlocs 两枚连接几何（真实件里常是空串）
  // v0.153：v:path 余量六枚——五个「这条路径允许哪种变换」的开关与连接点类型
  `<v:path w="1000" h="1000" connectangles="" connectlocs="" arrowok="t" connecttype="custom"` +
  ` extrusionok="f" fillok="f" gradientshapeok="t" textboxrect="0,0,10,10">` +
  `<v:pt x="0" y="0"/><v:pt x="10" y="20"/></v:path>` +
  `<v:gd fmla="sum 0 0 0" name="x1"/><v:cxn ang="0"/><v:pos x="5" y="6"/>` +
  `</v:shape>` +
  // v0.151：v:rect 四边——textbox 老式件的文字盒（与 v:shape 平级），四边常是 0
  // v0.153：补余量十一枚（身份、坐标约定、填充描边三件套与 allowincell）
  `<v:rect l="0" t="0" r="0" b="0" id="rc1" spid="rc2" spt="1" style="width:10pt"` +
  ` coordsize="1000,1000" fillcolor="#eeeeee" filled="t" strokecolor="#333333" stroked="f"` +
  ` strokeweight="0.75pt" allowincell="t"/>` +
  // v0.153：老式形状壳余下的三族——圆角矩形（arcsize 是圆角弧度）、直线（from/to
  // 两端点）、形状模板（oned 是单手柄开关，path 是可复用图元）。外加文字盒两枚
  `<v:roundrect id="rr1" spid="rr2" spt="201" style="width:80pt;height:40pt" coordsize="1000,1000"` +
  ` arcsize="0.1" fillcolor="#ffff00" filled="t" strokecolor="#ff0000" stroked="t"` +
  ` strokeweight="1pt" anchorId="A1"/>` +
  `<v:line id="ln1" spid="ln2" spt="20" style="position:absolute" coordsize="1000,1000"` +
  ` from="0,0" to="100,100" fillcolor="#0000ff" filled="f" strokecolor="#000080" stroked="t"` +
  ` strokeweight="2pt" allowincell="f" anchorId="A2"/>` +
  `<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m0,0 l0,21600 e"` +
  ` filled="f" stroked="t" adj="0" anchorId="A3" oned="t" preferrelative="t"/>` +
  `<v:textbox inset="2pt,2pt,2pt,2pt" style="mso-fit-shape-to-text:t"/>` +
  `</w:pict></w:r></w:p>` +
  // v0.150：VML 分组画布——v:group 五枚（id/spid/coordorigin/coordsize/style）。
  // gfxdata（图元字节缓存）**裁定不收**：base64  blob 挂 HTML 属性性价比极差，
  // 且写侧写不回——与 t|space 同款裁定，所以夹具里也不放它
  // v0.153：补 editas（编辑时按什么呈现）与 spt，画布坐标另两只（chExt/chOff）
  `<w:p><w:r><w:pict><v:group id="_x0000_s1025" spid="_x0000_s1026" coordorigin="0,0"` +
  ` coordsize="1000,1000" style="position:absolute" anchorId="A4" editas="canvas" spt="0">` +
  `<v:imagedata r:id="rId1"/><v:chExt cx="1000" cy="1000"/><v:chOff x="0" y="0"/>` +
  `</v:group></w:pict></w:r></w:p>` +
  // v0.153：嵌入对象那一支（w:object + o:OLEObject）——与 w:drawing 平级、不在 w:pict
  // 下，所以不进 VML 壳那趟扫描，单列两条：dxaOrig/dyaOrig 是原始尺寸（缇），
  // DrawAspect/ObjectID/ShapeID 是显示方式与两个身份号（ProgID/Type 已由 embed 路径读）
  `<w:p><w:r><w:object w:dxaOrig="5486" w:dyaOrig="3200">` +
  `<o:OLEObject DrawAspect="Content" ObjectID="_1" ShapeID="_x0000_s1027"/>` +
  `</w:object></w:r></w:p>` +
  // v0.151：wps:wsp 形状壳——文本框那一支。段内没有 a:blip，图片短路链够不着，
  // 只能靠跑正文前的按名查问（noteShapeMarks）上账：a:style 的四枚样式矩阵引用
  // （lnRef/fillRef/effectRef/fontRef 的 idx，各带一枚 schemeClr）、cNvSpPr 的
  // txBox，以及 txbx 之后的 bodyPr 全 19 枚文本盒属性（CT_WordprocessingShape 序）
  `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="9" name="形状 1"/>` +
  `<a:graphic><a:graphicData><wps:wsp>` +
  `<a:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>` +
  `<a:fillRef idx="2"><a:schemeClr val="accent2"/></a:fillRef>` +
  `<a:effectRef idx="0"><a:schemeClr val="accent3"/></a:effectRef>` +
  `<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></a:style>` +
  // v0.154：a:spLocks 的两把锁（不许改箭头、不许改顶点）——与 a:picLocks 同族两支，
  // 壳上零兑现（Web 没有「锁定编辑」），只读记账
  `<wps:cNvSpPr txBox="1"><a:spLocks noChangeArrowheads="1" noEditPoints="1"/></wps:cNvSpPr>` +
  `<wps:spPr><a:xfrm/></wps:spPr>` +
  `<wps:txbx><w:txbxContent><w:p><w:r><w:t>文本框正文</w:t></w:r></w:p></w:txbxContent></wps:txbx>` +
  `<wps:bodyPr anchor="ctr" wrap="square" vert="horz" numCol="1" lIns="91440" tIns="45720"` +
  ` rIns="91440" bIns="91440" anchorCtr="0" rtlCol="0" compatLnSpc="0" upright="0" rot="0"` +
  ` spcCol="0" spcFirstLastPara="0" forceAA="0" fromWordArt="0" horzOverflow="overflow"` +
  ` vertOverflow="overflow"/>` +
  `</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
  // v0.151：rPr 的 w:position——基线升降（半点，正升负降）。读名从 w:pos 修正为
  // w:position：CT_RPr 里没有 w:pos 这枚元素，Word 与 docx 库发的都是 w:position，
  // 旧读名让那 338 字面从没进过分子、屏上升降对真实件一次都没生效
  `<w:p><w:r><w:rPr><w:position w:val="24"/></w:rPr><w:t>升上去的字</w:t></w:r></w:p>` +
  // v0.154：隐藏文字（w:vanish）。屏上走 visibility: hidden 而不是 display:none——
  // Word 的隐藏文字不显示却仍占版面，抹掉布局等于改了周围排版。写侧有原生槽（可往返）
  `<w:p><w:r><w:rPr><w:vanish w:val="1"/></w:rPr><w:t>看不见的字</w:t></w:r></w:p>` +
  // v0.154：智能标记壳（w:smartTag，Word 2003 那一代的「认出这是个地址/人名」）。
  // 壳本身不产文字也不改排版（字一个都不少），element 与 uri 是它仅有的两枚信息
  `<w:p><w:smartTag w:element="address" w:uri="urn:schemas-microsoft-com:office:smarttags">` +
  `<w:r><w:t>智能标记里的字</w:t></w:r></w:smartTag></w:p>` +
  // v0.154：批注引用（w:commentReference）。批注区间由 commentRangeStart/End 那对包出来，
  // 这一枚不产可见文字，但它的 w:id 是「指向哪一条批注」——同一条链上的第三处 id
  `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>被批注的字</w:t></w:r><w:commentRangeEnd w:id="1"/>` +
  `<w:r><w:commentReference w:id="1"/></w:r></w:p>` +
  // v0.150：文档级标记三族——proofErr（拼写/语法检查标记，body 直子）、
  // mc:Choice（AlternateContent 的兼容分支）都不在任何读手路径上，块遍历前先查问
  `<w:proofErr w:type="spellStart"/>` +
  `<mc:AlternateContent><mc:Choice Requires="wps"><w:p><w:r><w:t>兼容分支</w:t></w:r></w:p></mc:Choice>` +
  `<mc:Fallback><w:p><w:r><w:t>兜底分支</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>` +
  // v0.145：段落浮动框架——absolute 形态（x/y 在场，无 xAlign/yAlign），十二枚全上账
  `<w:p><w:pPr><w:framePr w:x="720" w:y="1440" w:w="2880" w:h="720" w:hRule="exact"` +
  ` w:hSpace="12" w:vSpace="24" w:hAnchor="page" w:vAnchor="text" w:wrap="around" w:anchorLock="1"/></w:pPr>` +
  `<w:r><w:t>浮动框架段</w:t></w:r></w:p>` +
  // v0.145：浮动表——tblpPr 十枚（属性无前缀）。tblpPr 在 tblPr 里排 tblStyle 之后
  // v0.152：表级条件格式尺寸两枚（bandSize，排在 tblpPr 之后 tblW 之前——CT_TblPrBase 序）
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>` +
  `<w:tblpPr tblpX="10" tblpXSpec="absolute" tblpY="10" vertAnchor="top" horzAnchor="page"` +
  ` topFromText="0" leftFromText="108" bottomFromText="0" rightFromText="108" overlap="never"/>` +
  // v0.154：表与浮动对象重叠的许可（tblOverlap 排在 tblpPr 之后、bandSize 之前——
  // CT_TblPrBase 序：tblStyle → tblpPr → **tblOverlap** → bidiVisual → bandSize → tblW → …）
  `<w:tblOverlap w:val="never"/>` +
  `<w:tblStyleRowBandSize w:val="1"/><w:tblStyleColBandSize w:val="2"/>` +
  `<w:tblW w:w="5000" w:type="dxa"/>` +
  // v0.154：单元格间距（tblCellSpacing，排在 tblW/jc 之后、tblInd 之前）与表条件格式
  // 落点开关十三枚（cnfStyle，与 tblStyle 同住 tblPr 头一档）
  `<w:tblCellSpacing w:w="144" w:type="dxa"/>` +
  `<w:cnfStyle w:val="000000100000" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0"` +
  ` w:oddHBand="1" w:evenHBand="0" w:oddVBand="1" w:evenVBand="0" w:firstRowFirstColumn="1"` +
  ` w:firstRowLastColumn="0" w:lastRowFirstColumn="0" w:lastRowLastColumn="0"/>` +
  `</w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
  // v0.152：单元格不换行（w:tcPr/w:noWrap，排在 tcW 之后——CT_TcPr 序）
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:noWrap/></w:tcPr>` +
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
  // v0.152：hyperlink 的 w:history——这一链链接进没进过「历史记录」（Word 的已访问
  // 链接账）。只读记账：r:id 写侧发包自己重编，这枚身份带不回来
  `<w:p><w:hyperlink r:id="rId9" w:history="1"><w:r><w:t>进过历史的链</w:t></w:r></w:hyperlink></w:p>` +
  // v0.146：表级边框 space——两行两列六边都带边框，space 只写在 top=1 / insideH=2 /
  // insideV=3 三枚上（分摊口径：外层四边贴外圈格、insideH/insideV 贴相邻两格，
  // 仅当该边边框真回落到表级时才挂——格内无 tcBorders，六边全回落）
  `<w:tbl><w:tblPr><w:tblBorders>` +
  `<w:top w:val="single" w:sz="4" w:space="1" w:color="000000"/>` +
  `<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
  `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
  `<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
  // v0.150：insideH/insideV 带 themeColor 一族（主题色引用 + tint/shade）。
  // 量具的 zip 不带 theme1.xml，主题解析不出来——但引用名的**按名查问**照样要做
  // （v0.150 起 themeRefCss 把 attr 与「有没有主题」解耦，此前无主题的件这三枚
  // 一直挂在 neverConsulted 里）
  `<w:insideH w:val="single" w:sz="4" w:space="2" w:color="000000" w:themeColor="accent1" w:themeTint="99" w:themeShade="BF"/>` +
  `<w:insideV w:val="single" w:sz="4" w:space="3" w:color="000000" w:themeColor="accent1" w:themeTint="99" w:themeShade="BF"/>` +
  `</w:tblBorders></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>` +
  `<w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc>` +
  `<w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr>` +
  `<w:tr><w:tc><w:p><w:r><w:t>丙</w:t></w:r></w:p></w:tc>` +
  `<w:tc><w:p><w:r><w:t>丁</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
  // v0.147：段落属性余量——pPr 里那批屏上不兑现的直接属性。七枚 onOff 里特意混着
  // 显式 0 与显式 1（snapToGrid 在 Word 里默认就是开，「显式关」是真值，不能与没写同路），
  // textAlignment 是枚举档；w:spacing 身上再挂两枚自动段距
  `<w:p><w:pPr>` +
  `<w:adjustRightInd w:val="0"/><w:snapToGrid w:val="1"/><w:topLinePunct w:val="0"/>` +
  `<w:bidi w:val="1"/><w:autoSpaceDE w:val="1"/><w:autoSpaceDN w:val="0"/>` +
  `<w:suppressLineNumbers w:val="1"/><w:textAlignment w:val="center"/>` +
  `<w:spacing w:beforeAutospacing="1" w:afterAutospacing="0"/>` +
  `</w:pPr><w:r><w:t>属性余量段</w:t></w:r></w:p>` +
  // v0.147：表自身的条件层闸门——w:tblPr 上那一枚 w:tblLook（与样式里那一枚同名同义，
  // 归属不同：这张表自己说的压过样式说的）
  `<w:tbl><w:tblPr><w:tblLook w:val="01E0" w:noHBand="1" w:noVBand="0"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
  `<w:tr><w:tc><w:p><w:r><w:t>闸门表</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
  // v0.152：页眉页脚引用两族（sectPr 打头的位置——CT_SectPr 序 headerReference/
  // footerReference 排在最前）。只读记账：id 是关系 id 写侧发包自己重编，type
  // （default/first/even）我们只发 default 一档
  `<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/><w:footerReference w:type="default" r:id="rIdFtr"/>` +
  `<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>` +
  `<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/>` +
  // v0.147：节属性余下两族——分栏（w:cols）与文档网格（w:docGrid）。纸型与页边距
  // 那两枚早就在夹具里（读手原先不读其中的 top/bottom/header/footer/gutter/orient）
  // v0.152：docGrid 再加 charSpace（每字符网格宽度，缇）——与 linePitch 同住一枚
  // 元素上的第三枚，读写（包的 grid.charSpace 是原生槽）
  `<w:cols w:num="2" w:space="720"/><w:docGrid w:type="lines" w:linePitch="312" w:charSpace="200"/></w:sectPr>` +
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
  // v0.151：pos|val 曾在此列——那是 v0.142 起夹具与读手在错误元素名 w:pos 上的互锁
  // （CT_RPr 无此元素，宇宙里根本没有这对），改成 w:position 的 position|val，见
  // MUST_SEE 尾部与 D10 审计节
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
  // v0.150 修正：multiLevelType 从「w:abstractNum 身上的属性」改回**子元素**形态
  // （OOXML 的 CT_AbstractNum 里它就是一枚 <w:multiLevelType w:val>）——旧夹具与旧
  // 断言记的是 abstractNum|multiLevelType 那对不存在的属性，新对是 multiLevelType|val
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
  // v0.147 D6：段落属性余量九枚（pPr 七枚 onOff + textAlignment 枚举 + w:spacing 上的
  // 两枚自动段距）、表自身闸门三枚（w:tblPr/w:tblLook 的 val/noHBand/noVBand）、
  // 节属性九枚（pgSz 的 h 与 orient、pgMar 的 top/bottom/header/footer/gutter、
  // cols 的 num/space、docGrid 的 type/linePitch）
  'adjustRightInd|val',
  'snapToGrid|val',
  'topLinePunct|val',
  'bidi|val',
  'autoSpaceDE|val',
  'autoSpaceDN|val',
  'suppressLineNumbers|val',
  'textAlignment|val',
  'spacing|beforeAutospacing',
  'spacing|afterAutospacing',
  'tblLook|val',
  'tblLook|noHBand',
  'tblLook|noVBand',
  'pgSz|h',
  'pgSz|orient',
  'pgMar|top',
  'pgMar|bottom',
  'pgMar|header',
  'pgMar|footer',
  'pgMar|gutter',
  'cols|num',
  'cols|space',
  'docGrid|type',
  'docGrid|linePitch',
  // v0.148 D7：图片容器壳二十二枚——wp:inline/wp:anchor 的四边避让、wp:effectExtent
  // 四边、wp:docPr 与 pic:cNvPr 的序号与对象名、两枚 locks（graphicFrameLocks /
  // picLocks 的 noChangeAspect）、a:prstGeom 档位、a:xfrm 的 a:off/a:ext、
  // wp:simplePos 坐标与 wp:positionH/V 的基准
  'inline|distT',
  'inline|distB',
  'inline|distL',
  'inline|distR',
  'effectExtent|l',
  'effectExtent|t',
  'effectExtent|r',
  'effectExtent|b',
  'docPr|id',
  'cNvPr|id',
  'cNvPr|name',
  'graphicFrameLocks|noChangeAspect',
  'picLocks|noChangeAspect',
  'prstGeom|prst',
  'ext|cx',
  'ext|cy',
  'off|x',
  'off|y',
  'simplePos|x',
  'simplePos|y',
  'positionH|relativeFrom',
  'positionV|relativeFrom',
  // v0.149 D8：VML 图片壳十五枚 + wp:anchor 六枚闸门 + DrawingML 两枚
  // （a:picLocks 的箭头锁、pic:spPr 的黑白模式档位）
  'shape|id',
  'shape|spid',
  'shape|spt',
  'shape|type',
  'shape|coordsize',
  'shape|filled',
  'shape|stroked',
  'lock|aspectratio',
  'lock|ext',
  'imagedata|title',
  'fill|on',
  'fill|focussize',
  'stroke|on',
  'stroke|joinstyle',
  'stroke|weight',
  'anchor|allowOverlap',
  'anchor|behindDoc',
  'anchor|layoutInCell',
  'anchor|locked',
  'anchor|relativeHeight',
  'anchor|simplePos',
  'picLocks|noChangeArrowheads',
  'spPr|bwMode',
  // v0.150 D9：numbering 六枚（含 multiLevelType 的子元素形态修正）、styles 身份两枚、
  // DrawingML 零星五枚、VML 形状余量五枚、VML 分组五枚、图元几何九枚、
  // 表边框主题色两枚、文档级标记三枚
  'nsid|val',
  'tmpl|val',
  'multiLevelType|val',
  'lvl|tentative',
  'lvl|tplc',
  'suff|val',
  'next|val',
  'rsid|val',
  'blip|cstate',
  'ext|uri',
  'inline|anchorId',
  'inline|editId',
  'lumMod|val',
  'ln|w',
  'insideH|themeColor',
  'insideV|themeColor',
  'shape|path',
  'shape|fillcolor',
  'useLocalDpi|val',
  'attr|name',
  'attr|val',
  'group|id',
  'group|spid',
  'group|coordorigin',
  'group|coordsize',
  'group|style',
  'gd|fmla',
  'gd|name',
  'pt|x',
  'pt|y',
  'cxn|ang',
  'pos|x',
  'pos|y',
  'path|w',
  'path|h',
  'proofErr|type',
  'Choice|Requires',
  'document|Ignorable',
  // v0.151：形状壳一族（noteShapeMarks 按名查问）+ rPr 的基线升降读名修正
  'lnRef|idx',
  'fillRef|idx',
  'effectRef|idx',
  'fontRef|idx',
  'cNvSpPr|txBox',
  'bodyPr|anchor',
  'bodyPr|anchorCtr',
  'bodyPr|bIns',
  'bodyPr|compatLnSpc',
  'bodyPr|forceAA',
  'bodyPr|fromWordArt',
  'bodyPr|horzOverflow',
  'bodyPr|lIns',
  'bodyPr|numCol',
  'bodyPr|rIns',
  'bodyPr|rot',
  'bodyPr|rtlCol',
  'bodyPr|spcCol',
  'bodyPr|spcFirstLastPara',
  'bodyPr|tIns',
  'bodyPr|upright',
  'bodyPr|vert',
  'bodyPr|vertOverflow',
  'bodyPr|wrap',
  'position|val',
  // v0.151：图片壳零头六族（schemeClr 在图片段由 readImgPayload 收、wsp 段由
  // noteShapeMarks 收——两处都查问，同对只记一次）
  'schemeClr|val',
  'lumOff|val',
  'miter|lim',
  'stroke|color',
  'stroke|miterlimit',
  'path|connectangles',
  'path|connectlocs',
  'rect|l',
  'rect|t',
  'rect|r',
  'rect|b',
  // v0.152：字符/单元格/编号/节级读写族 + DrawingML 色彩零头
  'caps|val',
  'bdr|val',
  'bdr|sz',
  'bdr|space',
  'bdr|color',
  'noWrap|val',
  'tblStyleRowBandSize|val',
  'tblStyleColBandSize|val',
  'abstractNum|restartNumberingAfterBreak',
  'num|durableId',
  'numbering|Ignorable',
  'styles|Ignorable',
  'headerReference|id',
  'headerReference|type',
  'footerReference|id',
  'footerReference|type',
  'docGrid|charSpace',
  'hyperlink|history',
  'lum|bright',
  'lum|contrast',
  'shade|val',
  'gs|pos',
  'ln|cap',
  'ln|cmpd',
  // v0.153：VML 形状壳余量（w:pict 那一支，只读记账 + 裁剪四边落到 CSS）
  'roundrect|id', 'roundrect|spid', 'roundrect|spt', 'roundrect|style', 'roundrect|coordsize',
  'roundrect|arcsize', 'roundrect|fillcolor', 'roundrect|filled', 'roundrect|strokecolor',
  'roundrect|stroked', 'roundrect|strokeweight', 'roundrect|anchorId',
  'line|id', 'line|spid', 'line|spt', 'line|style', 'line|coordsize', 'line|from', 'line|to',
  'line|fillcolor', 'line|filled', 'line|strokecolor', 'line|stroked', 'line|strokeweight',
  'line|allowincell', 'line|anchorId',
  'rect|id', 'rect|spid', 'rect|spt', 'rect|style', 'rect|coordsize', 'rect|fillcolor',
  'rect|filled', 'rect|strokecolor', 'rect|stroked', 'rect|strokeweight', 'rect|allowincell',
  'shape|adj', 'shape|alt', 'shape|anchorId', 'shape|bullet', 'shape|connectortype',
  'shape|coordorigin', 'shape|ole', 'shape|preferrelative', 'shape|strokecolor', 'shape|strokeweight',
  'shapetype|adj', 'shapetype|anchorId', 'shapetype|coordsize', 'shapetype|filled', 'shapetype|id',
  'shapetype|oned', 'shapetype|path', 'shapetype|preferrelative', 'shapetype|spt', 'shapetype|stroked',
  'group|anchorId', 'group|editas', 'group|spt',
  'textbox|inset', 'textbox|style',
  'path|arrowok', 'path|connecttype', 'path|extrusionok', 'path|fillok', 'path|gradientshapeok',
  'path|textboxrect',
  'shadow|algn', 'shadow|blurRad', 'shadow|dir', 'shadow|dist', 'shadow|kx', 'shadow|ky',
  'shadow|offset', 'shadow|on', 'shadow|opacity', 'shadow|origin', 'shadow|sx', 'shadow|sy',
  'shadow|val',
  'fill|color2', 'fill|colors', 'fill|ext', 'fill|focus', 'fill|focusposition', 'fill|id',
  'fill|opacity', 'fill|opacity2', 'fill|recolor', 'fill|rotate', 'fill|title', 'fill|type',
  'stroke|dashstyle', 'stroke|endarrow', 'stroke|endcap', 'stroke|startarrow',
  'imagedata|cropbottom', 'imagedata|cropleft', 'imagedata|cropright', 'imagedata|croptop',
  'lock|shapetype', 'rot|lat', 'rot|lon', 'rot|rev', 'hiddenLine|w',
  'fillRect|b', 'fillRect|t', 'fillToRect|b', 'fillToRect|l', 'fillToRect|r', 'fillToRect|t',
  'lin|ang', 'lin|scaled', 'h|position', 'h|xrange', 'h|yrange',
  'chExt|cx', 'chExt|cy', 'chOff|x', 'chOff|y', 'f|eqn',
  'wrap|anchorx', 'wrap|anchory', 'wrap|side', 'wrap|type', 'cxnSpLocks|noChangeShapeType',
  'object|dxaOrig', 'object|dyaOrig', 'OLEObject|DrawAspect', 'OLEObject|ObjectID', 'OLEObject|ShapeID',
  // v0.154：图片源裁剪框 / 表间距 / 隐藏文字（三族读写或读侧兑现）
  'srcRect|t', 'srcRect|r', 'srcRect|b', 'srcRect|l',
  'tblCellSpacing|w', 'tblCellSpacing|type',
  'vanish|val',
  // v0.154：批注族（改由读手走 attr 漏斗读，不再是正则盲区）+ 脚注尾注根 Ignorable
  'comment|id', 'comment|author', 'comment|date', 'comment|initials',
  'commentEx|done', 'comments|Ignorable', 'commentsEx|Ignorable', 'commentReference|id',
  'footnotes|Ignorable', 'endnotes|Ignorable',
  // v0.154：纯只读记账三族——表条件格式落点开关十三枚、智能标记两枚、表重叠许可与形状锁
  'cnfStyle|val', 'cnfStyle|firstRow', 'cnfStyle|lastRow', 'cnfStyle|firstColumn', 'cnfStyle|lastColumn',
  'cnfStyle|oddHBand', 'cnfStyle|evenHBand', 'cnfStyle|oddVBand', 'cnfStyle|evenVBand',
  'cnfStyle|firstRowFirstColumn', 'cnfStyle|firstRowLastColumn',
  'cnfStyle|lastRowFirstColumn', 'cnfStyle|lastRowLastColumn',
  'smartTag|element', 'smartTag|uri',
  'tblOverlap|val', 'spLocks|noChangeArrowheads', 'spLocks|noEditPoints',
]
// 我放进夹具而读手一寸不查的：t 的 xml:space 是**裁定不查**——escText 无条件保留空白
// （连续空格第二个起换 nbsp），强于 preserve 所需，查了也没有第二行代码可写。
// （v0.143 注：ind|hangingChars 与 left|space 曾在此列——那一轮起 hangingChars 进了
// paraCss 的负 text-indent 分支、pBdr 四边 space 进了 padding，两枚移入 MUST_SEE。
// v0.147 注：spacing 两枚自动段距、pgSz|orient 与 pgMar|gutter 也曾在此列——节属性
// 那一族原是 docxToDocMeta 用正则读的（读是读了、账上是盲区），本轮改由读手走 attr
// 漏斗读，四枚一并移入 MUST_SEE）
const MUST_NOT_SEE = [
  't|space',
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
  // v0.152：hyperlink 的 rId9 与页眉页脚引用的 rIdHdr/rIdFtr（读手只按名查问不解析）
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
      `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>` +
      `<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>` +
      `<Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
      `</Relationships>`,
  )
  zip.file('word/media/image1.png', Buffer.from(PNG_B64, 'base64'))
  // v0.154：批注两份部件——w:comment 的四枚（id/author/date/initials）与两份部件根
  // 上的 mc:Ignorable，外加 commentsExtended 里 w15:commentEx 的 paraId 与 done
  // （done="1" 的那条批注在模型里标 resolved）。保真路径由读手走 attr 漏斗读
  zip.file(
    'word/comments.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="${W}" xmlns:w14="${W14}" xmlns:mc="${MC}" mc:Ignorable="w14">` +
      `<w:comment w:id="1" w:author="张三" w:initials="ZS" w:date="2026-10-25T10:00:00Z">` +
      `<w:p w14:paraId="0F1E2D3C"><w:r><w:t>这条批注</w:t></w:r></w:p></w:comment>` +
      `</w:comments>`,
  )
  zip.file(
    'word/commentsExtended.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w15:commentsEx xmlns:w15="${W15}" xmlns:mc="${MC}" mc:Ignorable="w15">` +
      `<w15:commentEx w15:paraId="0F1E2D3C" w15:done="1"/>` +
      `</w15:commentsEx>`,
  )
  // v0.154：脚注与尾注部件根上的 mc:Ignorable（v0.152 收的 numbering/styles 那两枚的
  // 第三、四处）。两个部件都是空的——这里要的只是根上那一枚属性被按名查问
  zip.file(
    'word/footnotes.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:footnotes xmlns:w="${W}" xmlns:mc="${MC}" mc:Ignorable="w14"></w:footnotes>`,
  )
  zip.file(
    'word/endnotes.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:endnotes xmlns:w="${W}" xmlns:mc="${MC}" mc:Ignorable="w14"></w:endnotes>`,
  )
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
