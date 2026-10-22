// pptx 属性级保真覆盖率生成器。
//
// 与 scripts/fidelity-report.mjs（docx 那一份）同一副骨架，四处不同：
//   1. 漏斗在 pptx-import.ts 的 ga 一枚（docx 那侧是 ooxml.ts 的 attr/attrL 两枚）——
//      整条读入链按名取属性只走它，含 r:embed 那族（取空按关系命名空间再取一次，
//      两路记同一对 blip|embed）；
//   2. 分母的部件范围是读手真会吃进去的那几件：ppt/theme/theme1.xml、
//      ppt/slideMasters/slideMaster1.xml（+它的 rels）、全部 ppt/slides/slideN.xml
//      （+各自的 rels）、全部 ppt/notesSlides/notesSlideN.xml。
//      slideLayouts 整个不读、themeN/slideMasterN（N>1）不读——不打算读的部件不算丢账；
//   3. 入口是 pptxBytesToDeck(bytes)（docx 那侧是 docxToHtmlFidelity）；
//   4. 读手跑在 node 里，DOMParser 由 devDependency @xmldom/xmldom 提供（浏览器端用原生的）——
//      模块注释里点名的那只解析器，语义与原生 DOMParser 在这一族用法上同值
//      （localName / getAttribute('r:x') / getAttributeNS 三件都实测过）。
//
// 语料不在盘上时（本轮就是）：--selftest 用内置夹具当宇宙出一份账，报告头部如实标注。
//
//   pnpm exec vite-node scripts/fidelity-report-pptx.mjs --selftest            # 夹具为宇宙出一份账
//   pnpm exec vite-node scripts/fidelity-report-pptx.mjs --corpus /path/pptx   # 真语料
//   ... --clean-pass      再跑一遍不带探针的副本，证明观察者不扰动产品
//   ... --mut no-ga       变异档：故意不注入漏斗，覆盖率必须下降（selftest 随之转红）
//
// 报告里不许出现任何文件路径或文件名：语料是每个人的本地件，公开的只有聚合数字。
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'

// 读手（与浏览器同一份代码）在 node 里要的全局 DOM：先立起来再 import 模块
globalThis.DOMParser = DOMParser

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i < 0 ? dflt : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

const REPO = path.resolve(import.meta.dirname, '..')
const REF = flag('ref', 'HEAD')
const OUT_DIR = path.resolve(REPO, flag('out', 'docs'))
const MOD_DIR = path.resolve(REPO, flag('tmp', 'tmp/pptx-fidelity-mod'))
const LIMIT = Number(flag('limit', '0'))
const MUT = flag('mut', '')
const CLIST_FILE = flag('clist', '')
const CORPUS = flag('corpus', '')

