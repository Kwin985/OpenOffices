# OpenOffices — 开源办公套件

> 天下苦 WPS / Office 久矣。这是一个用 **Rust + Tauri 2** 构建、完全由开源内核驱动的本地办公套件，
> 目标是文档（Writer）、表格（Calc）、演示（Impress）三件套，数据全程不出本机。

## 已实现（v0.2）

- **应用外壳**：类 WPS 首页、多标签工作区（标签右键菜单）、最近文件（持久化）、新建/打开/另存为、
  快捷键（Ctrl+O/S/Shift+S/W/N/Tab 切换）、拖拽文件到窗口打开、关闭前未保存确认、暗色/亮色主题、
  Workspace 懒加载（主包 8MB → 250KB）
- **表格（Calc）**：Univer 表格内核（中文界面、公式计算、工具栏），xlsx / xls / ods 读取与 xlsx / ods 写出，
  并支持导出 PDF（A4 横向，数据侧重排自绘网格）；
  第二轮新增社区高级预设五件套——**筛选排序、排序、条件格式、数据验证、查找替换**
  （注：Univer `preset-sheets-advanced` 属商业版，本项目只用 Apache-2.0 社区预设）
- **文档（Writer）**：TipTap 富文本（标题/加粗/斜体/下划线/删除线/对齐/列表/引用/代码块/表格/图片/链接），
  第二轮新增**字色、多色高亮、实时字数统计、打印/导出 PDF（系统打印对话框）**，
  颜色与高亮映射进 docx（`w:color` / `w:shd`）；docx 导入（mammoth）、docx 导出（docx）、
  ODT 双向（JSZip 直写/直读 ODF）、自有 `.odoc`（JSON）存档
- **演示（Impress-lite）**：自研轻量幻灯片编辑器——标题/要点/图片/空白四种版式、6 套主题色、
  页序调整、缩略图侧栏、全屏放映（←/→/空格翻页、N 切换备注、Esc 退出）；
  **pptx 导出**（pptxgenjs）与 **pptx 导入解析**（jszip + DOMParser，含图片提取还原），
  自有 `.opd`（JSON）存档格式；v0.15 起支持导出 PDF（每页一张全出血）

## 母版与备注（v0.4）

- **pptx 母版还原**：导入时解析 `slideMaster` + `theme1.xml`——背景（纯色/背景图）、主题配色
  （`clrScheme` 经 `clrMap` 映射，标题取 accent1、正文取 dk1）、标题/正文占位符几何（EMU → 相对定位），
  编辑画布、缩略图、放映与 pptx 导出全链路使用还原结果；单页背景覆盖（`slide.bg`）优先于母版
- **演讲者备注**：编辑区常驻备注面板，随 `.opd` 存档；pptx 导出经 pptxgenjs `addNotes` 写入
  notesSlide，导入时回收（自动剔除 sldNum/日期/页脚等占位噪声）；放映中按 **N** 浮现当页备注
- **往返保证**：自有导出 → 再导入的母版底色、备注、单页背景、要点内容均无损（Node 端 21 项结构断言 + 桌面 CDP 冒烟覆盖）

## 动画与演讲者视图（v0.5）

- **切页动画**：每页可选淡入/推入/擦除/劈开四种切换效果，放映时以 CSS 动画播放；导出经 JSZip
  后处理向 OOXML 注入 `<p:transition>`（pptxgenjs 原生不支持），导入时反向解析识别；
  与母版/备注同享 `.opd` ⇄ pptx 无损往返
- **演讲者视图**：放映中按 **P**（或点按钮）打开独立 Tauri 第二窗口——当前页大图、下一页预览、
  备注全文与计时器；跨窗口经 Tauri 事件总线实时同步，任一侧结束放映双向联动关闭

## 逐条动画与自动换页（v0.6）

- **要点逐条入场**：每页可选淡入/飞入/擦除三种逐条效果，放映与演讲者视图同步揭示——
  方向键/空格先揭示下一条，揭示完毕再换页（v0.7 起随 pptx 原生 timing 树往返，见下）
