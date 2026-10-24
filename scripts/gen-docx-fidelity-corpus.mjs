#!/usr/bin/env node
/**
 * 合成 docx 语料生成器 —— fidelity 覆盖率量具在「真件语料不在盘」时的复跑底座。
 *
 * 为什么需要它：docs/fidelity.json 那一跑用的是 313 件真件（D:/docs），那批件不在盘。
 * 但量具要真件才跑得起来（分子是运行时探针、分母是全树普查）。于是把旧跑见过的全部
 * 「元素|属性」对冻结成 docs/fidelity-universe.json（提交进库），本脚本按它重建一份
 * 合成语料：每一对都放在读手（docx-fidelity.ts）真会走过的上下文里，次数按旧计数
 * 均匀缩放（/100，下限 1）。
 *
 * 三条设计判据（都是实测出来的，不是想当然）：
 *   1. 分母与读手走哪无关——fidelity-report.mjs 的分母是用自家解析器对部件全树数的，
 *      所以放置只影响分子（读手的路踩不踩得到），不影响分母。
 *   2. 分子是「查问过没有」（seen.has），不是次数——所以每对在正确上下文出现一次即可
 *      进分子；次数只服务按字面加权。
 *   3. 读手的查问有真实的上下文不对称（top|space 读、left|space 不读；pgSz|w 读、
 *      pgSz|orient 不读；blip|embed 读、blip|cstate 现今零路径），这些不对称必须靠
 *      「放在真上下文里」复现，不能靠均匀撒。
 *
 * 缩放口径与诚实标注：scaled = max(1, round(count/100))。按对覆盖率不受缩放影响；
 * 按字面覆盖率与旧值同权重结构，偏差约 0.9%（取整所致），fidelity.md 的出处节如实写。
 * 幂等：宇宙冻结在库里，同一份宇宙永远生成同一份语料（内容确定、顺序确定）。
 *
 * 已知的计数噪声（按字面口径，合计 <0.2%，按对口径为零）：
 *   - 容器属性在包裹处顺带出现（如每个 v:shape 实例自带一枚 v:imagedata，
 *     使 imagedata|id 的字面数高于其自身缩放值）——为了让读手的 bitmap() 短路链
 *     （blip→rid→rel→media）真的走通，shape|style / extent|cx / docPr|name 这些
 *     「要媒体在场才被查问」的对必须挂在带图的结构上。
 *   - 部件根上的 mc:Ignorable 每个文件一枚（旧计数缩放后 1~2 枚）。
 *
 * 用法：node scripts/gen-docx-fidelity-corpus.mjs
 * 产出：tmp/docx-fidelity-corpus/*.docx + clist.txt（一行一枚绝对路径）
 */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const REPO = path.resolve(import.meta.dirname, '..')
const OUT_DIR = path.resolve(REPO, 'tmp/docx-fidelity-corpus')
const uni = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/fidelity-universe.json'), 'utf8'))

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  w10: 'urn:schemas-microsoft-com:office:word',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  omml: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
}

// 媒体件：rels 指向它，让读手的 mediaOf() 真的取到字节，
// extent|cx/cy 与 docPr|name 才走得到查问（bitmap() 的短路链：blip→rid→rel→media）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// ── 承放上下文：open/close 包裹若干副本；key 唯一 ───────────────────────────
// PIC_PRE 只留 bitmap() 真读的三样：a:blip 的 r:embed（短路链入口）、wp:extent 的
// cx/cy、wp:docPr 的 name。其余属性（cstate/srcRect/effectExtent/rotWithShape/
// picLocks/bwMode/cNvPr/inline dist*）全部剥掉——它们要么读手零路径，要么由 PLACE
// 条目在合法位置另发，留在包裹串里只会把 census 分母每枚多算一遍
const PIC_PRE =
  `<w:p><w:r><w:drawing><wp:inline>` +
  `<wp:extent cx="914400" cy="914400"/>` +
  `<wp:docPr id="1" name="图片 1"/><wp:cNvGraphicFramePr><a:graphicFrameLocks/></wp:cNvGraphicFramePr>` +
  `<a:graphic><a:graphicData><pic:pic>` +
  `<pic:nvPicPr><pic:cNvPr/><pic:cNvPicPr><a:picLocks/></pic:cNvPicPr></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill>` +
  `<pic:spPr>`