// 读手真正吃进去的部件：分母只算这些（见文件头第 2 条）。slideLayouts 不读 ⇒ 不进分母
const PARTS_STATIC = ['ppt/theme/theme1.xml', 'ppt/slideMasters/slideMaster1.xml']
const PARTS_RE =
  /^ppt\/(slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|slideMasters\/_rels\/slideMaster1\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/

// ---- 1b. 内置夹具（--selftest）------------------------------------------------
//
// 分子语义不依赖任何语料：这一份 pptx 里每枚属性都是亲手放的，「探针应当看到哪些、
// 应当看不到哪些」可以事先写死。MUST_SEE 是读手真会按名查问的；MUST_NOT_SEE 是故意放进去、
// 而读手（按源码现状）确实一寸都不查的——两边都断言才叫量具，只断一边等于自说自话。
// 形状照 PowerPoint 亲笔的那株树造（sp/pic/graphicFrame + transition + timing 四段都在），
// 连我们不读的旁支属性（name/descr/i/u/lang/bandRow/spd…）也一并放进去当反例。
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

const FIXTURE_THEME =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<a:theme xmlns:a="${A}" name="Office Theme"><a:themeElements>` +
  `<a:clrScheme name="Office">` +
  `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
  `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
  `</a:clrScheme>` +
  // 字族那一族读手整片不读（没有字体方案支持）：latin|typeface 是真实的丢账，不是反例装饰
  `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>` +
  `</a:themeElements></a:theme>`

const FIXTURE_MASTER =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld>` +
  // 背景走 schemeClr：bg1 → clrMap → lt1 → theme 的 sysClr lastClr
  `<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
  `<p:spTree>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="838200" y="457200"/><a:ext cx="7772400" cy="1143000"/></a:xfrm></p:spPr>` +
  `<p:txBody><a:bodyPr anchor="ctr"/><a:p><a:r><a:t>母版标题</a:t></a:r></a:p></p:txBody></p:sp>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="1143000" y="1600200"/><a:ext cx="6858000" cy="3200400"/></a:xfrm></p:spPr>` +
  `<p:txBody><a:bodyPr/><a:p><a:r><a:t>母版正文</a:t></a:r></a:p></p:txBody></p:sp>` +
  `</p:spTree></p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"` +
  ` accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"` +
  ` dk1="dk1" lt1="lt1" dk2="dk2" lt2="lt2"/>` +
  `</p:sldMaster>`

const FIXTURE_MASTER_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="${PKG_REL}">` +
  `<Relationship Id="rId1" Type="${R}/theme" Target="../theme/theme1.xml"/>` +
  `<Relationship Id="rId2" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `</Relationships>`

// 幻灯片：标题/正文两个占位 + 一个自由文本框 + 一张图 + 一个原生表格，
// 外加 transition 与一株三段的 timing（入场正文 wipe、入场形状 fade、出场图片 fade）
const FIXTURE_SLIDE =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:spTree>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="838200" y="274638"/><a:ext cx="7772400" cy="1371600"/></a:xfrm>` +
  `<a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="2F5496"/></a:solidFill></a:ln></p:spPr>` +
  `<p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/>` +
  `<a:r><a:rPr lang="en-US" sz="3600" b="1" i="1" u="sng" dirty="0"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></a:rPr>` +
  `<a:t>属性覆盖账夹具</a:t></a:r></a:p></p:txBody></p:sp>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="838200" y="1736592"/><a:ext cx="7772400" cy="1828800"/></a:xfrm></p:spPr>` +
  `<p:txBody><a:bodyPr/><a:p><a:pPr algn="l"/><a:r><a:rPr sz="2400" b="0"/><a:t>第一行正文</a:t></a:r></a:p>` +
  `<a:p><a:pPr algn="l"/><a:r><a:rPr sz="2400" b="0"/><a:t>第二行正文</a:t></a:r></a:p></p:txBody></p:sp>` +
  // 自由文本框：v0.140 起它同时是斜体/下划线/锚点/形状名/替代文本的断言载体——
  // 这几枚只有落在「真进形状层」的 sp 上才算数（占位符那支按设计丢字符样式）
  `<p:sp><p:nvSpPr><p:cNvPr id="4" name="自由文本框" descr="自由文本"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="1143000" y="3879216"/><a:ext cx="3657600" cy="914400"/></a:xfrm>` +
  `<a:ln w="12700"><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></a:ln></p:spPr>` +
  `<p:txBody><a:bodyPr anchor="ctr" wrap="square"/><a:p><a:pPr algn="r"/>` +
  `<a:r><a:rPr sz="1800" b="1" i="1" u="sng"><a:solidFill><a:srgbClr val="2F5496"/></a:solidFill></a:rPr>` +
  `<a:t>自由文本</a:t></a:r></a:p></p:txBody></p:sp>` +
  `<p:pic><p:nvPicPr><p:cNvPr id="5" name="图片 4" descr="一张 1×1 的 PNG"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
  `<p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
  `<p:spPr><a:xfrm><a:off x="6858000" y="1828800"/><a:ext cx="2286000" cy="1714500"/></a:xfrm></p:spPr></p:pic>` +
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="表格 5"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
  `<p:xfrm><a:off x="838200" y="4876656"/><a:ext cx="6858000" cy="914400"/></p:xfrm>` +
  `<a:graphic><a:graphicData uri="${A}/table">` +
  `<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid><a:gridCol w="3429000"/><a:gridCol w="3429000"/></a:tblGrid>` +
  `<a:tr h="457200"><a:tc><a:txBody><a:p><a:r><a:t>列一</a:t></a:r></a:p></a:txBody></a:tc>` +
  `<a:tc><a:txBody><a:p><a:r><a:t>列二</a:t></a:r></a:p></a:txBody></a:tc></a:tr>` +
  `<a:tr h="457200"><a:tc><a:txBody><a:p><a:r><a:t>值一</a:t></a:r></a:p></a:txBody></a:tc>` +
  `<a:tc><a:txBody><a:p><a:r><a:t>值二</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>` +
  `</a:graphicData></a:graphic></p:graphicFrame>` +
  `</p:spTree></p:cSld>` +
  // advTm=5000 → autoAdvance 5 秒；spd/advClick 读手一寸不查
  `<p:transition spd="med" advTm="5000" advClick="1"><p:fade/></p:transition>` +
  `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
  `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" restart="whenNotActive" nodeType="mainSeq"><p:childTnLst>` +
  // ① 正文逐段：wipe up + presetSubtype=4（下）→ anim=wipe dir=bottom；spTgt 指 bldP 那个 spid
  `<p:par><p:cTn id="3" presetID="22" presetClass="entr" presetSubtype="4" fill="hold" grpId="0" nodeType="clickEffect">` +
  `<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par>` +
  `<p:cTn id="4" presetID="22" presetClass="entr" presetSubtype="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
  `<p:animEffect transition="in" filter="wipe up"><p:cBhvr><p:cTn id="5" dur="500"/><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cBhvr></p:animEffect>` +
  `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>` +
  // ② 自由文本框入场：没有 animEffect 也没有 anim ⇒ 判 fade（这一支走 set/visibility）
  `<p:par><p:cTn id="6" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">` +
  `<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par>` +
  `<p:cTn id="7" presetID="10" presetClass="entr" presetSubtype="0" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
  `<p:set><p:cBhvr><p:cTn id="8" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
  `<p:tgtEl><p:spTgt spid="4"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>` +
  `<p:to><p:strVal val="visible"/></p:to></p:set>` +
  `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>` +
  // ③ 图片出场：presetClass=exit + animEffect transition="out"（这一族查 transition 不查 filter）
  `<p:par><p:cTn id="9" presetID="10" presetClass="exit" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">` +
  `<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par>` +
  `<p:cTn id="10" presetID="10" presetClass="exit" presetSubtype="0" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
  `<p:animEffect transition="out" filter="fade"><p:cBhvr><p:cTn id="11" dur="500"/><p:tgtEl><p:spTgt spid="5"/></p:tgtEl></p:cBhvr></p:animEffect>` +
  `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>` +
  `</p:childTnLst></p:cTn></p:seq>` +
  `</p:childTnLst></p:cTn></p:par></p:tnLst>` +
  `<p:bldLst><p:bldP spid="3" grpId="0" build="p"/></p:bldLst>` +
  `</p:timing></p:sld>`

const FIXTURE_SLIDE_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="${PKG_REL}">` +
  `<Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `<Relationship Id="rId2" Type="${R}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>` +
  `<Relationship Id="rId3" Type="${R}/image" Target="../media/image1.png"/>` +
  `</Relationships>`

const FIXTURE_NOTES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>` +
  // sldImg 那一枚按 ph|type 认出来然后整枚跳过——type 是被查问的，文本不进账
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg" idx="1"/></p:nvPr></p:nvSpPr>` +
  `<p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>幻灯片图像</a:t></a:r></a:p></p:txBody></p:sp>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
  `<p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>这是演讲者备注</a:t></a:r></a:p></p:txBody></p:sp>` +
  `</p:spTree></p:cSld></p:notes>`

// 1×1 透明 PNG（图片形状要真能落成 data URI，夹具才不是在空转）
const FIXTURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// 读手按名查问过的（ga 漏斗记的键，element|attr，两边都剥掉命名空间前缀）
const MUST_SEE = [
  // 几何与占位
  'off|x', 'off|y', 'ext|cx', 'ext|cy', 'ph|type',
  // 形状身份与字符样式
  'cNvPr|id', 'rPr|sz', 'rPr|b', 'pPr|algn', 'ln|w',
  // v0.140：本轮补上的十二枚真丢账（原先在 MUST_NOT_SEE，审计见 docs/pptx-fidelity-audit.md）
  'cNvPr|name', 'cNvPr|descr',
  'rPr|i', 'rPr|u',
  'bodyPr|anchor', 'bodyPr|wrap',
  'tblPr|bandRow', 'gridCol|w', 'tr|h',
  'transition|advClick', 'cTn|dur', 'latin|typeface',
  // 颜色三兄弟（theme 的 clrScheme、各处 solidFill、母版背景的 schemeClr）
  'srgbClr|val', 'sysClr|lastClr', 'schemeClr|val',
  // clrMap 照单全收：十二枚名一一过漏斗（取几枚代表性的点名，其余同族）
  'clrMap|bg1', 'clrMap|tx1', 'clrMap|accent6', 'clrMap|folHlink',
  // 图片 / 表格 / 切页 / 动画 / 备注关系
  'blip|embed', 'tblPr|firstRow', 'transition|advTm',
  'cTn|nodeType', 'cTn|presetClass', 'cTn|presetSubtype',
  'spTgt|spid', 'bldP|spid', 'animEffect|filter', 'animEffect|transition',
  'Relationship|Id', 'Relationship|Target', 'Relationship|Type',
]

// 故意放进去、而读手确实一寸不查的（两侧都断才叫量具）。
// v0.140：原在这张表上的十二枚真丢账已补读，移到 MUST_SEE；剩下的是审计裁定的「不读」
const MUST_NOT_SEE = [
  'rPr|lang', 'rPr|dirty', // 拼写语言与会话脏标记：都不进呈现
  'ph|idx', // 占位序号不读（同型占位按 kind 认，不按 idx）
  'transition|spd', // 切页速度档：效果名已建模，速度导出侧固定
  'theme|name', 'clrScheme|name', 'fontScheme|name', // 主题/方案的命名不参与呈现
  'sysClr|val', // 系统色只读 lastClr（val 是 "windowText" 这类枚举名）
  'graphicData|uri', // 内容类型标签：按子元素（tbl/blip/c:chart）分派，不看标签
  'cTn|presetID', 'cTn|grpId', 'cTn|fill', 'cTn|restart', 'cTn|id',
  'graphicFrameLocks|noGrp', 'spLocks|noGrp', 'cond|delay', 'seq|concurrent', 'seq|nextAc',
]

const md5 = (s) => createHash('md5').update(s).digest('hex')
const local = (n) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n)
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

function git(args, buf) {
  return execFileSync('git', args, { cwd: REPO, encoding: buf ? 'utf8' : null, maxBuffer: 128 * 1024 * 1024 })
}

// ---- 1. 语料清单 --------------------------------------------------------------

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
        } else if (/\.pptx$/i.test(e.name) && !e.name.startsWith('~$')) {
          list.push(path.join(dir, e.name))
        }
      }
    }
    walk(path.resolve(CORPUS))
  }
  list.sort()
  return LIMIT > 0 ? list.slice(0, LIMIT) : list
}

// ---- 2. 一次性模块副本 + 探针注入 ---------------------------------------------

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
      id: 'ga',
      skip: mut === 'no-ga',
      find:
        'function ga(el: Element | null | undefined, name: string): string | null {\n' +
        '  if (!el) return null\n  const v = el.getAttribute(name)',
      put:
        'function ga(el: Element | null | undefined, name: string): string | null {\n' +
        '  if (!el) return null\n  __PROBE.note(el.localName, name)\n  const v = el.getAttribute(name)',
    },
  ]
  // 注入块落在 import 段之后：pptx-import.ts 的 import 段以 `} from './ppt'` 收头
  const anchor = "} from './ppt'\n"
  const i0 = src.indexOf(anchor)
  if (i0 < 0) throw new Error('注入中止：找不到 import 段尾部（} from \'./ppt\'）')
  const nl = i0 + anchor.length - 1
  src = src.slice(0, nl + 1) + RECORDER + src.slice(nl + 1)
  const applied = []
  for (const x of inj) {
    if (x.skip) continue
    const hits = src.split(x.find).length - 1
    if (hits !== 1) throw new Error(`注入锚点 ${x.id} 命中 ${hits} 次（应为 1）`)
    src = src.replace(x.find, x.put)
    applied.push(x.id)
  }
  fs.writeFileSync(file, src, 'utf8')
  return applied
}

// ---- 3. 分母：同一只解析器（读手在 node 里的替身）数部件全树的属性字面 --------
//
// xmldom 0.8 不实现 Element.children（模块注释点名过），走 childNodes 自己过滤——
// 与读手里的 kids() 同一副走法。xmlns 声明不是属性语义，跳过（与 docx 那份同口径）

function countAttrs(root) {
  const pairs = new Map()
  let total = 0
  const visit = (el) => {
    const p = local(el.nodeName)
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i]
      const k = local(a.name)
      if (k === 'xmlns' || a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue
      pairs.set(`${p}|${k}`, (pairs.get(`${p}|${k}`) ?? 0) + 1)
      total++
    }
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 1) visit(c)
    }
  }
  visit(root)
  return { pairs, total }
}

async function scopeParts(zip) {
  const names = Object.keys(zip.files)
  const slideN = (n) => Number(n.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
  const notesN = (n) => Number(n.match(/notesSlide(\d+)\.xml$/)?.[1] ?? 0)
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => slideN(a) - slideN(b))
  const out = []
  for (const p of PARTS_STATIC) if (zip.file(p)) out.push(p)
  for (const s of slides) {
    out.push(s)
    const rels = s.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')
    if (zip.file(rels)) out.push(rels)
  }
  const masterRels = 'ppt/slideMasters/_rels/slideMaster1.xml.rels'
  if (zip.file(masterRels)) out.push(masterRels)
  const notes = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).sort((a, b) => notesN(a) - notesN(b))
  out.push(...notes)
  return out
}

async function censusPairs(zip, parts) {
  const pairs = new Map()
  const partTotals = {}
  for (const p of parts) {
    const entry = zip.file(p)
    if (!entry) continue
    let doc
    try {
      doc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml')
    } catch {
      continue
    }
    const { pairs: pp, total } = countAttrs(doc.documentElement)
    partTotals[p] = total
    for (const [k, v] of pp) pairs.set(k, (pairs.get(k) ?? 0) + v)
  }
  return { pairs, partTotals }
}

// ---- 4. 一趟读手 --------------------------------------------------------------

function errClass(e) {
  const m = String(e && e.message ? e.message : e)
  if (/Corrupted zip|End of data reached|unexpected end|invalid stored|compressed data|not a Zip/i.test(m))
    return 'unreadable-zip'
  if (/未找到任何幻灯片/.test(m)) return 'no-slides'
  return m.replace(/['"`][^'"`]*['"`]/g, "''").slice(0, 48)
}

