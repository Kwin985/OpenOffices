// 内置夹具（v0.157 从 scripts/fidelity-report.mjs 搬出来）——**一份事实，两处使用**：
//   --selftest 拿它断言「探针该看到哪些对、不该看到哪些对」；
//   fidelity-roundtrip 拿它做读 → 写 → 普查的往返回探。
// 从前夹具只活在量具脚本里，往返账想用就得另抄一份；抄的那份一旦漂移，两边测的
// 就不是同一份文档了。

// ---- 1b. 内置夹具（--selftest）---------------------------------------------
//
// 分子语义不依赖任何语料：这一份 document.xml 里每枚属性都是我亲手放的，所以「探针应当看到哪些、
// 应当看不到哪些」可以事先写死。MUST_SEE 是读手真会按名查问的，MUST_NOT_SEE 是我故意放进去、
// 而读手（按源码现状）确实一寸都不查的——两边都断言才叫量具，只断一边等于自说自话。
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
// v0.145：图片（docPr/cNvPr/blip）与浮动族的命名空间
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
export const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
// v0.149：VML 图片壳（w:pict 那一支）要 v/o 两个命名空间
export const V = 'urn:schemas-microsoft-com:vml'
export const O = 'urn:schemas-microsoft-com:office:office'
// v0.150：兼容性族（mc:AlternateContent/mc:Choice）与根上的 mc:Ignorable
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
// v0.151：形状壳（wps:wsp/cNvSpPr/txbx/bodyPr）
export const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
// v0.153：遗留环绕 w10:wrap（Word 97-2003 那一套，与 VML 同住 w:pict 里）
export const W10 = 'urn:schemas-microsoft-com:office:word'
// v0.154：批注两份部件（w14:paraId 与 w15:commentEx）
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
export const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
// 1x1 透明 PNG（图片段的关系与媒体目标）
export const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// v0.142：clrScheme 与 fontScheme 并列。dk1/lt1 写成 sysClr（真件里 windowText/window
// 的常驻形态，lastClr 兜底）——合成语料那侧全用 srgbClr（宇宙里没有 sysClr|val），
// 这一分支只有夹具走，两边合起来才把 readThemeColors 的两条路都盖到。
export const FIXTURE_THEME =
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