- **自动换页计时**：每页可设 1~3600 秒到点自动换页，导出写入 OOXML `<p:transition advTm>`、
  导入反向解析，与切换动画同族往返；末页计时器不触发

## PowerPoint 原生 timing 树（v0.7）

- **逐条入场导出**：含逐条动画的页向 slideN.xml 注入 PowerPoint 原生 `<p:timing>`——
  mainSeq 内每段一个 `clickEffect`（`set` 可见性 + 入场行为），`bldLst/bldP build="p"` 驱动逐段构建；
  淡入→`animEffect filter="fade"`、擦除→`wipe(down)`、飞入→`ppt_y` 位移动作，与 `<p:transition advTm>` 共存且顺序符合 schema
- **逐条入场导入**：解析任意来源 pptx 的 timing 树，按 `bldP`+`animEffect` 滤镜/`ppt_*` 动作识别
  fade/wipe/fly 并还原为本地逐条放映；无 `bldP` 的整形效果不误判为逐条
- **形状定位**：pptxgenjs 不给形状可预测 id，导出后处理按正文首行文本反查所在 `<p:sp>` 的 `cNvPr id` 作为 `spid`

## xlsx 样式与合并往返（v0.8）

- **样式通道**：单元格载荷新增 `s`（加粗/斜体/字号/字色/底色）与 `merges` 合并区，
  xlsx ⇄ Univer 全链路映射——导入时样式去重注册进快照 `styles`（`oo{n}` id 引用），
  保存时反向解析回写 `rust_xlsxwriter` `Format`
- **样式读取**：calamine 不公开样式 API，故用 `zip` + `quick-xml` 直接解 xlsx 的
  `styles.xml` / `sheet.xml`（字体、填充、cellXfs、mergeCells），与 calamine 的值读取按坐标缝合；
  两 crate 均已在依赖树中，产物体积零增量
- **合并单元格**：导入映射为 Univer `mergeData`（单格"合并"自动过滤）；导出时合并区先行
  `merge_range` 写入左上值与格式，被覆盖格子跳过不重复写
- **边界行为**：空值但带底色的格子从样式表补回保留；往返丢失的仅样式细节以外的少数格式维度
  （边框/对齐/数字格式暂未纳入）

## 动画方向/出场 + PowerPoint 实机回归（v0.9）

- **入场方向**：飞入/擦除支持上下左右四向——UI 每页可选「从上方/右侧/下方/左侧」，`.opd` 存
  `animDir`；pptx 导出映射为原生 `presetSubtype` 方向位（上1/右2/下4/左8），飞入按方向选
  `ppt_x`/`ppt_y` 轴与 `#+y+1` 类屏外起点，擦除滤镜取扫过反方向（从下方→`wipe(up)`）
- **逐条出场**：每页可选「出场 · 淡出」；放映揭示满后每击退一条（FIFO，步数 = 2×段数），
  CSS `fill-mode: forwards` 保持退场隐藏；pptx 导出追加 `presetClass="exit"` 的
  `animEffect transition="out" filter="fade"` clickEffect，与入场共用同一 `bldP`
- **导入识别**：timing 树解析优先 `presetSubtype` 位、其次 wipe 滤镜反查、再次飞入 `strVal`
  符号轴判向；`exit` clickEffect 识别为出场动画
- **实机回归**：导出的 pptx 由本机 PowerPoint 16.0（COM 无界面）打开不修复并另存，重存文件
  保留全部 6 个 clickEffect、`presetSubtype="8"`、`build="p"`、`advTm`——方向与出场被
  PowerPoint 原生接受；该重存文件再经我们的导入器仍识别 fly/left/fade，双向往返闭环

## 文档页眉页脚与目录（v0.10）

- **页眉页脚设置**：工具栏「页眉页脚」面板——页眉/页脚文本 + 页码开关，随 `.odoc` 的 `meta`
  存储；编辑界面在纸面上/下缘实时渲染预览条（页码显示占位 `[页码]`）
