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
- **范围**：表格/演示导出 PDF 暂未纳入；文字选择复制已由 v0.23 TextLayer 补齐，全文搜索见 v0.24

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
- **范围限制**：ODS 读侧仍走 calamine 值通道（ODF 样式/合并暂不解析回 Univer，ODT 不含目录域）；
  ODT 导出以应用自身能力子集为准，未覆盖脚注/锚定框架等
  （**v0.40 修订**：脚注/尾注这一档已经补上——ODF 1.2 内联写法导出、旧版 `text:note` 外壳也读得进，见 v0.40 一节）
  （**v0.86 修订**：批注这一档也已补上——`office:annotation` 读写往返 + 打开自动开侧栏，见 v0.86 一节；
  resolved 状态与目录域仍不往返）
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

## 文件关联与端到端加密同步（v0.16）

- **文件关联**：`bundle.fileAssociations` 声明四组扩展名（表格/文档/演示/PDF，PDF 为 Viewer
  只读语义），Windows 安装器写注册表后双击即把文件路径作为进程参数传给应用
- **单实例转发**：接入 `tauri-plugin-single-instance`——二次启动不再开新进程，把 argv 中
  过滤出的文件路径 emit `oof://open-paths` 给已开窗口并还原聚焦主窗；首启路径则进启动状态，
  前端挂载时经 `take_startup_files` 一次取走（与拖拽打开、最近文件共用同一 `openPath` 链路）
- **argv 过滤纯函数**：只认 `OPEN_EXTS`（与前端 `kindOfPath` 保持一致）匹配的扩展名、去引号、
  大小写不敏感，拒绝无扩展名与 `--flag` 类参数；Rust 3 项单测覆盖
- **端到端加密同步**：新增 `lib/sync.ts`，纯 WebCrypto 零新依赖——口令经 PBKDF2-SHA256
  （15 万次迭代 + 16B 随机盐）派生 AES-256-GCM 密钥，把「最近打开」密封成 `.oosync`
  JSON 文本信封（salt/iv/data 均 base64），丢进任何网盘即可完成跨设备搬运；解密校验
  app/kind/v 字段，口令错误或文件被篡改由 GCM tag 兜底报「解密失败」，条目按形状过滤；
  `mergeRecents` 按路径去重保新、时间倒序截 30 条落盘。口令不落盘、应用无密钥，真端到端
- **首页操作**：最近打开区新增口令输入框与「导出加密副本 / 从加密副本合并」按钮及状态行
- **验证**：cargo 18 项测试全绿（含 3 个新单测）；tsc 与 `pnpm build` 全绿；CDP 冒烟——
  信封形状、加解密往返、错误口令拒绝、非法条目过滤、非同步文件识别、mergeRecents 去重
  计数与持久化共 7 断言全 true；双实例真实冒烟——二次 `openoffices.exe <文件>` 启动后自行
  退出，主窗口标签与最近记录出现该文件，连开两文件两标签，期间 CDP page 目标与进程数恒 1

## 发布工程（v0.17 · v0.21 CI 实测跑通）

- **一键发布流水线**：新增 `.github/workflows/release.yml`——推 `v*` tag（或手动 dispatch）触发
  windows-latest + ubuntu-22.04 矩阵；先跑 `cargo test --lib` + `tsc --noEmit` 门禁，再过
  `tauri-action` 打包出 GitHub Release（NSIS/MSI 与 deb/AppImage），Linux 侧顺带首次真实编译
  了 pdf.rs 的非 Windows cfg 分支；macOS 暂不入矩阵（无签名凭据，列入后续）
- **CI 端到端实测**（tag v0.21.0 三轮修正后跑通）：①双平台 Type check 红——`@tiptap/core`/
  `@tiptap/extensions` 被源码直接 import 却未声明为直接依赖，本机旧 node_modules 掩盖（本机绿≠CI绿，
  以 `pnpm install --frozen-lockfile` 干净安装为准）；②"假绿"——tag push 触发时 tauri-action 不
  自动推断标签，缺 `tagName` 输入会静默跳过上传（`No releaseId or tagName provided, skipping
  all uploads...`），显式传 `tagName`/`releaseName`/`releaseDraft: false` 后 Release 正常发布
  win（exe/msi）+ linux（deb/rpm/AppImage）五产物；③Linux 首跑编译一次通过（约 17 分钟）
- **Actions 分钟止血（2026-09-23）**：私有仓库每月仅 2000 分钟，本周期已用 1833，几乎全被
  Release CI 吃掉（Windows runner 按 2× 计、占约 3/4）。`release.yml` 改为：推 `v*` tag 只打
  Linux，Windows 与 `cargo test` 挪到 `workflow_dispatch` 手动勾选（`build_windows` / `run_tests`），
  正常发版不再自动跑测试；apt 依赖加 `actions/cache` + `--no-install-recommends`；两条 job 各设
  `timeout-minutes` 兜底。Windows 包改由本机 `pnpm tauri build` 产出后按需上传，或发版时手动触发一次
- **本机产物链路**：`pnpm tauri build` 全量走通——release+lto 首编 4m54s，产物 NSIS 8.5MB /
  MSI 9.5MB；NSIS 静默安装→`%LOCALAPPDATA%\OpenOffices` 用户级免管理员→注册表 `.ods/.xlsx/
  .opd` 等 ProgId 与 `"%1"` 打开命令齐备→带文件参数启动真实出标签→静默卸载清理干净
- **修 MSI 打包阻塞 bug**：fileAssociations 的中文 `description` 会让 WiX light.exe 在
  en-US 代码页 1252 下报 LGHT0311（每个扩展名一条），关联描述须用 ASCII
- **修「点 X 无法退出」bug**（用户实报）：Tauri v2 关闭链路在 JS 确认后调 `plugin:window|destroy`，
  capabilities 缺 `core:window:allow-destroy` 时 ACL 拒绝、窗口静默卡死；dev 期全用强杀故未暴露。
  同期修正异步确认框时序：`preventDefault()` 必须同步调用、用户同意后再自行 `destroy()`，
  否则"未保存确认"形同虚设
- **后续发布项**：自动更新通道（v0.45 已出**检测层**：本机签名的清单 + 提示 + 跳下载页；应用内下载安装
  仍待真实更新源托管决策——**这句 v0.82 起改口**：下载与安装两拍已接线、闸立在「装」之前，而更新源托管
  **仍未定**，所以端点继续是占位 URL）、macOS 打包

## 表格保真补全（v0.18）

- **xlsx 读侧样式扩展**：`styles.xml` 直解器升级为 StyleBook（fonts/fills/borders/cellXfs/numFmts
  五段联动，`<xf>` 的 Start+子元素 alignment 两种形态都吃），边框四边线型+颜色、水平/垂直对齐、
  自动换行、数字格式 pattern 全读回；写侧 rust_xlsxwriter Format 对齐双设（`FormatAlign` 水平/垂直
  两次 `set_align` 互不覆盖）+ 逐边边框 + `set_num_format`；numFmt 覆盖 builtin id 表
  （`0%`/`0.00%`/`#,##0.00`/`@` 等）与自定义段（日期 id 跳过——calamine 已把日期字符串化）
- **ODS 读侧样式/合并**：`ods.rs` 新增 `read_ods_styles` 直解 content.xml 的 automatic-styles +
  表格遍历——单元格边框 `0.5pt solid #hex` 按关键字/宽度带映射回线型（hair<0.2pt、thin≤1.0、
  medium≤2.0、thick 以上，LibreOffice 的 0.26pt thin 可原样读回）、字色/底色/对齐/换行，
  以及 `number-columns-repeated`/`covered-table-cell`/`number-*-spanned` 合并语义；
  `read_xlsx` 命令按扩展名分流两套直解器，calamine 继续只负责值
- **前端全链路接入**：`CellStyle` 载荷扩 `bd/ho/vo/wb/nf` 五字段；`univer-io` 与 Univer 快照双向桥
  （BorderStyleTypes 1~13 ↔ 线型名、对齐枚举换算——Univer 的 RIGHT=3 并非 xlsx 顺序）；
  `sheet-print` 打印网格消费新字段：逐边 border CSS、水平/垂直对齐、换行、数字格式实排
  （`@` 透传、`%` 乘百后缀、小数位/千分位），导出 PDF 的表格自此带上边框/对齐/格式化数字
- **验证**：cargo 22 测全过（新增 xlsx 边框/对齐/数字格式往返、ODF 边框宽度映射、ODS 样式合并
  经真实 `read_xlsx` 拼合读回等 4 项）+ Node 打印纯函数 15 断言 + CDP 14 断言全链路
  （夹具文件 → Rust 读样式 → payload → Univer 快照 → 换回 payload → 打印 HTML）全绿

## 表格保真二期：列宽/行高/字体族（v0.19）

- **尺寸像素主线**：`SheetPayload` 新增 `colWidths/rowHeights`（列/行号 → 像素，与 Univer 快照
  同单位）；xlsx 读侧 `<col width>` 按 Excel 口径 `round(chars*7+5)`（MDW=7 + 5px 内边距）换算、
  `<row ht>` 按 `round(pt*4/3)`；`<col>` 的 min/max 区间展开到每列（单区段钳 2048 列防炸）；
  写侧用 rust_xlsxwriter 像素级 API，列宽先扣 5px 补偿其序列化不扣边距的口径差，实现 ±0 精确往返
- **ODS 尺寸双向**：写侧新增 `co{n}/ro{n}` 维度样式（px→cm @96dpi），`table-column`/`table-row`
  按等宽 run 分组以 `number-columns-repeated` + `style:style-name` 引用；读侧直解
  `style:column-width`/`style:row-height`，长度单位 cm/mm/pt/in/pc/px 统一化回像素，
  与既有 automatic-styles 遍历共用列序推进
- **字体族 ff**：`CellStyle` 新增 `ff`；xlsx StyleBook 补读 `<font><name val>` 且写侧
  `Format::set_font_name`；ODS 写 `style:font-name` + `fo:font-family` 双属性、读侧二者取一；
  默认字族名（Calibri/等线）如 fs≠11 一样在两侧过滤掉减噪
- **前端桥接**：`payloadToWorkbook` 把尺寸写进 Univer `columnData.w`/`rowData.h`（并把尺寸行列入
  行列数扩展）；`workbookToPayload` 反读，自适应行高（`ia=1`）取实际渲染值 `ah`；样式去重键与
  Univer `ff` 字段打通；`sheet-print` 逐列生成 `colgroup`、逐行 `<tr style="height:…">`、
  单元格 `font-family`（字族名先剥 CSS 非法字符），导出 PDF 的表格从此有真实版式与字体
- **验证**：cargo 25 测全过（新增 xlsx 尺寸/字族往返、ODS 尺寸/字族读回、`odf_len_to_px` 单位换算
  3 项）+ CDP 15 断言全绿（xlsx 与 ods 双夹具 → Rust 读 → Univer 快照桥 → 保存回传 → 打印 HTML）

## 表格保真三期：隐藏行列 + 冻结窗格（v0.20）

- **载荷扩展**：`SheetPayload` 新增 `hiddenRows/hiddenCols`（0 基索引数组）与 `freeze`
  （顶部冻结行数 + 左侧冻结列数）；`read_xlsx` 合并侧统一带出，xlsx/ODS 共用同一通道
- **xlsx 双向**：读侧 `<col hidden="1">`/`<row hidden="1">`（隐藏优先于宽度解析）与
  `<pane xSplit ySplit state="frozen">`（仅认 frozen，split 滚动条不算）；写侧
  `set_row_hidden`/`set_column_hidden`/`set_freeze_panes`，±0 往返
- **ODS 双向**：隐藏行列注册进既有 `co{n}/ro{n}` 维度样式表——`style:visibility="collapse"`
  与宽度/高度可共存（复合键 `{px}|1`）、纯隐藏走哨兵键 `h|1`；读侧按样式名集合展开
  `number-columns/rows-repeated` 区间；冻结窗格按 LibreOffice 惯例写进 styles.xml 的
  `office:settings → ViewSettings/Tables` 每表一条 map-entry（Columns/Rows/IsFrozen），
  读侧按表序索引回填
- **前端桥接**：`payloadToWorkbook` 把隐藏写进 Univer `columnData.hd`/`rowData.hd=1`（与
  `w`/`h` 共存合并）、冻结写 `freeze {xSplit/ySplit/startRow/startColumn}`；
  `workbookToPayload` 反读同三通道；`sheet-print` 整行整列剔除隐藏格（合并区跨隐藏列的
  colspan 按近似保留），导出 PDF 与屏显一致
- **验证**：cargo 27 测全过（新增 xlsx 隐藏/冻结往返、ODS 隐藏/冻结经 settings.xml 往返）+
  CDP 17 断言全绿（合成载荷 → write_xlsx/write_ods → read_xlsx 读回 → Univer 快照桥 →
  换回 payload → 打印 HTML 行列计数）

## 表格保真四期：公式往返（v0.21）

- **载荷扩展**：`CellPayload` 的 `f`（带 `=` 前缀的 A1 式）从"存了但落盘即丢"升级为全链路
  字段；`v` 兼任公式缓存值，calamine 不算式重开也不丢数
- **xlsx 双向**：读侧直解 `<c><f>…</f><v>…</v></c>`——quick-xml 0.42 会把 `&lt;` 实体拆成
  独立 `GeneralRef` 事件，需重建 `&name;` 再整体 unescape（否则 `=IF(A1<A2,…)` 的 `<` 静默
  丢失）；shared 从格空 `<f/>` 跳过，无缓存值公式格按公式表补回；写侧
  `Formula::set_result` 把缓存值随 `<v>` 落盘，Excel/WPS 打开即显示不重算
- **ODS 双向**：写侧 `table:formula="of:=…"` 属性 + 缓存 `office:value`，A1 区间换算成
  `[.A1:.B2]`、参数逗号转分号（字符串字面量内不换算）；读侧逆运算回 A1 式，跨表引用取
  最小支持面（简名直映、带空格表名加引号）
- **前端零改动**：`univer-io` 双向本来就透传 `f`（快照 `cellData.f` 与载荷约定一致），
  Univer 公式引擎重算覆盖缓存；`sheet-print` 打印缓存值，导出不受影响
- **验证**：cargo 30 测全过（新增 xlsx 公式含 `<` 转义往返、ODF 语法双向换算、ODS 公式
  往返）+ CDP 11 断言全绿（桥双向、xlsx/ODS 落盘读回、比较式/区间式、缓存值、打印）

## PDF 查看交互：滚轮翻页 + Ctrl 缩放（v0.22）

> 本节描述 v0.22 当时行为；滚轮翻页已被 v0.25 连续滚动取代，普通滚轮交还原生滚动。

- **滚轮翻页**：`PdfViewer` 查看区挂原生非被动 `wheel` 监听（React `onWheel` 是 passive，
  无法 `preventDefault`）——页面无溢出时滚轮直接翻页；放大溢出时先走原生滚动，滚到页底
  继续下滚才翻下一页、回页顶继续上滚翻上一页（同浏览器 PDF 查看器的滚动链接习惯）
- **防误触**：`deltaY` 累计过阈值（140px）才翻一格、翻后 350ms 冷却吞掉惯性余量，
  方向反转清零累计；翻页/回顶后 `scrollTop` 归零
- **Ctrl+滚轮缩放**：以 1.1× 步进在 50%~300% 区间缩放，与工具栏按钮共用同一 clamp
- **验证**：tsc/build 全绿；CDP 冒烟 10 断言全过——合成 3 页空白 PDF 开标签，派发
  `WheelEvent` 验证触底翻页、单格不足阈值不翻、未触边不翻、触顶回翻、首页钳制、
  冷却吞连翻、Ctrl 缩放复原、0.5 倍不溢出时直接翻页

## PDF 文字选择复制（v0.23）

- **文字层叠加**：canvas 渲染完成后挂 pdf.js `TextLayer`——透明字形盖在页面上，拖选、
  双击选词、Ctrl+C 复制全走浏览器原生选择，零新增权限；滚轮翻页与文字层互不干扰
- **随翻页/缩放重建**：`streamTextContent()` 流式建层，切页与缩放时 cancel 旧层并重建，
  层尺寸跟随 scale
- **坑：`--scale-factor`**：v4 文字层容器的内联尺寸写作
  `round(down, var(--scale-factor)×页宽, …)`，该变量由官方 viewer 负责设置；宿主不设
  则层塌成 0×0，span 虽在 DOM 但被 overflow 裁剪、肉眼不可选
- **验证**：CDP 冒烟 7 断言全绿（合成 3 页带文字 PDF：文字层内容与逐页重建、程序化
  选择取字、缩放后层与画布对齐、滚轮不被吞）；tsc/build 绿，Rust 零改动

## PDF 全文搜索（v0.24）

- **搜索链路**：`getTextContent()` 按页惰性建文本索引（items 拼接串 + 项起点表，缓存于
  Map），查询小写化全页扫命中（上限 500 防大文档卡死），全局偏移换算回（项下标, 项内
  偏移）定位到文字层 span 区间；Enter/Shift+Enter 或 ▲▼ 循环上下跳转，自动换页
- **高亮零侵入**：用 CSS Custom Highlight API（`::highlight()` + Range）上色，不复制
  DOM 不改文字层布局；活动命中单独一色并 `scrollIntoView` 居中；翻页/缩放重建文字层后
  在 render 完成回调里重挂高亮
- **交互**：Ctrl+F 打开搜索条并聚焦、Esc 关闭清空、🔍 按钮开关、计数 `x/y` 与"无匹配"
  提示；组件只在 PDF 标签挂载，不劫持其它编辑器的 Ctrl+F
- **验证**：CDP 冒烟 11 断言全绿（'page' 三页全命中、跳页后高亮重挂、上下循环导航、
  大小写不敏感、无匹配 UI、Esc 清空、v0.23 选择功能回归）；tsc/build 绿，Rust 零改动

## PDF 连续多页视图（v0.25）

- **连续滚动**：单页画布改为全页占位列（`flex column + gap`，每页 `data-page` 容器按页
  元数据尺寸给内联宽高）——滚动条长度一开始就正确；尺寸由后台逐页 `getPage` 预取补齐，
  未到达前用首页/595×842 估算兜底
- **视口虚拟渲染**：`IntersectionObserver`（root=滚动区，`rootMargin` 上下 800px 预渲染
  余量）进入即渲染 canvas+文字层、离开即 cancel 任务/清画布释放内存，回视口再重渲染；
  每页槽位记 `rendering/done/cancelled` 去重，防观察者重复触发双渲染
- **缩放重绘**：scale 变化时占位宽高随 inline style 重算，可见页先 free 再按新比例重画
  （否则 done 槽位会被跳过留下旧尺寸）；普通滚轮交还原生滚动（撤 v0.22 翻页劫持），
  仅 Ctrl+滚轮 `preventDefault` 缩放
- **页码与导航**：当前页=顶边进入视口的最后一页（scroll+rAF，文档序早断）；◀▶/页码输入
  改 `scrollIntoView` 跳页；全文搜索命中跳页后高亮重挂照旧，多页同屏时基础高亮可一次
  挂多个命中区间
- **验证**：CDP 冒烟 30 页夹具 12 断言全绿（前 3 页带文字后 27 页空白：占位数、初始仅
  渲染近旁页、滚到底页 30 渲染且页 1 画布归零、回顶重渲染、搜索跳页 3 活动区间命中、
  'page' 三命中 Enter 落页 2 且 3 区间同挂、Ctrl 缩放文字层宽=canvas CSS 宽±2px、
  中部页码跟踪、v0.23 选择回归）；tsc/build 绿，Rust 零改动

## 性能专项轮（v0.26）

- **PDF 位图 LRU 缓存**：每页栅格化完成后把画布快照进离屏 canvas 缓存（上限 8 页，
  插入序即 LRU）；滚回视口不再走 `p.render()`，同 scale/dpr 命中直接 `drawImage` 贴回
  （文字层绑定 DOM 仍需重建）；scale/dpr 不符视为未命中重栅格，天然防错尺寸复用；
  换文档清空。冒烟以计数器实证：来回滚动 `full` 不变、`hit` +2
- **尺寸预取批量化**：全页 `getPage` 取尺寸改为每 8 页合并一次 `setSizes`——逐页刷新
  会让全部占位随每一页到达重渲染一次（30 页 = 30 轮全列表 re-render），批量后降到 4 轮
- **空闲预热编辑器 chunk**：Workspace 挂载后 `requestIdleCallback` 逐个动态 import
  PdfViewer/DocEditor/PptEditor/SheetEditor（与 `lazy()` 共享同一模块 promise），并预热
  Univer 公式 worker（`new Worker` 后台线程 fetch+编译，2s 后回收，脚本留在 HTTP/代码
  缓存）；表格 6.2MB 主 chunk 与 7.4MB worker 脚本的加载成本从点击路径移到空闲期
  （**v0.35 修订**：预热上移到 `App` 并补上此前漏在点击路径上的外壳 chunk；worker 预热经发布包
  实测对首开耗时零收益，已删——见「大 PDF 分段读取 · 首开提速（v0.35）」。
  **v0.36 修订**：worker 预热与线程池再度 A/B 复核仍无收益，池子一并删除；挂载侧不再用 `lazy()`，
  改为自持已解析组件——见「首开那 300ms 的元凶：挂载不再走 Suspense（v0.36）」）
- **盘点结论**（不改代码）：标签切换本就是 `display:none` 保持挂载零重挂成本；首屏入口
  仅 247KB；vchart（2MB）与 Univer 各 locale 数据表（hu/nb/nn 300+KB）都已是按需动态
  chunk；`univer-worker` 7.46MB 为公式计算引擎必要成本，保留
- **验证**：CDP 冒烟 9 断言全绿（缓存命中免重栅格、LRU 上限、缩放换血重渲染、空闲预热
  五步全达、跨页搜索/选择复制回归）；tsc/build 绿，Rust 零改动

## PDF 缩略图 + 大纲侧栏（v0.27）

- **侧栏骨架**：工具栏 ☰ 开合 180px 侧栏，"缩略图/大纲"双页签；侧栏与主滚动区包进
  `.pdf-body` flex 行，收起时零开销
- **缩略图虚拟渲染**：每页固定 120px 宽独立小画布，独立于主视图的 IntersectionObserver
  调度（rootMargin 400px 进视口即画、离开即 cancel+清零）；侧栏收起/切页签时 DOM 重挂，
  槽位表整体清空重建；点缩略图 = 主视图 `scrollIntoView` 跳页，当前页缩略图描边高亮并
  `scrollIntoView({block:'nearest'})` 跟随视口
- **大纲（书签）解析**：`doc.getOutline()` 树递归拍平为（标题, 目标页, 层级）；pdf.js v4
  无 `getDestinationPageNumber`，目标页手工解析——字符串 dest 先 `getDestination`，取
  `dest[0]` 页引用过 `getPageIndex` 换算 1 起页码，失败记 null（渲染为禁用的无目标项）；
  缩进按层级 `paddingLeft: 8 + depth*14`，点击跳页、当前页着色；无大纲文档显示占位提示
- **验证**：CDP 冒烟 11 断言全绿（30 页带 Outlines 夹具：☰ 开合、近旁 6 缩略图渲染远处
  不渲、画布宽=120、点缩略图跳页+active 跟随、大纲 2 条解析为页 1/3、点章节跳页、
  搜索/位图缓存/文字选择三项回归）；tsc/build 绿，Rust 零改动

## PDF 标注与高亮（v0.28）

- **标注模型 + 读侧导入**：`PdfAnno`（highlight/note，PDF pt 左上角坐标 rects[]，颜色
  #rrggbb，文本内容）；打开文档逐页 `getAnnotations({intent:'display'})` 导入已有
  Highlight/Text 注解——关键坑：pdf.js 注解文本在 `contentsObj.str` 而非 `contents`，
  读错字段会让所有内容往返为空；坐标 `y_pdf = 页高 − y_top − h` 换算
- **选区即标注**：文字层选区 mouseup 弹浮动菜单（4 色色板高亮 / 📝 便签 / ✕），
  行矩形按 `range.getClientRects()` 顶边取整合并再除 scale 转回 PDF pt；弹层
  `onMouseDown preventDefault` 保住原生选区；高亮覆盖层 CSS 绝对定位
  `mix-blend-mode:multiply` 半透明叠色，零栅格化侵入（位图缓存保持无标注）；
  pdf.js 侧 `annotationMode: 0` 关闭其内建注解绘制，可视化完全归我们这层
- **便签**：🗒 图标锚在最后矩形右侧 16×16，点击弹内联 textarea 编辑/删除
- **写回 PDF 文件**：`registerSaver` 协议接入 Ctrl+S——动态 `import('pdf-lib')`，
  **pdf-lib 1.17 无高级注解 API**（`addHighLightAnnotation` 只在未发布的 vNext），
  走低层 `context.obj({Type/Subtype/Rect/QuadPoints/C/Contents})` + `register` +
  `page.node.Annots().push(ref)`（无 Annots 数组先建）；保存前按 Subtype 清除旧的
  Highlight/Text 再全量重写（`PDFName.of` 驻名引用相等比较），重复存开不累积；
  文本 `PDFHexString.fromText` 写入；改动即 `markDirty`，存成清 dirty
- **侧栏第三页签"标注"**：列表（色点+页码+摘要）点击跳页、✕ 删除
- **验证**：CDP 冒烟 10 断言全绿（3 页夹具带预置高亮：导入呈现、选文字弹层、
  加高亮/便签、面板 3 条、Ctrl+S 清 dirty、重开内容/颜色/页码保真、再存再开不重复、
  搜索/缩略图/位图缓存回归）；tsc/build 绿，Rust 零改动

## PDF 标注编辑增强（v0.29）

- **标注编辑工具**：工具栏 T/✎ 双态切换——文字态维持选择复制原样；标注态下文字层
  `pointer-events:none` 让位、高亮覆盖层可点可拖，单击选中（描边），自有与第三方导入
  注解走同一 `PdfAnno` 模型、行为完全一致
- **选中编辑条**：注解上方浮出深色胶囊——4 色点改色、🗑 删除、便签多一颗 🗒 开合内容卡；
  Delete/Backspace 直删选中项，Esc 或 ✕ 取消选中；点空白处也取消
- **拖移**：pointerdown 记录原 rects 快照，位移超 3px 阈值才算拖（否则视作点击），
  全程按原始快照 + 增量 `px/scale` 换算 PDF pt 平移，缩放/滚动下无累计误差；改动即 dirty
- **侧栏联动**：标注列表点击 = 跳页 + 切标注工具 + 选中（当前项描边底色），
  与画布上选中态双向同步
- **Acrobat 视觉**：选区菜单与编辑条统一为深色圆角胶囊（`border-radius:999px`）、
  色点改圆形白描边（选中色外圈高亮）、便签弹卡改淡黄便签纸配色
- **验证**：CDP 冒烟 10 断言全绿（第三方预置高亮点选/改色+dirty/拖移 +50px=+40pt/
  面板联动/Delete 删除/文字态选字弹层回归/便签增改色/保存重开颜色内容保真且删掉的
  预置注解不再回来/胶囊与便签卡 computed style 断言/搜索回归）；tsc/build 绿，Rust 零改动

## 文档编辑增强（v0.30）

- **页面设置**：工具栏"页面设置"面板——纸张 A4/Letter/自定义宽高（mm）+ 四边距，
  实时驱动 `.doc-page` 宽高与内边距、打印 `@page` 规则动态注入，并写进 docx
  `sectPr`（pgSz/pgMar，twips；横版按"竖版宽高+orientation"语义传参避免库交换）与
  odt `page-layout`；导入从 docx/odt 还原（A4/Letter 就近归 presets，否则 custom）
- **分页参考线与页数**：页内绝对定位覆盖层 `repeating-linear-gradient` 按页高画灰线
  （`pointer-events:none` 零侵入），ResizeObserver 量文档高度 → 状态栏"约 N 页"
- **表格上下文工具条**：光标在表内浮出——前后插行/列、删行/列、合并拆分
  （`mergeOrSplit`）、表头行切换、删除表格；导出补 `colspan/rowspan` →
  docx `gridSpan/vMerge` 与 odt `covered-table-cell`
- **图片增强**：剪贴板粘贴图片直接转 base64 插入（`handlePaste`）；选中图片浮出工具条——
  宽度按版心 25/50/75/100%（按当前显示比例换算 height）、居中（display:block+auto margin
  自定义 align 属性）、恢复原尺寸；宽度随 docx ImageRun/odt draw:frame 导出往返
- **验证**：vite-node 结构测试 5 断言（custom/Letter/默认 A4/合并表/横版 docx 往返）+
  CDP 冒烟 10 断言全绿（面板开合、Letter 页宽 816 与参考线、左边距 10mm→38px、
  约 N 页增长、表格条插行、图片条 50%+居中、粘贴成图、重置回 A4、@page 规则、
  odt 浏览器内往返含页面设置/合并/图宽）；tsc/build 绿，Rust 零改动

## 文档查找替换 · 字体 · 自动保存（v0.31）

- **查找/替换面板**：Ctrl+F 在文档标签打开面板（与 PDF 搜索互不劫持）——整文档按文本块匹配，
  段内跨 mark 可命中、跨段不算；命中集存 ProseMirror 插件 state，装饰 `.fr-hit`/`.fr-active`
  上色，"当前项"由选区派生（上下按钮即把选区挪到下一/上一命中，越界回绕）；支持大小写开关、
  单个替换（`insertText` 保留 marks）与全部替换（自后向前替换避免位置漂移）
- **字体族 / 字号**：工具栏两颗下拉——字号以 pt 呈现、内部按 `pt*96/72` 存 px，字体族含中英
  常用族；走 TipTap `TextStyleKit`（Color/FontFamily/FontSize 共用 `textStyle` mark attrs），
  导出 docx 时字族进 `w:ascii/hAnsi`、字号半磅 ×1.5，odt 进自动样式 `style:font-name` +
  `fo:font-size`（pt = px×72/96），导入再反解回同一 mark，三属性（字族/字号/字色）同链路往返
- **会话内版本历史**：每 60 秒探测一次内容变化并推快照（与栈顶 JSON+meta 相同则跳过），
  手动保存与恢复前也各留一份；环形上限 20 份，「历史版本」面板按时间倒序列出，一键恢复
  （恢复前自动把当前状态入栈，不丢操作）
- **自动保存**：对已落盘的 `.odoc` 写回并清 dirty，工具栏显示「已自动保存 HH:MM:SS」；
  间隔按失败次数退避（30 → 60 → 120 → 240 秒封顶，v0.75；此前是每 30 秒咬一次、明知不行还一直敲），
  手动存盘成功会把退避清零并立刻重挂那一枚时钟；写失败时那一格换成「自动保存失败（第 N 次）: …
  + X 秒后自动重试」（原话留悬停，v0.73 前是 `catch {}` 静默——屏上继续挂着上一次那个不真的时间），
  成功那格的悬停带本次会话的账（成功 N 次 · 失败 M 次 · X 秒后再检查，v0.75）；
  且**只撤说的是"这个路径"的那句过期失败宣称**（v0.73 的原话是"只撤这一路自己写上去的那句"，**⇒ v0.76 改口**：
  撤句权按路径认领，手动 Ctrl+S 那一路写上去的「保存失败」也在认领范围内——权限改回来后它若还挂着，
  界面上就没有一处承认"其实已经存上了"），手动存盘那句「已保存」仍不归它撤；失败不清 dirty（● 留 1，不许把账记成已存）；
  未命名文档与会话内 docx/odt 标签不参与（不擅自造文件）
- **坑**：TipTap v3 的 `useEditor` **不会因纯选区事务重渲染 React**，面板的命中计数与活动高亮
  必须订阅 `editor.on('selectionUpdate')` 自增 tick；`commands.focus()` 返回 Thenable，
  直接链式 `setTextSelection` 会 TypeError，要用 `editor.chain().focus().…`；关闭面板须同时清空
  输入框状态，否则重开时 UI 与插件命中脱节
- **验证**：vite-node 结构测试 8 断言（含「字符样式落在 content.xml 而非 styles.xml」定位、
  odt 导入合并回单 span）+ CDP 冒烟 17 断言全绿（重载起干净标签 → 面板开合、命中计数、
  大小写语义、上下导航回绕、替换与全部替换、无匹配提示、字族/字号写进 JSON、历史快照列表、
  恢复内容还原）；30s/60s 定时器由开发钩子直推快照代验；tsc/build 绿，Rust 零改动

## PDF 标注形状 · 首页模板（v0.32）

- **标注形状四类**：`PdfAnno.kind` 扩到 `rect / ellipse / line / ink`，几何统一塞进
  `polys: number[][][]`（line 一笔两点、ink 多笔），`rects[0]` 恒为包围盒——于是拖移、选中编辑条、
  侧栏「标注」列表、保存清理全部沿用 v0.29 通路零改动；工具栏 ✎ 态下多四颗绘制按钮
  （▭ ◯ ↗ ✏），页面按下起笔、拖出预览草稿、抬手成一条标注（ink 逐点采样），再点同颗或 Esc 退出
- **第三方导入**：`Square/Circle/Line/Ink` 四类注解读进同一模型（Line 缺 `L` 时按包围盒对角线兜底，
  Ink 多笔画逐条还原），颜色 0-255 数组 → `#rrggbb`
- **写回**：pdf-lib 走低层 `context.obj({Type:Annot, Subtype:Square|Circle|Line|Ink, Rect, L|InkList, Border})`
  + `register` + `Annots.push`；保存前清旧列表按 `Subtype` 全量重写，重复存开不累积；线尾箭头 `Head/Tail`
  与 Ink 的 `InkList` 折线数组都用 `context.obj([])` + `PDFNumber` 逐个 push 构造
- **渲染**：SVG 覆盖层按形状分支（`<rect>/<ellipse>/<line>+<polygon> 箭头/<polyline>`），每组外面套一层
  `stroke="transparent" strokeWidth=14` 的同形命中孪生体——细线也好点；命中权由
  `.pdf-page.anno-mode .pdf-anno-svg:not(.drawing) [data-anno] { pointer-events: auto }` 给
- **首页模板体系**：`lib/templates.ts` 注册 11 个模板（公文/会议纪要/周报 ×3、记账表/库存清单 ×2、
  六套演示配色 ×6），首页「从模板新建」画廊卡片一点即开标签；`Tab.template` 存 id，三个编辑器在
  **无路径**分支各自 seed（文档 `setContent` + meta、表格 payload→Univer 快照（含冻结表头/列宽/合计公式/金额格式）、
  演示 `useState` 惰性初值套主题），另存时文档用 `tab.title` 当默认文件名
- **查找命中上限**：`FR_HIT_CAP = 2000`，收集到 2001 即停并置 `truncated`，面板计数显示 `N+`，
  超长文档按文本块查找不再卡主线程
- **坑**：① pdf.js 把 Line 解析成 **扁平数组** `lineCoordinates=[x1,y1,x2,y2]`（不是 `line` 对象），
  Ink 是 `inkLists`（类数组，只能下标访问），读错字段整类注解静默全空；② 保存分支的 `else` 必须
  在 `else if (kind === 'note')` **之前**收敛，否则形状全被写成 Text 便签；③ CSS 里父级
  `pointer-events: none` 挡不住自己声明了取值的子元素，绘制态必须靠 `.drawing` 类把子组重新关掉；
  ④ pdf-lib 不导出 `PDFHexColor`（颜色用 0-1 三分量 `PDFArray`），本构建也无 `PDFArray.withOutDeltas`；
  ⑤ 页面 HTML 分支只特判 `highlight` 会让四种形状各多渲染一个 🗒 锚点（点选/拖移全打到错节点），
  必须显式 `note` 分支 + 形状 `null`；⑥ 模板里用 `cells[11].f = …` 按下标补公式极易数错位
  （合计文字与 `=SUM(D2:D3)` 挤进同一格），改为 `cell(r,c,v,style,f)` 构造期落值；
  ⑦ Univer facade 的 worksheet 实名 `getSheetName()`（无 `getName()`），冒烟改读
  `getActiveWorkbook().save()` 快照断言最稳；⑧ CDP 冒烟 `location.reload()` 后旧执行上下文仍可能
  答出 `.home`，须等 `Page.loadEventFired` 再判定就绪
- **验证**：vite-node 结构测试 28 断言（模板注册表、doc/sheet/ppt 三类 seed、公式落位、
  命中上限截断语义）+ CDP 冒烟 19 断言全绿（模板卡片→三编辑器注入、四形状导入几何与 Ink 双笔、
  页 1 拖拽画矩形落位、页 2 画线、点选+拖移 +50px、编辑条改色、Ctrl+S 写回清 dirty、
  重开 6 形状不累积且颜色保真、Delete 删除、🗒 锚点仅 Text 注解渲染）；tsc/build 绿，Rust 零改动

## 文档分页保真：页码域 · 多栏 · 分页符 · 打印边距（v0.33）

- **页眉/页脚/页码改走 CSS `@page` margin box**：`oo-page-rule` 注入的样式在 `@page` 内挂
  `@top-center` / `@bottom-center`，Chromium 逐页重绘，导出的 PDF **每一页**都有页眉页脚与正确页码
  （屏幕侧仍是流内那两份，只做占位预览）
- **页码四格式**：`1` / `第 1 页` / `- 1 -` / `1 / 3`（含总页数），`pageNumberParts()` 一处定义、
  三处消费——屏幕占位、打印 `counter(page)`/`counter(pages)`、导出 docx `PAGE`/`NUMPAGES` 域与
  ODF `<text:page-number>`/`<text:page-count>`；导入侧 `detectPageFormat()` 从页脚原文反推格式，
  默认 `cn` 保持与 v0.30~v0.32 存量文档兼容
- **多栏排版**：`PageSetup.cols`（1~4）+ `colGap`，屏幕用 `column-count`/`column-fill: auto` 容器包住正文、
  打印自然分栏，导出写 docx `sectPr/w:cols w:num w:space`（单栏故意不写 `w:cols`）与 ODF
  `style:page-layout/style:columns`（`fo:column-count` + `fo:column-gap`），导入双向读回
- **分页符**：新增 `pageBreak` 原子块节点（`Ctrl+Enter` 或工具栏「分页符」），屏幕画虚线 + 「分页符」胶囊，
  打印 `break-after: page` 真正另起一页，导出映射 docx `<w:br w:type="page"/>` 与 ODF
  段落样式 `fo:break-before="page"`（导入按样式名 `PBK` 或 `break-before` 还原）
- **纸张与四边距贯穿 PrintToPdf**：`export_pdf` 的 `margins` 升级为 `(top,right,bottom,left)` 英寸四元组、
  `page` 为宽高英寸，前端按 `resolvePage()` 的 mm→英寸传参——打印不再吃 WebView2 的默认 0.5/0.5/0.6/0.6 边距；
  `@media print` 里 `.doc-page` 的 `width/padding/min-height` 改 `!important`，否则 React 内联版心样式压过打印规则，
  页面自身 padding 与 PrintSettings 边距叠成双份
- **分页控制**：打印样式补 `break-after: avoid`（标题不与正文分离）、`break-inside: avoid`
  （表格/图片/代码块/引用/目录不跨页折断）、`orphans/widows: 2`
- **坑**：① `@page` margin box 的 `content` 只吃**空格串接**片段，写成 `"a" + counter(page)` 会让整条声明
  静默失效（页眉有、页脚整块消失）；② PrintToPdf 忽略 CSS `@page` 的 `size`/`margin`，纸张与边距必须由 Rust
  侧 `PrintSettings` 决定，CSS 那份只服务浏览器打印；③ pdf.js 读回中文「页」可能归一成部首字符 `⻚`，
  断言按数字松匹配；④ pdf.js 文本项 `y` 是**基线**，首行距页顶要再加字体 ascent 才等于边距，
  冒烟改用「同内容只差上边距 20mm → 基线下移 56.7pt」的差分断言才稳
- **验证**：vite-node 结构测试 17 断言（页码格式 parts/detect 双向、docx `w:cols`+PAGE/NUMPAGES+page break、
  ODF `style:columns`+页码域+`fo:break-before`、单栏不写 columns）+ CDP 真机冒烟 25 断言全绿
  （margin box 逐页页眉页脚且落在边距带内、`1 / 3` 页码、两分页符恰好 3 页且内容分属正确、
  A4 595×842pt 与 Letter 612×792pt、左缘精确到 62pt、上边距差分 56.7pt、双栏 x 两簇、清空后无 margin box）；
  `cargo test --lib` 30 通过、tsc/build 绿

## CSV 往返 · PDF 页面管理 · 性能包（v0.34）

- **CSV 全链路补齐**：calamine 不读 CSV，故读侧按扩展名分流到 `src-tauri/src/csv.rs` 的逐字符状态机
  （RFC4180：双引号包裹、`""` 转义、字段内可含逗号与换行；分隔符在 `,` `;` 制表符 三者按首行出现次数嗅探，
  欧洲导出的分号 CSV 直接能开）；解码先试 UTF-8、失败退 **GBK**（中文 Excel 另存的 CSV 常是 GBK），
  写回带 **UTF-8 BOM** + CRLF 行尾；值一律按文本落，`007` 不会被吞成 `7`；工作表名取文件主名。
  `write_csv` 成为第三个表格保存命令，`.xlsx`/`.ods`/`.csv` 三分流，存 CSV 时提示「只含首个工作表，样式与图表不保留」
- **PDF 页面管理**：侧栏新增「页面」工作区——每页一行缩略信息 + 勾选多选，页码写法 `1-3,5` 可直接输入套用；
  六个操作 ⟲ 左转 / ⟳ 右转（90° 步进）/ 删除页 / 提取为新 PDF / 合并其他 PDF / 拆分为单页，
  全部走 pdf-lib 覆盖写回（未选中页时对当前页生效）；删空被拒（PDF 至少要有一页），
  不允许把文件合并进自己；做完自动重载并**停在操作前那一页**
- **标注跟随页面操作**：页操作写盘前先把内存标注落进文件，操作后重载、标注从 `/Annots` 重新导入——
  不用自己维护页序映射表，删页/换序天然正确。旋转另有一处真问题：内存存的是**显示空间**（已套旋转、左上原点），
  而 `/Rect` 是**未旋转 + 左下原点**，故 `lib/pdf-geo.ts` 按该页 `/Rotate` 做精确可逆换算
  （`mapPoint`/`unmapPoint` 四个角度各一分支，`toDisplayRect`/`fromDisplayRect`/`toDisplayPoints`/`fromDisplayPoints`），
  旋转过的页上高亮与形状不再整体偏移
- **性能包**：`read_xlsx`/`write_xlsx`/`write_ods`/`write_csv` 升为 async 命令 + `spawn_blocking`
  （原来同步命令跑在主线程，解析大表时整个窗口冻结），IPC 名保持不变；xlsx 读侧先用
  `has_charts()` 只嗅探 zip 文件名，**图表专用的那份全表网格克隆**与 `read_xlsx_charts` 都只在簿子真含图表时才做；
  PDF 位图缓存除条数上限外补**像素预算**（`BITMAP_CACHE_PX`）并在 scale/设备像素比变化时清陈旧条目
  （A4 × 3 倍 × dpr 2 单页就几十 MB）；文档状态栏字数/字符改 400ms 后缘节流，逐键不再全文遍历
- **坑**：① TipTap v3 的 `useEditor` 是异步建实例的，挂载 effect 里直接取 `editor.storage.characterCount`
  拿到 `undefined` 就抛，React 会把**整棵树**卸掉（首页/工作区全白）——冒烟抓到并修：先订阅、`create` 事件补算、
  取不到就跳过；② pdf-lib 删页必须**倒序**删，正序会让后续索引整体前移而错位；③ 高亮写回的 `/Rect`
  要的是**角点对** `[x0,y0,x1,y1]`，写成 `[x,y,w,h]` 时 pdf.js 不报错、只是读回位置全歪（本轮实测撞出）；
  ④ pdf.js 会**静默丢弃**没有 `/QuadPoints`（或与 `/Rect` 不匹配）的 Highlight 注解，测试夹具少写这一项时表现为「注解导入永远 0 条」
- **验证**：`cargo test --lib` 36 通过（CSV 状态机/引号转义/分隔符嗅探/GBK 回退/BOM 往返）+ vite-node 结构测试 28 断言
  （四角度显示↔PDF 坐标往返回合、`displaySize`、`parsePageSpec` 各种写法）+ CDP 真机冒烟 31 断言全绿
  （CSV 读取五断言 + 落盘字节断言 + 二次打开保真、xlsx 异步读、删页/旋转后标注几何随之换算、
  旋转 90° 写回后 `/Rotate` 与 `/Rect` 双校、重载后显示几何不变、删空守卫、提取/合并/拆分数数、
  位图缓存受限、字数节流仍跟手）；tsc/build 绿

## 大 PDF 分段读取 · 首开提速（v0.35）

- **PDF 不再整本进 JS 堆**：`src/lib/pdf-range.ts` 实现 pdf.js 的 `PDFDataRangeTransport`——先问 `file_len` 拿字节数，
  **≥4MB** 才只喂 64KB 文件头起手，其余正文由 pdf.js 按实际需要的区间回调 `read_range` 从磁盘切片取
  （`disableAutoFetch` 使 worker 只请求真正用到的字节）；**小于阈值仍走原来的整本 `data` 读**，
  因为几十次区间往返对中小文档反而更慢（big.pdf 375KB 实测 715→731ms 持平，正是这条阈值的守卫）
- **Rust 侧两个新命令**：`file_len` 与 `read_range(path, start, len)`——后者返回 `tauri::ipc::Response::new(Vec<u8>)`
  走 **raw IPC**（JS 侧直接拿 `ArrayBuffer`，不经 JSON 逐字节序列化），同为 async 外壳 + `spawn_blocking`；
  越界自动裁到文件末尾、起点越界与零长返回空，缺文件给中文错误而非 panic
- **表格冷开提速**：`SheetEditor` 把「读文件」与「建 Univer 实例」由串行改为**并行**（数据 promise 先起，
  再 `createSheetApp`，两者互不等待），并把空闲预热上移到 `App`（停在首页时 `Workspace` 尚未挂载，
  那是唯一免费的空闲窗口）
- **预热只留实测有效的部分**：资源计时（`performance.getEntriesByType('resource')`，发布包无需 DEV 钩子）
  查出**外壳 Workspace chunk 原本还挂在点击路径上**，遂补 `shell` 预热步；现在点击之后只剩
  `read_xlsx` 与 worker 创建，四个编辑器 chunk + 外壳 + CSS 全部在空闲期取完
- **性能结论（发布包 `--no-bundle` + CDP 真实双开路径，单位 ms）**：
  表格 big.csv 冷开 **1456 → 1281**、热开 579 → 529；heavy.pdf 17.9MB 冷开 **901 → 710**、
  热开 **260 → 91**（分段读少掉的是整本字节进出 JS 堆那一趟）；big.pdf 保持不动
- **被数据否掉的三种更激进预热（已删除，别再试）**：空闲期预取 pdf.js worker 脚本、预先 new 一个 `Worker`
  再 terminate、空闲期真建一个 Univer 实例 + 空表、拿空白 PDF 走一遍渲染管线——DEV 探针确认这些步骤
  **确实执行了**（`__oofPrewarm` 全绿、无告警）而发布包首开耗时**一位数都没降**。
  留下的原因是：首次开标签比同会话第二次慢的那 ~600ms 不是库代码编译，而是新 context 里 6MB chunk 的
  编译与堆增长，空闲期提前跑同样要付一遍
  **（v0.36 修正：那 ~600ms 里还压着一条外壳 Suspense 的 ~300ms 兜底节流，当时把它算进了"编译"这一项；
  节流删掉后表格冷开 1281→584ms。本节其余结论——worker 与实例级预热不省——依然成立）**
- **坑**：① pdf.js 的 `PDFDataTransportStream` 按 `_begin` 找 reader 且 `assert(found)` **在发布包里照样抛**，
  而 `getRangeReader` 是先 `requestDataRange` 后 push reader、同一 `begin` 可被两个 reader 分别请求——
  用「按 begin 去重」当投递策略会把第二个 reader 永久挂死（表现为卡住且无异常面），
  正确做法是**按 begin 计数**、每个待决请求投递一次；② 分段模式下 `onDataRange` 的 chunk 所有权交给
  pdf.js（会 transfer 给 worker），主线程不得复用；③ 标签卸载必须 `openTask.destroy()`，
  否则 transport 的在途区间读回写到已销毁实例（`abort()` 里置 `dead` 标志兜住）
- **验证**：`cargo test --lib` 39 通过（read_range 3 个新测试：精确窗口取值、越界裁到文件末尾 + 起点越界与零长返回空、
  文件字节数与缺文件报错）+ CDP 冒烟 25 断言全绿（真实字节切片的首块 `%PDF` 魔数与尾块 `%%EOF`、
  零长与越界守卫、小文件整本读未回归、大文件 `rangeMode=true`、远处页按区间补读并画出像素、
  旋转后覆盖写回仍走分段、重载后页数与旋转页渲染保真、CSV 表格装载、空闲预热清单 shell/sheet/pdf/doc/ppt）；tsc/build 绿

## 首开那 300ms 的元凶：挂载不再走 Suspense（v0.36）

- **元凶是一条节流，不是"懒加载慢"**：发布包分段打点 + 间隙探针（rAF 采样 / longtask / MutationObserver）显示
  `Workspace` 在 79ms 就渲染完了、内容却到 **349ms** 才提交进 DOM，中间主线程每 8ms 跑一帧、没有任何长任务。
  原因是 React 对 Suspense 边界有一条「兜底一旦可见就至少撑住 ~300ms」的节流，而 **App 用 `lazy()`+`<Suspense>`
  包住了整个工作区外壳**——于是每个新 context 里第一次开编辑器都要付这一笔（首页 → 工作区同样付）
- **修法：自己持有已解析组件**（`src/lib/editors.ts`）——动态 import 由这一个模块独占，预热与挂载点共用同一份
  promise；外壳 `WorkspaceSlot` 与每标签的 `LazyEditor` 先 `peekEditor/peekWorkspace` **同步命中**，
  于是「挂上编辑器」与「改状态」落在同一次提交里，没有兜底可见期可被节流。浏览器**不缓存重编译**：
  组件源码求值一次，但每次新 context 的编译要重付——所以省掉的是等待，不是编译
- **编辑器与 PDF 的建实例 effect 改 `useLayoutEffect`**：被动效果排在「这一帧画完」之后，取文档/建 Univer
  白等一次真实绘制。PDF 侧同构建实测 heavy.pdf 首屏 **746 → 473ms**（画布判据）；表格侧这一改没动那一跳
  （那一跳的账在外壳），两处账分开记、不再混算
- **v0.35 的归因被本轮纠正**：上轮写「冷开多出的 ~600ms 是 6MB chunk 在新 context 的编译与堆增长」，
  编译确实每 context 重付，但当时压着的还有一条 300ms 节流，故那条结论把两件事算成了一件事
- **公式 worker 线程池：裁决为删**（同构建开关 `__oofNoPool` A/B）——常驻线程让卸载只摘监听器不 `terminate()`、
  再配合空闲预热拉起线程，实测**热开 569(池) / 565(无池) 持平、冷开 911(池) / 877(无池) 反而更慢**
  （预热线程与启动抢 CPU）。省掉一次 fetch+构造只值 40ms 左右，不足以推翻 v0.35 的边界判断，
  故池子（`lib/worker-pool.ts`）与预热步一并删除，回到每标签自建自杀
- **保住的部分要背书**：编辑器级自解析表不是"lazy 一律不好"——同构建 A/B 里表格冷开 **588ms（自解析）vs
  875ms（每标签一个 Suspense 边界）**、热开持平，这条差异就是节流量级，所以留着
- **性能结论（发布包 `--no-bundle` + CDP 真实双开路径，单位 ms）**：
  | 用例（判据一致才可跨轮比） | v0.35 | v0.36 本轮 |
  | --- | --- | --- |
  | 表格 big.csv 20001 行 · 冷开（Univer 两画布有宽） | 1281 | **584** |
  | 表格 big.csv · 热开 | 529 | 574（持平，噪声内） |
  | heavy.pdf 17.9MB · 冷开（首页画布节点出现） | 710 | **225** |
  | heavy.pdf · 热开 | 91 | 97（持平） |
  | big.pdf 375KB · 冷开（首页画布节点出现） | 715 | **198** |
  | heavy.pdf · 冷开（**真出像素**，本轮起的严格判据） | 未测 | 309 |
  | big.pdf · 冷开（真出像素） | 未测 | 195 |
- **预热没命中也要能开**：把静置时间压到 0（空闲预热来不及跑完）再双击开表格，仍 710ms 出画布、无异常，
  只比预热过的 584ms 慢 126ms——`peekEditor` 未命中时走 `loadEditor` 等一次的兜底路径是通的
- **坑**：① 判据一换数字就不可比——pdf.js 先建画布后绘制，「画布节点出现」比「第一个非零像素」早约 120ms，
  本轮把 PDF 判据改成扫描 `getImageData` alpha，故 PDF 与 v0.35 的不同判据两列都列出；
  ② 发布包与 dev 共用单实例互斥锁，测发布包前须先杀 dev（反之亦然）；
  ③ 首页与工作区是互斥渲染，回首页会整棵卸载编辑器树（Univer 实例重建）——本轮只断言"回来还能用"，
  保留状态是后话
- **验证**：`cargo test --lib` 39 通过（Rust 零改动）+ CDP 发布包冒烟 19 断言全绿、页面异常 0 条
  （模板→文档/表格/演示、外链开 heavy.pdf 走分段并按区间补画像素、切标签 Univer 容器不被重挂、
  首页往返后重挂可用、收尾关标签）；未预热兜底路径单跑 1 次通过；tsc/build 绿

## docx 保真导入：直接格式 · 缩进 · 三处导出真 bug（v0.37）

- **为什么绕开 mammoth**：mammoth 只认"语义样式"（标题/列表/加粗），把 Word 里最常见的**直接格式**
  （字号、字色、字体族、对齐、缩进、嵌套列表层级、合并单元格、批注锚点）全丢掉——中文文档的排版多数是
  直接敲出来的，走 mammoth 打开后"只剩文字 + 标题"，看着像内容少了半截。本轮手写
  `src/lib/docx-fidelity.ts`（OOXML → HTML，配 `src/lib/ooxml.ts` 迷你 XML 解析器，无 DOM 依赖故 Node 侧可直测），
  mammoth 降级为**兜底**：保真导入器抛错或 `blocks === 0`（认不出这份文件）时才用
- **覆盖**：run 级 `w:rPr`（粗斜/删除线/下划线/字色/高亮 `w:highlight` 与 `w:shd`/字族（拉丁+中文拆两档）/字号半点换算）、
  段落 `w:pPr`（jc 对齐、`w:ind` 的 left/firstLine/hangingChars/firstLine/hanging、pStyle 样式链继承）、
  `w:numPr` + `word/numbering.xml` 的 numFmt → 有序/无序与 ilvl 层级、表格 `gridSpan`/`vMerge`（continue 记账在
  restart 的同一批网格列上，rowspan 数完所有行才出 HTML）+ `tblGrid` 列宽、`w:drawing`/`v:imagedata` 图片（rels → data URL）、
  超链接（外部 `r:id` 与内部 `w:anchor`）、`w:br type="page"` → pageBreak 节点、批注 `commentRangeStart/End` 三态锚点、
  上标下标（v0.38 起真还原成 `<sup>/<sub>`）、`fldSimple`/`fldChar` 的**域代码文字不外泄**（结果段才渲染）、TOC 内容控件跳过
- **缩进进 schema**（`lib/indent-extension.ts`）：`indentLeft`/`indentFirst` 作为段落级全局属性（32px 一档、上限 320px），
  `Ctrl+]`/`Ctrl+[` 与工具条按钮调 `setIndent`，首行缩进与悬挂缩进共存时出 `hanging`；
  导出侧 docx 写 `w:ind`、ODF 因"一段只能挂一个 `text:style-name`"而**派生自动样式**（`style:parent-style-name` →
  Standard/H1..H4/PQ，列表项的左缩进交 `text:list-style` 管以免写双份）
- **顺手修掉三个已经上线的真 bug**：
  ① `.docx` 标签 Ctrl+S 把 `.odoc` 的 JSON 灌进 `.docx` 文件（保存只按"当前是不是文档标签"分流，没看扩展名），
  现按 `.odt`/`.docx` 各自格式原地保存；
  ② **应用内"导出 docx"从来没成功过**——`Packer.toBuffer` 走 jszip 的 nodebuffer 通道，浏览器里直接抛
  `nodebuffer is not supported by this platform`，只有 Node 侧结构测试能过（它有自己的 jszip），
  改 `Packer.toBase64String` + `atob`（两端都支持，解出来是同一份 zip 字节）；
  ③ 有序列表导出写成"1. "字面文本 + 假缩进——真 Word 里既不续号也不重排，读回来更把它当普通段落（编号从此消失）。
  改走 `Document.numbering.config` 三级（decimal/lowerLetter/lowerRoman，720×(lvl+1) + hanging 360），
  Word 实测序号由它自己生成（`ListString` 依次 1. / 3.，第二层 `a.`）
- **表头行**：导出侧首行带 `tableHeader: true`（**行级** `ITableRowPropertiesOptions`，塞进 `TableCell` 选项里类型不报错、
  静默什么也不写），导入侧不再限定"只有第一行"能是表头（Word 可声明第 2 行起重复）
- **体验**：状态栏报「保真导入：N 项未保留（首条告警…）」，不静默吞排版
- **坑**：① 冒烟断言会**假绿**——`<w:jc w:val="center"/>`、`<w:tbl>` 这类 needle 在文件根本没被重写时照样通过，
  必须同时断言"本轮新敲进去的字出现在产物里"（本轮加 mtime + 新文字双判据，正是它揪出 ② 那条导出 bug 之前
  一整轮断言都在自欺）；② dev 里两笔连续编辑之间 vite HMR 会推一个 `LevelFormat is not defined` 的瞬时错误，
  看起来像回归、其实后一编辑落地即自愈，判定前先看模块真产物；③ TipTap v3 没有 `commands.insertText`，
  脚本内插字用 `insertContentAt(pos, str)`（同步）；④ **CDP 不要对活会话 `Page.reload`**——WebView2 里重新加载会把
  这条调试会话换掉（事件与回包全收不到，整轮卡死），源码改动交给 HMR、只轮询 DEV 钩子就位；
  ⑤ 长时间冒烟的进度要边跑边 `appendFileSync` 落盘，`| tail` 全缓冲会把它看起来像卡死
- **验证**：`pnpm vite-node` 结构测试 73（保真导入器 + 导出→导入往返回环）+ 33（缩进）断言全绿；
  CDP 真机冒烟 52 断言全绿、页面异常 0 条（渲染样式逐条计算值核对 → 缩进命令与快捷键 → 原地存 docx →
  重开比对 → 导 odt 重开 → 空 body 走 mammoth 且坏 zip 会抛错）；
  **Word 16.0 实机 13 断言**（`ListType=3`、`ListString` 1./3./a.、层级 2、项目符号未受影响、正文无写死序号、
  首行 `HeadingFormat=-1` 次行 0、左缩进 36pt 首行 24pt）；`cargo test --lib` 39 通过（Rust 零改动）；tsc/build 绿

## 单元格样式与上下标：保真续项（v0.38）

- **闭合 v0.37 剩下的六条边界**：`w:vertAlign`（上标/下标）、`w:tcBorders`（单元格四边）、`w:shd w:fill`（底纹）、
  `w:vAlign`（单元格竖排对齐）、`w:tblInd`（整张表的左缩进）、`w:ind w:right`（段落右缩进）——
  读侧进 `lib/docx-fidelity.ts`，schema 落在 `lib/cell-style.ts`，写侧三条链路（.odoc JSON / docx / odt）各自回得去
- **边框只存一种形状**：规范串 `"<px>px <线型> <#rrggbb>"`，并区分**三态**——`null` 是原文件没声明（不写内联样式，
  落回应用自己的网格线）、`'none'` 是原文件显式去掉了这条边、有值才是真边框。省掉"CSS 一套、OOXML 一套"的双表示，
  往返只经一次换算
- **单位换算钉死在一处**：OOXML 的 `w:sz` 是 **1/8 磅**（`eighthsToPx = sz/8×4/3`、`pxToEighths = px×6`），
  ODF 侧宽度写 **pt**（px×0.75 是精确换算，故 1px 边框回来还是 1px）；
  ODT 读边**不走整数取整的 `len2px`**——0.5pt 细线是 0.67px，整数量化会把它抬成 1px，而边框宽度正是往返要保的那个量，
  故另写 `odfBorderCss` 保留两位小数（缩进/边距仍用 `len2px`）
- **UI 入口**：工具栏 X² / X₂；表格上下文条加"底纹色"一格与竖排对齐（上/中/下），命令走
  `setCellBackground`/`setCellVAlign`（`updateAttributes` 对选区内的 cell 与 header 一并生效）
- **三处真 bug，全是"只测 JSON 测不出来"的那类**：
  ① `border-right: none` **整条静默丢失**——Chrome CSSOM 把 `none` 拆成 longhand 存
  （width=medium / style=none / color=currentcolor），而 shorthand 的 getter 返回**空串**，
  于是 parseHTML 读到空、属性根本不进 schema；新增 `inlineBorder()` 直接读四条 longhand；
  ② **表格缩进在屏幕和 PDF 上完全不生效**——`TableKit` 开 `resizable: true` 后表格 DOM 由 prosemirror-tables 的
  `columnResizing` 节点视图生成，它 `new View(node, min, view)` **不传 HTMLAttributes**，`renderHTML` 里的
  `margin-left` 永远落不了地；`IndentTableView` 子类在构造与 `update()` 里自己套 `marginLeft`（并同步
  `width: calc(100% - Npx)`，否则满宽版心会被顶出页面）；
  ③ Word 里"显式去掉的边框"照样画出来——`w:val="none"` 在 Word 语义里**压不住表级默认边框**（它当"没指定"，
  继续吃 `w:tblBorders` 的 insideV，导出再开变成 0.5pt 实线），只有 **`w:val="nil"`** 才是真去掉；
  导出侧改 `BorderStyle.NIL`，导入侧 `CSS_BORDER_STYLE` 加 `nil → none`
- **坑**：① Word 的内部边框经不起 COM 读——边框合并会把相邻格的那条报回来（实测右边框读成 single、下边框宽度读成
  乙格左边框的 sz18），所以**单元格边框的保真一律直接比 OOXML 字面**（`tmp/t-wresave.mjs`），COM 只留外框（上/左）；
  ② 这台 WebView2 带浏览器级缩放，`getComputedStyle` 把长度按缩放折算（1px 报成 0.667px），DOM 断言里
  **长度只比 specified 内联样式**，宽度 0 与颜色这类缩放无关的量才比 computed；
  ③ Word 的另存会把颜色改大写（`FFF2CC`）、属性换序（`w:type` 与 `w:w` 谁在前都可能），读侧必须两者通吃；
  ④ `Table.Indent`/`PreferredLeft` 在这台 Word 上返回 null、`Paragraph.Runs` 与 `Range.Runs` 恒为 0，
  上下标只能靠 `Find.Font.Subscript/Superscript = -1` 按格式搜
- **验证**：结构测试 42 断言（docx/odt 写侧字面 + 保真导入读回，含 `nil`、0.67px 细线、`text-position="super 58%"`）；
  CDP 真机冒烟 **58 断言全绿、页面异常 0 条**（schema → 真实 DOM 渲染 → 存 docx 重开 → 存 odt 重开 →
  **Word 另存的那份再被本应用读回**，逐条比四边/底纹/竖排/两处缩进/上下标）；
  **Word 16.0 实机 13 断言**（外框线型与 1/8 磅宽度、底纹色 `13431551`、竖排 1/3/0 三态可区分、右缩进 36pt、
  Find 搜到上标与下标）+ Word 原样另存后 **26 断言** OOXML 差分（`w:tblInd 360`、`w:ind w:right="720"`、
  `w:vertAlign` 上下标、`w:shd fill=FFF2CC`、`w:vAlign` center/bottom 恰两处、未声明的格子仍不写 vAlign、
  `w:right w:val="nil"` 被 Word 原样写回）；`cargo test --lib` 39 通过（Rust 零改动）；tsc/build 绿

## 段落排版保真：行距 · 段前段后 · 底纹与四边（v0.39）

- **闭合 v0.38 剩下的段落边界**：`w:spacing`（`w:line`/`w:lineRule` 行距 + `w:before`/`w:after` 段前段后）、
  段落底纹 `w:shd w:fill`、段落四边 `w:pBdr`——读侧进 `lib/docx-fidelity.ts`，schema 落在新开的
  `lib/paragraph-style.ts`（`lineHeight`/`lineRule`/`spaceBefore`/`spaceAfter`/`background`/`bdTop..bdLeft`
  挂 paragraph + heading），docx 与 odt 两条保存链路各自回得去；中文公文最伤观感的丢失就是这一档
- **行距的两套双关对上了**：OOXML 的 `w:line` 在 `lineRule="auto"` 时是 **1/240 行**（Word 默认 259 即 1.08 倍），
  `exact`/`atLeast` 时是**二十分之一磅**；CSS 的 `line-height` 也是双关（无单位=倍数、`px`=绝对值），
  但 ODF/CSS 都表达不出"最小值"这一档，于是用行内自定义属性 `--oof-lr: atLeast` 记在原处带回
  （**实测**穿过 ProseMirror/TipTap 的 detached-CSSOM 重解析不丢，6 块×9 属性零漂移，不需要退化成 `data-*`）；
  属性上没记 rule 时 `ruleOf()` 按量级猜档（>6 只可能是 px 绝对值，没有哪份文档是 20 倍行距）
- **整篇的默认归样式管，写侧不逐段补**：Word 把它存在 `Normal`、ODF 存在 `Standard`。v0.37 那版给每个段落补
  `w:after="120"`，等于把「没声明」这个信息擦掉——**导出再开长出一屏假的段后距**（本轮往返断言抓到的）。
  现在只写用户声明过的那几项；ODF 读侧同理由：`resolvePara` 沿样式链走时按名字跳过具名样式
  （`office:styles` 里那批 + `FIXED_PARA_STYLES` 的 Standard/PQ/H1..H4/PSn），否则继承来的默认会被摊成每段的直接格式
- **0 是真值**：Word 用 `w:after="0"` 压掉样式里那段间距，所以判空一律 `!== undefined` / `owned()`，
  用 `if (v)` 会把 0 静默变成"没声明"；同一条纪律在 `ownedPx()`（docx 写侧）与单元格边框三态里已经立过
- **单位各钉一处**：ODF 段间距与绝对行距写 **pt**（px↔pt 是精确换算，`cm` 写第三位小数会磨掉零点几 px，
  缩进仍写 cm），读回走新的 `lenPx()`（保留两位小数），旧的整数取整 `len2px` 只留给缩进/边距；
  段落边框宽度仍是 1/8 磅制的 `w:sz`（0.67px ↔ sz4 ↔ 0.5pt）
- **UI**：段落上下文条 `.doc-para-bar`——行距下拉（单倍/1.15/1.5/2 + 固定值/最小值 + 自定义 `x倍数`）、
  段前段后两个数字框与「无间距」、底纹取色与「无底纹」；**界面按「磅」显示、属性里存 CSS px**（pt×4/3），
  不让用户换算。`TextStyleKit` 的 `lineHeight` 必须关掉：那是它给段落挂的**同名**属性，
  与这里记 OOXML 行距的 `lineHeight` 撞名字，两边只能留一个
- **主动记 warnings 的边界**：段落边框离字的 `w:space`（>1 磅时告警，schema 里没有 padding 这一层）、
  按「行」计的段前段后（只有 `w:beforeLines`/`w:afterLines` 时按 19px/行估算并说明是估的）
- **坑**：① **PowerShell 的假绿断言**——`Ok((cond), "msg")` 位置传参时 `(cond, "msg")` 被绑成**一个数组参数**，
  `$c` 恒真、`$msg` 恒空（表现是一屏 PASS 却没有文字），须 `param([bool]$c, [string]$m)` 显形参；
  同类还有 `$ps` 是自动变量（赋值静默无效）、段落格式在 `$p.Format`/`$p.Range.ParagraphFormat`
  （`$p.ParagraphFormat` 在这个 adapter 返回 null）、`WdBorderType` 是**负数**（top -1/left -2/bottom -3/right -4）
  且 `Border.Enable` 读不回（比 `LineStyle`）；② 比较函数要把"读不到"当失败——COM 返回空串/Null 时按 0 参与比较，
  会造出「P5 没凭空长出间距」这种假过，`Near()` 现在直接拒 null/空；
  ③ TipTap v3 内置 `trailingNode` 会在文档以标题结尾时补一个空段落，"六段全部挂上"实得 7——
  归因后用 `tmp/probe39.mjs` 抓到，断言放宽为 ≥6 并**显式核对多出来那条是空段落**（而不是放任数据错位）；
  ④ Word 的换算与归一：2 倍行距落到 `wdLineSpaceDouble` 而非 `Multiple`、`Multiple` 的 `LineSpacing` 单位是磅
  （1.08×12pt 报 12.95）、`nil` 显式去边读回 `LineStyle 9999999`（与 0=none 分得开）、底纹色是 BGR 整数（`#fff2cc` → 13431551）；
  ⑤ Word 另存会**抹掉冗余的 `w:after="0"`**（与样式默认等价就不写）、给边框补 `w:space="0"`、颜色改大写、
  中文 Word 的样式 id 是数字（`Heading2` → `2`）——读侧必须通吃，而"显式 0 的保真"由我们自己那条往返腿断言
- **验证（四腿）**：结构测试 **52 断言**（docx/odt 写侧字面 + 保真导入读回，含 1/240 与二十分之一磅两套、
  `w:after="0"`、`atLeast`、按行估算）；CDP 真机冒烟 **43 断言全绿、页面异常 0 条**（6 块×9 属性：schema →
  真实 DOM → `getHTML`/`setContent` 的 CSSOM 重解析零漂移 → 存 docx 重开 → 存 odt 重开 → 工具条真点出来生效）
  + **Word 另存的那份再被本应用读回 9 断言**；**Word 16.0 实机 20 断言**（`P1 rule 5 / line 12.95 / before 10.8 / after 0`、
  底纹 13431551、上边 single/sz4/`#8899aa`、下边 9999999、固定值 4/18pt、最小值 3/14.25pt、未声明段零凭空值、
  标题 `OutlineLevel 2` + 24pt + 段后 9pt）；Word 原样另存件 **OOXML 差分 24 断言**（`w:line="259"`/`w:before="216"`、
  `w:sz="4"`、`w:val="nil"` 原样写回、`w:fill="FFF2CC"`、`w:lineRule="exact|atLeast"` 360/285、
  无声明段连 `w:pPr` 都不写、有排版的四段才写 `w:spacing`）；`cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 脚注与尾注：真往返（v0.40）

- **新增 `note` 内联原子节点**（`src/lib/note-extension.ts`）：`kind`（footnote/endnote）+ `text` 两个属性，
  正文不摊进文档流；`parseHTML` 认 `span[data-oo-note-kind]`（保真导入写的就是这一个 span，
  docx 与 odt 两条读侧产**完全同一个**标记，编号/附录/UI 因此只有一套代码），`renderHTML` 挂 `.doc-note`
- **编号一律按文档顺序现算，没有一处存号**：屏上是 CSS counter（`.doc-content` 里 `counter-reset: oo-fn oo-en`，
  两种 kind 各自 `counter-increment`，`::before` 出圈号）；docx 导出把 `w:footnoteReference w:id` 现编 1..N、
  ODT 导出写 `oofn1/ooen1` + 字面 `text:footnote-citation`。于是**插入与删除自动重排，不需要 JS 回写号**，
  冒烟里删一条再看编号从 `1,2,3,1` 回到 `1,2,1` 就是这条设计的验收，而不是某个函数的返回值
- **属性里的换行会被解析器归一成空格**——XML 与 HTML 都一样（连 `&#10;` 也归一），所以多段脚注正文
  存进 `data-oo-note-text` 前必须过 `encodeNoteText`（`\n` → 两字符 `\n`，反斜杠自身也转义），
  读回再 `decodeNoteText`；docx 侧一段一个 `w:p`、ODF 侧 `text:line-break`，两边都靠这一个编解码守住"两段还是两段"
- **docx 读侧**（`lib/docx-fidelity.ts`）：`w:footnoteReference`/`w:endnoteReference` 按 `w:id` 去
  `word/footnotes.xml`·`word/endnotes.xml` 配正文；`w:type="separator"`/`"continuationSeparator"`（含负 id `-1`/`0`）
  是结构件不是正文，必须跳过；引用那一跑带的 `rStyle="FootnoteReference"` 不能被当成正文的下划线或字色；
  **有号没正文**（被截断的转换、损坏件）→ 记一条 warnings 并**不产空标记**（docx 与 ODT 两侧同一条纪律：
  留一枚空圈号会在下一次导出时长成一条真空白脚注）
- **docx 写侧**（`lib/docx.ts`）：`footnotes`/`endnotes` 记录 + 每条正文自带 `<w:footnoteRef/>`——
  **自动编号的铁证**就是这个元素而不是字面 "1."，Word 才会自己重排；多段正文拆成多个 `w:p`；
  `[Content_Types].xml` 与 `document.xml.rels` 两处注册缺一条 Word 就当这份部件不存在
- **ODT 双向**（`lib/odt.ts`）：写 ODF 1.2 的内联写法（`text:footnote-reference` 与 `text:footnote` 同 `text:id` 相邻、
  正文段间 `text:line-break`、脚注段挂 `FN` 自动样式）；读侧三种外壳都收——新版两个元素名、
  旧版（ODF 1.0/1.1 与不少转换器）单一 `text:note` + `text:note-class` + 再套一层 `text:note-body`。
  正文表**先扫全文建全表**再配 id，所以第三方件里正文排在引用之前、或 id 不连续都认得
- **UI**：工具栏「脚注」「尾注」+ 草稿输入框（Enter 落盘）；文末 `.doc-notes` 区分两组（标题带条数、
  行首序号与圈号同源、`textarea` 直接改正文、定位/删除按钮）；`@media print` 把文本框换成静态块——
  打印出去的是脚注，不是一个带边框的输入框
- **坑**：① **TipTap v3 的命令只能填 `tr` 并调用它给的那个 `dispatch`**——命令体内再 `view.dispatch(tr)` 一次，
  链式调用（`.focus().insertNote()`）末尾 TipTap 会把同一份 `tr` 提交第二遍，抛
  `RangeError: Applying a mismatched transaction`；纯 JS 与结构测试都测不到，**真机点工具栏那一下才炸**；
  ② Chromium 的 `getComputedStyle(el, '::before').content` 对 CSS counter 返回**未解析的** `counter(oo-fn)` 记号，
  a11y 树里根本没有伪元素节点（实测 613 节点 / 0 伪元素）——那个数字在页面上读不出来，
  于是圈号断言只能比"计数器接线"（`counter-increment` + 宿主 `counter-reset`）加附录里 JS 自己算的序号，
  "编号由阅读器现算"这件事改由 OOXML 的 `<w:footnoteRef/>` 字面来断言；
  ③ 这台 Word 的 adapter 里 `Footnote.Reference.AutoReference`、`Reference.Text`、`Footnote.Index` **恒返回空串**
  （与 v0.38 的 `Range.Runs` 恒 0 同类），编号类断言一律走 OOXML 字面；
  ④ 本机 Word 的 `SaveAs/SaveAs2` 挂死（见"开发备注"），所以"别人写的件"这一腿改由**手搭的 Word 形状 OOXML**
  与 docx 库写出件共同顶上
- **验证（四腿）**：结构测试 **70 断言**（编解码往返 5 组、docx 写侧字面含 `w:footnoteRef` 计数与"序号不是字面文本"、
  保真导入读回、docx 库件（id 1/7 不连续）、**手搭 Word 形状件 12 断言**（负 id 分隔符、乱序条目、表格里的引用、
  有号没正文）、odt 写侧字面与 `text:id` 配对计数）；CDP 真机冒烟 **74 断言全绿、页面异常 0 条**
  （`setContent` → schema → 真实 DOM（上标位/不可选中/CSS 计数接线）→ 工具栏真点插入 + 改正文 + 删除后编号自排 →
  存 docx 重开 → 存 odt 重开 → docx 库件 → **旧式 ODF `text:note` 外壳件**）；
  **Word 16.0 实机 10 断言**（`Footnotes.Count 2`/`Endnotes.Count 1`、正文逐字对得上、
  多段脚注在 Word 里读回**真是两个 `Paragraphs`**、脚注段挂"脚注文本"样式、正文没被复进主文档流、
  第一段确实带着第一枚引用）；`cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 文本框与公式：字不许消失（v0.41）

排序标准是丢东西的严重程度：**文字丢失 > 版式丢失 > 装饰丢失**。这一轮把读侧剩下那两条
"整块文字凭空不见"的洞堵上（docx 与 ODT 各半），版式则如实记进边界账而不是假装还原。

- **文本框展平**：`w:txbxContent`（现代 `wps:txbx` 与旧式 `v:textbox` 两种外壳）里的段落以前整块丢弃，
  现在按文档顺序**展平为普通段落**插回原位置——框内段落自带的首行缩进/居中/粗斜继续走同一条段落路径，
  不另造"文本框节点"（`hasnt(html,'data-oo-textbox')` 是这条纪律的验收）；ODT 侧同构：`draw:frame` 里
  现在认 `draw:text-box`，框内多段用 `<br/>` 连在所在段落里
- **`mc:AlternateContent` 只取一支**：同一份正文 Word 会写两遍（`mc:Choice Requires="wps"` +
  `mc:Fallback` 的 VML），旧代码两支都下钻 → **内容翻倍**；策略定为取 Choice，只有它什么都没产时
  才退回 Fallback（块级与行内各一处，local name 保大小写所以是 `'AlternateContent'`）
- **公式线性化**：OMML（`m:oMath`/`m:oMathPara`）与 MathML（ODF 的 `Objects/objectN/content.xml`）
  翻成同一种可读文本——`a/b`、`x^2`/`x^(ij)`、`a_i`、`√(y)`、`3√(x+1)`、`[v]`、`∑_i^n a`、矩阵 `1 ; 2`；
  规则：`m:*Pr`（含 `m:ctrlPr`）一个字都不产，含空格或运算符的片段加括号才不歧义，
  `m:rad` 是"次数在前"而 MathML `mroot` 参数顺序**正好相反**，`annotation`/`annotation-xml`
  （LaTeX/StarOffice 源码）绝不能漏进正文，`semantics` 只取首子。不引 KaTeX：编辑器里没有承载结构的节点，
  多一个渲染依赖换来的只是把同一批字画得好看
- **域代码与题注没坏**：`fldChar` begin/separate/end 三道门（v0.37 起）已让 `SEQ`/`REF`/题注按缓存文本
  落进正文，本轮实测确认；剩下的诚实边界是 SmartArt（字在 `diagrams/dataN.xml` 那棵树里，摊成扁段落
  等于说谎）与 OLE 对象，各记一条带 `ProgID` 的具体告警
- **边界账按类计数**：`warnings` 由"每条一记"改成**同类聚合**（`Map<文案, 次数>`，出口写成
  `文本框内容已展平为段落（位置与文字环绕未保留）×3`），docx 与 ODT 两条读侧同一套；状态栏照旧显示首条
- **坑**：① `__oofDocCtl` 这个全局指向"**最后一次渲染**的 doc 面板"，而导出后的 `setTimeout(setStatus(''))`
  会在开下一个标签之后重渲染旧面板、把全局改回旧实例——冒烟第一次跑就把 `round.odt` 导出成了 docx 那份内容，
  DEV 钩子必须按 `__oofDocCtlByTab[tabId]` 取；② 断言"翻倍"只能用**计数**（`split(needle).length-1`），
  `includes` 在内容写两遍时照样绿；③ Word 把文本框正文放在**另一个故事**里（`wdTextFrameStory=5`），
  正文 `Range.Text` 根本没有它——所以"展平"是我们主动做的合并，Word 腿要按故事类型读；
  ④ 这台 adapter 的 `Shape.TextFrame.HasTextFrame` **恒假**而 `.TextRange.Text` 照样给回正文，别拿它当门
- **验证（四腿）**：结构测试 **29 断言**（文本框三段各一次、Choice 空壳退 Fallback、OMML 七种形状单元核对、
  SmartArt/OLE/EMF 三条具体边界、图片链路未回归）；**Word 16.0 只读腿 10 断言**——同一份手搭件
  （schema 完整到 Word 真认：6 段 + 2 枚浮动框 + 1 张内联图 + 1 个公式），Word 框内正文与故事逐句对上我们
  展平出来的那几条，而 Word 自己的公式字面是 `𝑥2+𝑎𝑏`（**零连接符、字母还是数学斜体码点**），
  恰好证明"读得出字、读不出结构"，我们补的 `^` `/` 就是那层结构；CDP 真机冒烟 **32 断言全绿、页面异常 0 条**
  （打开 → 真实 DOM 逐句计数 → 展平的件存回 docx/odt → 再开自产物字仍在且不重复）；
  `cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 图形部件：SmartArt 与图表的字也不许消失（v0.42）

续项六的第一刀。这两个部件的正文都不在 `document.xml` 里——SmartArt 的字在
`word/diagrams/dataN.xml` 的**数据模型**树里、图表的数据在 `word/charts/chartN.xml` 的**缓存值**里，
以前一律只留一条"未导入"告警，整块文字凭空不见。现在的纪律照旧：**还原不了的如实在账，能还原的进文档模型**，
不新造节点（层级走 `bulletList`、数据走 `table`、格内层级走段落 `indentLeft`）。

- **SmartArt（DiagramML）**：`dgm:relIds r:dm` → dataModel 的 `ptLst` + `cxnLst`，按 `parOf` 边建树、
  `srcOrd` 定兄弟序（真实文件里 pt 与 cxn 都是乱序的）→ **嵌套无序列表**，一个节点一个条目、
  节点标签里的多行 `a:p` 并成一行。三处脏数据要兜：无字节点（`type="doc"` 的根、以及中间空节点）**不下钻就丢整支子树**，
  所以照钻但不成条目；同一节点被两处认父、还有 `sib` 边与反向边成环 → 以"首次认父"为准并挡住回边；
  `a:fld type="diagNum"` 的缓存编号**绝不采**（那是宿主现算的域，采了就把"9."画进正文）
- **图表（ChartML）**：`c:chart r:id` → chartSpace，系列按名字下钻找（`c:barChart`/`c:lineChart`/… 都吃得下），
  每行一个类目、每列一个系列 → 标题段 + **数据表**；`c:cat`/`c:val` 中间那层 `strRef`/`numRef` 别忘，
  `c:pt/@idx` 的**空洞留成空格**（压成顺序就把后一列前移了）、`multiLvlStrRef` 各级拼进同一格、
  系列名可能是字面 `c:v` 而非引用、坐标轴自己的 `c:title` 不能混进图表标题；
  纯引用无缓存（Word 里"待重算"的图）→ 只取回标题 + 一条告警，**不出空表**
- **落在表格里就展平**：`<w:tc>` 只能装段落，所以格内的图示/图表按深度写 `margin-left`（一档 32px）而不是列表或表格
- **边界账**（同类聚合 ×N）：`SmartArt 已按数据模型的父子层级展平（图形版式、配色与连线方向未保留）×2`、
  `图表已按文件里的缓存值取回数据（图表类型、坐标轴与配色未保留）×2`、`图表部件里没有缓存数值，只取回标题`、
  `SmartArt部件里没有可读的文字`、`SmartArt关系缺失…`、`图表部件未找到：word/charts/ghost.xml`
- **三处真 bug 全由"存出去再开回来"那两条腿抓到**（都早于本轮，纯读侧单元测试照不到）：
  ① docx 写侧把一格里的**所有子节点并成一个 `<w:p>`** —— 第二行起既没换行也没了自己的缩进/对齐，
  而图示部件落进格子恰好就是多段，于是整格在 Word 里糊成一行；改成逐块出 `w:p`，并补"空否则会成损坏件"的守卫
  （`w:tc` 至少要一个 `w:p`）；
  ② docx 读侧遇到 `ilvl` **跳档**（Word 真会写 0 直接跳 2）就凭空补中间层，屏幕上一排没字的空子弹；
  第一版只 clamp 上限，结果兄弟项被当成子女爬成楼梯（新加的等值断言抓到），最终按 `numId` 记**基准层**折算；
  ③ 形状约束：TipTap 的 `listItem` 是 `paragraph+`，而我们的 docx 写侧只认条目的第一段——
  所以渲染端改成"一个节点一段"，不去造写侧承不下来的形状（造了就是静默丢字）
- **坑**：① `ListLevelNumber` 挂在 **`Range.ListFormat`** 上，不在 `Paragraph.Format` 上——
  写成后者恒得 `$null`，于是"三级列表"这条断言假失败，还被记成"这台机器读不出层级"（其实 1/2/3 级全读得回）；
  ② 手搭图形部件 Word 认不认，**必须和骨架分开归因**：同一套 `[Content_Types]`/rels/正文不放部件时 Word 能开，
  放了 ChartML 也能开（前提两处规格：`c:spPr` 要在 `c:tx` **之后**、柱图必须 catAx + valAx **两个轴都在**且各带
  `scaling`/`crossAx`——读侧对顺序不敏感，所以自家结构测试全绿也照不出来），
  而 DiagramML 那份仍判「文件可能已经损坏」：`layoutDef` 要真版式（`constrLst`/`algLst`）与配色方案才画得出来。
  这一条如实记进边界而不是继续手钻：应用只**读**别人写的图示部件，从不产出 DiagramML
- **验证（四腿）**：结构测试 **41 断言**（层级/多段/环与反边/srcOrd 序/域编号不采/格内展平/空洞 idx/多层分类轴/
  无缓存只取标题 + 整包从 zip 到 HTML + 干净件与边界件同读）；CDP 真机冒烟 **64 断言全绿、页面异常 0 条**
  （打开 → 真实 DOM → 存 docx 重开 → 存 odt 重开，含格内多段那条形状）；
  **Word 16.0 只读腿 11 断言**（我们的导出件：39 段 / 2 表 / 格内 6 段且第二段 `LeftIndent=24pt` /
  列表层级读到 1·2·3 三级 / 图表数据表逐格对得上；手搭件：骨架能开、ChartML 认成图表且 `Chart.ChartTitle` 读得回缓存标题）；
  `cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 域编号重算与嵌入对象可见化（v0.43）

续项六的第二刀。题注、交叉引用、页码这些**域**在文件里是"代码 + 上次算出的缓存"两份，
v0.37 起我们只把缓存抄进正文——于是别的工具编辑过的文档会带着对不上的号原样呈现
（实测夹具里三枚题注的缓存是 `1、2、2`）。这一轮把"哪些号我们能算、哪些不能"划清，
并且**算得出的绝不抄缓存、算不出的绝不假装**。

- **`SEQ` 一律现算**（`src/lib/docx-fields.ts`）：它是纯文档顺序计数器，跟着渲染走一遍就有答案。
  三条纪律：① 缓存结果**照采但不留**（`separate` 之后的那段被 suppress，出口写我们算的那份）；
  ② **被跳过的分支不占号**——所以计数不能预扫、必须嵌在渲染顺序里（目录 `w:sdt` 整块跳过时里面几十枚
  `PAGEREF` 一枚都不许消耗 `SEQ`）；③ 只有代码没有 `separate` 的域（部分工具这么写）也在出口补现算值，
  不留空。同名 label 各一条序列，`图` 与 `表` 互不影响
- **大小写由开关自己决定，不是由缓存决定**：Word 按 `\* ROMAN` / `\* roman` / `\* ALPHABETIC` /
  `\* alphabetic` **这个 token 自身的大小写**给出 I / i / A / a（16.0 实机逐枚测得）。旧代码把开关
  统一转小写再各自硬编码，`ROMAN` 恰好对、`ALPHABETIC` 就错成了小写——这条是 Word 腿抓到的真 bug
- **`REF`：有缓存照原样，没缓存按书签段落文本兜底**（Word 常只写代码）。书签表必须在渲染**之前**
  扫全篇建好——交叉引用可以指向后面的段落，逐段渲染到那儿才知道就晚了；表格单元格里建的进表也认。
  只排掉 `_GoBack`（Word 反复挪动的光标书签）：**题注与目录的自动书签就叫 `_Ref…`/`_Toc…`，
  按"下划线开头"整类过滤会把 REF 唯一能兜底的那张表清成空的**。查不到的书签不硬塞文本，只记一条边界
- **`PAGE`/`PAGEREF`/`DOCPROPERTY`/`STYLEREF` 沿用缓存**：分页取决于版心，我们的排版与 Word 不同，
  现算出来的页码**比抄缓存更容易错**；没有缓存时明确记 `PAGEREF（_RefX）没有缓存结果，未重算`
  （此前是静默变空）。自家 TOC 件重开不报这条——`docPartGallery` 那条守卫先整块跳过了目录
- **OLE 嵌入对象：预览解不开也要看得见**：EMF/WMF 预览浏览器解不了，以前只剩一条告警、文档里
  什么都不留；现在在原位置放一行正文占位 `〔嵌入对象：Excel.Sheet.12，Microsoft_Excel_Worksheet.xlsx，内容未提取〕`
  （ProgID 取自 `o:OLEObject`，文件名经 rels 反查），能出预览图（PNG/JPEG）就出图、**不叠占位**。
  占位是真正文节点，所以 .odoc 存盘重开、docx/odt 导出再开都在。**内容（CFB / 嵌入包）提取当时仍未做**，
  下一轮（v0.44）补上

- **坑**：① **PowerShell 位置传参 `Ok($cond,'文案')` 会把整个括号当成一个数组参数** → `$msg` 恒 null、
  `$cond` 恒非空数组恒真，上一轮那条腿的"6 通过 3 失败"全部无意义。改成空格分参 `Ok (条件) '文案'` 并在
  helper 里 `param([bool]$Cond,[string]$Msg)` 显形参；判据是**失败时文案要能变**（本轮先证 `Ok($false,…)` 也打印 ok）
  ② Word 在**只读**文档上 `Fields.Update()` 返回 `0`（假），可结果确实重算了——别拿返回值当"更新失败"
  ③ 域前后的空格必须在 `w:t` **里面**（Word 为此写 `xml:space="preserve"`）：XML 元素**之间**的空白不是文档文本，
  夹具把空格夹在两个标签中间，就造出一个"我们把域后的空格吃掉了"的假 bug
  ④ 手搭夹具里 `w:p` 不能套 `w:p`（Word 判"文件可能已经损坏"），书签 helper 只收 run 级内容——本轮先怀疑 Word
  不认我们的件，直到同一份件用 docx 库写出来 Word 秒开，才把账归到骨架上
  ⑤ 超链接的外部目标要带 `TargetMode="External"`，OLE 要同时有预览图 rel 与 `embeddings/` 部件 rel，
  目录 `sdt` 要有 `docPartGallery`——少一条，测试就是在验一个形状不对的件

- **验证（四腿）**：**结构测试 38 断言**（SEQ 顺序/同名 label/ROMAN 与 roman/ALPHABETIC 与 Alpha 四形态/
  无 separate 也现算 / REF 有缓存照原样 + 无缓存前向兜底 + 格内书签 + 查不到不塞文本 / PAGE·PAGEREF·DOCPROPERTY
  沿缓存与无缓存记边界 / fldSimple 同路 / 超链接内不重复不漏字 / OLE 三种预览各走各的路 / 目录不占号 +
  自家件导出→重开不出现"没有缓存结果"）；**CDP 真机冒烟 27 断言全绿、页面异常 0 条**（打开 →
  真实 DOM 逐枚计数 → .odoc 正文性 → 存 docx 重开 → 存 odt 重开 → 关掉再开，编号三次一致）；
  **Word 16.0 只读腿 11 断言**——同一份夹具让 Word 自己 `Fields.Update`，`1|2|3|1|I|II|A|i|图 1|1`
  与我们算的逐枚相同（含大小写两形态），并核回更新前缓存确实是 `1|2|2|9|I|II|z|XVIII|图 1|7`；
  `cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿

## 嵌入对象里的字：CFB 容器与内层文件（v0.44）

续项六的最后一刀，也是路线图里最后一条未勾的功能项。v0.43 只做到"看得见有个对象"，
而对象里面通常装着**真正的文字**：Word 的 `word/embeddings/oleObjectN.bin` 是一套复合文档
（OLE 2 / MS-C），流 `\x01Ole10Native` 里又装着一个完整原生文件（Excel 工作簿、另一份 docx、
CSV、txt…）。这一轮把这层套娃拆到能读到底为止——读不到底的地方一律说清楚，不塞乱码。

- **容器形状两种，都由本机真件实测得来**（扫描到的分布：CFB 的 `.bin` 70 个、直接放的
  `Microsoft_Excel_Worksheet.xlsx` 21 个、`.docx` 2 个、Visio `.vsd` 1 个）：现代 Office 常把
  原生文件**直接**放在 `embeddings/` 下（本身就是 zip，没有 OLE 包装）；老的 Package 对象才套一层
  复合文档。两条都在同一条分派里走，先魔数后文件名
- **`src/lib/cfb.ts`：零依赖复合文档读侧**（不碰 DOM，所以 Node 侧与页面内跑同一份代码）。
  DIFAT（头里 109 直槽 + 链）→ FAT（扇区编号即数组下标）→ 目录链；小于 4096 的流住进根存储那条链
  装的迷你流，由 miniFAT 按 64 字节迷你扇区串；同一存储下的条目是红黑树（left/right 树兄弟、
  child 指孩子的树根），遍历带 `assigned` 闸门防环。**结构不合一律返回 `null` 不抛**：调用方要的是
  "取不到就记一条边界"，而不是把整次导入掀掉
- **`Ole10Native` 的字段布局是逐字节量出来的**（真件 1.5MB 的 oleObject1.bin）：
  `DWORD cbSize | WORD 0x0002 | label asciiz | 源路径 asciiz | 4 字节占位 | DWORD 临时路径长度（含结尾 \0）|
  临时路径 | DWORD 数据长度 | 数据 | 尾部一百多字节`。两个要点：**数据不贴着流末尾**（按流长反推必错），
  而严格走字段只覆盖了量到的这一种写法，所以走不通时再按"哪枚 DWORD 能把数据吃到接近结尾"扫一遍兜底
- **内层类型分派**（`src/lib/ole.ts`）：docx → 递归 `docxToHtmlFidelity(bytes, depth+1)`（套到第二层停）；
  xlsx → 只要值（共享字符串、`inlineStr`、按 `r="C5"` 定位、跳过的空列不挤位）→ `<table>`；
  CSV → 分隔符按首行嗅探 + RFC4180 引号规则 → `<table>`；txt → 按空行分段（UTF-8 出替换符就换 GBK 重试）。
  老式内层（Excel 97 的 BIFF、Word 97 的 FIB）与裸位图**不硬解**，如实给一条带真名与大小的边界说明；
  内层最大 24MB、表格 200 行 × 40 列 × 4 张表、文本 64KB / 200 段，**截断都写进告警**而不是静默少给
- **两条接缝都吃这套结果**：docx 保真导入器的 `w:object`（取到内容就不再叠 v0.43 那条占位），
  以及 ODT 的 `draw:frame`——`<office:binary-data>` 内联 base64 与 `Objects/objN/` 目录两种形状都解。
  摊出来的是**块级**正文（表格、多个段落），而 `draw:frame` 与 `w:object` 都住在段落里：所以块级正文作
  段落的**兄弟块**接在后面（`embedBlocks` + 各出口 `tail()`），单元格里的则压成行内文本（`inlineFlatten`）——
  嵌套表放不进 `<td>`，硬塞等于让 ProseMirror 的内容表达式把整块字丢掉
- **三处真 bug，全是"读得到字节才算数"的那类**：① `Ole10Native` 偏移 4 的标志是 **WORD** 0x0002，
  按 DWORD 读会把紧随的 label 头两字节一起吃进长度里 → 本机那份真件一直返回"没认出来"；
  ② 截断的复合文档（zip 里只存了一半）最后一枚扇区是残缺的，照整枚去 `DataView` 读直接
  `RangeError: Offset is outside the bounds of the DataView`，改成 `lastSec = floor(len/sec) - 1`；
  ③ ODT 的 `case 'frame'` 把取内容整段压在 `if (href)` 后面——而内联 base64 那种写法**根本没有 href**，
  于是它永远走不到（这一条是冒烟造夹具时才暴露的）。顺手补了 `content.xml` 的 `parsererror` 守卫：
  XML 坏了以前是"安静地打开一篇空白文档"，现在说得出是哪份 XML 坏了

- **坑**：① 单元格里的嵌入内容展平后**不再是表格**，那条"已取值为表格"的告警要有前置的一条
  "单元格里的嵌入内容已展平为文字"，否则状态栏第一句就是矛盾的；② 截断上限要**多取一行当探针**——
  `csvRows` 恰好截在 200 行时，"后面还有"这件事本来就说不出口了；③ 手搭 ODF 夹具的命名空间前缀必须
  声明到位（URI 是 `...:drawing:1.0` 而前缀惯例是 `draw:`），漏了就是整份 XML 解析失败，
  表现为"导入没报错但文档是空的"，最难查；④ 占位文字里能说的是**外层部件名**（`oleObject4.bin`），
  内层真名（`img.rgb`）只在告警里——冒烟断言要按这个分工写，不然就是假失败

- **验证（四腿）**：**结构测试 80 断言**（容器三条读分支 + 坏件一律不抛 + Ole10Native 两种写法 +
  类型分派与各种上限 + `embedHtml` 五种内层 + docx 接缝五种形状 + 格内展平）；**本机真件腿**——
  Word 写的 `oleObject1.bin` 读回 `\x01Ole10Native=1555443` 字节、内层判为 `img.rgb`（1519KB 裸位图）、
  按边界说明处理且不产正文（内容只按结构核对，不进仓库也不入日志）；**CDP 真机冒烟 24 断言全绿、
  页面异常 0 条**（docx 五种形状与 ODT 两种形状都**落在真实 DOM** 上验：4 张表格节点、`<td>` 里零嵌套表、
  `h1` 带级别、状态栏有边界账，再各自存 docx / odt 重开确认字不是一次性的）；
  `cargo test --lib` 39 通过（Rust 零改动）+ tsc/build 绿。**本轮写侧零改动**（只读不写），
  所以 Word 实机腿不适用——没有新东西要它验，这一条如实记着而不是补一条空腿

## 自动更新：检测层（v0.45）

- **这一刀只做检测**：点"检查更新"→ 有新版就提示（版本号、发布日期、一行更新说明）+「前往下载页」用浏览器
  打开；**不在应用内下载与安装**。这么切不是没做完，是因为更新源托管在哪还没定——而检测层恰好是
  不需要那个决定也能全绿验证的部分（清单是真的、签名是真的、链路是真的，只有"上架到哪个地址"是占位）
- **信任根在仓库外**：`pnpm tauri signer generate` 出的 Ed25519 密钥对，私钥存 `~/.tauri/openoffices.updater.key`
  （口令另存 `.pass`），**不进仓库、不进 git 历史、不打进日志**；公钥进 `tauri.conf.json` 的
  `plugins.updater.pubkey`。代价说清楚：**这把私钥没有备份，就等于全体老用户从此再也收不到更新**
  （换钥匙 = 旧客户端验不过新签名，只能重装）
- **清单契约是本机真件量出来的，不是照文档猜的**：`createUpdaterArtifacts: true` 在 CLI 2.11 签的是
  **安装包本身**（`..._x64-setup.exe` 与 `..._x64_en-US.msi` 各带一枚 `.sig`），**没有 `*.nsis.zip`**
  （那是 `v1Compatible` 的老形状）；插件两种都吃——`infer::archive::is_zip` 判 zip，否则落成 `.exe` 直接跑。
  三条平台键各有其人：`windows-x86_64-nsis`、`windows-x86_64-msi`，再加通用 `windows-x86_64`
  兜给 dev 跑的裸 exe（exe 里的 bundle type 是打包时 patch 进去的，dev 那份没有，`get_urls` 就只找 `{os}-{arch}`）
- **`.sig` 是 minisign 文本，签名钉在具体文件上**：第三行 trusted comment 带 `file:<包名>`，所以"清单里的 url
  与传上去的包不配对"这种错，用户端的表现就是验签失败——发版脚本自己先把这一对核了再出清单
- **失败必须说得出为什么**：`lib/update.ts` 把所有异常收敛成 `{state:'failed'}` 且**永不外抛**（抛出去的表现
  是"点了没反应"），`describeError` 按插件 `error.rs` 的真实字面归因成中文——源上没清单 / 没配端点 /
  非 https / 缺本平台条目 / 签名不合 / base64 解不开 / 日期不合 / 连不上；认不出来的一律原样带出，**不编原因**。
  `download_page` 从 `rawJson` 取（插件不认这个自定义字段，我们的检测层要它才写得下去），且只认 `http(s)`，
  `javascript:` 那种直接丢掉
- **权限最小化**：capabilities 只补 `updater:allow-check`（不给 download/install，因为没接线）；
  `getVersion` 在 `core:default` 里、开浏览器在 `opener:default` 里，都是现成的
- **体积账（同一条命令、同一份 dist，只挂/摘这一个插件）**：release exe 7,093,760 → 9,001,984 字节，
  **+1.82 MiB（+27%）**。涨在它自带一整套：`Cargo.lock` 多出 36 个包——rustls/ring/webpki 整条 HTTPS 栈、
  minisign-verify、tar，以及**第二份 zip（4.6.1，与我们自己的 8.6 并存，不是复用）**。安装包侧压缩后
  v0.37.0 → v0.45.0 的 setup.exe 是 9,161,284 → 9,950,952 字节（+789,668），但这中间八个轮次的界面资源都混在
  里面，所以这一笔不能整本记给插件
- **坑**：① capabilities 里留着 `updater:allow-check` 而 Cargo.toml 摘掉插件，**tauri 的构建脚本直接失败**
  （`Permission updater:allow-check not found`）——体积 A/B 必须两处一起摘，这就是"权限面与依赖面是绑死的"；
  ② 单实例锁按 **identifier** 判，dev 与用户已装的正式版共享同一把，要并存就
  `-c '{"identifier":"com.openoffices.smoketest"}'` 而不是去杀他的进程；③ https 闸门只在发布版生效，
  本机端到端腿用 `pnpm tauri dev -c` 注入 `http://127.0.0.1:8123/latest.json`，**仓库里存的仍是 https**；
  ④ 开关型参数不能用取值型 `arg()` 解析（`--skip-build` 排在末尾时读到 `undefined`，等于没传，
  于是"只重生成清单"静默跑成一整次完整构建）
- **验证（四腿）**：结构测试 **36 断言**（清单三平台键形状 + 端点是 https + 公钥在位 + capability 只给 check +
  私钥不入仓不入脚本 + 发版脚本按"已签名安装包"找产物）；**本机端到端真件腿 17 断言**——拿真实构建的
  `latest.json` 与真 `.sig`，先自核签名与 url 的 `file:` 配对，再挂成本地静态源喂给应用：**同版本判"已是最新"**，
  把版本号改成 99.0.0（签名与 url 都还是真的）后应用内真的报"发现新版本 99.0.0"并带出真发布日期、真更新说明、
  可用的下载页按钮；**CDP 真机冒烟 22 断言全绿、页面异常 0 条**（available / latest / 404 / 缺本平台条目 /
  坏 `pub_date` / 返回 HTML / `javascript:` 下载页 / 源不可达 八种形状）；`cargo test --lib` 39 通过 + tsc/build 绿
- **下一刀（应用内下载安装）要动什么**：capability 补 `updater:allow-download` + `allow-install`（或
  `allow-download-and-install`）、更新源定到一个真实 https 地址、前端改调 `downloadAndInstall()` 再
  `relaunch()`（Windows 装完默认自己重启，`restart_after_install` 是 true），那时 `download_page` 就可以不写了

## 表格规则的往返：筛选 · 数据验证 · 条件格式（v0.46）

- **补的是"设了就凭空不见"这一类**：三样规则从 v0.2 起就能在界面里设，但 `payloadToWorkbook` 把快照的
  `resources` 硬写成 `[]`、`workbookToPayload` 从不读它，所以**存一次盘整块丢**。按"丢东西的严重程度"排，
  用户亲手设的判定规则消失比颜色不准更恶劣——这一轮是表格保真线上欠得最久的一笔
- **规则不住在 sheet 对象上**：Univer 把它们交给各插件自己序列化进工作簿快照的 `resources`
  （`SHEET_CONDITIONAL_FORMATTING_PLUGIN` / `SHEET_DATA_VALIDATION_PLUGIN` / `SHEET_FILTER_PLUGIN`，
  每张表按 sheetId 分家）。所以**取**是纯函数 `extractRules`（零 DOM、Node 里直测），**放**必须走门面
  `applySheetRules`——Univer 建工作簿时并不会照我们自己写的那份 JSON 还原界面，只把载荷塞回快照是假往返
- **载荷是归一化模型，不是第三方内部 JSON**：`RangeRect` 0 基含端点、`kind`/`sub`/`op`/`type` 一律用 OOXML
  字面、颜色收成 `#rrggbb`、日期收成 `YYYY-MM-DD`，不存 cfId/uid 这类运行时标识。代价是两侧各写一次换算，
  换来的是"这条规则从哪来"（界面上设的 / 别人文件里读的）不影响我们存出去的字节
- **三处 OOXML 反直觉，逐条踩**：`showDropDown="1"` 说的是**没有**下拉箭头、`filterColumn/@colId` 是相对
  筛选区首列而不是绝对列、日期验证的值是 1900 序列号（`date_serial`/`serial_to_date` 自带 civil→days 换算，
  不为此引日期库；别的工具直接写日期串时原样交回，**不解成 1899 年**）
- **`dxf` 与 `cellXfs` 不是一套东西**：条件格式的着色直接住在 `<dxf>` 块里（粗斜体、字色都没有 fontId 索引），
  实心底纹落在 `bgColor` 而不是 `fgColor`（那是 Excel 反过来才写的），`cfRule/@dxfId` 按下标指 styles.xml 的
  `<dxfs>` 表，所以单独扫一趟而不是复用 StyleBook
- **图标集不抄名字表**：`icon_type_for` 逐个问 crate 的 `Display` 拿 OOXML 家族名（`3TrafficLights1`/`4Arrows`…），
  家族名不在能写出的那批里就记账、不硬凑一个像的；OOXML 的最低档**根本没有 operator**（隐式"≥0"）而 Univer 写
  `lessThan`，读回来按前者归一，档位数与家族图标数不符时按默认档位写出并记账
- **被筛掉的行要喂打印**：Univer 只在界面上现算隐藏，快照的行数据里根本没有这些行；而第三方件的筛选在 OOXML 里
  就是 `hidden` 行——`filter.filteredOut` 与 `hiddenRows` 并成一列剔除，才不会打出一份"没筛过的表"
- **ODS/CSV 先记账不硬做**：ODF 的三样确实存在（`table:database-range` / `table:content-validations` /
  `table:conditional-format`，都住在 content.xml），我们暂不读，但"文件里确实有"这一趟就要说得出；
  对照组同样重要——**我们自己写出的 ODS 不许凭空记出一条规则账**，否则状态栏沦为噪音。CSV 天生无规则，保存时明说
- **两条账都不断头**：`write_xlsx` 的返回值改成边界账数组（区域不成形、色阶档数不对、图标家族不认识、
  提示语超 Excel 面板的 32/255 字上限——**超限只能不写这一项并记账，裁过的提示语在别人电脑上是另一句话**），
  读侧 `WorkbookPayload.warnings`（认不出的判定型、按颜色筛选、`A:A` 这类读不懂的区域片段——只按能认的部分收，
  **绝不猜一个区域来冒充**），状态栏同类聚合成「文案 ×N（另有 M 条说明）」
- **坑**：① crate 的 `set_multi_range` 是**整串替换**而不是补在已设区域之后（实测只给"除第一块"会把第一块整个弄丢），
  所以区域一律先并成一个 `sqref` 再交出去；② rust_xlsxwriter 的默认负色是 Excel 的默认红条，载荷没设负色时
  **必须显式把负色压成正色**，否则从没碰过负值颜色的文件里会凭空多出 `<x14:negativeFillColor>FF0000`；
  ③ Univer 的 `nativeColor` 在"根本没设负色"时装的就是我们塞过去的正色，所以取侧要丢掉 `neg === pos`——留着它，
  "快照直接存"和"读文件再存"两条路会产出两份不同字节；④ `ignore_blank` 必须按载荷的 `blank` 显式给，
  否则 OOXML 的 `allowBlank`（默认 0）与我们界面的"没明说"不对称，第三方件的 `allowBlank="1"` 存一次就被偷偷抹掉；
  ⑤ 条件格式要**倒着插**（这一版门面按插入顺序的倒序吐规则，正着插会把整表优先级反过来），而 builder 的
  `setRanges` 只在 `.d.ts` 里存在、实例上没有，作用区只能 `build()` 之后挂到产物上；⑥ `extractRules(...).rules` 是
  **Map**（`Object.keys` 恒 `[]`）；⑦ 断言"区内规则相对次序不变"不能拿全局排序后的数组比（自反得毫无意义），
  要另留一份未排序的原始序
- **验证（四腿）**：**前端结构测试 53 断言**（三种插件 JSON 外壳各走各的分支 + 颜色/日期/list 归一 +
  门面建不出来的类型退成边界账而不是硬建 + 同色负色被丢掉）；**Rust 6 个新用例 + `cargo test --lib` 49 通过**
  （一份 `rules_workbook` 夹具同时喂写侧 XML 落点、读到写的 round-trip、别人写的件逐样报账、dxf 表自解、
  欠账记得住）；**Excel 16.0 只读腿 26 断言**（真件里 `AutoFilter.Range.Address`=A1:D7、B 列按 30/12 筛后只剩
  2 行、DV 与 CF 的类型/操作符/公式/颜色逐个对得上，并直接解 zip 核 `negativeBarColorSameAsPositive="1"` 出现
  2 次而 `x14:negativeFillColor` 0 次、`gradient="0"` 在位——这台 Excel 的 COM 面不暴露 dataBar 细节，
  负色只能按文件核）；**CDP 真机冒烟 26 断言全绿、页面异常 0 条**（打开→放下与取回逐条一致→实色数据条在 Univer
  里仍是实色→存 xlsx 重开→重存自产物零记账→ODS 只报边界不谎称读回）；tsc/build 绿

## 表格 PDF 打印保真：条件格式的色与图表的图进打印（v0.47）

- **补的是"屏幕上明明有、纸上没有"**：v0.46 让三样规则存得下、开得回，但打印链路只吃静态样式——
  `sheet-print` 从来不看 `condFormats`，图表又只作为 Univer 的浮动图片活在 canvas 上，而
  `PrintToPdf` 抓不到画布。于是同一张表，界面上红红绿绿带折线图，导出的 PDF 是一张白底数字表
- **条件格式在打印侧重算一遍，不抄界面上的色**：Univer 的求值住在画布里拿不到，而载荷本来就带着
  判定规则（`kind`/`sub`/`op`/`v1`/`fmt`/`scale`/`bar`），所以新建 `lib/sheet-cf-print.ts` 的
  `evalSheetCondFormats(sheet)` 纯函数自己算出 `{patches: Map<'行,列', CfPatch>, notes: string[]}`。
  分工照老规矩：**数值 / 文本 / 重复与唯一 / 前 N 与均值 / 色阶 / 数据条算得出就画；公式判定、日期区间、
  图标集算不出就记账**，一条都不硬凑颜色冒充
- **六条"Excel 就是这么画的"细节，全靠跟 Excel 对表才对上**：① 色阶的分位数是在排序列上**线性插值**
  出来的，不是"取第 n 个"；② 数据条在有负有正时把起点放在 **0 轴**上、负值往左长，渐变条靠轴那端浅、
  尖端深（实色条两端同色）；③ "前 N 项"**含并列**——以第 N 大的那个值为界，同值的整片都算进去；
  ④ 文本判定的空条件串是"格为空"那一项，不是"包含空串"（后者会命中区域里所有格）；⑤ 数字 `1` 与文本
  `"1"` 要归一成一个比较键，因为 Excel 那套比较（COUNTIF 语义）不分类型、文本判定也不分大小写；
  ⑥ 自定义端点可能把数据夹在中间，越界按 Excel 的做法**截到最近一档的颜色**
- **优先级与"命中即停"落在补丁的合并规则上**：数组顺序=优先级，同一属性**先命中的说话**（后面的规则只在
  缺口上补自己独有的属性），`stopIfTrue` 之后这一格不再被任何规则碰；`showValue=false` 打印出来是
  **值真的不在纸上**（`cellText` 直接给空串），不是"画了又被条盖住"；数据条走 `background-image`，
  与 `background-color` 天然分层，底色和条互不遮挡
- **图表按锚点格覆盖进网格**：`payloadWithCharts` 抽成保存与导出 PDF **共吃的一份产物**（否则"文件里有图、
  打印里没图"会各说一次话）→ `renderChartPng` 逐张渲染 → 锚在哪一格就绝对定位在该格左上角，并把那一格的
  `overflow` 放开（单元格默认裁掉溢出）；锚点落在合并区内时退到合并区左上角
- **真 bug 一处：图表浮在数据块外面就整个不见**。图表本来就常放在数据右下方，而打印网格的边界只按
  **数据**定，锚点格落在界外 → 那张图在打印里就此不见了（冒烟里表现为状态栏莫名多出一条"未放置"）。
  改成锚点也算网格的一部分；这样"未放置"就只剩超打印上限一种原因，账目才说得出具体行/列
- **另一处真 bug 比本轮功能更值钱：我们的 PDF 一直把屏幕的浅灰蓝铺成纸的颜色**。应用外壳
  `body{background:var(--bg)}`（`#f3f5f8`）实测占掉 **1269783 / 1759470** 像素——文档、演示、表格三种
  导出无一例外（暗色主题下就是一页黑底）。`lib/pdfprint.ts` 的 `@media print` 里给 `html,body` 兜底
  `background:#fff; color:#111`，**只兜"没人管的地方"**：单元格底色、字色这些元素自己声明的照旧说话
- **页面上只留"这份打印件缺了什么"**：超出打印上限那一类才印进 PDF（拿到纸上看的人才用得上），其余账目
  交回调用方进状态栏（`已导出 PDF（有条条件格式是图标集…未表现）`，同类仍聚合成"文案×N"）
- **坑**：① CDP 冒烟整轮卡在**零断言**，元凶是 `ws.on('message', cb)` 的第一个参数是 **Buffer**
  （`ws.onmessage` 才是带 `.data` 的事件对象），于是 `msg.method` 恒 undefined、
  `Page.loadEventFired` 永远等不到——从此长脚本都带**按调用超时**与 `uncaughtException` 出口，
  让下一次卡住能自己报是谁；② pdf.js 的 `page.objs.get(id)` 对**还没解码完的对象是直接抛异常**的，
  不是返回 undefined，取图片尺寸得 try/catch + 有界重试；③ 断言"图表进了 PDF"**不能按图片对象个数**数——
  打印机光栅把每根 CSS 渐变数据条都各出一个 XObject（72×16、72×1 的条有六七枚），要按载荷声明的宽高比
  加尺寸认出那一张（120×90 CSS px → 360×270，正好 3 倍打印 DPI）；④ pdf.js 画布没着墨的地方是**透明
  像素**，"纸白"必须按 透明 ∪ 近白 来算，否则白底断言测的是空气
- **验证（四腿）**：**结构测试 87 断言**（六种判定各画各的色 + 并列/端点/插值/窗口的边界 + 命中即停之后
  不再被碰 + 锚点撑开网格与超上限两种账分开 + 色值不能逃出 style 属性 + 空表给标题但不谎记账）；
  **Excel 16.0 对照腿 149 断言**（Rust 夹具写出八列各一种判定型的件，PowerShell 逐格抄回
  `DisplayFormat`/`Interior.Color`/`Font`，48 格的底色·字色·粗体与我们算的**逐格相同**、且全表只记图标集
  那一笔账；OLE 色是 `0x00BBGGRR` 小端，按 RGB 取会整片错色相）；**CDP 真机冒烟 37 断言全绿、页面异常
  0 条**（打开→`printPlan` 核对打印将要吃的规则数与账目→导出 PDF→pdf.js 像素采样：八种颜色逐个在位、
  没画过的纯红一枚都没有、`-5` 不在文本层而 `-1` 在（证 `showValue=false`）、按宽高比认出那张图表位图、
  主题底色从 1269783 像素降到抗锯齿的边角）；**`cargo test --lib` 49 通过 + tsc/build 绿**

## 表格批注与超链接：作者的编号不能按名字排（v0.48）

- **这两样不住在 `cellData` 的 `v`/`s` 里**：批注住快照 `resources` 的 `SHEET_NOTE_PLUGIN`（按
  表 id → 行 → 列 分家），超链接住 `cellData[r][c].p.body.customRanges`（Univer 把链接当成富文本的
  一种自定义区间，区间类型还有书签/字段好几种，只认 HYPERLINK 那一枚）。此前 `payloadToWorkbook` 把
  `resources` 硬写成 `[]`、链接格整块按普通富文本丢掉——别人文件里的批注与链接打开看不见，我们存一次盘就没了
- **与 v0.46 那三类规则不同，这次两头都是纯函数**：实测把 `resources` 与 `p` 裸写进快照，门面的
  `getNote()` / `getHyperLinks()` 都读得回来，所以 `lib/sheet-cell-side.ts` 只做取与放的换算，
  不发命令、不碰 DOM、Node 里直测——**上一轮"放必须走门面"的教训没有自动管到下一批东西，得再量一次**
- **Univer 的模型装不下两样东西**：`ISheetNote` 里没有作者这一项，链接也没有悬停提示的位置。打开时把
  `author` / `tip` 按表名另留一份，存盘前 `restampCellSide` 按格子回贴；界面上新写的批注因此作者仍是空
  （**不冒用文件里任何一个人的名字**），这是故意的而不是没做
- **读侧把两种写法归一**：老式 `xl/commentsN.xml`（`<authors>` 是表、`comment@authorId` 是下标，一格一枚时
  Excel 还会把作者写在正文第一行——**只有认得出作者才剥这层前缀**）与新式 `xl/threadedComments/*.xml`
  （作者住 `xl/persons/person.xml`，不同工具写的键不一样，两种都收）；Excel 为兼容会把同一条批注**两份都写**，
  按格子归并不重复收、回复并进正文并记一笔「有 N 条批注的回复被并进了正文（我们的模型不分层）」。部件归属
  只能靠 sheet 的 rels 认，`sheetN ↔ commentsN` 那种猜法会认错，认不出属于哪张表的部件**单独记包级账**，
  不挂在某一张表上冒充归属。气泡的宽高与"是否一直开着"既不在 comments 也不在 worksheet，而在
  `vmlDrawing` 的 `<v:shape>` 上（`style` 给 pt、`<x:Visible/>` 给常开），而默认那一档 128×74 读回来要
  **归一回"没声明"**，否则每个没设过尺寸的气泡都会从此开始写尺寸
- **写侧最值钱的一笔：作者表的顺序**：rust_xlsxwriter 0.99.1 把 `<authors>` 按**名字排序**写出（内部是
  `BTreeMap`，packager 只把键抄出来），而 `<comment authorId>` 用的是"按格子序首次出现"的编号。于是
  A1=李四、A2=张三 的件在 Excel 里把 A1 显示成张三——**署名串到了别人头上**。载荷里那张表我们自己按格子序
  数得出来，存盘时两序不一致就把那一张的 `<authors>` 按编号重排再写回；核对严到「作者多重集」与
  「`<comment ref>` 的文档序」两项都对上才动手，**数不上宁可不动并记账**（改错的件比不改更糟）。顺带：
  crate 给"没有作者"准备的槽位写的是字面量 `Author`，指过去等于替用户签了个名，所以 `set_default_note_author("")`
  让第 0 格真是空串
- **链接的两条通道**：外部地址在 sheet 的 rels 里（`r:id` → `Target`，`TargetMode="External"`），表内跳转
  才是 `location` 字面（`Sheet2!A1` / `'Sales Data'!A1:G5`），载荷里分成 `url` 与 `location` 而不是揉成
  一个串——Univer 那边表内跳转是 `#gid=<表 id>&range=...`，认的是表 **id**，所以放侧要建表名→id 的对照表，
  表名含空格或长得像单元格引用（`A1`）时按 OOXML 的规矩加单引号（`''` 才是引号本身）
- **记账的地方**：作者超 52 字（Excel 的上限）**只丢作者不丢正文**——裁过的名字放进别人文件里是另一个人；
  既无外部地址又无表内目标的链接未写入；没有 scheme 的目标（指向同目录另一个文件）按 OOXML 的 `file:`
  形状补一次再试，还不行就报出具体格子与目标；**公式格上那枚链接只记账不硬放**（放了会把公式吃掉）；
  只有链接、格子里没内容的也要占一格，否则这枚链接在会话里没有落脚的地方
- **ODS/CSV 说得出缺什么**：ODF 里这两样确实存在（`office:annotation` 是格子的孩子、`text:a` 是格子里的
  行内链接），探针按这两枚 needle 记「暂未读入」，而**自产物一条都不许多报**（对照组）；顺带量到 calamine
  没把批注正文渗进格值，所以"暂未读入"是真的没读而不是读串了。CSV 与 ODS 的"保存会丢什么"文案各补一句
- **坑**：① `FRange.getNote()` 返回的是 `ISheetNote` **对象**（`{note,width,height,show,…}`）不是字符串，
  照字符串写断言会一路"通过"到真机才发现读的是空气；② Univer 给链接格留下的 `v` 是**旧值**（显示吃的是 `p`），
  取侧一律 `richTextOf(cell) ?? cell.v`，否则改了名存一次、重开又是上一版的文字；③ 冒烟里"批注条数"数成了
  resources 的**行数**（同一行三枚只算一枚），改计数时才发现自己把两张表混成了一笔账；④ 冒烟会就地保存，
  直接开夹具等于把写侧原产物覆盖成二手件——改成每轮从原产物复制一份工作副本，夹具才留得住第一次写出的字节
- **验证（四腿）**：**结构测试 75 断言**（表名加引号的两种情况 + `location`↔`#gid=` 双向 + 富文本区间取与放
  + 作者两种键 + 回贴只贴对的那几格、不覆盖用户在界面上的改动 + 桥两头往返 + "链接格的 v 是旧值"这一条危害
  被点名）；**`cargo test --lib` 57 通过**（新增 7：批注与链接往返、作者表落在**编号序**、两张表的作者表互不
  串、threaded 与 legacy 归并、没署名的保持没署名、默认尺寸不声明、放不下的自己报自己）；**Excel 16.0 只读腿
  16 断言 × 两遍**（写侧原产物与应用重存过的件各一遍：五位作者逐个对得上、`D1` 的作者确为空串、`C1` 的气泡
  开着、`F1` 的 Address 与 ScreenTip、`G1` 只有 SubAddress 且**没有**外部地址、第二张表另算一份作者表、格值
  一个没动）；**CDP 真机冒烟 44 断言全绿、页面异常 0 条**（文件→界面按门面逐格读：五条批注正文与气泡尺寸、
  外链与内链各在位 → 界面上再写一条 → 存 → 重开：原五条署名仍在、新写那条作者仍是空）；**tsc + build 绿**

## 纸是纸，屏幕是屏幕：暗色主题的导出保真（v0.49）

- **v0.47 那条兜底只兜住了一半**：当时给 `html,body` 补了白底，量到的是"表格导出不又是屏幕的浅灰蓝"。
  这轮把三条链路（文档 / 表格 / 演示）× 两个屏幕主题各导一份 PDF 数像素，才发现暗色主题往纸上漏色
  有**两条独立的路**，第二条整个没被管到：
  ① `:root[data-theme='dark']{color-scheme:dark}` 让浏览器把**画布底色**（不是任何元素的底色）涂成深色，
  而 `PrintToPdf` 连画布一起抓走——于是纸上凭空一层深灰底。这条**连 `background:#fff !important` 都压不住**：
  实测同一份空白表格页有 31.6% 的像素是深色、文档页 96.6%，而只在 `documentElement` 上把
  `color-scheme` 改回 `light`，同页深色像素就从 246808 掉到 296。能治它的只有 `color-scheme` 本身
  ② 主题色以 `var()` 落在真元素上（`.doc-page{background:var(--panel)}`、`body{color:var(--text)}`、
  `.doc-content a{color:var(--accent)}`），或以**字面量**写在 `:root[data-theme='dark'] .doc-content pre{…}`
  这类规则里——后者连"打印态覆盖变量"都救不回来，因为它压根不走变量
- **于是把规则定成一句**：屏幕上的颜色必须先穿过一枚 CSS 变量，才能在打印态被一次换掉。`src/index.css`
  给 `:root` 补 `--code-bg`/`--quote-bg`（并把暗色段那两条字面底色规则**整条删掉**，改由变量说话），
  再加一段 `@media print` 同时命中 `:root` 与 `:root[data-theme='dark']`，把 `color-scheme` 压回 `light`
  并重新声明整套纸面调色板（`--bg/--panel` 白、`--text #111`、`--text-2 #444`、`--border`、`--accent`
  固定成亮主题那支蓝、`--code-bg/--quote-bg` 回到比纸略深的一档）。**段的位置在暗色段之后**——同特异度
  的 `:root[data-theme='dark']` 由源序说话，放前面就是白写。往后新增的主题色只要走变量就自动被管住，
  不必逐个选择器打补丁（结构测试就断这条：暗色段里凡是命中 `doc-page|doc-content|doc-toc|doc-note|sheet-print|ppt-print|ppt-slide-static`
  的选择器，一个字面颜色都不许留）
- **只覆盖"纸本身"的颜色，内容声明的一律照旧上纸**——而且演示链路是**对照组**而不是受益者：幻灯片背景来自
  `{background: slide.bg ?? master?.bg ?? t.bg}` 的**字面**内联样式，一页声明为深蓝 `#14203a` 的片子在暗主题
  和亮主题下都贡献 275078 个像素（量化后 `#112233`），谁也不许把它抹白。同理活下来的还有段落底纹
  `background-color:#fff2cc`（13043 像素）、红字 `#cc0000`（277 像素）、表格单元格 `bg/cl`（`#112244` 1823、
  `#eeffff` 1741 像素）
- **屏幕辅助不上纸**：查找替换的命中高亮 `.fr-hit`/`.fr-active`（`rgba(255,200,40,.35)`/`rgba(255,150,0,.6)`）
  在打印态收成 `background:transparent !important` 并去掉描边——它由 `lib/find-replace.ts` 的装饰产生，
  搜到哪儿黄到哪儿，纸上没有"搜索"这回事。`pdfprint.ts` 那条元素级白底兜底保留不动：覆盖层链路和文档链路
  各兜各的，顶掉谁都会掉一半
- **判据的分工是这轮最值钱的一条**：**像素直方图管整张纸，`getComputedStyle` 管单个属性**。四比特/通道的
  量化会把 `#f5f6f7`、`#f5f8fc` 这类近白并进 `#ffffff`，"代码块在纸上还该有一层比纸略深的底"在像素层面
  根本测不到——硬要按像素断言，测的是空气。所以逐属性那条腿走 `Emulation.setEmulatedMedia({media:'print'})`
  （真机 WebView2 认这个仿真，不必只从导出件反推），像素腿只管"整页暗色占比"和"两份纸是否一模一样"
- **最强的不变量不是"白底够多"而是"换主题不改纸"**：同一条链路在暗、亮两主题各导一份 PDF，两份直方图的
  **总变差恰好为 0**（三条链路都是 0，暗色像素数之差也是 0）。按单色计数会踩的坑它一并绕开——屏幕主题色
  `#17181c` 量化后正是打印墨色的 `#111111`，"深色像素变多"未必是缺陷，"两份纸逐档相同"才是
- **修好之后的数**：文档 3222/781636 = **0.4%**（基线 96.6%）、表格 460/781636 = **0.1%**（基线 31.6%），
  剩下的深色像素全是正文墨色与抗锯齿边角
- **坑（都出在测量脚本自己身上，但每一条都能把结论造假）**：① 六位十六进制取红通道是 `>>16` 不是 `>>20`——
  写错以后所有"内容声明色还在不在"的计数都是 0，12 条断言集体假绿；② DOM 会把行内 `style` 属性序列化成
  `rgb(204, 0, 0)`，所以 `span[style*="cc0000"]` 这类选择器**永远选不到东西**（表现为属性读到 `null`），
  要按 `getComputedStyle(x).color` 现找；③ `rgba(255, 150, 0, 0.6)` 的字符串不是以 `255` 开头，
  用 `indexOf('255')===0` 判"高亮还画着"会把成功判成失败——判"没画"只能按 `rgba(0, 0, 0, 0)` 正面比；
  ④ 打印仿真的复位要给 `{media:''}`，传空对象不等于取消仿真
- **顺手量到一条先前就存在、本轮不修的缺陷**：演示导出的 PDF 纸张是**竖版** `MediaBox [0 0 540 960]`
  （7.5×13.33 英寸），幻灯片被压成纸中间的一条横带。当时按 `pageSizeInches:[13.335,7.5]` 与
  `src-tauri/src/pdf.rs` 的"交换边长 + 转置 Orientation"换算推测成**转了两圈**，按未勾项写进路线图。
  **v0.50 的单变量探针否掉了这个归因**：那段换算本来就是对的（`page_box(13.335,7.5)` 只换位一次），
  真实原因是文档标签常驻 `head` 的那份 `@page` 串到了下一次打印作业上——症状是真的，猜的原因是错的
- **验证（四腿）**：**结构测试 28 断言**（打印段两个选择器都在 + 八枚调色板逐条 + 段序必须在暗色段之后 +
  暗色段"能上纸的选择器"零字面底色 + 两条 load-bearing 的 `var()` 链路点名（`.doc-page`→`--panel`、
  `body`→`--text`）+ `print-color-adjust:exact` 与 `pdfprint.ts` 白底兜底不许被顶掉 + 自测假例必须打 FAIL）；
  **CDP 真机像素腿 65 断言全绿、页面异常 0 条**（三链路 × 暗/亮各导一份，pdf.js 逐张画布做直方图 + 两主题
  对照 + 屏幕态与打印仿真态逐属性对照，共 6 份 PDF 与 2 份屏幕快照）；**`cargo test --lib` 57 通过**
  （本轮 Rust 零改动，四条腿里它管的是"没碰坏导出"而不是"碰了什么"）；**tsc + build 绿**（改动只有
  `src/index.css` 一个文件：+40 −12）

## 一张纸只说一次话：纸张方向契约与 `@page` 串台（v0.50）

- **契约先钉死**：`export_pdf` 的 `page` 参数**一律是"想要的纸面尺寸"（要横向就宽>高）**，三条导出链路
  都不许自己换位。WebView2 的 `PrintSettings` 把 `PageWidth/PageHeight` 当作**竖版纸的两条边长**，
  转置完全由 `Orientation` 负责，所以"短边当宽 + LANDSCAPE"这次换算**只在 `src-tauri/src/pdf.rs` 的
  `page_box()` 发生一次**（本机实测：照字面传 13.335×7.5 得到的 `MediaBox` 是 540×960，幻灯片压成横带）
- **设置失败不再静默**：`kick_print` 里背景/页眉页脚/四边距/纸宽纸高/方向五步全部 `map_err` 原样报出。
  静默退默认设置的后果是"导出成功但纸不对"，而那种 PDF 在文件管理器里看着一切正常，只有逐页量人才发现
- **v0.49 记下的那条未勾项是真缺陷，但归因是错的**：`page_box()` 没有转两圈。单变量探针（同一进程内依次跑）
  量出来的是一条谁也没想到的通道——**上一次打印作业会污染下一次**：
  ① 刷新后直接导演示 → `960×540`、底色占 `1.0`；② 演示→演示 → 干净；③ **导过一次 A4 竖版文档**再导演示
  → `540×960`、底色只占 `0.34`；④ 摘掉 `head` 里那份 `#oo-page-rule` 再演 → 又回到 `960×540` / `1.0`。
  元凶是 `DocEditor` **常驻** `document.head` 的 `@page`（它还要给页眉页脚用，标签关了也不移除），
  而 PrintToPdf **真的会认 CSS `@page` 的 `size`**——这条直接推翻了 v0.33 记在代码注释里的"PrintToPdf 忽略
  CSS `@page size/margin`"，注释按实证改掉了
- **修法不是"管住别人"，而是"把自己说全"**：`lib/pdfprint.ts` 的每条覆盖层作业输出一条自己的
  `@page{ size:…in …in; margin:…; @top-left…@right-bottom{content:normal;} }`（十六个页眉页脚位逐个复位，
  因为文档那份 `@page` 的 margin box 会同住进别人的作业）。同一个 `head` 里两条 `@page` 按**文档序**合并、
  后来者说话，而这份样式正是打印时最后追加的那枚。第一版实现走的是另一条路——遍历 `head` 里所有含
  `@page` 字样的 `<style>` 并 `el.disabled = true`，**实测直接判负**：`index.css` 的注释里就写着
  "@page margin box"，于是整张样式表被禁用，演示印成**一页无底色的裸文字**（`cover 0.063`、页数 2→1）。
  一张表里既有要禁的也有要留的，禁整张就是拿别人的正文样式当代价
- **边距也自说自话**：`printMarginsInches()` 把"没给边距"时的默认值明写在 TS 侧（`0.5/0.6/0.5/0.6` 英寸），
  同一组数同时进 CSS `@page` 与 `PrintSettings`。以前是"前端传 `null` 让 Rust 兜底 + CSS 那份 @page 由别人留着"，
  两边谁赢成了运气。演示的全出血因此不再需要自己写 `pageStyle:'@page{margin:0}'`
- **矮纸不再凭空多一页**：`.doc-content` 在屏幕上有 `min-height:900px` 的打字区，而横向 A4 的可印高度只有
  475px——正文尾巴被这块空高度顶到下一页，导出的 PDF 就是"一页正文 + 一页空白"。`@media print` 里补
  `min-height:0 !important`（那是编辑辅助，不是内容），实测同一份正文：横向自定义纸 2 页 → **1 页**、
  A5 矮纸同样 1 页，而 A4 长文仍按内容分 2 页、换 A5 变 3 页（分页由纸的可印高度决定，与空区无关）
- **量"纸"只能量产物**：覆盖层宿主在非打印媒体下是 `display:none`，`getBoundingClientRect()` 读出 `0×0`
  是**正确行为**，不是 bug——所以"幻灯片到底铺满了没有"只能从导出的 PDF 反推（pdf.js 画布数底色占比 +
  墨迹包围盒 + 文本层判"页眉有没有串过来"），别拿 DOM 的几何当打印几何
- **验证（四腿）**：结构测试 **18 断言**（边距三档来路 + `marginsInches:0` 不能被当成"没给" + 纸面/边距成对
  出现在同一条 `@page` + 十六个 margin box 全复位 + 一次作业只输出一条 `@page` + 没给纸张就不声明 `size` +
  自测假例必须打 FAIL）；**CDP 真机 44 断言全绿、页面异常 0 条**（三条链路各自的 `MediaBox`/无 `/Rotate`/
  铺满比例，**以及按"先文档（带页眉页码）→ 演示 → 表格 → 再文档"的污染序列跑**：演示 `960×540` `cover 0.994`、
  表格 `842×595` 左边距 `0.60in` 上边距 `0.55in`、文档的页眉没有出现在演示与表格的任何一页上、而文档自己
  再导时页眉还在；临时样式与宿主用完清零、没有一份样式留在禁用态）；`cargo test --lib` **59 通过**
  （含 `page_box` 两条新单测：横向折成"短边 + LANDSCAPE"、竖版与等边不换位、8.28×8.27 也算另一种纸）；
  tsc + build 绿

## 纸从文件里来：表格「页面设置」的 xlsx 往返与打印（v0.51）

- **欠账的位置**：表格能设的东西里，只有一层从来没被管到——**这张纸该怎么摆**。纸张与方向、边距、缩放、
  页眉页脚、手动分页符、打印区域、重复标题行/列、网格线与行列标题、奇偶页/首页不同、起始页码：
  别人文件里有（Excel 存一次盘全在），我们打开看不见、存一次盘整块没了，导出 PDF 则永远是我们替它定的
  A4 横向。表格保真七期把"格子里的东西"清完，这一轮把"格子外的纸"接上
- **它不住在 `<sheetData>` 里，也不在 Univer 的模型里**：散在 worksheet 末尾七处
  （`<sheetPr>`·`<printOptions>`·`<pageMargins>`·`<pageSetup>`·`<headerFooter>`·`<rowBreaks>`·`<colBreaks>`），
  而**打印区域与重复标题根本不在表上**——是 workbook 级两条 definedName（`_xlnm.Print_Area` /
  `_xlnm.Print_Titles`，靠 `localSheetId` 分表）。取与放两头都是纯换算（`src-tauri/src/xlsx_print.rs` 1281 行
  + `src/lib/sheet-print-setup.ts` 573 行），不放命令、不走门面，Univer 装不下的那份按表名留在侧通道
  （`printRef`，与 v0.48 的 `cellSideRef` 同形），存盘与导出 PDF **共吃同一份**——否则会出现"文件里有设置、
  打印里没设置"两句假话
- **本轮最值钱的一条：`<brk id>` 说的不是"断在这行之后"**。它是**0 基的"这一行/列自己开始新的一页"**。
  两处独立证据把它钉死：Excel 在 `A11` 之前插断点写出的正是 `id=10`，而我们写 `id=3` 时 Excel 的 COM 报
  `HPageBreaks(1).Location.Row = 4`（1 基）。前端换算最初按"之后"理解，于是每一条手动分页符都**差一格**
  ——差一格的后果不是报错，而是分页安静地错一页，只有逐页看纸才发现。Rust 侧读与写都**原样收 id**，
  换算只此一处（`pageBreakRows`/`colBreaks`），`fs.ts` 与 `xlsx.rs` 的注释按实测改过
- **crate 写不了半边，就搭 v0.48 那趟重打包的车**：`rust_xlsxwriter` 0.99.1 的 `write_header_footer` 只写
  odd 两条串，`differentOddEven`/`differentFirst` 一个字不写；`write_page_setup` 又把起始页码落在
  `useFirstPageNumber="3"` 上——OOXML 里那是**布尔属性**，号码另有 `firstPageNumber`，Excel 自己不这么写。
  所以 odd 交给 crate，even/first 与两个开关、页码那半边在存盘时**只换点名的那一张 worksheet 部件**
  （`Fix::Authors | Fix::Print` 在一个枚举里，一次重打包两类补丁；兄弟元素次序按 schema：`pageSetup` 之后、
  `rowBreaks` 之前；`<headerFooter>` 里 odd→even→first）。页眉页脚串里的 `&` 是**格式码**不是文字
  （Excel 按 `&amp;P` 存），转义只有三条标准的，多转一次就成了 `&amp;amp;P`
- **打印链路真的照着排**（`sheet-print.ts` 的 `sheetsToPrintHtml` 现在先要一份计划再画格子）：
  ① 纸张 = `paperSize 编号 → PAPER_INCHES` 再按 `orientation` 换边（认不出的编号记账后走默认纸）；
  ② 可印宽度决定**列带**（`planColumnBands`：一带宽不下就切带，标题列每带各带一份但不重复计列，
  手动列断点在那一列**之前**收带、首列上的断点是空的不凭空造带、"缩放到 N 页宽"反过来求缩放）；
  ③ 一个列带一张 `<table>`，每带各一份 `<thead>`（打印区域外的标题行不参与，越界端点**夹回来而不是整条作废**）；
  ④ 手动行断点落 `<tr class="sheet-print-break">`；⑤ 缩放落 `style="zoom:…"`、水平居中添加
  `margin-left/right:auto`；⑥ 页眉页脚那套 `&L/&C/&R` 码翻成 `@page` 的 16 个 margin box，
  `&A/&P/&N/&D/&F` 由调用方给的 `dateText/fileName` 与浏览器的页码计数器说话，
  **没有对应通道的码整码丢掉并记一笔**（不把 `&X` 当字面文字印出去）
- **做不到的只记账，不硬渲**：起始页码 7（PrintToPdf 没这一档，纸面上第一页还是"第 1 页"）、
  偶数页另有一版页眉页脚（CSS 只有 `@page:first`，没有奇偶档）、`fitToHeight`、垂直居中——
  四条各自一句中文账进状态栏；勾了"首页不同"却没写首页内容也要说（"纸上首页与其余页一样"）
- **`gridLines` 的默认值是 Excel 给的**：文件里**声明过**页面设置却没写 `printOptions@gridLines`，意思是
  "不印格子线"（实测 Excel 就是这么判的），而不是"没意见"。所以 CSS 里那条无条件的
  `.sheet-print-table td{border:…}` 收进了 `.sheet-print-grid` 类，**没声明过任何页面设置的表**
  （我们在 Univer 里新建的就是）沿用历史观照旧带细网格。行列标题（`headings`）同理是新增的一档：
  纸上是灰底小号的行号 + 列字母（`columnLetter(0)=A`、`(26)=AA`）
- **判据的三条经验**（都出在"我以为能这么量"被实测打掉之后）：
  ① `<thead>` 会不会重复不用我们操心——Blink 在自然溢出、`break-before:page` 强断、`zoom:0.9`、
  带容器内四种情形下都重排表头（A/B 探针各测一遍），手工再插一份反而会重复两遍；
  ② "居中上了纸"**不能**按"左右留白相等"判：单元格里的文字到不了右边界，量文字必不对称
  （实测左 173.5pt / 右 314.8pt 而纸是居中的）。可用的判据是**差分**——窄带（两列）比宽带（三列）
  的左边缘正好右移**半列宽**（83.3pt ≈ 列距 166.6pt 的一半），左对齐时这个位移是 0；
  ③ pdf.js 的 `OPS.rectangle` 扫不到 CSS 边框（返回空），几何只能从文本项的 x 或已知边距盒反推
- **PowerShell 第四次踩同一处**：`Ok((a -eq b), '文案')` 的逗号把两参绑成**一个数组**。这次因为形参写了
  类型（`[bool]$Cond`），报错从"恒真假绿"变成当场转换异常——响的，比假绿好，但正确写法仍是
  空格分隔实参的命令调用。COM 面还有两处只能认：这台 Excel 的 `FitToPage`/`PageOrder`/
  `PrintGridlines`/`PrintHeadings`/`OddHeader` **一律返回空**（不硬断言，把实得值抄进日志留证，
  这些字段由 cargo 的 XML 字面断言覆盖），`PrintTitleColumns` 没设时给 `$null`（与期望的 `''` 先归一），
  边距只能按磅比（`Application.PointsToInches` 不存在）
- **ODS / CSV 说得出缺什么**：`ODS 暂不含页面设置（纸张/边距/页眉页脚/分页符），导出的 PDF 仍照它排`，
  CSV 那句长账里也点上页面设置——自产物不许凭空多记一条账，结构与 v0.46/47/48 同一套
- **验证（四腿）**：前端结构测试 **226 断言 / 0 失败**（八档纸型换算 + 列带四种边界含"断点正好落在容量
  边界上只出两带" + 标题行列与打印区域求交 + `&L/&C/&R` 分段与码表 + 记账文案 + `SheetEditor` 的 ODS/CSV
  账目在位，开头假例必须打 FAIL）；`cargo test --lib` **66 通过 / 5 ignored**（新增打印设置的 XML 落点、
  自产物往返、二次存盘、缺失 `<headerFooter>` 时插入、odd 不动只补 even/first）；**Excel 16.0 只读腿两遍
  ——写侧夹具 26 断言、应用重存的第三方件 28 断言，全部 0 失败**（表名/格值没被碰坏、纸张方向缩放页码、
  六条边距按磅、奇偶与首页两枚开关、三段页眉逐字回位含 `&A/&P/&N` 未展开、打印区域与标题行列、
  两个断点的位置与 `xlPageBreakManual`）；**CDP 真机冒烟 64 断言全绿、页面异常 0 条**（Excel 原件 →
  我们的计划逐项等价 → 导出 PDF 四页：每页 `MediaBox` 都是 A4 横向 841.9×595.0、r11 真的另起一页、
  每页各带一份自己那一带的表头、D/E 带不混进 A~C、区域外 F 列与第 19 行没上纸、三段页眉连页码与
  文件名日期都进了 margin box、居中按半列位移判定、打印宿主与注入样式用完清零）；tsc + build 绿

## 一张纸在界面上也能摆：表格「页面设置」面板（v0.52）

v0.51 让这一层存得下、开得回、真上纸，但界面上改不动它——纸张、边距、打印区域这些只能等着别人
的文件带进来。本轮补的就是那只手：**面板写进 `printRef` 侧通道，保存与导出 PDF 共吃同一份计划**，
顺带把"这一版纸上做不到"的账在 UI 上当面说清，而不是等 PDF 印出来才发现。

- **钥匙还是表名，面板只是它的影子**：打开时 `dump.sheets.filter(s => s.print)` 把文件里的纸面灌进
  侧通道，「确定」= `printRef.set(表名, 草稿)`、「清除这张表的设置」= `delete(表名)`；Univer 里改了表名，
  钥匙跟着搬（冒烟按这一步量：改名→存盘→重开，设置仍挂在新名字上）。副标题说实话——
  「文件里带着纸面设置」与「这张表还没声明纸面设置，下面是我们打印用的默认纸」是两句话
- **新建 `src/lib/sheet-print-ui.ts`（347 行，纯函数、零 DOM、Node 直测）**：面板要的一切都不在组件里现算——
  毫米↔英寸（面板按毫米说话、载荷按英寸存，换算只有这一处）、`PAPER_OPTIONS`/`paperMm`（八档纸型带毫米提示，
  英制那几档没有"毫米名"就照实换算）、三槽↔OOXML 那条串、`$C$2:$F$5`↔0 基含端点矩形、行列整跨度
  `$1:$2`/`$A:$B` 的分段、`addBreak`/`removeBreak`、`validateDraft`、`draftPaperNotes`
- **只填中档时不带 `&C`**：页眉三框合成 OOXML 串，只有左或右在场才按段写标记——读侧那条"没标记的整串落在
  CenterHeader"的实测正是这里写出去的形状（与 Excel 字节同一档）。分段标记的查找一路走到底按 `&&` 跳转义，
  否则「A&&Link」里第二个 `&` 会被当成 `&L` 把串拆错
- **不声明 ≠ 报错，两条说法分开**：`F5:C2` 这类反向引用 `sqrefToRect` 判"不解析"，而**不解析就是不声明**，
  面板不拦；只有解析得动却**超出这张表**的（`A1:ZZZ1000000`）才点名「打印区域超出这张表的范围」并把「确定」
  灰掉。网格上限不靠猜——问 Univer 的 `getMaxRows()`/`getMaxColumns()`
- **三条只有真机才说得出来的账**：
  (a) **默认边距不算声明**：写侧的 crate 没人吩咐也给每张表落 `<pageMargins>` 那一档默认值，于是"从没设过"
      与"设成默认"字节相同——按了「清除这张表的设置」、存盘、重开，设置自己又长了回来。读侧
      `clear_default_only_margins()` 把"只剩默认边距"的载荷归一回不声明（与 v0.48"默认气泡尺寸不声明"同一规矩）；
  (b) **React 的渲染期闭包会吃掉一次点击**：格式码按钮原先从渲染期那份 `draft` 求"当前框里有什么"，
      同一批更新里连按两枚，后一枚把前一枚顶掉（实测右槽只剩 `&P`）——改成在函数式 updater 里算，
      并把"一次插两枚码"留在冒烟里当回归；
  (c) **CDP 信封只剥一层**：`send()` 已经解出 CDP 的 `result`，取值是 `r.result.value`；写成
      `r.result.result.value` 恒 `undefined`，于是页面上每个谓词都长得像"还没就绪"，本轮第三次把
      等待超时误判成导航问题（`exceptionDetails` 反倒与 `result` 同级，所以抛错看得见、值看不见）
- **对照组的价值：量具读不到 ≠ 文件里没有**：这台 Excel 的 COM 面对 `PageOrder`/`FitToPage`/
  `OddAndEvenPages`/`EvenHeader`/`FirstHeader` **一律返回 null**，而手搭的 fixture（我们自己的读侧认得）
  同样是 null——所以这不是写侧漏了东西，而是这台机器的 COM 面不暴露；这五条改从**文件字面**核对
  （PowerShell 只读解 zip，不碰任何人的原件）。另两条同样靠对照才不认错：`PrintArea` 回来是**字符串**
  `$C$2:$F$5`（带着 `$`，`-like '*C2*'` 永不匹配），清空起始页码读回的是 `-4105`（xlPageNumberAutomatic）
  而不是 "Automatic"。顺带修掉判据自己的一处坑：`$lines[0..(Count-2)]` 在只剩一条时把 `0..-1` 数成两个同一元素，
  那条 SELFTEST 假 FAIL 被印了两遍（人扫输出会以为真失败），改用 `Select-Object -SkipLast 1`
- **验证（四腿）**：前端结构测试 **147 断言 / 0 失败**（假例必须打 FAIL；毫米英寸往返 + 八档纸型 +
  三槽合成与拆分 + `&&` 不拆错 + 区域与整跨度的双向 + 断点去重 + 校验里"不声明"与"出界"两种说法分开 +
  做不到那四条账随草稿变）；`cargo test --lib` **68 通过 / 5 ignored**（新增两例：只有默认边距的件不算声明、
  边距只要有一档不是默认就算声明）；**CDP 真机冒烟 136 断言全绿、页面异常 0 条**（文件里的纸面→面板显示→
  改→打印计划→PDF 的 `MediaBox` 与文本层→存盘重开，一环一个见证；含改名搬钥匙、清除不留幽灵、
  文档在前表格在后的污染序）；**Excel 16.0 只读腿 57 断言 / 0 失败**（三份件：fixture 对照、面板写出的、
  清除后的；纸张方向纸型缩放六条边距按磅、打印区域与标题行列、两个断点的位置、格式码未展开、
  COM 读不到那五项按文件字面核）；tsc + build 绿

## 纸上真能压出 N 页高：表格页面设置的打印二期（v0.53）

v0.52 的面板能设这三样，文件也存得下、Excel 也认得，唯独我们自己的 PDF 不照着做。本轮按路线图那条
分寸办：**能接线的接线，接不了的当面降级成"只记账"**——「缩放到 N 页高」与「上下居中」接上了真通道，
「起始页码」说实话做不到（`@page` 的页码只有一个 counter，没有"从 7 接着数"的入口）。

- **为什么必须实测，不能按载荷算**：新建的表一条 `rowHeights` 都没有（默认行高由字体现算）、
  声明过的行高又只是**下限**（写 20px 实测 21px）、长文字那一行会自己撑到几百像素；更要命的是
  CSS `zoom` 之后的行高**不等于线性折算**，所以只能在**最终缩放**之下量。而"最终缩放"要靠行高才定得下来
  ⇒ 导出改成**来回几趟**：按计划缩放建一次 → 挂起来量 → 压出页高档重建 → 量稳了才把居中留白写回同一份 DOM
  （上限五趟；没勾这两样的表一趟就过，一次量都不做）
- **新建 `src/lib/sheet-print-measure.ts`（59 行）是这一层唯一碰 DOM 的地方**：`measureSheetPrint` 按
  `<section>` 表序返回实测高（**没有网格的那几张占一格 null**——少了这格对齐，`plans[i]` 就会配到别人家的实测上），
  表名那一行用「第一带的 `top` 减 `section` 的 `top`」量回来，不必逐个选择器猜 margin 折叠；
  `applyVerticalPads` 把留白写回**量它的那一份 DOM**（第一页给 `section`，表名与第一带一起居中才叫"这张表上下居中"，
  后面每带自己起一页就各自居中）。配套在 `pdfprint.ts` 加 `measurePrintLayout`：覆盖层在屏幕上被
  `#oof-print-host{display:none}` 藏着，量出来全是 0，于是另开一个离屏量尺容器（同一套正文样式，
  只是不带 `@media print` 与 `@page`——那组规则改的是可见性、分页与纸面，不改任何一行的高），量完即摘
- **换算仍旧是纯函数**（`sheet-print-setup.ts` +233 行）：`printPagesPerBand` 按实测行高贪心分页、
  **逐个列带**各数自己那几页；`fitToPagesTallZoom` 找能把每一带都压进 N 页高的最大一档缩放（1% 一档、
  下限 10%＝OOXML 能写的那一档、留 `FIT_TALL_GUARD` 一档余量）；`verticalCenterPadPx` 只在装得下时给留白；
  `planSheetFit` 把实测落成"这一张的最终缩放 + 各处上留白 + 该说的账"
- **页高不是总页数**：两个列带各占 1 页高，纸上就是 2 页，而「缩放到 1 页高」压的是**每一带**，
  所以 `tallPages` 取最高的那一带，不许为"总页数"再压一遍（这一条有专门一注对着量具）
- **本轮最值钱的是两条校正数**（都从真 PDF 与真 DOM 之间对出来，不猜）：
  (a) `PRINT_ROW_BIAS_PX = 0.4`——离屏容器的**屏幕媒体**下量的行矩形比纸上的短 0.4px/行，
      zoom 1 时屏幕矩形 20.615 而纸上 21.0，zoom .29 时 6.427 → 6.77，**与缩放档无关**；
      而表名那一行**不随 zoom 折算**（`zoom` 落在 `<table>` 上，那一行在表格外）。少了这两条，
      "缩放到 1 页高"要么多压一档要么多出一页
  (b) **递归收口**：压出来的那一档必须"站上去重排再量"仍是原档才交出去，否则每趟退一档、五趟都定不下来
- **顺带修掉一条只有面板上线后才暴露的真缺陷**：`rust_xlsxwriter` 0.99.1 的 `write_page_setup`
  **逢 `<pageSetup>` 必写 `orientation`**（`is_portrait` 默认真 → 落 `portrait`），于是"面板从没碰过方向"的表
  存盘、重开之后纸面从横版翻成竖版（`MediaBox` 595×841.9）。修法在写侧：`write_sheet_print` 只在真的走通
  setter 时才算声明过，`PrintPatch` 多带一枚 `drop_orientation`，存盘那趟定点重打包把 crate 补写的那枚
  **整枚擦掉**（只擦 `orientation`，其余属性按 schema 原样搬），而**声明过的方向一个字都不动**
- **读侧同一类归一**：crate 在 `fitToWidth`/`fitToHeight` 等于 1 时**不写那一枚**，OOXML 里缺省正是 1，
  所以开了 `fitToPage` 却没写的那两枚归一回 `Some(1)`——「缩放到 1 页」与「没开缩放」必须是两句话；
  没开 `fitToPage` 的不许归一（那是替用户声明了一档缩放）
- **记账的语气跟着改**：面板那句标题从"我们导出的 PDF 上兑现不了"改成"我们的 PDF 上照下面说的兑现"；
  `draftPaperNotes` 四条重写——页高档改成"只在那一页装得下才落笔"，起始页码把**为什么**做不到说出口，
  另补"缩放到 N 页宽/页高超出能排的页数"两条越界账
- **只有真机能教的三条**：① pdf.js 在 27% 那一档把一个单元格的文字拆成逐字符 item，按 item 匹配"第几行在纸上"
  会让量具在最需要它的档上读出 `rows=0` ⇒ 先按行的基线 `y` 合成一行再认标签；② 重开时只判门面在位会读到
  `printPlan()` 为 `null`（要先等 Univer 的工作簿接上），于是"重开没等到"会伪装成"计划里没有页高档"；
  ③ 状态栏那句"压到 27%"要说在**压它的那一趟**——压完再量的那一趟只会说"这档已经够了"，账就丢了
  （所以每张表占一格、后趟覆盖前趟）
- **对照组装进夹具本身**：新写侧夹具把"说了方向"与"从没说"两张表放进**同一趟存盘**（`gen_orient_fixture`），
  于是第三方腿看的是同一份 zip 里两枚 `<pageSetup>`——一枚带着 `orientation="landscape"`、一枚一个字都没有。
  分成两份件就会在"这份本来就没有 pageSetup"上因错的原因通过。实测还量到两个之前没写下来的形状：
  我们的补丁写出的是 `<pageSetup useFirstPageNumber="1" firstPageNumber="7" .../>`（两枚并存），
  Excel 回读 `FirstPageNumber=7`；而这台机器的 COM 面对**同一个工作簿的同一属性两次读回 `0` 与 `1`**，
  所以方向那条判据落在文件字面，COM 只报它稳得住的那几样（起始页码、两枚居中、`PrintArea` 的带 `$` 字符串、格值）
- **验证（四腿）**：前端结构测试 **142 断言 / 0 失败**（假例必须打 FAIL；行偏置只在有行的地方加、
  表名行不折算、页高看最高那一带、递归收口那一档重量原样交回、居中留白五种边界、越界页数、
  再加一组对 Rust 源文的钉：`patch_orientation` 在位、`drop_orientation` 只有两枚 `= false`、读侧归一那一行）；
  `cargo test --lib` **71 通过 / 6 ignored**（新增三例：没声明的方向不回来、走完整存盘链路后仍不声明且
  不连累别的属性、擦了方向不许把页高归一也带走）；**CDP 真机冒烟 67 断言全绿、页面异常 0 条**
  （101 行自然四页 → 压成 1 页含 R001..R100 → 2 页各 50 行 → 居中位移 188.1pt → 装不下那页按顶端排并当面说 →
  起始页码那本账 → 存盘重开纸面仍是横向）；**Excel 16.0 只读腿 30 断言 / 0 失败**（两份件、五个段落：
  两枚 `pageSetup` 的对照、应用真机存盘那份的三条字面、`_xlnm.Print_Area`、格值没被碰坏、COM 回读）；tsc + build 绿

## 三版页眉页脚各就各位：偶数页与首页真的上纸（v0.54）

路线图那条未勾项挂着两半：**偶数页另版**（`@page:left`/`:right` 与 `differentOddEven` 的对应关系没人量过）和
**起始页码的纸面通道**。量完的结果是一半接上了、另一半**说死了**——偶数版与首页版现在各落一处真的印在纸上，
起始页码则被穷举证伪（五种写法一种都没量得通），它照 v0.53 的语气留在"只记账"。

- **认得动的是 `:left`/`:right`，不是 `:odd`/`:even`**：这台 WebView2 上后两者发出去**两页整框空白**（页眉页脚
  一个字都没有），前两者各页都印且第 1 页吃 `:right`（与 CSS 分页的"第 1 页是右页"同一档）；于是
  `headerFooterCss` 里奇数版落 `@page:right{…}`、偶数版落 `@page:left{…}`，而**没勾 `differentOddEven` 时
  仍旧只写基 `@page`**（历史形状一个字都不许漂，结构腿专门钉这一条）
- **本轮最值钱的一条是真缺陷，而且是量出来的不是推出来的**：`@page:first` **只覆盖它自己声明的那几格**，
  没声明的框会**穿透**到同一条样式表里的 `@page:right` 或基 `@page`。首页三框只填了中框的那份夹具，
  纸上读回来的是 `L-奇 C-首 R-奇`——左右两格漏进了奇数版。治法是在 `:first` 里把六格中**没被那一版写到的**
  几格显式复位成 `content:normal`（`resetRest`），对照组 `content:"normal2"` 证伪了"normal 只是不被打印"
  这一可能：它确实把框清空了
- **由此推翻一条我们自己记下的旧账**：v0.51 写的是"`@page:first` **必须排在基 `@page` 之前**，否则第 2 页起
  同一框整个没了"。本轮把同一形状的两个源序各导一遍（u7/u8）——**四页两框都不缺，源序不承重**，
  承重的只有上面那枚复位。当时的读数是把整页文字并成一串来读的，与 `:odd`/`:even` 那次误判同一个来源
  （串读会跨行串位）；现在页面上认归属一律按基线 `transform[5]` 分组。产品仍旧发 `:first → :right → :left`，
  但注释与断言的语气改成"这一序只为好读"，不再假装它是物理约束
- **一条语气跟着反转**：勾了「首页不同」而首页那一版是空的 ⇒ 六格全被复位 ⇒ 首页**什么都不印**，
  这才是 Excel 的同义。所以 v0.52 起那句"纸上首页与其余页一样"不是措辞问题而是**说反了**，直接删掉而不是改写
- **奇偶是按物理页分的，这一条必须连带说出口**：起始页码既然没有纸面通道，纸上的页码就永远从 1 数，
  于是"第 1 页算奇数页"；而 Excel 按**页码**分奇偶——起始页码是偶数时两边会整个反过来。这句写在
  `hfAndPageNumberNotes` 里，与起始页码那条账同源，面板（`draftPaperNotes`）与导出（`planSheetPrint.notes`）
  吃的是**同一份文案**（v0.52 立的规矩在这里再收一次：整仓里"起始页码设的是"只出现一次，结构腿数着）
- **起点那半怎么算说死**：`counter-reset:page`、`@page:first` 上的 counter、`counter-increment` 改写、
  margin box 里做加法、以及干脆不带 counter 的手写串——五种写法各导一遍，逐页读回的都是 1..N，
  没有一种量得通；这不是"我们还没找到"而是这台机器的 PrintToPdf 只有一个从 1 开始的页码 counter
- **验证（四腿）**：前端结构测试 **59 断言 / 0 失败**（假例必须打 FAIL；三版各落一处 + **复位承重**那一组
  专挑 `:first` 里六格是否都有交代、`leak` 专用载荷、`:right` 不许被复位顺带改写 + 两枚开关 gating
  （含"空首页＝六格全复位且不再有那条错账"）+ 起始页码与奇偶连带 + 文案只此一处（面板源文里不许再有第二份）+
  三版共吃同一条 `parseHf`）；`cargo test --lib` **71 通过 / 7 ignored**（Rust 这轮只多一枚 `#[ignore]` 的
  **三版成版夹具** `gen_parity_fixture`：一张表、140 行、横向 A4、`oddEven` 与 `firstDiffers` 同时勾上、
  三版页眉页脚各不同、`firstPageNumber=7`——夹件自带对照（纸上若印出 7 就是起点漏进了我们自己的通道））；
  **CDP 真机冒烟 53 断言全绿、页面异常 0 条**（载荷在侧通道 → `job.hf` 三处顺序且绝不发 `:odd/:even` →
  反向对照（关掉两枚开关只剩基 `@page`，账换成"没勾"那两句，再恢复）→ 逐物理页核：p1 **只有** `C-首`
  （这条就是上面那个漏版的回归断言）、p2 偶 / p3 奇 / p4 偶、页码 1..N 反证起点不上纸、`MediaBox` 横向 →
  污染序（文档导出夹在两次表格导出之间）→ 存盘重开三版与两枚开关与 `plan.hf` **逐字**一致）；
  **Excel 16.0 只读腿 54 断言 / 0 失败**（夹具与应用重存的那份各一遍：`headerFooter` 六子元素的 schema 序、
  三版串里的格式码**逐字未展开**、两枚开关的字面、`pageSetup`/`pageMargins` 按磅、格值 420 个一格没动；
  COM 只报它稳得住的那几样，`FirstPageNumber` 回读 7，而 `OddAndEvenPages`/`FirstPageHeaderFooter`/
  `OddHeader`/`EvenHeader`/`FirstHeader` 在这台机上仍一律 `$null`——照旧抄证不改断言，
  并且这一轮的中文抄证要 `[Console]::OutputEncoding = UTF8` 才留得下来）；tsc + build 绿

## 页眉页脚的两枚开关：随文档缩放与按边距对齐（v0.55）

路线图那条写的是"整枚不见"：`headerFooter/@scaleWithDoc`（页眉字号随不随文档缩放）与
`@alignWithMargins`（页眉页脚按页边距还是按纸张说话）在 OOXML 里**缺省都是开着**（Excel 那两个勾默认打上），
而我们读侧不认、载荷里没有字段、写侧不补——于是别人文件里关掉的这两枚存一次盘就丢。本轮两头都接：
存得下、开得回，而且**两枚都真的落到了纸上**（不是"只记账"）。

- **收进来的分寸**：`off_attr()` 只把明确写 `0` 的那一枚收进载荷（`Some(false)`），缺省或写 `1` 一律归一回
  不声明——写 `1` 与不写在这两枚上语义相同，落笔就是替用户声明了他没设过的东西（v0.52 那条「默认值不算声明」，
  与默认边距、默认气泡尺寸同一家）。`Some(true)` 从面板出去也是同一个意思：存盘后读回来是 `None`，不许凭空长出 `true`
- **写侧走 crate 的 setter**（`set_header_footer_scale_with_doc(false)` / `set_header_footer_align_with_page(false)`，
  只在 `Some(false)` 时调用），crate 也只在关掉时落字节 ⇒ 与我们的"开着不写"同一档；顺带一笔有用的：走通 setter
  会把 `head_footer_changed` 置上，于是**只有开关、一条页眉页脚都没有**的件也长得出 `<headerFooter>` 元素，
  而那趟补 even/first 与两枚奇偶开关的 `patch_header_footer` 只擦自家那两枚属性，crate 写的这两枚活着过第二次存盘
- **`scaleWithDoc` 在纸上是真事，而且是 Excel 那边量出来的**：同一份 50% 的件，开着时页眉字高 5.5pt、
  关掉时 11pt（对照夹具 `s-on` / `s-scaleoff`）。我们的缩放是挂在 `<table>` 上的 CSS `zoom`，而 `@page` 的
  margin box 是**页级**的、不在那棵树里（实测内容 zoom 0.5 时页眉一个字都没变小）⇒ 这一档只能自己把字号乘出去；
  margin box 的 `font-size` 是认的（实测 40px 真上纸）。基准那档 `HF_BASE_FONT_PX = 16` 也是量的（内容没写 `&"字号"`
  时页眉继承的就是它，实测上纸字形高 12pt）；倍数正好为 1 时**一个字都不写**，段自己带了字号码则交给 `segStyle` 乘、
  两处不重复出手
- **`alignWithMargins` 开着正是我们原来的形状**：实测基 `@page` 的顶栏正好落在左右边距之间，所以这一档不需要改；
  关掉时要往外推的量**正好等于那一条边距**（负 margin），文字就落在纸张边缘（2 英寸边距配 `-2in` 时左端 x=0）。
  三条只有真量才知道的：margin box 的 `width:100%` **不吃**（认的是 margin/padding）、推过头（`-3in` 配 2 英寸边距）
  那一格会被**整个丢掉、连账都不留**（所以一丝不许多给）、中格要两边都推——不对称边距（左 1 / 右 2 英寸）下
  它的中心从可印区中心挪到纸中心（实测整条页眉中心 385.1 → 421.1，纸中心 421.0、可印区中心 385.0）
- **诚实的残差照旧上账**：Excel 关掉这一档时铺到的是**打印机的可打印区**（实测左右对称各留 55pt，随打印机变），
  我们没有打印机概念、铺到纸张边缘，差的就是那一圈。这句话写在 `hfAndPageNumberNotes` 里（面板与导出共吃一份文案，
  v0.52 立的规矩），语气是"做到了但差一圈"而不是"做不到"
- **接线口的形状**：`headerFooterCss` 多收一枚 `HfPaperOpts { zoom, margins }`，`planSheetPrint` 多一枚可选
  `opts.hfZoom`——因为"这一趟真正落到纸上的缩放"不一定等于计划里声明的那一档（v0.53 的实测循环会压出更小的一个数），
  `sheetsToPrintHtml` 把 `opts.zooms[i]` 顺着表传下去，页眉字号才跟得上
- **面板**：页眉页脚那一组里两枚勾选，勾着＝写 `null`（不声明）、取消＝写 `false`，旁注一次说清"哪一档我们照 Excel
  把字号乘了、哪一档两边差一圈"
- **判据自己栽的两处（都是"断了我以为文件里有的东西"）**：Excel 腿原本断 `&amp;A`，而夹具页眉写的是
  `&L<表名>左&C<表名>中&R<表名>右`——整串里根本没有 `&A`，五份件集体 FAIL；同一趟把 `w-s-on` 的边距按
  `s-alignoff` 那对**故意不对称**的 1/2 英寸来断，而 `w-s-on` 来自 `s-on`、边距是默认那档 0.7 英寸（50.4 磅）。
  改成断"格式码仍按 `&amp;L/&amp;C/&amp;R` 一节转义存着 + 整串不许出现 `&amp;amp;`（写侧多逃一趟）"与
  "重存后边距仍是默认那档"——断言只能写自己造过的那串字节
- **好消息：这两枚 COM 面报得出来**，与 v0.51~v0.54 那五项一律 `$null` 的属性（`PageOrder`/`FitToPage`/
  `OddAndEvenPages`/`EvenHeader`/`FirstHeader`）不同——`PageSetup.ScaleWithDocHeaderFooter` 与
  `AlignMarginsHeaderFooter` 给 msoTrue(-1)/msoFalse(0)，五份件十次读数全部与文件字面一致，
  于是这一对有了真第三方见证，不必退回"只按 XML 字面核"
- **量页眉不许只挑一段字**：pdf.js 会按字体把一行拆成多枚 item，用 `/[左中右]/` 过滤再取 min(x) 量到的是
  **中文那半条串**（1 英寸边距读成 120.7pt、贴着纸边读成 49.5pt，两个数都假）；要把整条基线上所有 item 一起量
  （min x / max right / max height），改完的读数才是 72.0 与 0.0
- **验证（四腿）**：前端结构测试 **24 断言 / 真失败 0**（假例必须打 FAIL；字号只在 `r.scale≠1` 时写、六框各写一次、
  `scaleWithDoc=false` 一个字都不乘、`&14` 那类自带字号的段也乘（9.33 / 18.66px）、基准常量整仓只定义一次、
  负 margin 只按载荷那两条边距推（左 1 条 / 中 2 条 / 右 1 条）、边距为 0 的那一侧不推、`opts.hfZoom` 压在声明的
  缩放之上、"差一圈"那句在 `plan` 与 `draftPaperNotes` 里逐字同一句、`validateDraft` 对 null/true/false 都不拦）；
  `cargo test --lib` **74 通过 / 8 ignored**（三例新腿：关着的那枚落进 XML 而开着的不写、存两次两枚都活着、
  文件里显式写 `scaleWithDoc="0" alignWithMargins="1"` 读回来是 `Some(false)` 与 `None`）；
  **CDP 真机冒烟 38 断言 / 真失败 0、页面异常 0 条**（四份件各开→断侧通道→导出→pdf.js 整条基线量几何：
  页眉字高比 开着/关掉 = 0.500（Excel 那两份 5.5/11 = 0.500）、按边距时左端落在 72.0＝1 英寸、关掉后落在 0.0＝纸边、
  整条中心 385.1 → 421.1、没声明页脚时纸上就是没有页脚行 → 污染序（文档导出在前）→ 面板落笔 → 存盘重开两枚仍在 →
  重开后再导出的几何与第一趟一致）；**Excel 16.0 只读腿 57 断言 / 真失败 0**（写侧夹具四份 + 应用重存的那份，
  文件字面与 COM 读数两条腿各一遍，`Zoom`/左右边距按磅/A1 格值一并核）；tsc + build 绿

## 页眉的字号在纸上只说一次话：底数与最后一档缩放（v0.56）

上一轮那条未勾项写得很准：`scaleWithDoc` 的**倍数**已经对了，对不上的是倍数所乘的那一档**底数**，
以及宽度分带挤出来的那一档 `zoom` 还没跟到页眉上。本轮就是这两笔——而且底数该是多少、
挤出来的那一档到底带不带页眉，都是在 Excel 16.0 自己导出的 PDF 上量出来的，不是猜的。

- **底数从 16px（上纸 12pt）改到 11pt 那一档**：`HF_BASE_FONT_PT = 11` 配一枚 `ptToPx`（96/72，换算只这一处），
  `segScaleCss` 换成 `segFontCss`。要紧的一条是**倍数正好为 1 时现在也写**——上一轮的"为 1 就一个字都不写"
  在这条上不是"不声明"而是"声明了另一档"：不写就等于让 margin box 去继承页面那 16px，缺陷原地不动。
  段自己带了 `&12` 那一类字号码时乘数交给 `segStyle`（`ptToPx(seg.pt * r.scale)`），底数不重复出手
- **但底数其实不是常量，是"工作簿默认字号"**：判别件 `fw-def14`（把 `xl/styles.xml` 里那条
  `<sz val="11"/>` 改成 `14`，其余一个字节都不动）在 Excel 里导出的 PDF 页眉 **14.04pt**、正文同为 14.04pt，
  比值 1.000，而 `plain/def14` 两件的页眉比正好是 **11/14** ⇒ 页眉底数走的是字号那一层、不是缩放那一层，
  11pt 只是它的默认值。我们的载荷里**没有工作簿默认字号这一层**（正文格子也是从 CSS `font-size:11px` 打印的），
  所以这一条不硬造，进路线图新开一项
- **改第三方件要按"对方也认"来验**：`.NET` 的 `ZipArchive` 用 Update 模式就地改写 `styles.xml` 产出的那份件，
  我们的读侧开得、zip 结构也合法，**Excel 16.0 直接拒开**（`不能取得类 Workbooks 的 Open 属性`）；
  改用 python `zipfile` 按原条目序重打包（`fw-def14b.xlsx`）就正常。只凭自家读得回来判"件没坏"是一条会自证清白的路
- **② 是真事，而且是三份对照件说出来的**（同一张 14 列 × 130px 的表，竖版 A4 一页宽装不下）：
  `fw-plain`（scale 100）页眉 11.04 / 正文 11.04，`fw-fit1`（`fitToPage` + `fitToWidth=1`）**1 页**、
  页眉 4.08 / 正文 4.08，`fw-fit1-off`（同一件再写 `scaleWithDoc="0"`）页眉 11.04 / 正文 4.08
  ⇒ Excel 自己反求出的那一档（约 37%）**确实带着页眉一起压**，而开关管的是**最终落到纸上的那一档**、
  不是"声明出来的那一档"。所以这一条是接线，不是记账
- **接线口的形状：不是把列带几何再算一遍**。`sheetHtml` 把自己**真正挂到 `<table>` 上的那一档 zoom** 回报出来
  （返回 `{html, notes, zoom}`），`sheetsToPrintHtml` 发现它与计划用的那档不同就只重说页眉那份 CSS
  （同一次解析，`notes` 故意不重复推），随后**重算一次 `job`**——纸的那三个数与"各表的页眉页脚不一样"那本账
  都要在页眉重说之后才算最终答案。两处各算一套列宽只会分叉，这一条与 v0.47/v0.51 那次同一个结构决定
- **COM 面在这条上帮不上忙**：`fitToPage` 开着时 `PageSetup.Zoom` 返回的是 `False` 而不是百分数，
  Excel 挤出来的那一档**只能从产物读**；我们的 0.384 与它的 ≈0.373 差在两家可印宽的算法上（边距那几毫米），
  不是同一档的 bug
- **冒烟第一次报的"失败"是判据写错了，不是链路**：我断"页眉与正文同档"，读回 4.22 / 3.16pt。真相是两边吃
  **同一档缩放、不同的底数**（页眉 11pt、正文 CSS 11px＝8.25pt），比值 1.335 ≈ 11/8.25。改成断这个比值之后
  它既过得去、又恰好把上面那条路线图项钉在纸上——把 Excel 那两档**恰好相等**当成通用不变量，就是拿别人的
  默认值当物理定律
- **验证（四腿）**：前端结构测试 **19 断言 / 真失败 0**（假例必须打 FAIL；底数 14.67px、×0.5＝7.33px、关掉＝14.67px、
  `&12` 那一段 8px、fit-to-width 5.47px 且"页眉比值 == 表上那一档 zoom"、`zooms:[0.2]` 抢过页宽那一档、
  窄表与只写一句页眉的表都不许多记账）；`cargo test --lib` **74 通过 / 9 ignored**（多一份三件对照夹具
  `gen_fitwidth_fixture`，Excel 腿与冒烟腿吃同一份字节）；**CDP 真机冒烟 29 断言 / 真失败 0、页面异常 0 条**
  （三件各开一遍：侧通道 → `printPlan` 的 `@page` 字号 → 导 PDF → pdf.js 量字高，11.00 / 4.22 / 11.00 与
  正文 3.16pt 逐个对上；三件的期望值本就是交替的，`@page` 串台会当场露出来）；
  **Excel 16.0 只读腿两头**——`excel-export.ps1` **6 断言**（导出份数、`ScaleWithDocHeaderFooter` 读数、文件字面）
  与 `excel-pdf.mjs` **14 断言**（把 11.04 / 4.08 / 11.04 / 14.04 这四个数从散文变成断言，含比值与"底数之比"两条
  通道分离的核法）；tsc + build 绿

## 文件开口说默认字体：页眉底数跟着工作簿走（v0.57）

上一轮那条未勾项说的是同一层——页眉的底数不是常量，是**工作簿默认字号**，而我们的载荷里根本没有这一层。
本轮按窄口径兑现：**只把页眉底数接到文件说话的那一层**，正文底数（CSS 11px 那一档）另开一项，因为它牵动的
是整张表的排版与 `PRINT_ROW_BIAS_PX` 的标定，不是把一枚数传下去就完事。

- **这一层在 OOXML 里的真位置**：`xl/styles.xml` 的 `fonts[cellXfs[0].fontId]`，也就是 Normal 样式那枚字体，
  不是任何一处看着像默认的东西。判别靠**索引**而不是位置——夹具里让 `cellXfs[0]` 指 `fontId="1"`，
  按第一个 `<font>` 读的那条腿当场报错（结构测试里那条钉就是为这个写的）
- **写侧走 crate 的 `set_default_format`**（`rust_xlsxwriter` 0.99.1），两条约束都是踩出来的：必须在**任何
  `add_worksheet` 之前**调用；第二个第三个参数是 crate 自己的列宽行高度量，传 `(20, 64)` 才能只动字体那一层
  ——`sheetFormatPr defaultRowHeight="15"` 一个字不变。走通了它默认格式就是 xf 0 / `fonts[0]`，
  设置失败**不再静默**（`notes.push`，不是 `let _ =`）
- **对照件教的一条 Excel 侧事实**：在 Excel 里改 `Styles("Normal").Font` 存盘，`<scheme>` 会消失、
  `sheetFormatPr@defaultRowHeight` 从 14 抬到 17.5；而我们只走字体那一层，`defaultRowHeight` 仍旧 15。
  顺带记一处部件：`sheetFormatPr` 在 `xl/worksheets/sheetN.xml` 而**不是** `styles.xml`——本轮有一条断言
  就是先找错了部件而"因错的原因通过"
- **这一层不归一化**（与 v0.48 默认气泡尺寸、v0.52 默认边那两条相反）：`ff` 读进什么就交回什么。
  把"等线"归一回"不声明"，写侧就会落一枚 Calibri——那是**换字族**，不是省字节；默认值不算声明这条规矩
  管的是"别替用户声明他没设过的东西"，不管"把文件里明写的抹掉"
- **荒谬值在唯一的消费点兜底**：载荷里 `fs` 为 0 或负数时视作"那一层没说话"、回落到 `HF_BASE_FONT_PT = 11`
  （那枚常量这轮起降级为**兜底**），而不是把字号写成 `0px` 让整行页眉在纸上消失
- **Univer 里没有这一层的活口**：`IWorkbookData.defaultStyle` 在 core 里零读取，引擎渲染兜回硬编码 Arial 11，
  而 `wb.save().defaultFont` 在本轮探针里恒为 `null`。所以它照旧走**侧通道**（`defaultFontRef`，钥匙与
  `printRef` 同族：换标签复位、加载时挂上、`payloadWithCharts` 那一枚漏斗回贴），于是存盘与导出 PDF 共吃一份，
  而界面渲染不会因此说谎
- **真上纸的数（本轮的量法全部是比值）**：文件说 11pt ⇒ `@page` 字号 14.670px ⇒ 纸上 11.002pt；文件说 14pt ⇒
  18.670px ⇒ 14.002pt；两件页眉比 **1.273 ≈ 14/11**，而正文那枚 `x` 两件都是 **8.244pt**（证明正文那一层没被动）。
  存盘 + 重开后**不给 `printSet`**，页眉串与 14pt 底数都从文件里回来
- **第三方认我们写的那一份**：Excel 16.0 打开应用重存的件，`Styles("Normal")` 报 **宋体 / 14**，
  它自己导出的 PDF 页眉/正文比 **1.276 ≈ 14/11**——写进去的那枚 `fonts[0]` 是真被认得的，不是只有自家读得回
- **只有真机能教的三条 + 判据自己栽的两处**：(a) **跨产品的绝对字高不可比**：Excel 那份宋体页眉量到 13.320pt 而
  我们是 14.002pt，两家的 font bbox 不同（≈0.95×em vs ≈1.000×em），第一次跑出三条"失败"就是这个——判据只能按
  比值定，这条已经变成一枚断言；(b) **这台 Excel 的 COM 面会替换字族名**：文件里明写 Calibri/11，
  `A1.Font.Name` 报宋体，所以 COM 那条腿只有**磅值**能当判据，字族名只当留证；(c) `PageSetup.Header.LeftHeader`
  在这台机器上照旧回空（v0.54/v0.55 已记过），本轮把它从断言降级成打印出来的证据，免得既假失败又因错的原因通过。
  栽的两处：`<headerFooter>` 找错了部件（styles.xml → worksheets/sheet1.xml），以及 Univer facade 的 worksheet
  **没有 `getName()`**，表名要从 `wb.save()` 的 `sheetOrder[0]` 取
- **本轮不做的，量出来记着**：我们存盘会给原本不带 `s=` 的格子盖上显式 xf（`<c r="A1" s="1">` → Calibri/11），
  于是**正文连 Normal 那一层也不吃了**；同一件在 Excel 纸上是 10.440pt 而我们 8.244pt（差 1.266 倍）。
  这一笔与 ODS 的 `default-style`（本轮读侧按 `None` 交回）都开进了路线图
- **验证（四腿）**：前端结构测试 **35 断言 / 真失败 0**（假例必须打 FAIL；`hfBasePt` 传与不传两档、
  兜底常量只在缺省时出现、0/负数不落到纸上、段自带字号码仍优先、`fs` 一轮只在一处被读、侧通道形状与漏斗接线）；
  `cargo test --lib` **78 通过 / 0 失败 / 9 ignored**（默认字体四枚：声明的落进 `fonts[0]` 且不带 `scheme`、
  没声明的保持 crate 形状、存两次字族与字号都在、`cellXfs` 索引判别那一例八条断言）；
  **CDP 真机冒烟 19 断言 / 真失败 0、页面异常 0 条**（两件各：侧通道 → `@page` 字号 → 导 PDF → 量字高比 →
  存盘重开不带 `printSet` 也能回来）；**Excel 16.0 只读腿两头**——`excel.ps1` **24 断言**
  （pristineA/pristineB 两份 Excel 原件做对照：Normal 的读法、`A1` 不带 `s=`、`defaultRowHeight` 17.5、
  COM 的 Normal/A1 读数、`fonts[0]` 字面、`&amp;` 转义、格值一个字符没动）+ `excel-pdf.mjs` **8 断言**
  （14/11、14/8.25、11/8.25 三条比值与那条"绝对值不可比"的自证）；tsc + build 绿

## 正文的一格不许替它说话：写侧不再给未设样式的格盖上显式 xf（v0.58）

上一轮末尾记的那笔账说的是同一层的下半截：`fonts[cellXfs[0].fontId]` 已经进了载荷、页眉也跟着文件说话了，
但**正文连这一层都不吃**——因为我们存盘会给原本不带 `s=` 的格子盖上一枚显式 xf（`<c r="A1" s="1">` → Calibri/11），
而 Excel 原件里那一格是靠**继承 Normal** 拿字号的。本轮只动写侧，而且动的是"少写"：把属于文件那一层的决定
还给文件，我们的常量不再冒充格子自己说过的话。

- **形状**：`format_for` 从"每格都带一份 Format"改成"载荷真说了样式才带"——没样式的格走 `write_string` /
  `write_number` / `write_boolean` / `write_formula` 那几条**不带 format** 的写法，实测那样 `<c>` 上就是没有 `s=`；
  `None`（有值没样式）与"只有默认值的空 `CellStyle`"（`has_any()` 那道门）都走这一路，
  而"一格空值也没样式"仍旧什么都不写
- **只说了一半的样式，底数由文件给**：格子里只勾了加粗、没说字族字号时，`seed_font(default)` 把工作簿默认字体那两味
  **种进**那一枚 `<font>` ⇒ `<b/><sz val="14"/><name val="宋体"/>`，而不是落到 crate 的 Calibri/11 上。
  反面守卫同样立着：文件那一层没说话时不许凭空造一层——载荷没给 `defaultFont` 时加粗格仍是 crate 那一档
- **同一档不重复声明**（本轮新的一条规矩）：文件说的正是 Calibri/11 时一个字都不种。实测显式
  `set_font_name("Calibri")` 写出来的那一条 `<font>` **没有** `<scheme val="minor"/>`——种了等于把"字族跟着主题走"
  弄丢，所以 `set_default_format` 与 `seed_font` 两头共用同一条守卫（`fs` 与 11 相等、名字为空或就叫 Calibri 时不算说话）
- **读侧的归一化参照物本轮没搬，而且这是量过之后决定的**：把 `style_for` 那把尺子从常量换成文件那一层，
  会把"与默认同一档"的格子读成空样式，而 Univer 的默认字体是硬编码 Arial/11（v0.57 记的那枚侧通道），
  界面上就会从宋体 14 掉回 11 号——**屏幕、纸面与这一层必须一起搬**，纸面那半还牵着 `PRINT_ROW_BIAS_PX` 的重标定。
  于是载荷里 `s: None` 有两种来源而分不开：文件里那一格真的不带 `s=`（该继承），和它带了 `s=` 而样式正是
  Calibri/11（该照自己写）。这一条本轮**当我说并钉住**（`empty_payload_style_is_ambiguous` + 冒烟里 stamped 那两例），
  写侧从本轮起把后一种从"歪打正着的 Calibri/11"换成"随大流"
- **成对夹具 `gen_inherit_fixture`**：`b-inherit` 正文格不带样式、`b-stamped` 正文格明写 Calibri/11（正是本轮之前
  我们盖上去的那一档），两件共用同一份宋体/14 工作簿默认字体与同一句页眉，只有正文那一层不同——
  于是"底数从哪来"在同一次运行里有对照。夹具写法上踩到的一条：**必须一趟写成，不走"读回再写"**，
  因为 stamped 那一档 Calibri/11 会被读侧归一化成"没说话"，重写一趟就把对照件写成了实验件
- **第三方认的分量（Excel 16.0 自己导出的 PDF，字高按文本项分三类）**：inherit 那件页眉 14.040 / 正文 14.040 /
  只说加粗那格 14.040 ⇒ 页眉正文**比 1.000**；stamped 那件页眉 14.040、正文 11.040 ⇒ **比 1.272**，
  也就是 v0.57 量到 1.266 的那个形状被留在同一趟里当对照。COM 面这里第一次真帮上忙：`Range.Font.Size` **会把继承解出来**
  （inherit 的 A1/B1/D1 全报 14，stamped 的 A1 报 11 而 D1 仍报 14）——正文那一层的归属在第三方是可读的，
  这条比量 PDF 便宜，是后续接正文底数时的首选判据
- **我们的纸本轮一个字没动，所以量出来正好是"没动"**：两件都是页眉 **14.002pt**（跟着文件，v0.57 那条）而
  正文 **8.244pt**（CSS `font-size:11px`＝8.25pt 那一档），我们纸上的页眉/正文比 **1.698 ≈ 14/8.25**，
  而同一件在 Excel 的纸上是 **1.000**——这一档差（同一件正文 14.040 vs 8.244＝**1.703 倍**）就是路线图那条"正文底数"未勾项的数
- **两处量法/部件坑**：(a) 同一行里既有 14pt 的加粗格又有 11pt 的正文格，**按基线取 `Math.max` 会把 stamped 读成 1.000**
  （第一条判据就是这么既假绿又假红的），判据必须按文本项分类取；(b) `t="s"` 的格值住 `xl/sharedStrings.xml` 而不在
  `sheet1.xml`，第一条只读腿先在错的部件里找 `<t>R1C1</t>`，于是集体 FAIL
- **验证（本轮前端零改动，四腿各就各位）**：`cargo test --lib` **83 通过 / 0 失败 / 10 ignored**（五枚新断言集：
  不带样式的格不盖 xf 且**存两次盘不许把 xf 盖回来**、只说加粗的格从文件那一层取底数、没有默认字体时照旧 crate 那一档、
  同一档不重复声明（`<scheme>` 仍在 + 省掉那一笔之后读侧仍认得出这一层是 Calibri/11）、空样式的两种来源分不开）；
  **Excel 16.0 只读腿两头**——`excel.ps1` **13 断言**（Normal/A1/B1/D1 的磅值、格值一个没动、加粗还在、PDF 出得来）
  + `excel-pdf.mjs` **8 断言**（1.000 与 1.272 两条比值，含"加粗格与页眉同档、与正文不同档"那条底数来源的当面对质）；
  **CDP 真机冒烟 16 断言 / 真失败 0、页面异常 0 条**（两件各：界面里 A1/D1 的样式来源 → 存盘 → 重开 → 格值一格没动 →
  我们的纸上页眉与正文两档各断住）；应用真机存盘那份的字节 `app-bytes.ps1` **10 断言 / 真失败 0**
  （`<c r="A1" t="s">` 没有 `s=`、`<c r="D1" s="1">` → fontId=1 → `<font><b/><sz val="14"/><name val="宋体"/>` 且通篇没有 Calibri、
  Normal=宋体/14、sharedStrings 里 R1C1/R8C3/BOLD 三条都在）；tsc + build 绿

## 正文也听文件的：纸面底数搬进工作簿默认字体那一层（v0.59）

v0.57 的窄口径留下下半截，v0.58 把那一档差量死在同一份文件上：`b-inherit` 那件在 Excel 的纸上页眉/正文比 **1.000**
（正文 14.040pt），而我们自己的纸上是 **14.002 / 8.244＝1.698**——正文仍旧从 CSS `font-size:11px`（＝8.25pt）打印。
那条未勾项说清了这是**三处必须一起搬**的东西（① 读侧归一化的参照物、② 屏幕那一层、③ 纸面那一层），
本轮搬的是 ③，而且 ③ 一动就牵着 `PRINT_ROW_BIAS_PX` 重标定——所以真正的活不在"把一枚数传下去"，而在行盒。

- **底数的解析整仓只有一处**：新增 `baseFontPt(df)` 把"文件说的那一档"与"荒谬值兜底"合进同一枚助手（`fs` 缺、0、
  负数都算"那一层没说话" ⇒ 落回 `BASE_FONT_PT = 11`，那枚常量从 v0.57 的页眉兜底升成**正文与页眉共用**的兜底），
  `baseFontPx(df)` 是它的 px 形。随之删掉两样旧的：`HF_BASE_FONT_PT` 这个名、以及 `HfPaperOpts`/`planSheetPrint`
  opts 里那枚 `hfBasePt`——**两处各自去读 `fs` 迟早分叉**（结构腿按"源文里读 `.fs` 的行只有一行"钉住这件事）。
  `ptToPx` 也从私有升为导出，成为整仓唯一的 pt→px 换算处；格子上那份 `Math.round(fs * 1.333)` 一并走过它（`1.333` 绝迹）
- **落到 DOM 的方式不是逐格写字号**：每张表的 `<section>` 挂一枚 `--oof-print-base-size:<px>`，`.sheet-print-table td`
  的 `font-size` 吃 `var(--oof-print-base-size, 14.67px)`。空表与"打印区域里没有可打印的格子"那两条早退路径**也带着它**
  （那一格里的字同样要上纸，底数不该因为没网格就换一档）；格子自己说了字号仍由 `styleParts` 盖在格上、`&12` 那类段仍走
  `segStyle`，一次读出两处共吃、不重复出手
- **行盒才是本轮的重量**：底数一动，旧的 `padding:2px 6px; font-size:11px; line-height:1.45; height:18px` 就成了多出来
  的一截。同一对件上 A/B 了四档（`base` 旧行盒不接文件 / `file` 接文件仍用旧行盒 / `tight` 1.0 / `lh125`、`lh127`）：
  `base` 那档**两份件行推进同为 19.99px**——这正是"正文不吃文件那一层"的形状，字节不同的两件在我们纸上一个字都不差；
  `file` 那档出 24.98 / 30.98，每行凭空多出 7px，连 11pt 那份都被挤成两页；`tight` 与 `lh125` 的差落在基线吸附的噪声里
  （14pt 两件同为 22.98），可 1em 的方框装不住下行墨而 td 是 `overflow:hidden`，p/g/y 那几笔在纸上就被切掉；
  留下的 `line-height:1.25` + `padding:0 6px` + **不再写 `height`** 把行推进收回 1.25 × 底数（18.333 / 23.333px）——
  14pt 那一档与 Excel 报的默认行高 **17.5pt 一字不差**，11pt 那一档是 13.75pt 而 Excel 报 14（差四分之一个磅，照实记）
- **`PRINT_ROW_BIAS_PX` 归零**（就是那条"纸面一动就得重标定"的兑现）：量法是逐行拿同一列（`C01`，每行恰好一枚）
  从上到下的基线差去对同一行的屏底行矩形，抖量在求和里自己抵消——按行取中位数会挑到被吸到整磅的那一档
  （13.49 与 14.24 各半那种读数是量具假象）。新行盒下普通行的差是 −0.05~+0.02px ⇒ 0.4 那一档不再存在；
  **留着旧的 0.4 不是保守而是凭空多压一档缩放**，结构腿把它钉成一枚"同一份实测在 0.4 下变成 15 页"的假例。
  注释里那条约束跟着改口：这枚数**跟着行盒走**，再动 `line-height`/`padding`/把 `height` 写回来都必须重跑这段实测
- **真上纸的数（判据仍是比值，跨产品绝对字高不可比那条沿用 v0.57）**：文件说 11 ⇒ 纸上正文 em **10.994**、页眉 **11.002**；
  说 14 ⇒ **13.992** / **14.002**；两件**页眉/正文 = 1.000**，与 Excel 自己导出的那两份（11.04/11.04、14.04/14.04）同形，
  跨件正文比 = 14/11。**只勾了加粗、没说字号那一格与正文同档**（10.994）⇒ 底数走的确实是文件那一层而不是我们的常量；
  分页也跟着走：`bb-11` 两家都是一页、`bb-14` 两家都是两页。存盘 + 重开后**不给 `printSet`**，页眉串与底数都从文件里回来，
  而那份重存件在 Excel 眼里正文仍 14.04、页眉/正文仍 1.000、页数同档
- **只有真机能教的三条**：(a) 这台 Excel 报的默认行高是 **14 / 17.5**（11pt 与 14pt 两档），不是我们在 `sheetFormatPr`
  里落的 15——底数抬高一档，Excel 的默认行高跟着抬，**这一维我们没接**（进路线图）；(b) pdf.js 的 `item.height` 与
  `transform[5]` 本来就是磅，别再乘 0.75；(c) 冒烟第一次"重开等不到能出计划的标签"不是产品缺陷——`printPlan()` 会把
  整份打印 HTML 重算一遍，在 `openPath` 之后紧密轮询它就是给一个还没渲染完的标签反复建表；先核 zip 魔数、
  把等待判据换成"标签在不在"、再有限次重试就正常了
- **本轮不做的，量出来记着**：① 读侧 `style_for` 的归一化参照物**仍旧是常量**，② 屏幕那一层**仍旧是 Univer 硬编码的
  Arial/11**。于是文件说 14pt 时**纸上是 14pt 而界面上一格不样式的字还是 11 号**——这一档分叉是本轮新留下的，当我说；
  搬其中任何一处都得连着另一处一起，否则刚对上 Excel 的那一档又会被弄丢
- **验证（四腿）**：前端结构测试 **37 断言 / 真失败 0**（假例必须打 FAIL；`baseFontPt` 的缺 `fs`/0/负数三档兜底、
  `planSheetPrint().defaultFontPx`、两张表 ⇒ 恰好两枚 `--oof-print-base-size:18.67px`、页眉 `@page` 与 `<section>`
  同一个数、`zooms:[0.5]` 把页眉重说成 9.33px 而 section 那枚一动不动、`&12` 段 16px、格子 `s.fs:9` ⇒ 12px 且一份字号、
  `PRINT_ROW_BIAS_PX = 0` + 旧偏置 15 页假例、三个旧名（`HF_BASE_FONT_PT`/`hfBasePt`/`1.333`）在源文里绝迹、
  td 规则那把尺子自己也被自检（带 `height` 的假规则要被抓到、只带 `line-height` 的不许误报））；
  `cargo test --lib` **83 通过 / 0 失败 / 11 ignored**（本轮只多一份成对夹具 `gen_bodybase_fixture`：`bb-11`＝Calibri/11、
  `bb-14`＝宋体/14，同一张 40 行 × 5 列的表、同一句带 tag 的页眉，第 3 列那条长串是给"列宽按 MDW 换算、不跟字体走 ⇒
  底数一大同一格就要多折一行"留的余地，读写逻辑零改动）；**CDP 真机冒烟 33 断言 / 真失败 0、页面异常 0 条**
  （两件各：侧通道 → `plans[0].basePx` → `baseVars` 按张核 → `@page` 字号 → 导 PDF 量正文/页眉 em 与行推进 →
  14→11→14 交替导出证 `@page` 不串台 → 存盘重开不带 `printSet` 仍回得来）；**Excel 16.0 只读腿两头**——
  `excel-leg.ps1` **12 断言**（两份原件 + 应用重存那份：`A1` 与加粗格的 `Font.Size` 跟着底数、默认行高 14→17.5 的方向、
  重存后 `Normal` 仍 14、PDF 出得来；字族名只留证，这台 COM 面会替换它）+ `excel-pdf.mjs` **13 断言**
  （两家各自的 1.000、跨件 14/11、行推进比 ≈ 1、重存件与原件同档），+ tsc 与 build 绿

## 那一层只在文件里说话：工作表缺省行高的保真往返（v0.60）

v0.59 那条未勾项写的是「默认行高与列宽不跟这一层走」，起点是「这台 Excel 报 14 / 17.5，而我们在 `sheetFormatPr` 里落的仍是 15 那一枚常量」。
本轮先去量**这一层到底是什么**，量完发现那条未勾项的前提得改口：把同一张表写成五件变体
（`defaultRowHeight="15"`／`30`／`30 customHeight="1"`／`17.5`／整枚擦掉）在 Excel 16.0 里逐个打开，
`Rows.Item(1).RowHeight` **五件全是 17.5**——它根本不是排版指令，而是一枚「文件里的字节」：Excel 不用它排版，
却**自己存盘会重写它**（那份 30 磅的件经 Excel `SaveAs` 变成 `<sheetFormatPr defaultRowHeight="17.5" x14ac:dyDescent="0.3"/>`）。
于是本轮的范围由实测定死：**只做保真往返**（读 → 载荷 → 存盘那趟定点重打包写回），界面与纸面都不吃它——
喂进去就是让界面去听一个纸面不认的数。

- **不吃 crate 的 `set_default_row_height`，两条理由都是量出来的**：① 它内部按**整数像素**存，17.5pt 落纸变成 17.25（磅字面在字节上漂 0.25）；
  ② 它把「缺省」盖成**每一行的显式 `ht` + `customHeight="1"`**——行是**存盘那一刻**才落进 XML 的，所以先设后设一个样，
  躲不过去。v0.58 刚立的「没声明过的东西不盖章」在这一维上会被它当场破掉，故判别测试
  `crate_default_row_height_setter_stamps_every_row` 把这枚 setter 永久钉死不用（不设 ⇒ 四行里只有一行带 `ht`；设了 ⇒ 除了明说 30 的那行全被盖章）
- **落点在同一趟定点重打包**：`PrintPatch` 多带 `sheet_format`，`patch_sheet_format` **只动那一枚元素的 `defaultRowHeight`/`customHeight` 两枚属性**
  （邻居属性如 `baseColWidth` 原样搬，元素本来不在就按 schema 位置插到 `<cols>`/`<sheetData>` 之前），`noop()` 把这一位也算进去
  ——否则「只有这一层」的那趟补丁会被整趟跳过、擦了个寂寞；缺部件时那句账目从「页眉页脚或起始页码没写出去」改成
  「页眉页脚、起始页码**或缺省行高**没写出去」（三种补丁共用一条账，名字写少就是在假账上）
- **归一化只有一条，而且是双向的**：正好 15 **且没带** `customHeight` ⇒ 视作「没说话」（ECMA 缺省就是 15、crate 落笔也是 15，
  省掉这枚声明与把它写进字节对读的人同一档，与 v0.52 那档「只剩默认边距的件视作没声明」同理）；但
  `defaultRowHeight="15" customHeight="1"` **不许**被归一化抹掉——那是真把缺省设成 15、又说「我改过」的一格。
  0／负数／NaN 在唯一的读点当「没说话」（v0.57 那枚 `fs` 的同一分寸）；磅字面一路直存**不换算成像素**（换算一趟就在字节上漂一档）
- **Univer 里这一枚是活口，方向与 v0.57 那层正相反**：`IWorkbookData.defaultStyle` 是死槽（零读取）所以非喂侧通道不可，
  而 `IWorksheetData.defaultRowHeight` 喂进去**界面真按它排**——于是这层反过来：**不喂**。
  按表名留一份只读侧通道 `sheetFormatRef`（第四份，改名时一起搬钥匙），`payloadWithCharts` 里
  `if (f && !sheet.sheetFormat)` 漏斗回贴（快照自己带的那份不许被侧通道盖掉）；
  「不喂界面」不是注释而是钉：结构腿数五个前端源文里 `sheetFormat` 出现**零次**、`univer-io.ts` 里 `defaultRowHeight` 出现**零次**，
  并带一枚「把喂法注回去就要被抓到」的假例
- **真上纸的数与真机读回的数**：三件变体（30／15／整枚擦掉）的纸上 **40 行行推进同为 17.237pt**、彼此差 <0.2pt，
  而那一枚说的是 30 磅 ⇒ 纸面确实不吃它（这条不是假设而是被监着的：真吃了就该是 37.5pt 那一档）；
  三件的 `plans[0]` 逐字相同（打印计划里没有这一层的影子）；污染序一趟（文档导出夹在两次表格导出之间）行距不变、
  侧通道仍旧在；存盘往返三件的字面各是 `defaultRowHeight="30"`／`"15"`（crate 那一枚原样不动）／`"30" customHeight="1"`，
  重开交回 `{30}`／`null`／`{30,customHeight:true}`；Excel 那边五件的行 1 **全是 17.5**、第 5 行仍是文件自己明说的 **22.5**
  （行级那一维与簿级这一层各管各的）、`A1`/`B1` 的格值一格没动，而我们重存的那份在 Excel 眼里行高**仍旧 17.5**（写这一层没挪动任何布局）
- **只有真机能教的三条 + 判据自己栽的一处**：(a) **判据不能写成「零枚盖章」**——那份夹具自己就带一行显式 `ht="22.5"`，
  冒烟第一次报的三条「失败」就是这个空断言，正确的说法是「存盘前后**同一批**」（`前 1 枚 / 后 1 枚`）；
  (b) **CDP 的信封是两层**：`Runtime.evaluate` 的响应体在消息的 `result` 里、值在它的 `result.value` 里，
  按一层剥时每个 `evl` 都拿到 `undefined`，`until()` 于是报「等不到新标签」——看着像产品挂了，其实是量具（先证明脚本跑得起来再下结论那条老规矩又一次兑现）；
  (c) **同路径打开是复用标签而不是新建**（`openTab` 按 `path` 去重），上一轮留下的那个标签会让「差分新长出来的 id」永远等不到，
  所以有路径的按**路径**找回、只有无路径的空标签才用差分；(d) Excel 腿的假例必须拿**真从 COM 读回来的那五个数**当原料，
  写死常量的自检只是在测自己写的 `Near`
- **本轮不做的，量出来记着**：① **列宽**仍旧按 MDW=7 换算（`chars_to_px` 只合 Calibri/11，底数 14pt 那一件的长串仍要多折一行）；
  ② `set_row_height_pixels` 的**整数像素截断**（载荷里非整的那一档被 `as u32` 截掉，最多 1px＝0.75pt 的字节漂移——
  顺手修掉了 `xlsx.rs` 里那句「px↔pt 3/4 对 4/3 无损」的**假注释**，它一直说的是同一维）；
  ③ Excel 亲笔那份带的 `x14ac:dyDescent="0.3"` 在**整包重写**里留不下（我们不认的属性活不过这趟；本轮只保证「那一枚数」活着，
  冒烟把这句从断言降级成打印的证据，免得既假失败又因错的原因通过）；④ `.ods` 这一枚照旧交回 `None`——**当时写的是「ODS 没有这一层的对应物」，v0.61 读侧通同一件 `styles.xml` 时改口：对应物是有的，那是 `family="table-row"` 那一支 default-style，本轮只是没接**
- **验证（四腿）**：前端结构测试 **17 断言 / 真失败 0**（假例必须打 FAIL：拆掉喂法／漏斗／侧通道三处各打一次，
  「不喂界面」那条是注入喂法后要被抓到）；`cargo test --lib` **88 通过 / 0 失败 / 11 ignored**（新三例：17.5 落进字面而一行都不被盖章、
  存两次还在；没说话的载荷保持 crate 那枚 15 且「只有这一层」的补丁不算 `noop()`；补丁只重写自家两枚属性，
  `0`／负数／NaN 一字节都不动也不留账）；**CDP 真机冒烟 28 断言 / 真失败 0、页面异常 0 条**；
  **Excel 16.0 只读腿 24 断言 / 真失败 0**，+ tsc 与 build 绿

## ODS 也开口说默认字体：同一层在 `styles.xml` 的另一处住址（v0.61）

v0.57 与 v0.60 都记了同一条未勾项：`default_font_of` 只走 xlsx 一路，`.ods` 在 `xlsx.rs` 的分流里**硬交回 `None`**，
后果写得很清楚——**正文与页眉的底数在 ODS 件上恒为兜底那 11pt**，文件说什么都不算。本轮接的就是这一条，
而且它动的是纸：v0.60 那一轮只做「字节里的保真往返」，这一轮同一层在 `.ods` 上是**消费端早就接好的活口**
（v0.57 的页眉底数 + v0.59 的 `--oof-print-base-size`），所以 Rust 读侧通上以后前端一个字都不用改，纸上的数当场跟着文件走。

- **这一层在 ODF 的真位置与形状都不同于 OOXML**：OOXML 在 `xl/styles.xml` 的 `cellXfs[0]@fontId → fonts[i]`（**按索引**找），
  ODF 在 `styles.xml` 的 `<style:default-style style:family="table-cell">` 里那条 `<style:text-properties>`；
  更宽的差别是**表达方式**——ODF 靠**样式继承链**（我们写出的格级自动样式都以 `Default` 为父，父层说过的字族字号不必再种一遍），
  而 OOXML 得在写侧手工 `seed_font`（v0.58），所以 ODS 这一路**没有**「同一档不重复声明」那笔账要算
- **只认 `table-cell` 那一支，而且只从 `text-properties` 取**：判别例把同一份字号分别写在 `family="text"` 那支、
  具名 `<style:style style:name="Default">` 那一层、以及兄弟元素 `<style:table-cell-properties>` 上——三处都**不算**工作簿默认字体
  （同文件里 `table-row`/`table-column` 两支管的是缺省行高与列宽，是另一层，本轮不接、进路线图）；
  两条字族属性 `style:font-name` / `fo:font-family` 取一（与格级同一顺序），**这一层照旧不归一化**（v0.57 那条规矩：
  格级丢掉 Calibri/等线 是为了别把通用档当真名，而在这一层抹掉就等于换字族），磅字面 `odf_font_pt` **直取不换算**（过一趟
  `odf_len_to_px` 就在字节上漂一档，只有真不是 pt 的那一档才走换算），0／负数不在读点拦、由唯一消费点 `baseFontPt` 兜回 11
- **分流只改一行，纸就动了**：`xlsx.rs` 那条三元把 `.ods` 从 `(…, None)` 换成 `read_ods_styles(&path)` 的真返回值，
  载荷 → `payload.defaultFont` → `baseFontPt` 那一段是 v0.57/v0.59 已有的路；量出来的正是「没动前端也照样上纸」：
  `--oof-print-base-size` 从 14.67px（文件没说话 ⇒ 兜底 11pt）变 **18.67px**（文件说 14pt），
  同一格 `88.5` 在两件上的**纸上字高比 1.2727 ≈ 14/11**（比的是同一引擎的两件产物，不是跨产品的绝对字高）
- **写侧按「没声明就不写这一层」办**：`default_style_xml` 只在载荷真说话时产出 `<style:default-style style:family="table-cell">`
  一条，位置有讲究（ODF 的 `office:styles` 里 default-style 排在具名 style **之前**），字号落 `fo:font-size="{fs}pt"`、
  字族双属性照格级同一写法；载荷没说就整层缺席——实测我们 app 自己存的那份里 `default-style` **恰一枚**，
  而那份没说话的件里 **零枚**（v0.58 那条「不许盖章」在 ODS 这一路同样立着）
- **第三方对照本轮缺位，这是范围而不是疏忽**：本机没有 LibreOffice/OpenOffice/pandoc/odfpy/ezodf，Excel 16.0 打不开 `.ods`，
  七个 ODF 规格 URL 变体（.rnc/.rng/.xsd）从本机全 404 ⇒ 四腿改成 `cargo test` / CDP 真机冒烟 / **独立读字节**
  （python `zipfile` 直读我们 app 存的那份，不经自家读侧）/ 编译，前端零改动故无结构腿（先例 v0.58）；
  「我们写的这一层别的 ODF 应用认不认」这句本轮**没有证**，已开进路线图
- **量具自己栽的两处，都不是产品**：(a) 手写夹具的布尔格用了 `office:value="true"` 而 ODF 真用的是
  `office:boolean-value` ⇒ calamine 报 `Parse float error: invalid float literal`、整个件打不开，
  状态栏那句错误看着像读侧坏了，其实是夹具不合规（我们写侧本来就写 `office:boolean-value`）；
  (b) 新增的那枚 quick-xml 循环漏了 `Event::Eof => break` ⇒ quick-xml 到文件尾**继续返回 `Ok(Eof)`** 而不是报错，
  测试二进制空转 **5.5 小时、烧掉 18 万核秒**，现场看起来和「cargo 锁被别的项目占着」一模一样；
  分辨办法是**看有没有 rustc 子进程**：没有子进程而测试 exe 在烧 CPU，就是死循环不是锁（仓库里其余二十处 reader 循环都带这条 break，本轮是唯一的漏网）
- **验证**：`cargo test --lib` **91 通过 / 0 失败 / 11 ignored**（三枚新例：只认 `table-cell` 那一支的十三档判别、
  这一层落进 `styles.xml` 且存两次都回得来、载荷没说话时整层缺席），另加**两处变异检查**证明假例真会打 FAIL
  （把 `family` 那道门换成「任何支都认」⇒ 判别例当场 FAIL；把 `default_style_xml` 换成空串⇒ 往返例 FAIL）；
  **CDP 真机冒烟 12 断言 / 真失败 0、页面异常 0 条**（两件各开：侧通道交回什么 → 底数 px → 导 PDF 量字高比 →
  污染序（文档导出夹在两次表格导出之间）→ 存盘 + 重开 → 第二次存盘还在）；**独立读字节腿**：`default-style` 枚数 1/0、
  `fo:font-size="14pt"` 在、mimetype 仍旧首条 STORED、四条目序不变；+ tsc 与 build 绿

## ODS 的批注与超链接也双向了：这一层长在格子自己身上（v0.62）

v0.48 那一条账目（`ODS 暂不含批注与超链接`）从写下那天起就是**读侧与写侧都空着**的实话，
而那一轮建好的三层——载荷类型（`CellNotePayload`/`CellLinkPayload`）、`xlsx_cell_side::{SideRead, SheetSide}`
的装配形状、Univer 那两枚侧通道（批注走 `resources` 的 `SHEET_NOTE_PLUGIN`、链接走每格的 `p.body.customRanges`）
——**一个字都不提格式**。所以本轮的形状是「Rust 两头一通 + 前端撤下两行」，界面、纸面、桥都是现成的。

- **住址与 xlsx 那头正相反**：xlsx 的批注住 `xl/comments1.xml`（作者表是同一件开头的 `<authors>`）、
  讨论串住 `threadedComments/*.xml` 加 `persons/person.xml`、气泡尺寸住 `vmlDrawing`、外部地址住该表的 rels
  ——**几件部件要按表名对回来**；ODF 里这两样**都是格子的孩子**（`<office:annotation>` 与格内文本外层的
  `<text:a>`），一趟 `content.xml` 扫描就收齐，交回同一枚 `SideRead` ⇒ 装配侧不必知道格式（`xlsx.rs` 那条分流多一个 `.ods` 分支）
- **`<office:annotation>` 必须排在同一格的正文之前**（ODF §9.1.4 的子元素定序）：写侧的两个发射点都是
  `annotation_xml(...) + text_p_xml(...)` 这个顺序，规格腿拿一条**把批注搬到正文之后**的假例当场 INVALID 证明了这条判据不是摆设；
  读侧不假设顺序（按事件流收，`in_annot` 关掉后 `text:p` 的正文不会串进气泡）
- **落不准的一律不硬派**（这是本轮读侧的主体）：被合并区盖住的格（`covered-table-cell`）与一次重复多列的格
  （`number-columns-repeated ≠ 1`）都说不准这两样属于哪一格，于是**不收进来、只记一条账**；
  同一格第二条链接「只收第一条」并报出实际条数；`xlink:href` 没写就是「没写它指向哪儿」；
  既不像内部地址（§9.2.1 的 `#表名.格`）又不带 RFC-3986 scheme 的那一档报「位置认不出来」——
  **不硬派成一条点不开的死链**；`dc:date`/`creator-initials` 只当元数据邻居（`in_meta` 那道门），不混进气泡正文；
  空气泡不收成界面上一枚点开没东西的标记；表名要 `unesc`（和 calamine 那一头的名字对得上才接得进 `by_sheet`）
- **写侧照旧「没声明就不写这一层」**：`office:display` 只在真说了 `true` 时落笔（缺席与 `false` 同一档，与读侧同一分寸）、
  气泡尺寸只在载荷给了那味时写（`px→cm` **单位必带**，128px ⇒ `3.3867cm`——`svg:width="128"` 那条假例当场 INVALID，
  ODF 的 `length` 不带单位就是不合规）、作者为空就不写 `dc:creator`；连**命名空间都按需声明**
  （`used_namespaces` 扫载荷决定根元素带不带 `xmlns:dc`/`xmlns:svg`/`xmlns:xlink`——没用到的不进字节）
- **内部地址的换算在这一头也有**：载荷的 `location`「表名!A1」折成 `#表名.格`，没写表名的用本表补齐；
  表名含空格/点/单引号要按 §9.2.1 裹 `'…'` 且 `''` 才是引号本身（`odf_table_ref`）；`<text:a>` 必带 `xlink:type="simple"`，
  `office:title` 是悬停提示（对应 xlsx 那头的 `tooltip`）
- **只有真机能教的三条，全是量具先找错了地方**：批注在快照里住 `resources` 里名为 **`SHEET_NOTE_PLUGIN`** 的那一条
  （不是 `note`）；内部链接 Univer 记的是 **`#gid=<表 id>&range=B1`** 而不是 `#表名.格`，于是「表名对不对」得问
  `sheets[id].name`——**`sheetOrder` 交回的是 id 不是名字**；这两条各制造过一次「看着像产品没接线」的假失败
- **一条本轮量到的已知代价，钉成断言而不是当缺陷修掉**：链接挂在**数字格**上会把那一格读回成**文本**
  （`office:value-type` 由 float 变 string、`office:value="40"` 不见了），因为 Univer 的链接格吃的是 `p.body`（富文本）而不是 `v`，
  **这座桥与文件格式无关、xlsx 同形状**；同一趟里其余数字格（`10`／`25.5`）仍是 float，所以说的是「那一格」不是「那一片」
- **规格腿（本轮新增的第五条腿）量出的三枚历史遗留属性名**：整件 `content.xml`（除样式层）与逐枚格子都合 ODF 1.2 语法，
  而**样式层本轮件与 v0.61 对照件同判 INVALID** ⇒ 本轮没新增不合规，但那三枚属性名是早先留下的：
  `style:align` 该落 `<style:paragraph-properties fo:text-align>`、`style:cell-wrapping` 该是 `fo:wrap-option`、
  `table:use-optimal-row-height` 该是 `style:use-optimal-row-height`（各造一件、逐枚判出来的）；
  顺手改口 v0.61 那句「`default-style` 必须排在具名 style 之前」——那是**应用惯例**，RelaxNG 并不强制这一条
- **幂等与非空断言**：两次存盘的 `content.xml` **逐字相同**（既没盖章也没丢），条目序与 `mimetype` 首条 STORED 不变；
  `default-style` 那一枚的判据写法本轮纠了一次——「应当为零」在这种自带数据的件上是**反过来的空断言**
  （夹具根本没说这一层），正确说法是**与夹具同数**（0 枚 / 0 枚）
- **前端只撤两行**（`hasSide` 与那句账目），另三句 ODS 账（图表／三类规则／页面设置）与 CSV 那句照旧立着；
  **第三方 Office 腿本轮仍缺位**（本机无 LibreOffice/OpenOffice，Excel 16.0 打不开 `.ods`），
  「别的应用认不认我们写的 annotation」与 v0.61 那条同源，挂在路线图
- **验证（五腿 + 编译）**：`cargo test --lib` **94 通过 / 0 失败 / 11 ignored**（四枚新例：别人写的件里读回（含七处各一条账的判别）、
  我们写的落进 `content.xml` 且读回、载荷没说话时这一整层缺席、摆不进的形状各记一条账）+ **两处变异检查**证明假例真会打 FAIL；
  **前端结构测试 16 断言 / 真失败 0**（撤下的那两句必须撤干净、`.ods` 分流那一行与写侧两个发射点的成对形状都在判据里）；
  **CDP 真机冒烟 17 断言 / 真失败 0、页面异常 0 条**（批注与三种链接形状进界面 → 存盘 → 重开 → 原样还在 → 状态栏不再报那一句）；
  **独立读字节腿 27 断言 / 真失败 0**；**RelaxNG 规格腿 26 断言 / 真失败 0**（三条假例 INVALID）；+ tsc 与 build 绿

## 写侧也有账了：ODS 那一趟摆不下的批注与链接说得出地址（v0.63）

v0.62 收尾时自己记下的那笔账是本轮的起点——「`write_ods_sync` 只回 `Result`、写侧没有回写账目通道 ⇒
现在是**读侧有账、写侧无账**」。那一轮把批注与链接双向通了，却被留下一整类静默：界面上报「已保存」，
文件里少了东西，而少了哪几枚、为什么少，一个字都不说。本轮动的就是这半截，而形状几乎不用新搭：**xlsx 那头 v0.46 起就有一条
accounts 通道**（`Vec<String>` → `invoke<string[]>` → `writeNotes` → `[...lost, ...writeNotes]` → 状态栏
`已保存（第一条，另有 N 条说明）`），本轮把同一条契约接到 ODS 这一路，前端只动两行。

- **判据只有一批，三处共用**：`note_writable`（正文不为空）／`link_writable`（`odf_href` 给得出目标）／
  `cell_covered`（落在合并区里被盖住的那一格）合成 `note_written`/`link_written`，同时被**格子渲染**
  （`note_at`/`link_at` 的取样点）、**`used_namespaces`**、**`ods_side_accounts`** 三处读取——各写各的判据
  就会有一种状态是「账上说没写、字节里却写了」（或反过来），共用之后「报的账」与「字节里少掉的那几枚」
  与「命名空间声明」是同一批，这是本轮唯一的架构决定
- **本轮新立的一条：命名空间只为真会落笔的属性服务**（`bubble_dim`）：气泡尺寸说 0／负数／NaN 时
  `px_to_odf_len` 根本写不出成立的 `svg:length`，于是那一味不写，**`xmlns:svg` 也跟着缺席**——
  为一条根本不出现的属性声明命名空间就是白盖一枚戳（v0.62 的「按需声明」在本轮多算了这一步，
  是复查发射点时发现的静默不忠实，不是新加的形态）
- **账目的顺序有说法**：先批注后链接、各按载荷里的条目序，「同格多条」那两条记在最后——同一份载荷两次存盘
  报出**逐字相同**的一批账（幂等判据里既比字节也比账）
- **规格腿把「账的依据」分成了两档，这是本轮最要紧的一条诚实区分**：
  ① **文法逼的**（RelaxNG 当场 INVALID）——同一格第二枚 `office:annotation`（`table-table-cell-content`
  只给**一枚** optional）、`<text:a>` 少了 `xlink:href`、批注排在正文之后、气泡尺寸不带单位；
  ② **语义与约定逼的**——把批注、正文、链接分别塞进 `covered-table-cell`，**三档 RelaxNG 全部放行**
  （本轮逐枚量出来），所以那句「ODF 在那里没有批注通道」说的不是文法而是规格正文的语义
  （那一格的内容属于锚格）加上我们读侧的归因分寸；同理「同一格两条链接只写第一条」是**约定**
  （Univer 与 Excel 都一格一条），不是文法强制——文案里两者都说得出地址与后果，但**依据不同，本轮把这一条写进判据注释**
- **真机上这条通道真有活干，不是理论上摆不下的形状**：CDP 那一路量到 Univer **当场就允许**
  「先给 B6 建批注、再把 A6:B7 合并」，批注留在被盖住的那一格里 → 保存 → 状态栏报出
  「第 6 行第 2 列的批注落在合并区里被盖住的那一格，ODF 在那里没有批注通道，未写入」，**再存一次还说得出**
  （不是一次性提示）；同件的锚格那枚与没被盖住的正控制那枚照旧进得了文件 ⇒ 少的只因「被盖住」；
  干净件（什么都摆得下）的状态栏就只说「已保存」，不许凭空记账
- **量具自己的一课**：门面那枚 `createOrUpdateNote` 吃的是 **`ISheetNote` 对象**（`{note,width,height,show}`），
  传字符串会被 Univer 摊成按字符下标的键，而我们的侧通道只认 `note` 是字符串那一档 ⇒ 界面新建的批注读不到，
  看着像产品没接线，其实是脚本写错
- **四条变异检查（+ 两条正控制）证明判据会响**：字节里多塞一枚气泡 ⇒ 数枚数／「载荷减账等于字节」／
  「未写入的正文不在字节里」／「用到的前缀都声明了」四条一起响；账目里少报一条 ⇒ 只有账目那两枚响而
  **字节枚数那枚照旧绿**（分得清「账错」与「字节错」）；多声明一枚用不到的 `xmlns:dc` ⇒ 「声明了却没用」响；
  把**真件**里的气泡搬到正文之后 ⇒ 规格腿「整件合 ODF 1.2 语法」与「锚格逐枚」当场 INVALID
  （这一档补的是"真件那一档也有牙"，此前整件 VALID 只由假例自证）
- **验证（五腿 + 变异 + 编译）**：`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（三枚新例：
  六条摆不下的形状逐条对上字面、载荷没说话时一条账都不记、命名空间跟着字节而不是跟着载荷）；
  **前端结构测试 28 断言 / 真失败 0**（`writeOds` 带回账这一行必须真接上，四条拆掉接线的假例各打 FAIL 且副作用面说清）；
  **CDP 真机冒烟 28 断言 / 真失败 0、页面异常 0 条**；**独立读字节腿 40 断言 / 真失败 0**；
  **规格腿 20 断言 / 真失败 0**；**变异检查 16 断言 / 真失败 0**；+ tsc 与 build 绿
- **本轮没动的**：读侧那三条「落不准」的账照旧（图表／三类规则／页面设置），xlsx 那头的「同格多条」是否记同一条账
  本轮**没核查**（只说 ODS 这一头），第三方 ODF 应用仍缺位（本机无 LibreOffice/OpenOffice，Excel 16.0 打不开 `.ods`），
  新开的未勾项见路线图

## 失败也说人话：用户可见的每一个出口归成中文一句，原话退到悬停里（v0.64）

本轮**不加功能**，动的是"失败的时候它怎么说"。此前几十轮把读侧写侧都通了账，而用户真撞上失败时看到的仍是
第三方库的原串——`无法打开文件: Xls error: Cfb error: Invalid OLE (17 bytes is too small, signature D6 07... invalid,
not an office document?)`、`Can't find end of central directory : is this a zip file ? ...`。这些话对我们等于答案，
对用户等于噪音。起点是那条支配本轮的判断：「把已经做的功能做易用」——而**报不出原因的失败是最贵的一类不易用**：
用户会照着"文件坏了"去重做一遍，而真原因只是"后缀被手动改过"。

- **本轮唯一的架构决定：一条字符串带两行，而不是给四个编辑器各加一份状态**。`failStatus` 交出
  `加载失败: {中文一句}\n{原话}`，渲染点用 `statusText` 取可见那一行、`statusTip` 取换行后那一段（`title`）。
  之所以要塞进同一枚字符串：状态栏本来就只有 `status` 一维，为"悬停能看原话"再各加一份状态，
  就多出一条**"文字说 A 而悬停出 B"的新分叉**——这一类分叉在前几轮是被当缺陷修的，不是新加的选项
- **归因表 11 条，按"具体在前"排**：先按第三方库的专属词形命中（calamine / rust zip / JSZip / cfb / pdf.js /
  `JSON.parse`），落到后面的才是 `os error N` 这类通用尾巴；`probeOf` 把 `Error` 的 **`name` 也拼进匹配串**
  （pdf.js 那类只靠 `name` 分类的档才有得匹配），且整串转小写（`Could not find EOCD` 与大写同判）。
  两条纪律都不是本轮新立的：**文案只写在这一处**（先例 v0.54「纸上账目的文案只写一处」——四个编辑器与首页只调
  `failText`/`failDialog`/`failStatus`，否则同一件事在表格上叫「被占用」、在文档上叫「拒绝访问」就分叉了）、
  **认不出来的原样带出，不编原因**（先例 v0.45 的更新通道：猜错原因比不说更糟，用户会照着不存在的理由去折腾）
- **前置实测改掉了当初设想的两条**（判据表里每一条命中的都是**真机上量出来的原串**，不是按"通常长这样"写的）：
  ① Windows 那一层**本机已经是中文**——`拒绝访问。 (os error 5)`、`另一个程序正在使用此文件，进程无法访问。 (os error 32)`、
  `系统找不到指定的文件。 (os error 2)`，所以真正看不懂的只有括号前那截第三方库的话；
  ② **路径过长报的是 `os error 3`**（"系统找不到指定的路径"）而不是专门的"文件名太长"，
  于是那一句话必须把"太长"也带上（Windows 一般限 260 字符）——只说"目录不存在"会把人引去建目录
- **三种不同的失败不能挤成一句话**，这一条钉成判据：`os error 32`（被别的程序开着，关掉那边再存）与 `os error 5`
  （没权限／只读／那本来是个文件夹）分两档，`os error 2` 与 `3` 分两档，EOCD 与 `Cfb error` 分两档，
  pdf.js 的"结构读不出"与"设了口令"分两档（后者要说的是**我们的查看器还没有输密码的地方**，不是文件坏了
  ——这一句到 v0.65 起过时了：那一档的原话如今由密码面板替用户拦住，`fail-msg.ts` 里那条判据跟着改口，见下一节）
- **干净文案一条都不归因**：归因表不许变成"看谁都想解释一番"的说明书——`已保存`、`已复制 3 行`这类没有失败的
  字符串走 `describeFailure` 只能得到 `known: false`，于是 `failStatus` 不拼中文、`failDialog` 不重复原话
  （同一段话出现两次只会让人以为有两个不同的原因）。结构腿 D 段判的就是这一条
- **PDF 那三处后台副作用本轮才开始说话**（页尺寸预读／大纲／标注导入）：它们从前只 `console.error`，
  于是侧栏空着而用户不知道为什么空。新立的 `isTeardown` 把"**Transport destroyed**"（用户已经把这页关掉了 ⇒ 不入账）
  与"文件真的读不出"（要说）分开——不分就会在每次快速关标签时冒出一句凭空的失败。
  同一条分寸用在别处：`failStatus` 的 `prefix` 交调用方给（`页尺寸读取失败`/`大纲读取失败`/`标注读取失败`/`渲染失败`），
  归因说的是**原因**而**地点由调用方说**，这样表格里不必为四个场景各写一句
- **页面级操作的失败那一句不定时清除**：`pageOp` 原来在 `finally` 里一律 `setTimeout(setStatus(''), 3000)`，
  于是失败文案也三秒就没了——**三秒后抹掉等于让用户读不完，也悬停不到原话**（原话才是提 issue 时唯一能贴给我们的东西）。
  现在成功那一路清、失败那一路留着；`PptEditor` 的加载占位（它有两处分身）与四个编辑器的状态栏同一套拆行
- **覆盖的出口（28 处）**：四个编辑器 21 处（加载 4、保存与导出 9、插图与插图表 2、规则还原上状态栏那一句 1、
  PDF 那一头 5＝渲染 + 三处后台补做 + 页面级操作那一条被四个标签名共用）+ 首页同步导入导出 2 句 +
  `ole` 嵌入体解不开 2 句 + `sheet-rules` 三类规则还原 3 句；`App.tsx` 另加一枚 dev 钩子 `__oofFail(cmd, args)`，
  让冒烟脚本能原样发起一次命令调用、拿回**用户会看到的那串话**（本轮判据不吃我们自己的读侧，只吃 DOM 上真渲染出来的那一行）
- **真机腿量到的都是只有真机能教的**（51 断言，全落在 DOM 的 `textContent` + `title` 这一对上）：
  十件坏件各读出中文一句、悬停里原话还在、可见那一行既没有换行也没有英文尾巴；写侧两档（只读文件的 `os error 5`
  与 PowerShell 拿独占句柄占住的 `os error 32`）先按路径找回标签、用 `runOp([1],'rotate')` 走真按钮同一条 `opRotate`，
  再判 3.8 秒后那句**还在**；两条对照件（干净件与好表）判"不许凭空记账"；**原生对话框这一轮第一次成为判据而不是打印**——
  标题为「保存失败」的窗口按 `EnumWindows` 数得出（`Get-Process MainWindowTitle` 里根本没有它），
  且**不阻塞 CDP**（对话框立着的时候 `1+1` 照样回 2）
- **量具自己栽的四次，每一次都像产品坏了**：① 编辑器挂载前的占位与加载中的初始 status **都是**「正在加载…」，
  按"状态栏有字"判"读完了"会在第一拍返回，十枚坏件全读到占位文案（本轮第一版就这么假失败了一整轮）；
  ② `__oofSheetByTab` 是 `??=` 的字典、关掉标签不删条目，只数键长会把上一轮的残留当成读完了 ⇒ 表格按**当前标签 id** 取；
  ③ **vite 会发一份陈旧的 transform 模块**——改完 `SheetEditor.tsx` 后页面里那份还是旧的（有 `failStatus`、没有 `statusText`），
  6 条失败看着像接线没做，其实是缓存（`touch` + `Page.reload(ignoreCache)` 才回得来）；
  这一趟反过来成为一条**没计划到的变异检查**：它造出的正是这条腿要找的失败签名（可见行带 `\n`、悬停为空）；
  ④ 原生对话框**关不掉**（SendKeys 与 `AppActivate` 静默无效），要靠 `PostMessage(WM_CLOSE)` 按 hwnd 发，
  且判据改成按**计数增量**写——本机可能被上一轮留下同标题窗口
- **变异检查证明归因表会响**（结构腿 81 断言里的一条条假例）：拆掉四个编辑器的拆行接线各打 FAIL 且副作用面说清、
  首页退回裸串打 2 条、另两处账目退回裸串打 2 条、把判据表抄一份到调用方打 1 条、抹掉 `isTeardown` 那道门打 1 条
- **验证（四腿 + 编译）**：**前端结构测试 81 断言 / 真失败 0**；**CDP 真机冒烟 51 断言 / 真失败 0、页面异常 0 条**；
  `cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63 同一份基线——**Rust 本轮一个字没动**，
  本轮全在前端那一层）；+ tsc 与 `pnpm build` 绿（2.37s）——四腿都在**版本号 bump 之后**复跑过一遍
  （`Cargo.toml`/`tauri.conf.json` 一动就重启 app，复跑真机腿是这一条老规矩）
- **本轮没动的，量出来记着**：只测了本机**中文** OS 的消息，英文/其他语言机器上 `os error` 括号前那截会是英文
  （判据靠编号，不受影响，但"原话是否已经可读"这一条没覆盖）；写侧三种前缀不统一（`保存失败`/`ODS 写入失败`/`无法写入`）；
  PDF 设了口令这件事现在只**说得出**、还没有输密码的入口（v0.65 接上了，见下一节）；toast 体系未建（失败仍寄生在状态栏这一枚字符串上）

## 加密的 PDF 也打得开了：这一句"要密码"终于交回用户按键（v0.65）

v0.64 收尾时自己记下的那条未勾项是本轮起点——归因表里那句「设了口令，而我们的查看器还没有输密码的地方」
说实话说得很好，但用户对着它什么也做不了。形状早就是现成的：pdf.js 从 v0.12 接进来那天起就有 `password` 这条通道，
只是我们从来没接；这一轮**Rust 一个字没动**（先例 v0.64），全部长度在前端那一层，而本轮最值钱的产出不是面板，
是被这台量具当场撞出来的一处真缺陷（见下面第 4 条）。

- **通道的形状只有一处容易装错，而装错的表现是"永远打不开"**：`openTask.onPassword = (updatePassword, code) => …`
  必须装在 `getDocument(...)` **之后**、`await openTask.promise` **之前**——那份承诺一旦拒绝就没有第二次机会，
  回调再装也来不及；`code` 实测只有两档（`1` 要密码 / `2` 密码不对，`PasswordResponses` 没有第三档，
  未知档一律按"要密码"说，不许凭编号编出新理由）。**pdf.js 自己不封顶**：答错一次它就再问一次，可以一直问下去，
  于是"试了几回"这件事只有界面说得出口——面板从第二回起把已经试过几次明说（`已经试过 N 次`），
  因为界面上不说的话用户就没有退出的依据
- **判据与文案只写一处**（`src/lib/pdf-password.ts`，照 v0.54 纸上账目与 v0.64 失败归因的先例）：
  `pwdReason(code)` 把两档 code 收成 `'need' | 'incorrect'`，`pwdPromptText`/`pwdCancelledText`/`PWD_MEMORY_NOTE`
  是这四句话的唯一持有者，面板与状态栏都不自带句子（结构腿 A10 扫的是**剥掉注释之后**的源文，
  注释里引述一句不算第二份文案）；`submitPwd` 里空串不当密码用——喂进去只换来一次重新提问，白耗一轮
- **"用户自己取消"与"压根没给密码"在错误内容上分不出来**：我们那串 `Error` 的 `name`/`message` 到不了归因层，
  所以"是用户按的取消"只能由界面自己记着（`pwdCancelledRef`），而记的方式是**在按下去之前**记下这件事；
  那一行的去处也跟着分岔——不带"失败"前缀（没有失败，只是没往下走），也不挂原始信息
  （那一句是我们自己按下去的，不是文件报的，挂上去就是把用户引去提一张不存在的 issue）
- **本轮的真缺陷：作废的那一趟把还活着的面板抹掉了**。开发模式下 `React.StrictMode` 会把挂载效应跑两遍
  （挂 → 清 → 再挂），于是同时存在两趟 `getDocument`；被换掉的那一趟自己按过 `Error` 下去，
  它的 `catch` 却照样执行 `setPwdAsk(null)` + `pwdUpdateRef.current = null`——**晚一步落地的话，
  它把还活着的那一趟刚亮起来的密码面板抹掉**，pdf.js 从此等不到回话，界面卡在「正在加载…」上且没有任何错误。
  修法是一条规矩而不是一处补丁：**「这一趟已经作废」那道门必须打在写任何共享状态之前，而不是打在最后一句上**；
  本轮把撞到的两处写点补了（catch 头部、`rangeModeRef` 赋值前），各钉一枚判据（C17/C18）+ 一枚变异（M8/M9）。
  顺带一条给下一轮动这块的人：**开发模式的双挂载不是噪音，它是一台免费的并发测试机**
  ——而 `disposed` 那道门现在只补在这两处，其余 `setState`/ref 写入仍是"最后一句挂个 `!disposed`"的形状（进路线图）
- **"能看"与"能改"之间有一条不是我们设的硬边界**：pdf-lib 1.17 不解密（`PDFDocument.load` 对加密件直接抛
  `EncryptedPDFError`，`ignoreEncryption` 只是"照样坏"）⇒ 标注写回与页面级操作在加密件上结构上做不到。
  这条本轮第一次成为界面里说得出的一句话：`pageOp` 第一步就是 `writeAnnosRef.current(path)`，所以点旋转
  当场报得出「设了密码的 PDF 只能看、不能在这里改」，原话仍完整留在悬停里（P24/P25 判的是**立刻**报得出——
  专门的探针量到 `runOp` 0.0 秒返回、那句之后 12 秒还在，也就是说上一轮那条"卡住"的感觉是冒烟腿自己的墙上时钟，不是产品）
- **密码只留在这次会话里**这条诚实边界是本轮新立的，而"没落盘"这种断言必须自带正控制：独立字节腿（E1–E11）
  先证明**同一个地方**扫得到最近文件路径的尾部串（E9：两枚 leveldb `.log` 命中 ⇒ 扫对了地方），
  再判那串密码在**全部 68 个被扫文件**里都不出现（E10），另判产品源码里不出现（E11）；
  这里有一条只有本机量得到的教训：Chromium 存 `localStorage` 的**值按 UTF-16 存**，
  按 ASCII 字节串扫leveldb 会一无所获——第一版 E9 就是这么"证明"了全场干净（假绿），
  改成 ASCII 与 UTF-16LE 两份编码一起扫之后正控制当场命中
- **字节层的四条实测**（E1–E5）：AES-128 → `/CF … AESV2`、AES-256 → `AESV3`、owner-only 同样带 `/Encrypt`，
  而 **RC4-128 那一档字节里根本不写算法名**（只有 `/Filter/Standard`+`/R 3`+`/V 2`+`/Length 128`，没有 `/CF`/`/CFM`）
  ⇒ 判据只能按 `/R`+`/V` 编号推出，E3 一开始按字面 `RC4` 判是一枚**永远不可能成立**的空判；
  另一条是门槛本身：`RANGE_MIN_BYTES = 4MB` 被真件夹住了（分段件 5,939,515 上、2,782,745 下，E4），
  于是"密码闸门"与"分段模式"这两件事必须能同时成立——真机那头的 P27/P28/P29 判的就是这一档
  （分段件输对密码照样开得完，且开完不留一枚空转的面板）
- **只有真机能教的几条**（29 断言）：干净件**不许**长出面板（P1/P2，问都没问过就不该问）；输入框必须是
  `type=password`（P7）且密码本身不回显在界面上（P13）；取消之后那份文档**不许**留在页面上（P18）；
  工具栏「重试」是**从第 1 回重新数起**而不是接着上一轮的计数（P20 量到 `{reason:"need",attempt:1}`），
  并且要把取消标记一起清掉（P21）——不清的话重试成功后第一次真失败会被归成"用户自己取消的"；
  owner-only 那一件**不问密码**就能看（用户口令为空），这一档如果按"有没有 `/Encrypt`"来判要不要问，就会凭空拦用户一道
- **量具自己踩的三处，每一次都像产品坏了**：① CDP 整腿在 `timeout 420` 下会**静默截断**——那枚 5.9MB 的分段件
  把腿拖长，输出停在 P23 而没有 traceback，看着像脚本死掉其实是墙上时钟到点（放到 1200 就是 29/0）；
  ② `cargo test --lib` 必须在 `src-tauri/` 下跑，仓库根没有 Cargo.toml，那句 `could not find Cargo.toml` + EXIT=101
  与"工具链坏了"长得一模一样；③ 判据 C17 第一次是自打 FAIL——因为**注释里正好写着 `setPwdAsk(null)` 这个字面**，
  按 `indexOf` 排前后就把注释当成了代码；判据吃的必须是剥掉注释的源文，这是"吃用户看得见的那一行"那条规矩在文本层的第二次兑现
- **本轮没动的，量出来记着**（都已开进路线图）：密码只在这一次会话里有效，重开同一件还要再输一遍，
  也没有"这次会话记住"的选项（不是我们偷懒：pdf-lib 不解密，也就没有把密码交进写侧的通道）；
  同一件 owner-only 的文件在两头说的话不一致（不问密码就能看 vs rotate 报"它设了密码"），
  「权限限制」与「口令限制」也没分；`disposed` 那道门只补在本轮撞到的两处；RC4-128 字节里没有算法名
  ⇒ 归因表在这一档说不出算法名；失败提示仍旧寄生在状态栏那一枚字符串上（toast 体系未建）
- **验证（五腿 + 编译）**：**前端结构测试 43 断言 / 真失败 0**；**变异检查 10 断言 / BAD 0**（正控制先跑一遍 43/0，
  九枚假例各自点名该响的那几条，M8/M9 是本轮新加的两枚）；**CDP 真机冒烟 29 断言 / 真失败 0、页面异常 0 条**；
  **独立读字节腿 21 断言 / 真失败 0**；`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63/0.64 同一份基线——
  **Rust 本轮一个字没动**）；+ tsc 与 `pnpm build` 绿（2.63s）——四腿都在**版本号 bump 之后**复跑过一遍
  （`Cargo.toml`/`tauri.conf.json` 一动就重启 app，复跑真机腿是这一条老规矩）

## 等的时候要说真话：PDF 全文搜索边扫边说，「无匹配」只有扫完全程才配说（v0.66）

本轮是性能轮，而性能轮的第一件事是**量**：三条热路径各花在哪、哪一条值得动、哪一条动不了。量完之后
交付的不是"快了多少毫秒"，而是**等待期间界面说的那句话现在是真的**——旧的形状里 700 页的件从零扫一遍
要 1.9~2.4s，而这一段里界面只说话一次（扫完才 `setMatches`），于是这一两秒内计数那一格写的是「无匹配」。
那不是"没有"，那是"还没扫到"，而用户照这句话换一个词再等两秒。**这一轮 Rust 一个字没动**（先例 v0.64/v0.65），
全部长度在前端那一层。

- **量到的三份账**（全部是 dev/debug 构建、真机 :9222、`tmp/x66/fix` 的夹具）：
  ① PDF 全文搜索冷扫 700 页 = **1893ms / 2218ms**（同一趟两次数），而不存在的串扫满全程 = 2292ms；
  分段拆开看 `parts = {pages:700, low:5, idxRaw:0, idxLow:0}` ⇒ **每页 `toLowerCase`+`indexOf` 全场只花 5 毫秒**，
  `awaits(700) = 0ms`，钱全在 pdf.js 那头逐页 `getTextContent` 的往返上；同一件热缓存重扫 = **234ms**（≈200ms 防抖 + 30ms）；
  ② 表格 20000 行 × 8 列的件（`big20k.xlsx`，13MB）dev 数 `shell 4 / read 4315 / toUniver 4363 / createWb 4449`、
  存盘 `write 3726` ⇒ 首开的 86% 与存盘的 98% 都在 Rust+IPC 那一侧；
  ③ 但**同一批 Rust 计时在 `cargo test --release` 里**是 `read_xlsx_sync` **307ms**、`write_xlsx_sync` **205ms**
  （`open_workbook_auto` 4.8ms、styles 91ms）⇒ **dev 那 4.3s/3.7s 是 debug profile 的产物，不许写成用户可感的缺陷**；
  release 的应用层（含 IPC 与前端）复测本轮没做，已进路线图
- **两条被数据否掉的优化，记下来是为了别再试**：**并行取页文本**做过头到尾的 A/B——并发 1/4/8/16 得到
  2879 / 2767 / 2174 / **1915**ms，只省 **1.3×**（pdf.js 的 worker 串行读页，前端排队排不出并行）；
  **把 500 条命中上限抬高**也不解决等待——本轮的量表上时间花在"扫"而不是"匹配"，抬高上限只会让全程更长。
  于是这一轮交付的是**诚实的反馈**，而不是一个假的加速数字
- **纯函数层只有一处**（新建 `src/lib/pdf-search.ts`，照 v0.54 纸上账目、v0.64 失败归因、v0.65 密码提示的先例）：
  `findCountText` 按顺序判四档（还在扫 → 先说扫到第几页；有命中 → 「第几条/共几条」，撞上限挂一个加号；
  扫完没命中 → 无匹配；查询串为空 → 空），`shouldPublish(now, lastAt, sinceHits, sincePages)` 是"什么时候肯把进度
  交出去"的唯一判据（新命中攒够 `SEARCH_PUBLISH_HITS=20` 就立刻交，否则按 `SEARCH_PROGRESS_MS=120` 的时间窗交，
  而 `sincePages === 0` 那一档拦住——**一页都没扫就不许交，否则空转也上屏**）；
  节流是被真机数定出来的：一趟全程界面说了 **20 句**（判据上下界 4..80），每页一句会把主线程点着，全程一句又回到旧形状
- **本轮的真缺陷由真机腿撞出来**：第一版冒烟在 P6/P14/P15 当场 FAIL——「无匹配」在打字之后 **~25ms** 就上了屏，
  也就是防抖那 200ms 里、`runSearch` 还没跑到第一页的那一刻，界面已经在报"没有"。这不是接线漏了一句，
  是**旧形状把"这一趟在扫"这件事交给了命中数**，而命中数在开始之前必然是零；修法是把那一位交给界面自己：
  查询一变化就 `{scanning:{scanned:0,total}}`（`scanned=0` 那一档只说「正在搜索…」，页号还没得说），
  并在**同一处**把上一词的命中与激活位清掉（不清就会拿旧词的"第 3 条"说新词的事）；钉成 B12/B13 + P6 + 一枚变异
- **v0.65 那条规矩在新循环上兑现**：作废门 `if (seq !== searchSeq.current || !aliveRef.current) return`
  打在 `const t = await loadPageText(d, n)` **之后**、写任何共享状态（`setMatches`/`setActiveIdx`/`setFindStatus`/
  `rangeModeRef`）**之前**（判据 B11 钉的就是这个前后顺序：打在 await 之前拦不住晚到的那一趟，打在最后一句上就晚了），
  收尾那一句同样先过门；`aliveRef` 在 setup 里置回 `true`，于是开发模式 `React.StrictMode` 的第二次挂载不被当成已卸载。
  真机 P19 量到换词 1.2s 起那一格的文本**零变化**（被作废的趟没能把界面抹回旧样子）
- **只有真机能教的几条**（22 断言）：打字之前**不许预扫**（P3，缓存里一页文本都没有——省下的那两秒不该提前花）；
  「无匹配」在整趟里**只出现一次**且和全程一样晚（P16/P17：≥1500ms，之前界面报的是进度不是"没有"）；
  页号单调不回退（P7，进度不是乱跳出来的）；热的那一趟收尾那句与冷的那一趟**逐字相同**（P14）；
  没撞上限不许挂加号（P12），而换成"满屏都是"的那个串就当场挂上（P18 的 `500+` ⇒ 剩下的没再扫，这话不能说满）；
  关掉再开搜索面板时查询串是空的 ⇒ 那一格也是空的（P21，既不留「正在搜索」也不留「无匹配」）
- **量具自己踩的四次，每一次都像产品坏了**：① **判据吃缓存枚数会造出假的"热"**——前一版用
  `textPages() >= total` 判"扫满了"，而这在 `t=0` 就成立，于是循环第一拍就返回，量到"热缓存 31ms"
  （一枚否定断言式的假绿）；换成"那句里不再带进度 + 非空 + 缓存已满"三条一起判，真数是 234ms；
  ② **被作废的那一趟停在门上（按页号退出，不是扫满）**，所以它跑完之后那枚标签的缓存**并不是全满**的——
  在它后面量"热"就会量到接近冷的数；热的那一趟必须挪到缓存可证已满的那一枚标签上量；
  ③ Chromium 的 `Log.entryAdded` **verbose recommendation**（首页口令框的 `input.sync-pass`）不是页面异常，
  第一版 P22 把它当成 3 条异常打 FAIL，按 `source`/`level` 滤掉之后是 0 条；④ 结构腿的**注释剥离器**自己坏了：
  一个反引号同时置 `str` 与 `tmpl`，而 `str` 分支只清 `str` ⇒ 状态反转，之后所有 `//` 都被当代码读，
  于是"PdfViewer 里没有第二份句子"那枚判据永远成立；修法是分开的两种串状态，并加一枚 **B0 自检**
  （"剥注释"这件事本身要有断言，这是 v0.65「判据吃的必须是剥掉注释的源文」那条教训的下一次兑现）
- **本轮没动的，量出来记着**（都已开进路线图）：搜索仍然**从第 1 页起扫**（没有"从当前页开始"这一档）；
  页文本缓存是跨查询共用的（热扫 234ms 就是它在工作），但**匹配本身不共用**——换一个词就要重新逐页 `indexOf` 一遍；
  冷扫 1.9s 的瓶颈在 pdf.js 逐页 `getTextContent`，
  而并行已经被数据否掉 ⇒ 真要提速得换形状（按需扫视口附近、增量扫后台续跑，或把文本层交给 Rust 侧一次算完），
  本轮没做也没有半句"我们优化了耗时"的话；页文本缓存**换标签就全丢**（没有按 path 的 LRU，重开同一件又从零扫）；
  命中上限 500 只说加号不说总数（用户不知道一共有多少）；`dev` 与 `release` 的数字必须分开记，
  而 release 的应用层复测还欠着（**这一条 v0.67 已还**：release 的分段账量完了，而量出来的那一处等待就是 v0.67
  要改的东西，见下一节）；失败提示仍旧寄生在状态栏那一枚字符串上（toast 体系未建，v0.64 那条未勾项照旧）
- **验证（五腿 + 编译）**：**前端结构测试 28 断言 / 真失败 0**（A1–A14 判纯函数四档文案与 `shouldPublish` 四档，
  B0 判剥离器自己，B1–B13 判接线：`findCountText` 是唯一入口、`PdfViewer` 里不许有「无匹配」「正在搜索」的字面、
  门排在 `await` 之后且先于 setState、setup 置回 `aliveRef`、进度与命中同交、重置块清进度、打字那一刻标 scanning）；
  **变异检查 10 项 / BAD 0**（正控制先跑一遍 28/0，九枚假例各自点名该响的那几条，
  其中 `no-gate` 连带打 B4+B5、`count-inline` 打 B1/B2/B3、`no-keystroke` 打 B12/B13，
  分得清"句子写了两份""门拆了""那一位没交"三类错法）；**CDP 真机冒烟 22 断言 / 真失败 0、页面异常 0 条**；
  `cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63/0.64/0.65 同一份基线——**Rust 本轮一个字没动**）；
  + tsc 与 `pnpm build` 绿（2.80s）——四腿都在**版本号 bump 之后**复跑过一遍（本轮另证：`textPages` 这枚 DEV 钩子
  从临时归因转正为常备观测量，因为"扫完全程"这件事只有它能硬判，而判据一次都没吃过自家 ref）

## 首开那一段的账：读件的 IPC 在外壳开标签那一刻就出门（v0.67）

本轮先还 v0.66 自己欠下的那笔账——「release 的应用层复测还欠着」——因为上一轮的结论**整段首开耗时都来自
debug 构建**，而一段没有 release 数字的性能工作等于凭空说话。还完这笔账，量出来的不是"快了多少毫秒"，是
**一处本可以叠起来却从没叠起来的等待**：读件请求（`read_xlsx`）过去排在编辑器 chunk 取完、求值之后才出门，
而这两件事互不依赖。改法只有一句：**在已经知道路径的那一刻把请求发出去**，而不是在需要结果的那一刻。
**Rust 一个字没动**（先例 v0.64/0.65/0.66）。

- **release 那两份账**（`pnpm tauri build --no-bundle` 的 exe，改前一份当场存档成 `tmp/x67/openoffices.before.exe`
  以便两头都是**真件**而不是"改前靠 dev 数推算"；big20k.xlsx 13MB、每边 3 次、单一基准=起进程时刻，
  `shift = performance.timeOrigin − 起进程时刻` 把 WebView 自己的时钟对回去）：
  改前首帧（画到格子）`1612 / 1526 / 1579`，`read_xlsx` 在**起进程后 850 / 786 / 832ms 才出门**、跑 244 / 229 / 235ms，
  SheetEditor chunk 在 520 / 459 / 496ms 就开始取；改后首帧 `1329 / 1376 / 1283`，`read_xlsx` **470 / 470 / 439ms**
  就出门、跑 226 / 229 / 229ms。⇒ **出门提前 362ms，首帧按中位数 1579 → 1329ms（省 250ms，约 16%），
  而那次读件本身耗时几乎没动（235 → 229ms）**——省下来的全是排队，不是 Rust 变快（这一条必须说清，
  否则读者会以为我们把 calamine 优化了）
- **为什么只提前了 362ms 而首帧只省 250ms**：chunk 的取与求值本身也被一起提前不了（它由挂载点驱动），
  两条时间线重叠的部分才是收益；剩下的那一截是 Univer 建实例 + 首帧绘制，本轮没碰。
  这也顺手解释了 v0.35 那条「读文件与建实例不再串行等待」为什么在 release 上表现不出来——**它只把 IPC 提到
  挂载点之前，而挂载点自己就在 chunk 求值之后**
- **一条实测把"是不是 WebView2 不让并行"这句话问死了**：同一次任务里发出 `invoke` 后立刻把主线程占住 200ms，
  那次请求在 Resource Timing 里的起点**仍是发出那一刻** ⇒ **IPC 会在主线程正忙的时候照样出门**，
  串行不是内核的脾气，是我们发得太晚。这一条之所以要量：不量就会有人把本轮的改动当成"引擎终于允许并行"的证据，
  而下一次尝试会照着那个错误模型去做
- **形状只有一处**（新建 `src/lib/open-prefetch.ts`）：`prefetchWorkbook(path)` 由 store 的 `openTab` 调用
  （`tab.path && tab.kind === 'sheet'` 那一路），`takeWorkbook(path)` 在编辑器挂载时取走（取不到就自己发一次，
  **不假设外壳一定先跑**），`dropWorkbook(path)` 挂在 `closeTab`（关掉的标签把在途的账撤掉，别让一叠没人要的字节挂在图上）。
  三条规矩都是判据级的：**取走即失效**（载荷是几 MB 的对象图，留着就是第二份账而编辑器只要它一次）、
  **key 归一**（Windows 的路径写法不止一种，argv 与文件对话框给的分隔符不同 ⇒ `\\`→`/` + 忽略大小写，
  不归一就会让 prefetch 命中不了）、**失败要有人接住但不吞**（`p.catch(() => {})` 只挡 unhandled rejection，
  原样的 rejection 仍旧留给真正的读者，由它按 v0.64 那一层说人话——这一条是真机冒烟判据 S6/S7/S8 的前提）
- **只服务表格这一头，另外两头的理由是量出来的不是顺手的**（v0.68 改口：PDF 这一头后来也进了同一条通道，
  而它预取的是「首屏该怎么读」那**一次决定**而不是整叠字节——下面这一条正是它当初不进的原因，也是本轮的形状根据）：
  PDF 读字节之后还要按区间补读（>4MB 走
  `PDFDataRangeTransport`），先把整叠字节取回来正好与那条闸门相反；文档/演示的字节读得很快，慢的是随后的解析
  （在浏览器那一层），提前读字节省不出什么。**判据 A5/A6/A12 钉的就是"不发不该发的"**：PDF/文档/演示那三条路径
  不许出现 `prefetchWorkbook`，空白新建标签与模板标签也不许（没有路径可发）。反过来 gating 按的是
  `kind === 'sheet'` 而**不是按后缀**——`.ods`／`.csv`／`.xls` 同走这一条在途通道，因为它们本来吃的是同一枚
  `read_xlsx` 命令、由 Rust 那头按后缀分流，按后缀 gate 只会让同一类标签分出两种等待
- **开发模式的双挂载这次也当免费测试机用了一回**（v0.65 那条）：S5 那枚判据的本意是「重开同一件确实又发了一次
  读件」（取走即失效 ⇒ 撤过账不影响第二次），而它顺带量到 **dev 下每开一次表格标签读到两次件**（Resource Timing
  里 `read_xlsx` 的条目 2 → 4）——`React.StrictMode` 的第一趟消费掉 prefetch，第二趟按 `takeWorkbook` 返回 null
  走了自备那一条。**这是 dev 独占的形状，不是缺陷**：挂载点写的是"取不到就自己发"，发布包只有一次挂载而那次必然
  取得到（判据 A10 钉的是"取在前、发在后"那个 `??` 顺序，**不是**"只发一次"）；反过来为了 dev 控制台好看而
  把第二趟阻塞掉，就是拿生产行为换开发体验——但这一条同时立了个规矩：**dev 上的首开耗时因此不可与 release 比**
- **判据吃的是接线而不是自家读侧**：结构腿 12 条（A1–A12）扫**剥掉注释之后**的源文（v0.65/0.66 那条教训的第三次
  兑现；本轮 `decomment()` 自己坏过一次——第一版把字符串字面量整个丢掉，于是找 `'sheet'` 的 A6/A8 与找 `'./fs'`
  的 A5 三条**一起** FAIL（3 条），看着像接线没做其实是量具不吃字符串，修法是**把引号与串内内容照样吐出来**）。
  A1 判三个出口都在这一处交出（契约只写一份）、A2 判 `keyOf` 归一只有这一层持有（模块内 4 次=定义 1+用 3，
  `store.ts` 与 `SheetEditor` 里各零次——别处再归一就是两把尺子）、A3 判取走即删（`delete` 排在 `return` 之前）、
  A4 判 `catch` 排在交账进字典**之前**、A5 判这一层只服务表格（除 `from './fs'` 外没有别的 import，
  模块里也不出现 `readPdf`/`readDocx`/`readPptx`/`kind`）、A6 判 `openTab` 那一行**同时**带 `path` 与
  `kind === 'sheet'` 两道门、A7 判 prefetch 排在去重早退之后且创建标签的 `set` 之前（同一趟里，不另起一轮）、
  A8 判 `closeTab` 的撤账也跟着 kind 那一档（不对所有标签乱撤）、A9 判外壳不碰读侧实现（`store.ts` 里没有
  `readXlsx`）、A10 判挂载点那一行是 `takeWorkbook(tab.path) ?? readXlsx(tab.path)`、A11 判取用排在
  `createSheetApp` **之前**（叠不起来就白改）、A12 判 PDF/文档/演示三头的组件里没有 `takeWorkbook`
- **变异检查 10 枚 / BAD 0**（+ 一枚正控制先跑 12/12，各枚都按"打中的恰好是预期那几条"判，多打一条也算 BAD）：
  门少了 `kind === 'sheet'` ⇒ A6；外壳整个不发 ⇒ A6+A7；取用不撤账 ⇒ A3；没人接住失败 ⇒ A4；
  编辑器不取用（prefetch 白发那一种形状）⇒ **A10+A11 一起响**；把取用挪到建实例之后 ⇒ **只有 A11 响**
  （这两枚分得清"没接"与"接了但排错序"）；撤账不跟格式 ⇒ A8；在 `store.ts` 里再写一份归一化 ⇒ A2；
  外壳直接 import `readXlsx` ⇒ A9；PDF 那头也来取用 ⇒ A12。
  本轮量具自己的两处坑都不是产品：M5 的副作用面**报得比预期多一条而报对了**（"取用"这件事一塌，
  排在它后面的 A11 跟着不成立——一开始把预期写窄了，改判据之前先问"这条多响的是不是真响"）；
  M6 原本写成两段多行替换，锚点匹配不上是因为 **`SheetEditor.tsx` 是 CRLF 而 `store.ts`/`open-prefetch.ts` 是 LF**，
  副本先统一归一成 LF、并把两阶段替换换成一次片段交换才对
- **只有真机能教的几条**（17 断言 / 页面异常 0 条）：坏件仍然说人话且**原话留在悬停里**（S6/S7/S8——
  这组判据本轮的角色变了，它判的是"prefetch 那条被接住的 rejection 到了用户面前仍然是同一句话"，
  也就是新通道没把 v0.64 那一层绕过去）；不存在的 path 报的是「文件不存在」而不是「读不出结构」（S10，
  两档归因没被新通道混掉）；**这两条坏件路径同时判"没有裸的 promise rejection"**（S9/S11/S16 三处计数，
  因为新通道第一次让失败在"没人读它"的时刻发生，接住它的那一句若写成吞掉就是静默）；
  空白新建标签（S12/S13）与 PDF 标签（S14/S15）**在 Resource Timing 里一条 `read_xlsx` 都不许多出来**
  （前后计数相等，这是 A6/A12 的真机版）；表格标签首帧照旧画得出（S1）、Sheet1 跟着来了（S2，说明取到的
  载荷真交给了 Univer）、干净件状态栏那块**根本没长出来**（S3，判的是 `null` 而不是空串）、
  关掉再开同一件仍画得出来（S4）、控制台 error 级条目 0 新增（S17）
- **本轮没动的，量出来记着**（都已开进路线图）：改后的 1329ms 里仍有一整段是 **SheetEditor chunk 的取（82ms）+
  顶层求值（一个 111~137ms 的长任务）**排在 Univer 建实例之前，而 chunk 现在与读件并行了，**求值那一截仍占着
  首帧的关键路径**（要再省就得把 Univer 的实例创建也提前到外壳，而它需要 DOM 容器，不是免费的）；
  `write` 那一头本轮一个字没碰（release 存盘 205ms 是 v0.66 在 `cargo test --release` 里量的应用层之外的数）；
  预热（`lib/prewarm.ts`）与本轮的 prefetch 是**两条互不知情的通道**——预热在空闲时取 chunk，
  本轮在开标签时读件，两者顺序在 Resource Timing 里会互相挪动，而"预热是否已经把 chunk 备好"本轮没判据；
  首页最近文件的**点击**路径与 argv/文件关联路径共用 `openTab`，所以三条都吃到本轮的收益，
  但**拖拽打开**那条路径本轮没单独量（它同样过 `openTab`，判据 A6 吃的是这一处）
- **验证（四腿 + 编译）**：**A/B 真机腿 6 判据（R1–R6）/ 3 次 × 两枚 exe 全绿**（R1 判改前的顺序、
  R2 判改后每一趟 `read_xlsx` 都早于 chunk、R3 判首帧中位数 1579 → 1329ms、R4 判那次读件本身耗时没变（≤60ms 漂移）、
  R5 判首帧与状态栏、R6 判页面异常 0 条）；**前端结构测试 12 断言 / 真失败 0**；
  **变异检查 11 项 / BAD 0**（含正控制）；**CDP 真机冒烟 17 断言 / 真失败 0、页面异常 0 条**；
  `cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63/0.64/0.65/0.66 同一份基线——**Rust 本轮一个字没动**）；
  + tsc 与 `pnpm build` 绿（2.19s，SheetEditor chunk 6,550.22 kB）。release 的 A/B 用的 exe 是**版本号 bump 之后**
  重新 `pnpm tauri build --no-bundle` 出来的（3m 55s），而结构腿/冒烟/编译也都在 bump 之后复跑（老规矩）

## PDF 首开的那一枚 IPC 也提前出门了：预取的是"该怎么读"那次决定，不是整叠字节（v0.68）

起点是 v0.67 收尾时自己记下的那条未勾项——「PDF 那头的 `file_len` 与首 64KB 其实是两件可以 prefetch 的小事」。
本轮把这句话做完：**Rust 一个字没动**（先例 v0.64/0.65/0.66/0.67），改的是同一层的接线，
而量出来的收益是表格那一头的十分之一（下面第 4 条），这句话本身就值得记——**上一轮那句"只服务表格这一头"
是被当时的实测支撑的，本轮把它改口成"两头都服务、各自的账不同"**。

- **本轮唯一的形状决定：预取那一次"决定"，不是那一次"读"**（`src/lib/pdf-range.ts` 新增 `preparePdfSource`）。
  v0.67 那条实测说得很清楚：>4MB 的件走 `PDFDataRangeTransport`，正文按区间补读，
  于是"先把整叠字节取回来"正好与那条闸门相反。所以外壳预取的是`{mode:'range', transport} | {mode:'bytes', bytes}`
  这两形状之一（过闸门 ⇒ `file_len` + 首块 64KB，没过 ⇒ 整本读一次），编辑器只管按 `src.mode` 分支；
  **闸门的判断由 `preparePdfSource` 单一持有**（结构腿 R2 判 `RANGE_MIN_BYTES` 全场只 2 次、V4 判 `PdfViewer`
  里不再出现 `createRangeTransport`），两处各判一次就会读出两种形状
- **三条规矩没有重写第二遍**：`open-prefetch.ts` 的 `put/take/drop` 泛化成 `<T>`，两张表（`workbooks`/`pdfs`）
  共用同一段实现。判据 P1–P4 吃的是那三个通用函数（归一只在 `keyOf` 一处、去重早退与 `p.catch(() => {})`
  排在交账之前、`delete` 排在 `return` 之前），所以本轮新增的不是第四第五道**规矩**，只是第四第五个**调用点**
- **`prefetchPdf` 喂的是那次决定而不是 `readBytes`**（判据 P6 直接钉这一条：这一层里 `readBytes` 一次都不许出现）。
  文档/演示照旧不进这一路（P5/S5 与变异 M12 判的是"不许挤进来"，它们的字节读得快、慢在随后的解析）
- **release 的账（三枚夹具 × 每边 5 趟 × 两支真 exe，基准=起进程时刻）**：改前（v0.67 存档件）每趟的首屏读都
  排在 PdfViewer 那块 chunk 备好**之后** 17~24ms；改后每趟都在它**之前** 4~10ms 出门。首画中位数
  12 页小件 `632 → 579`、3.7MB/1600 页 `778 → 708`、5.9MB/2300 页分段 `992 → 966`，
  而**那一次读自身耗时没动**（`10 → 9` / `40 → 39` / 首块 `3 → 4` ms）⇒ 省的仍是排队，不是 Rust 变快。
  分段那一头只省 26ms 是有道理的：首屏真的只读 64KB，可叠的窗口就这么大
- **`read_range` 枚数两头都是 92**（判据 A8）⇒ 这条通道不新增读，只是把已有的那几枚提前；
  顺带一条只有并行才能量出来的观测量：改后 `read_range` 的**累计**耗时是改前的 3~4 倍（`949~1460 → 4415~4858`ms）
  而**末次出门更早**——同一批区间读并行度上去了，每枚在 Resource Timing 里就长了，活并没有变多。
  不量这一条，下一轮很容易有人拿"累计耗时涨了"当预取有害的证据
- **一次裁决差点把这段改动删掉**：3 趟的初量算的是"出门时刻的绝对毫秒差"，两枚夹具判成 −2/−16ms（看着像没收益），
  按 v0.36 那条"无收益即删"的规矩就该 revert。加到每边 5 趟并把判据换成**符号**（排在 chunk 备好之前还是之后）之后，
  30/30 趟一致。绝对差被什么吃了：外壳 bundle 比上一版大，`openTab` 自己往后漂了二三十毫秒，
  而那条漂移与本轮无关。**教训是判据的形式**：量"排队有没有叠起来"要判顺序，不能判绝对时刻
- **腿自己撞的一坑，比产品坑更像产品坏了**：第一版 5 趟采样把四份 probe 并行发出去，结果四份记录**逐字相同**、
  12 页的小件报出 1600 枚 canvas——`--remote-debugging-port=9222` 是**全局单端口**，先起的那枚实例抢到，
  后起的抢不到而四个 CDP 客户端全连到了同一个页面。**A/B 腿必须严格串行**，且"两份数据一模一样"要当成腿坏了读，
  不是当成"没有差"读
- **开发模式的双挂载在这一路又当了一次免费测试机**（v0.65/0.67 那条）：真机 S4 量到小件每开一次读到
  `file_len file_len plugin:fs|read_file plugin:fs|read_file`（**各两枚**，第一趟消费 prefetch、第二趟走自备），
  而 release 每开一次各一枚。同一条判据在 dev 与 release 上数不同，所以**这条只在真机 release 上判符号**；
  C1/C2 判的是重开同一件仍读得到（第二次又发一次，取走即失效不影响第二趟）
- **只有真机能教的（25 断言 / 页面异常 0 条）**：**分段件不许被预取通道读成整叠字节**（R2：5.9MB 那件 `read_file` 0 枚，
  这是本轮最要紧的一条——它判的是新通道没把 4MB 那道闸门绕过去）；坏件仍说人话且原话留在悬停里（E1/E2/N1–N3，
  新通道没把 v0.64 那一层绕过去）；**密码面板没被绕开**（P1–P4：预取过的那一趟照样被问到、答对才开完、
  首页真画出来）；另外三头不许多发一枚读件（K1–K3）；干净件与分段件的状态栏都没凭空记账（S3/R4，判 `null`/空）
- **一处诚实的次序代价**：自备那一路的读现在排在 `if (disposed) return` **之前**（闸门单一持有的后果），
  而"写共享状态之前那道门"的位置一个字没动（V3，v0.65 那条规矩）；另有一条与表格同形的既有事实——
  外壳发了而标签在编辑器挂载前被关掉时，`dropPdf` 撤的是**字典里的账**，那一枚 IPC 已经出门收不回来
- **验证（A/B 裁决腿 + 四条腿 + 编译）**：**A/B 22 条断言 / 0 FAIL**（三夹具各有 A1 对照件确实排在 chunk 之后、
  A2 改后每趟提前、A3 出门中位提前、A4 首画中位不变差、A5 读本身没变慢、A6 十趟全画出来且状态栏干净、A7 不许多发，
  分段件另有 A8 枚数一致）；**前端结构测试 21 断言 / 真失败 0**；**变异检查 14 枚 + 正控制 / BAD 0**；
  **CDP 真机冒烟 25 断言 / 真失败 0、页面异常 0 条**；`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**
  （与 v0.63~0.67 同一份基线——**Rust 本轮一个字没动**）；+ tsc 与 `pnpm build` 绿（2.33s，SheetEditor chunk 6,550.21 kB）。
  对照件是改前当场存档的 exe（21:11），实验件是**版本号 bump 之后**重新 `pnpm tauri build --no-bundle` 的那一支（21:34），
  四腿与编译都在 bump 后复跑（老规矩）；A/B 跑完之后源文只动过注释，没有再 build
- **本轮没动的，量出来记着**（已开进路线图）：改后的 579/708/966ms 里，**chunk 的取与顶层求值仍排在最前**，
  PDF 这一头要再省就得让 PdfViewer 的实例创建也别等 chunk（与表格那一头同一个未决项）；
  预热（`lib/prewarm.ts`）与 prefetch **仍是两条互不知情的通道**（"预热是否已把 chunk 备好"两轮都没有判据）；
  分段件首屏那 92 枚 `read_range` 仍是 pdf.js 自己的切分节奏，没按视口排；`file_len` 与首块 64KB 现在合成一次
  预取，但**首块之后的区间仍要等 `getDocument` 起来才开始**（要把它们也提早就得自己实现按页预取，不是免费的）；
  写侧 release 的完整一趟（含 IPC 与快照抽取）仍未量（**这一条 v0.69 已还**：按键到 `write_xlsx` 出门之间是
  115~131ms 的主线程同步块、Rust 自身 460~470ms，而进度门与同标签串行锁都是照这一趟摆的）；
  失败提示照旧寄生在状态栏那一枚字符串上（toast 体系未建）

## 存盘那一段现在会说话，同一个标签不再并发写（v0.69）

起点是 v0.68 收尾时自己记下的那条未勾项——「写侧 release 的完整一趟（含 IPC 与快照抽取）仍未量」。
本轮先把那趟量完，再只动两件事：**等的时候界面说什么**、**连按两次时谁后落地**。
**Rust 一个字没动**（先例 v0.64/0.65/0.66/0.67/0.68），改动全在前端那一层（两个文件加一个新建的纯模块）。

- **前置实测把"存盘慢"这句话拆成三档**（release，三枚夹具 × 单按/连按共 13 趟，基准只有一个=页内时钟）：
  按一次 Ctrl+S 到 `write_xlsx` 出门之间隔着 **115~131ms**（这一段是主线程的同步块：`wb.save()` 取快照 + 交进 IPC），
  出门之后 Rust 自身 **460~470ms**（2 万行 / 1MB 那件）、**45~46ms**（2000 行）、**11ms**（200 行）
  ⇒ 同一句"存盘要多久"在三档件上差 40 倍，而那一段里界面**一句都不说**（要等落定才 `setStatus('已保存')`）
- **所以进度那句要有门，不是一按就说**（新建 `src/lib/save-status.ts`，照 v0.66 搜索进度、v0.65 密码提示、v0.54 纸上账目的先例：
  文案与判据只写一处）：`SAVE_BUSY_MS = 200` 是被那三档数定出来的——11ms 那一档说出口就是一闪的噪音，
  而 590ms 那一档有 366ms 的窗口值得说；`saveBusyTimer` 把"挂门/撤门"的时钟持有在模块里，组件只发牌（A5 判这一条）
- **挑路径那一段要撤门**（A7 + 变异 M7）：另存为时 `pickSaveFile` 是**用户手上的等待**，不该算成"我们在存"——
  门在那一句之前撤掉、挑完再挂回来。这是本轮唯一一处"进度"与"等待"的归因区分
- **连按两次的形状是本轮最贵的一条实测**：改前那支当场存档的 exe 连按两次，两趟 `write_xlsx` **全部重叠**
  （A/B 判据 R1 判的就是这个，13 趟无一例外），而 `write_xlsx_sync` 落盘是一枚 `std::fs::write` ⇒
  并发两趟跑在不同的 blocking 线程上写同一个路径，**谁后落地没有保证**——用户看到的是"按了两次，
  第二次改的东西可能被第一次的旧快照盖掉"。那不是"多写一次浪费"，是**内容对错**的问题
- **`registry.saveTab` 因此改成按标签串行 + 合并补跑**：`running` 管在途，`again` 只留"还要再存一次"**一个位**（不排队列）。
  **为什么不排队**：排两趟就是让用户早先的中间态多落一次盘，而用户要的是最后一次按键的结果；
  **为什么不丢弃**：丢弃就是第二次按的改动没存进去，与本轮要修的那个缺陷同形。
  补的那一趟跑的是同一个 `save()`，`wb.save()` 在它内部 ⇒ **重新取快照**，
  所以 dev 腿 D3 判的不是"发过两次请求"而是"两按之间改的那枚页眉字面真在文件里"
- **在途锁不许被一次抛错卡死**（A13 + 变异 M11）：`drain` 里的 `catch {}` 不上抛——saver 自己已经把失败说给用户了，
  这一层只管锁；锁卡死的后果是这个标签**再也存不了且不说话**
- 「已保存」那句的收尾定时器交给补趟撤（`doneClearRef`，A10 + 变异 M6）：不撤的话第一次按键的「已保存」
  会在说完之前被抹成空白——这是 v0.65「迟到那一趟不许抹活着那一趟」在写侧的形状
- **失败那一路换掉的正是同一句进度**（A8 + 变异 M3）：`setStatus(failStatus(e, '保存失败'))` 顶掉「正在保存…」，
  原话留在悬停里（v0.64 那条规矩）。dev 腿用只读件量到「保存失败: 这个位置不让写：…」+ 悬停
  「保存失败: 拒绝访问。 (os error 5)」，而**写请求确实出过门**（一枚 312ms）——只读是写盘时才知道的
- **A/B 的账（两支真 exe × 13 趟，判据只看顺序与"闪不闪"）**：改后两趟**不重叠**（第二枚在第一枚落定后 124~136ms 才出门）；
  大件进度句上屏后还有 366ms 可看（按键@1628 → 说进度@1856 → 落定@2222）；小件 3 趟 + 中件 2 趟**一次都不闪**；
  而 `write_xlsx` **自身耗时没变慢**（中位 505 → 471ms）⇒ 本轮没有让 Rust 变快，改的是排队与说话；13 趟页面异常 0 条
- **dev 腿的数字不吃，只吃形状**（12 断言 / 真失败 0）：dev 里同一枚 108KB 件的写自身是 304~362ms ⇒
  **进度句在 dev 上每次都亮**（release 上那一档不闪）——这是 v0.66「数字不能跨 profile 比」在写侧的重现，
  本轮记成观察而不是判据；判的是缝（15/16/14ms 全为正 = 不重叠）、补趟内容真落进文件
  （独立 python 在 zip 的 `xl/worksheets/*.xml` 里读到 `X69M1..3` 那枚字面）、进度→收尾方向单调、
  进度那句 `title` 为空、只读件那一路、页面异常 0 条
- **判据吃接线而不是自家读侧**：结构腿 25 断言（B0 自检 + A1–A15）扫的是**剥掉注释之后**的源文
  （v0.65/0.66 那条教训的第四次兑现）——A1/A3/A4 文案只在模块里、A2 门值不重复、A5 arm/cancel 各两次且时钟只挂一处、
  A6 arm 排在 `wb.save()` 之前、A7 撤门排在挑路径之前、A8 失败那句排在进度之后、A9 `finally` 里撤门、
  A10 收尾句可被补趟撤、A11 先判在途再开跑、A12 先看再 break 且锁排在最后一趟之后、A13 catch 不上抛、
  A14 外壳不重写那句话且 `saveTab` 只此一处、A15 两层都不碰 IPC/文件；变异 12 枚 / BAD 0（+ 正控制先跑 25/0）
- **本轮撞到的两处量具坑，都不是产品**：① dev 的 vite 会**整页重载**，`window.__x69d` 那枚常驻跟着没了，
  第一版在"清采样数组"那一句上抛 `TypeError` 就把整条腿带崩——常驻钩子必须在每次取样前重挂
  （幂等判据本来就写好了，只是没在这句前面调）；② 只读件那一档我原本把判据写成"失败了就不该发出写请求"，
  实测正好相反：**`os error 5` 是 Rust 写盘时才报的**，照想当然写就会永远绿在一个不存在的形状上
  （改判成"进度不许活在失败之后" + "写请求确实出过门"）
- **验证（四条腿 + 编译）**：release A/B 真机 **23 断言 / 真失败 0**、前端结构 **25 断言 / 真失败 0**、
  变异检查 **12 枚 + 正控制 / BAD 0**、CDP dev 真机 **12 断言 / 真失败 0、页面异常 0 条**，
  `cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63~0.68 同一份基线——**Rust 本轮一个字没动**），
  + tsc 与 `pnpm tauri build --no-bundle` 绿（3m15s）；对照件是改前当场存档的 exe，实验件是**版本号 bump 之后**重新 build 的那一支，
  四腿与编译都在 bump 后复跑（老规矩）
- **本轮没动的，量出来记着**（已开进路线图）：另外三头（文档/演示/PDF）只拿到 `registry` 的在途保护、**没有进度文案**
  （那三头各自的 `setStatus` 形状不同，而本轮没量过它们的存盘时间线）**⇒ v0.70 改口：三头的时间线量完了**——
  PDF 大件那一档（1071~1161ms）接上了进度/收尾/失败三句，文档（≤122ms）与演示（≤45ms）实测在门值以内故照旧不接
  （A12a/A12b 把"没接"这个决定钉成判据）；在途锁按 `tabId` 不按 `path` ⇒
  两个标签指向同一个文件仍可能并发写（`openTab` 按 path 去重让这种形状在正常操作里很难出现，但不是结构上不可能）；
  `SAVE_BUSY_MS = 200` 是本机 release 量出来的门，未跨机器复核；另存为撤门那一档只有结构判据、release 真机未量
  （要真挑一次原生对话框才撞得到）；写侧前缀三家不统一、toast 体系照旧未建
- **一条不属于本轮的现场记录**：dev 腿跑到一半，本机另有一支**外部构建的旧正式版**（0.37.0，
  `AppData\Local\OpenOffices`，其 panic 里的构建路径属于另一台机器、插件是 `tauri-plugin-single-instance` 2.3.0）
  在单实例初始化处 panic：`Failed to init single instance: The following required arguments were not provided:
  --first-instance-path <PATH>`。我们当前 `Cargo.lock` 锁的是 **2.4.5**，而本轮四条腿都不覆盖
  "二次启动把路径转发给已开窗口"这一路 ⇒ 记成路线图上一条待复判（见下），不当成本轮改动引起的

## PDF 头存盘那一路终于有话说：三头里只有一头的窗口值得开口（v0.70）

起点是 v0.69 收尾时自己记下的那条未勾项——「另外三头（文档/演示/PDF）只拿到 registry 的在途保护、没有进度文案
（它们的存盘时间线本轮一毫秒都没量，照搬 200ms 就是猜）」。本轮先把那三头量完，再只给**量出来值得开口的那一头**接线。
**Rust 一个字没动**（先例 v0.64~0.69），改动全在前端那一层：`PdfViewer` 的 saver 那一层加话，
`lib/save-status.ts` 多收一枚收尾时钟。

- **前置实测把"三头要不要同一句话"判掉了两头**（release，三头 × 三档 × 各 3 趟，基准=页内时钟）：
  文档（`.docx`，走 `plugin:fs|write_file`）按键到写出门 **6~111ms**、整趟 **≤122ms**、写自身 4~10ms；
  演示（`.opd`，走 `plugin:fs|write_text_file`）**0~8ms** 出门、整趟 **5~45ms**、写自身 5~31ms；
  PDF（标注写回，`write_file`）整趟 **11 / 143~161 / 1071~1161ms** 三档，而 `write_file` 自身只有 4~95ms
  ⇒ **只有 PDF 大件那一档跨过 200ms 的门**（中件 161ms 差一口气不闪——同一枚门在两档上给出两种答案，这正是"照搬就是猜"的反面）
- **PDF 这一路真正的缺陷比"没进度"更糟：它改前一句都不说**（R6e 判据判的就是这个）——`writeAnnosTo` 自己从不 catch，
  而 `registry.drain` 的 `catch {}`（v0.69 为"锁不许卡死"立的那条）把抛错整个咽了下去，
  于是**只读件按 Ctrl+S 之后屏上连一句「保存失败」都没有**；成功那一路同样只有 `markDirty(false)` 而没有「已保存」。
  那一层防锁死的设计恰好把这头的失败从界面上抹掉了，本轮补的就是这一格
- **三句话挂在 saver 那一层，不挂进 `writeAnnosTo`**（A8 + 变异 M5）：工具条的页面操作（`pageOp`：旋转/删除/提取…）
  共用同一个函数，句子写进去就成了两头发话；`pageOp` 自己有「旋转…」与失败那两句，本轮一个字没动
  （A9 + M6 是回归判据，判"没被顺手顶掉"）
- **收尾时钟从组件挪进模块**（这一轮唯一的复用改动）：v0.69 把 `doneClearRef` 写在 `SheetEditor` 里，本轮 PDF 头要用
  同一个形状 ⇒ 两份 1500/5000 就是两把尺子，于是 `saveDoneTimer(setStatus)`（`show(notes)` / `cancel()`）进
  `lib/save-status.ts`，表格头改成吃它（A3a/A3b + M9/M18）——「文案与时钟只写一处」那条先例的第五次兑现
  （v0.54 纸上账目 → v0.64 失败归因 → v0.65 密码提示 → v0.66 搜索进度 → v0.69/0.70 存盘进度与收尾）
- **A/B 的账（两支真 exe × 10 趟，20 断言）**：R1 改前大件整趟屏上文本时间线只有一个值 `[""]`（判据不是空的）；
  R2a~d 改后按键@3605 → 说进度@3822 → 落定@4762，**可看 940ms** 且进度到收尾中间不出现空白；
  R3a/R3b 小件 **48ms**、中件 **164ms** 一次都不闪；R3c 三档各只落一次盘（接了话不多写一次）；
  R4a 写自身 88→99ms、R4b 全程 1152→1150ms、R4c 两头 `longtask` 都是 `[]` ⇒ **本轮没让 pdf-lib 或 Rust 变快**，
  改的是界面说什么；R5/R5b 连按两次两趟都不重叠（改后间隔 **987ms**、改前 **960ms** ⇒ v0.69 那枚在途锁本来就管着这一头，
  本轮没有回退，而那 987ms 说的是补的那一趟**真的重跑了整条 pdf-lib 路**）；R5c 收尾句只有一句；
  R6a~e 只读件：失败句@5032、进度不留在屏上、原话 `failed to open file at path: … with error` 整句在悬停 title 里、
  `write_file@4921+93` 证明写请求确实出过门（只读是写那一刻才知道的）、而改前那支连失败都没说；R7 十趟页面异常 0 条
  （R1 与 R6e 这两枚判的是**对照件**：它们成立才说明这一轮买到的不是"判据空转"）
- **dev 腿只吃形状**（11 断言 / 真失败 0、页面异常 0 条）：与 v0.69 相反，dev 里这一路的写自身只有 **5~7ms** ⇒
  连 dev 都不闪进度句（这一条路的钱在 pdf-lib 的 load+save，不在序列化那一步）；D5 量到连按两趟间隔 39ms 为正、
  D6 收尾句只有一句、D9 悬停原话、D10 写请求出过门
- **判据吃接线而不是自家读侧**：结构腿 21 断言（B0a~d 自检 + A1~A14，含 A2a/A2b/A3a/A3b/A12a/A12b 六枚分裂 id）
  扫的是**剥掉注释之后**的源文；A12a/A12b 钉的是**本轮"没接"这个决定**（文档头与演示头不许出现进度门，
  也不许共用收尾时钟——两头成功那句文案各不相同，强行并就是把它们现在说的话改掉）**⇒ v0.71 半句改口**：
  文档头现在**共用**收尾时钟（量到了它该说的那句话），"不许出现进度门"那一半仍立着（A8a/A8b），
  "没接时钟"那半边只剩演示头（A9a/A9b）
- **本轮撞到的两处量具坑，都不是产品**：① **自检判据不许吃会被本腿自己变异的文本**——第一版 B0b 借用产品里那句
  `setStatus(failStatus(e, '保存失败'))` 做剥块注释的自检，于是变异腿 M4（正是删掉这一句）跑起来时 B0b 与 A7 一起响，
  看着像"删一句把量具也删坏了"；改成四枚合成样例（行注释 / 块注释+字符串 / 模板字面量里的 `//` 与 `/*` / 转义引号）
  之后自检才与被检对象脱钩；② **落定判据不能只看"写 IPC 静止"**——A/B 腿第一版把 settle 写成"最新一枚写的
  `responseEnd` 之后 1 秒不动"，于是它在合并补跑的那一趟还在 `read_file` 时就落了快照，**两枚 exe 都只采到一枚写**，
  R5 报 `枚数=1` 并接着崩在 `writes(b2)[1].s`；产品没错（原始数据 `press=[3740,3790]`、
  `read@3768 / write@4825+93 / read@4931`、文本 正在保存→已保存→正在保存→已保存），
  改成"**任何一枚 IPC** 都静止 1500ms"之后 R5/R5b 才第一次真的判到东西。这与 v0.69 那条
  「`os error 5` 是写盘那一刻才报」同族：**"结束"要按事件的完整集合定义，而不是按我们关心的那一类事件**
- **验证（五腿 + 编译）**：release A/B 真机 **20 断言 / 真失败 0**（对照件是改前当场存档的那支 0.69 exe）、
  前端结构 **21 / 0**、变异检查 **18 枚 + 正控制 / BAD 0**、CDP dev 真机 **11 / 0、页面异常 0 条**，
  `cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63~0.69 同一份基线——**Rust 本轮一个字没动**），
  + tsc 与 `pnpm tauri build --no-bundle` 绿（3m35s）；结构/变异/A/B/dev/编译五腿都在**版本号 bump 之后**复跑（老规矩）
- **本轮没动的，量出来记着**（已开进路线图）：PDF 大件那 ~1030ms（按键到写出门）本轮**只判了它不是 chunk 取、
  且页内 longtask 观测器全程 0 条**（门槛 50ms），没有归因到 pdf-lib 的哪一步；文档/演示的失败仍只进原生弹窗、不上状态栏（现在连进度都没有）
  **⇒ v0.71 改口：文档头这一路量完并接上了**（失败上状态栏、成功那句跟着标签的账走），演示头照旧没接；
  「已导出 PDF」那一路与 doc/ppt 的收尾各持一枚裸 `setTimeout(…, 1500)`（本轮只把**存盘**的收尾时钟收进模块）；
  中件 164ms 与门值 200ms 只差 36ms，换机器就可能翻脸；另存为撤门那一档 release 真机仍未量；在途锁按 `tabId` 不按 `path`；
  写侧前缀三家不统一、toast 体系照旧未建

## 文档头存盘那一路的账与话：写手只写字节，句子归动作（v0.71）

起点是 v0.70 收尾时自己记下的那条未勾项——「文档/演示的失败只进原生弹窗、不上状态栏」。本轮只动**文档头**，
演示头一字未接（A9a/A9b 把"没接"钉成判据）。**Rust 一个字没动**（先例 v0.64~v0.70），改动全在前端那一层：
`DocEditor` 里把"写文件"与"说话+记账"分成两层，`lib/save-status.ts` 的收尾句多一个 `base` 参数。

- **这一头的缺陷不是"没话说"，是"话说错了"**：改前 `.docx`/`.odt` 按 Ctrl+S，文件真写进去了、界面也说「已保存（docx）」，
  可标签的 **● 还挂着**（A/B 的 R0a：`dots 1→1 内容落盘=true 那句="已保存（docx）"`；R0b 量到成功那句与 ● **同屏 1 拍** ⇒
  判据不是空的）——界面自己跟自已矛盾，且关窗口时给一条假的"未保存"询问。根因是那句话与 `markDirty` 挂在**不同的层**上：
  句子挂在写手（`exportDocxTo`）身上，而标签的账只有 `renameTab`/`markDirty` 那一层能记
- **只读件那一路改前状态栏全程一个字都没有**（R2a：`弹窗 0→1 状态栏拍=[null]`）：写请求确实出过门
  （`fs|write_file` 17+6ms），失败只落在阻塞式 `#32770` 里——v0.70 给 PDF 头补的正是同一格，这一头当时没轮到
- **分层是本轮唯一的架构决定**：**写手**（`writeDocxTo` / `writeOdtTo`：取字节 → `writeBytes` → `markRecent`，不碰 store、
  不发句子）／**动作**（`saveOdoc` 与 `exportAs` 各自决定说什么、记不记账、失败走哪张面孔）。DEV 冒烟钩子因此指向写手，
  判据 D7c/D7d 钉的就是"写手自己不说界面那句话、不替标签记账"（状态栏文本调用前后逐字相同、`dirty true→true`）
- **`saveDoneText` 多一枚 `base`（本轮唯一的泛化）**：同一个写手既服务「保存」也服务「导出 docx」，句子得由**按下的那个动作**给，
  否则导出那一路会说「已保存（docx）」而标签其实没存（A11b/A11c + 变异 M8：导出不传 base 就响 A3a）
- **文档头不挂进度门**（A8a/A8b + 变异 M5）：release 实测 `.docx`/`.odt` 原地保存整趟 **30~92ms**、`write_file` 自身
  **6~62ms**、页内 `longtask` 观测器全程 0 条 ⇒ 这一头连门都不挂，说了就是一闪的噪音。这一条把 v0.70 的 A12b **就地改口**：
  文档头现在**接**收尾时钟、仍**不接**进度门（A9a 那半边改成只管演示头；判据吃的是历史事实，改口写成括号而不是删掉）
- **`cancel` 在文档头暴露出它真正的第二个用途**（A7 + 变异 M4）：v0.70 说它是给"下一趟开跑"用的，本轮量到
  **失败那一路更要撤**——改前第一趟那句裸 1500 会在第二趟说话时把它抹掉：连按两次（间隔 1 秒）时 R3a 的
  后一句从第二次写落定算只活了 **504ms**，而改后走同一个时钟是 **1504ms**（R3b）。同文两句在屏上会并成一拍，
  **只能锚 IPC 量在屏时长，不能数"文本段枚数"**
- **失败面孔按动作分两张，不是一刀切**：存盘失败上状态栏（`failStatus(e,'保存失败')`，原话留悬停 title，
  R2b/R2c/R2d：弹窗 `0→0`、● 从头挂到尾 R2e）；导出失败仍走弹窗（A6c + M9 的边界——那一路的对话框本轮没动）。
  `.odoc` 那一路「落盘→记账→说话」的形状两支持平（R4：`落盘=true dots=0 那句="已保存"`），本轮没有把它改坏
- **A/B 的账（两支真 exe，S1/S2 各 3 趟 + 连按与 .odoc 档，37 断言）**：R1a 改后 `dots 1→0`、字面真在
  `word/document.xml` 里、写枚数 1；R1b 打脸 **0 拍** 且那句是「已保存」而不是「已保存（docx）」；
  R5a 按键→上屏 **32→31ms**、R5b `write_file` 自身 **7→6ms**、R5c `longtask` `[]`、R5d 各趟写枚数 `[1,1,1]`
  ⇒ **本轮没让写侧变快**，改的是界面说什么、标签记什么账；R3c 紧连两下两趟写不重叠（对照件 `[[17,9],[35,8]]`、
  改后 `[[22,9],[42,7]]` ⇒ v0.69 那枚在途锁本来就管着这一头，本轮没有回退）；R6 全程页面异常 0 条
- **dev 腿只吃形状**（16 断言 / 真失败 0、页面异常 0 条）：D4 这一头**连 dev 都没说过「正在保存」**（`文本拍数=2`，
  全程只有「已保存」与空白）；D1b `dots 1→0`、D2 首句="已保存"、D3 独立读 zip 里真含 `D71K1`；
  D5/D5b 失败句与悬停原话、D6 弹窗 `0→0`、D6b `dots 1→1`、D6c 写请求出过门；D7 两枚写手直调都 ok
- **判据吃接线而不是自家读侧**：结构腿 31 断言（B0a~d 自检 + A1~A14，含 A6a/A6b/A6c、A8a/A8b、A9a/A9b、
  A11a~c 六枚分裂 id）扫的是**剥掉注释之后**的源文；A9a/A9b 与 A10a/A10b 是**回归判据**（演示头本轮没接、
  表格头 v0.69 与 PDF 头 v0.70 的两枚接线都没被顶掉）；变异 14 枚 + 正控制 / BAD 0
- **本轮撞到的六处量具坑，都不是产品**：① **同文两句要在屏时长锚 IPC**——R3a 第一版按"文本段枚数"判，
  两趟都报 `已保存` 于是并成一拍（`runs=[1499]`）看着像 FAIL 其实是判据不存在；② **"计数为零"型判据在跳过的档上是空断言**
  ——子集运行时 R5a~R5d 没有数据仍绿，改成显式 `SKIP`（`pass=null`）；③ **组件级 DEV 钩子不能当"app 起来了"的等待条件**
  ——`__oofDocCtlByTab` 要 `DocEditor` 挂载才存在，等它会把腿挂在启动上；④ **自己新写的腿也要每次取样前重挂常驻钩子**
  ——`SAMPLER` 导入了却没执行，`window.__x71` 是 undefined 当场崩（v0.69/0.70 那条教训我自己违反了一次）；
  ⑤ **注释里的数字要与证据一致**——`save-status.ts` 先写了"提前 120ms"，A/B 量到的是 504/1504ms，按证据改口；
  ⑥ **原生弹窗的出现时刻不在页内时钟的口径里，单次采样会读成"没有"**——复跑时 S2 的第二趟假 FAIL（`弹窗 0→0 状态栏拍=[null]`
  看着像对照件没立弹窗），而同一趟的 `R2w` 证明写请求出过门且失败（`fs|write_file` 18+5ms）⇒ 那枚 `#32770` 是原生窗口，
  它出现在按键之后多久没有任何页内观测能钉住，1800ms 那一刻恰好数到 0。改成**在一个窗口里反复数、见到就停**
  （`dialogCountWithin(3000, 400)`，返回最大值 ⇒ 判"改后不立弹窗"那一头照样跑满，判据方向没被放松）
- **验证（五腿 + 编译）**：release A/B 真机 **37 断言 / 真失败 0**（对照件是 v0.70 收尾存档的那支 0.70 exe；
  第一版在这条上复跑撞到过 ⑥ 那枚假 FAIL，改轮询后两趟都是 `弹窗 0→1`）、
  前端结构 **31 / 0**、变异检查 **14 枚 + 正控制 / BAD 0**、CDP dev 真机 **16 / 0、页面异常 0 条**，
  `cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63~0.70 同一份基线——**Rust 本轮一个字没动**），
  + tsc 与 `pnpm tauri build --no-bundle` 绿（4m49s，vite 2.28s）；五腿都在**版本号 bump 之后**复跑（老规矩），
  且 A/B 与 dev 两腿是在 `lib/save-status.ts` 那处**注释改口之后**重新 build 出来的那支 exe 上跑的（体积相同而 sha256 不同 ⇒
  不能靠"注释不进产物"这条推理免掉复跑）
- **本轮没动的，量出来记着**（已开进路线图）：**演示头**（`.opd` 的失败仍只进原生弹窗、状态栏一句都没有，
  且自持三枚裸时钟 1500/2000/1500，成功句连 notes 都没有）**⇒ v0.72 改口：演示头量完并接上了**（失败上状态栏、
  三枚裸时钟归模块），四类编辑器的**存盘**那一路现在都吃同一份收尾时钟；`DocEditor` 还剩四枚裸 `setTimeout`
  （导出 PDF 的 1500 与批注/脚注那三句的 1800——本轮只把**存盘**那一段的收尾交给模块）；
  `SheetEditor.exportPdfTo` 那句「已导出 PDF」仍**内联抄了一份拼句公式**（`notes.length ? 5000 : 1500`，与模块里同一形状）；
  `.odoc` 的定时自动保存那一路 `catch {}` 静默（写失败不告诉任何人）；PDF 大件那 ~1030ms 仍没归因；
  中件 164ms 与门值 200ms 只差 36ms；在途锁按 `tabId` 不按 `path`；另存为撤门那一档 release 真机仍未量；
  写侧前缀三家不统一、toast 体系照旧未建

## 演示头存盘那一路终于有失败可说：三枚裸时钟收进一处（v0.72）

起点是 v0.71 收尾时自己记下的那条未勾项——「演示头的失败仍只进原生弹窗、不上状态栏，且自持三枚裸时钟
1500/2000/1500」。本轮只动**演示头**（`PptEditor` 那一路），文档/表格/PDF 三头的接线一字未动（A14/A15 把它们钉成回归判据）。
**Rust 一个字没动**（先例 v0.64~v0.71），改动全在前端那一层的一个文件。

- **前置实测先把"这一头坏在哪儿"量清楚**（release，对照件＝本轮改动前存档的那支 0.71 exe，页内时钟为唯一基准）：
  ① 可写 `.opd` 编辑后按 Ctrl+S（3 趟）`dots=[0,1,0]`、字面真落盘、「已保存」在屏 1499ms、按键→写出门 **3ms**、
  `write_text_file` 自身 **6~8ms**、`longtask` `[]` ⇒ **成功那一路本来就是对的**（与文档头 v0.71 那种"说了话却不记账"的
  锚点缺陷不同形，本轮没有去修一个不存在的问题）；② 只读件（2 趟）状态栏**全程 `[null]`**——连一句失败都没有，
  `dots=[0,1,1]`、写请求确实出过门（440+7ms），而那一枚 `#32770` 前=0 后=1 峰值=[1]：与 v0.70 给 PDF 头补的**同一格**；
  ③ 连按两次（2 趟）两趟写**不重叠**（465+5 / 1472+5），可第二句在屏只 **481~491ms**——第一趟那句裸 1500 在第二趟
  说话时把它抹掉了（`cancel` 的第二个用途在这一头第二次兑现，而且是量出来的不是搬过来的）；④ 三档夹具
  （0KB/31KB/170KB＝2/60/150 页）整趟 **5 / 8~9 / 13~14ms**、`longtask` 0 条 ⇒ **这一头连门都不挂**，
  与文档头 v0.71 同一裁决（`SAVE_BUSY_MS=200` 在这一路根本没有调用点）；⑤ 另存为…／导出 pptx…／导出 PDF
  三档要真挑一次原生对话框，本轮**显式 SKIP**（`pass=null`）而不是让"计数为零"在跳过的档上冒充判据
- **本轮没有把文档头那套"写手／动作"分层搬过来**（这是本轮唯一的架构决定，也是一处克制）：演示头的三个动作
  （`save` / `exportPptx` / `exportPdfTo`）各自直接写文件，**没有共用写手的形状**——`exportPdfTo` 走打印覆盖层、
  `exportPptx` 走 `deckToPptxBytes` + `writeBytes`，硬抽一层就是为不存在的问题建层。本轮只搬那一层里真正被复用到的东西：
  **收尾时钟与句子归模块**（v0.71 的 `base` 参数在这一头同时服务三个动作，正是那个口子）
- **失败面孔上状态栏，撤掉那枚阻塞式模态**（A6a/A6b/A8/A9 + 变异 M3）：`setStatus(failStatus(e, '保存失败'))`，
  原话留在悬停 title 里（v0.64 的规矩）；成功那一路只是把 `setStatus('已保存')` 换成 `done.show([])`，
  **界面说的话一个字没变**（R1b 判的就是这句仍是「已保存」而不是带后缀的错位说法）
- **三枚裸时钟归一处**（A3a/A3b + 变异 M1/M6）：这一层不再有"把 `setStatus` 交给裸 `setTimeout`"的写法；
  开跑先 `done.cancel()`（A4b，排在 `try` 之前）、失败也先 `done.cancel()` 再说那句（A6b）。
  **一处可见的行为变化照记不抹**：导出 pptx 那句的停留从自持的 **2000ms** 变成模块的 **1500ms**——
  两把尺子并成一把必然有一把 shorter，这是这一轮买的东西而不是附赠的副作用
- **边界（本轮没接的，判据钉住而不是顺手统一）**：`exportPptx`/`exportPdf` 两条**失败**路径仍走原生弹窗
  （A11a/A11b + 变异 M8 判"不许被顺手改成状态栏"），`setStatus('正在生成 PDF…')` 那一路一字未动（A11c）
- **A/B 的账（两支真 exe × 18 趟 / 18 断言 / 真失败 0）**：R1a 改后 `dots 1→0` 且字面真落盘、R1b 那句仍是「已保存」；
  R2c **对照件只读件状态栏全程没说任何一句**（`文本集=[]`，判据不是空的）、R2d 对照件每按峰值=[1]、
  R2e 改后弹窗 `前=后=0`、R2f 两支写请求都出过门、R2g 失败不许记账（`dots=[0,1,1]`、`landed=false`）；
  R3a 对照件第二句只活 **489/496ms**、R3b 改后走同一枚模块时钟 **1501/1506ms**、R3c 两趟写不重叠
  （改后 `[[436,7],[1444,7]]` ⇒ registry 那枚在途锁本来就管着这一头，没有回退）、R3d 屏上只有一种收尾句；
  R4a 三档一次都不闪「正在保存」、R4b 整趟 改前 `[7,8,14]` → 改后 `[8,8,14]`（都在门以内）、R4c 两支 `longtask` 全 `[]`；
  R5a 每档每趟只落一次盘 `[1,1,1]`；记账：按键→上屏 **14→12ms**、`write_text_file` 自身 `[6,7]→[6,6]ms` ⇒
  **本轮没让写侧变快**，改的是界面遇到失败说不说话、以及谁的那句话活多久；R6 十八趟页面异常 0 条
- **dev 腿只吃形状**（20 断言 / 真失败 0、页面异常 0 条）：D1a~d（● 1→0、字面独立读回文件、那句是「已保存」、
  全程没有「正在保存」）、D2a~f（失败句 + 悬停原话 + ● 留 1 + 没落盘 + 写请求出过门 + 弹窗全程 0）、
  D3a~c（两趟不重叠、第二句 **1502ms**、屏上只有一种收尾句）、D4（三档 `["已保存"]×3`）、
  **D5a~d 是本轮唯一判"分层没走样"的真机证据**——直调 `__oofPpt.exportPdfTo(path)` 之后那句是「已导出 PDF」
  而**不是**「已保存」，且 ● 从头挂到尾（`dots=[0,1,1]`，导出是另拷一份出去，不替标签记账），PDF 件真落盘 38,176 字节（独立读字节）；
  dev 里 60/150 页那两档有 68~164ms 的 `longtask`（挂 60/150 张 `StaticSlide` 的渲染，不在存盘那一路），
  而 release 三档全程 0 条 ⇒ **dev 的数字不吃，只吃形状**（v0.66 那条规矩在这一头继续成立）
- **本轮撞到三处量具坑，都不是产品**：① **dev 会话不换页 ⇒ Resource Timing 是累加的**——上一趟的写在本次取样窗口里
  以 `s<0` 照样躺在缓冲中，于是"第二趟写"这种**按枚数索引**的判据拿到的其实是上一趟的请求（D3b 第一版因此假 FAIL 报 0ms，
  而 D3a 那时是**空断言而它自己不知道**）；改成按窗口过滤（只留 `s>=0`）并把剔掉的枚数记成 `staleIpc` 摆在日志里。
  与 v0.70 那条「落定要按任何一枚 IPC 静止」同族：**按枚数索引之前，先问这些条目属不属于这一趟**；
  ② **● 的计数在 dev 会话里跨标签累加**（一趟接一趟开新标签、`Workspace` 又把它们全部常驻）⇒ 判当前活动标签
  （`.tab.tab-active .tab-dirty`），release 每趟只有一枚标签所以两种口径给出同一个数；
  ③ **变异腿抓出我自己写的一枚假绿判据**——回归判据 A14a（文档头的写手不发句子）原写
  `[...w1, ...w2].some(b => /setStatus|renameTab/.test(b))`，把**字符串摊成字符数组**，于是每条正则只在一个字符上判，
  实际只判了"那两段找得到"；M11（把句子塞回文档头写手）报 BAD 才暴露 ⇒ 修成 `!/(setStatus|renameTab|markDirty)/.test(w1 + '\n' + w2)`。
  这正是"正控制必须自己先证明会响"该干的活，本轮它是**负控制**（让变异去审判据）
- **验证（五腿 + 编译）**：release A/B 真机 **18 断言 / 真失败 0**（对照件＝改动前当场存档的那支 0.71 exe）、
  前端结构 **36 / 0**（B0a~f 自检 + A1~A15，吃的是**剥掉注释之后**的源文）、变异检查 **14 枚 + 正控制 / BAD 0**、
  CDP dev 真机 **20 / 0、页面异常 0 条**，`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63~v0.71 同一份基线
  ——Rust 本轮一个字没动），+ tsc 与 `pnpm tauri build --no-bundle` 绿（3m04s，openoffices v0.72.0）；
  五腿都在**版本号 bump 之后**跑（老规矩），结构腿与变异腿在最终源文上复跑过一次
- **本轮没动的，量出来记着**（已开进路线图）：导出 pptx／另存为那两档需要真挑原生对话框的路径 release 真机**仍未量**
  （本轮显式 SKIP，`base` 在那两路上只有结构与 dev 的证据）；`DocEditor` 的**四枚**裸 `setTimeout`（导出 PDF 的 1500、
  批注/脚注那三句的 1800）与 `SheetEditor.exportPdfTo` 内联抄的那份拼句公式照旧；`.odoc` 定时自动保存 `catch {}` 静默
  （**⇒ v0.73 改口：这一路现在会说话了**，见下一节）；PDF 大件那 ~1030ms 仍未归因；中件 164ms 与门值 200ms 只差 36ms；**演示这一头连 notes 通道都没用过**
  （`done.show([])` 三次都是空数组，所以"带说明的 5000ms 那一档"在 `.opd` 上从未被真机走到）；
  在途锁按 `tabId` 不按 `path`、写侧前缀三家不统一、toast 体系照旧未建

## `.odoc` 的自动保存不再静默：那一路该说"最近一次结果"，不是"上一次的成功"（v0.73）

起点是 v0.72 收尾时自己记下的那条未勾项——「`.odoc` 的定时自动保存 `catch {}` 静默（写失败不告诉任何人）」。
本轮只动**文档头自动保存那一路**（一个文件），**Rust 一个字没动**（先例 v0.64~v0.72）。

- **前置实测先把"坏在哪儿"量清楚**（release，对照件＝本轮改动前当场存档的那支 0.72 exe，基准只有页内 10ms 文本时间线
  与 Resource Timing）：① 可写件那一路本来就是对的（29529ms 上屏「已自动保存 16:11:20」、字面真落盘、● 归 0）
  ⇒ **本轮没有去修成功那一路**；② 只读件那一档才是缺陷，而且它不是"没话说"而是**说错了话**——整窗 0~70333ms 屏上文本
  只有「已自动保存 16:11:20」一个值，而同一窗里 `write_text_file` 出门两枚（`s=29802 d=5` / `s=59801 d=8`）、
  一次都没落盘、● 全程 1 ⇒ **那句"已自动保存"挂的是一个已经不真的时间，而界面上没有任何一处承认失败**；
  ③ 恢复可写之后屏上文本变成 `["已自动保存 16:11:20","已自动保存 16:53:17"]`——**中间那两次失败从未被说过**，
  用户只能从"时间跳了"反推刚才有一回成功了；④ 冷开一枚只读件（从没成功过）屏上文本 `["∅"]`、有字的拍数=0
  ⇒ 那一路连"过期的成功宣称"都没有，是纯静默；⑤ 两档 `longtask` 观测器 0 条、写自身 5~8ms ⇒ 这一路**根本没有慢的问题**
  （也正因如此，本轮没给它挂进度门）
- **本轮唯一的架构决定：这一路的句子是「最近一次自动保存的结果」，不是收尾句** ⇒ **不挂进度门、也不共用模块那枚
  `saveDoneTimer`**（A5a/A5b + 变异 M7/M8 把这两条钉成判据）。理由是量出来的而不是讲出来的：失败那句在实验件里
  活了 **40417ms**、一直挂到整窗末拍 70331ms——若它被 1500ms 的收尾时钟抹掉，屏上就又是那句过期的成功宣称，
  本轮修的缺陷只会换个速度复发。这一层与 v0.69~v0.72 那四头的关系是**同一份文案出处、不同的停留契约**，不是"再抽一层"
- **失败上状态栏**（A1a/A1b + 变异 M1/M4）：`setStatus(failStatus(e, '自动保存失败'))`，原话留悬停 title（v0.64 的规矩，
  A2a）；判据写的是"catch 块里必须有发句子的动作"（A1b）而不是"不许出现 catch"——后者会把"仍然自然重试"那条设计顶掉
- **失败不许记账**（A3a/A3b + 变异 M2/M3）：`markDirty` 与 `setAutoSavedAt` 都只在 `writeText` 之后、`try` 之内
  ⇒ 只读件上 ● 全程 1（C/E-R2c），下一枚 30 秒仍然重试；"失败仍静默重试"是原设计，本轮没有取消它，
  只是不再让它成为唯一的动作
- **只撤自己那一句**（A4a/A4b/A4c + 变异 M5/M6，本轮第二件必须写进结构的事）：成功那一路撤句走身份比较
  `setStatus((cur) => (cur === mine ? '' : cur))`，`mine` 记在 `autoStatusRef` 里（失败置 msg、成功置空）。
  手动存盘的「已保存」不归这一路撤——v0.65「迟到那一趟不许抹活着一趟」在定时那一路的形状。
  dev 腿 D4a 判的就是这一点没被改坏：手动 Ctrl+S 之后屏上仍是「已保存」@212ms，而自动保存那一路撤的是自己那句
  （**⇒ v0.76 改口：`autoStatusRef` 已经换成按路径认领的 `saveFailRef: FailureClaim | null`，撤句权从"谁写的这句"
  改成"这句话说的是哪个文件"**——同一格的失败句若是手动那一路写上去的，定时这一路以前不认它，
  于是权限改回来、文件真的又存上了，屏上仍挂着「保存失败」达 20614ms 而「已自动保存」一次都没上屏；
  身份比较那一半原样保留，只是 `mine` 现在由 `staleFailureClaim(claim, path)` 按路径给。见 v0.76 一节）
- **状态栏那一格的门没动**（A7a/A7b）：「已自动保存 X」仍挂在 `!status` 之后 ⇒ 失败那句非空时**顺手把过期的成功宣称
  挤掉**，本轮没有新增第二处发句子的地方（屏上文本集从 `["已自动保存 …"]` 变成 `["自动保存失败: …"]` 就是这一条的实测：
  D2f / E-R1c）；60 秒那一路自动快照（`pushHist`）本轮一字未动（A8d）
- **A/B 的账（两支真 exe × 四段 / 32 断言 / 真失败 0）**：C-R1a/C-R1b 判的是**对照件**（只读窗口全程没有失败句、
  那句过期的成功宣称挂到窗口末尾 70320ms）、C-R3a 对照件恢复前后屏上始终只有「已自动保存」而**中间那次失败界面从未承认**
  ⇒ 三条成立才说明本轮买到的不是判据空转；E-R1a 失败句首拍 **29914ms**（就是那枚 30 秒时钟的第一次咬合）、
  E-R1b 悬停原话 `failed to open file at path: …`、E-R1c 失败首拍之后那句过期时间不再出现、E-R2d 活了 **40417ms**；
  E-R3a 恢复可写后**失败末拍 19571ms 与成功首拍 19581ms 相邻**（"只撤自己那句"的真机证据）、E-R3b `X73A3` 真落盘且 ● 归 0；
  冷开只读 E-R4a 首拍 29263ms、E-R4b 活到整窗末拍 70330ms（不是闪过一下）、E-R4d `longtask` 0 条；
  两支写请求各出门 2 枚、都一次没落盘、编辑之后 ● 全程 1；C-R5/E-R5 全程页面异常 0 条。
  记账：**这一路本来就不慢（写自身 5~8ms），本轮没有让任何东西变快**，改的是它遇到失败说不说话、以及那句话说的是哪一次结果
- **dev 腿只吃形状**（13 断言 / 真失败 0、页面异常 0 条）：D1a（29542ms 上屏 + 真落盘 + ●=0）、
  D2a~f（失败整串中文归因「这个位置不让写：可能是没有权限（比如往系统目录里存）、文件被设成了只读，或者那个路径其实是个文件夹。」
  + 悬停 `os error` 原话 + ● 全程 1 + 一次没落盘 + 一枚写请求 `[29961,7]` 确实出门 + 失败后旧时间不再出现）、
  D3a/D3b（恢复可写：成功那拍之后失败句不再回来，26658ms、真落盘、●=0、屏上换成新的时间）、
  **D4b 判的是闸门没被改宽**——手动存盘之后那 35 秒里 `write_text_file` 枚数=0（不脏就不写，这一条本轮一个字没动）；
  dev 与 release 的耗时差一个数量级这一族规矩（v0.66）本轮同样照守
- **验证（五腿 + 编译）**：release A/B 真机 **32 断言 / 真失败 0**（对照件＝改动前当场存档的那支 0.72 exe）、
  前端结构 **35 / 0**（B0a~f 自检 + A1~A13，吃的是**剥掉注释之后**的源文；A8a~A8f 与 A9a~A9c / A10a / A10b / A11a /
  A12 / A13 全是回归判据——本轮没动文档头手动存盘那两层、演示头 v0.72 的接线、表格头 v0.69、PDF 头 v0.70、
  registry 那层与模块里那枚收尾时钟）、变异检查 **18 枚 + 正控制 / BAD 0**、CDP dev 真机 **13 / 0、页面异常 0 条**、
  `cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63~v0.72 同一份基线——Rust 本轮一个字没动），
  + tsc 与 `pnpm tauri build --no-bundle` 绿（3m42s，openoffices v0.73.0）；五腿都在**版本号 bump 之后**跑（老规矩）
- **本轮撞到三处量具坑，都不是产品**：① **上一趟留下的只读夹具会让复制自己失败**——`chmodSync(0o444)` 之后那枚件留在盘上，
  下一次 `copyFileSync` 到同一路径直接 `EPERM: operation not permitted, copyfile`（A/B 腿在 D 段起跑前就崩，
  现场和"产品坏了"长得一模一样）⇒ 复制前先把目标**解权再删**（`freshCopy`）。同族的一条在收尾：dev 腿跑完
  `target/debug/openoffices.exe` 还活着而 `sweepOrphans()` 报 `killed=0`——它的 scope 只按 `tmp\x73\*` 的路径与 9273
  那枚**命令行参数**匹配，可 dev app 的路径在 `src-tauri/target/debug/`、端口标志只出现在 `msedgewebview2` 子进程的
  命令行上 ⇒ 只能核对路径确实属于本项目之后按**显式 PID** 收（依然不碰已装正式版）；② **窗口型判据的起点必须锚在
  触发那一下之后**——"编辑之后 ● 全程 1"若按整窗算，就把编辑之前那段正常的 `dots=0` 算了进去（D2c 第一版因此假 FAIL）
  ⇒ 取样器要能在编辑那一刻记一个 `mark()` 时刻并据此切窗；③ **"恢复窗口不许有失败句"这条判据不成立**——那枚持久句
  在恢复窗口的头若干拍里合法地还挂着（它说的正是上一轮的结果），只能判"成功那一拍之后失败不再回来"
  （E-R3a 与 D3a 同一形状）。与 v0.72 那条"按枚数索引之前先问这些条目属不属于这一趟"同族
- **本轮没动的，量出来记着**（已开进路线图）：**另外三头没有任何定时自动保存**（全仓 `setInterval` 只有 `DocEditor`
  的 30 秒那一路 + 60 秒快照 + `Presenter` 的 1 秒计时器显示 ⇒ 表格/演示/PDF 上"挂着不动就自己存了"这件事**根本不存在**，
  那是功能缺位不是文案问题，要不要做先得定"未命名与 foreign 格式能不能静默写盘"）；「已自动保存 X」那一句仍**没有悬停**、
  也没有任何次数账（这一路失败了几回、重试过几回，屏上看不出来）；30 秒定时**无退避**（只读件上它每 30 秒咬一次、
  每回都失败、每回都发一枚写请求，本轮既没加退避也没加"连续失败就停"）；后台常驻标签**各自挂自己的 interval**
  （N 枚 `.odoc` 就有 N 枚 30 秒时钟，与 v0.68 那条"标签全部常驻挂载"同族而本轮没盘它）；`DocEditor` 剩四枚裸
  `setTimeout`（导出 PDF 的 1500 与批注/脚注三句的 1800）、`SheetEditor.exportPdfTo` 内联那份拼句公式、
  PDF 大件 ~1030ms 仍未归因、中件 164ms 与门值 200ms 只差 36ms、另存为／导出 pptx 两档 release 真机仍未量、
  演示头 `notes` 通道从未被真机走到、在途锁按 `tabId` 不按 `path`、`SAVE_BUSY_MS=200` 是单机数、
  写侧前缀三家不统一、toast 体系照旧未建

## 定时那一路走在途锁之后：`.opd` 也上自动保存，两枚写不再抢同一格（v0.74）

起点是 v0.73 收尾时新开的那条未勾项——「另外三头没有任何定时自动保存」。本轮只动**前端那一层的三个文件**
（`lib/registry.ts` + `DocEditor.tsx` + `PptEditor.tsx`），**Rust 一个字没动**（先例 v0.64~v0.73）。

- **前置实测把"另外三头要不要定时"和"`.odoc` 的定时有没有隐患"一次量清**（release，对照件＝本轮改动前当场存档的那支 0.73 exe）：
  ① grep 全仓 `setInterval` ⇒ 只有 `DocEditor` 的 30 秒 + 60 秒快照 + `Presenter` 的 1 秒显示计时，
  演示/表格/PDF 三头**根本没有这一路**；② 真正的隐患在**已存在的那一路**上——装页内 `fetch` 拦截器在**定时那枚写刚出门**的瞬间
  打字并发 `Ctrl+S`（三趟），**两枚 `write_text_file` 在同一毫秒各发一次**（`start` 差 0ms、`dur` 各 12~15ms）、
  **文件里含上一段 `X74BnA` 而不含迟到那半句 `X74BnLATE`**——屏上「已保存」说了、新打的东西被旧快照盖掉，
  三趟全重现（`重叠=3 / 丢=3`）；③ 而这一路本身**不慢**（`write_text_file` 自身 5~8ms、`longtask` 0 条）⇒
  **本轮修的不是"存盘慢"而是"存错"**——v0.69 那枚在途锁管着 `saveTab`，可 `DocEditor` 的定时那一路是**直接调 `writeText`**、
  从来没走 registry 那一层，两条写手在同一 `tabId` 上并发而赢家不保证是晚的那一个
- **本轮唯一的架构决定：给 registry 加一枚 `runExclusive(tabId, fn)`——共享 `running`/`again` 但**不共享句子**（
  A1a/A2a + 变异 M1/M10 把这一条钉成判据）：锁空闲 ⇒ 跑 `fn`；锁忙 ⇒ **本趟跳过**（手动那趟的快照本来就更新、
  它落完就是最新内容存了盘，30 秒后下一趟再来）；`fn` 落定时 `again` 已被置位（在途时用户按了 `Ctrl+S`）⇒
  **交回 `drain(tabId, saver, asNew)` 补跑**——不补就是吃掉用户那一下，锁不卡死但事没做。这一层与 v0.69 的
  `saveTab`/`drain` 是同一把 `running` `Set`，"同一标签不并发写"这条不变量现在同时管到手动与定时两路
- **`.odoc` 那一路改吃 `runExclusive`**（A2a/A2b）：`setInterval` 里从 `try { writeText … } catch { setStatus }`
  改成 `await runExclusive(tab.id, async () => { try { … } catch { … } })`，**v0.73 的四条规矩一个字没改**
  （不脏就跳过、只在 `writeText` 之后 `markDirty+setAutoSavedAt`、成功那一路走身份比较只撤自己那句、
  失败上状态栏且仍自然重试）——A3a/A4a/A4b/A4c/A5a/A5b 把这六条钉成回归判据、M2/M3 是它们的负控制；
  这一路的句子仍是"最近一次自动保存的结果"而**不是收尾句**，所以既没挂进度门也没共用 `saveDoneTimer`
- **`.opd` 新增定时自动保存**（A5c/A5d/A5e/A6a~A6g，本轮的"另一半"）：照 `.odoc` 那一路的四条规矩逐条对齐，
  外加两条这一头特有的东西：① `deckRef`——React 的 `deck` 每敲一字都在换 state，直接进 `useEffect` 依赖数组
  会让每枚按键都重建 interval（定时器永远等不到 30 秒），所以走 ref 读最新那份快照；② `dirtyRef.current = false`——
  `PptEditor` 的 `edit()` 有个既有优化"只在第一次编辑时 `markDirty(true)`"，而它**从来没被复位过**：手动 `save()`
  里 `renameTab` 清了 store 的 `dirty` 却没清 `dirtyRef`，于是手存之后的下一次编辑不会重新上 ●（本轮只在**定时**的
  成功那一路补了自己这一份 `dirtyRef.current = false`；**手存那一路的既有缺陷没动**，记进路线图
  ——**⇒ v0.78 改口：这道闸连同那两份复位一起拆了**，因为它量出来不止"● 不亮"而是**手存成功之后整条编辑链断电**
  （定时不再发、焦点探写被同一枚门挡住、晚打的字面永远不落盘而屏上说「已保存」），见 v0.78 那一节）；
  状态栏两层 `{!status && autoSavedAt && <span>已自动保存 X</span>}` 也照 `.odoc` 那份对齐（A7a/A7b）
- **A/B 的账（两支真 exe × 8 趟 / 16 断言 / 真失败 0）**：**B1** `.odoc` 相遇——对照件两枚写同毫秒各发一次
  `[[0,1,0]]` 且迟到内容没落盘（`A=true 迟到=false`），改后两枚 `start` 差 18ms、第一枚 `end=…926` 早于第二枚
  `start=…930`（不重叠）且迟到内容真落盘（`迟到=true`），两趟都成立；**B2** `.opd` 相遇——**对照件 45 秒里探针一次没响、
  写清单 `[]` ⇒ "根本没有这一路"这一件事被探针的空手证明**（`probe===null` 从"没测到"变成"证明了没有"），
  改后两趟 `重叠=[] 迟到=true` 且时间线是「已自动保存 X」→「已保存」→「已自动保存 X」（手动那趟的收尾吃完模块那 1500ms
  之后自动保存那句回来了——v0.73 的"只撤自己那句"在 `.opd` 上同样成立，`dots` 也走 0→1→0）；**B3** `.opd` 只读件——
  对照件整窗 70 秒文本集 `[""]` 而 `write_*` 枚数=0（既没有句也没有请求，因为根本没有 timer 这一路 ⇒ 判的是对照件自己），
  改后文本集 `["","自动保存失败: 这个位置不让写：…"]`、`write_text_file` 出门两枚（`s=831865 d=9` / `s=861865 d=7`
  正好差 30 秒——失败不许记账 + 下一轮自然重试）、● 全程挂 1；**B4** 八趟页面异常 0 条。
  记账：**这一路本来就不慢（5~15ms），本轮也没让它变快**，买的是"两枚写不再抢同一格"与"`.opd` 有了这一路"
- **dev 腿只吃形状**（9 断言 / 真失败 0、页面异常 0 条）：D1a~c（`.opd` 可写件 29538ms「已自动保存 X」上屏、
  独立读回文件含编辑字面、● 归 0）、D2a~c（`.opd` 只读件失败那句上屏、● 全程挂 1、按窗口过滤后 write 枚数 ≥1）、
  **D3a~b**（`.odoc` 相遇形状在 dev 上重现——dev 会话里 Resource Timing 是累加的，六枚 write 里最后两枚
  `s=166836/s=166862` 差 26ms 不重叠、迟到内容真落盘）；dev 里 D2 的文本集合法地混着 D1 那趟留下的「已自动保存 21:06:52」
  （`Workspace` 标签常驻 ⇒ 新 tab 不冲旧 tab 的状态栏文本），判据只判"里有失败那句"而不判"整窗只有一句"；
  与 release 差一个数量级那条老规矩（v0.66）照守——**dev 的数字不吃，只吃形状**
- **验证（五腿 + 编译）**：release A/B 真机 **16 断言 / 真失败 0**、前端结构 **37 / 0**（B0a~f 自检 + A1~A13，
  吃的是**剥掉注释之后**的源文；A8a~A8f 与 A9a~A9c / A10 / A11 / A12 / A13 全是回归判据——本轮没动文档头手动存盘那两层、
  演示头 v0.72 的接线、表格头 v0.69、PDF 头 v0.70、模块里那枚 `saveDoneTimer`）、变异检查 **11 枚 + 正控制 / BAD 0**、
  CDP dev 真机 **9 / 0、页面异常 0 条**、`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**
  （与 v0.63~v0.73 同一份基线——Rust 本轮一个字没动），+ tsc 与 `pnpm tauri build --no-bundle` 绿
  （openoffices v0.74.0）；五腿都在**版本号 bump 之后**跑（老规矩），结构腿与变异腿在最终源文上复跑过一次
- **本轮撞到三处量具坑，都不是产品**：① **对照件 45 秒空手就是判据本身**——B2 改前那趟探针一次没响、写清单 `[]`，
  第一直觉是"腿没跑对"，其实它证明的是"这一头根本没有 `setInterval` ⇒ 没有定时写"这个功能缺位的形状；
  于是把 `probe===null` 从"腿崩了"改成一条 PASS 判据（B2a-before）——判"没有"与判"有"共用同一枚探针；
  ② **结构腿切片的终点不能撞上按 `save()` 那一路**——第一版 `pptTimer = ppt.slice(0, indexOf('30_000'))`
  把 `save()` 里 `done.show / done.cancel` 一并吃了进来，A8c 假 FAIL 报"演示头共用了收尾时钟"（其实没有），
  改成从 `lastIndexOf('useEffect', indexOf('30_000'))` 起切才只对 up 那一段——与 v0.73 那条"切片终点不能是被本枚变异改动的文本"
  同族，**判"这一段里没出现 X" 之前先问这段真的只包含那一段吗**；③ **single-instance 转发的守卫已经成熟**——
  `waitInstancesGone` 在起跑前用 `Get-CimInstance` 列出本项目路径下的实例并按显式 PID `taskkill /T /F`，
  本轮 8 趟 A/B 没撞一次"两枚 exe 争同一份窗口"的现场，v0.73 记的那条 `EPERM copyfile` 也被 `freshCopy` 的
  chmod→unlink→copy 稳住了
- **本轮没动的，量出来记着**（已开进路线图）：**表格/PDF 二头仍然没有任何定时自动保存**——不是没测到而是**判过不做**：
  `.xlsx`/`.ods`/`.csv` 是 foreign 格式、静默重序列化会丢保真（v0.34 的 CSV 只存首表、v0.46~v0.63 的 xlsx/ods 往返都在
  逐属性对齐第三方应用），"挂着不动就自己存了"这件事在**保真契约**上先要一个答复；PDF 的标注写回走 pdf-lib 的
  `save` 而**改的是文件本体**、静默一遍遍重写会让每一次都在改字节（v0.70 实测大件整趟 1150ms，中件 164ms 已经与
  200ms 那道门只差 36ms ⇒ 定时重跑必然撞上"跨机器翻脸"的那一档）；`.opd`/`.odoc` 的 30 秒定时无退避、无次数账、无悬停
  （**⇒ v0.75 改口：这三样都补上了**——退避翻倍到 240 秒封顶、失败那句带「第 N 次」、成功那句的悬停第一次有会话账，
  实测同一个 240 秒窗由 8 枚注定失败的写请求降到 3 枚）；
  N 枚 `.opd`+`.odoc` 标签 ⇒ N 枚 30 秒时钟（`Workspace` 常驻挂载那一条同族而本轮没盘它）；
  **`PptEditor` 手存之后 `dirtyRef` 未清**（本轮只在定时的成功那一路补了自己那一份；**⇒ v0.78 拆闸时这枚 ref 整个不存在了**）、
  `DocEditor` 剩四枚裸 `setTimeout`（导出 PDF 1500 与批注/脚注三句 1800）、`SheetEditor.exportPdfTo` 内联那份拼句公式、
  PDF 大件 ~1030ms 仍未归因、在途锁按 `tabId` 不按 `path`（两个标签同一文件仍能并发写，而 `openTab` 的路径去重让这形状
  正常操作里撞不上）、`SAVE_BUSY_MS=200` 是单机数、写侧前缀三家不统一、toast 体系照旧未建；
  自动更新的应用内下载安装与 macOS 打包按指令继续等信号

## 定时自动保存不再"明知不行还一直敲"：退避与会话账归一处（v0.75）

起点是 v0.74 收尾时新开的那条未勾项——「「已自动保存 X」这一路没有任何次数账，也没有退避」。本轮只动**前端那一层的三个文件**
（新建 `lib/auto-save.ts` + `DocEditor.tsx` + `PptEditor.tsx`），**Rust 一个字没动**（先例 v0.64~v0.74）。

- **前置实测把"挂着不动这一路在干什么"量成一张次数账**（release，一枚只读的 `.odoc` 挂着 4 分钟，基准=页内 10ms 文本时间线 + Resource Timing）：
  编辑之后 `dots=1`@757ms，之后**注定失败的 `write_text_file` 出门 8 枚**，时刻
  `[30255, 60251, 90259, 120258, 150254, 180255, 210247, 240244]` ⇒ 相邻间隔全是 30.0 秒（漂移 ≤9ms），
  而每枚自身只有 **5~14ms**；那一句「自动保存失败: 这个位置不让写：…」从 30436ms 一直挂到解权那一刻（240856ms），
  解权之后**还要再等 29.4 秒**才落第一枚盘（270254ms 出门、屏上换成「已自动保存 21:42:13」）⇒
  **这一路挂着的不是慢，是"明知不行还一直敲"**：四分钟里 8 枚 IPC 换 0 次落盘，而且界面对"敲了几回"一个字都不报
  （v0.73 那次只补了"失败要不要说话"，这一轮问的是"说了之后重复多少遍、以及说了哪一遍"）
- **本轮唯一的架构决定：把这一路的账做成一枚按标签持有的账本，退避延迟由账给而不是由时钟常数给**
  （新建 `src/lib/auto-save.ts`，A1a/A1b/A2/A3a/A3b/A3c/A4a + 变异 M1/M4/M5/M6/M9 钉成判据：M4 把翻倍公式换成裸常数、
  M5 让 `clearBackoff` 顺手记一次成功、M6 让 `noteSuccess` 不清连续账、M1/M9 把文档头那两枚进账各删一枚）——
  「文案与时钟只写一处」那条先例的**第八次**兑现，也是它第一次落在一条**没有人按键**的路上
  （v0.54 纸上账目 → v0.64 失败归因 → v0.65 密码提示 → v0.66 搜索进度 → v0.69/0.70 存盘进度与收尾 →
  v0.71 收尾句的动作名 → v0.72 演示头的三枚并一 → v0.75 定时的退避与次数账）：
  `AUTO_BASE_MS = 30_000` 是被实测保住的基数（v0.69 起就是这一枚，A1a 判"基数没被顺手改"）、
  `AUTO_MAX_MS = 240_000` 由上面那 8 枚定出来（翻倍到 240 秒封顶后同一个 4 分钟窗只剩 3 枚：30/90/210 秒）、
  `autoDelayMs(fails) = min(30_000 * 2**fails, 240_000)`；**没有做成"连续失败 N 次就彻底停"**——停掉之后用户把权限改回来
  也再也存不上，而 4 分钟一枚已经不打扰人
- **账必须一份一份造**（A4a + A34 + 变异 M16）：`createAutoSaveLedger()` 是工厂，组件用 `useRef` 拿着，**不许做成模块级单例**——
  `Workspace` 把开过的标签全部常驻挂载（v0.68 那条），共享一份账会让 A 件的失败把 B 件的时钟推后，
  那是"这一路挂着不动"之外**新的一种串台**；本轮第一次动 N 枚时钟这一格的方向（不是把时钟并掉，而是让每一枚时钟各自退避）
- **`setInterval` 因此换成自续的 `setTimeout`**（A7a/A7b/A8a/A8b/A18a/A18b/A19 + 变异 M3/M10：两头的时钟尾参各被换回裸的
  `30_000` 一枚，两条判据一起响——"延迟由账给"这件事在两头都不是嘴上说的）：
  这不是审美——一枚固定周期的 interval **装不下一个会翻倍的下一次**，`30_000` 写在两处就是两把尺子（A7b 判组件里不再出现裸的 30 秒常数，
  A8a 判得比"串里出现过 `autoDelayMs`"更严：**必须是那一枚 `setTimeout` 调用的尾参**）；跑完再挂下一枚（不等墙钟排一串，
  否则失败那一路的延迟会被前一次的排队吃掉）、卸载后不再挂（`stopped` 那道门 + `clearTimeout`），
  60 秒那一路的版本历史快照仍是 `setInterval`（A17 判"本轮没动文档头那四枚裸时钟"）；
  **锁忙那一趟不进退避的账**——`runExclusive` 跳过时 `fn` 根本没跑，`noteFailure` 也就没被调用
  （"这一趟没跑"与"这一趟跑坏了"是两件事，v0.74 的语义在这里继续成立）
- **两句话各归一处**（A5/A6/A10b/A10c/A16/A21/A26 + 变异 M2/M8/M12/M17）：失败那句 =
  `autoFailStatus(e, fails, nextDelay)` = `failStatus(e, '自动保存失败（第 N 次）')` **再多一行「X 秒后自动重试」**
  （v0.64 那两行规矩之上第一次加"什么时候再试"，可见那行仍由 `statusText` 出、原话与重试时间仍进 `title`），
  组件里**不再自己抄那份文案**（A10c）；成功那句的悬停第一次有账——`autoOkTip(l)` =
  「本次会话自动保存：成功 N 次 · 失败 M 次 · X 秒后再检查」，这是 v0.73 量到的那一格空 `title` 的补法
  （那一轮只说了"失败过几回屏上看不出来"，本轮把账留在**撤掉之后还看得到**的地方）
- **v0.73 那一刀原样成立、且这一轮由判据钉住**（A14/A24/A30b）：这一路仍**不挂进度门、不共用 `saveDoneTimer`**——
  共用 `failStatus` 那一层而不共用停留；`lib/auto-save.ts` 自己不吃那枚收尾时钟（A30b）、只吃 `lib/fail-msg.ts`（A30c）
- **手动存盘成功要做两件事，而不是一件**（本轮补的那半条，A15/A35/A36/A37/A28b + 变异 M7/M22/M23/M24/M25）：
  `auto.clearBackoff()` **并且** `autoRescheduleRef.current?.()`。理由是量出来的：账只管"下一枚隔多久"，
  而**已经在途的那一枚最坏还要再等 240 秒**（实测封顶那枚间隔 240009ms）⇒ 只归零账不重挂，用户按下 Ctrl+S 之后
  定时那一路仍挂在长的那枚上（实测那种形状要等 ≈218 秒）。通道由定时效果交出（`autoRescheduleRef.current = () => { … clearTimeout … schedule() }`）、
  卸载时收回（`= null`，A37 两头各一份）；**手动那一趟不算进自动保存的次数账**（A3c 判 `clearBackoff` 只做 `this.fails = 0`、
  不碰 `okTotal`，E5c/D4d 判真机上那句仍报"失败 4 次 / 2 次"）——那句「已自动保存」说的只能是真的自动保存过
- **两头共吃同一套**（A28/A28b + 变异 M22）：`.opd` 那一路（v0.74 才有）与 `.odoc` 那一路逐条对齐，
  延迟、账、两句话一律走同一模块；A28/A28b 是那一族"不许只落在一家"的判据——M1/M2/M3/M9/M10/M12 每删一头都连带命中 A28，
  而 M22（把演示头手动存盘那两件事整段删掉）同时报 A25/A28b/A36 三条 ⇒ 这一套在两家都被盯着
- **A/B 的账（两支真 exe × 240 秒/470 秒两窗 / 27 断言 / 真失败 0）**：先立两枚**长跑腿的自我评价**——
  **C0/E0 判"编辑真的把标签弄脏了"**（`press=695/732ms`、`dots=1`），因为这一轮整窗都是窗口型判据，
  触发没落的话下面每一条都在量一个不存在的窗口（详见下面的量具坑①）；
  对照件（0.74）那侧 **C1a 只读窗内 8 枚** `[30282,60278,90290,120284,150280,180284,210289,240282]`、
  **C1b 相邻间隔全是 30 秒**（29993~30012ms ⇒ "无退避"被数出来而不是被说出来）、
  **C2a/C2b 整窗只有一种失败句子且不带「第 N 次」也不带「秒后自动重试」**、**C2c 那一句一直挂到解权前**（跨度 240002ms）、
  **C3 失败期间 ● 全程挂**、**C4 独立读盘一次都没落**、**C6 成功那句的悬停是空串**（`tip=""` ⇒ v0.73 那条"没有次数账"到本轮为止）；
  实验件（0.75）**E1a 同一窗只剩 4 枚** `[30280,90287,210300,450309]`、**E1b 间隔逐枚翻倍并封顶** `[60007,120013,240009]`、
  **E1c 第一枚仍是 30 秒档**（press→首枚 29548ms ⇒ 基数没动）、**E1d 同一个 240 秒窗内 8 枚 → 3 枚**、
  **E2a 失败句按次数推进**（第 1/2/3/4 次各一处且按序）、**E2b 每句都带下一次时间且第四句封顶**（60/120/240/240 秒）、
  **E2c 原话仍在悬停里**（v0.64 的规矩没被新行挤掉）、**E3 退避期间 ● 仍全程挂**（退避不许把失败记成已存）、
  **E4 四枚出门而一次都没落盘**、**E5a 恢复后手动 Ctrl+S 说「已保存」且 ● 归 0 且真落盘**、
  **E5b 重挂生效**（再编辑之后 **28870ms** 下一次自动保存就出门并落盘——不重挂那一枚在途的长时钟要等约 218 秒）、
  **E5c/E5d 成功那句带会话账**（「本次会话自动保存：成功 1 次 · 失败 4 次 · 30 秒后再检查」）、
  **E6 每枚写自身仍是毫秒级** `[5,6,4,8,5,5]`、E7 两窗页面异常 0 条；
  **C5 是本轮唯一一处"改后可能变慢"的账**：对照件解权后 29658ms 就成功，实验件封顶那一枚要等 240 秒——
  这一条正是 `autoRescheduleRef` 那一半的由来，而它由 E5b 在真机上翻回 28870ms；
  记账：**这一路本来就不慢（写自身 4~14ms），本轮没让任何东西变快**，买的是"4 分钟里 8 枚 → 3 枚"、
  "那句话说的是第几回"以及"成功之后那一格里第一次有账"
- **dev 腿只吃形状**（16 断言 / 真失败 0、页面异常 0 条）：D0（编辑真把**当前活动标签**弄脏，`press=2254 dots=1`）、
  D1a~e（第一枚失败句带「第 1 次」+ 悬停里既有 `os error 5` 原话也有下一次时间 + 独立读盘没落 + 写请求确实出过门 + ● 全程 1）、
  D2a~d（次数推进到「第 1、2 次」、**首两枚间隔 60019ms**（>45 秒 ⇒ 不是 30 秒那枚，形状而非数字）、两枚都出门仍一次没落盘）、
  D3a（手动 Ctrl+S 92448ms 说「已保存」且 ● 归 0 且真落盘）、**D4a~d（手动那一路之后自动保存回到 30 秒节奏：28992ms、
  真落盘、成功句带「成功 1 次 · 失败 2 次 · 30 秒后再检查」，而手动那一趟没被算进自动保存的账）**、D5 页面异常 0 条；
  dev 里按窗口过滤剔掉的旧条目记成 `staleIpc=3` 摆在日志里（v0.72 那条"Resource Timing 在 dev 会话里是累加的"照守），
  与 release 差一个数量级那条老规矩（v0.66）继续成立——**dev 的数字不吃，只吃形状**
- **本轮撞到四处量具坑，都不是产品，而第一处最贵**：① **长跑腿必须先判"自己那一枚触发落没落"**——
  A/B 第一版报 **PASS 10 / FAIL 15**，15 条 FAIL 全是量具：`press` 那段 IIFE 在采样器装好**之前**就 deref `window.__a75`
  ⇒ 抛 TypeError ⇒ **CDP 的 `returnByValue` 把 rejected promise 的拒绝理由序列化成 `{}`**（不报错，只给你一个空对象），
  于是判据拿到 `undefined`、`filter` 出 0 枚写，而同一趟的日志明明在报"8 枚"；
  `mark(k)` 写成 `{t,k}` 的 shorthand ⇒ 页内 ReferenceError ⇒ `reviveAt`/`manual` 静默变 `null`（屏上那句「已保存」是真的上过）；
  编辑器就绪的选择器少一枚引号 ⇒ 每档盲睡 90 秒。修法是把 `INSTALL` 排在打字之前、`k:'${k}'` 插值、选择器补引号、
  `press` 交回数值，并**新立三枚 C0/E0/D0 守卫**；教训：**静默的空窗口比崩溃更贵**——崩了会停下来，
  而空窗口会把"我没量到"报成一条判据；与 v0.72 那条「按枚数索引之前，先问这些条目属不属于这一趟」同族而更进一层：
  **按窗口取值之前，先问这一趟的触发真的发生过吗**；② **`.ps1` 里的引号必须是 ASCII**——killdev 那枚模板写进了全角引号，
  PowerShell 5.1 直接 ParserError（v0.66 那条老规矩自己违反了一次）；③ **`powershell -Command` 里的 `$out` 会被 Git Bash 吞**
  ⇒ 进程守卫写成 `psproc.ps1` 用 `-File` 调（同族第三条）；④ 一条没修的量具瑕疵照记：进度日志那行
  `E reEdit+1790865641s` 把 `Date.now()` 与页内时钟混在一起打（判据本身一直用页内时钟，只有回显那句不认单位）
- **验证（五腿 + 编译）**：release A/B 真机 **27 断言 / 真失败 0**、前端结构 **54 / 0**（B0a~d 自检 + A1~A37，
  吃的是**剥掉注释之后**的源文；A11/A12/A13/A14/A22/A23/A24/A29/A30a~c/A31/A32/A33 全是回归判据——v0.73 的"只撤自己那句、
  不脏就不动手、在途锁、不挂门"四条、v0.74 的 `dirtyRef` 与 `runExclusive`（**⇒ v0.78 起这一族里只有 `runExclusive` 还在，
  `dirtyRef` 随那道闸一起拆了，当时的 A22/A23 换成 A1b/A2a/A3a 三枚"不再有这枚 ref 而标签的账仍被清"的判据**）、
  表格头 v0.69、PDF 头 v0.70、registry 那一层、
  模块里那枚 `saveDoneTimer`、文档头手动存盘那句失败都没被顶掉）、变异检查 **25 枚 + 正控制 / BAD 0**、
  CDP dev 真机 **16 / 0、页面异常 0 条**，`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**
  （与 v0.63~v0.74 同一份基线——Rust 本轮一个字没动），+ tsc 与 `pnpm tauri build --no-bundle` 绿
  （openoffices v0.75.0）；五腿都在**版本号 bump 之后**跑（老规矩），结构腿与变异腿在最终源文上复跑过一次
- **本轮没动的，量出来记着**（已开进路线图）：**N 枚标签仍各挂自己的时钟**（本轮只是让每一枚自己退避，没把 N 枚并成一枚——
  后台常驻的只读件仍会各敲各的，只是每枚都敲得少了）；**解开权限之后界面不会立刻再试一次**（拉回节奏的唯一动作是手动 Ctrl+S，
  没有"窗口重新获得焦点就探一次"那一路，不改权限干等最坏 240 秒——**⇒ v0.77 把这一路做了**：信号真的会到，
  只是不在 DOM 那一层而在 `getCurrentWindow().onFocusChanged` 那一层，见 v0.77 那一节）；`AUTO_MAX_MS=240_000` 与 `AUTO_BASE_MS` 一样是**本机单机的数**
  （那 8 枚/4 分钟那笔账没跨机器复核过），与 `SAVE_BUSY_MS=200` 同一类待复判；**会话账只在内存里**（关标签即没，
  也不写进版本历史那一趟）；**失败挂着的期间看不到总账**（悬停账挂在成功那一句上，而失败那句挤掉它时只带"第 N 次"与下一次时间——
  这一条是本轮的取舍而不是遗漏）；`.xlsx`/`.ods`/`.csv` 与 PDF 二头仍判过不做定时自动保存（保真契约那一句仍未答复）；
  **`PptEditor` 手存之后 `dirtyRef` 未清**（**⇒ v0.78 不是补这一份复位而是把整道闸拆了**，量出来它让手存成功之后
  整条编辑链断电，见 v0.78 那一节）、`DocEditor` 剩四枚裸 `setTimeout`（导出 PDF 1500 与批注/脚注三句 1800）、
  `SheetEditor.exportPdfTo` 内联那份拼句公式、PDF 大件 ~1030ms 仍未归因、在途锁按 `tabId` 不按 `path`、
  写侧前缀三家不统一、toast 体系照旧未建；自动更新的应用内下载安装与 macOS 打包按指令继续等信号

## 那句「保存失败」说的是哪个文件：恢复之后界面必须承认（v0.76）

起点是 v0.75 收尾时自己记下的那两条未勾项——「解开权限之后界面不会立刻再试一次」与「失败挂着的期间看不到总账」。
本轮只动**前端那一层的三个文件**（`lib/auto-save.ts` + `DocEditor.tsx` + `PptEditor.tsx`），**Rust 一个字没动**
（先例 v0.64~v0.75）。

- **前置实测① 先把"能不能不等下一枚时钟"判掉**（`tmp/x76/probe.mjs` / `probe2.mjs`，release 真机 + CDP）：
  把窗口失焦再找回来的整段事件挂上观测器，量到的是 **只有 `blur` 上账（1 条），`focus` 一次都没有、
  `visibilitychange` 从不触发**，而 `document.hasFocus()` 按 200ms 轮询能读到 1→0→1 的变化⇒
  **"窗口重新获得焦点就立刻探一次"这一路在页面里没有可用的信号**，要做必须先走 Rust 的窗口事件
  （`onFocusChanged` 那一层），本轮没有开那一层，于是这条未勾项从"没做"改口成"页面这一侧做不了"
  ——**⇒ v0.77 改口：那句"做不了"量错了对象**。观测器挂在 DOM 那一层（`window` 的 `focus`/`blur`/`visibilitychange`），
  那一层在 WebView2 里确实一次 `focus` 都不来；而 Tauri 的窗口事件 `tauri://focus` **会来**（Alt+Tab 切回之后 533ms 上账，
  比 200ms 轮询读到 `document.hasFocus()` 还早），并且它走的是 core 已有的事件通道——**不需要动 Rust**，
  本轮就是走这一层（"必须先走 Rust 那一层"这半句当时就对、也对得不够：那一层早就在，只是没人订）
- **前置实测② 把退避期间手动失败那一路的账判清楚**（`ab.mjs` 两腿顺带量到）：退避已经爬到 240 秒封顶时按一次
  Ctrl+S，那一趟自己也是失败的（同一个只读件），而**本轮裁决它不归零退避、也不重挂时钟**——
  失败就是"此刻仍写不上"的证据，把它当"用户在动"来拉回 30 秒，等于亲手把刚建立的退避抵消掉；
  实测 E3b 那枚数把这条钉死：手动那枚写 @213795 失败之后，下一枚自动写仍排在 **236509ms** 之后（封顶那一档），
  而 v0.75 那次补的是**成功**那一路（`clearBackoff()` + 重挂），两件事现在各有判据（D3f 管成功、D4a/D4b 管失败）
- **本轮唯一的架构决定：撤句权归"这个文件"，不归"谁写的这句"**。v0.73 立的是"只撤自己那一句"
  （`autoStatusRef` 存着自己那句 msg，成功时按身份比较撤掉），而它有一个当时没看到的后果：
  **手动 Ctrl+S 那一趟写的失败句不是这一路写的，于是这一路永远不认它**⇒
  用户把权限改回来、下一枚退避时钟真的把文件存上了，屏上仍挂着「保存失败」而界面没有任何一处承认这件事
- **对照件（0.75 那支）把这一格量成实测而不是推理**：写请求 @450335+10 落定、字面 `X76K1` 真在盘上、● 归 0@450363，
  而那句「保存失败」从 **213961ms 一直挂到整窗末拍 470959ms ⇒ 过期 20614ms**；
  同一窗里「已自动保存」**从未上屏**（C1c）——它挂在 `!status` 之后，而那枚非空的过期失败句正是堵死它的东西
- **新的认领关系**（`FailureClaim { msg, path }` + `staleFailureClaim(claim, path)`，A1a~A2d + 变异 M1/M19）：
  模块那条纯函数按**路径**认领，命中才把句子交回去、不命中给空串，调用方按"非空才撤"办事；
  身份比较那一半**原样保留**（`setStatus((cur) => (cur === stale ? '' : cur))`，D2b/P2b + M2），
  所以 v0.65「迟到那一趟不许抹活着一趟」没有被改宽——变的只是"那句是不是我的"的判据从来源换成路径
- **两头共吃**（D 段 20 枚 / P 段 15 枚判据）：`.odoc` 与 `.opd` 各持一份 `saveFailRef = useRef<FailureClaim | null>(null)`
  （仍是每枚标签一份、不并成模块单例——D1b/P1b 两家各钉一条，这一条本轮没有对应的变异）；定时失败登记 `{ msg, path: p }`，
  手动那一路把 `let target: string | undefined` 声明在 `try` **之前**、路径定下来之后赋值、失败时登记
  `{ msg, path: target ?? '' }`（D3a/P3a + M3）——**这一处是本轮最容易写错的地方**：`target` 在 `try` 里声明就活不到
  `catch`，那句失败又变回"说不清自己说的是哪个文件"
- **手动成功把这份认领清掉**（D3e/P3d）：文件现在真在盘上，那句过期宣称不再由定时那一路负责撤
- **顺序被钉成判据**（D2c/P4d）：取句 → 先清自己的账 → 再按身份撤（`saveFailRef.current = null` 必须排在
  `setStatus((cur)…)` 之前），反过来的话撤句那一步会拿已经清空的账去比
- **这一路仍不接收尾时钟、仍不挂进度门**（D5c/P4a + 变异 M16/M17）：v0.73 那一刀一个字没改宽，
  `auto` 那一段切片里不许出现 `done.show`；表格头与 PDF 头**没有被照抄**（R1d/R1e + M14/M15）
- **A/B 的账（两支真 exe × 两段 / 17 通过 / 真失败 0 / 显式 SKIP 1，共 18 行）**：C1a~C1d 四条判的是**对照件**
  （过期 20614ms、那句确实是手动写的、成功句从未上屏、而写侧本身是对的）⇒ 它们成立才说明本轮买到的不是判据空转；
  E1a 落定后失败句最长活 **71ms**（一枚采样间隔）、E1b/E1c **成功句首拍 450380 紧跟落定 450309**（差 71ms，
  既不是提前宣布也不是拖到窗尾）、那句是「已自动保存 00:43:03」且悬停「本次会话自动保存：成功 1 次 · 失败 3 次 ·
  30 秒后再检查」；E2a 撤的那句确实说过话；E2b 写侧两支持平（真落盘 + ● 归 0）；
  **E3a/E3b 判的是本轮没改节奏**（恢复后仍等 231490ms 那枚封顶时钟、手动失败没把它拉回基数）；
  E4 两段这一窗里的写枚数 **5 vs 5**（撤句不额外发写请求）；E5 两段页面异常 0 条。
  记账：**本轮没有让任何东西变快**（写自身 5~10ms，与 v0.73~v0.75 同一档），改的是"承认恢复"这件事由谁来做
- **dev 腿只吃形状**（12 通过 / 真失败 0 / 显式 SKIP 1、页面异常 0 条）：D1a/D1b（第 1 次失败上屏 @30962 + 悬停带
  `os error 5` 与「60 秒后自动重试」）、D2a/D2b（手动那句确实是「保存失败」+ 那一枚写请求 @32656 确实出过门）、
  **D3b/D3c 是本轮的 dev 证据**（恢复后下一枚自动 @90949 落定，那句失败只活 **206ms**、下一拍 @91163 就是
  「已自动保存 00:50:04」）、D3d 字面真落盘且 ● 归 0
- **本轮撞到三处量具坑，都不是产品**：① **单实例会把第二支 spawn 转发给上一趟还活着的窗口**——A/B 的 after 腿
  第一次跑就附着在一枚 144 秒前起的老页面上（页内时钟 144218ms、多出一枚不属于本趟的写 @30321、
  首拍就是遗留的「已自动保存 00:08:24」），三条判据当场报 FAIL 而产品一个字没错；
  现场和"产品坏了"完全同形。修法三步：起跑前用 `killstale.ps1` 收掉**本项目 `src-tauri/target` 下**那两支
  （已装正式版的路径不在这个前缀里，照旧不碰）、附着后**先验页内时钟刚起步**（`pageAge<25000` 且首拍不含成功句）、
  并把这两件事写成判据（Cb/Eb）而不是只写成日志——**"跑起来了"不等于"跑的是这一趟"**；
  ② **"落定之后不再有失败句"按有无所判，量的其实是采样器自己的粒度**——撤句必然发生在落定之后的下一拍
  （release 71ms / dev 206ms），于是第一版把成功报成失败；改成"至多活一枚采样间隔"，同时把对照件那条
  加强成**必须 >10000ms**（否则容差会把两段都判成通过，判据就空了）；
  ③ **dev 会话跨腿留驻 ⇒ 成功句要按"落定之后第一次"取**，取整条时间线的第一次会拿到上一趟那句
  （与 v0.72「按枚数索引之前先问这些条目属不属于这一趟」、v0.73「按窗口取值之前先问这一句凭什么不该出现」同族）
- **验证（五腿 + 编译）**：release A/B 真机 **17 通过 / 真失败 0 / 显式 SKIP 1**（对照件＝v0.75 收尾存档的那支 0.75 exe）、
  前端结构 **66 / 0**（B0a~g 自检 + A1~A5 / D1~D5 / P1~P5 / R1~R2，吃的是**剥掉注释之后**的源文；
  D3f/D4c/D4d/D5a/D5b/P5a/P5b/R1a~R1e/R2a/R2b 全是回归判据——v0.75 的退避与次数账、v0.74 的 `runExclusive` 与
  `dirtyRef`（**⇒ v0.78 起这枚 ref 已随那道闸删除，当时的回归判据换成"不再有它而标签的账仍被清"那三枚**）、
  v0.73 的"失败上屏/不脏不动/不挂门/不接收尾时钟"四条、表格头 v0.69、PDF 头 v0.70、registry 那一层
  都没被顶掉）、变异检查 **21 枚 + 正控制 / BAD 0**（M1 把认领做成"无条件撤"、M2 做成裸 `setStatus('')`、
  M3 手动失败不登记、M8/M9 给手动失败加 `clearBackoff`/重挂、M19 认领关系里没有路径、M14/M15 照抄进另两头）、
  CDP dev 真机 **12 通过 / 0 失败 / 1 显式 SKIP、页面异常 0 条**，`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**
  （与 v0.63~v0.75 同一份基线——Rust 本轮一个字没动），+ tsc 与 `pnpm tauri build --no-bundle` 绿
  （openoffices v0.76.0）；五腿都在**版本号 bump 之后**跑（老规矩），结构腿与变异腿在最终源文上复跑过一次
- **本轮没动的，量出来记着**（已开进路线图）：**"权限解开了"这件事仍要等下一枚时钟**，而页面这一侧确实没有
  焦点信号（实测只有 `blur`）⇒ 下一轮要做的话，第一步是 Rust 的窗口焦点事件而不是前端定时器
  （**⇒ v0.77 兑现**：走 `getCurrentWindow().onFocusChanged`，那是 core 的事件通道而不是新命令，Rust 仍一个字没动；
  而"页面这一侧确实没有焦点信号"那半句量的是 DOM 那一层，窗口事件那一层有——见 v0.77 那一节的前置实测①）；
  **「另存为到别的路径」那一档 release 真机仍未量**（要真挑一次原生对话框才撞得到）⇒ 本轮在两腿上都是**显式 SKIP**
  （`pass=null`）而不是让"计数为零"冒充判据，它目前只吃结构判据 D3a/P3a 与 A2b；
  **手动失败仍会把那句失败留在屏上等封顶那一枚**（本轮的裁决，代价记在这里）；
  N 枚标签各挂自己的时钟、会话账只在内存、`AUTO_BASE_MS/AUTO_MAX_MS` 是单机数——v0.75 那三条照旧；
  `PptEditor` 手存之后 `dirtyRef` 未清（**⇒ v0.78 拆闸**）、`DocEditor` 剩四枚裸 `setTimeout`、`SheetEditor.exportPdfTo` 内联那份拼句公式、
  PDF 大件 ~1030ms 仍未归因、在途锁按 `tabId` 不按 `path`、写侧前缀三家不统一、toast 体系照旧未建；
  自动更新的应用内下载安装与 macOS 打包按指令继续等信号

## 窗口回来就探一次：退避期间「权限解开了」不必等下一枚时钟（v0.77）

起点是 v0.76 收尾记下的那一条未勾项「权限解开了这件事仍要等下一枚时钟」，而 v0.76 顺手把它的可行性判死了——
「页面这一侧没有可用信号，要做必须先走 Rust 的窗口事件」。**本轮第一步就是推翻那句裁决**：信号在，
只是不在 DOM 那一层，而在 Tauri 的窗口事件那一层（`getCurrentWindow().onFocusChanged`），
而它是 core 已有的事件通道，**不需要新命令、不需要动 capabilities、Rust 一个字没动**（先例 v0.64~v0.76）。
动的是前端那一层的三个文件（`lib/auto-save.ts` + `DocEditor.tsx` + `PptEditor.tsx`）。

- **前置实测① 先把"到底有没有信号"量清楚**（`tmp/x77/probe.mjs`，release 真机 + CDP，同一窗里把
  `tauri://focus`/`tauri://blur` 与 `window` 的 `focus`/`blur`/`visibilitychange` 一起挂上观测器 + 200ms 轮询 `document.hasFocus()`）：
  静置 2 秒 **0 枚**（没有操作就没有事件）；外部 `SetForegroundWindow` 把别的窗口抢到前台再抢回来 **0 枚 focus**
  （**没有真的 blur 就不会有 focus**，这一条后来直接解释了量具的坑）；页内 `setFocus()` 而窗口本来就聚焦 **0 枚**
  （没有变化就不是漏报）；Alt+Tab 切走 ⇒ `tf_blur` 1 枚（Δ409ms，与 `dom_blur` 同刻）；
  **Alt+Tab 切回 ⇒ `tf_focus` 1 枚 @15232、Δ533ms，而轮询到 15291 才读到 `hasFocus()===true`**
  ⇒ 窗口事件那一层比 200ms 轮询还早，v0.76 那句"只能靠轮询读到"就是这么来的：它只看了 DOM 那一层
  （那边确实一次 `focus` 都不来）；**原始事件对象是 `{"event":"tauri://focus","payload":null,"id":6}`**
  ⇒ 裸 `listen` 的 payload 是空的，**只有 `onFocusChanged` 才交出那枚布尔**（F2a + 变异 M3：blur 那一半必须被 payload 挡掉）
- **前置实测② 把"会不会变成另一种一直敲"判掉，节流下界由谁定**：这一路最贵的东西从 v0.75 起就是**频率**而不是速度，
  所以探写不能"焦点来一次就敲一次"。量到人能敲出来的最快节奏是**连打 6 次 Alt+Tab 只得到 3 枚 focus**
  （切走那三下没有回来就不算）、相邻两枚间隔 **[3535, 3612]ms** ⇒ 下界取这一路本来就有的基数
  `AUTO_BASE_MS = 30_000`（比人手慢一个数量级，且不再新增第二个常数）；
  下界读的是**账里的 `lastAttemptAt`**，而登记它的判据是「那枚写请求真的被送出门」——
  **锁忙被跳过的那一趟 `fn` 根本没跑，不配算敲过门**（F3b + 变异 M5：把 `noteAttempt` 挪到 `runExclusive` 外面就报；
  这一条与 v0.75 那条「跳过不算失败」同一个理由：不许让手动那一趟正在写替自动这一路受罚）
- **本轮唯一的架构决定：探写不是第二条链路，是同一条链路的第二个入口**。写动作抽成一份 `attempt()`，
  定时那一枚与焦点探写**共用同一份**（同一把 `runExclusive` 锁、同一套句子、同一份按路径的撤句认领、同一本退避账），
  区别只在"什么时候被允许跑"；探写跑完仍然走 `autoRescheduleRef.current?.()` 那一刀（撤掉在途的那一枚 + 按当前的账重挂）
  ⇒ **焦点这一路不造第二枚时钟**（F3e + 变异 M7/M16：探写自持一枚 `setTimeout` 就报）。
  真机上这一条的判据是 E3d：**对照件那一枚 `w2+120s` 的时钟位在实验件上是空的**——探写把自己并进了同一枚时钟而不是加了一枚
- **失败仍照 v0.76 的裁决**（F3f + 变异 M8）：探到失败只 `noteFailure`、**不清基数** ⇒ 它拿到的是"此刻仍写不上"的证据，
  重挂出来的那一枚只会更远，这一路因此不会退化成"每次切回窗口就敲一次"；`canProbe` 在下界之内直接 return，
  连锁都不去抢
- **手动那一趟一个字没动**（F5a/F5b + 变异 M13）：成功仍是 `clearBackoff()` + 重挂，而它**不登记 `noteAttempt`**
  （那一趟不是自动这一路的敲门账）——v0.76 那条分工没有因为这次多一个入口而被搅浑
- **两头共吃**：`.odoc` 与 `.opd` 的焦点探写同一套接线（F3a~F3k 十一枚 / F4a~F4g 七枚，含演示头独有的
  `dirtyRef.current = false` 仍在成功里，F4e + 变异 M17；**⇒ v0.78 改口：那一处独有复位随整道闸一起删除**，
  这一头改由标签自己的 `s.markDirty(tab.id, false)` 记那一份账，F4e 换成 A3a；
  而"两头共吃"这四个字到 v0.78 才有两边的真机数字——`.opd` 那一格此前只有接线，见 v0.78 那一节）；
  **表格头与 PDF 头没有被照抄**（F6a/F6b + 变异 M18/M19——
  那一两头本来就没有定时自动保存，v0.74 判过不做）
- **A/B 的账（两支真 exe × 五段 / 42 通过 / 真失败 0）**：C 臂（0.76，这一路不存在）写请求
  `[30236,90256,210276,450286]`、节流窗内 8 枚 focus 换来 **0 枚写**、过了下界之后 6 枚 focus 也换来 **0 枚写**，
  解权 @224950 之后那句「自动保存失败（第 3 次）」一直挂到 focus @256380（**46095ms**）而成功句整窗只在
  @450296 出现过一次 ⇒ **解权→落盘 225336ms**（它等的是自己那枚封顶时钟）；
  E 臂（0.77）写请求 `[30507,90516,133248,257554]`，节流窗内 7 枚 focus 换来 **0 枚写**、过了下界的 3 枚只换来
  **1 枚探写**（Δ**[0]ms**，⇒ 下界挡掉 2 次），解权 @224609 之后 focus @257554 ⇒ 同一毫秒写出门、
  字面独立读盘确认真在、「已自动保存 10:07:05」@257567（**落定之后 13ms**）、那句过期失败**落定之后 0 拍**、● 归 0
  ⇒ **解权→落盘 32945ms，而这 32.9 秒全部是"焦点什么时候回来"所花的时间**（焦点一到就是 0ms）；
  两臂**总写枚数 4 vs 4**（探写没有加戏）、解权那一刻两支持平的是**形状**（都挂着「第 N 次」的失败宣称而一次都没落盘）、
  两臂页面异常 0 条。记账：**本轮没让写侧变快**（写自身 C `[12,14,8,5]` / E `[6,5,8,9]`ms，与 v0.73~v0.76 同一档），
  改的是"什么时候被允许再试一次"
- **dev 腿只吃形状**（14 通过 / 真失败 0、页面异常 0 条）：D2a（距上一次敲门 16896ms 的那枚 focus ⇒ 0 枚写）、
  D3a（focus @69573 ⇒ 探写 @69573，Δ**0ms**）、D3c（「已自动保存 09:52:19」@69590，落定之后 17ms）、
  D3e（v0.76 的撤句在 dev 上同样成立）、**D3f（一枚 focus 只换来一枚写 ⇒ `React.StrictMode` 双挂载没留下第二路监听——
  这一枚是本轮唯一直接判"订阅迟到要补取消"的真机证据**，F2c + 变异 M2 是它的结构那一半）、
  D4a（全腿写枚数 2 @[34407,69573]：一枚注定失败 + 一枚探写）
- **本轮撞到五处量具坑，都不是产品**：① **对照件的"平"要判形状而不是判枚数**——第一版 `E4a` 要求两支在解权那一刻都报
  「第 3 次」，而实验件报「第 4 次」：探写失败**也是真失败、`fails` 也真的涨**（两支当时都已在 240 秒封顶档），
  这两句话都对；把"平的形状"写成"平的次数"就会把产品正确的一面报成缺陷 ⇒ 改成判"挂着「第 N 次」（N≥3）的失败宣称 +
  写请求已出门而一次都没落盘"；② **两个监听接收同一枚 `tauri://focus` ⇒ 因果判据必须带符号容差**——
  第一版报「窗内写 [133793] vs 首枚 focus 133794」，Δ 是负的 1ms 而它是**真因果**；锚要取"触发之后页内事件账上的第一枚 focus"，
  不是量具 helper 返回的那一枚；③ **这台机器上有第三方在前台抢焦点**（这一趟 E 臂起跑时前台是 `cline-app`，
  上一趟是 Chrome 的 "WorkBuddy"）⇒ 任何按"helper 调用返回时刻"的判据都会随机红，焦点账全部改成页内那枚独立监听；
  ④ **CDP 的 `Runtime.evaluate` 在这台机器上会卡 20 秒**（A/B 第一版在尾那枚两分钟等待里报 `cdp_timeout` 而整臂判据作废）
  ⇒ 每一枚页内读包一层重试、**每次重试失败都如实打在日志里、耗尽之后仍抛**（吞成 `null` 会让后面的判据变空断言，
  那是 v0.75 那条「CDP 把异常序列化成 `{}`」的同一个形状）；⑤ **dev 的两枚假 FAIL 是同一族**——
  `D0b` 在 `plugin:event|listen` 的回执落地之前就去读 `listen`（读到 `[]`，而同一趟后面真的数到了 4 枚 focus），
  `D1a` 要求"按键之后要有新的变化点"而那句签名本来就没变（v0.73「只在变了时记一笔」反过来咬人）
  ⇒ 前者改成先轮询回执再判，后者改成判**当前那一格**并把"按键之前的 ●"单独记成一行账；
  同族再来一次：**dev 的 StrictMode 在开标签那一刻就把标签标脏** ⇒ "不脏就不写"这一条只能在 release 腿判
- **验证（五腿 + 编译）**：release A/B 真机 **42 通过 / 真失败 0**（对照件＝本轮改动前当场存档的那支 0.76 exe）、
  前端结构 **37 / 0**（B0a~e 自检 + S1/S2 切片非空 + F1a~F6b，吃的是**剥掉注释之后**的源文；
  F3h/F3i/F3j/F3k/F4e/F5a/F5b 全是回归判据——v0.73 的"失败上屏/不挂门/不接收尾时钟"、v0.75 的退避与次数账、
  v0.76 的按路径认领、v0.74 的 `runExclusive` 都没被顶掉）、变异检查 **19 枚 + 正控制 / BAD 0**
  （M1 下界归零、M2 订阅迟到不取消、M3 blur 也探、M4 取消成空动作、M5 `noteAttempt` 挪到锁外、M6 探写不看下界、
  M7 探写自持时钟、M8 探写失败清基数、M9 卸载不收回、M13 手动也登记敲门账、M14~M17 演示头未同步、M18/M19 照抄进另两头）、
  CDP dev 真机 **14 通过 / 0 真失败、页面异常 0 条**，`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**
  （与 v0.63~v0.76 同一份基线——Rust 本轮一个字没动），+ tsc 与 `pnpm tauri build --no-bundle` 绿
  （openoffices v0.77.0）；五腿都在**版本号 bump 之后**跑（老规矩），结构腿与变异腿在最终源文上复跑过一次
- **本轮没动的，量出来记着**（已开进路线图）：**`.opd` 那一头的焦点探写真机没跑过**（A/B 与 dev 两腿本轮都在 `.odoc` 上，
  演示头只有 F4a~F4g 七枚接线证据——v0.76 记下的同一格在 v0.77 又复现一次，没量到的不写成结论
  **⇒ v0.78 把这一格量掉了**：expC 臂在 `.opd` 上真跑（焦点→探写 Δ 0ms、落定后过期失败 4ms），dev 的 D5 段同形）；
  **探写的下界是"每一枚标签各自的下界"**（`lastAttemptAt` 住在按标签持有的账本里，N 枚标签就是 N 枚账
  ⇒ 切回窗口会给 N 枚各探一次的许可，后台常驻的只读件可能同一秒各发一枚写；这一格本轮既没做也没量）；
  `AUTO_BASE_MS = 30_000` 现在**一枚数两个用途**（退避基数 + 探写下界），改它得同时想两件事，而它仍是本机单机的数；
  **焦点事件只说"窗口回来了"，不说"权限改回来了"** ⇒ 权限没改的每一次切回仍然会撞一枚注定失败的写
  （30 秒下界挡住了绝大多数，挡住了不等于免费）；另存为到别的路径那一档 release 真机仍未量、
  「已自动保存 X」有悬停而手动那句仍没有、N 枚标签各挂自己的时钟、DocEditor 剩四枚裸 `setTimeout`、
  `SheetEditor.exportPdfTo` 内联那份拼句公式、PDF 大件 ~1030ms 仍未归因、在途锁按 `tabId` 不按 `path`、
  写侧前缀三家不统一、toast 体系照旧未建；自动更新的应用内下载安装与 macOS 打包按指令继续等信号

## 手存之后那条编辑链还活着：演示头"只在第一次编辑时标脏"那道闸拆了（v0.78）

起点是 v0.74 收尾记下的那条"顺带撞到的既有缺陷"（当时只补了定时成功那一路的自己那一份复位，手存那一路没动），
本轮把它量成了**静默丢数据**而不只是"● 不亮"。动的是前端那一层的一个文件（`PptEditor.tsx`），
**Rust 一个字没动**（先例 v0.64~v0.77），另把 v0.76/v0.77 连续两轮记下的「`.opd` 那一格只吃接线证据」一并量掉。

- **前置实测① 先把"坏在哪儿"量成四格而不是感觉**（`tmp/x78/pre.mjs`，release 真机 = 改动前那支 0.77 exe + CDP，
  基准=页内 10ms 文本时间线 + Resource Timing + 独立读文件）：可写 `.opd` 上手动 Ctrl+S 那一路**本来就是对的**
  （`_a1` 真在盘上、● 归 0、那句是「已保存」⇒ 本轮没有去修一个不存在的问题）；缺陷从"再打一个字"开始——
  **● 回不来（=0，等到超时）**、**再编辑之后 75 秒窗内 `write_text_file` 枚数 = 0**（定时的整条链不再发）、
  **切回窗口那枚 focus（@79686）换来 0 枚探写**（v0.77 那一路被同一枚门挡住）、
  **晚打的 `_a2` 不在盘上**——而屏上从头到尾挂着「已保存」⇒ **这不是"没存快一点"的问题，是"改了却再也不会存"**：
  手动一成功，这一枚标签的编辑链就整条断电，页面异常 0 条
- **前置实测② 同形对照 `.odoc`：这一头本来就是对的**（同一支 exe）：再编辑之后 ● = 1、75 秒窗内写 1 枚 @[30499]、
  `_b2` 真在盘上 ⇒ 缺陷归演示头那一道闸，而不是归 store、归 `runExclusive`、归 v0.75 那本账；
  本轮因此**没有**动文档头一个字（expB 那一臂 7 条判据吃的就是"没被顶掉"）
- **本轮唯一的架构决定：拆闸，而不是"在手存成功那一路再补一份复位"**——补复位能把这四格治好，但闸还在，
  于是**任何一条不清 `dirtyRef` 的新路径**（导出、另存为、以后再加的）都会让同一件事复发，而这一头当时已经有
  两份复位要各记一遍（手存走 `renameTab`、定时走自己那一句）；去重**本来就在 store 那一层做**
  （`markDirty` 是 `if (!t || t.dirty === dirty) return s`，脏值没变不触发订阅），所以 `edit()` 里那道
  `if (!dirtyRef.current)` 买的东西是**重复的**而代价是整条链断电 ⇒ 现在每次编辑都调 `markDirty(tab.id, true)`，
  `dirtyRef` 连同定时成功那一路的 `dirtyRef.current = false` 一起删除（A1b/A2a 钉"整个演示头不再有这枚 ref"、
  A3a 钉"标签的账仍由 `s.markDirty(tab.id, false)` 清"、A3b 钉"标脏只归 `edit()` 一处"、M3 把 store 那层去重拆掉就报）
- **顺带兑现的两格（v0.76/v0.77 连续两轮的同一条未勾项）**：`.opd` 的按路径撤句与焦点探写此前**只有接线证据**
  （P1a~P4d / F4a~F4g 十五枚 + 七枚），本轮 A/B 的 expC 臂与 dev 的 D5 段都在 `.opd` 上真跑：
  改前的 0.77 上焦点→探写 **Δ 0ms**（距上一次真敲门 44905 / 46076ms 而过了 30 秒下界）、那句过期失败在探写落定之后
  最长活 **8ms**（末次失败拍 30217）；改后的 0.78 上重跑得 **Δ 0ms**（gap 39934ms）、落定 72103ms 之后
  过期失败最长活 **4ms**（末次失败拍 30216）⇒ **"两头共吃"这句现在才真的两头有数**
- **A/B 的账（两支真 exe × 四臂 / 49 通过 / 真失败 0）**：**ctrlA**（0.77 对照件，`.opd`，11 条）——
  C2a「再编辑之后 ● 起不来（等到超时=true）」、C3a「90 秒窗内写枚数 = 0」、C4b「焦点之后的写枚数 = 0」、
  C4c「晚打的 `_a2` 不在盘上 = true」而 C1c 那句仍是「已保存」，写全表只有一枚 `[{"s":439,"d":4}]`；
  **这四条判的都是对照件，它们成立才说明本轮买到的不是判据空转**；
  **expA**（0.78 实验件，`.opd`，16 条）——写全表 `[452/5, 30461/6]`（再编辑之后定时那一路自己出过门）、
  E2a ● 回得来、**E3b `_a2` 真在盘上**、E3c 落定之后 ● 归 0、E3d/e 那句是「已自动保存 11:27:10」且悬停
  「本次会话自动保存：成功 1 次 · 失败 0 次 · 30 秒后再检查」、E3f 那一枚写自身 6ms、
  **E4b 焦点窗内写枚数 = 0（不脏就不该敲门，0 才是对的）**、E5 页面异常 0 条；
  **expB**（`.odoc` 同形对照，7 条）——F2a ● = 1、F3a 75 秒窗内写 1 枚 @[30473]、F3b `_b2` 在盘上；
  **expC**（`.opd` 只读件，15 条）——G1a/b 手动失败句 + 悬停 os error 5 原话、G2a 定时 1 枚 @[30198]、
  G2b「自动保存失败（第 1 次）」、G2c ● 仍 1、G3a focus 1 枚 @72094、G3b 探写 1 枚 @[72094]、G3c Δ 0ms、
  G4a `_c1` 真落盘、G4b/c 成功句 + 悬停会话账、G4d ● 归 0、G5a 过期失败 4ms、G5b 页面异常 0 条。
  记账：**本轮没让任何东西变快**（写自身 5~6ms，与 v0.73~v0.77 同一档、`longtask` 观测器 0 条），
  买的是"手动成功之后这一枚标签还在不再存东西"这件事
- **dev 腿只吃形状**（25 通过 / 真失败 0 / 显式 SKIP 0，页面异常 0 条）：D1a~c 手存回归（`_d1` 落盘、「已保存」、●=0）；
  **D2a 手存成功之后再打字 ● 回得来**、D2b 再编辑之后定时的写出过门 1 枚 @[34608]、**D2c `_d2` 真在盘上**、
  D2d 落定之后 ● 归 0、D2e/f 成功句 + 悬停账；D3a~d 只读件那一路（失败句 + 悬停原话 + ● 留 1 + 一次没落盘）；
  D4a/b 退避之后那一枚 60 秒的钟在只读件上真出过门 @[64837] 且「第 1 次」上屏；
  D5a~f 解权 + 焦点 ⇒ **focus 2 枚 @110001,110002（`React.StrictMode` 双订阅）而探写只有 1 枚 @[110002]**
  （v0.77 那条"订阅迟到要补取消"在 dev 上第二次兑现而本轮仍在）、`_d3` 真落盘、过期失败活 11ms、● 归 0、成功句 + 悬停
  「成功 1 次 · 失败 1 次 · 30 秒后再检查」；D7 写全表 `[4601/5, 34608/8, 36335/8, 64837/7, 110002/15]`
  而 `staleIpc = 0`——**其中 34608 与 36335 只差 1727ms，是 dev 双挂载留下的第二枚时钟**，
  所以这一腿的判据写的是"出过门 ≥1 枚"而不是枚数（dev 的数字一律不吃，v0.66 那条老规矩在这里第三次兑现）
- **前端结构 35 / 0**（B0a~d 剥离器自检 + A1a~A9 + R1a~R4，吃的是**剥掉注释之后**的源文）：
  A1a~A1d 四枚钉"闸拆了而不是挪了"（`fn(next)` 与标脏之间不许出现 `if`、那句是顶格的裸调用），
  A2b/R4 钉"没有把这枚 ref 或这道闸新造进另外两头"，R3 钉"表格头那份内联拼句公式没被顺手归一"（未勾项照旧），
  A6a~A6f / A7a~A7b / A8a~A8d / A9 / R1a~R2b 全是回归判据（v0.74 的 `runExclusive`、v0.75 的退避与次数账、
  v0.76 的按路径认领与身份比较、v0.77 的焦点接线与下界、文档头两头都没被顶掉）；
  **变异检查 22 枚 + 正控制 / BAD 0**：M1 把那道闸原样放回 ⇒ 该响 3 条（A1b/A1c/A2a），M2「`edit()` 干脆不标脏」、
  M3「拆掉 store 那层的按状态去重（闸的替代品不在了）」、M4「`renameTab` 不再把 `dirty` 归 false（手存失去清账通道）」、
  M5「把这道闸搬进文档头」、M6「定时成功不再清标签的脏（● 一直挂着）」、M16「把这道闸加进表格头」⇒ 响 2 条，
  M7~M15 与 M17~M20 是 v0.74~v0.77 那四层的负控制；P0/P1 两枚正控制（什么都不改 / 只改注释）必须全绿
- **本轮撞到四处量具坑，都不是产品**：① **后台跑长跑腿会被闲置收掉，而它带崩的是整棵 dev 树**——
  第一版 dev 腿在 70 秒静默等待里被回收（exit 0 而 `finally` 没跑 ⇒ cmd→pnpm→vite→app 全留在盘上继续占 9222），
  补了 `waitLogged` 每 15 秒打一行进度之后改前台跑；由此**"附着到已经在跑的 dev"这一模式在树被杀过一次之后不可用**
  （`waitTarget(9222)` 轮询 600 秒全报 `fetch failed` ⇒ 只能整腿自重开，判据前先核对 `target/debug/openoffices.exe`
  的 mtime 晚于 `Cargo.toml` 才敢省掉 Rust 重编）；② **focus 触发必须排在 30 秒下界之后**——expC 第一版在距上一次
  真敲门 14972ms 时就切窗口，于是拿到"探写 0 枚"并把**产品正确的"不敲门"**连累成 7 条 FAIL（G3b~G5a 全是这一族）
  ⇒ 触发前按 `lastAttemptAt` 补足间隔，这一条与 v0.76「窗口判据起点要锚在触发之后」同族：**判"该敲门时敲了没"之前，
  先问这一刻按下界该不该敲**；③ **"过期失败挂多久"的锚要排在落定之后**——第一版拿"落定之前最后一次失败上屏"
  到落定的时长当成停留，读出 41880ms 这种数（其实是 gap），判据本身得按 `t > landedAt` 筛拍；
  ④ **附着成功不等于采样器就绪**——expA 第一趟 `cdp target after 434ms` 之后立刻 `dump` 报
  `TypeError: Cannot read properties of undefined (reading 'marks')` 而 retry 4 次整臂作废，
  症状和产品坏了长得一样 ⇒ 现在起跑先轮询到**首页真的渲染出来**再装再读（每趟日志多那一行「首页已渲染（第 N 次轮询）」）
- **验证（五腿 + 编译）**：release A/B 真机 **49 通过 / 真失败 0**（对照件＝本轮改动前当场存档的那支 0.77 exe，
  两支真 exe、四臂 11/16/7/15）、前端结构 **35 / 0**、变异检查 **22 枚 + 正控制 / BAD 0**、
  CDP dev 真机 **25 通过 / 0 真失败 / 0 显式 SKIP、页面异常 0 条**，`cargo test --lib`
  **97 通过 / 0 失败 / 11 ignored**（与 v0.63~v0.77 同一份基线——Rust 本轮一个字没动），
  + tsc 与 `pnpm tauri build --no-bundle` 绿（openoffices v0.78.0）；五腿都在**版本号 bump 之后**跑（老规矩），
  结构腿与变异腿在最终源文上复跑过一次（04:29:10 那一份，UTC 时间戳；两腿与 04:04:05 那份同数）
- **本轮没动的，量出来记着**（已开进路线图）：**每次都标脏换来的按键成本没量**——去重住在 store 那一层
  （每枚按键都要过一遍 `getState()` 与脏值比较才得出"不触发订阅"），dev 的 D2a 只证行为不证成本，
  真要盘它先得有一枚"按键→状态栏"的打点；**`markDirty` 调在 `setDeck` 的 updater 里面**（updater 按约定该是纯函数，
  而 StrictMode 下它会被双跑）⇒ 本轮只量到"两枚时钟各敲各的"这一后果，没量 updater 重复调用本身；
  **本轮只在"一枚标签一枚文件"的形状上量**（多枚 `.opd` 同时脏时每枚各自的时钟、各自的认领关系仍未量，
  与 v0.75~v0.77 那三条"N 枚标签各挂自己的时钟 / 下界按标签各自 / 认领关系没有变异钉"同源而同一条）；
  另存为／导出 pptx 之后"再编辑 ● 该不该亮"这一档不涉及这道闸（它们不调 `renameTab`）而 release 真机**仍未量**；
  「已自动保存 X」有悬停而手动那句仍没有次数账、DocEditor 剩四枚裸 `setTimeout`、`SheetEditor.exportPdfTo`
  内联那份拼句公式、PDF 大件 ~1030ms 仍未归因、中件 164ms 与门值 200ms 只差 36ms、在途锁按 `tabId` 不按 `path`、
  `SAVE_BUSY_MS` / `AUTO_BASE_MS` / `AUTO_MAX_MS` 是单机数、写侧前缀三家不统一、toast 体系照旧未建；
  自动更新的应用内下载安装与 macOS 打包按指令继续等信号

## 那句标脏搬出 updater：演示头一枚按键只敲一次 store，React 的渲染阶段不再替它写全局（v0.79）

起点是 v0.78 收尾时自己记下的两条未勾项——「每次都标脏换来的按键成本没量」与「`markDirty` 调在 `setDeck` 的
updater 里面」。本轮动的是前端那一层的一个文件的一行**位置**（`PptEditor.tsx` 的 `edit()`），**Rust 一个字没动**
（先例 v0.64~v0.78），也没有新增常数、没有新增任何一路时钟。

- **前置实测（`tmp/x79/predev.mjs`，dev 腿，只量不改产品）先把"这一枚按键里到底发生了什么"量成五格**：
  ① **调用次数**——0.78 那一支上一枚按键把 `markDirty` 换来 **2 次**（连打 4 枚 = 8 次、6 枚标签之下再打一枚 = 2 次），
  0.79 那一支是 **1 次**（4 枚 = 4 次、6 枚标签下 1 次）；② **栈里有没有渲染阶段的帧**——改前第一枚按键被 dump
  出来的那一枚调用，栈是 `markDirty ← PptEditor.tsx:93（updater 体内）← basicStateReducer ← updateReducerImpl ←
  updateReducer ← Object.useState` ⇒ 它跑在**渲染阶段**；改后是 `markDirty ← edit ← editSlide ← onChange ←
  executeDispatch` ⇒ 事件处理器里；③ **单次耗时**——改前中位 0.1ms / 最大 0.3ms（4 枚合计 0.900ms），
  改后中位 0.1ms / 最大 0.1ms（合计 0.400ms）⇒ **本轮买到的不是速度**（0.5ms 的差在本机噪声里，
  而 6 枚标签之下那一枚读到 0ms）；④ **store 订阅被通知几次**——脏值 false→true 那一枚按键 1 次，
  已经脏了之后连打 4 枚 = **0 次** ⇒ v0.78 那条"去重住在 `store.markDirty`"第二次兑现，而它恰好解释了
  "每次按键都标脏为什么不贵"；⑤ **React 自己怎么看这件事**——改前抓到 1 条 DEV 告警
  `Cannot update a component (Workspace) while rendering a different component (PptEditor)`，改后 **0 条**
- **量具的说明书由正控制签出来，而它真的自毁过一次**：探针给 `useApp` 的 `markDirty` 包一层壳去数次数与抓栈，
  "这一枚调用算不算渲染阶段"靠栈帧分类。第一版拿 `basicStateReducer` 当渲染标记，于是**两条路径被判成同一类**——
  它在 eager 那一路也在（`basicStateReducer ← dispatchSetStateInternal ← dispatchSetState`），真正的分水岭是它的
  **调用方**。正控制（`__oofPpt.setDeck(d => …)` 由 React 自己调，按契约必然在渲染阶段）当场报 **FAIL**，
  同一趟 0.78 的阶段读数全报 `["other","other"]` ⇒ 腿自己那条规矩「正控制没被认成渲染阶段 ⇒ 后面的阶段读数一律不吃」
  把那一趟的分类读数整批作废。修法是先判处理器标记（`dispatchSetState|onChange|editSlide|callCallback|…`）
  再判渲染标记（`updateReducerImpl|renderWithHooks|performUnitOfWork|…`）；**所以上面第 ② 格只吃两样东西**：
  dump 出来的原始栈帧，以及那条 DEV 告警——改前那一趟的分类器读数不吃（它已被自己的正控制作废）
- **本轮唯一的架构决定：那句 `markDirty(tab.id, true)` 从 updater 体内提到 `setDeck(…)` 语句之后**，
  而不是"在里面补一份只跑一次的门"——updater 按 React 契约是**纯函数**，它被调几次、在哪个阶段被调由不得我们
  （eager state、并发渲染、`StrictMode` 三条路径都能动它），把"这一枚标签脏了"写进全局 store 这件事如果发生在里面，
  等于把它的可见性交给 React 的调度器；提到外面 ⇒ 一枚按键恰好一次、必然在事件处理器里
  （S1a 钉位置、S1b 钉 updater 体里只剩 `fn(next)` 与 `return next`、S1c 钉那道闸不许回到里面、S1d 钉那句是顶格的裸调用）
- **release A/B 的账（两支真 exe × 两臂 / 30 通过 / 真失败 0 / 页面异常 0 条）：结论是"持平"**——0.78 与 0.79
  在同一套格子上读出来的行为一模一样：● 起得来（首拍 @1722 / @1701）、定时那一枚写在 30.0 秒处出门
  （落定锚 @30230 / @30190）、落定之后 **12ms / 11ms** 那一拍 ● 归 0 且那句是「已自动保存 22:37:39」/「22:38:50」、
  手动那趟「已保存」+ `_m1` 真在盘上 + ●=0、**手存之后再打字 ● 回得来**（首拍 @32903 / @32821，按键 @32899 / @32804）、
  再编辑之后写枚数 2→3、晚打的 `_a2` 真在盘上（第二枚落定锚 @62499 / @62408，● 归 0 首拍距锚 **4ms / 13ms**）；
  写自身 ctrl `[5.7, 7, 14.7]` / exp `[7.1, 4, 6.2]`ms ⇒ 没变快也没变慢。**记账**：**「渲染阶段写全局」这一格在
  release 上根本没有可观测面**（那条告警是 React DEV-only），所以本轮的实验证据只能来自 dev 腿，
  release 这一臂买的是"没有回归"而不是"改好了什么"——这与 v0.77 那条"不脏就不写只有 release 能判"正好反过来
- **前端结构 28 / 0**（吃**剥掉注释之后**的源文）：S2a 是全仓扫描——四个头的 `setState` updater 里都不再写脏值；
  S3a~S3g 是 v0.74~v0.77 那四层的回归（`runExclusive`、一份 `attempt()`、两头 `onFocusBack`、按路径认领、
  账本每枚标签一份），S4a/S4b 钉表格头与 PDF 头没被顺手接上。**本轮先撞到两枚判据自身的坑**：① S2a 第一版把
  `setTimeout(() => { … })` 认成 React 的 updater（文本同形而它不是 `setXxx`），于是定时那一路**合法**的 `markDirty`
  被报成违例 ⇒ 加了 `NOT_AN_UPDATER = /^Timeout$/` 黑名单；② S2d「`renameTab` 仍把标签归到不脏」原来是拿整文件
  找 `dirty: false` ⇒ **那是判据空转**（`openTab` 里也有一枚同名键，改名那一格就算不再归 false 也照样绿），
  改成按 `renameTab:` 切块再查块内，而切片起点必须取**最后一枚**（`State` 接口在 `store.ts:32` 先声明了一次同名键，
  取第一枚切到的是类型而不是实现，于是另立一枚 `S2d-renametab-slice-found` 守卫）——这一枚是变异 M7 抓出来的，不是产品
- **变异检查 16 枚（14 枚 + 2 枚正控制）/ BAD 0 / 多打中 0**：M1 把那句原样放回 updater ⇒ 响 4 条
  （S1a/S1b/S1g/S2a）、M2 把那道闸连同那句一起放回 ⇒ 6 条、M3 `edit()` 干脆不标脏 ⇒ 3 条、M4 定时成功不再清标签的脏、
  M5 `dirtyRef` 复活、M6 拆掉 store 那层去重、M7 `renameTab` 不再归 `false`（**抓出 S2d 空转的那一手**）、
  M8 文档头把标脏搬进自己的 updater ⇒ S2a/S2b、M9/M10 表格头与 PDF 头被照抄、M11~M13 拆 v0.77 的接线、
  M14 把那句包进一道外层闸 ⇒ S1d；P0（什么都不改）与 P1（只改一处占位文本）必须全绿
- **CDP dev 腿只吃形状**（14 通过 / 真失败 0 / 页面异常 0 条）：上面前置实测那五格就是这一腿的账，而**它的数字
  一律不吃成产品指标**（v0.66 那条老规矩第四次兑现）——dev 的量具读的是"每枚按键换几次调用 / 有没有渲染阶段帧 /
  React 报不报话"，这些在 release 上要么不存在要么换了形状
- **本轮撞到三处量具坑，都不是产品**：① **时间线快照不能与落定锚同毫秒**——C3d/E3d 第一版在同一刻取 `landedAt`
  与 `tl`，于是"落定之后 ● 归 0 首拍"永远找不到行而两臂同 FAIL；第二轮 29/1 时是那一行自己的窗口 dump 自证的
  （`62103:1:` … `62463:1:` 之后那一枚 `62524:0:已自动保存…` 本来就存在，只是排在取快照之后）⇒ 加了
  `rowsSince(landedAt, 900)`；与 v0.76「"某句该消失"要容许采样器自己那一拍」同族而方向相反——那一轮怕读早，
  这一轮怕读在**同一刻**；② **5 秒粒度的文件轮询会把"落定"读晚**——`waitForLiteral` 每 5000ms 探一次盘，
  `landedAt = pageNow()` 因此能比真写晚 5 秒，"● 归 0"与"「已自动保存」首拍"两格同时被推后 ⇒ 改 500ms 粒度，
  且落定锚改成按**那一枚写自己的 `startTime + duration`**（`landedPage()`）而不是页内"现在"；③ 状态栏
  `.editor-status` **本来就是两枚 span**（v0.73 那两层渲染），`X.stat()` 第一版只取 `querySelector` 的第一枚 ⇒
  现在把全部 join 起来（这一枚在 dev 腿与 release 腿各撞一次）
- **验证（五腿 + 编译）**：release A/B 真机 **30 / 真失败 0**（对照件＝本轮改动前当场存档的那支 0.78 exe）、
  前端结构 **28 / 0**、变异检查 **16 枚 + 正控制 / BAD 0**、CDP dev **14 / 0、页面异常 0 条**，`cargo test --lib`
  **97 通过 / 0 失败 / 11 ignored**（与 v0.63~v0.78 同一份基线——Rust 本轮一个字没动），+ tsc 与
  `pnpm tauri build --no-bundle` 绿（openoffices v0.79.0）；五腿都在**版本号 bump 之后**跑（老规矩），
  结构腿与变异腿在最终源文上复跑过一次（28 / 0 与 16 枚 BAD 0，与 bump 后那两份同数）
- **本轮没动的，量出来记着**（已开进路线图）：**这一格在 release 上没有可观测面** ⇒ "渲染阶段写外部 store"这一类
  缺陷从此只能由 dev 腿判（React DEV 告警 + 栈帧分类），A/B 无从对照；**那把阶段分类器仍是一把手工尺子**——
  标记表由本轮实测里出现过的帧名拼出，React 换版本就要重校，而正控制只能证"这一版认得出"；
  **每次按键都调 `markDirty` 仍是 O(标签数) 的 `getState()`**（本机量到 ≤0.1ms，而 20 枚标签的形状没量）；
  **`setDeck` 的 updater 里仍有整片 `slides.map(s => ({ …s }))` 拷贝**（本轮只挪了一句，没量 updater 被双跑时的拷贝成本）；
  另存为／导出 pptx 之后"再编辑 ● 该不该亮"仍未量（与 v0.78 同源）、多枚 `.opd` 同时脏时每枚各自的时钟与认领关系仍未量、
  「已自动保存 X」有悬停而手动那句仍没有次数账、DocEditor 剩四枚裸 `setTimeout`、`SheetEditor.exportPdfTo` 内联那份
  拼句公式、PDF 大件 ~1030ms 仍未归因（**⇒ v0.80 改口：已归因为 pdf-lib 的宏任务让出并兑现，见下一节**）、
  中件 164ms 与门值 200ms 只差 36ms、在途锁按 `tabId` 不按 `path`、
  `SAVE_BUSY_MS` / `AUTO_BASE_MS` / `AUTO_MAX_MS` 是单机数、写侧前缀三家不统一、toast 体系照旧未建；
  自动更新的应用内下载安装与 macOS 打包按指令继续等信号

## 那 1030ms 是 pdf-lib 在等时钟而不是在写文件：让出粒度按块预算定在一处（v0.80）

起点是 v0.70 记下的那一格、并在 v0.71~v0.79 连续七轮收尾时被写成「仍未归因」的那条：大件（2300 页）按 Ctrl+S
整趟 1071~1161ms，而 `write_file` 自身只有 4~95ms ⇒ 钱在 pdf-lib 的 `load` + `save`，但没有分段打点就说不出口
各档占多少。本轮把它归因并兑现，改动全在前端那一层（新建 `src/lib/pdf-ticks.ts` + 六处站点各多一个参数），
**Rust 一个字没动**（先例 v0.64~v0.79），没有新增时钟、没有新增分层、没有动 worker。

- **前置实测①（`tmp/x80/pre2d.mjs` / `pre2e.mjs`，dev 腿 + 临时打点，只量不改产品）先把"等"与"忙"分开**：
  ① 分段（同一枚件连打两趟）——`read=14/12`、`load=236/233`、`strip=2/3`、`add=1/1`、`save=749/746`、
  `write=23/15`，整趟 1025/1010ms ⇒ 九成以上的时间在那两段 **await** 上；② **而这两段根本不是同步块**——
  同一枚函数按"只算同步那一截"与"算到 await 结束"各量一遍，得到 `loadSyncOnly=0 / loadAwaitOnly=236`、
  `saveSyncOnly=0 / saveAwaitOnly=750`；③ 页内 10ms 空闲打点器在那一截里 `gapCount=0`、`longtask=[]`，
  Node 侧往返 `max=8 / p90=2 / med=1` ⇒ 主线程没被占住，也没有在跨进程上排队；④ 忙的比例（`dTask` 增量
  133/100ms 对整趟 1022/996ms）⇒ **`mainThreadShare=10.9%`，且它含本轮的 CDP 轮询所以是上界**；
  ⑤ 正控制——`E0 busy300 control: dScript=300.4 dTask=302.0`（打点器认得出人为的 300ms 块）而真保存那一趟
  `dScript=1.6/1.5` ⇒ **这把尺量得到东西，所以"量不到忙"不是尺的失灵**。
  结论形状：约九成时间主线程**空着**，而它空着是因为 pdf-lib 每处理 `objectsPerTick` 枚对象就
  `waitForTick()` 让出一个宏任务（`setTimeout(…, 0)`，Chromium 对嵌套零延迟定时器钳到 ≥4ms）
- **前置实测②（`pre2f.mjs` / `pre3.mjs` / `pre3b.mjs`）把"让出多少枚 × 每枚值多少"量成算术，再扫一根粒度阶梯**：
  件里 `objects=4764`，库默认（load 100 / save 50）下 expected-yields = 4764/100 + 4764/50 = **142 枚**，
  钳位隐含 568ms 而实测差 938ms ⇒ **每枚让出约 6.6ms**（比 4ms 的钳位下限贵，因为宏任务之间还有别的活）；
  阶梯（同一枚 2300 页件，页内墙钟）——默认 100/50 **985ms** → t500 157 → **t1500 73/96** → t4000 57 → fastest 55；
  **产物字节随粒度不变**：五档 `hash=c4b260253a7f` 同一份（小件 12 页那档 wall 2~3ms、`54b74efb14d0` 同样五档一致）
  ⇒ 这一改只动时间不动内容，这是本轮敢做的前提；而**越激进单枚同步块越长**：`maxGap` 默认 0 → t1500 28 →
  t4000 35 → fastest 65，Node 侧往返 `max` 3 → 10 → 22 → 54 ⇒ 本轮取 **1500**（pdf-lib 自己的
  `ParseSpeeds.Fast`）而不是最快档——最快档把 65ms 的块留在主线程上，那是 v0.66「别把主线程点着」那一族
- **本轮唯一的架构决定：一枚常数、一处持有、六处站点**——新建 `src/lib/pdf-ticks.ts` 只导出
  `PDF_OBJECTS_PER_TICK = 1500`，喂给全仓六处 pdf-lib 站点（两处 `PDFDocument.load({parseSpeed})`：
  `PdfViewer.writeAnnosTo` 与 `lib/pdf-pages.ts` 的 `loadDoc`；四处 `.save({objectsPerTick})`：viewer 那一路的
  `pdoc.save` 与 `saveDoc`/`extractPages`/`splitPdf`）。**没有**做的三件事各有理由：不搬进 worker（本轮的账是
  "等"而不是"忙"，搬到 worker 只是把等待换个线程，而 `save` 的返回要跨线程回递给界面）、不做"只写变更的注解"
  （那是内容层的改动，与让出粒度不同一件事，且会把 v0.32 那条"整片清旧注解"的账重开）、
  也不给读与写各立一个数（实测里 `load` 与 `save` 两段的让出成本同一量级，两个数就是两根阶梯要各扫一遍）
- **release A/B 的账（两支真 exe × 3 趟 / 27 通过 / 真失败 0 / 显式 SKIP 0 / 页面异常 0 条）**——对照件＝本轮
  改动前当场存档的那支 0.79 exe：● **按键到写出门** ctrl Δ `[1024, 1028, 1034]` / exp Δ `[148, 172, 153]`，
  E7b 两支逐趟分开（对照件最小 1024 > 实验件最大 172）；● **门值那一格兑现**：实验件三趟 Δ 全部落在
  `SAVE_BUSY_MS=200` 之下 ⇒ 那句「正在保存…」不再上屏（`progressRows=[]`），而对照件每趟都在 **217~219ms**
  上屏并活 `[819, 818, 828]`ms——v0.70 那句"进度句可看 940ms"说的就是这一段，本轮买的是"等待没了所以句子
  没有内容可说"；● **内容一格没动**：两支写出去的字节同一份 `d46fd9db95ae3c0d`（A9）、两支各只一枚写请求（A10）、
  盘上 `{pages:2300, annos:40}` 与侧栏落定枚数逐趟相同（G6a/G6b/G6c）；● **没长出新等待**：每趟"按键之后那一截"
  的同步块 `[]`（G7）；● 落定之后 ● 归 0、屏上「已保存」、`savedGap` 25~33ms；● 写自身 ctrl `[15,15,18]` /
  exp `[19,19,18]`ms（Rust 那一头本来就一字未动）。**分界 `DIV=600` 在本腿跑之前就定好**（v0.70 实测那一格
  ~1030ms 的一半留量），不拿本轮烟测的读数倒推门槛值
- **顺带量到一枚既有缺陷（早退那一趟 `X80_EARLY=1`，两支同犯，本轮一毫秒没为它改）**：在标注导入扫完之前按
  Ctrl+S，写回去的那一份会把 **`/Annots` 整片抹掉**——按下时页龄 ctrl 594 / exp 1447ms（侧栏那枚计数还没落定），
  两支落盘都是 `annos: 0` 且哈希同为 `ca72e8c365681d03`，而屏上照旧「已保存」、● 照旧归 0 ⇒ 界面说"存好了"
  而 40 枚标注没了。正常那一臂因此改成**先等侧栏「标注 N」落定再按**（`settleAnnos()`，判据吃
  `disk.annos === sideCount` 而不是硬编码 40）。这一格需要的是"读侧未就绪就不许写"那道闸，与让出粒度不是
  同一件事，**已开进路线图而不是并进本轮**。诚实记账：早退那一趟的 G6b/G6c 读数是空集合 `[]`（那两枚只吃
  gated 趟），所以它们在那一趟**不表态**，只有 `disk.annos=0` 这一格当证据
- **前端结构 21 / 0**（B0 自检 5/5，吃**剥掉注释之后**的源文）：S1a/S1c 钉"这枚数只在一处导出、整个前端只有
  这一处定义"、S1b 钉定义处字面量 = 1500、S2a 钉 load 站点数 = 2 且 S2b 每一处都带 `parseSpeed:
  PDF_OBJECTS_PER_TICK`、S3a 钉 pdf-lib 的 save 站点数 = 4 且 S3b 每一处都带 `objectsPerTick: …`、S4 钉站点上
  没有写死的数字、S5a/S5b 钉两处各从 `./pdf-ticks` 与 `../lib/pdf-ticks` 取、S6 钉"没有一处走库默认的让出
  粒度"、S7 钉文档/表格/演示/外壳不吃这枚常量
- **变异检查 14 枚（12 枚 + 2 枚正控制）/ BAD 0 / 多打中 0**：M1~M6 把六处站点逐一退回库默认或裸调用（各响
  S2b 或 S3b + S6）、M7 常数被改成库默认的 50（响 S1b）、M8 站点写死数字而不吃常量（响 S2b+S4）、M9 组件里
  另立一份同名常数（响 S1a+S1c）、M10 页面操作不走那一处而自带一份（响 S1c+S5a）、M11 表格头被顺手接上
  （响 S7）；P1 注释里的假站点不算站点、P2 代码里的真站点必须响（两枚正控制）
- **CDP dev 腿只吃形状**（15 通过 / 真失败 0 / 显式 SKIP 0 / 页面异常 0 条 / `staleIpc=0`）：D0b 新模块在跑的
  这一趟上（值 = 1500）、D1a/D1b 大件 2300 页且内存标注**非零**（否则"一枚没少"是空断言）、D2a 写请求出过门
  （dev 只判 ≥1 枚不判枚数）、D2b/D2c 落定在「已保存」且 ● 不在、D3a `f5ae02e02ded166a → d46fd9db95ae3c0d`、
  D3b/D3c 重载之后页数没变且标注 40→40、D4a 同一枚件第二次保存仍然成功、D5a/D5b 小件那一头也走得通。
  **dev 的数字一律不吃成产品指标**（v0.66 那条老规矩第五次兑现）：归因那两批腿也全在 dev 上（release 上
  没有分段落点），本轮吃的是"同步段为 0 / 让出枚数与墙钟对得上 / 哈希随粒度不变"这三条**形状**
- **本轮撞到四处量具坑，都不是产品**：① **`SKIP(cond) || check` 是假绿形状**——`null || x` 会把 `x` 照常求值，
  而空集合上的 `every([])` 自己为真，于是"这一条本轮没跑"被报成 `PASS ctrl·G6b … :: []`；改成
  `need(present, check)`（判据先认得"这一臂没跑"才谈得上报 SKIP）；② **模块级 `const` 声明在用它的那段之后**
  ⇒ `ReferenceError: Cannot access 'SKIP' before initialization` 崩在 7 条 PASS 之后——"跑起来了"和"跑完了"
  是两件事，长跑腿的日志要能看到它死在第几行；③ **整窗的 longtask 计数会把文档打开那一段算到这次保存头上**——
  第一版实验件读到 `longCount:2 / longMax:240`，看着像"本轮把等待换成了卡顿"，按 `t >= pressAt - 5` 筛之后
  两支都是 `[]`（那几枚 ≥50ms 的块属于 opening，不属于 Ctrl+S），与 v0.73「窗口判据的起点要锚在触发之后」同族；
  ④ **一支的读数不能同时当两支的门槛**——烟测那趟实验件读到 331ms 时，先写的 `E7 < 300ms` 会把自己的改动判成
  缺陷；分界必须由 prior 实测给（本轮 `DIV=600`），本轮因此另立 E7b「两支逐趟分开」这种纯分离形判据
- **验证（五腿 + 编译）**：release A/B 真机 **27 / 真失败 0 / 显式 SKIP 0**（3 趟 × 两支真 exe）、前端结构
  **21 / 0**、变异检查 **14 枚 + 正控制 / BAD 0**、CDP dev **15 / 0、页面异常 0 条**，`cargo test --lib`
  **97 通过 / 0 失败 / 11 ignored**（与 v0.63~v0.79 同一份基线——Rust 本轮一个字没动），+ tsc 与
  `pnpm tauri build --no-bundle` 绿（openoffices v0.80.0）；五腿都在**版本号 bump 之后**跑（老规矩），
  结构腿与变异腿在最终源文上复跑过一次（21 / 0 与 `RESULT mutants=14 bad=0`，与 bump 后那两份同数）
- **本轮没动的，量出来记着**（已开进路线图）：**存盘走在标注导入之前会把 `/Annots` 整片抹掉**（上面那一格的
  账，两支同犯、0.79 同样犯，本轮只量出代价没有修；**v0.81 已修**——写回那一路改成只认「哪一份 doc 已经整片
  读完」那本就绪账，闸门立在两条写通道共吃的那一处）；**更激进的两档只由 dev 侧阶梯量过**（t4000 57ms /
  fastest 55ms，而单枚同步块 35 / 65ms）——本轮选 1500，那两档没在 release 真机走过；
  **`PDF_OBJECTS_PER_TICK = 1500` 是本机单机的数**（换机器或换件要重扫那根阶梯，而 4ms 钳位是 Chromium 的不
  是我们的）；**release 上没有分段落点** ⇒ 分段归因只能来自 dev（本轮为此临时改过一份 `PdfViewer`，产物已删；
  想要长期观测就得给存盘那一路做正式打点通道）；**页面操作五路（旋转/删除/提取/合并/拆分）wired 但没在真
  大件上量过整趟**（结构腿与变异腿判的是接线）；**中件那一档 A/B 没跑**（本轮只跑 2300 页件，所以"Δ 落在
  门值之下"这一格在大件上成立、在中件上仍是 v0.70 那次的旧读数）；另存为／导出 pptx 之后"再编辑 ● 该不该亮"
  仍未量、多枚 `.opd` 同时脏时每枚各自的时钟与认领关系仍未量、「已自动保存 X」有悬停而手动那句仍没有次数账、
  DocEditor 剩四枚裸 `setTimeout`、`SheetEditor.exportPdfTo` 内联那份拼句公式、在途锁按 `tabId` 不按 `path`、
  `SAVE_BUSY_MS` / `AUTO_BASE_MS` / `AUTO_MAX_MS` 是单机数、写侧前缀三家不统一、toast 体系照旧未建；
  自动更新的应用内下载安装与 macOS 打包按指令继续等信号

## 界面说"存好了"而 40 枚标注没了：写回那一处只认「哪一份 doc 已经读完」这本账（v0.81）

起点是 v0.80 的 A/B 顺带量到、当轮只记下代价而没有修的那一格既有缺陷（路线图「标注还没扫完就按 Ctrl+S，会把
`/Annots` 整片抹掉」）：**写那一路是「整片清旧注解 + 按内存那一份重加」，而读那一路（逐页扫 `/Annots` 之后再
publish）是异步的** ⇒ 在两者之间按 Ctrl+S，内存此刻**不是文件的视图**，落盘就把文件里那 40 枚注解抹了，而屏上
照旧「已保存」、● 照旧归 0。本轮把它修掉，改动全在前端那一层的**一个文件**（`src/components/PdfViewer.tsx`，
+23 行 / −1 行），**Rust 一个字没动**（先例 v0.64~v0.80），没有新增时钟、没有新增分层、没有动 worker。

- **前置实测①（`tmp/x81/pre1.log`，dev + 只量不改产品）先把"坏在哪儿"量成四格**：300 页件上同一条动作在窗口内与
  落定之后各跑一遍——A0 触发时内存 `0` 枚、**A1 落盘 `40 → 0`**（`b5d26635504970 → d350cb9a1e33ab`）、A2 页数与
  旋转没被顺手动到（`pages:300, rot:[0,0]`）、A3 GAP 屏上说的是**成功**（`status:""` `dots:0`）、**A4 同一条动作在
  落定之后执行是齐的**（`settleAt=1, annos:40`）⇒ 缺陷归**时序**而不归内容，这一格是本轮所有判据的地基
- **前置实测②（`pre2.log` / `pre4.log`，同样 dev 腿 + 临时钩子，只吃形状）量到两格独立缺陷，而不是一格**：
  ● 大件（2300 页 + 真实按键）
  C1 `40 → 0`（`landed at=1266`、`hash 9bea7c532a843e`、快慢读一致）、C3 那句是「已保存」+ ● 归 0，期间还说过
  「正在保存…」（`dt=312`）；**D1 页面操作那一路（旋转）同样抹**（`before:40 → after:0`、`结果 rotated`）而
  **D2 旋转本身真的生效**（`rot:[90,0]`）⇒ 不是"整趟失败所以没来得及抹"；● **第二格在收尾的形状**：
  ADD1b 落定后内存是 `40` 而不是 `41`、`rect 枚数 7` ⇒ 终值把**窗口内用户刚画的那枚替换掉了**，ADD2b 于是盘上
  也只有文件那 40 枚（GAP ADD3b 屏上仍是「已保存」●0）；pre4 从"改内容"那一头再证一遍：E1 窗口内画一枚再按
  Ctrl+S ⇒ 落盘只剩 `{"Square":1}`（文件那 40 枚没了）、E2 屏上「已保存」●0，而 E3/E4/E5 落定之后同样两条动作
  落盘 **41 枚** ⇒ 这一头要的除了闸门还有「收尾是**并**不是**替**」
- **前置实测③（`pre5.log`，dev，量"挂载之后、doc 之前"那一段）把「只记在途」那一版挡不住的那一格钉出来**：
  Z1 按下这一刻 `viewer:true / pages:0`（24 枚按下）、**Z2 那本「哪一份还在读」的布尔账此刻是 `false` ⇒ 闸门还没
  挂上**、Z3 于是 `40 → 0`（`2bde644fbf70e6 → 9bea7c532a843e`）⇒ **记「在读」挡不住「还没有 doc」那一段**；本轮
  因此把账记成「**哪一份 doc 已经读完**」而不是「哪一份在读」——初值为空，挂载后第一件事就是没读全
- **本轮唯一的架构决定：写回那一路只认一本按 doc 身份开的就绪账，而闸门只立在两条写通道共吃的那一处**
  （`writeAnnosTo` 函数头、取内存列表**之前**）。四格各有出处：① **身份而不是布尔**（doc 还没来、正在逐页扫、读到
  一半失败、reload 换出新 doc 四种情形统一落在"没读全"里，S2b 钉 `!d ||` 与身份比较两半都要在）；② **这本账是
  状态而不是直接写 ref**——那句 `setAnnosRead(doc)` 与合并那一句在同一批更新里 ⇒ 门开的那一刻内存已经是整片；
  这一格由 dev 腿的 ref 那一版自证：`FAIL Q3 … :: {"内存":0,"读全":true}` 加上
  `MEASURE P1 开账那一拍 {"t":48514,"n":0,"writable":true}` / 后一拍 `{"t":48550,"n":40}` ⇒ **中间那一拍约一枚
  rAF（36ms）里闸门是开的而写回读到的是空片**；最终版同一条判据（改名 `P1a`）读到开账那一拍就带 `n:40`；
  ③ **读到一半失败 ⇒ 故意不记账**（读到的不是整片；代价明说：这一档写回会被一直拒到重新打开这份文件，
  **没有"重试导入"那一路**——**v0.83 补的正是这一路**：闸门那一条纪律一个字没动，而"直到重新打开"那句已经不成立）；
  ④ **没有任何一处销账**（S4 钉全仓零枚 `setAnnosRead(null)`——换 doc 时旧账自然不认
  新 doc，而销账等于把门开回 v0.80）；● 顺带把收尾从 `setAnnos(out)` 改成 `setAnnos((cur) => [...out, ...cur])`
  （ADD1b 那一格的正面兑现：窗口内画的那枚不再被终值替掉）
- **release A/B 的账（两支真 exe × 3 趟 / 49 通过 / 真失败 0 / 显式 SKIP 0 / 页面异常每趟 0 条）**：对照件＝本轮
  改动前当场存档的那支 0.80 exe；时序由我们把「什么时候开件」钉住——**先裸起 exe、附 CDP、装 helper、起页内
  actor，再 spawn 第二枚实例把路径转发给这扇活窗口**（single-instance 转发），于是首拍 `t 1735~1782ms` 那一刻
  工具条已经在而 `.pdf-pageinfo` 还是 `"/ -"`。● **ctrl（0.80）**：M0 按下枚数 `[17,17,16]`、C1
  `{"pre":40,"按下落盘后":0,"byKind":{},"hash":["2bde644fbf70e6","9bea7c532a843e"]}`、C2 写请求真出门
  （`[{"s":1982,"d":13}]`，不是"点了没反应"）、C3 那句拒绝 **0 拍**（对照件根本没有这本账）、C4 落定之后第二次
  保存把那 40 枚写回（`{"落定盘上":0,"第二次落盘":40}`）⇒ 丢的正是"按下到落定"那一段；● **exp（0.81）**：按下枚数
  `[11,10,11]`、**E1 这一按没改文件**（`pre:40 / 按下后:40`、哈希仍是 `2bde644fbf70e6`）、**E2 窗口内写请求 `[]`
  而落定之后同一把尺量得到**（`[{"s":8681,"d":16}]`）⇒ 那个 0 不是缓冲溢出、E3 那句「保存失败: 标注还没读全，
  这一趟没写文件（现在存会抹掉还没读进来的标注），等读全再存」说了 `[10,9,10]` 拍、E4 落定之后侧栏「标注 40」而
  盘上 40、E5 这时按 Ctrl+S 写得出去（40 枚 / 2300 页 / 屏上「已保存」）；● **三枚纯分离形判据**（不拿一支的读数
  当另一支的门槛）：SEP 按下落盘枚数 ctrl `[0,0,0]` vs exp `[40,40,40]`、SEP2 说的话 ctrl `[0,0,0]` vs
  exp `[10,9,10]`、**SEP3 落定之后两支都把 40 枚写回 `[40,40,40]` / `[40,40,40]`，两支第二次落盘哈希同为
  `bc482236284a04`** ⇒ 本轮没有把正常那一路改坏；● 两处诚实记账：**● 那一格只写日志不判**（这一臂没有编辑动作，
  "拒绝期间 ● 该不该亮"只有 dev 腿 R4 判过形状）；**侧栏落定距第一按 ctrl `1498/1472/1488ms` vs exp
  `6741/6710/6763ms` 未归因**（两支导入快慢的差异不是本轮的判据，本轮既不把它写成收益也不写成回归）
- **前端结构 21 → 26 / 0**（B0 自检 6/6，吃**剥掉注释之后**并归一成 LF 的源文）：S1a 就绪账是
  `useState<PDFDocumentProxy | null>(null)` 而不是 ref、S1b 渲染期镜像恰好一处、S1d 没有任何一处把 doc 直接写进
  这本账（arm-on-import-start 那一版就犯在这）、S1e 镜像紧跟声明（搬进 effect 会让门开那一拍读到旧镜像）、
  S2a 身份比较的闸门恰好一处、S2c 闸门排在 `writeAnnosTo` 之内而**读内存列表之前**、S2d 那句拒绝文案整个前端只写
  一处、S3a 合并紧跟记账（同批提交的形状）、S3b 收尾走并而不走整片替换、S4 全仓没有销账、S5b 失败那一路不记账、
  S6 DEV 钩子两半都在（`null` doc 也算不许写）、S7 记账调用点恰好一处、S8 `annosReadRef` 一共四处引用、
  S9 另外三头没有这本账、S10b 页面操作通道不自己 throw（它只共吃那一处）
- **变异检查 17 枚（14 枚 + 3 枚正控制）/ BAD 0 / 多打中 0 / 基线 struct=20/20**：M1 收尾回到整片替换（响
  S3a,S3b）、M2 导入一开头就把账记上（S7）、M3 导入一开头就写镜像（S1b,S1d,S8）、M4 闸门整句删掉
  (S2a,S2b,S2c,S2d,S8)、M5 闸门只判「有没有 doc」而不认身份（S2a,S2b,S8）、M6 闸门排在取内存列表之后（S2c）、
  M7 就绪账换成 ref（S1a）、M8 渲染期镜像搬进 effect（S1e）、M9 读到一半失败也记账（S5b,S7）、M10 换 doc 时销账
  （S4,S7）、M11 合并与记账之间夹进别的语句＝拆成两批提交（S3a）、M12 页面操作通道自己再立一道闸
  （S2a,S2d,S8,S10b）、M13 这套账照抄进文档头（S2d,S9）、M14 页面操作不再先把内存标注写回文件（S10a,S10b）；
  P0 什么都不改必须全绿、P1 注释里的假站点不算站点、P2 代码里的真站点必须响（S4）
- **CDP dev 腿只吃形状（26 通过 / 真失败 0 / 显式 SKIP 0 / 页面异常 0 条）**：X0/X1a/X1b/X2/X3 在挂载后的窗口里
  17 枚按下、没有一把碰得着文件（哈希与盘上枚数都没动）而那句拒绝上了屏；**R4 拒绝期间 ● 没被清掉**（拒绝兑现
  就不该宣布存好了）；R5/R6 落定之后内存 41 枚、`rect 8 = 文件 7 + 用户 1` ⇒ 窗口内画的那枚没被终值替掉；R7/R8
  这时才写得出 41 枚并说「已保存」；Q1/Q2 在途时**页面操作**也没写成文件（`rot:[0,0]`）而说的是「旋转失败: 标注
  还没读全…」，Q4 落定之后同一枚旋转真生效而 40 枚没少；P1a 门开那一拍内存已经是整片；S1/S2/S3 小件那一头也走得
  通。**dev 的数字一律不吃成产品指标**（v0.66 那条老规矩第六次兑现：X4/R5 的 `settleMs` 只记「出过门」）
- **验证（五腿 + 编译）**：release A/B 真机 **49 / 真失败 0 / 显式 SKIP 0**（3 趟 × 两支真 exe）、前端结构
  **26 / 0**、变异 **17 枚 + 正控制 / BAD 0 / 多打中 0**、CDP dev **26 / 0、页面异常 0 条**，`cargo test --lib`
  **97 通过 / 0 失败 / 11 ignored**（与 v0.63~v0.80 同一份基线——Rust 本轮一个字没动），+ tsc（exit 0）与
  `pnpm tauri build --no-bundle` 绿（openoffices v0.81.0）；五腿都在**版本号 bump 与最终源文（21:50）之后**跑
  （老规矩），结构腿与变异腿在最终源文上复跑过一次（26 / 0 与 `RESULT mutants=17 bad=0 多打中=0`）
- **本轮撞到七处量具坑，都不是产品**：① **尺子的通道名认错就会把"量不到"读成"没发生"**——PDF 这一头写的是**字节**
  （`lib/fs.ts` 的 `writeBytes` → plugin-fs 的 `writeFile` ⇒ `plugin:fs|write_file`），不是文档/演示那两头的
  `write_text_file`；"窗口内 0 枚写请求"这条判据因此必须成对写（同一把尺在落定之后**量得到**才算数，E2 就是这么
  立的）；② **CDP 的 `awaitPromise:true` 会把"以 Promise 结尾的表达式"await 到底** ⇒ arm 页内 actor 那一步自己
  卡住，症状与"产品挂了"同形；表达式收尾给字符串；③ **窗口判据的起点要锚在按下之后**（`e.s >= pressAt - 5`），
  否则落定之后那一按的写会算进"窗口内那一臂"（v0.73/v0.80 那一族第三次兑现）；④ **仓库 TS/TSX 源文是 CRLF**
  ⇒ 静态腿在剥注释之后统一归一成 LF，否则所有按「紧跟下一行」形状的判据永不成立，而**变异腿会在自己的说明书上
  假绿**；⑤ **`annosReadRef.current\s*=` 会把比较也算成写**（DEV 钩子里 `=== docRef.current` 同前缀）⇒ 判"写"
  一律用 `=(?!=)`，否则 S1b 报 2 枚、S1d 把比较报成违例；⑥ **负向预查会被 `\s*` 的回溯打败**：
  `current\s*=(?!annosRead)` 里 `\s*` 可以回吐一个空格让预查看到空格而通过 ⇒ 判据与明细自相矛盾
  （`FAIL S1d … :: {"违例":[]}`）；修法是把候选先收齐、再判**收上来的那一份**（判据与明细同源）；⑦ **变异锚点
  必须计枚数**：`let cancelled = false\n;(async () => {` 在文件里有 3 枚、
  `useState<PDFDocumentProxy | null>(null)` 有 2 枚（174 行与 221 行），第一版锚点太短 ⇒
  `BAD M2/M3/M7 :: 变异没打上`；**这枚 `throw` 正是挡住假绿的那一手**（锚点没打上会被读成"这一枚没响"＝产品没事）
- **本轮没动的，量出来记着**（已开进路线图）：**导入失败之后写回会被一直拒到重新打开**（没有"重试导入"那一路；
  这是③那一格的代价，本轮选的是"宁可拒也不抹"而不是加一条重扫——**v0.83 兑现的就是这条重扫，而"宁可拒也不抹"那条一个字没改）；**拒绝期间用户这一趟的意图无法兑现**（画的那枚
  仍在内存、● 仍挂着，而旋转/删除那一路直接失败且不排队——落定之后要不要自动补做没有判据；**v0.83 明确不做这一条**，
  理由与代价都写在 v0.83 那一节）；
  **`annosWritable` 是 DEV-only 观测量** ⇒ release 判"这一按该不该被拒"只能吃状态栏那句 + 盘上枚数（**v0.83 起
  "门开了"这一格在 release 上也看得见**——重试成功那一路说的是状态栏上那句「标注已读全：N 枚，现在可以存回文件了」，
  而"该不该被拒"仍然只有那句拒绝 + 盘上枚数）；
  **release 只量了 pre-doc 那一档**、● 那一格在 release 上无从判（这一臂没有编辑动作）；
  **reload 换出新 doc 那一段本轮只由结构判据钉住**（S4 + M10）——dev 腿最终那一跑（`dev3.log` 26 条）没有 L 段，
  读到 `FAIL L0 {"读全":true,"内存":0}` 的是 ref 那一版（`dev.log`），所以这一格的形状证据属于"错法被量到"而不属于
  "最终版跑过"；**ctrl 与 exp 的侧栏落定时长差（~1.5s vs ~6.7s）未归因**；**小件那一档 A/B 没跑**（dev 腿 S 段
  只吃形状）；另存为／导出 pptx 之后"再编辑 ● 该不该亮"、多枚 `.opd` 同时脏时每枚各自的时钟与认领关系、「已自动
  保存 X」有悬停而手动那句仍没有次数账、DocEditor 剩四枚裸 `setTimeout`、`SheetEditor.exportPdfTo` 内联那份拼句
  公式、在途锁按 `tabId` 不按 `path`、`SAVE_BUSY_MS` / `AUTO_BASE_MS` / `AUTO_MAX_MS` 是单机数、写侧前缀三家不
  统一、toast 体系照旧未建；自动更新的应用内下载安装（v0.82 已兑现，见下一节）与 macOS 打包按指令继续等信号

## 装那一步前面只问一句「还有几处没保存」：下载与安装分两拍，闸立在「装」之前（v0.82）

起点是 v0.45 那一版的边界——只有检测层（`check` 一次、说一句话、给一枚「前往下载页」），权限也只给
`updater:allow-check`。本轮把它接成**检测 + 下载 + 安装**三拍。用户拍板了两件事：**在真机上真跑一次「装」**
（装进一次性目录、验完自行卸载），以及**更新源托管本轮不定**（`tauri.conf.json` 的端点继续是 GitHub releases
占位 URL）。产品改动只有**三枚文件**：`src/lib/update.ts`（+102 行）、`src/components/Home.tsx`（+72 行）、
`src-tauri/capabilities/default.json`（+2 枚权限）；**Rust 侧一个字没动**（`cargo test --lib` 与 v0.63~v0.81
同一份基线），没有新增时钟、没有新增分层。

- **前置实测①（`tmp/x82/leg1.out`，0.81 件 + 本地 http 源）先量"这一路原来能不能走"**：P1 首页那句
  `版本 0.81.0`、P2 `check` 认得出 `available:true / 0.99.0 / current 0.81.0`（检测层本来就是通的）、
  **P3 `download` 直接被拒**——`updater.download not allowed. Permissions associated with this command:
  updater:allow-download, updater:default`，`ms=5`、**`events=0`** ⇒ 权限是这一路的真门，而拒得比网络还早
  （五毫秒、一枚事件都没发出去，所以"下载失败了"绝不能被写成网络问题）；P4 `%TEMP` 快照
  `before=1246 after=1246 freshInWindow=[]`（这一趟当然零落点，它顺手证明了这把尺认得出落点）；
  P5 同版本 `available:false`（v0.45 那格去重仍成立）
- **前置实测②（`leg2.out`，本轮注入件 + 三枚权限 + 真签名的 10 MiB 包）量的是"下载到底做了什么"**：
  Q0 包体 `10485760` 字节、`GOOD_SHA=5560571d481f9992` 与 `BAD_SHA=c359c0a0db2b61f9`（同一把私钥的签名盖在
  **另一份字节**上，这就是"被动过"那一档的夹具）；Q2 good 那趟 `ok` `468ms` `events=42`；
  **Q3 `{finished:0, progressCount:41, chunkSum:10485760, chunkMin:8023, chunkMax:417792, gapMax:12, longCount:0}`**
  ⇒ 逐枚 `Progress.chunkLength` **加起来正好等于包体大小**，所以字节数不必去读 `Finished`；
  **Q5 `landed=[]`——`%TEMP` 里一个新落点都没有**；Q7 bad 那趟 `The signature verification failed`（`426ms`、
  `events=43`）⇒ **验签是下完整个包之后才报的**，这一路必然已经花掉了流量；Q9 依旧 `landed=[]`
- **前置实测③（`leg3.out`）把"这些字节住在哪儿"量成一格**：宿主工作集 **68.2 → 78.5 MiB（下载之后）→
  68.4 MiB（`close()` 之后）** ⇒ 下载期内存在 Rust 侧、`close()` 就是把它放回去的那把手；同一趟
  `finished:1 progressCount:32`——**与②那趟的 `0/41` 不一致**，所以**事件枚数与 `Finished` 是否出现都不能当判据**
  （本轮只吃 `chunkSum` 等于包体这一条形状）；P5/P8 两次 `%TEMP` 快照 `freshCount=0`
- **前置实测④（`leg4.out`）量的是闸读的那本账**：首页 `dirtyCount 0` → 进编辑器打一个字「闸」→ **`dirtyCount 1`
  且 ● 上屏** → 回首页 `dirtyCount` 仍是 1 且 `home-visible true` ⇒ 那句拒绝能在首页读得到工作区的账，
  不需要编辑器挂着
- **前置实测⑤（`leg5.out`）是给判据定尺子的**：按下「检查更新」之前全窗按钮枚举 **33 枚**（模板画廊里九枚都叫
  「新建」）⇒ 任何"这枚按钮在不在屏上"的判据都必须 scope 到 `.home-update`，整窗枚举会把画廊读成更新排
- **本轮唯一的架构决定：闸立在「装」之前，不立在「下载」之前**，而这道题的四条形状都不是可选的：
  ● **下载前面不立闸**——`download()` 只把字节取进 Rust 内存并验签、一个字节不写盘（②的 `landed=[]` 与③的
  工作集涨落是同一件事的两面），给它立闸买不到任何东西，反而把"先看看这包多大"也一起挡了（M16 给下载也立一道
  ⇒ 响 S3g）；● **装前面必须立闸**——Windows 的 `install()` 以 `std::process::exit(0)` 收尾，那一步之后界面
  说什么都没人听见，所以那句拒绝必须排在调用**之前**而不是错误处理里（M1 把它搬到调用之后 ⇒ 响 S3a/S3b；
  M2 整个拆掉 ⇒ 响 4 条；M3 让它永远放行 ⇒ 响 S3d/S3e）；● **第二道闸是「用户明确按下」而不是复选框**——
  「装上并重启」只在 `dl.stage==='downloaded'` 之后出现（A3b/B3b 那格量的就是这个：两拍分得开）；
  ● **不做假取消**——JS 侧没有 abort 通道，所以「下载中…」是**禁用**的那一枚按钮而不是"取消"，
  界面不许诺兑现不了的事
- **三枚权限而不是 `updater:default`**：`capabilities/default.json` 从 `+allow-check` 扩到
  `+allow-check +allow-download +allow-install`（S5a/S5b；M5 少一枚 `allow-install` ⇒ 响 S5a，
  M6 给成宽口径 `updater:default` ⇒ 响 S5a/S5b）；**同时不用一步到底的 `downloadAndInstall`**
  （M4 ⇒ 响 S6a）——两拍分开是界面形状，也是"不可逆那一步要有第二次按下"的形状，交给一步到底的 API 就没了；
  `install({restartAfterInstall:true})` 显式写出（它本是插件默认值，写出来才成为可被钉住的一格）
- **端到端 A 臂（`e2e-A.log`，**真签名 + 真下载 + 脏账之下按「装上并重启」** / 26 通过 / 0 失败）**：
  A2 认出新版本 0.99.0、**A3b 下载之前屏上没有「装上并重启」**、A5 在途那一拍只有「下载中…」、
  A6 下好说的是 `已下载 9.7 MiB · 签名校验通过`、A7 第二拍入口这才出现、Ap 进度 **52 档**严格递增的整数百分比
  `[1,2,3,5,…,100]`；然后是本轮要买的那一格——**Ag 按下之后的屏序是两枚**
  `[err:""] → [err:"还有 1 处未保存改动，先保存再装（装上会立刻退出应用）"]`，A10b 那句里带着**枚数**「1 处」
  （闸读的是真账不是有无），**A11 拒了之后「装上并重启」仍在**（保存之后可以再来一次，状态没被打回 idle）、
  **A12 整排里没有「正在安装…」**（闸排在 install 之前而不是错误处理里）、**A13 30 秒后进程仍然活着**、
  **A14 一次性目录根本没被建出来**（`injDir=false`）、A15 期间 `%TEMP` 零枚新的 updater 临时目录、
  A16 生产目录逐格没动（2 行 vs 2 行）
- **端到端 B 臂（`e2e-B.log`，**干净账之下真的按下去装** / 21 通过 / 0 失败）**：B9 那枚按下之后
  **Bg 屏序第二排是「正在安装…」**，而 **B9b 那句「未保存改动」从头到尾一次都没上屏**（每排读到的都是空串
  `["",""]`——干净账不拦，这是 A10 的负向配对）；**B10 客户端真的退出**（Δ=1868ms，此后界面说什么都没人听见，
  这正是闸必须排在它之前的原因）、**B11 一次性目录里真的装出了 `openoffices.exe`**（Δ=0ms）、
  **B12 装上那支的 `ProductVersion` = `0.99.0`**（装的是清单指的那一包，不是手边那支）、
  B13 `restartAfterInstall` 真的把新版拉起来（pid=30536）、B14 卸载退出码 0、
  **B15 一次性目录卸干净**（`gone=true 等=502ms`）、B16 `%LOCALAPPDATA%/OpenOffices` 全程 2 行 vs 2 行；
  Bp 进度 61 档 `[0,1,3,…,100]` ⇒ **档位数量本身不判**（本机两臂 52 / 61 档，判的是"整数、单调、≥3 档"）
- **release A/B 三臂（两支真 exe + 一支注入件 / CTRL 7 / EXP 7 / NET 11 = 25 通过 / 0 真失败 / 0 显式 SKIP）：
  对照件＝本轮改动前从 HEAD 当场出的那支 0.81 exe**（`tmp/x82/ctrl081/`，保留原进程名）——
  ● **https 那两臂买的是"检测层没回归"**：两支在同一把尺下说的都是诚实归因那句
  「更新源没有返回发布清单…」（私有仓库的 Release 对匿名访问就是 404），**都没说成「已是最新版本」**
  （失败与"没更新"必须分开，这是 v0.45 立的那条），C4/E4 ⇒ available 没到 ⇒ **「下载更新」「装上并重启」都不出门**
  （新两拍不泄漏到走不通的源上），C5/E5 静置 10 秒那句没被后台任何东西改动（**不轮询这一格界面侧也证一次**）；
  ● **"什么时候才联网"这一格只有本地源说得了**（请求是 Rust 侧 reqwest 发的，页面的 Resource Timing 与 CDP
  都看不见），NET 臂用构建期 `-c` 注入 `http://127.0.0.1:8123` 的那支测试件跑：
  **N1 启动 + 静置 12 秒，源上 `0` 枚请求**、N4 清单请求**恰好 1 枚**且排在按下之后
  （`at=1791093690335`，`good/latest.json`）、**N5 按下「下载更新」之前包体 `0` 枚**、
  N7 包体 REQ **1 枚**、到达时刻 `1791093690641`（晚 306ms）、N7b 那一枚确实按规格吐完（`200`、
  `url===file`、`endsWith('-setup.exe')`）、**N8 整趟恰好 2 枚**（清单 1 + 包体 1，没有第三种请求）
- **验证（五腿 + 编译）**：端到端两臂真机 **47 / 0**、release A/B **25 / 0 / 0 SKIP**、前端结构 **41 / 0**
  （B0a~B0e 自检 5/5 + S1a~S10c + G1/G2，吃**剥掉注释并归一成 LF 之后**的源文：五枚导出各只在一处、
  四支新的失败归因字面都在、`available` 那一支**带着 `Update` 对象**走（S2b/M13）、闸的位置与身份与唯一
  （S3a~S3h）、三枚插件调用各只被调一次、三枚权限齐且**不给宽口径**（S5a/S5b）、**全仓没有
  `downloadAndInstall`**（S6a）、没有 `restartAfterInstall:false`、**仓库配置里没有 `insecure` 且端点仍是 https
  占位且没有密钥材料**（S7a/S7c）、只有 Home 引这一层（S8a）、整数百分比一次（S9a/S9d）、
  同句跳过 setState（S10a）、「装上并重启」只在下好之后（S10b）、两拍两枚按键（S10c））、
  变异检查 **19 枚（17 + 2 正控制）/ BAD 0 / 多打中 0 / 基线 struct=41/41**（M1~M17 逐一造"闸搬进调用后"
  "闸拆掉""闸空转""一步到底 API""少一枚权限""给成 `updater:default`""仓库塞 insecure""私钥路径写进源文"
  "启动就联网""进度不取整""界面节流拆掉""别的头照抄这道闸""available 不带 Update""去掉签名归因"
  "去读 Finished 的 payload""下载前面也立闸""Home 自己再写一句拒绝文案"；P0 什么都不改、
  P1 注释里写着判据的字面都必须响 0 条）、CDP dev **23 / 0、页面异常 0 条**、
  `cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（与 v0.63~v0.81 同一份基线——Rust 本轮一个字没动）
  + tsc exit 0 与 `pnpm tauri build --no-bundle` 绿（openoffices v0.82.0）；五腿都在**版本号 bump（三处对齐）之后**跑
- **dev 腿只吃形状**（v0.66 那条老规矩第七次兑现）：**D6 一枚「下载更新」在 StrictMode 双订阅下只换来 `1` 枚包体
  REQ**（整趟源上 1 枚 ⇒ 没有把下载发两遍——这一格只有 dev 有，release 上没有双挂载这一档）；
  D9 验签失败说的是**归因那一句**「更新包签名校验未通过：包体与清单里的签名不匹配（被动过、或不是发布那把私钥签的），
  已在写盘之前拒绝」（不是"下载失败"、也不是静默），**D10 验签没过 ⇒「装上并重启」门都出得来不了**（排里回到
  「下载更新」）、D11 进程仍然活着（拒绝是返回一句话，不是把应用带下去）、D12 bad 那趟包体**确实下过 1 枚**
  （所以那句不是没下就瞎报）；D18 切走工作区再回来，`{那块:"版本 0.82.0检查更新",排:"检查更新"}` ⇒
  **下载那一拍的状态确实丢了**（本轮记账的那条代价第一次量成形状）；D19 页面异常 0 条且**这本账整趟还在**。
  dev 那枚 `已下载 10.0 MiB` 与端到端的 `9.7 MiB` 是**两份不同夹具**，不是回归
- **本轮撞到八处量具坑，都不是产品**：① **`serve.log` 的 REQ 行是"请求到达"、GET 行是"响应写毕"**——限速下两者
  差约 3 秒，所有排序型判据（"这一枚排在按下之后"）必须吃 REQ，否则会把"发出得晚"读成产品慢；
  ② **`fx/mode.txt` 是一枚指针而不是目录**——`mode=bad` 时清单请求仍写 `good/latest.json`、由服务端转读
  `bad/latest.json`，所以**按服务端文件前缀认包体**会把清单误认成包体，认包体只能按 URL 里带不带 `-setup.exe`；
  ③ **N7b 第一版把"这条判据写下时那一档 mode=pkg"当成了产品前提**——good 模式下同一格读到真 `200` 却报 FAIL；
  要判的是"那一枚包体按规格吐完了"，与 mode 无关；④ **`aux` 是 Windows 保留设备名**（`aux.ps1` 写不出来也
  读不到）；⑤ **`aux82.ps1 -Mode kill` 的参数是 `-Path`，`-Id` 是静默空操作**（打印 `KILLED=` 空、进程全在）——
  被 idle-kill 的 dev 树由此留下了继续占 1420 的 vite（v0.78 那笔账的同族，只是这次在 1420 那一头）；
  ⑥ **CDP 对已经死掉的页面是 stall 而不是报错**；⑦ **React 的 setState 不在 `b.click()` 返回前 flush** ⇒
  "按下之后那一排出没出这句话"必须吃页内 MutationObserver 的**序列** + `samples.length>=2` 的非空转守卫
  （A10 / B9b / B9c 用的是同一把尺，两臂各当一次正控制）；⑧ **"文本一变就返回"的谓词第二次踩**——
  第一拍抓到的是中间态「检查中…」（改判成"三种终态都算定"），另同一族的是 D19：`window.__oofErr ?? []`
  在被整页重载抹掉时会读成"0 条异常"，那是**没有这本账**不是没有异常，所以加了 `<no-book>` 哨兵；
  还有一条流程性的：长跑腿**必须 tee 到文件**——本轮 dev 腿第一次"看起来停在 D18"其实是显示截断，
  复跑 `EXIT=0 / 23 PASS / RESULT 行在尾` 才敢报数（先证明量具跑完，再报结论）；**这笔账要如实记着：
  release A/B 的 https 两臂（CTRL 7 / EXP 7）正是在学到这条之前跑的，它们的逐条判据只出在终端输出里、
  没有落盘（`ab-net.log` 只有 NET 臂那 11 条），所以上面那两行的数字属于"当场读到"而不属于"日志可复核"；
  这两臂判的都是句子与按键的可见形状（没有回归），复跑成本低，下一轮动这块时先重跑再说数**
- **本轮没动的，量出来记着**（已开进路线图）：**Home 与 Workspace 互斥挂载 ⇒ 切走再回来，检查与下载两拍的状态
  一起丢**（D18 量成形状；要不要把这份状态搬到 store 那一层没有判据）；**下载没有 abort 通道 ⇒ 不做假取消**
  （在途只能等它自己结束或失败）；**装前那道闸只认脏账枚数**，不认"关闭脏标签时那条确认"的既有链路，而**没有
  路径的新建脏标签也算一处**（有意宽口径——宁可多拦一次）；**`available` 那一档在仓库占位端点下真机根本到不了**
  （全靠构建期 `-c` 注入 `http://127.0.0.1` + `dangerousInsecureTransportProtocol`，这两样只允许出现在测试件的
  注入配置里，仓库配置零枚 = S7a/M7）；**更新源托管仍未定＝端点继续占位**；**签名私钥无备份＝最大单点风险**
  （丢了就再也给不出更新；它只在 `~/.tauri`，不入仓、不进日志、不进 argv）；**真装只在一次性目录验过**，
  生产目录全程未动；**整数百分比节流是本机 32~41 枚事件下量的**（慢网、更大的包没量，而两臂 52/61 档本身不判）；
  **mac 侧 `install()` 的形状未量**（本轮全在 Windows，那一头是 `kill app + 替换 .app`，退出语义与 `exit(0)`
  不同）；**"一枚按键换几枚下载请求"只有 dev 能判**；**release 上"未保存闸"的可观测面只有状态栏那句话 +
  一次性目录没被建出来**（没有 dev 钩子可读 `dl.stage`）；另存为／导出 pptx 之后"再编辑 ● 该不该亮"、
  多枚 .opd 同时脏时每枚各自的时钟与认领关系、「已自动保存 X」有悬停而手动那句仍没有次数账、DocEditor 剩四枚裸
  `setTimeout`、`SheetEditor.exportPdfTo` 内联那份拼句公式、在途锁按 `tabId` 不按 `path`、`SAVE_BUSY_MS` /
  `AUTO_BASE_MS` / `AUTO_MAX_MS` 是单机数、写侧前缀三家不统一、toast 体系照旧未建；macOS 打包按指令继续等信号

## 那句「重试」真的按得下去：导入失败不再只能重开这份文件（v0.83）

起点是 v0.81 收尾自己记下的两条代价：③「读到一半失败就故意不记账」换来的是**写回被一直拒到重新打开这份文件**，
而这一头**没有"重试导入"那一路**——用户能做的只有关标签再开。本轮把它接成一句真话加一枚真把手，窄口径到**一个文件**
（`src/components/PdfViewer.tsx`，+89 / −40）；**Rust 侧一个字没动**，v0.81 那本就绪账与那一道闸门的四条形状
**一条都没改**（改的是"拒了之后有没有尽头"，不是"该不该拒"）。用户拍板三件事：**失败句把页号说出来**、
**闸门关着时在侧栏「标注」页签放一枚真的「重试导入」把手**（点它重跑同一趟），以及**不做**排队补做、
**不做**按页部分写回（两条各开进路线图并写明理由）。

- **前置实测①（`tmp/x83/pre.out`，dev + 临时钩子，300 页 / 40 枚标注那件）先量"重跑买的是不是这一格"**：注入一次
  导入失败之后 `partialOut:29`、`writable:false`、屏上是「标注读取失败: x83 injected import failure」；这一段时间里
  用户**照样能画一枚**（`annos:1 / dots:true / 页签「标注 1」`），而 **Ctrl+S 被拒且盘上那 40 枚一动没动**
  （`P5-disk {annos:40, sha:3298315c5c1694}`）、旋转那一路同样拒；**重跑那一趟之后 `writable:true / annos:40`
  并且随后 Ctrl+S 真落盘**（P3/P4）⇒ 这一格要的不是第二道闸门，而是"再跑一次"这条通道
- **前置实测②（`pre2.out`，12 页 / 3 枚那件）量的是重跑必须自带两道门**：Q4 第一次重跑 `annos:4`（文件 3 + 窗口内
  用户 1）而 **Q6 第二次重跑变成 `annos:7`**（`highlight,highlight,note,note,rect,rect,rect`）⇒ **幂等门不立就会把
  文件那几枚各收第二遍**；Q3 页面操作那一路说的是「旋转失败: 标注还没读全…」（共吃同一处闸门，没有自建第二道）；
  Q7 走的是 reload：进失败态 → 画一枚 → reload → `annos:4 / writable:true`（**换 doc 之后旧账自然不认新 doc**，
  这一头依然不需要销账）
- **前置实测③（`pre3.out` / `pre3b.out`，**十二枚形状各坏的真件**）量的是"确定性坏结构开得了门吗"——答案是开不了**：
  `/Annots` 不是数组（b3）、`/Annots` 是一枚 dict（b7）、`/AP` 悬空（b8）、`/AP` 是数字（b9）、`/Contents` 是 dict
  （b10）、页自指 `/Parent`（b11）、缺 `/Subtype`（b4）、`/Rect` 越界或是字符串（b5/b6）、kid 悬空（b1）、非 dict
  （b2）——**这些全部 `outcome:gated-open`**（pdf.js 逐页容错，读侧照样拿到 1~2 枚、`writable:true`、页面异常 0 条，
  只有 worker 一句 `Warning: Annotation is missing the required /Subtype.`）⇒ **这一档根本没有失败态可重试**；
  十二枚里只有 **b12**（`/Pages` 树里一枚 kid 指向错类型）真把读侧打到失败：
  `标注读取失败: Page dictionary kid reference points to wrong type of object.`、`writable:false`，而 **pdf.js 数出
  4 页、pdf-lib 只认 3 页**（这一枚分歧就是 b12 的身份，结构判据 D0b 钉的正是它）。所以这一格的收益**只属于瞬时性
  失败**（网络盘抖一下、文件正被别的进程写），确定性坏结构按把手只会再说一次同一句拒绝
- **前置实测④（`pre4.out`，b12 真件 + 真按键，**不靠 DEV 钩子也走得到失败态**）是给 release A/B 定尺子的**：
  F2 那一刻侧栏整排 **9 枚按钮里没有「重试」也没有 reload**（②那一格的另一半），F3 用钩子硬重跑拿到的是**同一句
  拒绝**（`sameSentence:true`），F4 失败态里画一枚 `annos:1 / 标注 1 / dots:true`，F5 Ctrl+S `writes:[]` 而盘上
  `660dd6e20dbcb0` 一字没动，F6 旋转那一路同样拒，F7 关标签再开说的还是那一句，F8 同一把尺量好件 `{pages:12,
  annos:3, writable:true}` ⇒ 本轮 release 的判据面由此定成**句子 + 把手 + 盘不动 + 好件没回归**这四格
- **本轮唯一的架构决定：那一枚把手重跑的是同一趟 `readAnnos`，而不是第二份实现**，四条形状都不是可选的：
  ● **抽成具名函数**（effect 里那整段搬进 `readAnnos(d, announce)`，effect 只剩 `if (doc) readAnnos(doc)` 一行——
  两份实现会分叉：一处说读全了而另一处还在读；S1a/S1b/S1c 钉这个）；● **幂等门直接借 v0.81 那本就绪账**
  （`if (annosReadRef.current === d) return`——按**身份**而不是布尔；②那格 `4 → 7` 就是它买的东西）；
  ● **在途门按身份收放**（`annosRunRef = {doc, cancelled}`；收尾只收自己那一趟 `if (annosRunRef.current === run)`，
  被 cleanup 作废的旧趟不许抹掉正在跑的新趟的账，否则下一次点击又双跑；effect 的 cleanup 按 `r.doc === doc` 置
  `cancelled`）；● **成功那一句只在重试那一路说**（`if (announce)`——自动那一趟成功时界面本来没什么可宣布的；
  而这一句挂在**状态栏**上，所以「闸门开了」这件事**从此在 release 上也看得见**，不必再只靠 DEV-only 那枚
  `annosWritable`；M7 让自动那一路也说 ⇒ 响 S1c/S7c）。失败那句带上页号是因为**页号在 catch 那一刻是知道的**
  （`let page = 0` 跟着循环走；实测 b12 停在第 4 页），而 `page` 仍为 0 时兜底成不带页号那一句（S4d/M4）
- **没有做的两件事各有一条理由，不是遗漏**：**不做排队补做**——拒绝期间用户这一趟的意图仍然无法兑现，本轮只把
  "等待有个尽头"做出来；落定之后自动补做那一刀需要"用户这一刻还想不想做"的判据，而没有（M16 造一条排队补做 ⇒
  响 S10c）。**不做按页部分写回**——那要把就绪账从"整片"降到"逐页"，而 v0.81 那条「宁可拒也不抹」的前提就是整片，
  按页写等于允许拿半片去覆盖全片
- **release A/B 的账（两支真 exe × 坏件/好件两臂 / 42 通过 / 真失败 0 / 显式 SKIP 1）：对照件＝本轮改动前从 HEAD
  当场构建的那支 0.82 exe**（保留原进程名）：● **坏件臂（b12）** 对照件 `标注读取失败: Page dictionary kid…`
  **不带页号**（`ctrl-B3` 判的就是这一格缺口），实验件 `标注读取失败（读到第 4 页）: …`（`exp-B3/B4`：页号正是它
  死在那一页）；两支都 `pageInfo:"/ 4"`、都拒绝写回且 `writes:[]`、盘上哈希 `660dd6e20dbcb0` 一字没动
  （`ctrl-B10/B11`、`exp-B9`）⇒ **闸门那一半没有回归**；**把手是本轮买的东西**：对照件侧栏只有四枚页签
  （`ctrl-B5 no-retry-handle`），实验件多一枚「↻ 重试导入标注」，能点、且悬停那句写清了"存盘与页面操作都会被拒
  （现在写是在覆盖文件）"（`exp-B5/B6`）；● **那一枚显式 SKIP 是 `exp-B7 handle-re-ran-the-same-pass`**——判
  "按下去真的又跑了一趟"要吃 `getPage` 的调用计数，而 release 上没有钩子；本轮把"能不能改吃 console"量过之后
  放弃：**`ctrl-B4c` 与 `exp-B4c` 两臂 `kidTotal:0`**（pdf.js 那句失败是**返回值**而不是 console error，所以
  "日志涨了几枚"这条代理根本不存在）⇒ 这一格写成 SKIP 而不是拿"把手在屏上"当证据（dev 臂 D1/D6 判的就是它）；
  ● **好件臂（12 页 3 枚）两支逐格相同**：页签「标注 3」与列表 3 行相同、账已读全时**没有把手**（G3）、没有失败句
  （G4）、写请求 1 枚 `[{"name":"write_file","s":2913,"d":8}]`、盘上 `{annos:3, pages:12}` 前后相同、「已保存」在
  20ms 时间线上有 301 拍而首拍 ●=0、哈希 `31f01ad48f85f3 → 696fcba73bf57a` ⇒ **闸门与把手都没碰得着正常那一趟**；
  ● 四格**分离形**判据全成立：**SEP1 页号 / SEP2 把手 / SEP3 坏件盘未动 / SEP4 正常件回归（ctrl 3/3 vs exp 3/3）**
- **验证（五腿 + 编译）**：release A/B **42 / 0 / 1 SKIP**；前端结构 **51 / 0**（自带 B0 自检 7/7，吃**剥掉注释并
  归一成 LF 之后**的源文）；变异检查 **19 枚（17 + 2 枚正控制）/ BAD 0 / 多打中 0 / 基线 struct=51/51**；CDP dev
  真机 **34 / 0 / 0 SKIP（b12 臂 14 + transient 臂 20），两臂页面异常各 0 条**；`cargo test --lib` **97 通过 / 0 失败 /
  11 ignored**（与 v0.63~v0.82 同一份基线——Rust 本轮一个字没动）+ `tsc` exit 0 + `pnpm tauri build --no-bundle` 绿
  （openoffices v0.83.0）；五腿都在**版本号 bump（三处对齐）之后**跑
- **结构那张表（51 条）钉住的是形状而不是读数**：S1a~S1d 抽成具名函数 / effect 里只剩一次调用 / cleanup 按身份作废；
  S2a/S2b 幂等门排在登记之前；S3a~S3e 在途 ref 全仓**只有一枚**、带 `cancelled`、只有身份相等才收，而**收它是全仓
  唯一的注销动作**；S4a~S4d 页号跟着循环、catch 里那句带页号、页号为 0 有兜底；S5a/S5b 失败那一路**仍然不给这本账
  记账**（v0.81 那条纪律原样保住）而拒绝句仍走 `failStatus`；S6a~S6c 收尾仍是「并」不是「替」、记账排在合并之后、
  两句都在作废门里；S7a~S7d `announce` 那道门 + 两句字面都在 + 自动那一路静默 + **成功那句是一句兑现得了的许诺**；
  S8a~S8e 把手只挂在 `annosPending` 上、全仓一枚、用共用的 `btn()`、只在「标注」页签里、点它调的是同一个
  `readAnnos(doc, true)`；S9a~S9c `annosPending` 只定义一次且**读状态而不是读 ref**（渲染期要跟着变；闸门那一边才读
  ref）、第二本同名的账不许出现；S10a~S10c 两个调用点、**没有重试定时器**、**没有排队补做**；S11a~S11e 闸门仍只有
  一句、排在取列表之前、比的是身份、全仓零枚销账（`S11d` 读到 0）；S12a~S12c `docProxy` 全仓一处且在 DEV 块内；
  S13a~S13d 文档／表格／演示／`lib/pdf-pages` 四头没有这本账
- **变异那张表（19 枚）**：M1 拆幂等门（响 2）、M2 拆在途门、M3 收账不看身份、M4 失败句去掉页号（响 2）、
  M5 让失败也记账（响 2）、M6 收尾退回整片替换（响 2）、M7 自动那一路也说成功句（响 2）、M8 把手常驻（响 2）、
  M9 把手自带 markup 不用共用 `btn()`、M10 `annosPending` 改读 ref、M11 闸门退化成"有没有 doc"、M12 加一处销账、
  M13 做成自动重试定时器（响 4）、M14 把这套照抄进文档头、M15 让 `docProxy` 泄漏到 release（响 2）、M16 加一条
  排队补做、M18 闸门排在登记之后；**P0（什么都不改）与 P1（只在注释里写一句假站点）必须全绿**
- **CDP dev 真机那张表（34 条）里，两臂各买一格**：● **b12 臂（真件、确定性坏结构）买"release 那四格在 dev 上也对，
  而且按下去不会说谎"**：D0 挂载唯一（`.editor-pane` 里带 toolbar 的头数 = 1，否则侧栏读数会指错对象）、D0b 夹具
  身份 `{diskPages:3, hookPages:4}`（两把尺**必须**分歧）、D1 句子带页号、D2 门仍关着
  （`writable:false / hasDoc:true / numPages:4 / docTag:<untagged>`——**有活 doc 而账不认它**，这就是"按身份记账"
  的量）、D4 页签真的切到「标注」、D5 把手在且能点、**D6 按下去真的又跑了一趟（`calls 0→4`，恰为一趟 `getPage`——
  这一格 dev 独有）**、D7 同一拍连按两下只跑一趟（`grew:4 ≤ numPages:4`）、D8~D12 按完之后仍然诚实（拒绝句不变、
  门没开、`writes:[]`、盘上哈希没动、484 拍时间线里没有成功句、页面异常 0 条）；● **transient 臂（好件 + 腿自己注入
  一次性的失败）买的是 release 无从判的那一整格**：T1 第一趟把账记上（页签「标注 3」）、T3 已记账时**没有把手**、
  T4 没有失败句、T5 腿侧注入排在 reload 之前装好、**T6 注入的失败真的落在标注那趟**
  （`标注读取失败（读到第 3 页）: … hits:3 thrown:1`）、T7 门在一份 12 页活 doc 上关着且**按身份**（`writable:false
  hasDoc:true numPages:12 docTag:<untagged> tagged:doc0`）、T8b 页签又真的切回「标注」、T9 把手出现在失败态、
  **D1 点它开得了门（`writable:true`，`click:"clicked-x2"`，`calls:[24,36]`＝两枚按键一趟）**、D2 那句成功话上屏
  （`标注已读全：3 枚，现在可以存回文件了`）、D3 门开那一刻内存里就是整片（`annos:3` 与盘上枚数相同）、D4 连按两下
  只多 12 次 `getPage`（正好一趟而不是两趟）、D5 成功之后把手自己不见了、E1~E4 门开了之后 Ctrl+S 真出门
  （`[{"name":"write_file","s":8690,"d":10}]`）、盘上枚数与内存一致、"已保存"在 161 拍时间线上出现过、
  哈希 `31f01ad48f85f3 → 696fcba73bf57a`。**dev 的数字一律不吃成产品指标**（v0.66 那条老规矩第八次兑现）：这一臂吃的是
  "开得了门 / 只跑一趟 / 成功那句真上过屏 / 之后写得出去"这四条形状
- **本轮撞到六处量具坑，都不是产品**：① **注入点选错通道就会拿到空失败态**——第一版把抛错装在 `doc.getPage` 的原型上，
  而 `getPage` 在这一份组件里被三处共用（页尺寸那趟 / 渲染 / 标注扫描），实测那句是「页尺寸读取失败: …」而标注扫描
  照样读全 ⇒ 于是三格 PASS 是**空断言**（`tr-D1` 在没有重试的情况下读到 `writable:true`、`tr-D4 grew:0`、
  `click:"no-button"`）；换成把抛错装在 `page.getAnnotations`（grep 全仓**只有一个调用点**，就在 `readAnnos` 里）才量到
  真东西，并把"判据先认得这一臂没跑出这个状态"写成 `ranPass` 在场门；② **夹具的两把尺本来就该分歧**——b12 上
  pdf.js 数 4 页而 pdf-lib 认 3 页（这一枚 kid 悬空正是它坏的地方），按"必须相等"判就假 FAIL，判据应改成**断言这个
  分歧**；同族第二处是在途门那一格的上界必须按 pdf.js 的 `numPages`（一趟正常扫描 4 次 `getPage` 会被 pdf-lib 的 3
  判成"跑了两趟"）；③ **`need(name, present, check, detail)` 的第三槽塞了对象** ⇒ `check()` 抛错而明细序列化成
  `null`（`FAIL tr-T5 :: null` 那种自相矛盾行）；④ **reload 会把侧栏页签退回「缩略图」** ⇒ 在错的页签上找把手是空
  断言，判"把手存在"之前得先证页签真的切过去了（本轮为此新立 `tr-T8b`）；⑤ **dev 会话里"这一趟有没有重跑"只能靠
  `getPage` 计数，而计数要先装探针再按下**（`patch()` 排在 `clickSideN` 之前，`calls:[0,4]` 才是同一趟的读数）；
  ⑥ **9222 被这台机器的入站过滤挡死**（本机事实：按应用放行——node 可以而 Chromium/python 不行）⇒ 经用户同意临时加了
  一条**只限 127.0.0.1** 的入站放行规则 `tmp-x83-cdp-loopback`，**收尾已按提权删除**（`BEFORE=1 AFTER=0`）
- **本轮没动的，量出来记着**（已开进路线图）：**确定性坏结构的失败重跑开不了门**（③那十二枚里十一枚根本到不了
  失败态，b12 那一档按把手只有"再说一次同一句拒绝" ⇒ 这一路的收益只属于瞬时性失败）；**拒绝期间用户这一趟的意图
  仍然无法兑现**（本轮明写不做：落定之后要不要自动补做没有判据）；**按页部分写回不做**（那会拆掉「宁可拒也不抹」
  的整片前提）；**release 上没有"重跑真的又跑了一趟"的可观测面**（console 面 `kidTotal:0` 已经量过 ⇒ 这一格从此
  只能由 dev / 结构 / 变异判，卖点落在 dev 独有观测面时要明写这一条）；**只跑了 4 页与 12 页两枚件**（2300 页那一档
  的失败重跑没有量过，而"重跑一趟的代价"恰好在那一档最大——**v0.84 已量，见下节**）；**`docProxy` 是量具唯一的注入口**（S12 钉住它不许泄漏到
  release，代价是产品多一枚 DEV-only 出口）；**ctrl 与 exp 的侧栏落定时长差（~1.5s vs ~6.7s）仍未归因**（v0.81 那笔
  账原样挂着）；另存为／导出 pptx 之后"再编辑 ● 该不该亮"、多枚 `.opd` 同时脏时每枚各自的时钟与认领关系、「已自动
  保存 X」有悬停而手动那句仍没有次数账、DocEditor 剩四枚裸 `setTimeout`、`SheetEditor.exportPdfTo` 内联那份拼句
  公式、在途锁按 `tabId` 不按 `path`、`SAVE_BUSY_MS` / `AUTO_BASE_MS` / `AUTO_MAX_MS` 是单机数、写侧前缀三家不统一、
  toast 体系照旧未建；自动更新的源托管与 macOS 打包按指令继续等信号，**签名私钥无备份仍是最大单点风险**

## 重跑那几秒不再挂着上一趟的「读取失败」装没事：在途先说一句进行中的话（v0.84）

起点是 v0.83 收尾记下的未勾项「只跑了 4 页与 12 页两枚件：2300 页那一档的失败重跑没有量过，而"重跑一趟的代价"
恰好在那一档最大」。本轮把那一档量清，然后只补一个缺口，窄口径到**三行**（`src/components/PdfViewer.tsx`，+3）；
**Rust 侧一个字没动**，v0.83 那枚把手与它的三道门（幂等 / 在途 / 就绪）一个字没动。

- **前置实测（dev + 注入件，只量不改产品；夹具 `fx2300` = 2300 页 + 40 枚标注，另备 12 页 / 3 枚对照小件做注入
  引导）先把"重跑一趟的形状与代价"量成五格**：● **基线整趟 6659ms / 恰好 2300 枚 `getAnnotations` / 40 枚注解**，
  而扫描期间状态栏只有「正在加载…」→ 空 ⇒ **导入这一路全程不发进度**；● 注入瞬时失败（`getAnnotations` 原型上
  一次性抛错、按 `pageNumber` 触发）：第 3 页档 **262ms / 3 枚调用**、~第 2200 页档 **6245ms / 2200 枚调用**，
  失败句都是 v0.83 那句「标注读取失败（读到第 N 页）: …」；● **重跑永远整趟从头**：两个失败位置按把手都是
  2300 枚调用、从不续扫——有意：就绪账必须整片，按页续写等于拆掉「宁可拒也不抹」的前提；● **在途窗口连按两下
  不会双跑**（calls 停在 2300 ⇒ 在途门成立），但**把手在重跑期间仍是可按的**（disabled 不变、文本不变 ⇒ 按了只是
  静默 no-op，成功后把手自己消失）；● **重跑期间状态栏一直挂着上一趟的失败句**直到成功句把它替换 ⇒ 这就是本轮
  修的缺口——重跑那几秒屏上装没事。另量到：重跑墙钟 **2543ms（失败靠前、冷）vs 81ms（失败靠后、暖）**——差的
  是 pdf.js 的页/注解缓存暖度而不是算法（两个位置都整趟 2300 枚）；盘上哈希全程未动
- **本轮唯一的架构决定：重试那一路（`announce=true`）开跑前先说一句「正在重新导入标注…」**，成功句/失败句到点
  替换它；首趟（`announce=false`）不说话——加载期有「正在加载…」顶着，自动那一路成功时界面本来没什么可宣布
  （v0.83 那条）。没做的三件事各有理由：**把手在途不禁用**（要新立一枚 useState，而在途门已经把双跑挡死，禁用
  买不到正确性只买到外观；**v0.85 改口：禁用还是补上了——"在途"翻成状态之后，外观买到的正是诚实，见下一节**）、**进度百分比不做**（导入没有用户可校准的档位，本轮不扩）、**续扫不做**（同上）
- **release A/B 本轮明写跳过，会计在这里**：到得了"重跑在途"那个状态的唯一注入缝是 DEV-only 的 `docProxy`，
  而这一格要的恰是"注入一次瞬时失败" ⇒ release 上没有到达面（那句进行中的话**形状上**挂在状态栏、release 可见，
  但"按把手之后它真的出现过"无法在 release 造出来）；v0.83 那条「release 上没有"重跑真的又跑了一趟"的可观测面」
  未勾项原样挂着，卖点落在 dev 独有观测面时明写这一条（v0.79 那条纪律的又一次兑现）
- **验证（腿 + 编译）**：前端结构 + 变异合并一腿 **mutants=9（P0 不改 + P1 注释陷阱两枚正控制 + M1~M7）/ BAD 0 /
  多打中 0 / B0 自检 ok**（吃剥掉注释并归一 LF 之后的源文；S1 那句字面只出现一次、S4 那一行挂着 `if (announce)`
  卫兵、S2 位置排在 `annosRunRef.current = run` 登记之后与失败句之前、S5 把手仍调 `readAnnos(doc, true)`、S6 在途
  门与登记原样且登记只此一枚、S7 失败/成功两句字面都在、S8 `readAnnos` 体内不带 announce 卫兵的 `setStatus`
  零枚；M1 拆卫兵、M2 整句搬去闸门之前、M3 换句子、M4 删掉、M5 拆在途门、M6 把手那路不传 announce、M7 重复一句
  ——各响预期判据）；CDP dev 真机 **12 / 0、页面异常账 0 条**（D1 失败 calls=3、D2 失败句带页号、D3 重跑后门开、
  D4 连按两下 calls=2300 恰一趟、D5「正在重新导入标注…」在 20ms 采样里 ≥1 拍、D6 排在按下之后、D7 成功句
  「标注已读全：40 枚」、D8 在途句先于成功句、**D9 重跑窗口里没有上一趟的失败句**、D10 把手没禁用、D11 内存
  40 枚、D12 盘上哈希未动）；`cargo test --lib` **97 / 0 / 11**（基线原样）+ tsc exit 0 + `pnpm tauri build
  --no-bundle` 绿（openoffices v0.84.0）；全部在**版本号 bump（三处对齐）之后**跑
- **本轮撞到八处量具坑，都不是产品**：① 首页就绪判据不许要求 `.home`（上一腿开过标签 ⇒ view 已切到 workspace，
  首页 DOM 不在了）；② `.side-tab` 只在侧栏开着才渲染 ⇒ 判"把手存在"之前先点 ☰；③ `__oofOpenPath` 按路径去重 ⇒
  上一腿残留的 fxB/fxC 标签不关，"重跑没反应"是打开动作被去重了而不是产品坏了；④ 失败段采样器停了之后重跑窗口
  必须重装采样器（空窗 = 空断言，PASS 后面挂空集合那一族）；⑤ 变异的注释陷阱必须种进剥注释**之前**的原文（种进
  剥后源文它就活着 ⇒ P1 假 FAIL）；⑥ 失败句是反引号模板字面 ⇒ 锚点不许带引号前缀（S7 首跑假 FAIL）；⑦ 变异的
  期望失败清单要列全合法 catch（M1/M2 顺手也会响 S8，漏列就是"多打中"假报）；⑧ 9222 入站被这台机器的过滤挡死
  （v0.83 同族）⇒ 临时放行规则 `tmp-x84-cdp-loopback` 只限 127.0.0.1，**收尾已按提权删除（BEFORE=1 AFTER=0）**
- **本轮没动的，量出来记着**（已开进路线图）：**把手在重跑在途期间仍可按 = 静默 no-op**（只补了句子没补禁用；**v0.85 已补，见下一节**）；
  **release 无"重跑又跑一趟"的到达面**（v0.83 那条原样挂着）；**重跑墙钟差只由 dev 量过**（dev 的数字一律不吃成
  产品指标，v0.66 那条老规矩第九次兑现）；**导入全程仍不发进度**（重跑那句是这一路唯一的话）；**重跑是整趟而不是
  续扫**（有意）；另存为／导出 pptx 之后"再编辑 ● 该不该亮"、多枚 `.opd` 同时脏、两支侧栏落定时长差未归因等
  v0.83 那批原样挂着；自动更新的源托管与 macOS 打包按指令继续等信号，**签名私钥无备份仍是最大单点风险**

## 重试把手在重跑期间真的按下不去了：「在途」翻成状态，禁用吃它（v0.85）

起点是 v0.84 收尾记下的未勾项「把手在重跑在途期间仍可按 = 静默 no-op」。形状 v0.84 已量成（在途窗口连按两下
不会双跑、但把手 disabled 不变文本不变，按了只是静默 no-op），本轮不再前置实测，直接补缺口：窄口径到
`src/components/PdfViewer.tsx` 一个文件（+9 / −2），**Rust 侧一个字没动**，v0.81 那本就绪账、v0.83 的三道门
（幂等 / 在途 / 就绪）与 v0.84 那句进行中的话一个字没动。

- **本轮唯一的架构决定：「在途」从 ref 独享翻成一枚状态 `annosScanning`（useState），四条形状都不是可选的**——
  ① **置真不问 announce**：`setAnnosScanning(true)` 在登记那一拍无条件置真（首趟时把手还没渲染、置了无妨，
  v0.84 那句「正在重新导入标注…」仍只在 `announce` 那一路说）；② **清与 ref 收回同吃一枚身份卫兵**：`finally`
  里 `if (annosRunRef.current === run) { annosRunRef.current = null; setAnnosScanning(false) }`——被换掉的旧趟
  （StrictMode 双挂载 / reload 换 doc 之下与活趟并存的时刻真实存在）不得把活趟的「在途」抹回 false，这正是
  v0.81「闸门只认身份」那条规矩在收尾那一头的重申（v0.81 教过的同族形状：**持有在状态里而不是只放 ref**，
  只放 ref 渲染期跟不上，把手永远禁用不了）；③ **把手第三参吃 `annosScanning`**：禁用走共用的 `btn()` 自己的
  外观，**在途门一个字没动**——"按不了"是门的后果不是新闸；悬停那句同步改口成「正在读时按它不会另起一趟」；
  ④ 全仓 `setAnnosScanning` 恰好三处（声明 / 置真 / 清），没有第二本同名账。没做的：不加进度、不做续扫（同 v0.84）
- **验证（腿 + 编译）**：前端结构 + 变异合并一腿 **mutants=7（P0 不改 + P1 注释陷阱两枚正控制 + M1~M7）/ BAD 0 /
  多打中 0 / B0 自检 7/7**（吃剥掉注释并归一 LF 之后的源文）；S1 声明恰好一枚、S2a~S2d 置真一处且不被
  `if (announce)` 卫兵包着、位置在 `annosRunRef.current = run` 登记之后与 v0.84 那句之前、S3 finally 与 ref
  收回同吃一枚身份卫兵且 `setAnnosScanning(false)` 全仓一处、S4 把手切片里第三参是 `annosScanning` 而不是
  `false`、S5 v0.84 回归面原样（在途句 / 在途门 / 幂等门三枚字面）、S6 三处计数与把手引用各一枚；M1 把手退回
  `false`、M2 拆置真、M3 finally 去卫兵、M4 置真加卫兵、M5 拆清、M6 拆声明、M7 v0.84 句子删除——各响预期判据；
  CDP dev 真机 **14 / 0、页面异常 0 条**（S-guard 采样非空 226 拍；D1 在途窗口 146 拍禁用；D2 按下后 20ms 内
  首拍即禁用；D3 在途→成功两个时刻分开；D4 在途窗口没有上一趟的失败句；D5 连按三下只跑一趟——调用计数
  63 = 首趟 3 + 重跑整趟 60；D6 成功后把手消失；D7 成功句「标注已读全：40 枚」；D8 失败态把手 enabled；
  D9 第二趟在途同样禁用 144 拍；D10 二趟成功；D11 累计 126 = 两趟；D12 盘上哈希全程未动；D13 页面异常 0）；
  `cargo test --lib` **97 / 0 / 11**（与 v0.63~v0.84 同一份基线——Rust 本轮一个字没动）+ tsc exit 0 +
  `pnpm tauri build --no-bundle` 绿（openoffices v0.85.0）；全部在**版本号 bump（三处对齐）之后**跑
- **本轮撞到三处量具坑，都不是产品**（第一条追了一整圈）：① **PdfViewer 的状态栏是单层结构**——
  `.editor-status` 这枚 span 自己就装着文本（`statusText(status)` 是它的直接子文本），而 dev 腿第一版照搬
  v0.79 那条「join 全部 span」的教训去读 `.editor-status span` ⇒ 零匹配、失败句"从不上屏"、把手"从不出现"，
  先后怀疑过 slot 归属 / StrictMode 双挂载 / `isTeardown` / `failStatus` 抛错，最后用 MutationObserver +
  10ms 采样的时间线证明句子根本没被采样到——**产品没哑，尺子瞎**（教训的第五次兑现，方向相反：这次是
  "多找了一层"）；② **夹具的 Highlight 必须带 `/QuadPoints`**：pdf.js 基类 `viewable` getter 在
  `data.quadPoints === null` 时返回 false，而 `HighlightAnnotation` 构造时 `quadPoints = getQuadPoints(dict, null)`
  ⇒ 不带 /QuadPoints 的高亮在 DISPLAY 意图下**整枚静默滤掉**（"40 枚只导入 10 枚"是 pdf.js 的滤除而不是夹具
  写错，console 里一声不吭；Text 不设该字段不受影响）；③ `__oofOpenPath` 按路径去重 ⇒ 中途重生成夹具之后
  必须整棵重启 dev 树（旧标签里还是旧字节），不能只重跑腿
- **本轮没动的，量出来记着**：**release 上"在途禁用"这一格仍没有到达面**（到得了重跑在途状态的唯一注入缝
  `docProxy` 是 DEV-only，v0.83 那条未勾项原样挂着——禁用的形状挂在 `disabled` 属性上、release 可见，但
  "重跑在途的那一拍"在 release 上造不出来）；重跑仍是整趟从头而非续扫（有意）；导入全程仍不发进度（v0.84
  那条原样挂着）；重跑墙钟差只在 dev 量过（v0.66 那条老规矩）；另存为／导出 pptx 之后"再编辑 ● 该不该亮"、
  多枚 `.opd` 同时脏时每枚各自的时钟与认领关系等 v0.83 那批原样挂着；自动更新的源托管与 macOS 打包按指令
  继续等信号，**签名私钥无备份仍是最大单点风险**

## ODT 的批注也往返了：读侧收得住，写侧写得出（v0.86）

「继续完善文档功能」自选口径：`.odt` 的批注（office:annotation）此前两头都空着——带批注的 ODT 打开侧栏
静默没账、界面上画的批注存进 `.odt` 一个不剩，两头都不说一句话。窄口径：只动 `src/lib/odt.ts`（+93 / −6）
与 `DocEditor` 那条 `.odt` 开路的一行 `setCmOpen(true)`（+1），**Rust 一个字没动**。

- **前置实测（tmp/x86/pre86，只量不改产品）四格**：① 打开带批注的夹具 ODT ⇒ `meta.comments` 为 null、
  正文零锚点、**零告警**——静默丢是这一档的现状；② 批注正文被摊进了正文段落（读侧只认元素不认外壳那档）；
  ③ 界面画一枚批注存盘 ⇒ `content.xml` 里 `office:annotation` 零枚——批注只住 `.odoc` 与 docx；④
  `.odoc` 开路那句 `setCmOpen(true)` 原样在工作，`.odt` 开路没有这一句 ⇒ 侧栏也不自动开。
- **写侧照抄 docx 那两条老规矩（v0.11 量过的教训原样适用）**：① **同一 cid 全局只一组区间**——
  `usedAnn` Set 守卫开区间（同 id 多组 range 在 Word/LibreOffice 那头就是「文档损坏」那一档）；
  ② **孤儿不写回**——`meta.comments` 里有、正文里没有锚 mark 的批注（原文被删那档）不进 `content.xml`，
  与 docx 导出同一分寸。写出 ODF 1.2 形状：`<office:annotation office:name="oocN">` 内挂 `dc:creator`/
  `dc:date` **子元素**与 `<text:p>` 正文（多行 `<text:line-break/>`），跨段区间用同名
  `<office:annotation-end>` 收口；**块间独立开闭**——mark 不能跨块（docx-fidelity 那条），每个块出口先把
  开着的那枚收掉（inline 段尾收口），读侧靠 endNames 配对还原。
- **读侧三条**：① **endNames 预扫**——先把全文 `annotation-end` 的名字收成账再配对，不靠碰运气；
  ② **有区间的走 openCids 位置栈，点批注（无 end）进 pointCids 锚在自己段落尾**；③ **annWrap**
  在每个块出口把还开着的区间续挂一遍（跨段批注是 LibreOffice 的合法形状）。
- **两条真缺陷是验证腿自己量出来的，不是提前知道的**：① 首跑 CDP 往返腿抛对象 ⇒ 逐格探到读侧把
  `dc:creator`/`dc:date` 当**属性**取（`getAttributeNS`），而 ODF 1.2 里它们是 annotation 的**子元素**
  ——修成按后代元素收（`namespaceURI` 认 purl.org/dc）；② 二趟往返腿炸「Namespace prefix dc on creator
  is not defined」⇒ **写侧自己漏了 `xmlns:dc` 声明**——写出去的字节连自家读侧都不认，第三方更不会认；
  两条都是「往返腿真的走两趟」才买得到的证据。
- **验证（结构 + CDP 真机往返 + 编译，全部在版本号 bump 三处对齐之后跑）**：结构腿 **25/25**
  （B0 自检 3 条绿——注释剥离器本轮升级，见量具坑①；S1 写侧一对开收助手 / S2 usedAnn 与段尾收口 /
  S3 读侧三账 / S4 annWrap 四出口 / S5 meta 与 DocEditor 接线）；CDP dev 真机往返 **36/36、页面异常 0 条**
  （R1 夹具三枚收全带 author/date、R2 正文零污染、R3 锚点 span 落位含点批注与跨段两枚、R4 无批注夹具负控制、
  W1 写出字节逐格——annotation=2 枚（孤儿那枚不写）、annotation-end=2、无作者那枚恰好不带 `dc:creator`、
  开收落在同一段、RT2 二趟往返稳定且无作者那枚保持空、U1 侧栏自动开「批注 3」三卡、U2 正文干净、
  U3 页面异常账 0）；`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（基线原样）+ tsc exit 0 +
  `pnpm tauri build --no-bundle` 绿（openoffices v0.86.0）。
- **量具坑五处，都不是产品**：① 剥注释器的 `${` 帧**只 push 不 pop**——栈越长越深，模板正文里的引号被
  开成假字符串态把注释漏出来（B0a 当场抓到）；修成帧带花括号计数、`}` 在计数归零时弹回 tpl；
  ② S2e 假 FAIL——`<dc:creator>` 与 `</dc:creator>` 同在一行 ⇒ 计数=2 才对，判据按 openAnnEl 切片重标定；
  ③ CDP 把页内异常序列化成 `{}`（v0.75 那条再兑现）⇒ 页内 try/catch 带 `{__throw, __stack}` 出来；
  ④ `window.__oofErr` 在当前 App.tsx 里**不存在**——那是某一轮的临时探针、按惯例删了，页面异常账改由腿自己
  `Runtime.enable` + `Runtime.exceptionThrown` 记；⑤ 腿里 `Runtime.enable` 那段插在 `seq` 声明之前 ⇒
  ReferenceError 长得像产品挂，初始化挪到 send 定义之后。
- **本轮没动的，量出来记着**（已开进路线图）：**LibreOffice/第三方真件未回归**（本机无 ODF 第三方应用，
  v0.62 老规矩——往返证据全部来自自家读写两头互证）；**跨段批注写回收进首段、续挂从第二段开头**
  （锚位语义没有第三方真机可对，有意记账）；**点批注读侧锚在段落尾**，原始锚位丢了；
  **resolved 状态不往返**（ODF 1.2 的 annotation 没有这个通道，ODT 上它恒为未解决）；**目录节点仍不写
  ODT**（范围限制那条的后一半原样挂着）；自动更新的源托管与 macOS 打包按指令继续等信号，
  **签名私钥无备份仍是最大单点风险**

## 性能（v0.3）


- **按编辑器分包 + 懒加载**：主包 8MB → 首屏约 300KB；Univer（6.1MB）只在首次激活表格标签时加载，
  TipTap/docx（836KB）与 pptxgenjs/jszip 同理按编辑器按需加载，mammoth/pptxgenjs/jszip 进一步延迟到导入/导出动作
- **编辑器懒挂载**：标签首次激活才创建 Univer/TipTap 重型实例，之后切换保留状态不重复初始化；
  激活判定落在**渲染期**（幂等 `Set.add`）而不是 effect 里再 `setState`，少一次空转重渲染（v0.36）
- **渲染裁剪**：三个编辑器与幻灯片缩略图 `React.memo` 化；store 的 `markDirty` 幂等去重，
  避免 Univer 每条命令都触发无关标签重渲染
- **挂载不走 Suspense**（v0.36）：外壳与四类编辑器都由 `src/lib/editors.ts` 自持已解析组件，
  绕开 React「兜底至少可见 ~300ms」的节流——表格冷开 1281→584ms、heavy.pdf 冷开 710→225ms
- **空闲预热编辑器 chunk**（v0.26 起，v0.35/v0.36 两次收到实证边界）：`lib/prewarm.ts` 挂在 App
  （首页才是免费的空闲窗口），与挂载点共用同一模块 promise，点击路径上只剩数据请求；
  预热顺序为**外壳** + 按最近文件排部的四个编辑器。
  **实测到此为止**——再往下（真建 Univer 实例、预取/预启 worker、拿空白 PDF 走一遍渲染、把公式 worker
  线程做成常驻池）发布包首开耗时一位数都不降甚至更慢，见上一节的 A/B
- **大 PDF 分段读取**（v0.35）：≥4MB 走 `PDFDataRangeTransport` + Rust `read_range`（raw IPC），
  首屏只读 64KB 头 + 按需区间，17.9MB 文档冷开 901→710ms、热开 260→91ms，且整本字节不再进 JS 堆
- **Univer 首开并行化**（v0.35）：读文件与建实例不再串行等待，20001 行表格冷开 1456→1281ms
  （**这一条在 release 上远没说到点子上了，v0.67 量完改口**：它只把 IPC 提到挂载点之前，而挂载点自己排在
  chunk 取与求值之后，所以 release 上 `read_xlsx` 仍在起进程后 850ms 才出门；把请求提到**外壳开标签那一刻**
  之后，同一件的首帧 1579→1329ms）
- **Rust release profile**：`lto = true`、`codegen-units = 1`、`strip = true`、`panic = "abort"`

## 技术栈与开源组件

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| [Tauri 2](https://tauri.app) | 桌面壳（Rust 后端 + 系统 WebView） | MIT |
| [Univer](https://univer.ai) | 电子表格内核（渲染/公式/撤销重做）+ 筛选/排序/条件格式/数据验证/查找替换/绘图社区预设 | Apache-2.0 |
| [VChart](https://visactor.io/vchart) | 表格图表自绘（PNG 渲染 → 浮动图片），动态导入懒加载 | MIT |
| [TipTap 3](https://tiptap.dev) | 富文本编辑器内核（ProseMirror），含 color / highlight / character-count / text-style（字族·字号）扩展 | MIT |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js) | docx → HTML **兜底**导入（保真导入器抛错或拆不出块时启用，v0.37 起退居二线） | BSD-2 |
| [docx](https://github.com/dolanmiu/docx) | ProseMirror JSON → docx 导出（编号列表走 `numbering.config` 真编号、表头行走行级 `tableHeader`；字节经 `Packer.toBase64String` 取，`toBuffer` 在浏览器不可用） | MIT |
| [pptxgenjs](https://gitbrent.github.io/PptxGenJS/) | 幻灯片 → pptx 导出 | MIT |
| [JSZip](https://github.com/Stuk/jszip) | pptx/odt（zip）解包与 ODT 打包 | MIT |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | PDF 标注写回（低层 Annotation 字典构造）与页面操作（旋转/删除/提取/合并/拆分），保存时动态导入 | MIT |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | PDF 查看渲染（worker + cmaps/标准字体） | Apache-2.0 |
| [webview2-com](https://docs.rs/webview2-com) + [windows](https://github.com/microsoft/windows-rs) | PrintToPdf 原生调用（wry 依赖树内，零体积增量） | MIT / Apache-2.0 |
| [calamine](https://github.com/tafia/calamine) | Rust xlsx/xls/ods 读取（CSV 不支持，故 `csv.rs` 自解） | MIT |
| [encoding_rs](https://docs.rs/encoding_rs) | CSV 读侧 GBK 回退解码（中文 Excel 另存的 CSV 非 UTF-8） | MIT / Apache-2.0 |
| [rust_xlsxwriter](https://github.com/jmcnamara/rust_xlsxwriter) | Rust xlsx 写出（含 Format 样式/合并） | BSD-2 / Artistic-2.0 |
| [zip](https://github.com/zip-rs/zip) | Rust xlsx 解包（读取样式/合并 XML）+ ODS 打包写出 | MIT |
| [quick-xml](https://github.com/tafia/quick-xml) | Rust OOXML 流式解析 | MIT |
| [zustand](https://github.com/pmndrs/zustand) | 前端状态管理 | MIT |
| [tauri-plugin-single-instance](https://github.com/tauri-apps/plugins-workspace) | 单实例启动 + 二次启动 argv 转发（文件关联体验） | MIT / Apache-2.0 |
| [tauri-plugin-updater](https://github.com/tauri-apps/plugins-workspace) | 自动更新**检测层**（`check` 一次拿版本/说明/日期；自带 rustls 栈与 minisign 验签，release exe +1.82 MiB 实测） | MIT / Apache-2.0 |
| React 19 + Vite | UI 框架与构建 | MIT |

## 架构

```
src-tauri/            Rust 后端
  src/xlsx.rs         read_xlsx (calamine) / write_xlsx (rust_xlsxwriter) 命令，含样式、合并区、尺寸/字族、隐藏/冻结、公式（含缓存值）、图表与**三类规则（筛选/数据验证/条件格式，v0.46 的载荷类型 RangeRect/SheetFilterPayload/DataValidationPayload/CondFormatPayload 也在这里）**、**批注与超链接（v0.48 的载荷类型 CellNotePayload/CellLinkPayload）**、**打印设置（v0.51 的载荷类型 SheetPrintPayload/PrintMarginsPayload/PrintHfPayload，枚举收 OOXML 字面、边距收英寸、区域收 0 基含端点）**，v0.52 再加 `DEFAULT_PRINT_MARGINS` 与 `is_all_default()`/`clear_default_only_margins()`——rust_xlsxwriter 给每张表都写一份默认 `<pageMargins>`，而"没人设过边距"与"边距正好等于默认"在字节上是同一件事，所以只装着默认六数的载荷视作没声明（与 v0.48 那条「默认气泡尺寸归一回不声明」是同一条规矩），读写两头都算在这一套往返里，**v0.55 再添两枚 `Option<bool>`：`scale_with_doc` / `align_with_margins`**（`skip_serializing_if = Option::is_none`，因为这两枚的"没值"说的就是"开着"）；write_xlsx 返回 `Vec<String>` 边界账；命令为 async + spawn_blocking（同步跑主线程会让窗口冻结），`.csv` 读侧分流到 csv.rs，图表网格按 has_charts 惰性构建，`.xlsx` 才另开一趟 zip 读独立部件的批注、链接与打印设置；测试里带一份**条件格式打印夹具**（v0.47：八列各一种判定型，写出真 xlsx 供 Excel 逐格对色）与一份**打印设置夹具**（v0.51：横向 A4 + 85% + 六条边距 + 三槽页眉页脚 + 打印区域/标题行列 + 两个手动断点，`#[ignore]` 生成器与冒烟腿共用同一份产物）；**v0.57 添载荷类型 `DefaultFont { ff, fs }`（`WorkbookPayload` 改 `camelCase` 并多一枚 `defaultFont`）与写侧那一步**：在任何 `add_worksheet` 之前 `wb.set_default_format(&fmt, 20, 64)`——后两个数是 crate 自己的列宽行高度量，这么传才只动字体那一层（`sheetFormatPr defaultRowHeight="15"` 不变），走通了默认格式就是 xf 0 / `fonts[0]`，失败 `notes.push` 不再静默；`fs` 只收正数（0 与负数在这一层就是"没说话"）；测试四例（声明的落进 `fonts[0]` 且不带 `scheme`、没声明的保持 crate 形状、存两次字族与字号都在、`cellXfs` 按索引判别）；**v0.58 把"没样式的格"还给文件那一层**：`format_for(s, default)` 多收工作簿默认字体，且载荷得**真说了样式**（`has_any()`）才建得出那枚 Format——没样式的格走 `write_string`/`write_number`/`write_boolean`/`write_formula` 那几条不带 format 的写法（实测 `<c>` 上没有 `s=`，字号由 Normal 继承），合并区那条照旧要 Format 故仍走 `format_for`；新增 `seed_font(default)`（只把真正需要种的那两味交出去：名字为空或就叫 Calibri、字号正好 11 都算"文件说的就是 crate 那一档"⇒ 一个字不种，种了会把 `<scheme val="minor"/>` 弄丢，`set_default_format` 那一步共用同一条守卫）——只勾了加粗的格因此落 `<b/><sz val="14"/><name val="宋体"/>` 而不是 Calibri/11；测试五例（不盖 xf 且**存两次盘不许把 xf 盖回来**、加粗格从文件取底数、没默认字体时照旧 crate 那一档、同一档不重复声明且省掉那笔后读侧仍认得出 Calibri/11、空样式两来源分不开）+ 成对夹具 `gen_inherit_fixture`（`b-inherit` 正文不带样式 / `b-stamped` 明写 Calibri/11，共用宋体/14 与同一句页眉；一趟写成不走"读回再写"，否则 stamped 被自家读侧归一化成实验件）；**v0.59 只多一份量正文底数用的成对夹具** `gen_bodybase_fixture`（`bb-11`＝Calibri/11、`bb-14`＝宋体/14：同一张 40 行 × 5 列的表、同一句带 tag 的页眉，只有工作簿默认字体那一层不同，于是"同一张表在两种底数下纸上怎么排"是可比的两件——40 行是给分页留的余地（底数一档一页少几行就可能多出一页），第 3 列那条长串是给换行留的余地（**列宽按 MDW=7 换算、不跟字体走**，底数一大同一格就要多折一行，这正是耦合点），第 4 行另给了显式行高，而 `BOLD` 那一格只说加粗不说字号——它的底数正该由文件那一层给；读写逻辑本轮零改动，只读腿与冒烟吃同一份字节）；**v0.60 添载荷类型 `SheetFormat { default_row_height, custom_height }`**（挂在 `Sheet` 的 `sheet_format: Option<SheetFormat>` 上，`custom_height` 为 false 时不序列化——只有明确写了 `customHeight="1"` 的那一枚才算说话，与 v0.55 那两枚开关同一分寸），它的类型注释记着实测：五份件（15 / 30 / 30+customHeight / 17.5 / 整枚抹掉）在 Excel 16.0 里报的都是它自己按字体算的那 17.5，所以**这一层是保真往返而不是排版指令**；`write_xlsx` 把它随 `PrintPatch` 交出去（不吃 crate 的 `set_default_row_height`，见 `crate_default_row_height_setter_stamps_every_row` 那条判别）；顺手改口一条旧注释——`set_row_height_pixels` 只收整数像素，载荷里非整的那一档在 `as u32` 上被截掉（最多 1px＝0.75pt 的字节漂移，挂进路线图），"px↔pt 无损"那句从 v0.60 起不再说；**v0.61 只改这一行的分流**：读样式那趟由 `if .ods { crate::ods::read_ods_styles(&path) } else { xlsx_style::read_xlsx_styles(&path) }` 决定，两条路交回同一枚 `(fmts, Option<DefaultFont>)`，于是 `.ods` 的工作簿默认字体进了同一份 `payload.defaultFont`——**前端一行没动就上了纸**（消费点 `baseFontPt`/`--oof-print-base-size` 从 v0.56/v0.59 起就与格式无关），这一处也是本轮唯一的接线改动；**v0.62 把同一形状的分流补到批注与链接那一趟**：`read_xlsx_sync` 里那条链多一个 `.ods` 分支走 `crate::ods::read_ods_cell_side(&path)`，交回的是同一个 `xlsx_cell_side::SideRead` ⇒ 装配侧不必知道格式（xls/csv 仍没有这条路），顺手给 `CellNotePayload`/`CellLinkPayload` 带上 `Debug`（只为本轮测试打得出"落不准的那一枚究竟落在哪一格"，不是新的运行时行为）
  src/csv.rs          CSV 往返：RFC4180 逐字符状态机（引号/转义/字段内换行）+ 分隔符嗅探（, ; 制表符）+ UTF-8 失败退 GBK 解码 + 写侧 BOM/CRLF，read_payload 供 read_xlsx 分流、write_csv 为独立命令
  src/xlsx_style.rs   zip + quick-xml 直读 xlsx 的 styles.xml（StyleBook：fonts/fills/borders/cellXfs/numFmts，**外加 `<dxfs>` 条件格式样式表 `parse_dxfs`**——dxf 不走 fontId/fillId 索引、实心底纹在 bgColor 而非 fgColor，故单独一趟）/ mergeCells / col·row 尺寸（字符宽·pt→px）/ 隐藏行列 / 冻结 pane / 公式 `<f>`（GeneralRef 实体重建 + unescape，calamine 无样式/公式 API）；**v0.57 起 `read_xlsx_styles` 返回 `(StyleBook→fmts, Option<DefaultFont>)`**：新增 `default_font_of(book)` 按 `cellXfs[0].fontId` **索引**查 `fonts`（不是取第一个 `<font>`，夹具里让 xf0 指 `fontId="1"` 就是为判别这一条），`ff` 与 `fs` 两头都没说就交回 `None`，**这一层不归一化字族**（"等线"归一回不声明会让写侧落 Calibri＝换字族，与 v0.48/v0.52 那两条"默认值不算声明"相反：那两条管的是别替用户声明他没设过的，这条不许抹掉文件里明写的）；**ODS 那一路 v0.61 接上了**——`xlsx.rs` 的分流不再硬交回 `None`，而是走 `ods::read_ods_styles`（同一枚 `(fmts, Option<DefaultFont>)` 返回形状，住址换成同一件 `styles.xml` 里的 `<style:default-style style:family="table-cell">`，见 ods.rs 那条）；**v0.58 只加一条注释与一枚钉**：`style_for` 的归一化参照物**没**从常量搬到文件那一层——搬了会把"与工作簿默认同一档"的格子读成空样式，而 Univer 的默认字体硬编码 Arial/11（界面就从宋体 14 掉回 11 号），屏幕、纸面与这一层得一起搬（见路线图）；`empty_payload_style_is_ambiguous` 把这份歧义钉成断言而非缺陷：`s: None` 有两种来源而载荷分不开（文件真不带 `s=`＝该继承， vs 带了 `s=` 而正是 Calibri/11＝该照自己写），写侧从 v0.58 起把后一种也归到"随大流"；**v0.60 在这一趟里多认一个元素**：`SheetFmt.sheet_format` 收 worksheet 部件里的 `<sheetFormatPr @defaultRowHeight @customHeight>`，按**磅字面**读、不折算成像素（这一层不进像素主线），判别夹在旁邻属性之间——同元素上 Excel 爱写的 `x14ac:dyDescent="0.3"` 与 `baseColWidth` 都只当邻居、一个字不碰，而 `customHeight="0"` 与不写归同一档；`DEFAULT_SHEET_ROW_HEIGHT_PT = 15.0` 是归一化的参照物：正好 15 而**没带** `customHeight` 视作"没说话"（OOXML 缺省与 crate 落笔都是 15，与 v0.52 那枚默认 `<pageMargins>` 同一条规矩），而 `15 customHeight="1"` **不许归一化掉**（那一枚是文件明写着"这一档是我设的"）；`0`、负数、NaN 一律在这一处读点就交回 `None`（v0.57 那枚 `fs` 的先例）；ODS 那一路的对应物是 `styles.xml` 里 `family="table-row"` 与 `family="table-column"` 那两支 default-style，**v0.61 只接了 `table-cell`（字体）那一支**，行高/列宽两支仍未接 ⇒ `.ods` 的这一枚恒为 `None`（路线图挂着）
  src/xlsx_rules.rs   三类规则的双向（v0.46）：写侧 `write_sheet_rules`（autoFilter + filterColumn 的 list/custom 两种形状、dataValidation 六类型与日期序列号换算、条件格式四大类 cellIs/containsText/timePeriod/top10/aboveAverage/duplicate/unique/expression + colorScale/dataBar/iconSet，含 dxf 与 x14 的 gradient/negativeBarColorSameAsPositive）、读侧 `read_sheet_rules`（quick-xml 事件流 + `cfRule` 的 begin/end 临时态、`dxfId` 查表、colId 换回绝对列、`showDropDown` 反义、整列引用等读不懂的片段原样交回由调用方记账），摆不进 / 读不出的**一律返回账目不静默少给**
  src/xlsx_cell_side.rs 单元格两位邻居的双向（v0.48）：读侧 `read_cell_side` 另开一趟 zip 按表名对回**独立部件**——legacy `commentsN.xml`（`<authors>` 表 + `authorId` 下标、正文里那行「作者:」前缀只在认得出作者时剥）、threaded `threadedComments/*.xml`（作者查 `persons/person.xml`，两种键名都收，回复并进正文并记账）、两者的归一、气泡尺寸与常开来自 `vmlDrawing`（pt→px，默认那档 128×74 **归一回不声明**）、超链接的 `ref` 在 worksheet 而外部地址在其 rels（`TargetMode="External"`）、表内跳转才是 `location` 字面；写侧 `write_sheet_side`（链接先落文本再补普通格，无 scheme 的目标按 `file:` 补试；`Note` 带作者/尺寸/常开，作者超 52 字只丢作者；`set_default_note_author("")` 让"没人署过"真是空串）+ `save_workbook`（**rust_xlsxwriter 的 `<authors>` 按名字排序而 `authorId` 按格子序登记**，两序不一致时按载荷数出来的那张表重排 `<authors>`，多重集或 `<comment ref>` 文档序对不上就宁可不改并记账）；认不出的形状一律记账；**v0.60 只改一句账目文案**：那条"产物里没有 {}，那张表的页眉页脚、起始页码没写出去"扩成"……起始页码**或缺省行高**没写出去"——`patch_part_xml` 现在也可能因为这一枚失败而少写东西，账目得说得出它管的是什么
  src/xlsx_print.rs   一张纸怎么摆的双向（v0.51）：读侧 `read_print_setups` 另开一趟 zip 收 worksheet 末尾七处（`sheetPr/pageSetUpPr@fitToPage`·`printOptions`·`pageMargins`·`pageSetup`·`headerFooter` 的 odd/even/first 三槽·`rowBreaks`·`colBreaks`）**加 workbook 级两条 definedName**（`_xlnm.Print_Area`/`_xlnm.Print_Titles` 靠 `localSheetId` 分表，`$1:$2`/`$A:$B`/区域三种片段各归各的字段），`<brk id>` **原样收**（0 基，指"这一行/列自己开始新的一页"——两头实测过）；写侧 `write_sheet_print`（odd 与其余各项交 crate）+ `PrintPatch`/`patch_part_xml`（crate 只有 odd 通道、`differentOddEven`/`differentFirst` 一个字不写、又把起始页码落在布尔属性 `useFirstPageNumber` 上，故 even/first 两条串与真号码在字节上补一次：只动点名的那张 worksheet 部件，兄弟元素次序按 schema 排，页眉页脚里 `&` 是格式码故只认三条标准转义）；认不出的纸型编号与片段一律记账不硬凑；**v0.52 只补一条读侧归一**：接进 `print.clear_default_only_margins()` 之后才判 `is_empty()`，于是"文件里只有 crate 那份默认 `<pageMargins>`"的表不再被当成带着纸面设置（面板副标题、账目与 `printRef` 三处都因此说实话），测试另加两例——只含默认六边的那一份不算声明、超出默认的那一条仍算；**v0.53 补的是"没声明过的那一枚不该被替我们声明"**：`write_sheet_print` 只在真走通 setter 时才算声明过方向并回传 `drop_orientation`，`patch_part_xml` 那趟据此把 crate 逢 `<pageSetup>` 必写的 `orientation` **整枚擦掉**（`patch_orientation` 只动这一枚，其余属性与内部正文原样搬，声明过 landscape/portrait 的一张字都不改），读侧同一条分寸用在页高档上——`<pageSetup>` 里 `fitToWidth`/`fitToHeight` 被 crate 在等于 1 时省掉，而 OOXML 缺省正是 1，故开了 `fitToPage` 却没写的那两枚归一回 `Some(1)`（没开 `fitToPage` 的不许归一，那是替用户凭空声明一档缩放）；测试再加三例（没声明的方向不回来、走完整存盘链路后仍不声明且不连累 paperSize/scale、擦方向不许把页高归一也带走）与一份**成对夹具** `gen_orient_fixture`（同一趟存盘里"说了 landscape"与"从没说"两张表，第三方腿据此分辨"被擦了"与"本来就没写"）；**v0.54 只多一份夹具** `gen_parity_fixture`（一张表 140 行、横向 A4、`differentOddEven` 与 `differentFirst` **同时为真**、odd/even/first 三版页眉页脚各写不同内容、`firstPageNumber=7`——那枚 7 是装在同一份件里的对照：纸上印出 7 就说明起点漏进了我们自己的通道，而它始终印的是 1..N；只读腿与 CDP 冒烟吃的是同一份字节）；**v0.55 收的是同一元素上那两枚缺省开着的开关**：读侧新增 `off_attr()`（只把明确写 `0` 的收进载荷，缺省与显式 `1` 都归一回不声明——与 v0.52 那枚默认边距同一条规矩），写侧只在 `Some(false)` 时调 `set_header_footer_scale_with_doc(false)` / `set_header_footer_align_with_page(false)`（crate 也只在关掉时落字节，且走通 setter 会置上 `head_footer_changed`，于是"只有开关、一条页眉页脚都没有"的件也长得出 `<headerFooter>`；`patch_header_footer` 那趟只擦自家那两枚奇偶开关，crate 写的这两枚活着过第二次存盘），`merge_defaults` 按「任何一头说了关就是关」填；测试三例（关着的落进 XML 而开着的不写、存两次两枚都在、`scaleWithDoc="0" alignWithMargins="1"` 读回来是 `Some(false)` 与 `None`）+ 一份**四件套对照夹具** `gen_switch_fixture`（`s-on`/`s-scaleoff`/`s-alignon`/`s-alignoff`：同一份页眉、只动一枚开关，`align` 那两份故意用不对称边距 1in/2in，于是"按边距的中心"与"按纸边的中心"分得开；Excel 腿与冒烟腿吃同一份字节）；**v0.56 只多一份三件对照夹具** `gen_fitwidth_fixture`（同一张 14 列 × 130px 的表——竖版 A4 一页宽根本装不下、必须挤——写出 `fw-plain`（scale 100）/ `fw-fit1`（`fitToPage` + `fitToWidth=1`）/ `fw-fit1-off`（同一件再写 `scaleWithDoc="0"`）三份件，页眉三槽各带表名 tag 好让 pdf.js 认得出哪一行是页眉；它管两个问题：挤一页宽时页眉跟不跟着压、跟着的是**反求出来那一档**还是**声明出来的那一档**；Excel 只读腿与 CDP 冒烟吃同一份字节）；**v0.60 让这一趟定点重打包多认一处**：`PrintPatch` 多一枚 `sheet_format`（`noop()` 必须把它算进去，否则整趟被跳过、擦了个寂寞），`patch_sheet_format` 只重写 `<sheetFormatPr>` 自家那两枚属性（`defaultRowHeight` 与 `customHeight`），同元素上的旁邻属性原样搬，部件里没有这一枚时按 schema 序插在 `<cols`/`<sheetData` 之前；荒谬值（非有限数、`<= 0`）在这里再兜一次而不是落进字节；为什么不走 crate——`set_default_row_height` 会把这枚缺省盖成**每一行的显式 `ht`**，而且内部按整数像素存（17.5pt 存成 17.25），判别见 `xlsx::tests::crate_default_row_height_setter_stamps_every_row`；测试三例（这一枚落进字面而**逐行不许被盖章**、没声明时不许把 crate 那份 15 改写、补丁只动自家两枚属性）
  src/xlsx_chart.rs   zip + quick-xml 直读 chartN.xml + drawing 锚点，系列值按实时网格解析；has_charts 只做 zip 文件名嗅探
  src/ods.rs          ODS 双向：write_ods（async 外壳 + write_ods_sync，共用 xlsx 载荷 → ODF zip，样式/尺寸去重与合并、冻结 settings.xml、公式 of:= 换算）+ read_ods_styles（直解边框/对齐/换行/列宽行高/字族/隐藏 collapse/重复单元格/合并跨度/公式 + settings.xml 冻结）+ **ODF 规则只记账不硬读**（content.xml 里有 `table:database-range`/`table:content-validations`/`table:conditional-format` 就说得出"暂未读入"，自产物不许凭空记出一条账）；**v0.61 在这一趟里多认一处住址**：`ods_default_font_of(styles.xml)` 只从 `<style:default-style style:family="table-cell">` 那条的 `<style:text-properties>` 取字族与字号（`family="text"` 那支、具名 `<style:style style:name="Default">` 那一层、兄弟元素 `<style:table-cell-properties>` 上的字号都不算），`read_ods_styles` 的返回形状随之变成 `(fmts, Option<DefaultFont>)`；`odf_font_pt` 带 `pt` 后缀就按**磅字面直取**，只有真不是 pt 的那一档才走 `odf_len_to_px`（那一趟带取整）；这一层**不归一化**（抹掉文件明写的字族＝换字族，v0.57 那条），0／负数不在读点拦（由唯一消费点兜）；写侧新增 `default_style_xml`——载荷没说话就整层不写（不盖章），说了就落 `<style:default-style style:family="table-cell"><style:text-properties style:font-name=… fo:font-family=… fo:font-size="Npt"/>` 且排在具名 style 之前；ODF 靠样式继承链表达这一层，故 xlsx 那套 `seed_font`/「同一档不重复声明」在这里用不上；**v0.62 添 `read_ods_cell_side`（批注与超链接的双向）**：这两样在 ODF 里**都是格子的孩子**（xlsx 那头是四件独立部件 + rels），所以一趟 `content.xml` 扫描按表名收齐、交回同一枚 `xlsx_cell_side::SideRead`——`flush_table` 把每张表的账目并进 `out`；读侧的判据主体是"落不准就不硬派"：`covered-table-cell` 与 `number-columns-repeated ≠ 1` 的格说不准这两样属于谁 ⇒ 各记一条账而不猜列位，同一格第二条链接「只收第一条」，`href` 缺席／既不像 §9.2.1 的内部地址（`#表名.格`，`#` 与 `.#` 两种写法、`$` 绝对引用都认）又不带 RFC-3986 scheme ⇒「位置认不出来」而不是造一条点不开的死链，`dc:date`/`creator-initials` 由 `in_meta` 挡在正文外，空正文的气泡不收，表名 `unesc` 一次（与 calamine 那一头对得上才接得进 `by_sheet`），批注内层的 `text:a` 只贡献显示文字（不是格子链接）；写侧 `annotation_xml`（排在同格正文 `<text:p>` **之前**，ODF §9.1.4 的子元素定序——`office:display` 只在说 true 时落笔、`svg:width/height` 只在载荷给那味时写且**单位必带**（`px_to_odf_len`），没署过名就不写 `dc:creator`）+ `text_p_xml`（有链接时外套 `<text:a xlink:type="simple">`，`office:title` ＝悬停提示）+ `odf_href`（载荷的 `location`"表名!A1"折成 `#表名.格`，没说表名用本表补）+ `odf_table_ref`（含空格/点/单引号的表名裹 `'…'`、`''` 是引号本身）+ `used_namespaces`（`dc`/`svg`/`xlink` **按需声明**，载荷没用到的命名空间不进根元素）；`note_at`/`link_at`/`side_at` 三个取样点让"只有批注没有值"的格子也长得出（`row_used` 与 `max_row` 都算上这两味）；**v0.63 给这一头补上回写账目通道**——`write_ods`/`write_ods_sync` 的返回从 `Result<(), Error>` 变成 `Result<Vec<String>, Error>`（与 `write_xlsx_sync` 同一条契约，`fs.ts` 的 `writeOds` 随之回 `string[]`），`ods_side_accounts` 说的就是这一趟**摆不下**的那几枚（批注没正文／落在被盖住的格上、链接两头都没目标／落在被盖住的格上、同格多于一枚的"只写了第一条"并报实际条数），顺序是先批注后链接、各按载荷条目序、重复那两枚记在最后；判据**只有一批**（`note_writable`/`link_writable`/`cell_covered` 合成 `note_written`/`link_written`），格子渲染、`used_namespaces`、`ods_side_accounts` 三处共读，于是"报的账"、"字节里少掉的那几枚"与"命名空间声明"是同一批而不是各写各的；`bubble_dim` 是本轮新立的一条——尺寸说 0／负数／NaN 时 `px_to_odf_len` 写不出成立的 `svg:length`，**那一味不写，`xmlns:svg` 也跟着不声明**（为一条根本不落笔的属性盖命名空间就是白盖章）；同一轮由规格腿量清楚了两件事：`covered-table-cell` 里塞批注/正文/链接**文法全放行**（那三条"未写入"的账依据是规格正文的语义＋我们读侧的归因分寸，不是 RelaxNG），而**同一格第二枚 `office:annotation` 是文法逼的**（`table-table-cell-content` 只给一枚 optional）、两条链接只是约定；"链接挂在数字格上会把该格读回成文本"这条代价与桥有关、与格式无关，v0.62 钉成断言、本轮照旧
  src/pdf.rs          export_pdf 命令：with_webview → WebView2 PrintToPdf（四边距英寸四元组 + 纸张宽高/朝向，cfg windows）；**纸张换算是唯一的**：`page_box(w,h)` 把"想要的纸面尺寸"折成 PrintSettings 的"竖版边长 + Orientation"（v0.50，宽>高才转横向，等边不算横向），背景/页眉页脚/四边距/纸宽纸高/方向五步设置失败**一律原样报出**（静默退默认＝"导出成功但纸不对"）；file_len + read_range（raw IPC 返回 Vec<u8>，async + spawn_blocking，供大 PDF 分段读）
  src/lib.rs          OPEN_EXTS 与 argv 文件过滤纯函数、take_startup_files 命令、single-instance 文件转发；插件链只注册 updater 的 check 能力（前端仅授 `updater:allow-check`，下载与安装没接线——**v0.82 改口：这一行代码一个字没动，`.plugin(tauri_plugin_updater::Builder::new().build())` 注册的是插件本体，接线接的是 capabilities 那头的三枚权限，Rust 侧本轮零改动**）
  capabilities/       dialog + fs 权限与路径作用域 + updater 的**三枚**权限（`allow-check` / `allow-download` / `allow-install`，v0.82 起；**故意不给宽口径 `updater:default`**——它会把"删掉某一枚以测试"这种变异变成静默通过，而这三枚的差别正是这一路的权限边界）
src/                  React 前端
  store.ts            标签页 / 最近文件 / 主题（zustand）；`openTab` 里有**两行**按 `tab.path && tab.kind === …` gating 的预取（`prefetchWorkbook` 管表格、`prefetchPdf` 管 PDF；v0.67 起是表格那一头，v0.68 把 PDF 那一头接上同一层：读件请求在开标签那一刻就出门，而不是等编辑器挂载），`closeTab` 里有两行对称的撤账（`dropWorkbook`/`dropPdf`，关掉的是那枚还没人取的标签就撤掉在途的账，**撤账跟着标签的格式走**）；两处都只调用 `lib/open-prefetch.ts` 而不内联那份字典，也不在这一层碰读侧实现（判据 S1–S5）
  App.tsx             全局快捷键、拖拽打开、文件关联打开（启动 argv + 单实例转发）、关闭确认、懒加载路由；dev 钩子另加 `__oofFail(cmd, args)`（v0.64：原样发起一次命令调用并把失败时用户会看到的那串话交回，冒烟据此问"写侧真失败怎么说"而不必经过我们自己的读侧）
  index.css           外壳样式、两套主题，以及**纸面与屏幕主题的断钩处**（v0.49）：屏幕上的颜色一律先落进 CSS 变量（`--bg/--panel/--text/--text-2/--border/--accent/--code-bg/--quote-bg`），`@media print` 里一段同时命中 `:root` 与 `:root[data-theme='dark']` 的规则把 `color-scheme` 压回 `light` 并重声明整套纸面调色板（**段必须排在暗色段之后**，同特异度靠源序说话），顺手清掉屏幕辅助（`.fr-hit`/`.fr-active` 的查找命中高亮）；内容自己声明的字面色（段落底纹、单元格底色、幻灯片背景）不经过这条规则，所以照旧上纸；v0.50 又在这里补了 `.doc-content{min-height:0 !important}`——屏幕上那 900px 是打字辅助，矮纸（横向/A5）的可印高度不足它，正文尾巴会被顶成凭空多出的空白一页；**表格的网格线从无条件改为 `.sheet-print-grid` 一类**（v0.51：`printOptions@gridLines` 是打印设置里的一勾，而 Excel 的默认是"没勾就不印"），并新增 `.sheet-print-heading`/`.sheet-print-corner`（行列标题）与 `.sheet-print-band{break-inside:auto}`（一个列带一张表，带内可被分页切开，带与带之间由 `.sheet-print-break` 隔开）；v0.52 再添「页面设置」面板那一份（`.print-pop` 的分组 fieldset、毫米边距格、开关格、分页符 chip，以及 `.print-pop-errs` 与 `.print-pop-notes` 两本账的分色，`--danger` 同时进暗色 token 与 `@media print` 的纸面调色板——面板自己也可能被印出来，规矩照 v0.49 那条「屏幕上的颜色必须先穿过一枚 CSS 变量」）；**v0.59 换掉了 `.sheet-print-table td` 那一整档行盒**：`font-size` 从写死的 `11px` 改成 `var(--oof-print-base-size, 14.67px)`（底数由每张表 `<section>` 上那枚自定义属性说话，括号里那档只是"文件那一层没交代"时的兜底，与 `baseFontPt` 同一个数），`padding` 上下归零、`line-height` 从 1.45 收到 1.25、**`height:18px` 不再写**——底数一动，旧的固定行高就成了多出来的一截（接上文件而仍用旧行盒时 11pt 那份每行 24.98px、被挤成两页），而 1em 的方框又装不住下行墨（td 是 `overflow:hidden`，`line-height:1.0` 那一档在纸上把 p/g/y 那几笔切掉），1.25 × 底数正好落回 Excel 那一档（11pt ⇒ 13.75pt vs Excel 报的 14；14pt ⇒ 17.5 = Excel 报的 17.5）。**这一档行盒是 `PRINT_ROW_BIAS_PX` 的标定条件**：再动 `line-height`/`padding`/把 `height` 写回来，那枚偏置必须重跑实测
  lib/univer.ts       Univer 实例工厂（公式 worker + 八个社区预设：核心/筛选/排序/条件格式/数据验证/查找替换/绘图 + **批注与超链接**（v0.48，超链接的 `urlHandler` 把外链交给系统默认浏览器——桌面上 `window.open` 会开出一个新 WebView 窗口））
  lib/univer-io.ts    xlsx 数据+样式（粗斜/颜色/字族/边框/对齐/换行/数字格式）/合并/图表/列宽行高/隐藏行列/冻结窗格 ↔ Univer 快照 转换（样式去重注册）；**规则走侧通道**——取完单元格再按 sheetId 把 `extractRules(resources)` 的结果对回每张表，`warnings` 由 `aggregateNotes` 聚合；**批注与链接同一条侧通道**（v0.48）：取侧交给 `extractCellSide`，放侧把 `resources` 写成 `[noteResourceOf(...)]`（实测裸写就能被门面读回）、链接写成带 `customRanges` 的富文本格（**公式格上那枚先记账不硬放**，只有链接没内容的格子也要占一格）；`payloadToWorkbook` 因此多收一个 `accounts` 出参
  lib/sheet-rules.ts  三类规则的前端桥（v0.46）：`extractRules` 从工作簿快照的 `resources` 里按表取规则（Univer 三个插件各写各的 JSON，条件格式按快照原序交回=高优先级在前），`applySheetRules` 经门面放回界面（**条件格式倒着插**，因为这一版门面按插入顺序的倒序吐规则；builder 无 `setRanges`，作用区在 `build()` 之后挂产物），`buildDataValidation` 只建门面表达得出的四类 + custom；归一化（`normColor` 收 rgb/#、`normDateValue` 收 ISO、`listOf` 拆 JSON 数组串与区域引用、`neg === pos` 的负色丢掉）与 `aggregateNotes`（同类收成"文案×N"）都在这，`textLength`/`time`/`any` 这类摆不进模型的退成边界账而不是硬建一条；**v0.64 那三句"没能还原"后面的原串改走 `lib/fail-msg.ts` 的 `failText`**（账目本来就上状态栏，原话只该有一份出处）
  lib/sheet-cell-side.ts 批注与超链接的前端桥（v0.48，纯函数、零 DOM、Node 直测）：`extractCellSide` 从 `resources` 的 `SHEET_NOTE_PLUGIN` 按表取批注、从每格 `p.body.customRanges`（`rangeType` 只认 HYPERLINK）取链接，`noteResourceOf` 反向建 resources（实测裸写即可被门面读回，所以**不发消息不走门面**），`richTextOf`/`richTextBox` 负责"链接格吃的是 p 不是 v"这一层，`univerUrlOf`/`locationOfUniverUrl` 在 OOXML 的 `Sheet2!A1` 与 Univer 的 `#gid=<表 id>&range=` 之间换算（`quoteSheetName`：含空格或长得像单元格引用的表名要加单引号、`''` 是引号本身），`restampCellSide` 存盘前按格子把 Univer 模型装不下的 `author`/`tip` 回贴（**只在缺的时候贴**，界面上新写的那一枚不冒用别人的署名），装不下的形状退成边界账而不是挑个像样的凑数
  lib/chart.ts        ChartPayload → VChart spec → 离屏 canvas PNG dataURL（动态导入分包）
  lib/docx.ts         docx 导入导出（ProseMirror JSON ↔ docx，字色/字族/字号/高亮/页眉页脚/TOC 域/批注/页面设置 sectPr（纸张·四边距·w:cols 栏数栏距）/页码格式（PAGE·NUMPAGES）/分页符/表格合并映射（首行行级 tableHeader、列表 numbering.config 真编号）、单元格四边 `w:tcBorders`（**显式去边写 `w:val="nil"`**——none 压不住表级默认边框）、`w:shd` 底纹、`w:vAlign` 竖排、`w:tblInd` 表缩进、`w:vertAlign` 上下标、段落 `w:spacing`（行距 + 段前段后，**只写声明过的**）/`w:shd`/`w:pBdr`、脚注与尾注（`footnotes`/`endnotes` 记录 + 正文各带自动编号 `<w:footnoteRef/>`、多段拆多个 `w:p`、部件与 rels 注册））；文本节点兼容顶层 text 与 attrs.text；字节经 Packer.toBase64String + atob 取（toBuffer 走 jszip 的 nodebuffer 通道，浏览器里没有 Buffer））
  lib/ooxml.ts        迷你 OOXML XML 解析器（零依赖、不碰 DOM）：parseXml/find/findDesc/all/allL/attr/attrL/val/valNum/textOf + decodeEnt 实体表——让 docx 读侧能在 Node 里直测
  lib/ooxml-graphics.ts 图形部件读侧（v0.42，零依赖、不碰 DOM 所以 Node 侧可直测）：`smartArtToHtml(dataXml, inCell)` 解 DiagramML dataModel 的 ptLst/cxnLst（parOf 建树 + srcOrd 定序、空节点下钻、首次认父挡回边、`a:fld` 域编号不采）→ 嵌套 `bulletList`（格内改段落 `margin-left` 表层级）；`chartToHtml(chartSpaceXml, inCell)` 解 ChartML 缓存值（下钻找系列、`strRef`/`numRef` 中间层、`c:pt/@idx` 空洞留格、`multiLvlStrRef` 各级拼一格、轴标题不当图表标题）→ 标题段 + 数据表，无缓存只取标题；两者都返 `{html, kept}` 让调用方按"真取回多少"说告警
  lib/cfb.ts          复合文档（OLE 2 / MS-C 容器）读侧（v0.44，零依赖、不碰 DOM）：`isCfb` 认魔数、`openCfb(bytes)` 走 DIFAT（109 直槽 + 链）→ FAT（扇区编号即下标）→ 128 字节目录项的红黑树（left/right 兄弟 + child 指孩子根，`assigned` 兼防环），小于 4096 的流从根存储链装的迷你流按 64 字节迷你扇区拼；扇区 512/4096、v3/v4 都认，**结构不合返回 null 不抛**（坏件要"少部分内容照出"而不是整篇打不开），截断的件按 `floor(len/sec)-1` 收边界、v4 高 32 位非零的流只报名字不去碰
  lib/ole.ts          OLE 嵌入对象的**内容**提取（v0.44）：`unwrapEmbed` 拆容器（现代形状=部件本身就是原生文件；老形状=复合文档里的流 `\x01Ole10Native`），`oleNativePayload` 按实测字段布局走一遍、走不通再按"哪枚 DWORD 能把数据吃到接近结尾"扫兜底（数据不贴着流末尾，按流长反推必错）；`classifyEmbed` 先魔数后文件名，`embedHtml(content, depth)` 分派 docx（递归 `docxToHtmlFidelity`，depth≥2 停）/ xlsx（只要值，`r="C5"` 定位、空列不挤位）/ CSV（首行嗅探分隔符 + RFC4180 引号）/ txt（空行分段，UTF-8 出替换符换 GBK 重试），取不出的一律给带真名与大小的 `note`；上限 24MB / 200 行 × 40 列 × 4 表 / 64KB × 200 段，**截断写进告警不静默少给**；`inlineFlatten` 把块级正文压成行内（单元格放不下第二层表）
  lib/docx-fidelity.ts OOXML → HTML 保真导入器（v0.37）：run 级 rPr（粗斜/删除线/下划线/字色/高亮/字族/字号/上下标 `w:vertAlign`）、段落 pPr（jc/`w:ind` 左右与首行悬挂四种缩进写法/pStyle 样式链）、numPr+numbering.xml → 有序无序与 ilvl 层级（**跳档按 numId 折基准层**，不凭空补中间层）、表格 gridSpan/vMerge + tblGrid 列宽 + 单元格四边 `w:tcBorders`（含 val=nil 的显式去边）/底纹 `w:shd fill`/竖排 `w:vAlign`/表级 `w:tblInd`、段落 `w:spacing`（行距两档 + 段前后，含按行的 `w:*Lines` 估算）/`w:shd` 底纹/`w:pBdr` 四边、脚注与尾注引用（`w:footnoteReference`/`w:endnoteReference` 按 `w:id` 配 `word/footnotes.xml`·`endnotes.xml` 正文，跳过 separator/continuationSeparator，正文缺失记告警且不留空标记）、图片 rels→dataURL、内外超链接、分页符、批注三态锚点、域代码文字不外泄、**域编号重算**（v0.43：`fldChar` begin/separate/end 三道门接 `docx-fields` 的 `FieldEngine`——`SEQ` 现算并压掉缓存、`REF` 无缓存按书签段落文本兜底（书签表渲染前预扫）、算不了的沿缓存且无缓存记边界、`fldSimple` 同路、被跳过的分支不占号）、`w:object` 嵌入对象（v0.43 预览是 EMF/WMF 解不开时留一行可见占位，ProgID + rels 反查的部件文件名；**v0.44 先走 `lib/ole` 取内容**——取到就把内层正文接为段落兄弟块（格内改压行内）且不再叠占位，取不到才留占位）、文本框 `w:txbxContent`（`wps:txbx` 与旧式 `v:textbox`）展平为段落、OMML 公式线性化、`mc:AlternateContent` 只取 Choice（空则退 Fallback，避免同一份正文翻倍）、drawing 锚点经 rels 找图示/图表部件（v0.42，部件缺失与关系缺失各记一条告警）；认不出就抛错或 blocks=0，调用方回退 mammoth
  lib/docx-fields.ts 域重算引擎（v0.43，零依赖、纯 Node 可直测）：`parseInstr` 拆 `命令 参数 \开关`（**开关 token 原样保留大小写**——Word 就按它决定结果形态）、`seqText` 按 `\* ROMAN`/`roman`/`ALPHABETIC`/`alphabetic`/`Alpha` 出对应形态、`FieldEngine`（`from(doc)` 渲染前扫全篇建书签表（只排 `_GoBack`，`_Ref…`/`_Toc…` 必须留）+ `seqValue` 跟着文档顺序走 + `refText` 兜底段落文本）、`recomputable`（只有带 label 的 SEQ 现算）、`fieldLabel`/`paraText`（域代码与已删文字不算正文）
  lib/cell-style.ts   单元格样式扩展（v0.38）：tableCell/tableHeader 的 bdTop/bdRight/bdBottom/bdLeft + background + vAlign、table 的 marginLeft 全局属性（只声明属性不改内容模型）；边框统一规范串 `"0.67px solid #8899aa"`，三态 null 未声明/'none' 显式去边/有值；`inlineBorder()` 读 CSSOM longhand（shorthand 对 none 返回空串）、`IndentTableView` 子类补 marginLeft（resizable 的节点视图不传 HTMLAttributes）、`eighthsToPx`/`pxToEighths` 管 1/8 磅换算、命令 setCellBackground/setCellVAlign
  lib/paragraph-style.ts 段落排版扩展（v0.39）：paragraph/heading 的 lineHeight/lineRule/spaceBefore/spaceAfter/background/bdTop..bdLeft 全局属性，一组属性拼**一条** style（多条各写一份会互相盖掉）；`ooxmlLine`/`lineToOoxml`/`ruleOf` 管 1/240 行与二十分之一磅两套语义，"最小值"档 CSS 表达不了就修行内自定义属性 `--oof-lr` 带回；命令 setParagraphStyle/setLineSpacing/setSpaceAround/setParaBackground
  lib/indent-extension.ts 段落全局属性 indentLeft/indentFirst（32px 一档、上限 320px）+ setIndent/indent/outdent 命令 + Ctrl+] / Ctrl+[ + 悬挂缩进感知的出退格
  lib/toc-extension.ts TipTap 目录原子节点：按标题实时汇总、点击跳转
  lib/page-break-extension.ts TipTap pageBreak 原子块（`div[data-oo-pagebreak]`）+ insertPageBreak 命令 + Ctrl+Enter 快捷键
  lib/comment-extension.ts comment mark（cid 锚定批注）+ 加/删/定位/汇总工具
  lib/note-extension.ts 脚注/尾注的 `note` 内联原子节点（attrs kind/text，正文不摊进文档流）：`encodeNoteText`/`decodeNoteText` 管属性里的换行（XML/HTML 解析器会把属性值里的 LF 归一成空格），`notesOf`/`noteOrdinalOf`/`locateNote` 按文档顺序现算编号，命令 insertNote/setNoteText/deleteNote（只填 tr + 用给到的 dispatch，绝不自己 view.dispatch）
  lib/odt.ts          ProseMirror JSON ↔ ODT（JSZip 打包导出 + DOMParser 导入，字符样式（字族/字号/字色/上下标 `style:text-position`，落在 content.xml 自动样式）/合并表/图片尺寸/页码域与总页数/page-layout 页面设置（纸张·四边距·style:columns 多栏）/分页符 fo:break-before/单元格自动样式 `fo:border-*`（宽度写 pt，读回走 `odfBorderCss` 保留 0.67px 这类细线不整数取整）+`fo:background-color`+`style:vertical-align`、表级 `fo:margin-left`、段落直接格式 `fo:margin-top/-bottom` + `fo:line-height`（倍数写 % + proportional、绝对值写 pt + fixed/minimum，两档在 ODF 里分得清而 CSS 分不清）+ `fo:background-color` + `fo:border-*`（宽度写 pt），读侧按名字跳过具名样式与 `office:styles` 里那批，以免把整篇默认摊成每段的直接格式；脚注/尾注写 ODF 1.2 内联 `text:footnote-reference` + 同 `text:id` 的 `text:footnote`（citation 写字面序号、段间 `text:line-break`、正文段挂 `FN` 自动样式），读侧三种外壳都收（新版两个元素名 + 旧版 `text:note`/`text:note-class`/`text:note-body`），正文表先扫全文建全表，故 id 不连续或正文排在引用之前也配得上；`draw:frame` 认三类内容（`draw:image` 位图 / `draw:text-box` 文本框展平为 `<br/>` 连成的行内文字 / `draw:object` 嵌入件——`Objects/objectN/content.xml` 里有 MathML 就线性化成文本，否则 v0.44 走 `lib/ole` 取内层内容：`<office:binary-data>` 内联 base64 与 `Objects/objN/` 目录两种形状都解，摊出的块级正文由 `tail()` 作段落兄弟块接回、单元格内压成行内文本），`content.xml` 解析失败时抛出说得出是哪份 XML（否则表现为"打开了一篇空白"），读侧统一产 `warnings`（同类聚合成「文案×N」）交状态栏显示；**批注往返（v0.86）**：读侧把 `office:annotation` 收成 DocComment（`dc:creator`/`dc:date` 按**子元素**取——当属性取那一版是往返腿自己量出来的真缺陷；`annotation-end` 名字预扫配对、点批注锚在自己段落尾、annWrap 在每个块出口续挂还开着的跨段区间），写侧照 docx 那两条老规矩（`usedAnn` 同 cid 全局只一组区间、孤儿不写回），跨段区间同名 `office:annotation-end` 收口，`xmlns:dc` 声明在根 NS 上补齐——漏了它写出的字节连自家读侧都不认）
  lib/find-replace.ts 查找/替换 ProseMirror 插件：按文本块匹配存 state、装饰高亮、findNext/findPrev/replaceOne/replaceAll 命令（命中上限 FR_HIT_CAP=2000 截断并标 `N+`）
  lib/templates.ts    首页模板注册表与纯函数 seed：11 个模板（公文/会议纪要/周报 → ProseMirror JSON+meta，记账表/库存清单 → WorkbookPayload 含公式冻结，六套演示配色 → Deck）
  lib/ppt.ts          .opd 幻灯片数据模型（版式/主题/序列化）
  lib/pdfprint.ts     打印覆盖层：挂 DOM → 注入打印样式 → export_pdf → 清理；`@media print` 里给 `html,body` 兜白底黑字（v0.47：外壳的 `body{background:var(--bg)}` 曾把整页铺成屏幕的浅灰蓝，三种导出都中招；元素自己声明的颜色不受影响）；**每条作业把自己那份 `@page` 说全**（v0.50：`ownPageRule()` 输出 `size` + 四边 `margin` + 十六个 margin box 复位，`printMarginsInches()` 让 CSS 与 PrintSettings 吃同一组数）——PrintToPdf 会认 CSS `@page size`，而文档标签的 `#oo-page-rule` 常驻 `head`，不禁掉别人的说法就会被"上一次打印"污染（实测：导完文档再导演示得到竖版纸 540×960、幻灯片只占 0.34）；**v0.53 加 `measurePrintLayout(overlay, read)`**——覆盖层在屏幕上被 `#oof-print-host{display:none}` 藏着、量出来全是 0，于是另开一个离屏量尺容器（同一套正文样式，只是不带 `@media print`/`@page`，那组规则改的是可见性、分页与纸面而不改任何一行的高），量完即摘，被量的那份 DOM 仍旧原封不动交给导出那条腿
  lib/sheet-cf-print.ts  条件格式的**打印侧求值**（v0.47，纯函数零 DOM）：`evalSheetCondFormats(sheet)` 按载荷数组序（=优先级）吃规则，产出 `Map<'行,列', CfPatch>` 与账目——`cell`（number/text/duplicate/unique/rank/average，含"前 N 项算并列""空串条件=格为空""数字与文本归一比较"）、`colorScale`（分位数线性插值 + 越界截最近档）、`dataBar`（0 轴起点、负色、渐变/实色、`showValue=false` 收成 `hideValue`）；`iconSet`/公式判定/日期区间/缺样式的一律**只记账不落笔**；`PRINT_MAX_ROWS`/`PRINT_MAX_COLS` 用来裁 `A:A` 这类整列引用，否则一条规则循环百万格
  lib/sheet-print-ui.ts  「页面设置」面板要的一切（v0.52，347 行纯函数、零 DOM、Node 直测，不进组件也不碰门面）：`mmToInch`/`inchToMm`（**面板按毫米说话、载荷按英寸存**，换算只这一处）、`PAPER_OPTIONS`/`paperMm`（纸号→毫米，英制档没有"毫米名"就照实换算）、`hfSlotsToText`/`hfTextToSlots`（三框 ↔ OOXML 那条串：只填中档时**不带** `&C`，与 Excel 写出去的形状同一档；找分段标记时按 `&&` 跳转义，否则「A&&Link」里第二个 `&` 会被当成 `&L` 拆错）、`hfStrayAmpersands`（`&` 后面不是已知格式码时 Excel 会自己吞一个字符，界面先说出口）、`sqrefToRect`/`rectToSqref`/`spanToSqref`/`sqrefToSpan`（`$C$2:$F$5` ↔ 0 基含端点、`$1:$2`/`$A:$B` ↔ 行列跨度）、`addBreak`/`removeBreak`（重复断点只记账不重排）、`draftOf`（缺省项**留白**而不是替用户声明一档默认值；v0.55 起那两枚缺省开着的开关反过来——`scaleWithDoc`/`alignWithMargins` 在面板上**勾着才是缺省**，只有载荷明确说 `false` 才不勾）、`validateDraft`（区分"不解析＝不声明"与"解析得动但超出这张表＝点名并把确定灰掉"，网格上限由调用方从门面取）、`draftPaperNotes`（随草稿实时说给面板的那几本账，v0.53 改了内容：整码做不到的两类（起始页码——`@page` 的页码 counter 没有"从 N 接着数"的通道、偶数页另版），有条件才落笔的一类（上下居中只在那一页装得下才居中，否则按顶端排并记账），越界的一类（`fitToWidth`/`fitToHeight` ≥100 排不出那么多页，纸上按整幅分带/自然分页）——文案与 `planSheetPrint`/`planSheetFit` 逐字对齐，同一笔账在面板上与在导出时说的是同一句话；**v0.54 把它收成"转述"**：页码与奇偶页那几本账一律取自 `hfAndPageNumberNotes`（面板源文里不再出现"起始页码设的是""奇偶页不同"这类自家抄的文案，结构腿数着整仓只此一处），而"偶数页另版"从账上消失了——它已经不是做不到的事）
  lib/sheet-print-measure.ts 打印排版的**实测层**（v0.53，59 行，这一层唯一碰 DOM 的地方）：`measureSheetPrint(root)` 按 `<section>` 表序量回 `SheetMeasure`（每一带的重复表头高、逐行高、整表高，加表格上面那一行表名的高——用「第一带的 `top` 减 `section` 的 `top`」量，不逐个选择器猜 margin 折叠；**没有网格的那几张占一格 null**，否则 `plans[i]` 会配到别人家的实测上）；`applyVerticalPads(root, fits)` 把居中留白写回**量它的那一份 DOM**（第一页给 `section`，其后逐带给自己的带）。为什么要这一层：新建的表一条 `rowHeights` 都没有（默认行高由字体现算）、声明过的行高只是**下限**（写 20px 实测 21px）、长文字那行自己撑到几百像素，而 `zoom` 之后的行高**不等于线性折算** ⇒ 只能在最终缩放下量，换算则全交给 `sheet-print-setup` 的纯函数
  lib/sheet-print-setup.ts 一张表的打印设置 → 打印计划（v0.51，纯函数零 DOM 零时钟）：`planSheetPrint(sheet, ctx, opts?)` 产出 `SheetPrintPlan`（v0.55 多的那枚 `opts.hfZoom` 说的是「这一趟真正落到纸上的那一档缩放」，页眉字号乘的是它而不是计划里声明的 `zoom`）、纸面 `pageSizeInches`（`PAPER_INCHES` 编号→短边×长边再按 `orientation` 换边，认不出记账后走 `SHEET_DEFAULT_PAGE`）、`margins`（缺省与 `pdfprint` 同一组数，英寸）、`printableWidthPx` 与 `printableHeightPx`（**可印高这里不取整**——一页放几行要拿小数行高去比，v0.53）、`zoom`、`gridLines`/`headings`/`hCentered`/`vCentered`、`printArea`（`clampArea` 把越界端点**夹回来而不是整条作废**）、`titleRows`/`titleCols`（`titleRowSpan` 与打印区域求交——区域外的行根本不印，标题也就无从重复）、`pageBreakRows`/`colBreaks` **照 `<brk id>` 原样收**、`fitToWidthPages`/`fitToHeightPages`/`firstPageNumber`、`headerStyle`）；`planColumnBands` 按可印宽度切列带（标题列每带各带一份但不重复计列、手动列断点在**那一列之前**收带、首列上的断点是空的不凭空造带、勾了"缩放到 N 页宽"反求 zoom）；`headerFooterCss` 把 `&L/&C/&R` 三段码翻成 `@page` 的 margin box（`&A/&P/&N/&D/&F` 有对应通道，**没有的整码丢掉并记一笔**，不把 `&X` 当字面文字印出去；**v0.54 之后三版各落一处**：奇数版在勾了「奇偶页不同」时落 `@page:right`（实测 `:odd`/`:even` 这台不认，发出去两页整框空白）、偶数版落 `@page:left`、首页版落 `@page:first`，两枚开关各自 gating——没勾的那一版不上纸、勾了而那一版是空的也不发空框；关键是 `resetRest`：`@page:first` **只覆盖它自己声明的那几格**，未声明的框会穿透到 `:right`/基 `@page`（实测首页页眉长出 `L-奇 C-首 R-奇`），故六格中没写到的要显式 `content:normal` 复位，勾了「首页不同」而首页那一版整个是空的就等于六格全复位＝首页什么都不印（Excel 同义）。**v0.51 记的「`:first` 必须排在基 `@page` 之前」本轮重量后不成立**，源序只为好读、承重的是复位。**v0.55 再收一枚 `HfPaperOpts { zoom, margins }`，管两枚缺省开着的开关**：`scaleWithDoc` 开着时把页眉字号乘上这一趟真正上纸的那一档缩放——margin box 是**页级**的、不吃挂在 `<table>` 上的 CSS `zoom`（实测内容 zoom 0.5 时页眉一个字都没变小），所以只能自己乘（Excel 那一份是量的：50% 下开着＝页眉 5.5pt、关掉＝11pt；基准 `HF_BASE_FONT_PX = 16` 也是量的，倍数正好为 1 时一个字都不写，段自己带了字号码就交给 `segStyle` 乘、两处不重复出手。**v0.56 把底数改到 Excel 那一档**：`HF_BASE_FONT_PX` 换成 `HF_BASE_FONT_PT = 11` 配一枚 `ptToPx`（pt→px 的 96/72 只写这一处），`segScaleCss` 换成 `segFontCss` 且**倍数正好为 1 时也照写**——不写不是"不声明"，而是让 margin box 去继承页面那 16px（＝12pt），把缺陷原地留在纸上；自带字号的段仍走 `segStyle` 的 `ptToPx(seg.pt * r.scale)`，底数不重复出手）；`alignWithMargins` 关掉时按**载荷那两条左右边距**给每一格往外推同量的负 margin（`width:100%` 不吃、认 margin/padding，推过头那一格会被静默整个丢掉故一丝不许多给，边距为 0 的那侧不推，中格两边都推——不对称边距下它的中心从可印区中心挪到纸中心）；`hfAndPageNumberNotes` 是**纸上那几本账的唯一文案处**（起始页码设的是 N 而纸上仍从 1 数、起始页码不算⇒奇偶按物理页分且从偶数起时会与 Excel 反过来、带着偶数版/首页版却没勾、勾了开关而那版是空的），导出与面板都吃它这一份，**v0.55 多一句「做到了但差一圈」**：`alignWithMargins` 关掉时我们铺到纸张边缘、Excel 铺到打印机的可打印区（实测左右各留 55pt），这句不说出口用户会以为两边一模一样；`jobPrintPlan` 定这一趟的纸（多张表各说各话时第一张说话、其余记进 `job.notes`）；**v0.53 把"按实测说话"那一半接上**：`printPagesPerBand`/`simulatePrintPages` 按实测行高逐带贪心分页（行不拆开，一页装不下整行挪下一页）、`fitToPagesTallZoom` 找能压进 N 页高的最大一档缩放（1% 一档、下限 10%、`FIT_TALL_GUARD` 一档余量，页高看的是**最高的那一带**而不是总页数）、`verticalCenterPadPx`（装得下才给留白，装不下 0——居中的反面是"假居中"）、`planSheetFit` 把实测落成最终缩放 + 各处上留白 + 该说的账，`PRINT_ROW_BIAS_PX = 0.4` 是"屏幕媒体下量的行矩形比纸上短多少"的实测常数（与缩放档无关），`scaleMeasure`/`paperAt` 把两者分开：表名那一行**不随 zoom 折算**；仍然做不到的只剩起始页码（`@page` 只有一个页码 counter）**只进 `notes` 不落笔**；**v0.57 把页眉底数从常量改成文件说的数**：`HfPaperOpts` 与 `planSheetPrint` 的 opts 各多一枚 `hfBasePt`（一路传到 `HfRender.basePt`），`HF_BASE_FONT_PT = 11` 降级为**兜底**——荒谬值（0 与负数）在唯一的消费点回落它，而不是把 `font-size:0px` 写到纸上让整行页眉消失；**v0.59 把这一层从"只管页眉"抬成"正文与页眉共吃的底数"**：新增 `baseFontPt(df)`（那一层说的磅数；没说话、或说 0/负数这种荒谬值都算"没交代"⇒ 落回 `BASE_FONT_PT = 11`，那枚常量由页眉专属改成共用名）与 `baseFontPx(df)`，`ptToPx` 从私有升为**整仓唯一**的 pt→px 换算处（格子的 `s.fs`、页眉段、正文底数都从它过），`SheetPrintPlan` 多一枚 `defaultFontPx`（`planSheetPrint` 的 opts 由 `hfBasePt: number` 换成 `defaultFont: DefaultFont`，`HfPaperOpts.basePt` 同步换成 `defaultFont`，`headerFooterCss` 里那一档底数改由 `baseFontPt` 读——**解析只此一处**，否则重说出来的页眉 CSS 与计划那份不是同一档纸）；`PRINT_ROW_BIAS_PX` 从 0.4 **归零**（跟着新行盒重标定：逐行拿同一列的基线差对屏底行矩形，普通行差 −0.05~+0.02px 属基线吸到整磅的噪声，中位数会挑到抖出来的那一档；留着 0.4 不是保守而是凭空多压一档缩放——结构腿钉成"同一份实测在 0.4 下变 15 页"的假例），注释里那条件升级为「这一枚数跟着行盒走，动 `line-height`/`padding`/`height` 必须重跑实测」）
  lib/sheet-print.ts  WorkbookPayload → 打印 HTML 网格（值/边框/对齐/换行/数字格式/字族/合并/列宽行高/跳过隐藏行列/**跳过被筛掉的行（`filter.filteredOut` 与 hiddenRows 并列）**/**条件格式算出的底色·字色·粗斜·下划线·删除线·数据条（v0.47）**/**图表位图按锚点格绝对覆盖、锚点撑开网格边界（v0.47）**/**纸张·边距·缩放·打印区域·重复标题行列·手动分页符·列带·水平居中·网格线与行列标题（v0.51，一切先过 `planSheetPrint`）**/分页/截断）；一个列带一张 `<table>`、每带各一份 `<thead>`（实测 Blink 会自己重复表头，我们不再手工插第二份）；返回 `{html, notes, plans, job}`——页面上只印"这份打印件缺了什么"，其余账目交回调用方进状态栏，`job` 那三个数直接喂 `pdfprint`；**v0.53 多收一枚 `opts.zooms`（按表序，null＝这张不动）**：那是上一趟实测定下的最终缩放，说话权在它而不在计划的 `zoom`，于是"按 N 页高压一档"能真的把这份 HTML 重建成那一档；**v0.55 让同一枚数再往下走一步**——`planSheetPrint(s, ctx, { hfZoom: opts?.zooms?.[i] })`，正文被压了页眉就跟着压；**v0.56 补上宽度分带挤出来的那一档**：`sheetHtml` 的返回值多一枚 `zoom`（它**真正挂到 `<table>` 上的那一个数**，空表与"打印区域里没有可打印格子"那两条早退路径回报计划的 `plan.zoom`），`sheetsToPrintHtml` 发现它与计划用的那档不同就**只重说页眉那份 CSS**（同一次解析、`notes` 故意不重复推，否则同一笔账说两遍）并把 `job` **重算一次**——纸的那三个数与"各表的页眉页脚不一样"那本账都要在页眉重说之后才算最终答案；这里刻意不把列带几何再算一遍，两处各算一套宽度迟早分叉；**v0.57**：`const hfBasePt = payload.defaultFont?.fs ?? null` 一次取，既喂 `planSheetPrint` 的 `opts.hfBasePt`，也喂 v0.56 那趟"页眉重说"的 `headerFooterCss(..., { basePt })`——底数在两趟里必须是同一个数，否则重说出来的那份 CSS 与计划那份不是同一档纸；**v0.59 让同一层再往下走一步到正文**：`const defaultFont = payload.defaultFont ?? null` 一次取出，既喂 `planSheetPrint` 的 `opts.defaultFont`（计划里那枚 `defaultFontPx` 由它算），也喂 v0.56 那趟"页眉重说"的 `headerFooterCss(..., { defaultFont })`；`sheetHtml` 里新增一枚 `bstyle`，把 `--oof-print-base-size:<px>` 挂到每张表的 `<section>` 上（**三条出口都挂**：正常网格、空表、"打印区域里没有可打印的格子"——后两条那格里的字同样要上纸，底数不该因为没网格就换一档），`styleParts` 里格子自带的 `s.fs` 改走导出的 `ptToPx`（不再各算一份 `×1.333`）；格子说了字号仍由 `styleParts` 盖在格上、`&12` 那类段仍走 `segStyle`，一次读出两处共吃、不重复出手）
  lib/pptx-export.ts  Deck → pptx（pptxgenjs）
  lib/pptx-import.ts  pptx → Deck（JSZip 解包 + OOXML 解析 + 媒体还原）
  lib/pdf-pages.ts    PDF 页面级操作（pdf-lib 覆盖写回）：rotatePagesInPlace / removePagesInPlace（倒序删 + 删空守卫）/ extractPages / mergePdfs / splitPdf，做完由调用方重载；**v0.80：这一层的两处 `load` 与三处 `save` 不再走库默认的让出粒度，一律吃 `./pdf-ticks` 那一枚常数**（`loadDoc` 带 `parseSpeed`，`saveDoc`/`extractPages`/`splitPdf` 带 `objectsPerTick`；这一层自己不留第二个数，M10 把"自带一份"判成违例）
  lib/pdf-ticks.ts    pdf-lib 让出粒度的唯一持有者（v0.80，一枚常数 + 它的实测理由）：`PDF_OBJECTS_PER_TICK = 1500`（= 库自己的 `ParseSpeeds.Fast`）。为什么是这一个数：库默认（load 100 / save 50）下 2300 页件（`objects=4764`）要让出 **142 枚**宏任务，每枚被 Chromium 的嵌套零延迟钳位吃到 ~6.6ms ⇒ 整趟 985ms 里约九成是**等**而不是忙（dev 打点：`loadSyncOnly=0 / loadAwaitOnly=236`、`saveSyncOnly=0 / saveAwaitOnly=750`、页内 `longtask=[]`、`mainThreadShare ≤10.9%` 且那还是含 CDP 轮询的上界）；粒度阶梯（同一枚件、页内墙钟）默认 985 → t500 157 → **t1500 73/96** → t4000 57 → fastest 55，而**产物字节五档同一份**（`c4b260253a7f`）⇒ 只动时间不动内容；不取最快档是因为越激进单枚同步块越长（`maxGap` t1500 28 / t4000 35 / fastest 65ms，Node 侧往返 max 10/22/54），那是 v0.66「别把主线程点着」那一族。真机的账在 release A/B：按键→写出门 **1024/1028/1034 → 148/172/153ms**，因此那句 `SAVE_BUSY_MS=200` 的「正在保存…」从"上屏并活 819ms"变成根本不上屏（v0.70 那一格买到的句子，本轮买的是它不必再说）。**读与写共用这一枚数**（两段的让出成本同一量级，两个数就是两根阶梯）；它是本机单机的数，换机器要重扫
  lib/pdf-geo.ts      显示空间（已套旋转·左上原点）↔ PDF 原始坐标（未旋转·左下原点）双向精确换算：normRot / displaySize / toDisplayRect / fromDisplayRect / toDisplayPoints / fromDisplayPoints + parsePageSpec（`1-3,5` 页码写法）
  lib/pdf-range.ts    大 PDF 分段读取：PDFDataRangeTransport 子类（≥4MB 才启用、64KB 文件头起手、按 begin 计数投递、abort 置 dead）+ fileSize/readRange，配 Rust 侧 file_len + read_range；**v0.68 新增 `preparePdfSource(path)`——「这枚 PDF 首屏该怎么读」那次决定的唯一持有者**，返回 `{mode:'range', transport} | {mode:'bytes', bytes}` 两种形状之一（先判闸门再决定读法：过了 4MB 只取文件头，没过才整本读一次，顺序反了就等于把分段件读成整叠字节），外壳的预取与编辑器的自备**共吃这一枚**（阈值 `RANGE_MIN_BYTES` 全场只这一处，判据 R1/R2/R3）
  lib/pdf-password.ts 加密 PDF 那句"要密码"的判据与文案（v0.65，纯函数、零 DOM、Node 直测，这四句话的唯一持有者）：`pwdReason(code)` 把 pdf.js 的 `PasswordResponses` 收成两档（实测只有 `1` 要密码与 `2` 密码不对，**没有第三档**，故未知档一律落 `'need'` 而不许凭编号编出新理由）；`pwdPromptText(reason, attempt)` 管问的那一句——第二回起把「已经试过 N 次」说出来（`attempt - 1` 且下限 1；pdf.js 自己**不封顶**，答错就一直再问，界面上不说用户就没有退出的依据）；`pwdCancelledText()` 是用户自己按取消的那一行，**不带"失败"前缀**（没有失败，只是没往下走）也不挂原始信息（那一句是我们按下去的，不是文件报的）；`PWD_MEMORY_NOTE` 说的是密码的去向（只留内存、关掉标签就没了、不写进任何文件）——面板与状态栏都不自带句子，结构腿 A10 扫的是剥掉注释之后的源文
  lib/pdf-search.ts   全文搜索那一格的文案与"什么时候肯把进度交出去"（v0.66，纯函数、零 DOM、Node 直测，这两件事的唯一持有者）：`findCountText(st, hasQuery)` 按顺序判四档——还在扫就先说扫到第几页（`scanned=0` 那一档页号还没得说，只说「正在搜索…」；有命中时把「第几条/共几条」与进度写在同一句里，因为用户等的是命中数而界面要说的是还在干活），扫完才许说「无匹配」（**这一句只有扫完全程才配说出口**：真机量到旧形状在打字后 ~25ms 就报"没有"，而那是一页都没扫的防抖窗），查询串为空则整格为空（不给凭空的否定）；`shouldPublish(now, lastAt, sinceHits, sincePages)` 是节流的唯一判据（新命中攒够 `SEARCH_PUBLISH_HITS=20` 立刻交、否则按 `SEARCH_PROGRESS_MS=120` 的时间窗交，而 `sincePages === 0` 拦死——一页都没扫就不许交，否则空转也上屏），两个阈值是被真机数定出来的：一趟 700 页全程界面说 **20 句**，每页一句会把主线程点着、全程一句又回到"扫完才说话"的旧形状；`FindStatus` 那一位只存 `scanning` 与 `capped`（命中条数与激活下标跟着 `matches`/`activeIdx` 走，不在这里重复存一份，重复存就会分叉）
  lib/editors.ts      动态 import 的唯一持有者：四类编辑器 + Workspace 外壳各自的「已解析组件表」（peekEditor/loadEditor、peekWorkspace/loadWorkspace），挂载点同步命中即不走 Suspense（v0.36）
  lib/prewarm.ts      首页空闲期预取外壳与编辑器 chunk（App 级，与 lib/editors.ts 共用同一模块 promise）：顺序为 Workspace 外壳 → 按最近文件类型的四个编辑器；实测无收益的实例级/worker 级预热与公式 worker 线程池已删除
  lib/registry.ts     跨组件保存器注册表（Ctrl+S 路由到当前标签）；**v0.69 起这一层还管"同一个标签不许并发写"**：`running` 集合记在途、`again` 只留一个"还要再存一次"的位（不排队列也不丢弃——排队会让用户早先的中间态多落一次盘，丢弃会让最后一次按键的改动没存进去，而 `write_xlsx_sync` 的 `std::fs::write` 并发跑在不同 blocking 线程上写同一路径、谁后落地没有保证，实测改前连按两趟**全部重叠**）；补的那一趟跑的是同一个 `save()` 因而**重新取快照**，`drain` 里的 `catch {}` 不上抛（saver 自己已经把失败说给用户，这一层只管锁；锁卡死就是这个标签再也存不了且不说话）；**v0.74 添 `runExclusive(tabId, fn)`**：定时自动保存那一路以前直接调 `writeText`、绕过 `running`/`again` ⇒ 真机三趟全重现"定时器刚把 `write_text_file` 送出门、同一毫秒手动 Ctrl+S 又发一枚"，两枚 `std::fs::write` 竞写同一路径，屏上「已保存」说了而**文件里那半句新打的字被旧快照盖掉**——这一层要买的就是那一格。语义与 `saveTab` 共用同一把 `running` 锁与同一个 `again` 位：锁空闲 ⇒ 跑 `fn`；锁忙 ⇒ 本趟**跳过**（手动那趟的快照本来就更新，它落完就已经是最新内容存了盘，30 秒后下一趟再来）；`fn` 跑完若 `again` 被置位（锁在途时用户按了 Ctrl+S），交给 `drain` 补跑，让手动的句子与 fresh 快照最终落地——**不补跑就等于把用户那一下吃掉，锁不卡死但事没做**。**句子仍不归这一层**：`runExclusive` 只保证"这一路不与手存抢同一格"，成功/失败那两句话说什么由调用方持有（DocEditor/PptEditor 各自那 30 秒的定时器与 `failStatus`，**⇒ v0.75 改口：那两句话现在由 `lib/auto-save.ts` 拼，而"隔多久再来一枚"也由它给**），与 v0.69 那条"锁只管锁、saver 自己把失败说给用户"同一条分寸
  lib/auto-save.ts    定时自动保存那一路的账（v0.75，纯函数、零 DOM、两头共吃，「隔多久再来一枚」「失败第几回」「那两句话怎么说」这三件事的唯一持有者）：`AUTO_BASE_MS = 30_000` 是 v0.69 起就在那一路的实测基数（A1a 判"基数没被顺手改"）、`AUTO_MAX_MS = 240_000` 由前置实测那 8 枚定出来（只读件挂 4 分钟，`write_text_file` 每 30.0 秒出门一枚、间隔漂移 ≤9ms 而每枚自身只有 5~14ms ⇒ 挂着不动的不是慢，是"明知不行还一直敲"；翻倍到 240 秒封顶后同一个 4 分钟窗只剩 3 枚）、`autoDelayMs(fails) = min(BASE * 2**fails, MAX)`（A2 + M4：把公式换成裸常数就报）；**没有做成"连续失败 N 次就彻底停"**——停掉之后用户把权限改回来也再也存不上；`createAutoSaveLedger()` 是**工厂**而不是单例，组件用 `useRef` 一份一份拿着（A4a/A34 + M16 把这一条钉死：`Workspace` 标签常驻挂载 ⇒ 共享一份账会让 A 件的失败把 B 件的时钟推后）——`noteFailure` 同进连续账与总账、`noteSuccess` 清连续账并记一次成功（A3a/A3b + M6）、`clearBackoff` **只归零退避而不进次数账**（A3c + M5：手动那一趟不是这一路存上的，E5c/D4d 在真机上判那句仍报"失败 4 次 / 2 次"）；`autoFailStatus(e, fails, nextDelay)` 在 v0.64 那两行规矩之上第一次加第三行「X 秒后自动重试」（A5 + M17），`autoOkTip(l)` 是给成功那句的悬停账（v0.73 量到那一格 `title` 是空的；失败一旦被下一次成功撤掉，整段经历就会从界面上消失，这一行是给"撤掉之后"留的）；**这一层与 `lib/save-status.ts` 的分工是 v0.73 定下的那一刀**：共用 `failStatus` 那一层的文案、不共用 `saveDoneTimer` 那一层的停留（A30b/A30c 判这一层不吃那枚收尾时钟、只吃 fail-msg），也不挂进度门——这一路的句子是"最近一次自动保存的结果"，实测要挂到下一次结果出来为止；**v0.76 这一层多了一条认领关系**——`export interface FailureClaim { msg: string; path: string }` 与纯函数 `staleFailureClaim(claim, path): string`（命中该路径才把那句交回去、不命中给空串，调用方按"非空才撤"办事；A1a~A2d + 变异 M1/M19：把认领做成"无条件撤"或从关系里去掉 `path` 都会报）。这条是补 v0.73 那一格的：那时撤句的凭据是"这句是我写的"（组件里一枚 `autoStatusRef`），于是**手动 Ctrl+S 在同一个文件上失败的句子，定时这一路永远不认**，真机量到权限改回来、文件又真的存上了之后，那句「保存失败」仍挂在屏上 **20614ms** 而「已自动保存」一次都没上屏（它挂在 `!status` 之后，正是被那句堵死的）；现在撤句的凭据换成"这句话说的是哪个文件"，而**身份比较那一半原样保留**（`cur === stale` 才撤，M2 钉"不许做成裸 `setStatus('')`"）⇒ v0.65「迟到那一趟不许抹活着一趟」没有因为这次换凭据而被改宽。模块仍不碰状态栏也不碰 store（A3a/A3b），仍不吃 `saveDoneTimer`（A3c）。**v0.77 这一层多的是"什么时候可以不等那一枚"**——
账本添 `lastAttemptAt`（初值 0 ⇒ 从没敲过门时第一次焦点可以探）、`noteAttempt()`（记页内毫秒时钟，F1b）、
`canProbe(now = Date.now())`（`now - lastAttemptAt >= AUTO_BASE_MS`，F1a：下界就是那一枚基数，组件里不许另写一个数）
——**登记的判据是"那枚写请求真的被送出门"**，所以 `noteAttempt` 必须排在 `runExclusive` 之内（F3b + M5：锁忙被跳过的那一趟
`fn` 根本没跑，记它进节流账等于让手动那一趟正在写替自动这一路受罚，与 v0.75 那条"跳过不算失败"同一个理由）；
同一模块导出 `onFocusBack(fn)`（F2a~F2d + M2/M3/M4：订 `getCurrentWindow().onFocusChanged` 而不是 `{kind:'Any'}`，
只有 `e.payload` 为真才回调 ⇒ blur 那一半挡掉，`then` 迟到时若已 `stopped` 就立刻 `u()` 取消——StrictMode 双挂载下
被换掉那趟不许留下监听，交出的那枚取消会真的解除订阅）。这三样加起来的只是**"什么时候可以不等那一枚"**，
而"说什么、记什么账"仍是上面那两套（v0.73~v0.76 那一字未改，F3h/F3i/F3j/F3k 四枚吃的就是这一点）
  lib/save-status.ts  存盘那一段的文案与时钟（v0.69，纯函数、零 DOM、Node 直测，这两件事的唯一持有者）：`saveDoneText(notes)` 只此一处拼「已保存」与「已保存（第一条，另有 N 条说明）」（v0.63 那套拼句公式原样搬进来，组件里不许再抄一份，抄了就分叉）；`SAVE_BUSY_TEXT = '正在保存…'` 与 `SAVE_BUSY_MS = 200` 那枚门是被真机数定出来的——release 上小件整趟 11~18ms 不值得说话、中件 45~46ms、大件 590ms 而**头 115~131ms 是主线程上的同步块**（`wb.save()` 与 `payloadWithCharts`），门早于它就等于闪一下没读完的字，故取 200ms 晚于它；`saveBusyTimer(setShow)` 的 `arm()` 重复调用只算一次（连按会让进度话提前上屏，把"200ms 内不说话"这条判据打穿），`cancel()` 只清自己那个 timer；注释里另留一条：另存为挑路径那一段必须**撤门**（原生对话框可以挂几分钟，留着一句「正在保存…」就是说谎）。**v0.70 多收一枚 `saveDoneTimer(setStatus)`**（`show(notes)` / `cancel()`）：那两枚 1500/5000 原本写在 `SheetEditor` 的 `doneClearRef` 里，而 PDF 头要用同一个形状 ⇒ 两份就是两把尺子（A3a/A3b 判"收尾时长与收尾句的时钟只此一处持有"）；同一轮把门值那句注释补齐——PDF 三头实测（11/161/1161ms，v0.70）也落在同一枚 200 上：大件有 ~940ms 可看，前两档由同一枚门拦着不闪，而这一路**没有 ≥18ms 的同步块**，所以门什么时候挂都来得及（与表格头"必须晚于同步块"是两种脾气，同一个数）；**v0.71 两处泛化**——`saveDoneText(notes, base = '已保存')` 与 `show(notes, base?)`：`base` 是**动作的名字**不是函数的名字，同一个写手既服务「保存」也服务「导出 docx」，句子得由按下的那个动作给（否则导出那一路说「已保存（docx）」而标签其实没存，A11b/A11c + M8）；门值那段注释补上第三档（文档 `.docx`/`.odt` 原地整趟 30~92ms、写自身 6~62ms、longtask 0 条 ⇒ 这一头连门都不挂），并把 `cancel()` 的第二个用途写清：**失败那一路也要撤**，否则上一句会把这一句按掉（真机连按两次量到后一句只活 504ms，改后 1504ms）；**v0.72 是这一层的第七次"文案与时钟只写一处"，也是它第一次被搬进一个原本没有它的头**——演示头此前自持三枚裸时钟（存盘 1500 / 导出 pptx 2000 / 导出 PDF 1500），本轮三枚并成同一份 `saveDoneTimer`，于是**导出 pptx 那句的停留从 2000 变成 1500**（两把尺子并一把必然有一把变短，这是买到的东西不是副作用）；`base` 在这一头同时服务三个动作（`已保存` / `已导出 pptx` / `已导出 PDF`），dev 腿 D5a~c 判的就是"直调 `exportPdfTo` 之后屏上是「已导出 PDF」而**不是**「已保存」，且标签的 ● 不清"；门值那段注释再补第四档（演示 `.opd` 三档 2/60/150 页整趟 **5 / 8~9 / 13~14ms**、`longtask` 0 条 ⇒ 这一头同样连门都不挂，`SAVE_BUSY_MS` 在这一路根本没有调用点）；**v0.73 是这一层第一次被"明确不接"**——`.odoc` 那 30 秒的定时自动保存共用 `failStatus` 而不共用 `saveDoneTimer`，因为这一层的契约是"一句收尾的话停留 1500/5000ms"，而定时那一路的句子是**最近一次结果**、要挂到下一次结果出来为止（真机量到失败那句活 40417ms）：给它套收尾时钟等于亲手把屏上恢复成那句过期的「已自动保存」，也就是本轮要修的那个缺陷本身（A5b + 变异 M8 钉"自动保存切片里不许出现 `saveDoneTimer`/`done.`"，M18 钉"也不许做成一枚裸时钟"——两枚一起把这一格的契约钉住：**共用文案，不共用停留**）；**v0.75 是这一层第二次被那条定时路明确不接**——新立的 `lib/auto-save.ts` 只吃 `lib/fail-msg.ts` 那一层，A30b 把"新模块不许去吃这枚收尾时钟"钉成判据、A14/A24 把"两头都不挂进度门"钉成判据
  lib/open.ts         路径→标签 打开 / 带确认关闭
  lib/open-prefetch.ts 开标签那一刻就把表格的读件 IPC 发出去（v0.67，纯模块、零 React 零 DOM，所以 Node 可直测）：`prefetchWorkbook(path)` 发一次并留在途字典、`takeWorkbook(path)` **取走即失效**（载荷是几 MB 的对象图，留着就是第二份账而编辑器只要它一次；拿不到就交回 null 让挂载点自己发，**不假设外壳一定先跑**）、`dropWorkbook(path)` 给 `closeTab` 撤账（别让一叠没人要的字节挂在图上）；`keyOf` 按「反斜杠→正斜杠 + 忽略大小写」归一（Windows 的路径写法不止一种，argv 与文件对话框给的分隔符不同，不归一就会让 prefetch 命中不了）；`p.catch(() => {})` **只挡 unhandled rejection 不吞失败**——原样的 rejection 留给真正的读者，由它按 v0.64 那一层说人话（真机冒烟 S6/S7/S8 判的就是这条通道没把归因绕过去）；注释里留着那条把串行归因说死的实测：**发出 `invoke` 后立刻占住主线程 200ms，那次请求在 Resource Timing 里的起点仍是发出那一刻** ⇒ 串行不是 WebView2 的脾气，是发得太晚；只服务表格这一头（PDF 读字节后还要按区间补读，先把整叠字节取回来正好与那条闸门相反；文档/演示慢的是随后的解析而不是读）**⇒ v0.68 改口：现在是两条通道、三条规矩只写一处**——`put/take/drop` 泛化成 `<T>`，`workbooks`／`pdfs` 各一张表，本轮新增的是调用点而不是第四第五道规矩；PDF 这一头预取的不是整叠字节而是 `preparePdfSource` 那**一次决定**（所以那条"与闸门相反"的顾虑由闸门自己持有而不由这一层猜），表格那头省的是排队的大头（首开 1550→1300ms 一档）而 PDF 这头按发布包 5 趟中位只省 26~70ms（首屏真读的只有 64KB 或几 MB 整本的那一次），另有一条实测留给下一轮：`read_range` 的**累计**耗时在改后涨到 3~4 倍而枚数不变（92/92）、末次出门更早 ⇒ 那是并行度上去了不是活变多；文档/演示照旧不进这一路
  lib/sync.ts         最近文件端到端加密同步（WebCrypto PBKDF2-SHA256 → AES-256-GCM，.oosync 信封）
  lib/update.ts       自动更新的**检测 + 下载 + 安装三拍**（v0.45 出检测层，v0.82 出后两拍；这一层是**唯一持有这条链路的文件**，只有 Home 引它）：`checkForUpdate()` 动态导入 updater 插件走一次 `check`，任何失败都收敛成 `{state:'failed'}` 不往外抛（抛出去的表现就是"点了没反应"）；`describeError` 按插件 error.rs 的真实字面把"源上没清单/没配端点/非 https/缺本平台条目/签名/base64/日期/连不上"归成中文，**下载与安装那四支（`signature verification failed` / `not allowed. permissions associated` / `download request failed` / `called before`）是 v0.82 实测来的字面**，认不出的一律原样带出不编原因；`infoOf` 从 `rawJson` 里取自定义字段 `download_page`，只认 http(s) 才给按钮；**`available` 那一支必须带着 `Update` 对象走**（S2b/M13——不带它就下不动，而这是这一路最容易悄悄断的一格）；`progressLine(received, total|null)` 的节流单位是**整数百分比**（实测一趟 32~41 枚分块事件，同句原样返回 ⇒ 界面那头的 `setState` 自己退出；没有包体大小时说的是「已下载 X MiB（更新源未给出包体大小）」而不是猜一个百分数）；`downloadUpdate` 逐枚累加 `Progress.chunkLength`（实测其和**正好等于**包体大小）、**不碰 `Finished` 的 payload**（那一枚在两趟里分别给出 0 与 1 枚 `Finished`，所以事件枚数与它是否出现都不作判据）；`installBlock(dirtyCount)` 是「装」前面那道闸的**唯一一句话**、返回 null 才许往下走，它是纯函数而不是内联 if——这句话必须排在 `install()` **之前**（Windows 那一拍以 `std::process::exit(0)` 收尾，进了里面再报错就没人听见）；`installUpdate` 显式写出 `restartAfterInstall:true`（成功在 Windows 上不返回，所以 `{state:'launched'}` 记的是"命令发出去了"而不是"界面还在"）；`closeUpdate` 是重新检查前放内存的那把手（实测宿主工作集 68→78→68 MiB）
  lib/fail-msg.ts     用户可见失败的**唯一**归因处（v0.64，纯函数、零 DOM、Node 直测）：`describeFailure` 走一张按"具体在前"排的 12 条判据表（第三方库专属词形 → `os error N` 通用尾巴；**v0.65 补的是 pdf-lib 那一档**——`is encrypted`/`EncryptedPDFError` 说的是"标注与页面管理这层走 pdf-lib，而它不解密 ⇒ 只能看、不能在这里改"，与 pdf.js 那一档"设了口令"分得清清楚楚，后者跟着改口成「刚在密码面板上按了取消，或这一趟没能问到密码」并告诉用户 ↻ 会再问一次——从前那句只能说"没有输密码的地方"，现在真的问过了），`probeOf` 把 `Error` 的 `name` 也拼进匹配串并整串转小写（pdf.js 那类只靠 `name` 分类的档才有得匹配、大写 EOCD 与大写不命中是同一条判据的两面）；三种出法按去处分——`failText`（只出一句中文，给状态栏里那些本就很窄的账目位）、`failDialog`（中文一句 + `（原始信息：…）`，归因没命中时**不重复**原话，同一段话出现两次只会让人以为有两个不同的原因）、`failStatus`（可见那一行是 `prefix: 中文`，换行后挂原话）；`statusText`/`statusTip` 是那枚字符串的两把拆刀，于是"悬停能看原话"不必再多一份状态、也就多不出"文字说 A 而悬停出 B"的分叉；`failRaw` 只给原话（`isTeardown` 用它分辨"关标签拆掉的 transport"与"文件真读不出"）；判据表里每一条命中的都是**真机上量出来的原串**而不是"通常长这样"，表头的注释记着两条实测结论（本机 Windows 那一层已经是中文 ⇒ 真正看不懂的只有第三方库那几档；**路径过长报的是 `os error 3`** 而不是专门的"文件名太长"⇒ 那一句话必须把"太长"也带上）；`known` 那一位的用处是"干净文案一条都不归因"——没有失败就不许造句子，结构腿 D 段判的就是这一条；**v0.73 只多一处调用点而没多一条判据**——`.odoc` 那 30 秒自动保存的 `prefix` 是「自动保存失败」而不是「保存失败」（A1a 钉前缀、M4 钉"不许退回空 catch"），归因表一个字没改：只读那一档的原串（`failed to open file at path: …` + `os error 5`）v0.64 就在表里了，这一轮只是那条中文第一次说给"没有按下任何键"的用户听（定时器自己写盘、自己失败）
  components/         Home（最近文件 + 从模板新建画廊 + 版本号与"检查更新"；**v0.82 在这一头多了 `dl` 那台四态机**
                      `idle/downloading/downloaded/installing` 与**两拍两枚按键**——「下载更新」在 `idle`、
                      「装上并重启」**只在 `downloaded`**（S10b：入口的出现本身就是第二道闸），在途那一枚是
                      **禁用**的「下载中…」而不是"取消"（JS 侧没有 abort 通道，不许诺兑现不了的事）；
                      拒绝那句走 `dl.note` 而不是内联文案（S3h/M17：Home 里不许自己再写一句，否则那句话有两份），
                      闸读的是 `useApp.getState().tabs.filter((t) => t.dirty).length`（前置实测④：回首页仍读得到
                      工作区的脏账，不需要编辑器挂着）；重新检查先 `closeUpdate(上一份)` 再问（把下载占的内存还回去）；
                      **代价记着**：Home 与 Workspace 互斥挂载 ⇒ 切走再回来 `update`/`dl` 两份 state 一起丢，
                      已下好的那 10 MiB 白下（dev 腿 D18 量成形状） / Workspace / SheetEditor（保存按 .xlsx/.ods/.csv 三分流，打开时把读到的规则经门面放回界面并把两侧账目显示在状态栏；**「页面设置」面板（v0.52）**——纸张/方向、六条边距（毫米）、缩放与"缩放到 N 页宽"、六个开关、打印区域与重复标题行列（可「用当前选区」「用选区首行/首列」按门面选区给）、手动分页符（按 Excel 的 `brk@id` 说法：这一行/列自己起新页）、页眉页脚三框 + 六枚格式码 + 奇/偶/首页三版 + **两枚缺省开着的开关（「页眉页脚随文档缩放」「与页边距对齐」，v0.55：勾着＝写 `null` 不声明、取消＝写 `false`，旁注一次说清哪一档我们照 Excel 乘了字号、哪一档两边差一圈）**；「确定」写进 `printRef` 侧通道、「清除这张表的设置」把它整个删掉、面板里的错把确定灰掉，做不到的那几条以账目形式随草稿说在面板上（v0.53 改了语气：页高档与居中已经接线，只剩起始页码真做不到；v0.54 之后偶数页那一版也不再是账——它真的印在偶数页上，面板这几句全部转述 `hfAndPageNumberNotes` 那一份文案）；**导出这一侧多了一段实测循环（v0.53）**——计划里勾了「缩放到 N 页高」或「上下居中」的表才走：建一次 → `measurePrintLayout` 离屏量 → `planSheetFit` 压档/算留白 → 带 `zooms` 重建，最多五趟，定档后把居中留白写回**同一份 DOM** 再交导出；账目分两头记（"压到 27%"那句要说在压它的那一趟、每张表占一格由后趟覆盖前趟，居中的账反过来只在最终缩放那份实测上算数）；DEV 门面钩子随这轮加 `printSet(表名, 载荷|null)`（落笔处＝面板「确定」那一行）与 `printHtml(zooms)`（把**将要上纸的那份 HTML**交出去，让脚本自己挂起来量真实布局）；**v0.57 工作簿默认字体走第三枚侧通道 `defaultFontRef`**（不放 Univer 快照——`IWorkbookData.defaultStyle` 在 core 里零读取、引擎兜回硬编码 Arial 11，而 `wb.save().defaultFont` 实测恒为 `null`）：加载时挂上 `dump.defaultFont`、换标签复位、在 `payloadWithCharts` 那一枚漏斗里回贴，于是存盘与导出 PDF 共吃一份而界面渲染不说谎；**v0.59 只把 DEV 钩子摊宽**（生产行为一个字没动）：`printHtml()` 的返回值多三枚——`defaultFont`（侧通道里那一层本体，冒烟据此分辨"文件说的"与"我们兜的"）、每张计划里的 `basePx`（计划算出的正文底数）、`baseVars`（那份 HTML 里所有 `--oof-print-base-size:<px>` 的含值列表，按张核）；**v0.60 添第四枚侧通道 `sheetFormatRef`**（按表名持有 `SheetFormat`，与前三枚同一脾气：加载时从 `sheets[].sheetFormat` 挂上、换标签复位、改名随 `migrateSheetName` 一起迁、在 `payloadWithCharts` 的漏斗里回贴，且 `if (f && !sheet.sheetFormat)`——快照自己说出来的那一张永远赢）；这一枚与 `defaultFontRef` 方向相反：`IWorksheetData.defaultRowHeight` 在 Univer 里是**活口**（喂了就界面认、而 Excel 根本不认它），所以这里**只收不放**——不喂编辑器也不喂纸面，只为存盘时原样落回；DEV 钩子 `printPlan()` 因此多一枚 `sheetFormats`，冒烟据此问得出"这一层交回了什么"，而结构测试那头的钉是"五个消费点里 `sheetFormat` 出现零次"；**v0.62 只撤两行**——`hasSide` 那枚判定与「ODS 暂不含批注与超链接」那句账目，因为 `.ods` 这两样现在真读得回也写得出，而另三句 ODS 账（图表／三类规则／页面设置）与 CSV 那句照旧立着（结构腿判的就是"撤干净了且只撤了这一句"）；**v0.63 只动两行**——`.ods` 那一路的 `await writeOds(...)` 改成 `writeNotes.push(...(await writeOds(path, payload)))`，于是写侧的账与 xlsx 那头走同一条汇合（`[...lost, ...writeNotes]` → 状态栏 `已保存（第一条，另有 N 条说明）`），另一行是把注释里的例子换成"规则摆不进 OOXML、批注落在被盖住的格上"；拼句的公式、`lost` 那三句 ODS 账与 CSV 那句一个字没动（本轮没有新桥：`sheet-cell-side.ts` 的取与放早就是格式无关的）；**v0.67 只动两行**——挂载点那一句 `readXlsx(tab.path)` 换成 `takeWorkbook(tab.path) ?? readXlsx(tab.path)`（这一趟的 IPC 早在外壳开标签那一刻就发出去了，这里只是把它取来用；取不到——不是从路径开的、或已被别处取走——才自己发一次，**不假设外壳一定先跑**），另一行是那条注释改口（它还写着 v0.35 的"先把 IPC 发出去，实例同时在造"，而现在发得比挂载更早）；dev 下 `React.StrictMode` 的双挂载会让第一趟消费掉 prefetch 而第二趟走自备那一路，于是**开发模式开一次表格标签读到两次件**（真机 S5 量到 `read_xlsx` 的条目 2→4）——这是 dev 独占的形状不是缺陷，判据钉的是"取在前、发在后"那个 `??` 顺序而不是"只发一次"，反过来为 dev 好看而阻塞第二趟就是拿生产行为换开发控制台；**v0.69 存盘那一段开始说话**——`busy.arm()` 排在 `wb.save()` **之前**（那是同步块的头，门晚一纳秒都量不到它）、`await pickSaveFile` 之前 `busy.cancel()` 之后取完路径再 `busy.arm()`（另存为挑路径可以挂几分钟，那句「正在保存…」留着就是说谎）、`setStatus(saveDoneText(notes))` 排在把成功交回那一路而 `finally` 里再撤一次门、失败那一句走 `failStatus(e, '保存失败')` **把「正在保存…」原地换掉**（不清就等于让用户以为还在写盘，原话照旧留在悬停里）；收尾那句的清除定时器 `doneClearRef` 挂在存盘最开头，于是同一个标签补跑的那一趟会**先把上一趟的「已保存」撤掉**（不撤的话第二趟还在写而屏上已经写着"已保存"，那是这一轮最像成功的错）；接线只有 `busy` 那三行与 `saveTab` 那两行，句子与时钟一律在 `lib/save-status.ts` / DocEditor（页面设置含分栏/页码格式、分页参考线、分页符、表格与图片上下文工具条、粘贴成图、查找替换面板、字体族·字号、缩进工具条与 Ctrl+]/[、上下标 X²/X₂、表格上下文条的底纹色与竖排对齐（上/中/下）、脚注/尾注（工具栏插入 + 文末分区编辑与定位/删除，打印时文本框换静态块）、版本历史·自动保存、模板 seed、状态栏字数节流；打开 .docx 保真导入优先、mammoth 兜底，保存按 .odoc/.odt/.docx 各自格式原地落盘；**v0.71 把这一头分成两层**——
  **写手** `writeDocxTo`/`writeOdtTo`（只 `prosemirrorTo*Bytes` → `writeBytes` → `markRecent`，不碰 store、不发句子，
  DEV 冒烟钩子指向它们，判据 D7c/D7d 钉"写手自己不说那句话、不替标签记账"）与**动作** `saveOdoc`/`exportAs`
  （各自决定说什么、记不记账、失败走哪张面孔）：改前的形状是句子挂在写手身上，于是**文件真写进去了、说了「已保存（docx）」、
  标签的 ● 却还挂着**（A/B R0a/R0b：`dots 1→1` 且成功那句与 ● 同屏 1 拍 ⇒ 界面自相矛盾 + 关窗口给假未保存询问），
  现在落盘成功后由动作 `renameTab(tab.id, baseName(path), path)`（内含 `dirty:false`）记这笔账、`done.show([])` 说「已保存」；
  **导出那一路不记账**（另拷一份出去 ≠ 标签已存，A14 + M9），说的是「已导出 docx/odt」（同一枚 `base` 参数）；
  存盘失败上状态栏（`failStatus(e,'保存失败')` + 原话进悬停，R2b/R2c/R2d：弹窗 `0→0`、● 从头挂到尾 R2e），
  **导出失败仍走弹窗**（A6c 钉这一条边界，本轮没动它）；这一头**不挂进度门**（实测整趟 30~92ms，A8a/A8b + M5），
  只接收尾时钟，且 `saveOdoc` 开头与 catch 里各 `done.cancel()` 一次（A7 + M4）——`.odoc` 那一路的「落盘→记账→说话」不变（R4 两支持平）；
  **v0.73 动的是同一文件里另一条不经过这两层的路**——30 秒的 `.odoc` 定时自动保存（它走自己的 `writeText` + `markDirty(false)`，
  所以 v0.71 那两层管不到它）：改前的形状是 `catch {}` 把错整个吞掉，于是只读件上屏上**只挂着上一轮那句已经不真的
  「已自动保存 16:11:20」**（release 对照件整窗 0~70333ms 文本集只有一个值，而同一窗里 `write_text_file` 出门两枚
  `s=29802`/`s=59801`、一次没落盘、● 全程 1；冷开只读件更是一个字都没有 `["∅"]`），本轮把 `catch` 换成
  `setStatus(failStatus(e, '自动保存失败'))`（原话进悬停，A1a/A2a）、成功那一路**只撤自己那一句**（`autoStatusRef` 存着
  自己写上去的那串，`setStatus((cur) => cur === mine ? '' : cur)`，所以手动存盘的「已保存」不归它抹，A4a/A4b/A4c + M5/M6
  ——v0.65 那条"迟到一趟不许抹活着一趟"在定时这一路的形状）、失败不置 `markDirty`/`setAutoSavedAt`（A3a/A3b + M2/M3，
  ● 留 1 且下一枚 30 秒仍重试）；**这一路不挂进度门也不共用 `saveDoneTimer`**（A5a/A5b + M7/M8），理由不是"懒得接"而是
  实测那一句失败要活到下一次结果出来为止（实验件里活了 **40417ms** 到整窗末拍 70331ms），1500ms 的收尾恰好会把它抹回
  那句过期的成功宣称 ⇒ 本轮修的缺陷会换个速度复发；60 秒那一路自动快照与那四枚裸时钟本轮一个字没动（A8d/A8e 是回归判据）；**v0.74 同一文件的 30 秒那一路改吃 `runExclusive(tab.id, …)`**——把 v0.73 那四条规则（不脏就跳过、`markDirty`/`setAutoSavedAt` 排在 `writeText` 之后同一 try 内、成功只撤自己那一句、失败走 `failStatus`）整段塞进回调，其余一字未改；改前的形状是这一路直接调 `writeText` 而**绕过 `running`/`again`**，真机三趟全重现"定时器刚把 `write_text_file` 送出门、同一毫秒手动 Ctrl+S 又发一枚"（v0.69 那枚在途锁本来就管着 `saveTab`，可它管不到不走 `saveTab` 的这一路），两枚 `std::fs::write` 竞写同一路径而赢家接近对半——屏上「已保存」说了、文件里那半句新打的字被旧快照盖掉；本轮修的不是"存盘慢"而是"存错"）；**v0.75 把这一路的"隔多久再来一枚"交给账**——`setInterval(…, 30_000)` 换成自续的 `setTimeout`（一枚固定周期的 interval 装不下一个会翻倍的下一次），延迟由 `autoDelayMs(auto.fails)` 给且**必须是那一枚调用的尾参**（A8a）、跑完再挂下一枚且卸载后不再挂（A8b），失败走 `auto.noteFailure()` + `autoFailStatus(e, auto.fails, autoDelayMs(auto.fails))`（次数与"X 秒后自动重试"都在句子里，A10a/A10b/A10c：组件不再自己抄那份文案），成功走 `auto.noteSuccess()` 且那一格的悬停换成 `autoOkTip(auto)`（A16——v0.73 量到 `title` 是空的），账挂在 `useRef` 上 ⇒ 每枚标签一份（A34）；v0.73 那四条规矩（不脏跳过、只在写成功之后记账、只撤自己那句、失败上状态栏且仍自然重试）与 v0.74 那把 `runExclusive` 一个字没动（A11/A12/A13 是回归判据，M13/M14/M15/M19 是它们的负控制），**锁忙跳过那一趟不进退避的账**（`fn` 根本没跑，"没跑"与"跑坏了"分开记）；手动存盘那一路成功之后现在做两件事——`auto.clearBackoff()` 把退避归零 **并且** `autoRescheduleRef.current?.()` 撤掉在途的那一枚重挂（A15/A35 + M7/M23：**只归零账不重挂是不够的**，账只管下一枚延迟，而已经排出去的那枚最坏还要再等 240 秒；实测 E5b 再编辑之后 28870ms 就落盘，不重挂那一路要等 ≈218 秒），而手动那一趟不算进自动保存的次数账）；**v0.76 把这一路撤句的凭据从"来源"换成"路径"**——`autoStatusRef`（只记自己那句）换成
  `saveFailRef = useRef<FailureClaim | null>(null)`（句子 + 它说的是哪个文件），定时成功后走
  `const stale = staleFailureClaim(saveFailRef.current, p)` → 非空则**先**清自己的账**再**按身份撤（D2a/D2b/D2c + M2：
  顺序反了会拿已经清空的账去比，做成裸 `setStatus('')` 会抹掉活着一趟）；手动 `saveOdoc` 那一路同步改三处——
  `let target: string | undefined` 声明在 `try` **之前**（D3c：写在里面就活不到 `catch`，那句失败又说不清自己说的是哪个文件）、
  路径定下来之后 `target = path`（D3d）、失败登记 `{ msg, path: target ?? '' }`（D3a + M3）、成功清掉这份认领（D3e）；
  **本轮裁决手动那一趟失败既不归零退避也不重挂时钟**（D4a/D4b + M8/M9——失败就是"此刻仍写不上"的证据，
  拿它当"用户在动"就把刚建立的退避抵消了；真机 E3b 量到手动失败 @213795 之后下一枚自动写仍排在 236509ms 之后）；
  v0.73 那四条与 v0.74/v0.75 那两层接线一字未动（D4c/D4d/D5a/D5b/D5c 是回归判据）；**v0.77 在这一头把"什么时候允许再试"多开一个入口**
  ——30 秒那一路的整段写动作抽成一份 `attempt()`（脏检查、`runExclusive`、`noteAttempt`、那两句话、按路径的撤句认领全在里面），
  定时那一枚与焦点探写**共用同一份**，于是本轮新增的不是第二条链路而只是第二个入口；焦点那一路的接线是三行：
  `onFocusBack(() => { if (stopped || !auto.canProbe()) return; void attempt().then(() => autoRescheduleRef.current?.()) })`
  ——**跑完走 `autoRescheduleRef` 那一刀而不是自持一枚时钟**（F3e + M7：探写自己 `setTimeout` 就报；真机 E3d 判的是
  对照件那枚 `w2+120s` 的时钟位在实验件上为空），`canProbe` 在下界之内直接 return（连锁都不去抢，F3d + M6），
  卸载时 `offFocus()` 收回监听（F3g + M9：只挂不收＝这一枚标签关掉之后每次切窗口都还去点那一枚已经不存在的账）；
  **手动那一路一个字没动**（F5a/F5b + M13：成功仍只是 `clearBackoff` + 重挂，而它不登记 `noteAttempt`——
  那一趟不是自动这一路的敲门账）；60 秒那一路自动快照与那四枚裸时钟照旧没动 / PptEditor（放映 / 逐条入场与出场 / 自动换页计时 / 母版与备注 / 演讲者窗口；`save(asNew)` 走 `.opd`（`writeText` + `serializeDeck`），`.pptx` 与无路径都先经 `pickSaveFile` 挑成 `.opd`；**v0.72 存盘那一路有失败可说了**——改前的形状是「成功自己写『已保存』＋自持一枚裸 1500，失败只弹阻塞式 `#32770` 而状态栏全程 `[null]`」（release 对照件实测：只读件按 Ctrl+S 之后 `文本拍=[null]`、写请求确实出过门 440+7ms、弹窗 前=0 后=1），本轮把 `catch` 换成 `setStatus(failStatus(e, '保存失败'))`（原话留悬停，v0.64 那层第一次覆盖到这一头）、把三枚裸时钟 1500/2000/1500 并成模块那一份 `saveDoneTimer`（A3a/A3b + M1/M6，代价是导出 pptx 那句由 2000 变 1500），开跑与失败各 `done.cancel()` 一次（A4b/A6b：连按两次时第一趟的裸 1500 会把第二趟那句提前抹掉，改前第二句只活 **489/496ms**、改后 **1501/1506ms**）；导出那两路吃 `base` 而不改口（`已导出 pptx` / `已导出 PDF`，A10a~c + M7），**但它们的失败仍走原生弹窗、`setStatus('正在生成 PDF…')` 那一路一字未动**（A11a/b/c + M8 是边界判据，本轮没顺手统一）；按实测这一头**不挂进度门**（三档 2/60/150 页整趟 5 / 8~9 / 13~14ms、`longtask` 0 条，A1a/A1b + M5），也没有搬 v0.71 那套"写手／动作"分层——`save`/`exportPptx`/`exportPdfTo` 三处各自直接写，**没有共用写手的形状**，硬抽一层就是为不存在的问题建层（这是本轮唯一的架构决定）；**v0.74 给这一头新加了 `.opd` 的 30 秒定时自动保存**——形状与 DocEditor 那一路一字对齐（不脏就跳过、`markDirty`/`setAutoSavedAt` 排在 `writeText` 之后同一 try 内、成功只撤自己那一句、失败走 `failStatus`、整段塞进 `runExclusive(tab.id, …)`），另加两处这一头独有的接线：① 用 `deckRef` 把 `deck` 存进 ref，effect 依赖里只留 `tab.id`／`tab.path`／`s.dirty` 那几枚而**不吃 `deck` 本体**——否则每一次编辑都会重建定时器；② 成功那一路额外补一句 `dirtyRef.current = false`——`edit()` 有个既有优化"只在第一次编辑时 `markDirty(true)`"而**从来没被复位过**（手动 `save()` 也不清它），于是"改一次 → 清 → 改第二次"这一路 `s.dirty` 恒 false，这一路自己得能在下一次 30 秒里被认成脏；本轮只补了**定时成功那一路**的这一份复位，`PptEditor.save()` 手存之后仍没清（路线图挂着
——**⇒ v0.78 改口：补的那一份没有成为长期方案，整道闸连同那一句 `dirtyRef.current = false` 一起删除**，
因为它在 release 上量到的是"手存成功之后 ● 不亮 + 定时的写不再发 + 晚打的字面永远不落盘"，见 v0.78 那一节）。状态栏多两层的渲染（`{!status && autoSavedAt && <span>已自动保存 X</span>}`），与 DocEditor 的 v0.73 同形状——非空的失败句会把过期的成功宣称挤掉）；**v0.75 这一头吃的是同一份账而不是第二份规矩**——30 秒那一路同样换成自续 `setTimeout` 且尾参是 `autoDelayMs(auto.fails)`（A18a/A18b + M10），失败句带「第 N 次」与「X 秒后自动重试」（A21 + M12），成功那句的悬停同样换成 `autoOkTip(auto)`（A26），手动 `save()` 成功后同样做两件事（A25/A36 + M22/M24——**"不许只落在一家"由 A28/A28b 与这一族变异一起钉**），`dirtyRef.current = false`（v0.74 那一条）与 `deckRef` 那两处独有接线原样留着（A22/A23 + M11；
  **⇒ v0.78 起这一头只剩 `deckRef` 那一处独有接线**，另一处的判据换成"不再有这枚 ref 而 `s.markDirty(tab.id, false)` 仍在清"），**v0.76 这一头吃的是同一条认领关系而不是第二份判据**——`autoStatusRef` 同样换成 `saveFailRef: FailureClaim | null`、
  定时成功按 `staleFailureClaim(saveFailRef.current, p)` 取句再按身份撤（P1a~P2c + M7：把这条判据退回"自己有没有句就撤"就报 P1c/P2a/P4d），
手动 `save()` 同样把 `target` 提到 `try` 之外、失败登记它写的那个路径、成功清掉认领（P3a~P3d），
  **取句 → 清账 → 撤句**那一串的顺序也钉成判据（P4d）；A/B 与 dev 两腿本轮都只在 `.odoc` 上跑（`.opd` 的同一格只由结构腿 P1a~P4d 管，
  没量到的档不写成结论）；**v0.77 这一头照做焦点探写，形状与文档那一头一字不差**（`attempt()` 抽成一份、
  `onFocusBack` + `auto.canProbe()` 那道门、跑完 `autoRescheduleRef.current?.()` 重挂、卸载 `offFocus()` 收回，
  F4a~F4g 七枚判据，其中 F4e 钉的是这一头独有的 `dirtyRef.current = false` 没被这次重构弄丢（**⇒ v0.78 改口：那一处独有复位随整道闸一起删除，
  判据换成 A3a「不再有这枚 ref 而 `s.markDirty(tab.id, false)` 仍在清」**）、M14~M17 四枚变异
  分别判"只补了文档头""演示头探写没接""演示头探写自持时钟""那一处独有复位被顺手删掉"，其中**v0.77 的那枚 M17** 随那一处独有复位一并作废
  ——本轮变异编号重排，v0.78 的 M17 是"registry 的在途锁不再拦第二趟"，两枚不是同一件事）；
  而这一头的焦点探写**真机同样没跑过**（本轮 A/B 与 dev 两腿都在 `.odoc` 上）⇒ `.opd` 现在有两格只吃接线证据，
  下一轮补那一趟时把 v0.76 的按路径认领与这一格一起量掉——**⇒ v0.78 把这两格都量掉了**：expC 那一臂在 `.opd` 只读件上真跑焦点探写
  （focus @72094 → 探写 @[72094]，**Δ 0ms**，判据是"探写排在 30 秒下限之后"而不是枚数），同一臂量按路径认领
  （探写落定 72103ms 之后那句过期失败最长只挂 **4ms**＝一枚采样间隔），dev 腿的 D5 段同形另有 **11ms** 那一格；
  而"手存之后再编辑 ● 该不该亮"这一档也是 v0.78 的 ctrlA/expA 两臂第一次给出真机数字（拆闸前 ● 起不来、90 秒窗内写枚数 = 0、
  晚打的 `_a2` 不在盘上；拆闸后 ● 回得来、写全表 `[452/5, 30461/6]`、`_a2` 真落盘）；**v0.79 只挪了一句的位置**——
`edit()` 里那句 `markDirty(tab.id, true)` 从 `setDeck` 的 updater 体内提到 `setDeck(…)` 语句之后（dev 前置实测：改前一枚按键
把 `markDirty` 换来 2 次调用而其中一枚跑在渲染阶段（`basicStateReducer ← updateReducerImpl ← Object.useState`）、React 为此
在 DEV 报"渲染 PptEditor 时更新了 Workspace"；改后 1 次、栈是 `edit ← editSlide ← onChange ← executeDispatch`，告警 0 条），
updater 里从此只剩 `fn(next)` 与 `return next`——**副作用不许住在 updater 里**，因为它被调几次、在哪个阶段被调由不得我们
（eager state / 并发渲染 / StrictMode 三条路径都能动它）；判据侧的两枚量具账记在这里：`S2a` 全仓扫"有没有头往 updater 里写脏值"
时 `setTimeout(() => { … })` 与 React 的 updater **文本同形**（要 `NOT_AN_UPDATER` 黑名单排除），而 `S2d`「`renameTab` 仍把标签归到不脏」
一度是**判据空转**（整文件找 `dirty: false` 会被 `openTab` 里那枚同名键顶住 ⇒ 改成按 `renameTab:` 切块，起点取**最后一枚**，
因为 `State` 接口在 `store.ts:32` 先声明了一次同名键）——这一枚由变异 M7 抓出）/ PdfViewer（pdfjs-dist 懒加载，连续多页视口虚拟渲染+Ctrl 缩放+TextLayer 文字选择+全文搜索+缩略图/大纲/标注侧栏+高亮便签与矩形·椭圆·直线·手绘形状（绘制/导入/写回 pdf-lib）+标注编辑（点选/拖移/改色/删除）+「页面」工作区旋转/删除/提取/合并/拆分；≥4MB 走分段读（lib/pdf-range.ts），卸载时 destroy openTask 并 abort transport；**v0.64 四个编辑器与首页的失败出口一律改走 `lib/fail-msg.ts`**——状态栏那一行由 `{status}` 直出换成 `statusText(status)` + `title={statusTip(status)}`（四个渲染点各一处，`PptEditor` 的加载占位有两处分身所以两处都换），原生对话框那一层的 `String(e)` 换成 `failDialog(e)`，账目位里的 `${e instanceof Error ? e.message : String(e)}` 换成 `failText(e)`；`PdfViewer` 除接线外还立了两条行为——三处后台补做（页尺寸／大纲／标注）由"只 `console.error`"改成**先过 `isTeardown` 那道门再占状态栏**（拆标签时的 `Transport destroyed` 不入账，否则每次快速关标签都冒一句凭空的失败），`pageOp` 的定时清除从 `finally` 移到成功那一路（失败那一句留着，三秒就抹等于让用户读不完也悬停不到原话）；**v0.65 加密 PDF 的密码闸门**——`openTask.onPassword` 装在 `await openTask.promise` **之前**（装晚了那份承诺已经拒绝，回调再挂也来不及），回调只做三件事：把 `updatePassword` 存进 `pwdUpdateRef`、把"第几回问"记进 `pwdAttemptRef`、亮面板（判据与文案一律走 `lib/pdf-password.ts`，组件里只负责亮与接线，句子一处都不写）；**闸门绝不自动投密码**（自动投等于替用户猜，结构腿 C2 判这一条）、空串不当密码（喂进去只换来一次重新提问）、取消时**先**记 `pwdCancelledRef` **再**把闸门按下去（错误内容分不出"用户取消"与"没给密码"，这一位只能界面自己留着），于是那一行不带"失败"也不挂原始信息；工具条的 ↻ 是**从第 1 回重新数起**并把取消标记一起清掉（不清的话重试成功后第一次真失败会被归成"用户自己取消的"）；`type=password` 且密码不回显、不在界面上；owner-only 那一件**不问密码**就能看（用户口令为空）而页面级操作当场报得出 pdf-lib 那一句；同一轮补的是一条规矩而不是一处补丁——**「这一趟已经作废」那道门必须打在写任何共享状态之前**，开发模式的双挂载下晚到的 `catch` 会抹掉还活着的那一趟刚亮起来的面板，pdf.js 从此等不到回话，表现是卡在「正在加载…」且没有任何错误（C17/C18 各钉住本轮撞到的两处写点，另外那三句账目仍在，本轮没有新的拆接线）；**v0.66 搜索这一趟改由界面自己记着"在扫"**——查询一变化就标 `scanning:{scanned:0,total}` 并把上一词的命中与激活位**在同一处**清掉（防抖那 200ms 里界面不许回到「无匹配」，也不许拿旧词的第 3 条说新词的事），扫页循环里按 `shouldPublish` 交进度（`setMatches` 与 `setFindStatus` 同交，一句里不许半新半旧），收尾那一句先过作废门再把 `scanning` 清掉；**v0.65 那条"门打在写任何共享状态之前"在这里再兑现一次**：`seq !== searchSeq.current || !aliveRef.current` 那道门排在 `await loadPageText(...)` **之后**、任何 `setState`/ref 写入**之前**（排在 await 之前拦不住晚到的那一趟，排在最后一句就晚了），`aliveRef` 在 setup 里置回 `true`，于是开发模式 `React.StrictMode` 的第二次挂载不被当成已卸载——真机量到换词 1.2s 起那一格的文本零变化（被作废的那趟没能把界面抹回旧样子）；句子一律走 `lib/pdf-search.ts`，组件里不留「无匹配」「正在搜索」的字面（B2/B10 判这一条，而 B10 吃的是剥掉注释之后的源文）；`textPages` 这枚 DEV 钩子由本轮的临时归因**转正为常备观测量**——"扫完全程"只能硬判缓存枚数，把判据建在那句文案上就等于建在实现上；**v0.68 只动两行**——加载那一路的 `await createRangeTransport(path)` 换成 `const src = (await takePdf(path)) ?? (await preparePdfSource(path))`（外壳已在开标签那一刻把那次决定连同要读的字节发出去了，这里只是取来用；取不到就自己发，**不假设外壳一定先跑**），随后 `getDocument` 按 `src.mode` 分支，于是这一层**不再自己判闸门**（V1/V2/V4 钉的就是这三件事）；另一行是那条注释改口（它还写着"大文件只喂文件头、小的整本读"的选法，而现在选法在 `preparePdfSource` 那一处）。次序上有一条诚实的代价：自备那一路的读现在排在 `if (disposed) return` **之前**（闸门单一持有的后果），而**"写共享状态之前那道门"的位置一个字没动**（V3，v0.65 那条规矩在这里继续成立——`rangeModeRef.current = src.mode === 'range'` 仍排在门之后）；**v0.70 Ctrl+S 那一路开始说话**——`registerSaver` 里那一个 `async` 函数从"只 `await writeAnnosTo(path)`"变成「撤上一句收尾 → 挂进度门 → 写 → 撤门 + `done.show([])`，catch 里 `setStatus(failStatus(e, '保存失败'))`」，句子与时钟一律在 `lib/save-status.ts`（A5/A6/A7 判这三句的次序与去处），而**三句挂在 saver 层不挂进 `writeAnnosTo`**（那一函数与工具条的 `pageOp` 共用，写进去就是两头发话：A8 + 变异 M5；`pageOp` 原有的「旋转…」与失败句一个字没动：A9 + M6）。改前的形状是 `writeAnnosTo` 从不 catch 而 `registry.drain` 的 `catch {}` 把抛错咽了下去 ⇒ **只读件按 Ctrl+S 之后屏上连一句失败都没有**，成功那一路也只有 `markDirty(false)` 而没有「已保存」——本轮补的就是这一格（release A/B 里 R1/R6e 判改前那支的静默，R6a~R6d 判改后这一路说出口的每句话）**。**v0.80 只在这一头的两处 pdf-lib 调用上各加一个参数**——`writeAnnosTo` 里 `PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: PDF_OBJECTS_PER_TICK })` 与 `pdoc.save({ addDefaultPage: false, objectsPerTick: PDF_OBJECTS_PER_TICK })`，两者都从 `../lib/pdf-ticks` 取而不在这层写字面量（S1a/S1c/M9 钉这一条）；这一层**没有**新增时钟、没有搬 worker、句子与三道门（撤收尾 → 挂进度门 → 撤门）一个字没动，只是它等的东西变短了：实测按键→写出门 1030ms → 148~172ms，于是那句 `SAVE_BUSY_MS=200` 的「正在保存…」在这件上不再有机会上屏（v0.70 那一节里"进度句可看 940ms"说的是它的**第一次也是唯一一次**兑现）；顺带量到一条**既有缺陷**并已开进路线图而**本轮未修**：标注读侧那一路（`setAnnos`，逐页扫 `/Annots`）还没扫完就按 Ctrl+S，写回去的那一份会把 40 枚注解**整片抹掉**而屏上照旧「已保存」（早退那一趟：按下时页龄 594 / 1447ms ⇒ 两支落盘都是 `annos: 0`、哈希同为 `ca72e8c365681d03`）——要的是"未就绪不许写"那道闸，与让出粒度不是同一件事；**v0.81 就是那道闸，而这本账的形状有三格都不是可选项**——① 它记「**哪一份 doc 已经整片读完**」而不是「哪一份在读」（`const [annosRead, setAnnosRead] = useState<PDFDocumentProxy | null>(null)` + 渲染期镜像 `annosReadRef`，闸门读镜像）：初值为空所以挂载后第一件事就是没读全，于是"doc 还没来 / 正在逐页扫 / 读到一半失败 / reload 换出新 doc"四种情形统一落在同一句拒绝里；记"在读"的那一版实测挡不住第一段（`pre5.log`：24 枚按下时布尔账是 `false` ⇒ 40→0）。② **它是状态而不是直接写 ref**：`setAnnosRead(doc)` 与合并那一句在同一批更新里 ⇒ 门开的那一刻内存已经是整片；直接写 ref 的那一版由 dev 腿自证 `FAIL Q3 … :: {"内存":0,"读全":true}` 与 `MEASURE P1 开账那一拍 {"t":48514,"n":0,"writable":true}` / 后一拍 `{"t":48550,"n":40}` ⇒ **中间约一枚 rAF（36ms）里闸门开着而写回读到空片**（S1a 钉 `useState`、S1e 钉镜像紧跟声明不许搬进 effect）。③ **闸门只有一处**（`writeAnnosTo` 函数头、`const list = annosRef.current` **之前**；`if (!d || annosReadRef.current !== d) throw new Error('标注还没读全，…')`），Ctrl+S 那一路与工具条的页面操作**都只共吃它**、由自己现成的 catch 说这一句（S2d 钉整句文案全前端一处，M12 钉"页面操作自己再立一道闸"是违例）。另外两条是同一本账的纪律：**读到一半失败故意不记账**（S5b；代价写进路线图——写回会被一直拒到重新打开，这一头没有"重试导入"那一路）、**全仓不许销账**（S4 零枚 `setAnnosRead(null)`；换 doc 时旧账自然不认新 doc，而销账等于把门开回 v0.80，M10 响）。收尾同时从整片替换改成 `setAnnos((cur) => [...out, ...cur])`（前置实测 ADD1b：`40` 而不是 `41`，终值会把用户在窗口里刚画的那枚替掉），S3a 钉"合并紧跟记账"、M11 钉"两句之间夹进别的语句＝拆成两批提交"也响；`annosWritable`（两半都判，`null` doc 也算不许写）是这一格的 DEV 取反面，release 上没有这一枚观测量；**v0.83 补的是那本账的代价而不是那道闸**——记账按身份、失败不记账、全仓不销账三条一个字没动（S5a/S11d 复钉），新增的是"拒绝之后这一头有把手"：逐页扫那一路从 effect 里提成具名 `readAnnos(d, announce)` 而不是第二份实现（effect 只剩 `if (doc) readAnnos(doc)`，两份实现会分叉；S1a~S1c 钉），幂等门 `annosReadRef.current === d` 直接借 v0.81 那本按身份记的账（不立它实测会把文件那几枚各收第二遍，pre2 的 `4 → 7`；M1 拆它就响），在途门 `annosRunRef = {doc, cancelled}` 收放都按身份、而**收它是全仓唯一的注销动作**（S3a~S3e；M2 拆在途门、M3 收账不看身份、M18 闸门排在登记之后就响）；把手「↻ 重试导入标注」只在 `sideTab === 'annos'` 且 `annosPending`（`doc !== null && annosRead !== doc`，读**状态**而不是 ref——渲染期要跟着变，闸门那一边才读 ref；M10）时出现、且只走共用的 `btn()` 不自己写一枚（S8a~S8e；M8 把手常驻、M9 自带 markup 就响），点它调的是同一个 `readAnnos(doc, true)`；失败那句带上页号（`读到第 N 页`——页号在 catch 那一刻本来就知道，`let page` 跟着循环走、页号为 0 兜底成不带页号那句；S4a~S4d/M4）；成功那句只在重试那一路说（`if (announce)`——自动那一路成功时界面本来没什么可宣布，M7/M13 钉它静默且不许长出定时器）——这一句挂在**状态栏** ⇒ 它是 **release 可见**的取反面，补的正是上一句 `annosWritable` 是 DEV-only 那一格；`docProxy`（DEV 块内、全仓一处）是量具的唯一注入口（S12a~S12c 钉它不许泄漏到 release）；**明写不做的两条**：不做排队补做（M16 响 S10c）、不做按页部分写回（那要拆掉「宁可拒也不抹」的整片前提）；**实测边界一条**：重跑只治**瞬时**失败——确定性坏结构那一件（b12：pdf.js 数 4 页而 pdf-lib 认 3 页）按多少趟把手门也不会开，这一头要的仍是"重新打开"，把手在那一刻只会再说一次同一句拒绝；**v0.84 只补一句进行中的话**——`readAnnos` 在 `announce` 那一路开跑前先说「正在重新导入标注…」（重跑那几秒不再挂着上一趟的「读取失败」装没事；首趟不说话，加载期有「正在加载…」顶着；结构腿钉它只此一句、位置在登记之后与失败句之前、挂着卫兵），把手在重跑在途仍可按 = 静默 no-op（**v0.85 改口：禁用已补**——「在途」翻成 `annosScanning` 状态（useState），登记那一拍无条件置真、`finally` 里清与 ref 收回同吃一枚身份卫兵（被换掉的旧趟不得抹掉活趟的「在途」）、把手第三参吃它走共用 `btn()` 的禁用外观；在途门一个字没动，全仓 `setAnnosScanning` 恰好三处）
scripts/              copy-pdfjs-assets.mjs（dev/build 前复制 cmaps/标准字体到 public/pdfjs） /
                      updater-release.mjs（发版：开 createUpdaterArtifacts 本机建签名包 → 读回真 .sig 与产物 →
                      出带三平台键的 latest.json → 打印要上传的清单；私钥只走子进程环境变量，`pnpm release:updater`）
.github/workflows/    release.yml——tag v* 触发只打 Linux（1× 计费）；Windows（2×）与 cargo test 改手动 dispatch 勾选
```

表格文件流：`xlsx/ods 磁盘 → Rust(calamine 值 + xlsx/ods 各自 zip/quick-xml 直解样式·合并·尺寸·字族·隐藏·冻结·公式·图表·三类规则) → JSON 快照 → Univer 渲染（图表经 VChart 出 PNG 浮动图片，筛选/数据验证/条件格式经门面放回）`；**这一趟的读件请求在 shell 的 `openTab` 那一刻就出门**（v0.67：不等编辑器的 chunk 取完并求值，release 上 `read_xlsx` 的起点从起进程后 850ms 提前到 470ms，而那次读件本身 235→229ms 没变 ⇒ 省的是排队不是 Rust 变快；gating 按 `kind === 'sheet'` 而不是按后缀，所以 `.ods`／`.csv` 同走这一条在途通道——它们本来吃的是同一枚 `read_xlsx` 命令、由 Rust 那头按后缀分流），CSV 走 `csv.rs` 状态机（UTF-8/GBK 自动）→ 单表载荷；保存按扩展名分流——`.xlsx` 经 `rust_xlsxwriter`（含原生图表部件与三类规则的 OOXML 落盘，带回写侧账目）、`.ods` 经 `ods.rs` 生成 ODF 包（v0.63 起同样带回写侧账目：这一趟摆不下的批注与链接要说得出地址）、`.csv` 经 `csv.rs` 写 BOM + CRLF 文本（只存首表）。**存盘那一段现在会说话，同一个标签不再并发写**（v0.69：Rust 一个字没动，改的是前端那一层）——release 上量出的完整一趟是「取快照 + 拼载荷」115~131ms（主线程同步块，IPC 还没出门）+ `write_xlsx` 自身 471ms 中位（改前 505，同一枚 IPC 面量的两端）+ 落定，小件整趟 11~18ms、中件 45~46ms、大件 590ms，于是 200ms 那道门只让大件那一档开口（改前这一整段界面一个字都不说，用户在两次「已保存」之间什么也看不见）；而连按两次 Ctrl+S 在改前**两趟全部重叠**（`write_xlsx_sync` 是一次 `std::fs::write`，跑在不同 blocking 线程上写同一路径，谁后落地没有保证 ⇒ 表现是"后按的那次改动可能没进文件"这种数据回退），现在 `registry.saveTab` 按 `tabId` 记在途、只留一个"还要再存"的位，补的那一趟走同一个 `save()` 因而**重新取快照**（真机 x69d1/2/3 量到新页眉字面 `&LX69M*` 真在 zip 的 worksheet 部件里，第二枚在第一枚落定后 124~136ms 出门），既不排队（早先的中间态不该多落一次盘）也不丢弃（最后一次按键的改动必须进文件）。
文档文件流：`docx → lib/docx-fidelity.ts 直读 OOXML（w:rPr/w:pPr 直接格式 + numbering 层级 + 表格合并 + 图片 + 批注 + sectPr 页面设置）→ HTML/元数据 → TipTap`，
保真导入器抛错或拆不出块时回退 `mammoth 正文 + zip 直读页眉页脚/批注/sectPr`（v0.37）；`.odt` 走 `lib/odt.ts` 双向；
保存按标签扩展名分流——新建文档存 `.odoc` JSON（含 meta）、`.odt` 与 `.docx` 标签各自格式原地写回（导出走 docx/odt 链路）。
**这一头的存盘现在按层说话**（v0.71：Rust 一个字没动）——写手只写字节（`writeDocxTo`/`writeOdtTo`），动作负责句子与账
（原地保存成功后 `renameTab` 记 `dirty:false` 再说「已保存」；改前是"文件写了、话说「已保存（docx）」、● 还挂着"，
A/B 的 R0b 量到成功那句与 ● 同屏；只读件的失败改前**状态栏全程 [null]**、只有一枚阻塞式 `#32770`，现在走
`failStatus` 上状态栏而原话留悬停、且不再新立弹窗）；这一头的完整一趟实测 **30~92ms**（写自身 6~62ms、longtask 0 条）
⇒ **不挂 200ms 那道门**（说了就是一闪的噪音，A8a/A8b），只接 `lib/save-status.ts` 那一份收尾时钟；
导出那一路吃同一个时钟的另一个 `base`（「已导出 docx」）而**不替标签记已存的账**；
**另有一条不经过这两层的定时路**（v0.73）：`.odoc` 每 30 秒看一次标签的 ●，脏了才自己 `writeText` 写回并清账——
改前那一路的 `catch {}` 把错整个吞掉，于是**屏上只挂着上一轮那句已经不真的「已自动保存 16:11:20」**（release 对照件：只读件整窗
0~70333ms 文本集只有一个值，而同一窗里两枚 `write_text_file` 出过门、一次没落盘、● 全程 1；冷开只读件更是全程 `["∅"]`），
现在失败走 `setStatus(failStatus(e, '自动保存失败'))`（原话进悬停）、成功那一路**只撤自己写上去的那一句**
（`cur === mine` 才撤，手动存盘的「已保存」不归它管），而这一路**既不挂进度门也不共用那枚 1500ms 收尾时钟**——
它的句子是"最近一次结果"、实测要挂到下一次结果出来为止（失败那句活了 **40417ms**），抹掉它就等于把屏幕上那句过期的成功宣称放回去；
写自身仍 5~8ms、`longtask` 0 条 ⇒ 本轮没有让这一路变快，只是它现在说的是哪一次结果）；**v0.74 让这一路的写与手动 Ctrl+S 抢同一把锁**——30 秒那一路以前直接调 `writeText` 而**绕过 `registry.running`/`again`**，真机三趟全重现"定时器刚把 `write_text_file` 送出门、同一毫秒手动按 Ctrl+S 又发一枚"（v0.69 那枚在途锁管着 `saveTab`，可它管不到不走 `saveTab` 的这一路），两枚 `std::fs::write` 竞写同一路径而赢家接近对半——屏上「已保存」说了、文件里那半句新打的字被旧快照盖掉；本轮修的不是"存盘慢"而是"存错"：定时那一路整段包进 `runExclusive(tab.id, fn)`（与 `saveTab` 共用 `running` 与 `again`），锁忙 ⇒ **跳过本趟**（手动那趟的快照本来就更新，30 秒后下一趟再来），锁闲时 `fn` 跑完若 `again` 被置位（用户在锁在途期间按了 Ctrl+S），交给 `drain` 补跑让手动的句子与 fresh 快照最终落地。句子仍不归这一层（v0.69 那条"锁只管锁、saver 自己说给用户"在这一路继续成立）——`runExclusive` 只保证不与手动抢同一格
**⇒ v0.75 改的是这一路"隔多久再来一枚"与"那句话说的是第几回"**：前置实测把一枚只读件挂 4 分钟的账量清楚了——
`write_text_file` 出门 **8 枚**、间隔逐枚 30.0 秒（漂移 ≤9ms）、每枚自身只有 5~14ms、一次都没落盘，
而界面对"敲了几回"一个字都不报（v0.73 只补了"失败要不要说话"）；于是 `setInterval` 换成自续的 `setTimeout`
（interval 装不下会翻倍的下一次），延迟由新建的 `lib/auto-save.ts` 那一份**按标签持有的账**给
（`autoDelayMs(fails) = min(30_000 * 2**fails, 240_000)`，实测同一个 240 秒窗由 8 枚降到 3 枚：30/90/210 秒；
**不做成"连续失败就停"**——权限改回来也再也存不上），失败那句多带「第 N 次」与「X 秒后自动重试」、
成功那句的悬停第一次有会话账（「成功 N 次 · 失败 M 次 · X 秒后再检查」）；**退避换来的代价是"解开权限之后还要等下一枚"**
（封顶那一枚 240 秒），所以手动存盘成功那一路做两件事：`clearBackoff()` 归零账 **加上** 撤掉在途那一枚重挂
（真机 E5b：再编辑之后 28870ms 就落盘，只归零账不重挂要等 ≈218 秒），而手动那一趟不算进这一路的次数账；
这一路仍不挂进度门、不共用收尾时钟（v0.73 那一刀，A14/A24/A30b 钉着）
**⇒ v0.76 改口：撤句的凭据从"这句是我写的"换成"这句话说的是哪个文件"**——上面那句"只撤自己写上去的那一句"
留下了一个当时看不到的洞：**手动 Ctrl+S 在同一枚文件上写失败的句子不属于这一路，于是它永远撤不掉**。
对照件（0.75）实测：权限改回来之后下一枚退避时钟真的把文件存上了（`write_text_file` @450335+10、字面在盘上、● 归 0），
而那句「保存失败」仍从 213961ms 挂到整窗末拍 470959ms（**过期 20614ms**），
同一窗里「已自动保存」**一次都没上屏**——它挂在 `!status` 之后，堵死它的正是那句过期宣称；
现在两边的失败句都登记成 `FailureClaim { msg, path }`，定时成功后按路径认领、按身份撤（实验件 **71ms** 就换成了
「已自动保存 00:43:03」+ 悬停会话账）。同一轮量到的另一条裁决写在这里：**手动那一趟失败不归零退避、也不重挂时钟**
（D4a/D4b + M8/M9）——失败就是"此刻仍写不上"的证据，拿它当"用户在动"就把刚建立的退避抵消了
（真机 E3b：手动失败 @213795 之后下一枚自动写仍排在 236509ms 之后）；
而"权限解开了能不能立刻探一次"这一路**在页面里没有可用信号**（实测只有 `blur`，`focus` 与 `visibilitychange` 从不触发），
要做得先走 Rust 的窗口焦点事件，本轮 Rust 一个字没动
**⇒ v0.77：这一路做了，而且 Rust 仍一个字没动**。DOM 那一层确实没有信号（那句裁决对它量过的那一层成立），
但窗口事件那一层有——`lib/auto-save.ts` 添 `onFocusBack(fn)`（订 `getCurrentWindow().onFocusChanged`，
只有 `e.payload` 为真才回调，订阅迟到时补一次取消 ⇒ StrictMode 双挂载不留第二路监听），账本添 `lastAttemptAt` /
`noteAttempt()` / `canProbe()`（**探写节流下界 = `AUTO_BASE_MS = 30_000`**，实测人能敲出来的最快 focus 是 3535ms 一枚）；
`DocEditor`/`PptEditor` 把原来的写动作抽成一份 `attempt()`，**定时那一枚与焦点探写共用同一份**（同一把 `runExclusive` 锁、
同一套句子、同一份按路径的撤句认领、同一本退避账），探写跑完仍走 `autoRescheduleRef` 那一刀重挂
⇒ **焦点这一路不造第二枚时钟**（真机 E3d：对照件那枚 `w2+120s` 的时钟位在实验件上是空的）。
买到的那一格：只读件挂到退避封顶、用户把权限改回来再切回窗口——对照件（0.76）**解权→落盘 225336ms**（等自己那枚封顶时钟），
实验件（0.77）**32945ms 且那全是"焦点回来"所花的时间**（focus @257554 ⇒ 写 @257554、Δ0ms，字面独立读盘确认真在、
「已自动保存 10:07:05」在落定之后 13ms 上屏、● 归 0、那句过期失败落定之后 0 拍），而**两臂总写枚数 4 vs 4**（探写不加戏）
演示文件流：`pptx → JSZip 解包 OOXML → Deck 模型 → 编辑器`；保存为 `.opd` JSON 或经 pptxgenjs 导出 pptx。**存盘那一段现在遇到失败会开口**（v0.72：`save()` 的 `catch` 换成 `setStatus(failStatus(e,'保存失败'))` 而原话留在悬停 `title`，改前只有一枚阻塞式 `#32770` 而状态栏全程空白；只读件那一路 ● 仍留 1，失败不许把账记成已存）；三枚裸 `setTimeout`（保存、导出 pptx、导出 PDF 的收尾）收进 `lib/save-status.ts` 的同一枚 `saveDoneTimer`，导出那两路各吃自己的 `base`（「已导出 pptx」「已导出 PDF」）而**不替标签记已存的账**；这一头按实测**不挂进度门**（`.opd` 三档 2/60/150 页整趟 5~14ms、`write_text_file` 自身 6~8ms、longtask 0 条 ⇒ 说了就是一闪的噪音）；**v0.74 补上了这一头原本没有的 30 秒定时自动保存**（全仓 grep `setInterval` 时这一头根本没有：只有 `DocEditor` 的 30 秒 + 60 秒快照 + `Presenter` 的 1 秒显示计时）——形状与文档那一头的 v0.73 一字对齐、整段包进 `runExclusive(tab.id, fn)` 与手存共享同一把锁，另加两处这一头独有：`deckRef`（effect 不吃 `deck` 本体，否则每次编辑重建定时器）与 `dirtyRef.current = false` 在定时成功那一路补一句（`edit()` 有个既有优化"只在第一次编辑时 `markDirty(true)`"而从来没被复位，手存那一路本轮没动，见路线图）——**⇒ v0.78 这一处独有接线只剩 `deckRef`：那道闸连同两份复位一起删除，去重归 `store.markDirty` 那一层**（量出来它买的东西是重复的而代价是"手存成功之后整条编辑链断电"，见 v0.78 那一节）；状态栏多一层 `{!status && autoSavedAt && <span>已自动保存 X</span>}`，非空失败句会挤掉过期成功宣称。**v0.75 这一头与文档那一头共吃同一份账**（新建 `lib/auto-save.ts`：退避延迟、连续失败次数、会话总账与那两句话一律走同一模块，两头各拿一份按标签持有的账本实例）——30 秒的 `setInterval` 同样换成自续 `setTimeout`、尾参由 `autoDelayMs(auto.fails)` 给（A18a/A18b + M10），失败那句带「第 N 次」与「X 秒后自动重试」，成功那句的悬停带会话账，手动 `save()` 成功后同样做两件事（归零退避 + 撤掉在途那一枚重挂，A25/A36 + M22/M24）；A28/A28b 那一族判据把"这套规矩不许只落在一家"钉住。**v0.76 这一头同样换成按路径的认领**（`saveFailRef: FailureClaim | null`、`staleFailureClaim(saveFailRef.current, p)`、手动 `save()` 的失败句登记它写的那个路径、成功清掉；P1a~P4d 十五枚判据吃的全是接线）。真机那两位数字——落定之后那句失败只活 **206ms**（dev 腿）、下一拍就上「已自动保存」——量的是 `.odoc` 那一头，`.opd` 的这一格本轮 A/B 与 dev 两腿都没跑，只有结构证据，没量到的不写成结论（**⇒ v0.78 补上了那一趟：`.opd` 只读件上落定之后过期失败最长挂 4ms（A/B expC）/ 11ms（dev D5 段）**）。**v0.77 同一头照做焦点探写**（`attempt()` 抽成一份、`onFocusBack` + `canProbe`、跑完走 `autoRescheduleRef` 重挂，F4a~F4g 七枚接线判据，含这一头独有的 `dirtyRef.current = false` 仍在成功里），而这一头的焦点探写**真机同样没跑过**——本轮 A/B 与 dev 两腿都还在 `.odoc` 上，于是 `.opd` 现在有两格只吃接线证据（v0.76 的按路径认领 + v0.77 的焦点探写），下一轮补那一趟时要把两格一起量掉。**⇒ v0.78 把这两格都量掉了**：expC 臂在 `.opd` 只读件上跑焦点探写（focus @72094 → 探写 @[72094]，Δ **0ms**，判据是"排在 30 秒下限之后"而不是枚数），同一臂量按路径撤句；而那一处独有的复位随整道闸删除，v0.77 的 F4e 与当时那枚 M17 一并作废（本轮编号重排后 M17 说的是 registry 那把锁），取而代之的是 A3a「不再有 `dirtyRef` 而 `s.markDirty(tab.id, false)` 仍在清」。

**⇒ v0.79 这一头只剩一句的位置**：`edit()` 里那句 `markDirty(tab.id, true)` 不再待在 `setDeck` 的 updater 里面
（改前一枚按键换来 **2 次**调用，其中那一枚的栈是 `basicStateReducer ← updateReducerImpl ← Object.useState`＝渲染阶段，
React 为此在 DEV 报「Cannot update a component (Workspace) while rendering a different component (PptEditor)」；
改后 **1 次**、整条栈到 `executeDispatch` 为止都在事件处理器里，告警 0 条），理由是 updater 按契约是纯函数、
它被调几次在哪个阶段被调由不得我们，而"这一枚标签脏了"写的是**全局 store**。本轮 release A/B 读到的是**持平**
（两臂的 ● / 定时落盘 / 手动 / 再编辑四格逐格相同，写自身 ctrl `[5.7, 7, 14.7]` vs exp `[7.1, 4, 6.2]`ms）——
**这一格在 release 上没有可观测面，实验证据只能由 dev 腿给**（与 v0.77 那条"不脏就不写只有 release 能判"正好反过来），
见 v0.79 那一节。

PDF 文件流：查看 `pdf 磁盘 → 小于 4MB 整本 readBytes / 大于 4MB 经 file_len + read_range 分段喂给 pdf.js（首屏只取 64KB 文件头）→ pdfjs-dist（worker + canvas）；**这"首屏该怎么读"的一次决定连同要读的那一点字节，也在 shell 的 `openTab` 那一刻就出门**（v0.68：闸门由 `preparePdfSource` 单一持有，预取的因此不是整叠字节而是 `{mode:'range'|'bytes'}` 那两种形状之一；发布包 5 趟中位——改前每趟排在 PdfViewer 的 chunk 备好之后 17~24ms 才出门、改后每趟提前到它之前 4~10ms，首画 632→579／778→708／992→966ms，而那一次读自身耗时没动（10→9／40→39／3→4ms）⇒ 省的仍是排队；分段件的 `read_range` 枚数两头都是 92 ⇒ 这条通道不新增读，只是提前已有的那几枚）`；设了打开密码的那一档由界面上的密码面板拦住（v0.65：`openTask.onPassword` 装在 `await openTask.promise` 之前，闸门只把用户按键交回的那一串投进去，密码只留在这次会话的内存里、不写盘）；全文搜索 `逐页 getTextContent 的页文本缓存（loadPageText，跨查询共用——换一个词重扫只需 234ms，而第一次冷扫 700 页要 1.9~2.4s，钱在 pdf.js 的逐页往返上、每页的 toLowerCase+indexOf 全场只花 5ms，并行取页实测只省 1.3× 故不做）→ 串行扫全程、命中上限 500（撞到就说「500+」不说总数），而**"这一趟在不在扫"由界面自己记着**（v0.66：查询一变化就标 `scanning`，进度按 `shouldPublish` 的时间窗与新命中数交，「无匹配」只有扫完全程才说得出）；四档文案与那两条节流判据都在 lib/pdf-search.ts，Rust 不参与这一趟` ；标注 `选区高亮/便签/拖拽画的矩形·椭圆·直线·手绘 → 内存模型（rects[0] 包围盒 + polys 几何）→ Ctrl+S 时 pdf-lib 低层写 Annotation 字典回原文件`（**存盘那一段现在会说话**，v0.70：release 上 12/300/2300 页三档的整趟是 11/143~161/1071~1161ms，而 `write_file` 自身只有 4~95ms ⇒ 钱在 pdf-lib 的 load+save 而不是写盘那一步；同一枚 `SAVE_BUSY_MS=200` 的门只让大件那一档开口（进度句可看 940ms、中件 164ms 差一口气不闪），成功补上「已保存」、失败补上 `failStatus(e,'保存失败')` 而原话留在悬停里——改前三句都没有，因为 `writeAnnosTo` 从不 catch 而 `registry.drain` 的 `catch {}` 把抛错咽了下去；三句挂在 `registerSaver` 那一层不挂进与工具条共用的 `writeAnnosTo`，收尾时钟与表格头共用 `lib/save-status.ts` 那一份。另外两头按实测**不接**：文档整趟 ≤122ms、演示 ≤45ms，接了就是闪，而它们本来就各自说着「已保存（docx）」「已保存」（A12a/A12b 把"没接"钉成判据）**⇒ v0.71 改口：文档头量完并接了收尾时钟与失败句，就是不接进度门**（实测整趟 30~92ms），演示头照旧**⇒ v0.72 改口：演示头也接上了，同样是只接收尾时钟与失败句、不接进度门**（实测三档整趟 5~14ms）**⇒ v0.80 改口：大件那一档的等待已经归因并拆掉，那句话因此不再上屏**（归因的形状是"等"而不是"忙"：那 ~1030ms 里 pdf-lib 每处理 `objectsPerTick` 枚对象就 `waitForTick()` 让出一个宏任务（`setTimeout(…, 0)`，Chromium 对嵌套零延迟钳到 ≥4ms），dev 打点量到 `loadSyncOnly=0 / loadAwaitOnly=236`、`saveSyncOnly=0 / saveAwaitOnly=750`、页内 `longtask=[]`、`mainThreadShare ≤10.9%`（含 CDP 轮询，是上界），件里 `objects=4764` 在库默认 100/50 下要让出 **142 枚**、实测每枚 ~6.6ms；让出粒度定在 `PDF_OBJECTS_PER_TICK = 1500`（`lib/pdf-ticks.ts` 一处持有，两处 `load` 与四处 `save` 共吃，产物字节五档同一份）之后，release 实测按键→写出门 **1024/1028/1034 → 148/172/153ms**、写自身 [15,15,18]→[19,19,18]ms（Rust 一字未动）、两支写出去的字节同一份 `d46fd9db95ae3c0d`，实验件三趟 Δ 全部落在 `SAVE_BUSY_MS=200` 之下 ⇒ 那句「正在保存…」不再上屏（对照件每趟 217~219ms 上屏并活 819/818/828ms）；句子、三道门与 `writeAnnosTo` 的接线一个字没动——本轮改的只有"等多久"。**⇒ v0.81 改口：这一头的写现在先问一句「这一份 doc 读完了吗」**——`writeAnnosTo` 函数头
（取内存那份列表之前）立着**唯一一道闸** `if (!d || annosReadRef.current !== d) throw new Error('标注还没读全，…')`，
它比的那本账记的是「**哪一份 doc 已经整片读完**」（按 doc 身份、`useState` 持有、与合并那一句同批提交、失败不记账、
全仓不销账），于是"doc 还没来 / 正在逐页扫 / 读到一半失败 / reload 换出新 doc"四种情形统一被拒而**不再写坏文件**；
导入收尾同时从整片替换改成把窗口内刚画的那枚**并**进来。release 实测（两支真 exe × 3 趟 / 49 通过 / 真失败 0）：
按下落盘枚数 ctrl `[0,0,0]` vs exp `[40,40,40]`（对照件那一刻内存是空片、文件被抹成 `annos:0`、哈希
`2bde644fbf70e6 → 9bea7c532a843e`），实验件那一按**没改文件**而屏上说的是「保存失败: 标注还没读全…」；
落定之后两支都把 40 枚写回、第二次落盘哈希同为 `bc482236284a04` ⇒ 正常那一路一个字没改坏。代价与余账写在路线图
（导入失败后没有"重试导入"那一路；页面操作当场失败而不是排队等落定——**v0.83 改口**：前一条已补上（侧栏「标注」页签的「↻ 重试导入标注」把手重跑同一趟 `readAnnos`，闸门那四条形状一个字没动），后一条本轮明写不做、理由在 v0.83 那一节）；**v0.84 改口：重跑在途的那几秒这一头有话了**——`readAnnos` 在 `announce` 那一路开跑前先说一句「正在重新导入标注…」，成功/失败句到点替换（首趟不说话，加载期有「正在加载…」顶着）；重跑仍是整趟从头（就绪账必须整片），2300 页档实测冷趟重跑秒级、暖趟毫秒级，差的是 pdf.js 的页/注解缓存暖度）；四类编辑器的**存盘**那一路现在吃同一份收尾时钟）；文档导出 `@media print 排版（分栏/分页符/避免跨页折断）+ @page margin box 逐页页眉页脚页码 + 打印态纸面调色板（`color-scheme` 压回 light、主题色经变量换掉，v0.49）→ Rust export_pdf（PrintSettings 纸张与四边距；CSS `@page` 也真的说话，所以每条作业自己声明完整，见 v0.50）→ WebView2 PrintToPdf 落盘`；演示导出 `Deck → createRoot 离屏挂载 StaticSlide 分页 → 同上`；表格导出 `Univer 快照 → WorkbookPayload → lib/sheet-print-setup.ts 把那张「页面设置」翻成打印计划（纸面/四边距/缩放/打印区域/重复标题行列/手动分页符/列带/页眉页脚的 @page margin box）→ lib/sheet-print.ts 自绘 HTML 网格 → 同上（canvas 抓不到故走数据侧重排；计划同时喂 PrintToPdf 的 PrintSettings，两条通道同一组数，v0.51。**勾了「缩放到 N 页高」或「上下居中」时这份 HTML 先建后量再重建（v0.53）**——行高不在载荷里（默认行高由字体现算、声明过的只是下限、`zoom` 之后又不线性），只能离屏量真排版（`lib/sheet-print-measure.ts` + `pdfprint.measurePrintLayout`），`fitToPagesTallZoom` 按实测逐带贪心分页压出 1% 一档的缩放、`verticalCenterPadPx` 只在装得下的那一页给上留白，量稳了才把留白写回同一份 DOM 交导出）。**正文与页眉的底数吃同一层**（v0.59）：工作簿默认字体（`xl/styles.xml` 的 `cellXfs[0]→fonts`）一次读进载荷，`baseFontPt` 一处解析，页眉由 `@page` 的 margin box 乘出去、正文落在每张表 `<section>` 的 `--oof-print-base-size` 上被 `td` 的 `font-size` 吃掉，没说话时两处同落 11pt 那一档兜底）`；页面管理 `内存标注先写回 → pdf-lib 旋转/删除/提取/合并/拆分覆盖写回 → 重载并从 /Annots 重新导入标注（旋转页坐标按 /Rotate 经 pdf-geo.ts 换算）`。

自动更新通道（v0.82 起是**三拍而不是检测层**）：`首页按下「检查更新」 → Rust 侧 reqwest 取清单 → `check`
认出 `available` 并把那份 `Update` 对象带在状态里 → 按下「下载更新」 → `download(onProgress)` 把字节取进
**Rust 侧内存**并**在那里验签**（实测 `%TEMP` 零枚新落点、宿主工作集 68→78→68 MiB，`Progress.chunkLength`
逐枚累加正好等于包体大小）→ 下好了这才亮出「装上并重启」 → **两道闸**（① `installBlock(dirtyCount)`：未保存
账不为 0 就返回一句话；② 这一枚按键本身就是"用户明确按下"，没有默认、没有超时）→ `install({restartAfterInstall:true})`，
而 Windows 那一拍以 `std::process::exit(0)` 收尾**。这条链路的三个结构性事实决定了它的形状：**闸只能立在调用之前**
（进了 `install()` 再说拒绝就没人听见），**下载前面不需要闸**（它不写盘、不改应用，立闸只会挡掉"先看看多大"），
**"什么时候才联网"在页面上无从观测**（请求是 Rust 发的，Resource Timing 与 CDP 都看不见 ⇒ 只能由本地源带
Node 毫秒戳的访问日志判，而 `dangerousInsecureTransportProtocol` 只允许出现在构建期注入给测试件的那份配置里，
仓库配置永远说 https）。这一层不轮询、不做假取消（JS 侧无 abort），句子与时序全部在 `lib/update.ts` 一处，
`Home` 只做亮与接线；Rust 侧本轮一个字没动（`.plugin(tauri_plugin_updater::Builder…)` 从 v0.45 起就是插件本体注册，
扩的是 capabilities 那三枚权限）。

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
> 2026-09-23 复核：症状照旧（`Open` 能过、`SaveAs2` 永不返回，写仓库内与 `%TEMP%` 都一样），
> 且被强杀的 Word 会在同目录留下 `~$<文件名>.docx` 孤儿属主文件——**下一次以读写方式 `Open` 会卡在
> "文件正在使用，是否只读打开"的模态框上**，跑 COM 腿前务必先删掉它（只读 `Open` 不受影响）。
> "第三方作者写的件"这一腿因此由手写 Word 形状的 OOXML 夹具顶上（负 id 分隔符条目、条目乱序、
> 表格单元格里的引用、有号没正文），不再等 Word 可写。

## 路线图

- [x] 演示：pptx 母版/背景图还原、演讲者备注
- [x] 演示：动画、演讲者视图（双屏备注独立窗口）
- [x] 演示：元素级动画（逐条入场）与自动换页计时
- [x] 演示：动画映射 PowerPoint 原生 timing 树（元素级跨端保真）
- [x] 演示：动画方向/出场效果补全 + PowerPoint 实机回放回归确认
- [x] 表格：样式（字体/颜色/合并）随 xlsx 往返
- [x] 表格：边框/对齐/数字格式 xlsx 往返 + ODS 读侧样式/合并 + PDF 打印保真
- [x] 表格二期：列宽/行高/字体族 xlsx+ODS 全链路往返（读→Univer→保存→PDF 打印）
- [x] 表格三期：隐藏行列 + 冻结窗格 xlsx+ODS 全链路往返（OOXML/collapse+settings → Univer → 打印跳过）
- [x] 表格四期：公式 xlsx+ODS 全链路往返（`<f>`/of:= 换算 + 缓存值，Univer 引擎重算）
- [x] 表格：图表（VChart 渲染 PNG + Univer 社区浮动图片 + xlsx 原生图表往返，Excel 实机确认）
- [x] 文档：页眉页脚（含 PAGE 页码域）与目录（原生 TOC 域）docx 往返，Word 实机回归
- [x] 文档：批注（锚点标记 + 侧栏面板 + docx comments 往返）
- [x] 文档：ODT 批注往返（office:annotation 读 + 写，docx 那两条老规矩照抄）
- [x] PDF 查看（pdf.js）与文档导出（WebView2 PrintToPdf）
- [x] PDF：表格/演示导出
- [x] ODF（ods/odt）原生格式
- [x] 本地文件关联与"最近项目"跨设备同步（可选、端到端加密）
- [x] 发布工程：CI 矩阵打包（win+linux）与 GitHub Release
- [x] PDF 查看：滚轮翻页（溢出先滚动、触边再翻）+ Ctrl 滚轮缩放
- [x] PDF 查看：文字选择复制（TextLayer 透明字层叠加）
- [x] PDF 查看：全文搜索（命中定位 + Custom Highlight 高亮 + 上下导航）
- [x] PDF 查看：连续多页视图（IntersectionObserver 视口虚拟渲染/离屏释放）
- [x] 性能专项：PDF 位图 LRU 缓存 + 尺寸预取批量化 + 空闲预热编辑器 chunk
- [x] PDF 查看：缩略图 + 大纲（书签）侧栏（双页签虚拟渲染 + getOutline 解析跳页）
- [x] PDF 标注与高亮：选文字加高亮/便签，Ctrl+S 经 pdf-lib 写回原 PDF（读侧导入+往返保真）
- [x] PDF 标注编辑增强：标注工具点选/拖移/改色/删除（含第三方注解）+ Acrobat 风胶囊弹层
- [x] 文档：页面设置（纸张/边距，视图+打印+docx/odt 全链路）+ 分页参考线 + 页数指示
- [x] 文档：表格上下文工具条（行列/合并/表头，gridSpan/vMerge 导出）+ 图片粘贴成图与宽度/居中条
- [x] 文档：查找/替换面板（命中高亮+大小写+单个/全部替换）+ 字体族/字号（docx/odt 往返）
- [x] 文档：自动保存（.odoc 定时静默落盘）+ 会话内版本历史（快照环形栈一键恢复）
- [x] PDF 标注形状：矩形/椭圆/直线/手绘（绘制交互 + Square/Circle/Line/Ink 读侧导入 + pdf-lib 写回保真）
- [x] 首页模板体系：文档/表格/演示 11 个模板一键新建（三编辑器无路径分支各自 seed）+ 查找命中上限截断
- [x] 文档分页保真：`@page` margin box 逐页页眉页脚页码（四格式）+ 多栏排版 + 分页符 + 纸张/四边距贯穿 PrintToPdf（docx/odt 同步往返）
- [x] 表格：CSV 往返（RFC4180 状态机 + UTF-8/GBK 自动 + BOM/CRLF 写回 + 保存三分流）
- [x] PDF 页面管理：旋转/删除/提取/合并/拆分覆盖写回（标注跟随所在页，旋转页坐标按 `/Rotate` 换算）
- [x] 性能：表格命令 async（spawn_blocking）+ 图表网格惰性构建、PDF 位图缓存像素预算、文档字数节流
- [x] 性能二期：大 PDF 分段读取（`file_len`/`read_range` raw IPC + `PDFDataRangeTransport`）+ Univer 首开并行化 + 预热实证边界（更激进的实例级预热实测零收益，已删）
- [x] 性能三期：首开挂载不再走 Suspense（外壳+编辑器自持已解析组件，绕开 ~300ms 兜底节流）+ effect 改 layout + 公式 worker 线程池 A/B 裁决为删
- [x] 文档：docx 保真导入（直接格式/缩进/列表层级/表格合并/图片/批注，mammoth 退为兜底）+ 缩进 schema 与 docx/odt 往返 + Word 实机回归
- [x] 文档保真续项：上下标 `w:vertAlign` + 单元格四边/底纹/竖排对齐 + 表格缩进/段落右缩进 读入，.odoc/docx/odt 三链路回写（Word 16.0 实机 + Word 另存件差分与再读回双向核对）
- [x] 文档保真续项三：段落行距（倍数/固定值/最小值）+ 段前段后 + 底纹与四边 `w:spacing`/`w:shd`/`w:pBdr` 读入，docx/odt 回写（Word 16.0 实机 20 断言 + Word 另存件 OOXML 差分 24 断言）
- [x] 文档保真续项四：脚注/尾注真往返（`note` 内联原子节点 + 编号按文档顺序现算 + OOXML `word/footnotes.xml`·`endnotes.xml` 与 ODF 1.2 内联写法双向（含旧版 `text:note` 外壳）+ 文末脚注区编辑与打印）
- [x] 文档保真续项五：文本框展平（`w:txbxContent` 新旧两种外壳 + ODF `draw:text-box`，位置与环绕不保但字不丢）+ 公式线性化（OMML 与 MathML 翻成同一套 `x^2`/`a/b`/`√(y)`/`∑_i^n`）+ `mc:AlternateContent` 只取一支（Word 16.0 只读腿按 `wdTextFrameStory` 逐句核对）
- [x] 文档保真续项六之一：SmartArt（`diagrams/dataN.xml` 的 DiagramML 数据模型 → 嵌套列表）与图表（`charts/chartN.xml` 的 ChartML 缓存值 → 标题 + 数据表）读回，格内走层级缩进展平，还原不了的记边界
- [x] 文档保真续项六之二：域**编号重算**（`SEQ` 按文档顺序现算并压掉缓存、`\* ROMAN`/`\* roman`/`\* ALPHABETIC`/`\* alphabetic` 四形态按开关自身大小写、`REF` 无缓存时按书签所在段落文本兜底、`PAGE`/`PAGEREF`/`DOCPROPERTY` 沿缓存且无缓存记边界、`fldSimple` 同路、被跳过的目录不占号）+ OLE 嵌入对象预览解不开时留一行看得见的占位（ProgID + 部件文件名，.odoc/docx/odt 三链路都在）
- [x] 文档保真续项六剩下：OLE 嵌入对象的**内容**提取（复合文档 `cfb.ts` + `\x01Ole10Native` 的字段布局与兜底扫描 → 内层 docx 递归展开 / xlsx 与 CSV 取值成表 / txt 分段；两条接缝 docx `w:object` 与 ODT `draw:frame`（内联 base64 与 `Objects/objN/` 两种），块级正文作段落兄弟块、格内压行内，取不出的带真名与大小记边界；**v0.64 那两句"嵌入的 X 解不开"的原串尾巴同样改走 `failText`**（docx 与 xlsx 两路））
- [x] 表格保真五期：筛选 / 数据验证 / 条件格式 **xlsx 全链路往返**（Univer `resources` 双向桥 + 门面放回界面 + OOXML autoFilter/dataValidation/cfRule·dxf·x14 读写，Excel 16.0 实机核对；被筛掉的行喂打印；ODS/CSV 只记边界账不谎称读回）
- [x] 表格保真六期：**PDF 打印保真**（条件格式在打印侧按载荷重算一遍→底色/字色/粗斜/数据条/色阶真上色，六处判据与 Excel 16.0 的 `DisplayFormat` 逐格核对；图表位图按锚点格覆盖进网格并让锚点撑开边界，"图浮在数据块外就整个不见"就此修掉；打印纸面兜白底（外壳的 `var(--bg)` 曾把整页铺成屏幕色）；算不出的一律进状态栏记账）
- [x] 表格保真七期：**批注 / 超链接 xlsx 全链路往返**（批注走 `resources` 的 `SHEET_NOTE_PLUGIN`、链接走每格的富文本 `customRanges`，两头都是纯函数所以**不放命令**；legacy `commentsN.xml` 与 `threadedComments`/`person.xml` 两种写法归一、气泡尺寸与常开从 `vmlDrawing` 认回；作者与悬停提示 Univer 装不下，按格子回贴且界面新写的那枚不冒用别人署名；写侧修掉 rust_xlsxwriter 把 `<authors>` 按名字排序而 `authorId` 按格子序登记的**串署名**缺陷（核对不过宁可不改）；Excel 16.0 只读腿对写侧原产物与应用重存件各跑一遍；ODS/CSV 只记边界账不谎称读回——**这句 v0.62 起改口**：`.ods` 的批注与链接现在双向了（见 ods.rs 的 `read_ods_cell_side`），只剩 CSV 与「ODS 的图表／三类规则／页面设置」还在记边界账）
- [x] 自动更新通道（**检测层**，v0.45）：本机 Ed25519 密钥对签发的清单 + `check` 一次拿版本/说明/日期，
      有新版本就提示并**用浏览器打开下载页**；失败一律归成中文一句（源上没清单/非 https/缺本平台条目/签名不合…），
      认不出来的原样带出不编原因；不做应用内下载与安装，所以不需要先定更新源托管在哪
      （**这句 v0.82 起改口**：应用内下载与安装已经接成两拍、闸立在「装」之前，而**更新源托管仍未定**——
      本轮要的只是"源上真有一份签名清单时这条路走得通"，那由构建期注入的本地 http 源验，不依赖托管决策）
- [x] 自动更新通道（**下载 + 安装层**，v0.82）：`check` 认出 `available` 之后由用户分两拍走——**下载**
      （字节进 Rust 侧内存、按清单验签，实测 `%TEMP` 零枚新落点、宿主工作集 68→78→68 MiB，所以这一拍前面
      **不立闸**）与**装上并重启**（Windows 那一拍以 `std::process::exit(0)` 收尾，所以那句"还有 N 处未保存改动"
      **必须排在调用之前**；第二道闸就是"用户明确按下"这一枚——按钮只在下载完成后出现）；进度按**整数百分比**
      刷（一趟 32~41 枚分块事件，同句原样返回 ⇒ `setState` 自己退出）；三枚权限
      `allow-check/download/install` 而**不给宽口径 `updater:default`**、**不用一步到底的 `downloadAndInstall`**、
      **不做启动后台轮询**、**不做假取消**（JS 侧无 abort）；真机端到端跑过一次真装：一次性目录装出
      `ProductVersion=0.99.0` 的那支、`restartAfterInstall` 真把它拉起、随后自卸（生产目录全程逐格未动）
- [x] 导出保真：**暗色主题的纸面与屏幕脱钩**（漏色有两条独立的路——`color-scheme:dark` 让浏览器把**画布底色**
      涂深而被 PrintToPdf 抓走（这条连 `background:#fff !important` 都压不住），以及主题色以 `var()`/字面量落在
      真元素上；治法是"屏幕色必须先穿过一枚 CSS 变量"+ 一段排在暗色段之后的 `@media print` 调色板，
      内容自己声明的字面色（段落底纹 / 单元格底色 / 幻灯片背景）照旧上纸，查找命中高亮不上纸。
      判据：三链路 × 暗/亮各导一份 PDF，直方图**总变差 0**＝换主题不改纸；文档 96.6%→0.4%、表格 31.6%→0.1%）
- [x] 导出保真：**一张纸只说一次话**（`export_pdf` 的 `page` 契约＝"想要的纸面尺寸"，"竖版边长 + Orientation
      转置"只在 Rust 侧 `page_box()` 换算一次、五步设置失败一律原样报出；**@page 串台**——文档标签常驻 `head`
      的那份 `@page` 会被下一次 PrintToPdf 连 `size` 与页眉页脚一起认走，实测"导完文档再导演示"得到竖版纸
      `540×960`、幻灯片只剩 `0.34` 的一条带，治法是每条覆盖层作业把自己那份 `@page`（纸面 + 四边距 + 十六个
      margin box 复位）说全，而不是禁用别人的样式表；矮纸的 `min-height:900px` 打字区不再把正文顶成凭空一页）
- [x] 表格保真八期：**页面设置 xlsx 全链路往返 + 打印链路真的照着排**（纸张/方向/边距/缩放/网格线与行列标题/奇偶页与首页/页眉页脚三槽/打印区域与重复标题行列（workbook 级 definedName）/手动分页符，读侧七处 + 两条 definedName、写侧 odd 交 crate 其余搭同一趟定点重打包补；Univer 装不下这一层，按表名走侧通道且**保存与导出 PDF 共吃同一份计划**；列带按可印宽度切、一个带一张表、断点语义按实测取"这一行/列自己开始新页"；页眉页脚翻成 `@page` margin box 且 `&A/&P/&N/&D/&F` 真展开；Excel 16.0 只读腿对写侧夹具与应用重存的第三方件各跑一遍，CDP 真机按四页纸的 `MediaBox`/表头重复/半列居中位移逐项核对；ODS/CSV 只记边界账不谎称读回）
- [x] 表格**页面设置的编辑 UI**（v0.52：`src/lib/sheet-print-ui.ts` 供纯函数（毫米↔英寸、八档纸型、
      页眉页脚三槽↔OOXML 串、区域/整跨度↔0 基矩形、断点表、校验与"做不到"的账），`SheetEditor` 的面板
      写进 `printRef` 侧通道并被保存与导出 PDF 共吃；打印区域/重复标题行列「用当前选区」按门面选区给，
      「这一版纸上做不到」的四条账（起始页码、偶数页另版、缩放到 N 页高、垂直居中）在面板上当面说清且随草稿变；
      读侧不再把写侧工具替每张表落下的默认 `<pageMargins>` 当成声明）
- [x] 表格页面设置的打印二期（v0.53）：**缩放到 N 页高**与**垂直居中**接线（先把将要上纸的那份 DOM 在最终缩放之下
      量一遍——行高只能真量：新建的表一条 `rowHeights` 都没有、声明过的又只是下限，长文字那一行会自己撑到几百像素，
      且 CSS `zoom` 之后的行高不是线性折算；于是导出走 `build→measure→rebuild` 最多五趟，页高档按 1% 一档贪心下压，
      判的是「最高的那一个列带」装得下而不是总高，居中把留白写成 `padding-top` 落回量它的那份 DOM）；
      **起始页码**照做不到办——从「能设」降级为「只记账」，面板与状态栏当面说清（`@page` 通道只有一个 counter，
      没有「从 N 接着数」的对应物）；顺带修掉一条写侧缺陷：rust_xlsxwriter 逢 `pageSetup` 必补
      `orientation="portrait"`，面板没碰过方向的表存盘重开后纸面会自己翻了个面，现在按「声明与否」定点擦掉
- [x] 页眉页脚的**偶数页另版**与**首页另版**真上纸（v0.54：`differentOddEven` → `@page:right`/`@page:left`
      （实测这台 WebView2 **不认** `:odd`/`:even`，发出去两页整框空白），`differentFirst` → `@page:first`；
      两条只有真机能教的账——① `@page:first` **只覆盖它自己声明的那几格**，未声明的框会穿透到
      `:right`/基 `@page`（实测首页页眉长出 `L-奇 C-首 R-奇`），故六格里没写到的必须显式 `content:normal` 复位；
      ② v0.51 记的「`:first` 必须排在基 `@page` 之前否则第 2 页起整框消失」**重量后不成立**，两个源序各导一遍
      四页都不缺框，承重的是那枚复位而不是源序（当时的读数把整页文字并成一串读，同 `:odd/:even` 那次误判一个来源）；
      顺带删掉一句说反了的旧账：勾了「首页不同」而首页那一版是空的＝六格全复位＝首页什么都不印（Excel 同义），
      而不是"首页与其余页一样"）
- [x] **起始页码的纸面通道：已说死为"没有"**（v0.54 穷举五种写法——`@page:first{counter-reset:page N-1}`、
      counter 落在基 `@page`、`counter-increment` 改写、margin box 里做加法、不带 counter 的手写串——
      各导一份 PDF 逐页读回，全部仍是 1..N；这台机器的 PrintToPdf 只有一个从 1 开始的页码 counter。
      于是它永久留在"只记账"那一档，且连带一句要说出口：奇偶按**物理页**分，起始页码为偶数时会与 Excel 反过来）
- [x] `headerFooter` 上的两枚开关**从"整枚不见"到两头都接**（v0.55：`@scaleWithDoc` 与 `@alignWithMargins`
      收进载荷（缺省开着 ⇒ 只收明确写 `0` 的那一枚，显式 `1` 与不写都归一回不声明）、写回原位置（走 crate 的
      setter，只在关掉时落字节；顺带让"只有开关没有页眉"的件也长得出 `<headerFooter>`），
      并且**两枚都真的上纸**：`scaleWithDoc` 由 `headerFooterCss` 自己把字号乘出去（Excel 那一份实测 50% 下
      开着＝页眉 5.5pt、关掉＝11pt；我们的 margin box 是页级的、不吃挂在 `<table>` 上的 CSS `zoom`），
      `alignWithMargins=0` 按载荷那两条左右边距往外推**正好等于**边距的负 margin（推过头那一格会被静默丢掉）——
      与 Excel 差的正是"我们铺到纸张边缘、Excel 铺到打印机可打印区（实测各留 55pt）"那一圈，这句当账说在面板与导出
- [x] 页眉字号的**底数与最终缩放**两处对齐 Excel（v0.56：① 底数从 16px＝12pt 改成 `HF_BASE_FONT_PT = 11`，
      且**倍数正好为 1 时也写**——不写不是"不声明"而是让 margin box 去继承页面那 16px，缺陷原地不动；
      ② 宽度分带挤压反求出的那一档（`planColumnBands` 的 `bp.zoom`）也跟上了：`sheetHtml` 把自己真正挂到
      `<table>` 上的那一档 zoom **回报**给 `sheetsToPrintHtml`，只重说页眉那份 CSS 再重算一次 `job`
      （不是在计划里再算一套列宽——两处各算必分叉）。接线前先量了三份对照件：Excel 的 fit-to-width 确实带着
      页眉一起压（`fw-plain` 11.04/11.04、`fw-fit1` 4.08/4.08、`fw-fit1-off` 11.04/4.08），
      而 `PageSetup.Zoom` 在 `fitToPage` 开着时返回 `False`、那一档只能从产物读）
- [x] **工作簿默认字体（族+字号）进载荷**，页眉底数跟着文件说话（v0.57，窄口径：只接页眉）：这一层在 OOXML 的位置是
      `xl/styles.xml` 的 `fonts[cellXfs[0].fontId]`（Normal 那枚），读侧按**索引**取而不是取第一个 `<font>`；
      写侧走 `set_default_format(&fmt, 20, 64)`（必须在任何 `add_worksheet` 之前，后两数按 crate 自己的量传 ⇒
      `sheetFormatPr defaultRowHeight` 不动，只有字体那一层动）；这一层**不归一化字族**（"等线"归一回不声明会让写侧落
      Calibri＝换字族，与"默认值不算声明"是两件事）；Univer 里 `defaultStyle` 是死槽、`wb.save().defaultFont` 恒 `null` ⇒
      走侧通道 `defaultFontRef`。判别件量的两条：文件说 11pt ⇒ 纸上 11.002pt、说 14pt ⇒ 14.002pt，两件页眉比 1.273 ≈ 14/11
      而正文两件同为 8.244pt（正文那一层没被动）；Excel 打开我们重存的件报 `Normal = 宋体/14`、它自己导出的 PDF
      页眉/正文比 1.276 ⇒ 写进去的那枚 `fonts[0]` 第三方认得；另注一条改第三方件的教训：
      .NET `ZipArchive` Update 模式就地改写的 xlsx 我们读得回而 **Excel 16.0 拒开**，按原条目序重打包才正常
- [x] **写侧不再给未设样式的格盖上显式 xf**，正文那一格改由文件说话（v0.58，`b-inherit`/`b-stamped` 成对件在
      Excel 16.0 自己导出的 PDF 上量）：`<c r="A1" s="1">` → Calibri/11 那一笔从字节上消失了（载荷没 styles 的格走
      **不带 format** 的写法），Excel 原件里那一格本来就是**靠继承 Normal** 拿字号的；只勾了加粗的格改由
      `seed_font` 把工作簿默认字体种进 `<font>`（`<b/><sz val="14"/><name val="宋体"/>`，不再落 Calibri/11），
      而文件说的正是 Calibri/11 那一档时**一个字都不种**（种了会把 `<scheme val="minor"/>` 弄丢）。
      第三条只读腿帮上了忙：`Range.Font.Size` **会把继承解出来**（inherit 的 A1 报 14 而 stamped 的 A1 报 11），
      于是正文底数的归属有一条比量 PDF 便宜的判据；成对件的页眉正文比 inherit **1.000**、stamped **1.272
      （＝14/11，v0.57 那个 1.266 的形状留在同一趟当对照）**
- [x] **正文底数接到文件说话的那一层**（v0.59，那三处里的 ③ 纸面那一层）：`baseFontPt`/`baseFontPx` 把那一层的一次解析
      供两处消费——页眉由 `@page` 的 margin box 乘出去、正文落在每张表 `<section>` 的 `--oof-print-base-size` 上被 `td`
      的 `font-size` 吃掉，兜底那档 `BASE_FONT_PT = 11` 从页眉专属改成共用；`hfBasePt`/`HF_BASE_FONT_PT` 与格子那份
      `×1.333` 一并删掉（`ptToPx` 成整仓唯一的 pt→px 换算处，"两处各自读 `fs` 迟早分叉"由结构腿按行数钉住）；
      行盒随底数重做（`padding:0 6px`、`line-height:1.25`、**不再写 `height`**——旧的 18px 固定行高在 14pt 那一档每行
      多出 7px、把一页表挤成两页，而 `line-height:1.0` 那一档装不住下行墨），`PRINT_ROW_BIAS_PX` 随之归零。
      判据全是比值：文件说 11 ⇒ 正文 em 10.994 / 页眉 11.002，说 14 ⇒ 13.992 / 14.002，两件**页眉/正文 = 1.000**、
      跨件正文比 = 14/11，与 Excel 自己导出的那两份（11.04/11.04、14.04/14.04）同形；只勾加粗、没说字号那一格与正文
      同档（证明底数走的是文件那一层而不是我们的常量），分页两家一致（11pt 一页、14pt 两页），存盘重开不给 `printSet`
      也回得来
- [ ] **屏幕那一层与读侧归一化还没搬，于是本轮留下一档分叉**：文件说 14pt 时**纸上是 14pt 而界面上一格不样式的字
      仍是 Univer 硬编码的 Arial/11**（`IWorkbookData.defaultStyle` 在 core 里零读取，`defaultFontRef` 那枚侧通道只喂
      存盘与导出），读侧 `style_for` 的归一化参照物也仍旧是常量（v0.58 钉住的那份歧义：`s: None` 两种来源载荷分不开）。
      搬其中任何一处都得另一处一起，否则刚对上 Excel 的那一档纸面又会被弄丢
- [x] **工作表缺省行高那一层（`sheetFormatPr`）的保真往返**（v0.60，范围由实测定死）：五件变体
      （`15`／`30`／`30 customHeight="1"`／`17.5`／整枚擦掉）在 Excel 16.0 里 `Rows.Item(1).RowHeight` **全是 17.5**
      ⇒ 这一层**不是排版指令**，只是文件里的字节（Excel 不用它排版、自己存盘却会把它重写：那份 30 磅的件经 `SaveAs`
      变成 `defaultRowHeight="17.5"`）。于是只做往返，**界面与纸面都不吃它**——Univer 那一枚 `IWorksheetData.defaultRowHeight`
      是**活口**（喂进去界面真按它排），喂了就是让屏幕去听一个纸面不认的数；写侧不吃 crate 的 `set_default_row_height`
      （整数像素存 ⇒ 17.5 变 17.25，且把缺省盖成**每一行的显式 `ht`**，行是存盘那刻才落 XML 的所以躲不过），
      走同一趟定点重打包且只重写自家那两枚属性；归一化只有"正好 15 且没带 customHeight"一条，而
      `15 customHeight="1"` 不许被抹掉；纸面判据是**三件行推进同为 17.237pt**（真吃了那一枚就该是 37.5 档）
- [ ] **列宽不跟工作簿默认字体走**：`chars_to_px = round(chars*7+5)` 里的 MDW=7 只是 Calibri/11 那一档，底数抬到 14pt
      时同一格里的长串就要多折一行（`bb-14` 第 3 列那条就是为这一条留的对照）；这一维一动又牵着分页与
      `PRINT_ROW_BIAS_PX` 重标定，得连着行盒一起重跑实测
- [ ] **显式行高在字节上会漂**：`set_row_height_pixels` 只收整数像素，载荷里非整的那一档被 `as u32` 截掉
      （最多 1px＝0.75pt；`xlsx.rs` 里那句"px↔pt 3/4 对 4/3 无损"的假注释已在 v0.60 改口成说实话），
      要修就得连着纸面行高与 `rowHeights` 那批夹具一起复核
- [ ] **整包重写留不下我们不认的属性**：存盘是 `Workbook::new()` 整包重写，第三方件里读侧不认的属性活不过这趟
      （v0.60 实测：Excel 亲笔的 `x14ac:dyDescent="0.3"` 在我们重存后不见了，同一趟里 `defaultRowHeight` 那枚**数**活着）。
      本轮只保证"点名的那几枚"活着，其余按维记账；要收的是"逐属性搬运"还是"整份件只改点名的字节"，得先定方向
- [x] ODS 的工作簿默认那一层接上了（v0.61）：`xlsx.rs` 的 `.ods` 分流不再硬交回 `None`，而是读同一件 `styles.xml`
      的 `<style:default-style style:family="table-cell">` → `<style:text-properties>`，与 xlsx 的 `cellXfs[0].fontId`
      同一枚形状、两处住址；因为消费点（`baseFontPt` 与 `--oof-print-base-size`）从 v0.56/v0.59 起就跟格式无关，
      **前端零改动**就把这一层上了纸（实测两件页眉字高比 1.2727 ≈ 14/11）
- [ ] **ODS 的 default-style 只接了一支**：`family="table-row"`（缺省行高）与 `family="table-column"`（缺省列宽）
      两支还没读，于是 `.ods` 的 `sheet_format` 仍旧恒为 `None`——v0.60 那趟"保真往返"在 xlsx 上成立、在 ODS 上
      连字节都没开始搬；单位也不同（ODF 说 `cm`，`odf_len_to_px` 那把尺子得先量准第三方件里这两支常见写成什么档）
- [ ] **ODF 的字族字号各有三条变体**：`style:font-name` 之外还有 `-asian` / `-complex`（字号同理 `fo:font-size-asian`
      等），真件里中文环境常是三条同写；本轮只取西文那一档，其余当邻居不碰——但要紧的是**只读西文会不会在东亚字族
      的件上读出一档"没说话"**，得先拿真 LibreOffice 件对质
- [ ] **`office:font-face-decls` 的字族映射未接**：ODF 在那里把显示名映射到实际字体家族，读到的 `style:font-name`
      可能是这一个映射表的 key 而不是字体名，本轮按字面直存
- [ ] **具名 `style:name="Default"` 与 default-style 谁优先未经第三方实测**：ODF 的继承链上两层都可能带字体，
      本轮判别只证明"我们只从 `table-cell` 那一支取"，没有证明"别的应用在两层冲突时听哪一层"（本机无 ODF 应用可问）
- [ ] **我们写的这一层别的应用认不认未证**：v0.61 的四腿里没有第三方 Office 腿（本机无 LibreOffice/OpenOffice，
      Excel 16.0 打不开 `.ods`，ODF 规范的七个 URL 全 404），所以"往返自证 + 字节自证"是当前上限；一旦有可用的
      ODF 应用，第一件事是打开我们存的那份看 `Table > 属性` 里的默认字体是不是那一档
- [x] **ODS 的批注与超链接双向**（v0.62）：这两样在 ODF 里都是**格子的孩子**（`office:annotation` 排在同格正文之前、
      链接是格内文本外层的 `text:a`），一趟 `content.xml` 扫描按表名收齐并交回同一枚 `SideRead`，写侧照"没声明就不写这一层"
      （`office:display`／气泡尺寸／`dc:creator`／命名空间全部按需落笔，尺寸单位必带）；落不准的一律记账不硬派
      （被合并区盖住的格、重复列、同格第二条、认不出的目标、空正文气泡）；前端只撤下那句"暂不含"，另三句账目照旧
- [x] **ODS 写侧的回写账目通道**（v0.63）：`write_ods`/`write_ods_sync` 的返回从 `Result<(), Error>` 变成
      `Result<Vec<String>, Error>`（与 `write_xlsx_sync` 同一条契约，前端只动两行就上了状态栏），
      "批注落在被合并区盖住的格上"、"链接两头都没目标"、"同格第二条"这类**写侧**摆不进的形状从此报得出地址与后果；
      判据只有一批（`note_written`/`link_written`）而格子渲染／命名空间／账目三处共读，所以"报的账"与"字节里少掉的"
      是同一批；真机量到 Univer **当场允许**先建批注再合并，这条通道不是理论上摆不下的形状（另新开三条，见下）
- [ ] **账目文案那句"ODF 在那里没有批注通道"按 v0.63 实测要改口**：规格腿逐枚量出 `covered-table-cell` 里塞批注、
      正文、链接**三档 RelaxNG 全部放行**——拦住它的是规格正文的语义（那一格的内容属于锚格）加我们读侧的归因分寸，
      不是文法；文案现在说的"没有通道"听着像文法逼的，而真机冒烟与结构腿**正按这句字面断着**，改口得连着判据一起动
- [ ] **xlsx 写侧的"同格多条"是否记同一条账没核查**：ODS 这头本轮立了「只写第一条 + 报出实际条数」，
      `xlsx_cell_side` 那头有没有对称的判据与账目未对照过——两头不一致时，状态栏说的话就取决于文件是什么后缀
- [ ] **被盖住的那枚批注现在只是报得出，仍救不回来**：真正的修法要么在放侧先按同样判据挡掉（界面里就不给放），
      要么把它搬到锚格并说清楚；本轮选的是**记账不挡**（与读侧"落不准就不硬派"同一条分寸），代价是界面上那枚气泡
      存完就没了、只留一句账
- [ ] **界面新建批注只有门面那一条路，而门面吃的是 `ISheetNote` 对象**：`createOrUpdateNote(字符串)` 会被 Univer
      摊成按字符下标的键、侧通道只认 `note` 是字符串那一档（本轮冒烟在这上面栽过一次，看着像产品没接线）；
      批注正文的富文形状（多 run）本轮没测，快照那一档只见 `note` 一个字符串
- [ ] **链接挂在数字格上会把那一格读回成文本**（v0.62 钉成断言的已知代价）：Univer 的链接格吃 `p.body`（富文本）而不是 `v`，
      这座桥与文件格式无关 ⇒ `.ods` 与 xlsx 同形状（`office:value-type` 由 float 变 string、`office:value` 不见了），
      而同一趟里其余数字格照旧是 float；要收的是"值与链接共存"那一档，得先定桥的吃法（改一处两头都动）
- [ ] **同一格两条 `office:annotation` 会并成一枚气泡且不记账**：读侧按格子收，第二条的正文按换行**并进**第一条，
      而 `svg:width`/`svg:height`/`office:display` 被后一条**覆写**（后一条没说就降级成"没声明"），作者只在后一条也署了名时才换；
      这一档既没有测试覆盖也不是 ODF 的常见形状（v0.62 的判据只到"同格两条链接"），但"并成一枚"与"丢掉一条"在账目上说不清——得先定它该算什么
- [ ] **`dc:date` 与 `creator-initials` 未建模**：读侧只把它们当元数据邻居（`in_meta` 挡在正文外，不污染气泡），
      载荷里没有对应字段 ⇒ 往返会丢；批注时间若要上界面就得先定它在 Univer 那一头的落点
- [ ] **公式格挂链接仍只进界面账**：`univer-io` 那条 v0.48 立的规矩（公式格上的链接"先记账不硬放"）与格式无关，
      `.ods` 同形；要收得连着公式表示（`p` 与 `f` 谁占哪一格）一起定
- [ ] **样式层那三枚属性名不合 ODF 1.2**（v0.62 规格腿逐枚判出，各造一件：假例 INVALID、正规写法 VALID）：
      `style:align` 该落 `<style:paragraph-properties fo:text-align>`、`style:cell-wrapping` 该是 `fo:wrap-option`、
      `table:use-optimal-row-height` 该是 `style:use-optimal-row-height`；这一层从 v0.61 起就同判 INVALID（本轮件与对照件同判，
      **不是本轮新增**），而整件级校验要通就得先修这三枚 + 补齐 cell→paragraph→text 的子元素定序
- [ ] **规格腿只有一台引擎**：整件 RelaxNG 靠本机 lxml 一家（无 java/jing），"lxml 说不合规"与"真不合规"之间还差一次复判；
      且 RelaxNG **并不强制** `default-style` 排在具名 style 之前 ⇒ v0.61 那句"位置有讲究"是按应用惯例说的，本轮已改口
- [ ] **`.ods` 的图表 / 三类规则 / 页面设置**：SheetEditor 那三句账目还在（v0.62 只撤了批注与链接那一句）
- [x] 打印排版的实测常数随行盒重标定（v0.59）：`PRINT_ROW_BIAS_PX` 从 0.4 **归零**——新行盒（1.25 × 底数、上下 padding
      归零、不写 `height`）下逐行比对屏底行矩形与纸上推进，普通行差 −0.05~+0.02px（属基线被吸到整磅的噪声，所以量法是
      按同一列从上到下的基线差逐行求和，而不是取中位数——中位数会挑到抖出来的那一档）；**留着旧的 0.4 不是保守而是凭空
      多压一档缩放**，这一条钉成结构腿的假例（同一份实测在 0.4 下变 15 页），注释里的约束改口为「这枚数跟着行盒走，
      再动 `line-height`/`padding`/把 `height` 写回来都必须重跑这段实测」
- [x] **易用性一期：用户可见的失败出口说人话**（v0.64，Rust 零改动）：新建 `src/lib/fail-msg.ts`——11 条判据按
      "具体在前"排（calamine / rust zip / JSZip / cfb / pdf.js / `JSON.parse` 的专属词形 → `os error N` 通用尾巴），
      每一条命中的都是**真机上量出来的原串**；`failStatus` 把中文一句与原话装进**同一枚字符串**（两行），
      渲染点用 `statusText`/`statusTip` 拆，于是不必给四个编辑器各加一份状态、也不多出一条"文字与提示不同步"的分叉；
      覆盖 28 处出口（四个编辑器 21 + 首页同步 2 + `ole` 2 + `sheet-rules` 3）；PDF 那三处后台补做从此开始说话，
      并按 `isTeardown` 把"关标签拆掉的 transport"与"文件真读不出"分开；页面级操作的失败句不再三秒自动抹掉；
      真机腿 51 断言里第一条把**原生对话框**变成判据（按 `EnumWindows` 数得出、不阻塞 CDP）
- [x] **PDF 设了口令只说得出、还没有输密码的地方**（v0.65，Rust 零改动）：pdf.js 的 `password` 通道接上了——
      `openTask.onPassword` 装在 `await openTask.promise` **之前**，面板亮出来、等用户按键，绝不自动投密码；
      `No password given` 那一档判据跟着改口（见上一节）
- [x] **性能一轮：先量再动，而交付的是"等的时候说真话"**（v0.66，Rust 零改动、只动前端那一层）：三条热路径各量了一遍
      （PDF 冷扫 700 页 1.9~2.4s／热扫 234ms、每页字符串工作全场 5ms、钱在 pdf.js 的逐页 `getTextContent`；
      表格 20000 行件 dev 首开 4.4s，而同一批 Rust 计时在 release 里是 307ms/205ms ⇒ **dev 数是 debug profile 的产物**；
      并行取页文本 A/B 只省 1.3× 已裁决为不做），于是这一轮不做假的加速，改的是**旧形状里"扫完才说话"这一条**：
      新建 `src/lib/pdf-search.ts` 供四档文案与节流判据，`PdfViewer` 那一趟改由界面自己记着"在扫"，
      于是「无匹配」只有扫完全程才说得出（真机量到旧形状在打字后 ~25ms 就报"没有"，而那一页都没扫），
      进度按 120ms 时间窗/攒够 20 条命中交出去（一趟全程说 20 句），撞上限时那句带加号；
      v0.65 那条「作废门打在写任何共享状态之前」在这条新循环上再兑现一次（B4/B5/B11 + 真机 P19）
- [ ] **PDF 全文搜索还是"从第 1 页起扫整本"**：本轮只改了等待期间说什么，没改扫法；冷扫那 1.9s 的瓶颈在 pdf.js
      逐页 `getTextContent` 的往返上，而**并行已被实测否掉（只省 1.3×）**⇒ 真要提速必须换形状：按需只扫视口附近并
      让后台续跑、或把文本层交给 Rust 侧一次算完（`pdf-oxide`/`pdfium` 一类，需过许可红线）、或增量索引存下来跨次会话复用；
      页文本缓存目前**换标签即全丢**（没有按 path 的 LRU），重开同一件又从零扫一遍
- [ ] **匹配结果不跨查询共用，而页文本缓存是共用的**：换一个词就要重新逐页 `indexOf` 一遍（热扫 234ms 里 200ms 是防抖）；
      另外"从当前页开始找下一个"这一档界面入口也还没有（上下导航只在命中列表里前后走）
- [ ] **命中上限 500 只说加号不说总数**：`500+` 是诚实的（剩下的没再扫），但用户不知道这份文件里一共有多少条，
      而"继续扫下去数得出总数"与"截断以省下时间"这一档本轮没决策
- [x] **dev 与 release 的数字必须分开记，而 release 的应用层复测还欠着**（v0.67 还的账）：本轮只在
      `cargo test --release` 里量到 Rust 那两层（`read_xlsx_sync` 307ms／`write_xlsx_sync` 205ms），
      **含 IPC 与前端建 Univer 的完整一趟**在 release 构建上是多少还没有数——v0.67 用
      `pnpm tauri build --no-bundle` 出两份 exe（改前的当场存档）各跑三趟真机腿量完了：big20k.xlsx 的首帧
      **1579 → 1329ms**，而 `read_xlsx` 那一次请求本身的耗时没变（235 → 229ms）⇒ 上一轮那些"4.4s 首开"确实是
      debug profile 的产物，而 release 上真正可省的是**排队**；这条账量出来直接变成了下一轮的改动
- [x] **表格首开那一段：读件的 IPC 在外壳开标签那一刻就出门**（v0.67，Rust 零改动）：新建
      `src/lib/open-prefetch.ts`（在途字典 + 取走即失效 + 关标签撤账 + 路径归一），`store.openTab` 里一行
      按 `tab.path && kind === 'sheet'` gating 的 `prefetchWorkbook`，`SheetEditor` 挂载点那一句换成
      `takeWorkbook(...) ?? readXlsx(...)`；改的根据是 release 上量到的**一段本可叠起却没叠的等待**
      （chunk 取 82ms + 求值 142ms 全排在 `read_xlsx` 出门之前），而一条实测把"是不是引擎不让并行"问死了
      ——**发出 `invoke` 后立刻占住主线程 200ms，那次请求的起点仍是发出那一刻** ⇒ 串行是我们发得太晚，不是 WebView2 的脾气；
      12 条结构判据 + 10 枚变异 + 17 断言真机冒烟 + A/B 腿 6 判据全绿
- [ ] **改后 1329ms 里仍有一整段在 chunk 的取与求值上**：它现在与读件并行了，但**顶层求值那一截（一个 111~137ms
      的长任务）仍排在 Univer 建实例之前、也就是仍在首帧的关键路径上**；要再省就得把建实例也提到外壳，
      而它需要真实 DOM 容器（本轮没动，也不是免费），另需查清"空闲预热（`lib/prewarm.ts`）到底有没有把 chunk 备好"——
      预热与本轮的 prefetch 是**两条互不知情的通道**，两者在 Resource Timing 里的顺序会互相挪动，本轮没有判据
      （v0.68 依旧没有：PDF 那一头的 A/B 判的是"读件排在 chunk 之前还是之后"，不是"预热有没有把 chunk 备好"）
- [ ] **PDF 这一头的 chunk 取与求值也仍排在首帧关键路径上**：改后 579／708／966ms 里，`PdfViewer` 那块 chunk 的
      下载与顶层求值还是在最前，预取只把"读"这一件叠了进去；要再省就得连 pdf.js 的 `getDocument` 也提到外壳，
      而它需要真实 DOM 容器（与上面表格那一头是同一个未决项，不是两处独立的账）
- [ ] **分段件首屏那 92 枚 `read_range` 仍是 pdf.js 自己的切分节奏**：预取把首块 64KB 提前了，
      而**首块之后的区间要等 `getDocument` 起来才开始**（要连它们也提前就得自己按页预取，不是免费的）；
      另有一条观测量留给下一轮当解释用：改后 `read_range` 的**累计**耗时涨到改前的 3~4 倍而枚数不变（92/92）、
      末次出门反而更早 ⇒ 那是并行度上去了，不是活变多——不写清就会被读成"预取让读变慢"
- [ ] **发布包 A/B 腿的两条量具纪律（本轮各撞一次）**：① **采样必须严格串行**——`--remote-debugging-port=9222`
      是全局单端口，四份 probe 并行发出去时后起的实例抢不到端口而四个 CDP 客户端全连到同一个页面，
      于是四份记录**逐字相同**、12 页的小件报出 1600 枚 canvas（"两份数据一模一样"要当成腿坏了读，不是当成"没有差"读）；
      ② **判据要判顺序而不是判绝对时刻**——本轮 3 趟初量按"出门时刻的绝对毫秒差"把两枚夹具判成 −2/−16ms，
      按 v0.36 那条"无收益即删"就该 revert；加到每边 5 趟并换成符号判据（排在 chunk 备好之前/之后）之后 30/30 趟一致。
      绝对差是被外壳 bundle 变大、`openTab` 自己往后漂二三十毫秒吃掉的，而那一截漂移与本轮无关
- [x] **在途通道只有一条，而首开要读的东西不止一件**（v0.68 把 PDF 这一头接上了）：`.ods`／`.csv`／`.xls` 同走
      表格那一条（它们吃同一枚 `read_xlsx` 命令、由 Rust 按后缀分流），**PDF 现在是第二条通道**——
      `store.openTab` 里加一行按 `tab.kind === 'pdf'` gating 的 `prefetchPdf`，`PdfViewer` 加载那一路换成
      `takePdf(path) ?? preparePdfSource(path)`；而它预取的是**「首屏该怎么读」那次决定**而不是整叠字节，
      所以上一轮那句"先把整叠字节取回来正好与那条分段闸门相反"不再是拦路的理由（闸门由 `preparePdfSource`
      单一持有，外壳不猜）；`put/take/drop` 泛化成 `<T>`，两张表共用同一段实现（本轮没新增规矩，只新增调用点）；
      21 条结构判据 + 14 枚变异 + 25 断言真机冒烟 + A/B 腿 22 断言全绿，收益按发布包 5 趟中位是
      **首画省 26~70ms**（表格那一头是 250ms 一档，两头不该按同一个期待比）
- [ ] **文档/演示仍在挂载点才发**：理由是量出来的而不是顺手的（它们的字节读得快，慢的是随后的解析，
      提前读字节省不出什么）——但若下一轮动 docx/pptx 的解析（挪进 Rust 或 worker），这一条要重新量
- [ ] **dev 下开一次表格标签读到两次件**（真机 S5 量到 `read_xlsx` 的 Resource Timing 条目 2→4）：
      `React.StrictMode` 的双挂载里第一趟消费掉 prefetch、第二趟走自备那一路——**这是 dev 独占的形状不是缺陷**
      （挂载点写的是"取不到就自己发"，发布包只有一次挂载而那次必然取得到），但**首开耗时在 dev 上因此不可与 release 比**；
      若下一轮想让 dev 也消费同一份，判据得改（现在钉的是 `??` 的取/发顺序，不是"只发一次"），
      而"为了控制台好看而阻塞第二趟"是拿生产行为换开发体验，不做
- [x] **写侧也有账了：release 上存盘那一路的完整一趟量出来并接上了进度话与同标签串行**（v0.69）：
      先还 v0.66 记的那笔账——`write_xlsx_sync` 的 205ms 是 `cargo test --release` 里**应用层之外**的数，
      而这一轮从页内 Resource Timing 量到真件整趟 = 取快照+拼载荷的**主线程同步块 115~131ms**（IPC 还没出门）
      + `write_xlsx` 自身 **471ms 中位**（改前同一枚面 505ms ⇒ 本轮没让 Rust 变快，本来也没打算）
      + 落定，小件 11~18ms／中件 45~46ms／大件 590ms 三档；于是 `SAVE_BUSY_MS=200` 那道门有依据
      （早于同步块就等于闪一句读不完的话），另存为挑路径那一段撤门；连按两次 Ctrl+S 改前**两趟全部重叠**
      （`write_xlsx_sync` 是一次 `std::fs::write`、跑在不同 blocking 线程上写同一路径，谁后落地没有保证 ⇒
      表现是"后按的改动可能没进文件"这种数据回退），现在按 `tabId` 记在途 + 只留一个"还要再存"的位，
      补的那一趟走同一个 `save()` 因而**重新取快照**（真机 x69d1/2/3 从 zip 的 worksheet 部件里读回新页眉字面，
      第二枚在第一枚落定后 124~136ms 出门）。验证：release A/B **23 断言 / 真失败 0**（改前两枚全重叠且一次都不说进度）、
      前端结构 **25 / 0**、变异 **12 枚 + 正控制 / BAD 0**、dev 真机 **12 断言 / 真失败 0**（数字不吃 dev，
      那里是 debug profile）、`cargo test --lib` **97 / 0 / 11**（Rust 本轮一个字没动），tsc 与 release build 绿（3m15s）
- [x] **另外三头只有"不并发"没有"说话"**（v0.70 量完并只接上一头）：`registry.saveTab` 的在途保护对四类编辑器一视同仁，
      而 v0.69 的 `arm/cancel/saveDoneText` 只接在 `SheetEditor` 上——本轮先把那三头的存盘时间线**逐档量完**
      （release，三头 × 三档 × 各 3 趟）：文档 `.docx` 按键到写出门 6~111ms／整趟 ≤122ms／写自身 4~10ms，
      演示 `.opd` 0~8ms 出门／整趟 5~45ms／写自身 5~31ms（走 `write_text_file`），PDF 标注写回整趟
      **11 / 143~161 / 1071~1161ms** 而 `write_file` 自身只有 4~95ms ⇒ 200ms 那道门对**只有 PDF 大件那一档**说得出真话，
      文档/演示接上就是闪（A12a/A12b 把"没接"这个决定钉成判据，下一轮想接得先重新量）；而量这一路时撞出的真缺陷是
      **PDF 头改前一句都不说**（`writeAnnosTo` 从不 catch + `registry.drain` 的 `catch {}` ⇒ 只读件按 Ctrl+S 之后
      连「保存失败」都没有，成功也只有 `markDirty(false)` 没有「已保存」），现在三句都挂在 saver 那一层
      （不挂进与 `pageOp` 共用的那个函数，A8/M5 钉这一条；`pageOp` 原有的两句照旧，A9/M6 是回归判据），
      收尾时钟 `saveDoneTimer` 进模块（两份 1500/5000 就是两把尺子）。验证：release A/B **20 断言 / 真失败 0**
      （两支真 exe × 10 趟；进度句可看 940ms、小中两件一次都不闪、三档各只落一次盘、写自身 88→99ms 与全程
      1152→1150ms 都没变慢 ⇒ 本轮没让 pdf-lib 变快）、前端结构 **21 / 0**、变异 **18 枚 + 正控制 / BAD 0**、
      dev 真机 **11 / 0、页面异常 0 条**、`cargo test --lib` **97 / 0 / 11**（Rust 一个字没动），tsc 与 release build 绿（3m35s）
- [x] **文档头的存盘那一路把账说对了**（v0.71）：改前 `.docx`/`.odt` 按 Ctrl+S **写了文件、说了「已保存（docx）」、可标签的 ● 还挂着**
      （A/B R0a `dots 1→1 内容落盘=true`，R0b 量到成功那句与 ● 同屏 1 拍 ⇒ 界面自相矛盾 + 关窗口给一条假的未保存询问），
      而只读件那一路改前**状态栏全程 [null]**、失败只落在阻塞式 `#32770` 里（写请求确实出过门：`fs|write_file` 17+6ms）；
      本轮把两层分开——**写手**（`writeDocxTo`/`writeOdtTo` 只写字节 + `markRecent`）／**动作**（`saveOdoc` 与 `exportAs` 各自决定
      说什么、记不记账、失败走哪张面孔），`saveDoneText` 因此多一枚 `base`（句子由按下的动作给，否则导出那一路会说「已保存」）；
      按实测这一头**不挂进度门**（整趟 30~92ms、写自身 6~62ms、longtask 0 条），只接收尾时钟；`cancel` 的第二个用途在这里露出来
      ——**失败那一路也要撤**，改前第一趟那句裸 1500 会把第二趟的句子抹掉（连按两次：R3a 后一句只活 504ms／改后 R3b 1504ms）。
      验证：release A/B **37 断言 / 真失败 0**（ dots 1→0、打脸 0 拍、各趟只落一次盘、按键→上屏 32→31ms、写自身 7→6ms、
      longtask `[]`、页面异常 0 条 ⇒ 本轮没让写侧变快，改的是界面说什么）、dev 真机 **16 / 0（含 D7c/D7d 两条分层判据）**、
      前端结构 **31 / 0**、变异 **14 枚 + 正控制 / BAD 0**、`cargo test --lib` **97 / 0 / 11**（Rust 一个字没动）
- [x] **PDF 大件那 ~1030ms（按键到写出门）没有归因**：本轮只判了它**不是** chunk 取、且全程**没有 ≥200ms 的长任务**
      （`longtask=[]`），而 `write_file` 自身只 91~99ms ⇒ 钱在 pdf-lib 的 `PDFDocument.load` + `save()` 那条 await 链上，
      但没有分段打点说不出各档占多少；再省要么把它挪进 worker，要么像表格那样只写变更的注解（本轮一毫秒都没为此改动）
      ——**v0.80 已归因并兑现**：打点量到的形状是"等"而不是"忙"（`loadSyncOnly=0 / loadAwaitOnly=236`、
      `saveSyncOnly=0 / saveAwaitOnly=750`、页内 `longtask=[]`、`mainThreadShare ≤10.9%` 且那是含 CDP 轮询的上界，
      正控制 `E0 busy300 dScript=300.4` 证这把尺量得到东西），算术也对得上（件里 `objects=4764` ⇒ 库默认 100/50
      下要让出 **142 枚**宏任务、实测每枚 ~6.6ms，而 Chromium 把嵌套零延迟定时器钳到 ≥4ms）⇒ **不必搬 worker**：
      把让出粒度定在 `PDF_OBJECTS_PER_TICK = 1500`（`lib/pdf-ticks.ts` 一处持有、六处站点共吃）之后，release 实测
      按键→写出门 **1024/1028/1034 → 148/172/153ms**，写出去的字节两支同一份 `d46fd9db95ae3c0d`、各只一枚写请求、
      按键之后没有长出新的同步块，而那句 `SAVE_BUSY_MS=200` 的「正在保存…」因此在大件上也不再上屏；
      "只写变更的注解"那一路同样没走——它改的是内容而不是等待。验证：release A/B **27 / 真失败 0 / 显式 SKIP 0**
      （3 趟 × 两支真 exe，对照件＝改前当场存档的 0.79 那支）、前端结构 **21 / 0**（B0 自检 5/5）、
      变异 **14 枚 + 正控制 / BAD 0**、CDP dev **15 / 0、页面异常 0 条**、`cargo test --lib` **97 / 0 / 11**
      （Rust 一个字没动）
- [x] **标注还没扫完就按 Ctrl+S，会把 `/Annots` 整片抹掉**（v0.80 的 A/B 顺带量到的既有缺陷，**v0.81 修掉**）：
      写那一路把内存里的标注整片重盖进文件，而读那一路（逐页扫 `/Annots` 之后 `setAnnos`）是异步的——早退那一趟
      按下时页龄 ctrl 594 / exp 1447ms，两支落盘都是 `annos: 0` 且哈希同为 `ca72e8c365681d03`，而屏上照旧「已保存」、
      ● 照旧归 0 ⇒ **界面说"存好了"而 40 枚注解没了**；正常那一臂因此改成先等侧栏「标注 N」落定再按
      （判据吃 `disk.annos === sideCount` 而不是硬编码枚数）。要的是"读侧未就绪不许写"那道闸（或未就绪时先补扫），
      与让出粒度不是同一件事；0.79 同样犯，所以这不是本轮引入的回归，但它是本轮**看到**的第一格会丢用户数据的形状。
      **v0.81 的兑现形状**：闸记的是「**哪一份 doc 已经整片读完**」（按 doc 身份、`useState` 持有、渲染期镜像给闸门读），
      而不是「哪一份在读」——后者挡不住"挂载之后、doc 之前"那一段（实测 `pre5.log`：24 枚按下时那本布尔账是 `false`
      ⇒ 闸门没挂上 ⇒ 40→0）；闸门**只立在两条写通道共吃的那一处**（`writeAnnosTo` 函数头、取内存列表之前），
      读到一半失败**故意不记账**，全仓**没有一处销账**；顺带把收尾从整片替换改成 `setAnnos((cur) => [...out, ...cur])`
      （前置实测 ADD1b 量到终值会把窗口内刚画的那枚替掉：落定后内存 40 而不是 41）。
      验证：release A/B **49 / 真失败 0 / 显式 SKIP 0**（3 趟 × 两支真 exe，对照件＝改前当场存档的 0.80 那支；
      按下落盘枚数 ctrl `[0,0,0]` vs exp `[40,40,40]`，两支落定之后都把 40 枚写回且哈希同为 `bc482236284a04`）、
      前端结构 **26 / 0**（B0 自检 6/6）、变异 **17 枚 + 正控制 / BAD 0 / 多打中 0**、CDP dev **26 / 0、页面异常 0 条**、
      `cargo test --lib` **97 / 0 / 11**（Rust 一个字没动）
- [x] **导入失败之后写回一直被拒，直到重新打开这份文件**（v0.81 的实现**故意**留下的代价，不是回归）：读到一半抛错时
      那本账**不认这一份 doc**（读到的不是整片，认了就是在允许抹），而这一头**没有"重试导入"那一路**——用户能做的只有
      关标签再开。要做的是给标注导入一条显式重扫（以及它该由谁触发：按钮、还是下一次 Ctrl+S 之前自动补一次）
      ——**v0.83 已补**：侧栏「标注」页签的「↻ 重试导入标注」把手重跑同一趟 `readAnnos`（幂等门借那本按身份记的就绪账、
      在途门按身份收放、成功那句挂在状态栏 ⇒ release 可见的取反面）；"该由谁触发"选了**用户按把手**而不是 Ctrl+S 之前
      自动补（见下一条）；**重跑只治瞬时失败**——确定性坏结构按多少趟也开不了门（新开未勾项）
- [ ] **闸门拒绝期间，用户这一趟的意图无法兑现**（v0.81 只做到"不抹"，没做到"不丢"）：Ctrl+S 那一路抛出去之后画的那枚
      仍在内存、● 仍挂着（dev R4 钉这一格），等待是合法的；而页面操作那一路（旋转/删除/提取/合并/拆分）当场失败
      （dev Q1/Q2：`rot:[0,0]` + 「旋转失败: 标注还没读全…」），**落定之后要不要自动补做那一刀没有判据**
      ——**v0.83 明写不做排队补做**（变异 M16 钉住不许有），本轮只把"等待有个尽头"做出来（把手）；**按页部分写回也不做**
      （那要把就绪账从整片降到逐页，等于拆掉「宁可拒也不抹」的前提）
- [ ] **`annosWritable` 是 DEV-only 观测量** ⇒ "这一按该不该被拒"在 release 上只能由状态栏那句 + 盘上枚数判；
      本轮 release 因此**只量了 pre-doc 那一档**，而 ● 那一格在这一臂根本没有编辑动作（只写日志不判）
      ——**v0.83 起"读全"那一档有了 release 可见的取反面**（重试成功那句「标注已读全：N 枚，现在可以存回文件了」挂在
      状态栏）；"拒绝"那一档的观测面没变（失败句 + 盘上枚数）
- [ ] **确定性坏结构的失败重跑开不了门**（v0.83 的实测边界）：十二枚坏形状里十一枚根本到不了失败态（pdf.js 逐页容错，
      `outcome:gated-open`），唯一真失败的 b12（`/Pages` 树一枚 kid 指向错类型，pdf.js 数 4 页而 pdf-lib 认 3 页）
      按多少趟把手也只有"再说一次同一句拒绝" ⇒ 重试的收益**只属于瞬时失败**（网络盘抖动、文件正被别的进程写），
      坏结构那一头要的仍是"重新打开"
- [ ] **release 上没有"重跑真的又跑了一趟"的可观测面**（v0.83 量死的缺口）：console 代理不存在（`ctrl-B4c`/`exp-B4c`
      `kidTotal:0`——pdf.js 那句失败是**返回值**而不是 console error）⇒ 这一格从此只能由 dev（`getPage` 计数）/
      结构 / 变异判；卖点落在 dev 独有观测面时要明写这一条（v0.79 那条纪律的又一次兑现）
- [x] **只跑了 4 页与 12 页两枚件**（v0.83）：2300 页那一档的失败重跑没有量过，而"重跑一趟的代价"恰好在那一档最大
      （整趟逐页 `getPage` + `getAnnotations` 从头再来）——**v0.84 已量**（前置实测五格 + 重跑缺口补一句进行中的话，
      见 v0.84 那一节）；重跑仍是整趟从头而非续扫（有意，就绪账必须整片）
- [x] **把手在重跑在途期间仍可按 = 静默 no-op**（v0.84 只补了句子没补禁用）——**v0.85 已补**：「在途」翻成
      一枚 `annosScanning` 状态，把手第三参吃它，清与 ref 收回同吃一枚身份卫兵；在途门本身一个字没动
      （见 v0.85 那一节）
- [ ] **release 无「重跑又跑一趟」与「在途那一句」的到达面**（v0.83 那条原样挂着 + v0.84 的 A/B 明写跳过）：
      到得了重跑在途状态的唯一注入缝 `docProxy` 是 DEV-only，那句「正在重新导入标注…」形状上挂在状态栏、release
      可见，但"按把手之后它真的出现过"在 release 上造不出来 ⇒ 这一格从此只能由 dev / 结构 / 变异判
- [ ] **重跑墙钟差（2543ms 失败靠前·冷 vs 81ms 失败靠后·暖）归 pdf.js 的页/注解缓存暖度，只在 dev 量过**：
      两个位置的调用数都是整趟 2300 枚 ⇒ 差的不是算法；release 上的墙钟没有读数
- [ ] **标注导入全程不发进度**（v0.84 量成形状）：首扫「正在加载…」一句顶全程（6659ms / 2300 枚调用期间状态栏
      无进度），重跑那句「正在重新导入标注…」是这一路唯一的话；百分比没做（导入没有用户可校准的档位）
- [ ] **`docProxy` 是量具唯一的注入口**（v0.83 的取舍而不是缺陷）：S12 钉住它只住在 DEV 块内、不许泄漏到 release
      （M15 响），代价是产品为量具多一枚 DEV-only 出口
- [ ] **reload 换出新 doc 那一段只由结构判据钉住**（S4 全仓无销账 + M10 换 doc 时销账要响）：dev 腿最终那一跑
      （`dev3.log` 26 条）**没有 L 段**，读到 `FAIL L0 {"读全":true,"内存":0}` 的是被推翻的那一版 ⇒ 这一格的形状证据
      属于"错法被量到"而不属于"最终版跑过"
- [ ] **两支的「侧栏落定」时长差未归因**：同一枚 2300 页件、同一把尺，对照件 1498/1472/1488ms 而实验件
      6741/6710/6763ms ⇒ 本轮的闸门买的是"不抹"而**没有**买导入的快慢；这一格要么是 v0.80 那枚
      `PDF_OBJECTS_PER_TICK` 在导入这一路上的副作用（同一枚常数也喂 `PDFDocument.load`），要么是这一臂时序不同，
      两种都没量
- [ ] **小件那一档的 A/B 没跑**（v0.81）：本轮 release 只跑 2300 页件；12 页那一件只有 dev 腿 S 段的形状
      （S1/S2/S3：账记上、画一枚落盘 41 枚、「已保存」+ ● 归 0）
- [ ] **t4000 与最快那一档只由 dev 侧的粒度阶梯量过**（页内墙钟 57 / 55ms，而单枚同步块 35 / 65ms）：本轮选 1500，
      更激进的两档没在 release 真机走过 ⇒ "再省 18ms 值不值一枚 65ms 的块"没有真机判据；
      `PDF_OBJECTS_PER_TICK = 1500` 是本机单机的数，换机器要重扫那根阶梯（4ms 的钳位是 Chromium 的而不是我们的）
- [ ] **release 上没有分段落点** ⇒ 分段归因只能来自 dev（v0.80 为此临时改过一份 `PdfViewer`，产物已删）：
      想要长期观测就得给存盘那一路做正式的打点通道，否则下一轮"再省一档"又要重摆一遍临时探针
- [ ] **页面操作五路（旋转/删除/提取/合并/拆分）wired 而没在真大件上量过整趟**：v0.80 的结构腿与变异腿判的是
      这六处各吃了那一枚常数（S2a/S2b/S3a/S3b + M1~M6、M10），而 2300 页件上"旋转一页要等多久"仍然没有读数
- [x] **演示头的失败仍只进原生弹窗、不上状态栏**（v0.71 只补了文档头这一半）——**v0.72 已补**：前置实测先把它坏在哪儿量清楚（可写件那一路本来就是对的：`dots=[0,1,0]`、字面真落盘、「已保存」在屏 1499ms、按键→出门 3ms、`write_text_file` 自身 6~8ms、longtask `[]` ⇒ 本轮没有去修一个不存在的锚点缺陷，与文档头 v0.71 那处不同形），而**只读件那一路状态栏全程 `[null]`**、失败只落在阻塞式 `#32770` 里（前=0 后=1 峰值=[1]，写请求确实出过门 440+7ms）⇒ 与 v0.70 给 PDF 头补的是**同一格**；本轮把 `save()` 的 `catch` 换成 `setStatus(failStatus(e,'保存失败'))`（原话留悬停、不再新立弹窗、● 留 1 而不记成已存），连按两次那一路量到**第二句在改前只活 489/496ms**（`cancel` 的第二个用途在这一头第二次兑现，而且是量出来的不是搬过来的）；三档 2/60/150 页整趟 **5 / 8~9 / 13~14ms** ⇒ **这一头连门都不挂**（`SAVE_BUSY_MS=200` 在这一路根本没有调用点，A9a/A9b 那类"没接"判据继续在）。**本轮没有把文档头那套"写手／动作"分层搬过来**——三个动作（`save`/`exportPptx`/`exportPdfTo`）各自直接写文件、没有共用写手的形状，硬抽一层就是为不存在的问题建层；只搬真正被复用到的东西：收尾时钟与句子归模块，而 v0.71 的 `base` 参数在这一头同时服务三个动作（D5a~c 直调 `__oofPpt.exportPdfTo` 判「已导出 PDF」而不是「已保存」且 ● 不清账）。验证：release A/B **18 断言 / 真失败 0**（对照件＝改动前存档的 0.71 exe；R2c 判的就是对照件全程没说任何一句 ⇒ 判据不是空的；R3b 改后 1501/1506ms；按键→上屏 14→12ms、写自身 [6,7]→[6,6]ms ⇒ **本轮没让写侧变快**）、dev 真机 **20 / 0、页面异常 0 条**、前端结构 **36 / 0**、变异 **14 枚 + 正控制 / BAD 0**、`cargo test --lib` **97 / 0 / 11**（Rust 一个字没动）
- [ ] **收尾时钟只收了存盘这一路**：文档头（v0.71）现在吃 `saveDoneTimer`，而**导出那几路仍各持裸时钟**——
      `SheetEditor.exportPdfTo:875` 那句「已导出 PDF」还**内联抄了一份拼句公式**（`notes.length ? 5000 : 1500`，
      与模块里 `saveDoneText` 同一形状的两把尺子）、`DocEditor` 剩四枚（`:501` 导出 PDF 的 1500 与批注/脚注那三句的 1800）、
      ~~`PptEditor` 三枚（`:213` 保存、`:230`、`:258` 导出）~~ **⇒ v0.72 改口：演示头那三枚已经归到模块那一枚 `saveDoneTimer`**
      （代价记着：导出 pptx 那句的停留从自持的 2000ms 变成模块的 1500ms——两把尺子并成一把必然有一把 shorter，
      这是买到的东西不是副作用）；剩 `DocEditor` 四枚与 `SheetEditor.exportPdfTo` 那份内联公式；再收就得先定"导出与存盘是不是同一句话"（现在不是：一句说导出、一句说保存，
      而 v0.71 的 `base` 参数正是给这一件事开的口子——它在文档头已经同时服务两个动作）。**v0.73 顺带定了另一半**：
      定时自动保存那一路**不该**吃这枚时钟——它的句子是"最近一次结果"而要挂到下一次结果出来（实测 40417ms），
      1500ms 的收尾恰好会把它抹成上一轮那句过期的成功宣称 ⇒ 这一路从此是"共用文案（`failStatus`）而不共用停留"的那一档
- [x] **`.odoc` 的定时自动保存写失败时一句都不说**（原 `DocEditor` 那一路的 `catch {}`）——**v0.73 已补**：前置实测量到的
      缺陷比"没话说"更糟，是**说错了话**——只读件整窗 0~70333ms 屏上只有「已自动保存 16:11:20」那一个值，而同一窗里
      `write_text_file` 出门两枚（`s=29802 d=5` / `s=59801 d=8`）、一次都没落盘、● 全程 1 ⇒ 那句挂的是一个已经不真的时间；
      恢复可写之后屏上变成两个「已自动保存」，**中间那两次失败界面从未承认**；冷开只读件更是整窗 `["∅"]`、有字的拍数=0。
      本轮的修法只有一句 `setStatus(failStatus(e, '自动保存失败'))`（原话留悬停）+ 撤句走身份比较（`cur === mine` 才撤，
      手动存盘的「已保存」不归它管），**没有**给它挂进度门也**没有**共用那枚 1500ms 收尾时钟——这一路的句子是
      "最近一次结果"，实测失败那句活了 **40417ms** 到整窗末拍 70331ms，用收尾时钟抹它等于让原缺陷换个速度复发（A5a/A5b + M7/M8）。
      验证：release A/B **32 断言 / 真失败 0**（对照件＝改动前存档的 0.72 exe；C-R1a/C-R1b/C-R3a 三条判的都是对照件 ⇒
      判据不是空的；E-R3a 恢复后失败末拍 19571ms 与成功首拍 19581ms 相邻）、dev 真机 **13 / 0、页面异常 0 条**
      （D4b 另判"闸门没被改宽：手动存盘后 35 秒里写请求枚数=0"）、前端结构 **35 / 0**、变异 **18 枚 + 正控制 / BAD 0**、
      `cargo test --lib` **97 / 0 / 11**（Rust 一个字没动）；写自身 5~8ms、`longtask` 0 条 ⇒ **本轮没有让任何东西变快**
- [x] **另外三头没有任何定时自动保存**（v0.73 收尾时 grep 全仓 `setInterval` 判出来的形状）——**v0.74 补了演示那一半**：
      `.opd` 现在也吃同一套四条规矩（不脏跳过 / 只在写成功之后 `markDirty+setAutoSavedAt` / 只撤自己那句 /
      失败上状态栏且仍自然重试），走 `registry.runExclusive` 与手动 `Ctrl+S` 共用同一把在途锁；A/B 里
      对照件那 45 秒探针一次没响（写清单 `[]`）＝**"根本没有这一路"被空手证明**（`probe===null` 是判据不是腿崩），
      改后两趟 `重叠=[] 迟到=true` 且时间线走「已自动保存 X」→「已保存」→「已自动保存 X」。**表格/PDF 二头判过不做**
      ——不是没测到而是"要不要做"的答复在**保真契约**上：`.xlsx`/`.ods`/`.csv` 是 foreign 格式，静默重序列化会丢
      第三方应用的属性（v0.34 的 CSV 只存首表、v0.46~v0.63 的 xlsx/ods 都在逐属性对齐 Word/Excel/LibreOffice），
      "挂着不动就自己存了"要先把"我们的写手能不能替用户下这个结论"回答完；PDF 的 `writeAnnosTo` 走 pdf-lib
      `save` **改的是文件本体**（v0.70 实测大件整趟 1150ms、中件 164ms 与门值 200ms 只差 36ms ⇒
      定时重跑必然撞上"跨机器翻脸"那一档）。未命名与 foreign 路径仍走手动保存，本轮没改这一层
- [x] **v0.74 顺带撞到的一条既有缺陷（本轮只在定时的成功那一路补了自己那一份）**：`PptEditor` 的 `dirtyRef`
      是"只在第一次编辑时 `markDirty(true)`"那一枚优化，而手存 `save()` 只调 `renameTab` 清了 store 的 `dirty`
      **不清 `dirtyRef`** ⇒ 手存之后的下一次编辑不会重新上 ●（关窗口也不会给"未保存"询问）。
      本轮只在定时的成功那一路写了 `dirtyRef.current = false`（那是它自己那份账，它自己写脏了自己清），
      手存那一路没动——修它得同时决定「手存之后又编辑 → ● 该不该亮」是不是 `edit()` 那一路的责任
      （**v0.78 拆闸**：那道闸连同**两份**复位一起删除，`edit()` 每次编辑都调 `markDirty(tab.id, true)`，去重归
      `store.markDirty` 那一层（`if (!t || t.dirty === dirty) return s`，脏值没变不触发订阅）⇒ 买的东西是重复的而代价是整条链断电。
      前置实测把"坏在哪儿"量成四格而不是感觉（release，改动前那支 0.77 exe）：**● 回不来**（=0 等到超时）、
      **再编辑之后 75 秒窗内 `write_text_file` 枚数 = 0**、**切回窗口那枚 focus（@79686）换来 0 枚探写**（v0.77 那一路被同一枚门挡住）、
      **晚打的 `_a2` 不在盘上**——而屏上从头到尾挂着「已保存」；同形对照 `.odoc` 那一头本来就是对的（● = 1、窗内写 1 枚 @[30499]、`_b2` 在盘上）
      ⇒ 缺陷归演示头那一道闸，不归 store、不归 `runExclusive`、不归 v0.75 那本账。真机四臂 49 条 / 真失败 0：
      **ctrlA**（0.77 对照件 `.opd`，11 条）C2a ● 起不来 / C3a 90 秒窗内写枚数 = 0 / C4b 焦点之后写枚数 = 0 / C4c `_a2` 不在盘上，
      写全表只有一枚 `[{"s":439,"d":4}]`；**expA**（0.78 `.opd`，16 条）写全表 `[452/5, 30461/6]`、E2a ● 回得来、
      **E3b `_a2` 真在盘上**、E3c 落定之后 ● 归 0、E3d/e 「已自动保存 11:27:10」+ 悬停会话账、E4b 焦点窗内写枚数 = 0（不脏就不该敲门）；
      **expB**（`.odoc` 同形对照，7 条）证明文档头一个字没被顶掉。判据换成 A1b/A2a（不再有这枚 ref）、A3a（标签的账仍由
      `s.markDirty(tab.id, false)` 清）、A3b（标脏只归 `edit()` 一处），M3 把 store 那层去重拆掉就报
- [x] **「已自动保存 X」这一路没有任何次数账，也没有退避**（v0.73 留下、v0.74 未改，**v0.75 补上**）：改前的形状是那句
      「已自动保存 X」没有悬停原话（成功没有原话可挂，但也没有"这一路失败过几回"），30 秒定时无退避、无"连续失败 N 次就停"
      ⇒ 一枚只读件挂着不动会每 30 秒发一次注定失败的写请求（v0.73 量到 70 秒窗内 2 枚；v0.75 前置实测把它挂满 4 分钟，
      量到 **8 枚**、间隔逐枚 30.0 秒（漂移 ≤9ms）、每枚自身 5~14ms 而一次都没落盘）；本轮新建 `lib/auto-save.ts` 把
      "隔多久再来一枚 / 失败第几回 / 那两句话怎么说"收成一处，两头共吃：`autoDelayMs(fails)=min(30_000*2**fails, 240_000)`
      ⇒ 同一个 240 秒窗 **8 枚 → 3 枚**（实测 E1a `[30280,90287,210300,450309]`、E1b 间隔 `[60007,120013,240009]`），
      失败那句带「第 N 次」+「X 秒后自动重试」（E2a 第 1/2/3/4 按序、E2b 封顶 240），成功那句的悬停第一次有会话账
      （「本次会话自动保存：成功 1 次 · 失败 4 次 · 30 秒后再检查」，E5d/D4c；对照件那一格是空串 `tip=""`，C6）；
      **没做成"连续失败就停"**（停掉之后权限改回来也再也存不上），而退避换来的"解开权限还要等下一枚"由
      手动存盘那一路的两件事抵掉（`clearBackoff()` + 撤掉在途那一枚重挂：E5b 再编辑后 28870ms 就落盘，不重挂要等 ≈218 秒）；
      账按标签一份（`useRef` + 工厂，A34 + M16）；验证：release A/B **27 断言 / 真失败 0**、结构 **54 / 0**、
      变异 **25 枚 + 正控制 / BAD 0**、dev 真机 **16 / 0、页面异常 0 条**、`cargo test --lib` **97 / 0 / 11**（Rust 一个字没动）
- [x] **过期失败宣称的撤句权从"谁写的这句"换成"这句话说的是哪个文件"**（v0.73 立"只撤自己那句"时留下的洞，**v0.76 补**）：
      手动 Ctrl+S 在同一枚文件上写的「保存失败」不属于定时那一路，于是它永远撤不掉。对照件（0.75）实测：权限改回来之后
      下一枚退避时钟真的把文件存上了（`write_text_file` @450335+10、字面在盘上、● 归 0@450363），而那句「保存失败」
      从 213961ms 挂到整窗末拍 470959ms（**过期 20614ms**），同一窗里「已自动保存」**一次都没上屏**——它挂在 `!status`
      之后，堵死它的正是那句过期宣称。现在两头的失败句都登记成 `FailureClaim { msg, path }`，模块里 `staleFailureClaim`
      按路径认领（不命中给空串）、身份比较那一半原样保留，定时成功那一路的次序钉成判据（取句 → 清自己的账 → 按身份撤），
      手动那一路把 `let target` 提到 `try` 之外才活得过 `catch`、手动成功把这份认领清掉；实验件 **71ms** 就换成了
      「已自动保存 00:43:03」（落定 450309 → 成功句 450380）且悬停带会话账。本轮另记一条裁决：**手动那一趟失败
      既不归零退避也不重挂时钟**（失败就是"此刻仍写不上"的证据，E3b：手动 @213795 之后下一枚自动仍排在 236509ms 的封顶档）。
      验证：release A/B **17 通过 / 真失败 0 / 显式 SKIP 1**、结构 **66 / 0**、变异 **21 枚 + 正控制 / BAD 0**、
      dev 真机 **12 通过 / 0 失败 / 1 显式 SKIP、页面异常 0 条**、`cargo test --lib` **97 / 0 / 11**（Rust 一个字没动）
- [x] **退避之后"权限解开了"这件事在界面上仍要等下一枚时钟**（v0.75 留下的代价，**v0.77 兑现**）：
      封顶那一枚要 240 秒，v0.75 用"手动 Ctrl+S 拉回 30 秒节奏"抵掉了最常撞的那一档（E5b 实测 28870ms），
      而"窗口重新获得焦点就立刻探一次"那一路当时没有 ⇒ 用户不改权限、不按键地干等，最坏仍是 240 秒；
      **v0.76 把这一路的可行性判死了：页面这一侧没有可用信号**（失焦再找回的整窗里只有 `blur` 上账、`focus` 一次都没有、
      `visibilitychange` 从不触发，`document.hasFocus()` 只能靠 200ms 轮询读到 1→0→1）⇒ 这条裁决**量错了对象**：
      观测器挂在 DOM 那一层，而 Tauri 的窗口事件 `tauri://focus` **会到**（Alt+Tab 切回之后 Δ533ms 上账，
      比轮询读到 `hasFocus()` 还早），并且 `getCurrentWindow().onFocusChanged` 走的是 core 已有的事件通道——
      **不需要新命令、不需要动 capabilities、Rust 一个字没动**；买到的那一格（两支真 exe）：只读件挂到退避封顶、
      权限改回来再切回窗口，**对照件（0.76）解权→落盘 225336ms**（等自己那枚封顶时钟），
      **实验件（0.77）32945ms 且那 32.9 秒全部是"焦点回来"所花的时间**（focus @257554 ⇒ 写 @257554、Δ0ms，
      字面独立读盘确认真在、成功句在落定之后 13ms 上屏、● 归 0、过期失败落定之后 0 拍），
      而**两臂总写枚数 4 vs 4**（探写把这一路并进同一枚时钟而不是加一枚：对照件那枚 `w2+120s` 的位在实验件上是空的）；
      节流下界取这一路本来就有的 `AUTO_BASE_MS = 30_000`（实测人能敲出来的最快 focus 是 3535ms 一枚，
      连打 6 次 Alt+Tab 只得到 3 枚），真机两边各 7~8 枚"下界之内的 focus"换来 **0 枚写**
- [ ] **`AUTO_MAX_MS = 240_000` / `AUTO_BASE_MS = 30_000` 是**本机单机的数**（那笔"8 枚/4 分钟"的账没跨机器复核，
      与 `SAVE_BUSY_MS=200` 同一类待复判）；v0.77 之后 `AUTO_BASE_MS` 还多了一重身份——**它同时是退避基数与焦点探写的节流下界**，
      改它得同时想两件事（要拆开就得新增第二枚常数，而那一枚数同样是单机的）
- [ ] **探写的下界是"每一枚标签各自的下界"**（v0.77 的形状而本轮没量）：`lastAttemptAt` 住在**按标签持有**的账本里
      （v0.75 那条"绝不做成模块单例"在这里反过来变成代价），所以 N 枚标签就是 N 枚各自的 30 秒下界 ⇒
      切回窗口一次会**给 N 枚各探一次的许可**，后台常驻的 N 枚只读件可能在同一秒各发一枚写请求；
      这一格与下面那条"N 枚标签各挂自己的时钟"同源而同解，要做先答"要不要一枚全局的敲门账"
- [ ] **焦点事件只说"窗口回来了"，不说"权限改回来了"**（v0.77 的取舍而不是缺陷）：权限没动的每一次切回，
      只要标签还是脏的就会撞一枚**注定失败**的写（30 秒下界挡住了绝大多数，而挡住了不等于免费——
      它换来的是「第 N 次」再 +1、退避再翻一倍）；要真分辨"值不值得再试"得先问界面上有没有一个比焦点更准的信号。
      v0.76 那条同一族的裁决记在这里而不是抹掉：**手动那一趟失败仍会把那句失败留在屏上等下一次自动那一路**
      （本轮之后"下一次"多了一种可能是探写，但那句话本身该由谁撤的规矩没改）
- [ ] **这台机器上有第三方在前台抢焦点，release 腿凡是按"helper 调用返回时刻"的判据都会随机红**（v0.77 撞了两轮的量具账）：
      这一趟 E 臂起跑时前台是 `cline-app`、上一趟是 Chrome 的 "WorkBuddy"（pid 35964），
      而**没有真的 blur 就不会有 focus**（实测外部 `SetForegroundWindow` 抢走再抢回 ⇒ 0 枚 focus）⇒
      焦点的账只能读页内那枚独立监听，锚要取"触发之后事件账上的第一枚"而不是量具自己返回的那一枚；
      下一轮如果要继续走焦点这一路，先想清楚这条噪声环境
- [ ] **dev 的 `React.StrictMode` 在开标签那一刻就把标签标脏**（v0.77 的 dev 腿量到）：于是"不脏就不写"这一条
      **只能在 release 腿判**，dev 的 ● 起点不是 0；同一轮的 dev 腿另立了两枚形状规矩——
      `plugin:event|listen` 的**回执要先轮询到**再去读 `listen`（读早了拿到 `[]` 而同一趟后面真的数到 4 枚 focus），
      以及"只在文本签名变了时记一笔"意味着**判 ● 要判当前那一格**而不是要求出现新的变化点
- [ ] **N 枚标签仍各挂自己的时钟**（v0.75 只做到"每一枚自己退避"，没把 N 枚并成一枚）：`Workspace` 把开过的标签全部常驻
      （v0.68 那条），所以 N 枚 `.odoc`/`.opd` 就是 N 枚自续时钟；后台常驻的只读件现在各敲各的、只是每枚都敲得少了。
      真要并成一枚得先回答"账并了之后失败那句该报哪一枚标签的事"——那是话头串台，比时钟串台贵
- [x] **`.opd` 那一头的两格只吃了结构判据，两腿真机都没在它上面跑**（v0.76 记一格，**v0.77 又添一格**）：A/B 与 dev
      这两轮都跑在 `.odoc` 上，演示头那一格的 P1a~P4d 十五枚（按路径认领）与 F4a~F4g 七枚（焦点探写）全是接线
      ⇒ 同一格在 `.opd` 上没有真机数字；下一轮要么补那一趟（把两格一起量掉），
      要么把 README 里"两头共吃"这句降格成"一头量过、一头照接线"
      （**v0.78 把这两格一起量掉了**，没有降格：expC 臂在 `.opd` 只读件上跑焦点探写 ⇒ G3a focus 1 枚 @72094、
      G3b 探写 1 枚 @[72094]、**G3c Δ 0ms**（判据是"排在 30 秒下限之后"，gap 39934ms，而不是枚数）；
      同一臂量按路径撤句 ⇒ G5a 落定 72103ms 之后那句过期失败最长活 **4ms**（一枚采样间隔；改前那支 0.77 同形状量到 **8ms**，末次失败拍 30216/30217）；
      dev 腿 D5 段同形另有 **11ms**，且 D5a~d 里 focus 2 枚（StrictMode 双挂载）而探写只有 1 枚 ⇒ **dev 吃形状不吃枚数**；
      G4a `_c1` 真落盘、G4b/c 成功句 + 悬停会话账、G4d ● 归 0、G5b 页面异常 0 条）
- [x] **拆闸换来的按键成本没量**（v0.78 留的，**v0.79 量掉了**）：去重住在 `store.markDirty` 那一层，于是**每枚按键**都要过一遍
      `getState()` 与脏值比较才得出"不触发订阅"；dev 的 D2a 只证行为（● 回得来）不证成本 ⇒ v0.79 的前置实测直接给 `markDirty`
      包了一层壳去数：单次中位 **0.1ms** / 最大 0.3ms，已脏之后连打 4 枚合计 **0.400ms**（改后 4 次调用）／**0.900ms**（改前 8 次），
      而这 4 枚按键带来的 store 通知 = **0 次**（去重成立）⇒ **"每次都标脏"这一条不贵，贵的是它当时被调了两遍**；
      没量到的那部分另开成下面那条（20 枚标签的形状）
- [x] **`markDirty` 调在 `setDeck` 的 updater 里面**（v0.78 的形状债，**v0.79 搬出来了**）：updater 按约定是纯函数，而它被跑几遍
      由不得我们——dev 真机量到**一枚按键两遍**（一遍在 `dispatchSetState` 的 eager 路径、一遍在
      `basicStateReducer ← updateReducerImpl ← updateReducer ← Object.useState` 的渲染阶段），React 为那第二遍直接报 DEV 告警
      「Cannot update a component (Workspace) while rendering a different component (PptEditor)」⇒ 那句搬到 `setDeck(…)` 之后
      （S1a~S1d 钉位置与 updater 纯度，M1/M2/M14 三枚变异分别钉"搬回里面""把那道闸连同那句一起搬回里面""在外面重新包一道闸"）；
      而 v0.78 留的那一问（"搬出来得同时决定哪一路保证标脏"）答案是**不用决定**——取新快照与标脏本来就是两件事，
      前者归 updater、后者归事件处理器
- [ ] **这一格在 release 上没有可观测面**（v0.79 新开的一条判据纪律，不是缺陷）：那条告警是 React **DEV-only** ⇒
      "渲染阶段写外部 store"这一类缺陷**只能由 dev 腿判**（告警 + 栈帧分类），release A/B 无从对照——本轮 A/B 读到的是"持平"，
      而持平就是它的正确结论；下一轮凡是卖点落在 dev 独有观测面上的改动，都要像这样在 README 里明写"这一格只有 dev 能判"，
      否则"跑了支真 exe 的 A/B"会被当成证据，而它什么也没判（与 v0.77「不脏就不写只有 release 能判」正好反向）
- [ ] **栈帧分类器是一把手工尺子**（v0.79 撞的量具账）：标记表（`dispatchSetState|onChange|editSlide|…` 对
      `updateReducerImpl|renderWithHooks|performUnitOfWork|…`）由本轮实测里出现过的帧名拼出，**React 换版本就要重校**；
      正控制（`setDeck(d => …)` 按契约必然在渲染阶段）只能证"这一版认得出"而不能证"下一版还认得出"，
      而它这一轮已经自毁过一次——第一版拿 `basicStateReducer` 当渲染标记，而两条路径上都有它
- [ ] **每次按键过一遍 store：成本量了而规模没量**（v0.79 留的下一格）：≤0.1ms 是在 1 枚与 6 枚标签之下读出来的，
      **20 枚标签同时挂着**的形状没量；同一轮另立的一条是 `setDeck` 的 updater 里那整片 `slides.map(s => ({ …s }))` 仍在
      （本轮只挪了一句），它被跑两遍时拷两遍的成本也没量——真要判这一格先得有一枚"按键→状态栏"的打点
- [ ] **本轮只在"一枚标签一枚文件"的形状上量**（多枚 `.opd` 同时脏时每枚各自的时钟、各自的认领关系仍未量）：
      与 v0.75~v0.77 那三条「N 枚标签各挂自己的时钟 / 下界按标签各自 / 认领关系没有变异钉」同源而同一条——
      expA/expC 两臂各只开一枚标签，而拆闸改的正是**每次编辑都标脏**这一条，标签数上去之后的写请求总量仍然没有上界
- [ ] **另存为／导出 pptx 之后"再编辑 ● 该不该亮"这一档 release 真机仍未量**（v0.78 新增的一格而不是旧的那道闸）：
      那两个动作不调 `renameTab`，所以它们**不清标签的脏**⇒ 导出之后 ● 仍亮着在当前实现里是必然，而它是否正确没有判据；
      与上面那条 v0.72/v0.76 的"原生对话框两档显式 SKIP"同族，要补得真挑一次对话框
- [ ] **"每枚标签一份认领关系"这一条本轮没有变异钉**（量具账而不是一条产品回归，v0.76 撞见的形状）：D1b/P1b 只吃
      `useRef` 的字面，把 `saveFailRef` 做成模块单例（于是两枚标签共享同一句、A 的自动保存会把 B 的失败句撤掉）
      没有哪一枚变异会响；v0.75 的 M16 钉的是**账本**单例而不是**认领**单例，要补就从那一条抄形状
- [ ] **会话账只留内存、且失败挂着的期间看不到总账**（v0.75 的取舍而不是遗漏）：`okTotal`/`failTotal` 关标签即没，
      也不写进版本历史那一路；而 `autoOkTip` 挂在**成功**那句的悬停上，失败那句挤掉它的期间屏上只有"第 N 次 + 下一次时间"
      （那一格同时能放一行——要不要把总账也塞进失败那句，等有人真在只读件上工作过再说）
- [ ] **长跑腿必须自己判"那一枚触发落没落"，而 CDP 的异常会被序列化成 `{}`**（v0.75 撞的，量具纪律而不是一次回归）：
      A/B 第一版报 **PASS 10 / FAIL 15**，15 条全是量具——`press` 那段 IIFE 在页内采样器装好**之前**就 deref 全局钩子
      ⇒ 抛 TypeError ⇒ **CDP 的 `returnByValue` 把 rejected promise 的拒绝理由写成 `{}`**（不报错，只给你一个空对象），
      判据拿到 `undefined` 就把整窗的写过滤成 0 枚，而同一趟的日志明明在报"8 枚"；另有 `mark(k)` 写成 `{t,k}` 的 shorthand
      ⇒ 页内 ReferenceError ⇒ 标记时刻静默变 `null`。**静默的空窗口比崩溃更贵**：崩了会停下来，空窗口会把"我没量到"
      报成一条判据 ⇒ 每趟长跑先立一枚守卫（本轮的 C0/E0/D0：编辑之后当前活动标签的 ● 必须为 1、触发时刻必须是数值）。
      与 v0.72 那条「按枚数索引之前，先问这些条目属不属于这一趟」同族而更进一层：**按窗口取值之前，先问这一趟的触发真的发生过吗**
- [ ] **同文两句在屏上会并成一拍，"说了多久"只能锚 IPC**：v0.71 的 R3a/R3b 第一版按"文本段枚数"判连按两次的收尾句，
      于是两趟都报「已保存」被读成一拍（`runs=[1499]`）——判据当场假 FAIL，而它指向的形状根本不存在；
      改成"从第二枚写的 `responseEnd` 起算那句还在屏上多久"才量到 504ms（改前）／1504ms（改后）。
      与 v0.70 那条「"结束"要按事件的完整集合定义」同族：**"说了多久"要按落定时刻定义，而不是按文案的边界**
- [ ] **中件 164ms 与门值 200ms 只差 36ms**：PDF 那一档在真机上"刚好不闪"是运气而不是设计——同一枚件换一台机器
      （或磁盘缓存刚冷）就会闪一句「正在保存…」再落定；这一条与下面那条 `SAVE_BUSY_MS` 的机器账要一起复判。
      **v0.80 只改口而不勾掉**：大件那一档改让出粒度之后实测 Δ 148/172/153ms、进度句三趟都不再上屏，
      所以"大件会开口"这一格已经翻篇；而**中件那一档本轮没有重跑**（A/B 只跑 2300 页件），
      它现在的 Δ 仍是 v0.70 那次 143~161ms 的旧读数，"差 36ms 靠运气"这件事在换机器上要不要翻脸仍未复判
- [ ] **在途锁按 `tabId` 不按 `path`**：同一件文件开两个标签（今天 `openTab` 按路径去重，走"找回已有标签"那一路，
      所以撞不上）时锁就管不到跨标签同路径并发了；真要先改的是去重还是锁，得等出现"两个标签指向同一文件"的形状
- [ ] **`SAVE_BUSY_MS = 200` 是本机单机的数**：它在 115~131ms 的同步块与 471ms 的 IPC 之间取了一档，
      没在别的机器/别的盘（NVMe 与机械盘、是否刚写完缓存冷）上复核过；换机器后小件开始闪一句「正在保存…」
      或大件迟迟不说话，第一嫌疑是这一枚常数而不是接线
- [ ] **另存为撤门那一档只有结构判据（A7），release 真机没量**：那条走的是原生保存对话框，
      冒烟要按 `EnumWindows` 数窗口再 `PostMessage(WM_CLOSE)` 关（v0.64 的量具坑），本轮没为它单开一趟；
      真机上"对话框立着的那几分钟屏上到底写什么"仍是推断。**v0.72 同一族还多两档**：演示头的**另存为…**与**导出 pptx…**
      各持一次原生对话框、也各吃一次 `base`，本轮在 dev 与 A/B 两腿上都是**显式 SKIP**（`pass=null`）而不是让"计数为零"
      在跳过的档上冒充判据 ⇒ `base` 在那两路上目前只有结构与 dev 的证据（D5a~c 那一路是直调 `exportPdfTo`、不需要对话框，才量得到）。
      **v0.76 同一族又添一枚**：「另存为到别的路径」之后那句失败**不该被本路径的自动保存撤掉**，两腿都是显式 SKIP
      （`X1`，`pass=null`）⇒ 它只吃结构判据 D3a/P3a（登记的是它自己写的那个路径）与 A2b（路径不命中就给空串）
- [ ] **演示这一头连 `notes` 通道都没用过**（v0.72 量出来的）：`done.show([])` 三次传的都是空数组，
      所以模块里"带说明的 5000ms 那一档"在 `.opd` 上从未被真机走到——这一头只证了 1500ms 的那一半；
      要补得先给演示找到"有哪些说明可报"的形状（表格有导入告警、文档有脚注/批注账目，演示的序列化目前没有这类账）
- [ ] **二次启动与文件关联转发没有任何腿覆盖**：单实例插件把第二次双击的路径经 `oof://open-paths` 转给已开窗口，
      这一段既没有规格腿也没有真机腿（真机腿都 attach 在唯一那个实例上）；本机现场还见过一支**外部构建**的
      `openoffices.exe` 0.37.0 在 `Failed to init single instance`（要 `--first-instance-path`）上 panic——
      它的 build 路径与 `Cargo.lock` 里的插件版本都不是我们的，所以不是本轮回归，但**这一路确实没测过**：
      重复启动不 panic、路径真能落到新标签，得单开一条腿（要真的起两次）。
      **v0.76 这一条从"没测过"升级成"它已经咬过一次 A/B 腿"**：after 腿第一次跑就附着在一枚 144 秒前起的老页面上
      （页内时钟 144218ms、多出一枚不属于本趟的写、首拍是遗留的「已自动保存」），三条判据当场报 FAIL 而产品一个字没错⇒
      长跑腿起跑前收掉**本项目 `src-tauri/target` 下**那两支（已装正式版不在这个前缀里，照旧不碰）、附着后先验
      页内时钟刚起步，并把这两件事写成判据（本轮的 Cb/Eb）而不是只写成日志——**"跑起来了"不等于"跑的是这一趟"**
- [ ] **判据吃"缓存枚数"这类观测量时，正控制必须自己先证明会响**：本轮两枚假绿都来自这里——
      `textPages() >= total` 在 `t=0` 就成立（于是"热缓存 31ms"是腿自己第一拍返回的），以及**被作废的那一趟停在门上、
      按页号退出而不是扫满**，在它后面量"热"就会量到接近冷的数；换量位置之前先问这一条判据在第一拍成不成立
- [ ] **失败归因只覆盖本机中文 OS 的原串**：判据靠 `os error` 编号与第三方库的英文词形，换英文/其他语言的 Windows
      上括号前那截中文归因照旧（编号匹配不受影响），但"原话本身是否已经可读"这一条没测过；
      另外判据表是**按本轮撞到的档列的**，不是穷举第三方库的抛点——没列出的原串仍会以"原样带出"收着（这是设计而非缺陷）
- [ ] **写侧前缀三家不统一**：同一次存盘失败在文件那边可能报成 `保存失败`（对话框标题）／`ODS 写入失败: …`（`ods.rs`）／
      `无法写入 {path}: …`（`csv.rs`）／`无法打开文件: …`（`xlsx.rs`）——归因表都吃得下，但**地点那一截的说法随格式换**，
      状态栏说的话取决于文件是什么后缀；要收得先定"前缀归谁给"（Rust 侧还是调用侧）
- [ ] **加密 PDF 的密码只留在这次会话里**（v0.65 定的诚实边界）：关掉标签就没了、也不写进任何文件（独立字节腿
      扫 `localStorage`／`sessionStorage`／`IndexedDB` 的两份编码都扫不出那串密码，而同一处扫得到最近文件的路径 ⇒
      扫对了地方），于是**重开同一件加密 PDF 要再输一次**；没有"这次会话记住"的选项，也没有把密码交进写侧的通道
      ——那不是我们偷懒：pdf-lib 1.17 不解密，`ignoreEncryption` 只是"照样坏"
- [ ] **同一件 owner-only 的文件在两头说的话不太一致**（本轮量出来的）：它**不问密码**就能看（用户口令为空），
      而 rotate 报的是「设了密码的 PDF 只能看、不能在这里改」——按字节它确实设了 owner 口令，句子不算编的，
      但"从没问过密码"与"它设了密码"这两件事界面上没有对上眼；「权限限制」与「口令限制」也没分
- [ ] **`disposed` 那道门只补在了本轮撞到的写点上**（v0.65 是密码面板与 `rangeModeRef` 两处，v0.66 又补了搜索循环的两处：
      `await loadPageText` 之后先判再写、收尾那一句之前）：`PdfViewer` 里其余的
      `setState`/ref 写入仍是"最后一句挂个 `!disposed`"的形状，本轮没有系统盘过"旧趟还会盖掉哪些共享状态"；
      开发模式的**双挂载**不是噪音，它是一台免费的并发测试机——下一轮动这块前先想这一条
- [ ] **RC4-128 那一档的算法名不在字节里**：加密字典只有 `/R 3 /V 2 /Length 128`，没有 `/CF` 也没有 `/CFM`
      （AES 那两档才把 `AESV2`/`AESV3` 写出来），所以"这是哪一路加密"只能按编号推。本轮四件自造夹具覆盖的是
      V2/V4/R3/R4 这几档，真件里遇到 R 4 / V 1 之类的怪组合时判据说什么还没测
- [ ] **失败提示仍寄生在状态栏那一枚字符串上**：本轮的"一条字符串带两行"是**取舍**不是终局——四类编辑器各有
      自己的 `status` 生命周期，"三秒清除还是留着"的分歧本轮只在 `PdfViewer` 的 `pageOp` 改了一处，其余仍各自定时；
      独立的 toast／通知层（可复制原话、可停留）没建
- [ ] **自动更新：`Home` 与 `Workspace` 互斥挂载 ⇒ 切走再回来，检查与下载两拍的状态一起丢**（v0.82 的 D18
      第一次把它量成形状：`{那块:"版本 0.82.0检查更新",排:"检查更新"}`——已经下好的 10 MiB 白下了，得从
      「检查更新」重走。要不要把这份状态搬到 store 那一层没有判据，本轮只记账不修）
- [ ] **装前那道闸只认脏账枚数**：`tabs.filter((t) => t.dirty).length` 读的是同一本账，而"关闭脏标签时那条确认"
      是另一条既有链路，两者没打通；**没有路径的新建脏标签也算一处**（有意宽口径——宁可多拦一次，代价是用户
      可能不明白一张空草稿凭什么拦他）
- [ ] **`available` 那一档在仓库占位端点下真机根本到不了**：私有仓库的 Release 对匿名访问就是 404，所以
      "下载/安装"两拍的所有真机证据都来自**构建期注入**的本地 http 源（`-c` 喂端点 +
      `dangerousInsecureTransportProtocol`，只允许出现在测试件上，仓库配置零枚 = S7a/M7）。
      **更新源托管仍未定＝端点继续占位**；**签名私钥无备份＝最大单点风险**（丢了就再也给不出更新，
      只在 `~/.tauri`，不入仓、不进日志、不进 argv）
- [ ] **真装只在一次性目录里验过**：`%LOCALAPPDATA%/OpenOffices`（已装正式版）2 行 vs 2 行逐格相同、全程未动，
      所以"装在用户真实安装上会怎样"（UAC、正在运行的另一份、快捷方式）本轮没有证据
- [ ] **整数百分比节流是本机 32~41 枚事件下量的**：慢网、更大的包没量（端到端两臂的档位 52 / 61 只当形状看，
      数量本身不判）；**mac 侧 `install()` 的形状未量**（那一头是"杀掉 app 再替换 `.app`"，退出语义与 Windows
      的 `exit(0)` 不同，闸的位置要不要跟着变没有判据）
- [ ] **"一枚按键换几枚下载请求"这一格只有 dev 能判**：StrictMode 双订阅下的 D6（`1` 枚包体 REQ）在 release 上
      没有对应场景；另"未保存闸"在 release 上的可观测面只有状态栏那句话 + 一次性目录没被建出来（没有 dev 钩子
      可读 `dl.stage`）
- [ ] **ODT 批注往返还有四档没对齐第三方**（v0.86 量出来记着的）：**LibreOffice/第三方真件未回归**（本机无
      ODF 第三方应用，v0.62 老规矩——往返证据全部来自自家读写两头互证）；**跨段批注写回收进首段、续挂从
      第二段开头**（锚位语义没有第三方真机可对，有意记账）；**点批注读侧锚在段落尾**，原始锚位丢了；
      **resolved 状态不往返**（ODF 1.2 的 annotation 没有这个通道，ODT 上它恒为未解决）
- [ ] macOS 打包（需签名/公证凭据）

## License

本项目代码 MIT；各内核组件遵循上表各自许可证。