const PIC_POST = `</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
// 表格包裹常量：TBL_HEAD 开表（带网格），ROW_OPEN/ROW_CLOSE 开闭一行一单元格，
// CELL_BODY 是格内段落，TBL_CLOSE 闭表。早先 TBL_OPEN 里带 <w:tbl>，嵌进
// <w:tbl><w:tblPr> 的 close 串会开出嵌套表，XML 当场撕裂
const TBL_HEAD = '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>'
const ROW_OPEN = '<w:tr><w:tc>'
const ROW_CLOSE = '</w:tc></w:tr>'
const CELL_BODY = '<w:p><w:r><w:t>x</w:t></w:r></w:p>'
const TBL_CLOSE = '</w:tbl>'
// 常用组合：tblPr 系上下文的收尾 = 闭容器 + 补一个最小合法行列 + 闭表
const TBL_TAIL = `${ROW_OPEN}${CELL_BODY}${ROW_CLOSE}${TBL_CLOSE}`

const CTX = {
  // ── 01-body：正文流 ──
  'b0': { f: '01-body', part: 'document', open: '', close: '' },
  'b:rpr': { f: '01-body', part: 'document', open: '<w:p><w:r><w:rPr>', close: '</w:rPr><w:t>文</w:t></w:r></w:p>' },
  'b:ppr': { f: '01-body', part: 'document', open: '<w:p><w:pPr>', close: '</w:pPr><w:r><w:t>文</w:t></w:r></w:p>' },
  // v0.142：组合 shd 专用段——b:ppr 那条 open 会被几百个单属性实例合并进同一个 pPr，
  // 而读手 find(pPr,'w:shd') 只取第一枚，组合实例排在末尾就永远踩不到。换个 open
  // （keepNext 在 schema 序里位于 shd 之前，合法且读手不查问它）让组合实例独占一个段落。
  'b:ppr-shd': { f: '01-body', part: 'document', open: '<w:p><w:pPr><w:keepNext w:val="1"/>', close: '</w:pPr><w:r><w:t>纹</w:t></w:r></w:p>' },
  'b:run': { f: '01-body', part: 'document', open: '<w:p><w:r>', close: '</w:r></w:p>' },
  // v0.146：书签区间专用段——bookmarkStart/End 属 EG_RangeMarkupElements，只有进到
  // 段落内容里才走 inline() 的 visit()；b0 是正文流直子上，块层分发根本不碰它，
  // 三对会凭空掉出分子。段内不放 run：书签区间可以为空（起终点相邻），
  // 读者照读 id/name（空区间不产 span，是记账内的已知边界）
  'b:para': { f: '01-body', part: 'document', open: '<w:p>', close: '</w:p>' },
  'b:numpr': { f: '01-body', part: 'document', open: '<w:p><w:pPr><w:numPr>', close: '</w:numPr></w:pPr><w:r><w:t>文</w:t></w:r></w:p>' },
  'b:pbdr': { f: '01-body', part: 'document', open: '<w:p><w:pPr><w:pBdr>', close: '</w:pBdr></w:pPr><w:r><w:t>文</w:t></w:r></w:p>' },
  'b:tabs': { f: '01-body', part: 'document', open: '<w:p><w:pPr><w:tabs>', close: '</w:tabs></w:pPr><w:r><w:t>文</w:t></w:r></w:p>' },
  // OMML 必须不带前缀（默认命名空间）：读手的 findL(dPr,'begChr') 按全名精确匹配，
  // 带 m: 前缀就找不到，begChr|val / endChr|val 这两对会凭空掉出分子
  'b:omml': {
    f: '01-body',
    part: 'document',
    open: `<w:p><w:r><oMath xmlns="${NS.omml}"><d><dPr>`,
    close: '</dPr><e><r><t>x</t></r></e></d></oMath></w:r></w:p>',
  },
  // ── 02-tables：表格与节属性 ──
  // sectPr 必须排在文件最前：contentTwipsOf() 用 findDesc 找 body 的第一个 sectPr 读
  // pgSz|w 与 pgMar|left/right，空 sectPr 打头会让这三对掉出分子
  't:sect': { f: '02-tables', part: 'document', open: '<w:sectPr w:rsidR="00A1" w:rsidRPr="00A2" w:rsidSect="00000001">', close: '</w:sectPr>' },
  't:cols-kids': { f: '02-tables', part: 'document', open: '<w:sectPr><w:cols>', close: '</w:cols></w:sectPr>' },
  't:cols': { f: '02-tables', part: 'document', open: '<w:sectPr>', close: '</w:sectPr>' },
  't:tblPr': { f: '02-tables', part: 'document', open: '<w:tbl><w:tblPr>', close: `</w:tblPr>${TBL_TAIL}` },
  't:borders': { f: '02-tables', part: 'document', open: '<w:tbl><w:tblPr><w:tblBorders>', close: `</w:tblBorders></w:tblPr>${TBL_TAIL}` },
  't:cellmar': { f: '02-tables', part: 'document', open: '<w:tbl><w:tblPr><w:tblCellMar>', close: `</w:tblCellMar></w:tblPr>${TBL_TAIL}` },
  't:grid': { f: '02-tables', part: 'document', open: '<w:tbl><w:tblGrid>', close: `</w:tblGrid>${TBL_TAIL}` },
  't:tr': { f: '02-tables', part: 'document', open: `${TBL_HEAD}<w:tr>`, close: `</w:tr>${TBL_CLOSE}` },
  't:trPr': { f: '02-tables', part: 'document', open: `${TBL_HEAD}<w:tr><w:trPr>`, close: `</w:trPr></w:tr>${TBL_CLOSE}` },
  't:tcPr': { f: '02-tables', part: 'document', open: `${TBL_HEAD}<w:tr><w:tc><w:tcPr>`, close: `</w:tcPr>${CELL_BODY}${ROW_CLOSE}${TBL_CLOSE}` },
  // v0.142：tcPr 侧的组合 shd 专用段，同 b:ppr-shd 的道理（tcW 在 schema 序里位于 shd 之前）
  't:tcPr-shd': { f: '02-tables', part: 'document', open: `${TBL_HEAD}<w:tr><w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>`, close: `</w:tcPr>${CELL_BODY}${ROW_CLOSE}${TBL_CLOSE}` },
  't:tcborders': { f: '02-tables', part: 'document', open: `${TBL_HEAD}<w:tr><w:tc><w:tcPr><w:tcBorders>`, close: `</w:tcBorders></w:tcPr>${CELL_BODY}${ROW_CLOSE}${TBL_CLOSE}` },
  't:tcmar': { f: '02-tables', part: 'document', open: `${TBL_HEAD}<w:tr><w:tc><w:tcPr><w:tcMar>`, close: `</w:tcMar></w:tcPr>${CELL_BODY}${ROW_CLOSE}${TBL_CLOSE}` },
  't:b0': { f: '02-tables', part: 'document', open: '', close: '' },
  // 00-base 的正文只有这一张表：它引用 styles 里的 TableCond，让读手走到
  // styleCondCells（w:tblStylePr 的 w:type 与条件行高 w:trHeight 的 val/hRule
  // 三处查问全在那条路上，没有引用就一对都踩不到）
  'd0:tbl': {
    f: '00-base',
    part: 'document',
    open:
      '<w:tbl><w:tblPr><w:tblStyle w:val="TableCond"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>',
    close: '</w:tc></w:tr></w:tbl>',
  },
  // ── 03-drawings：DrawingML ──
  // 图片的位图层与容器层分开承放：d:inline 只装 wp:inline / wp:anchor 本身（属性在开标签
  // 上，父是 w:drawing，层位合法），而 extent / effectExtent / docPr 是 wp:inline 的直子，
  // 得进到 inline 里面才合法——d:wp 这一段就是为此另开的。
  // **close 里必须带 blip**：bitmap() 的短路链是 blip→rid→rel→media，找不到 blip 就在
  // 第一步返回 null，整段连 readImgPayload 都不会被调用，effectExtent 四边会凭空掉出
  // 分子（v0.148 实测过：光把承放挪进 d:inline 是不够的）。骨架元素一律不带属性——
  // 带一枚就给 census 分母多算一份（唯一例外的 a:blip r:embed 是这条链必需的）
  'd:inline': { f: '03-drawings', part: 'document', open: '<w:p><w:r><w:drawing>', close: '</w:drawing></w:r></w:p>' },
  'd:wp': {
    f: '03-drawings',
    part: 'document',
    open: '<w:p><w:r><w:drawing><wp:inline>',
    close:
      '<wp:docPr/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr/><pic:cNvPicPr><a:picLocks/></pic:cNvPicPr></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill><pic:spPr/>' +
      '</pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></w:r></w:p>',
  },
  'd:anchor-kids': {
    f: '03-drawings',
    part: 'document',
    open:
      '<w:p><w:r><w:drawing><wp:anchor>' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"/><wp:positionV relativeFrom="page"/>' +
      '<wp:extent cx="914400" cy="914400"/><wp:wrapSquare wrapText="bothSides"/>' +
      '<wp:sizeRelH relativeFrom="page"/><wp:sizeRelV relativeFrom="page"/><wp:docPr id="1" name="图片 1"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      `<a:graphic><a:graphicData><pic:pic>` +
      `<pic:nvPicPr><pic:cNvPr id="1" name="图片 1"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>` +
      `<pic:blipFill rotWithShape="1"><a:blip r:embed="rId2"/></pic:blipFill><pic:spPr bwMode="auto">`,
    close: `</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`,
  },
  'd:pic': { f: '03-drawings', part: 'document', open: `${PIC_PRE}`, close: PIC_POST },
  'd:xfrm': { f: '03-drawings', part: 'document', open: `${PIC_PRE}<a:xfrm rot="0" flipH="0" flipV="0">`, close: `</a:xfrm>${PIC_POST}` },
  'd:clr': { f: '03-drawings', part: 'document', open: `${PIC_PRE}<a:solidFill><a:schemeClr val="accent1">`, close: `</a:schemeClr></a:solidFill>${PIC_POST}` },
  'd:clr2': { f: '03-drawings', part: 'document', open: `${PIC_PRE}<a:solidFill>`, close: `</a:solidFill>${PIC_POST}` },
  'd:gs': { f: '03-drawings', part: 'document', open: `${PIC_PRE}<a:gradFill flip="none" rotWithShape="0"><a:gsLst>`, close: `</a:gsLst></a:gradFill>${PIC_POST}` },
  'd:ln': { f: '03-drawings', part: 'document', open: `${PIC_PRE}<a:ln w="9525" cap="flat" cmpd="sng">`, close: `</a:ln>${PIC_POST}` },
  'd:fx': { f: '03-drawings', part: 'document', open: `${PIC_PRE}<a:effectLst>`, close: `</a:effectLst>${PIC_POST}` },
  'd:scene': { f: '03-drawings', part: 'document', open: `${PIC_PRE}<a:effectLst><a:scene3d>`, close: `</a:scene3d></a:effectLst>${PIC_POST}` },
  'd:wps': {
    f: '03-drawings',
    part: 'document',
    open:
      '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/>' +
      '<wp:docPr id="1" name="形状 1"/><wp:cNvGraphicFramePr/>' +
      `<a:graphic><a:graphicData><wps:wsp>` +
      '<a:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>' +
      '<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></a:style>' +
      '<wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm/></wps:spPr><wps:txBody>',
    close: '<a:p/><a:endParaRPr/></wps:txBody></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
  },
  'd:bodypr': {
    f: '03-drawings',
    part: 'document',
    open:
      '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/>' +
      '<wp:docPr id="1" name="形状 1"/><wp:cNvGraphicFramePr/>' +
      `<a:graphic><a:graphicData><wps:wsp>` +
      '<wps:cNvSpPr/><wps:spPr><a:xfrm/></wps:spPr><wps:txBody>',
    close: '<a:p/><a:endParaRPr/></wps:txBody></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
  },
  // ── 04-vml：VML 与遗留件 ──
  'v:pict': { f: '04-vml', part: 'document', open: '<w:p><w:r><w:pict>', close: '<v:imagedata r:id="rId3"/></w:pict></w:r></w:p>' },
  // shape 的每枚属性都自带一枚 imagedata：bitmap() 找不到 blip/imagedata 就整体 return，
  // shape|style 这一对会凭空掉出分子（旧账 995 已查问）
  'v:shape-attr': { f: '04-vml', part: 'document', open: '<w:p><w:r><w:pict>', close: '<v:imagedata r:id="rId3"/></w:pict></w:r></w:p>' },
  'v:main': {
    f: '04-vml',
    part: 'document',
    open:
      '<w:p><w:r><w:pict><v:shape id="_x0000_s1026" type="#_x0000_t75" style="width:100pt;height:50pt" fillcolor="#ffc0cb" filled="t" stroked="f" strokecolor="#000080" strokeweight="1pt"><v:imagedata r:id="rId3"/>',
    close: '</v:shape></w:pict></w:r></w:p>',
  },
  'v:fill': {
    f: '04-vml',
    part: 'document',
    open: '<w:p><w:r><w:pict><v:shape><v:fill on="t" type="solid">',
    close: '</v:fill></v:shape></w:pict></w:r></w:p>',
  },
  'v:stroke': {
    f: '04-vml',
    part: 'document',
    open: '<w:p><w:r><w:pict><v:shape><v:stroke on="t" color="#000080" weight="1pt">',
    close: '</v:stroke></v:shape></w:pict></w:r></w:p>',
  },
  'v:path': {
    f: '04-vml',
    part: 'document',
    open: '<w:p><w:r><w:pict><v:shape><v:path w="1000" h="1000">',
    close: '</v:path></v:shape></w:pict></w:r></w:p>',
  },
  'v:formulas': {
    f: '04-vml',
    part: 'document',
    open: '<w:p><w:r><w:pict><v:shape><v:formulas>',
    close: '</v:formulas></v:shape></w:pict></w:r></w:p>',
  },
  'v:handles': {
    f: '04-vml',
    part: 'document',
    open: '<w:p><w:r><w:pict><v:shape><v:handles>',
    close: '</v:handles></v:shape></w:pict></w:r></w:p>',
  },
  'v:group': {
    f: '04-vml',
    part: 'document',
    open: '<w:p><w:r><w:pict><v:group id="" coordorigin="0,0" coordsize="1000,1000" editas="canvas" style="">',
    close: '</v:group></w:pict></w:r></w:p>',
  },
  'v:object': { f: '04-vml', part: 'document', open: '<w:p><w:r><w:object>', close: '</w:object></w:r></w:p>' },
  'v:object-run': { f: '04-vml', part: 'document', open: '<w:p><w:r>', close: '</w:r></w:p>' },
  'v:ffdata': {
    f: '04-vml',
    part: 'document',
    open: '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData>',
    close: '</w:ffData></w:fldChar></w:r></w:p>',
  },
  'v:textinput': {
    f: '04-vml',
    part: 'document',
    open: '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:textInput>',
    close: '</w:textInput></w:ffData></w:fldChar></w:r></w:p>',
  },
}

// 元素前缀默认 w:；VML/DrawingML 家族自带前缀且属性不带前缀（bare）
const P = { v: 'v:', o: 'o:', w10: 'w10:', wp: 'wp:', a: 'a:', pic: 'pic:', wps: 'wps:', w15: 'w15:' }

// 部件级上下文（根元素自带 mc:Ignorable 等；root: true 的负责开闭整个部件）
const PART_CTX = {
  's:root': { f: '00-base', part: 'styles', root: true, open: `<w:styles xmlns:w="${NS.w}" xmlns:mc="${NS.mc}" mc:Ignorable="w14">`, close: '</w:styles>' },
  's:latent': { f: '00-base', part: 'styles', open: '<w:latentStyles count="376" defLockedState="0" defQFormat="0" defSemiHidden="0" defUIPriority="999" defUnhideWhenUsed="0">', close: '</w:latentStyles>' },
  's:style-kids': { f: '00-base', part: 'styles', open: '<w:style w:type="paragraph" w:styleId="a"><w:name w:val="a"/>', close: '</w:style>' },
  's:style-rpr': { f: '00-base', part: 'styles', open: '<w:style w:type="paragraph" w:styleId="a"><w:name w:val="a"/><w:rPr>', close: '</w:rPr></w:style>' },
  // 样式级 pPr：读手只从 w:style 的 pPr 认 outlineLvl（正文段落自己那枚不查），
  // 放在 b:ppr 里等于凭空掉出分子
  's:style-ppr': { f: '00-base', part: 'styles', open: '<w:style w:type="paragraph" w:styleId="a"><w:name w:val="a"/><w:pPr>', close: '</w:pPr></w:style>' },
  // 表格样式的条件块（w:tblStylePr）：由 d0:tbl 那张表引用后才会被读
  's:table-cond': { f: '00-base', part: 'styles', open: '<w:style w:type="table" w:styleId="TableCond"><w:name w:val="Table Cond"/>', close: '</w:style>' },
  's:style-attrs': { f: '00-base', part: 'styles', open: '', close: '' },
  'n:root': { f: '00-base', part: 'numbering', root: true, open: `<w:numbering xmlns:w="${NS.w}" xmlns:mc="${NS.mc}" mc:Ignorable="w14">`, close: '</w:numbering>' },
  'n:b0': { f: '00-base', part: 'numbering', open: '', close: '' },
  'n:abstract-attrs': { f: '00-base', part: 'numbering', open: '', close: '' },
  'n:abstract-kids': { f: '00-base', part: 'numbering', open: '<w:abstractNum w:abstractNumId="0">', close: '</w:abstractNum>' },
  'n:lvl-attrs': { f: '00-base', part: 'numbering', open: '<w:abstractNum w:abstractNumId="0">', close: '</w:abstractNum>' },
  'n:lvl-kids': { f: '00-base', part: 'numbering', open: '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">', close: '</w:lvl></w:abstractNum>' },
  'n:lvl-rpr': { f: '00-base', part: 'numbering', open: '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:rPr>', close: '</w:rPr></w:lvl></w:abstractNum>' },
  'n:num-attrs': { f: '00-base', part: 'numbering', open: '', close: '' },
  'n:num-kids': { f: '00-base', part: 'numbering', open: '<w:num w:numId="1">', close: '</w:num>' },
  'fn:root': { f: '00-base', part: 'footnotes', root: true, open: `<w:footnotes xmlns:w="${NS.w}" xmlns:mc="${NS.mc}" mc:Ignorable="w14">`, close: '</w:footnotes>' },
  'fn:footnote-attrs': { f: '00-base', part: 'footnotes', open: '', close: '' },
  'fn:footnote': { f: '00-base', part: 'footnotes', open: '<w:footnote w:id="1">', close: '</w:footnote>' },
  'en:root': { f: '00-base', part: 'endnotes', root: true, open: `<w:endnotes xmlns:w="${NS.w}" xmlns:mc="${NS.mc}" mc:Ignorable="w14">`, close: '</w:endnotes>' },
  'en:endnote-attrs': { f: '00-base', part: 'endnotes', open: '', close: '' },
  'en:endnote': { f: '00-base', part: 'endnotes', open: '<w:endnote w:id="1">', close: '</w:endnote>' },
  'cm:root': { f: '00-base', part: 'comments', root: true, open: `<w:comments xmlns:w="${NS.w}" xmlns:mc="${NS.mc}" mc:Ignorable="w14">`, close: '</w:comments>' },
  'cm:comment-attrs': { f: '00-base', part: 'comments', open: '', close: '' },
  'cm:comment': { f: '00-base', part: 'comments', open: '<w:comment w:id="1">', close: '</w:comment>' },
  'cx:root': { f: '00-base', part: 'commentsExtended', root: true, open: `<w15:commentsEx xmlns:w15="${NS.w15}" xmlns:mc="${NS.mc}" mc:Ignorable="w14">`, close: '</w15:commentsEx>' },
  'cx:b0': { f: '00-base', part: 'commentsExtended', open: '', close: '' },
  'noop': { f: 'ALL', part: 'document', open: '', close: '' },
}

// 每文件里 document.xml 上下文的出场顺序（sectPr 打头，见 CTX['t:sect'] 注）
const ORDER = {
  '00-base': ['d0:tbl'],
  '01-body': ['b0', 'b:rpr', 'b:ppr', 'b:run', 'b:numpr', 'b:pbdr', 'b:tabs', 'b:omml', 'b:para'],
  '02-tables': ['t:sect', 't:cols-kids', 't:cols', 't:tblPr', 't:borders', 't:cellmar', 't:grid', 't:tr', 't:trPr', 't:tcPr', 't:tcborders', 't:tcmar', 't:b0'],
  '03-drawings': ['d:inline', 'd:wp', 'd:anchor-kids', 'd:pic', 'd:xfrm', 'd:clr', 'd:clr2', 'd:gs', 'd:ln', 'd:fx', 'd:scene', 'd:wps', 'd:bodypr'],
  '04-vml': ['v:pict', 'v:shape-attr', 'v:main', 'v:fill', 'v:stroke', 'v:path', 'v:formulas', 'v:handles', 'v:group', 'v:object', 'v:object-run', 'v:ffdata', 'v:textinput'],
  styles: ['s:latent', 's:style-attrs', 's:style-kids', 's:style-rpr'],
  numbering: ['n:b0', 'n:abstract-attrs', 'n:abstract-kids', 'n:lvl-attrs', 'n:lvl-kids', 'n:lvl-rpr', 'n:num-attrs', 'n:num-kids'],
  footnotes: ['fn:footnote-attrs', 'fn:footnote'],
  endnotes: ['en:endnote-attrs', 'en:endnote'],
  comments: ['cm:comment-attrs', 'cm:comment'],
  commentsExtended: ['cx:b0'],
}

// ── 承放表：元素 → 承放处数组 ──────────────────────────────────────────────
// spot: { c, p?, bare?, av, ap? }   av: 属性名 → 值；ap: 属性名前缀覆盖
const PLACE = {
  // ── rPr 族 ──
  rFonts: [
    { c: 'b:rpr', av: { ascii: 'Times New Roman', hAnsi: 'Arial', eastAsia: '宋体', cs: 'Courier New', hint: 'eastAsia', asciiTheme: 'minorHAnsi', hAnsiTheme: 'minorHAnsi', eastAsiaTheme: 'minorEastAsia', cstheme: 'minorBidi' } },
    // 主题引用在 styles 的 Normal 与 numbering 的 lvl 里也各落一处：applyThemeFonts 三棵树都走
    { c: 's:style-rpr', av: { ascii: 'Times New Roman', hAnsi: 'Arial', eastAsia: '宋体', cs: 'Courier New', hint: 'eastAsia', asciiTheme: 'minorHAnsi', hAnsiTheme: 'minorHAnsi', eastAsiaTheme: 'minorEastAsia', cstheme: 'minorBidi' } },
    { c: 'n:lvl-rpr', av: { ascii: 'Times New Roman', hAnsi: 'Arial', eastAsia: '宋体', cs: 'Courier New', hint: 'eastAsia', asciiTheme: 'minorHAnsi', hAnsiTheme: 'minorHAnsi', eastAsiaTheme: 'minorEastAsia', cstheme: 'minorBidi' } },
  ],
  b: [{ c: 'b:rpr', av: { val: '1' } }],
  bCs: [{ c: 'b:rpr', av: { val: '1' } }],
  i: [{ c: 'b:rpr', av: { val: '1' } }],
  iCs: [{ c: 'b:rpr', av: { val: '1' } }],
  caps: [{ c: 'b:rpr', av: { val: '1' } }],
  smallCaps: [{ c: 'b:rpr', av: { val: '1' } }],
  strike: [{ c: 'b:rpr', av: { val: '1' } }],
  dstrike: [{ c: 'b:rpr', av: { val: '1' } }],
  outline: [{ c: 'b:rpr', av: { val: '1' } }],
  shadow: [{ c: 'b:rpr', av: { val: '1' } }],
  emboss: [{ c: 'b:rpr', av: { val: '1' } }],
  imprint: [{ c: 'b:rpr', av: { val: '1' } }],
  vanish: [{ c: 'b:rpr', av: { val: '1' } }],
  color: [{ c: 'b:rpr', av: { val: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } }],
  spacing: [
    { c: 'b:rpr', av: { val: '20' } }, // rPr 字符间距（readRPr 的 valNum 走这条）
    { c: 'b:ppr', av: { before: '120', after: '240', beforeLines: '240', afterLines: '240', line: '276', lineRule: 'auto', beforeAutospacing: '0', afterAutospacing: '0' } },
  ],
  w: [{ c: 'b:rpr', av: { val: '10' } }],
  kern: [{ c: 'b:rpr', av: { val: '2' } }],
  position: [{ c: 'b:rpr', av: { val: '12' } }],
  sz: [{ c: 'b:rpr', av: { val: '24' } }],
  szCs: [{ c: 'b:rpr', av: { val: '24' } }],
  highlight: [{ c: 'b:rpr', av: { val: 'yellow' } }],
  u: [{ c: 'b:rpr', av: { val: 'single', color: 'FF0000', themeColor: 'accent1', themeTint: '99' } }],
  bdr: [{ c: 'b:rpr', av: { val: 'single', sz: '4', space: '1', color: 'FF0000' } }],
  vertAlign: [{ c: 'b:rpr', av: { val: 'superscript' } }],
  lang: [{ c: 'b:rpr', av: { val: 'en-US', eastAsia: 'zh-CN', bidi: 'ar-SA' } }],
  em: [{ c: 'b:rpr', av: { val: 'dot' } }],
  ligatures: [{ c: 'b:rpr', av: { val: 'standard' } }],
  numSpacing: [{ c: 'b:rpr', av: { val: '20' } }],
  cntxtalts: [{ c: 'b:rpr', av: { val: '1' } }],
  rStyle: [{ c: 'b:rpr', av: { val: 'a3' } }],
  // shd 五上下文（paraBorderSig / cellStyleCss / shadingHex 几条路都铺）
  shd: [
    // v0.142：pPr 上下文改成非 clear 档的字面图案（前景 FF0000/背景 FFFFFF，无 themeFill）——
    // clear+themeFill 那支只走 themeRefCss 的主引用，`??` 右侧的字面 color 不求值，
    // 普查腿就永远踩不到 shd|color；这里补上图案档让两支都在合成语料里真实发生。
    { c: 'b:ppr', av: { val: 'pct25', color: 'FF0000', fill: 'FFFFFF' } },
    { c: 'b:rpr', av: { val: 'clear', color: 'auto', fill: 'FFE699', themeFill: 'accent1', themeFillShade: 'BF', themeFillTint: '99' } },
    { c: 't:tcPr', av: { val: 'clear', color: 'auto', fill: 'FFE699', themeFill: 'accent1', themeFillShade: 'BF', themeFillTint: '99' } },
    { c: 't:tblPr', av: { val: 'clear', color: 'auto', fill: 'FFE699', themeFill: 'accent1', themeFillShade: 'BF', themeFillTint: '99' } },
  ],
  snapToGrid: [
    { c: 'b:ppr', av: { val: '1' } },
    { c: 'b:rpr', av: { val: '1' } },
  ],
  // ── pPr 族 ──
  pStyle: [{ c: 'b:ppr', av: { val: 'a' } }],
  keepNext: [{ c: 'b:ppr', av: { val: '1' } }],
  keepLines: [{ c: 'b:ppr', av: { val: '1' } }],
  pageBreakBefore: [{ c: 'b:ppr', av: { val: '1' } }],
  widowControl: [{ c: 'b:ppr', av: { val: '1' } }],
  suppressLineNumbers: [{ c: 'b:ppr', av: { val: '1' } }],
  kinsoku: [{ c: 'b:ppr', av: { val: '1' } }],
  wordWrap: [{ c: 'b:ppr', av: { val: '1' } }],
  overflowPunct: [{ c: 'b:ppr', av: { val: '1' } }],
  topLinePunct: [{ c: 'b:ppr', av: { val: '1' } }],
  autoSpaceDE: [{ c: 'b:ppr', av: { val: '1' } }],
  autoSpaceDN: [{ c: 'b:ppr', av: { val: '1' } }],
  bidi: [{ c: 'b:ppr', av: { val: '1' } }],
  adjustRightInd: [{ c: 'b:ppr', av: { val: '1' } }],
  jc: [{ c: 'b:ppr', av: { val: 'both' } }],
  textDirection: [
    { c: 'b:ppr', av: { val: 'tbRl' } },
    { c: 't:tcPr', av: { val: 'tbRl' } },
  ],
  textAlignment: [{ c: 'b:ppr', av: { val: 'center' } }],
  outlineLvl: [{ c: 's:style-ppr', av: { val: '1' } }],
  ind: [{ c: 'b:ppr', av: { left: '420', leftChars: '200', right: '210', rightChars: '100', firstLine: '240', firstLineChars: '200', hanging: '240', hangingChars: '200' } }],
  framePr: [{ c: 'b:ppr', av: { anchorLock: '0', h: '1', hAnchor: 'page', hRule: 'exact', hSpace: '12', vAnchor: 'text', vSpace: '12', w: '100', wrap: 'around', x: '10', xAlign: 'center', y: '10', yAlign: 'top' } }],
  ilvl: [{ c: 'b:numpr', av: { val: '0' } }],
  numId: [{ c: 'b:numpr', av: { val: '1' } }],
  tab: [{ c: 'b:tabs', av: { val: 'left', pos: '720', leader: 'dot' } }],
  // 段落边框四边 + between + bar
  top: [
    { c: 'b:pbdr', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:borders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:tcborders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:cellmar', av: { w: '108', type: 'dxa' } },
    { c: 't:tcmar', av: { w: '108', type: 'dxa' } },
  ],
  bottom: [
    { c: 'b:pbdr', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:borders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:tcborders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:cellmar', av: { w: '108', type: 'dxa' } },
    { c: 't:tcmar', av: { w: '108', type: 'dxa' } },
  ],
  left: [
    { c: 'b:pbdr', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:borders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:tcborders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:cellmar', av: { w: '108', type: 'dxa' } },
    { c: 't:tcmar', av: { w: '108', type: 'dxa' } },
  ],
  right: [
    { c: 'b:pbdr', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:borders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:tcborders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } },
    { c: 't:cellmar', av: { w: '108', type: 'dxa' } },
    { c: 't:tcmar', av: { w: '108', type: 'dxa' } },
  ],
  insideH: [{ c: 't:borders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } }],
  insideV: [{ c: 't:borders', av: { val: 'single', sz: '8', space: '1', color: 'FF0000', themeColor: 'accent1', themeShade: 'BF', themeTint: '99' } }],
  between: [{ c: 'b:pbdr', av: { val: 'single', sz: '8', space: '1', color: 'FF0000' } }],
  bar: [{ c: 'b:pbdr', av: { val: 'single', sz: '8', space: '1', color: 'FF0000' } }],
  tl2br: [{ c: 't:tcborders', av: { val: 'single' } }],
  tr2bl: [{ c: 't:tcborders', av: { val: 'single' } }],
  cnfStyle: [
    { c: 'b:ppr', av: { val: '00000001', evenHBand: '0', evenVBand: '0', firstColumn: '1', firstRow: '1', firstRowFirstColumn: '1', firstRowLastColumn: '0', lastColumn: '0', lastRow: '0', lastRowFirstColumn: '0', lastRowLastColumn: '0', oddHBand: '0', oddVBand: '0' } },
    { c: 't:trPr', av: { val: '00000001', evenHBand: '0', evenVBand: '0', firstColumn: '1', firstRow: '1', firstRowFirstColumn: '1', firstRowLastColumn: '0', lastColumn: '0', lastRow: '0', lastRowFirstColumn: '0', lastRowLastColumn: '0', oddHBand: '0', oddVBand: '0' } },
    { c: 't:tcPr', av: { val: '00000001', evenHBand: '0', evenVBand: '0', firstColumn: '1', firstRow: '1', firstRowFirstColumn: '1', firstRowLastColumn: '0', lastColumn: '0', lastRow: '0', lastRowFirstColumn: '0', lastRowLastColumn: '0', oddHBand: '0', oddVBand: '0' } },
  ],
  // ── 表格（02-tables）──
  tblStyle: [{ c: 't:tblPr', av: { val: 'TableGrid' } }],
  tblpPr: [{ c: 't:tblPr', av: { bottomFromText: '0', horzAnchor: 'page', leftFromText: '0', rightFromText: '0', tblpX: '10', tblpXSpec: 'absolute', tblpY: '10', topFromText: '0', vertAnchor: 'top' } }],
  tblOverlap: [{ c: 't:tblPr', av: { val: 'never' } }],
  tblStyleRowBandSize: [{ c: 't:tblPr', av: { val: '1' } }],
  tblStyleColBandSize: [{ c: 't:tblPr', av: { val: '1' } }],
  tblW: [{ c: 't:tblPr', av: { type: 'dxa', w: '5000' } }],
  tblCellSpacing: [{ c: 't:tblPr', av: { type: 'dxa', w: '0' } }],
  tblInd: [{ c: 't:tblPr', av: { type: 'dxa', w: '0' } }],
  tblLayout: [{ c: 't:tblPr', av: { type: 'fixed' } }],
  tblLook: [{ c: 't:tblPr', av: { val: '04A0', firstColumn: '1', firstRow: '1', lastColumn: '0', lastRow: '0', noHBand: '0', noVBand: '0' } }],
  gridCol: [{ c: 't:grid', av: { w: '2000' } }],
  gridAfter: [{ c: 't:trPr', av: { val: '1' } }],
  wAfter: [{ c: 't:trPr', av: { type: 'dxa', w: '120' } }],
  trHeight: [{ c: 't:trPr', av: { val: '400', hRule: 'atLeast' } }],
  tcW: [{ c: 't:tcPr', av: { type: 'dxa', w: '2000' } }],
  gridSpan: [{ c: 't:tcPr', av: { val: '2' } }],
  vMerge: [{ c: 't:tcPr', av: { val: 'restart' } }],
  noWrap: [{ c: 't:tcPr', av: { val: '1' } }],
  vAlign: [
    { c: 't:tcPr', av: { val: 'center' } },
    { c: 't:sect', av: { val: 'center' } },
  ],
  // ── 节属性（02-tables）──
  type: [{ c: 't:sect', av: { val: 'nextPage' } }],
  pgSz: [{ c: 't:sect', av: { w: '11906', h: '16838', orient: 'portrait', code: '9' } }],
  pgMar: [{ c: 't:sect', av: { top: '1440', right: '1800', bottom: '1440', left: '1800', header: '851', footer: '992', gutter: '0' } }],
  pgNumType: [{ c: 't:sect', av: { fmt: 'decimal', start: '1' } }],
  cols: [
    { c: 't:sect', av: { num: '1', space: '708', equalWidth: '1' } },
  ],
  col: [{ c: 't:cols-kids', av: { space: '14', w: '7092' } }],
  formProt: [{ c: 't:sect', av: { val: '0' } }],
  rtlGutter: [{ c: 't:sect', av: { val: '0' } }],
  docGrid: [{ c: 't:sect', av: { type: 'default', linePitch: '312', charSpace: '0' } }],
  headerReference: [{ c: 't:sect', av: { id: 'rId8', type: 'default' }, ap: { id: 'r:' } }],
  footerReference: [{ c: 't:sect', av: { id: 'rId9', type: 'default' }, ap: { id: 'r:' } }],
  // ── DrawingML（03-drawings）──
  inline: [{ c: 'd:inline', p: P.wp, bare: true, av: { anchorId: '', distB: '0', distL: '0', distR: '114300', distT: '0', editId: '' } }],
  anchor: [{ c: 'd:inline', p: P.wp, bare: true, av: { allowOverlap: '1', anchorId: '', behindDoc: '0', distB: '0', distL: '114300', distR: '114300', distT: '0', editId: '', layoutInCell: '1', locked: '0', relativeHeight: '1', simplePos: '0' } }],
  extent: [{ c: 'd:wp', p: P.wp, bare: true, av: { cx: '914400', cy: '914400' } }],
  effectExtent: [{ c: 'd:wp', p: P.wp, bare: true, av: { l: '0', t: '0', r: '0', b: '0' } }],
  docPr: [{ c: 'd:wp', p: P.wp, bare: true, av: { id: '1', name: '图片 1', descr: '一只猫' } }],
  simplePos: [{ c: 'd:anchor-kids', p: P.wp, bare: true, av: { x: '0', y: '0' } }],
  positionH: [{ c: 'd:anchor-kids', p: P.wp, bare: true, av: { relativeFrom: 'page' } }],
  positionV: [{ c: 'd:anchor-kids', p: P.wp, bare: true, av: { relativeFrom: 'page' } }],
  sizeRelH: [{ c: 'd:anchor-kids', p: P.wp, bare: true, av: { relativeFrom: 'page' } }],
  sizeRelV: [{ c: 'd:anchor-kids', p: P.wp, bare: true, av: { relativeFrom: 'page' } }],
  wrapSquare: [{ c: 'd:anchor-kids', p: P.wp, bare: true, av: { wrapText: 'bothSides' } }],
  graphicData: [{ c: 'd:pic', p: P.a, bare: true, av: { uri: 'http://schemas.openxmlformats.org/drawingml/2006/picture' } }],
  blipFill: [{ c: 'd:pic', p: P.pic, bare: true, av: { rotWithShape: '1' } }],
  blip: [{ c: 'd:pic', p: P.a, bare: true, av: { embed: 'rId2', cstate: 'print' }, ap: { embed: 'r:' } }],
  srcRect: [{ c: 'd:pic', p: P.a, bare: true, av: { l: '0', t: '0', r: '0', b: '0' } }],
  spPr: [{ c: 'd:pic', p: P.pic, bare: true, av: { bwMode: 'auto' } }],
  xfrm: [{ c: 'd:xfrm', p: P.a, bare: true, av: { rot: '0', flipH: '0', flipV: '0' } }],
  off: [{ c: 'd:xfrm', p: P.a, bare: true, av: { x: '0', y: '0' } }],
  ext: [
    { c: 'd:xfrm', p: P.a, bare: true, av: { cx: '914400', cy: '914400' } },
    { c: 'd:pic', p: P.a, bare: true, av: { cx: '0', cy: '0', uri: '{BE4D3D25-FFFF-4B7F-94D9-4B33BB0EFB7F}' } },
  ],
  prstGeom: [{ c: 'd:pic', p: P.a, bare: true, av: { prst: 'rect' } }],
  srgbClr: [{ c: 'd:clr2', p: P.a, bare: true, av: { val: 'FF0000' } }],
  scrgbClr: [{ c: 'd:clr2', p: P.a, bare: true, av: { r: '255', g: '0', b: '0' } }],
  prstClr: [{ c: 'd:clr2', p: P.a, bare: true, av: { val: 'red' } }],
  schemeClr: [{ c: 'd:clr', p: P.a, bare: true, av: { val: 'accent1' } }],
  lumMod: [{ c: 'd:clr', p: P.a, bare: true, av: { val: '50000' } }],
  lumOff: [{ c: 'd:clr', p: P.a, bare: true, av: { val: '50000' } }],
  // a:lum 是颜色变换子元素，读手零路径 ⇒ 恒居未查问档
  lum: [{ c: 'd:clr', p: P.a, bare: true, av: { bright: '70000', contrast: '-30000' } }],
  tint: [{ c: 'd:clr', p: P.a, bare: true, av: { val: '50000' } }],
  shade: [{ c: 'd:clr', p: P.a, bare: true, av: { val: '50000' } }],
  satOff: [{ c: 'd:clr', p: P.a, bare: true, av: { val: '0' } }],
  alpha: [{ c: 'd:clr', p: P.a, bare: true, av: { val: '50000' } }],
  alphaOff: [{ c: 'd:clr', p: P.a, bare: true, av: { val: '0' } }],
  hueOff: [{ c: 'd:clr', p: P.a, bare: true, av: { val: '0' } }],
  gradFill: [{ c: 'd:pic', p: P.a, bare: true, av: { flip: 'none', rotWithShape: '0' } }],
  gs: [{ c: 'd:gs', p: P.a, bare: true, av: { pos: '0' } }],
  ln: [{ c: 'd:ln', p: P.a, bare: true, av: { w: '9525', cap: 'flat', cmpd: 'sng' } }],
  prstDash: [{ c: 'd:ln', p: P.a, bare: true, av: { val: 'solid' } }],
  headEnd: [
    { c: 'd:ln', p: P.a, bare: true, av: { len: 'med', type: 'none', w: 'med' } },
    { c: 'v:stroke', p: P.v, bare: true, av: { len: 'med', type: 'none', w: 'med' } },
  ],
  tailEnd: [
    { c: 'd:ln', p: P.a, bare: true, av: { len: 'med', type: 'none', w: 'med' } },
    { c: 'v:stroke', p: P.v, bare: true, av: { len: 'med', type: 'none', w: 'med' } },
  ],
  miter: [{ c: 'd:ln', p: P.a, bare: true, av: { lim: '800000' } }],
  textOutline: [{ c: 'd:ln', p: P.a, bare: true, av: { algn: 'ctr', cap: 'flat', cmpd: 'sng', w: '9525' } }],
  prstTxWarp: [{ c: 'd:ln', p: P.a, bare: true, av: { prst: 'textNoShape' } }],
  outerShdw: [{ c: 'd:fx', p: P.a, bare: true, av: { algn: 'tl', blurRad: '40000', dir: '2700000', dist: '20000', rotWithShape: '0' } }],
  glow: [{ c: 'd:fx', p: P.a, bare: true, av: { rad: '40000' } }],
  reflection: [{ c: 'd:fx', p: P.a, bare: true, av: { algn: 'bl', blurRad: '0', dir: '5400000', dist: '0', endA: '0', endPos: '35000', fadeDir: '5400000', kx: '0', ky: '0', stA: '70000', stPos: '0', sx: '100000', sy: '-100000' } }],
  lightRig: [{ c: 'd:scene', p: P.a, bare: true, av: { dir: 't', rig: 'legacyFlat3' } }],
  props3d: [
    { c: 'd:scene', p: P.a, bare: true, av: { contourW: '0', extrusionH: '0', prstMaterial: 'legacyMatte' } },
    { c: 'v:main', p: P.v, bare: true, av: { contourW: '0', extrusionH: '0', prstMaterial: 'legacyMatte' } },
  ],
  picLocks: [{ c: 'd:pic', p: P.a, bare: true, av: { noChangeAspect: '1', noChangeArrowheads: '0' } }],
  graphicFrameLocks: [{ c: 'd:pic', p: P.a, bare: true, av: { noChangeAspect: '1' } }],
  spLocks: [
    { c: 'd:wps', p: P.a, bare: true, av: { noChangeArrowheads: '0', noEditPoints: '0' } },
    { c: 'v:main', p: P.o, bare: true, av: { noChangeArrowheads: '0', noEditPoints: '0' } },
  ],
  cNvSpPr: [{ c: 'd:wps', p: P.wps, bare: true, av: { txBox: '1' } }],
  cNvPr: [{ c: 'd:pic', p: P.pic, bare: true, av: { id: '1', name: '图片 1', descr: '一只猫' } }],
  bodyPr: [{ c: 'd:bodypr', p: P.a, bare: true, av: { anchor: 'ctr', anchorCtr: '0', bIns: '91440', compatLnSpc: '0', forceAA: '0', fromWordArt: '0', horzOverflow: 'overflow', lIns: '91440', numCol: '1', rIns: '91440', rot: '0', rtlCol: '0', spcCol: '0', spcFirstLastPara: '0', tIns: '45720', upright: '0', vert: 'horz', vertOverflow: 'overflow', wrap: 'square' } }],
  lnRef: [{ c: 'd:wps', p: P.a, bare: true, av: { idx: '1' } }],
  fillRef: [{ c: 'd:wps', p: P.a, bare: true, av: { idx: '1' } }],
  effectRef: [{ c: 'd:wps', p: P.a, bare: true, av: { idx: '0' } }],
  fontRef: [{ c: 'd:wps', p: P.a, bare: true, av: { idx: 'minor' } }],
  // ── VML（04-vml）──
  shape: [
    {
      c: 'v:shape-attr',
      p: P.v,
      bare: true,
      av: {
        adj: '', alt: '一只猫', anchorId: '', bullet: 'f', connectortype: 'straight', coordorigin: '0,0',
        coordsize: '1000,1000', fillcolor: '#ffc0cb', filled: 't', gfxdata: '', id: '_x0000_s1026', ole: 'f',
        path: 'm0,0 l100,0 e', preferrelative: 't', spid: '_x0000_s1026', spt: '75', strokecolor: '#000080',
        stroked: 'f', strokeweight: '1pt', style: 'width:100pt;height:50pt', type: '#_x0000_t75',
      },
      // imagedata 由 v:shape-attr 的 close 串统一挂一枚（兄弟节点即够 bitmap() 的 findDesc），
      // 每枚属性各挂一枚会把 imagedata|id 的分母吹涨 45 倍
    },
  ],
  shapetype: [{ c: 'v:pict', p: P.v, bare: true, av: { adj: '', anchorId: '', coordsize: '1000,1000', filled: 'f', id: '_x0000_t75', oned: 'f', path: 'm0,0 l100,0 e', preferrelative: 't', spt: '75', stroked: 'f' } }],
  fill: [{ c: 'v:fill', p: P.v, bare: true, av: { color2: '#0000ff', colors: '', ext: 'view', focus: '0,0', focusposition: '0,0', focussize: '0,0', id: '', on: 't', opacity: '', opacity2: '', recolor: 't', rotate: '0', title: '', type: 'solid' } }],
  fillRect: [{ c: 'v:fill', p: P.v, bare: true, av: { b: '0', t: '0' } }],
  fillToRect: [{ c: 'v:fill', p: P.v, bare: true, av: { b: '0', l: '0', r: '0', t: '0' } }],
  lin: [{ c: 'v:fill', p: P.v, bare: true, av: { ang: '0', scaled: '0' } }],
  stroke: [{ c: 'v:stroke', p: P.v, bare: true, av: { color: '#000080', dashstyle: 'solid', endarrow: 'none', endcap: 'flat', joinstyle: 'round', miterlimit: '8', on: 't', startarrow: 'none', weight: '1pt' } }],
  shadow: [{ c: 'v:main', p: P.v, bare: true, av: { algn: 'tl', blurRad: '0', dir: '2700000', dist: '2pt', kx: '0', ky: '0', offset: '2pt,2pt', on: 't', opacity: '', origin: '', sx: '100000', sy: '100000', val: '' } }],
  textbox: [{ c: 'v:main', p: P.v, bare: true, av: { inset: '0,0,0,0', style: 'mso-fit-shape-to-text:t' } }],
  path: [{ c: 'v:path', p: P.v, bare: true, av: { arrowok: 't', connectangles: '', connectlocs: '', connecttype: 'segments', extrusionok: 'f', fillok: 't', gradientshapeok: 't', h: '1000', path: 'm0,0 l100,0 e', textboxrect: '0,0,1000,1000', w: '1000' } }],
  f: [{ c: 'v:formulas', p: P.v, bare: true, av: { eqn: 'sum 0 0 0' } }],
  h: [{ c: 'v:handles', p: P.v, bare: true, av: { position: '0,0', xrange: '0,1000', yrange: '0,1000' } }],
  pt: [{ c: 'v:path', p: P.v, bare: true, av: { x: '0', y: '0' } }],
  gd: [{ c: 'v:main', p: P.v, bare: true, av: { fmla: '', name: '' } }],
  lock: [{ c: 'v:main', p: P.v, bare: true, av: { aspectratio: 'f', ext: 'edit', shapetype: 'spt' } }],
  cxnSpLocks: [{ c: 'v:main', p: P.o, bare: true, av: { noChangeShapeType: '0' } }],
  cxn: [{ c: 'v:main', p: P.v, bare: true, av: { ang: '0' } }],
  pos: [{ c: 'v:main', p: P.v, bare: true, av: { x: '0', y: '0' } }],
  rot: [{ c: 'v:main', p: P.v, bare: true, av: { lat: '0', lon: '0', rev: '0' } }],
  hiddenLine: [{ c: 'v:main', p: P.v, bare: true, av: { w: '1pt' } }],
  attr: [{ c: 'v:main', p: P.o, bare: true, av: { name: 'x', val: 'y' } }],
  imagedata: [{ c: 'v:main', p: P.v, bare: true, av: { cropbottom: '0', cropleft: '0', cropright: '0', croptop: '0', id: 'rId3', title: '' }, ap: { id: 'r:', title: 'o:' } }],
  group: [{ c: 'v:pict', p: P.v, bare: true, av: { anchorId: '', coordorigin: '0,0', coordsize: '1000,1000', editas: 'canvas', gfxdata: '', id: '', spid: '', spt: '0', style: '' } }],
  chOff: [{ c: 'v:group', p: P.v, bare: true, av: { x: '0', y: '0' } }],
  chExt: [{ c: 'v:group', p: P.v, bare: true, av: { cx: '1000', cy: '1000' } }],
  line: [{ c: 'v:pict', p: P.v, bare: true, av: { allowincell: 'f', anchorId: '', coordsize: '1000,1000', fillcolor: '', filled: 'f', from: '0,0', gfxdata: '', id: '', spid: '', spt: '20', strokecolor: '#000080', stroked: 't', strokeweight: '1pt', style: '', to: '100,0' } }],
  rect: [{ c: 'v:pict', p: P.v, bare: true, av: { allowincell: 'f', b: '0', coordsize: '1000,1000', fillcolor: '', filled: 'f', gfxdata: '', id: '', l: '0', r: '0', spid: '', spt: '100', strokecolor: '#000080', stroked: 't', strokeweight: '1pt', style: '', t: '0' } }],
  roundrect: [{ c: 'v:pict', p: P.v, bare: true, av: { anchorId: '', arcsize: '10%', coordsize: '1000,1000', fillcolor: '', filled: 'f', gfxdata: '', id: '', spid: '', spt: '100', strokecolor: '#000080', stroked: 't', strokeweight: '1pt', style: '' } }],
  wrap: [{ c: 'v:main', p: P.w10, bare: true, av: { anchorx: 'margin', anchory: 'page', side: 'right', type: 'square' } }],
  useLocalDpi: [{ c: 'v:main', av: { val: '0' } }],
  OLEObject: [{ c: 'v:object', p: P.o, bare: true, av: { DrawAspect: 'Content', ObjectID: '_1', ProgID: 'Excel.Sheet.12', ShapeID: '_x0000_s1027', Type: 'Embed', id: 'rId4' }, ap: { id: 'r:' } }],
  object: [{ c: 'v:object-run', av: { dxaOrig: '0', dyaOrig: '0' } }],
  calcOnExit: [{ c: 'v:ffdata', av: { val: '1' } }],
  entryMacro: [{ c: 'v:ffdata', av: { val: '' } }],
  maxLength: [{ c: 'v:textinput', av: { val: '10' } }],
  default: [{ c: 'v:textinput', av: { val: '默认' } }],
  appearance: [{ c: 'v:ffdata', av: { val: 'normal' } }],
  // ── styles.xml（00-base）──
  name: [
    { c: 's:style-kids', av: { val: 'Normal' } },
    { c: 'v:ffdata', av: { val: 'Text1' } },
  ],
  aliases: [{ c: 's:style-kids', av: { val: '正文' } }],
  basedOn: [{ c: 's:style-kids', av: { val: 'a' } }],
  next: [{ c: 's:style-kids', av: { val: 'a' } }],
  link: [{ c: 's:style-kids', av: { val: 'aChar' } }],
  uiPriority: [{ c: 's:style-kids', av: { val: '9' } }],
  rsid: [{ c: 's:style-kids', av: { val: '00A1' } }],
  tblStylePr: [{ c: 's:style-kids', av: { type: 'firstRow' } }],
  // latentStyles 的六属性不走承放：由 s:latent 的 open 串承担（见主循环的 skip）
  lsdException: [{ c: 's:latent', av: { locked: '0', name: 'Normal', qFormat: '1', semiHidden: '0', uiPriority: '0', unhideWhenUsed: '0' } }],
  // ── numbering.xml（00-base）──
  nsid: [{ c: 'n:abstract-kids', av: { val: '00000001' } }],
  multiLevelType: [{ c: 'n:abstract-kids', av: { val: 'hybridMultilevel' } }],
  tmpl: [{ c: 'n:abstract-kids', av: { val: '0409001D' } }],
  styleLink: [{ c: 'n:abstract-kids', av: { val: 'a' } }],
  numForm: [{ c: 'n:abstract-kids', av: { val: 'default' } }],
  numIdMacAtCleanup: [{ c: 'n:b0', av: { val: '0' } }],
  numPicBullet: [{ c: 'n:b0', av: { numPicBulletId: '0' } }],
  start: [{ c: 'n:lvl-kids', av: { val: '1' } }],
  numFmt: [{ c: 'n:lvl-kids', av: { val: 'bullet' } }],
  lvlRestart: [{ c: 'n:lvl-kids', av: { val: '0' } }],
  lvlText: [{ c: 'n:lvl-kids', av: { val: '·' } }],
  lvlPicBulletId: [{ c: 'n:lvl-kids', av: { val: '0' } }],
  legacy: [{ c: 'n:lvl-kids', av: { legacy: '1', legacyIndent: '0', legacySpace: '0' } }],
  lvlJc: [{ c: 'n:lvl-kids', av: { val: 'left' } }],
  suff: [{ c: 'n:lvl-kids', av: { val: 'nothing' } }],
  abstractNumId: [{ c: 'n:num-kids', av: { val: '0' } }],
  lvlOverride: [{ c: 'n:num-kids', av: { ilvl: '0' } }],
  startOverride: [{ c: 'n:num-kids', av: { val: '1' } }],
  // ── 脚注/尾注/批注（00-base，各自部件）──
  // commentsExtended 的根只声明 w15/mc，属性也带 w15: 前缀（真实格式如此），
  // 早先默认 w: 前缀会打出未声明前缀，整个部件解析失败
  commentEx: [{ c: 'cx:b0', p: P.w15, ap: { done: 'w15:', paraId: 'w15:' }, av: { done: '0', paraId: '00000001' } }],
  creationId: [{ c: 'cx:b0', p: P.w15, ap: { id: 'w15:' }, av: { id: '00000001' } }],
  // w:suppressAutoHyphens 本属 settings.xml（不在普查七部件之列），旧账 14 次；
  // 读手零路径 ⇒ 只为分母齐全，放 document.xml 正文流占位（结构位置不 schema 合法，量具语料专用）
  suppressAutoHyphens: [{ c: 'b0', av: { val: '1' } }],
}

// 非自闭合 / 前缀特殊的承放（pair → { c, item? }；无 item 的由部件根或包裹处提供）
const SPECIAL = {
  't|space': { c: 'b:run', item: '<w:t xml:space="preserve">文 字</w:t>' },
  'instrText|space': { c: 'b:run', item: '<w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText>' },
  'br|type': { c: 'b:run', item: '<w:br w:type="page"/>' },
  // 每对一枚最小件：一枚实例只带本对那一个属性，否则 census 分母把同一枚属性数 N 遍
  'sym|char': { c: 'b:run', item: '<w:sym w:char="F0FC"/>' },
  'sym|font': { c: 'b:run', item: '<w:sym w:font="Wingdings"/>' },
  'fldChar|fldCharType': { c: 'b:run', item: '<w:fldChar w:fldCharType="begin"/>' },
  'fldChar|fldLock': { c: 'b:run', item: '<w:fldChar w:fldLock="1"/>' },
  'fldSimple|instr': { c: 'b0', item: '<w:p><w:fldSimple w:instr=" PAGEREF _Toc1 \\h "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>' },
  'hyperlink|anchor': { c: 'b0', item: '<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>文</w:t></w:r></w:hyperlink></w:p>' },
  'hyperlink|id': { c: 'b0', item: '<w:p><w:hyperlink w:id="rId1"><w:r><w:t>文</w:t></w:r></w:hyperlink></w:p>' },
  'hyperlink|history': { c: 'b0', item: '<w:p><w:hyperlink w:history="1"><w:r><w:t>文</w:t></w:r></w:hyperlink></w:p>' },
  'hyperlink|tgtFrame': { c: 'b0', item: '<w:p><w:hyperlink w:tgtFrame="blank"><w:r><w:t>文</w:t></w:r></w:hyperlink></w:p>' },
  'hyperlink|tooltip': { c: 'b0', item: '<w:p><w:hyperlink w:tooltip="提示"><w:r><w:t>文</w:t></w:r></w:hyperlink></w:p>' },
  // v0.146：书签三对从 b0 挪进 b:para（段内）——正文流直子上块层分发不碰
  // bookmarkStart/End，探针不发，三对永远进不了分子
  'bookmarkStart|id': { c: 'b:para', item: '<w:bookmarkStart w:id="1"/>' },
  'bookmarkStart|name': { c: 'b:para', item: '<w:bookmarkStart w:name="_Toc1"/>' },
  'bookmarkEnd|id': { c: 'b:para', item: '<w:bookmarkEnd w:id="1"/>' },
  'proofErr|type': { c: 'b0', item: '<w:proofErr w:type="spellStart"/>' },
  'smartTag|element': { c: 'b0', item: '<w:smartTag w:element="address"><w:r><w:t>文</w:t></w:r></w:smartTag>' },
  'smartTag|uri': { c: 'b0', item: '<w:smartTag w:uri="urn:schemas-microsoft-com:office:smarttags"><w:r><w:t>文</w:t></w:r></w:smartTag>' },
  'commentRangeStart|id': { c: 'b0', item: '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>文</w:t></w:r></w:p>' },
  'commentRangeEnd|id': { c: 'b0', item: '<w:p><w:r><w:t>文</w:t></w:r><w:commentRangeEnd w:id="1"/></w:p>' },
  'commentReference|id': { c: 'b0', item: '<w:p><w:r><w:commentReference w:id="1"/></w:r></w:p>' },
  'ins|author': { c: 'b0', item: '<w:p><w:ins w:author="作者"><w:r><w:t>文</w:t></w:r></w:ins></w:p>' },
  'ins|date': { c: 'b0', item: '<w:p><w:ins w:date="2026-01-01T00:00:00Z"><w:r><w:t>文</w:t></w:r></w:ins></w:p>' },
  'ins|id': { c: 'b0', item: '<w:p><w:ins w:id="1"><w:r><w:t>文</w:t></w:r></w:ins></w:p>' },
  'p|paraId': { c: 'b0', item: '<w:p w14:paraId="00000001"/>' },
  'p|rsidR': { c: 'b0', item: '<w:p w:rsidR="00A1"/>' },
  'p|rsidP': { c: 'b0', item: '<w:p w:rsidP="00B3"/>' },
  'p|rsidRDefault': { c: 'b0', item: '<w:p w:rsidRDefault="00A2"/>' },
  'p|rsidRPr': { c: 'b0', item: '<w:p w:rsidRPr="00A4"/>' },
  'p|rsidDel': { c: 'b0', item: '<w:p w:rsidDel="00A5"/>' },
  'p|textId': { c: 'b0', item: '<w:p w14:textId="00000001"/>' },
  'r|rsidR': { c: 'b:run', item: '<w:r w:rsidR="00A1"/>' },
  'r|rsidRPr': { c: 'b:run', item: '<w:r w:rsidRPr="00A2"/>' },
  'r|rsidDel': { c: 'b:run', item: '<w:r w:rsidDel="00A3"/>' },
  'tr|paraId': { c: 't:tr', item: '<w:tr w14:paraId="00000001"/>' },
  'tr|rsidR': { c: 't:tr', item: '<w:tr w:rsidR="00A1"/>' },
  'tr|rsidRPr': { c: 't:tr', item: '<w:tr w:rsidRPr="00A2"/>' },
  'tr|rsidTr': { c: 't:tr', item: '<w:tr w:rsidTr="00A3"/>' },
  'tr|textId': { c: 't:tr', item: '<w:tr w14:textId="00000001"/>' },
  'sectPr|rsidR': { c: 't:b0', item: '<w:sectPr w:rsidR="00A1"/>' },
  'sectPr|rsidRPr': { c: 't:b0', item: '<w:sectPr w:rsidRPr="00A2"/>' },
  'sectPr|rsidSect': { c: 't:b0', item: '<w:sectPr w:rsidSect="00000001"/>' },
  'id|val': { c: 'b0', item: '<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>文</w:t></w:r></w:p></w:sdtContent></w:sdt>' },
  'docPartGallery|val': { c: 'b0', item: '<w:sdt><w:sdtPr><w:docPartGallery w:val="Default"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>文</w:t></w:r></w:p></w:sdtContent></w:sdt>' },
  'Choice|Requires': { c: 'b0', item: '<mc:AlternateContent><mc:Choice Requires="w14"/></mc:AlternateContent>' },
  'begChr|val': { c: 'b:omml', item: '<begChr val="("/>' },
  'endChr|val': { c: 'b:omml', item: '<endChr val=")"/>' },
  // 部件根上的 mc:Ignorable：由根元素开串提供，此处 no-op
  'styles|Ignorable': { c: 'noop' },
  'numbering|Ignorable': { c: 'noop' },
  'footnotes|Ignorable': { c: 'noop' },
  'endnotes|Ignorable': { c: 'noop' },
  'comments|Ignorable': { c: 'noop' },
  'commentsEx|Ignorable': { c: 'noop' },
  'document|Ignorable': { c: 'noop' },
  // 容器/带子元素：属性走独立实例，子元素由 *_kids 上下文承放
  'style|type': { c: 's:style-attrs', item: '<w:style w:type="paragraph"/>' },
  'style|default': { c: 's:style-attrs', item: '<w:style w:default="1"/>' },
  'style|styleId': { c: 's:style-attrs', item: '<w:style w:styleId="a"/>' },
  'style|customStyle': { c: 's:style-attrs', item: '<w:style w:customStyle="0"/>' },
  'abstractNum|abstractNumId': { c: 'n:abstract-attrs', item: '<w:abstractNum w:abstractNumId="0"/>' },
  'abstractNum|restartNumberingAfterBreak': { c: 'n:abstract-attrs', item: '<w:abstractNum w:restartNumberingAfterBreak="0"/>' },
  'lvl|ilvl': { c: 'n:lvl-attrs', item: '<w:lvl w:ilvl="0"/>' },
  'lvl|tentative': { c: 'n:lvl-attrs', item: '<w:lvl w:tentative="0"/>' },
  'lvl|tplc': { c: 'n:lvl-attrs', item: '<w:lvl w:tplc="0409000F"/>' },
  'num|numId': { c: 'n:num-attrs', item: '<w:num w:numId="1"/>' },
  'num|durableId': { c: 'n:num-attrs', item: '<w:num w:durableId="0"/>' },
  'footnote|id': { c: 'fn:footnote-attrs', item: '<w:footnote w:id="1"/>' },
  'footnote|type': { c: 'fn:footnote-attrs', item: '<w:footnote w:type="normal"/>' },
  'endnote|id': { c: 'en:endnote-attrs', item: '<w:endnote w:id="1"/>' },
  'endnote|type': { c: 'en:endnote-attrs', item: '<w:endnote w:type="normal"/>' },
  'comment|author': { c: 'cm:comment-attrs', item: '<w:comment w:author="作者"/>' },
  'comment|date': { c: 'cm:comment-attrs', item: '<w:comment w:date="2026-01-01T00:00:00Z"/>' },
  'comment|id': { c: 'cm:comment-attrs', item: '<w:comment w:id="1"/>' },
  'comment|initials': { c: 'cm:comment-attrs', item: '<w:comment w:initials="K"/>' },
}

// ── 汇聚 ───────────────────────────────────────────────────────────────────
const acc = new Map() // key → {f, part, open, close, items: []}
function push(f, part, open, close, xml) {
  const key = `${f}|${part}|${open}`
  let a = acc.get(key)
  if (!a) {
    a = { f, part, open, close, items: [] }
    acc.set(key, a)
  }
  a.items.push(xml)
}

// background 属性取值（themeColor 的 background1 是 schema 合法主题色槽）
const BG_VAL = { color: 'FFFFFF', themeColor: 'background1', themeShade: '0' }
const missing = []
// w:background 是 w:document 的单例子元素（schema 位置在 w:body 之前，故走 pre-body 槽）。
// 读手零路径 ⇒ 三对恒居未查问档；把宇宙里 background 的全部属性合成一枚实例
const bgAttrs = []
for (const { pair } of uni.pairs) {
  if (pair.startsWith('background|')) bgAttrs.push(pair.split('|')[1])
}
const bgEl = bgAttrs.length
  ? `<w:background ${bgAttrs.map((a) => `w:${a}="${BG_VAL[a] ?? '1'}"`).join(' ')}/>`
  : ''
for (const { pair, count } of uni.pairs) {
  const [el, attr] = pair.split('|')
  if (el === 'background') continue // pre-body 槽统一承放
  // latentStyles 六属性由 s:latent 的 open 串承担：w:latentStyles 是 styles 的单例容器，
  // 属性该长在容器自身上；发成子元素既嵌套错形，又把六对计数各吹涨近 20 倍
  if (el === 'latentStyles') continue
  const n = Math.max(1, Math.round(count / uni.scale))
  const sp = SPECIAL[pair]
  if (sp) {
    const c = PART_CTX[sp.c] ?? CTX[sp.c]
    if (!c) {
      missing.push(pair)
      continue
    }
    if (sp.item) {
      const f = c.f === 'ALL' ? '01-body' : c.f
      push(f, c.part, c.open, c.close, sp.item.repeat(n))
    }
    continue
  }
  const spots = PLACE[el]
  if (!spots) {
    missing.push(pair)
    continue
  }
  const live = spots.filter((s) => (PART_CTX[s.c] ?? CTX[s.c]) && s.av && attr in s.av)
  if (!live.length) {
    missing.push(pair)
    continue
  }
  const k = live.length
  const each = n >= k ? Math.max(1, Math.round(n / k)) : null
  live.forEach((s, i) => {
    const m = each ?? (i === 0 ? n : 0)
    if (m <= 0) return
    const c = PART_CTX[s.c] ?? CTX[s.c]
    const pfx = s.p ?? 'w:'
    const apfx = s.bare ? (s.ap?.[attr] ?? '') : (s.ap?.[attr] ?? 'w:')
    push(c.f, c.part, c.open, c.close, `<${pfx}${el} ${apfx}${attr}="${s.av[attr]}"/>`.repeat(m))
  })
}

// 表格样式的条件块 + 引用它的那张表：读手的 styleCondCells 只在「表上 w:tblStyle
// 指着一个带 w:tblStylePr 的样式」时才走这条路——tblStylePr|type 与条件行高那两条
// （trHeight|val / trHeight|hRule）都住在这条路上；行上的直接值要 val>0 才读 hRule，
// 所以只靠 t:trPr 那枚 hRule 实例是踩不到的
const condStyle = PART_CTX['s:table-cond']
push(
  '00-base',
  'styles',
  condStyle.open,
  condStyle.close,
  '<w:tblStylePr w:type="firstRow"><w:tcPr><w:shd w:val="clear" w:fill="FF0000"/></w:tcPr></w:tblStylePr>' +
    '<w:tblStylePr w:type="band1Horiz"><w:trPr><w:trHeight w:val="400" w:hRule="exact"/></w:trPr></w:tblStylePr>',
)
push('00-base', 'document', CTX['d0:tbl'].open, CTX['d0:tbl'].close, '<w:p><w:r><w:t>表</w:t></w:r></w:p>')

// 组合 shd 两枚（v0.142）：上面的单属性实例铺不满「多属性同元素」的查问路径——
// shadeSpec 里 `themeRefCss(...) ?? attr(shd,'w:color')` 的右支要无 themeFill 的图案档才求值，
// themeFillTint/Shade 要主引用在场才算，而单属性 `<w:shd w:color="auto"/>` 无 val 即 clear 档、
// 读手按 Word 语义正确地整个跳过。这两枚让 shd|color、shd|themeFillTint/Shade 在普查腿
// 真实发生（selftest 夹具早已覆盖，普查腿此前是盲区）。两枚 shd 分居两个专用段：
// 读手每个 pPr/tcPr 只 find 第一枚 shd，同段放两枚第二枚必被压掉。
push(
  '01-body',
  'document',
  CTX['b:ppr-shd'].open,
  CTX['b:ppr-shd'].close,
  '<w:shd w:val="pct25" w:color="FF0000" w:fill="FFFFFF"/>',
)
// 第二枚必须换个 open（push 按 open 合并，同 open 会同段、被 find 压掉）；
// widowControl 在 schema 序里同样位于 shd 之前，读手不查问它
push(
  '01-body',
  'document',
  '<w:p><w:pPr><w:widowControl w:val="1"/>',
  '</w:pPr><w:r><w:t>纹</w:t></w:r></w:p>',
  '<w:shd w:val="clear" w:themeFill="accent1" w:themeFillTint="99" w:themeFillShade="BF"/>',
)
// 表格侧同来一组：tcPr 走 cellStyleCss 那条路（shadingHex → themeRefCss），与段落侧互证
push(
  '02-tables',
  'document',
  CTX['t:tcPr-shd'].open,
  CTX['t:tcPr-shd'].close,
  '<w:shd w:val="pct25" w:color="FF0000" w:fill="FFFFFF"/>',
)
// 第二枚同理换 open（gridSpan 在 tcPr 的 schema 序里位于 shd 之前）
push(
  '02-tables',
  'document',
  `${TBL_HEAD}<w:tr><w:tc><w:tcPr><w:gridSpan w:val="1"/>`,
  `</w:tcPr>${CELL_BODY}${ROW_CLOSE}${TBL_CLOSE}`,
  '<w:shd w:val="clear" w:themeFill="accent1" w:themeFillTint="99" w:themeFillShade="BF"/>',
)

// ── 组装文件 ───────────────────────────────────────────────────────────────
// docHeader = 声明 + 根开串（不含 <w:body>）：w:background 要插在根与 body 之间
const docHeader =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:mc="${NS.mc}" xmlns:v="${NS.v}" ` +
  `xmlns:o="${NS.o}" xmlns:w10="${NS.w10}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" ` +
  `xmlns:pic="${NS.pic}" xmlns:wps="${NS.wps}" xmlns:w14="${NS.w14}" xmlns:w15="${NS.w15}" ` +
  `mc:Ignorable="w14 w15">`