- **docx 导出**：页眉写入 section `headerReference`（右带细线），页脚含页码时生成原生
  `PAGE` 域（"第 X 页"）；`features.updateFields` 让 Word 打开即刷新域
- **目录节点**：TipTap 原子节点（NodeView 不存正文），按标题 1-4 实时汇总、点击滚动跳转；
  导出映射为 Word 原生 TOC 域（`\o "1-4" \u` + 标题段落大纲级别），本机 Word 16.0 实机确认
  更新域后生成"第一章 起源 · 第 1 页"式条目；另配 `settings.xml` updateFields
- **docx 导入**：mammoth 不读页眉页脚，用 JSZip 直读 `sectPr` 的 `headerReference`/
  `footerReference`（取 `w:type="default"` 项）抽文本并识别 PAGE 域；Word 重存的规范化
  docx 亦被容错解析，双向闭环
- **许可注记**：表格图表经调研确认 Univer 图表插件属 `@univerjs-pro` 商业授权，社区版
  不可用，故图表继续单列并评估 VChart（Apache-2.0）自绘路线

## 文档批注（v0.11）

- **批注模型**：`meta.comments`（id/作者/日期/内容/已解决）+ 正文 `comment` mark 按 `cid`
  锚定选区；随 `.odoc` 持久化，侧栏实时汇总
- **批注侧栏**：选中文字「新建批注」→ 输入内容确定；卡片支持定位滚动、解决/重新打开、删除
  （同步移除正文锚点）；原文被删的孤儿批注标注"原文已删除"；正文锚点黄色高亮
- **docx 导出**：写原生 `word/comments.xml` 批注部件 + 正文 `w:commentRangeStart/End`（
  `commentReference` 须包在 `w:r` 内）；`resolved` 经 `commentsExtended.xml` 落盘（docx 库要求
  存在 `parentId` 才生成该部件，以 `-1` 触发且不产出伪造父链接）；每个批注全局只写一组 range
  ——同 id 多组 range 会被 Word 判定文档损坏；孤儿批注不写入 docx
- **docx 导入**：JSZip 直读 `comments.xml`（内容/作者/日期）与 `document.xml` 的单段落
  range 锚文本，在 mammoth HTML 中把锚点包成 `span[data-oo-comment]` 还原为 mark；
  跨段/被格式打断的锚点降级为侧栏未定位条目；`w14:paraId` 属性式与 `w15` 式都容错
- **实机回归**：本机 Word 16.0（COM）打开导出文件不修复，`Comments.Count=3`，作者、
  批注正文、`Scope.Text` 锚文本（含 `&` 实体）全部正确；规范重存回测因当日 Word COM
  SaveAs 环境故障顺延（见开发备注）

## PDF 查看与导出（v0.12）

- **PDF 查看**：新增 `pdf` 标签种类，pdfjs-dist（Apache-2.0）渲染——上下页、缩放 50%~300%、
  worker 分离加载；cmaps/standard_fonts 由 `scripts/copy-pdfjs-assets.mjs` 在 dev/build 前复制到
  `public/pdfjs`（gitignore）；pdf 只读、不可新建，打开/拖拽/最近文件全支持
- **文档导出 PDF**：Rust `export_pdf` 命令走 WebView2 原生 `PrintToPdf`（`with_webview`（稳定
  API，非 unstable）取 `ICoreWebView2_7`，`ICoreWebView2Environment6.CreatePrintSettings` 设
  背景色/页边距），无对话框、按 `@media print` 样式矢量出图；实机验证 4 页分页、54 个编号
  段落齐全、高亮底色保留（`print-color-adjust: exact`）
- **顺带修复真实数据丢失 bug**：TipTap 3 `getJSON` 的文本节点是**顶层 `text`** 而非
  `attrs.text`，docx 导出此前只读后者——应用真实保存的文档导出 docx 正文全空；历史结构测试
  用同错格式造夹具故未暴露。现两者兼容、夹具改用应用真实产物格式重建，本机 Word 16.0 只读
  回归通过（Pages=3、批注锚文本与正文正确）