export const FIXTURE_STYLES =
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
  // v0.155：样式别名（Word 里给样式起的中文名常挂这儿）
  `<w:aliases w:val="报告,Report"/>` +
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
export const FIXTURE_NUMBERING =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:numbering xmlns:w="${W}" xmlns:mc="${MC}" mc:Ignorable="w14">` +
  `<w:abstractNum w:abstractNumId="0" w:restartNumberingAfterBreak="0">` +
  `<w:nsid w:val="00A1B2C3"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="0A0B0C"/>` +
  // v0.155：定义挂在哪条样式上（CT_AbstractNum 序：tmpl 之后、numStyleLink/lvl 之前）
  `<w:styleLink w:val="Report"/>` +
  `<w:lvl w:ilvl="0" w:tentative="1" w:tplc="0409001F">` +
  `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:suff w:val="nothing"/><w:lvlText w:val="·"/>` +
  // v0.155：层余量三枚（CT_Lvl 序：lvlRestart 在 numFmt 之后、suff 之前；
  // lvlPicBulletId 在 lvlText 之后、legacy 之前）
  `<w:lvlRestart w:val="0"/><w:lvlPicBulletId w:val="7"/>` +
  `<w:legacy w:legacy="1" w:legacySpace="0" w:legacyIndent="0"/>` +
  `<w:lvlJc w:val="left"/></w:lvl>` +
  `<w:lvl w:ilvl="1" w:tentative="0" w:tplc="0409001D">` +
  `<w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:suff w:val="tab"/><w:lvlText w:val="%2."/><w:lvlJc w:val="center"/></w:lvl>` +
  `</w:abstractNum>` +
  `<w:num w:numId="1" w:durableId="3C7B9A2E"><w:abstractNumId w:val="0"/>` +
  `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num>` +
  // v0.155：根级两枚——图片项目符号定义（id 属性）与 Mac 版清理水位
  `<w:numPicBullet w:numPicBulletId="7"/>` +
  `<w:numIdMacAtCleanup w:val="0"/>` +
  `</w:numbering>`

export const FIXTURE_DOC =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  // v0.145：图片与浮动族要 wp/a/pic/r 四个命名空间（docPr/cNvPr/blip）
  // v0.150：兼容性族再要一个 mc（AlternateContent/Choice 与根上的 mc:Ignorable）
  // v0.151：形状壳要 wps（wsp/cNvSpPr/txbx/bodyPr）
  `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"` +
  // v0.153：w10 是 w10:wrap（遗留环绕）的命名空间
  ` xmlns:v="${V}" xmlns:o="${O}" xmlns:mc="${MC}" xmlns:wps="${WPS}" xmlns:w10="${W10}"` +
  ` mc:Ignorable="w14">` +
  // v0.155：整篇底色（设计 → 页面颜色）——三枚全带：字面色 + 主题槽 + 主题深浅
  `<w:background w:color="FFE699" w:themeColor="background1" w:themeShade="BF"/>` +
  `<w:body>` +
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
  // v0.164：底纹的背景色改成「主题引用 + 字面色」双戴（Word 的默认写法）——主题那一枚让
  // 屏上色与字面 fill 分了家，字面值从此只有 data-shd 载荷记得住
  `<w:p><w:pPr><w:shd w:val="pct25" w:color="FF0000" w:fill="FFFFFF" w:themeFill="accent2" w:themeFillTint="99" w:themeFillShade="BF"/></w:pPr>` +
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
  // v0.155：行属性余量三枚——gridAfter（这一行末尾空过几格，网格记账用）与
  // wAfter 的两枚（行末留白的宽与档位）。屏上都不画，只读记账
  `<w:tr><w:trPr><w:gridAfter w:val="0"/><w:wAfter w:w="120" w:type="dxa"/></w:trPr>` +
  `<w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc>` +
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
  // v0.155：禁则三枚（kinsoku/wordWrap/overflowPunct）+ 自动断字总闸 + 文字方向。
  // CT_PPrBase 序：suppressAutoHyphens → kinsoku → wordWrap → overflowPunct → topLinePunct；
  // textDirection 在 jc 之后、textAlignment 之前
  `<w:suppressAutoHyphens w:val="1"/><w:kinsoku w:val="0"/><w:wordWrap w:val="1"/>` +
  `<w:overflowPunct w:val="0"/><w:textDirection w:val="tbRl"/>` +
  `<w:spacing w:beforeAutospacing="1" w:afterAutospacing="0"/>` +
  `</w:pPr><w:r><w:t>属性余量段</w:t></w:r></w:p>` +
  // v0.147：表自身的条件层闸门——w:tblPr 上那一枚 w:tblLook（与样式里那一枚同名同义，
  // 归属不同：这张表自己说的压过样式说的）
  `<w:tbl><w:tblPr><w:tblLook w:val="01E0" w:noHBand="1" w:noVBand="0"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
  `<w:tr><w:tc><w:p><w:r><w:t>闸门表</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
  // v0.155：符号（w:sym）——正文里的**一个字符**（插入 → 符号），char 是十六进制码点、
  // font 是它所在的字体（Wingdings 一族码位落在私有区，离了字体画不出形状）
  `<w:p><w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r></w:p>` +
  // v0.155：下划线颜色三枚（字面色 + 主题槽 + 主题深浅）+ 着重号 + OpenType 字形档四枚
  // + 字形装饰三枚（浮雕/阴文/镂空，屏上不兑现只记账）
  `<w:p><w:r><w:rPr><w:u w:val="single" w:color="FF0000" w:themeColor="accent1" w:themeTint="99"/>` +
  `</w:rPr><w:t>带色的下划线</w:t></w:r>` +
  `<w:r><w:rPr><w:em w:val="dot"/><w:ligatures w:val="standardContextual"/>` +
  `<w:numForm w:val="oldStyle"/><w:numSpacing w:val="proportional"/><w:cntxtalts/>` +
  `<w:emboss/><w:imprint/><w:outline/></w:rPr><w:t>字形档</w:t></w:r></w:p>` +
  // v0.155：链接的悬停提示与打开目标（HTML 的 title/target 正好是这两个含义）
  `<w:p><w:hyperlink r:id="rId9" w:tooltip="悬停提示" w:tgtFrame="blank">` +
  `<w:r><w:t>带提示的链</w:t></w:r></w:hyperlink></w:p>` +
  // v0.155：DrawingML 图形余量一整片——颜色变换（alpha/alphaOff/hueOff/satOff/tint/
  // prstClr/scrgbClr）、线端（prstDash/headEnd/tailEnd）、效果（outerShdw/glow/
  // reflection）、三维（lightRig/props3d）、浮动档位（sizeRelH/sizeRelV/wrapSquare）、
  // 填充开关（blipFill/gradFill 的 rotWithShape 与 flip）、形状锁余下那枚、
  // 自定义几何的路径数据（a:path@path）。屏上一个都不兑现（Web 没有这些模型）
  `<w:p><w:r><w:drawing><wp:anchor><wp:extent cx="914400" cy="914400"/>` +
  `<wp:wrapSquare wrapText="bothSides"/><wp:sizeRelH relativeFrom="page"/>` +
  `<wp:sizeRelV relativeFrom="margin"/><wp:docPr id="11" name="图形余量"/>` +
  `<a:graphic><a:graphicData><pic:pic><pic:nvPicPr><pic:cNvPr id="11" name="图形余量"/>` +
  `<pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>` +
  `<pic:blipFill rotWithShape="1"><a:blip r:embed="rId1"/>` +
  `<a:gradFill flip="xy" rotWithShape="0"><a:gsLst><a:gs pos="0">` +
  `<a:scrgbClr r="1000" g="2000" b="3000"><a:alpha val="50000"/><a:alphaOff val="200"/>` +
  `<a:hueOff val="60000"/><a:satOff val="1000"/><a:tint val="40000"/></a:scrgbClr></a:gs>` +
  `<a:gs pos="100000"><a:prstClr val="red"><a:lumMod val="80000"/></a:prstClr></a:gs>` +
  `</a:gsLst></a:gradFill></pic:blipFill>` +
  // v0.155：a:xfrm 的旋转（六万分之一度）与翻转两枚——这一族**读得进屏上**（CSS transform）
  `<pic:spPr><a:xfrm rot="5400000" flipH="1" flipV="0"/>` +
  `<a:custGeom><a:rect l="0" t="0" r="0" b="0"/><a:pathLst>` +
  `<a:path w="1000" h="1000" path="moveTo(0,0) lnTo(1000,1000)"/></a:pathLst></a:custGeom>` +
  `<a:ln w="9525"><a:prstDash val="dash"/>` +
  `<a:headEnd type="triangle" w="med" len="sm"/><a:tailEnd type="arrow" w="lg" len="lg"/></a:ln>` +
  `<a:effectLst><a:outerShdw algn="tl" blurRad="63500" dir="5400000" dist="38100" rotWithShape="0"/>` +
  `<a:glow rad="63500"><a:schemeClr val="accent1"/></a:glow>` +
  `<a:reflection algn="bl" blurRad="6350" dir="5400000" dist="0" endA="1000" endPos="10000"` +
  ` fadeDir="5400000" kx="0" ky="0" stA="0" stPos="0" sx="100000" sy="100000"/>` +
  `<a:scene3d><a:camera prst="orthographicFront"><a:lightRig rig="threePt" dir="t"/></a:camera>` +
  `<a:backdrop><a:sp3d><a:bevelT w="63500" h="25400"/><a:contourClr>` +
  `<a:schemeClr val="accent2"/></a:contourClr></a:sp3d></a:backdrop></a:scene3d>` +
  // 三维形状属性：真实 schema 叫 a:sp3d，universe 里那一族记的是 props3d——两个名字都放，
  // 读手两个都问（问不到元素不产生账，两个都问比赌一个名字安全）
  `<a:sp3d contourW="12700" extrusionH="25400" prstMaterial="plastic"/>` +
  `<a:props3d contourW="12700" extrusionH="25400" prstMaterial="plastic"/>` +
  `</a:effectLst><a:spLocks noEditPoints="1"/>` +
  `</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>` +
  // v0.155：艺术字变形（a:prstTxWarp）与文字轮廓——形状身上的两支，屏上同样零兑现
  `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/>` +
  `<wp:docPr id="12" name="艺术字"/>` +
  `<a:graphic><a:graphicData><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm/>` +
  `<a:prstTxWarp prst="textArchUp"/></wps:spPr>` +
  `<wps:txbx><w:txbxContent><w:p><w:r><w:t>艺术字</w:t></w:r></w:p></w:txbxContent></wps:txbx>` +
  `<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
  // v0.155：表单域（w:fldChar 里的 w:ffData 一族）与域锁。表单域的结果文字照常渲染，
  // 壳上的名字/启用/退出计算/宏/外观/文本域默认值与上限全族只读记账
  `<w:p><w:r><w:fldChar w:fldCharType="begin" w:fldLock="1"><w:ffData>` +
  `<w:name w:val="Text1"/><w:enabled/><w:calcOnExit w:val="1"/><w:entryMacro w:val=""/>` +
  `<w:appearance w:val="normal"/>` +
  `<w:textInput><w:default w:val="默认"/><w:maxLength w:val="10"/></w:textInput>` +
  `</w:ffData></w:fldChar></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:t>表单里的字</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>` +
  // v0.155：内容控件的 id（w:sdtPr/w:id）与修订的 id（w:ins/@w:id）——两枚身份都只记账
  `<w:sdt><w:sdtPr><w:id w:val="42"/></w:sdtPr><w:sdtContent>` +
  `<w:p><w:r><w:t>控件里的字</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
  `<w:p><w:ins w:id="7" w:author="张三" w:date="2026-10-26T00:00:00Z">` +
  `<w:r><w:t>插入的字</w:t></w:r></w:ins></w:p>` +
  // v0.152：页眉页脚引用两族（sectPr 打头的位置——CT_SectPr 序 headerReference/
  // footerReference 排在最前）。只读记账：id 是关系 id 写侧发包自己重编，type
  // （default/first/even）我们只发 default 一档
  `<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/><w:footerReference w:type="default" r:id="rIdFtr"/>` +
  // v0.155：节余量七枚——节的起法（type）、纸型档位号（pgSz/@w:code）、页码型别与
  // 起始值（pgNumType）、逐栏表（cols/@equalWidth 与 col 两枚）、装订线在右（rtlGutter）、
  // 窗体保护（formProt）。全是「说了也不改屏上排版」的元信息，只读记账
  `<w:type w:val="continuous"/>` +
  `<w:pgSz w:w="11906" w:h="16838" w:orient="portrait" w:code="9"/>` +
  `<w:pgNumType w:fmt="lowerRoman" w:start="3"/>` +
  `<w:rtlGutter w:val="1"/><w:formProt w:val="1"/>` +
  `<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/>` +
  // v0.147：节属性余下两族——分栏（w:cols）与文档网格（w:docGrid）。纸型与页边距
  // 那两枚早就在夹具里（读手原先不读其中的 top/bottom/header/footer/gutter/orient）
  // v0.152：docGrid 再加 charSpace（每字符网格宽度，缇）——与 linePitch 同住一枚
  // 元素上的第三枚，读写（包的 grid.charSpace 是原生槽）
  `<w:cols w:num="2" w:space="720" w:equalWidth="0">` +
  `<w:col w:w="2000" w:space="400"/><w:col w:w="3000" w:space="400"/></w:cols>` +
  `<w:docGrid w:type="lines" w:linePitch="312" w:charSpace="200"/></w:sectPr>` +
  `</w:body></w:document>`