function fixtureBytes() {
  const zip = new JSZip()
  zip.file('ppt/theme/theme1.xml', FIXTURE_THEME)
  zip.file('ppt/slideMasters/slideMaster1.xml', FIXTURE_MASTER)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', FIXTURE_MASTER_RELS)
  zip.file('ppt/slides/slide1.xml', FIXTURE_SLIDE)
  zip.file('ppt/slides/_rels/slide1.xml.rels', FIXTURE_SLIDE_RELS)
  zip.file('ppt/notesSlides/notesSlide1.xml', FIXTURE_NOTES)
  zip.file('ppt/media/image1.png', FIXTURE_PNG)
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
}

// 读手给每页每形状发 newId()（带 Date.now()），两趟必然不同——等价腿只该看「导入结果」
// 一不一致，不该被流水号牵着走。归一化：把一切 id 字段的值抹成占位串再比
function stripIds(v) {
  if (Array.isArray(v)) return v.map(stripIds)
  if (v && typeof v === 'object') {
    const out = {}
    for (const [k, x] of Object.entries(v)) out[k] = k === 'id' ? '<id>' : stripIds(x)
    return out
  }
  return v
}

async function runSelftest(reader, probe) {
  const seen = probe.__PROBE.seen
  const bytes = await fixtureBytes()
  seen.clear()
  const deck = await reader.pptxBytesToDeck(bytes)
  const got = new Set(seen.keys())
  const fails = []
  for (const k of MUST_SEE) if (!got.has(k)) fails.push(`应看到而没看到 ${k}`)
  for (const k of MUST_NOT_SEE) if (got.has(k)) fails.push(`不该看到却看到 ${k}`)
  // 夹具必须真的产出了内容，否则上面的断言是在空转
  const s0 = deck.slides[0]
  if (!deck.slides.length) fails.push('夹具一页都没读出来')
  if (!s0 || !s0.title.includes('属性覆盖账夹具')) fails.push(`标题没读对：${s0 && s0.title}`)
  if (!s0 || !s0.body.includes('第一行正文')) fails.push('正文没读对')
  if (!s0 || s0.transition !== 'fade') fails.push(`切页没读对：${s0 && s0.transition}`)
  if (!s0 || s0.autoAdvance !== 5) fails.push(`自动换页没读对：${s0 && s0.autoAdvance}`)
  if (!s0 || !s0.notes || !s0.notes.includes('演讲者备注')) fails.push('备注没读对')
  const table = s0 && s0.shapes && s0.shapes.find((x) => x.kind === 'table')
  if (!table) fails.push('表格形状没读出来')
  else if (!table.table || !table.table.hasHeader) fails.push('表头行没读对（firstRow）')
  else {
    // v0.140：列宽/行高是「相对总和的分数」——两枚等宽列/两枚等高行 ⇒ 各 0.5
    if (table.table.bandRow !== true) fails.push('隔行底纹没读对（bandRow）')
    const cw = table.table.colW
    if (!cw || cw.length !== 2 || Math.abs(cw[0] - 0.5) > 1e-9) fails.push(`列宽没读对：${JSON.stringify(cw)}`)
    const rh = table.table.rowH
    if (!rh || rh.length !== 2 || Math.abs(rh[0] - 0.5) > 1e-9) fails.push(`行高没读对：${JSON.stringify(rh)}`)
  }
  const img = s0 && s0.shapes && s0.shapes.find((x) => x.kind === 'image')
  if (!img || !img.image || !img.image.startsWith('data:image/png;base64,')) fails.push('图片形状没读成 data URI')
  else if (img.alt !== '一张 1×1 的 PNG') fails.push(`图片替代文本没读对：${img.alt}`)
  // v0.140：自由文本框是斜体/下划线/锚点/形状名/替代文本的载体（占位符那支按设计不取字符样式）
  const txt = s0 && s0.shapes && s0.shapes.find((x) => x.kind === 'text')
  if (!txt) fails.push('自由文本框没读出来')
  else {
    if (txt.italic !== true) fails.push('斜体没读对（rPr@i）')
    if (txt.underline !== true) fails.push('下划线没读对（rPr@u）')
    if (txt.anchor !== 'middle') fails.push(`垂直锚点没读对：${txt.anchor}`)
    if (txt.name !== '自由文本框') fails.push(`形状名没读对：${txt.name}`)
    if (txt.alt !== '自由文本') fails.push(`替代文本没读对：${txt.alt}`)
  }
  if (!deck.master || deck.master.majorFont !== 'Calibri Light')
    fails.push(`主题标题字族没读对：${deck.master && deck.master.majorFont}`)
  if (!deck.master || deck.master.minorFont !== 'Calibri')
    fails.push(`主题正文字族没读对：${deck.master && deck.master.minorFont}`)
  if (!s0 || s0.animDur !== 500) fails.push(`入场时长没读对：${s0 && s0.animDur}`)
  let notes = 0
  for (const v of seen.values()) notes += v
  console.log(`SELFTEST|夹具 查问对=${got.size} 查问次数=${notes} 形状=${s0 && s0.shapes ? s0.shapes.length : 0}`)
  console.log(`SELFTEST|看到的全部键 ${[...got].sort().join(' ')}`)
  if (fails.length) {
    for (const f of fails) console.log(`SELFTEST|FAIL ${f}`)
    throw new Error(`夹具自检 ${fails.length} 条不通过`)
  }
  console.log(`SELFTEST|双向断言通过 应看到 ${MUST_SEE.length} 枚全命中，不该看到 ${MUST_NOT_SEE.length} 枚全落空`)
  seen.clear()
  return { bytes, deck }
}