- **范围**：表格/演示导出 PDF 暂未纳入；查看器的文字选择复制与全文搜索未做

## 表格图表（v0.13）

- **渲染路线**：Univer 图表插件属 `@univerjs-pro` 商业授权不可用，改用 **VChart**（MIT）
  自绘——图表数据渲染成 PNG 后经社区绘图预设（`UniverSheetsDrawingPreset`，Apache-2.0）以
  **浮动图片**（`FOverGridImage`）落在网格上；VChart 走动态导入独立分包（约 548KB gzip），
  仅首次插入/还原图表时加载
- **插入与刷新**：选中 ≥2行×2列 数据区（首行系列名、首列类别）→「插入图表」对话框，
  柱形/条形/折线/面积/饼/环形 × 标准/堆叠/百分比堆叠分组；改数据后「刷新图表」按引用
  重读现值重出 PNG；图表随拖拽/缩放保留锚点
- **xlsx 原生往返（写）**：`write_xlsx` 用 `rust_xlsxwriter` 生成真图表部件
  （chartN.xml + drawing 锚点），保存的文件 Excel 可直接编辑图表；数据引用按 A1 区间写
  `numRef/strRef`，不带缓存值，Excel 打开即按实时网格计算
- **xlsx 原生往返（读）**：`xlsx_chart.rs` 以 zip + quick-xml 解析任意来源 xlsx 的
  `barChart/lineChart/pieChart/doughnutChart/areaChart`——系列名/类别/数值引用、标题
  （含 `&` 实体还原）、`oneCellAnchor/twoCellAnchor` 锚点与 EMU 尺寸，数值再从实时网格取值解析
  （不信缓存），重开文件图表按位置尺寸还原
- **实机回归**：本机 Excel 16.0（COM 只读）打开应用保存的三图表文件——`ChartObjects=3`，
  柱形 51×2 + 饼 5、系列数与标题正确；cargo 12 项测试含列形+饼双图表写读往返断言

## ODF 原生格式（v0.14）

- **ODS 写出**：新增 `ods.rs`——`write_ods` 命令把与 xlsx 共用的工作簿载荷直接生成 ODF 包
  （mimetype 首条不压缩 + manifest + content.xml/styles.xml），单元格值（文本/数值/布尔）、
  粗体斜体字号字色底色（自动样式去重 `ce1..`）、合并区（spanned + covered-table-cell）、
  稀疏行列全部按 ODF 规范落盘
- **按扩展名分流保存**：修复此前 `.ods` 路径会被写入 xlsx 字节的 bug——表格保存按目标扩展名
  在 `write_xlsx` / `write_ods` 间路由，另存为对话框同时提供两种过滤器；ODS 不含图表时状态栏提示
- **ODT 双向**：前端 `lib/odt.ts`（JSZip + DOMParser，零新依赖）实现 ProseMirror JSON ↔ ODT——
  导出覆盖标题(H1-H4)/粗斜下删/字色高亮等字符样式（`C1..` 去重）/对齐/有序无序列表/代码块/引用/
  表格合并/图片内嵌（`Pictures/`）/超链接/页眉页脚含 PAGE 页码域；导入按样式表反解析回 HTML 挂进编辑器
- **范围限制**：ODS 读侧仍走 calamine 值通道（ODF 样式/合并暂不解析回 Univer，ODT 不含批注与目录域）；
  ODT 导出以应用自身能力子集为准，未覆盖脚注/锚定框架等
- **验证**：calamine（真实读侧实现）读回自写 ODS 值/布尔/稀疏/转义断言；zip 布局断言（mimetype 首条
  Stored）；CDP 冒烟全程走应用真实链路——打开夹具 ODS → Univer 改值 → 保存分流 → 解包断言 → 重开显新值；
  ODT 导出/导入/编辑器加载/原地写回（含图片）全链路；本机无 LibreOffice 且 WPS COM（KWPS）与 Word 一样
  存在自动化挂起故障，ODF 实机回归以结构断言替代