// 读手按名查问过的（源码里 spacing / ind / jc / pStyle / rFonts / sz / b / 顶边 都走 attr 或 attrL）

// 夹具包的部件表：路径 → 内容。zip 装配与往返账共用这一份，
// 免得一边改了部件、另一边还按老清单读。
export function fixtureParts() {
  const parts = new Map()
  parts.set('word/document.xml', FIXTURE_DOC)
  parts.set('word/styles.xml', FIXTURE_STYLES)
  parts.set('word/theme/theme1.xml', FIXTURE_THEME)
  parts.set('word/numbering.xml', FIXTURE_NUMBERING)
  // v0.145：图片段的关系与媒体目标（docPr/cNvPr 的 descr 靠这条链读出来）
  // v0.152：hyperlink 的 rId9 与页眉页脚引用的 rIdHdr/rIdFtr（读手只按名查问不解析）
  parts.set(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
      `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>` +
      `<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>` +
      `<Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
      `</Relationships>`,
  )
  parts.set('word/media/image1.png', Buffer.from(PNG_B64, 'base64'))
  // v0.154：批注两份部件——w:comment 的四枚（id/author/date/initials）与两份部件根
  // 上的 mc:Ignorable，外加 commentsExtended 里 w15:commentEx 的 paraId 与 done
  // （done="1" 的那条批注在模型里标 resolved）。保真路径由读手走 attr 漏斗读
  parts.set(
    'word/comments.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="${W}" xmlns:w14="${W14}" xmlns:mc="${MC}" mc:Ignorable="w14">` +
      `<w:comment w:id="1" w:author="张三" w:initials="ZS" w:date="2026-10-25T10:00:00Z">` +
      `<w:p w14:paraId="0F1E2D3C"><w:r><w:t>这条批注</w:t></w:r></w:p></w:comment>` +
      `</w:comments>`,
  )
  parts.set(
    'word/commentsExtended.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w15:commentsEx xmlns:w15="${W15}" xmlns:mc="${MC}" mc:Ignorable="w15">` +
      `<w15:commentEx w15:paraId="0F1E2D3C" w15:done="1"/>` +
      // v0.155：创建会话号（w15:creationId/@w15:id）——这条批注是哪一次编辑会话建的
      `<w15:creationId w15:id="00000001"/>` +
      `</w15:commentsEx>`,
  )
  // v0.154：脚注与尾注部件根上的 mc:Ignorable（v0.152 收的 numbering/styles 那两枚的
  // 第三、四处）。两个部件都是空的——这里要的只是根上那一枚属性被按名查问
  parts.set(
    'word/footnotes.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:footnotes xmlns:w="${W}" xmlns:mc="${MC}" mc:Ignorable="w14"></w:footnotes>`,
  )
  parts.set(
    'word/endnotes.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:endnotes xmlns:w="${W}" xmlns:mc="${MC}" mc:Ignorable="w14"></w:endnotes>`,
  )
  return parts
}