const BODY_OPEN = '<w:body>'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
// clrScheme（v0.142 补）：读手自此解析 w:color/@w:themeColor 一族，语料里必须有色槽可解，
// 否则主题色全掉字面值、那一族对翻不了身。十一槽一律写 srgbClr——宇宙里有 srgbClr|val
// （563 次）而没有 sysClr|val，全用 srgbClr 保证「读到的每一对都在分母里」；
// sysClr（dk1/lt1 在真件里的常驻形态）那条分支由 selftest 夹具的 FIXTURE_THEME 覆盖。
// 色值取 Office 2007-2016 那套主题色（与 Word 默认件一致）。
const CLR_SCHEME =
  `<a:clrScheme name="Office">` +
  `<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
  `</a:clrScheme>`
const THEME =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<a:theme xmlns:a="${NS.a}" name="Office Theme"><a:themeElements>` +
  CLR_SCHEME +
  `<a:fontScheme name="Office">` +
  `<a:majorFont><a:latin typeface="Cambria"/><a:ea typeface="等线"/><a:cs typeface="Times New Roman"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="等线"/><a:cs typeface="Times New Roman"/></a:minorFont>` +
  `</a:fontScheme></a:themeElements></a:theme>`
const RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
  `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embed.xls" TargetMode="External"/>` +
  `<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>` +
  `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
  `</Relationships>`
const CT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Default Extension="png" ContentType="image/png"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`