## PDF：表格与演示导出（v0.15）

- **共享打印覆盖层**：新增 `lib/pdfprint.ts`——把任意 DOM 挂成 `#oof-print-host` 打印覆盖层，
  临时注入打印样式后调 `export_pdf` 落盘再清理；关键一处是打印时必须放开外壳的
  `html,body{height:100%;overflow:hidden}`，否则整个应用被裁成一屏、多页内容全丢
- **export_pdf 支持纸张与边距**：Rust 侧新增 `margins`（英寸，`None` 用默认 0.5/0.6）与
  `page`（纸张宽高）参数，走 `ICoreWebView2PrintSettings`；实测 `@page size` 在 PrintToPdf
  下不生效，且 PageWidth/PageHeight 语义是「纵向纸」边长、`Orientation` 再整体转置，
  故横向须先交换宽高
- **演示导出**：`PptEditor` 用 `createRoot` 把每张幻灯片挂进离屏容器，`StaticSlide` 复用
  放映版式，每页 1280×720px 对应 338.7×190.5mm 零边距纸，出片即 960×540pt 全出血，
  与放映视图同字号比例（em 基准 17px）；图片幻灯片等解码完成后再打印
- **表格导出**：Univer 是 canvas 渲染，PrintToPdf 抓不到，改走保存同源的工作簿载荷——
  `lib/sheet-print.ts` 纯函数把 `WorkbookPayload` 自绘成 HTML 网格（值、粗体/斜体/字号
  pt→px/字色/底色、合并 `rowspan/colspan` 覆盖矩阵、`colgroup` 列宽、每表分页），A4 横向输出；
  超过 2000 行 × 120 列截断并在页尾提示
- **范围限制**：表格 PDF 不含图表（浮动图片不在载荷里）与边框/数字格式/对齐等样式子集之外
  的属性；演示 PDF 不经 pptx 中转，直接以网页排印复刻放映比例
- **验证**：cargo 15 项测试；tsc 与 `pnpm build` 全绿；CDP 冒烟用 pdf.js 读回导出文件断言——
  样张三页 960×540 全出血、演示三页标题与要点齐全、图片幻灯片 image 算子仅落在图页、
  表格夹具值/样式/合并 HTML 断言 + 导出 841.9×595（A4 横向）+ 填满后 3 页分页、
  文档导出（不传新参数）None 分支回归通过

## 性能（v0.3）

- **按编辑器分包 + 懒加载**：主包 8MB → 首屏约 300KB；Univer（6.1MB）只在首次激活表格标签时加载，
  TipTap/docx（836KB）与 pptxgenjs/jszip 同理按编辑器按需加载，mammoth/pptxgenjs/jszip 进一步延迟到导入/导出动作
- **编辑器懒挂载**：标签首次激活才创建 Univer/TipTap 重型实例，之后切换保留状态不重复初始化
- **渲染裁剪**：三个编辑器与幻灯片缩略图 `React.memo` 化；store 的 `markDirty` 幂等去重，
  避免 Univer 每条命令都触发无关标签重渲染
- **Rust release profile**：`lto = true`、`codegen-units = 1`、`strip = true`、`panic = "abort"`