// ---- 5. 主流程 ---------------------------------------------------------------

async function main() {
  const t0 = Date.now()
  const { count: modFiles, fromGit } = materialize(MOD_DIR)
  const applied = injectProbe(path.join(MOD_DIR, 'pptx-import.ts'), MUT)
  const reader = await import(`${path.join(MOD_DIR, 'pptx-import.ts').replace(/\\/g, '/')}`)
  const probe = await import(`${path.join(MOD_DIR, 'pptx-import.ts').replace(/\\/g, '/')}`)
  const seen = probe.__PROBE.seen

  let clean = null
  if (has('clean-pass')) {
    const CLEAN_DIR = path.resolve(REPO, 'tmp/pptx-fidelity-clean')
    materialize(CLEAN_DIR)
    clean = await import(`${path.join(CLEAN_DIR, 'pptx-import.ts').replace(/\\/g, '/')}`)
  }

  // 夹具腿先跑：它同时是自检（分子语义）与「无语料时的宇宙」
  const fixture = has('selftest') ? await runSelftest(reader, probe) : null

  let files = []
  let mode = 'fixture'
  try {
    files = corpusList()
    mode = 'corpus'
  } catch (e) {
    if (!has('selftest')) throw e
    console.log('REPORT|没给语料，跑 --selftest 夹具腿，宇宙=内置夹具')
  }

  // 夹具也要进账：mode=fixture 时它就是唯一那一「件」
  const jobs = []
  if (mode === 'fixture' && fixture) jobs.push({ name: '<fixture>', bytes: fixture.bytes })
  for (const f of files) {
    let bytes
    try {
      bytes = new Uint8Array(fs.readFileSync(f))
    } catch (e) {
      continue
    }
    jobs.push({ name: f, bytes })
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

  for (const job of jobs) {
    bytesTotal += job.bytes.length
    // 分子：读手在真实导入里的按名查问
    let deck
    let firstErr = ''
    try {
      deck = await reader.pptxBytesToDeck(job.bytes)
      ok++
    } catch (e) {
      const k = errClass(e)
      firstErr = k
      errs.set(k, (errs.get(k) ?? 0) + 1)
    }
    if (clean) {
      let cd
      try {
        cd = await clean.pptxBytesToDeck(job.bytes)
      } catch (e) {
        cd = `ERR:${errClass(e)}`
      }
      const probeOk = deck !== undefined
      const cleanOk = !String(cd).startsWith('ERR:')
      if (probeOk && cleanOk) {
        if (md5(JSON.stringify(stripIds(deck))) === md5(JSON.stringify(stripIds(cd)))) eqSame++
        else eqDiff++
      } else if (!probeOk && !cleanOk) {
        if (String(cd).slice(4) === firstErr) eqErrBoth++
        else eqDiff++
      } else {
        eqErrOne++
      }
    }
    // 分母：同一件、同一套部件，用同一只解析器数一遍属性字面
    try {
      const zip = await JSZip.loadAsync(job.bytes)
      const parts = await scopeParts(zip)
      const { pairs: pp, total } = await censusPairs(zip, parts)
      for (const [k, v] of pp) pairs.set(k, (pairs.get(k) ?? 0) + v)
      for (const p of parts) partTotals[p] = (partTotals[p] ?? 0) + (total[p] ?? 0)
    } catch (e) {
      errs.set(`census:${errClass(e)}`, (errs.get(`census:${errClass(e)}`) ?? 0) + 1)
    }
  }

  const totalOcc = sum(Object.fromEntries(pairs))
  // pptx 没有 docx 那族存档流水号（rsid/paraId）：没有独立的噪音档，
  // 但 lsdException 这类「样式表自记账」在本族不存在，故噪音恒为空并在报告里说明
  const noise = {}
  const covered = {}
  const uncovered = {}
  for (const [k, v] of pairs) {
    if (seen.has(k)) covered[k] = v
    else uncovered[k] = v
  }
  const meaningful = sum(covered) + sum(uncovered)
  const byElement = new Map()
  for (const [k, v] of Object.entries(uncovered)) {
    const p = k.split('|')[0]
    byElement.set(p, (byElement.get(p) ?? 0) + v)
  }

  const data = {
    measured: {
      ref: REF,
      source: fromGit ? `git:${REF}` : 'worktree',
      modules: modFiles,
      injections: applied,
      mode,
      domParser: '@xmldom/xmldom 0.8（devDependency；浏览器端用原生 DOMParser）',
    },
    corpus: {
      files: jobs.length,
      readable: ok,
      unreadable: jobs.length - ok,
      bytes: bytesTotal,
      scopeParts: [...PARTS_STATIC, 'ppt/slides/slideN.xml(+rels)', 'ppt/notesSlides/notesSlideN.xml'],
    },
    totals: {
      distinctPairs: pairs.size,
      occurrences: totalOcc,
      noisePairs: 0,
      noiseOccurrences: 0,
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
    neverConsultedByElement: [...byElement.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    partTotals,
    errors: Object.fromEntries(errs),
  }
  if (clean) data.equivalence = { identical: eqSame, differing: eqDiff, bothFailed: eqErrBoth, onlyOneFailed: eqErrOne }

  const mdPath = path.join(OUT_DIR, 'pptx-fidelity.md')
  const jsonPath = path.join(OUT_DIR, 'pptx-fidelity.json')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
  fs.writeFileSync(mdPath, renderMd(data), 'utf8')

  console.log(
    `REPORT|mode=${mode} ref=${REF} 件=${jobs.length} 读成=${ok} 分母对=${pairs.size} 字面=${totalOcc} ` +
      `有效=${meaningful} 已查问=${sum(covered)}`,
  )
  console.log(
    `REPORT|覆盖率 按对=${(data.coverage.byPair * 100).toFixed(1)}% 按字面=${(data.coverage.byOccurrence * 100).toFixed(1)}% ` +
      `注入=[${applied.join(',')}] 探针记录对=${seen.size} 用时=${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
  if (clean) console.log(`REPORT|等价腿 相同=${eqSame} 不同=${eqDiff} 两边同错=${eqErrBoth} 只一边错=${eqErrOne}`)
  console.log(
    `REPORT|写盘 ${path.relative(REPO, mdPath).replace(/\\/g, '/')} 与 ${path.relative(REPO, jsonPath).replace(/\\/g, '/')}`,
  )
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
  L.push('# PPTX fidelity: attribute-level coverage report')
  L.push('')
  L.push(
    'This report is generated by `scripts/fidelity-report-pptx.mjs`. It is **not** a count of implemented',
  )
  L.push(
    'commands: it compares every `element|attribute` literal that real .pptx files put on the wire',
  )
  L.push(
    'against the lookups our import path (`pptxBytesToDeck`) actually performs on them, at run time. A',
  )
  L.push(
    'pair counts as *consulted* only if the reader asked for it by name while a real import was running,',
  )
  L.push('through the single `ga` accessor every named lookup in `pptx-import.ts` goes through.')
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
    '| **noise** | *(empty tier)* | pptx has no Word-style save-session bookkeeping (`rsid*`/`paraId`); nothing qualifies |',
  )
  L.push('')
  L.push(
    `Measured on the committed product at \`${d.measured.ref}\` (\`${d.measured.source}\`, ${d.measured.modules} modules,`,
  )
  L.push(`probe injected into ${d.measured.injections.length} accessor: ${d.measured.injections.join(', ')}).`)
  if (d.measured.mode === 'fixture') {
    L.push('')
    L.push(
      '> **Fixture mode.** No .pptx corpus was on disk when this report was generated, so the universe',
    )
    L.push(
      '> below is the built-in `--selftest` fixture: one synthetic deck shaped like PowerPoint output',
    )
    L.push(
      '> (title/body placeholders, a free text box, a picture, a native table, a transition, and a',
    )
    L.push(
      '> three-effect timing tree). Every pair in it was placed by hand, so both assertion directions of',
    )
    L.push(
      '> the selftest are meaningful. Re-run with `--corpus <dir>` for the real ledger — the numbers below',
    )
    L.push('> are a working ledger of the machinery, not a claim about the population of real files.')
  }
  L.push('')
  L.push('## Scope: which parts the denominator counts')
  L.push('')
  L.push('| In | Out (and why) |')
  L.push('|---|---|')
  L.push(
    '| `ppt/theme/theme1.xml`, `ppt/slideMasters/slideMaster1.xml` (+ its rels), every `ppt/slides/slideN.xml` (+ rels), every `ppt/notesSlides/notesSlideN.xml` | `ppt/slideLayouts/*` (the reader never opens them — placeholder geometry comes from the slide itself and the master), `themeN`/`slideMasterN` for N>1 (only #1 is read), `docProps/*` (no rendering meaning) |',
  )
  L.push('')
  L.push('## Headline')
  L.push('')
  L.push('| | pairs | attribute literals |')
  L.push('|---|---:|---:|')
  L.push(`| In scope (${d.measured.mode === 'fixture' ? 'fixture' : `${d.corpus.readable} readable files`}) | ${n(d.totals.distinctPairs)} | ${n(d.totals.occurrences)} |`)
  L.push(`| Meaningful universe | ${n(d.totals.meaningfulPairs)} | ${n(d.totals.meaningfulOccurrences)} |`)
  L.push(`| Consulted | ${n(d.coverage.consultedPairs)} | ${n(d.coverage.consultedOccurrences)} |`)
  L.push(`| Never consulted | ${n(d.coverage.neverConsultedPairs)} | ${n(d.coverage.neverConsultedOccurrences)} |`)
  L.push('')
  L.push(`**Coverage: ${pct(d.coverage.byPair)} of distinct pairs, ${pct(d.coverage.byOccurrence)} of literals.**`)
  L.push('')
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
    '- **Consulted ≠ rendered.** A pair counts as consulted when the reader asked for it by name;',
  )
  L.push(
    '  whether the value changed the deck is a separate question this ledger does not answer.',
  )
  L.push(
    '- **The denominator uses the reader\'s own parser, in node.** The product parses with the',
  )
  L.push(
    `  browser DOMParser; this script substitutes \`${d.measured.domParser}\``,
  )
  L.push(
    '  (the library `pptx-import.ts` names in its comments) so the same code runs headless.',
  )
  L.push(
    '  `localName`, `getAttribute("r:embed")` and `getAttributeNS` were verified to agree.',
  )
  L.push(
    '- **Occurrence attribution is pair-level, like the docx report.** A pair consulted on one',
  )
  L.push('  element counts as consulted everywhere that pair appears.')
  L.push('')
  L.push('## Reproduce')
  L.push('')
  L.push('```sh')
  L.push('pnpm exec vite-node scripts/fidelity-report-pptx.mjs --selftest')
  L.push('pnpm exec vite-node scripts/fidelity-report-pptx.mjs --corpus /path/to/pptx --selftest')
  L.push('pnpm exec vite-node scripts/fidelity-report-pptx.mjs --corpus /path/to/pptx --clean-pass')
  L.push('pnpm exec vite-node scripts/fidelity-report-pptx.mjs --selftest --mut no-ga   # 覆盖率必须下降')
  L.push('```')
  L.push('')
  return L.join('\n')
}

main().catch((e) => {
  console.error(`REPORT|失败 ${e && e.message ? e.message : e}`)
  process.exit(1)
})