const files = {}
for (const [, a] of acc) {
  files[a.f] ??= {}
  const part = a.part === 'document' ? 'word/document.xml' : `word/${a.part}.xml`
  files[a.f][part] ??= []
  files[a.f][part].push(a)
}

const out = []
for (const [f, parts] of Object.entries(files)) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CT)
  zip.file('word/_rels/document.xml.rels', RELS)
  if (f === '00-base') {
    zip.file('word/theme/theme1.xml', THEME)
    zip.file('word/document.xml', `${docHeader}${BODY_OPEN}<w:p><w:r><w:t>文</w:t></w:r></w:p></w:body></w:document>`)
  }
  if (f === '01-body') zip.file('word/theme/theme1.xml', THEME)
  if (f === '03-drawings' || f === '04-vml') zip.file('word/media/image1.png', PNG)
  for (const [part, list] of Object.entries(parts)) {
    const short = part.replace('word/', '').replace('.xml', '')
    const order = ORDER[f] ?? ORDER[short] ?? []
    // 反查：包裹串 → 上下文键（同一包裹串只认 order 里排前的那个键）
    const keyOf = new Map()
    for (const k of order) {
      const c = CTX[k] ?? PART_CTX[k]
      if (c && !keyOf.has(c.open)) keyOf.set(c.open, k)
    }
    const rank = (a) => {
      const k = keyOf.get(a.open)
      return k ? order.indexOf(k) : 99
    }
    const sorted = [...list].sort((x, y) => rank(x) - rank(y))
    const body = sorted.map((a) => a.open + a.items.join('') + a.close).join('')
    if (part === 'word/document.xml') {
      // w:background 单例，只落 01-body（计数按 1/100 缩放，不多文件重复）
      zip.file(part, `${docHeader}${f === '01-body' ? bgEl : ''}${BODY_OPEN}${body}</w:body></w:document>`)
    } else {
      // 部件根：root 上下文统辖整个部件的开闭。它自身从不当承放处、从不进 acc，
      // 所以根开串必须在这里按 part 显式发射（早先靠 list 里找 root 条目，永远找不到）
      const rc = Object.values(PART_CTX).find((c) => c.root && c.part === short)
      if (!rc) throw new Error(`部件 ${short} 没有 root 上下文`)
      zip.file(part, `${XML_DECL}${rc.open}${body}${rc.close}`)
    }
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const p = path.join(OUT_DIR, `${f}.docx`)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(p, bytes)
  out.push(p)
}

fs.writeFileSync(path.join(OUT_DIR, 'clist.txt'), out.join('\n') + '\n', 'utf8')

if (missing.length) {
  console.log(`未承放 ${missing.length} 对：${missing.join(' ')}`)
  process.exitCode = 1
} else {
  console.log(`合成语料：${out.length} 个文件 → ${path.relative(REPO, OUT_DIR).replace(/\\/g, '/')}`)
  for (const p of out) console.log(`  ${path.basename(p)} ${(fs.statSync(p).size / 1024).toFixed(0)} KB`)
}