## 技术栈与开源组件

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| [Tauri 2](https://tauri.app) | 桌面壳（Rust 后端 + 系统 WebView） | MIT |
| [Univer](https://univer.ai) | 电子表格内核（渲染/公式/撤销重做）+ 筛选/排序/条件格式/数据验证/查找替换/绘图社区预设 | Apache-2.0 |
| [VChart](https://visactor.io/vchart) | 表格图表自绘（PNG 渲染 → 浮动图片），动态导入懒加载 | MIT |
| [TipTap 3](https://tiptap.dev) | 富文本编辑器内核（ProseMirror），含 color / highlight / character-count 扩展 | MIT |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js) | docx → HTML 导入 | BSD-2 |
| [docx](https://github.com/dolanmiu/docx) | ProseMirror JSON → docx 导出 | MIT |
| [pptxgenjs](https://gitbrent.github.io/PptxGenJS/) | 幻灯片 → pptx 导出 | MIT |
| [JSZip](https://github.com/Stuk/jszip) | pptx/odt（zip）解包与 ODT 打包 | MIT |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | PDF 查看渲染（worker + cmaps/标准字体） | Apache-2.0 |
| [webview2-com](https://docs.rs/webview2-com) + [windows](https://github.com/microsoft/windows-rs) | PrintToPdf 原生调用（wry 依赖树内，零体积增量） | MIT / Apache-2.0 |
| [calamine](https://github.com/tafia/calamine) | Rust xlsx/xls/ods 读取 | MIT |
| [rust_xlsxwriter](https://github.com/jmcnamara/rust_xlsxwriter) | Rust xlsx 写出（含 Format 样式/合并） | BSD-2 / Artistic-2.0 |
| [zip](https://github.com/zip-rs/zip) | Rust xlsx 解包（读取样式/合并 XML）+ ODS 打包写出 | MIT |
| [quick-xml](https://github.com/tafia/quick-xml) | Rust OOXML 流式解析 | MIT |
| [zustand](https://github.com/pmndrs/zustand) | 前端状态管理 | MIT |
| React 19 + Vite | UI 框架与构建 | MIT |

## 架构

```
src-tauri/            Rust 后端
  src/xlsx.rs         read_xlsx (calamine) / write_xlsx (rust_xlsxwriter) 命令，含样式、合并区与图表往返
  src/xlsx_style.rs   zip + quick-xml 直读 xlsx 的 styles.xml / mergeCells（calamine 无样式 API）
  src/xlsx_chart.rs   zip + quick-xml 直读 chartN.xml + drawing 锚点，系列值按实时网格解析
  src/ods.rs          write_ods 命令：共用 xlsx 载荷 → ODF zip（mimetype/manifest/content/styles），含样式去重与合并
  src/pdf.rs          export_pdf 命令：with_webview → WebView2 PrintToPdf（边距/纸张尺寸参数，cfg windows）
  capabilities/       dialog + fs 权限与路径作用域
src/                  React 前端
  store.ts            标签页 / 最近文件 / 主题（zustand）
  App.tsx             全局快捷键、拖拽打开、关闭确认、懒加载路由
  lib/univer.ts       Univer 实例工厂（公式 worker + 六个社区预设，含绘图 FOverGridImage）
  lib/univer-io.ts    xlsx 数据+样式/合并/图表 ↔ Univer 快照 转换（样式去重注册）
  lib/chart.ts        ChartPayload → VChart spec → 离屏 canvas PNG dataURL（动态导入分包）
  lib/docx.ts         docx 导入导出（ProseMirror JSON ↔ docx，字色/高亮/页眉页脚/TOC 域/批注映射；文本节点兼容顶层 text 与 attrs.text）
  lib/toc-extension.ts TipTap 目录原子节点：按标题实时汇总、点击跳转
  lib/comment-extension.ts comment mark（cid 锚定批注）+ 加/删/定位/汇总工具
  lib/odt.ts          ProseMirror JSON ↔ ODT（JSZip 打包导出 + DOMParser 导入，字符样式/合并表/图片/页码域）
  lib/ppt.ts          .opd 幻灯片数据模型（版式/主题/序列化）
  lib/pdfprint.ts     打印覆盖层：挂 DOM → 注入打印样式 → export_pdf → 清理
  lib/sheet-print.ts  WorkbookPayload → 打印 HTML 网格（值/样式子集/合并/分页/截断）
  lib/pptx-export.ts  Deck → pptx（pptxgenjs）
  lib/pptx-import.ts  pptx → Deck（JSZip 解包 + OOXML 解析 + 媒体还原）
  lib/registry.ts     跨组件保存器注册表（Ctrl+S 路由到当前标签）
  lib/open.ts         路径→标签 打开 / 带确认关闭
  components/         Home / Workspace / SheetEditor / DocEditor / PptEditor / PdfViewer（pdfjs-dist 懒加载）
scripts/              copy-pdfjs-assets.mjs（dev/build 前复制 cmaps/标准字体到 public/pdfjs）
```

表格文件流：`xlsx/ods 磁盘 → Rust(calamine 值 + zip/quick-xml 样式合并图表) → JSON 快照 → Univer 渲染（图表经 VChart 出 PNG 浮动图片）`；保存按扩展名分流——`.xlsx` 经 `rust_xlsxwriter`（含原生图表部件）、`.ods` 经 `ods.rs` 生成 ODF 包。
文档文件流：`docx → mammoth 正文 + zip 直读页眉页脚/批注 → HTML/元数据 → TipTap`；`.odt` 走 `lib/odt.ts` 双向；保存为 `.odoc` JSON（含 meta）或导出 docx/odt。
演示文件流：`pptx → JSZip 解包 OOXML → Deck 模型 → 编辑器`；保存为 `.opd` JSON 或经 pptxgenjs 导出 pptx。
PDF 文件流：查看 `pdf 磁盘 → readBytes → pdfjs-dist（worker + canvas）`；文档导出 `@media print 排版 → Rust export_pdf → WebView2 PrintToPdf 落盘`；演示导出 `Deck → createRoot 离屏挂载 StaticSlide 分页 → 同上`；表格导出 `Univer 快照 → WorkbookPayload → lib/sheet-print.ts 自绘 HTML 网格 → 同上（canvas 抓不到故走数据侧重排）`。

## 开发

```bash
pnpm install
pnpm tauri dev     # 桌面调试
pnpm build         # 前端类型检查 + 打包
cargo check        # Rust 后端检查（在 src-tauri 下）
```

环境要求：Rust (MSVC)、Node ≥ 20、WebView2 运行时。

> `pnpm dev` / `pnpm build` 会先跑 `scripts/copy-pdfjs-assets.mjs`，把 pdf.js 的 cmaps 与标准字体
> 复制到 `public/pdfjs`（该目录已 gitignore，不入库）。

> 开发备注（2026-09-19）：本机 Word COM 出现任意文档 `SaveAs/SaveAs2` 均挂起的环境故障
> （新建空白也卡、无对话框、与文件内容和落盘位置无关），只读回归（Open + 批注枚举）不受影响；
> v0.11 批注的"Word 规范重存回测"顺延，恢复前先跑新建空白文档保存探针验证 COM 可写。

## 路线图

- [x] 演示：pptx 母版/背景图还原、演讲者备注
- [x] 演示：动画、演讲者视图（双屏备注独立窗口）
- [x] 演示：元素级动画（逐条入场）与自动换页计时
- [x] 演示：动画映射 PowerPoint 原生 timing 树（元素级跨端保真）
- [x] 演示：动画方向/出场效果补全 + PowerPoint 实机回放回归确认
- [x] 表格：样式（字体/颜色/合并）随 xlsx 往返
- [x] 表格：图表（VChart 渲染 PNG + Univer 社区浮动图片 + xlsx 原生图表往返，Excel 实机确认）
- [x] 文档：页眉页脚（含 PAGE 页码域）与目录（原生 TOC 域）docx 往返，Word 实机回归
- [x] 文档：批注（锚点标记 + 侧栏面板 + docx comments 往返）
- [x] PDF 查看（pdf.js）与文档导出（WebView2 PrintToPdf）
- [x] PDF：表格/演示导出
- [x] ODF（ods/odt）原生格式
- [ ] 本地文件关联与"最近项目"跨设备同步（可选、端到端加密）

## License

本项目代码 MIT；各内核组件遵循上表各自许可证。
