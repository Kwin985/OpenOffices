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
  （**v0.89 记账**：ODT 的**列宽两头都不往返**——写侧零枚 `table:table-column`、读侧不解析 `style:column`/`table:style`
  那一层的宽度；本轮明写不开：本机无 ODF 第三方应用、ODF 1.2 RelaxNG 三个源全 404 ⇒ 写出的形状无人可裁，
  见 v0.89 一节）
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
  （`mergeOrSplit`）、表头行切换、删除表格、**列宽输入框**（v0.91：键得出"这一列 90px"，命令 `setGridColumnWidth`
  一次写遍该网格列的每一枚真格子、其余列按现有账等比重排到可用宽，见 `lib/table-width.ts`）；导出补 `colspan/rowspan` →
  docx `gridSpan/vMerge` 与 odt `covered-table-cell`（**v0.89 起这一条通道也真写列宽**：`w:tblGrid` 真宽 + 逐格 `w:tcW` +
  `w:tblLayout fixed`，而此前导出件里的 `w:gridCol w="100"` 是 docx 库的默认假网格；ODT 那一头的列宽两头都还不往返；
  **v0.90 两半**：认账门只松「每一格都得带账」那一道 ⇒ 界面上拖一次得到的**部分账**（`[248]|null|null` 那一型）不再
  整表作废、没带账的列按剩下的版心补平，而拖列边界那条缝自这一版起才**看得见**（`.column-resize-handle` 此前一条样式
  都没有，实测装饰 rect 高 0）；**v0.91 把「每行 colspan 之和等于列数」那道门改成按占位走**（`gridShapeOf`：被竖跨
  压掉的格子算占位而不算缺格），此前含竖跨的表整表判成形状不合、宽度账整表作废；**v0.92 起屏上也吃这一份账**
  （`accountTotalPx`：整表每列都带账 ⇒ `table.style.width = Σpx`，与 docx 的 `w:tblW`（网格和）同一形状，键入的 90px
  在屏上就是 89.94；没账或部分账仍走版心比例那一档，逐格宽度与导出字节都不变）；**v0.93 起纸面也吃这一份账**
  （`@media print` 里 `.doc-content{overflow:hidden}`：内容比版心宽时不再让 Blink 把**整页**按比例缩小，而是把超出的
  那一段裁在版心右沿——实测 900px 的表纸上 scale 从 0.6981 回到 1.0004，前两列按 300px 真尺寸上纸、第三列被裁）
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
  （图片/代码块/引用/目录不跨页折断）、`orphans/widows: 2`——**表格从这一族里摘出来了（v0.94）**：`avoid` 让比剩余版心
  高的表整张推到后面一页，实测 22 行那张摊成 3 页而第 1 页 0 枚格标、页边空出 ~305px 只为等一张推得走的表；现在
  `.doc-content table{page-break-inside:auto; break-inside:auto}` 显式写流式，而**不给 `tr`/`td` 补 `avoid`**（注入候选
  实测：那一档在装得下的表上是纯 no-op，却把比一页还高的那一行退回同一缺陷），纸上的形状落到"表级流、行边界切、
  不劈行"——与 Word 16.0 自己分页那一头逐行落页映射同形。**代码块/引用/目录也从这一族里摘出来了（v0.96）**：同一枚
  缺陷在它们身上一模一样——40 行代码块那张纸上 3 页而第 1 页 0 枚行标（`inkBottom=99.7` 只有一段正文的墨），60 行
  引用 4 页而第 1 页同样 0 枚，页边三档（放 27/28 段正文再摆一块 12 行代码）改后第 1 页分别吃掉 3/2 行；而**图片留在
  这一族里**：它是替换件、没有内部断点，把 `avoid` 摘掉对它是纯 no-op（两件尺寸 300px 与 1200px 在"跟着摘掉"那一档
  注入里逐页同形、裁剪框位置也逐枚同），留着它才能如实说"图片不跨页折断"是这一族当前的边界
- **表头组（v0.95）**：表流着排之后跨页的第二页原本是一张无头表（实测 22 行那张纸上 `head 3/0`——第 1 页 3 枚表头标而
  第 2 页 0 枚），因为模型只把 `tableHeader` 落在**行属性**上、`contentDOM` 渲染成 `tbody > tr > th`，而浏览器在纸上
  只认 DOM 里真住的 `<thead>`（给 `tbody > tr:has(> th)` 单写 `display:table-header-group` 那档注入实测是纯 no-op）。
  现在 `IndentTableView` 按模型那份账**克隆**开头连续的表头行成 `<thead class="doc-th">`（搬移那一档会把模型吃掉——
  实测搬之后 `rows 23→22`、`thRows 1→0`），标记住在 `<table>`（`doc-th-rep`）而不是 `<tr>`，因为 PM 会擦 `contentDOM`
  里行的 `class`；CSS 屏上一条 `display:none`（克隆在屏上不占位，实测表高差恰为 0）+ `@media print` 两条
  （`table-header-group` 与藏 `tbody > tr:has(> th)`）。那道门只认「开头连续的全部表头行」，中途夹一枚表头行的表
  整块不建克隆，纸面与改前逐枚同形
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
  mammoth 降级为**兜底**：保真导入器抛错或 `blocks === 0`（认不出这份文件）时才用；而「保真导入器按名查过多少属性」从本轮起有一枚公开的账——见 `docs/fidelity.md`（属性级覆盖率，运行时探针生成）
- **覆盖**：run 级 `w:rPr`（粗斜/删除线/下划线/字色/高亮 `w:highlight` 与 `w:shd`/字族（拉丁+中文拆两档）/字号半点换算/字符间距 `w:spacing`（缇 / 20 折磅落 `letter-spacing`，含负值与 0——字符读侧第一笔账；同一枚换算从本轮起两头都写得出——字符写侧第一笔账））、
  段落 `w:pPr`（jc 对齐、`w:ind` 的 left/firstLine/hangingChars/firstLine/hanging、pStyle 样式链继承——**段落读侧第一笔账起
  `w:ind` 沿链按属性名合并**：同名的后写层压前写层而段落没写的属性留样式那一枚，`firstLine`/`hanging` 同一枚首行槽、字符那一档
  的宽度底数吃段落自己的字号；**段落读侧第二笔账起 `w:spacing` 走同一枝**——`w:line`|`w:lineRule` 是一枚槽而段落要连 `w:line`
  一起写才整槽归它，段前/段后仍按「行档压缇档、缇档的 0 是真值」判）、
  `w:numPr` + `word/numbering.xml` 的 numFmt → 有序/无序与 ilvl 层级、表格 `gridSpan`/`vMerge`（continue 记账在
  restart 的同一批网格列上，rowspan 数完所有行才出 HTML）+ `tblGrid` 列宽（**读侧从这一版就把这份账收全并摊成逐格
  `colwidth`——跨列格记「所覆盖的各列」而不是合起来的宽，而写侧一直没写回去，直到 v0.89**；**v0.90 起写侧改成「有几枚
  写几枚、没带账的列按剩余版心补平」**，因为界面上拖一次本来就只写被拖那一枚（`updateColumnWidth` 的形状），要求整表
  齐账等于把用户拖出来的宽度在导出时整表作废）；**v0.91 起写侧的网格形状按占位走**（`gridShapeOf` 把被竖跨压掉的格子
  算占位，认账与导出逐格游标共用同一份起始列账 ⇒ 含竖跨的表不再整表丢账，界面上也键得出精确宽度）；
  **v0.97 起读侧不再只吃 `w:gridCol`；第九笔账把行 0 那一层的次序倒过来（改由逐格 `w:tcW` 说话）；第十笔账起这份账第一次由 `w:tblLayout` 分流、且所有行一起上账**：
  `fixed` 那一档 `w:gridCol` 是**地板**——任何一行的单列格只往宽里抬、
  缩小不落（`x_fix_nw` 行 0 各 1500 缇而网格 60|90|120 磅 ⇒ Word 与本读手同为 75|90|120；
  `c_clash_sum_under` 落 60|90|120 而不是 tcW 原样的 30|45|60；`y_lookfirst_shrink` 同形），
  两行说同一列时**取最大而不是后说的赢**（`n_row12_big_first` / `_big_last` 两序都 105|90|120）；跨列格仍是「比它跨的那盘账还宽」那截上账、
  落所跨的**最后一条**网格列、负差丢（`n_row1_span_pos` 60|120|120、`n_row1_span_neg` 60|90|120、`f_span_fixed` 60|120|120、
  `i_span_under_fixed` 60|90|120），
  `w:vMerge=continue` 那一格的 tcW**根本不参与**（`n_row1_vmerge_continue` 只有「跳过 continue 那格」这一支对得上），
  而跨到缺账列时正差补进缺口（`n_row1_grid_hole` 60|90|120、`q_fix_span_hole1` 60|120|120）。
  `autofit` 与 `w:tblLayout` 缺失那一档反过来：**网格让位、缩小照落**（`x_aut_aw_shrink` 与 `x_non_nw_shrink` 30|30|30、
  `n_row1_only_autofit` / `n_row1_only_none` 75|75|45），逐列取所有行 tcW 的最大，
  跨列格那一份**均摊到所跨各列**而不是落最后一条（`z_aut_row1_span` 90|90|120，同一份声明在 fixed 那一档是 60|120|120）；
  一行都没说话的列退网格（Word 那里按内容重排，是账外）；
  **第十一笔账起逐格这一族第一次按型别收口**——闸门由排除法改成白名单：`w:tcW` 只有 `dxa`（或没写 `w:type`，按规格算 dxa）才是数字，
  `auto` / `pct` / `nil` / 规格外一律账外。`nil` 那一档是「这格没宽」而不是「宽是 0」，跟着 dxa 当数字读会造出一枚文件里没说的宽
  （`p_type_nil` 写 `w:w="1500" w:type="nil"`：旧读手 [75|90|120]、Word [60|90|120]＝声明的网格，改后两头同为 60|90|120；`t_nil_aut` 同形）；
  `pct` 的账外理由由「没有基数」改口成「基数是**表宽**不是版心，而表宽那道门还关着」（`r_fix_dxa4513_uneven`：折表宽差 0.02 磅/格、折版心差 90.27 磅/格）；
  规格外型别 Word 把数字继续用（`t_foo_aut` Word [75|75|75]）而我们账外，266 枚真件里 nil 与规格外各 0 命中 ⇒ 这道闸对真件可证是 no-op；
  `auto` / `nil` / `0` 的表宽仍不吃（第十二笔账把表级那道闸的 nil 同族缺口收掉，见下面那条），出账闸门仍是 `acctKnown = gridKnown || !!tblTotal`、
  发射门仍是 `ri === 0 && acctKnown` 配 `.filter((v) => v > 0)` ⇒ 上账的范围变了而**出账的形状没变**。
  **表格读侧第八笔账起，表级那一层的 `w:tblW` 只在整盘宽度账都没说时说话**（无 `w:gridCol`、网格全零、所有行也没逐格 `w:tcW` 的那些列 ⇒ 折出总宽后按列等分：
  `tb_pct30_nogrid` 30% 版心 /3 格 = 45px ↔ Word 45.20|45.25|45.25（松等）、
  `tc_only_tblw` 4500 缇 /3 格 = 75 磅 ↔ Word 75|75|75；pct 那一档的口径是**五十分之一百分点**（5000 = 100% 版心 = 9026 缇，按「百分之几」折的那一档差一整倍））；
  **第十二笔账把表级这一族的型别闸收成「`auto` 与 `nil` 都不算数字」**：带正数的 `nil` 在 Word 门面报 `pwtype=1 pw=0.00`（`w_nog_nil4513_fix` 落 18.00|18.00|18.00 磅的
  内容重排，而旧读手把 4513 缇折成 75.00 磅/格——37 臂里这样的造宽臂 7 枚）⇒ `nil` 并入 `auto` 那一档；而**规格外与缺 `w:type` 在这一层仍复用那枚数字**
  （`w_nog_foo4513_fix` Word `pwtype=3 pw=225.65`、逐格与 dxa 臂同形）⇒ 表级不设格级那道 dxa 白名单，**两族方向相反**（第十一笔账在格级把规格外请出门）；
  **表格读侧第十三笔账把表级 `@w:w` 的字符串字面接上**：旧那句 `attr(tblW, 'w')` 只匹配无前缀的 `w=` 键，而真 OOXML（含自家写侧）落的是带前缀的 `w:w="30%"` ⇒ 那一档在真件上从不达
  （字节腿 b2 `带冒号 w:w 的臂=23/23 无冒号裸 w 的臂=0`）；改成 `attr ?? attrL` 后**字面按百分之几折而数值仍按五十分之一百分点**（`"100%"` 两臂严等 150.75×3 ↔ Word 150.8|150.75|150.75、
  总差 −0.05 磅），字面另过一枚形状闸 `/^-?\d+(?:\.\d+)?%$/`——`"30 %"` 在 Word 报 `pw=0`（旧写法会凭它造出 45.00 磅/格的假账），与 `abc%` / 空 / `"-10%"` / `"0%"` 同归账外；
  23 臂同一趟 `转有账臂=10`（读手账外 16→6）而门开臂读数逐字未动，真件 1154 表枚里百分号字面 0 枚 ⇒ 这一枚 fix 对真件可证是 no-op；
  **第十笔账把「真数表宽压过逐格账」那两道门的机理量清而门仍不开**：
  fixed 那一档 Word 是把上面这盘 max 形状**等比缩到表宽**（`x_fix_d3000` max 形状 75|90|120 + 表宽 3000 缇 ⇒ 纸上 39.70|47.40|62.90 磅、
  `n_row1_tblw_present` 与 `tc_tcw_vs_tblw` 同形），autofit 与缺失那一档是**表宽 ÷ 首行格数**、
  跨列格那一份再摊到所跨各列（`x_aut_d3000` 与 `x_non_d3000` 50|50|50、`x_aut_d3000_span` 37.50|37.50|75.00）
  ⇒ 动它要重标 v0.92 / v0.93 / v0.94 三批屏上与纸面基线，故读手仍不吃真数表宽；
  **第九笔账记下的 `c_clash_*` 那批 Word 读数本轮独立 Word 腿不复现**（那里记 75|75|75 与 30|45|60，本轮两次独立跑同为 75|90|120 与 60|90|120，
  且「与 layout 三档无关」在 fixed 那一档不成立）⇒ 「覆盖」这一条按本轮读数改口，两批夹具到底差在哪一枚字面上没量（`tmp/xmar9` 已删）；
  **再往下一层（样式层）**：被表引用的样式（`w:tblPr/w:tblStyle` 指着的，沿 `w:basedOn` 自根向下、叶子覆盖根）说的 `w:tblCellMar`
  是这一层的基座，样式条件层（`w:tblStylePr` 里那**两格**——`w:tblPr/w:tblCellMar` 与 `w:tcPr/w:tcMar`，配 `w:tblLook` 的闸门；表格读侧第七笔账起两格各记各的账）
  说的 slot 那一格**归样式层而落点按型别逐格现取**（`sc_slot_top_vs_tbl` 里表自身 top108 压过 slot 的 600 而位移差 0.00，`sc_slot_top_vs_stylebase` 里 slot 压过样式基座而差 +32.87 磅）；
  闸门只吃四枚位属性（`w:val` 那位十六进制从不被 consult），而型别的落点在**边距这一族**是行型按行落、列型不看行位、四枚角型按其所在那一**整行**落（`sb_nw_all_on` 首行三枚格各 40px 而第 1、2 行九枚全空）
  且要那一角的两枚位都开（`sb_nw_fr_only` / `sb_nw_fc_only` 九枚全空）、同一块里 `w:tcPr` 那一格盖 `w:tblPr` 那一格（`sc_slot_top_vs_tcpr` 落 300 那一档）、`wholeTable` 那一格哪一边都不落、同一型的两块是**整块**替换；
  而**两族的梯子反着**（边距自低向高 列型 > 角型 > 末行 > 首行，底纹 角型 > 行型 > 列型 且角型只落那一角那一格）⇒ 两族分两条路走而不并成一条梯子。
  表自身逐边盖样式层、条件层 `w:tcPr/w:tcMar` 再盖表级、行条件层 `w:tblPrEx/w:tblCellMar` 再盖条件层、逐格最后盖条件——**六层逐边**合并；
  而**「默认标记」不再当门**（`r1_def_referenced` / `v1_def_referenced_mar` 两臂：自造 id 而带 `w:default="1"` 的样式被表引用时，Word 把样式说的
  240 缇读成 12 磅 = 16px、把 `w:tcPr/w:shd` 的 D9D9D9 落满九枚格，而我们两头照落）；门里只留**被替换的内建样式** `TableNormal`（边距 `u6_normal_substitution`
  往它身上写 400 缇而 Word 读回 5.4 磅 = 7.2px，底纹 `q21_default_referenced` 往同一枚写 D9D9D9 而九枚格全读回无底色、`word_style=????` 就是它换上了自己那套内建定义）；
  没人引用的样式压根不在链上（`q19_default_tcpr` / `r2_def_unreferenced` / `v2_def_unreferenced_mar` 两头都全空，我们本来也不读）；六层都没说的边仍不铺数，
  Word 自带的 0/5.4/0/5.4 磅是应用默认而不是文档说了的数）、
  **格底纹从此也是三层取一**（表格读侧第六笔账，69 枚夹具三方同一趟：逐格 `w:tcPr/w:shd` > 条件层 `w:tblStylePr/w:tcPr/w:shd`（含四枚角型，梯子按**型别**而不按声明顺序）
  > 被引用样式自己的 `w:tcPr/w:shd` 基座（沿 `w:basedOn`，本体说了才覆盖祖先：`p17_chain_leaf_wins` 九枚 FFF2CC 而 `p18_chain_inherit` 九枚 D9D9D9）；
  比的是**哪一层的元素在场**而不是色值，所以逐格那枚 `w:fill="auto"` 也算说了话（`q15_cell_auto_over_base` 清掉样式基座、`r4_cell_auto_over_cond` 清掉条件层）；
  条件层的底纹**真按位置**落（`p5_firstCol` / `t7_firstCol_B_ctl` 只落每行第 0 网格列，跨两列而自第 0 列起的格算第 0 列 `q16_firstCol_span`；四枚角型要那一角的**两枚位都开**才落，
  `u3_corner_last_bits` 里只有 seCell 落；`u2_corner_vs_rowcol` 与 `u7_nw_declared_first` 两趟第 0 格都是 D2691E 而把 firstRow 让到 #1/#2、firstCol 让到 #3/#6），
  而同一个闸门同一个型换成格边距时落到**全表每一格**（上一轮 `g_firstCol_L4_full` 的 22px）⇒ 两族的作用域不同，读侧因此分两条路走而不是并成一条；
  `@w:val="pct50"` 那一半 CSS 里没有对应档位，只把 fill 当纯色读并如实记一句（`p19_pct50` Word 那头是 FF0000/500 ⇒ 我们的告警 `×9`），而写侧没有样式层与条件层的底纹出口
  ⇒ 样式与条件的色落盘时塌成逐格 `w:shd`（同一趟 69 臂里 29 臂换档，`COLLAPSE|arms=29 src_cells=6 exp_cells=169`）
  `w:drawing`/`v:imagedata` 图片（rels → data URL）、
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
  往返只经一次换算（**v0.88 才接上界面**：这一层从 schema 到 docx/odt 字节一直全通，缺的只是能改它的那一排按钮——
  同一轮还修掉两处静默：表头格上 `&&` 短路造成的整条 no-op，与 `dashSmallGap` 一类 Word 线型读成实线），
  **表格读侧第十四笔账起 `w:sz="0"` 的实线不再落成 `0px`**（CSS 的 0px 边框一滴墨都不落，而 Word 门面把它报成 `LineWidth=2` 的可见细线）⇒ 读侧抬到 0.33px 的最小发墨档，
  而撤销档 `none` / `nil` / `hidden` 照旧发 `'none'`（三头一致：字节腿点名 `w:val="nil"` 的那几格、读手发 `none`、Word 报 `0/6/False`）
- **单位换算钉死在一处**：OOXML 的 `w:sz` 是 **1/8 磅**（`eighthsToPx = sz/8×4/3`、`pxToEighths = px×6`），
  **表格读侧第十四笔账在读侧这一头加了一枚最小发墨档**——`edgeCss` 里折像素前 `Math.max(2, …)`：`w:sz` 低于 2 抬到 2（2 个八分位 = 0.25 磅 = 0.33px，
  Word 门面那枚 `LineWidth=2` 就是这一档），4/6/8 原样通过 ⇒ 是地板不是一律取最小；地板设在 `eighthsToPx` **外面**，故写侧 `pxToEighths`、ODT 的 pt 直译与界面那九档一律不受影响，
  而缺省档 `?? 8`（1 磅）与 `NaN`（数字读不出来）两档都不因本笔改变；
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
  `width: calc(100% - Npx)`，否则满宽版心会被顶出页面；**v0.92 起这一枚 `calc` 只在"没账或部分账"那一档盖**——整表每列
  都带账时表宽就是那份账的绝对像素和 `accountTotalPx`，缩进不再靠 `calc` 收右边，见 v0.92 一节；**v0.93 纸面腿第一次
  在纸上量到这一枚**——`indent` 臂的表左沿 = 版心左沿 83 + 缩进 40 = 122.98px，缩进真的上纸）；
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
  段落边框宽度仍是 1/8 磅制的 `w:sz`（0.67px ↔ sz4 ↔ 0.5pt；**v0.88 的界面就接在这一层上**——`.doc-para-bar` 那一排四边、
  按磅显示、九档磅值 × `borderCss` 换算只写一处，「清除」写 `null` 收回未声明；第五边 `w:between` **v0.97 已接**
  （与下一段是同一串签名时落成本段下边框），`w:space` 仍未接）
- **UI**：段落上下文条 `.doc-para-bar`——行距下拉（单倍/1.15/1.5/2 + 固定值/最小值 + 自定义 `x倍数`）、
  段前段后两个数字框与「无间距」、底纹取色与「无底纹」；**界面按「磅」显示、属性里存 CSS px**（pt×4/3），
  不让用户换算。`TextStyleKit` 的 `lineHeight` 必须关掉：那是它给段落挂的**同名**属性，
  与这里记 OOXML 行距的 `lineHeight` 撞名字，两边只能留一个
- **主动记 warnings 的边界**：段落边框离字的 `w:space`（>1 磅时告警，schema 里没有 padding 这一层；**这一条告警到 v0.88 仍没有到达面**——这台机器的
  Word 报 `Border.Space` property not found，而它自己写出的件恒为 `w:space="0"`，构造不出触发它的那一档，只能手造件）、
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
  这一档的解释（「嵌套表放不进 `<td>`，硬塞等于让 ProseMirror 的内容表达式把整块字丢掉」）在第十六笔账按 b5/b7/b8/x8
  四头改口：`tableCell.content=block+` 吃得下格里的表、界面真用的那套扩展在浏览器里渲染得出、自家写侧本来就在产嵌套表
  ⇒ 展平是选择而不是被迫；留下的真理由是格内 OLE 那四种内层形状未逐枚数过，而正文格里的真表自第十六笔账起出真 `<table>`
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
  **签名私钥无备份仍是最大单点风险**（**2026-10-05 已解决：加密备份 + 恢复演练 7/7，见下一节**）

## 签名私钥备份：从"最大单点风险"变成"有一份加密包且演练过"（2026-10-05 补记）

从 v0.45 起每一轮收尾都在重复一句实话——**签名私钥无备份，丢了就再也给不出更新**。这一节把那笔账结掉。
窄口径：**产品代码一个字没动**（无需版本 bump），仓库 `git status` 全程为空，两条腿脚本与日志都活在
`~/Backups/openoffices-updater-key/`。

- **体检先量成四格（只读名字、大小与 SHA256，内容一个字没读）**：三枚住 `~/.tauri/`——
  `openoffices.updater.key`（348 B，`5fb87db8…cf1eaf`）、`.key.pub`（152 B，`b4e282c8…da1713a2`）、
  `.key.pass`（32 B，`4bd9435e…53ae1484`）；**口令文件就躺在私钥旁边** ⇒ 私钥自带的加密在本机形同虚设，
  所以这层备份要有**另一把口令**才有意义；工具面 `openssl` ✓ / `gpg` ✓ / `age` ✗ / `7z` ✗；
  `tauri signer sign` 的 `-f`/`-p` 都带环境变量退路（`TAURI_SIGNING_PRIVATE_KEY_PATH` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）⇒ 签名演练这一步**不必**把口令写进 argv；而 `tauri signer`
  只有 `sign`/`generate`，**没有 `verify`**。
- **备份的形状**：`tar`（三枚钥 + 一份自带清单，明文不落第二份副本——清单走 staging、三枚钥直接从
  `~/.tauri` 打包）→ `openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt` → 一枚
  `openoffices-updater-key-20261005.tar.enc`（10272 B）。解密口令由脚本随机生成 24 位字母数字，
  **只落在桌面那枚一次性文件里**，不进 argv、不进日志、不进仓库、不进聊天记录；`RESTORE.txt` 记三枚
  应有 SHA256、加密包自身哈希与恢复四步。
- **恢复演练 7 / 7（`drill-20261005.out` 尾行 `RESULT drill total=7 pass=7 fail=0`）**：
  **D1** 包在场且非空；**D2** 正确口令解得开、成员恰 4 枚；**D3** 解出的三枚与现场**逐字节相同**
  （`cmp`，不打印内容）；**D4** 清单里记的 SHA256 与现场三枚一致（防"备份做完了、清单写错了"这种事故）；
  **D5 负控制**——错口令 `rc=2` 且落地 0 枚，证明这层 AES 包裹不是摆设；**D6** 用**解出来的那把私钥**
  对临时目录里一枚测试件真签一次，`.sig` 396 B；**D7** 现场私钥吃同一把尺也签得出 396 B
  ⇒ D6 的读数归因在钥而不在腿。
- **本轮没做到的，如实记账**：① **`.sig` → `.pub` 的验签没做**（`tauri signer` 无 `verify` 子命令），
  所以"D6 证的是这把钥可用"，而"签出的字节更新端认不认"仍只由 v0.82 那条真签名端到端臂背书；
  ② **备份包与解密口令目前仍在这同一台机器上**——异地那一抄只能由用户手动做；③ **桌面那枚口令文件还在**
  （516 B），它是口令唯一的副本，抄存之后要用户自己删，我没有擅自删；④ **私钥本体在本机仍是单点**
  （`~/.tauri` 那一份），备份是加密包而不是明文冗余，这是有意的。
- **收尾**：`backup-key.sh` / `drill-key.sh` 两份腿脚本（只含路径与哈希）连同两枚 `.out` 日志留在备份目录，
  下轮动更新链路时可原地复跑演练；README 新增本节 + v0.86 节尾那句就地改口 + 路线图把"私钥无备份"
  改口成"已备份"并新开上述四枚未勾项；现场三枚钥哈希与清单逐字相同、仓库零沾染、明文临时残留 0 枚、
  全程未碰已装正式版。

## 大件不再一口气喂进编辑器：阈值分批喂 + 文档读全闸门（v0.87）

「继续对齐 WPS，完善文档处理功能与性能」自选口径：文档这一头的**打开链路从来没分段量过**（v0.34~v0.36 量的是
表格首开与 PDF，v0.66~v0.68 量的是 PDF/表格的 IPC）。窄口径：新增 `src/lib/doc-feed.ts`（137 行，纯函数 + 喂料
通道）+ `DocEditor.tsx` 接线（+76 / −6），**Rust 一个字没动**。

- **前置实测（tmp/x87，只量不改产品；dev 打点 + release 真机 10ms 采样）五批**：① 分段构成（legA，8 件）——瓶颈在
  **最后一口气**：`.odoc` 的 `setContent` 139.6ms（5000 块）/ 300.7ms（24000 块），而同件的读件 16.8 / 55.5ms、
  `JSON.parse` 0.8 / 4.2ms、docx 的保真导入 5ms；② 现象（legB dev + legD/legD-small release）——**fx1000.docx 打开时
  主线程空档 964ms、单枚最长同步块 555ms**、正文首现 1097ms；fx1000.odoc 417/255/483；fx250.odt 188/108/225；
  **而小件（71 / 1869 / 5000 块）空档 ≤92ms、长任务 ≤53ms**——5000 块这一档本来就谈不上"卡"，5056 块的 `.odt`
  已经要 188ms ⇒ 阈值 **5000** 是量出来的分界，不是拍的；③ 通道候选（legC2，15 形状逐节点对参照）——**增量追加这条路走不通**：
  只有纯 `paragraph` 那 2 枚与整片 `setContent` 相同，heading / bulletList / orderedList / table / blockquote / codeBlock
  一律**多出一枚空段**（PM 的 `appendTransaction` 在容器后面补可编辑段落），块数从 5840 变 5841；④ 通道裁决（legC5，8 枚 mini
  + 四件 A/B）——A1（追加 + 边界撤填充）在 fx250.docx / fx1000.docx 上**仍然 diverged**（第一处不同 `at=1612`），撤填充补不了
  那一档；**C2（JS 侧累加 `Fragment`、从不读活文档，每批整片换回）四件全部逐节点相同**，且把最长同步块拆小（fx1000.docx
  796ms → 批间 156ms，正文首现 1072ms → 30ms）；⑤ 批次大小（legC6，400/1500/4000 三档 × 三件）——整趟代价三档基本持平
  （fx1000.docx 全量上屏 1155 / 1100 / 1115ms）⇒ 4000 与"首屏 12 块另走一档"。
- **本轮唯一的架构决定（跟着数据走）：阈值分批喂 + 文档读全闸门，只对大件生效**，四条形状：① `planFeed` 只在
  `hint > FEED_THRESHOLD(5000)` 时给计划（html 侧先按串长廉价预筛、再有一道"顶层裸文本就不切"的安全闸；json 侧数
  `doc.content`），阈值以下**原样走今天的单片 `setContent`**，一条已量过的路径都没碰；② 喂料通道只吃实测唯一等价的 C2——
  批批 `tr.replaceWith(0, doc.content.size, acc)` + `addToHistory:false`，非末批 `preventUpdate:true`（末批才 emitUpdate），
  首屏两帧 rAF、批间 `setTimeout 0` 让出主线程，`stopped()` 按**这一趟的身份**取消；③ **读全闸门**沿用 v0.81 那本账的四条形状
  （按身份记、持有在 ref、失败不记账、全仓不销账）——六个写出口里四条说话（`saveOdoc` / 另存为 / 导出 PDF / 历史回滚）两条
  静默（快照、`.odoc` 定时自动保存）；④ 喂料窗口内把编辑器 `editable` 关掉，释放只认自己那一趟（`finally` + 身份卫兵）。
- **闸门买到的那一格在 release 上是真缺陷**（A3）：0.86 上打开 fx1000.docx（741615 B），在块数还是空种子 `1` 的那一拍按下
  **真** Ctrl+S（`isTrusted: true`）⇒ 写请求真的出门（`plugin:fs|write_file@121+7`），盘上那 741615 B 的件被换成
  **8563 B**，而状态栏说的是「已保存」。0.87 同一拍：写 IPC `[]`、盘上哈希一字没动、拒存那句上屏 15 拍（A4/A5），
  对照件同一拍既没有拒存句也没有那句话之外的任何东西（A6）。
- **release A/B 的账**（`legE-judge` **total=16 pass=16 fail=0 skip=1**；对照件＝改动前从 HEAD 当场构建的 0.86 exe，保留原进程名）：
  大件三枚逐件都被拆小——采样空档 fx250.odt 210→155 / fx1000.odoc 499→158 / fx1000.docx 951→283，最长同步块 odoc 335→157、
  docx 572→269（**odt 110→118 按"持平"记而不写成收益**——这件只有 5056 块，对照件本来最长才 110ms，谈不上冻结）；
  正文首现 249→86 / 572→86 / 1106→**344**；过阈的件真的分批（块数出现过的值：对照件每件三枚 `-1,1,全量`，实验件四到八枚
  `-1,1,12,8012,…`）；代价按判据吃了——**全量上屏 ≤ 对照件 ×1.2**（odt 249→241、odoc 572→507、docx 1106→1290＝1.17×）；
  阈值以下三枚件两臂形状逐格相同（`-1,1,71` / `-1,1,1869` / `-1,1,5000`，空档 20→15 / 63→61 / 49→85ms）⇒ 没回归；
  两臂页面异常各 0 条、夹具哈希前后逐字相同；**A16 写成显式 SKIP**（见下述未勾项①）。
- **CDP dev 真机腿 6 段 / 页面异常 0 条**（`RESULT legF runs=6 … exceptions=0`，只吃形状）：A 大件形状（顶层块 24000、
  模型值 8 种、`editable` 关 7 拍首 155ms、whole 假 12 拍 / 真首拍 983ms）；B 闸门两拍（喂料中按真键 ⇒ 拒存句 4 拍、
  写 0 枚、盘未动；读全之后**同一路**按下 ⇒ 写 1 枚 `write_text_file`、已存句 150 拍、哈希 `7f17…→0ad3…`）；
  C 喂料窗口里的程序化改动（量成未勾项③那格）；D 小件 5000 块（模型值三枚、`editable` 关 **0** 拍、whole 真首拍 141ms、
  拒存 0 拍 ⇒ 阈值以下这条路一步没走）；E 坏件（截半的 `.odoc` ⇒ `JSON.parse` 必抛：拒存句 144 拍、写 0 枚、whole 永不真、
  盘未动，而**重试把手 0 枚**＝未勾项②）；F 喂料中关标签再重开（24000 块读全、写 0 枚 ⇒ 被作废那趟没留下半个字节的假成功）。
- **验证（腿 + 编译，全部在版本号 bump 三处对齐之后跑）**：结构腿 **28/28**（B0 自检 3/3；F1~F13 阈值与通道形状、
  E1~E15 闸门六出口与 DEV 钩子三格，E13 钉"旧形状没复活"、E8 钉"catch 里零枚 loadReadRef"）；变异腿 **25 枚（P0/P1 两枚
  正控制 + M1~M23）/ BAD 0 / 多打中 0 / 基线 struct=28/28**（M5 累加退化成每批覆盖、M6 整片换回改成就地插入、M13 失败也记账
  响 E6+E8、M16 读全账退化成布尔、M20 `.odoc` 分支退回裸 `setContent` 响三枚）；release A/B 16/0 + 1 SKIP；dev 真机 6 段
  0 异常；`cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（Rust 本轮一个字没动）+ tsc exit 0 +
  `pnpm tauri build --no-bundle` 绿（openoffices v0.87.0）。
- **量具坑四处，都不是产品**：① **`.odoc` 夹具不 representative**——`gen-fx.mjs` 把 `.odoc` 写成 `{content: 节点数组}`，
  而产品写的是 `{app,kind,version,content:<整枚 doc 节点>,meta}`；数组形状下 `planFeed` 的 json 分支拿不到 hint
  （`doc.content` 是 undefined ⇒ 0）⇒ **分批那一路从来没被量到**（是 exp 臂的 fx1000.odoc 与 ctrl 逐格相同才暴露）。
  修法 `fix-odoc.mjs` 只重包外层、节点文字一字不改（块数仍 5000 / 24000），然后**两臂都重跑**，修前那批 odoc 读数一律不当证据；
  ② 腿自己的解构默认值 `settle(name, { timeoutMs = 90_000 })` 单参调用直接 TypeError——第一跑只跑到 WARM 就 THREW，
  这是腿不是产品（补 `= {}`）；③ **release 的 exe 里 grep 中文字面必然 0 命中**（前端资源压缩内嵌）⇒ 判两支 exe 不同
  只能靠哈希与真机行为；④ `Input.dispatchKeyEvent` 在 release 上给的是 `isTrusted: true` 的**真按键** ⇒ "没读全就按 Ctrl+S"
  这一格第一次有了到达面（A1 两臂各一枚，按下时块数都还是 `1`＝比的确实是"拦不拦"而不是"读到哪了"）。
- **本轮没动的，量出来记着**（已开进路线图）：① **阈值以下（≤5000 块）的件在载入窗口内按 Ctrl+S 会不会被拒——这一格本轮没量**
  （A16 显式 SKIP；闸门判的是读全账、与阈值无关，但小件那一路的拒存形状没人量过）；② **载入失败那一路只有拒绝、没有重试把手**
  （v0.83 那枚把手只长在 PDF 那一头，文档头没建，dev E 段把手 0 枚）；③ **喂料窗口内工具栏/程序化改动会被下一批整片覆盖**
  （`editable:false` 只挡用户输入、不挡 `view.dispatch`；dev C 段量成了形状）；④ **阈值只在 5000 / 5056 这一点量过**，
  2000~5000 区间没扫；⑤ **解析侧那枚长任务没拆**（fid / odt / `JSON.parse` 仍是一口气，本轮只拆了"喂"这一段）；
  ⑥ 非产品形状的 `.odoc`（`{content:[节点数组]}`）走单片那一路、本轮没加兼容（我们不产出这种件）；⑦ **分批喂与闸门只做在
  文档这一头**——表格 / 演示的"读没读全"仍没有这本账；自动更新的源托管与 macOS 打包按指令继续等信号，签名私钥已加密备份
  并演练 7/7（见上一节），**私钥本体在本机仍是单点**。

## 边框这一层终于有把手了：段落一排、单元格一排，顺手拆掉两处静默（v0.88）

「继续对标 WPS 完善文档处理」自选口径：v0.38/v0.39 早就把边框的**读与写**接齐了（schema、docx、odt 三链路），
而**界面上一个字都改不了**——改前全仓 `.tsx` 里 `bd*` 零命中（本轮之后唯一的 `.tsx` 使用者就是 `DocEditor.tsx`）。窄口径（Rust 一个字没动）：
`src/lib/cell-style.ts` +74 / −12、`src/components/DocEditor.tsx` +87 / −1、`src/lib/paragraph-style.ts` +9 / −1。

- **前置实测四格（tmp/x88，真件真字节，只量没改产品）**：① **读侧通道是通的但有两处静默丢档**——`w:val="single" w:sz="4"` →
  `0.67px solid`、`sz="8"` → `1.33px`、`auto` 色 → `#000000`、`w:val="nil"` → `"none"`，上屏计算样式 `0.666667px/solid/rgb(0,0,255)`，
  三态在 attrs 里分得开；**缺陷一（无声）**：Word 虚线对话框实际写的是 `dashSmallGap`，另有 `dotDotDash`、`dashDotStroked`、
  `thinThick*`、`thickThin*`、`threeDEngrave` 全不在 `CSS_BORDER_STYLE` 里（`dotDash` 会被小写归一命中，`dashSmallGap` 命不中）
  ⇒ Word 里的虚线导进来显示成**实线**、再导出也是实线，而 `notes: []`，用户一个字都看不到；**缺陷二**：Word 段落边框有
  第五边 `w:between`，读侧没有这一枚 ⇒ PSINGLE5 与 PSINGLE4 的 attrs 逐字相同，静默丢；`Border.Space` 在这台机器的 Word 上
  报 property not found ⇒ 读侧那条「间距未保留」告警**没有到达面**；② **写侧也是通的**——导出字节里 `<w:pBdr>` / `<w:tcBorders>` /
  `w:tblBorders`（含 insideH/insideV）形状正确，`none` 写成 `w:val="nil"`，ODT 写 `fo:border-top="0.5pt solid #0000ff"`；
  我们从不写 `w:space`（Word 每次写 `w:space="0"`，形状差但无害）；③ **缺的那一层就是界面**——程序化
  `setParagraphStyle({bdTop:'1px dashed #00ff00'})` 与 `updateAttributes('tableCell',{bdTop:…})` 一路都走得通（attrs 落地、
  DOM 画出虚线、docx 带 `w:val="dashed"`、ODT 带磅值）：通道早就齐了，**用户没有把手**；④ **跨产品**——真 Word 打开我们的
  往返件无修复提示，Word 自己的 single/0.5pt/蓝色两边往返两轮不丢，重新导入自家产物 attrs 与首趟逐字相同（无漂移）；
  两处小账：我们写的 `dashed` 在 Word 读成 DashLargeGap(4) 而 Word 对话框写 dashSmallGap(3)、表级边框会被摊进每一枚单元格
  （2 枚 tcBorders → 6 枚，字节膨胀外观相同）；**纸上有没有边框从来没正面量过**。
- **本轮唯一的架构决定（跟着数据走）：给这一层补界面入口，并顺手修读侧那一档真实丢档**——段落四边（`.doc-para-bar`）与
  单元格四边（`.doc-table-bar`）共用**同一排**（`bdRow(cur, write, suppress)`：先选线型/磅/颜色，再点要加的边，点已着边的边＝
  取消这一边），四条形状都不是可选的：① **三态各有出口**——「清除」写 `null`（回到未声明）而「压掉」写 `'none'`
  （导出 `w:val="nil"`）且只在单元格那一路出现，因为表格自带一圈表级边框，不显式压就盖不掉（Word 只读腿后来从第三方那头
  证实了这一格：未声明的边 Word 照样从 `w:tblBorders` 解出线来）；② **界面按磅、属性存 px**，换算只写一处
  （`BORDER_WIDTH_PT` 那九档 × `borderCss` / `eighthsToPx` / `pxToEighths`），0.5 磅 → 0.67px → `w:sz="4"` 与 Word 自己
  写下的字节同形；③ **「着边」只认真线**（`borderParts(cur(edge)) !== null`）——`'none'` 不算着边，在它上面再点一次是
  把边框加上而不是清成未声明；④ 一次调用**一条事务**（「四周」点一下只撤销一次）。读侧同批补 `CSS_BORDER_STYLE` 缺的
  Word token（`dashSmallGap`/`dashLargeGap`/`dotDotDash`/`dashDotStroked` → `dashed`），因为「UI 里选虚线写 dashed」和
  「Word 导进来的虚线读成实线」是同一枚通道的两头不一致。
- **另一处真缺陷是写命令时才发现的**：单元格三条命令走的是
  `updateAttributes('tableCell',…) && updateAttributes('tableHeader',…)`，表头格上第一型返回 false 就整条短路 ⇒
  **边框/底纹/竖排对齐在表头格上全是静默 no-op**（v0.38 起一直如此），普通格上又因第二型 false 把链上这一步记成失败；
  改成 `[两型].some(Boolean)`（段落那一头 v0.39 早就是这个形状）。字节腿 B4/B5 判的就是它：表头格的上边现在真的进得了
  `w:tcBorders`（`dashed` / `sz=12` / `336699`）。
- **验证（腿 + 编译，全部在版本号 bump 三处对齐之后跑）**：结构+变异合并一腿
  **`RESULT struct total=27 pass=27 fail=0 mutants=16 bad=0 extra=0 b0=3/3`**（吃剥掉注释并归一 LF 的源文；B0 自检 3 条——
  中文注释短语剥后消失、字符串字面量内容活下来、模板内插 `${edge}`/`${v}` 不被花括号帧吞掉；CS1~CS10 / PS1~PS5 / DE1~DE12；
  M1 退回 `&&` 短路响 CS1+CS2、M2 只试 tableCell、M3 去 `dashsmallgap`、M4 `nil` 不再压成 none、M5 `borderCss` 不做磅→px、
  M6 段落不走 `edgeAttrs`、M7「压掉」写 `null`、M8 去 `suppress` 门、M9 表格传 false、M10 css 吃死值、M11 color 换成文本框、
  M12 着边判定吃原始串、M13 默认磅改 6、M14「四周」不再切换；两枚正控制 P0 原样、P1 把 `&&` 旧形状藏进注释——判据不认注释）；
  CDP dev 真机 **40 / 0、页面异常 0 条**（A0/B0 一次**真按键**把光标放进正文、段落那一排自己出现；B1~B10 段落那一排含
  「清除」收回未声明与悬停改口；C1/C2 包 `view.dispatch` 数 docChanged ⇒ 一次点击只推一枚改文档的事务；D1~D7 单元格那一排
  （suppress 那一路多一枚「压掉」、`none` 不算着边、三态各有出口、源件写着 none 的那条边读成未着边、在它上面点「上边」是加
  而不是清）；E1~E3 表头格（点「表头行」真变 `tableHeader` 节点、「清除」与「上边」与「底纹」全部落得下去）；
  F1~F6 导出态字面 + 脏账 ● + 夹具盘上未动）；字节腿（python 独立解 zip 部件，不吃自家解析）**13 / 0**（B1/B2 段落上边
  `single sz=6 ff0000`＝0.75 磅红、B3「清除」之后整个 `<w:pBdr>` 不再出现、B4/B5/B5b 表头格上边进字节而其余三条经清除
  整条不在字节上、B6 四条 `w:val="nil"`、B7 点一条边只换那一条、B8 表级 `w:tblBorders` 原样没被顺手改、B9 逐边不变、
  B10 部件齐全）；**Word 16.0 只读腿**（`EXIT=0`，80 行 `EDGE` 读数，只读打开 + `Close($false)` 不落盘）四条最硬的对应：
  夹具 P0 四边全 `style0` → 我们写的件里 e1=`style1 width6 color255`（实线 0.75 磅红，Word 的 `LineWidth` 枚举本就按
  1/8 磅给数 ⇒ 与 `w:sz="6"` 对上）；夹具 PSINGLE4 四边 `style1` → 件里四边全 `style0`（**「清除」在 Word 那头真读成无边**）；
  表头格 c11 上边 Word 报 `style4 width12 color10053171`（＝虚线 1.5 磅 #336699，本轮修的那一枚 no-op 从第三方那头也认账）；
  未声明的边 Word 从表级 `w:tblBorders` 解出线来（c11 其余三条字节上不存在而 Word 照报 `style1`）。
  `cargo test --lib` **97 通过 / 0 失败 / 11 ignored**（Rust 本轮一个字没动）+ tsc exit 0 +
  `pnpm tauri build --no-bundle` 绿（openoffices v0.88.0）。
- **量具坑七处，都不是产品**：① **合成的 `new MouseEvent('mousedown')` 放不下 ProseMirror 的光标**（`detail:0` ⇒ PM 不把它
  当成一次点击），第一版整条腿判的是"程序化 put 之后的光标"，B0 自检当场 FAIL；改用 CDP `Input.dispatchMouseEvent`
  的 mousePressed/mouseReleased 一对（`isTrusted: true`）才有"点进正文那一排才出现"的到达面——这是 v0.87 那条真按键结论
  在鼠标那一头的续篇；② **`btn()` 的 `key` 是 `label + title`** ⇒ 悬停那句一改口（「加上」↔「取消」）React 就重挂载，
  手里那个 DOM 节点已脱离文档，读它的 `className` 读到的是按下**之前**的样子（B3 假 FAIL）——按下之后必须重新查一次，
  这是「尺子瞎不是产品哑」同族教训第六次兑现；③ **夹具本来就给那一行写了四条边**（`0.67px solid #000000`）⇒ 不先按
  「清除」收回未声明，点「上边」吃的是**取消**那一支，量不到"写得进去"（E2 假 FAIL，修法是新立 E1b 单独判「清除」也落得下去）；
  ④⑤ **两处期望值是我猜的**：字节腿 B7 以为夹具里 c12 其余三条也是 `nil`（实际是 `single sz=4 000000`）、B9c 以为件里
  有 5 枚 `dashSmallGap`（量出来是 4 枚段落边降档、导出件里 6 枚 `dashed`＝4 降档 + 2 枚 UI 新写）——**判据里的数字必须由
  同一趟量出来**，两处都改成先测再写；⑥ 这台机器的 `python3` 是商店占位桩（exit 49、无输出），字节腿走 `python`（3.14.2），
  而控制台按 GBK 解码会把中文判据名打成乱码 ⇒ `PYTHONIOENCODING=utf-8` 并读 tee 下来的日志；⑦ **段落上的第五边在 COM
  这头没有到达面**（`Borders.Item(5)` 对段落抛「集合要求的成员不存在」，单元格才有 e5）；另外 `Get-NetTCPConnection`
  报 9222 无监听而 `curl /json/version` 拿得到版本号——端口型判据别只吃一枚尺。
- **本轮没动的，量出来记着**（已开进路线图）：① `w:between` 第五边仍未接（本轮由字节腿当场数出代价：**7 枚段落丢掉这一边**）；
  ② 我们写的 `dashed` 在 Word 读成另一档虚线（件里 `style3` → 件外 `style4`），异形线型（`thinThick*`/`threeD*`）CSS 表达不了、
  一律静默降为实线且明写不做界面；③ **`w:val="nil"` 在 Word 的 `Borders.Item` 上不是一致读成"无线"**（我们写死的四边 nil，
  Word 报 e1=`style1`、e2/e3=`style0`、e4=`style1`），本轮**未归因**（COM 的解析路径与"单元格边框一律比 OOXML 字面"那条老规矩
  v0.38 并存），只记不作结论；④ `w:space` 无到达面；⑤ 样式级 `w:pBdr` 摊平后「清除」在第三方件里可能压不掉样式带来的边
  （未量）；⑥ **本轮没有 release A/B**——到得上的证据来自 dev 真机 + 字节 + Word 三头，"界面上那一排在 release 上也长这样"
  只有形状推断；⑦ 纸面（导出 PDF）上有没有边框仍未正面量；⑧ 表级边框摊进每枚单元格的字节膨胀（2→6 枚）没动。
- **收尾**：README 新增本节 + 文件清单 `lib/cell-style.ts` / `lib/paragraph-style.ts` / `DocEditor` 三条补 v0.88 段 +
  架构那一层三处就地括号改口（v0.38「边框只存一种形状」补界面入口与两处静默的修法、v0.39「段落边框宽度仍是 1/8 磅制」
  接上界面那一排、v0.39「主动记 warnings 的边界」把 `w:space` 那条改成「仍没有到达面」）+ 路线图新立本轮已建的那条
  （`- [x]` 边框的界面入口）并新开上述八枚未勾项，版本 0.88.0（package.json / tauri.conf.json / Cargo.toml 三处对齐），
  tmp/x88 的夹具、dev 腿、字节腿、Word 腿与结构+变异腿按惯例删除（全程未碰已装正式版）；自动更新的源托管与 macOS 打包
  按指令继续等信号，签名私钥已加密备份并演练 7/7，**私钥本体在本机仍是单点**。

## 表格的列宽第一次真的写进 docx：真网格、逐格账、固定布局（v0.89）

「继续对标 WPS 完善文档处理」自选口径：列宽这一层**读侧从 v0.19/v0.30 起就一直是全的**（`w:tblGrid` 的逐列宽 →
每格 `colwidth` 数组），缺的是**写侧一个字都没写**——导出的 docx 里 `w:tblW` 恒为 `pct 100%`、`w:gridCol` 恒为
docx 库默认的 `w="100"`（twip，≈6.7px），`w:tcW` 与 `w:tblLayout` 零枚。窄口径（Rust 一个字没动）：`src/lib/docx.ts` +92 / −12。

- **前置实测六格（tmp/x89，真件真字节，只量没改产品）**：① 导入首趟模型逐格 `colwidth` 收下真值——fixed 件每格
  [120]/[160]/[240]（两行都有）、auto 件 [133]/[333]、span 件首行 [100][200][100] 而次行跨两列那格是 **[100,200]**
  （跨列格记「所覆盖的各列」而不是记合起来的宽 ⇒ 这是 `gridPxOf` 摊平的依据）；② 屏上 `<col>` 与模型逐枚一致 ⇒
  读侧通道确实通（cellsPx 按网格比例排 138.39/184.52/276.79）；③ 三枚导出件一律 `w:tblW pct 100%` + `w:gridCol w="100"` +
  `w:tcW` 零枚 + `w:tblLayout` 零枚 ⇒ **宽度这份账在写侧根本不存在**，而那枚 100 twip 是库的默认值不是我们的账；
  ④ **二趟漂移**：把自家导出件再导入，`colwidth` 全变 [7]（100 twip 折成 px）、屏上 `<col>` 25px ⇒ 模型揣着一枚
  荒谬但"真实"的宽度继续往下传，下一趟存盘就把它当宽度写；⑤ Word 16.0 只读腿（磅）：夹具 90/120/180（prefType=3 固定宽）
  ↔ 我们的导出件 **150.3/150.25/150.25**（prefType=2 百分比）——三列被压成三等分，span 夹具的 75/150/75 同样塌成
  150.3/150.25/150.25；⑥ 界面「插入表格」新建的 2×3 每格 `colwidth` 是 null、屏上 `<col>` 空 ⇒「没有宽度账」那一档
  **真实存在**，而它现在正被写成那枚 100 twip 假网格。另两格门面：TipTap v3 命令里**没有 `setColumnWidth`**
  （只有 `addColumnBefore` 一族）而 cell schema 有 `colwidth` ⇒ 精确设宽要自己写命令，本轮不做；本机无 ODF 第三方应用
  且 ODF 1.2 RelaxNG 三个源全 404 ⇒ **ODT 列宽写侧无人可裁，本轮不开**（ODT 导出件里 `table:table-column` 实测零枚，两头都缺）。
- **本轮口径（由以上实测选出）**：docx 写侧把列宽这份账写全（`w:tblGrid`/`w:gridCol` 真宽 + 逐格 `w:tcW` +
  `w:tblLayout fixed` + `w:tblW` 绝对值），没有宽度账时按版心等分写真网格、不再盖 100 twip 的默认假网格。
- **本轮唯一的架构决定：宽度账「有就写全、没有就等分」，而这两档在字节上是刻意分开的两种形状**——四条形状都不是可选的：
  ① **认账只认整表齐的账**（`gridPxOf(rows)`：行 0 非空、每格 `colwidth` 必须是数组**且长度等于该格 colspan**、
  枚枚 `> 0`、每一行的 colspan 之和必须等于摊平出来的网格列数）；任一道门不合 ⇒ 整表按「无宽度账」处理，而
  **五个出口一律 `return null`、绝不 `return []`**（拿空数组去写网格等于伪造一份"有账"）。理由是 `w:gridCol` 的枚数
  必须和单元格的跨度对得上，对不上的件在 Word 那头是**损坏件**档而不是"宽度不准"档（**v0.90 就地改口**：这一道
  「每一格都得带账」松成了「有几枚写几枚、没带账的列按剩余版心补平」，因为真拖一次得到的正是部分账
  `[248]|null|null`，另三道形状门一道没松、出口涨到七个而仍全返 null）；
  ② **有账的表声明固定布局**——表级 `{width: {size: totalTw, type: DXA}, layout: FIXED}`（`w:tblW` 写真绝对值而不是
  百分比，绝对值 = 网格之和，两边不自相矛盾才够 `fixed` 的语义）、`columnWidths: gridTw` 写真网格，
  逐格 `w:tcW` = **所跨那几枚网格列之和**（`gridTw.slice(gc, gc + cs)`），网格游标 `gc` **只为真格子前进**
  （`if (isCell) gc += cs`：行里的非 cell 孩子不占网格位）；
  ③ **没账的表不谎称固定宽**——表级仍是 `{size: 100, type: PERCENTAGE}`、**不声明 `fixed`**、**不逐格盖 `w:tcW`**，
  只有 `w:gridCol` 改由版心等分（`equalGridPx`：版心 twips → px → `floor(÷ 列数)`，保底 1）。这一档买的是
  "别再写 6.7px 那种荒谬值"，不是"替用户决定宽度"——布局那一头仍交给 Word 自动排；
  ④ **版心从导出入口算一次并穿下去**（`prosemirrorToDocxBytes` 先算 `contentTw` = 页宽 − 左右边距 − `colGap × (栏数 − 1)`
  再按栏数分，作为 `blocksOf` 的第 4 参一路穿过四处递归，形参带 `CONTENT_TWIPS_FALLBACK` 兜底 = A4 + 默认边距算出而非硬编码数）：
  表在列表项里、在嵌套列表里、在单元格里的话，等分用的都该是它真实可用的那一层宽度而不是一个常量。
  单位仍只有一处换算（模型存 px，`PX_TWIP = 15`）——**px 存整数 ⇒ 导出必然带 ±0.25 磅级漂移**，字节腿按 ±15 twip、
  Word 腿按 ±0.5 磅判这一档而不是要求逐字节相等。
- **验证（腿 + 编译，全部在版本号 bump 三处对齐之后在最终源文上复跑）**：结构+变异合并一腿
  **`RESULT struct=21/21 mutants=16 bad=0 b0=3/3 exit=0`**（吃剥掉注释并归一 LF 的源文；B0 自检三条——行注释里的锚点
  剥后不再存在、代码里的锚点仍在、**含 `"` 与 `'` 的两枚正则字面量原样活着**；S0a~S19：认账四道门 + 出口全 null +
  fixed/百分比两档各只一枚 + `columnWidths` 一枚 + px→twips 保底 1 + 逐格所跨之和 + 游标只认真格子 + 等分算法 +
  版心由 A4 算出 + 四处递归全穿 + 多栏扣栏距按栏数分 + v0.30/v0.38 表格通道原样 + **S19 记 ODT 写侧本轮没开**；
  16 枚变异各响该响的那条——M1 无账也拿库默认→S7、M2 fixed 退 autofit→S5、M3/M4/M5 拆三道认账门→S1/S2/S3、
  M6 逐格只拿首列→S9、M7 游标对所有孩子前进→S10、M8 无账也盖 tcW→S11、M9 等分忘 px 换算→S12、M10 版心写死 210→S13、
  M11/M12 递归与入口不穿版心→S15、M13/M14 多栏不扣栏距/不分栏数→S16、M15 表格缩进回归面→S17、M16 声称 ODT 已做→S19；
  两枚正控制 P0 原样 / **P1 注释陷阱**埋进注释的四条锚点剥后一律不算命中）；CDP dev 真机 **21 / 0、页面异常 0 条**
  （四臂 × 五判：三枚夹具臂 D1 模型行 0 收下夹具列宽、D2 屏上 `<col>` 与列数等长、D3 导出落盘、**D4 二趟不再退化成
  7px 假宽**、D5 二趟屏上与模型一致；无账臂 notblwidth D4 二趟拿到的是等分真宽（px 读数 [209,209,209]）；
  tblspan D6 行 1 首格跨两列且摊平成三枚网格列）；独立字节腿（zipfile + 正则直解 `word/document.xml`，不吃自家读侧）
  **23 / 0**（A2 网格 = 1800/2400/3600、A3 六格逐格 tcW = 所跨网格列之和、A4 一律 dxa、A5 表级绝对值 = 网格和、
  A6 fixed；B1 auto 件两列 ±15 twip 内、B2 声明 fixed；C1~C3 跨度件（1500/3000/1500 + `gridSpan=2` + 次行 4500/1500）；
  D1~D4 无账件 = 三列等分 ~3135（绝不是 100）且**不盖 tcW / 仍百分比 / 不声明 fixed**；E×4 三趟网格逐枚相同；
  F×4 单元格正文不丢）；Word 16.0 只读腿 **20 / 0 + 2 条 NOTE 记账**（W1 导出件列宽 = 夹具的 90/120/180、
  W2 「塌成三等分」那一缺陷形状不再出现、W3 逐格与列宽一致、W5/W6/W7 跨度件逐格与夹具相同（首行 75/150/75、
  跨两列那格 225）、W8/W9 无账件 prefType=2 百分比且列宽等分而非 6.7 磅假宽、W10 重开件与夹具逐枚相同、
  W11 无账件重开一趟列宽不变；NOTE：重开后的无账件 prefType 2→3、含合并格的表 Word 的 `Columns` 集合一律抛
  COMException（夹具与导出同尺同读数））；`cargo test --lib` **97 passed / 0 failed / 11 ignored**（Rust 本轮一个字没动）
  + `pnpm exec tsc --noEmit` exit 0 + `pnpm tauri build --no-bundle` 绿（openoffices v0.89.0）。
- **本轮撞到的量具坑六处，都不是产品**：① **注释陷阱又种在剥之后的源文上**（`run(TRAP + d0)` 里 d0 已剥 ⇒ 陷阱字面
  被当代码数到，P1 假 FAIL 报「多出来=[S5,S7,S15,S18]」）——v0.84 记过的原样再犯一次，修法必须是 `readRaw()` +
  `stripComments(TRAP + raw)`；② **剥注释器不认正则字面量**：`docx.ts:177` 的 `/PAGE(\s|\*|"|'|<)/` 里那对引号开出
  一枚假字符串态，把后面一整段 JSDoc 留在"剥后源文"里（B0a FAIL）⇒ 加正则起点判定（前一枚非空吐出字符 + 关键字前瞻，
  带字符类/转义/遇换行弃守/吃尾部 flags），并把 B0c 加宽成断言两枚正则都原样活着；③ **判据回调的参数顺序**——S19 声明成
  `(o)` 而调度器喂的是 `(docxSource, odtSource)`，于是它一直在 docx 文件里找 `table:table-column`（恒 0）：**基线那条 PASS
  是空断言，只有变异腿（M16）把它抓出来**——"判据作用在错的文件上也能绿"这一族的第一次兑现；④ 数递归调用点那条正则
  `blocksOf\([^)]*contentTw\)` 跨不过 `slice(1)`，而入口变量名是 `contentTw`、形参名是 `contentTwips`，多行定义还会自匹配
  ⇒ 改 `blocksOf\((?:[^()\n]|\([^()\n]*\))*contentTw` 再加一枚全仓出现枚数上界；⑤ **变异的期望清单要按判据实际量的东西写**：
  M3/M4/M5 各坏一道认账门，而 S4 量的是 `return null` 的**枚数**（那三枚变异一枚不改）⇒ 期望里带着 S4 就是「该响未响」假 FAIL；
  ⑥ dev 腿的阈值单位混过一次（无账臂 D4 断 `v > 300` 而实际读数是 px 的 [209,209,209] ⇒ 腿自己的 FAIL 长得像产品的）。
- **本轮没动的，量出来记着**（已开进路线图）：① **ODT 的列宽两头都不往返**（写侧零枚 `table:table-column`、读侧不解析
  `table:style`/`table-column`），明写不开——本机无 ODF 应用且规格源全 404 ⇒ 无人可裁；② **界面上没有精确设宽的把手**
  （TipTap 无 `setColumnWidth`），本轮只保证「已有的账不丢」，用户仍然拖不出"这一列 90px"；③ 读侧仍只吃 `w:gridCol`，
  **不读 `w:tblLayout` / `w:tcW` / `w:tblCellMar` / `w:trHeight`** ⇒ 第三方件里 `tcW` 与 `gridCol` 打架时以谁为准未量；
  ④ **无账的表存—重开一趟之后就变成"有账"**（等分那份真网格被读回收下 ⇒ 下一趟按固定宽写，Word 那头 prefType 2→3），
  这是本轮带来的形状改变，等分账本身三趟逐枚稳定；⑤ 嵌套表的版心是按最外层算的近似（不扣外层单元格的边距）；
  ⑥ px 存整数的 ±0.25 磅级漂移是模型层的，不在本轮口径内；⑦ **本轮没有 release A/B**——纯写侧字节改动，证据来自
  字节 + Word 只读 + dev 三头，"界面上看到的列宽与导出的件一致"由 dev 判；⑧ 含合并格的表在 Word COM 上 `Columns`
  集合直接抛 ⇒ 跨度那一档只能按 `Rows(1).Cells` 量（夹具与导出同尺同读数，不构成差异判据）。
- **收尾**：README 新增本节 + 架构两处就地括号改口（v0.37「覆盖」那条的 `tblGrid` 列宽补上「读侧一直全、写侧到 v0.89
  才写」+ v0.30 表格通道那条补上列宽写侧）+ 文件清单 `lib/docx.ts` 条目补 v0.89 段 + ODF「范围限制」明写列宽两头都不往返
  + 路线图新立本轮已建的那条（`- [x]` docx 表格列宽真往返）并新开上述八枚未勾项，版本 0.89.0（package.json /
  tauri.conf.json / Cargo.toml 三处对齐），tmp/x89 的夹具、前置实测腿、dev 腿、字节腿、Word 腿与结构+变异腿按惯例删除
  （收摊后 1420/9222 无监听、`target/debug/openoffices.exe` 零枚残留，全程未碰已装正式版）；自动更新的源托管与
  macOS 打包按指令继续等信号，签名私钥已加密备份并演练 7/7，**私钥本体在本机仍是单点**。

## 列宽的把手第一次看得见，拖出来的那一枚宽度也不再被整表作废（v0.90）

「继续对标 WPS 完善文档处理」自选口径（从 v0.89 收尾那句候选缺口里取「无精确设宽把手 + 部分账那一档」）：把手那一格
实测**有两半**——看不见的把手 + 没有键入精确宽度的地方。本轮做能窄做的那两件事：让那条拖得动的缝真的看得见，
以及让**部分账**（界面上拖一次得到的形状）不再被 v0.89 的认账门整表判成"无账"。窄口径（Rust 一个字没动）：
`src/lib/docx.ts` +32 / −13（`gridPxOf` 重写成「只松一格」）+ `src/index.css` +38（`.column-resize-handle` 这一族
此前**产品里一条样式都没有**，`grep -rn "column-resize" src/` → 0 命中）。

- **前置实测六格（tmp/x90，真鼠标真字节，只量没改产品）**：① **拖之后逐格 `colwidth` 到底是什么形状**
  （`Input.dispatchMouseEvent` 一对真事件）：在无账表上拖第 1 列 +40px ⇒ `before` 六格全 null、**拖拽途中模型一个字
  没动**（`mid` 仍全 null，屏上反馈是 `<col>` 的 inline style 228px）、`after=["[248]|null|null","[248]|null|null"]`
  而 `colsAfter` 是 248 / 188.7 / 188.71（表宽 626.07 不变）——**只写被拖的那一枚网格列，但写遍了所有行**；在整表
  齐账的件上拖 +30px ⇒ `after=[150]|[160]|[240]` 两行仍齐账，而屏上视觉只动了 **+26.24px**（这一版没有
  `.column-resize-proxy`，拖拽把屏幕位移直接当模型 px 增量用＝**混单位**）；读源码对上通道：prosemirror-tables 1.8.5 的
  `updateColumnWidth` 只在 mouseup 走、把这一枚网格列写进所有行（跳过 rowspan 延续格），缺就补 `zeroes(colspan)`
  ⇒ **无账表上拖一次 = 一枚有账 + 两枚 null = 部分账，界面上真的造得出来**；② 部分账那一档**现在导出成什么**：
  `none` / `partial` / `dragged`（无账件拖过一列）三件**字节逐枚相同**——`tblW=('100%','pct')`、`layout=None`、
  `grid=[3135,3135,3135]`、`tcW` 全 None ⇒ J1「dragged 网格里没有 248px 那枚（3720 twip）」、J2「与无账件逐枚相同」；
  齐账那两件一直是好的（`full` 1800/2400/3600 + fixed + 7800 dxa、`dragfull` 2250/2400/3600）；③ **Word 16.0 只读腿
  对同一批件的磅读数**：none / partial / dragged 三件一律 `156.7 × 3` ⇒ **用户拖过的那一列在 Word 里跟没拖一样**
  （屏上有、字节里没有、Word 里也没有＝一路静默），full `90/120/180`、dragfull `112.5/120/180`（+30px = +22.5 磅，
  第三方认账）；NOTE：`Row.PreferredWidthType` 对这几件一律读回 0、**不分叉** ⇒ 宽度形状不以 prefType 为证；④ **屏上
  没带账的列的读数**：无账件 `minW "25px"`、rect 208.47 ×3、`<col>` 无 `style.width` ⇒ 那是浏览器 auto 布局在算宽，
  三列等分是巧合不是设计；partial 件 `model=["[120]|null|null" ×2]`——夹具只给行 0 第一格带账而**载入时库就把这一枚
  摊到了整列**（`findBadColWidths`：某列声明数 < 表高才跑）⇒ 屏上是「这一列 120px、其余两列平分剩下的」（120/252.7/
  252.71），与导出侧那份等分三列**不同形**；齐账件 `styleW` 是模型 px（120/160/240）而 rect 是 144.32/192.43/288.66
  ⇒ 我们的 `IndentTableView` 把 `table.style.width` 写成 `calc(100% - Npx)` 覆盖了库的绝对宽，**屏幕上宽度是比例、
  导出字节里是绝对 dxa**（这一层不一致本轮只记账不动）；⑤ **`fixTables` 公开通道能不能替我们把账补平**：只改行 0
  那一枚为 [210] 再跑命令 ⇒ `{ranCmd:true, afterNoStructureChange:true, rows:[120,160,240]×2}`——**改的那一枚被下一趟
  事务抹回 120**（`tableEditing` 的 `appendTransaction` 每趟跑 `fixTables(state, oldState)` 并派发结果 tr，而 TipTap 那条
  公开命令 `if (dispatch) fixTables(state)` 把返回的 tr 直接丢掉＝no-op），无账件跑它 `unchanged:true` 补不出账
  ⇒ 形状结论：**任何"只写一行"的宽度设置在下一趟就被摊平/抹掉**，要做精确设宽就得一次写遍该网格列的所有行；⑥ **把手
  为什么"看不见"**：产品没给这一族任何 CSS，实测把手装饰的 rect 是 `width 188、height 0`（cy 落在两行之间）而拖拽本身
  是通的（`handleMouseDown` 只看 `pluginState.activeHandle`，不认指针是否压在把手 DOM 上）⇒「有功能、没有可见入口」。
- **本轮口径（由以上实测选出）**：两半里可窄做的两件事——① 把列边界那条缝做成看得见的（CSS 那一层完全缺失）；
  ② 把部分账那一档从「整表作废」改回「账写进去」。**精确键入宽度的输入框本轮仍不做**（⑤ 那条形状结论说明它需要
  一次写遍整列的命令，不是加一枚输入框就完事）。
- **本轮唯一的架构决定：四道认账门里只松一道，另三道一道不松**——四条形状都不是可选的：
  ① **只松「每一格都得带账」那一道**：`gridPxOf` 现在把行 0 各格的账摊成 `laid: (number | null)[]`，**长度必须等于
  该格 colspan、枚枚必须是正数（`0` = 该列没账，是库自己的约定）、每行 colspan 之和必须等于网格列数**这三道门
  原样保留；任一道不合仍 `return null`（`w:gridCol` 枚数与跨度对不上在 Word 那头是**损坏件**档而不是"宽度不准"档，
  而**七个出口一律 `return null`、绝不 `return []`**）；
  ② **一枚账都没有 ⇒ 照旧 null**，走「无宽度账」那一档（版心等分 + 百分比表宽 + 不声明 fixed），那一档的字节形状
  本轮一个字没动（`equalGridPx` 仍在，S15 判它）；
  ③ **没带账的列分走剩下的版心**：`fill = max(1, floor((contentPx − Σknown) / rest))`，只有未带账的格子吃补出来的那份
  （`laid.map((px) => px ?? fill)`），整表齐账时 `rest === 0` 那条分路根本不进（不会除零）——**这一档在屏上就是浏览器的
  算法**（实测 colsAfter 248/188.7/188.7 对字节 3720/2835/2835 即 248/189/189，±1px 内），补平后的总宽必然 = 版心；
  ④ **把手样式全住在 `.doc-content` 口径内**：`td/th {position: relative}` 给把手一枚 containing block，把手绝对定位
  `right:-3px / top:0 / bottom:0 / width:6px / cursor:col-resize`（不再撑满整格宽而高 0），常态不刷存在感（`::after`
  那条 2px `--accent` 靠 `opacity:0`，悬停才 `.65`），**拖拽中的那一列用 `outline` 不用 `background`**（v0.38 那层单元格
  底纹是内联样式，背景会把它压掉），`@media print` 里把手 `display:none`——编辑态的把手不上纸。单位仍只有一处换算
  （`PX_TWIP = 15`）⇒ 拖出来的宽度导出必然带 ±0.25 磅级漂移，字节腿按 ±15 twip、Word 腿按 ±0.5 磅判这一档。
- **验证（腿 + 编译，全部在版本号 bump 三处对齐之后在最终源文上复跑）**：结构+变异合并一腿
  **`RESULT struct=26/26 b0=4/4 exit=0`**（吃剥掉注释并归一 LF 的源文；B0 自检四条——注释里的中文短语 CSS/TS 两头剥后
  都消失、字符串字面量内容活下来、**含 `"` 与 `'` 的正则字面量原样活着**、`gridPxOf` 切片确实从剥后源文切的；
  S0 切片非空 + S1~S10 认账三道门 / 出口全 null（`return null` 恰 7 枚）/ `0` 与正数与负数三态 / 版心不硬编码数 /
  补平算法 / 齐账不走补平 / 只有未带账的格子吃补 / S11~S14 调用点顺序与 fixed·百分比两档形状 / 逐格闸门吃"有没有账"
  而不是"账齐不齐" + S15~S17 无账那档原样、版心穿三处递归、导出入口喂进去 + **C0~C7 把手八条**（规则块非空、绝对定位
  的 6px 缝、`td/th position:relative`、常态不亮悬停才亮、高亮用 outline 不用 background、打印不上纸、
  **不给这一版根本不产出的 `.column-resize-proxy` 写样式**、新增选择符全在 `.doc-content` 口径内）；16 枚变异各响该响的那条
  ——M1 补平不扣已入账的→S8、M2 一枚账都没有也不返 null→S4+S5、M3/M4 拆两道形状门→S2/S3、M5 `0` 被当账→S6、
  M6 齐账也走补平（除零）→S9、M7 不声明 fixed→S12、M8 无账也盖 tcW→S14、M9 版心写死 626→S7、M10 调用点不穿版心→S11、
  M11 把手不绝对定位→C1、M12 `position:static`→C2、M13 悬停不亮→C3、M14 高亮退成 background→C4、M15 打印那条指错
  选择符→C5+C6、M16 `::after` 跑出 `.doc-content` 口径→C3+C7；两枚正控制 P0 原样 / **P1 注释陷阱**（埋进注释的锚点
  剥后一律不算命中，`RESULT trap ok`、`TRAP S4 读数=实数=7`）；CDP dev 真机腿 **EXIT=0、页面异常 0 条**（把手实测
  `w:6, h:50`——同一枚量具改前读的是 `188 × 0`；两臂真拖 `after=["[248]|null|null" ×2]` 与
  `["[150]|[160]|[240]" ×2]`；`fixTables` 两臂 no-op 复现；三枚夹具的模型/屏上读数逐枚同前置实测）；独立字节腿
  （zipfile + 正则直解 `word/document.xml`，不吃自家读侧）**14 / 0**（B1 无账件仍是不谎称固定宽那一档、B2 网格 = 版心
  三等分 3135 且绝不 100、**B3 dragged 网格 = 3720 + 2835 + 2835（拖的那枚进了字节、剩下的补平）**、B4 dragged 声明
  fixed 且表级绝对宽 = 网格和 9390、B5 两行逐格 tcW 各等于所跨网格列、**B6 dragged 与无账件不再同形**、B7 partial =
  1800 + 3795 + 3795、B8 full 1800/2400/3600 未回归、B9 dragfull 2250/2400/3600、B10 调过 `fixTables` 的那件与 full
  逐枚相同、B11 六件逐格正文都还在（补平不吞字）、B12 部件齐全、**B13 补平后总宽 = 版心 9390**、B14 屏上 188.7px vs
  字节 2835 twip = 189px 在 ±1px 内）；Word 16.0 只读腿 **`RESULT word90 bad=0`（10 PASS）**（W1×5 五件逐格磅 =
  自家 `w:gridCol/20`，最大 0.05 磅、**W2 dragged ≠ none**（旧缺陷正是两者读数完全相同）、W3 dragged 第 1 列 = 186 磅
  即那枚 248px 被兑现、W4 full = 90/120/180 未回归、W5 dragfull 第 1 列 = 112.5 磅、W6 dragged 行宽之和 = 版心
  469.5 磅 ⇒ 补平没有把表撑出版心）；`cargo test --lib` **97 passed / 0 failed / 11 ignored**（Rust 本轮一个字没动）
  + `pnpm exec tsc --noEmit` exit 0 + `pnpm tauri build --no-bundle` 绿（openoffices v0.90.0）。
- **本轮撞到的量具坑五处，都不是产品**：① **产品的定时自动保存会改写夹具**——第二趟 dev 腿读到 `none.odoc` 的模型是
  `[248]|null|null`、`full.odoc` 是 `[150]…`，那是上一趟真拖留下的账被自动存盘写回了盘；修法是**每趟腿之前先重跑
  `fx.mjs`**（v0.87「夹具必须写成产品真形状」的同族：形状对了，内容仍会被产品自己改）；② **验证腿的期望停在旧缺陷形状**
  ——字节腿第一版还断「dragged 与无账件同形」（那正是要修的缺陷），改完产品它自己 `bad=1`；判据必须由**同一趟量出来**
  重写，不能沿用前置实测那趟的结论行；③ **PS 5.1 上 `$obj.$p` 动态属性访问对 COM 直接抛「不能对 Null 值表达式调用方法」**、
  也没有 ternary ⇒ 一律显式属性名 + `[int]`/`[double]` 强转 + `Say()` helper；同趟另量出 `Row.PreferredWidthType`
  对本轮五件**一律 0 不分叉**（记 NOTE，宽度形状以磅与字节为证）；④ **变异腿与陷阱腿都在 `j.id` 上栽**：判据 id 带着
  中文描述（`S8 补平 = …`）而期望清单写的是裸 id ⇒ 16 枚变异全体 `rc=2`「漏 / 多都填满」的**假 BAD**，
  `J.find((j) => j.id === 'S4')` 同样拿到 undefined ⇒ 比较一律 `split(' ')[0]` / `indexOf('S4 ') === 0`；
  ⑤ **`dir_path` 会改重定向基准**——`cargo test --lib` 配 `dir_path=src-tauri` 时 `> tmp/x90/…log` 报
  `No such file or directory`（相对路径按 `dir_path` 解析）⇒ 腿日志一律用绝对正斜杠路径。另有一处是**前置实测**撞的：
  docx 库写 `<w:tblW>` 的属性顺序不固定（`w:type` 在前而 `w:w` 在后）⇒ 字节腿一律按属性名取，不按顺序匹配。
- **本轮没动的，量出来记着**（已开进路线图）：① **精确数值设宽的输入框仍然没有**——本轮做的是「把手可见」+「拖出来的
  账不丢」，用户还是键不出"这一列 90px"，而⑤ 那条形状结论说清了这个把手该长什么样（一次写遍该网格列的所有行）；
  ② **拖拽把屏幕位移当模型 px 增量**（P1b：要 +30px 而屏上只 +26.24px，这一版没有 `.column-resize-proxy`）＝混单位；
  ③ **屏上比例 vs 字节绝对宽**那一层不一致（`IndentTableView` 写 `table.style.width = calc(100% − Npx)`）本轮只记账；
  ④ 读侧仍不读 `w:tblLayout` / `w:tcW` / `w:tblCellMar` / `w:trHeight`；⑤ ODT 列宽两头都不往返（v0.89 明写不开）；
  ⑥ **部分账件存—重开一趟会变成整表齐账**（v0.89 那条「无账换档」的同族）：补平出来的那份真网格被读侧逐格收下 ⇒
  下一趟人人都带账；⑦ `fixTables` 公开通道是 no-op 这一格只记读数没动（只改一行的宽度设置在下一趟被抹掉是库的行为）；
  ⑧ **本轮没有 release A/B**：把手那一半是纯 CSS、字节那一半由 dev 腿落盘的件交给字节腿与 Word 腿裁，release 上
  只有形状推断；⑨ w:between 第五边、嵌套表版心按最外层近似、px 存整数的 ±0.25 磅漂移都原样挂着。
- **收尾**：README 新增本节 + 架构 v0.89 那条就地改口（「认账只认整表齐的账」→「四道门只松一格：部分账按剩余版心补平」）
  + 文件清单 `lib/docx.ts` 条目同步改口、`index.css` 条目补 v0.90 把手那一段 + 路线图把「界面上没有精确设列宽的把手」
  拆成勾掉的一半（把手可见 + 拖出来的账不丢）与未勾的一半（键入精确宽度），并新开上述未勾项，版本 0.90.0
  （package.json / tauri.conf.json / Cargo.toml 三处对齐），tmp/x90 的夹具、前置实测腿、dev 腿、字节腿、Word 腿与
  结构+变异腿按惯例删除（收摊后 1420/9222 无监听、项目路径进程 0 支、Word 只读腿那两枚不可见 WINWORD 先按
  `GetActiveObject` 列文档确认归因再 Close + Quit，全程未碰已装正式版）；自动更新的源托管与 macOS 打包按指令继续等信号，
  签名私钥已加密备份并演练 7/7，**私钥本体在本机仍是单点**。

## 列宽第一次能键进一个精确的数，含竖跨的表整表丢账那一格顺手也挖掉了（v0.91）

「继续对标 WPS 完善文档处理」自选口径（取 v0.90 收尾那句候选缺口里剩下的另一半——「键入精确宽度」：那一轮把把手做
得看得见、拖出来的账不再被整表作废，而用户还是键不出"这一列 90px"）。窄口径（Rust 一个字没动）：新建
`src/lib/table-width.ts`（252 行：四味纯函数 + 一枚 TipTap 命令）+ `src/lib/docx.ts` +114 / −28（`gridShapeOf` 新立、
版心公式从导出入口搬成 `contentTwipsOf`/`contentPxOf`）+ `src/components/DocEditor.tsx` +40（表格那一排的「列宽」输入框）。

- **前置实测七格（tmp/x91，dev 真机真事务，只量没改产品）**：① **六枚夹具的模型账与屏上读数**（M0）：`none`
  `laid=[null,null,null]` 而 rect `208.47 ×3`（浏览器 auto 布局在算宽）、`full` `[120,160,240]` 的 `<col>` styleW 是模型 px
  而 rect 是 `144.32/192.43/288.66`（v0.90 记过的那层"屏上比例 / 字节绝对宽"的不一致，本轮又量到一次）、`span` 行 0
  只有两格而 `cols=3`、**`rowspan` 行 1 只有两格 `["[160]|1x1","[240]|1x1"]` 而 `cols=3`**（被上面竖跨压掉的那一枚在
  TipTap 模型里根本不存在）、`partial` `[248,null,null]` rect `248/188.7/188.71`、`over` `[300,300,300]`（Σ=900 超出版心）
  而 rect 仍是 `208.47 ×3` ⇒ **表宽不由账决定，屏上没有"超出版心"这件事**；② **光标认到的是哪一枚网格列**（M1）：
  跨两列那一格里光标报 `0,0`（被盖住的后续列没有独立把手）、竖跨件行 1 第一格也报 `0,0`；③ **只写行 0 与一次写遍**
  （M2）：齐账件上把行 0 那一枚改成 200 ⇒ `afterWrite=[120,160,240]`＝**同一次 dispatch 之内就被抹回**（`tableEditing`
  拿其余各行的账覆盖行 0），而一次写遍 `afterWrite=[120,200,240]` 且再走一趟无关事务仍在；④ **键入 90 的两臂对照**
  （M3，这一格决定了本轮的形状）：`none` 臂 `onlyOne=[90,null,null]` rect `[90,267.7,267.71]`、`widths=[90,268,268]`
  （Σ=626）rect `[89.94,267.73,267.74]`＝**键入值 1:1 上屏当且仅当 Σ 恰等于可用宽**；`full` 臂只改那一枚
  `widths=[90,160,240]`（Σ=490）⇒ rect `[114.86,204.21,306.33]`＝浏览器按 626/490 把三份账整体放大，键进去的 90
  屏上变 114.86；`over` 臂 `[90,300,300]`（Σ=690>626）⇒ `[84.22,270.58,270.6]` 缩小；`span`/`rowspan` 臂 `steps=6`
  而 `cells=5`（模型里那一枚不存在）；⑤ **一次写遍的撤销代价**（M4）：`cells=6 / steps=6` 而 `undo1=[null,null,null]`
  ⇒ 同一枚事务里六个 `setNodeMarkup` 仍是一步撤销；⑥ **版心的来源**（M5/M7）：活动标签 `editorClient=626`、
  `.doc-page` hostRect 793.7，而 docx 那头的公式给 627（9405 twip ÷ 15）＝**一枚 1px 口径差**；多栏件按 1/2/3 栏
  实测 626 / 304 / 196，`<col>` 一直是模型 px 而 rect 按比例；⑦ **导出一趟的落盘形状**（M6，交给字节腿）。
- **本轮唯一的架构决定：一把输入框 + 一次写遍 + Σ 恰等于可用宽**——五条形状都不是可选的：
  ① **一次事务写遍该网格列的每一枚真格子**（M2 那条：只写行 0 会在同一次 dispatch 里被 `tableEditing` 抹回；
  被竖跨压掉的延续格在模型里不存在，不参与写入，导出侧靠占位对齐兑现）；
  ② **其余列按各自现有的账等比分享剩下的可用宽**：`baseWidths` 先把没账的列补平成同一份账（与 docx 写侧的 `fill`
  同一算法），`redistribute` 再按 `targetPx − 键入值` 摊给其余列，舍入用**最大余项法**配平、每列保底 1px、键入列
  夹到 `targetPx − (cols−1)`（M3 那一档"1:1 上屏"的条件，否则 Σ 落不到可用宽上）；
  ③ **可用宽只从一处算**：版心公式从 `prosemirrorToDocxBytes`
  里内联的那一份搬成 `contentTwipsOf` / `contentPxOf`（导出入口与界面同吃它，D6 判「全文件只出现一次」），界面
  那头再扣掉表级缩进——`marginLeft` 在屏上写的是 `width: calc(100% − Npx)`，不扣它键入值照样被浏览器缩走
  （A2-ind 实测 `target=587 = 627 − 40`）；④ **网格形状那道门改成按占位走**：新立 `gridShapeOf`（行内游标跳过被
  竖跨压掉的列；横向跨出列数 / 竖向跨出行数 / 格子互相压住 / 每行没铺满网格列数 ⇒ `null`，**出口一律 null，
  绝不给半份形状**），`gridPxOf` 认账与导出逐格游标共用同一份 `starts`，导出侧从 `if (isCell) gc += cs` 改成
  `start = shape.starts[ri][ck++] ?? gc` + `gc = start + cs`（不省被压掉的那几枚，否则整行往左错一枚、键进去的账
  落错格子）；⑤ **重打同一个数字不多一枚撤销步**（`same` 检查 ⇒ B4 `docTx=0`），全表无变化时命令返回 `false`。
- **顺手挖掉的一处真缺陷（含竖跨的表整表丢账，v0.89 起一直挂着）**：写字节腿时当场量出来——`rowspan` 夹具揣着
  `[120,160,240]` 的账进导出，字节却是 `[3135,3135,3135]`（那是"无账那档按版心等分"的形状）而不是
  `[1800,2400,3600]`。读源码对上门道：v0.89 立的那道「每行 colspan 之和等于网格列数」只数**行内自己的格子**，
  而 M0 早就量过竖跨件行 1 只有两格（`cols=3`）⇒ **含竖跨的表整表判成形状不合、宽度账整表作废**，正是 v0.90
  为"部分账"松掉的那一类静默（屏上有、字节里没有、Word 里也没有），只是这一次踩到的是竖跨而不是拖拽。⑦ 那格的
  形状结论直接给出了修法（按占位走），本轮据此立 `gridShapeOf`；字节腿 X18/X18b/X18c 与 Word 腿 W1~W4 钉这一档。
- **验证（腿 + 编译，全部在版本号 bump 三处对齐之后在最终源文上复跑）**：算术腿（`tmp/x91/redist.test.ts`，
  `pnpm exec vite-node`）**`RESULT redist pass=11 fail=0`**（R1 `[90,268,268]` / R2 齐账件等比重排 `[90,214,322]` Σ=626 /
  R3 部分账 `[299,100,227]` / R5 夹到 `[624,1,1]` / R6 幂等 / R7 单列 / R8 四道闸门 / R9 `[200,111,389]` / R10 全扫
  `bad=0` / R11 `base-fill [208,208,208]`）；结构+变异合并一腿 **`RESULT struct=40/40 mutants=38 bad=0 extra=0 b0=3/3
  p1=ok`**（吃剥掉注释并归一 LF 的源文；B0 自检三条含「竖跨那两条注释里的锚点短语剥后 0/0 命中」；
  T1~T15 钉 `table-width.ts` 的四道闸门 / 夹取 / 单列早退 / 最大余项法 / 写回顺序 / `baseWidths` / 账只取行 0 /
  跨度展开 / `0` 与负数不算账 / 可用宽扣缩进 / 界面读数吃同一份账 / 整表一片且先验齐 / 同值零步 / 一枚事务 /
  不借 `TableMap`；D1~D14 钉版心一处算 + px 换算一处 + `gridShapeOf` 的出界·压住·铺满三道门 + 先记起始列再进行 +
  导出侧游标吃 `shape.starts` + 形状不合时列数退回行内跨度和 + v0.89/v0.90 两档字节形状原样；E1~E11 钉命令注册、
  把手只一枚、`min/max` 就是那道闸门、种子值随「哪一列 + 当前账」换 key、Enter 与失焦同走 `commit`、把手住在
  `doc-table-bar`；38 枚变异各响该响的那条（M18 不只改一处版心公式 → D1+D6），两枚正控制 P0 原样 / P1 注释陷阱
  `多出来=[]`）；CDP dev 真机腿 **`RESULT dev pass=40/40 bad=0`、页面异常 0 条**（A 六件 + 缩进件：把手在场、
  `min=1 max=target`、**种子值 = 模型读数**（A3 的 `predicted === seed` 七臂全对，无账件读的是等分补平后的 209）、
  A4 `target 587 ≠ 627` 证缩进真的扣了、A5 光标在表外时这一枚不出现；B 键入 90 两臂 `docTx=1`（一枚改文档的事务）
  而 `allTx=6`、屏上 `colStyle` 与模型逐枚同值且 rect 兑现到 ±0.2px、`undo` 一步回原状、重打同值 `docTx=0`；
  C1 键 0 被拒且字节没动、C2 键 999 夹成 `[1,625,1]`、C3/C4 跨两列那格写成 `[90,269]`（数组长度等于 colspan）、
  C5 竖跨件「各行同账」`[172,111,344]` 且行 1 第一格读回 `[111]`）；独立字节腿（zipfile + 正则直解
  `word/document.xml`，不吃自家读侧）**27 / 0**（X1 键出来的 90 落进字节 `[4035,1350,4020]`、X4/X7/X10/X13b 补平后
  总宽 = 版心 9405、X8 拒 0 之后字节没动、X9 夹取 `[15,9375,15]`、X12 跨列首格吃两列之和 5385、**X14b 键进去的账
  穿过竖跨到第二行**、**X18 竖跨件带着账落地 `[1800,2400,3600]`（改前这一档量出来是 `[3135,3135,3135]` 的无账形状）**、
  X15~X21 无账那档 / 齐账 / 跨度 / 部分账 / 超出版心 / `w:tblInd` 六档未回归、X22 重排不吞字）；Word 16.0 只读腿
  **16 / 0 + 两条 NOTE**（W1~W4 竖跨件行 0 `90/120/180` 磅、行 1 只读回 `120/180`（被盖住的那格不重复出现）且正文
  没被吞、W5 键进去的 111px = **83.25 磅**、W6/W7 穿过竖跨那一列各行同账且行宽之和 = 版心 470.25 磅、W8~W11 无账件
  键入与未键入两档、W12 缩进件照旧 `90/120/180`、W13/W14 夹取那一档、W15/W16 跨列件 `150/75` 与 `75×3`；
  NOTE：`w:tblInd` 在 `Rows/Cells` 宽度上没有 COM 到达面、Word 的最小单元格宽 2 磅把我们 1px 那一档的差从主导列扣走）；
  `cargo test --lib` **97 passed / 0 failed / 11 ignored**（Rust 本轮一个字没动）+ `pnpm exec tsc --noEmit` exit 0 +
  `pnpm tauri build --no-bundle` 绿（openoffices v0.91.0，3m33s）。
- **本轮撞到的量具坑八处，都不是产品**：① **剥注释器的 `scanBraces`（吃模板 `${}` 那一枚）不认正则字面量**——
  `${target.replace(/^\.\//, '')}` 里那对 `/` 被读成行注释起点、模板收尾的反引号被吞、模板态一路吃到下一枚反引号，
  把**真注释整段吐回"剥后源文"**（B0a FAIL 报 `竖跨注释=1/1`）；代价比这条 bug 本身大：**此前所有吃 `docx.ts` 的
  判据一直匹配在没剥净的源文上**（注释里的短语也算命中）＝「尺子瞎不是产品哑」同族第六次兑现、方向是假绿；
  修法是 `scanBraces` 自带 `prevSig`/`ident` 的正则前瞻与 `/*` 块注释，并把「注释里的锚点剥后 0 命中」写成 B0a 的
  一条自审；② **dev 腿的导出必须排在 undo 之前**（B6/B5 顺序写反过一次 ⇒ 字节腿拿到的是回原状之后的件，
  X1 那条 FAIL 长得像"产品没写账"）；③ **`__oofOpenPath` 按 path 去重**——同一趟里第二枚夹具"打开了"而活动标签
  仍是第一枚（`pre-a.log PRE|FAIL|fixture not opened: full`）⇒ 每趟腿换标签前缀（r2a… / xa…）；④ **Bash 里
  `> /D:/rust/…` 报 No such file or directory**（大写盘符 + 正斜杠不是 Git Bash 认的形状），一律 `/d/rust/…`；
  ⑤ **`.ts` 腿走 `pnpm exec vite-node`**，`node --test` 只认 `.mjs`（本轮第一次跑错入口还把 `redist.log` 覆掉一次）；
  ⑥ PowerShell 内联命令里的 `$_` 被 bash 吞（老账再撞）⇒ 一律 `.ps1` + `-File`；⑦ **Word 的最小单元格宽是 2 磅**：
  我们把那一档夹到 1px（字节 15 twip = 0.75 磅）而 Word 读回 2，并把多出的 1.25 磅从主导列扣走（466.25 而非 468）
  ⇒ W13 判「主导列 + 行宽之和」，NOTE 记着不作产品缺陷；⑧ **bump 前的旧日志会冒充本轮结论**（同目录里
  `bytes.log` / `word.log` / `dev-leg.log` 是改前的，`-x` 那三份才是最终源文那趟）⇒ 报数前对 mtime。
- **本轮没动的，量出来记着**（已开进路线图）：① **单列表（`cols===1`）没有"其余列"可分享** ⇒ 键入 90 后 Σ=90 ≠
  可用宽，屏上仍被按比例放大（本轮只保证不早退崩，没替这一档作主）；② **被跨列格盖住的后续列没有独立把手**，
  跨列格上键入的是它第一枚网格列、种子值也只读第一枚（C4 实测跨两列那格写成 `[90,269]`）；③ **屏上 626px 与
  `contentPxOf` 的 627（9405 ÷ 15）那一枚 1px 口径差**只记账（A1 同屏读出 `avail=626 / max=627`）；④ **等分补平
  那一档的算法住了两处**（`docx.ts` 的 `fill` 与 `table-width.ts` 的 `baseWidths`，同一算法两份实现，注释互相指着
  但没有合一）；⑤ 键入值超出版心时**整表不夹取**（X20 `over` 臂仍写 `[4500,4500,4500]`、表级绝对宽 13500，
  比版心宽 43%）；⑥ 读侧仍只吃 `w:gridCol`（不读 `w:tblLayout` / `w:tcW` / `w:tblCellMar` / `w:trHeight`）；
  ⑦ ODT 列宽两头仍不往返（v0.89 明写不开）；⑧ 部分账件存—重开一趟会变成整表齐账（v0.90 那条原样挂着）；
  ⑨ 拖拽那一半仍是"屏幕位移当模型 px 增量"、屏上比例 vs 字节绝对宽那层不一致（M0 `full` 臂又量到一次）；
  ⑩ `fixTables` 公开通道 no-op 原样；⑪ **dev 腿 A5 那一路用的是 `setTextSelection` 而不是真鼠标** ⇒
  「光标在表外时这一枚不出现」是程序化判的；⑫ **本轮没有 release A/B**（界面那一半到不了 release 的注入缝，
  字节那一半由 dev 腿落盘的件交给独立字节腿 + Word 只读腿裁）；⑬ w:between 第五边、嵌套表版心按最外层近似、
  px 存整数的 ±0.25 磅漂移原样挂着。
- **收尾**：README 新增本节 + 架构两处就地改口（v0.30 表格通道那条补「v0.91：键入精确宽度 + 含竖跨的表不再整表丢账」、
  v0.37「覆盖」那条的写侧形状补 `gridShapeOf` 的占位口径）+ 文件清单新增 `lib/table-width.ts` 条目、`lib/docx.ts`
  条目把「每行 colspan 之和等于网格列数」改口成「按占位走（`gridShapeOf`）」并把「网格游标 `if (isCell) gc += cs`」
  改成 `shape.starts` / `gc = start + cs`、`components/` 那条补「列宽」输入框 + 路线图勾掉「键入精确列宽仍然没有」
  并新开上述未勾项，版本 0.91.0（package.json / tauri.conf.json / Cargo.toml 三处对齐），tmp/x91 的夹具、前置实测腿、
  算术腿、dev 腿、字节腿、Word 腿与结构+变异腿按惯例删除（收摊后 1420/9222 无监听、项目路径进程 0 支、WINWORD 0 支，
  全程未碰已装正式版）；自动更新的源托管与 macOS 打包按指令继续等信号，签名私钥已加密备份并演练 7/7，
  **私钥本体在本机仍是单点**。

## 屏上的表宽第一次吃同一份账（v0.92）

窄口径：`src/lib/table-width.ts` +19（新增一枚导出的纯函数 `accountTotalPx`）、`src/lib/cell-style.ts` +7/−3
（`IndentTableView.applyIndent` 里那一行宽度判定），**Rust 一个字没动**。还的是 v0.90 就记着、v0.91 又量到一次、
一直没有动的那层账：屏幕上宽度是比例、导出字节与 Word 里是绝对宽度——同一张表在三个头上不是同一个数。

- **前置实测九格**（tmp/x92，dev 真机、真光标、只量不改产品）：逐枚读「表级宽度」这一层在屏上的形状——模型账
  （行 0 逐格 `colwidth`）/ `<col>` 的 style / `table` 的 inline `width` 与 `minWidth`（库自己的判定）/ 单元格与表
  在屏上的 rect。八格里只有两格是"屏上与账同形"的：`exact` 三列键成 [90,268,268]（Σ=626）而 rect 89.94/267.73/267.74
  ——因为这一枚的 Σ 恰好等于可用宽；其余六格只要 Σ ≠ 可用宽，屏上就被按比例缩走——`narrow` [120,160,240]（Σ=520）
  的 `<col>` 是模型 px 而 rect 144.32/192.43/288.66、`over` [300,300,300]（Σ=900）的 rect 又回到 208.47 ×3、
  `single` 一列 [90] 的 rect 625.41＝单列被拉满整个版心（v0.91 记的「单列表 Σ ≠ 可用宽」正是这一档的屏上一半）、
  `span` 跨两列那格 [100,100]+[100]（Σ=300）rect 416.94/208.47、`vspan` [180,240,360]（Σ=780）rect 147.2/193.15/285.06、
  `indent`（ml=40 + Σ=520）inline `width: calc(100% - 40px)` 而 css 586.073、rect 135.09/180.13/270.19。另两枚是
  对照：`none` 三列全 null（rect 208.47 ×3，浏览器 auto 布局在算宽）、`partial` [248,null,null]（inline `(empty)`
  而库写 `minWidth=298px`，rect 248/188.7/188.71）。**就地探针那一档是本轮唯一的裁决证据**：只在 `table.style.width`
  上手工写这份账的 Σpx、写完立刻复原——narrow 520 → rect 119.86/159.79/239.68、single 90 → 89.33、span 300 →
  199.5/99.83、vspan 780 → 179.85/239.79/359.69、over 900 → 299.77 ×3 且表右沿 1259.29 顶过文档右沿 985.36。
  ⇒ 键入值 1:1 上屏的那一枚条件从来不是"其余列怎么算"，而是**表宽本身要写成这份账的和**；库（prosemirror-tables
  1.8.5 的 `updateColumnsOnResize`）在整表齐账时本来就写 `table.style.width = Σ + "px"`，而我们的子类 `applyIndent`
  紧跟其后无条件盖成 `calc(100% − Npx)` / `''`——缺陷在自己的那一层，不在库。
- **本轮唯一的架构决定（跟着数据走）**：屏上的表宽吃行 0 那一份账，与 docx 写侧（`w:tblW` = 网格和、逐格 `w:tcW`）
  同一权威，四条形状都不是可选的——① **只有整表齐账才写绝对宽**：`accountTotalPx(table)` 把行 0 摊平出的每一枚
  网格列求和，缺任何一枚（部分账）或压根没账 ⇒ `null`，与写侧 `gridPxOf` 吃的是同一份权威（同一个 `tableGrid` /
  `gridAccount`，不另起一套判定）；② **没账或部分账保留原来的比例档**：一个字不改库那一路（`minWidth` 照旧、
  `.doc-content table { width: 100% }` 照旧），实测 `partial` 臂改后与改前逐字相同（inline `(empty)`、minWidth 298px、
  rect 248/188.7/188.71），`none` 臂 tableRect 仍是 626.07；③ **不夹取到版心**：`over` 那臂（Σ=900）现在如实撑出
  （tableRect 900、contentScroll 900 > clientWidth 626、表右沿 1259.29 顶出文档右沿 985.36）——Word 16.0 对同一件
  读回 225 磅 ×3 = 675 磅而版心只有 470.6 磅，**第三方也不缩表**，屏上把 900px 缩成 626px 是我们这一头擅自作的决定，
  把它如实画出来才是与字节/Word 同形；④ **有账时缩进不再靠 `calc` 收右边**：宽度既然是绝对值，`calc(100% − ml)`
  那一条就只在没账那一档留着（`indent` 臂现在 inline 520px + computed marginLeft 40px，而不是 586.073 的百分比）。
  单位仍只有一处换算（`PX_TWIP = 15`）；一处诚实的不对称留在 `renderHTML` 那一路——attrs 通道看不见子节点，算不出 Σ，
  仍只能写 `calc`（结构腿 CS8 钉住这个口径，不是漏网）。
- **验证**（腿 + 编译，全部在版本号 bump 三处对齐之后在最终源文上复跑）：算术腿 17/0（R1~R17 钉 `accountTotalPx`
  的形状：没账 null / 齐账求和 / 部分账 null / 跨列格按 colspan 展开 / 竖跨按占位不重复计数 / 长度不齐 null /
  0 与负数不算账 / 非数组不算账 / 表头格同吃 / 权威只认行 0（行 1 有账而行 0 没有 ⇒ null）/ 行与行打架按行 0）；
  结构+变异合并一腿 RESULT struct=21/21 mutants=15 bad=0 extra=0 b0=5/5 trap=ok（吃剥掉注释并归一 LF 的源文；
  TW1~TW11 钉 `accountTotalPx` 住在 table-width.ts、复用 `tableGrid`/`gridAccount` 而不另起判定、null 出口齐、
  CS1~CS10 钉 `applyIndent` 只在有账时写绝对宽、部分账走 `''`、缩进那一句没被顺手改、`.doc-content table` 的
  比例兜底一条没动、宽度只问 table-width 那一处；M1~M15 各响该响的那条——含 M15「把绝对宽那一行整行删掉」
  正是本轮修之前的缺陷形状、M3「宽度算成 0」响 CS1；B0 自检五条含「模板态里的正则字面量不被吞」「顶层花括号帧里的
  注释确实被剥掉」；两枚正控制 P0 原样、P1 注释陷阱 + 一枚反向控制（拆掉真代码那一行之后判据必须响 CS3））；
  CDP dev 真机腿 RESULT dev pass=45/45 bad=0、PAGEERRS|0（真光标 + 真导出：A 齐账六臂的 inline 宽 = Σpx 且行 0
  rect 之和 = Σ（±2px）且逐格 1:1（±1.5px，跨两列那格按两枚之和 199.5）、B 单列表也吃账（90px，本轮挖掉屏上那一半）、
  C `over` 臂如实撑出 + 记下外沿读数、D `none`/`partial` 两臂不谎称绝对宽且仍按版心铺满、E `indent` 臂缩进照属性
  上屏而表宽是 Σ 不是 100%−ml、F `vspan` 臂屏上也吃账、G 键入端到端（在无账件上真走 `setGridColumnWidth(90, 626)`
  ⇒ 账 [90,268,268]、inline 626px、rect0 89.93）；独立字节腿（zipfile + 正则直解 `word/document.xml`，不吃自家读侧）
  34/0（Y1~Y9 本轮写侧一个字没动 ⇒ 九臂的 `w:tblW` / `w:tblInd` / `w:tblLayout` / `w:gridCol` / `w:tcW` 逐枚等于
  改前基线，G 系列钉 v0.89/v0.90/v0.91 那几档形状未回归：无账仍 pct 100% + 3135×3 + 零枚 tcW + 不声明 fixed、
  部分账仍 3720/2835/2835、竖跨件仍 2700/3600/5400 而不是等分、`w:tblInd 600` 与表级绝对宽 7800 各住各处、
  `gridSpan` 与 `vMerge` 不塌、逐格正文不丢，T1~T4 键入那臂的 90px = 1350 twip 真进字节而其余两列按等比重排成 4020）；
  Word 16.0 只读腿 RESULT word pass=21/21 fail=0 + 一条 NOTE（W1 无账件仍百分比且三列 156.7 磅、W2 齐账件逐格磅
  = 屏上 px × 0.75（90/120/180）、W3 键入那档 67.5/201/201 磅与屏上 90/268/268 对上、**W4 `over` 件 Word 也不夹取
  （675 磅 > 版心 470.6 磅）⇒ 屏上如实撑出有第三方对照**、W5 单列 67.5 磅、W6 缩进不吃宽度账、W7 补平那档 186 磅、
  W8 跨两列那格读两枚之和 150 磅、W9 竖跨件经 `Range.Cells` 第一次读得出（135/180/270）、W10 九臂改后与改前逐枚
  同读数、W11 键入的 90px 走到 Word；NOTE：`indent` 件的 `LeftIndent` 读回 0 而字节上写着 `w:tblInd 600`）；
  `cargo test --lib` 97 passed / 0 failed / 11 ignored（Rust 本轮一个字没动）+ `pnpm exec tsc --noEmit` exit 0 +
  `pnpm tauri build --no-bundle` 绿（openoffices v0.92.0，2m54s）。
- **本轮撞到八处量具坑，都不是产品**：① **剥注释器把顶层花括号帧当"非常规态"**——`normal()` 只认 `expr` 帧，于是
  每一个函数体（brace 帧）里的注释都原样吐进"剥后源文"，B0a 当场抓住（中文短语还在）；修成
  `normal = !(top() && top().t === 'tpl')`，**这一格意味着此前所有吃这两个文件的判据都在没剥净的源文上匹配**，
  是「同族假绿」的第七次兑现、也是这条腿自己第二次被自己抓住；② **变异期望要按判据实际量的字面写**——M2 把
  `const total = accountTotalPx(node)` 换成一枚常量，同时打掉 TW6 匹配的那行 `return total` 字面，期望里只写 TW7
  就报「多响」；③ **变异打不到那一行就要另立一枚**——M3 只改宽度算出的值，`applyIndent` 里写绝对宽的那一行原样
  还在（CS3 不响），于是另加 M15 整行删掉，让它响 CS3；④ **反向陷阱控制要带 `throw` 守卫**——删真代码那枚锚点把
  缩进写成 6 枚空格而文件里是 4 枚，删不掉任何东西而控制"看起来通过"，补 `if (minusRaw === RAW.cs) throw`；
  ⑤ **改了产品源码后 dev 腿必须 `Page.reload{ignoreCache:true}`**（vite 发陈旧 transform 模块，同一条 PASS 会量到
  改前的屏上）；⑥ **CDP 探针 IIFE 少了「找不到活动标签就取末位」那枚兜底** ⇒ 键入那一臂整臂 TypeError，而同一个
  PROBE 里早就写着这枚兜底——量具内部不一致比缺量具更难查；⑦ **判据里的数字凭记忆写**——字节腿 G4a 期望写成
  `[1800,2400,3600]`（磅）而夹具是 180/240/360 **px** = 2700/3600/5400 twip，G6 的「文本枚数 ≥ 6」对单列与跨度两臂
  根本不成立 ⇒ 改成与 `<w:tc>` 枚数成对判（「必须由同一趟量出来」的老账第三次兑现）；⑧ Word 的 `Rows.Item(1).Cells`
  对含竖跨的表一律抛（v0.89 记过），本轮改走 `Range.Cells` + 按 `RowIndex` 过滤，那一档第一次有到达面；另
  bash 里 `powershell -Command "$o=@(...)"` 的 `$o` 被吞（老账，一律 `.ps1` + `-File`）、版本号 bump 会重启 app
  ⇒ **bump 之前那份 dev 日志不属于最终源文**（本轮以 b4 前缀在重启后的应用上整腿复跑）。
- **本轮没动、量出来记着**（已开进路线图）：① **纸面那一头没量**——文档导出 PDF 走 WebView2 `PrintToPdf` 吃的就是
  这份 DOM，而 `over` 臂现在屏上就撑出（contentScroll 900 > clientWidth 626、表右沿顶出文档右沿）⇒ 超宽表上纸是被
  裁掉、缩进下一页还是照样出血，从来没正面量过；② NodeView 与 `renderHTML` 两口径没合一（一处吃账、一处只能 `calc`，
  因为它看不见子节点）；③ 部分账那一档屏上仍是比例（248/188.7/188.71）而字节里是 3720/2835/2835（= 189px 那一档），
  本轮只让齐账那一路同形、没把它拧成绝对宽；④ 屏上 626 与 `contentPxOf` 的 627 那一枚 1px 口径差原样；
  ⑤ 等分补平的算法仍住两处（docx.ts 的 `fill` 与 table-width.ts 的 `baseWidths`）；⑥ 被跨列格盖住的后续列没有
  独立把手；⑦ **本轮没有 release A/B**（界面那一半到不了 release 的注入缝，屏上形状由 dev 真机腿裁、字节与磅值由
  两条独立腿裁）；⑧ 拖拽混单位、`fixTables` 公开通道 no-op、ODT 两头不往返、读侧只吃 `w:gridCol`、部分账存—重开
  变整表齐账、`w:between` 第五边、嵌套表版心按最外层近似、px 存整数的 ±0.25 磅漂移原样挂着。
- **收尾**：README 新增本节 + 架构两处就地改口（v0.30 表格通道那条补「屏上的表宽从 v0.92 起吃同一份账」、
  v0.37/v0.38 缩进与 NodeView 那条把「无条件盖 `calc(100% − Npx)`」改口成「只在没账或部分账那一档盖」）+ 文件清单
  `lib/table-width.ts` 条目补 `accountTotalPx`、`lib/cell-style.ts` 条目补这一枚判定 + 路线图勾掉「屏上比例 vs
  字节绝对宽」与「单列表键入后 Σ ≠ 可用宽」的屏上一半、把「键入值超出版心时整表不夹取」改写成「如实渲染（纸面未量）」，
  版本 0.92.0（package.json / tauri.conf.json / Cargo.toml 三处对齐），tmp/x92 的夹具、前置实测腿、算术腿、
  结构+变异腿、dev 腿、字节腿与 Word 腿按惯例删除（收摊后 1420/9222 无监听、openoffices.exe 0 支、
  com.openoffices.app 的 msedgewebview2 0 支、WINWORD 0 支，按显式 PID 收宿主而不是按进程名乱杀，全程未碰已装正式版）；
  自动更新的源托管与 macOS 打包按指令继续等信号，签名私钥已加密备份并演练 7/7，**私钥本体在本机仍是单点**。

## 纸面那一头第一次被正面量：超宽表不再把整页拖小（v0.93）

窄口径：`src/index.css` +5（`@media print` 里 `.doc-content` 那一条补一句 `overflow: hidden`，与 v0.50 那句
`min-height:0 !important` 同住一条规则），**Rust 一个字没动、docx 写侧一个字节没动**。还的是 v0.92 收尾时自己记下的
那条未勾项——「纸面那一头没量」，以及 v0.88 的同族「纸上有没有边框从来没正面量」。

- **前置实测**（tmp/x93，dev 真机 + 真导出 + Word 自己导的 PDF，只量不改产品）：九臂（`none`/`narrow`/`exact`/
  `single`/`indent`/`partial`/`over`/`longtall`/`borders`/`columns`，另加 `wide-tall`）逐枚导出 PDF 再用几何腿读回
  `scale` / 表左沿 / 逐枚列边界 / 单元格标位。**只有一臂出问题**：`over`（模型 [300,300,300]，Σ=900）在纸上
  `scalePx=0.6981` = 627/899——Blink 打印遇到比版心宽的内容时**把整页按比例缩小**去迁就那一枚超宽件，三列 300px
  在纸上被压成 209 一档（`colEdges` 83/292.23/500.77/710.01、`tableWidthPx` 627.01），代价是**整篇正文字号跟着缩**
  （文本矩阵 `a` 从 11.24pt 掉到 7.85pt，屏幕上 15px 的正文纸上只有 10.5px）；其余八臂 `scale` 一律 1.0004（版心
  没被撑破就不缩），且屏上那一份账 1:1 上纸（`narrow` 纸上 pitch 119.94/159.93/238.88 而模型 120/160/240、
  `single` 88.96 而模型 90、`exact` 89.96/266.87/267.87、`indent` 左沿 122.98 = 版心左沿 83 + 缩进 40）。
  **注入五枚候选裁决住哪一层**：`.doc-content{overflow:hidden}` 与 `.doc-page{overflow:hidden}` 都把 `scale` 拉回
  1.0004（表纸上 `colEdges` 83/382.86/681.72，即前两列按 300px 真尺寸、第三列起点在纸上而墨不画），而
  `.doc-cols{overflow:hidden}` 与 `.doc-content table{max-width:none}` **完全不管用**（仍 0.6981）。
  **第三方对照走 Word 16.0 自己导出的 PDF**：同一件 Word 报逐列 225 磅 ×3（`pref=3` 固定宽）而纸宽只有 595.32pt、
  左右边距各 62.35pt ⇒ 表按真尺寸排、第三列起点 512.5pt 而它自身 225pt 越出纸边**被纸裁掉**——不缩表、不缩字号，
  这一条与 v0.92「屏上不夹取」的裁决同源。另三档第一次有纸面读数：`borders` 臂纸上 4 枚红段落边 + 6 枚蓝格上边 +
  1 块黄底纹真的上纸（v0.88 那条"边框进不进导出 PDF"至此有判据），而**纸上零枚带 dash 的路径**（边框被铺成实心
  矩形 `fill`、`dash` 全为 null ⇒ 屏幕上的 `1.5px dashed #ff0000` 到纸上成实线）；`longtall`（22 行 × 520px）
  纸上是四页而**第 1、2 页 0 枚格标**、表从第 3 页才起（`break-inside:avoid` 把整张表推后）；`wide-tall`
  （1500px 宽 + 22 行）同理第 1 页 0 枚。
- **本轮唯一的架构决定（跟着纸面走）**：版心是纸上的硬边界，四条形状都不是可选的——① **裁而不缩**：超出版心的那一段
  在纸上不存在，而不是替整页决定字号（"同一篇文档因为一枚超宽表就换正文字号"正是 Word 从不做的事）；② **收口住
  `.doc-content` 而不是 `.doc-page`**：两枚都能修住 `scale`（实测逐枚同读数 598.72），选只管正文那一层的——
  `.doc-page` 还牵着页眉页脚与分页参考线，收它会管住不属于本次问题的东西；③ **只在 `@media print` 生效**：屏幕上
  v0.92 刚立的"超宽如实撑出"那一档一个字没动（`over` 臂屏上仍是 inline 900px 而 `clientWidth` 626，dev 腿 D7 判住）；
  ④ **被裁的那一列本轮不另加提示**（既不在界面上说、也不在纸上打标记），明写成未勾项而不是偷偷做一半。
  写侧一头刻意不碰：**十臂导出件的 `word/document.xml` 与改前逐字节相同**（字节腿 W0 判），这一轮买的是纸面不是字节。
- **验证**（四腿 + 编译，全部在版本号 bump 三处对齐之后在最终源文上复跑）：纸面判据腿 RESULT paper pass=35 fail=0
  （P1 改前 0.6981 留档 / P2 改后 1.0004 / P3 纸上列间距 = 模型 300px（pitch 299.86/298.86）/ P4 表左沿 = 版心左沿 83 /
  P5+P6 第三列被裁而前两列完整 / **P7 产品自带规则那一份 ≡ 改前注入那一份**（598.72/598.72 逐枚同读数）/ P8+ 其余
  九臂五头（scale·页数·左沿·列沿·文字位）与改前逐枚同 = 没超宽的表纸面一点没动 / P16 无账那一档纸上仍是版心三等分
  208.9/207.9/208.9 / P16b 部分账 247.88/188.91/188.91（248 那枚按真尺寸）/ P17 表级缩进上纸 / P18-P19 长表四页且
  22 行全上纸（收口没在后续页吃行）/ P20-P22 超宽又超高 1500px 三页不缩、纸上列宽 499.76 ≈ 模型 500 / P23 边框与
  底纹上纸 + NOTE 虚线档（带 dash 的键 = []）/ P24-P25 超宽件首末段正文在纸上而第三列文字不在（只裁表不裁字）/
  P26 七臂逐枚格标全在 / P27 墨停在版心右沿以内（maxRight 709.2 < 版心右沿 710 < 纸宽 793.28，纸的右白边不画）/
  P28 Word 的超宽表真尺寸上纸并被纸边裁掉 + NOTE 两头的裁位不同）；CSS 结构+变异合并一腿 RESULT css struct=10/10
  b0=4/4 mutants=11 bad=0 extra=0 trap=ok（吃剥掉注释并归一 LF 的源文；CSS1 print 内那条收口真在、CSS2 print 之外
  零枚（屏幕不受管）、CSS3 `min-height:0 !important` 没被顺手改、CSS4 值确是 `hidden`、CSS5 `.doc-content` 恰一枚而
  `.doc-page` 没被加上 overflow、CSS6 `break-inside:avoid` 五枚选择器齐、CSS7 把手不上纸、CSS8 `.doc-page` 的
  width/padding 仍带 important、CSS9 print 里没有第二处宽口径 overflow、CSS10 `.ppt-print-page{overflow:hidden}`
  先例仍在；M1~M11 各响该响的那条，含 M1「整条声明删掉」正是本轮改前的形状、M9「print 之外也加一枚」；
  B0 自检四条 + P1 注释陷阱（print 内外各埋一枚假声明，十枚判据须与基线同判）+ P2 反陷阱（真删锚点自带 `throw` 守卫））；
  独立字节腿（zipfile + 正则直解 `word/document.xml`，不吃自家读侧）RESULT bytes pass=41 fail=0（W0 十臂与改前
  **逐字节相同** = 写侧没碰，W0z 记 `docProps/core.xml` 每次导出都重写 ⇒ 整件哈希必然 DIFF、不能当"没动写侧"的证据；
  Y1~Y16 九臂账形状（`w:tblW`/`w:tblInd`/`w:tblLayout`/`w:gridCol`/`w:tcW`/`gridSpan`）未回归、Y17 逐格正文不丢、
  Y18 部件齐全）；CDP dev 真机腿 RESULT dev pass=45 bad=0、pageerr=0（D0b **产品自带**那条 print 收口在活页面上恰一枚
  且值为 hidden（`.doc-content { overflow: hidden; min-height: 0px !important; }`，不吃注入件）；D1~D3 齐账臂 inline =
  Σpx、rect 与模型 1:1（±0.6）、`<col>` 逐枚模型 px；D4 `none`/`partial` 两臂 inline `(empty)` 而 rect ≈ 版心 =
  没账那一档一点没动；D6 `indent` 520px + `marginLeft` 40px；D7 `over` rect 900 > `clientWidth` 626（屏上仍如实撑出）；
  D5 十一臂 PDF+docx 双双落盘 > 1200B；NOTE 屏上 `.doc-content` `clientWidth` 626 而纸面板心 627px）；
  Word 16.0 只读腿本轮**没有重跑**（字节腿证明写侧逐字节未变 ⇒ 磅值一头的证据仍是 v0.92 那批 + 本轮 Word 自己导出的
  那九份 PDF）；`pnpm exec tsc --noEmit` exit 0 + `cargo test --lib` 97 passed / 0 failed / 11 ignored（Rust 本轮
  一个字没动）+ `pnpm tauri build --no-bundle` 绿（openoffices v0.93.0，5m16s）。纸面判据腿在 bump 后吃 dev 腿新落盘的
  那一批（`dev93-*.pdf`）整腿复跑，仍是 35/0。
- **本轮撞到八处量具坑，都不是产品**：① **bump 之前那批纸面件不属于最终源文**——bump 会重启 app，纸面判据必须吃
  bump 之后重新导出的那份 PDF，本轮把判据腿的"改后"前缀做成参数（`POST_PREFIX=dev93`）而不是重跑生成腿（省一整趟
  真导出）；② `.doc-editor` 这枚选择符**产品里根本不存在**（`grep -rn "doc-editor" src/` → 0 命中），dev 腿照前置
  实测那份写法就整臂 TypeError，屏上口径要问 `tbl.closest('.doc-content')`；③ **整件 docx 的哈希永远 DIFF**
  （`docProps/core.xml` 每次导出重写），"写侧没动"只能比 `word/document.xml` 逐字节；④ CSS 判据那条"不许有第二处
  宽口径 overflow"撞上 app 外壳本来就有的 `html, body, #root{overflow:hidden}` ⇒ 判据 scope 进 print 块，屏上那一档
  另记 NOTE（屏幕溢出是 v0.92 刚立的"如实撑出"，不该被自家判据判成违例）；⑤ **正控制第一版什么都没测到**——在同一枚
  规则里复制一份声明，规则枚数与值判定都不变，改成把假锚点埋进 print 内外的注释里；⑥ **变异期望按判据实际量的东西写**
  ——M1 删掉声明同时打掉值判定（CSS4）与枚数判定（CSS5），期望只写 CSS1 就报「多响」；⑦ perl 就地改 JS 把正则里的
  `\\/` 吞成 `\/`（写出不闭合的字面量，一整条腿 SyntaxError）⇒ 跨语言批量改锚点一律落成 `.pl`/`.ps1` 文件再执行、
  改完 `node --check`；⑧ 屏上 626 与纸面 627 那枚 1px 口径差会在纸面腿上伪装成"裁位差 1px" ⇒ 判据一律带 ±1px。
- **本轮没动、量出来记着**（已开进路线图）：① 超宽表被裁掉的那一列**在纸面上没有任何提示**（用户不知道少印了一列，
  Word 那一头至少还在屏上把表画出纸外）；② 两头的**裁位不同**——自家裁在版心右沿（710px = 532.5pt，纸的右白边不画）
  而 Word 裁在纸边（595.32pt）；③ **纸面把虚线降成实线**（`borders` 臂纸上零枚带 dash 的路径，边框被铺成实心矩形）；
  ④ **超高表被 `break-inside:avoid` 整张推到后面一页**（`longtall` 第 1、2 页 0 枚格标、`wide-tall` 第 1 页 0 枚）⇒
  表前面那段正文与表被隔开、首近空白；⑤ 部分账那一档纸面仍是比例（247.88/188.91/188.91）；⑥ **本轮没有 release A/B**
  （改的是 `@media print` 那一条，dev 与 release 走同一份 CSS，但纸面证据只在 dev 一头）；⑦ v0.92 那几项原样挂着
  （NodeView 与 `renderHTML` 两口径、被跨列格盖住的后续列没有独立把手、拖拽混单位、`fixTables` 公开通道 no-op、
  ODT 两头不往返、读侧只吃 `w:gridCol`、`w:between` 第五边、嵌套表版心按最外层近似、px 存整数的 ±0.25 磅漂移、
  等分补平算法住两处、626 与 627 那枚 1px 口径差）。
- **收尾**：README 新增本节 + 文件清单 `index.css` 条目补这一枚 print 收口 + 架构两处就地改口（v0.30 表格通道那条补
  「v0.93 起纸面也吃这一份账」、v0.38「表格缩进在屏幕和 PDF 上完全不生效」那条补上纸面第一次量到的读数）+ 路线图
  勾掉「纸面那一头没量」与「纸上有没有边框从来没正面量」、把「键入值超出版心时整表不夹取」的纸面那一半结掉，
  版本 0.93.0（package.json / tauri.conf.json / Cargo.toml 三处对齐），tmp/x93 的夹具、纸面腿、CSS 结构+变异腿、
  dev 腿、字节腿与几何量具按惯例删除（收摊后 1420/9222 无监听、openoffices.exe 0 支、com.openoffices.app 的
  msedgewebview2 0 支、WINWORD 0 支，按显式 PID 收宿主而不是按进程名乱杀，全程未碰已装正式版）；
  自动更新的源托管与 macOS 打包按指令继续等信号，签名私钥已加密备份并演练 7/7，**私钥本体在本机仍是单点**。

## 表在纸上第一次流着排：超一页的表不再被整张推走（v0.94）

- **前置实测（十枚夹具，dev 真机 + 真光标 + 真导出 + pdf.js 几何量具 + Word 16.0 只读腿，只量不改产品）**：
  `@media print` 那一族的 `break-inside: avoid` 名单里一直带着**表格**（v0.33 立这一层时就写着，README 架构那条原话是
  「表格/图片/代码块/引用/目录不跨页折断」），量出来的是——`tall`（22 行 ×3 列，表高 1120.8px 而纸上一页版心只有
  ~920px）纸上 **3 页而第 1 页只有 1 枚 mark、0 枚格标**（`yLast=101.0`＝表前那一段正文的第一行），整张表从第 2 页才起
  （P2 cells=54 rows=18、P3 cells=12 rows=4）；`hdr` 同形（3 页、P1 0 枚格标）；`mid`（18 段正文 + 12 行表）第 1 页
  段落打完停在 `yLast=681.7` 而 `cells=0` ⇒ **剩余 304.9px 空着，只为等一张推得走的表**；页边三臂 `edge1/2/3`
  （把表摆在页边不同位置，剩余空间分别只容得下 1/2/4 行）第 1 页同样 0 枚格标；`bigrow`（一枚比一页还高的行，
  屏上 `trHeight` 1953.7px）4 页；`short`（3 行小表）2 页、`precise`（40 行代码块）3 页——这两枚是本轮的对照组。
  **注入三档同一趟各出真件**：`i1`（只把 `table` 写成 `break-inside:auto`）——`tall` 3→**2 页**且第 1 页就有 54 枚格标、
  `bigrow` 4→**3 页**；`i2`（`i1` + `tr{avoid}`）与 `i3`（`i2` + `td,th{avoid}`）对 `tall` 与 `i1` 逐页同形（2 页），
  却把 `bigrow` **退回 4 页** ⇒ 行内那一档在装得下的表上是纯 no-op，只在"行本身比一页高"时把整张推页的缺陷换一副面孔买回来；
  Word 16.0 只读腿的第三方纸面（同一件把每行强制成 60 磅，`AllowBreakAcrossPages` 读回 `cantSplit=False`）——
  全文高 728.5 磅、**2 页**、逐行落页 r0..r10 → P1 / r11..r21 → P2 ＝ **表级流、行边界切、不劈行**（这一档形状与 `i1` 同向）
- **本轮唯一的架构决定（跟着数据走，缺陷住在家那一层）**：表是这一族里唯一该在纸上流着排的件，四条形状都不是可选的——
  **只把 `table` 从 avoid 家族摘出来并显式写 `auto`**（`page-break-inside` 与 `break-inside` 两句都写：老 Blink 只认前者，
  且实测"靠缺省值"那一档在 print 媒体里就是把整张表推走，显式说话才留得住）；**不给 `tr`/`td`/`th` 补 `avoid`**
  （`i2`/`i3` 两档就是量出来要弃的那两档——"行不劈"与"整张推页"在这一版是同一枚开关的两面）；
  **`img`/`pre`/`blockquote`/`.doc-toc` 照旧 `avoid`**（同族里只有表被摘出来，`precise` 臂逐页相同判的就是这一档没被顺手改）；
  **写侧与屏上一寸不碰**（改的是 CSS，到不了 docx 写手——不回归由字节腿以"逐字节相同"为证；屏上形状由 dev 腿逐臂读数）
- **实现（窄口径：`src/index.css` 的 `@media print` 里一枚规则块，Rust 一个字没动）**：
  `.doc-content table { page-break-inside: auto; break-inside: auto; }`，注释里写清弃掉的那两档与它的实测后果
- **验证（腿 + 编译，全部在版本号 bump 三处对齐之后在最终源文上以 `POST=b4` 复跑）**：CSS 结构+变异合并一腿
  `struct=12/12 mutants=16/16 bad=0 b0=ok p0=ok trap=ok revtrap=ok`（S1 表不在 avoid 名单 / S2~S6 那一族其余四件仍在、
  `orphans/widows` 未动、把手不上纸未动 / S7~S10 不给 `tr`/`td`/`th` 补 avoid / S11 两句都写 / S12 只此一处针对表的 break 块；
  16 枚变异各响该响的那条，含「把 `avoid` 写回 table」「给 tr 补 avoid」「删掉 `page-break-inside` 只留 `break-inside`」
  「再开第二处针对表的块」；B0 剥注释自检 + P0 正控制 + P1 注释陷阱 + 反陷阱全过）；
  CDP dev 真机腿十臂 `PAGEERRS|0`（屏上逐臂回归改前读数——`tall` 22 行 `tableH` 1120.8 `trHeight` 50.9、`short` 3 行 153.4、
  `bigrow` 1953.7、`pair` 两枚表 408；print 媒体计算样式 `table/tr/td = auto` 而 `img/pre/blockquote/toc = avoid`、
  `h1 = avoid`、`p = 2/2`、把手 `display:none`；七臂 docx 与十臂 PDF 全落盘）；
  纸面判据腿 `RESULT paper pass=55 fail=0`（G1 十臂**没有任何一行被劈开**——每页 `partial=-`；G2 `tall` 3→2 页且与 `i1`
  同形而第 1 页从 0 枚格标变 54 枚；G3 22 行一枚不丢一枚不重、行号连续 0..21；G4 `mid` 第 1 页 18 枚格标、墨底从 681.7
  落到 986.6；G5 `short` 改后与改前**逐页相同**；G6 页边三臂第 1 页行数恰是剩余空间容得下的那一档 1/2/4 且与 `i1` 同形；
  G7 `bigrow` 仍流式 3 页（改前 4 页）＝没有给行加 avoid；G8 `hdr` 3→2 页 22 行齐全；G9 `precise` 逐页相同＝本轮没动那一族；
  G10 `pair` 与 `i1` 同形；G11 纸张 793.3×1122.6 没变；G12 任何一臂页数都没变多）；
  独立字节腿（zipfile + 正则直解 `word/document.xml`，不吃自家读侧）`RESULT bytes pass=25 fail=0`（Y1 七臂与改前**逐字节相同**
  ——`tall sha=70956fc0e05d96d6 n=16989`、`mid 78eaff9a…`、`hdr 4c910672…`、`pair 6063ea4d…`、页边三臂 81bbc59e…/b3b75717…/0b8a3a04…；
  Y2 部件清单、Y3 结构枚数逐臂相同；Y5 现场量出 `tall` 是无账那一档（`pct 100%` + 等分真网格 [3135,3135,3135] + 零枚 `w:tcW` +
  不声明 `fixed`）；Y6 `hdr` 23 行且带 `w:tblHeader`；Y7 交叉对照两臂 sha 不同＝判据有区分力）；
  Word 判据腿 `RESULT word pass=6 fail=0`（改后件在 Word 的纸上仍是 2 页、`textHeightPt=728.5` 同一枚数、
  逐行落页映射与改前**逐枚相同**＝第三方那一头没被自家 CSS 牵动，且判据吃的是两趟同一把尺：Word 16.0 + 同一档行高 60 磅）；
  `cargo test --lib` 97 passed / 0 failed / 11 ignored（Rust 本轮一个字没动）+ `pnpm exec tsc --noEmit` exit 0 +
  `pnpm tauri build --no-bundle` 绿（openoffices v0.94.0，3m58s）
- **本轮撞到八处量具坑，都不是产品**：① 纸面判据的**参考读数分散在三枚日志且标签两套写法**（`geo-pre.log` 是短标签
  `pre-tall`、`geo-b2.log` 带 `.pdf` 后缀且只有页边三臂、`inji1-pair` 只住在 `geo-b.log`）⇒ 只吃一份就整腿报「参考读数缺失」，
  改成分头按"哪份日志里真有这枚标签"取并缓存，且不许把两趟的 pages 混进同一枚判据；② `'pre-' + ARMS.join(', pre-').split(', ')`
  的优先级坑——`join` 先做、整串拼成一枚标签，缺失清单看着像"十臂全缺"（实为构造清单写错）；③ **判据里的数字必须由同一趟
  量出来**（本轮第三次兑现）：字节腿 Y5 把 `w:tcW` 枚数手抄成 66 而现场量出 0——`tall` 夹具本就是无账表，改成先量网格再判
  那一档的形状；④ Word 腿在属性读之后走 `ExportAsFixedFormat` 会挂（420s 超时转后台、CPU 空转不出件）⇒ 要的读数已在导出
  之前落盘，收摊先 `GetActiveObject` 列出它揣着的文档确认归属（那一支只揣 `tmp/x94/out/post-tall.docx`），`Close(0)+Quit`
  就干净，不必按 PID 强杀；⑤ PS 5.1 上 `[intptr]$word.Application.Hwnd` 直接抛（COM 动态属性）⇒ 归属改走"列文档 +
  `Get-Process` 按 `Path` 过滤"两枚实尺；⑥ **bump 重启 app ⇒ 改前的 dev/纸面/字节件不属于最终源文**，本轮把三枚腿的
  输出前缀做成同一枚环境变量（`POST=b4`：dev 落盘、纸面判据、字节判据吃同一批），bump 后整批重导而不是沿用 `post-*`；
  ⑦ 屏上探针那枚 `leftovers=36` 把 `pre/h1/p` 一类正常节点也数了进去，别读成"avoid 残留 36 处"；⑧ dev server 只绑
  `localhost`，`curl http://127.0.0.1:1420` 恒 000 而 `http://localhost:1420` 是 200 ⇒ 端口型判据别只吃一枚尺（v0.88 那条的续篇）。
- **本轮没动、量出来记着**（已开进路线图）：① **表头行在纸上不重复**——`b4-hdr` 第 1 页 `head=3`（表头那三枚格标）而
  第 2 页 `head=0`，跨页后第二页没有表头，Word 的默认是重复标题行（写侧 `w:tblHeader` 在字节上是齐的，缺的是 CSS 那一头
  的 `thead` 重复，本轮没量它能不能上纸）；② `pre`/`img`/`blockquote`/`.doc-toc` 同族仍整块推页（`precise` 臂 40 行代码块
  改后与改前逐页相同、第 1 页仍只有 1 枚 mark）；③ **纸面行高仍比 Word 那一档厚约 3×**（我们每行 50.9px = 38.2 磅，
  Word 自然行高在 ~12 磅那一档；本轮为拿到"行边界切"的第三方对照读数把每行强制成 60 磅，那是量具不是产品）；
  ④ v0.93 那四枚原样挂着（超宽表被裁掉的一列在纸上无提示、两头裁位不同、纸面把虚线降成实线、部分账那一档纸面仍是比例）；
  ⑤ **本轮没有 release A/B**（改的是 `@media print` 里表级那一档，dev 与 release 走同一份 CSS，但纸面证据只在 dev 一头）；
  ⑥ v0.92/v0.91/v0.90 那几项原样挂着（NodeView 与 `renderHTML` 两口径、被跨列格盖住的后续列没有独立把手、626 与 627
  那枚 1px 口径差、等分补平算法住两处、拖拽混单位、`fixTables` 公开通道 no-op、ODT 两头不往返、读侧只吃 `w:gridCol`、
  部分账存—重开变整表齐账、`w:between` 第五边、嵌套表版心按最外层近似、px 存整数的 ±0.25 磅漂移）。
- **收尾**：README 新增本节 + 架构「分页控制」那条就地改口（表从 avoid 家族里摘出来，同族只剩图片/代码块/引用/目录）+
  文件清单 `index.css` 条目补 v0.94 这一段 + 路线图勾掉「超高表被 `break-inside:avoid` 整张推到后面一页，前一页近空白」
  并新开上述①②③，版本 0.94.0（package.json / tauri.conf.json / Cargo.toml 三处对齐），tmp/x94 的夹具、前置实测腿、
  注入候选腿、CSS 结构+变异腿、dev 腿、纸面几何量具与判据腿、独立字节腿与 Word 腿按惯例删除（收摊后 1420/9222 无监听、
  openoffices.exe 0 支、com.openoffices.app 的 msedgewebview2 0 支、WINWORD 0 支，按显式 PID 收宿主而不是按进程名乱杀，
  全程未碰已装正式版）；自动更新的源托管与 macOS 打包按指令继续等信号，签名私钥已加密备份并演练 7/7，
  **私钥本体在本机仍是单点**。

## 表头行在纸上第一次重复：跨页长表的第二页不再是无头表（v0.95）

- **前置实测（九枚夹具，dev 真机 + 真光标 + 真导出 + pdf.js 几何量具 + Word 16.0 只读腿，只量不改产品）**：
  写侧从 v0.37 起就在表头行盖 `w:tblHeader`（本轮字节腿再验：`hdr` 23 行里恰 1 枚、`hdr2` 22 行里 2 枚、
  `mixth` 22 行里 1 枚而它住在第 2 行、`nohdr` 0 枚），缺的是纸面那一头。屏上量到的是 **DOM 里根本没有 `thead`**：
  `DOM|hdr|{"tables":1,"thead":0,"tbody":1,"kids":"COLGROUP:3|TBODY:23","thRows":1,"tableH":1171.8,"rowH":50.9}`
  —— 模型只把 `tableHeader` 落在行属性上，`contentDOM` 渲染成 `tbody > tr > th`，浏览器在纸上没有可重复的表头组；
  同一件纸上 2 页而**逐页表头标 `head 3/0`**（第 1 页 3 枚、第 2 页 0 枚）、`rows 18/5`；`hdr2`（双表头行）`head 6/0`、
  `span`（跨列表头）`head 2/0`、`short`（3 行）1 页 `head 3`、`mixth`（中途夹一枚表头行）`head 3/0` 而它原本就在第 1 页、
  `nohdr` `head 0/0`。**注入六档同一趟各出真件**：`i1`（只给 `tbody > tr:has(> th)` 写 `display:table-header-group`）
  纸上**一点没变**（`head 3/0`、`rows 18/5` 与改前逐枚同）⇒ 这一族只认 DOM 里真住的 `<thead>`；
  `i2`（把原行搬进真 `thead`）纸上 `head 3/3` 可**模型被吃**（`MOVE|hdr|moved=1` 后 `rows 23→22`、`thRows 1→0`、
  哈希 `568008ca→27c4b4bb`）⇒ 搬行不是选项；于是只剩"克隆一份"，而克隆要过四道裁决（`out4/b6-c0..c4`）：
  `c0`（克隆而不写任何 CSS）屏上表高从 1171.8 涨到 1222.7（**多画整整一行 50.9px**）且纸上第 1 页 `head=6`
  （`HMAP` 里每枚表头标出现两次）；`c1`（只在纸上开表头组 + 藏原行、屏上不藏）屏上仍 1222.7 ⇒ 屏幕那一头也得管；
  `c2`（屏上藏 + 纸上开表头组而不藏原行）纸上第 1 页仍 `head=6` ⇒ **藏原行必不必 = 必**；
  `c3`（屏上藏克隆 + 纸上开表头组 + 纸上藏原行）屏上 1171.8 而 `theadH=[0]`（克隆不占位）、纸上 `head 3/3`
  `rows 18/6` `distinct=66 dups=-` ⇒ 胜出形状；`c4`（在 `c3` 上把表头行的账改按「开头连续那几行」算）
  `hdr/span/short cloned=1` 而 `mixth/nohdr cloned=0` ⇒ 这道门就是这么立起来的；
  另两格：给「原行」打行级标记被 PM 的观察器抹掉（`ALLTAG|hdr|tagged=0` ⇒ 标记只能住在 `<table>` 上，
  NodeView 自己管的元素 v0.37 起就没被抹过），克隆会不会过期（`PERSIST-DATA|built=1`：真编辑数据格之后
  `cls/clone/tableH` 前后逐枚相同）。Word 16.0 只读腿第三方那一头逐行读 `Rows.Item(i).HeadingFormat`：
  `hdr` 行 1 = −1（真）而整表 1 枚、`hdr2` 2 枚、`mixth` **行 1 = 0 而整表 1 枚**（标志住在中途那一行）、
  `nohdr` 0 枚 ⇒ 「表顶连着」与「中途夹一枚」在第三方眼里本来就是两档
- **本轮唯一的架构决定（跟着数据走，缺陷住在屏上渲染这一层）**：表头重复的权威只有一处——模型那份行属性
  （`tableHeader` 行 + 写侧 `w:tblHeader`），屏上要把这份账渲染成浏览器认识的表头组，五条形状都不是可选的——
  **只克隆不搬移**（`i2` 那档 `moved=1` 就把模型吃了，搬行走不通）；
  **只给「开头连续的全部表头行」开这一档**（`leading.length && leading.length === rows.filter(isHeader).length`，
  中途夹表头行那一档整块不建克隆——`mixth` 臂纸面与改前**逐枚同形**判的就是这道门；`c4` 那档就是量出来要立它的证据）；
  **标记住 `<table>` 而不是 `<tr>`**（`tagged=0`：PM 会擦 `contentDOM` 里行的 `class`，实测 `rowCls` 归 `-/-/-`，
  所以 CSS 走 `.doc-content table.doc-th-rep > thead.doc-th` 这一口径）；
  **建与拆走 `queueMicrotask`**（`spec.update` 跑在 PM 重画行之前，同一趟里读 `contentDOM` 拿到的是旧行；
  隔 600ms 连读两趟屏上形状逐枚相同 ⇒ 不会来回重读抖动）；
  **屏上藏克隆、纸上才成表头组**（屏幕一条 `display:none`、`@media print` 两条：`table-header-group` +
  藏 `tbody > tr:has(> th)`——`c0/c1/c2` 三档就是「少写其中一条」的三种后果）；
  写侧与字节一寸不碰（改的是 DOM/CSS，到不了 docx 写手——不回归由字节腿以「与改前逐字节相同」为证，
  Word 那一头的 `HeadingFormat` 由本轮 Word 腿逐臂复量）
- **实现（窄口径：`src/lib/cell-style.ts` 的 `IndentTableView` 加 `scheduleReplica`/`syncReplica` 与
  `src/index.css` 三条规则，Rust 一个字没动）**：`syncReplica()` 先撤旧克隆与标记**再**过门（撤在门之前 ⇒
  中途表头行那一档回到"根本没有这一档"的形状），过门才建 `<thead class="doc-th">` + 克隆 leading 行 +
  给表加 `doc-th-rep`；CSS 屏幕一条、`@media print` 两条，注释里写清弃掉的那三档与它们的实测后果
- **验证（腿 + 编译，全部在版本号 bump 三处对齐之后在最终源文上以 `POST=b5` 复跑）**：
  结构+变异合并一腿 `RESULT struct pass=34/34`、`RESULT mutants pass=29/29 bad=0`、
  `B0|ts注释剥除=true css注释剥除=true|字符串活着=true/true/除号=true`、`B0z|中文注释残留=无`、
  `TRAP|注释里埋两枚假声明|基线BAD=0 埋后BAD=0 print内枚数=2（应=2）|ok`、
  `REVTRAP|真删 T14 锚点|fired=T14,T16|ok`（T 系列钉「只克隆不搬移」「撤在门之前」「门的两枚出口」「标记在 table」
  「`queueMicrotask`」；C 系列钉屏幕那一条与 print 那两条、`tr:has(> th)` 只在 print 里藏、口径不越出 `.doc-content`；
  29 枚变异各响该响的那条，含「把门去掉于是中途表头行也克隆」「屏上与纸上两条 `display` 写反」「撤克隆写在门之后」
  「改用行级标记」）；
  CDP dev 真机腿 `RESULT dev pass=93 bad=0` + `PAGEERRS|0`（六臂逐臂 D1~D11：`D1 标记由产品自己建（与模型现算的门同判）`
  `hdr:1/1 hdr2:1/1 mixth:0/0 short:1/1 span:1/1 nohdr:0/0`、`D3 屏上表高不回归` 1171.8/1120.8/1120.8/153.4/1069.9/1120.8
  逐臂与改前同、`D4 屏上克隆不占位` `[[0],["none"]]`、`D7 打印媒体计算样式` `thead=table-header-group` 而
  表头那行 `none`、数据行 `table-row`、`D10 建克隆收敛` 隔 600ms 两趟逐枚相同、`D11` 六臂 PDF+docx 全落盘）；
  纸面判据腿 `RESULT paper pass=59 fail=0`（`Z0` 六臂门状态全从本轮 dev 日志读出不硬编码 + `Z1 模型期望与屏上读数逐臂相同`；
  开火四臂 `A/A2/B/B2/C/D/E/F/R` 九条各一臂：`hdr head 3/0 → 3/3`、`hdr2 6/0 → 6/6`、`span 2/0 → 2/2`、`short 3 → 3`
  且每页表头枚数 = 表头标总数（整行重复而不是只重复一枚格）、数据标不丢不重（`distinct=66/60/60/6`、`dups` 全空）、
  逐页数据枚数与改前相同（`51/15`、`48/12`、`51/9`、`6` ⇒ 没有因为表头重复而重新分页）、页数没变多、纸张 595.0×841.9 没变；
  不开火两臂 `B0/B1` 纸面与改前**逐枚同形**且原行没被 `display:none` 吃掉；`G-mixth` 中途表头行不重复、原行不消失；
  `H1~H5` 开关两趟（撤表头行 `head 3/0` 回改前那一档、翻回来 `3/3`，`off=18/5 post=18/6 pre=18/5`）；
  `I1~I5` 编辑两趟（改表头那一格 ⇒ 每页少一枚可读标而仍逐页重复；改一枚数据格 ⇒ 只吃那一枚、不重新分页））；
  独立字节腿（zipfile + 正则直解 `word/document.xml` 并独立解析 `.odoc`，不吃自家读侧）`RESULT bytes pass=39 fail=0`
  （逐臂 `A1~A6` 六头同判：表枚数、行数（`hdr 23 / hdr2 22 / mixth 22 / short 3 / span 21 / nohdr 22`）、格数
  （69/66/66/9/62/66）、`w:tblHeader` 枚数 == 模型表头行数（1/2/1/1/1/0）、每格在字节里恰好出现一次（克隆没漏进字节）、
  部件齐全 22 枚；`B1` 三臂 `document.xml` 互不同形（17124/16559/16485 字节）＝判据有区分力；`B2` 字节里没有
  任何 `thead`/克隆漏痕；`C1 正控制` A5 那把尺认得出重复——真件计 1 而自我拼接后计 2）；
  Word 判据腿 `RESULT word pass=19 bad=0`（六臂 `W1` 行数 == 模型、`W2` `HeadingFormat` 枚数 == 模型表头行数、
  `W3` 逐臂那一档：`hdr/hdr2/short/span` 行 1 = −1 而 `mixth` 行 1 = 0 且整表 1 枚（标志住中途）、`nohdr` 两枚皆 0；
  `W4` 区分力 `hdr=1 nohdr=0`）⇒ 第三方那一头没被自家 CSS 牵动；
  `cargo test --lib` 97 passed / 0 failed / 11 ignored（Rust 本轮一个字没动）+ `pnpm exec tsc --noEmit` exit 0 +
  `pnpm tauri build --no-bundle` 绿（openoffices v0.95.0，3m59s）
- **本轮撞到六处量具坑，都不是产品**：① **bump 后头一趟 dev 腿的屏上绝对像素读数整体漂约 0.35px/行**
  （`RESULT dev pass=86 bad=7`：`hdr D3 got 1179.8 want 1171.8`、`1128.5/1120.8`、`154.8/153.4`、`1077.3/1069.9`
  外加 `H4` 那一枚）⇒ 用 `t95.mjs` 在**同一趟里**做差：`WITH|tableH=1171.75 rows=50.92×23`、
  `NOCONE|tableH=1171.75`、`ROWS IDENTICAL|true H delta|0`（真删克隆再量，差恰为 0）且 `ENV|innerW=1360 dpr=1.5 hostW=626.07 zoom=1`
  ⇒ 判为 app 刚重启那一趟的测量态而不是产品改动，原腿一个字没改复跑得 93/0；**教训写死：绝对表高这类跨会话比像素的
  判据要么在同一趟里做差，要么失败后先复跑一趟再用探针裁决**；② 纸面判据的参考读数仍分散在多枚目录
  （`out` 有 `pre-hdr2` 而没有 `pre-mixth`、`out4` 才有 `b6-pre-mixth`、胜出候选住在 `out6/b8-*`）⇒ 分头按"哪份里真有这枚标签"
  取并缓存，且不许把两趟的 `pages` 混进同一枚判据（v0.94 那条的续篇）；③ **「每页表头枚数相同」这条不能对所有臂成立**：
  门拒开火的两臂必须与改前同形 ⇒ 开火与否不吃硬编码清单，从本轮同一趟的 dev 日志里读 `gated` 那枚数（`readGate()`）；
  ④ **字节腿那条"数 `w:tblHeader` 枚数"的尺要先证明它认得出重复** ⇒ `C1` 正控制（真件 1 / 自我拼接 2），否则一枚
  永远返回 1 的尺会把"克隆漏进字节"读成"没漏"；⑤ **PS 5.1 上带中文标签的 `.ps1` 直接解析报错**
  （`word95b.ps1`：`UnexpectedToken`、`Try 缺少自己的 Catch`）⇒ Word 腿重写成纯 ASCII 的 `word95c.ps1`
  （同族老账第 N 次兑现：一律 ASCII-only `.ps1` + `-File`，绝不内联 `-Command`）；⑥ **bump 会重启 app ⇒ 改前的
  dev/纸面/字节/Word 件都不属于最终源文**，本轮把四枚腿的输出前缀做成同一枚环境变量（`POST=b5`），bump 后整批重导
  而不是沿用 `post-*`（v0.94 那条的第二次兑现）。
- **本轮没动、量出来记着**（已开进路线图）：① **中途夹表头行那一档在纸上不重复、也没有任何提示**（`mixth` 臂门拒开火、
  纸面与改前逐枚同形；字节里 `w:tblHeader` 明晃晃住在第 2 行，Word 也读得到那枚标志）；② **嵌套表的表头行克隆未量**
  （本轮的门只认最外层 `table` 的 `contentDOM` 行，而 `nest` 臂前置实测里读到 `rowCount 24` 那种外层吞内层的形状）；
  ③ **屏上藏克隆这一档意味着"表头行在屏上只有一份"而它靠 CSS 而非 DOM**——删/改原表头行时克隆靠 `update` 重建，
  本轮 `D10`/`PERSIST-DATA` 只量了收敛与真编辑两趟，没量撤销栈回放、协作式远端改动那一类路径；
  ④ `pre`/`img`/`blockquote`/`.doc-toc` 同族仍整块推页（v0.94 记的，本轮没重做那一族）；
  ⑤ **纸面行高仍比 Word 那一档厚约 3×**（每行 50.9px = 38.2 磅）；⑥ v0.93 那四枚原样挂着（超宽表被裁掉的一列在纸上无提示、
  两头裁位不同、纸面把虚线降成实线、部分账那一档纸面仍是比例）；⑦ **本轮没有 release A/B**（改的是 NodeView 的 DOM
  与 `@media print`，dev 与 release 走同一份 CSS，但屏上与纸面证据只在 dev 一头）；⑧ v0.94/v0.92/v0.91/v0.90 那几项
  原样挂着（NodeView 与 `renderHTML` 两口径、被跨列格盖住的后续列没有独立把手、626 与 627 那枚 1px 口径差、
  等分补平算法住两处、拖拽混单位、`fixTables` 公开通道 no-op、ODT 两头不往返、读侧只吃 `w:gridCol`、
  部分账存—重开变整表齐账、`w:between` 第五边、嵌套表版心按最外层近似、px 存整数的 ±0.25 磅漂移）。
- **收尾**：README 新增本节 + 架构「分页控制」那条就地改口（表头组：屏上藏克隆、纸上 `table-header-group` + 藏原行）+
  文件清单 `cell-style.ts` 条目补 `syncReplica` 与那道门、`index.css` 条目补 v0.95 那三条 +
  路线图勾掉「表头行在纸上不重复」并新开上述①②③，版本 0.95.0（package.json / tauri.conf.json / Cargo.toml 三处对齐），
  tmp/x95 的夹具、前置实测腿（六档）、纸面几何量具与判据腿、结构+变异腿、dev 腿、独立字节腿与 Word 腿按惯例删除
  （收摊后 1420/9222 无监听、openoffices.exe 0 支、com.openoffices.app 的 msedgewebview2 0 支、WINWORD 0 支，
  按显式 PID 收宿主而不是按进程名乱杀，全程未碰已装正式版）；自动更新的源托管与 macOS 打包按指令继续等信号，
  签名私钥已加密备份并演练 7/7，**私钥本体在本机仍是单点**。

## 代码块/引用/目录在纸上第一次流着排：比剩余版心高的那一块不再整张推走（v0.96）

- **前置实测**（`tmp/x96`，dev 真机 + 真导出 + pdf.js 几何量具 + Word 16.0 只读腿 + 四档注入，只量不改产品）：
  v0.94 把表从 `break-inside: avoid` 那一族里摘出来之后，同一族里还住着代码块/引用/目录/图片四件，而这一族的后果
  当时只当作对照组量过（`precise` 臂 40 行代码块「改后与改前逐页相同」）。本轮把这四件逐枚摆到页边各档量到底：
  ① **40 行代码块**（`pre40`）纸上一张 3 页而**第 1 页 0 枚行标**——第 1 页只有两段正文（`inkBottom=99.7`），整块从
  第 2 页才起（`cl00..cl39` 全在第 2 页），第 3 页只剩一段正文（`inkBottom=71.2`）；② **90 行代码块**（`pre90`，比一页高）
  4 页而第 1 页同样 0 枚；③ **60 段引用**（`quote60`）4 页、第 1 页 0 枚 `ql`；④ **目录摆在正文中间**（`tocmid`，
  16 段填充正文 + 目录 + 20 枚标题）4 页而第 1 页只有那 16 段（`inkBottom=438.6`）——第 1 页下部约 338pt 空着
  （版心墨底到 ~776.7），只为等一张推得走的目录；同形的引用那一档（`quotemid`：16 段填充 + 20 段引用）第 1 页
  `inkBottom=438.6` 而 20 段整块住在第 2 页；⑤ **页边六档**（`fill27`…`fill32`：
  放 27/28/…/32 段正文再摆一枚 12 行代码块）——27 那一档改前第 1 页 `inkBottom=704.7` 而 0 枚行标（下部约 72pt
  是空的、改后吃掉 3 行），28 那一档 `728.7` 而 0 枚（改后 2 行），而 29~32 那四档 filler 自己就把第 1 页吃到
  `776.7`，**剩余空间连一行代码都容不下**；⑥ **图片两件**（`img300` 400×300px、`img1200` 600×1200px）与**短件对照组**（`pre3`/`quote3`/
  `quote25`/`toc8`：比剩余版心矮，本来就整块放得下）、**比一页高的目录**（`toc40`：目录 + 40 枚一级标题，5 页而第 1 页
  已有 32 枚 `hd` 标——目录条目与标题共用这一批记号，说明 avoid 比一页高那一档本就惰性）。四档注入各出真件（同一趟）：`j1` 只摘 `pre` ⇒ `pre40` 3→2 页而第 1 页 `cl38`，
  而 `quote60` **一整臂不动**（仍 4 页、第 1 页 0 枚）⇒ 只摘代码块不够；`j2` `pre+blockquote` ⇒ `quote60` 3 页而
  第 1 页 `ql28`；`j3` 再加 `.doc-toc` ⇒ `tocmid` 第 1 页 `hd13` 且墨底从 `438.6` 推到 `757.2`；`j4` 再跟着摘 `img` ⇒
  与 `j3` **逐页同形且裁剪框位置逐枚同**（`img300` 单页 `yTop=87`、`img1200` 3 页而图落在第 2 页 `yTop=58.5`）⇒
  **摘掉图片那一枚 `avoid` 是纯 no-op**（替换件没有内部断点），这一件留在族里是有据的而不是漏了。Word 16.0 只读腿
  的第三方那一头：代码块与引用在 docx 里是**一段带换行的段落**，所以 Word 天生流着排（`pre90` 那一段 `pgStart=1` 而
  `pgEnd=2`），目录条目是各自独立的段落（`toc40` 逐条落页），大图自己占一页（`img1200` 3 页）
- **本轮唯一的架构决定**（跟着纸面走）：这一族的权威只有一处——`@media print` 里那份 `break-inside` 名单，
  而「整块推页」不是这一族的固有语义而是**名单里点了名**：三条形状都不是可选的——把 `pre`/`blockquote`/`.doc-toc`
  从 `avoid` 摘出来并**显式写两门**（`page-break-inside: auto` 与 `break-inside: auto` 两句都写：老 Blink 只认前者，
  而实测「靠缺省值」那一档在 print 媒体里就是把整块推走，显式说话才留得住，与 v0.94 表那一格同一形状）、
  **图片留在 `avoid` 家族**（`j4` 那档 no-op 就是立的据：摘它不换来任何形状，而留着它才能如实说"图片不跨页折断"
  是当前这一族的边界）、**不给块内部补任何 `avoid`**（`pre` 的行、`blockquote` 的段落都让它切：页边六档量出来的
  正是「剩余空间吃几行」这件事，而 29~32 那一档剩余连一行都不容 ⇒ 那一档改后仍同形不是漏修，是这一档没有断点可用）；
  写侧与字节一寸不碰（改的是 CSS，到不了 docx 写手——不回归由独立字节腿以「`document.xml` 逐字节相同」为证，
  第三方那一头由 Word 腿以「逐段落页映射逐枚相同」为证）
- **验证**（腿 + 编译，全部在版本号 bump 三处对齐之后在最终源文上以 `POST=b6` 整批复跑）：
  CSS 结构+变异合并一腿 `RESULT struct pass=13/13 bad=无 | mutants pass=16 bad=0`（`S1` print 内 `avoid` 枚数=1 且
  选择器恰是 `.doc-content img`、`S2` 三件那块=两句 `auto`、`S3` 表那块两句仍在、`S4~S6` 屏上那条 `overflow:hidden`
  与 `min-height` 未动、`S7` v0.95 那两条表头组规则在、`S8` `h1..h4{break-after:avoid}`、`S9` `orphans/widows`、
  `S10~S13` 口径不越出 `.doc-content`；16 枚变异各响该响的那条，含 `M3`「把三件写回 avoid」响 S1,S2,S10,S13、
  `M4`「只留 `break-inside` 删掉 `page-break-inside`」响 S2,S13、`M10`「print 内再开一处把 `pre` 写回 avoid」响
  S1,S10,S12、`M11`「删掉表那一块」响 S3,S13、`M14`「撤掉表头组」响 S7；`B0` 剥注释自检（中文注释剥净、
  字符串活着、全角标点残留 0）+ `TRAP` 注释里埋两枚假声明（基线 bad=0 埋后 bad=0，print 内枚数=2）+
  `REVTRAP` 真删 `img` 那块 `fired=S1`）；CDP dev 真机腿 `RESULT dev pass=119 bad=0` + `PAGEERRS|0`
  （19 臂，屏上 16 枚共用臂绝对像素逐枚与改前完全相同、漂移 0 枚；打印媒体计算样式按臂现读：
  `pre`→`auto`、`blockquote`→`auto`、`.doc-toc`→`auto`、`img`→`avoid`、`p`→`auto`、`h1`→`auto`，
  19 臂 PDF+docx 全落盘）；纸面判据腿 `RESULT paper pass=198 fail=0`（**开火 7 臂**：`pre40`/`pre90`/`quote60`/
  `fill27`/`fill28`/`quotemid`/`tocmid` 的第 1 页族件枚数从 0 变正——`pre40` 0→38（3→2 页）、`pre90` 0→40（4→3 页）、
  `quote60` 0→28（4→3 页）、`fill27` 0→3（墨底 `704.7`→`769.9`）、`fill28` 0→2（`728.7`→`777.4`）；
  `Z4` 每臂 `cl/ql/hd/fe` 复集合与改前完全相同（一枚不丢不重：`pre40` 40→40、`pre90` 90→90、`quote60` 60→60）、
  `Z5` 每页族标是连续升段 ⇒ **断开只发生在行边界**、`Z5b` 跨页切成几轮连续段与重复轮数相等、
  `Z6` 三枚图片臂纸面同形且裁剪框位置逐枚同、`Z7` 四枚短件臂逐页同形、`Z8` `toc40`（比一页高那一档）逐页同形
  （`P1 hd=32` 改前后同）、`Z9` 纸张仍 595×841.9、`Z10` 没有任何一臂多出空页、`Z11` 只摘 `pre` 那一档（`j1`）
  对 `quote60`/`tocmid` 不等价于本轮（判据有区分力）、`Z11b` 跟着摘 `img`（`j4`）与基准同形（本轮把它留着是有据的）、
  `Z12` 页边六档代码行总数不变而第 1 页墨底不缩水）；独立字节腿（zipfile + 正则直解 `word/document.xml`，
  不吃自家读侧）`RESULT bytes pass=59 fail=0`（`B1` `document.xml` 逐字节相同——`pre40` `post=11690 pre=11690`
  且 `sha=e7c03e7e/e7c03e7e 两趟同`、`B2` 部件清单 22/22、`B3` 枚数守恒 `p=5 br=39 w:t=83`、
  `B4` 字节里 `w:br` 枚数 = 纸上行标枚数 − 1（`br=39` ↔ `cl=40`，两条腿互相对得上））；
  Word 判据腿 `RESULT word pass=46 bad=0`（逐臂 `HDR`（页数/段落枚数/纸宽/页高/上下边）与逐段落页映射
  （`mark/n` + `pgStart`/`pgEnd` + `yTop`/`yEnd` + `keep`）改前后**全同**、`W5` `pre90` 那一段仍是 `pgStart=1 pgEnd=2`、
  `W6` 两枚图片臂整臂同形、三枚合成变异各响该响的那一臂）；`cargo test --lib` 97 passed / 0 failed / 11 ignored
  （Rust 本轮一个字没动）+ `pnpm exec tsc --noEmit` exit 0 + `pnpm tauri build --no-bundle` 绿
  （openoffices v0.96.0，`Finished release profile in 4m 36s`）
- **本轮撞到的量具坑，都不是产品**：① 「哪些臂该开火」不能吃硬编码清单——`fill29`~`fill32` 那四档改后仍同形是因为
  剩余空间连一行都不容，判据若写「每臂第 1 页族件 > 0」会把这一档读成失败 ⇒ 开火集合由同一趟的 `gated` 现算；
  ② `mid` 三臂（`imgmid`/`quotemid`/`tocmid`）只有改后那一批而没有改前参考（`geo-a2-*`/`geo-a3-*` 里根本没这三枚标签）
  ⇒ 「与改前同形」类判据对它们天然不成立，只能与注入件（`inj2-j3`）对照，参考读数按「哪份日志里真有这枚标签」分头取
  （v0.94/v0.95 那条的第三次兑现）；③ 报数脚本里 `i === 0 ? null : \`…\`` 之后紧跟 `.replace('Pnull','')`——
  `.replace` 打在 `null` 上直接 `TypeError`，而那种「把脏字符串抹掉」的写法本来就是错的形状，跳页要用 `.filter`；
  ④ `pnpm tauri dev` 在应用运行期间**常驻一枚 `cargo` 父进程**（本轮 PID 64644），所以「没有 cargo 进程」不是重编
  完成的判据（本轮那条轮询就是这么卡的）⇒ 有效判据是 `target/debug/openoffices.exe` 比 `Cargo.toml` 新 + 应用
  `StartTime` 晚于本次改动 + 9222 返回 200；⑤ Word 腿 `quote60` 在 Word 里只占 94.7 磅（单页）而自家纸面跨页 ⇒
  两头的行高档不同，判据必须各自成立，不许拿我们的页数去判 Word 那一头；⑥ Word 收摊脚本的文档名单要跟着前缀走
  （本轮补 `b6-*`），否则新前缀的件不被 `Close(0)`——归属检查走的是「列文档 + 比 HDR/P 行」而不是 `ATTACH` 那行
  （两趟的 attach 一档天生不同）；⑦ bump 会重启 app ⇒ 改前的 dev/纸面/字节/Word 件都不属于最终源文，本轮把四枚腿的
  输出前缀做成同一枚环境变量（`POST=b6`）bump 后整批重导（v0.94/v0.95 那条的第三次兑现）；⑧ `APPVER` 探针
  （eval 里动态 `import('@tauri-apps/api/app')`）在 CDP eval 里解析不到模块 ⇒ 记 NOTE 而不是当假失败
- **本轮没动、量出来记着**（已开进路线图）：① **跨页的代码块没有任何孤行寡行下限**（`pre` 的行在纸上想切就切，
  末段落在新页上只留一行也不管——`p{orphans/widows:2}` 管不到块内部）；② **代码块/引用被切开之后底纹带是否连续**
  没量（`--code-bg` 在打印态换成白底这一档 v0.49 管过，而「同一块跨页时左右边界与底色带接不接得上」本轮没有几何读数）；
  ③ `img1200` 那一枚比一页高的图仍在纸上纵向出血（图整块住在第 2 页而它比可印高度还高；v0.93 那一族管的是横向
  裁在版心右沿，纵向这一头本轮只有页数与落页读数、没有出血量）；④ **`h1..h4{break-after:avoid}` 自己造出的空白没有量也没有提示**（`toc40` 第 2 页只有 8 枚
  `hd` 标而墨底停在 `221.2`——下部约 555pt 空着，因为一枚标题不能独自坐在页底而它后面的正文又被推走；
  这一档与本轮的开关无关（改前后同形），但它和「整块推页」是同一族观感问题，本轮没量它该怎么修）；⑤ **没有 release A/B**（改的是 `@media print`
  里非表族那一档，dev 与 release 走同一份 CSS，但纸面证据只在 dev 一头）；⑥ v0.95 那三枚原样挂着（中途夹表头行那一档
  纸上不重复也无提示、嵌套表的表头行克隆未量、屏上藏克隆的重建路径只量了两趟）；⑦ v0.94/v0.93/v0.92/v0.91/v0.90
  那几项原样挂着（纸面行高比 Word 那档厚约 3×、超宽表被裁掉的一列在纸上无提示、两头裁位不同、纸面把虚线降成实线、
  部分账那一档纸面仍是比例、NodeView 与 `renderHTML` 两口径、被跨列格盖住的后续列没有独立把手、626 与 627 那枚
  1px 口径差、等分补平算法住两处、拖拽混单位、`fixTables` 公开通道 no-op、ODT 两头不往返、读侧只吃 `w:gridCol`、
  部分账存—重开变整表齐账、`w:between` 第五边、嵌套表版心按最外层近似、px 存整数的 ±0.25 磅漂移）
- **收尾**：README 新增本节 + 架构「分页控制」那条就地补口（这一族现在只剩图片；代码块/引用/目录与表同档流着排，
  两门都显式写，`j4` 那档图片 no-op 是留下的据）+ 文件清单 `index.css` 条目补 v0.96 这一段 +
  路线图勾掉「`pre`/`img`/`blockquote`/`.doc-toc` 同族仍整块推页」并把图片那一半留作「图片仍整块推页（替换件，
  摘掉 avoid 是纯 no-op）」、新开上述①②③④，版本 0.96.0（package.json / tauri.conf.json / Cargo.toml 三处对齐；
  **这一枚 bump 后来被并发轮次的 0.98.0 覆盖，故 v0.96 的本地提交里不带版本文件**。另记一笔归属证据：
  `src/index.css` 的最后修改时间 09:34 晚于 `paper-b6.log` 09:27 与 `wordjudge-b6.log` 09:31 ⇒ b6 那批复跑吃的树
  **不含**后来为 v0.97 起草又拆出去的那枚 `line-height: normal` 改动），
  tmp/x96 的夹具、前置实测腿、四档注入腿、CSS 结构+变异腿、dev 腿、纸面几何量具与判据腿、独立字节腿与 Word 腿
  按惯例删除（收摊后 1420/9222 无监听、openoffices.exe 0 支、com.openoffices.app 的 msedgewebview2 0 支、
  WINWORD 0 支，按显式 PID 收宿主而不是按进程名乱杀，全程未碰已装正式版）；自动更新的源托管与 macOS 打包
  按指令继续等信号，签名私钥已加密备份并演练 7/7，**私钥本体在本机仍是单点**。

## 文字深化一期：表格读侧三笔账 + 段落第五边（v0.97）

按「不扩格式、把现有格式做深」的路线图开工，窄口径：`src/lib/docx-fidelity.ts` +189 / −17（读手）、
`src/lib/cell-style.ts` +45（模型属性层）、`src/lib/docx.ts` +20（写侧）。Rust 一个字没动。

- **前置实测**（`tmp/x97`，18 枚夹具 + 3 枚往返件，三头对照：自家读手（HEAD 与改后两份对同一批件各出一份 HTML）+
  独立字节腿（zipfile 直解 `word/document.xml`，不吃自家读侧）+ Word 16.0 只读 COM 腿
  （`Table.*Padding` / `Cell.*Padding` / `Row.Height` / `WdRowHeightRule` / `Cell.Width`），只量不改产品）：
  ① **宽度那一格**——`gridzero`（`w:gridCol` 三枚全零）改前整表无账，改后读手给 [120,160,240]px 而 Word 读回
  90/120/180 磅 = 同一份账；`nogrid`（压根没有 `w:tblGrid`）与 `row0-notc`、`span-uneven`、`rt-span` 四臂逐臂同判
  ours=[90,270,90]px / word=[67.5,202.5,67.5]pt / gridTwips=[1350,4050,1350] ⇒ 网格说话时按网格；
  `span-clash`（行 0 逐格 `w:tcW` 与网格打架）读手 [90,270,90] 跟 gridCol 而 Word=[106.55,95.95]pt 按 `w:tblW` 重摊
  （字节里 tcW=[3000,2700]）⇒ 这一臂是**两头的次序不同**，本轮选了 grid-first 并把不同形如实记 NOTE；
  被弃的「把 tcW 均摊覆盖已有账」那一档量出来是 variantPx=[100,100,90]、对 Word 的最差偏差 127.50 磅而本轮算法 0.00
  ⇒ 均摊不是备选而是错的形状。② **行高** `w:trHeight`——`rowh` 四行读手 40/80/60/无 px 而 Word 30/60/45 磅 +
  rules=["atLeast","atLeast","exactly","auto"]：数只在 atLeast 那一档对得上，而**数住在 `@w:val` 而不是邻居那种 `@w:w`**
  （改前 `headBefore=0`：字节里声明了 3 枚而读手一枚都拿不到，`bytesDeclared=3 / wordReal=3` 两头互证）；
  `hRule` 缺省按 OOXML 说 atLeast，`exact` 的「超高裁内容」CSS 表达不了 ⇒ 按最小行高读入并**只在这一档**发一枚告警
  （`fxRules=[null,"atLeast","exact",null]` 而 `exactWarnFx=1`，往返件 `warnRt=0`）。③ **格边距**
  `w:tblCellMar` / `w:tcMar`——`mar-tbl` 表级 108 缇读手 [7.2,7.2,0,0]px 而 Word [5.4,5.4,0,0] 磅（同一份账三单位），
  改前 `headPaddedCells=0` 而改后 4/4；`mar-subset`（表级说四边、格级只说左边）读手 `{top:2,right:7.2,bottom:3,left:20}`
  而 Word [15,5.4,1.5,2.25] 磅 ⇒ **逐边覆盖**成立，而「整组替换」那一档量出来是 oursEdges=4 而 groupEdges=1
  （Word 那一头也是 4）；`mar-zero` 的 0 是真值（上下边距就是 0 也落），而字节里没有 `w:tblCellMar` 时 Word 读
  0.5/0.5 磅——那是**文档级默认那一层**，我们不读也不铺（记 NOTE，屏上交给 CSS 缺省）。④ **段落第五边 `w:between`**——
  `between-nobottom` 三段读手 `workBottom=[true,true,false]` 而改前 `[false,false,false]`（串尾不画，与 Word 同方向）；
  `between-break`（两段之间夹一张表）`[false,true,false]` ⇒ 断串那道门真管住了；`between-bottom`（显式 `w:bottom` 在场）
  同一条缝不叠两根线；`between-run`（run 级 `w:pBdr`）三臂 `identical=true` ⇒ 本轮没有牵连 run 级那一头
- **架构决定**（跟着数据走，宽度账的权威次序是本轮唯一的新裁决）：三笔账的形状都不是可选的——**网格先占、逐格补缺**
  （`w:gridCol` 说了数的列先落自己的账，`w:tcW` 只往缺账的列 `holes` 里补，补的是「这一跨的总账减掉已知列再平摊给 holes」，
  没有 holes 或减完剩负就整格跳过；没有 `w:tblGrid` 的表列数取「网格枚数与行 0 跨界的较大者」，`colwidth` 只在至少有一枚
  数时才写；`w:type` 为 auto/pct 的 tcW 不吃——pct 的换算要版心宽而导入处没有）；**行高住 `tableRow.rowHeight`**
  （HTML 里 `tr` 的高度本就是下限语义，与 atLeast 恰好同形；0 与缺省都不出账）；**格边距四边各一枚属性**
  （`padTop/padRight/padBottom/padLeft` 存 CSS px、0 是真值，`mergeAttributes` 把各属性给出的 style 片段串起来所以每条
  只写自己那一边；读侧「表级打底 + 逐边覆盖」，写侧只在有声明时给逐边 `w:tcMar`（缇），没声明的格不写）；
  **between 只在下一段是同一串签名时落成本段下边框**（签名 = 生效 pPr 的四边 + between + 底纹，样式链里的边框参与判定；
  中间隔表或非段落构件即断串、元素间的空白文本节点不算构件；显式 `w:bottom` 让位）。导出侧没有 between 出口，
  落下去的边按 `w:bottom` 回写（同一条缝同一根线，Word 视觉等价而字节换档，诚实记下）。
  **默认行距那一档不在本轮**：工作树里另有一枚 `.doc-content{line-height: 1.75 → normal}` 的 CSS 改动（v0.95/v0.96 记的
  「纸面行高比 Word 厚」的默认档对应），它需要屏上 + 纸面两腿并会作废 v0.94/0.95/0.96 的绝对像素与纸面基线，
  本轮没有 dev 树可用 ⇒ 拆出去另立一轮，本轮的口径只有上面这三笔账 + 第五边
- **验证**（三条腿 + 编译，全部离线，证据都在最终源文上）：三方判据腿 `RESULT judge pass=28 fail=0`
  （读手 / Word 16.0 的尺 / 字节三头同一趟，`Z|armsRead=17 warnArms=["f1-rowh"]`——告警只住在文档里真声明了 exact 的
  那一臂）；结构+变异合并一腿 `RESULT struct pass=61 fail=0 | judges=47 files=3 mutants=38 bad=0`（`S1~S34` 钉读手：
  `@w:val` 而非 `@w:w`、hRule 缺省 atLeast、exact 告警只在真 exact 时发、grid-first 那三枚出口、`tcWpx` 的 auto/pct
  两枚 null 出口、表级打底 + 逐边覆盖、0 是真值、`w:start/w:end` 别名、between 的五条门（`bottom === undefined` 让位、
  `local(nx.name) !== 'p'` 断串、空白文本节点跳过、签名一致才画、正文与格内两条通道都接上）；`C1~C7` 钉模型属性层
  （四条边由一枚列表生成、逐边读自己的 padding、边距 0 是真值而行高只收正数、行高住在 `tableRow`）；`D1~D6` 钉写侧
  （atLeast 回写、`pad*` 四边各取自己的属性、`margins` 只在有声明时给且单位 DXA）；38 枚变异各响该响的那条，含 `M14`
  「退回本轮之前：表级边距整条丢弃」、`M7`「均摊覆盖已有账」、`M15`「整组替换而不是逐边覆盖」、`MD1`「导出改写成
  exact ⇒ 读进来 atLeast、写出去 exact，往返不稳」、`MD2`「0 那一档写不出（读到的 0 边距在字节里蒸发）」；
  `B0` 三份源文各自检（注释短语「原文里有且剥后没有」、代码字面与字符串活着、带引号的正则原样活着）+ `P1` 注释陷阱
  三份各埋不响 + `P2` 反陷阱三份各真删一枚锚点并该响（`S5`/`C3`/`D1`））；往返腿（写→读同一份源文）`rt-rowh` 三行
  `height: 40px / 80px / 无`、`rt-mar` 第一格四条边 `0/0/7.2/7.2` 而第二格只有 `padding-left: 20px`、`rt-span`
  `colspan="2" colwidth="90,270"`；`pnpm exec tsc --noEmit` exit 0（Rust 本轮一个字没动，故 cargo/build 未跑）。
  **本轮没有 dev 真机腿与纸面腿**：dev 树此刻由另一会话持有，而我的 dev 腿开头就 `__oofCloseTab` 关全部标签（那会毁掉
  它未保存的工作）⇒ 行高与格边距在屏上和纸上的形状本轮**没有读数**，明写成未勾项
- **本轮撞到的量具坑，都不是产品**：① 判据把格子里的 `<p>` 数成了段落（`paras=5` 而夹具是 3 段正文 + 1 张表），
  「串尾不画」那条于是整臂假失败 ⇒ 量 `between` 的相邻关系前必须先把 `<table>…</table>` 整块摘掉；② `S19` 数的是
  `marginsCss(` 的枚数，而那枚**函数定义本身**也命中 ⇒ 基线天然红，这一红在变异腿里伪装成「30 枚变异全都多响 [S19]」
  （产品没坏，腿全红），改成「旧通道名 0 枚 + 调用恰 2 枚 + `padding-top:` 文案恰 1 枚」——同族教训：**数定义点的判据
  是假绿/假红发生器**；③ `B0a` 的探针短语从别的文件（`src/index.css`）抄来，而它在本轮源文的注释里根本不存在 ⇒
  探针改成「原文里必须有、剥后必须没有」两个条件一起判，判据自己证明它量得到；④ Word 腿在本机仍只能只读
  （`SaveAs2`/`ExportAsFixedFormat` 挂），要的读数一律在导出之前落盘；⑤ 三份文件共用一枚变异表时，漏填 `file`
  字段会让锚点在错的那份文件里数到 0 而报「锚点枚数 raw=0 stripped=0」，那是量具错不是产品错（锚点枚数门是这一轮
  第一次跨三份文件生效的那道）；⑥ 产品注释里那句「Word 对每张表都写 `w:tblCellMar`」是**没有据的**——字节腿在手写
  夹具上读出 15 枚 `TBLCELLMAR|None`，而判据腿的 NOTE 记着 Word 那一头此时给的是文档级 0.5 磅（另一层）⇒ 注释改成
  实测形状
- **本轮没动、量出来记着**（已开进路线图）：① **Word 的文档级默认格边距那一层**（字节里没有 `w:tblCellMar` 时 Word
  读 0.5/0.5 磅）我们不读也不铺；② **cell-clash 那一格两头次序不同**（我们跟 gridCol，Word 按 tcW/tblW 重摊）——
  grid-first 是本轮选的，第三方那一头没有对齐判据；③ **ODT 链路的 `pad*` / `rowHeight` 通道**（v0.97 量出「两头都不认」，
  **表格写侧第一笔账已接**：写侧逐边 `fo:padding-*` + `style:min-row-height`，读侧另收 `fo:padding` 简写与四档行高字面）；
  ④ **`w:tblLayout` 仍不读**（自动/固定布局档吃不到）；⑤ **exact 行高的裁剪语义**（读入按 atLeast，屏上不裁，只有
  一枚告警）；⑥ **行高与格边距在屏上/纸面没有读数**（本轮没有 dev 腿与纸面腿）；⑦ `w:between` 的**导出出口**
  （写回成 `w:bottom`，字节换档）；⑧ v0.96 那六枚与 v0.95/v0.94/v0.93/v0.92/v0.91 那几项原样挂着
- **收尾**：README 新增本节 + 架构两处就地改口（v0.30 表格通道那条补「v0.97 起读侧不再只吃 `w:gridCol`：网格先占、
  tcW 补缺」并记上另两笔账、v0.39 段落边框那条把「第五边仍未接」改口成「v0.97 已接，`w:space` 仍未接」）+
  路线图勾掉「读侧只吃 `w:gridCol`…」与「段落的第五边 `w:between` 仍未接」两条（各留改口注）并新开上述①~⑦ 与
  「默认行距」那一枚拆出去的轮次；**版本号本轮不碰**——`package.json` / `tauri.conf.json` / `Cargo.toml` 现在住着
  并发轮次的 0.98.0，本轮不与之抢这三处对齐（故本节描述的是源码形状而不是发行号）；tmp/x97 的 18 枚夹具、三头
  前置实测腿、三方判据腿、结构+变异腿与往返腿按惯例删除；**dev 树全程未碰**（它属于另一会话）


## 格边距的表样式那一层第一次上账：三层逐边合并，而默认表样式不算层

按「不扩格式、把现有格式做深」的路线图开工，本轮从 v0.97 收尾那句候选缺口里取「Word 的文档级默认格边距那一层」——量下来它住的**不是文档默认而是表样式**那一层。窄口径：
  `src/lib/docx-fidelity.ts` +33 / −4（只有读手，五枚 hunk），Rust 一个字没动、写侧一寸没碰。**本轮不占版本号**：`package.json` /
  `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0，而并发轮次已把工作树里两节的编号写成 v0.99（PDF 表单）与 v0.100（修订），
  本节若也自称 v0.99 就是两枚同号 ⇒ 本节按内容命名，源码注释同样不带编号（只写「样式层」；改口之后复跑结构腿，见下面量具坑 ⑦）。

- **前置实测**（`tmp/x99`，13 枚自造最小 docx + 三头同一趟：自家读手 / Word 16.0 只读 COM（`Cell.*Padding` 磅）/
  独立字节腿（zipfile + 正则直解 `word/document.xml` 与 `word/styles.xml`，含样式链，不吃自家读侧），只量不改产品）：

① **样式层是真实存在的一层**——`a1_ref108`（表 `w:tblStyle="S108"`，样式说 top/bottom 108 缇、left/right 144 缇，
  表自身与逐格都不说）ours=[7.2,9.6,7.2,9.6]px ↔ Word=[5.4,7.2,5.4,7.2] 磅（同一份账三个单位）；
  `a7_basedon`（叶子样式什么都没说而祖先 `SP` 说 216）ours 四边 14.4px，链是 `['SC','SP']` ⇒ 「叶子没说」不等于「没有」；
  `a12_chain_override`（祖先说四边 216 而叶子只说 left 108）ours=[14.4,14.4,14.4,7.2] ↔ Word=[10.8,10.8,10.8,
  5.4] 磅 ⇒ 沿链**自根向下、叶子覆盖根**，而不是遇到第一枚有声明的就停

② **0 在样式这一层也是真值**——`a3_stylezero`（样式说四边全 0）ours=[0,0,0,0] 而 Word=[0,0,0,0] 磅，**不是** Word 自带的那组
  5.4 ⇒ 「样式说了 0」与「样式没说」在 Word 眼里是两档，读回来也必须两档

③ **谁压谁，且逐边**——`a4_precedence`（样式 216 而表自身 `w:tblCellMar` 108）ours 7.2px 而不是 14.4px ⇒ 表层压样式层；
  `a6_threeedge`（样式说 top/left、表说 left/right、格 A 说 bottom）ours 第一格
  `{top 7.2, right 20, bottom 24, left 14.4}` 而第二格 `bottom=null` ⇒ 三层**逐边**各取最近一层说的数（v0.97
  立的「逐边而不是整组替换」在跨层这一头同样成立）

④ **默认表样式（`w:default="1"` 的 Normal Table）不是一层**——四枚判别臂各砍一种备选解释：`a2_defaultonly`（表不引用任何样式，
  只有默认样式声明 216/288）、`a10_default_nosemi`（同臂但不写 `w:semiHidden`——判的就是「不算层」这道门是不是 `semiHidden` 造成的）、
  `a11_default_as_ref`（表直接 `w:tblStyle="TableNormal"` 把默认样式指起来——判「被引用」是不是那道门）三臂 ours 全空而 Word
  三臂**同一读数** top/bottom 0 磅、left/right 5.4 磅（正是 Word 自带的应用默认，不是文件里声明的那组数）；
  `a13_default_mid_chain`（默认样式住在链中间，作为叶子 `SDerive` 的 `basedOn` 祖先，而叶子自己说 left 108）ours 只有
  `left 7.2`px ↔ Word=[0,5.4,0,5.4] 磅 ⇒ 「默认样式在链里哪一层都不算」连中间层也管住；`a8_default_vs_ref` 把这条钉死：默认样式声明了
  bottom 216 而被引用的样式没说 bottom，Word 读回 **0** 而不是 10.8 ⇒ 那一层我们既不读也不铺（铺了就是把别人的默认当成用户的声明写回文件）

⑤ **条件层 `w:tblStylePr` Word 认而我们本轮不接**——`a9_condition`（基础样式说四边 108，同一枚样式带
  `<w:tblStylePr w:type="firstRow">` 里的 `w:tcMar` left 300）ours 首行四边一律 7.2px，而 Word 读回 [5.4,5.4,
  5.4,**15**] 磅 ⇒ 首行那一格的左边距在 Word 是 20px 而我们是 7.2px。这一层还牵着 `w:tblLook` 的位语义（哪个条件真生效），
  本轮没有把它和样式链一起裁住的把握 ⇒ 如实开成一枚未勾项，判据里以**显式豁免清单 + 由另一条判据现场供数**记着（量具坑 ①）

⑥ 基线臂在同一趟里对着：`a5_none`（被引用的样式什么都没说）ours 全空而 Word 读回 [0,0,0,0] 磅——与 a2 那组 0/5.4/0/5.4
  **不同形**（引用一枚什么都没说过的样式，Word 连自带的那对左右边距也不铺）；屏上这一档仍交给 CSS
  缺省（`.doc-content table td, th{padding: 6px 10px}`），本轮没有 dev 腿 ⇒ 明写未勾

- **架构决定**（跟着数据走，唯一的新裁决是「哪几层算层」）：格边距的权威是一份**逐边**的账，来自三层而不是两层——被表引用的样式（`w:tblPr/w:tblStyle` 指着的，
  沿 `w:basedOn` 自根向下、叶子覆盖根）打底，表自身 `w:tblCellMar` 逐边盖它，逐格 `w:tcMar` 逐边盖表；**默认表样式不进这条链**（a2/a10/a11/
  a13 四臂量的就是这道门，而它既不是 `semiHidden` 也不是「有没有被引用」造成的）；三层都没说的边仍不铺数（`undefined` 而不是 0），因为 Word
  那一头此时给的是它自带的 0/5.4/0/5.4 磅，那是应用默认而不是文档说了的数；说了 0 必须落 0（a3）。换算仍只走那一枚口径（1px = 15 缇、1pt = 20 缇 ⇒ px
  = pt × 4/3）。写侧一寸没动 ⇒ 样式层读进来的数**没有样式层的出口**，落盘时以逐格 `w:tcMar` 的形式重住（往返腿 R5 判的就是这一档，
  形状换了档这件事如实记在下面而不是偷偷说无损）

- **验证**（三条腿 + 编译，全部离线）：三方判据腿 `RESULT judge pass=15 fail=0`（13 臂 × 2 格 × 4 边；`J1` ours==独立字节底账、
  `J2` 凡是说了数的边 ours==Word（磅→px 同一口径，豁免 1 格由 `J9` 供数）、`J3` a2/a10/a11 三臂 ours 全空而 Word 三臂同读数、
  `J4`~`J7` 压次 / 三层逐边 / basedOn 继承 / 默认样式不铺、`J8` 样式层 0 是真值、`J9` 条件层那一格两头的差当场供数、`J10` 样式层四边上账、
  `J11` 13 臂表级 style 里都没有 padding、`J12` 13 臂一条告警都不发、`J13` 正控制量出 9 种不同期望形状、`J14`/`J15` 后加的 a12/a13
  两臂）；结构+变异合并一腿 `RESULT struct pass=14 fail=0 | mutants pass=13 bad=0 | b0=6/6 trap=ok revtrap=ok`
  （吃剥掉注释并归一 LF 的三份源文；`S1~S14` 钉这道门的出口——样式层进账处恰一枚（`S1`）、默认样式逐枚 entry 都跳（`S3`）、`isDefault` 只认
  `w:default`（`S4`）、链自根向下不许 `push`（`S5`）、样式条目带着自己的 `w:tblPr`（`S6`）、`StyleInfo` 那两枚可选字段（`S7`）、
  沿链走而非常量空账（`S8`）、合并次序是 样式→表→格（`S10`）、旧通道不借尸还魂（`S11`）、v0.97 那三笔账没被顺手改（`S13`）、换算只走那一枚尺（`S14`）；13
  枚变异各响该响的那条，含 `m2`「默认样式也算一层」、`m4`「链序反过来于是根覆盖叶子」、`m7`「链根本不走」、`m8`「整组替换而不是逐边」、`m9`「给表铺 padding」、
  `m13`「网格账整段撤掉（打 v0.97 那笔）」）；往返腿（写→读同一份源文）`RESULT rt pass=9 fail=0`：六枚格逐边 `RT|back` 与 `RT|want`
  逐枚同值（那六档 = 7.2/9.6 一组、四边 0、四边 14.4、只有 left 20、只有 bottom 24、一句不说），字节里逐格边枚数==声明枚数
  `[4,4,4,1,1,0]`（`R2`），0 往返为真值（`R3`），px→缇→px 无漂移（`R4`），**写件里没有 `w:tblStyle` 也没有表级
  `w:tblCellMar`**（`R5`：样式层在写侧没有出口，账换档住进逐格 `w:tcMar`，同一趟数到 5 枚而 6 枚格——一句不说的格仍不说），行高往返仍是
  `w:trHeight w:val="600" w:hRule="atLeast"` ↔ `<tr style="height: 40px">`（`R6`），表元素上无
  padding（`R7`），六枚格正文一枚不丢（`R8`），`R9` 正控制（同一格塞两份 `w:tcMar` 时尺读得出 1→2）；`pnpm exec tsc --noEmit`
  exit 0（Rust 本轮一个字没动，故 cargo/build 未跑）。**本轮没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，
  不跑）⇒ 样式层读进来的边距在屏上和纸上的形状本轮**没有读数**

- **本轮撞到的量具坑，都不是产品**：① **豁免清单必须与供数判据同源**——`J2` 起初整臂红在 `a9` 首行的 `left` 那一格（本轮刻意没接的条件层）。
  修法不是把那一格从判据里删掉，而是立一枚显式 `KNOWN_GAP` 集合 + 断言它的**大小** + 要求另一条判据（`J9`）现场量出同一格的 Word 读数，
  于是「豁免」不会悄悄长大成漏；② **判据锚点必须吃代码面文本**（本轮两次踩）——`S13` 先钉 `'tableRow'`（读侧根本没这串）基线天然红而 13 枚变异全报「多响」；
  第二版钉 `w:between`，可它只活在注释里、剥完注释就消失 ⇒ 还是红；改成钉真代码（`find(trPr, 'w:trHeight')` /
  `attrNum(th, 'w:val')` / `betweenOfSiblings` / `border-bottom: ${betweenCss}`）才立得住——同族教训第二次兑现：
  **锚点红一次，整张变异表就跟着红一次**；③ `docxToHtmlFidelity` 返回的是 `DocxImport`（
  `{html, comments, blocks, warnings}`）而不是字符串，往返腿把它当字符串使 ⇒ `RT|back=[]`，而写件本身是好的（同一趟独立数到 6 枚
  `<w:tc>` / 5 枚 `<w:tcMar>`）⇒「量具坏了」长得和「产品坏了」一模一样，先用独立字节腿证明件的结构再改判据；④ **Python 的 `$` 在非 MULTILINE
  下只认串尾**——`re.search(r"RT\|trs=(.*)$", log)` 对文件中间那一行返回 `None` 而整腿 `AttributeError` ⇒ 行锚定取数一律
  `re.M`；⑤ **字节尺要先照真件的字节形状写**——真件是 `<w:top w:type="dxa" w:w="108"/>`，`w:w` 不在第一个属性位，写死
  `'<w:top w:w="…"'` 的尺对每枚格都数到 0 枚边（`R2`/`R3`/`R9` 三条同时假失败）⇒ 改 `<w:%s\b[^>]*?w:w="(-?\d+)"`；
  这一枚的凭据正是 `R9` 那把正控制：**尺若恒 0，正控制也会恒 0 而露馅**；⑥ **变异的期望要按判据实际量的东西写**——`m10` 注入的那串不含 `marginsCss(`
  因而期望只能写 `S9`；`m13` 若只做子串替换 `w:gridCol`→`w:gridColX`，`cnt >= 1` 那类判据根本不会响 ⇒ 改成整段换成 `[]`；⑦
  **编号归属也是量具**：并发轮次已把工作树两节命名为 v0.99/v0.100，本轮自称 v0.99 就是同号相撞 ⇒ 本节与源码注释一起改口不带编号，
  而改口动了注释就**必须复跑结构腿**（14/0、13 枚变异逐枚同判，B0 的探针短语「不算这一层」在改口之后仍「原文里有、剥后没有」）

- **本轮没动、量出来记着**（已开进路线图）：① **表样式条件层 `w:tblStylePr`（firstRow/lastRow/oddRow…）不接**（`a9` 臂 ours
  7.2px 而 Word 首行 left 15 磅 = 20px），它要连着 `w:tblLook` 的位语义一起裁才有意义，否则「哪一行的哪个条件真生效」仍是猜；②
  **样式层的数在写侧没有出口**：读进来的样式边距落盘变成逐格 `w:tcMar`（`R5` 判住），往返视觉等价而**字节换档**，第三方件重存之后样式层那份声明不再活着；③
  样式条件层里的 `w:tcPr`/`w:rPr`/`w:pPr` 三格本轮只碰了 `w:tcMar` 那一格；④ **屏上/纸面本轮没有读数**（无 dev 腿、无纸面腿），
  样式层边距的实际观感未量；⑤ `pad*` / `rowHeight` 在 ODT 两头仍没有通道、`w:tblLayout` 仍不读、cell-clash
  那一格两头次序不同仍无第三方判据（v0.97 那三枚原样）；⑥ v0.96/v0.95/v0.94/v0.93/v0.92 那几项与「默认行距
  `line-height: normal`」那一枚拆出去的轮次原样挂着

- **收尾**：README 新增本节 + 架构一处就地改口（v0.30/v0.97 那条「读侧不再只吃 `w:gridCol`」里的格边距部分补上第三层与「默认表样式不算层」那道门）+
  路线图把「Word 的文档级默认格边距那一层不读也不铺」勾掉并改口（量出来那一层根本不住在文档默认，而是住在表样式；而 Word 自带的 0/5.4/0/5.4 确实仍不铺），
  新开上述①②③④；**版本文件不入本提交**（0.98.0 住着并发轮次的对齐号，本轮不与之抢那三处）；`tmp/x99` 的 13 枚夹具、三头前置实测腿、三方判据腿、结构+变异腿、
  往返腿与独立字节腿按惯例删除；**dev 树全程未碰**（它属于另一会话）


## 格边距的条件层第一次上账：四层逐边合并，而 `w:tblLook` 的 `w:val` 从不被读

按「不扩格式、把现有格式做深」的路线图开工，本轮取上一节明写的那枚未勾项——「表样式条件层 `w:tblStylePr`（firstRow/lastRow/oddRow…）不接」
（`a9_condition` 臂 ours 首行四边一律 7.2px 而 Word 读回 15 磅 = 20px）。窄口径：`src/lib/docx-fidelity.ts` +110 / −4（六枚 hunk，全部住在读手），
Rust 一个字没动、写侧一寸没碰。**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xcond`，63 枚自造夹具分两批 55 + 8，三头同一趟：自家读手 + Word 16.0 只读 COM + 独立字节腿，互不吃对方的读手）：每枚臂出一份最小
  docx（一枚 3×3 表），数全部摆成互不相同的档，这样任一枚格的任一边走回来都能认出它是哪一层说的——样式基座 `w:tblCellMar`
  60/108/90/120 缇 = top/left/bottom/right 4/7.2/6/8px，`firstRow` left 300（20px）、`lastRow` left 450（30px）、`oddRow` top 150（10px）、
  `evenRow` top 270（18px）、`firstCol` 330（22px）、`lastCol` 510（34px）、表自身 `w:tblCellMar` left 144（9.6px）、逐格 `w:tcMar` left 216（14.4px）。
  量出来五格：① **闸门有四副面孔而 `w:val` 一位都不算数**——`w:tblLook` 不存在、或存在而一枚位属性都没写 ⇒ 首行与首列开、末行与末列关
  （`k3_look_absent`：Word 首行 left 15 磅 = 20px 而二三行 left 5.4 磅 = 基座 7.2px，同时 `firstCol` 的 right 16.5 磅 = 22px 落在九枚格上；
  `g_firstCol_L1_empty` 空元素同判）；只写 `w:val` 而无逐位属性 ⇒ 四位全关（`g_firstCol_L2_val` ours left=7.2px ↔ Word 5.4 磅，条件一次没落；
  `k4_zero` 六枚条件全声明而 val=0000 ⇒ 九枚格全在基座）；写了至少一枚位属性 ⇒ 说了的按说的算、没说的按开算（`k5_attr_beats_val` 里 val=0000 而
  firstRow=1 firstColumn=1，Word 末行照落 left 22.5 磅 = 30px、九枚格照落 right 25.5 磅 = 34px；`k6_val_beats_attr` 里 val=000F 而 firstRow=0 firstColumn=0
  ⇒ 首行首列关掉而未说的末行末列照开）；样式自己写的那枚 `w:tblLook` 不参与裁决（`r_style_look_on_L3` 与 `r_style_look_off_L3` 逐格同形，表上那枚 absent）。
  ② **只有四型会把边距落到实处**——`oddRow` / `evenRow` / `band1H` / `band2H` / `wholeTable` / 未知型六臂（`g_oddRow_L4_bands`、`g_evenRow_L4_bands`、
  `g_band1H_L4_bands`、`g_band2H_L4_bands`、`k13_wholetable`、`k15_band_alias`、`k17_unknown_type`）在 Word 眼里九枚格全不落边距，而 ours 同一趟也全不落
  （判据里空集对空集同样是通过，落点集合逐枚相同）。③ **首列/末列那两型的边距落到全表每一格**——`g_firstCol_L4_full` ours left=22px 而 Word left=16.5 磅，
  九枚格分毫不差（`g_lastCol` 那档 34px ↔ 25.5 磅同形，`k16_firstcol_colspan` 把跨列格也算进这一档）；而同一个闸门同一个型换成 `w:rPr` 载荷时才是真按列落
  （`q_bold_firstCol_L3`：Word 只在 R1C1 读回 bold=-1 而三列的边一律 5.4 磅）⇒ 「边距这一族在 Word 里不是列作用域」是被量出来的而不是猜的。
  ④ **同一型的两块条件是整块替换而不是逐边合并**——`r_dup_type_firstRow_L3`（A{left 300, top 600} + B{left 270, bottom 450}）Word 落的是 B 的
  left 13.5 磅与 bottom 22.5 磅而 A 的 top 一次都没出现（那枚读回基座 4px），`q_basedon_L3`（祖先 firstRow 说 left、本体 firstRow 说 right 360）Word 只落
  right 18 磅而 left 仍是基座；不同型各落各的（`r_basedon_diff_type_L3`：祖先 firstRow 落第 0 行 20px、本体 lastRow 落末行 30px）。
  ⑤ **撞车次序**逐臂问了一遍：逐格 > 条件 > 表级 > 样式基座（`k8_cell_vs_cond` / `q_cell_vs_cond_L3` 两头 R1C1 left 14.4px ↔ 10.8 磅；
  `k7_tbl_vs_cond` / `q_tbl_vs_cond_L3` 表自身那枚 144 压住条件的 300 ⇒ 两头 9.6px ↔ 7.2 磅），末列压首列（`q_firstCol_lastCol_both`），
  行型压列型（`r_rowcol_same_edge_L3`：firstRow 的 left 落地而 firstCol 那枚 22px 一次都没出现 ⇒ 两头 left=20px ↔ 15 磅），
  单行表既是首行又是末行时首行赢（`r_one_row_first_last_L3` 两枚位属性都 1 ⇒ 20px ↔ 15 磅，`k18_one_row_table` 同一档在 val 门上再问一遍）。

- **本轮唯一的架构决定**（跟着数据走，缺陷住在读侧那第四层）：格边距从此是**四层逐边合并**——样式基座（沿 `w:basedOn`）→ 表级 `w:tblCellMar` →
  **条件层 `w:tblStylePr/w:tcPr/w:tcMar` 配 `w:tblLook` 闸门** → 逐格 `w:tcMar`，四条形状都不是可选的——闸门只吃**表上**那一枚 `w:tblLook`
  （`r_style_look_on/off` 两臂就是量出来要弃「样式自己那枚也算」的备选解释）；只有 firstRow/lastRow/firstColumn/lastColumn 四型落地，其余型按实测一律不落；
  同一型的两块与 basedOn 链上的同型是**整块替换**（`out[type] = mar`），而四**层**之间才是逐边合并（`{...样式, ...表级, ...条件, ...逐格}`），0 仍是真值；
  行型按行落、列型按**全表**落（③ 那格的后果）；`w:default="1"` 的表样式上的条件层 Word 会落而我们**不铺**，只发一句
  `默认表样式的条件层格边距未铺：<型名>`（上一节刚把「默认表样式不算一层」立起来，本轮不再从后门把它请回来）；条件块里只认 `w:tcPr/w:tcMar` 那一格，
  `w:tblPr/w:tblCellMar` 那一格本轮不接（Word 照样落，量出来记着）。换算仍只走那一枚 `PX_TWIP/TWIP_PX`（1px = 15 缇），写侧一个字节没动。

- **验证**（离线三头 + 结构/变异 + 往返 + 独立字节腿，全部在最终源文上跑，Rust 本轮一个字没动、屏上与纸面本轮没有读数）：三方判据腿第一批 55 臂
  `RESULT judge pass=95 fail=0`（`落地点 ours=26 word=26`、`PER-EDGE|不等枚数=0` 即每一格每一条边在两头读回同一个数、`OFF-LEDGER|…枚数=0`、
  `告警对得上=True`、`gapDefault=无`）；第二批 8 臂 `RESULT judge pass=18 fail=0`（`落地点 ours=10 word=10`，`gap臂=r_default_style_cond_L3` 就是刻意不铺的
  那一臂——ours 九枚格全空而 Word R1C1 left 15 磅，那一句告警在同一趟对上了，`OFF-LEDGER 枚数=9` 全部住在 `r_slot_tblpr_firstRow_L3`（Word 落了
  `w:tblPr` 那一格而 COM 把它的读数报成 -1 磅 = 账外），`ours 同时出账外=0` 判的就是「账外只许 Word 一头有」）；结构+变异合并一腿
  `RESULT struct pass=14 fail=0` + `RESULT mutants pass=15 bad=0`（`DATA|files=1 judges=14 baseBad=无`、`B0|剥注释自检 pass=13 bad=无`、
  `CONTROL|旧版在这一把尺下通过的枚数=0`、TRAP/TRAP2/REVTRAP 全过；15 枚变异各响该响的那条，含 M1「条件层改成逐边合并而不是整块替换」响 S2、
  M3「val-only 那一档不再关门」响 S5、M6「首列压末列」与 M7「末行压首行」响 S7、M13「默认样式的条件层也铺」响 S12、M14「readStyles 收错元素」响 S13+S14）；
  往返腿（docxToHtmlFidelity → prosemirrorToDocxBytes）`RESULT rt pass=63 fail=0 arms=63 cells=553 declaredEdges=2176 dupLabels=0`，默认样式那一臂
  `declared=0|bad=0|warnsBefore=1|warnsAfter=0`；独立字节腿（zipfile + 正则直解 `document.xml`/`styles.xml`，不吃自家读手）
  `RESULT rtbytes pass=13 fail=0`（`DATA|arms=63 expCells=553 expEdges=2176 shiftArms=60` ⇒ 63 臂里 60 臂的层位从「样式/条件声明」换成了逐格 `w:tcMar`；
  `R6` 往返件零枚表级 `w:tblCellMar`、`R7` styles.xml 零枚 `w:tblStylePr`、`R8` 零枚 `w:tblStyle` 引用 ⇒ 写侧确实没有样式层与条件层的出口；
  `R9` 层换档确实发生而不是顺手；`R10` 不铺就不出口；`R11`/`R12` 两枚正控制：把一枚 `w:w` 改成 7 会被 `R2` 抓到、那把尺认得出重复计数）；
  `pnpm exec tsc --noEmit` exit 0。

- **本轮撞到的量具坑，都不是产品**：① **`python <腿>.py` 那一趟打印的是另一枚脚本的输出**——`rtbytes.log` 与 `struct.txt` 逐字节相同（3253 字节）、exit 0、
  stderr 全空，连重定向进去的日志里都是那份别人的读数 ⇒ 跑不起来的腿看着像通过了；此后每条腿自打一行 `IDENT|<腿名>-<批> pid=… here=…`，
  读数只吃带这一行的那份日志（「先证明校验脚本跑起来了再报结论」在这一族的第三次兑现）；② `python -I` 隐含 `-E` ⇒ `PYTHONIOENCODING` 被静默忽略，
  日志里中文全成 mojibake（`rb2.log` 那一趟）⇒ `-I -X utf8` 两枚一起写；③ `rtout/` 的文件名带 `rt-` 前缀而 `rt.log` 的 DECL 行吃的是臂名，差一枚前缀就整腿
  FileNotFoundError（`rb1.err`），而「拿不到期望数」在判据里会被读成空判 ⇒ 修尺之外新立 `R0`「每一臂都有模型那份期望数」；④ DECL 行本身有 7 段
  （`fmt()` 把四边用 `|` join 起来）而 `split("|")` 不限刀数就 unpack 报错 ⇒ `split("|", 3)`；⑤ 模型 attr 名是 `padTop/padLeft/…` 而 HTML 边名是 `top/left/…`，
  往返腿起初把 HTML 那份边名 spread 进 attrs ⇒ 553 枚格全假红；⑥ 块注释里不能写 `*/`（那句 `pad*/rowHeight` 让 .mts 直接 PARSE_ERROR）；
  ⑦ Word 的 COM `Cell.*Padding` 在「条件块住在 `w:tblPr` 那一格」的臂上返回 -1 磅，既不能当「不等」也不能当「通过」⇒ 账外读数另立一枚计数，而「我们这一头
  也出账外」才是真缺陷。

- **本轮没动、量出来记着**（已开进路线图）：① `w:default="1"` 表样式上的条件层只发告警不铺（`r_default_style_cond_L3` 臂 ours 全空 ↔ Word R1C1 15 磅）；
  ② 条件块里只接了 `w:tcPr/w:tcMar` 那一格，`w:tblPr/w:tblCellMar` 那一格 Word 照样落（`r_slot_tblpr_firstRow_L3` 九枚账外读数），`w:rPr`/`w:pPr` 两格本轮只当探针
  （`q_bold_firstCol_L3` 量到 bold 只落每行第 0 格 ⇒ 边距与字体两族在 Word 里的作用域不同）；③ `oddRow`/`evenRow`/`band1H`/`band2H`/`wholeTable` 各型按实测不落边距，
  而它们的底纹与字体载荷仍未接；④ **写侧没有样式层与条件层的出口** ⇒ 读进来的数落盘一律变成逐格 `w:tcMar`（同一趟 60/63 臂换档），第三方件重存一趟之后原声明不再活着，
  而那句「默认表样式未铺」的告警也不在往返之后回来（`warnsAfter=0`）；⑤ **屏上/纸面本轮没有读数**（无 dev 腿、无纸面腿，dev 树由另一会话持有 ⇒ 破坏性，不跑）；
  ⑥ `pad*` / `rowHeight` 在 ODT 两头仍没有通道、`w:tblLayout` 仍不读、cell-clash 那一格两头次序不同仍无第三方判据、exact 行高只一枚告警、Word 自带的 0/5.4/0/5.4
  磅应用默认仍不铺（前几节原样），「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着

- **收尾**：README 新增本节 + 架构一处就地改口（v0.30/v0.97 那条格边距的「三层逐边合并」补成四层：条件层与 `w:tblLook` 闸门的四副面孔、四型才落地、同型整块替换）+
  路线图勾掉「表样式条件层 `w:tblStylePr`（firstRow/lastRow/oddRow…）不接」并改口（量出来只有四型落地而 `w:val` 从不被读），把「样式层读进来的数在写侧没有出口」补上本轮的
  `expEdges=2176 / shiftArms=60` 三枚零计数，把「样式条件层里只碰了 `w:tcMar` 那一格」收窄成剩下的那一格与两格载荷，新开「`w:default="1"` 表样式上的条件层只发告警不铺」
  「band/oddRow 各型的其余载荷没接」「条件层这一趟没有 dev 真机腿与纸面腿」三枚并留上述①②③④⑤；**版本文件不入本提交**（0.98.0 住着并发轮次的对齐号，
  本轮不与之抢那三处）；`tmp/xcond` 的 63 枚夹具、三头前置实测腿、两批判据腿、结构+变异腿、往返腿与独立字节腿按惯例删除；**dev 树全程未碰**（它属于另一会话）


## 格底纹第一次上样式层与条件层的账：三层比「哪一层在场」，而它真按位置落、格边距那族不按

按「不扩格式、把现有格式做深」的路线图开工，本轮取上一节明写的两枚未勾项——「oddRow/evenRow/band1H/band2H/wholeTable 各型的其余载荷没接」里底纹的那一半，
以及「条件块里只接了 `w:tcPr/w:tcMar` 那一格」里同一格的另一枚载荷。窄口径：`src/lib/docx-fidelity.ts` +131 / −44（26 枚 hunk，全部住在读手），
Rust 一个字没动、写侧一寸没碰。**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xshd`，69 枚自造夹具分六批 20 + 22 + 8 + 9 + 7 + 3，三头同一趟：自家读手 + Word 16.0 只读 COM + 独立字节腿，互不吃对方的读手）：每枚臂仍是一份最小 docx
  （一枚 3×3 表），色一律摆成互不相同的档（基座 FFF2CC、firstRow D9E1F2、firstCol FCE4D6、lastRow E2EFDA、lastCol E4DFCB、四角 nw D2691E / ne 5F9EA0 / sw 9370DB / se F08080、逐格 806000），
  这样任一枚格的颜色回来都能认出它是哪一层说的。量出来六格：① **三层尊卑 + 「auto 是真值」**——逐格压条件压基座（`p15_cell_wins` 两头 #4 那一格都是 806000 而其余八枚 FFF2CC）；
  而逐格那枚 `w:fill="auto"` 也算「说了话」：`q15_cell_auto_over_base` 里它把样式基座清掉（两头 #4 那一枚都读回无底色而其余八枚 FFF2CC）而 `r4_cell_auto_over_cond` 里它把条件层清掉
  （那一枚格两头都无底色，而同一行没被顶掉的格子照落条件层的 D9E1F2）⇒ 三层要比的是**哪一层的 `w:shd` 在场**而不是色值，色值那一档把「说了没有」和「没说」分不开；基座沿 `w:basedOn` 自根向下后来者覆盖（`p17_chain_leaf_wins` 祖先 D9D9D9 + 本体 FFF2CC ⇒
  Word 九枚全读 FFF2CC；`p18_chain_inherit` 只有祖先说 ⇒ 九枚 D9D9D9）。② **条件层的底纹真按位置落**——firstRow 落第 0 行三枚（`p3_firstRow`）、firstCol 只落每行第 0 网格列三枚
  （`p5_firstCol` / `t7_firstCol_B_ctl` 都是 FCE4D6,-,- 那一型而其余六枚 Word 报 `000000/0`），跨两列且自第 0 列起的那枚格也算第 0 列（`q16_firstCol_span`：8 枚格里 FCE4D6 落 #0/#2/#5 而它右边那枚落基座）；
  四枚角型（nw/ne/sw/seCell）是一等型别，落点就是那一角那一格（`u1_corners_look_on` 四枚各落一格），闸门要那一角的**两枚位都开**（`u3_corner_last_bits` 里只有 seCell 的末行+末列都开着 ⇒ 只它落 F08080），
  尊卑按**型别**而不按声明顺序（`u2_corner_vs_rowcol` 把 nwCell 写在 lastRow/lastCol 之后、`u7_nw_declared_first` 把它写在最前，Word 两趟都在第 0 格落 D2691E 而把 firstRow 让到 #1/#2、firstCol 让到 #3/#6）；
  全梯子同时开的那臂逐枚同账（`p14_gate_all_on` 两头都是 D9E1F2×3, FCE4D6, 空, E4DFCB, E2EFDA×3）。③ **底纹与格边距不是同一种作用域**——同一个闸门、同一个 firstCol，载荷是 `w:tcMar` 时上一轮量到
  九枚格全落（`g_firstCol_L4_full` ours 22px ↔ Word 16.5 磅），载荷换成 `w:shd` 时只落每行第 0 网格列 ⇒ 缺陷不住在「条件层没接」而住在「条件层只有一副落点」，所以读侧两族分两条路走而不是并成一条；
  同一型的两块条件与 basedOn 链上的同型仍是**整块**替换（`q18_dup_type_shd` 两块各说一枚色 ⇒ Word 只落后面那枚 D9E1F2；`q17_chain_cond_types` 祖先的 firstRow 落第 0 行而本体的别的型各落各的）。
  ④ **band/odd/even/wholeTable 连底纹也不落**（`q1_band1HV_A` / `q3_band1HV_C` / `q4_band1HV_D` / `q10_band2V_B` / `p10_evenRow` / `p11_wholeTable` / `p12_band1H` 七臂 Word 九枚格全 `000000/0` 而 ours 同一趟全空
  ⇒ 空集对空集同样是通过）；`p20_fill_auto` 那一臂两头也全空，「基座说了 fill=auto」与「基座什么都没说」在 Word 眼里是同一件事。⑤ **样式身份：被引用才算一层，而 `TableNormal` 会被换掉**——
  自造 id 而带 `w:default="1"` 的样式被表引用时 Word 会落（底纹 `r1_def_referenced` 九枚全落 D9D9D9；同一档在边距那头 `v1_def_referenced_mar` 240 缇 = 16px 照落），没人引用时两头都不落
  （`q19_default_tcpr` / `r2_def_unreferenced` / `v2_def_unreferenced_mar` 全空）；而往内建 `TableNormal` 身上写的数从不落地：`q21_default_referenced` 写 D9D9D9 而 Word 九枚格全读回无底色、
  `word_style=????`，`u6_normal_substitution` 写 400 缇边距而 Word 读回 5.4 磅 = 7.2px ⇒ 门从「isDefault」换成「这张 id 会被 Word 换上自带定义」。⑥ **图案那一半 CSS 里没档位**——
  `p19_pct50` 的 `@w:val="pct50"` 在 Word 那头是 FF0000 配 Texture 500（`word_tex=-` 之外另读 500），我们只把 fill 当纯色读并如实记一句（同一趟 `×9`；同一枚住在逐格那一层时 `r7_cell_pct50` 只 `×1`，
  门发在该发的那一枚上）。

- **本轮唯一的架构决定**（跟着数据走，缺陷住在读侧那三层之外的一格）：格底纹从此是**三层取一**——逐格 `w:tcPr/w:shd` > 条件层 `w:tblStylePr/w:tcPr/w:shd` > 被引用样式自己的 `w:tcPr/w:shd` 基座，
  五条形状都不是可选的——**比「哪一层在场」而不是比色**（`cellShadingEl(tcPr, cond, base)` 三层各交回元素，逐格那枚 `fill="auto"` 也赢：`q15`/`r4` 两臂就是量出来要弃「按色值取先」的备选解释）；
  条件层的底纹按**位置**走一枚 8 档梯子（角型四枚 > firstRow > lastRow > firstCol > lastCol，行型里首行压末行、列型里末列压首列沿用上一轮边距那头的读数，且每一档都要 `w:tblLook` 的对应位说话，
  角型要那一角的两枚位都开），而**格边距那一族保持按位置-blind**（列型落全表）：两族的落点集合被量出来不同，把它们并成一条就把 `t7` 那一臂读歪；**默认标记换成替换名单**——
  `SUBSTITUTED_TABLE_STYLES` 只吃内建 `TableNormal`，这道门**同时改掉了上一轮边距那一族的 `if (s.isDefault) continue`**（`v1` 那臂证明旧门在过杀：被引用的默认标记样式 Word 真会落）；
  四层都没说的边/色仍不铺数（Word 自带的 0/5.4/0/5.4 磅与无底色都是应用默认而不是文档说了的数）；图案档只读 fill 并记一句，不假装图案活着。换算仍只走那一枚 `PX_TWIP/TWIP_PX`（1px = 15 缇），
  写侧一个字节没动。

- **验证**（离线三头 + 结构/变异腿 + 往返腿，Rust 本轮一个字没动、屏上与纸面本轮没有读数）：结构+变异合并一腿 `RESULT struct pass=19 fail=0 | mutants pass=20 bad=0 []`，
  三模式各跑一遍同一份最终源文（`TRAP=1` 那趟 `TRAP|注释里埋两枚假声明|基线BAD=0 埋后BAD=0|ok`、`REV=1` 那趟 `REVTRAP|真删 S4 锚点|fired=S4|ok`、`P0|正控制 删 nwcell 那一行|fired=S6,S7|ok`，
  `DATA|files=1 judges=19 baseBad=[]`）；S/C/D 三系列分别钉「梯子八档的形状与两处出口」「`SUBSTITUTED_TABLE_STYLES` 一枚列表生两族门」「角型两枚位都开」「三层比在场而不是比色」「patternVal 只挡 clear/none」，
  20 枚变异各响该响的那条（含「三层退回按色值取先」「角型只开一枚位」「把底纹也写成按位置-blind 的边距那条路」「默认标记的门改回 isDefault」「auto 不当说了话」）；
  三方判据腿 `RESULT|arms=69|files=6 MINE|69` 六批 `pass=20 diff=0 / 21 diff=1 / 8 diff=0 / 9 diff=0 / 5 diff=2 / 3 diff=0` ⇒ 现场加总 **pass=66 diff=3 miss=0**，逐格颜色
  `ours_missing=0`、`both_real_same=169`、`both_none=451`、`real_diff=0`、`ours_extra=0`、`count_diff=0`；**改前的同一把尺在同一批夹具上** `pass=36 diff=33 miss=0`（`ours_missing=165`、`both_real_same=4`）
  ⇒ 缺色从 165 枚降到 0 枚是被同一趟量出来的，而残余的 3 枚 diff **全在边距那一族（`lp`）而不是底纹**：`q21_default_referenced` 与 `u6_normal_substitution`（Word 换上自带默认，两头都不铺是判据里的 gap 而非缺陷）、
  `u4_corner_margins`（角型那块的格边距本轮没接，Word 三枚 40.0px 而 ours 全空——已开进路线图）；往返腿三批 `RESULT|arms=20 same=20 drift=0 no_table=0` / `30 same=30` / `19 same=19` ⇒ 69 臂 `same=69`；
  独立字节腿 `RESULT|rt_bytes pass=69 fail=0 miss=0` 并当场量出塌缩那格 `COLLAPSE|arms=29 src_cells=6 exp_cells=169`（样式与条件的色落盘时全部重住逐格 `w:shd`）；`pnpm exec tsc --noEmit` exit 0；
  **没有 dev 真机腿与纸面腿**（dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签，破坏性故不跑 ⇒ 底纹三层在屏上和纸上没有读数），**没有 release A/B**。

- **本轮撞到五处量具坑，都不是产品**：① B0 探针不许用「含中文且无引号」当注释判据（这一族源文里住着 `/^标题\s*/` 那一枚正则——中文而无引号，剥完仍算「裸中文行」而把整腿假红；
  现场读数 `B0d|剥后裸中文行=1|const m = /^heading ([1-9])$/.exec(n) ?? /^标题\s*` 就是那枚正则本体，改成按注释标记判而 `B0z` 断字面量/正则/除号三件活着）；
  ② 注释陷阱必须把假声明埋进 **raw** 源再走剥注释器（在已剥净的文本上注入再重剥＝恒假阴），且要双向断言「埋后判据数不变而变异计数不得变」；③ 判据要吃**函数体**而不是签名
  （`condShadingFor` 起初被数成锚点，而八档梯子住在函数体里 ⇒ 改坏梯子判据一个字不动，那是假绿发生器）；④ 日志名必须与判据取数的那把尺同形（本轮 `fin_L*.log` / `sum_L*.log` / `new_docx*.log` 三套命名，
  按一套取并集就漏批）；⑤ **报数前现场加总**——本轮把「改前」读数手抄成 `pass=37 diff=32`，靠逐批 grep `RESULT|ours_vs_word` 那行才发现真数是 `pass=36 diff=33`（11+16+2+6+0+1 / 9+6+6+3+7+2）；
  另记一处工作树形状：`git apply --cached` 在 `core.autocrlf` 与 `index <pre-image>` 双重检查下对这份混合文件必失败（"error: patch failed / Files differ"），出账只能走「HEAD 原文 + 只我那 26 枚 hunk」
  重建 blob（逐枚 assert a-side 行全等、自底向上套）再 `git hash-object -w` + `git update-index --cacheinfo`；而并发会话的工作树 README 此刻**不含上一节的第四笔账与第五笔账**（工作树 `grep -c tblLook README.md` = 0 而
  HEAD 里两节都在），故本节以 `git show HEAD:README.md` 为底落 blob，不去动他们那一份。

- **本轮没动的量出来记着**（已开进路线图）：**图案 Texture 那一半**（`p19_pct50` 只读 fill，屏/纸/字节三头都没承载）；**条件块的 `w:tblPr/w:tblCellMar` 那一格**仍不接（Word 照样落）；
  **band/odd/even 各型的字体那一档**没量（本轮只把底纹那半结掉）；**角型的格边距**没铺（`u4` 三枚 diff 就是它）；**写侧没有样式层与条件层的底纹出口** ⇒ 落盘塌成逐格 `w:shd`（`COLLAPSE|arms=29 src_cells=6 exp_cells=169`）；
  `TableNormal` 身上 Word 自带的那套默认既不读也不再发上一轮那句告警；`w:shd` 在 ODT 两头的表格里仍没有通道（段落那一头 v0.39 早接了）；`w:tblLayout` 仍不读、cell-clash 那一格两头次序不同仍无第三方判据、
  exact 行高只一枚告警、Word 自带的 0/5.4/0/5.4 磅仍不铺（前几节原样）；屏上/纸面本轮没有读数；「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 架构两处就地改口（「覆盖」那条把「`w:default="1"` 的默认表样式不算这一层」换成「按引用与内建替换判定」并补上格底纹三层与两族作用域不同；文件清单 `lib/docx-fidelity.ts`
  条目补 `SUBSTITUTED_TABLE_STYLES` 与那枚 8 档梯子）+ 路线图把「oddRow/band/wholeTable 各型的其余载荷没接」按底纹半勾结掉、把「条件块里只接了 `w:tcPr/w:tcMar` 那一格」改口成「两样载荷已接、剩 `w:tblPr` 那一格」、
  把「`w:default="1"` 表样式上的条件层只发告警不铺」换成「只剩 `TableNormal` 被替换而它自带的那套不铺，告警随门一起删掉」，并新开图案 Texture / 角型边距 / 底纹往返无样式出口 / 无 dev 与纸面腿 / 不占版本号五枚；
  **版本文件不入本提交**（0.98.0 住着并发轮次的对齐号，本轮不与之抢那三处）；`tmp/xshd` 的 69 枚夹具、三头前置实测腿、两批判据腿、结构+变异腿、往返腿与独立字节腿按惯例删除；
  **dev 树全程未碰**（它属于另一会话）


## 条件块里的第二格与角型的整行：slot 那一格归样式那层、角型按其所在那一行落，而两族的梯子是反的

按「不扩格式、把现有格式做深」的路线图开工，本轮取上一节明写的两枚未勾项——「**条件块的 `w:tblPr/w:tblCellMar` 那一格**仍不接（Word 照样落）」，
以及「**角型的格边距**没铺（`u4` 三枚 diff 就是它）」。窄口径：`src/lib/docx-fidelity.ts` +63 / −19（8 枚 hunk，全部住在读手），
Rust 一个字没动、写侧一寸没碰、模型属性一枚都不新增（`pad*` 四条边与 `rowHeight` 那五条通道沿用第五、六笔账立起来的形状）。**本轮不占版本号**：
`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar7`，46 枚自造夹具分四批 5 + 11 + 19 + 11（标定与控制 / 条件块的 slot 那一格 / 角型边距 / 两格撞车与闸门），三头同一趟：自家读手 + Word 16.0 只读 COM + 独立字节腿，
  互不吃对方的读手；这一轮另立一枚**新的第三方头**：格子的竖直位置尺 `Cell.Range.Information(6)`，因为 COM 那枚 `Cell.*Padding` 在样式层与条件层说的边距上给不出标量）。每枚臂仍是一份最小 docx，
  数一律摆成互不相同的档（样式基座 108 缇 = 7.2px、条件层或 slot 600 缇 = 40px、另一档 300 缇 = 20px、900 缇 = 60px、逐格 120/60 缇 = 8/4px），这样任一枚格的任一条边走回来都能认出它是哪一层说的。
  量出来六格：① **上一节那句「Word 不落」被推翻**——条件块里 `w:tblPr/w:tblCellMar` 那一格真落，且吃同一枚 `w:tblLook` 闸门：`sa_slot_top_only`（firstRow=1）第 0 行两枚格各往下位移 +39.67 磅，
  而 `sa_slot_fr_off`（同一份声明只把闸门关掉）位移 0.00，`sa_slot_top_gate_off` 同判；四边都声明那一臂（`sa_slot_all_edges`）的 top300 走竖直尺读 +19.60（ours +20.00）。
  ② **它归的是样式那一层而不是条件那一层**——`sc_slot_top_vs_tbl`（slot 说 top600 而表自身说 108）与 `sc_tbl_top_only` 位移差 0.00 ⇒ 表自身压过 slot；`sc_slot_top_vs_stylebase`（slot 600 而样式基座 108）
  位移 +32.87 磅（ours +32.80）⇒ slot 压过样式基座。可它又按**型别作用域**落（firstRow 那一块只落第 0 行）而不是整层铺一遍，所以读侧在条件块里逐格现取而不是塞进那枚不分位置的 `styleCellMargins`——
  **层的归属与落点的取法在这一格上不是一条线**（`sc_slot_top_nw_all_on` 与 `sb_nw_all_on` 逐枚同账：同一份 top600 写在 slot 与写在 `w:tcPr` 落点集合相同）。③ **同一块里两格都说同一枚边时 `w:tcPr` 那一格盖 `w:tblPr` 那一格**——
  `sc_slot_top_vs_tcpr` 同一块 tblPr 说 top600 而 tcPr 说 top300，尺读 −20.07 磅（ours −20.00）＝落在 300 那一档，比只说 600 的 `sa_slot_top_only` 低 15.05 磅。④ **`wholeTable` 换哪一格写都不落**——
  `sa_slot_wholeTable` 左右仍是 Word 自带的 108 缇、`sc_slot_top_whole` 位移 0.00（这一臂就是判据里那 4 枚 7.2px 缺口的全部来源）。⑤ **角型在边距这一族按整行落而不按那一角**——`sb_nw_all_on` 的 left 落在第 0 行
  三枚格各 40px（600 缇 = 30 磅）而第 1、2 行九枚里全空，ne 落首行的右边距、sw/se 落末行整行（`sb_ne_all_on` / `sb_sw_all_on` / `sb_se_all_on`），四边齐说那一臂那一行四边都有（`sb_nw_all_four` 40/20/8/4 ×3）；
  闸门要那一角的**两枚位都开**（`sb_nw_fr_only` 缺 firstColumn、`sb_nw_fc_only` 缺 firstRow，两臂九枚全空）；尊卑按**型别**而不按声明次序（nw 与 firstRow 各说 600/300 缇，正反两序 `sb_nw_vs_firstRow` /
  `sb_firstrow_then_nw` 都落 firstRow 那档 20px；nw 与 firstCol 各说 600/900，两序都落第 0 行 40px、其余行 60px；`sb_nw_declared_last` 把 nw 写在最末仍一次没赢）⇒ 边距的梯子自低向高是 **列型 > 角型 > 末行 > 首行**；
  逐格 `w:tcMar` 照旧压它（`sb_nw_cell_wins` 第 0 格 7.2 而同一行另两枚 40）、0 仍是真值（`sb_nw_zero` 三枚 0）、1×1 表那一枚格同时是四角（`sb_nw_1x1` 40px）；而**底纹那一族的梯子是反的**
  （上一节量到：角型压一切且只落那一角那一格）⇒ 同一型在两族里的落点集合与尊卑序都不同，两族不并成一条梯子。⑥ **COM 那头的账外另立计数**——样式层与条件层说的边距 `Cell.*Padding` 返回 −1，
  本轮 57 枚计入账外而不是不等（按臂分布 `sa_slot_all_edges` 16 / `sa_slot_nwCell` 9 / `sc_slot_top_nw_all_on` 9 / `sc_slot_top_vs_stylebase` 4 / `sa_slot_top_only` 4 / 其余五臂共 15），
  于是竖直位置尺才是这一族的第三方头，10 对全过（含 `s0_cal_top600`↔`s0_cal_top0` 那一对标定：逐格 600 缇该位移 30 磅而尺读 39.67px，标定偏差 −0.25 磅 ⇒ 这一把尺容差 1.5px，与逐边判据那把 0.34px 的不是同一把）。

- **本轮唯一的架构决定**（跟着数据走，缺陷住在「条件层只有一格」与「角型只有一副落点」两处）：条件块从此**按两格分开记账**——`CondCell = {mar, tblMar, shd}`（`w:tcPr` 那格交回 `mar` 与 `shd`、
  `w:tblPr/w:tblCellMar` 那格交回 `tblMar`），空块门跟着吃三枚载荷（`Object.keys(mar).length || Object.keys(tblMar).length || shd`：只说 slot 的块此前被当空块丢掉，那是「名义在场而实际不落地」的形状）；
  `condMarginsFor(look, conds, ri, isLastRow, key)` 一枚函数吃两层，key 的两档字面量写在签名上，落点唯一权威是 `condMarginLadder` 那八枚 push（定义一枚、调用一枚，不复刻梯子）；
  五层折叠的形状落死为**样式基座（沿 `w:basedOn`）→ slot（归样式层）→ 表自身 `w:tblCellMar` → 条件层 `w:tcPr/w:tcMar` → 逐格 `w:tcMar`**，五枚 spread 的次序就是 `sa_slot_vs_stylebase` / `sa_slot_vs_tbl` /
  `sa_slot_vs_cell` 三臂两两量出来的三段关系；两族的梯子保持**反着**（边距 `行型 > 角型 > 列型`、角型按其所在那一整行；底纹 `角型 > 行型 > 列型`、角型只落那一角那一格，且底纹一枚都不吃边距那两格的账）；
  `w:val` 那位十六进制仍只在闸门那枚函数里读一次而梯子不吃它；没说的边仍不铺数（本轮 140 枚缺口是 Word 自带的 0，把应用默认铺进账里就是把别人的默认写成用户的声明）；
  两档没有实测的形状**写在注释里记着而不是顺手编一条**：同一行里两枚角型说同一枚边（本序按后入的 necell 取，这批夹具没有这一臂）、`w:tblLook` 的 `w:val` 与位属性打架时以位属性为准（第五笔账 `k5_attr_beats_val` /
  `k6_val_beats_attr` 的读数，本轮不复测）。换算仍只走那一枚 `PX_TWIP/TWIP_PX`（1px = 15 缇），写侧与模型一个字节、一枚属性都没动。

- **验证**（离线三头 + 结构/变异腿 + 往返腿，Rust 本轮一个字没动、屏上与纸面本轮没有读数）：结构+变异合并一腿 `RESULT|struct pass=32 fail=0 mutants pass=23 bad=0`，
  吃的是**提交件**（`DATA|files=1 judges=25 b0=7 提交件行数=1923 剥后 ladder.push=16`——把 HEAD 那份 docx-fidelity.ts 只套本轮 8 枚 hunk 重建出的 blob，`BASE|bad=[]`；`剥后 ladder.push=16` 是两族各八枚的合计），
  B1~B7 是剥注释器自检（注释里的臂名与中文说法剥后全部消失、代码锚点仍在、无残留标记、模板字面量与正则字面量不开假态、保行号、同一枚锚点在原文出现 6 次而剥后 1 次）；
  S 系列钉「五枚 spread 的次序」「slot 归样式层的说法写在文档里而代码按型别逐格取」「梯子八枚自低向高且边距不看列位」「四枚角型各要两枚位都开」「两族梯子相反」「空块门吃三枚载荷」「本轮只在读侧」，
  23 枚变异各响该响的那条，含 M2「slot 整条丢弃＝本轮不做了」响 S1,S2,S25、M10「边距梯子按列位落」响 S6,S24、M17「wholeTable 进梯」响 S4,S16、M18「两族梯子被统一（底纹改成边距序）」响 S17、
  M21「闸门改吃 `w:val` 那位数」响 S21、M22「本轮越界往模型写 pad*」响 S20、M23「注释陷阱：把被推翻的那句写回注释而代码一字不动」响 S10,S11（改口由这两枚成对钉：旧句在原文里消失、新证据句在原文里在场）；
  **同一把尺在改前的那份源文上** `RESULT|arms=46 参与判定的边=264 等=75 不等=9 缺口=180 默认=771 账外=57 声明打架=0`，9 枚不等全在三臂（`sb_firstcol_then_nw` / `sb_nw_tbl_wins` / `sb_nw_vs_firstCol`）的第 0 行三枚格 left，
  ours 分别 60、7.2、60 而 Word 三臂都是 40.0 ⇒ 不等从 9 降到 0 是同一批夹具同一趟量出来的（把结构腿喂同一份改前源文时 `BASE|bad=['S1','S9','S22']`，判据确实认得出这一层没接）；
  改后三方判据腿 `RESULT|arms=46 参与判定的边=264 等=120 不等=0 缺口=144 默认=771 账外=57 声明打架=0`，同一趟的独立字节头 `BYTES|arms=46 层边声明=321 与夹具生成器打架=0`、竖直尺 `RULER|pass=10 fail=0`；
  缺口 144 枚在同一份日志里现场拆账 `按 Word 读数={'0': 140, '7.2': 4}`：4 枚 7.2 全在 `sa_slot_wholeTable`（该臂声明集只有 wholeTable 那一格而它什么都不落）、140 枚 0 是 Word 在「声明在场而那一型不落」的边上的自带读数
  ⇒ **设计上的沉默而不是缺陷**；往返腿 `RESULT|rt arms=46 fail=0`：`EDGES|等=149 不等=0 原沉默后说话=0 原说话后沉默=0`（说话过的边一条不丢、也没凭空多一条）+ `BG|等=273 不等=0`（273 枚格的颜色原样回来）+
  `MAP|padding 简写出现=0`（每条只写自己那一边，与 `cell-style.ts` 的 `mergeAttributes` 形状同形）；层的形状落盘必换档：46 臂里 **41 臂换档**（不换的正是 5 臂只说逐格的标定件），夹具的样式基座 20 枚 + 条件块 50 枚 +
  表级 4 枚在导出件里恒为 0 而逐格 `w:tcMar` 从 9 枚涨到 131 枚（写侧没有样式层与条件层的边距出口）；本轮夹具不声明 `w:trHeight` ⇒ 行高通道这一趟没测（`ROW|两头都无行高=109`）；`pnpm exec tsc --noEmit` exit 0；
  **没有 dev 真机腿与纸面腿**（dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签，破坏性故不跑；Word 导出 PDF 那一头本轮只出得来 `IDENT|wordpdf-b1` 一行、整趟挂住 ⇒ 连第三方纸面读数都给不出），**没有 release A/B**。

- **本轮撞到五处量具坑，都不是产品**：① 提交件重建里 difflib 的**纯插入 opcode 给出空 a-side 锚点**（本轮 8 枚 hunk 有 3 枚是纯插入），照锚点自底向上套会把插入静默套到文件末尾 ⇒ 改成按上下文锚定分组（HL=6）、
  逐枚 assert 那段 a-side 行在 HEAD 与在工作树里都全等且唯一；② 判据起初数 `condMarginsFor` 的**签名**而不是它的两处调用与函数体 ⇒ 把 slot 那一格接丢掉判据一个字不动（假绿发生器），改成数「两处调用各吃一枚不同 key 字面量」
  与「ladder.push 恰八枚」；③ 独立字节腿里条件块也带一枚 `<w:tblPr>`，`edges_of(styleBlock, 'tblCellMar')` 一漂进去就把 slot 那一格计成表级 ⇒ 声明集逐臂与夹具生成器对账（`与夹具生成器打架=0` 就是这一枚门）；
  ④ Word 的 `Cell.Information(5)` 在这批表上什么都读不出而 `(6)` 读得到（基线 72.65），`Cell.*Padding` 对样式层与条件层说的边一律 −1 ⇒ 第三方头得另立一把尺，且这把尺的容差（1.5px）不能拿来当逐边判据（0.34px）用；
  ⑤ **缺口桶不等于缺陷桶**——「参与判定的边」按臂计数（arm-level declared）而落点按格作用域，`缺口=144` 里 140 枚是 Word 的 0 默认、4 枚是 `wholeTable` 的设计沉默，
  现场从同一份日志拆出来才敢写「不等=0」；另记一处脚本自改的坑：就地补一行 `POST = os.environ.get(...)` 时 assert 的锚点必须是那一枚文件里真实的那行（`import os, re` 而不是 `import os`），
  否则 python 抛 AssertionError 而 legs 全部照旧跑旧版标签。

- **本轮没动的量出来记着**（已开进路线图）：**写侧仍没有样式层与条件层的边距出口** ⇒ 落盘 41/46 臂换档、逐格 `w:tcMar` 从 9 枚涨到 131 枚（第三方件重存一趟之后原声明不再活着）；
  **同一行两枚角型说同一枚边**没量（本序按后入的 necell 取）；**slot 那一格只验了竖直方向**——水平边（left/right）在 COM 那头给不出标量，只有 top 能用位置尺第三方交叉；
  `w:rPr` / `w:pPr` 两格载荷仍只当过探针；**本轮夹具没有 `w:trHeight`** ⇒ 行高通道这一趟没有往返读数；往返腿的 HTML→ProseMirror JSON 那一半是**按 `cell-style.ts` 三处属性映射写的镜像适配器**而不是浏览器 DOMParser
  （用 `MAP|padding 简写出现=0` 担保它没绕过逐边形状，但它不是真浏览器解析）；图案 Texture、`w:tblLayout`、Word 文档级默认格边距、cell-clash 次序、`pad*`/`rowHeight` 在 ODT 两头、exact 行高的裁剪、
  Word 自带的 0/5.4/0/5.4 磅仍照前几节挂着；屏上/纸面本轮没有读数；「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 架构两处就地改口（「覆盖」那条把格边距从「四层逐边合并、只有 firstRow/lastRow/firstColumn/lastColumn 四型落地」改口成**五层**并补上 slot 那一格归样式层、角型按整行且要两枚位都开、
  两族梯子相反；文件清单 `lib/docx-fidelity.ts` 条目补 `CondCell` 两格分开记账与那枚边距专用的 `condMarginLadder`）+ 路线图勾掉「条件块里那格的载荷只接了 `w:tcMar` 与 `w:shd` 两样」的边距半与「角型只铺了底纹，没铺它的格边距」两枚、
  把「样式层读进来的数在写侧没有出口」补上本轮的 `41/46 臂换档 / 逐格 9→131 枚`，并新开 slot 只验竖直 / 同行两角同边未量 / 本轮夹具无 trHeight / 往返腿用镜像映射 / 无 dev 与纸面腿 / 不占版本号六枚；
  **版本文件不入本提交**（0.98.0 住着并发轮次的对齐号，本轮不与之抢那三处）；`tmp/xmar7` 的 46 枚夹具、四批前置实测腿、三批判据腿（含竖直位置尺）、结构+变异腿与往返腿按惯例删除；
  并发会话的工作树 README 此刻仍不含第四、五、六笔账三节 ⇒ 本节以 `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**（它属于另一会话）


## 表级那一层的 `w:tblW` 第一次上账：整盘宽度账都没说时它才说话，而 pct 的口径是五十分之一百分点

按「不扩格式、把现有格式做深」的路线图开工，本轮取挂着的那枚「读侧只吃 `w:gridCol`」的同族另一格——表级 `w:tblW` 在读侧一直没有位置。
窄口径：`src/lib/docx-fidelity.ts` +62（6 处整块唯一替换，全部住在读手），Rust 一个字没动、写侧一寸没碰、模型属性一枚都不新增。**本轮不占版本号**：
`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar8`，19 枚自造夹具，三头同一趟：自家读手 + Word 16.0 只读 COM + 独立字节腿，互不吃对方的读手；另立往返腿 = 读手给出的行 0 那盘账喂回写侧再看字节）。
  字节头数到有网格元素 16 / 无网格 3 / 有表宽 14 / 无表宽 5，`w:tblLayout` fixed 11 / autofit 3 / 缺失 5，`@w:type` 三档 auto / dxa / pct 都在；版心两腿各自量到同一枚
  （字节 `sectPr` 9026 缇 = 601.73px，Word `contentPt` 451.3 磅）。量出来四格：① **表宽与网格打架时 Word 跟谁，按「哪一层说了话」而不按声明强弱**——逐格 `w:tcW` 恒压网格
  （`tc_tcw_vs_tblw` Word 落 [133.33,66.67,66.67]px = 逐格 2000/1000/1000 缇原样，ours 跟网格 [80,120,160]）；网格在而只有表宽说话时按 `w:tblLayout` 分流：fixed 按网格比例缩
  （`ta_tblw_big_fixed` 7200 缇 → 106.67/160/213.33 即 8:12:16 摊到 480、`tb_pct50_fixed` 5000 pct → 134.07/201/268），autofit 或缺失按列等分（`ta_tblw_big_none` 三等分 160、`ta_tblw_small_auto` 三等分 80）；
  `w:tblW` 说 `0 dxa` 时 Word 干脆跟网格（`ta_tblw_zero_fixed`、`ta_tblw_eq_fixed` 两头同账）；**没有网格**时一律等分（`tb_pct30_nogrid` 120.67/120.60/120.60、`tc_only_tblw` 100/100/100）；
  而 layout 缺失且只有网格那一臂 Word 按内容重排（`t0_grid_only` 三枚 34.40px），这一档从声明里读不出来。② **pct 那一档的口径是五十分之一百分点**（5000 = 100% 版心）：同一趟把 3000 与 5000
  各按两种口径折——口径 A（按百分之几）180.52 / 300.87px，口径 B（除以 5000）361.04 / 601.73px，Word 读数 361.87 / 603.07px ⇒ `PCT|…命中=B` 三臂全中，A 档差着一整倍。
  ③ **三头各读得到什么标量**：自家读手当时对 19 臂里 17 臂给得出行 0 账，两臂（`tb_pct30_nogrid` / `tc_only_tblw`）整盘无账 ⇒ 交给浏览器自动布局；COM 那头 `Columns.Width` 19 臂全读得到，
  而 `PreferredWidth` 在 12 臂上是 9999999 哨兵（表宽由布局算出来时它不给标量）⇒ 计入账外而不是不等，可读那 7 档（0/60/100/180/225/360 磅）与 `prefType ∈ {1,2,3}` 只说明这一格有三种语义没译。
  ④ **写侧一直在写这两格**（v0.89 起 `w:tblW` 写真表宽、`w:tblLayout fixed`）而 HEAD 的读手两格都不吃 ⇒ 往返一趟 `表宽值` 18 臂换档、`layout` 10 臂换档，且**重读时那两臂的账就丢了**（`RT重读换账的臂数=2`）。

- **本轮唯一的架构决定**（跟着数据走，缺陷住在「整盘无账时不给任何宽度」而不是「表宽没上账」）：表级那一层的 `w:tblW` **只在整盘宽度账都没说时说话**——`gridKnown` 为假（无 `w:gridCol` 或网格全零）
  且行 0 也没有逐格 `w:tcW` 的那些列，才把 `tblWpx(tblPr, this.contentTw)` 折出总宽后按列等分（`each = Math.max(1, Math.round(tblTotal / acct.length))`），出账闸门从 `gridKnown` 换成
  `acctKnown = gridKnown || !!tblTotal`；`auto` / `0` / 没说一律交回 `null`（那本来就是没账），而当时那句「`@w:w` 另吃 `"100%"` 字面（我们的写侧无账时就是这么落的）」是**写了而够不着**
  ——取字面用的 `attr(tblW, 'w')` 只匹配无前缀的 `w=` 键，真件（含自家写侧）落的是带前缀的 `w:w` ⇒ 第十三笔账才把这一档接上，见下面那节；版心宽新立一枚 `contentTwipsOf(body)`
  （body 末尾 `sectPr` 的 `pgSz` 减左右 `pgMar`，说不全就是 0 ⇒ pct 那一档就此没账而不是猜一个）。**`w:tblLayout` 仍不吃**：它的作用点在「网格或 tcW 有账」的那些臂（Word 在那里按 fixed 缩比例、
  按 autofit / 缺失等分），而那 12 枚不等的读数同时是 v0.92 屏上、v0.93 纸面、v0.94 跨页三批基线的锚，动它要先重标三批，本轮不抢这一口。另记一条：**我们的写侧永远写真网格** ⇒ 这一档只在第三方件上触发。

- **验证**（离线三头 + 结构/变异腿 + 往返腿，Rust 本轮没动、屏上与纸面本轮没有读数；五腿全吃**提交件** = `git show HEAD:src/lib/docx-fidelity.ts` 那份 1922 行的基座套 6 处整块唯一替换出 1984 行，
  `md5=49ffe0fa0fc2ff7e9939ff81a6d8f8a1`）：三方判据腿同一趟 `AGG|判定分布={'等': 7, '不等': 12}`、`AGG|自家缺口臂=[]`，两枚原缺口臂现在 `判定=等` 且 `Word命中=表宽等分`
  （120/120/120 ↔ Word 120.67/120.60/120.60、100/100/100 ↔ 100/100/100，容差 1.00px）；**改前同一把尺**（b6 批、HEAD 件读手）`{'等': 5, '不等': 12, '自家缺口': 2}` ⇒ 等从 5 涨到 7 而**不等一枚没动**，
  12 枚不等全在「网格或 tcW 有账」那一档（七臂吃 `w:tblLayout` 分流、四臂是 Word 跟 tcW 而 ours 跟网格、一臂是 Word 按内容重排），本轮设计上不碰；自家读手腿 `行0有账=19|行0无账=0`（改前 17/2）、
  `告警里提到宽或布局的枚数=0`、`表标签带style=1`（仍是 `tc_ind_and_w` 那一臂的 `margin-left: 48px; width: calc(100% - 48px)`）；往返腿 `RT重读换账的臂数=0`（改前 2）、`表级六项全不换的臂数=1`、
  换臂计数 `{表宽值:17, 表宽type:9, layout:8, 网格枚数:4, 网格合计:5, ind:1}`（改前 `{18,9,10,4,5,1}` ⇒ 读手吃表宽之后 `表宽值` 与 `layout` 各少换一档），版心 `RT=[9026]` 与原同；
  结构+变异腿 `VERDICT|红=0`（23 枚 CLAIM 全绿：B0 自检三枚、注释陷阱正七枚 / 反两枚、`闸门=acctKnown`、两枚正控制 + 越界防线 `tb_pct50_fixed` 仍 `[80,120,160]`、无回归 17 枚有账臂逐格不换形且告警差 0、
  变异 A/B/C 各响该响的那条：A「表宽那格完全不吃」两臂回缺口、B「pct 折成百分之几」那一臂减半成 `[60,60,60]`、C「表宽压过网格」让 10 枚有账臂换形）；`pnpm exec tsc --noEmit` 只报 `src/lib/__mut8a.ts` 两行 TS6133
  （变异 A 故意拿掉 `contentTw` / `tblWpx` 的唯一使用处），产品件与提交件零错。

- **本轮撞到五处量具坑，都不是产品**：① **剥注释器把模板字面量的 `${}` 当注释吃掉**、且不认正则字面量 ⇒ 两处判据（`num / 5000`、`type === 'auto'`）在剥后消失给出**假红**；改成 `tpl` / `expr` 栈 + 正则起始判定，
  要 `残注释标记=0` 与两枚反陷阱（`五十分之一百分点`、`重标屏上与纸面三批基线` 剥后 0 枚）同时翻绿才算修好；② **提交件补一句文件头改口 ⇒ 已跑过的腿全部过期**：探针与三支变异件必须按新 blob 重装重生，
  发现这一点的读数就是 `B0|提交件行数` 从 1980 变 1984；③ merge 腿对 ours 日志按 `tag + "-" + batch` 子串断言 IDENT，把读手腿改名 `ours8b` 之后得把 tag 传进 `load_batch`，否则新腿被无声拒吃而聚合照旧出数；
  ④ Word 那条 COM 腿的 `.ps1` 里残留一枚中文键名（`AGG|ColumnsNA臂数`），PS 5.1 按 ANSI 解码 `-File` ⇒ 落盘成 mojibake（`鑷傛暟`），脚本体得真 ASCII-only；
  ⑤ 往返腿的 `meta.page` 必须与夹具同版心（A4 + 四边 1440 缇）：写侧默认左右边距是 22mm，不传 meta 会让「无账 ⇒ 版心等分」那一档混进第二枚变量（200px 变 209px）。

- **本轮没动的量出来记着**（已开进路线图）：**`w:tblLayout` 的分流仍不吃** ⇒ 12 枚不等里那七臂（`ta_tblw_big_fixed` / `ta_tblw_big_none` / `ta_tblw_small_auto` / `ta_tblw_small_fixed` / `tb_pct50_auto` / `tb_pct50_fixed` / `tc_ind_and_w`）留在原处；
  **Word 在网格与 tcW 打架时跟 tcW 而 ours 跟网格**（四臂 `tc_tcw_vs_tblw` / `tb_auto_with_tcw` / `tc_autofit_tcw` / `tc_span_tcw`），这是 v0.97 就选下的 grid-first，本轮只补齐读数没改次序；
  **`prefType` 三档语义没译**、`PreferredWidth` 在 12 臂上是哨兵；**layout 缺失且只有网格时 Word 按内容重排**（`t0_grid_only`）不可从声明预言 ⇒ 判据只能标 `Word命中=无`；
  **写侧把表宽一律写成 `dxa` 真值** ⇒ 第三方件重存一趟之后 pct 声明塌成 dxa（往返腿 `表宽type` 9 臂换档就是它）；图案 Texture、Word 文档级默认格边距、cell-clash 次序、`pad*` / `rowHeight` 在 ODT 两头、
  exact 行高的裁剪、`w:rPr` / `w:pPr` 条件块载荷、角型同行同边、slot 水平边仍照前几节挂着；屏上 / 纸面本轮没有读数；「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 架构两处就地改口（「覆盖」那条把表级 `w:tblW` 从「不吃」改口成「整盘账都没说时按列等分、pct 按五十分之一百分点折版心，`w:tblLayout` 仍不吃」；文件清单 `lib/docx-fidelity.ts` 条目补
  `tblWpx` / `contentTwipsOf` 两枚助手与那道 `acctKnown` 闸门）+ 路线图把「表宽那一格在读侧没有位置」勾掉、给 `w:tblLayout` 与 tcW-vs-grid 两枚挂着项补上本轮量到的落点，并新开 tcW 四臂不等 / 内容重排那档 / `prefType` 未译 /
  写侧无 pct 出口 / 无 dev 与纸面腿 / 不占版本号六枚；**版本文件不入本提交**（0.98.0 住着并发轮次的对齐号）；`tmp/xmar8` 的 19 枚夹具、三批判据腿、往返腿与结构+变异腿按惯例删除；
  并发会话的工作树 README 此刻仍不含第四~八笔账这几节 ⇒ 本节以 `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**（它属于另一会话）。

## 逐格 `w:tcW` 第一次上到网格之上：单列格连缩小都盖过 `w:gridCol`，而跨列格只有正差上账、落点是这一跨的最后一条

按「不扩格式、把现有格式做深」的路线图开工，本轮取挂着的那枚「tcW 与 gridCol 打架时两头次序不同」——v0.97 量出了形状、第八笔账把读数补齐而次序未改，
这一轮把次序改过来。窄口径：`src/lib/docx-fidelity.ts` 改动 41 行（净 +13，2 处整块唯一替换，全部住在读手），Rust 一个字没动、写侧一寸没碰、模型属性一枚都不新增。
**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar9`，26 枚自造夹具 + 4 枚只量形状的形状臂，三头同一趟：自家读手 + Word 16.0 只读 COM + 独立字节腿，互不吃对方的读手；另立往返腿，一条链吃提交件、
  一条链吃改前的 HEAD 件）。字节头数到 26 臂全带 `w:tblGrid`，`w:tblLayout` fixed 14 / autofit 6 / 缺失 6，`w:tblW` dxa 6 / pct 4 / 没说 16，行 0 带逐格 `w:tcW` 的 16 臂、
  不带的 10 臂，含跨列格的 6 臂；Word 腿 `arms=26 errArms=0`（`Columns.Width` 26 臂全读得到），`PreferredWidth` 在 15 臂上是 9999999 哨兵。量出来四格：
  ① **单列格的 tcW 压过网格，缩小也压，且与 layout 三档无关**——`c_clash_uniform` 三臂（tcW 各 1500 缇而网格 1200/1800/2400）Word 三档都落 75|75|75 磅、
  `c_clash_sum_under`（tcW 600/900/1200 = 网格的一半）落 30|45|60、`c_clash_sum_eq`（tcW 900/2700/1800，合计恰等网格之和）落 45|135|90 ⇒ grid-first 是错的那一头；
  ② **跨列格的 tcW 是这一跨的总账**：比所跨网格之和宽的那截才上账、且落在这一跨的**最后一条**网格列（`f_span` 行 0 = [3600,2400] 跨 2,1 而网格 1200/1800/2400 ⇒
  Word 第二行 60|120|120 = 正差 600 缇记在第 1 列上），比网格窄的那截 Word 直接不要（`i_span_under` 行 0 tcW=[2400,2400] 而所跨之和 3000 ⇒ 仍是网格 60|90|120，
  那一格自己量出来 150 磅 = 网格之和）⇒ 加与撤两向不对称；③ **表级精确宽压过逐格 tcW，而压过来之后怎么分列要看 layout**（`d_clash_tblw_pct30_fixed` 表宽 1500/pct、
  逐格各 1500 缇 ⇒ Word 45.2/45.25/45.25 而不是 tcW 的 75；`e_tblw_dxa4500_fixed` 只有网格与表宽 ⇒ 50.1/75/99.9 = 按网格比例缩，同件 autofit 与缺失两档 ⇒ 75|75|75 = 等分）；
  ④ **非首行的 tcW 只扩不缩**（`m_tcw_row1_only_fixed` 行 0 无 tcW 而行 1 = [1500,1500,900] ⇒ Word 75|90|120 = 逐列取各行 tcW 与网格的最大值）。另有一档从声明里读不出来的：
  `b_grid_autofit` / `b_grid_nolayout` 里 Word 三枚 5.8 磅（按内容重排），这一档本轮仍不进账。

- **本轮唯一的架构决定**（跟着数据走，缺陷住在「行 0 那一层的次序」而不是「跨列格没摊平」）：列账改成 **tcW-first**——先按 `w:gridCol` 立底，再让行 0 每格的
  `tcWpx` 覆盖它：单列格 `acct[span[0]] = total` 直接盖；跨列格先收出它跨的网格列集合，集合里有缺账的列就走 v0.97 那一档（减掉已知列、正差摊给缺账的列），
  集合全已知时 `total > known` 才把正差加到**最后一条**、`total <= known` 整格跳过（负差不做）。**三道门都不动**：出账闸门仍是 `acctKnown = gridKnown || !!tblTotal`、
  发射门仍是 `ri === 0 && acctKnown` 配 `.filter((v) => v > 0)`、表级 `w:tblW` 仍只在 `!gridKnown` 时说话；`w:tblLayout` 仍不吃。两处**已知不如 Word** 的账（③ 表级精确宽压 tcW
  + layout 分流两道门、④ 非首行 tcW 只扩不缩）按实测原样写进源文注释而本轮不开门——开③要连 layout 一起开，否则手上 18 枚等臂里的 grid/tcW 那几臂会被表宽带下水。

- **验证**（离线三头 + 结构/变异腿 + 往返腿，Rust 本轮没动、屏上与纸面本轮没有读数；五腿全吃**提交件** = `git show HEAD:src/lib/docx-fidelity.ts` 那份 1984 行的基座套
  2 处整块唯一替换出 1997 行（`wc -l`；mut9 腿自己打印的 `B0|提交件行数=1998` 是它的 split 计数，末尾多数一枚空行），`md5=cf99325c33779794d460b52f0c780841`）：
  三方判据腿同一趟 `AGG|判定分布(松1.0磅)={"不等": 6, "等": 18, "账外": 2}`、`判定分布(严0.15磅)={"不等": 4, "等": 17, "账外": 5}`，
  **改前同一把尺**（b3 批、HEAD 件读手、同一批 26 枚夹具）是 `{"不等": 18, "等": 6, "账外": 2}` / 严 `{"不等": 16, "等": 5, "账外": 5}` ⇒ **等从 6 涨到 18、12 枚不等翻成等**
  （六枚 `c_clash_*`、`d_clash_tblw_autofit` / `_fixed`、三枚 `f_span_*`、`j_partial_tcw_fixed`），且**没有一枚原本相等的臂翻成不等**。剩下 6 枚不等按 Word 那头的账源分：
  5 枚是「表级精确宽压过来 + layout 分流」那一档（`d_clash_tblw_pct30_fixed` 差 29.8 磅、`e_tblw_dxa4500_autofit` 45.0、`e_tblw_dxa4500_fixed` 20.1、`e_tblw_pct60_autofit`
  与 `_nolayout` 各 30.5），1 枚是非首行 tcW（`m_tcw_row1_only_fixed` 15.0）；2 枚账外是 `b_grid_autofit` / `b_grid_nolayout`（Word 5.8 磅的内容重排，读不出来）。
  账源分布（松档）`{"grid": 6, "max_grid_tcW": 1, "row0.tcW+last": 12, "tblw_equal": 6, "tblw_scale_grid": 4, "无一份声明说得通": 2}`；松严两档判定不同处只在
  `e_tblw_pct60_autofit` / `_fixed` / `_nolayout` 三臂；版心那一枚是字节腿数出来再穿到 merge 腿的（`AGG|… 版心=9026.0 缇`）。自家读手腿
  `行0有账=26|缺口臂=无`、字节腿 `臂数=26 网格与夹具生成器打架=0`；往返腿两条链各 30 臂：`换账臂=[无] 无账臂=[无] 形状不合臂=[无]`、`幂等不合=0`、两枚正控制 `g_our_writer_shape=合` /
  `h_our_writer_span=合`（写侧有账时 `tcW == 所跨网格之和` 那条构造恒等式在跨列表头上也成立），换臂计数 new `{表宽值:26, 表宽type:24, layout:16, 网格合计:15, 网格枚数:2}`
  对同一趟 head `{表宽值:28, 表宽type:24, layout:16, 网格合计:4, 网格枚数:2}` ⇒ 读侧改吃 tcW 之后往返把网格写成 tcW 那一盘账（`网格合计` 换档从 4 臂涨到 15 臂）而
  `表宽值` 少换 2 臂，`改前后我账不同的臂数=14`；代表读数 `c_clash_uniform_fixed` 我账 new [100,100,100]px（= tcW 1500 缇）而 head 仍 [80,120,160]、
  `f_span_fixed` new [80,160,160] ⇒ 写回网格 [1200,2400,2400]（正是 Word 第二行 60|120|120 磅那一档）、`j_partial_tcw_fixed` [100,120,160]、`l_grid_half_tcw` new [100,60,120]
  而 head [80,60,160]、`i_span_under_fixed` 两链都 [80,120,160]（负差不上账，与 Word 的网格档一致）。结构+变异腿 `B0|三形一致(base=strip=lie)=是 臂数=30`、
  14 枚 `CTRL|等`、五枚变异全响该响的那条（m1「退回只往缺账列补」⇒ 11 臂换形、m2「负差也上账」⇒ 2 臂、m3「正差落首列而非末列」⇒ 3 臂、m4「关掉 holes 那一档」与
  m5「holes 双贴」各打 `k_nogrid_span_hole` 一臂）、`AGG|臂数=30 不符项=0`、`DONE|mut9-b4 bad=0`；`pnpm exec tsc --noEmit` 零错（提交件以未跟踪兄弟
  `src/lib/__q9probe.ts` 装回去吃那一趟）。

- **本轮撞到四处量具坑，都不是产品**：① 往返腿**必须两条链同趟**（一条吃提交件、一条吃改前的 HEAD 件），单条链只能给出「往返本身换了几档」，给不出「读侧改次序
  对往返的影响」——本轮那对 `{网格合计:15}` ↔ `{4}` 就是靠第二条链才看得见的；② **探针兄弟件会撞并发会话的模块增强**：把 HEAD 的 `docx.ts` 与 `paragraph-style.ts`
  也各装一份未跟踪副本跑 tsc，报 `error TS2717: Subsequent property declarations must have the same type. Property 'paragraphStyle' ...`（同一份 `declare module` 被两个
  文件各写一遍，而工作树那一头已有并发轮次的增强）⇒ 腿跑完立刻删副本再跑编译闸（编译闸吃的是最终源文，探针件本就不入提交）；③ 从 XML 里抽一枚 tag 的 helper 写成
  `?? [, ''])[1]` 会恒返回 `undefined`（capture-less 的正则只有 group 0），往返腿与字节腿各踩一次，要 `?? ['', ''])[0]` 取整个 tag 再交给 `attr()`；④ 标量档「换没换」
  要用与数组同型的比较（`sameTw([orig.x],[w1.x])`），`null ↔ 有值` 那一档直接比 `!==` 会被算成没换。

- **本轮没动的量出来记着**（已开进路线图）：**表级精确宽压过逐格 tcW、而压过来之后怎么分列仍看 `w:tblLayout`**（5 臂不等，两道门要一起开）；**非首行的 tcW 只扩不缩**
  （`max_grid_tcW` 那一档读手没做）；**`w:tblLayout` 缺失且只有网格时 Word 按内容重排**（5.8 磅那一档，判据只能标账外）；**写侧把表宽一律写成 `dxa` 真值**（往返
  `表宽type` 24 臂换档）；屏上 / 纸面本轮没有读数（dev 树由另一会话持有，本轮的 dev 腿开头会关掉它全部标签 ⇒ 破坏性，不跑）；往返腿只用行 0 的账（`rowspan` 恒 1），
  **竖跨那一格不进这一趟**；`pad*` / `rowHeight` 在 ODT 两头、exact 行高的裁剪、`w:rPr` / `w:pPr` 条件块载荷、角型同行同边、slot 水平边、图案 Texture 与 Word
  文档级默认格边距仍照前几节挂着；「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 架构两处就地改口（「覆盖」那条把行 0 那层从「网格说了数的列先占住自己的账、tcW 只往缺账的列里补」改口成 **tcW-first**，并补上跨列格
  正差落末列、负差不做那两档；同一格再补一句「表级精确宽压过 tcW 这一档 Word 有而本轮没跟」；文件清单 `lib/docx-fidelity.ts` 条目补那三档覆盖形状与三道不动的门，
  并剪掉上一轮 splice 留在同一行末尾的一段重复尾巴）+ 路线图勾掉「Word 在网格与 tcW 打架时跟 tcW、ours 跟网格」与「tcW 与 gridCol 打架时两头次序不同」两枚、把
  「写侧无 pct 出口」那枚的往返计数按同一批件刷新（`表宽值` 17→26、`表宽type` 9→24、`layout` 8→16），并新开 表宽压 tcW + layout 两道门 / 非首行 tcW 只扩不缩 /
  内容重排两臂 / 无 dev 与纸面腿 / 不占版本号五枚；**版本文件不入本提交**（0.98.0 住着并发轮次的对齐号）；`tmp/xmar9` 的 26+4 枚夹具、三批判据腿、往返腿与
  结构+变异腿按惯例删除；并发会话的工作树 README 此刻仍不含第九笔账这一节 ⇒ 本节以 `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**。

## 列账第一次由 `w:tblLayout` 分流：fixed 那一档网格是地板、autofit 那一档网格让位，而所有行的逐格 `w:tcW` 一起上账

按「不扩格式、把现有格式做深」的路线图开工，本轮取挂着的那两枚——「非首行的逐格 `w:tcW` 只扩不缩」与「`w:tblLayout` 的分流」。第九笔账留的话是「开表宽那道门要连 layout 一起开」，
而这一轮量出来 **`w:tblLayout` 本身就在管逐格账怎么落**：它不是只有表宽在场时才说话。窄口径：`src/lib/docx-fidelity.ts` 改动 65 增 / 42 删（净 +23），
全部住在读手「列账」那一段，Rust 一个字没动、写侧一寸没碰、模型属性一枚都不新增。**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar10`，59 枚自造夹具 = 56 枚判据臂 + 3 枚只量形状的形状臂；三头同一趟：自家读手 + Word 16.0 只读 COM + 独立字节腿，互不吃对方的读手；
  另立往返腿两条链，一条吃提交件、一条吃第九笔账那份 HEAD 件）。
  字节腿 `臂数=59 与夹具生成器打架=0 带网格臂=56 layout={"autofit": 13, "fixed": 36, "none": 10} tblW={"auto": 6, "dxa": 14, "none": 37, "pct": 2} 行0带tcW臂=37 低行带tcW臂=19 含跨列臂=12 含竖跨臂=1 不带tblLook臂=1 版心=9026.0 缇`；
  Word 腿 `arms=59 errArms=0 colsNA=12 naCells=0 fbArms=1`（`fbArms=1` 是竖跨那一枚臂：`Rows(i).Cells` 在竖跨上抛，
  腿退到扁平 cell 区间那一档），`PreferredWidth` 仍是 9999999 哨兵那一批（`prefW` 逐臂可见）。量出来五格：
  ① **`fixed` 那一档 `w:gridCol` 是地板**：`x_fix_nw`（行 0 各 1500 缇、网格 1200/1800/2400）Word 落 75|90|120 磅——只有第一列被抬，
  缩小与等宽都不落；`c_clash_sum_under`（tcW 600/900/1200 = 网格的一半）落 60|90|120 = 网格原样；`y_lookfirst_shrink` 同形；
  两行说同一列时取最大而不是后说的赢（`n_row12_big_first` / `_big_last` 两序都 105|90|120、`n_row0_shrink_row1_wider` 75|90|120、
  `n_row1_middle_only` 60|150|120）。
  ② **`autofit` 与 `w:tblLayout` 缺失那一档反过来**：网格让位、
  缩小照落（`x_aut_aw_shrink` 与 `x_non_nw_shrink` 30|30|30 = tcW 600 缇原样、`x_aut_nw` / `x_non_nw` 75|75|75），
  逐列取所有行 tcW 的最大（`n_row1_only_autofit` / `n_row1_only_none` 75|75|45）；一行都没说话的列 Word 按内容重排（`z_aut_row12` 的第二三列 10.55 磅）——那是账外，读手退网格。
  ③ **跨列格两族反着**：fixed 那一档仍是第九笔账那形状（正差落所跨最后一条、负差丢——`n_row1_span_pos` 60|120|120、`n_row1_span_neg` 60|90|120），
  而 autofit 那一档把整份**均摊到所跨各列**（`z_aut_row1_span` 行 1 一枚跨 2 格的 3600 缇 ⇒ 90|90|120，同一份声明在 fixed 那一档是 60|120|120）；
  跨到缺账列时 fixed 把正差补进缺口，一枚缺口对得上（`q_fix_span_hole1` 60|120|120）、
  两枚缺口 Word 按内容分而读手均摊（`q_fix_span_hole2` 18|162|120 ↔ 90|90|120，合计同为 300 磅）。
  ④ **`w:vMerge=continue` 那一格的 tcW 不参与**：
  `n_row1_vmerge_continue` 是本轮唯一一枚「只有跳过 continue 那一支才对得上」的臂（75|90|120 磅，候选账源 `fixed_max_skipvm` 严档唯一命中）。
  ⑤ **真数表宽压过来之后怎么分列也看 layout**：fixed 那一档把上面那盘 max 形状**等比缩到表宽**（`x_fix_d3000` 39.70|47.40|62.90、
  `x_fix_d3000_shrink` 33.65|50.00|66.35），autofit 与缺失那一档是**表宽 ÷ 首行格数**（`x_aut_d3000` 与 `x_non_d3000` 50|50|50、
  `x_aut_d3000_span` 37.50|37.50|75.00）⇒ 这两道门本轮仍不开（要重标 v0.92/v0.93/v0.94 三批屏上与纸面基线）。

- **本轮唯一的架构决定**（跟着数据走，缺陷住在「列账不看 layout、且只看行 0」而不是「表宽没压住 tcW」）：
  列账那一段由「行 0 单遍覆盖」改成 **`layFixed` 分流 + 全行扫描**—— fixed 那一档直接在 `acct` 上做「地板 + 只往宽里抬 + 正差落末列 + 缺口补差 + 跳过 `c.cont`」，
  autofit 与缺失那一档另立一盘 `pure`（逐列取各行 tcW 的最大、跨列格均摊），
  扫完才 `pure[k] > 0` 覆盖 `acct` ⇒ 「一行都没说话的列退网格」是这一档的兜底而不是特例。**三道门都不动**：
  出账闸门仍是 `acctKnown = gridKnown || !!tblTotal`、
  发射门仍是 `ri === 0 && acctKnown` 配 `.filter((v) => v > 0)`（上账的范围变了而出账的形状没变）、
  表级 `w:tblW` 仍只在 `!gridKnown` 时说话。两处**已知不如 Word** 的账（③ 的两枚缺口按内容分、⑤ 的真数表宽两道门）按实测原样写进源文注释而本轮不开门。

- **验证**（离线三头 + 结构/变异腿 + 往返腿，Rust 本轮没动、屏上与纸面本轮没有读数；
  八枚腿全吃**提交件** = `git show :src/lib/docx-fidelity.ts` 那份 2020 行（LF 计数口径，与 `wc -l` 同数）、剥注释后 1762 行、
  `md5=9e5d631869ea5c19afc4a0575fa6167d`，探针件 `src/lib/__q10probe.ts` 与之逐字节相同）：
  三方判据腿同一趟 `AGG|臂数=56 判定分布=[('等', 38), ('不等', 16), ('松等', 2)]`，**改前同一把尺**（批号 `b6h`：
  只把 ours 腿的读手换成第九笔账那份 HEAD 件（1997 行、`md5=cf99325c33779794d460b52f0c780841`），字节腿与 Word 腿在该批号下各重跑一趟、
  `ARM` 行与 b6 那趟逐字节相同）是 `[('不等', 38), ('等', 16), ('松等', 2)]` ⇒ **相等集从 18 涨到 40、22 臂翻成等，
  而原本相等的 18 臂一枚没翻红**（集合差算出来的，不是枚数）；翻成等的 22 臂点名：六枚 `x_fix_*` 与 `x_fix_none_nolook`、三枚 `y_lookfirst_*`、
  `z_aut_row1_span`、`q_aut_span_hole1`、`c_clash_*` 三臂、`l_grid_half_tcw`、`m_tcw_row1_only_fixed`、
  `n_row0_shrink_row1_wider` / `n_row12_big_first` / `n_row12_big_last` / `n_row1_grid_hole` / `n_row1_middle_only` / `n_row1_only_autofit` / `n_row1_only_none` / `n_row1_span_pos`。剩下 16 枚不等按账源分三族：
  **11 枚是「真数表宽压过来 + layout 分流」那两道没开的门**（`x_fix_d3000`、`x_fix_d3000_shrink`、`d_clash_tblw_pct30_fixed`、
  `e_tblw_dxa4500_fixed`、`tc_span_tcw`、`tc_tcw_vs_tblw`、`n_row1_tblw_present`、`x_aut_d3000`、`x_non_d3000`、
  `z_aut_d3000_shrink`、`x_aut_d3000_span`），3 枚是内容重排那一档（`b_grid_autofit` / `b_grid_nolayout` / `t0_grid_only`），
  1 枚是两枚缺口的按内容分（`q_fix_span_hole2`），1 枚是 `z_aut_row12` 的第二三列（内容重排的另一种面孔）；候选账源（严档）
  分布 `fixed_max_skipvm 30 / fixed_max 29 / fixed_max_noscale 25 / pure_tcw 23 / pure_tcw_noscale 19 / grid 8 / aut_eqcells 7 / equal 6`，
  `无候选匹配=5`（`z_aut_row12, q_fix_span_hole2, t0_grid_only, b_grid_autofit, b_grid_nolayout`——全在「Word 按内容算」那一族），
  `跨列臂的 fb 臂=n_row1_vmerge_continue`；两枚松等 `tb_pct30_nogrid`（45.20|45.25|45.25 ↔ 45|45|45）
  与 `tc_autofit_tcw`（100|50|50 ↔ 99.75|50.25|50.25）。自家读手腿 `臂数=59|bad=0`、字节腿 `与夹具生成器打架=0|bad=0`；
  **往返腿两条链同一趟 59 臂**：`判定分布=账不动59/漂移0/换档0/丢账0/盘本无账0`、`写件出表=59`、`写件重读两链不同的臂数=0`（往返件重读不再依赖行范围那一档——本轮改的就是行范围），
  而 `盘重读两链不同的臂数=30` ⇒ 那 30 臂就是第十笔账在**原始夹具**上的读侧足迹；
  `盘的 layout 档={"fixed":36,"autofit":13,"缺":10} 往返件的 layout 档={"fixed":59}`（写侧只有 fixed 那一档的出口）；
  代表读数 `x_fix_nw` 盘 `[lay=fixed,tblW=/-,网格=[1200,1800,2400],tcW枚=3]` → 往返 `[lay=fixed,tblW=5700/dxa,网格=[1500,1800,2400],tcW枚=6]`。结构+变异腿 `B0|提交件行数=2020 剥注释后非空行=1762`、
  12 枚断言 `不中=0`（含「行0-only 旧循环已撤=0」那枚反向断言）、注释陷阱件 `TRAP|注释件不中=9 枚（应 >=6）`判红、`AGG|提交件行数=2020 断言枚=12 不中=0`；
  变异腿 11 枚模块同一趟 `CTRL|臂=56 不复现=0`，
  m1「吃掉 layout」咬 24 臂 / m2「layout 恒真」16 臂 / m3「退回只吃行 0」14 臂 / m4「拆掉 fixed 的地板」21 臂（靠近 Word 3 臂）
  / m5「fixed 跨列正差改均摊」2 臂 / m6「autofit 跨列改落末列」3 臂 / m7「continue 那格也上账」1 臂 / m8「autofit 也把网格当地板」14 臂 / m9「fixed 的缺口不补」2 臂（canary `q_fix_span_hole1`），
  `靠近Word` 只有 m1 与 m4 各 3 臂（都在「表宽压过来」那一族，正是没开的那两道门），反陷阱 `n1_noop` `咬住=0`（`动了 0 枚`）⇒ `AGG|模块=11 臂=56 不中=0`；
  `pnpm exec tsc --noEmit` 零错（编译面只吃「产品件 + 那一枚提交件副本」，其余 12 枚 scratch 件挪出编译面，负控制 `__q10neg.ts` 出 `error TS2322` 而证明那一趟真跑起来了）。

- **本轮撞到五处量具坑，都不是产品**：① **改前对照不能只换个日志名**——合并腿按批号认件，把旧日志复制成 `*-b6h.log` 会被拒吃（`BADIDENT|byte10 枚=0`）；
  正解是给对照趟单立一个批号并把 **每一条**腿在该批号下重跑，Word 腿重跑后 `ARM` 行与 b6 逐字节相同（`diff` 空），于是两趟的差只归给读手；
  ② **批号 env 又漏传一次**（Word 腿贴 `word10-b1`）⇒ 每枚腿必须自己打 `IDENT|…-<批>`，认这一行才算跑过；
  ③ **探针兄弟件会把并发会话的模块增强拖进编译面**——12 枚变异/对照件与 HEAD 副本同住在 `src/lib/` 时那一趟 tsc 不是产品行为的尺，
  本轮把它们挪进 `tmp/xmar10/modules/` 只留一枚提交件副本，跑完即删；
  ④ **行数口径要写成 `match(/\n/g).length`**——`split('\n').length` 会把 LF 结尾的文件多数一枚（2020 → 2021），而自证腿报的就是这一行；
  ⑤ **m9 那枚变异在 b5 批咬 0 臂 = 假绿**：当时的夹具没有「跨列格 + 网格缺口」的组合臂 ⇒ 补 `q_fix_span_hole1/2` 两臂并把它点名为 m9 的 canary，
  b6 起 `咬住=2|漏咬=-|判定=绿`（覆盖面要靠臂，不是靠变异枚数）。

- **本轮没动的量出来记着**（已开进路线图）：**真数表宽压过逐格账那两道门**（11 枚不等，fixed 等比缩 / autofit 除以首行格数，要重标 v0.92/v0.93/v0.94 三批基线）；
  **fixed 那一档跨两枚以上缺口的正差 Word 按内容分**（`q_fix_span_hole2` 18|162|120 而均摊 90|90|120，合计同为 300 磅）；
  **`autofit`/缺失且一行都没说话的列 Word 按内容重排**（`b_grid_autofit` / `b_grid_nolayout` / `t0_grid_only` / `z_aut_row12` 四臂）；
  **写侧把 layout 一律写成 `fixed`**（往返件 `{fixed:59}` 而盘 `{fixed:36, autofit:13, 缺:10}`）；
  **第九笔账记下的 `c_clash_*` 那批 Word 读数本轮不复现**（两次独立 Word 腿同为 75|90|120 与 60|90|120，而那里记 75|75|75 与 30|45|60）
  ——已按本轮读数改口「覆盖」那条与文件清单，两批件的差在哪一枚字面上没量（`tmp/xmar9` 已删）；屏上 / 纸面本轮没有读数（dev 树由另一会话持有，本轮的 dev 腿开头会关掉它全部标签 ⇒ 破坏性，
  不跑）；往返腿只用行 0 的账（发射门没动，`rowspan` 恒 1）；`pad*` / `rowHeight` 在 ODT 两头、exact 行高的裁剪、`w:rPr` / `w:pPr` 条件块载荷、
  角型同行同边、slot 水平边、图案 Texture 与 Word 文档级默认格边距仍照前几节挂着；「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 架构两处就地改口（「覆盖」那条把行 0 那一层从「单列格的 tcW 直接盖网格、缩小也照盖、
  与 `w:tblLayout` 三档无关」改口成**由 layout 分流的两档**并补上全行上账、`w:vMerge=continue` 不参与、autofit 跨列均摊那三档，
  同时按本轮 Word 读数把 `c_clash_*` 那批数改掉；文件清单 `lib/docx-fidelity.ts` 条目补 `layFixed` / `pure` 那一盘与仍关着的那两道门）
  + 路线图勾掉「非首行的逐格 `w:tcW` 只扩不缩」与「tcW 与 gridCol 打架时两头次序不同」（后者按两档改口）、把「表级精确宽压过逐格 tcW」那枚的不等臂数按同一趟刷新（5 枚 → 11 枚）、
  新开 两枚缺口按内容分 / 第九笔账那批 Word 读数不复现 / 往返件一律 fixed / 无 dev 与纸面腿 / 不占版本号五枚；**版本文件不入本提交**（0.98.0 住着并发轮次的对齐号）；
  `tmp/xmar10` 的 59 枚夹具、三批判据腿、往返腿与结构+变异腿按惯例删除；
  并发会话的工作树 README 此刻仍不含第四~十笔账这几节 ⇒ 本节以 `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**（它属于另一会话）。

## 逐格 `w:tcW` 的型别闸收成只认 `dxa`：nil 带正数时读出的是一枚假宽，而 pct 的基数是表宽不是版心

按「不扩格式、把现有格式做深」的路线图开工，本轮取挂着的那一格——逐格 `w:tcW` 的 `w:type` 到底哪几档算数字。第九、十两笔账把「谁压过谁」与
「哪一行说话」都改完了，闸门那句却还是排除法（`type === 'auto' || type === 'pct'`）：`nil` 与规格外型别跟着 `dxa` 一起被当数字读。
窄口径：`src/lib/docx-fidelity.ts` 改动 16 增 / 3 删（净 +13；增里 15 行是源文注释、1 行是代码，删里 2 行注释、1 行代码），
全部住在读手 `tcWpx` 那一枚闸门上，Rust 一个字没动、写侧一寸没碰、模型属性一枚都不新增。**本轮不占版本号**：`package.json` / `Cargo.toml` /
`tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar11`，43 枚自造夹具 + 两批真件字节腿；三头同一趟：自家读手 + Word 16.0 只读 COM + 独立字节腿，互不吃对方的读手）。
  字节腿 `臂数=43 与夹具生成器打架=0 带网格臂=43 layout={"fixed":25,"autofit":15,"缺":3} 行0带pct臂=27 低行带pct臂=4 含跨列臂=5 含竖跨臂=2 窄版心臂=3`；
  Word 腿 `arms=43 fbArms=0`。量出来四格：
  ① **`nil` 是「这格没宽」而不是「宽是 0」**：夹具 `p_type_nil` 写的是 `<w:tcW w:w="1500" w:type="nil"/>`（规格常写 0，而第三方件带着旧数字），
  旧闸把那 1500 缇读成 75 磅 ⇒ 我们 [75|90|120] 而 Word [60|90|120]＝声明的网格；同一形状的 autofit 臂 `t_nil_aut` 同形（[75|75|75] ↔ [60|90|120]）。
  这一枚是本轮唯一「旧读手造出一枚文件里没说的宽」的形状：`w:w` 与 `w:type` 得分开信，型别说不算数时数字就不许上账。
  ② **`pct` 有基数，但那基数是表宽不是版心**：`r_fix_dxa4513_uneven`（表宽 4513 缇＝225.65 磅而版心 9026 缇＝451.3 磅）里 Word 读
  [45.15|90.25|90.25] 磅，判据那把尺上「pct 折表宽」差 0.02 磅/格、「pct 折版心」差 90.27 磅/格 ⇒ 折版心那个口径从一开始就是错的，
  而折表宽那一档住的正是「真数表宽压过逐格账」那两道**没开**的门（`t_pct_aut_tblw` 的 `Word说通=pct折表宽+表宽按份额` 同一形状）。
  ③ **规格外型别 Word 继续用那个数字**：`t_foo_aut`（`w:type="foo"`）Word [75|75|75]＝tcW 的数字而我们改后 [60|90|120]＝退网格——
  本轮唯一一枚「改前等、改后不等」的臂；266 枚真件里规格外 0 命中，本轮按「读不出来就账外」处理并把它挂进路线图。
  ④ **真件那侧 pct 与 nil 的落点**（两批字节腿）：266 枚可读件（另 34 枚打不开）里 1304 枚表，`w:tcW` 型别分布
  `dxa×38279 pct×1772 auto×145` ⇒ **nil 与规格外 0 命中**（40196 枚全在这三档里）；含首行 pct 格的表 30 枚且**全部**住在
  「缺 `w:tblLayout` × 有真数表宽」那一档；pct 折宽对声明网格分两桶——19 枚 ≤1 磅（0.10–0.64，上不上账是 no-op）、11 枚差 2.08–65.28 磅；
  而 Word 能开的 6 枚件里 11 枚含首行 pct 的表有 **10 枚读的就是声明的网格（0.00 磅）**、1 枚（`f6#1`）读的是 pct 折出来的那档（0.32 磅，
  网格那头差 6.9 磅）⇒ 把 pct 折进来只会把前 10 枚推远，这条是本轮「pct 落门外」在真件上的另一头证据。

- **本轮唯一的架构决定**（跟着数据走：缺陷住在「闸门用排除法而不是白名单」，而**不是**「pct 该折宽」）：
  `tcWpx` 那句 `if (type === 'auto' || type === 'pct') return null` 换成 `if (type !== 'dxa') return null`（缺省 `w:type` 按规格算 `dxa`，这一条不动）。
  一枚闸同时改掉 nil 与规格外两族；而 **pct 的账外理由由「没有基数」改口成「基数是表宽、而表宽那道门还关着」**（第八、十笔账立着的那两道门）
  ——这正是本轮把它写进源文注释而不是写进代码的原因，也是为什么不顺手给 `tcWpx` 加一枚 `contentTw` 参数。
  **三道门都不动**：出账闸门仍是 `acctKnown = gridKnown || !!tblTotal`、发射门仍是 `ri === 0 && acctKnown` 配 `.filter((v) => v > 0)`、
  表级 `w:tblW` 仍只在 `!gridKnown` 时说话；`tblWpx` 那侧的 nil 同族缺口本轮没跟着补（表级那一层同样会读出一枚假宽，挂路线图）。

- **验证**（离线三头 + 结构/变异腿 + 真件不变腿；Rust 本轮没动、屏上与纸面本轮没有读数；腿全吃**提交件** = 以
  `git show HEAD:src/lib/docx-fidelity.ts`（2020 行，LF 计数口径）为基座、只做三处唯一精确串替换装配出来的 2033 行件，
  `md5=157af492b9bcae1476c9ef28584cc2ba`，批号 b17 且每一条腿自己打 `IDENT|…-b17`）：
  **读手两链同一趟 43 臂**——提交件 `SRC|commit … md5=157af492… 行数=2034`（split 口径，LF 计数 2033）、HEAD 件 `SRC|head … md5=a905fe8c… 行数=2021`，
  两头都 `AGG|臂数=43 行0有账=43 缺口臂=无`；两链读数**差恰好 6 臂**（`p_type_nil` [75|90|120]→[60|90|120]、`t_nil_aut` [75|75|75]→[60|90|120]、
  `t_nil_mix_aut` [75|75|120]→[75|90|120]、`t_nil_span_aut` [75|75|120]→[60|90|120]、`t_foo_fix` [75|90|120]→[60|90|120]、
  `t_foo_aut` [75|75|75]→[60|90|120]）而**其余 37 臂逐字节相同** ⇒ 这道闸的影响面就是 nil 与规格外那两族，没溢出到 dxa/pct/auto；
  **三方判据腿同一把尺**（同一份 Word 日志，`PRE=1` 那一趟只把 ours 腿换成同批号的 HEAD 件日志）：改后 `等(松)=9 等(严)=9 形状不合=6 解析不合=0`、
  改前 `等(松)=8 等(严)=8`，集合差算出来的翻案是**新转等 `p_type_nil` / `t_nil_aut`**（两枚 nil 臂改后与 Word 同为 [60|90|120]）、
  **丢了等 `t_foo_aut`**（规格外那一格）；改后那 9 枚等点名 `p_control_grid`、`p_type_nil`、`p_vmerge_pct`、`t_auto_zero_fix`、`t_dxa_aut`、
  `t_dxa_fix`、`t_nil_aut`、`t_nil_mix_fix`、`t_nil_zero_aut`（严尺同 9 枚 ⇒ 本轮没有松等档）；43 枚按 `Word说通` 分三族且**三族恰分完**：
  **13 枚住在「真数表宽压过来」那两道没开的门**（`说通` 里带 `pct折表宽` / `表宽按份额` / `表宽除格数` 那一批：`r_fix_dxa4513_uneven`、`t_pct_aut_tblw`、
  `p_tblw_pct_tcw_pct`、`r_fix_t5000_uneven` / `_mix` / `_span` / `_vmerge`、`r_aut_t5000_uneven` / `_span`、`r_fix_t2500_even` / `r_aut_t2500_even`、
  `r_narrow_t5000_uneven`、`r_non_t5000_uneven`；13 枚全在不等/形状不合里）、`都不(账外)` 24 枚＝内容重排那一族（本轮新认出的两枚规格外
  `t_foo_aut` / `t_foo_fix` 与 `t_nil_mix_aut` 的第三列 12.85 磅住在这一族，而这一族里也有 3 枚撞对了数的等臂 `t_dxa_aut` / `t_dxa_fix` / `t_nil_mix_fix`）、
  `网格` 那 6 枚说通全部落在改后判等的 9 枚里（`p_type_nil` 与 `t_nil_aut` 改后落回的就是声明网格 0.00 磅）；
  **真件不变腿** `AGG|真件枚=6 摘要不等枚=0 表枚合计=51` ⇒ HEAD 与提交件在这 6 枚可读件上产出的 HTML 逐枚同摘要，配上字节腿的 nil 0 命中，
  这道闸对真件可证是 no-op；**结构+变异腿** `AGG|结构断言=34 变异支=7 咬合支=4 零咬支=3 臂数=43`（自证 `SRC|提交件 md5=157af492… 行数=2034`）：
  白名单闸在源文与剥注释件里各恰一枚、闸住在取型别之后取数之前（`型=134 闸=194 数=228`）、读 `w:tcW` 只一处、表级那道闸没被顺手改；
  四枚变异 m1「退回旧闸」咬 6 臂且该族全覆盖、m2「只认 nil」咬 9、m3「删闸（所有型别当数字）」咬 30、m4「只把 auto 请出门」咬 30；
  三枚零咬合是 ctrl（原样再读）、cmt（只改注释措辞）、swap（只把比较两侧对调，`TRAP|swap 字面闸枚=0` 该支该红而行为差 0）；
  剥注释器两族注释都见着（`行注=146 块注=89`、源文注 235 枚剥后 0 枚、剥注释件仍能扫且诊断 0、不留整行注释）；
  `pnpm exec tsc --noEmit` 零错（编译面只吃产品件 + 那一枚提交件副本，其余 scratch 件挪出），负控制 `__q11neg.ts(1,14): error TS2322` 证明那一趟真跑起来了。

- **本轮撞到三处量具坑，都不是产品**：① **源文注释里那句「11 枚 Word 读的就是声明网格」把两条腿的数并成了一枚**——b7 那批 pct 对表是
  字节腿的分桶（19/11），Word 只覆盖 6 枚可达件里的 11 枚表（10 枚 0.00 磅 + 1 枚 0.32 磅）；改口按腿点名之后**重装配提交件并整批换批号
  b16 → b17 重跑**（两批判据分布逐字相同，但注释的归因不同），理由是「注释说的话也是这一轮的产物」；② **吃 `.ts` 的 `.mjs` 腿必须走
  `pnpm exec vite-node`**——真 node 对 `import('D:/…ts')` 直接 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，报错长得像腿坏了；
  ③ **改前对照那趟要有自己的读手日志**——`mergefx11.mjs` 本轮加 `PRE=1` 开关去读同批号的 `ours11head-<批>.log`，
  而不是把旧日志复制成新名字（复制件会被合并腿按批号拒吃，也更不了一趟的账）。

- **本轮没动的量出来记着**（已开进路线图）：**表级 `w:tblW` 的 nil 同族缺口**（`tblWpx` 仍只对 `auto` 关门，nil 带正数时同样造出假宽——本轮只动逐格那一族）；
  **pct 折表宽那一档**（要等「真数表宽压过逐格账」那两道门开了才接得上）；**规格外型别两头次序不同**（Word 复用数字、我们账外）；
  **autofit/缺失且一行都没说话的列 Word 按内容重排**（`t_nil_mix_aut` 的 12.85 磅是新面孔）；
  **写侧一寸没碰**（读侧闸门只把范围收窄、不新增出口 ⇒ 往返形状不变，本轮按机理记这一句而没重跑往返腿）；
  屏上 / 纸面本轮没有读数（dev 树由另一会话持有，而本轮的 dev 腿开头会关掉它全部标签 ⇒ 破坏性，不跑）；`pad*` / `rowHeight` 在 ODT 两头、
  exact 行高的裁剪、`w:rPr` / `w:pPr` 条件块载荷、角型同行同边、slot 水平边、图案 Texture 与 Word 文档级默认格边距仍照前几节挂着；
  「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 架构两处就地改口（「覆盖」那条在 layout 分流那两句之后补上型别闸这一格、文件清单 `lib/docx-fidelity.ts` 条目把逐格那一族
  写成「只认 `dxa`（缺省也算 `dxa`），`auto`/`pct`/`nil`/规格外一律账外」）
  + 路线图勾掉「逐格 `w:tcW` 的型别只认 `dxa`」一枚、新开 表级 nil 同族缺口 / pct 折表宽等那道表宽门 / 规格外型别两头次序不同 /
  无 dev 与纸面腿 / 不占版本号五枚；**版本文件不入本提交**（0.98.0 住着并发轮次的对齐号）；
  `tmp/xmar11` 的 43 枚夹具、改前/改后两趟判据腿（同一份 Word 日志）、真件字节腿与结构+变异腿按惯例删除；
  并发会话的工作树 README 此刻仍不含第四~十一笔账这几节 ⇒ 本节以 `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**。

## 表级那一层的 `w:tblW` 第一次按型别收口：nil 带正数在 Word 那里是「没宽」，而规格外在表级复用数字、在格级请出门

按「不扩格式、把现有格式做深」的路线图开工，本轮取第十一笔账明写挂着的那枚姊妹缺口——表级 `w:tblW` 的 `w:type` 到底哪几档算数字。逐格那一族收成 dxa 白名单时，
源文注释就记着「表级那一层同样会读出一枚假宽」：`tblWpx` 那道闸只对 `auto` 关门，`nil` 带着正数时照样折成一枚文件里没说的表宽，再按列等分上账。
窄口径：`src/lib/docx-fidelity.ts` 改动 6 增 / 2 删（净 +4；增里 5 行是源文注释、1 行是代码，删里 1 行注释、1 行代码），全部住在读手 `tblWpx` 那一枚闸门上，
Rust 一个字没动、写侧一寸没碰、模型属性一枚都不新增。**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar12`，37 枚自造夹具 = 表级型别七档（dxa / pct / auto / nil / 规格外 / 缺 `w:type` / 没写 `w:tblW`）× 门的两种状态（无网格、有网格、全 0 网格、
  格级只说 dxa、格级只说 pct）× `w:tblLayout` 三档 + 3 枚窄版心件；三头同一趟：自家读手 + Word 16.0 只读 COM + 独立字节腿，互不吃对方的读手）。
  字节腿 `臂数=37 与夹具生成器打架=0 门开臂(无网格)=30 带网格臂=7 带逐格tcW臂=4 nil臂=16 规格外臂=3 窄版心臂=3 type={"dxa":7,"foo":3,"nil":16,"pct":6,"auto":2,"无tblW":2,"缺type":1} lay={"fixed":26,"autofit":9,"缺":2}`；
  Word 腿 `arms=37 fbArms=0 failArms=0 files=37`；改前那一趟判据 `等(严)=5 等(松含严)=16 不等=11 形状不合=0 解析不合=0 ours账外=10 nil造宽臂=7`。量出来四格：
  ① **`nil` 带正数在 Word 门面就是「没宽」**：`w_nog_nil4513_fix`（`<w:tblW w:w="4513" w:type="nil"/>`、无网格、fixed）Word 报 `pwtype=1 pw=0.00` 而首行逐格
  18.00|18.00|18.00 磅，`autofit` 与缺 layout 那两臂（`w_nog_nil4513_aut` / `w_nog_nil4513_non`）落 11.80|11.80|11.80——两把内容重排的尺，而那枚 4513 缇（225.65 磅）
  一分都没进账；旧读手把它折成 300.87px 再等分 ⇒ ours 75.00 磅/格（`w_nog_nil1500_fix` 那枚 1500 缇折成 24.75 磅/格）。这一族共 7 臂，是本轮唯一
  「旧读手造出一枚文件里没说的表宽」的形状，且**全部住在门开那一侧**（其中两枚是「网格全 0」的 `w_gzero_nil4513` 与「格级只有 pct 说话」的 `w_tcw_nilpct_fix`——
  门看着该挡而实际没挡）。
  ② **`nil` 与 `auto` / 没写 `w:tblW` / 空字面 / 负数五臂同形**：`w_nog_nil0_fix`（`w:w="0"`）、`w_nog_empty_fix`（`w:w` 写成空字面）、`w_nog_nilneg_fix`（-100 缇）、
  `w_nog_auto4513_fix`、`w_nog_none_fix` 在 Word 那头全是 `pwtype=1` + fixed 落 18.00 磅 / autofit 落 11.80 磅 ⇒ 表级这一层的正确闸是「把 `nil` 并入 `auto` 那一档」，
  而不是照抄逐格那族的白名单；`w_nog_dxaneg_fix`（dxa 而负）Word 门面报 `pwtype=3 pw=-5.00` 而格仍 18.00，我们这侧 `w > 0` 那道闸本来就挡着 ⇒ 两头都没账而门面各说各话。
  ③ **规格外型别在表级继续用那个数字**：`w_nog_foo4513_fix` / `w_nog_foo4513_aut`（`w:type="foo"`）Word 报 `pwtype=3 pw=225.65`、逐格 75.25|75.20|75.20 = 与 dxa 臂同形，
  缺 `w:type` 那一枚 `w_nog_notype4513` 同形 ⇒ 这一层只把 `nil` 取出去。**方向与第十一笔账的格级闸相反**（格级把规格外请出门、表级把它留在账内），
  所以两族各立一道闸而不并成一条梯子。
  ④ **门（`gridKnown`）mask 得住谁**：有网格数字那族 mask 得住（`w_g_nil4513_fix` 严等 60|90|120 磅而 Word 门面给的是 `pw=9999999` 哨兵）、
  有格级 dxa 那族也 mask 得住（`w_tcw_nil_fix` / `w_tcw_nil_aut` / `w_lowrow_nil_fix` 三臂严等 75|90|120 = 逐格那一盘账）；
  全 0 网格 mask 不住（`w_gzero_nil4513`）、格级只说 pct 时同样 mask 不住（`w_tcw_nilpct_fix` ours 造 75.00×3 而 Word 2.00|2.40|2.25 是内容重排）；
  另有一族「门挡而真数表宽在 Word 那头压过网格」本轮只数不等不开门（`w_g_dxa4513_fix` / `w_g_foo4513_fix` Word 50.25|75.20|100.20、
  `w_g_pct5000_fix` 100.55|150.75|201.00 而 ours 落网格 60|90|120）。

- **本轮唯一的架构决定**（跟着数据走：缺陷住在「表级那道闸漏了 `nil` 这一档」，而**不是**「表级也该上 dxa 白名单」）：
  `tblWpx` 那句 `if (type === 'auto') return null` 换成 `if (type === 'auto' || type === 'nil') return null`，规格外与缺 `w:type` 继续算数字（Word 在表级复用那枚数，
  读数与 dxa 臂逐格同形）。类型层面这条决定另给了一枚自证：在表级套白名单（变异 m2）会让它下面的 pct 分支静态不可达，
  `pnpm exec tsc --noEmit` 直接报 `src/lib/__q12m2.ts(1680,7): error TS2367: This comparison appears to be unintentional because the types '"dxa"' and '"pct"' have no overlap`
  ——这一枚编译错不是量具坏了，而是「表级不能设白名单」的另一种说法。
  **三道门都不动**：出账闸门仍是 `gridKnown = acct.some((v) => v > 0)` 配 `tblTotal = gridKnown ? null : tblWpx(tblPr, this.contentTw)` 与
  `acctKnown = gridKnown || !!tblTotal`，发射门仍是 `ri === 0 && acctKnown` 配 `.filter((v) => v > 0)`，逐格 `tcWpx` 的白名单一字未改；
  `tblWpx` 在源文里只有一个调用处（1426），本轮没顺手给它加参数或加档。

- **验证**（离线三头 + 结构/变异腿 + 真件对照腿；Rust 本轮没动、屏上与纸面本轮没有读数；腿全吃**候选件** = 以
  `git show HEAD:src/lib/docx-fidelity.ts`（2033 行，LF 计数口径、`md5=157af492b9bcae1476c9ef28584cc2ba`）为基座、只做「闸门一行 + 注释改口一处 + 新注四行」
  装配出来的件，`md5=8187c850e1ec43022e6099a1e85a78e0`（split 口径 2038 行、`wc -l` 口径 2037），批号 b5 且每一枚腿自己打 `IDENT|…-b5`）：
  **三方判据腿同一把尺**——候选 `臂数=37 等(严)=5 等(松含严)=16 不等=4 形状不合=0 解析不合=0 ours账外=17 nil造宽臂=0`，
  改前同一批件 `等(严)=5 等(松含严)=16 不等=11 ours账外=10 nil造宽臂=7` ⇒ 严等与松等两份点名**逐字相同**（原本相等的 16 臂一枚没翻红），
  收窄的正是那 7 枚造宽臂（`w_nog_nil4513_fix` 从 ours [75|75|75] 翻成账外 ↔ Word [18|18|18]，`w_tcw_nilpct_fix` 从 [75|75|75] 翻成账外 ↔ Word [2|2.4|2.25]）；
  自家读手两趟同为佐证：HEAD 件 `行0有账=27 行0账外=10`、候选件 `行0有账=20 行0账外=17`（`臂数=37 缺口臂=无` 两头一致）；
  剩下 4 枚不等按账分两族——3 枚是「真数表宽按份额压过网格」那两道没开的门（`w_g_foo4513_fix` / `w_g_dxa4513_fix` / `w_g_pct5000_fix`）、
  1 枚是内容重排那一档（`w_g_nil4513_aut` Word 11.80×3）；`Word说通` 六族恰分完 37 臂
  `表宽除格数+门面pw=声明宽=8 / 都不(内容重排)=18 / 表宽除格数=4 / 格级dxa=3 / 表宽按份额=3 / 网格=1`。
  **结构腿** `AGG|增行=6 删行=2 净=4`、`DIFF|增未预期=0 增缺席=0 删未预期=0 删缺席=0`、六枚 `KEEP|… HEAD=1 候选=1 合`（三道门面 + 逐格白名单 +
  取型别那句 + pct 分支）、`GATE|旧闸句式残留=1（应 1，属 w:fill 那档） 新闸句式=1（应 1）`——同一句式在源文里住两枚（`w:fill` 的颜色闸与 `tblWpx` 的宽度闸都写
  `if (type === 'auto') return null`），补丁腿按整行精确串匹配并断言命中恰一枚，颜色那枚没被顺手改。
  **变异三枚 + 判读腿**（`MUT|候选=8187c850 __q12m1.ts=f1aa4596 __q12m2.ts=4dfab50c __q12m3.ts=7e6a65f7 枚枚相异=4/4`）：m1「退回 HEAD 那句只挡 `auto`」咬 7 臂且
  `与 nil 同族集合相合=是`、每臂方向都是「候选账外 → 变异造数」；m2「表级上 dxa 白名单」咬 6 臂、`咬臂里 Word 门面没数的=0`（咬掉的全是 Word 真给数的 4 枚 pct 与
  2 枚规格外）；m3「连 pct 一起请出门」咬 4 臂且 `其中不合 pct 那一档的=0`；三枚变异腿的读手分别是 `27/10`、`14/23`、`16/21`（有账/账外），
  `AGG|M1咬=7 M2咬=6 M3咬=4 候选账外臂=17 变异不合项=0 判=绿`。
  **真件对照腿** `CENSUS|候选 docx 枚=303 超 8MB 跳枚=15`、`AGG|比枚=250 跳枚=53 表枚=1253 不同处=0`（同一份字节各喂 HEAD 读手与候选读手一趟，逐表比
  `<table>` 与首行 `colwidth`）；**真件字节腿** `可读枚=265 打不开枚=38 表枚=1302 门开表枚=0 型别={"auto":307,"dxa":950,"pct":45}`、`NIL|点名=无 FOO|点名=无`
  ⇒ 这道闸对真件可证是 no-op（nil 与规格外各 0 命中，而「门开」的表本来一枚都没有）。
  **编译腿** `pnpm exec tsc --noEmit` 在撤掉三枚变异件后 `exit=0`、零行输出；负控制 `src/lib/__q12neg.ts(2,14): error TS2322` 证明那一趟真跑起来了（tsc 成功时不打印任何字）。

- **本轮撞到三处量具坑，都不是产品**：① **`tail` 不能用来出证据日志**——b5 那趟字节腿写成 `… | tail -3 | tee byte12-b5.log`，日志被截成 3 行而 `exit=0`
  （管道末端还把 node 的退出码掩了），合并腿照常吃它 ⇒ 整文件重定向重跑一遍；② **批号要一路串到每一枚腿**——读手腿本轮加了 `QF` 开关去选源文
  （`__q12head.ts` / `__q12new.ts` / `__q12m{1,2,3}.ts`），换读手就得整批换批号重跑，否则合并腿按 `IDENT` 拒吃；
  ③ **变异件的咬合集合要拿 Word 的读数判方向**而不是拿理论：m2 在表级上白名单只看「我们少上账 6 臂」会像一次合理收紧，配上 Word 的 `pwtype`/`pw`
  才看出它咬掉的正是 Word 真给数的那 6 臂，而它在类型层面根本编译不过。

- **本轮没动的量出来记着**（已开进路线图）：**`w:tblW` 的 `w:w` 写成字符串字面那一档**（`w_nog_pctstr30_fix` 写 `w:w="30%"`，Word 门面 `pwtype=2 pw=30.00`、
  逐格 45.20|45.25|45.25 磅，而我们取不成数 ⇒ 账外）；**规格外型别两族方向相反、本轮没去统一**（表级复用数字、格级请出门，265 枚可读件里 0 命中）；
  **「真数表宽压过逐格账」那两道门仍不开**（`w_g_dxa4513_fix` / `w_g_foo4513_fix` / `w_g_pct5000_fix` 的按份额分列与 `w_g_nil4513_aut` 的内容重排）——开它要重标
  v0.92 / v0.93 / v0.94 三批屏上与纸面基线；**pct 在两层的基数不同**（表级折**版心**：`w_nog_pct5000_fix` 严等 150.75×3 = 451.3 磅的 100%、
  `w_narrow_pct2500` 在 4520 缇窄版心上 37.50 磅 = 226.0×50%/3；格级折**表宽**：第十一笔账的 `r_fix_dxa4513_uneven` 差 0.02 磅/格）⇒ 记在源文注释里而不并成一条账；
  **写侧一寸没碰**（读侧闸门只把 nil 取出去、不新增出口 ⇒ 往返形状按机理不变，本轮没重跑往返腿）；屏上 / 纸面本轮没有读数（dev 树由另一会话持有，
  而本轮的 dev 腿开头会关掉它全部标签 ⇒ 破坏性，不跑）；`pad*` / `rowHeight` 在 ODT 两头、exact 行高的裁剪、`w:rPr` / `w:pPr` 条件块载荷、角型同行同边、
  slot 水平边、图案 Texture 与 Word 文档级默认格边距仍照前几节挂着；「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 架构两处就地改口（「覆盖」那条在表级 `w:tblW` 那两句之后补上型别闸这一格、文件清单 `lib/docx-fidelity.ts` 条目把表级那一族写成
  「`auto` 与 `nil` 一律账外，而规格外与缺 `w:type` 在这一层复用数字」）+ 路线图勾掉「表级 `w:tblW` 的 nil 同族缺口没跟着补」一枚、新开
  `w="30%"` 字符串字面 / 规格外两族方向相反没统一 / 真数表宽两道门仍不开（含按份额与内容重排两族）/ pct 两层基数不同只记注释 /
  无 dev 与纸面腿 / 不占版本号六枚；**版本文件不入本提交**（0.98.0 住着并发轮次的对齐号）；
  `tmp/xmar12` 的 37 枚夹具与这批腿日志（夹具 / 字节 / Word / 读手四趟 / 判据 / 补丁 / 结构 / 变异 / 变异判读 / 真件对照 / 真件字节 / 编译）连同两枚源文副本按惯例删除；
  并发会话的工作树 README 此刻仍不含第四~十二笔账这几节 ⇒ 本节以 `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**。

## 表级 `w:tblW` 的 `"30%"` 字面第一次够得着：那一行读的是无前缀的 `w` 键，而真件把字面落在带前缀的 `w:w` 上

按「不扩格式、把现有格式做深」的路线图开工，本轮取第十二笔账明写挂着的那枚缺口——表级 `w:tblW` 把宽写成 `"30%"` 这种字符串字面时 Word 读成百分数而我们账外。
量下来这一格比「没译」更硬：`tblWpx` 里那句 `const raw = attr(tblW, 'w')` 只匹配**无前缀**的 `w=` 键，而真 OOXML（含我们自己的写侧）落的是 `w:w="…"`
⇒ 那一条分枝在真件上**从来没有可达过**，第八笔账写下的「`@w:w` 另吃 `"100%"` 字面」是一句写了而够不着的话（本节把它就地改口）。
窄口径：`src/lib/docx-fidelity.ts` 改动 3 段 / 增 10 删 3（净 +7；增里 8 行是源文注释、2 行是代码，删里 1 行注释、2 行代码），全部住在读手 `tblWpx` 那一枚 pct 分枝上，
Rust 一个字没动、写侧一寸没碰、模型属性一枚都不新增。**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.116.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar13`，23 枚自造夹具 = 字面 19 档（`"30%"` / `"100%"` / `"50%"` / `"0%"` / `"-10%"` / `"abc%"` / 空 / `"30 %"` / `"30.5%"`）× 门（无网格 / 有网格 / 逐格带账）
  × `w:tblLayout` 三档，另配数值对照两档（2500 / 3000）、dxa 对照一枚与窄版心两档；三头同一趟：自家读手（改前改后各一趟）+ Word 16.0 只读 COM + 独立字节腿，互不吃对方的读手，
  另立往返腿；批号 b2 且每一枚腿自己打 `IDENT|…-b2`）。字节腿 `臂数=23 与清单打架=0 字面带百分号臂=19 空字面臂=1 纯数字臂=3 没写w臂=0`、属性键形状
  `带冒号 w:w 的臂=23/23 无冒号裸 w 的臂=0`、`型别={"dxa":1,"pct":21,"缺":1} layout={"fixed":15,"autofit":5,"缺":3} 门开臂=2 逐格带账臂=2 窄版心臂=2`；
  Word 腿 `COUNT|arm=23 AGG|ok=23|bad=0`；自家读手两趟同一把尺：HEAD 件 `有账臂=7 账外臂=16 出错臂=0`、提交件 `有账臂=17 账外臂=6 出错臂=0`。量出来四格：
  ① **可达性由探针量死**：`PROBE|字面=w:w="30%" attrs键=[w:w,w:type] attr('w')=undefined attrL('w')="30%" attrNum('w')=undefined`——同一函数里 `attrNum` 走的正是
  `attr ?? attrL` 那条，所以数字那一档（`w:w="3000"` → 3000）一直够得着，只有 `%` 字面这一档的 raw 读是死的；探针里唯一够得着的形状是裸 `w="30%"`（`attrs键=[w,w:type]`），
  而字节腿 23/23 真臂都带冒号 ⇒ 「死分支」在夹具与真件两头同时证实。
  ② **pct 两档口径不同而 Word 门面各自说话**：数值按**五十分之一百分点**（`x_num2500_fix` `pw=50`、`x_num3000_aut` `pw=60`），字面按**百分之几**（`"30%"` → `pw=30`、`"50%"` → 50、`"100%"` → 100），
  判据腿 `AGG|门面pw与字面折档对得上=19 对不上=2 名=[x_g_pctstr30_fix(字面30% 折=30 word=9999999) x_pctstr30sp_fix(字面30 % 折=30 word=0)]`——前一枚是布局算出来的哨兵（第十二笔账就记着），
  后一枚正是形状闸要挡的那一档。两档并排住在同一枚 `ratio` 上而不互查。
  ③ **形状闸买回「不造 Word 没说的账」**：`"30 %"` 在 Word 门面 `pw=0`、逐格 18.00|18.00|18.00（内容重排），照旧的 `raw.endsWith('%')` 折成 30% 就凭空造出 45.00 磅/格——
  b1 那趟这一枚是 `新造账而Word门面不说pct=1`，本轮配 `/^-?\d+(?:\.\d+)?%$/` 后同一判据 `=0 名=[]`，代价是 `转有账臂` 从 11 收成 10；`abc%` / 空 / `"-10%"` / `"0%"` 与它同归账外
  （Word 各报 0 或 −10）。`"30.5%"` 形状过关而 Word 把 `pw` 截成 30，我们照 30.5 折 ⇒ 45.75 ↔ 45.20|45.25|45.25 落松尺内（总差 1.55 磅）。
  ④ **这一档的作用域只在门关那一侧**：门开臂（有网格的 `x_g_pctstr100_aut` / `x_g_pctstr30_fix`、逐格带账的 `x_tcw_pctstr30_aut` / `x_tcw_pctstr30_none`）改前后读数**逐字相同**
  （60|90|120 与 225|225|225 磅），转有账的 10 臂全住在「无网格且无逐格账」那一族；窄版心两臂（4520 缇 = 226.0 磅）同批上账，验的正是 `contentTwipsOf` 那枚基数跟着件走而不是猜 A4。

- **本轮唯一的架构决定**（跟着数据走：缺陷住在「那枚字面读不到」而不是「pct 字面不该上账」）：pct 分枝里 `const raw = attr(tblW, 'w')` 换成
  `const raw = attr(tblW, 'w') ?? attrL(tblW, 'w')`，`else if (raw && raw.endsWith('%'))` 换成
  `else if (raw && /^-?\d+(?:\.\d+)?%$/.test(raw)) ratio = Number(raw.slice(0, -1)) / 100`——字面按百分之几、数字按 `/5000`，各折各的口径；`attrL` 早已在那行 ooxml import 里 ⇒
  本轮没加新 import、没加新函数。**四道门都不动**：`type === 'auto' || type === 'nil'` 的型别闸、`contentTw <= 0` 的版心闸、`!(ratio > 0)` 的正数闸、
  出账闸门 `acctKnown = gridKnown || !!tblTotal` 与发射门 `ri === 0 && acctKnown` 配 `.filter((v) => v > 0)` 一字未改；`tblWpx` 在源文里仍只有一个调用处。
  `x_pctstr_notype_fix`（`"30%"` 而无 `w:type`）仍账外：缺 `w:type` 在表级缺省成 `dxa` 那一档、走不到 pct 分枝（Word 在那里推断成 pct，已开进路线图而不猜）。

- **验证**（离线三头 + 结构/变异腿 + 往返腿 + 真件两腿；Rust 本轮没动、屏上与纸面本轮没有读数；这批腿全吃**提交件** = `git show HEAD:src/lib/docx-fidelity.ts` 那份 2037 行的基座
  （blob `c03741bcae937a91b3eec98d1bb2060f43fc7226`）套 3 处整块唯一替换出的 2044 行、`md5=16a1b419ad121d3115cb2720e63aa236`、CR=0，且结构腿 `B1|提交件与读手候选件逐字节相同=true`；
  提交件源文注释里引的那几处数（真件 1154 表枚 / 百分号字面 0 枚、判据腿 23 臂与 `"100%"` 两臂严等总差 −0.05）在 b2 这一趟**逐字复现** ⇒ 注释不需要重汇编）：
  **三方判据腿同一把尺**：`head桶={"等松":3,"不等":4,"账外":16}` → `cand桶={"等松":7,"等严":2,"不等":8,"账外":6}`、`AGG|转有账臂=10`、`AGG|新造账而Word门面不说pct=0 名=[]`；
  head 那侧的 3 枚松等在 cand 一侧**全部还在等**（`x_dxa4513_fix` 75|75|75 ↔ Word 75.25|75.2|75.2、`x_num2500_fix`、`x_num3000_aut` 逐字未动），新落两枚严等
  `x_pctstr100_fix` / `x_pctstr100_aut`（150.75×3 ↔ Word 150.8|150.75|150.75，总差 −0.05 磅）；`AGG|改后仍账外而Word有数=6` 那 6 臂按形状闸与缺省型别逐枚点名（`x_pctstr0_fix`、
  `x_pctstr30sp_fix`、`x_pctstr_notype_fix`、`x_pctstrabc_fix`、`x_pctstrempty_fix`、`x_pctstrneg10_fix`）；判据腿 `CHECK|字节腿与清单打架臂=0（臂数=23 清单=23）`。
  **结构腿** `B0|提交件行数=2044 基座行数=2037 增减=7`、`B2|diff段数=3 增行=10 删行=3`、12 枚 `GATE|…=在位` 全绿、`B3|可达=true 形状闸=true 注释改口=true 闸丢失=0`
  配 `基座旧写法在=(true,true,true)` ⇒ `AGG|结构腿判据(可达+形状闸+注释改口+diff三段落+增10删3+闸全在位+基座那三处旧写法都在)=过`。
  **变异三枚 + 判读腿**：m1「退回旧的那枚 raw 读」与 m2「字面也按 5000 分之一折」各咬**同一把 10 臂**（`集合相同=是`；m1 每臂方向都是「提交件有账 → 变异账外」，m2 把 45.00 磅折成 0.75 磅/格），
  m3「撤掉形状闸」只咬 `x_pctstr30sp_fix` 一臂（提交件账外 → 变异 45.00×3）；`CHECK|覆盖面臂数=23 百分号字面臂=19 提交件本腿读数与读手腿不一致臂=0`、`M1与HEAD腿不同形臂=0`
  （⇒ 本轮那枚代码差异确实就是这一行）、`AGG|转有账臂=10 变异三支全咬住=过`。
  **往返腿** `AGG|自家往返不回归臂=2/2 手工门关件改后上账=true =过`：带账臂写 `<w:tblW w:type="dxa" w:w="8100"/>` + `<w:tblLayout w:type="fixed"/>` + 真网格（1800|2700|3600 缇），
  账外臂写 `<w:tblW w:type="pct" w:w="100%"/>`（**属性序是 `w:type` 先、`w:w` 后**）而网格 3135 缇×3；两臂在 HEAD 与提交件两枝下读数各自相同（90|135|180 与 156.75×3 磅，自家写侧永远带真网格 ⇒
  这一档在自家往返里是**惰的**）；把手工把那枚账外件的 `w:gridCol` 全置 0（表级字面仍在、版心 9405 缇 = 470.25 磅）后 head `账外` → cand `[156.75,156.75,156.75]` ⇒ 它买的就是第三方/手工件那一档。
  **真件两腿**：字节腿 `ROOTS|枚数=159`、`AGG|可读枚=150 打不开枚=9 表枚=1154 带tblW表枚=1154`、`型别={"auto":233,"dxa":872,"pct":49}`、`字面形状={"纯数字":1154}`、
  `布局={"autofit":172,"fixed":891,"缺":91}`、`百分号字面表枚=0`（其中带网格 0、门关 0）；对照腿 `AGG|比枚=150 跳枚=9 两边都错=9 表枚合计=1151 不同处=0 点名|无`
  ⇒ 这一枚 fix 对真件可证是 no-op。**编译腿** `pnpm exec tsc --noEmit` 在撤掉三枚变异件后 `exit=0`、零行输出（日志 0 字节），负控制 `src/lib/__q13neg.ts(1,14): error TS2322` 证明那一趟真跑起来了。

- **本轮撞到五处量具坑，都不是产品**：① **`%` 不能住在 JS 标识符里**——变异腿那句 `const 门关带%臂` 被 rolldown 读成 `const 门关带` 再接 `%臂`，报
  `Missing initializer in const declaration` 而整条腿红在解析期（改名 `门关带百分号臂`）；② **`.mjs` 腿在 `pnpm exec vite-node` 下按纯 JS 解析**，往返腿第一枚 `(t: string, …)` 的 TS 注解
  就是 parse error（`Expected , or ) but found :`）；③ **写侧 `w:tblW` 的属性序是 `w:type` 先**，往返腿拿 `^<w:tblW w:w=` 断言「表级字面仍在」第一趟假红，换成与顺序无关的两枚 test；
  ④ **日志读回先看 `wc -l`**——往返腿重跑后一次 Read 只回了前 33 行而文件 35 行，少看的正是 HAND/AGG 那两行；⑤ **探针腿把批号写死在 `IDENT` 里**（`-b1`）而日志叫 `-b2`，
  按「腿自报的批号为准」把它改成吃环境变量重跑一遍才对得上。

- **本轮没动的量出来记着**（已开进路线图）：**缺 `w:type` 而字面带百分号那一档 Word 推断成 pct**（`x_pctstr_notype_fix` `pwtype=2 pw=30.00`、45.20|45.25|45.25 而我们账外）；
  **门关一侧 `autofit` 与缺 `w:tblLayout` 那三臂 Word 按内容重排**（`x_pctstr30_aut` 68.15×3、`x_pctstr30_none` 与 `x_pctstr50_none` 77.15×3，我们给等分 45.00 / 75.00 磅/格）；
  门开一侧剩下的 4 枚不等（两枚网格族 + 两枚逐格带账族）仍是第十、十一、十二笔账挂着的「真数表宽压过逐格账」那两道门，**本轮没去碰**（`w:tblLayout` 仍不吃、真数表宽仍不压账）；
  **整数 px 的列账在窄版心量化不掉的 0.7 磅**（`x_narrow_pctstr100_fix` 75.00 ↔ Word 75.70|75.65|75.65，总差 −2.00）；**真件里两枚文件的 `<w:tbl>` 数与 HTML `<table>` 数不等**
  （1154 ↔ 1151）本轮没去归因；屏上 / 纸面本轮没有读数（dev 树由另一会话持有而本轮的 dev 腿会关掉它全部标签 ⇒ 破坏性，不跑）；`pad*` / `rowHeight` 在 ODT 两头、exact 行高的裁剪、
  `w:rPr` / `w:pPr` 条件块载荷、角型同行同边、slot 水平边、图案 Texture 与 Word 文档级默认格边距仍照前几节挂着；「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 三处就地改口（「覆盖」那条在表级型别闸那两句之后补上字符串字面这一格、第八笔账那句「`@w:w` 另吃 `"100%"` 字面（我们的写侧无账时就是这么落的）」改成
  「写了而够不着，第十三笔账接上」、文件清单 `lib/docx-fidelity.ts` 条目把表级那一族写成「dxa/pct 两档而 pct 数值按五十分之一百分点、字面按百分之几且另过一枚形状闸」）+ 路线图勾掉
  「`w:tblW` 的 `w:w` 写成字符串字面那一档 Word 读成百分数而我们账外」一枚、新开 缺 `w:type`+`%` 字面 / 门关 autofit 与缺 layout 的内容重排 / 窄版心 0.7 磅量化 / 真件两腿 1154 与 1151 那两枚差 /
  无 dev 与纸面腿 / 不占版本号六枚；**版本文件不入本提交**（0.116.0 住着并发轮次的对齐号）；
  `tmp/xmar13` 的 23 枚夹具与这批腿日志（探针 / 字节 / Word / 读手两趟 / 判据 / 结构 / 变异 / 往返 / 真件对照 / 真件字节 / 编译两枚）连同源文副本与两枚往返产物按惯例删除；
  并发会话的工作树 README 此刻仍不含第四~十三笔账这几节 ⇒ 本节以 `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**。

## 边框粗细第一次有最小发墨档：表级 `w:sz="0"` 的实线 Word 那里落墨而我们 `0px` 一滴不落，而 4/6/8 原样通过 ⇒ 这是地板不是一律取最小

按「不扩格式、把现有格式做深」的路线图开工，本轮取边框那一族的第一格：表级六槽写 `w:val="single" w:sz="0"` 时 Word 把它当**能看见的细线**画，
而我们折成 `0px solid …`——CSS 的 0px 边框一滴墨都不落。窄口径：`src/lib/docx-fidelity.ts` 改动 1 段 / 增 3 删 1（净 +2；增里 2 行是源文注释、1 行是代码），
全部住在读手 `edgeCss` 那一枚**三族共用**的宽度换算上（表级六槽、逐格四边、段落四边同一条路），Rust 一个字没动、写侧一寸没碰、模型属性一枚都不新增。
**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.116.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar14`，先在同一张 237 枚真件清单 `corpus4.txt` 上普查再定位，另配一枚改造件；三头同一趟：自家读手（HEAD / 提交 / 变异三臂）+ Word 16.0 只读 COM +
  独立字节腿，互不吃对方的读数；批号 b7~b26 且每一枚腿自己打 `IDENT|…-bNN`）。量出来六格：
  ① **真件可达且只住一处**：定位腿 b13 `FILE|idx=117 视频记录设备开发需求文档_R230506.docx 命中表枚=7`、`DONE|带 sz=0 非撤销档表级边的表枚合计=7`；字节腿 b14
  `META|顶层表枚=7` 而每张表六槽全 `single|sz=0|c=DEE0E3|sp=0`、`TBL0|行枚=13` 而逐格四边全 `缺声明`、`CTRL|正则直数的 tcBorders 块枚=0 边枚=0 结构化数到的边枚=0`
  ⇒ 那 42 枚边（7 表 × 六槽）就是这一档在真件里的全部肉身。
  ② **族普查把「低于 2」量成表级正文独有**：b21 `格级/样式 最小在场 sz=2 全档={"2":4,"4":11,"12":4}`、`格级/正文 sz=4`（`{"4":14426,"6":2302,"8":7930,"12":129}`）、
  `段落/样式 sz=4`、`段落/正文 sz=4`（1600 枚）、`表级/样式 sz=2`、`表级/正文 sz=0`（`{"0":42,"4":10902,"6":3534}`）+ `LOW|低于 2 的在场边合计=42 枚，分布在 1 处`
  ⇒ `sz=1` / `sz=3` 在整张清单上 0 命中，而省掉 `w:sz` 那一档根本没有 `(缺)` 桶（读侧仍按缺省 8 折 1 磅，本轮不动它）。
  ③ **Word 落墨而我们不落**：门面腿 b19 吃 b18 复制出的 `w3.docx`（`COPY|idx=117 →w3.docx 字节=38725/38725 同=true`）打
  `AGREE|t1 rows=13 cols=3 byteCellsPerRow=3,3,…` 而 45 枚格 × 四条边全 `1:1/2/True`（LineStyle=single、LineWidth=**2** 个八分位、Visible=True）；
  改前读手 b17 同一件 `EDGE|top={"0px/solid/#dee0e3":45}`（四边同）⇒ 差的是「有没有墨」，不是口径。
  ④ **段族没有真件臂 ⇒ 用改造件直接量 Word**：夹具腿 b24 从 idx=159（《论信息系统项目的工作绩效域.docx》，表外 `w:pBdr` 段枚=30）造出
  `CHK|改造件字节=18007 原件=20162 表外块已换=true`，第一块 `CHK0|四边 sz=0,4,6,8 色=123456`、第二块 `CHK1|四边 sz=4,4,4,4`；门面腿 b26
  `PARA|i=2 cnt=4 k1:ls=1/lw=2/vis=True k2:…lw=4… k3:…lw=6… k4:…lw=8…` 而 `PARA|i=3` 四边全 `lw=4` ⇒ 声明 0 报 2、4/6/8 原样通过；
  改前读手 b25 同一件 `HIT0|top=0px solid #123456 left=0.67px … bottom=1px … right=1.33px …`。
  ⑤ **地板不碰撤销档**（同批把格级 `w:val="nil"` 那一族量成三头一致）：字节腿 b8 逐格点名（如 `FILE|5.附件三…报价表.docx 顶层表枚=2 表枚标记=2 撤销格枚=212`、
  `LOC|…撤销=left=nil 原文=<w:tcBorders>…<w:left w:val="nil"/>…`）、改前读手 b7 在同一件上正好发 `EDGE|top={"0.67px/solid/#000000":51,"none":176}` 与
  `EDGE|left={"0.67px/solid/#000000":23,"none":204}`、门面腿 b12 在那几枚格上报 `0/6/False` 而别处报 `1/4/True` ⇒ 现有 `none/nil/hidden → 'none'` 的并档是对的、本轮一字未改，
  而地板写在 `if (style === 'none') return 'none'` **之后** ⇒ 撤销档拿不到它。
  ⑥ **真件段族的 `sz=0` 只与撤销档同现**：b24 那两枚 `OLD|` 打出的原件块全是 `<w:top w:val="none" w:color="auto" w:sz="0" w:space="0"/>` 这一形状 ⇒ 地板对真件段落可证是惰的，
  它买的是表级正文那一族，外加第三方件段族里同一档的形状。

- **本轮唯一的架构决定**（跟着数据走：缺陷住在「0px 不落墨」而不在「`sz=0` 不该上账」）：`edgeCss` 里
  `const px = eighthsToPx(attrNum(b, 'w:sz') ?? 8)` 换成 `const px = eighthsToPx(Math.max(2, attrNum(b, 'w:sz') ?? 8))`——**地板设在折像素之前而不是设在 `eighthsToPx` 里面**，
  于是写侧的 `pxToEighths`（本来就 `Math.max(1, px*6)`）、ODT 的 pt 直译与界面那一排 `BORDER_WIDTH_PT`（最低 0.25 磅 = 2 个八分位）一律不受影响；三族从这一处共用同一枚地板而不逐族加闸。
  **它是地板不是一律取最小**：4/6/8 两臂（b19 表级 + b26 段落）原样通过。**缺省档不动**：`?? 8` 仍写在 `Math.max` 里面，省掉 `w:sz` 还是 1 磅；而 `attrNum` 折不出数时是 `NaN`、
  `Math.max(2, NaN)` 仍是 `NaN` ⇒ 「数字读不出来」那一档不因本笔改变。**线型闸、色闸、五层逐边合并次序、`w:tblLook` 的位、出账闸门一字未改**。

- **验证**（离线三头 + 结构/变异腿 + 编译腿；Rust 本轮没动、屏上与纸面本轮没有读数；这批腿全吃**提交件** = `git show HEAD:src/lib/docx-fidelity.ts` 那份 2044 行、
  `md5=16a1b419ad121d3115cb2720e63aa236`、CR=0 的基座套 1 处整块唯一替换出的 2046 行 `md5=bee2c2cbcd1a79392f68f45034b26e87`（变异件同 2046 行而 `md5=cdda215eecc3ca5e9bf4c39c083980ec`），
  每枚读手腿自己打 `B0|件=… 行数=… 字节=… md5=…` 以证吃的是哪一枚）：
  **三头判据对照腿 b36**：`BYTE|表枚=7 六槽全为 sz0=true`、`WORD|格枚=45 边枚=180`、`OURS|四边桶={"0.33px/solid/#dee0e3":45}`（四边同），逐边
  `CMP|top 声明sz=0 我读=0.33px→0.2475磅 Word lw=2→0.2500磅 差=0.0025磅 枚=45` ⇒ `CTRL|表族：四边全比中=4/4 形状不合=0 严(0.10 磅)内边枚=180/180`；
  段落臂 `PCMP` 四边差 0.0025 / 0.0025 / 0.0000 / 0.0025 磅 ⇒ `DONE|表族形状不合=0 段落超严=0 段落四边全在严判据=true`（那 0.0025 是 1/3 px 的两位小数量化，不是口径差）。
  **读手三臂同一把尺**：提交件 b27 `EDGE|top={"0.33px/solid/#dee0e3":45}` 四边同；变异件 b28 回 `{"0px/solid/#dee0e3":45}`；HEAD 臂 b31 与改前趟 b17 除那四行 `CELL*` DUMP 外逐字相同。
  段落臂提交件 b29 `HIT0|top=0.33px …` 而 left/bottom/right 仍 0.67 / 1 / 1.33px、`HIT1` 四边全 0.67px 未动，b30（变异）与 b32（HEAD）回 `top=0px` 且与 b25 逐字相同 ⇒ **两族各咬一枚臂**。
  **12 枚目标件回归三臂**：b33(HEAD) / b34(提交件) / b35(变异件) 剥掉 `IDENT|` 与 `B0|` 后两两 `diff` 空，且 b33 与改前旧趟 b15 也空 ⇒ 这批不含 idx=117 的件上地板可证是 no-op。
  **结构腿 b39**：`SIZE|HEAD件行=2045 提交件行=2047 变异件行=2047 工作树件行=2304`（`split('\n')` 的形状，`wc -l` 各少一枚）、`GATE1|提交件 新句式=1 旧句式=0`、
  `GATE2|HEAD 0/1`、`GATE3|变异 0/1`、`GATE4|工作树 1/0`、`GATE5|首个差异行号=1584 其前全同=true 其后全同=true 行数增=2`、`GATE6|改动所在的函数=edgeCss`、
  `GATE7|eighthsToPx 调用行 HEAD=1 提交件=1 变异件=1；Math.max(2, 出现 HEAD=0 提交件=1`、`GATE8|变异件 vs 提交件 差异行枚=1（注释仍在=true）` ⇒ `DONE|全闸=true`
  （那两行注释在变异件里留着 ⇒ 咬的是代码而不是注释）。
  **编译腿**：`pnpm exec tsc --noEmit` 带负控制那一趟只回一行 `src/lib/__q14neg.ts(2,14): error TS2322: Type 'string' is not assignable to type 'number'.`
  （同趟把 HEAD 件 / 提交件 / 变异件与住着并发 hunk 的工作树件一起过类型）；撤掉负控制后 `exit=0` 且日志 0 字节。

- **本轮撞到四处量具坑，都不是产品**：① **读手腿光靠静态 import 行分不出三枚同族件**——加了 `B0|件=… 行数=… 字节=… md5=…` 自证以后，b27/b28/b31 才敢叫「同一把尺的三臂」；
  ② **对照趟要读实际 diff 而不是过滤管道**——b31 与 b17 的差是四行 `CELL*`（那一趟带了 `DUMP=4` 而这趟没带），不是读数差；
  ③ **判据腿吃门面腿那串 `1:1/2/True` 时边号在冒号左边**，按 `/` 切第一段会把 `1:1` 整段当数字 ⇒ `TypeError: Cannot read properties of undefined (reading 'lw')`，得先切 `:`；
  ④ **`grep -c` 命中 0 时退出码是 1**，接在 `&&` 链上会把一条绿的腿看起来像红了。

- **本轮没动的量出来记着**（已开进路线图）：**条件层 `w:tblStylePr` 里的 `w:tcBorders` 仍从不被读**（`CondCell` 仍只有 `{mar, tblMar, shd}`；这里那句「真件里唯一带它的
  UL212 那枚表」第十五笔账按 b10 改口——321 枚清单上有条件块 67 枚、带 `w:tcBorders` 的 34 枚共 175 枚边、分布在 3 枚文件，
  引用这些样式的表 17 枚在 2 枚文件（《T-5-2106-华大北斗OTA-升级开发指南-V1.0.5.docx》一枚就占 16 枚）；「那枚表 48 格四边在 b33 里全 `(没写)`」
  那条读数不与改口冲突、仍成立，而这一层正压在并发会话那份「样式基座」hunk 上）；**样式基座层（被引用表样式的 `w:tcBorders`）本轮也不上账**；
  `w:sz` 缺省仍是 8（1 磅）而不是 Word 在 `single` 那里的缺省档；表级样式族普查最小在场是 2 ⇒ 样式那一层的 `sz<2` 在 237 枚清单上 0 命中；
  ODT 两头的粗细直译不经地板；屏上 / 纸面本轮没有读数（dev 树由另一会话持有而本轮的 dev 腿会关掉它全部标签 ⇒ 破坏性，不跑）；
  `pad*` / `rowHeight` 在 ODT 两头、exact 行高的裁剪、`w:rPr` / `w:pPr` 条件块载荷、角型同行同边、slot 水平边、图案 Texture 与 Word 文档级默认格边距仍照前几节挂着；
  「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 三处就地改口（「边框只存一种形状」那条写明 `w:sz="0"` 的实线从 v0.97 的 0px 改落成 0.33px 而撤销档仍发 `'none'`、
  「单位换算钉死在一处」那条补上读侧的最小发墨档而 `pxToEighths` 与 ODT 直译不受影响、文件清单 `lib/docx-fidelity.ts` 条目把 `w:tcBorders` 那一句写成
  「四边含 `sz<2` 抬到 2 的地板（表格读侧第十四笔账，三族共用 `edgeCss` 那一枚）」）+ 路线图新开 条件层边框与样式基座层边框 / `w:sz` 缺省档 / ODT 不经地板 /
  表级正文之外没人量过的更细档 / 无 dev 与纸面腿 / 不占版本号六枚（**本轮没有可勾的那一枚**——路线图里没住着这一格）；
  **版本文件不入本提交**（0.116.0 住着并发轮次的对齐号）；`tmp/xmar14` 的三枚件副本、真件与改造件副本连同这批腿日志（定位 / 逐格字节 / 族普查 / 门面 / 读手三臂 / 判据 / 结构 / 编译）
  按惯例删除；并发会话的工作树 README 此刻仍不含第四~十四笔账这几节 ⇒ 本节以 `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**。

## 行条件层第一次上格边距的账：`w:tblPrEx` 是 `w:tr` 的首子而不是 `w:trPr` 的孩子，而它逐边合并、压过表级却让位逐格

按「不扩格式、把现有格式做深」的路线图开工，本轮取格边距那一族剩下的最后一层：行级例外 `w:tr/w:tblPrEx/w:tblCellMar` 说了哪条边，Word 就按那一条落，
表级与条件层说的都被压住——而我们的梯子只有五层，这一层整层不读。窄口径：`src/lib/docx-fidelity.ts` 改动 2 段 / 增 17 删 0（增里 15 行是源文注释、2 行是代码），
全部住在读手那一枚 `marginsCss({ … })` 调用上（一枚取数 + 一枚铺入），Rust 一个字没动、写侧一寸没碰、模型属性一枚都不新增。
**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.116.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar15`，先在 321 枚真件清单 `corpus15.txt` 上普查形状与并说，再造八臂夹具走三头同一趟：自家读手 + Word 16.0 只读 COM + 独立字节腿，互不吃
  对方的读数；批号 b1~b22，每一枚腿自己打 `IDENT|…-bNN`）。量出来六格：
  ① **这一层在真件里成规模，且父链只有一种**：形状腿 b2 `LAYER|带 tblPrEx 的文件枚=49 tblPrEx 块枚合计=3318 其中带 cnfStyle=0` 而 `PERROW|{"每行 tblPrEx 枚=1":3318}`；
  父链腿 b5 `PARENT|{"w:body/w:tbl/w:tr":3318}` + `POS|{"行的第一个孩子（trPr 之前）":3318}` ⇒ 它是 `w:tr` 的首子而不是 `w:trPr` 的孩子，
  顺着 `w:trPr` 往下找就永远够不着；同一枚腿的 `APP|` 里 WPS 各版本合占 3249 枚而「Microsoft Office Word」只 69 枚 ⇒ 这一档主要是 WPS 写出来的。
  ② **同一行的逐格那层常常也说了话**：b2 按每行格数分桶，如 `SHAPE|多格行(4格) {"行枚":1181,"逐格带边枚":1416,"同边两边都说":5105,"说的不同":4977,"只有tblPrEx说":13375}`
  ⇒ 「行条件压逐格」还是「逐格压行条件」蒙不得，得请 Word 裁。
  ③ **并说普查给出可裁面**：同层并说腿 b11 `CTRL|清单枚=321 可读枚=288 表枚=1391 带行条件边距的表枚=455`、`TYPE|行条件边距的型别= dxa=12722`（只有 dxa 一档）、
  `COMBO|表级同一边: 同数=12438 异数（表 0→行 57）=146 (表级没说这条边)=138`、`COND|行条件与条件层（tblStylePr/tcPr/tcMar）同槽且行位对得上=0`、
  `BASE|行条件与样式基座同槽=0（涉及表枚=0）`、`CELL|行条件说了边距的那些行的格枚=48722 自己带 tcMar=2596 同槽带 tcMar=1476` ⇒ 与表级那层可裁的是 146 枚异数
  加 138 枚「表级没说这条边」，而与条件层、样式基座的先后**在真件里没有一臂可裁**。
  ④ **同层另外三样读了也不改任何一张表**：层间对照腿 b6 `CTRL|…带行条件的表枚=464 条件层行枚=3318 条件层涉及的格边枚=39400` 而
  `BUCKET|两层说了相同的数（读了也是 no-op）=36280 逐格自己说了（条件层够不着）=2953 只表级说（行条件没说这条边）=167`；条件层与布局腿 b9
  `LAYOUT|行条件带 tblLayout 的块枚=1353` 而其中「同（都是 fixed）」=1353、`不同的样本=` 空；底纹那一族 12 枚全 `auto` 或没写 ⇒ 本轮只把 `w:tblCellMar` 上账，
  另三样进注释而不进代码。
  ⑤ **八臂三行、每臂请 Word 量两次 vpos 差**：臂生成腿 b19 造 a1~a8（每臂 控制行／被试行／控制行，行盒高由 a1 定标成 14.00 磅）、门面腿 b20 逐臂打
  `R|n topPad=… bottomPad=… vpos=…`；裁决腿 b21 把 vpos 差折成被试行上下边距（磅）后打 `a2_ex_full 行条件300/300 | 14.90/15.25 … 吃了 距0.25（次近10.25）`、
  `a3_ex_top_only 行条件只说上300 | 14.90/5.30 … 逐边合并`、`a4_ex_vs_cell` 与 `a5_cell_only` 同形 `10.10/10.10 … 逐格赢`、`a6_ex_over_missing 表级没说 | 15.30/15.55 … 吃了`、
  `a7_ex_zero 表300/300 行条件0/0 | 0.10/0.15 … 0真值`、`a8_ex_auto_type 上auto/300 下dxa/300 | 0.20/14.90 … auto当0` ⇒ Word 在这一层**逐边合并、压过表级、让位逐格、0 是真值**；
  而 `topPad=-1.00` 在 a2/a6/a7/a8 上成串出现（a4/a5 那两臂逐格说话时它报 10.00）⇒ 门面那两格在此不够用，尺只能是 vpos 差。
  ⑥ **改前读手在同一批臂上整层不看**：改前两趟 b13（两行臂）/b22（三行臂）的被试行里 `a2_ex_full` 与 `a3_ex_top_only` 都是 `6.67/6.67`（=表级 5 磅）、
  `a6_ex_over_missing` 上下 `(没铺)`、`a7_ex_zero` 落 `20/20`（表级 15 磅而 Word 0.10/0.15）、`a8_ex_auto_type` `6.67/6.67` ⇒ 漏的是四臂，方向一致朝「把表级那本账当最终答案」。

- **本轮唯一的架构决定**（跟着 b21 那张判据表走）：**行条件层 `w:tr/w:tblPrEx/w:tblCellMar` 上格边距的梯子**——落点在条件层（`mar` 槽）之上、逐格 `w:tcMar` 之下，
  于是梯子是六层：样式基座 → 条件层 `tblMar` 槽 → 表级 `w:tblCellMar` → 条件层 `mar` 槽 → **行条件** → 逐格；**逐边合并而不是整组替换**——
  `marginsOf` 天然只落说了的那条边，直接把结果铺进 spread 就与 Word 同形（一枚 `group` 变异件把整组替换的形状试出来，b27 咬住 a3 与 a8）；**0 是真值**
  （a7 那一档现成的，不必另开闸）；**只取 `w:tblCellMar`**，同层的 `w:tblBorders` / `w:tblLayout` / `w:shd` 归账外只留注释（b6/b9：39400 边读数全同 / 1353 与 1353 全同 /
  12 枚全 auto）；`w:type="auto"` 带一枚数时 Word 落 0（a8）而 `marginsOf` 把 auto 归账外——真件里这一层 12722 枚边距**全是 dxa**（b11），那一档在真件上够不着 ⇒
  不为它改闸；取数放在行循环内、格循环外（每行算一次而不是每格一次），因为 `w:tblPrEx` 说的正是这一行。

- **验证**（离线三头 + 结构/变异腿 + 后果腿 + 编译腿；Rust 本轮没动、屏上与纸面本轮没有读数）：
  **改后读手腿 b24** 在同一批臂上把被试行铺成 `a2 20/20`、`a3 20/6.67`、`a7 0/0`、`a8 6.67/20`（px，控制行一字未动）。
  **独立字节腿 b25** 不 import 自家读手也不 import 自家解析器，只用 jszip 加正则把八臂字节再读一遍，逐层打 `层|表级 … / 层|行条件 … / 层|逐格 …`（带 `w:type`），
  再按两条梯子各算一次：`磅|梯子甲（auto 归账外，我们该落）` 给 5.00/5.00、15.00/15.00、15.00/5.00、10.00/10.00、10.00/10.00、15.00/15.00、0.00/0.00、5.00/15.00，
  而 `梯子乙（auto 当 0，Word 在 a8 上落的）` 只在 a8 分叉（`上=0.00 下=15.00 分叉=是`）；每臂还打 `行条件块位置=首子（0<117）` 或 `没有这块` 作字节级形状自证。
  **三头判据腿 b26**：`CTRL|行盒高定标=14.00 磅（a1 的两行差 102.10−78.10 减表级上 5 下 5）` +
  `CTRL|尺自证：控制行上边距按同一把尺现量 a1=5.00（构造 5.00）、a7=14.90（构造 15.00，字节腿读表级 15）`，八臂逐档如
  `a2_ex_full | 14.90/15.25 | 15.00/15.00 | 15.00/15.00 | 差0.10/0.25 同档 | 差0.000/0.000 同档 | 未变` ⇒
  `TALLY|臂枚=8 Word↔读手 松判据内=7 读手↔字节甲 严判据内=8 控制行未漏=8`，而 `DIVERGE|a8_ex_auto_type（Word 0.20/14.90 vs 读手 5.00/15.00，松判据外）`
  正是那腿自己先打的一句 `NOTE|a8 已声明的分叉`（③ 的 dxa 普查说这一层真件里只有 dxa），`ALLGREEN|三头按判据齐（松档外只有已声明的那几枚）`。
  **结构腿 b23（工作树件）与 b31（提交件）各 14 枚断言全绿**：`S3 取数在铺入之前`、`S4 声明住在本趟行循环内、格循环外（每行一次）`、
  `S6 梯子次序＝样式<条件tblMar<表级<条件mar<行条件<逐格`、`S7b 六层都在这枚调用的闭合括号之前（真在同一枚对象字面量里）`、
  `S9 同层的边框/布局/底纹没上账（代码行只认 tblCellMar）`、`S10 exMar 标识符只出现两次（声明+铺入）`、`S11 写侧 docx.ts 不落 tblPrEx（已知差） 命中=0`、
  `S12 ODT 侧无 tblPrEx 命中=0` ⇒ `VERDICT|断言枚=14 红=0`。
  **变异腿 b27**：四枚各自预先声明咬合集合与方向（腿里先写死预测再跑，逐档打「实咬 vs 预测」且要求 `=预测`），`drop`（整层不铺）咬 5 臂、`group`（整组替换）咬 2 臂、
  `under-tbl`（铺到表级之下）咬 4 臂、`above-cell`（铺到逐格之上）咬 1 臂，`SELF|五枚互不相同=是`（四枚变异件加基座）且
  `TALLY|变异枚=4 咬合集合齐=是 方向全对=是 控制行不漏=是`——
  每一处咬合都比 Word 更远（如 `a6_ex_over_missing：15.00/15.00→不铺/不铺（Word 15.30/15.55）`、`a7_ex_zero：0.00/0.00→15.00/15.00（Word 0.10/0.15）`）。
  **后果腿 b28** 在 321 枚真件上把「工作树件」与「工作树件减掉 `...exMar` 那一行」两头同跑：
  `CTRL|清单枚=321 可读枚=288 打不开枚=33 带行条件边距块的文件枚=49 块枚=3218 ｜ 至少一条边带数的：文件枚=49 边枚=12722`、
  `RESULT|变文件枚=2 变表枚=18 变格枚=391 变边枚 上/下/左/右=391/391/0/0`、`GATE|变表枚≤455(b11)=是 变格枚≤48722(b11)=是 两头同形=是` ⇒ 这一枚改动**在真件上有后果**（两枚文件、18 张表、391 枚格真变），
  而后果全落在上下两条边（左右 0/0），其余 47 枚文件两头同形。
  **装配与编译**：装配腿 b29 以 `git show HEAD:src/lib/docx-fidelity.ts` 那 2047 行件为基座、用 a-side 整块唯一替换贴进本轮那两处插入，
  `GATE1|增减=+17 -0（应 +17 -0）`、`GATE2|新增行枚=17 每行在工作树原样在场=是`、`GATE3|反向剥回基座逐字节相同=是`、`GATE4|提交件六层次序=…：是`
  （提交件 = 2064 行、99166 字节、`md5=3d09ec3429ea0cc315a4a54747554f5c`、CR=0）；提交件读手腿 b30 与 b24 剥掉自证行后 41 行逐字相同（`diff` 空）⇒
  提交上去的那份源文读这八臂与工作树里那份一字不差；`pnpm exec tsc --noEmit` 在提交件在场时 `exit=0` 且日志 0 行，同趟的负控制只回一行
  `src/lib/__q15neg.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.`。

- **本轮撞到三处量具坑，都不是产品**：① **独立字节腿那句 `w:w` 正则 `(?:\sw|^)` 永不达**——`\s` 会吃掉属性前的空格而 `^` 只认串首，改成 `(?:^|[\s"/])` 才够；
  修好之前它把每臂都读成「这层没说」，看起来恰像「字节腿同意读手」的假绿。② **正则字面量里插值不生效**（`/^IDENT\|三头判据腿-${B26} /m` 静默永不匹配 ⇒
  判据腿 8 臂全 MISS 后崩在 `Cannot read properties of undefined (reading 't')`），得写 `new RegExp('^…' + B26 + ' ', 'm')`。③ **跨块懒匹配会造出假阳**：后果腿第一版用
  `/<w:tblPrEx\b[\s\S]*?<\/w:tblCellMar>/` 直数，一枚 `w:tblPrEx` 会借到后面一行的 `w:tblCellMar` ⇒ 文件枚数到 49 而 b11 记 41；改成**逐块切开再在块内数**，
  边枚与 b11 同为 12722，而那 8 枚之差是 b11 的 `perFile` 按**文件名**（`basename`）记账而这里按全路径——同名件住在不同目录就被并成一枚。

- **本轮没动的量出来记着**（已开进路线图）：**写侧与 ODT 两头都不落 `w:tblPrEx`**（b23 `S11 命中=0` / `S12 命中=0`）⇒ 读进来了，存回去这一层的账就丢；
  这一层与条件层（`w:tblStylePr`）、样式基座的**先后无从裁决**（真件里同槽 0 枚，b11），本轮把它放在两者之上；`w:type="auto"` 带数那一档 Word 落 0 而我们账外（a8）；
  同层的 `w:tblBorders` / `w:tblLayout` / `w:shd` 仍不上账；**第十四笔账记的「真件里唯一带条件层边框的 UL212 那枚表」本轮 b10 改口**——321 枚清单上有条件块 67 枚、
  带 `w:tcBorders` 的 34 枚、共 175 枚边、分布在 3 枚文件，而引用这些样式的表 17 枚分布在 2 枚文件（《T-5-2106-华大北斗OTA-升级开发指南-V1.0.5.docx》一枚就占 16 枚）
  ⇒ 条件层边框那一格更该上账，而它正压在并发会话那份「样式基座」hunk 上；屏上 / 纸面本轮没有读数（dev 树由另一会话持有而本轮的 dev 腿会关掉它全部标签 ⇒ 破坏性，不跑）；
  `pad*` / `rowHeight` 在 ODT 两头（表格写侧第一笔账已接）、exact 行高的裁剪、角型同行同边、slot 水平边、图案 Texture 与 Word
  文档级默认格边距仍照前几节挂着；
  「默认行距 `line-height: normal`」那一枚拆出去的轮次仍挂着。

- **收尾**：README 新增本节 + 四处就地改口（架构「覆盖」那条把格边距从**五层逐边**改成**六层逐边**并把「五层都没说的边仍不铺数」同数、文件清单 `lib/docx-fidelity.ts`
  那条把「格边距的五层逐边合并（第六、七笔账）」写成六层并点名行条件层的落点、第十四笔账本节与路线图那条各把「唯一带条件层边框的 UL212 那枚表」按 b10 改口）+
  路线图新开 写侧与 ODT 不落这一层 / 与条件层和样式基座的先后无从裁决 / `auto` 带数那一档 / 同层另三样不上账 / 条件层边框那一格 / 无 dev 与纸面腿 / 不占版本号七枚
  （**本轮没有可勾的那一枚**——`w:tblPrEx` 这一格原先没住在路线图里）；**版本文件不入本提交**（0.116.0 住着并发轮次的对齐号）；
  `tmp/xmar15` 的清单、两批臂目录、件副本、基座与腿日志（普查 / 形状 / 原文 / 上下文 / 父链 / 层间 / 条件层两枚 / 同层并说 / 臂生成两枚 / 门面三枚 / 读手四趟 /
  裁决两枚 / 字节 / 三头判据 / 结构两枚 / 变异 / 后果 / 装配 / 提交件读手 / 编译）按惯例删除；并发会话的工作树 README 此刻仍不含第四~十五笔账这几节 ⇒ 本节以
  `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**。

## 格里的表第一次出真表：`w:tc` 下的 `w:tbl` 从「展平为段落」改道成 `this.table(b)`，而那句「硬塞会丢字」的解释在四头都被否掉

按「不扩格式、把现有格式做深」的路线图开工，本轮取第十三笔账挂着的那枚归因缺口——真件里字节的 `<w:tbl>` 枚数比 HTML 的 `<table>` 枚数多，而当时记的解释是「整表被跳过、本轮没去归因」。
量出来不是跳过，是**主动展平**：`cellBlocks()` 里那一枝 `t === 'tbl'` 把格里的表拆成段落文字，11 枚真件表因此不落 `<table>`。窄口径：`src/lib/docx-fidelity.ts` 改动 3 段 /
增 6 删 5（净 +1；代码只一枚 `html += await this.table(b)` 替掉那两行展平循环与它的告警，其余增删都住在注释与文档串上），全部住在那一枚分枝里，Rust 一个字没动、写侧一寸没碰、
模型属性一枚都不新增。**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.116.0 ⇒ 本节按内容命名。

- **前置实测**（`tmp/xmar16`，先在 331 枚真件清单 `corpus16.txt` 上把缺口的父链数清，再问 schema / 浏览器 / 自家写侧 / Word 门面四头吃不吃得下格里的表；批号 b1~b9＝离线与
  浏览器腿、w1~w3＝Word 16.0 只读门面腿、x1~x8＝本轮验证腿，每一枚腿自己打 `IDENT|…`）。量出来六格：
  ① **缺口有数、且父链只有一种**：独立字节形状腿 b2 `CTRL|清单枚=331 可读枚=290 解压失败枚=41 表枚合计=1393` 而 `PARENT|w:body 枚=1382 / w:tc 枚=11`、
  `SHAPE|链 w:document/w:body/w:tbl 枚=1382 与 w:document/w:body/w:tbl/w:tr/w:tc/w:tbl 枚=11`；同一批清单上 HEAD 的读手腿 b3 只产 `HTML表枚合计=1382` ⇒ 差的 11 枚**全住在
  `w:tc` 那一档**，一枚不在别处。
  ② **那 11 枚住在 3 枚文件**：b3 的 `MM|idx=5 字节=5 HTML=1 diff=-4 件=file.docx`、`MM|idx=164 字节=8 HTML=4 diff=-4`、`MM|idx=192 字节=29 HTML=26 diff=-3`，
  而告警形状榜上正是 `嵌套表格已展平为段落×N 枚=3`；嵌套形状腿 b6 `N3b|嵌套深度形状榜=第1层×11` 与 `N2|链上带 sdt/sdtContent=0 枚，带 txbxContent（文本框）=0 枚`
  ⇒ 没有一枚藏在内容控件或文本框里，全是正文表格的格子里再摆一张表。
  ③ **每一枚自带宽度账**：b6 `N3|带 w:tblGrid 真网格的枚=11/11`、`N5|首行逐格 w:tcW 形状榜`（枚枚 `dxa`）、
  `N6|网格和（缇）=4597×1 / 4800×4 / 4861×3 / 5376×1 / 6124×1 / 6294×1`、
  `N7|外层那一格的 w:tcW=dxa/9927×4 / dxa/4996×4 / dxa/5505×1 / dxa/6520×2`；表级那一格 b6 `N4|w:tblW 形状榜=auto|0×11` ⇒
  「整盘没账就按版心等分」那一档在这 11 枚上根本走不到（本轮不为它改道，见路线图）。
  那一档在这 11 枚上根本走不到（本轮不为它改道，见路线图）。
  ④ **schema 那一头早就吃得下**：b5 直接问 tiptap 的内容表达式——`S1|tableCell.content=block+`、`S1|table.spec.group="block"` 而 `table.isInGroup(block)=true`、
  `S2|matchType(tableCell→table)=合法`、`S3|createChecked 嵌套表=通过（没抛）`、`S6|doc.check()=通过`；同一枚腿的三枚对照臂各抛在自己的门上（段落里放表 / 空表 /
  行外段落）⇒ 这道表达式是抛得动的，只是「格里放表」不在抛的那一批。
  ⑤ **界面真用的那一套扩展也吃得下**：b7（精简集）与 b8（`StarterKit` + `TableKit{resizable, View: IndentTableView}` + `Indent`/`TextAlign` +
  `ParagraphStyle`/`RStyleMark`/`CellStyle`/`TableWidth`，即 `DocEditor.tsx:191-227` 那一批）在真浏览器里跑 DOMParser + 渲染：
  `CTRL|B8 真扩展集·格里有表 tables=2 cells=4 chars=外层左格外层右格内层甲内层乙 domTables=2` ⇒ 表成了表、字一枚没丢。读手注释与 README v0.44 那句
  「嵌套表放不进 `<td>`，硬塞等于让 ProseMirror 的内容表达式把整块字丢掉」在 b5/b7/b8 三头都被否掉。
  ⑥ **自家写侧早就在产嵌套表**：b9 `B1|docx 写侧 w:tbl 枚=2` 里 `B2|「父是 w:tc」的表枚=1`、`B4/B5` ODT 那头同为 2 枚表里 1 枚住 `table:table-cell`——
  而 `B6|HEAD 读手再读这份写侧件：<table 枚=1` 配 `读手告警=嵌套表格已展平为段落` ⇒ 自己写出去的嵌套表，自己读回来读平。

- **Word 那一头本轮够不着（如实记未量）**：w1/w3 的 `FILE#N|TablesTotal=` 在同样三枚件上是 1 / 4 / 26，而字节腿 w3 同批说 5 / 8 / 29 ⇒ `Document.Tables` 只数最外层；
  w2/w3 的 `A#N.N|nested=null` ⇒ `Table.Nested` 经 COM 取不回来（`ASUM|nestedInCollection=0`）；w2 按行走的那一趟撞在合并格上抛 `COMException`（「无法访问此集合中的
  单独行，因为该表包含合并的文档单元」）⇒ 改按格走，w3 `BSUM#N|cellsScanned=76 / 63 / 379 而 cellsNotExactlyOneTable=0`——`cell.Range.Tables.Count` 恒为外层那一枚，
  格里的内层表在第三方门面上没有入口。所以本轮判据只有**自家读手 + 独立字节腿**两头，Word 那一头记「够不着 / 未量」而不硬凑。

- **本轮唯一的架构决定**（跟着 b2/b3/b6 与 b5/b7/b8/b9 走）：**`w:tc` 里的 `w:tbl` 从「展平为段落」改道成「出真嵌套表」**——那一枝直接 `html += await this.table(b)`，
  复用外层正文同一枚 `table()`（同一套列账、同一套边距六层梯子、同一套底纹三层取一，而不是给格内表另开一本简化账）；随之撤掉那句展平告警与「放不下」的假解释。
  三条**不做**的裁决各有理由：**不设深度闸**（真件 11 枚全在第 1 层，而 x5 的三层合成件 `S2|表枚=3 td内表枚=2` 量出递归本来就走得下去 ⇒ 为真件里没有的那一档加闸是凭空设防）；
  **不把外层格宽穿进 `table()`**（b6 的 `N3/N5` 说 11 枚枚枚带账，「等分吃版心」那一档本轮够不着）；**格内 OLE 嵌入那一枝保持展平**（`embedContent` 提出来的内层形状有
  docx 递归 / xlsx→表 / CSV→表 / txt→段 四种，本轮没像那 11 枚那样逐枚数过——**没量过的形状不改道**，注释里那句假话换成这句真理由）。

- **验证**（结构腿 x1 / 后果腿 x2 / 判据腿 x3 / 变异腿 x4 / 往返腿 x5 / 编译腿 x6 / 浏览器 schema 腿 x8；这批腿全吃**提交件** = `git show HEAD:src/lib/docx-fidelity.ts`
  那份 2063 行（`wc -l` 口径、`md5=3d09ec3429ea0cc315a4a54747554f5c`）的基座套 3 处 a-side 整块唯一替换出的 2064 行件，`md5=c34513be4d23ba8680894ed72661fce9`；
  Rust 本轮没动、屏上与纸面本轮没有读数）：
  **x1 结构腿 14 闸**：`S1..S4` 展平告警 / 展平循环体 / 旧文档串 / 那句假话在提交件上残留各 0，`S5` 新文档串=1、`S6` 新改道调用=1、`S7` `await this.table(` 调用处=2
  （外层正文 + 本轮格内）、`S8` OLE 那句「单元格里的嵌入内容已展平为文字」原文仍在=1（本轮不动它）、`S9/S10` HEAD 对照各 1、`S11..S14` 两枚变异件确实退回；
  `D1|HEAD 独有行组=5 提交件独有行组=6`。
  **x2 后果腿**（同一趟里 HEAD 件 vs 提交件）：三枚件表 1→5 / 4→8 / 26→29 且与字节腿同数，格 76→149 / 63→95 / 379→414，行 24→28 / 21→25 / 105→118，
  td 内表 0→4 / 0→4 / 0→3，告警从 `嵌套表格已展平为段落×4/×4/×3` 变 `(无)`；**去空白正文逐字符相同**（2582 / 1382 / 3377 字）⇒ 这一改只搬形状，一个字都不丢也不多。
  **x3 判据腿**（提交件在 331 枚全清单上）：`CTRL|清单枚=331 读手成功枚=290 抛错枚=41 HTML表枚合计=1393` 与 b2 的 1393 严等，`RESULT|不等文件枚=0 展平告警枚=0`，
  成功枚与抛错枚与改前 b3 同数（没新增失败），其余告警形状榜一字未动（emf 图片 28、`w:bookmarkEnd` 未导入 27、矢量图形 17、文本框展平 15、exact 行高 14…）。
  **x4 变异腿**：M1（退回展平，`md5=de60be69…`）与 M2（整枝删空成 `html += ''`，`md5=685e7879…`）在 3 枚件上**各咬 11 枚**（5→1 / 8→4 / 29→26），且 M1 带展平告警而
  M2 不带——这一枚差别正说明「那句告警是那张表的影子」；5 枚控制件（15 / 1 / 15 / 1 / 1）两枚变异件都不伤，且提交件在控制件上仍等于字节腿。
  **x5 往返腿**：合成两枚层件（字节 `md5=f8626bab…`）提交件出 2 表 1 枚 td 内表、HEAD 出 1 表 + 告警；自家写侧件读回 2 表 vs HEAD 1 表（这一臂吃的是**工作树** `docx.ts`
  的字节，含并发会话未提交改动，如实标注 `md5=7fb02b5e…`）；三层件只记录不设闸。
  **x8 浏览器 schema 腿**：x7 把手把提交件读手的真输出落盘（自造件 HTML 149 字符 + 真件 `file.docx` 里含嵌套那一段 57869 字符、内含 5 枚 `<table>`），b8 那一套扩展下
  `tables=2 / 5`、`nestedTables=1 / 4`、`maxDepth=2`、HTML 里的每段非空白文字（3 段 / 346 段）全部原样出现在 JSON 正文（`lostCount=0`），DOM 侧 `<table>` 与 JSON 同数；
  真件那臂 `cells=149` 与 x2 的提交件 td 数对上（`innerParent=DIV` 是 `resizable` 那层 `tableWrapper` 的必然，不是缺陷）。
  **x6 编译腿**：只吃提交件那一趟 `tsc --noEmit` 零错（成功不打印任何字），另造一枚 `__qNneg.ts` 负控制拿 `error TS2322` 证明那趟真跑了。

- **本轮踩到的量具坑（不是产品缺陷）**：第一版装配把 `else if (t === 'tbl')` 换成了无花括号的单语句，而锚点 `} else if (t === 'sdt' || …)` 原样留着 ⇒ 多出一枚孤立 `}`，
  **文件根本编译不过**；而当时行增减对账（净 +1）与全部残留闸都放行——那两枚只数行数与字符串，不看语法。教训记死：**结构腿的残留闸与增减对账都不证明语法，唯一那道闸是
  在提交件上真跑 `tsc --noEmit`**（改回块形、注释搬进块内之后全绿）。另两枚：`b2-perfile.json` 的 `idx` 是整数键，按字符串取会静默 undefined；变异腿 M2 那种「只删不改」
  的形状必须自带一枚「控制件也等于字节腿」的闸，否则它咬得对、控制臂却被打飞也照样报绿。第四枚在装配器自己头上：整节插入拿
  `换行 + ## 性能（v0.3） + 换行` 当锚点，而把 new 写成「换行 + 本节」忘了把锚点吐回去 ⇒ **那一枚标题被本节吃掉**，
  可「反向剥回基座逐字节相同」那道闸照样过（反向替换正好把它补回来）——反向闸证的是替换可逆，不证输出健全；本轮补的两道闸是
  「基座每一枚标题在新件里枚数不减」与「基座侧被删的每一行都必须住在本轮替换的 old 里」。

- **本轮没动的量出来记着**（已开进路线图）：屏上 / 纸面的嵌套表几何本轮**没有读数**（x8 只证 schema 与渲染吃得下，那两枚 `getBoundingClientRect` 不带应用 CSS；dev 树由
  另一会话持有而本轮的 dev 腿会关掉它全部标签 ⇒ 破坏性，不跑）；深度不设闸而真件只到第 1 层（第 2 层往上只有合成件读数）；格内表的「整盘没账按版心等分」那一档吃的是**版心**
  而不是外层格宽（`N7` 那四档外层格宽 9927 / 4996 / 5505 / 6520 缇就躺在字节里，本轮没接）；Word 门面这一头 `Table.Nested=null` 且 `cell.Range.Tables.Count` 恒为外层
  ⇒ 内层表几何在第三方那头没有判据；格内 OLE 那一枝仍展平（内层四种形状未逐枚数）；v0.95 记的「嵌套表的表头行克隆未量」这一臂的**可达性本轮才第一次成立**（以前那 11 枚
  压根不在 DOM 里）；`w:tblPrEx` 的写侧出口、条件层边框那一格、「默认行距 `line-height: normal`」那枚拆出去的轮次仍照前几节挂着，
  而该节挂着的 `pad*` / `rowHeight` 的 ODT 通道一枚由**表格写侧第一笔账**接上。

- **收尾**：README 新增本节 + 四处就地改口（v0.44 那一节「嵌套表放不进 `<td>`，硬塞等于让 ProseMirror 的内容表达式把整块字丢掉」按 b5/b7/b8/x8 改口成「展平是选择而不是被迫，
  真理由是内层形状未逐枚数过」；第十三笔账那条「真件里两枚文件的 `<w:tbl>` 数与 HTML `<table>` 数不等…本轮没去归因」勾掉并归因为 3 枚文件 11 枚格内表；文件清单
  `lib/docx-fidelity.ts` 条目补「格里的 `w:tbl` 走同一枚 `table()`」；v0.95 那条「嵌套表的表头行克隆未量」补一句可达性从本轮成立）+ 路线图新开 屏上与纸面几何未量 /
  深度不设闸而真件只到第 1 层 / 格内表等分那一档吃版心 / Word 门面这一头够不着 / 格内 OLE 仍展平 五枚，并勾掉第十三笔账那枚归因缺口；**版本文件不入本提交**
  （0.116.0 住着并发轮次的对齐号）；`tmp/xmar16` 的清单、四枚同族件副本、把手件与腿日志（形状 / 读手 / 结构 / schema / 嵌套形状 / 浏览器两枚 / 写侧 / Word 门面三枚 /
  后果 / 变异 / 判据 / 往返 / 编译 / 把手 dump / 浏览器 schema）按惯例删除；并发会话的工作树 README 此刻仍不含第四~十六笔账这几节 ⇒ 本节以 `git show HEAD:README.md`
  为底落 blob，不去动他们那一份；**dev 树全程未碰**。

## 格边距与行高第一次有 ODT 的出口：写侧逐边落 `fo:padding-*`，行高走 `style:min-row-height` 而**不是** `style:row-height`，因为 Word 门面把后者无一例外读成会裁字的精确档

按「不扩格式、把现有格式做深」的路线图开工，本轮取 v0.97 明写挂着的那枚——`pad*` 四条边与 `rowHeight` 在 docx 两头早有账，而 ODT 那一头两头都不认，docx → odt 再回 docx
这两笔账必丢。窄口径：只动 `src/lib/odt.ts`（改动 12 段 / 增 112 删 4，其中 26 行是注释、86 行是代码），Rust 一个字没动、docx 两头一寸没碰、模型属性一枚都不新增。接缝本来就在：
`pad*` 与 `rowHeight` 那五条通道沿用第五、六笔账立起来的形状，而 HTML↔属性的映射住在 `cell-style.ts` 的 `parseHTML` 里（每枚 `padding-<边>: Npx`
换一枚 `fo:padding-<边>`、每枚 `<tr style="height: Npx">` 换一枚 `style:min-row-height`）⇒ 本轮不改模型一个字段。**本轮不占版本号**：
`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.119.0 ⇒ 本节按内容命名。

- **前置实测（Word 16.0 当 ODT 的门面，15 臂，`w10`）**：这一档决定写侧落哪枚字面，所以先把「行高在 ODF 里有几种写法、Word 各读成什么」量死。①
  **`style:row-height` 无一例外折成 exact**：VRHFIX `rowHeightPt=60 heightRule=2`，数尺对上了的方向 V3FIXOK 同读数，
  而配一枚比内容矮得多的数就**真裁**——V3FIXTINY
  `rowHeightPt=2.85 heightRule=2 paras=3 topRow1Pt=56.65 topRow2Pt=59.5 gapPt=2.85`，那 44.8 磅的三段正文被推进下一页而字节俱在 ⇒
  精确档是**会吃内容**的那一档。② **`use-optimal-row-height="true"` 撤不回它**（VRHOPTTRUE `style:row-height` + `true` 仍报
  `60 / heightRule=2`）⇒ 「给 `row-height` 同时声明按内容自适应」这条路在门面这一头不成立。③
  **`style:min-row-height` 配那枚 `true` 落的是不带 `w:hRule` 的 `w:trHeight`**（VMINSTYLE `rowHeightPt=60 heightRule=1`，
  OOXML 缺省即 atLeast，与我们「行高是下限」的语义同形），且不裁（VMINSTYLETINY `rowHeightPt=2.85 heightRule=1 gapPt=44.8`，与没有任何行高字面的基线
  V3NONE `gapPt=44.8` 逐枚同数）⇒ 这一枚才是我们的落点。④ **`fo:minimum-row-height` 与 `fo:min-height` 在门面一头都不进账**（VRHMIN /
  VRHFOMIN / V3MINTINY 全报 `rowHeightPt=9999999 heightRule=0`，V3MINTINY 的 `gapPt=44.8` 等同基线）⇒ 那两枚只在读侧收、写侧不发；
  两档并存时门面按固定档裁决（VRHBOTH `style:row-height` 在场而 `fo:minimum-row-height="1.058cm"` 也在，读数 `60 / heightRule=2`）。⑤
  **格边距逐边认**（VPAD4 首格上边 `1.058cm` 把 `topRow1Pt` 从控制臂 V0 的 56.65 推到 86.7，正合那枚 cm 的 30.03 磅）、
  **`fo:padding` 简写也认**（VPADSH `gapPt=74.9` 对 V0 的 15.05）、**0 是真值不垫高**（VPADZERO `gapPt=15.05`，与控制臂 V0 同数）。
  裁墨的读数用位移尺 `gapPt = Rows(2).Cells(1).Range.Information(6) − Rows(1).Cells(1).Range.Information(6)`，全程只读、自开箱
  `Close(0)`，`GUARD|docs before=0` 与 `docs after=0` 夹住。

- **架构决定（跟着门面读数走）**：写侧行高落 `style:min-row-height` + `style:use-optimal-row-height="true"` 而**绝不**落
  `style:row-height`——② 与 ③ 合起来证明：落后者等于把「存一趟 `.odt` 再开」变成给一份本来不裁字的文档强加 exact 语义。读侧把四档字面（`style:row-height` /
  `style:min-row-height` / `fo:minimum-row-height` / `fo:min-height`）收进同一档，按此次序取第一枚达的——**次序与门面的裁决同形**（④ 的 VRHBOTH：
  固定档在场时下限档让位），闸门是**有限正数**（0 在这一头是「没说」而不是「零高」，与边距那道 `>= 0` 分开立）。边距逐边落 `fo:padding-top/right/bottom/left`，单位 cm
  三位小数（0.001cm ≈ 0.038px，是这条通道的分辨率下界），闸门照 docx 那一头的老规矩：**有限非负数都上账，0 是真值**；读侧另收 `fo:padding` 简写（1/2/3/4 值的 CSS 折叠，
  `expandPadding`）而**逐边压过简写**。

- **验证（九腿，每枚数字都来自打印它的那一趟）**：**结构腿** 24 臂 `B0|file=src/lib/odt.ts|lines=1622|arms=24|fail=0`（含 W13 那枚缺席断言——写侧从不
  emit `style:row-height="`）；**变异腿** 15 枚 `B0|SRC_LINES=1622|mutations=15|fail=0`，M04「行高落进精确档」同时咬响 W06 与 W13
  那两枚（发与不发成对钉），M90 良性反证 `bitten=0 exit=0`；**往返腿** 34 臂 `B0|roundtrip|arms=34|fail=0`：四边距 39.99 / 60.02 / 19.99 /
  80.01 对 40 / 60 / 20 / 80（TOL=0.03px，来自 cm 三位小数的换算上界）、0 那档 `got=0` 回得来且没把没账的两边写成 0、行高 80.01、没账那行不出 `height`、
  简写六臂（两值 / 单值 / 三值折叠 / 逐边压过 / 混非长度整条不算而逐边仍上账）、裁决 D01「`row-height` 压过 `min-row-height`」与 D05「0 不上账」；**ODT 独立字节腿**
  18 臂 `B0|byte-leg|file=tmp/xmar17/out/tbl1.odt|bytes=2126|arms=18|fails=0`，走自己的单位路径（cm→缇）：1.058 / 1.588 / 0.529
  / 2.117cm 折出 599.81 / 900.28 / 299.91 / 1200.19 对 600 / 900 / 300 / 1200，行高 2.117cm＝60.0094 磅＝1200.19 个二十分之一磅对上
  80px＝1200，而 `Z25` 在盘上数到 `rowprops=['min-row-height', 'use-optimal-row-height']`、精确档字面 0 枚；**夹具自检腿**
  `K|tbl2|bytes=2067|trHeightPx=4.99|paras=4`（5px 的下限不被 cm 三位小数压成 0 而掉账）；**Word 门面腿**（`w11`，同两份件走 Word 自己）
  `tbl1 tables=1 rows=2 r1HeightPt=60 r1HeightRule=1 gapPt=74.9`、
  `tbl2 r1HeightPt=3.75 r1HeightRule=1 r1Cell1Paras=3 gapPt=44.8`——后者正是「下限不裁」的正控制：3.75 磅的下限配三段正文，`gapPt`
  与前置实测里没有任何行高字面的 V3NONE 基线同数；**docx 独立字节腿** 16 臂 `B0|docxbyte|arms=16|fails=0`，读的是 Word 门面另存出来的那份 `.docx` 的字节：
  `w:tcMar` 四枚边 600 / 1200 / 300 / 900 全带 `w:type="dxa"`、0 那格只落它真有账的两枚、整份恰好一枚 `w:trHeight w:val="1200"`
  且**不带 `w:hRule`**、tbl2 那枚 `val=75` 同样不带、无账的格不落 `tcMar`、三段甲乙丙一枚不少；**编译腿**双证——先只吃提交件那一趟 `tsc --noEmit`
  零错（成功不打印任何字，`LOG_BYTES=0`），另造一枚一次性 `__qNneg.ts` 拿
  `src/__qNneg.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.` 证明那趟真跑了，探针随即删掉；
  **真件后果普查腿** `B0|corpus|files=383|cells=29652|pad=76634|rowH=6806|failed=7`：383 枚清单里 376 枚可读（7 枚失败全是 `~$` 锁文件与截断
  zip），HEAD 的 docx 读手在 29652 枚格里落 **76634 枚 `padding-*` 字面**（逐边 18178 / 18178 / 20139 / 20139，其中
  **0 那档 40329 枚**）、在 10075 枚行里落 **6806 枚行高字面**，带边距字面的 271 枚文件、带行高字面的 244 枚——这批账以前一旦走 `.odt` 就整批丢掉，
  最大的那枚《D:/FAE/苏标外设与终端协议(瑞为).docx》一件就占 4644 枚边距 / 1161 枚格，行高那族以《D:/FAE/TTX/Protocol of Terminal_20230111.docx》321
  枚行 / 762 枚行为首。

- **本轮踩到的量具坑（不是产品缺陷）**：① **`w:trHeight` 的属性名是 `val` 而不是 `w`**——docx 字节腿起初拿 `.get("w")` 取值，两臂直接 FAIL 而打印出来的是
  Element 的 repr（`attrs=<Element '{…}trHeight' at 0x…>`），先把属性名局部化（`attrs_by_local`）再断言，读数才落纸。② 同一条腿里那枚「不带
  `w:hRule`」起初是**假绿**：`'hRule' not in tr1` 的 `in` 遍历的是 Element 的**子标签**而不是属性字典，形状一错就永远不命中——现在断言的是那枚真打印出来、
  非空的属性字典（`X24 attrs={'val': '1200'}`）。③ **普查腿起初吃工作树的 `docx-fidelity.ts`**，而那份带着并发会话在飞的 507 行改动 ⇒ 枚数不能归到本轮账上；改成
  `git show HEAD:src/lib/*.ts` 整层落 `tmp/xmar17/headlib/`（50 枚）再 import，并在日志第一行自证那份的
  md5（`CTRL|HEAD件md5=c34513be4d23ba8680894ed72661fce9`）。

- **本轮没动的量出来记着**（已开进路线图）：**`style:min-row-height` 的 ODF 语法合法性本机没量具**（没装 LibreOffice，v0.62 那套 RelaxNG 闸住在 Rust 侧、
  只管 ODS 的 sheet 家族样式）——它是从 Word 门面的读数反推出来的可达写法，不是由规格校验器证明的；**exact 那一档在 ODT 两头没有落点**（读侧收 `style:row-height`
  而写侧从不 emit ⇒ 第三方件的精确档存回来降成下限，这一档的观感差异两头都有而本轮没通道）；`fo:minimum-row-height` 与 `fo:min-height` **只进不出**；
  **ODT 的边距只有逐格那一档**（docx 的表级 `w:tblCellMar`、条件层与行条件层在 ODT 这一头没有对应落点，表级默认铺不进逐边字面）；屏上 / 纸面本轮没有读数（dev 树由另一会话持有而本轮的
  dev 腿会关掉它全部标签 ⇒ 破坏性，不跑）；`w:tblPrEx` 的写侧出口、条件层边框那一格、「默认行距 `line-height: normal`」那枚拆出去的轮次仍照前几节挂着。

- **收尾**：README 新增本节 + 四处就地改口（v0.97 那节「本轮没动、量出来记着」里的「③ **ODT 链路没有 `pad*` / `rowHeight` 通道**」按本节改口、
  紧邻两节（十五笔账与十六笔账）「仍照前几节挂着」清单里这一枚各标上「已接」、文件清单 `lib/odt.ts` 那条补上这两条新通道）+ 路线图**勾掉** `pad*` / `rowHeight` 在 ODT
  两头没有通道那枚，并新开 ODF 语法合法性没量具 / exact 档两头无落点 / `fo:minimum-row-height` 与 `fo:min-height` 只进不出 / ODT 边距只有逐格那一档 / 无
  dev 与纸面腿 五枚；历史各节「本轮没动」清单里那句「`pad*` / `rowHeight` 在 ODT 两头仍没有通道」按节保留为当时的口径（与列宽那族同例），只有紧邻本节的两处就地改口；
  **版本文件不入本提交**（0.119.0 住着并发轮次的对齐号）；`tmp/xmar17` 的清单、臂目录、件副本、基座与腿日志（前置实测两枚 / 结构 / 变异 / 往返 / 字节两枚 / 夹具 / 门面两枚 / 普查
  / 装配 / 编译负控制）按惯例删除；并发会话的工作树 README 此刻带着他们自己那一版改动（相对 HEAD 增 626 删 1265，且不包含第四~十六笔账这几节）⇒ 本节以
  `git show HEAD:README.md` 为底落 blob，不去动他们那一份；**dev 树全程未碰**。


## 段落缩进第一次按属性名继承：`w:ind` 在样式链上是逐枚属性合并而不是整枚元素替换，而 `firstLine` 与 `hanging` 是同一枚首行槽的正负两写法——按名字各留各的会把号读反；字符那一档的宽度底数取**段落自己的字号**，旧那枚硬写的 16px 在真件上每字最多差 4.00px

按「不扩格式、把现有格式做深」的路线图开工。本轮的开门量具是一枚跨层通道普查（一次读 1342 份真件，按 `w:pPr` / `w:rPr` /
`w:tblPr` / `w:tcPr` / `w:trPr` / `w:sectPr` 六层数出出现过的元素名与属性名，再逐名去 HEAD 的读手里查它是否被吃——grep
命中不等于读到，要按调用处判），本节只吃其中段落缩进那一枝。窄口径：只动 `src/lib/docx-fidelity.ts`（相对 HEAD 增 57 行
= 10 段改动、增 64 删 7，其中 25 行是注释、39 行是代码），Rust 一个字没动、docx/odt 写侧一寸没碰、模型属性一枚都不新增。
接缝本来就在：样式链继承早就住在 `mergePPr` 里（`w:pPr` 的同名子元素沿 `w:basedOn` 自根向尾叠），本轮只把 `w:ind`
那一枝的叠法从「整枚换」改成「逐属性合」，**不改模型一个字段**。**本轮不占版本号**：`package.json` / `Cargo.toml` /
`tauri.conf.json` 现在住着并发轮次的 0.119.0 ⇒ 本节按内容命名。

- **前置实测（Word 16.0 当段落缩进的门面，`c8`~`c22` 那十几枚腿，只量不改产品）**：①
  **元素级替换在真件里丢的是一批账，不是一角**——带 `w:ind` 的段 98255 枚、住 998 枚文件（c1
  `pPr|ind count=98255 files=998`），其中「样式写了而段落没写、被整枚替换一次扔掉」的属性共 **18460 枚、住 190
  枚文件**（逐名：`firstLine` 7277 / `firstLineChars` 6255 / `leftChars` 1568 / `rightChars` 1600 / `left` 1111 /
  `right` 269 / `hanging` 321 / `hangingChars` 59），把带编号的段剔掉仍有 79 枚文件在这一档上漏账（c19b）。②
  **`w:firstLine` 与 `w:hanging` 是同一枚槽的正负两写法**（c21：跨层两拼法并存 818 枚、住 46
  枚文件——段落 `firstLine` × 样式 `hanging` 248、段落 `hanging` × 样式 `firstLine` 570，另同拼法 f/f 11500、h/h
  467；字符那一槽 `hangingChars` 压 `firstLineChars` 91 枚）⇒ 按属性名各留各的会读出反号。③
  **别名的账比想的小**（c21：同一枚 `w:ind` 上 `w:left` 与 `w:start` 并存 0 例、跨层混拼 0
  例且 0 枚文件）⇒ 只做取值时归一，不给它另立一槽。④ **缇值那一头先说话**（c13 门面九枚「缇值 ×
  字符数双生」臂**全部** `verdict=literal`、`dLit=0`，例 `W13|firstLineChars wordPt=372.75 litPt=372.75 charsPt=639`）
  ⇒ 字符档只在缇值整枚没写时说话。⑤ **0 是真值**（c17：`firstLineChars` 单独出现的 4031 枚里 4028 枚是 0、住 181
  枚文件，其中「本段写 0 而样式链上有值」1635 枚、住 112 枚文件；c20 两枚 drop 臂在门面上报 `L=0 F=0 H=0`——显式
  `w:firstLine="0"` 把样式的 `w:hanging="283/721"` 整槽压掉）⇒ 槽内合并要让后写那层说了算，0 不许当「没说」。⑥
  **负数的字符档不上账**（c15w：`w:leftChars="-49"` 在 Word 门面报 `wordPt=0`）。⑦ **字符档的宽度底数＝段落自己的字号**
  （c15w `firstLineChars=200 → wordPt=21.1`、`perCharPt=10.55`、`fontPt=10.5`；c8 `leftChars=200 → wordPt=22`、
  `perCharPt=11`、`fontPt=11`——`perCharPt` 逐枚等于本段字号）——旧那枚硬写的 16px/字在 c16b 那 282 枚字号可解的 `leftChars`
  臂上平均偏 0.15px、**最大 4.00px**（12 枚超 0.5px），全榜按 c9c：`firstLineChars` n=3500 均偏 1.37px/字、超 0.5px
  2136 枚，`hangingChars` 那 16 枚**枚枚差 −2.00px/字**；字号怎么解：段标 `w:rPr/w:sz` > 样式链（本体说了才覆盖 `w:basedOn`
  祖先）> 兜底，链上解不出字号的字符单独枚只有 13 枚、住 9 枚文件（c15）。⑧ **样式链底数与段标底数分叉那一档在真件里一枚都
  没有**（c14 `CTRL|分叉枚=0 件=0`）⇒ 不为它改道。

- **架构决定（跟着门面读数走）**：`mergePPr` 里 `w:ind` 那一枝改成 `mergeIndAttrs` **按属性名**合——同名者后写那层压前写那层、
  段落没写的属性留样式那一枚；`IND_SLOTS` 立两枚槽（`firstLine`|`hanging`、`firstLineChars`|`hangingChars`），
  **同槽只认后写那层**：那层写了槽里任一拼法，整槽就归它，另一层的另一拼法不再回来。其余同名子元素（`w:spacing` / `w:shd` /
  `w:pBdr`）仍走整枚替换、孩子仍取后写那层（与旧行为一字不差）——同形状的账本轮没量就不改道。`paraCss`
  新吃第三枚参数 `baseSz`，调用处传的是 `baseRunProps(view.chain, effPPr).sz`，**与正文渲染吃的是同一份字号账**；
  `charPx = Math.round(baseSz × HP_PX)`（半点 → px），解不出字号才退 15px（`.doc-content` 正文那 15px，
  `src/index.css:996`）。闸门三句：缇值先说话且**含 0**、字符档只在缇值整枚没写时说话且只认正数（`leftChars > 0` /
  `firstChars > 0`）、缇值与字符档同写那一档的组合本轮没量过所以不接。

- **验证（八腿，每枚数字都来自打印它的那一趟）**：**结构+变异腿** 11 臂五变体
  `B0|b17|arms=11|variants=5|fixMismatch=0|exit=0`——`BITE|v_m1=6`（合并枝退回整枚替换：A1/A2/A5/A6/A9/A11）、`BITE|v_m2=1`
  （`IND_SLOTS` 清空：A3 那一枚「段落写 0 而样式有悬挂」）、`BITE|v_m3=5`（底数退回 16px：A5/A6/A7/A8/A10），`DIFF|head->fix=9`；
  **真件读手腿** 17 臂 head/fix 两变体逐枚对照 `B0|b17|leg=leg17b|arms=17|variants=2`，六臂可见改动，例《M52H user
  manual.docx》#549 head `text-indent: 16px` → fix `margin-left: 7px; text-indent: 16px`（样式那枚 `w:left="103"`
  第一次够得着）、《授权变更说明函.docx》#16 fix 多出 `text-indent: 28px`；**独立字节腿** 17 臂 `B0|b17|leg=c22|arms=17`
  走 python 自己的单位路径（缇 → px 按 `1/15`、字符按本段字号），不吃自家读手一行代码，17/17 `idOk=True`；
  **三头合并判据腿** `B0|b17|leg=merge17|arms=17|wordHits=10|wordMiss=7|tolPt=0.5` ⇒
  `S|b17|三头通=9|两头通=1|只字节腿=6|Word不合=1`，且 `S|b17|head→fix改动枚=6` **全落在 keep-style 族**（c18b/16、c18b/573、
  c20/61、c20/62、c20/549、c20/556）——正是「样式写了段落没写」那一族；那枚 `Word不合` 由 `Q|归因` 钉死为门面量的不是本臂
  （UL212 门面上 `wordPt=-18.0` 而本臂字节折磅 `-6.0`，同一份样式里同名处有 6 枚）；**后果腿**
  `S|b17|件=1342|读过=1306|错=36`、`正文不同枚=0|非style处不同枚=0|段数不同件=0`、`段总=421001|变CSS件=202|变CSS段=2764`，
  改动按属性分 `text-indent: 1959 / margin-left: 1039 / margin-right: 1`（那唯一一枚 margin-right 住在《产品技术建议书模板.docx》#22）；
  **归因腿** `S|b17|HEAD就抛=36|HEAD不抛而提交件抛=0|两头都过=1306`——36 枚排除逐枚报名与原因（34 枚报 `End of data reached`、
  1 枚报 `expected 18 records in central dir, got 0`、1 枚报 `unexpected signature`），**没有一枚是「HEAD 能读而提交件读不出」**；
  **三头拆分腿**（154 秒）把两笔合起来的账拆开：
  `head→mg(合并那一笔)=件197|段2776`、`mg→fix(字符底数那一笔)=件11|段276`、`两笔都碰的段=259`，而
  `head→fix(两笔合起来)=件202|段2764|并集段=2793` ⇒ 并集比净数多 29 段：那 29 段先被合并那一笔改道、又被底数那一笔改了回来（净零，
  本轮如实记着）；同腿 `OK|三头正文与去 style 的形状逐字符相同——只搬形状不丢一字`；**编译腿**双证——先只吃提交件那一趟
  `tsc --noEmit` 零错（`SELF|提交件|md5=bc776b4e34c235324c2d4bea788fdcf9`、`TSC|exit=0`），另造一枚一次性 `__q17neg.ts` 拿
  `tmp/xmar18/ctree/src/__q17neg.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`
  证明那趟真跑了，探针随即删掉。

- **本轮踩到的量具坑（不是产品缺陷）**：① **Word 门面拿 URL 转义过的路径开件会一句「很抱歉，找不到您的文件」**——c8
  那批臂里同一段号有 `D:\//FAE/…%20….docx` 那种串，六枚候选只达一枚（`W|leftChars … wordPt=22`），要把真路径原样交给 COM
  才有读数。② **后果腿报「跳过 36 枚」而普查腿报 35 枚，两条腿都没错，是口径不同**：《【2605站外】独立站转化率提升10倍的产品详情页设计技
  巧.docx》的 `word/document.xml` 单独整份解得出来（普查按单成员解，把它算成可读），而我们的读手解整包——那件里
  `word/media/image6.png` 的本地头签名就不对、`image7.png` 解到一半坏（把整包成员逐个 inflate 才归因到这两枚），于是整件被跳。
  ③ **python 腿在 cp936 控制台下打印中文会变成 mojibake**（exit 0 而日志不可读），全套腿改 `PYTHONIOENCODING=utf-8`
  重跑，不改判据。④ 变异件与提交件三枚同族并存时 `B0|` 自证只认 md5：五棵变体树逐枚打印
  `SELF|v_*|bytes|lines|md5` 才敢把读数归到某一件上（`v_head c34513be…` 2065 行 / `v_fix bc776b4e…` 2122 行 / `v_m1 da5beca6…` /
  `v_m2 8bbfb0d7…` / `v_m3 baefeab9…`）。

- **本轮没动的量出来记着**（已开进路线图）：**同形状的漏账在 `w:spacing` / `w:shd` / `w:pBdr`
  上一样成立而本轮没量**（那三族同名子元素仍是整枚替换；普查榜上 `pPr|spacing@afterAutospacing`
  10404 枚/183 件那一类仍在账外）；**编号层没接**——`numbering.xml` 里 `w:lvl/w:pPr/w:ind`
  与段落自身的 `w:ind` 之间同样是属性级的账，本轮只在样式链上做；**字符档的字号只解两档**（段标 > 样式链 → 15px
  兜底），`docDefaults` 那一层的字号没接进来（c16b 量到 docDefaults 可解的有 4 枚）；**`rightChars`
  单独出现的枚数是 0**（c16b/c17）⇒ 右缩进那一档的字符写法本轮没有臂；**缇值与字符档同写的组合没量**（`w:left="0"` 配
  `w:leftChars="200"` 现在按缇值 0 处理＝不上账，而门面那一头怎么裁本轮不知道）；**`w:start`/`w:end`
  只在同一枚 `w:ind` 上归一**，跨层混拼没做别名合并（真件 0 例，做了也没读数证明该做）；**写侧没动**——docx/odt
  回写仍把缩进写成整枚 `w:ind`，存—重开一趟会不会把这份账改写，本轮没量；**屏上 / 纸面本轮没有读数**（dev 树由另一会话持有而本轮的
  dev 腿会关掉它全部标签 ⇒ 破坏性，不跑）。

- **收尾**：README 新增本节 + 两处就地改口（架构那节「段落 `w:pPr`（jc 对齐、`w:ind` 的
  left/firstLine/hangingChars/firstLine/hanging、pStyle 样式链继承）」补上「按属性名合」那句、文件清单
  `lib/docx-fidelity.ts` 那条把这一枝的账记进去）+ 路线图新开 八枚（`w:spacing`/`w:shd`/`w:pBdr` 的同一形状 /
  编号层的 `w:ind` / 字符档的 `docDefaults` 字号档 / `rightChars` 无臂 / 缇值与字符档同写 / `w:start`
  跨层归一 / 写侧整枚 `w:ind` 的存—重开 / 无 dev 与纸面腿）；历史各节的口径按节保留，不改写；**版本文件不入本提交**（0.119.0
  住着并发轮次的对齐号）；`tmp/xmar18` 的清单、基座、变体树、件副本与全部腿日志按惯例删除；并发会话的工作树此刻带着他们自己那一版
  `src/lib/docx-fidelity.ts`（md5 `8dbbd4a8…`，相对 HEAD 增 451 删 56）与 README ⇒ 本节与提交件都以
  `git show HEAD:…` 为底落 index-only blob，不去动他们那一份；**dev 树全程未碰**。


## 段前/段后与行距第一次按属性名继承：`w:spacing` 走上趟 `w:ind` 那同一枝梯子，而 `w:line` 与 `w:lineRule` 是同一枚槽里的两笔（后写那层要连主属性一起写，整槽才归它）、行档压缇档且「0」在两档上语义相反；`w:shd` 与 `w:pBdr` 量到真件里两层都在场 0 段 ⇒ 不为没读数的形状改道

按「不扩格式、把现有格式做深」的路线图开工。本轮吃的正是上一轮新开的那枚路线图项——样式链上同名子元素整枚替换的漏账在
`w:spacing` 上一样成立。窄口径：只动 `src/lib/docx-fidelity.ts`（相对 HEAD 增 49 删 29 = 11 段改动，其中 27 行是注释、21 行是代码、
1 行空白），Rust 一个字没动、docx/odt 写侧一寸没碰、模型属性一枚都不新增。接缝本来就在：属性级合并的形状上一轮已经落在
`mergePPr` 里（那时是一对专用的 `IND_SLOTS` + `mergeIndAttrs`），本轮把它通用化成一张表 `PPR_ATTR_SLOTS` 加一枚通用
`mergeAttrAttrs`，`w:ind` 从此只是表里的一行。**本轮不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json`
现在住着并发轮次的 0.119.0 ⇒ 本节按内容命名。

- **前置实测（Word 16.0 当段落间距与行距的门面，夹具 24 枚臂 `A0`~`A23`，只量不改产品）**：①
  **整枚替换在 `w:spacing` 上丢的账比 `w:ind` 那一枝更集中**——带 `w:spacing` 的段 29931 枚（c2 `在场|spacing=29931`），其中
  「样式链写了而段落那一枚整枚替换扔掉」的段 1801 枚、住 52 枚文件（c1 `spacing|多层在场段=6275|丢账段=1801|仅样式链内=727|文件=52`），
  而段落层丢掉的最大头是**行距**不是段前后（c3 `段落层丢的样式属性|line(正)=679 lineRule(负)=679`——两枚总是成对写、跟着一起丢），
  其次 `before(正)=411 / beforeLines(正)=282 / afterLines(正)=268 / after(零)=151 / after(正)=147`；样式链内部（`w:basedOn`
  相邻两层都写 spacing）另有 727 段，槽榜 line=897 / lineRule=897 / beforeLines=460 / afterLines=446 / before=439 / after=301。
  ② **`w:line` 与 `w:lineRule` 在真件里从不单独出现**（c2 `段_line带rule|段=23038|文件=150`、`段_line单独=0`、`段_rule单独=0`）
  ⇒ 它们是一枚槽里的两笔；可**跨层混写法是 0 例**（c2 `跨_段rule压样line=0`、`跨_段line压样rule=0`、`跨_样rule非auto而段line无rule=0`）
  ⇒ 主属性闸对真件是 no-op，只有夹具 A3/A13 量得出它有事。③ **行档压缇档、且不看在哪一层**（A4：样式 `before="120"` 而段落
  `beforeLines="100"` → 门面 12pt 而不是 6pt；A5：反向的段落缇档压不过样式的行档；真件里同层并立 873 段/28 件、跨层两种写法
  70 段/4 件与 282 段/9 件，c2/c3 `before×beforeLines 正/正=746`）。④ **「0」在两档上语义相反**：行档的 0 不算说话却压得住同名
  前写层（A19 段落 `beforeLines="0"` 压掉样式的正数 → 门面 `beforePt=0`；A18/A20/A21 行档 0 压不住同层缇值也压不住样式那层 →
  退回缇档），缇档的 0 则直接是真值（A6/A7；真件 `段_before零而样非零=593段/27件`、`段_after零而样非零=507段/31件`）——
  两档不能共用一条真值判断。负数那一头 0 枚（c4 `beforeLines|正=1050|零=339|负=0|非数=0`、`afterLines|正=845|零=338|负=0`）。
  ⑤ **行档的底数在 Word 那里是 12pt/行**（九枚行档臂 A4/A5/A8/A12/A14/A15/A17/A22/A23 的 `beforePt`/`lineUnitBefore` 全按 12pt
  折），我们的 19px/行 偏 3px/行——本轮只量出来记着，不改道。⑥ **Word 的 Normal 自报 after=8pt、before=0** ⇒ 判据腿里 14 处
  「缺省档」门面有读数而我们整枚不发言（缺的那一层不补）。⑦ **`w:*Autospacing` 从不被 consult**：c1A 在场段 1537/1547、
  置真段 297/304、与绝对值并立 1248/1256 段、住 36/38 枚文件，c2 还有 `跨_段autospacing压样before=621段/12件` 的形状 ⇒
  那两枚属性名在我们的读手里一枚都不吃，本轮只留注释。⑧ **`w:shd` / `w:pBdr` 的同形状在真件里够不着**：c1 同普查
  `shd|多层在场段=0`、`pBdr|多层在场段=0`（在场枚数并不少——c2 `在场|shd=1842|pBdr=706`，只是从不两层都写）⇒ 没读数的形状不改道。

- **架构决定（跟着门面读数走）**：`PPR_ATTR_SLOTS: Record<string, AttrSlot[]>` 一张表写全「哪枝元素按属性名合、槽怎么分」——
  `ind` 两槽（`firstLine`|`hanging`、`firstLineChars`|`hangingChars`）、`spacing` 一槽
  （`{ members: ['line', 'lineRule'], primary: 'line' }`）。通用那一枚 `mergeAttrAttrs(base, add, slots)` 定三条：同名者后写那层
  压前写那层、这一层没写的属性留前写那枚、**槽内加主属性闸**——后写那层必须把 `primary` 也写了整槽才归它，只写 `lineRule`
  的那层把 `w:line` 让给前写层。夹具两枚臂有读数：A13（样式 `line="360" auto` + 段落只写 `lineRule="atLeast"` → 整槽归样式，
  门面 `rule=1 lineSpacingPt=18`＝1.5 倍，与我们的 1.5 同一档）；A3（样式 `line="240" exact` + 段落只写 `lineRule="atLeast"`
  → 同样整槽归样式，门面的磅数同为 12pt，而它那句 `rule=4`（atLeast）是从段落来的——**数字通而型别按样式**，本轮照
  门面数字走而不为型别的写法改道）。其余同名子元素（`w:shd` / `w:pBdr`）仍走整枚替换、孩子仍取后写那层，与上一轮一字不差。
  `spaceOf` 的两档次序按门面**倒过来**：旧那一枚是缇档优先（`w:before` 在场就不看行档，而行档的 0 被当成「没声明」），本轮改成
  行档只要 >0 就压过缇档（同层并立与跨层同判，A4/A5/A8/A12/A14/A15/A22/A23）、缇档含 0 都是真值（A6/A7）、行档 ≤0 且缇档
  整枚没写才落 0 而不是「没声明」（A19）。本轮的两笔账——「属性级合并」与「行档压缇档」——正落在这两处，拆分腿把它们分开
  各算了一遍。

- **验证（六族腿，批号 b18g；每枚数字都来自打印它的那一趟）**：**结构+门面判据腿**（同一趟读手两列各判各的）24 臂——
  提交件（`SELF|md5=e39efb90…`）`Y|合计|结构不合臂=0|档不合=0|缇数字不合=0|行档底数差=9|缺省档=14`，改前对照（headlib
  `bc776b4e…`＝HEAD）`结构不合臂=20|档不合=40`；**变异四支各咬各的集合** `BITE|v1(摘掉 spacing 槽)=20 臂(A1~A15,A18~A22)`、
  `BITE|v2(撤主属性闸)=2 臂(A3/A13)`、`BITE|v3(把缇档排回行档之前)=8 臂(A4/A5/A8/A12/A14/A15/A22/A23)`、
  `BITE|v4(撤「行档 ≤0 → 0」那一枝)=1 臂(A19)`；**真件 head↔fix 对照 + 后果 + 归因腿**（清单 313 枚）
  `B0|b18g|r1|清单=313|两头都读成=279|head抛=34|fix抛=34`、`R|件面|有段落样式差=50|块面差=2100`、改动按属性分
  `margin-top=1594 margin-bottom=1310 line-height=890 --oof-lr=490`、后果 `正文不同件=0|块枚不同件=0`（只搬样式账，不搬一个字）、
  归因 `head抛集合与fix抛集合相同`（34 枚全报 `End of data reached … Corrupted zip ?` 的截断件）；**举例腿**打印真身两枚：
  《项目管理实用表格(1).docx》#7 head `text-align: center; margin-top: 16px; margin-bottom: 8px` → fix 多出
  `line-height: 24px; --oof-lr: atLeast`（样式那两枚 `w:line`/`w:lineRule` 第一次没被段落的整枚替换扔掉，正是 c3 那 679 段的形状）、
  同件 #11 head `margin-top: 8px` → fix `margin-top: 9.5px` 并补上样式那一枝的行距（段落缇档与样式行档并立，行档说话）；
  《M52H user manual.docx》#294 fix 多出 `margin-top: 2.47px`；**拆分腿**（154 秒量两笔账）
  `head→v6lib(只属性级合并)=件41|块1404`（`line-height=890` 与 `--oof-lr=490` 全在这一笔里）、
  `head→v1lib(只行档压缇档)=件20|块910`（属性面只有 `margin-top=805 margin-bottom=629`）、
  `head→fixlib(两笔合起来)=件50|块2100` ⇒ 件面重叠 11 枚、块面重叠 214 段（41+20−50 与 1404+910−2100）；**残留闸**
  提交件上 `IND_SLOTS=0 mergeIndAttrs=0 mergeAttrAttrs=2 PPR_ATTR_SLOTS=4`——上一轮那对专用名字已完全退场；
  **编译腿双证**：`tsc --noEmit` 本次总报错 1 行，而那一行来自一次性负控制
  `src/lib/__qneg18.ts(2,14): error TS2322: Type 'string' is not assignable to type 'number'.`（证明那趟真跑了），
  提交件本身 `COMMIT|__qcommit18 报错行数=0`，探针随即删掉并 `P1|清理后 src/lib 残留探针=0`。

- **本轮踩到的量具坑（不是产品缺陷）**：① **两条 vite-node 并行会在 `node_modules/@esbuild/*` 上撞 `ENOTEMPTY`**（整批腿
  一起红），全套改串行；② `pnpm exec tsc` 偶发 `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "tsc" not found`——并发会话正在动
  `node_modules`，重试即绿，**绝不把这一条当「编译通过」**；③ 判据列里「行档形状」的换算把倍率写成 `19/12` 而正确的是
  `(19×0.75)/12`，一枚笔误把九臂全报成「档不合」的假阳——**形状不合与底数不合要分列**，底数差是 19px/行 那枚已记账的账；
  ④ 门面日志的行式是 `W1|<段号>|<臂名> <段号> |style=…`，按「`W1|4|` 加臂名」去 grep 会零命中，只按臂名才达；⑤ 注释里
  「本轮 8 枚行档臂」与实测 9 枚不符——按纪律这算重汇编，整批换批号 b18g 在最终源文上复跑，`B0|` 自证只认 md5。

- **本轮没动的量出来记着**（已开进路线图）：**`w:shd` / `w:pBdr` 的属性级合并没做**——真件里两层都在场 0 段，做了也没读数
  证明该做；**`w:beforeAutospacing` / `w:afterAutospacing` 两枚属性名一枚都不吃**（置真 297/304 段）；**Word Normal 的
  after=8pt 缺省档不补**（判据腿 14 处缺省档）；**行档底数 19px/行 vs Word 12pt/行**（九臂差 2.25~4.5pt）；**主属性闸对真件
  no-op**（跨层混写 0 例，只在夹具 A3/A13 有读数）；**编号层没接**——`numbering.xml` 里 `w:lvl/w:pPr/w:spacing` 与段落自身的
  `w:spacing` 之间同样是属性级的账；**`docDefaults` 那一层的间距没接进来**；**写侧没动**——docx/odt 回写仍把间距写成整枚
  `w:spacing`，存—重开一趟会不会把这份账改写，本轮没量；**屏上 / 纸面本轮没有读数**（dev 树由另一会话持有而本轮的 dev 腿会
  关掉它全部标签 ⇒ 破坏性，不跑）。

- **收尾**：README 新增本节 + 两处就地改口（架构那节「段落 `w:pPr`（jc 对齐、`w:ind` …）」补上 `w:spacing` 同一枝、文件清单
  `lib/docx-fidelity.ts` 那条把这一枝的账记进去）+ 路线图勾掉上一轮新开的那枚 `w:spacing`/`w:shd`/`w:pBdr` 项（`w:spacing`
  做完、另两枝按实测另立可达性项）+ 新开六枚（`w:shd`/`w:pBdr` 无臂 / `w:*Autospacing` 从不 consult / Word Normal 的 after=8pt
  缺省档 / 行档底数 19px vs 12pt / 写侧整枚 `w:spacing` 的存—重开 / 无 dev 与纸面腿）；历史各节的口径按节保留，不改写；
  **版本文件不入本提交**（0.119.0 住着并发轮次的对齐号）；`tmp/xmar19` 的清单、基座、变体树、件副本与全部腿日志按惯例删除；
  并发会话的工作树此刻带着他们自己那一版 `src/lib/docx-fidelity.ts`（md5 `8dbbd4a8…`）与 README ⇒ 本节与提交件都以
  `git show HEAD:…` 为底落 index-only blob，不去动他们那一份；**dev 树全程未碰**。


## 属性级覆盖率第一次有公开的账：`docs/fidelity.md` 的分子不是「实现了多少命令」，而是「真件导入那一趟里读手按名查过哪些对」

按「不扩格式、把现有格式做深」的路线图开工，但这一轮一寸产品源都不动：前十九笔账每笔都在补一枚具体的属性，
而「还差多少」从来没有一枚可重跑的数——只有逐笔的普查。本轮把量具本身做成公开产物：`scripts/fidelity-report.mjs`
（生成器）、`scripts/fidelity-census.py`（独立分母腿）、`docs/fidelity.md` 与 `docs/fidelity.json`（只有聚合数字，
不含任何路径或文件名——语料是每个人本地的那些件）。口径是两枚数：**分母**＝同一批件的 7 枚部件里全部
`元素|属性` 字面，**分子**＝读手在真实导入那一趟里按名查问过的对。分子来自运行时探针，注入只发生在
`src/lib/ooxml.ts` 的 `attr` / `attrL` 两枚漏斗上（整条读入链按名取属性只走这两处，`attrNum = attr ?? attrL` 继承覆盖面），
而注入的对象是从 `git show HEAD:src/lib` 整层取出的一次性副本（50 枚文件），产品工作树一个字节没改：
`src/lib/ooxml.ts` 工作树 md5 与 HEAD 同为 `5058e526…`，`src` 里 `__PROBE` 残留文件=0。三档归因：consulted（查问过）、
never consulted（从没查问过）、noise（`rsid*` / `paraId` / `textId` 按名字规则归零语义档）。两轴诚实话写在报告开头，
不等别人读出来：**查问过 ≠ 落进 CSS**（`w:top/@w:space` 读了只为出一句告警），**没查问 ≠ 看得见错**
（`w:szCs` 管复杂文种，`xml:space` 管我们分词器本来就留住的空白）。**本轮不占版本号**：`package.json` / `Cargo.toml` /
`tauri.conf.json` 现在住着并发轮次的 0.119.0 ⇒ 本节按内容命名。

- **前置实测与头条读数（313 枚本机真件，只量不改产品）**：读手 279 枚读成、34 枚抛（全是截断 zip，带探针那趟与
  不带那趟抛的集合相同），探针查问到的对=126；同一趟用我们自己的解析器全树数属性字面 ⇒ **701 对 / 3,108,523 枚**。
  分档：噪音 19 对 / 770,634 枚，有效宇宙 682 对 / 2,337,889 枚，已查问 120 对 / 1,184,292 枚，从没查问 562 对 /
  1,153,597 枚 ⇒ **覆盖率按对 17.6%、按字面 50.7%**。从没查问的最大几枚：`rFonts|hint` 136,408、`szCs|val` 96,610、
  `lsdException|name` 66,628、`rFonts|cs` 60,132、`lang|val` 41,620、`t|space` 34,771、`spacing|val` 25,271（这一对从本节的字符读侧第一笔账起搬进「已查问」，报告本身按纪律没重跑）；按元素归并
  的头几档 `rFonts` 283,998 / `lsdException` 212,720 / `szCs` 96,610 / `lang` 77,664 / `pt` 57,908。已查问那一档的头几枚
  `rFonts|ascii` 100,937 / `sz|val` 99,708 / `rFonts|hAnsi` 92,695 / `tcW|w` 与 `tcW|type` 各 41,582——十九笔账买的属性
  正住在这张表里，而这是它第一次有一个数。

- **验证七腿，每枚数字来自打印它的那一趟**：① **真值腿**（`--selftest`，内置夹具不依赖任何语料）应看到 16 枚全命中、
  不该看到 9 枚全落空，打印 `SELFTEST|双向断言通过`，夹具单趟 `查问对=33 查问次数=58 blocks=1`；② **等价腿**
  （`--clean-pass`：带探针的副本与不带的那份逐字节比 html）`相同=279 不同=0 两边同错=34 只一边错=0`——观察者不扰动产品，
  而正是「只一边错」那一格归零才逼出了下面第④条；③ **独立分母腿**（`zipfile` + `xml.etree`，完全另一条解析路）
  `files=313 files_ok=279 files_bad=34`、`distinct_pairs=701 total_occ=3108523 noise_occ=770634 meaningful_occ=2337889`，
  再逐对对照 `只在python=0 只在node=0 同对不同数=0`——分母不是自说自话；④⑤ **变异腿两枚**：`--mut no-attrL` ⇒
  `注入=[attr] 探针记录对=118 按对=16.6% 按字面=50.6%`，掉出账面的 7 对枚枚是带前缀的关系 id（`blip|embed` 1,827、
  `imagedata|id` 201、`docPartGallery|val` 10、`hyperlink|id` 26、`OLEObject|id` 3、`begChr|val` 1、`endChr|val` 1）——只有
  `attrL` 够得着那一档，`--mut no-attr` ⇒ `注入=[attrL] 探针记录对=31 按对=4.1% 按字面=8.3%`，掉 92 对；⑥ **确定腿**：
  同一份清单同一枚 rev 两趟逐字节相同（不带等价腿那一对 `md5=2c693733…`，带的那一对 `67b179bd…` 且与盘上 `docs/` 那份
  `cmp` 相同）——报告里没有时钟，所以它的 diff 就是保真的 diff；⑦ **结构腿 + 编译腿**：注入锚点每枚命中一次（命中≠1
  直接中止；三趟日志分别打 `注入=[attr,attrL]`、`[attr]`、`[attrL]`），公开产物里盘符、反斜杠、MSYS 形态、家目录痕迹、
  真实文件名全名与主干命中**七项禁词全零**；`tsc --noEmit` 干净趟 `报错行数=0 输出字节=0`，另配一次性负控制拿到
  `src/lib/__q19neg.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.` 证明那趟真跑，探针随即删掉、
  `src/lib` 残留探针=0。

- **本轮踩到的量具坑（不是产品缺陷）**：① **注入的那一行绝不能以 `(` 开头**——`attrL` 的前一行是
  `if (!el) return undefined`，而「换行 + `(`」在无分号下是上一行的续写，于是 `(__PROBE as any).note(...)` 被读成
  `return undefined(__PROBE.note(...))` ⇒ `TypeError: undefined is not a function`；它只在 `el` 缺席那一枝求值，又只在
  那枚件真的走到 `attrL` 时才走到 ⇒ 假象是「带探针的副本读坏了 108 枚真件」而产品读手全好。归因链：直接把那枚函数
  拿出来调用不抛 → 两份模块层只差 `ooxml.ts` → 绝对 URL 与相对 URL 是同一枚实例（不是双份模块）→ 逐 variant 二分
  （只撤 `as any` 就绿，把类型标注加回去不会红）⇒ 与 TypeScript 无关，是 ASI 续行；再造一枚最小夹具**复现不出来**，
  如实记成负结果（凶器是那枚 `return undefined` 前行，不是 cast 本身）。抓住它的是等价腿的「只一边错=0」；② **诊断腿
  自己把路径转坏了**：POSIX 形态转 Windows 形态时写 `d.toUpperCase() + '/'` 漏了冒号 ⇒ 拼出「盘符不带冒号再接绝对
  路径」那种谁也找不到的串而全批 ENOENT，而报告脚本里那一行本来就是对的——所以**诊断腿必须自证**「清单=313 打不开=0」，否则「读不到」会被当成
  「覆盖率低」报出去；③ 控制台是 gbk，`print` 中文与 `⇒` 直接 `UnicodeEncodeError` ⇒ 读数一律落文件再读；④ 两枚
  `vite-node` 并行在 `node_modules/@esbuild/*` 撞 `ENOTEMPTY` ⇒ 本轮所有腿串行（一枚 `legs.sh` 顺序串五趟，每趟 19~20 秒）。

- **本轮没动的量出来记着**（已开进路线图）：**分母只算读手吃进去的 7 枚部件**（`word/settings.xml`、`fontTable.xml`、
  `theme1.xml`、`docProps/*` 一概不在账内）；**探针只吃 `attr` / `attrL` 两枚漏斗**，任何直接读 `el.attrs[...]` 的查问不进账 ⇒
  「从没查问」那一档里可能混着「其实读了而没走漏斗」的形状；**等价腿只裁 html 逐字节**，不裁 `blocks` 与告警以外的出口；
  **语料是本机那 313 枚**而产物不含文件名 ⇒ 换一批件数字就换一批，目前没有可复核的固定语料；**「查问过 → 落进 CSS →
  屏上/纸面可见」的第二段没接**，这枚覆盖率是查问率而不是视觉平价率；**噪音档按名字规则归**而不证明零语义，`--mut`
  只演示「漏注入会让覆盖率降」而没有「假注入让覆盖率虚高」的正控制。

- **收尾**：README 新增本节 + 两处就地改口（v0.37 那节的 mammoth 兜底句尾挂上这枚公开的账、架构那节的 `scripts/`
  清单补上 `fidelity-report.mjs` 与 `fidelity-census.py`）+ 路线图新开六枚（部件之外的分母 / 漏斗覆盖面 / 等价腿的裁面 /
  语料不可复核 / 查问≠上屏的第二段 / 噪音规则与缺正控制）；**版本文件不入本提交**（0.119.0 住着并发轮次的对齐号）；
  并发会话的工作树此刻带着他们自己那一版 `src/lib/*`（9 枚改过 + 3 枚新增，其中不含 `ooxml.ts`）与 README ⇒ 本节以
  `git show HEAD:README.md` 为底落 index-only blob，不去动他们那一份；**dev 树全程未碰**；`tmp/fidelity-mod`、
  `tmp/fidelity-clean` 与本轮的一次性腿件随收尾清盘。


## 字符间距第一次上屏：`w:rPr/w:spacing` 的缇折磅走 `letter-spacing`，而段落标记那一层的间距一律不进正文的基准；`docs/fidelity.md` 榜上那枚 `spacing|val` 25,271 从此搬进「已查问」

上一节把量具本身做成公开的账，而挑账的规则本来就写着「下一笔账可直接从 never-consulted 榜挑，但挑之前要先给那枚对配一枚后果腿」。
本轮挑的是那张榜上第一个与「看得见」同形的对：`spacing|val` 25,271 枚（按字面算第 7 大），后果腿先量清——HEAD 读手在 265 枚真件的
HTML 里落 `letter-spacing` 字面**0 枚**，而字节层有 25,961 枚带 `w:val` 的 `w:spacing`（其中 25,557 枚住在真 run 的 `w:rPr` 下），
1,679 段至少有一枚真 run 带着间距：一份 Word 里明显拧松或拧紧过的字，我们屏上一寸没动。

- **前置实测（299 枚本机真件 + Word 16.0 门面十臂，只量不改产品）**：`c1` 独立字节腿——`w:spacing` 元素在 document+styles 两层共
  56,383 枚，按父元素 pPr=30,390 / rPr=25,993，而 **pPr 下带 `w:val` 的枚数=0**：同一枚元素名住两族，段落的走 `line`/`lineRule`/
  `before`/`after`（上一节那笔账），字符的这一族只走 `val` ⇒ 报告里那 25,271 枚**整档**归字符；rPr 这一族的符号分布
  负（紧缩）=20,237 / 正（加宽）=4,139 / 零=1,617，极值 -200..180 缇＝-10.00..9.00 磅，带声明的件 35 枚（七部件口径 46 枚）、
  单件枚数榜首 22,900。`c1d` 把七部件口径的祖父榜钉住：`r`=25,557 / `pPr`=404（段落标记）/ `lvl`=44（编号层）/ `style`=32。
  `c2` 对照腿给后果腿打底：HEAD 的 HTML 总长 451,897,446 而 `letter-spacing` 字面枚数=0，走到的 `w:spacing`=55,419（带 val=25,961）、
  段=1,727、有真 run 带间距的段=1,679、真 run=25,557、只有段落标记那层的件=0。`c3`/`c3b` Word 门面十臂 + 写回字面：
  `textSpacingPt` 依次 0/1/-1/0/10/3/5/0/0/5，另存回来的 `w:val` 依次 NONE/20/-20/NONE/200/NONE/100/0/NONE/100 ⇒ **磅＝缇/20 且负值照收**、
  样式链传下（A5=3）而 run 压样式（A6=5）、**0 在压过样式时是真值**（A7 写回 `w:val="0"`）而样式链本身没账时 Word 把这枚 0 整枚丢掉
  （A3 写回 NONE）、**段落标记那层的间距不传给正文 run**（A8 正文 0 而标记自己 4，写回 `mark=80`），A9（标记 4 + run 5）里 run 照旧赢。

- **架构决定四枚**（`src/lib/docx-fidelity.ts` 一枚文件，净增 17 行：注释 9 / 代码 8 / 空 0）：**E1** `RunProps` 加 `sp?: number`（379 行，
  单位照字节层留缇，折磅只在出口做）；**E2** `readRPr` 收 `const sp = valNum(el, 'w:spacing')` 且 `if (sp !== undefined) o.sp = sp`
  （408-409）——闸门是「这一层有没有写这枚数」而不是「写没写出非零」，所以 0 覆盖样式那一枚（A7）而缺省才留样式（A5）；
  **E3** `baseRunProps` 里段落标记那一层先留住 `const sp = p.sp`，读完 `paraMark` 之后**只在标记自己声明了间距时**把它按回去
  （435-437）——等价于「标记那层的 `w:spacing` 一律不进正文基准」，而这一层原有的粗体/字号/字色照旧当基准用，一处没改口径；
  **E4** `cssOf` 出口 `letter-spacing: ${p.sp / 20}pt`（450）。选 `letter-spacing` 而不是 `word-spacing` 或自定义变量：这一族在 OOXML 里
  就是逐字符加宽，且屏上那一路本来由 `marked()` 套 `style`，不新增模型属性、不动 docx/odt 写侧、Rust 与界面一寸没碰。

- **验证七腿，每枚数字来自打印它的那一趟**：① **结构腿 15 闸全合**（`V1|闸数=15 不合=0`）——旧那枝 `readRPr(paraMark, p)` 单行式
  在提交件里残留=0、新枝 `if (paraMark)` 开块=1、`valNum` 吃 `w:spacing`=2（真 run 与标记层各一枚）、`letter-spacing` 出口=1、
  `p.sp !== undefined`=1、`sp?: number`=1，四枚定义/调用处计数 head↔fix 相等（`baseRunProps` 1/2、`readRPr` 1/5、`cssOf` 1/2、
  `marked` 1）⇒ 只改了函数体而没有改形状；写侧出口=1 枚且 docx 写侧函数名命中 head=0 fix=0（相等＝写侧一寸未动）。
  ② **夹具判据腿**：一枚 2,010 字节夹具（md5 `d105fb20…`）配 Word 门面那十臂，HEAD `letter-spacing` 字面枚数=0 而**十臂里七臂**是
  「无字面而 Word 非 0」；提交件 `判据：提交件合臂=10/10 不合臂=无`，落 8 枚字面，新落臂＝A1plus20:1 A2minus20:-1 A3zero:0
  A4plus200:10 A5styleonly:3 A6stylerun:5 A7stylezero:0 A9markrun:5。③ **变异腿六枚**：m1 撤读属性 ⇒ 判据咬 6 / 形状咬 8；
  m2 撤 E3 那一枝 ⇒ 判据咬**恰 1 臂且那臂是 A8**（我=4pt 而 Word=0pt，方向按门面读数裁）；m3 把 0 不当真值 ⇒ 判据咬 1＝A7stylezero
  （我=3pt）；m4 撤出口 ⇒ 6/8；m5 单位折错（`/10`）⇒ 判据咬 6 而**形状咬 0**（字面照样在场，只有磅数错：2/-2/20/6/10/10pt）；
  m6 良性只改注释 ⇒ 咬 0，`静默变异枚数=1` 正是它。判据（磅数）与形状（字面在否）分列就是为了让 m5 那种「在场而数错」不被形状掩盖。
  ④ **真件后果腿**：清单 299 枚、打不开文件=0、读成 head=265 fix=265、抛 34 且两头集合相同（`unreadable-zip=34`）；HTML 总长
  451,897,446 → 452,509,318（净增 611,872），`letter-spacing` 字面 head=0 → fix=**25,150**、落字面的件=35；符号 负=20,060 / 正=4,015 /
  零=1,075，`|磅|` 分档 0=1,075、<0.1pt=8,381、0.1-0.5pt=14,467、0.5-1pt=513、1-4pt=589、≥4pt=125；`style` 串枚数差=9 且
  `<span style>` 枚数差=9 ⇒ **每一枚新增 style 串都配一枚自己的 span**（不往既有元素硬贴属性，`marked()` 有 CSS 才套壳所以
  「元素不增删」不是本轮不变量）；变 CSS 件=35 块=24,961；**去标签去空白正文逐字符相同：不同件数=0（总字数=4,956,768）**⇒
  只搬形状不丢一字。⑤ **拆分腿**：把「这笔账」拆成两笔——head↔fix 变 CSS 件=35 块=24,970；fix↔e3（E3 退回单行式）值袋口径
  有差件的件=7、多涂 102 枚、少涂 0 枚，逐位块口径件=6 块=94 且块面分类里「改数=0 / 串序变=0 / 反向少涂=0」。
  字面枚数 `fix=25150 e3=25252`——**撤掉那一枝要多涂 102 枚**，而 `闸 合 值袋差=102 与字面枚差=102 同数`；e3 那 102 枚的榜
  （-0.15pt×14、-4.5pt×12、-1.9pt×12、-0.1pt×12、-1.8pt×11、1.05pt×11、1pt×8、-0.25pt×8…）就是「把标记那层的间距错传进正文」的形状。
  ⑥ **编译腿双证**：镜像整棵 HEAD 的 `src`（64 枚）+ 三枚配置文件出两枚一次性工程，`闸 合 除 docx-fidelity.ts 外逐字节相同：相同件数=63`；
  两趟 `tsc --noEmit` 各 `趟数=1 退出码=0 报错行数=0 字节=0 工具没跑起来=0`、`两枚工程报错集合逐行相同：不同行数=0`；一次性
  `__q19neg.ts` 拿到 `error TS2322: Type 'string' is not assignable to type 'number'.`（趟数=1 退出码=2 字节=104）证明那趟真跑，清探针后
  复跑仍零错。工作树那份带着并发轮次的 318 行净增（md5 `8dbbd4a8…`／2,459 行）而提交件 md5 `220b5566…`／2,158 行，`src/lib 脏件数=12` 不变。
  ⑦ **归因腿两趟**：v4 量到「document.xml 有声明的件=35，其中提交件一枚字面都没落的=2」，`v7` 先把整批件的祖先链按读手真实分支归类——
  落字面那批的容器榜 body=25,278（`/r`=25,045、`/pPr`=233）、tbl=678、txbxContent=3，不落那批只有 body=2；`v7b` 再把那 2 枚的形状打全：
  `spacing 全名=w:spacing 属性键=[w:val] val 字面="0"`、`r 子=[rPr,drawing] run 文本长度（含空白）=0` ⇒ 那两枚是**只有图片而没有一字文本的 run**，
  走到 `case 'drawing'` 就 push 一块并 `return`（1089-1093），拿不到套 `style` 的那一路；且它们写的都是 0 ⇒ 即便上账也是 `0pt`，屏上无可辨差异。
  同腿另一笔差额自证：`有声明的件(46) - 落字面的件(35) = 11`，其中「声明只在 document.xml 之外」11 枚贡献 9 枚、另 2 枚经 footnotes/endnotes
  的同一条 run 路落了字面。

- **本轮踩到的量具坑（不是产品缺陷）**：① **`Read`/编辑自己也会造坑**：装配脚本 Edit 时去掉行尾换行，把 `HS=$(grep -c …)` 粘进上一条
  `say` 的参数 ⇒ `set -u` 当场 `line 102: HS: unbound variable`、SCRIPT_EXIT=1，而日志里前面四枚闸已经打成「合」——**脚本自己也要按语句数
  自证**，「闸全绿而脚本当场死」是会骗人的形状；② **变异腿的索引只能待在它自己的回调里**：把 `filter((r,i))` 的 `i` 写进后续 `map` 的模板串是
  运行时 `ReferenceError` 而静态一路放行（vite-node 那趟直接起不来）；③ **镜像工程里 `pnpm exec` 找不到 `.bin`**：`(cd 镜像目录 && pnpm exec tsc)`
  四趟全是 `Command "tsc" not found`／`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`，正解是在仓库根 `pnpm exec tsc -p "$dir/tsconfig.json"` 并按工具自己的
  失败字面探测——tsc 成功不打印任何字，「没跑起来」与「跑起来零错」长得一模一样；④ **`comm -3` 前必须剔掉报错行自带的工程路径前缀**：
  两枚镜像工程的报错行只差前缀，第一版于是报「不同行数=2」的假红；⑤ **归因腿的容器名单要对着读手真实的分支写**而不是照 OOXML 词汇表猜：
  第一版塞了 `hdr`/`ftr`/`sdtContent`/`contentControl` 等几枚这份读手根本不认的名字，第二版换成 `AlternateContent`/`Choice`/`Fallback`/`pict`/
  `smartTag`/`tbl`/`txbxContent` 并在日志里说明「归类只看祖先里最先命中的那一枚」；⑥ **一件工具用错口径就整批错位**：`v7` 里 `silentFiles.map(f => '')`
  那行永远打 2，是无信息的残行，换成每件枚数的直方才算读数。

- **本轮没动的量出来记着**（已开进路线图）：**屏上与纸面两头没量**——本轮判据是「读手输出的 CSS 串」对 Word 门面的 `Font.Spacing`，
  屏上排版宽度与打印那一层需要 dev 树，而它归并发会话；**编号层 `w:lvl/w:rPr` 那 44 枚从不落屏**（`readNumbering` 只取编号形状）；
  **样式链与标记层同写间距**那一臂没进夹具（A5/A6/A7 裁的是 run↔样式，A8/A9 裁的是标记↔run），sty/style=32 枚在真件里走哪条次序未逐臂量；
  **写侧没有出口**——docx / odt 都不写 `letter-spacing`，我们打出去的文件不带字符间距；**`letter-spacing: 0pt` 的字面形状与 Word 不同**
  （A3 那侧 Word 另存回来是 `NONE`，A7 是 `0`），本轮按「读手说 0 就落 0」而不模仿 Word 的丢弃；**报告里那枚 `spacing|val` 要重跑才搬得动**：
  本轮清单是 299 枚而 `docs/fidelity.md` 那批是 313 枚，不同批重跑会同时改分子与分母 ⇒ 不可归因，故本轮不重跑；**只有图片/域代码这类
  不落文本的 run 拿不到这一枚 CSS**，本轮只把那 2 枚归因到 `case 'drawing'`，没穷举同族的其他分支。

- **收尾**：README 新增本节 + 三处就地改口（v0.37 那节的「覆盖」条挂上字符间距、架构那节文件清单的 `lib/docx-fidelity.ts` 补上这一层、
  fidelity report 那节的 never-consulted 榜就地指一句）+ 路线图新开七枚（屏上与纸面 / 编号层那 44 枚 / 样式链与标记层同写那一臂 / 写侧出口 /
  `0pt` 的字面形状 / 报告重跑要同批清单 / 无文本 run 的同族分支）；**本轮不占版本号**（`package.json` / `Cargo.toml` / `tauri.conf.json`
  现在住着并发轮次的 0.119.0，本节按内容命名）；并发会话在场 ⇒ 只动 `src/lib/docx-fidelity.ts` 一枚**且不落工作树**：全部量具吃
  `git show HEAD:src/lib` 整层出的一次性副本，README 以 `git show HEAD:README.md` 为底落 index-only blob，**dev 树全程未碰**；
  `tmp/b19` 的夹具、十份日志与七枚一次性腿件（`headlib`/`fixlib`/`v3m*`/`v4head`/`v5e3`/`v5head`/`v7head`/`headproj`/`fixproj`）随收尾清盘。

## 字符间距第一次有出口：docx 走 `w:rPr/w:spacing@w:val` 的缇、ODT 只走 `fo:letter-spacing` 这一条通道，而 0 那一档在两头是两笔形状——docx 落不下（库的真值闸整枚吞掉），ODT 写得出去而 Word 读作缺省

上一节把这一层读上屏，收尾时留了一句「写侧没有出口——docx / odt 都不写 `letter-spacing`，我们打出去的文件不带字符间距」。
本轮挑的就是那一句，而动手前先量「ODF 那一头 Word 到底读得到哪条通道」——表格写侧那笔账的教训就摆在那儿：
`fo:minimum-row-height` 规格允许而门面不进账。两头量完才发现这一档在 docx 与 ODT 是**两笔形状**，于是出口写两遍而 0 的账只记一次。

- **前置实测（写侧现状 + 两头门面裁定，只量不改产品）**：`c1` 把候选形状各出一件（docx 五臂 + ODT 十一臂），`c1b`/`c1c` 读自己的字节——
  `characterSpacing: 200` 写手落 `<w:rPr><w:spacing w:val="200"/></w:rPr>`、`-60` 落 `-60`，而 **`characterSpacing: 0` 那一臂连 `w:rPr` 都不出**
  （`rPr=NORPR`）；同臂字符串 `"2pt"` 被原样涂成 `w:val="2pt"`（一枚 OOXML 读手再也解不出的字面）。`c1d`/`c1e`/`c1f` 量「绕开库那道闸」的代价：
  字符串喂进 `signedTwipsMeasureValue` 会**被补零**（`0→"00"`、`1→"01"`、`200→"200"`），而 Word 16.0 把那枚 `w:val="00"` **另存一趟整枚丢弃**
  （`ZeroRun:NOELE`），同批夹具里字符串写的 `w:val="200"` 原样保留 ⇒ **0 在 docx 这一头只能记账不能上纸**，两条路都量过才敢这么写。
  `c2` 是同一趟门面吃两头：ODT 十一臂里只有 `fo:letter-spacing` 那一枚 `content_spacing=2`，而 `style:letter-spacing`、`loext:letter-spacing`、
  `loext:letter-spacing-padding`、`loext:kerning` 八枚**全报 0**；docx 那五臂的 `9999999` 不是错误而是 Word 的 `wdUndefined`——「这段区间里各 run 不同」，
  它恰恰证明值到了 Word（夹具都是 Plain+Spaced 两枚 run）。`c3`/`c3b` 把 `fo:` 那一族的层级量全（八臂）：character style 层 2、paragraph style 层 2、
  `styles.xml` 具名样式层 4、负数 `-2` 读得到、`0pt` 与无声明同形、`0.0706cm` 折成 2；且同一块样式里 `bold=-1`/`size=24` 照旧读到 ⇒
  那一族是**被跳过**而不是整块样式没进。`c4` 真件普查（清单 307 枚、可读 269、抛 38 全是截断 zip 与 `~$` 锁文件；本轮这批与上一节的 299 枚不同批）：
  字节层 `w:spacing@val` 按父元素分 run=24,826 枚/29 件、段落标记层=345 枚/21 件、样式层=40 枚/15 件（character 25 + paragraph 15）、兜底枝 0 枚。
  `c5` 静态扫写侧：`docx.ts` 与 `odt.ts` 里 `letter-spacing` 出口**0 枚**，而自家 ODT 字符样式实际发射的属性名单 16 枚里没有这一族——
  「写了什么」打的是发射名单而不是 OOXML/ODF 词汇表，否则这份漏账会照着词汇表猜出一堆不存在的通道。

- **架构决定四枚**（净增 90 行：`char-spacing.ts` 71 枚新行 + 三处纯插入 7/9/3，删除 0 行、整行替换 0 行）：**E1** 新建 `src/lib/char-spacing.ts`——
  `toLetterSpacingPt` 只收 pt/px 两档（px 按 96dpi 乘 0.75），判别式手写（`em`/`calc`/逗号/`10pt 3pt` 简写/`e` 记数全落不进来）且规范化到三位小数，
  `letterSpacingToTwips` 再 ×20 取整，同一文件里 `CharSpacing` 扩展把 `letterSpacing` 挂成 `textStyle` 的全局属性（`parseHTML` 吃 `el.style.letterSpacing`、
  `renderHTML` 发 `letter-spacing: Npt`）；**存的形状跟 `fontSize` 那一族走（带单位的规范化串而不是数字）**，因为两条写手通道都只认字符串，
  而数字会在写侧被当成「没声明」。**E2** docx 出口（`docx.ts`）：`const lsTw = letterSpacingToTwips(ts('letterSpacing'))` 且只在
  `lsTw !== null && lsTw !== 0` 时给库传 `characterSpacing: lsTw`——那道 `!== 0` 是**记账闸**而不是功能闸（见验证⑤的 m2）。
  **E3** ODT 出口（`odt.ts`）：mark 采集新键 `ls`（`sp` 已被上下标占了，两族挤同一枚键会互相顶掉），发射只走 `fo:letter-spacing`，
  0 在这一头写得出去（`m.ls` 真值闸留 `"0pt"` 而不是 null）。**E4** 接线（`DocEditor.tsx`）：`CharSpacing` 注册在 `TextStyleKit.configure` 之后，
  与 `backgroundColor`/`lineHeight` 同挂一枚 `textStyle`——保真导入发的那句 `letter-spacing: Npt` 到这一步才进得了模型，此前它在 `setContent` 就被剥掉。
  docx 与 odt 的**读侧**、Rust、界面把手、模型其他属性一寸没动。

- **验证十一腿，每枚数字来自打印它的那一趟**：① **结构腿 31 闸全合**——HEAD 三处出口各 0 枚而提交件各 1 枚、`style:letter-spacing"="` 与
  `loext:letter-spacing"="` 各 0 枚（通道没走错）、ODT 的 `ls:` 与 `sp:` 各 1 枚且 `text-position` 枚数 4/4 不动（上下标那族没被撞）、
  `char-spacing.ts` 里 `letterSpacing` 出现 5 枚而 `docx`/`odt` 一个都不 import（把手不吃写手）、注册点在 `TextStyleKit.configure` 之后、
  三枚件 difflib 纯插入 7/9/3 而纯删除 0 与整行替换 0、CR=0×3。② **生成腿 20 形状臂 × 两头 40 件落盘**（10pt / −3pt / 2.5pt / 0.05pt / 16pt /
  9pt（px 档）/ `+3pt` / 带空格 / `10.pt` / 与上标共存，另 10 枚本就不该落的：`normal`、`calc(4px)`、`10,5pt`、`1.5em`、空串、裸文字、`10pt 3pt`、
  无单位、`0`、`-0`）。③ **独立字节腿 45 闸**（python 自己解 zip，不借 TS 那条路）：docx 落 10 枚 `w:val`（200/−60/50/1/180/…）、ODT 落 12 枚
  `fo:letter-spacing`（含 `0pt` 两枚）、**段落层 `w:spacing` 污染 0 枚**、其他 letter-spacing 通道 0 枚、命名空间只出现 xsl-fo 那一族、每件事件正文完整。
  ④ **把手腿 44 闸**：41 行输入里 24 枚规范化幂等、17 枚归 null。⑤ **变异腿八枚**：m0 对照件三头 `bites=0/0/0`；m1 撤 docx 出口 ⇒ docx 咬 10 而 odt/handle 各 0；
  **m2 撤那道 `!== 0` 闸 ⇒ 三头全 0 咬**——这正是「0 被吞」发生在库而不在我们的闸的证明；m3 撤 ODT 发射、m4 把 `ls` 键恒置未声明 ⇒ odt 各咬 12；
  m5 把手只认 pt ⇒ 1/1/4；m6 单位只切一枚（前置实测抓到的那枚真缺陷形状）⇒ 9/11/20 且把手腿自己从 44 臂变 48 臂、`idem` 24→0；
  m7 把 0 当「没声明」⇒ odt 咬 2、handle 咬 3 而 docx 咬 0（docx 咬不到是因为它本来就不写 0，与 m2 同一枚事实的两侧）。⑥ **浏览器 CSSOM 门面腿 17 闸**
  （真 Blink/Chrome 150，与 WebView2 同族引擎）：29 枚值过 `el.style.letterSpacing` 与 `getComputedStyle` 两头，`10pt → 13.3333px` 即 4/3 换算、
  把手的 px×0.75 是它的逆；UA 拒收而把手收的只有 `10.pt` 一枚、把手拒收而 UA 给值的有 `1e1pt` 一枚 ⇒ **覆盖面按「谁更宽」分列而不报「相同」**；
  `normal`/`calc(4px)`/`1.5em` 三枚账外；`0.0001pt` 在 DOM 存活而进把手归 `0pt`。⑦ **Word 门面腿 12 闸**（40 件只读、`Close(0)`、GUARD 0/0）：
  落账的十臂两头同数（`10`/`-3`/`2.5`/`0.05`/`16`/`9`/`3`…，最小档 `0.05pt` 在 Word 里存活），八臂 `0` 与无声明同形，上标臂 `bold=-1` 与间距共存，
  而默认字号底数 docx=10、odt=11——那是两头默认样式那一层的既有差，不是本轮引入。⑧ **后果腿两半**：供给半（吃提交件读手 + 两头写手）量到真件一趟发出
  `letter-spacing` 字面 24,644 枚、住 32 件、**153 枚不同值**（负 114／正 38／零 1，`|pt|` 最大 10），并为这 153 枚各出一件 docx 与一件 odt；
  字节半判 `dx_landed=152`（唯一不落的就是 0 那枚）、`od_landed=153`、把手三份副本（TS 两处 + python 一处）逐枚同意、逐件正文完整、段落污染 0、杂通道 0。
  ⑨ **覆盖面腿**：提交件 `src/**` 65 枚里与 HEAD 相同 61、不同 3（正是 `docx.ts`/`odt.ts`/`DocEditor.tsx`）、HEAD 里没有的 1（`char-spacing.ts`），
  意外污染 0、漏交 0。⑩ **往返腿 7 闸**：那 152 枚写出去的件再走自家读手读回来，**每枚恰好一枚 `letter-spacing` 字面且与发出去的那一枚同数**
  （读回 152 枚不同值），0 那枚按「落不下」的形状读不回来（`zero_rows=1`、`leaked=0`），每件事件正文俱在——这一腿把「写侧对字节」与「读侧对 CSS」两半接成一圈。
  ⑪ **编译腿双证**：镜像工程自证等于提交件（四枚件与 index blob 逐字节相同=4、不同=0、`src` 65 枚），三趟 `tsc --noEmit`——干净两趟各
  `退出码=0 报错行数=0`，中间插一枚一次性 `__q20neg.ts` 拿到 `error TS2322` 证明那趟工具真跑过，清探针后复跑仍零错，`探针残留=0`×2。

- **本轮踩到的量具坑（不是产品缺陷）**：① **「0 落不下」的两条路不同形**：数字 0 被库的 `if (options.characterSpacing)` 真值闸整枚吞掉，
  字符串绕开那道闸会写出 `w:val="00"` 并被 Word 另存丢弃；而**数字串还会被补零**（`1→"01"`、`0→"00"`、`200→"200"`）——
  用字符串喂一条只认数字的通道，盘上字面会静默变形，只有独立字节腿看得见。② **门面的 `9999999` 是 `wdUndefined` 而不是失败**：
  多 run 区间的 `Font.Spacing` 报「各 run 不同」，把它当错误会把五臂「值确实到了 Word」读成全红。③ **ODF 里 `loext:` 前缀不声明 xmlns 会让整份
  `content.xml` 解析失败**（`unbound prefix`），而「写了这一族」与「Word 读得到这一族」是两笔账——本轮通道选择由门面八臂裁而不由规格文档裁。
  ④ **门面腿要把同块里的 bold/size 一起打**：只有 `spacing=0` 时，「这一族不进账」与「这件文件根本没打开」两种解释分不开。
  ⑤ **腿的日志 0 字节不等于通过**：本轮最先跑的两趟编译日志是 0 字节（tsc 成功不打印任何字），换成「趟数/退出码/报错行数/字节/工具没跑起来」
  五枚一起自报才叫读数——0 字节与「跑起来零错」长得一模一样。⑥ **跨腿对文件名要各自补零**：供给半把序号补到 4 位而字节半按 `'v' + idx` 找文件，
  第一趟 `FileNotFoundError` 全红；两条腿各自成立不代表它们对得上。⑦ **属性名单要打发射的那份而不是词汇表**：`c5` 打的 ODT 字符样式属性名单
  （16 枚）是发射事实，照 ODF 规格猜会列出十几种这份写手从不写的属性，漏账就藏在那种名单里。

- **本轮没动的量出来记着**（已开进路线图）：**ODT 读侧不吃 `fo:letter-spacing`**——我们写得出、Word 读得到，而自家 reopen 一件 `.odt` 时这一层整批丢（下一节「ODT 字符间距读侧第一笔账」已闭这一层）
  （`resolveStyle` 只认字重/斜体/下划线/删除线/字色/底色/字族/字号/上下标那九族）；**界面上没有字符间距的把手**，本轮打通的是「导入→模型→导出」这一圈，
  用户手动设这一层没有入口；**docx 的 0 要真上纸得绕开库**（自己写 `<w:spacing w:val="0"/>`）或在模型里把「0」与「没声明」分家；**屏上排版后果没量**
  （行宽、换点、是否撑出、打印分页）——那一头要 dev 树而它归并发会话；`w:styles` 里 character 样式那 25 枚经样式链传给 run 的**那一步**在写侧走的是
  run 层出口，样式链传下这一层没逐臂量；**同族的 `w:w`（字符缩放）与 `w:position`（升高/降低）没量**；`docs/fidelity.md` 榜上那枚 `spacing|val`
  仍要同批复跑才搬得动（本轮清单 307 而报告那批 313）。

- **收尾**：README 新增本节 + 三处就地改口（v0.37 那节的「覆盖」条挂上写侧出口、架构文件清单的 `lib/docx.ts` 与 `lib/odt.ts` 两条各接这一枚）+
  文件清单新增 `lib/char-spacing.ts` 一条 + 路线图勾掉「写侧没有字符间距的出口」并新开七枚（ODT 读侧 / 界面把手 / docx 的 0 / 屏上后果 /
  样式链传下那一步 / `w:w` 与 `w:position` 同族 / 报告同批复跑）；**本轮不占版本号**（`package.json` / `Cargo.toml` / `tauri.conf.json`
  现在住着并发轮次的 0.119.0，本节按内容命名）；并发会话在场 ⇒ 四枚件全走 index-only blob、**工作树那三份带着他们的改动一寸没碰**，
  量具吃提交件镜像（`tmp/b20/proj`）与 `git show HEAD:src/lib` 副本，dev 树全程未碰；`tmp/b20` 的夹具、日志与一次性腿件随收尾清盘。

## ODT 读侧第一次吃 `fo:letter-spacing`：那份九族名单外的一整族第一次上屏，而差额一枚一枚归到名字，mm 那一档的宽度底数在这条枝上错了 10 倍

上一节（字符写侧第一笔账）收尾时把「ODT 读侧不吃 `fo:letter-spacing`」写进了「本轮没动的量出来记着」：我们写得出、Word 三层门面读得到，
而自家读手把同一件 `.odt` reopen 回来时这一层整批丢。本轮挑的就是那一句，量法照段落读侧那两笔账——先在字节层数底数，再让 HEAD 读手在真 Blink 里跑一趟
证明「不是落不进 CSS 而是压根没查问」，最后才动那一枝。动完才发现这一枚枝底下的单位梯子自己就是错的，而那笔账不归本轮改。

- **前置实测（只量不改产品）**：`c0b`/`c0c` 出 34 枚 `.odt` 夹具（A 批 12 枚走自家写手、B 批 22 枚手写各种单位与层级形状）另加 1 枚 `.docx` 对照；
  `c1a` 静态扫 HEAD 的 `resolveStyle`——查问名单只有九枚（`fo:font-weight`、`font-style`、`text-underline`、`text-line-through`、`color`、
  `background-color`、`font-name`、`font-size`、`text-position`），名单里没有 letter-spacing 这一族；`c1b`/`c1c` 是独立字节腿（python 自己解 zip，
  不借 TS 那条路）数出的底数：**字节层间距字面 32 枚**（`fo:` 30、`style:` 1、`loext:` 1，住 31 枚件）；`c2` 读手对照腿（真 Blink，HEAD 装成
  `reader_head.js`）在 34 枚件上落 `letter-spacing` 字面 **0 枚**而件件读成、抛件 0、正文一字不差 ⇒ 这一族在 ODT 那头是「整枚没查问」而不是
  「查问了而落不进 CSS」。同一位对照另有一枚：`A04` 与 `B22` 那两件里字重与字号照旧上屏、`B15` 沿 parent 链传下的粗体照旧上屏，缺的只是查问那一句。

- **可达性分派（30 枚 `fo:` 一枚一枚归类，`d1`）**：字符族 27 枚住 `resolveStyle` 一步就够得着的位置——content.xml 自动样式层 25 枚（A 批 10 枚住
  `style:family="text"`、B 批 14 枚住 `style:family="character"`、再加 `B11` 那枚「属性直接写在 `style:style` 身上」靠 `pick() ?? el` 那一枝）
  + styles.xml 具名样式层 2 枚（`B14` 直接引到、`B15` 沿 `style:parent-style-name` 传下）；段落族 2 枚（`B12` 自动段落样式、`B13` 具名段落样式链上传下）；
  `style:default-style` 1 枚（`B16`）。对账 25+2+2+1=30，与字节腿那一行同数；`style:` 与 `loext:` 那两枚按上一节的门面裁定继续不吃。

- **架构决定三枚纯插入 + 一处注释改口**（只动 `src/lib/odt.ts` 一枚件：4 hunk、增 14、删 1、整行替换 1，1630 行 → 1643 行、CR 枚 0）：**E1**
  `StyleInfo` 加 `ls?: string`，注释钉「规范化成 `"Npt"`」⇒ 存的形状与 docx 那一头同一份账；**E2** `resolveStyle` 在同一个 `tp` 上查问
  `fo:letter-spacing`——pt/px 直接进 `lib/char-spacing.ts` 的 `toLetterSpacingPt`，落不进才走 `lenPx` 那一枝折成 px 再折回来，且闸门是
  「这一枚属性在场」而不是「值非零」，所以 `0pt` 是真值；**E3** `htmlOfStyle` 的出口 `letter-spacing: ${si.ls}`，与字族/字号/字色同一枚
  `textStyle` 壳（那一枚壳不能嵌套两层同类 mark，注释本轮接上「字距」二字）；**E4** 读侧收的串就是写侧发的那一份形状 ⇒ reopen 一件自家
  `.odt` 从此不必借道 Word。先折 pt 再折 px 那个次序是有读的：`0.05pt` 直取时原样过，先折成 px 再折回来会变成 `0.053pt`（三位小数），
  `A11` 那枚最小档就是为这一枚次序立的臂。

- **验证九腿，每枚数字来自打印它的那一趟**：① **结构腿 16 闸**（`e7`）——提交件对基座恰 4 hunk/增14/删1/整块替换1；`ls` 声明枚=1、读侧查问枚=1、
  CSS 出口枚=1、直入 char-spacing 枚=1、lenPx 回折枚=1、全件 `fo:letter-spacing` 枚=3（声明注释、查问、写侧各一枚），而 head 的读侧查问枚=0、
  写侧字面枚 head=new=1；headlib↔newlib 同名 51 枚件里逐字节相同 50，唯一不同的是 `odt.ts` ⇒ 其它 lib 一寸未碰。② **读回腿六趟**（真 Blink，`e6`）：
  HEAD 的 odt 头=0 枚，提交件 **26 枚住 24 件**，含负（`-1.5pt`）、含 0（`0pt` 三枚）、含最小档（`0.05pt`）、含列表项/表格格/标题三种容器
  （`B19`/`B20`/`B21` 各 1 枚）。③ **归因腿**：30（字节层 `fo:`）− 段落族 2（`B12`/`B13`）− `style:default-style` 1（`B16`）− `em` 与 `normal` 2
  （`B06`/`B07`，`lenPx` 与把手双双拒收）= 25 枚该落，而 `A12` 那枚自动样式被两段引用故落 2 枚（+1）= 26 = 提交件读数 ⇒ 每一枚差额都有名字。
  ④ **变异腿四枚**（`e0` 生成器逐枚打 md5、行数增减、锚点残留与新句式命中：m1/m3/m4 各「旧句式残留=0 而新句式命中=1」，m2 是删行所以新句式
  天然为 0 而行数 −1；锚点不合件=0）：**m1** 撤 pt/px 直入那一趟 ⇒ 咬 5 件 6 枚
  **值失真**（`A04` 2→2.003pt、`A05` 5→5.002pt 与 −2→−2.002pt、`A09` 1→0.998pt、`A10` 4→3.998pt、`A11` 0.05→0.053pt）而**枚数一毫不动**；
  **m2** 撤 CSS 出口 ⇒ 咬 24 件 26 枚全不落（读得到而不上屏）；**m3** 把查问的名字换成 `style:letter-spacing` ⇒ 26 枚 `fo:` 全不落而 `B17` 那枚
  `style:` 落 1 枚——**这是本轮最贵的读数**：它证明不吃 `style:`/`loext:` 是门面裁定而不是可达性限制（那两枚就住在同一枝上够得着）；
  **m4** 把 `0pt` 当成「没说」⇒ 恰咬 `A03`/`B08`/`B10` 三枚。⑤ **docx 对照腿**：`D01` 在六趟里恒 1 枚 `3pt` ⇒ 本轮改动与四枚变异都只咬 ODT 一枝。
  ⑥ **后果腿**：六趟正文（去标签去空白、35 件按夹具顺序串起来）sha256 前 16 位全为 `bc03a4127a7a5552`、字数合计 326 全同 ⇒ 只搬形状不丢一字。
  ⑦ **往返腿六档**（`e9`）：`3pt`/`-1.5pt`/`0pt`/`0.05pt`/`12pt`/`1pt` 各经自家写手出件，python `zipfile` 独立数字面
  `fo:letter-spacing@content.xml` 逐臂与输入同串，提交件读回 1 枚同值而 HEAD 读回 0 枚 ⇒ 写侧↔读侧这一圈在 ODT 那头第一次闭合（含 0 那一档：
  它在 ODT 是「写得出去而 Word 读作缺省」，而自家读手按「在场」收）。⑧ **写侧不变腿**（`e10`/`e10b`）：同一批六档分别用 HEAD 装件与提交件装件写盘，
  件级 md5 六臂 0/6 相同（写出时间戳必然不同，这一枚不能当不变量）⇒ 改按 XML 部件逐个比：六臂清单相同 6/6、部件逐枚相同 5/5、`content.xml`
  逐臂 md5 相等 ⇒ 本轮对写出的字节一寸未动。⑨ **副本与编译双证**：`e2` 先自证量具吃的就是 HEAD（66 枚件剥 CR 后与 `git show HEAD:src/lib`
  逐字节不同=0，其中 `odt.ts` md5=`570a31084e4f25349f4fb17cf277dddd`、1630 行）；`e3` 在一次性镜像工程上跑 `tsc --noEmit`，提交件与四枚变异件
  各趟报错行数=0（五趟，含提交件复跑，每趟打 `odt_md5` 自证装进去的就是那枚件，提交件为 `2193e70b713cafd043f28b13a9b48c66`），
  中间插一枚一次性 `__q21neg.ts` 拿到 `error TS2322` 证明那趟工具真跑过，清探针后残留=0。

- **本轮踩到的量具坑（不是产品缺陷）**：① **zip 件级 md5 在写侧不是不变量**：写出时间戳使六臂件级 md5 全不同而 XML 部件逐枚相同——
  「写侧没动」只能按部件比，同一件事 `e10` 报 0/6 而 `e10b` 报 5/5，口径必须写在日志里而不是留在脑子里。② **「写得出去而读不回来」与「够不着」
  是两笔账**：只有 m3 那种「把查问的名字换掉」的变异能把它们分开；若只测「落不落屏」，会把「门面裁定不吃」读成「这一层根本读不到」，
  下一轮就会去做一条本来没用的通道。③ **值失真是枚数判据的盲区**：m1 那六枚照样落屏、枚数不动，只有把逐臂的**值袋**打出来才看得见——
  「先折一趟 px」这种改法在只数枚数的腿上永远是绿的。④ **`python -m http.server` 只吃 GET**：往返腿要把浏览器里写出的字节带回盘上，
  POST 收到 501 而页面那边看不出来，得自写收件件（`e8_sink.py`，带 CORS 与 `do_OPTIONS`）。⑤ **Bash 工具的 cwd 跨命令持续**：上一趟留在
  `tmp/b21` 而下一趟又写 `cd tmp/b21` 就变成 `tmp/b21/tmp/b21`（exit 2、整条腿根本没跑），路径一律写绝对正斜杠。⑥ **内联 python 的字面反斜杠
  会被 shell 吃掉**：`'\\'.join(...)` 落到解释器是 `'\'` ⇒ `SyntaxError` 而什么都没写，改 `p.replace(os.sep, '/')`；与「含反斜杠的字面一律落 .py 文件」
  是同一条纪律。⑦ **归因式要把「一枚样式被两处引用」的 +1 单列**：否则 25 与 26 那一枚差额看起来像漏读，而它其实是同一枚样式落进两个 span。

- **本轮没动的量出来记着**（已开进路线图，其中头两句由下一节量出来）：**真件 `.odt` 的 ODT 读侧覆盖面没量**——`e10` 数盘上 od 族只有本轮那 34 枚夹具，一头真件都没有
  （docx 那两批真件清单 313 / 307 枚里没有 `.odt`）；**`lenPx` 的 mm 档与裸数档共用 37.795 这个因子** ⇒ `B03` 那枚 `1.058mm` 折成 29.993pt
  而按 mm 该是 3.0pt（cm 那枚 `0.106cm → 3.008pt` 是对的，裸数按 cm 也自洽），同一枚梯子还被 11 处 `lenPx`/`len2px` 调用吃着（下一节在夹具 HTML 上把这 10× 量成了读数，并量出它在真件上一枚都够不着，而两枝 mm 由 ODT 长度 mm 档第一笔账改到并配上四批判据）（缩进、格边距、
  段落边距、表宽、行距…）⇒ 修它是整族改道加一枚判据腿的事，不为单独一枚间距在这一轮撞它；`em` 与 `normal` 两档落不进（读成未声明）；
  段落族那 2 枚（`resolveStyle` 从不为段落样式取任何字符属性，字重/字号/字色同样不取）；`style:default-style` 那一层整层不可达（`B16`，
  读手 `styles` Map 只收 `localName === 'style'` 而它自己的注释写着两种都收）；屏上与纸面两头没量。

- **收尾**：README 新增本节 + 两处就地改口（架构那节文件清单的 `lib/odt.ts` 那条把「读侧 `resolveStyle` 还没吃这一族」接成本轮那枚查问、
  字符写侧那节「本轮没动的」第一句挂上「下一节已闭」的指针）+ 路线图勾掉「ODT 读侧不吃 `fo:letter-spacing`（写得出去而读不回来）」并新开六枚
  （真件覆盖面 / `lenPx` 的 mm 档 10× 偏 / `em` 与 `normal` / 段落族那 2 枚 / `style:default-style` 那 1 枚 / 屏上纸面没量）；
  **本轮不占版本号**（`package.json` / `Cargo.toml` / `tauri.conf.json` 住着并发轮次的 0.119.0，本节按内容命名）；并发会话在场 ⇒
  `src/lib/odt.ts` 走 index-only blob（工作树那份落后 HEAD 九行、带着他们自己的改动，一寸没碰），README 同样以 `git show HEAD:README.md`
  为底落 index-only blob，量具吃 `git show HEAD:src/lib` 副本（`tmp/b21/headlib`）与提交件镜像（`newlib`/`m1lib`…`m4lib`），dev 树全程未碰；
  `tmp/b21` 的夹具、日志与一次性腿件随收尾清盘。

## ODT 读侧第一次有真件语料：77 枚件跑通运行时查问面，覆盖率第一次有「按对」的账，而 mm 那 10× 在这一批真件上一枚都够不着

上一节收尾时挂了两句话：一句是「真件 `.odt` 一头没量，要跑得先攒一份语料」，一句是「`lenPx` 的 mm 档与裸数档共用 37.795 这个因子 ⇒ 全族 10× 偏」——这一句由 ODT 长度 mm 档第一笔账闭（两枝 mm 各换成每毫米的系数而 terminal 一寸没动）——
后一句只有两枚夹具读数撑着。本轮是前置实测轮（只量不改产品，docx 与 odt 两头写侧、Rust、界面、模型属性、版本文件一寸没碰），做的就是把这两句
各自变成有名字的数：语料攒出来了（77 枚件、件件读成、抛 0），读手「这一趟到底按名查过哪些对」第一次有了运行时的账，而 mm 那一档在手工夹具上确实在、
在这批真件上一枚都不在——后者不是好消息，它指向另一笔账（具名样式的段前段后完全不上屏）。

- **语料的来源与成色**：一枚公开办公套件仓库里的 odfimport 测试数据目录，只取 zip 型成员（目录条目 98 枚、zip 型 75 枚、单 XML 的 flat 型跳过 21 枚、
  解包 ok=75 bad=0）另加自家 Word 16.0 另存的 2 枚 ⇒ 77 枚。那 75 枚里是 74 枚 `.odt` 加 1 枚 `.ott`（模板后缀，读手吃的容器相同而腿的枚举按
  `odt|ott` 两档写），所以「按 `*.odt` 一枚枚点」会数出 76 而腿报 77——这一枚差是后缀不是丢件，取件腿与枚举腿必须共用同一份后缀表。
  写手分布按件里的 generator 数：LibreOffice 正式版 34 枚（从 3.5 一直到 24.2.0.3，22 个档）、LibreOfficeDev 26 枚（最高 26.2.0.0.alpha0）、
  OpenOffice.org 5 枚、OpenOffice 3 枚、NeoOffice、Collabora_Office、MicrosoftOffice/14.0 各 1 枚，另 generator 缺席 3 枚、整份 meta.xml 没写 1 枚。
  那 2 枚 Word 写的**逐字节相同**（同一枚 md5，正反两方向各存一回）⇒ Word 写手有效一枚。**盘上此前没有外部真件 `.odt`**：`c0` 扫整盘只找到 1234 枚 `.docx`
  （294 个目录、1,104,639,679 字节）而 od 族一头为零，本轮取件之后再扫一回（`c0c`：整盘 + 桌面/文档/下载三处、见过 735,155 枚文件、
  od 族命中 77 枚，且那 77 枚全住在本轮的临时目录里＝就是本批语料）⇒ 上一节说的「没量」不是不想量而是盘上没件可量，而这一轮之后「有件可量」
  也仍然只在这批被忽略的临时目录里成立。

- **Word 门面这条腿是负结果**：批量把 docx 另存成 odt（60 枚清单里挑 6 臂，逐件独立 Word 进程 + 120 秒硬看门狗）**六臂全 TIMEOUT、ok=0**；
  按批准的「先杀掉先前会话留下的那两枚 WINWORD 实例（pid 31728 与 38988，其中一枚累计 cpu 1116.3 秒、无窗口标题）」再重跑，四臂仍旧停在
  `step=save fmt=23` 那一行没有下文、产物目录空。另把 Word 那两处目录与本批夹具目录扫出的 4 枚 `~$*` 锁文件隔离出去（moved_total=4）。
  ⇒ **本轮没有 Word 判据腿**，ODT 这头的判据仍是「自家读手 + 独立字节腿」两头（与表格写侧那笔账同门），而门面那头的 SaveAs 卡死另立一枚未勾。

- **三档口径各自的数（这就是「覆盖率」这个词以前混用的地方）**：① 字节分母（python 自己解 zip，77 枚件、zip_bad=0；分母部件口径 = 读手会打开的那三件
  content.xml + styles.xml + `Objects/*/content.xml`，在扫 154 枚 = 两件各 77，账外 229 枚 = manifest 77 + meta 76 + settings 76）
  = **808 对 / 64,919 枚字面**；② 静态查问面（扫 `git show HEAD:src/lib/odt.ts`，1644 行）= 属性名 **61 枚**，与分母按名 join ⇒ 已查问 178 对 /
  24,690 枚 / **38.0% 字面**、只同 local 名 71 对 / 1,263 枚 / 1.9%、整枚从没查问 559 对 / 38,966 枚 / 60.0%；③ **运行时查问面**（把 HEAD 那份读手装成
  一次性副本、在真 jsdom 的 `DOMParser` 上跑 77 枚件，探针只记录每一次按名查问）= **88 对 / 52,071 次命中，files_ok=77、thrown=0**。

- **覆盖率第一次有「按对」的数**：运行时那 88 对里 **69 对在分母里** ⇒ 覆盖字面 **19,244 枚 = 29.6%**，比按名那份的 38.0% 低 8.4 个百分点；
  差额不是「又量错了一回」而是两个口径——按名把不同元素上同名的属性并成一档（`style:name` 在 `style` 与 `text:style` 上是两回事）。
  另 **19 对查问了而这批真件没写字面**（读手问的是别的写手会写的形状）：`paragraph-properties|style:line-height` 与 `-method`（那是 ODF 行高的另一种写法）、
  `style|fo:*` 八枚（字符属性直接写在 `style:style` 身上那一族）、`table-row-properties|fo:min-height` 与 `minimum-row-height`、`text-properties|fo:font-name` 等。
  **零命中的对 = 0 枚**：凡列进查问面的都在真件里真开了火。

- **两头互校（这正是那份公开产物的静态腿该证的事）**：静态名 61 / 运行时名 54，**runtime_only = 0** ⇒ 静态扫描器是运行时查问面的 sound 超集；
  静态独有 7 枚在这批语料上从未开火（`fo:column-gap`、`office:mime-type`、`style:distance`、`text:endnote`、`text:endnote-citation`、
  `text:endnote-reference`、`text:note-class`）——前四枚是脚注/尾注族，这批 odfimport 件里没有带注的段落。
  上一节刚接的那条字符间距通道在真件上第一次有底数：字节层 `text-properties|fo:letter-spacing` **89 枚**，运行时按名开火 **597 回**
  （这一句由下一节量成读数：89 枚里 66 枚落屏、23 枚没落的按 raw 值分派恰好全是 `normal`）。

- **腿的自证（三枚，缺一枚这轮的数都不算量过）**：① **观察者不改变被观察者**——带探针与关探针两趟 77 枚件的 HTML **逐枚 md5 全同**（聚合
  `70b500f6a6f67353`），关探针那趟 `consulted=0`；② **变异腿咬得住**——摘掉 `paragraph-properties|fo:margin-top` 那一句按名查问 ⇒ 88 对 → 87 对，
  差集恰为那一枚而反向差集 0，真件 HTML 变掉 5 枚件（`tdf123829`、`tdf165156`、`vmerge-cell-border` 与 Word 那两枚）而 77 枚件的正文
  去标签去空白字数全同 ⇒ 只搬形状不丢一字；③ **自测腿有判据**——一枚手工夹具上六枚 must_see（`fo:margin-top/-bottom/-left`、`fo:text-indent`、
  `fo:letter-spacing`、`fo:font-size`）全在场、两枚 must_not_see 全缺席，`consulted=32 / hits=38`、告警 0。

- **mm 那 10× 从静态推断升级成真读数，而它在真件上够不着**：同一份夹具（自动样式层写 `fo:margin-top="2.12mm"`、`fo:margin-bottom="4.23mm"`）
  HEAD 落 `margin-top: 80.13px; margin-bottom: 159.87px`，只把 `lenPx` 的 mm 系数换成 3.7795 落 `8.01px` / `15.99px`，HTML md5
  `18859033fa52` → `78fda8dc503e` ⇒ **10.0× 坐实**。而同一改动在 77 枚真件上 **动 0 枚件**、查问面对不变（88 对同）。逐枚归因（独立 python 腿，
  只吃带 mm 长度的那两枚件）：**33 枚「有出口的」mm 字面全住 styles.xml 的 `office:styles` 具名样式**（`Quotations`、`Text_20_body`、`Caption`、
  `Subtitle`、`Heading`、`Heading_20_1`…`Heading_20_7` 那一族段落样式，按名逐枚打回），其中 **30 枚是段前/段后**——读手 `resolvePara` 里那句
  `namedStyles.has(sn) || FIXED_PARA_STYLES.has(sn) ⇒ continue` 正坐在 `fo:margin-top`/`margin-bottom` 的查问之前（源码顺序自证：`len2px` 那三枚问在闸前、
  `lenPx` 那两枚问在闸后，12 枚 FIXED 名单逐枚打回）；另 **3 枚**（`Quotations` 的左/右缩进与首行缩进）问在闸前，但那枚样式在这件里**没有任何段落引用、
  也不在任何被引名沿 `style:parent-style-name` 往上的闭包里** ⇒ 进不了解析。剩下 12 枚 mm 字面住 `page-layout-properties` 的自动页样式层而吃另一把
  已经对的 `cm2mm` 尺。三把尺的分族与上一批独立腿逐一对齐：`lenPx` 30=30、`len2px` 3=3、`cm2mm` 12=12，paragraph 枚 33 与 `mm_with_exit=33` 同数。
  ⇒ 本轮的账：**mm×10 是「直接格式那一枝」上的潜伏缺陷，对这批外部真件不可达**；这批真件在段落边距上的可见缺陷是**具名样式的段前段后完全不上屏**，
  而那道 continue 是带理由的设计（注释写的是「具名样式里的那些是整篇的默认，摊到每一段上就等于把默认值写成直接格式，导出再开会长出一整篇的显式行距」）
  ⇒ 改它不是补漏而是换设计，要先把「写回时长出一整篇显式边距」那笔代价绕开。

- **本轮踩到的量具坑（不是产品缺陷）**：① **探针记的键必须与普查的键同形状**——一度按 `parentElement.localName` 记成 `style|fo:margin-top` 而普查记
  带属性那枚元素自己的 `paragraph-properties|fo:margin-top`，两头永远对不上，自测腿六枚 must_see 全红而读手其实是对的；② **夹具的样式放哪一层决定腿
  成不成**——放 `office:styles` 就成了具名样式而被那道 continue 跳过，读数全 0（这一枚坑本身就是本轮那笔归因的答案，绕它绕了一趟）；③ 读手在
  `jszip` + `DOMParser` 之外不碰别的宿主能力，所以运行时腿能在 node 里跑，但 jsdom 要**单独装在一次性目录**而不动项目的 `node_modules`（并发会话在场）；
  ④ **「查问了」有三档**（静态按名 61 / 运行时按名 54 / 运行时按对 88），引数必须说清是哪一档——38.0% 与 29.6% 不是同件事的两回测量而是两个口径；
  ⑤ **「闸在后面」与「谁都没引到」是两种读不到**，对「改系数」的后果都是「动 0 枚件」，只看后果腿会以为这一族在真件里不存在；
  ⑥ **ElementTree 既没有 `getAttribute` 也没有 parent 指针**，前缀属性名要按各部件自己的 `xmlns:` 解成 Clark 串再查——`el.attrib.get('style:name')`
  恒为 None 是这类腿最安静的假绿（本轮一趟归因就是这么错的，靠「行数对不上」才抓住）。

- **本轮没动的量出来记着**（已开进路线图）：**语料没钉成可复核清单**（77 枚件在一次性临时目录而 `/tmp/` 不入仓，重跑要重新取件）；
  **Word 门面 SaveAs 到 odt 全灭**（十臂无一回话，得换法）；**具名样式的段前段后不上屏**那笔账；`odfBorderCss` 里同一枚 37.795 的 mm 因子
  本轮没量（真件里没字面走到那一枝）——现由 ODT 长度 mm 档第一笔账量到并改到，而这一族 Word 门面整臂报 off 故只有规格加夹具两头判据；按对 29.6% 与按名 38.0% 两套口径**还没合进那份公开产物**（它至今只算 docx 那头）；`style:line-height` 那一族
  查问了而语料没写，换一批写手（另两种行高写法）就得重量；上一节那 34 枚夹具与本轮这 77 枚真件**两批语料不可互引**（同一个「三批清单三个数」的老问题）。

- **收尾**：README 新增本节 + 两处就地改口（上一节「本轮没动的」里那两句「没量」各挂一枚指针）+ 路线图勾掉「ODT 字符间距读侧只在 34 枚夹具上量过
  （真件 `.odt` 一头没量）」并新开七枚；**本轮不占版本号**（`package.json` / `Cargo.toml` / `tauri.conf.json` 住着并发轮次的 0.119.0，本节按内容命名）；
  并发会话在场 ⇒ 工作树与 dev 树全程未碰，README 以 `git show HEAD:README.md` 为底落 index-only blob；量具吃 `git show HEAD:src/lib` 副本，
  一次性腿件与日志留在被忽略的临时目录里（那批语料下一轮还要用）。

## ODT 字符间距在 77 枚真件上落不落屏第一次有数：89 枚字节字面里 66 枚落屏，而没落的那 23 枚恰好全是 `normal`

上一节收尾时把那枚底数挂在「两头互校」那一块的最后一行：字节层 `text-properties|fo:letter-spacing` **89 枚**、运行时按名开火 **597 回**，
而「落不落屏本轮没数，那是下一笔账的判据」。本轮就是那下一笔账（前置实测轮，只量不改产品：docx 与 odt 两头写侧、Rust、界面、模型属性、
版本文件一寸没碰，落进仓库的只有这份 README，七条腿（`d1`~`d7`）的一次性件与日志留在被忽略的临时目录里），做的就是把那半句话换成有名字的数——
而数出来的结论跟「这一族在真件上工作得好不好」是两回事：**落的 66 枚全住在那两枚逐字节相同的 Word 另存件里，外部写手那 75 枚一枚不落。**

- **两头的分母各自独立**：字节腿（`d1`，python `zipfile` + `ElementTree`，完全不吃读手）在 77 枚件上数出 **89 枚** `fo:letter-spacing` 字面、
  带字面的件 **8 枚**、raw 值只有 **3 档**（`-0.0041in` 48 枚、`normal` 23 枚、`-0.0055in` 18 枚），分层是 `content.xml|fo|automatic|text` 71 /
  `content.xml|fo|automatic|table-cell` 10 / `styles.xml|fo|default-style|paragraph` 4 / `styles.xml|fo|automatic|table-cell` 4；
  屏上腿（`d2`，同一批件喂给 `git show HEAD:src/lib` 那份读手，jsdom 26.1.0 的真 `DOMParser`，无探针）在 77 枚件上**全部读成、抛 0**，
  HTML 里落 `letter-spacing` 字面 **66 枚**、值袋两档（`letter-spacing: -0.292pt` 48 枚、`-0.397pt` 18 枚）。
  上一节那句「597 回」与这里的「89 枚」是**两把尺**（查问次数对字面枚数），本轮另加两把：`text-properties` 元素底数 **2,283 枚**、
  `text:style-name` 出现 **2,600 回**（逐件不同名相加 **1,215**）——四把尺各自自证，不许相减（`d7`）。

- **差额一枚不多一枚不少：`d3` 的纯 join**：89 − 66 = **23 枚**，而这 23 枚按 raw 值分派**恰好全是 `normal`**（`{'normal': 23}`，其余值零缺枚）。
  件面只有两种形状：Word 那两枚各「字节 34 / 屏上 33 / 缺 1（那一枚正是 `normal`）」、另 6 枚件各「字节 = 全缺」且缺值清一色 `normal`
  （`fdo60842` 8、`tdf103025` 6、`annotation-formatting` 4、`tdf134971a`/`tdf74524`/`Word2010AsCharShape` 各 1）。
  ⇒ 一条不变量在 77 枚件上**逐件成立且件面全等**：屏上枚 = 字节里非 `normal` 枚。
  而这批语料把「层够不够得着」和「值收不收」两件事**完全混在一起**——三个非 `text` 载体层（`table-cell` 两档 14 枚、`default-style|paragraph` 4 枚）
  写的值集合只有 `normal`，所以字节腿自己说不出「那 14 枚是不落屏还是本来就落不进」。

- **可达性由夹具单独拆（`d4`，31 臂 = 14 枚载体臂 + 17 枚单位臂，全在内存里拼 zip）**：落的载体臂八枚（`A1`/`A2`/`A3`/`A4`/`A7`/`A8b`/`A10b`/`A13`）
  全走「`span` 引一枚 `style:family="text"`」这一条通道，含字面直接写在 `style:style` 身上那一族与经 `style:parent-style-name` 继承那一族，
  连表格里的正文也一样（`A7`）；不落的六枚（`A5`/`A6` = `table-cell` 样式自己带 `text-properties`、`A8`/`A9` = 具名与自动的段落样式带
  `text-properties`、`A10`/`A11` = `style:default-style` 两族）里头**有带长度型字面的**，所以那 14 枚真件字面不落屏的原因是「载体不可达」
  而不是「值是 `normal`」——这一枚拆分正是字节腿给不出的那半张账（`A3` 那一族形状在真件里是 **0 枚**，`d7` 数过）。

- **单位梯子第一次有整榜读数（`d4` 那 17 臂）**：`pt` 与 `px` 直进 `toLetterSpacingPt`（`-2pt → -2pt`、`-2px → -1.5pt`），其余单位走 `lenPx` 折成 px
  再回折 pt（`0.05in → 3.6pt`、`0.1cm → 2.835pt`、裸数 `5 → 141.735pt`、`1mm → 28.35pt`）；`0pt` 是真值（闸门是「在场」不是「非零」），
  `-0in` 与 `0.00001in` 都折成 `0pt` 而 `0.0001in` 保住 `0.008pt` ⇒ 这一族的屏下界约在 1e-4 英寸量级；
  拒收四档 `normal`/`0.1em`/`20%`/`1e-3pt`（科学记数法被 `toLetterSpacingPt` 的多记法闸挡住，`lenPx` 的 `^-?[\d.]+$` 也不认）——其中 `normal` 那一档已由下一节（ODT 字符间距读侧第二笔账）在查问处折成显式 `0pt`，这里记的是当时 HEAD 的读数而剩下三档照旧拒收。
  `1mm → 28.35pt` 就是上一节那枚 mm×10 的推断在**字符间距这一族**上的夹具读数（按 mm 该 2.835pt），而 `d1` 的三档值里没有一枚 mm 字面
  ⇒ 与段落边距同门：改它要给「夹具动 N 臂」与「真件动 0 枚」两头同判。

- **两步梯子的失真第一次有数（`d3` 值面）**：`-0.0041in` 精确折磅是 **-0.2952pt**，经「×96 → 2dp 的 px → ×0.75 → 3dp」两步落 **-0.292pt**，
  记为失真 `-0.0032pt`（=-0.0043px）；`-0.0055in` 精确 **-0.396pt**，两步落 **-0.397pt**，失真 **+0.0010pt**（=0.0013px）——两枚一负一正，
  说明失真不是「一律往零靠」而是卡在中间那档 2dp 的 px 上（`-0.39px`、`-0.53px`）。另有一枚卡在半步上：`-0.2925` 经 `Math.round` 落 `-0.292`
  （负半值朝 +∞ 那一头进位，不是四舍五入的对称版），本轮只量到它而没有为它配判据腿。

- **变异四枚，方向按预登记的期望逐枚对上（`d5`，同一份 1,644 行 HEAD 副本改一处）**：语料腿 `head=66 / m1=0 / m2=0 / m3=66 / m4=66`，
  件数与抛错五趟全 `77/0`；夹具腿 `m1` 咬 21 臂（载体 8 + 单位 13）、`m2` 咬 17 臂（8 + 9）、`m3` 只咬 1 臂（`1mm`，28.35pt → 2.835pt）、
  `m4` 只咬 3 臂（`0pt`/`-0in`/`0.00001in` 那三枚落值为 `0pt` 的）。`m1`（把查问属性名换掉）与 `m2`（撤掉 `lenPx` 回折那一枝）的差集
  正好是走 `pt`/`px` 直入那一枝的四臂（`-2pt`/`0.5pt`/`0pt`/`-2px`）⇒ 「先试 `toLetterSpacingPt`、不吃才回折」这条**次序**是被两枚变异合起来钉住的，
  单任一枚都钉不住。`m3`/`m4` 在语料上是 no-op 而夹具可见，与「这批件只写了 in 与 `normal`」一致。

- **自证三枚（缺一枚这轮的数都不算量过）**：① **确定性**——屏上腿与夹具腿各跑两趟，日志 md5 与行数逐字节全同
  （`d2_log_head.txt` 87 行、`d4_log_head.txt` 37 行，`d6`）；② **跨轮等式**——同一份读手在 b22 带探针、b22 关探针、b23 无探针三趟下
  77 枚件的 HTML md5 **全同、不同 0**，而正文去标签去空白字数 77/77 件相同 ⇒ 上一节那条「观察者不改变被观察者」升级成了跨轮的等式，
  本轮那 66 枚与上一节那 88 对/52,071 次来自同一条读手；③ **join 键自证**——本批 77 枚件 basename 无重名（`distinct=77 dup=无`），
  口径写在腿里而不当通用不变量（同名件混进语料就会破这条）。

- **本轮踩到的量具坑（不是产品缺陷）**：① **切前缀的 off-by-one 能把整批臂名读错位**——归因腿把 `d4|` 当成四枚而写 `line[4:]`，
  于是 kind 列被切成 `rm`（`d4|rm|` 的尾巴）并一路撞上断言；这类错不改变「有没有读数」，只改变「读数挂在谁身上」，必须靠断言炸而不是靠看；
  ② **列序要对着写日志那枚腿核**——join 腿一开始把探针腿 `pf` 行的第 5 列当 HTML 长度用，`text_len` 数出假值，补一枚自证行
  （`BibliographyEntryField.odt html_len=39 text_len=10 两列不同=True`）才把口径钉住；③ **「不落屏」有两种原因而在真件上完全混淆**
  （载体不可达 / 值被拒收），拆它只能靠夹具分别造「可达层带被拒值」与「不可达层带可落值」两臂，字节腿加屏上腿数不出原因；
  ④ **读手腿全程串行**——前一轮量到并行 `vite-node` 在 `node_modules/@esbuild/*` 撞 `ENOTEMPTY`，本轮五趟读手（HEAD 加四枚变异）按那条纪律一枚一枚跑
  （不是本轮新踩的，是沿用）；jsdom 沿用上一轮那枚一次性隔离安装而绝不装进项目依赖（并发会话在场）；⑤ **console 是 gbk**
  ⇒ 每枚腿的读数一律落 UTF-8 日志再读回，脚本自报写了哪几枚文件。

- **本轮没动的量出来记着**（已开进路线图）：落屏那 66 枚只由**一枚内容**撑着（那两枚 Word 件逐字节相同），而语料不可复核那枚至今没钉；
  `referenced=NO` 那 8 枚没逐件归因是「样式名没人引」还是「引它的元素没进 `span` 分支」；597 回查问与 89 枚字面的**逐件**对账没做
  （探针腿只报聚合命中数）；`-2pt`/`0.5pt`/`px`/`mm`/`cm`/裸数这一整串单位档在真件上零枚（值面只有 in 与 `normal` 两族），
  屏上下界与最大失真的扫档腿没跑；`table-cell` 载体那 14 枚要不要接（接了就是「格子样式兜住格内无 span 的正文」那笔设计账）；
  上一节那两批语料（34 枚夹具 / 77 枚真件）与本轮这 31 臂夹具**三批不可互引**的老问题又添一枚。

- **收尾**：README 新增本节 + 四处就地改口（上一节「落不落屏本轮没数」那行换成指向本节的读数；路线图里 `em`/`normal` 那枚挂真件 23 枚、
  「屏上与纸面后果」那枚把「落不落屏」那一半划掉、mm 那枚补上字符族同中招）+ 新开七枚，勾选零枚；**本轮不占版本号**
  （`package.json` / `Cargo.toml` / `tauri.conf.json` 住着并发轮次的 0.119.0，本节按内容命名）；并发会话在场 ⇒ 工作树与 dev 树全程未碰，
  README 以 `git show HEAD:README.md` 为底落 index-only blob；产品源一寸未动，量具吃 `git show HEAD:src/lib` 副本，
  一次性腿件与日志留在被忽略的临时目录里（那批语料下一轮还要用）。

## ODT 字符间距读侧第二笔账 — `normal` 那一档第一次有形状：Word 门面裁它是「说了 0」而读手两头读成「没声明」

上一节量到 77 枚真件里 `fo:letter-spacing` 的 89 枚字面有 23 枚不落屏而那 23 枚恰好全是 `normal`，收尾时把这半句挂在「值被拒收」那一头；
本轮给那一档接上通道。`normal` 在 ODF 里是**声明**而不是缺省：Word 门面在祖先层进账的件上量到它把间距压成 0，而自家读手在两头都把它读成「没声明」。
窄口径实现只动一枚文件（`lib/odt.ts`）里读字符间距的那同一枝，三行纯插入（`e14`：基座 md5 `2193e70b713c`/1643 行 → 提交件 md5 `241a2dbcea96`/1646 行，
difflib 纯插入 3、纯删除 0、整行替换块 0，hunk 细目 `insert@998 +3`），docx 与 odt 两头写侧、Rust、界面、模型属性一寸没碰；本轮不占版本号。

- **裁定来自三头而每一头只裁一件事**：门面第一批六臂（`e3a` 造件、`e3` 读 Word）在这一枚载体上**裁不出**——`NORM`、`ZERO`、`ABSENT` 三臂值袋全同（各 `0:1069`），
  因为这件里根本没有进账的祖先档；同批的校准臂 `CAL15` 与 `KEEP` 不同（`1.5:56`）⇒ 尺没瞎，而那三臂同数**不能**读成「`normal` 就是 0」。
  第二批 P15 三臂（`e3e` 造件、`e3_p15` 读 Word）把祖先档补上：`P15KEEP` 读 `1.5:1013`、`P15NORMAL` 读 `0:56` 与 `1.5:1013`、`P15ABSENT` 读 `1.5:1069`
  ⇒ 判据「NORMAL 与 ABSENT 不同」为真而 normal 臂那 56 枚词落 0：**声明 `normal` 是「说了 0」，整枚不写才跟着祖先那一档走**。
  浏览器一头（`e2h`，40 臂两趟同宽）量到 `normal`/`0pt`/`0px`/裸 `0` 四档同宽（lat 247.333、cjk 216.0）而计算样式都是 `normal`，
  且在三种父层档下 `normal` 与 `0pt` 都把父层切掉 ⇒ 屏上这两档不可分；模型那头（`e2f`）`toLetterSpacingPt` 不吃 `normal` 这个词（`parseHTML` 交回 `null`）
  ⇒ 那一档活不到模型，所以只能在读手就折成 `0pt`——落点由这三头合起来定，不是「屏上好看一点」的偏好。
- **实现只一句判「这一层声明了 `normal`」**：`ls.trim().toLowerCase() === 'normal'` 落 `out.ls = '0pt'`，插在 pt/px 直入与 `lenPx` 回折那两级梯子**之前**而两梯一寸没动；
  闸门是「这一层写没写这个词」而不是「这一层有没有数」，所以它压得过可达父层那枚 `1.5pt`、而整层没写时父层照旧传下来。
- **可达父层那一臂才是本轮的判据（P16 三臂）**：`e11` 把 `1.5pt` 注在名字解析真拿得到的那枚父样式 `默认段落字体` 上（声明该父名的子样式 210 枚、其中带字距 33 枚，
  逐臂自证载体孩子与可达性），HEAD 读手（`e12`）在 `P16NORMAL` 与 `P16ABSENT` 上**整枚值袋相同**（都是 `1.5pt:207`）⇒ 「说了 0」被读成「没声明」；
  提交件（`e15`）把那一臂改成 `{1.5pt:174 0pt:33}`——撤掉这 33 枚自己的父层而其余 174 枚照旧跟父层；另一臂 `P15NORMAL` 在 HEAD 是**零枚** `letter-spacing`（`e6`）
  而提交件落 `0pt:33` ⇒ 声明 `normal` 的词第一次有形状；六臂里其余四臂值袋不动、span 枚 207 全同、去标签去空白正文逐臂相同 ⇒ 只搬形状不丢一字。
- **门面第三批（`e13`）不裁本轮而量出另一件事**：同一批 P16 件在 Word 那头三臂全读 `0:1069`（`ABSENT` 臂读 `1.5` 的词数=0）⇒ 这批的门面前提闸为假，
  「normal 切不切父层」归 P15 那批；这里两头不合的那一枚是**继不继承具名父字符样式**——读手把 174 枚没有自己字面的 span 涂成父层的 `1.5pt` 而 Word 一律读 0，
  改它等于换字符样式的继承模型（字族字号字色同吃这条梯子），不在本轮口径，另开一枚。
- **变异三枚咬住的正是这一枝（`e16`，`e16a` 自证三枚变异件与提交件只差落点那一行）**：`v1` 把落点换成 `normal` 这个词 → 咬 2 臂且 `P16NORMAL` 变 `{1.5pt:174 normal:33}`
  （正是「写得出去而活不到模型」那一档）；`v2` 撤掉整枝 → 回到 HEAD 的 `NORMAL≡ABSENT`；`v3` 落 `1pt` → 咬 2 臂而**枚数不动**（`{1.5pt:174 1pt:33}`）
  ⇒ 只数枚数的腿会放行 `v3`，本腿因此逐臂打值袋；覆盖面是带 `normal` 的臂 2 枚被咬、不带的 4 臂一寸没动。
- **真件一头它是严格的 no-op，而这枚 no-op 有名字**：`e17` 在 77 枚件上两头全读成、只一头抛 0 枚，`-0.292pt` 48 与 `-0.397pt` 18 逐档差 0，
  `normal` 档两头 0 枚（提交件没把那个词涂进 CSS），变 CSS 件枚=**0**、正文不同件枚=0、`<span style` 枚差与 `<span` 枚差同数；`e8` 早量到「外层带数字而内层 normal」的嵌套枚=0。
  `e20` 往上追一层：`e1` 归因出的上界那 5 枚（族对、被正文 `text:span` 直接引：`annotation-formatting` 的 T2~T5、`tdf74524` 的 T1）父链**逐枚都穿过 `annotation`**，
  而读手按批注那条老规矩不收 `office:annotation` 的孩子 ⇒ 这一档在真件上落不了屏不是因为载体够不着样式表，而是因为**引它的那枚 span 走不到 `case 'span'`**；另开一枚。
- **往返腿把整圈接上（`e18`：夹具 → 读手 CSS → CSSOM → 模型门 → ODT 写手 → 解包 → 再读回，全程不跨腿引数）**：`P16NORMAL` 那一臂读手交 `{1.5pt:174 0pt:33}`、
  CSSOM 交回串档 `["0pt","1.5pt"]`、模型门后同档而**被门拒的枚=0**、解包后 `fo:letter-spacing` 字面档 `{"0pt":1,"1.5pt":1}` 住 `content.xml`、
  再读回值袋同档且「没声明」那一档回读为无；三臂裁定：`normal` 这个字面在整圈里**一寸没出现**（读手 0 枚 / 字节 0 枚 / 再读回 0 枚）、
  `0pt` 活过整圈、而写侧没替「没声明」那一档造出字面；形状差诚实记下——读进 `normal` 而写出 `0pt`，两头在门面与屏上都折成同一个数，
  而外部写手与规格看那是两种字面，另开一枚。
- **编译腿四趟真 `tsc --noEmit`（`e19`）**：以 `git show HEAD:src` 装配一次性工程（65 件、64 枚 ts|tsx、配置 3/3 在场），基座被 `core.autocrlf=true` 落成 CRLF
  而按字节去掉 CR 之后 md5 与前置腿的 `2193e70b713c` 合=true；趟1 基座报错 0、趟2 换提交件（`241a2dbcea96`、1646 行、`normal` 分支枚=1）报错 0、
  趟3 一次性探针件拿 TS2322 **1 行**证明那一趟真跑过、趟4 清探针后仍 0；工作树那份 `odt.ts` 跑前跑后 md5 相同（`5809b80826d9`——那是并发侧的账，本轮没往工作树写一个字）。
- **本轮踩到的量具坑（不是产品缺陷）**：① **zip 的字节直接 grep 恒空**——往返腿第一趟报「解包后字面档={}」，因为原始件是 DEFLATE，必须按部件解出来再扫
  （「写了而没看见」与「没写」在日志里长得一模一样）；② **archive 落 CRLF 让基座自证假红**——`core.autocrlf=true` 下 `git archive` 写出的副本按 LF 的 md5 必然不合，
  要先按字节去 CR 再 md5，否则这枚假红一路撞上编译腿；③ **缺席的键参与相等判断两头都骗人**——值袋里 `normal` 那一档缺席时 `undefined === 0` 为 false，
  把「提交件不该涂 normal」打印成红色，改成先补零再比并把整腿重跑；④ **`xargs -I{} say` 会静默丢掉整行读数**（shell 函数不进 xargs 的子进程），计数要先落变量；
  ⑤ **「上界」不能当落屏**——样式族与被引用都对还不够，可达性要一路走到渲染分支那一层才算数（`e1` 给 5 枚上界而 `e20` 量出那 5 枚住在批注里）；
  ⑥ **假断言长得很像通过**——`text.startsWith('')` 恒真，往返腿的「正文回来了」改成逐段回读而不是整串前缀。
- **本轮没动的量出来记着**（已开进路线图）：Word 继不继承具名父字符样式这一层两头相反（174 枚对 0 枚）；`style:default-style` 那层的字符间距 Word 吃而读手整层不可达
  （P15 那批的祖先层正是它，本轮没为它改通道）；批注正文里的字符属性整批不进屏；`normal` 折成 `0pt` 之后的字节形状差；门面第一批对 `normal` 缺独立判据（三臂同数）；
  屏上后果（行宽、换点、是否撑出、打印分页）一头沿用上一节那半枚仍未量；而 `em` 那一档照旧拒收，从上一枚未勾项里单拆一枚。
- **收尾**：README 新增本节 + 三处就地改口（上一节单位榜那句把 `normal` 从拒收四档里划出来、`lib/odt.ts` 与 `lib/char-spacing.ts` 两条架构条各接本轮口径）+
  路线图勾掉「`em` 与 `normal` 两档落不进读侧」的 `normal` 那一半（`em` 另开一枚）并新开六枚；**本轮不占版本号**（`package.json` / `Cargo.toml` / `tauri.conf.json` 住着并发轮次的 0.119.0）；
  并发会话在场 ⇒ 工作树与 dev 树全程未碰，提交走 index-only blob（`src/lib/odt.ts` 与这份 README），只本地 commit 不 push；一次性腿件与日志留在被忽略的临时目录里。

## ODT 长度 mm 档第一笔账 — 全族 10× 偏第一次两头改到而它在 77 枚真件上是 no-op，而这枚 no-op 有两重原因：走到尺跟前的 mm 字面 0 枚，件里那 118 枚全住不可达层

上一节收尾时挂着两枚未勾：`lenPx` 的 mm 档与 `odfBorderCss` 里同一枚因子。它们当时的处境是「静态推断成立而运行时零读数」——夹具上 `1.058mm` 折成 29.993pt 而按 mm 该是 3.0pt（那一轮 B03），同一改动在 77 枚真件上动 0 枚件（真件语料那一节把这句量成了读数，另附 33 枚「有出口的」mm 字面全住具名样式层的逐枚归因）。
本轮把这两枚一起改到，并把「为什么它是 no-op」量成有名字的数。实现只动 `src/lib/odt.ts` 一枚文件：基座 `241a2dbcea96` / 1647 行 → 提交件 `23fdd79d8c48` / 1647 行，difflib 纯插入 0 / 纯删除 0 / 整行替换块 2（`1<->1` @55 与 `1<->1` @70），字节数 78174 前后相同（`37.795` 与 `3.7795` 同六字符 ⇒ 等长替换本身是一枚免费的形状自证），docx 与 odt 写侧、Rust、界面、模型属性、版本文件一寸没碰。

- **落点为什么是这两枚而不是 terminal 那一枝**：基座里 `37.795` 出现 5 枚（@28 `px2cm` 除数、@55 `odfBorderCss` 的 mm 枝、@59 它的 terminal、@70 `lenPx` 的 mm 枝、@74 它的 terminal），提交件只换 @55 与 @70 而两枚 terminal 一寸没动 ⇒ 残留 3 枚而 `3.7795` 枚=2。`e6` 的单位榜给了理由：HEAD 把六档同物理宽度读成 `{"378px":["mm","bare"],"38px":["cm","in","pt","px"]}`——mm 那一档与裸数同值而它自己有枝，`lenPx` 的 terminal 同时吃 `cm` 与裸数（`g1` 逐枚打印过那五行），所以「只修 mm」的形状只能是换 mm 那一行；改 terminal 会连 `cm` 一起动，而 `cm` 那一档在门面与真件两头都是对的。
- **三头各自只裁一件事**。门面（Word 16.0，七臂两趟逐臂读数相同）裁「mm 该等于 cm」：`ARMM10`、`ARMC10`、`ARMPT` 三臂 Word 全读 `indent=28.35 sb=14.15`（同宽三臂同值=true），而 `headlib` 把 `10mm` 读成 283.5/141.735（与 Word 那档最大差 255.15 磅）、`fixa`/`fixb` 三臂改成 `[28.5, 28.5, 28.5]` 而与 Word 最大差 0.15 磅；倍数式 `HEAD mm/cm = 9.947`（段前那一臂 9.999）而提交件同式 1.0。裸数臂 `ARMBARE` 是门面的负结果：Word `indent=0.0` 而三头全 283.5 ⇒ 门面不给 ODF 裸数进账，这一档的取舍另开一枚。边框族没有第三头：`ARDBM`/`ARDBC` 两臂 Word 报 `borderLeft=off`（段落左边框没启用）⇒ `odfBorderCss` 那两枚枝只有 ODF 规格 + 夹具判据，诚实记下。读手一头 `e6` 载体榜 13 臂里 `fixa` 动 10 臂，而 `char_font_size` 三头同 `11px`（`fo:font-size` 自带 3.78 那一枝不吃这条梯子）。
- **真件一头是严格 no-op 而这枚 no-op 有两重原因，只有探针能把它们分开**。`e3`：77 枚件三头都读成、都抛 0，变 CSS 件枚 `head→fixa`=0 且 `head→fixb`=0，`fixa` 与 `fixb` 不同件枚=0，正文不同件枚=0、`style=` 串枚差=0、`<span style` 枚差=0，属性面枚差=无。而件里明明有 mm：`e1` 独立字节腿数出长度型属性字面底数 21,030 枚、全属性名单位榜 `cm=5258, mm=426, in=3832, pt=4668, %=1066, 裸数=5780`，其中住查问位那 21 枚属性名上的 mm 字面 118 枚。两件事不矛盾——`e5` 把读手装成带探针的一次性副本（探针桩枚=2，正控制开火=是：夹具那两枚 `10mm`/`5mm` 被数到）在 77 枚真件上跑，走到 `lenPx` 的输入 8,958 枚按单位是 `{"cm":304,"非长度":6342,"in":2312}` 而 **mm 档 0 枚**，走到 `odfBorderCss` 的 4,436 枚全是「非长度」。
- **那 118 枚住哪一层由 `e4` 逐枚归因**：A 属性名对得上而载体不在查问表上 85 枚（`graphic-properties` 57 / `list-level-label-alignment` 20 / `page-layout-properties` 8）、B 载体对得上而坐具名样式层被那道 `continue` 跳过 27 枚、D 值为 `0mm` 4 枚（`len2px` 当「没说」而 `lenPx` 落 `0px`）、C 进得了尺 2 枚而那样式（`Quotations`）在这批件里没有任何正文引用——85+27+4+2=118 而逐属性明细 33 行。所以「件里有 mm」与「mm 走到尺跟前」是两笔账：前者是普查，后者要一路走到那一枝的调用处。
- **写手一头把「这条修复对自家往返没有后果」说成读数**：三头各出 A4/custom 两件，六件合长度型字面 375 枚（`cm:249 pt:96 %:6` 与四条带色边框串 `:6`、`in:6`）而 **mm 枚=0**；反控制往同一批部件注入两枚 mm 字面后本尺数出 `mm枚=2 值=10mm,5mm` ⇒ 尺看得见 mm，那个 0 是真 0。这条腿不能被「真件动 0 枚」代替：它说的是「自家写手从不发 mm」，所以本轮修复只对外部件生效。
- **变异四枚各只咬该咬的臂，而 `v3` 是这轮最贵的一枚读数**（`g2`，逐臂打值而不只打落没落）：`v1` 撤 `lenPx` 的 mm 枝⇒载体榜咬 10 臂（`p_margin_left 378px`、`p_line_height 188.98px`、`char_letter_spacing 56.693pt`…）且单位榜咬 `ladder_mm`；`v2` 撤 `odfBorderCss` 的 mm 枝⇒恰咬 `p_border_left` 与 `cell_border_top` 两臂（两枚枝可分，因为 `v2` 与前置实测的 `fixa` 逐字节相同）；`v3` 把 mm 折成 `n * 1`⇒**落屏枚数一毫不动**（六份读手全 13 枚）而逐臂值不同枚=10，只数枚数的腿会放行它；`v4` 改 terminal⇒载体榜咬 0 臂而单位榜同时咬 `ladder_cm` 与 `ladder_bare` 两档，这正是「不为裸数改 terminal」的量。值袋把三族形状摊开：提交件 `{"38px":4,"18.9px":3,"1.89px":2,"11.34px":1,"45.35px":1,"5.67pt":1,"11px":1}`、`v1` 同形状各 ×10、`v3` 同形状各 ÷10；四枚变异的正文去标签去空白与提交件不同臂枚=0 ⇒ 只搬形状不搬字。
- **编译腿四趟真 `tsc --noEmit`**：`git show HEAD:src` 装配一次性镜像工程（递归 65 件 / `src/lib` 51 枚 / 配置 3 枚全按 HEAD），镜像里那枚 `odt.ts` 自证 md5=`23fdd79d8c48`；趟1 基座 0 错、趟2 提交件 0 错、趟3 一次性负探针拿到 `error TS2322` 一行证明那趟工具真跑过、趟4 清探针后仍 0 且残留=0；工作树那份 `odt.ts` 跑前跑后 `a702edb69ac2` 相同＝并发侧的账，本轮没往工作树写一个字。
- **确定性腿**：`g2` 两趟日志逐字节相同（md5 `4683d63703461089fe1e078ac27ec20c`），`e6`/`e8a`/`e8b` 各两趟，门面两趟逐臂相同；写侧跨趟部件 md5 相同 18/18 而件级 md5 有 6 枚不同 ⇒ 又一次确认「写手时间戳进 zip 而不进部件」，件级 md5 不能当不变量。
- **本轮踩到的量具坑**：① **变异目录必须整份带兄弟件**——只放 `odt.ts` 的那份在 `import './docx'` 上直接起不来（表现为 `Cannot find module`，与「改动错了」长得完全不同），补齐 50 枚兄弟件后四枚变异的 md5 一寸未变才算换了腿件没换读数；② **非唯一串要按行号钉**——`: n * 37.795` 全件出现 2 枚（@59 与 @74），按内容替换会同时命中两枝，`v4` 因此按行号锁定；③ **cm 与裸数共用 terminal 枝** ⇒ 「只改 mm」的形状只能是换 mm 那一行，而这条只能由一枚改 terminal 的臂量出来而不是靠读代码断定；④ **真件 no-op 有两种原因**（字面压根不在件里 / 字面在件里而够不着那一枝），本例是后者且后者还要再拆「载体不可达」「样式层被闸」「值为 0」「样式无人引」四桶；⑤ **「修复只对外部件生效」得由写侧字节腿说**，「真件动 0 枚」推不出它；⑥ **只数落屏枚数的判据对「换系数」这一族是盲的**（`v3` 把 mm 折成另一个错系数，六份读手落屏枚数全 13 而逐臂值全错），变异腿必须逐臂打值。
- **本轮没动的量出来记着**（已开进路线图）：ODF 裸数那一档 Word 门面整臂读 0 而我们按 cm 进账（`ARMBARE`）；`odfBorderCss` 那两枚枝没有第三头判据（边框族门面报 `off`）；真件 A 类那 85 枚 mm 住图形/列表标签对齐/页布局三种载体，接不接是「这些载体要不要吃长度」的设计账；`len2px` 把 0 当「没说」而 `lenPx` 落 `0px`，那 4 枚 `0mm` 正卡在两把尺的分界上；`fo:font-size` 自带的 3.78 与本轮的 3.7795 并存而没并档；自家写手 mm 零档 ⇒ 这条通道在自家往返里自证不了，判据只有外部件一头。
- **收尾**：README 新增本节 + 四处就地改口（上一节「本轮没动的」里那枚 `lenPx` 的 10×、`odfBorderCss` 那条「本轮没量」、再上一节开场挂的那句、架构那节 `lib/odt.ts` 的系数口径）+ 路线图勾掉三枚并新开六枚；**本轮不占版本号**（`package.json` / `Cargo.toml` / `tauri.conf.json` 住着并发轮次的 0.119.0，本节按内容命名）；并发会话在场 ⇒ 工作树与 dev 树全程未碰，提交走 index-only blob（`src/lib/odt.ts` 与这份 README），只本地 commit 不 push；一次性腿件与日志留在被忽略的临时目录里。

## ODT 页面块第一笔账 — 「这张纸」取哪一枚 `page-layout-properties`：基座按 `styles.xml` 文档序的第一枚而真件 77 枚里 11 枚的那一枚住 `<style:default-page-layout>` 且六枚长度字面全缺 ⇒ 那 11 枚件的页账整枚没接住

页面块（纸张尺寸 + 四边距 + 分栏）是 ODT 读侧唯一一块「值不在正文那条样式链上」的账，而基座取它的方式是拿 `styles.xml` 文档序的第一枚 `page-layout-properties`。ODF 把这件事交给 `style:master-page` 的 `style:page-layout-name`：先按引名找那一枚 `style:page-layout`，再取它的属性块。`f7b` 量出两种取法的分界——77 枚件的第一枚 `page-layout-properties` 有 66 枚住 `document-styles>automatic-styles>page-layout`、11 枚住 `document-styles>styles>default-page-layout`，而后者的属性名只有 `layout-grid-standard-mode`/`writing-mode`/`layout-grid-square-mode` 那三个（六枚长度字面一枚没有）。`f6` 的读手普查因此报 HEAD 接住 64/77、未接住 13，未接住按「第一枚宽/高形状」分派恰好是 `{"属性不在/属性不在":11,"pt/pt":2}`——那 11 枚是本节的账，另 2 枚是 `cm2mm` 的收档问题，本节把它量出来而按纪律不改。

实现只动 `src/lib/odt.ts` 一枚：基座 `23fdd79d8c48` / 1647 行 → 提交件 `524089fd2831` / 1657 行（`h1`：difflib 纯插入 0 / 纯删除 0 / 整行替换块 1 枚 `1<->11`、净增 10、CR 枚=0、字节 78932），换掉的只有那一行 `find`——先取 `master` 上的 `style:page-layout-name`，按它找 `localName === 'page-layout'` 的宿主，再 `pick(plpEl, 'page-layout-properties')`，查不到才回退旧取法（`?? firstPlp`）；`master` 那行与 `colsEl` 那行一寸没动（`h1` 逐行打过 `[True, True, True]`）。docx 与 odt 写侧、Rust、界面、模型属性、版本文件没碰，工作树那份 `odt.ts` 跑前跑后 `a702edb69ac2` 相同（`h7`/`h8`）＝并发侧的账，本轮没往工作树写一个字。

- **回归面先裁「这枚选择会不会换纸」**：`f12` 的可达性矩阵是 `both=66 || only-master=11`（合 77=True）而回退格 `only-first` 枚=0——真件里没有任何一件「文档序第一枚有账而按引名选的那枚没账」；多枚 master-page 的件 15 枚（`tdf116195` 一件 10 枚、`tdf167774` 一件 11 枚，逐件的 名->引名 全打回），而「两枚都全而值不同」的件枚=0。`f12b` 把六枚字面（`fo:page-width`/`fo:page-height` + 四枚 `fo:margin-*`）逐件比：档=「六枚全同（且同一枚元素）」66 件 ||「新增（第一枚全缺而引名枚在场）」11 件，合 77，另 `不同元素而字面相同`=0、`两枚都在场而字面不同` 按六个属性各自=0，日志里那句回归面一句话逐字是「换纸（两枚都在场而不同）=0 只换边距=0 新增（第一枚全缺）=11 全同=66」。所以这一笔账不是换纸而是**第一次把 11 枚件的纸接住**。
- **后果腿：11 件从「没账」到「有账」而 HTML 与正文一寸不动**（`h2`，77 枚 × 六份读手；后缀表 `odt|ott` 与 `f1`/`f6`/`f12`/`f12b` 同一份）：六份读手读成全 77、抛全 0、正文合计字数全 17633，接住 `meta.page` 从 64/77 到 75/77，`size` 档 `{"Letter":11,"custom":3,"A4":50}` 改成 `{"Letter":12,"custom":4,"A4":59}`；对照「本轮改动的后果」臂 `meta.page` 不同件枚=11（期望 11 合=true）而 HTML 不同件枚=0、正文不同件枚=0（两枚须=0）。11 件逐件页账打印过（`fdo37606` A4 25/25/30/30、`tdf109228` Letter 35/30/30/30、`tdf41542_borderlessPadding` custom 148×105、`V_back`/`V_fwd` A4 四边 5mm…），而「基座接住而提交件没接住的件枚=0」⇒ 这枚选择只加账、不挪账、不动字。
- **变异四枚各只咬该咬的臂**（`h0` 装配 / `h4` 夹具 / `h2` 真件）：`m1` 撤掉整枚新增 ⇒ 它与基座**逐字节相同**（md5 都是 `23fdd79d8c48`，`h0` 直接打印 相同=True）而相对提交件咬 11 件——「新增的行为就是引名选择这一件事」由这枚等于基座的变异钉住；`m2` 撤回落档 ⇒ 真件咬 0 件而夹具咬 `["G3","G5"]`（覆盖面 须咬=实咬、漏咬=[]）；`m3` 去掉 `page-layout` 的型别闸 ⇒ 真件咬 0 件而夹具咬 `["G6"]`；`m4` 把引名换成 master-page 自己的 `style:name` ⇒ 真件咬 11 件（等于把选择退回回落档）。真件那两个 0 不是尺瞎而是覆盖面压根不在真件上：`h3` 的字节普查报「同名而型别非 `page-layout`」的诱饵 命中枚=0 件枚=0，而 77 枚件的引名全部解析得到（`h3` 那行 引名可查的件枚=77）。
- **夹具六臂把「取哪一枚」的四档形状摆开**（`f9a`/`h3` 建臂、`h4` 裁，六臂 × 六份读手 符合全 true）：G1 两枚字面全同（谁都一样）、G2 文档序第一枚 A4 而引名 `pmB` 是 148×105（⇒ 提交件读 custom 而基座读 A4）、G3 没有 master 层（⇒ 只有回落档吃得到，撤回落的 `m2` 在这一臂整枚没账）、G4 默认档 A4 而引名 Letter（⇒ 引名那一枚压过默认档）、G5 引名 `pmZ` 在件里查不到（⇒ 提交件回落到第一枚 A4 而 `m2` 没账）、G6 引名 `pm1` 命中两枚同名元素（文档序先是 `style:style` 带一枚 30cm×40cm 的亲儿、再是 `page-layout` 的 A4）⇒ 有闸读 A4、撤闸的 `m3` 读到 custom300x400。诱饵的属性块必须是同名元素的**亲儿**，因为 `pick` 只看 children——这一档形状在真件里 0 枚，只有夹具能给 `m3` 覆盖面。
- **三头里的「第三头」第一次落在页面族上，而它不是全绿**（`h5`，Word 16.0 读 `PageSetup` 的磅再折 mm；16 臂 = 11 合 + 4 有差 + 1 THREW）：宽高与边距都合的臂枚=11、有差的臂枚=4、基座没账 12 臂而提交件没账 2 臂（两头都没账=2，正是提交件没账那两件 ⇒ 提交件那 2 ⊂ 基座那 12）。4 枚有差逐臂有名：`tdf167774` 门面 bottom=29.99mm 而我们 20mm（距差 −9.99）；`tdf41542_borderlessPadding` 门面 `orient=1` 而距差 top/bottom=−11.42、left/right=−5.08；`tdf116195` 与 `unreferenced_stream` 提交件整枚没账。另 `fdo47267-3` 门面 THREW（「文件可能已经损坏」）⇒ 本臂不进合裁也不在有差之列。宽高那一层的差落在 −0.06…+0.07mm 量级（cm 三位小数是这一族的分辨率下界），`V_back`/`V_fwd` 两臂 `secs=2` 而仍合——多枚 master-page 那一层本节没接（见路线图）。
- **那两件「还是没接住」的件是 `cm2mm` 的收档问题而不是取哪一枚**（`h5b`/`f6`/`f1b`/`f3`）：`tdf116195` 九枚属性块的宽/高字面全是 pt（432/648、612/792、649.16/323.15…），`unreferenced_stream` 一枚 595.3pt/841.89pt；`f6` 报 124 枚的档 `{"cm":86,"in":15,"属性不在":11,"pt":10,"mm":2}` 而 `f1b` 六枚查问位每臂都报 `全=113 裸=0 件=77 档=cm×86, in×15, pt×10, mm×2`。`f3` 页面族两臂（`page_width|cm2mm@1608`、`page_margin_left|cm2mm@1618`）11 档值袋 `{"cm":"50.8","mm":"50.8","in":"50.8","inchquote":"20","bare":"50.8"}` 而 pt/px/pc/em/ex/pct 六档全「不落(尺拒收)」⇒ cm/mm/in/裸数四档同值 50.8mm，pt 那一档在真件里有 10 枚字面却整族进不了账；那两件的门面读数（152.4×228.6mm 与 210.01×297mm）证明它们本来是有账的。`h5b` 尾行自证「提交件没接住的件枚=2（须=77−75=2，与 `h2` 那趟 接住=75 合）」。
- **同一枚「裸数」在两种载体上门面裁出两种数**。页面族门面夹具（`f4c` 九臂各写同一张物理页 432pt×648pt、左 36pt 其余 72pt；`f4d` Word 16.0 两趟逐臂读数相同）里 CM/IN/MM/PC/PT/PX 六臂全读 `432/648/36/72/72/72`，而 BARE 与 QT 两臂读 `7.2/7.2/90/90/72/72`、NONE 臂读 `612/792/72/72/72/72`；上一节 `ARMBARE` 在缩进族裁的是「门面整臂读 0」⇒ 门面对裸数的裁定随载体变，那条取舍不能跨载体搬。另有一档量出来而不改：`cm2mm` 的正则收了 `"` 那一枚后缀，换算只给 `cm`/`mm`/`in` 三档，于是 `2"` 折成 20mm 而不是 50.8mm（倍数 0.394，`f3` 两臂同读数），而真件里 `"` 那一档 0 枚（`f1b` 六臂的档里没有它）。
- **写手一头与上一轮 mm 零档同形状**（`h6`，5 件走「读进 → 写回 → 解包 → 再读回」）：提交件与基座读回同值全 true，写出件的六枚全 cm 三位小数（如 `tdf128737` 的 `["21.00cm","29.70cm","2.00cm","2.00cm","2.00cm","2.00cm"]`），而**每一件写出的部件里 `plp枚=1`、`master=["Standard->pm1"]`** ⇒ 「取哪一枚」在自家往返里根本没有第二枚可取，这条通道的判据只有外部件一头。自家写手三臂（A4 默认 / Letter / custom 148×105）跨六份读手页账全同=true、部件字节全同=true（`h4`；`content.xml` 三臂同 md5 `bbd920952bec` 而 `styles.xml` 三臂各异 `3d3f3895ff68`/`e7306f9404f0`/`d14b945f22cc`）⇒ 写侧一寸未动。
- **编译腿四趟真 `tsc --noEmit`**（`h8`）：`git show HEAD:src` 装配一次性镜像工程（65 件 / `src/lib` 51 枚 / 配置 3 枚 / ts|tsx 64 枚），趟1 基座 0 错、趟2 提交件 0 错、趟3 一次性负探针拿到 `__q26neg.ts(1,7): error TS2322` 一行证明那趟工具真跑过、趟4 清探针后仍 0 且探针残留=0；趟4 自证吃进去的 `odt.ts` md5=`524089fd2831`。口径先写清：编译腿的行数按换行枚数（1656）而 `h1`/`h0` 按 `splitlines`（1657），差一枚是文件尾那个换行——跨腿引行数必须说清是哪把尺。
- **确定性腿**（`h9`）：`h2` 两趟逐字节相同（md5 `45cda1c537c0`，74 行 / 7792 字节）、`h4` 两趟（`9d4d92da42e0`，53 行 / 6448）、`h6` 两趟（`5f30665265e7`，6 行 / 2176）——第二趟另存为 `*_run2` 文件再比，因为读手腿写的是同一个文件名，不另存就等于自己跟自己比。`f13` 另给单位榜的确定性：同版两趟（r2<->r3）全行差=0、跨版（基座读手 vs 提交件读手）臂×档数据行值不同枚=0、逐臂值袋行 15 枚不同枚=0；而它比的 99 枚汇总格里「落数变了」的 6 枚格**不是读数变了而是口径变了**——r1 那一趟只有「落」一档而 r2/r3 拆成 落/无出口/尺拒收 三档，六枚全住 `cm2mm@1422` 那一臂的 pt/px/pc/em/ex/pct（形状 `落1/1 -> 落0/1 无出口1 拒收0`，`f13` 断言「形状不是这一式的枚=0」），三档分布 `{"落":102,"尺拒收":57,"无出口":6}` 而「无出口」全住臂=`frame_svg_width`——页面族两臂跨版同值，这枚 0 是本轮 no-regression 的另一半。
- **本轮踩到的量具坑**：① **期望数要挂在真正的那一列**——后果腿第一趟把「=11」写去了 HTML 差值列（本轮 HTML 恒 0），改成 `meta.page` 按期望、HTML/正文一律须=0 才自洽；② **一枚变异有没有覆盖面是由普查决定的，而不是由它撤掉的那枝决定**（`m2`/`m3` 在真件各咬 0 件而各自在夹具咬 2/1 臂），所以「覆盖面 须咬/实咬/漏咬」必须自己打印；③ **同一枚字面在不同载体上门面能给出相反的裁定** ⇒ 引「门面说裸数不进账」得说清是哪一族；④ **`pick` 只看 children** 所以诱饵臂的字面必须挂在同名元素的亲儿上，挂错了那枚变异谁都咬不到而看起来像「撤错了枝」；⑤ **腿日志会被后一趟覆盖** ⇒ 确定性比对要先按趟另存；⑥ **bash 内联 python 的反斜杠路径能把装配腿自己写死**（本轮 `open` 一个带 `\t` 的路径报 `OSError: [Errno 22]` 而什么都没写，读数直到下一趟才回来）；⑦ **行数有两把尺**（`splitlines` 与换行枚数差一枚）。
- **本轮没动的量出来记着**（已开进路线图）：`cm2mm` 不收 pt/px/pc/em/ex/% 而那两件真件的页账整枚在这一档（pt/px/pc 三档已由下一节接住而 em/ex/% 仍在这枚上）；`"` 后缀在正则里在场而换算没给档；页面族显式 0 被 `n <= 0` 读成「没说」（与上一轮 `len2px`/`lenPx` 那 4 枚 `0mm` 同族而这一族还没并档）；多枚 master-page 只取文档序第一枚而首页/奇偶页（`First_20_Page`、`Left_20_Page`/`Right_20_Page`）那一层未接；`tdf167774` 与 `tdf41542_borderlessPadding` 的门面距差；自家写手只发一枚属性块 ⇒ 取枚逻辑在自家往返自证不了；`fdo47267-3` 那一臂 Word 报 THREW；`frame_svg_width|cm2mm@1422` 那六档「无出口」还没并档。
- **收尾**：README 新增本节 + 两处就地改口（架构那节 `lib/odt.ts` 补「这张纸取哪一枚」的口径、路线图 A 类那枚里「`cm2mm` 那把已经对的尺」改成有收档读数的一句）+ 路线图新开八枚而勾掉 0 枚；**本轮不占版本号**（`package.json` / `Cargo.toml` / `tauri.conf.json` 住着并发轮次的 0.119.0，本节按内容命名）；并发会话在场 ⇒ 工作树与 dev 树全程未碰，提交走 index-only blob（`src/lib/odt.ts` 与这份 README），只本地 commit 不 push；一次性腿件与日志留在被忽略的临时目录里。

## ODT 页面长度单位第一笔账 — `cm2mm` 补上 pt/px/pc 三枝：两件真件的页账第一次有账而判据是三头合裁（门面七档同纸 + 夹具逐臂值袋 + 往返两圈同值）

- 本轮只裁一件事并把路线图那枚「`cm2mm` 不收 pt/px/pc/em/ex/% ⇒ 两件真件的页账整枚进不了账」收口：实现只动 `src/lib/odt.ts` 一枚文件的 `cm2mm` 那一枝（基座 `524089fd2831`/1,656 行/78,932 字节 → 提交件 `17fedfa33f29`/1,661 行/79,228 字节，`g9` 的 difflib 纯插入 0/纯删除 0/整行替换块 3：@148 注释 `1<->1`、@151 正则 `1<->1`、@155 三元式换成五枝 if 链 `1<->6`，净增 5 枚）。docx 与 odt 写侧、Rust、界面、模型属性、版本文件一寸没碰。行枚口径先钉死：`g2` 按 `splitlines` 报 1,656 而 `g3` 那一行把 `split('\n')` 的 1,657 标成了 `splitlines`（收尾时本机复量：基座 1,656/1,657、提交件 1,661/1,662）⇒ 引行枚必须说清是哪枚腿，而净增 5 枚在两把口径下相同。
- 正则从 `(cm|mm|in|")?` 换成 `(cm|mm|in|"|pt|px|pc)?`，换算从「`in` 折 25.4 而其余一律 ×10」那枚三元式换成 in/mm/pt/px/pc 五枝 if 链加末尾 `n * 10`（pt 按 25.4/72、px 按 25.4/96、pc 按 25.4/6），而 `if (!v)` 与 `n <= 0` 两道闸一寸没动。`g9` 的串枚自证把形状逐串数出来：新正则串基座 0 枚→提交件 1 枚、`'pc'` 0→1、`(n * 25.4) / 72` 与 `/ 96` 与 `/ 6` 各 0→1、旧三元式串残留 0 枚。
- `cm2mm` 是页面族的唯一一把尺而它同时管着另外两条通道（`g0` 按行号打出调用处枚=9 含定义：`frame`@1422 的 `svg:width`、页宽@1618 与页高@1619、四边距@1626–1629、栏间距@1646）；同一份文件里 `lenPx`@63 收 `cm|mm|in|"|pt|px` 六档且吃负号、`len2px`@78 在它上面做整数取整——**两把尺的单位榜今天还没并**（`pc` 只有 `cm2mm` 收，而段落族那批同名 `fo:margin-*` 走的是 `lenPx`）。
- 前置普查（`g1`，77 枚真件、python zipfile + ElementTree、完全不吃读手）：页族六枚查问位的字面底数 3,345 枚；逐属性单位榜 `fo:page-width` 113 枚 `{cm:86, in:15, pt:10, mm:2}`、`fo:margin-top` 645 枚 `{cm:417, in:120, pt:90, mm:18}`、`fo:margin-left` 1,477 枚 `{cm:757, in:391, pt:316, mm:13}`。现尺的拒因分成两族列出而不混算——「正则不收:pt」全族 619 枚（页面六枚问位相加 10+10+90+87+316+106）与「值为0」那一批，另有「正则不收:cm」3 枚而 `g4b` 逐枚归因它们是**负数**（`-0.123cm`、`-0.9cm`、`-0.191cm`，住 `table-properties` 而不是页面块，撞的是 `n <= 0` 那道闸的另一面）。`px` 与 `pc` 两档在真件页面族问位上 0 枚 ⇒ 新补那两枝本轮只有夹具判据。
- 「页账真正吃的那一枚」（`g4`，逐件按 master-page 引名选中那一枚 `<style:page-layout-properties>`）：77 枚件、选中那枚的六枚字面底数 462、榜 `fo:page-width` 77 枚 `{cm:60, in:13, pt:2, mm:2}`；现尺接住 75 枚而 **2 枚整枚没账**（`tdf116195` 六枚全 pt、`unreferenced_stream` 595.3pt/841.89pt），候选尺 77 枚全接住；size 档分布 `{Letter:12, custom:4, A4:59, 无:2}` 改成 `{Letter:12, custom:5, A4:60}`——`unreferenced_stream` 那 595.3pt 折成 210.0mm 后被 `near()` 认进 A4 那一档而不显式落 w/h，这是「同一张纸的两种写法在页账里合流」第一次有读数。
- 架构决定由梯子读数给出而不是由代码读出来（`g3`，19 档字面 × 三把尺：现尺 / 候选A 只补三枝 / 候选B 让页面族改吃 `lenPx` 再 px→mm）：候选A「新收的档=[pt, px, pc]、改值的档=[]、收窄的档=[]」，候选B「新收 6 档而改值 4 档（`21.59cm` 从 215.9 变 215.897、`215.9mm` 同、裸数同、`8.5"` 从 85 翻成 215.9）而收窄 space 档」⇒ B 被读数否掉：它把两头都对的 `cm`/`mm` 那一档改了零点零零几毫米，又换掉两档现尺收着的东西。正控制：同一张物理页七档在候选A 下全落 215.9（`cm`/`mm` 精确而 `in`/`pt`/`px`/`pc` 落 215.8999…），`inchquote` 仍 85 而 A 不碰它（那枚的取舍是路线图上的老账）。读手对照（`g3|R`/`g3|X`）页宽/页高/页左边距三臂 × 19 档「不合臂枚=0」⇒ 纯函数尺与读手在这一族上同值，而图框臂量纲是 px（`cm2mm` 折 mm 再乘每毫米的 px 数）。
- 三头判据（`g7`，21 臂 × Word 16.0 门面 + 自家读手 + 纯函数）：合=7（CM/MM/IN/PT/PX/PC/MIXPT 七臂折成 mm 后与候选A 差<0.01mm）、不合=3（BARE 差 149.86、SPACE 差 149.86、QT 差 57.46）、候选A 不收=11、臂枚=21、合=True。门面的形状榜把 21 臂分成五袋：同纸 7 臂 `[432,648,36,72,72,72]`、退化页 9 臂 `[7.2,7.2,90,90,72,72]`、负数 2 臂 `[1584.05,-648,0,0,72,72]`、零 2 臂 `[7.2,7.2,0,0,0,0]`、NONE 1 臂 `[612,792,36,72,72,72]`——**「同一张纸的七种写法」在门面上是同一个形状**，这就是 pt/px/pc 该等于 cm 的那枚判据，而不是规格里的一句话。
- 门面腿自身（`g6a`/`g6b`/`g6c`：21 臂 + 单臂重读 + 21 臂复跑，逐臂独立进程）：三趟臂读数枚=21/1/21 而抛臂=0；两趟相等按共同臂 21 枚里 20 同，唯一不同的 `MIXPT` 是因为 `g6a` 跑在夹具修正之前（`g5` 把那枚臂从「四边距也吃 pt」改成「只有宽高吃 pt」）；跨轮同臂 9 枚里 `NONE` 一枚不等而差额（`[612,792,36,72,72,72]` 对 `[612,792,72,72,72,72]`）由臂定义解释：NONE 臂只撤宽高、四枚 cm 边距留在原地。字面抓回 21 臂里 20 臂含 `fo:page-width`（不含的那臂正是 NONE，等于臂定义的自证）。
- 夹具一头（`g11`，21 臂盘上夹具 + 8 臂内联 = 29 臂 × 六把读手，逐臂打值袋而不只打落没落）：提交件相对基座新接住页账臂 `["PT","PC","PX","MIXPT"]`、页账值变臂 `["colgap_pt","colgap_px","colgap_pc"]`、图框宽度变臂 `["frame_pt","frame_px","frame_pc"]`；正控制是七臂同纸（CM/MM/IN/PT/PC/PX/MIXPT 在提交件下页账值袋完全相同：`size=custom w=152.4 h=228.6 m.top=25.4 … m.left=12.7`）=true；负控制 11 臂在提交件下仍是「没有页账」而例外=[]；`BARE`/`QT`/`SPACE` 三臂基座与提交件同值（本轮一寸没碰它们）。
- 变异四枚（`g9` 定义，`g11` 夹具与 `g10` 真件两头咬合；md5 `176cf8ed6236`/`a0dd82a79240`/`a48690d716e4`/`b5f54ce9d905`）：`m1` 只补正则而不给换算 ⇒ pt/px/pc 全落末尾 `n * 10` 那一枝，夹具 PT 臂读 4320×6480（应 152.4×228.6）而相对提交件同时咬页账臂 7 枚 + 栏间距 3 枚 + 图框 3 枚；`m2` 只给 pt 枝（撤 px/pc）⇒ 相对提交件恰是 `["PC","PX","colgap_px","colgap_pc","frame_px","frame_pc"]`；`m3` 把 px 枝写成 `/72` ⇒ 恰咬 PX 那一族（576px → 203.2mm）；`m4` 把 pc 枝写成 `/12` ⇒ 恰咬 PC 那一族（36pc → 76.2mm）。`m3` 的栏间距那一臂是本轮最贵的一枚读数：它报 `colGap=—`，因为 23px 折成 8.12mm 正落在 `DEFAULT_COL_GAP=8mm ± 0.6` 那道门里被当成「没说」，而同枚变异在 `frame_px` 那一臂上照报——**系数错了可以被默认值门吞成「整枚没账」**，所以判据必须打值袋而不是打落没落。
- 真件后果（`g10`，77 枚件 × 六把读手：基座 / 提交件 / 四枚变异）：六把各自 77 枚全读成、抛错 0；提交件相对基座**变页账件枚=2、变 HTML 件枚=1、正文不同件枚=0**；变页账清单是 `tdf116195.odt` 与 `unreferenced_stream.odt` 而变 HTML 只有前者（那件在 `content.xml` 里还有一枚 `frame`/`svg:width="432pt"`，是本轮唯一一枚落进 HTML 的新收字面）；基座没页账的件枚=2 而提交件=0；聚合 HTML md5 基座 `d7e6d671dc78`、提交件 `eaf587d7c498` 且 m2/m3/m4 三趟与提交件同 md5、m1 是 `8c06c58cb6c7`：撤掉 px/pc 任一枝在真件 HTML 上一寸不动（那两档在真件里 0 枚），而只补正则不给换算会把两枚件的页账改成十倍；正文字数合计 17,633 枚六把读手全同 ⇒ 只搬形状不丢一字。
- 回归面普查（`g8`，77 枚件 × 两把尺的收/拒逐枚分派）：候选A 相对现尺的「新收」枚合计 436，件分布 `{tdf116195:425, unreferenced_stream:11}`，载体分布 `{list-level-label-alignment:210, paragraph-properties:154, page-layout-properties:56, graphic-properties:12, header-footer-properties:3, frame:1}`——但**只有 `page-layout-properties` 那 56 枚加 3 枚 `svg:width` 走 `cm2mm` 的问位**，其余 377 枚同名 `fo:margin-*` 住在段落/列表/表格层而吃 `lenPx`/`len2px`，对它们是严格 no-op；这枚「同名不同尺」的分离是由枚数给的而不是由「看起来应该没事」给的。0 值枚 35（单位分布 `{cm:29, pt:5, in:1}`、住 13 枚件、全在 `columns` 与 `page-layout-properties` 的问位上）两把尺都按「没说」处理；不收档表逐单位打印：`pt`/`px`/`pc` 现尺否而候选是，`em`/`ex`/`%`/无法切 两头否，`"` 与裸数两头是。正控制：问位字面底数 796 枚、plp 那一族 678 枚 ≥ `g4` 的 462 枚（口径不同：`g4` 只数选中那一枚而 `g8` 数全部 plp）。
- 写侧一头（`g12|A`）：自家写手在页载体六枚字面上**只发 cm**（A4 / Letter / from_pt_arm / cols_pt_gap 四臂的页载体单位集都是 `["cm"]` 而页载体 pt|px|pc 枚=0），反控制往同批部件注入一枚 pt 字面后尺看得见（命中=true、页枚内单位=pt）⇒ 那个 0 是真 0；同一枚件里另有 8 枚 pt 全住段落族而不吃 `cm2mm`，所以「页载体 0 枚」与「全件 0 枚」是两笔账、必须分开打印。「本轮这条修复只对外部件生效」这笔账还是由写侧字节腿说——真件那头「动了 2 枚件」推不出它（与上一轮 mm 零档同形状）。
- 往返一头（`g12|B`，同一枚外部件走「读手 → 自家写手 → 解包 → 再读回」两圈 × 两把读手）：基座下 `pg_PT`/`pg_PC`/`pg_PX`/`pg_MIXPT` 四臂**第一圈页账=null**（读不到那张纸）而写出的件落成 A4 默认（`21.00cm`×`29.70cm`、边距 `2.00/2.00/2.20/2.20`），第二圈读出 A4 ⇒ 两圈不同臂=4；提交件下 5 臂两圈全同（两圈不同臂=[]、第一圈没账臂=[]）。**这笔账的形状不是「写得出去而读不回来」而是「导出一趟纸被换成默认 A4」**：一张 152.4×228.6mm 的自定义页在基座下走 `.odt` 存盘，纸账整枚丢掉而界面看不出来。这枚读数是修好腿 bug 之后才有的——原来的腿把第二圈的页账打在「第一圈页账」那一行标签下，两行内容因此一模一样而断言照样绿，第一圈从头到尾没被观测过；改成分别打印两圈并加「与第一圈同」旗后两趟重跑。
- 写侧不变腿（`g12|C`）：同一份 meta 在基座与提交件下写出四臂，部件枚相同=true、**部件逐字节相同=true** ⇒ `cm2mm` 没有写侧调用处，本轮是纯读侧；件级 md5 也相同但那枚不作不变量（理由见确定性那一行）。
- 编译腿（`g13` + `g13b`）：`git show HEAD:src` 装配一次性镜像工程（src 件数=65、ts|tsx=64、`src/lib`=51 枚、配置文件在场 3/3），真 `tsc --noEmit` 八趟——趟1 基座 0 错、趟2 提交件 0 错、趟3 一次性负探针拿到 `error TS2322` 一行（证明那一趟工具真跑过）、趟4 清探针后仍 0 且探针残留枚=0、m1/m2/m3/m4 各 0 错（变异件必须是能编译的源文，否则「咬住了」与「编译不过」在日志里长得一样）、趟9 复位提交件 0 错。装配件自证 md5 `281fb2aeb175`/CR 字节=1,656/去 CR 后 `524089fd2831` 与前置腿基座合=true；工作树那份 `odt.ts` 跑前跑后 `a702edb69ac2` 相同＝并发侧的账，本轮没往工作树写一个字。
- 确定性腿：`g12` 两趟日志 62 行里不同的只有 11 行——10 行是「写出件 md5」（zip 里的写出时间戳）加 1 行尾行的日志文件名，其余 51 行逐字节相同；写出件字节数两趟相同（1,968 与 1,973）⇒ **又一次确认件级 md5 不能当不变量而 XML 部件能**（`g12|C` 比的正是部件）。门面那一头的确定性由 `g6a`↔`g6c` 两趟逐臂对给出（共同臂 21 枚里 20 同，唯一不同的那枚原因是夹具改过，见上一节那行）。
- 本轮踩到的量具坑（记进 README）：① **「第一圈/第二圈」标签下的读数必须是那一圈的**——这类错的症状是两行内容一模一样而断言全绿，抓它的唯一办法是把标签所指的那枚变量自己打出来；② **行枚有两把尺**（`splitlines` 与 `split('\n')` 差一枚尾换行），同一份基座在两枚腿的 B0 自证行里会打架，跨腿引行数必须报腿名；③ **控制台是 gbk**——本轮用 `python -c` 直接打印带「等于号箭头」的行拿到 `UnicodeEncodeError` 而脚本什么都没写，锚点一律落 UTF-8 文件再用读文件那枚工具读回；④ **怀疑一枚腿的标签错位时，先在同一枚腿里找另一行交叉核**——`g10` 的「面 mX 相对 head」一度被当成错标，按它自己打印的「变异 mX：相对 commit 变页账件枚=0」核过之后确认标签正确、腿没动；⑤ **只补正则而不给换算（m1）与换算写错分母（m3/m4）都不改落屏枚数**——数枚数的判据对「换系数」这一族永远是绿的，延续上一轮那条纪律。
- 本轮没动的（各开一枚进路线图）：`em`/`ex`/`%` 三档两头都不收而门面对它们给的是退化页（等于这一族没有第三头判据）；真件页面族没有 px/pc 字面 ⇒ 新补那两枝只有夹具一头；`lenPx` 与 `cm2mm` 的单位榜还没并（`pc` 只在这一枝）；`DEFAULT_COL_GAP ± 0.6` 会把错系数读成「整枚没账」；`n <= 0` 那道闸与门面把 0 读成有值之间的分歧（页面族问位上 35 枚显式 0）；自家写手只发 cm ⇒ 这三档在自家往返里自证不了；`cm` 折 mm 的 ×10 与 `lenPx` 那套 px→mm 并存（同一物理宽度差 0.003mm）。
- 收尾：README 新增本节 + 六处就地改口（上一节「本轮没动的」第一句挂指针、架构那节 `lib/odt.ts` 补本轮单位榜口径、路线图 A 类那枚里的「pt/px/pc 全拒收」改口、`cm2mm` 不收 pt/px/pc 那枚勾掉、显式 0 那枚把「有没有写 0 没扫过」换成 35 枚读数、裸数那枚补 SPACE 档读数）+ 路线图勾掉 1 枚而新开 7 枚（未勾 264→270、已勾 130→131）；**本轮不占版本号**（`package.json`/`Cargo.toml`/`tauri.conf.json` 住着并发轮次的 0.119.0，本节按内容命名）；并发会话在场 ⇒ dev 树与工作树那份 README 全程未碰，提交走 index-only blob（`src/lib/odt.ts` 与这份 README），只本地 commit 不 push；一次性腿件与日志留在被忽略的临时目录里。

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
  index.css           外壳样式、两套主题，以及**纸面与屏幕主题的断钩处**（v0.49）：屏幕上的颜色一律先落进 CSS 变量（`--bg/--panel/--text/--text-2/--border/--accent/--code-bg/--quote-bg`），`@media print` 里一段同时命中 `:root` 与 `:root[data-theme='dark']` 的规则把 `color-scheme` 压回 `light` 并重声明整套纸面调色板（**段必须排在暗色段之后**，同特异度靠源序说话），顺手清掉屏幕辅助（`.fr-hit`/`.fr-active` 的查找命中高亮）；内容自己声明的字面色（段落底纹、单元格底色、幻灯片背景）不经过这条规则，所以照旧上纸；v0.50 又在这里补了 `.doc-content{min-height:0 !important}`——屏幕上那 900px 是打字辅助，矮纸（横向/A5）的可印高度不足它，正文尾巴会被顶成凭空多出的空白一页；**表格的网格线从无条件改为 `.sheet-print-grid` 一类**（v0.51：`printOptions@gridLines` 是打印设置里的一勾，而 Excel 的默认是"没勾就不印"），并新增 `.sheet-print-heading`/`.sheet-print-corner`（行列标题）与 `.sheet-print-band{break-inside:auto}`（一个列带一张表，带内可被分页切开，带与带之间由 `.sheet-print-break` 隔开）；v0.52 再添「页面设置」面板那一份（`.print-pop` 的分组 fieldset、毫米边距格、开关格、分页符 chip，以及 `.print-pop-errs` 与 `.print-pop-notes` 两本账的分色，`--danger` 同时进暗色 token 与 `@media print` 的纸面调色板——面板自己也可能被印出来，规矩照 v0.49 那条「屏幕上的颜色必须先穿过一枚 CSS 变量」）；**v0.59 换掉了 `.sheet-print-table td` 那一整档行盒**：`font-size` 从写死的 `11px` 改成 `var(--oof-print-base-size, 14.67px)`（底数由每张表 `<section>` 上那枚自定义属性说话，括号里那档只是"文件那一层没交代"时的兜底，与 `baseFontPt` 同一个数），`padding` 上下归零、`line-height` 从 1.45 收到 1.25、**`height:18px` 不再写**——底数一动，旧的固定行高就成了多出来的一截（接上文件而仍用旧行盒时 11pt 那份每行 24.98px、被挤成两页），而 1em 的方框又装不住下行墨（td 是 `overflow:hidden`，`line-height:1.0` 那一档在纸上把 p/g/y 那几笔切掉），1.25 × 底数正好落回 Excel 那一档（11pt ⇒ 13.75pt vs Excel 报的 14；14pt ⇒ 17.5 = Excel 报的 17.5）。**这一档行盒是 `PRINT_ROW_BIAS_PX` 的标定条件**：再动 `line-height`/`padding`/把 `height` 写回来，那枚偏置必须重跑实测；**v0.90 在这一层给列宽把手补齐了样式**（`.column-resize-handle` 这一族此前产品里一条 CSS 都没有，`grep -rn "column-resize" src/` → 0 命中，实测装饰 rect 是 `width 188 / height 0` 而拖拽功能一直是通的）：`table td/th{position:relative}` 一枚 containing block + 把手 `position:absolute; right:-3px; top:0; bottom:0; width:6px; cursor:col-resize`，常态靠 `::after{opacity:0}` 不刷存在感、悬停才 `.65`（不占额外宽度），拖拽中的那一列用 `outline:2px solid var(--accent); outline-offset:-2px` 而**不用 `background`**（v0.38 那层单元格底纹是内联样式，背景会把它压掉），`@media print` 里 `.column-resize-handle{display:none}`——编辑态的把手不上纸；全部选择符住 `.doc-content` 口径内，且**不给这一版根本不产出的 `.column-resize-proxy` 写样式**；**v0.93 在这一层的 `.doc-content` 那条 print 规则里补了 `overflow: hidden`**（与 v0.50 那句 `min-height:0 !important` 同住一条规则）——版心是纸上的硬边界：内容比版心宽时 Blink 打印会把**整页**按比例缩小去迁就那一枚超宽件（实测 900px 的表 ⇒ `scale` 0.6981 = 627/899，正文 15px 在纸上只有 10.5px），而 Word 从不替整页决定字号（它的表按真尺寸排、超出纸外的部分被纸裁掉）；注入五枚候选里只有 `.doc-content` 与 `.doc-page` 这两条能修住 `scale`，选前者因为它只管正文那一层、不牵页眉页脚与分页参考线，且**只在 `@media print` 生效**（屏幕上 v0.92 刚立的"超宽如实撑出"那一档一个字没动）；**v0.94 把表从这一层的 `break-inside: avoid` 家族里摘出来**（`.doc-content table{page-break-inside:auto; break-inside:auto}` 一条独立规则块，同族的 `img`/`pre`/`blockquote`/`.doc-toc` 照旧 `avoid`）——`avoid` 带着表格时比剩余版心高的表被整张推到后面一页（22 行那张 3 页而第 1 页 0 枚格标、`mid` 臂页边空出 304.9px），显式 `auto` 后纸上是"表级流、行边界切、不劈行"（`tall` 2 页、页边三臂第 1 页行数恰为剩余空间容得下的 1/2/4），两句都写是因为老 Blink 只认 `page-break-inside` 而"靠缺省值"那一档实测就把表推走；**刻意不给 `tr`/`td`/`th` 补 `avoid`**：注入候选 `i2`/`i3` 量出来在装得下的表上是纯 no-op，而 `bigrow`（单行 1953.7px 比一页还高）从 3 页退回 4 页＝同一枚缺陷换面孔；**v0.95 再加三条（表头组）**——屏幕一条 `.doc-content table.doc-th-rep > thead.doc-th{display:none}`（克隆在屏上不占位，实测表高差恰 0），`@media print` 两条：那枚 `thead` 写 `display:table-header-group` 与 `tbody > tr:has(> th){display:none}`（藏原行，纸上由克隆来当那一行）。少写其中任一条都是实测过的错形状：不写屏幕那条 ⇒ 屏上多画一整行 50.9px 且纸上每枚表头标出现两次；不写 print 里的 `table-header-group` ⇒ 纸上第 2 页无头（`head 3/0` 原样）；不藏原行 ⇒ 纸上第 1 页 `head=6`；
  **v0.96 把这一族剩下的三件也从 `avoid` 里摘出来**（`.doc-content pre, .doc-content blockquote, .doc-content .doc-toc
  {page-break-inside:auto; break-inside:auto}` 一枚规则块，与 v0.94 表那一块同住 `@media print`）——同一枚「整块推页」
  的后果在它们身上逐枚量过：40 行代码块 3 页而第 1 页 0 枚行标、60 段引用 4 页而第 1 页 0 枚、目录摆在正文中间时
  第 1 页下部约 338pt 空着；**这一族从此只剩 `.doc-content img{break-inside:avoid}`**，因为注入 `j4`（跟着把 img 也摘）
  与 `j3` 逐页同形且裁剪框位置逐枚同＝替换件没有内部断点，摘它是纯 no-op；两门都写同 v0.94 的理由，且**不给块内部
  补 `avoid`**（页边六档 `fill27`~`fill32` 量出的正是「剩余空间吃几行」：改后第 1 页 3/2 枚，而 29~32 那一档剩余连
  一行都不容 ⇒ 与改前同形不是漏修）
  lib/univer.ts       Univer 实例工厂（公式 worker + 八个社区预设：核心/筛选/排序/条件格式/数据验证/查找替换/绘图 + **批注与超链接**（v0.48，超链接的 `urlHandler` 把外链交给系统默认浏览器——桌面上 `window.open` 会开出一个新 WebView 窗口））
  lib/univer-io.ts    xlsx 数据+样式（粗斜/颜色/字族/边框/对齐/换行/数字格式）/合并/图表/列宽行高/隐藏行列/冻结窗格 ↔ Univer 快照 转换（样式去重注册）；**规则走侧通道**——取完单元格再按 sheetId 把 `extractRules(resources)` 的结果对回每张表，`warnings` 由 `aggregateNotes` 聚合；**批注与链接同一条侧通道**（v0.48）：取侧交给 `extractCellSide`，放侧把 `resources` 写成 `[noteResourceOf(...)]`（实测裸写就能被门面读回）、链接写成带 `customRanges` 的富文本格（**公式格上那枚先记账不硬放**，只有链接没内容的格子也要占一格）；`payloadToWorkbook` 因此多收一个 `accounts` 出参
  lib/sheet-rules.ts  三类规则的前端桥（v0.46）：`extractRules` 从工作簿快照的 `resources` 里按表取规则（Univer 三个插件各写各的 JSON，条件格式按快照原序交回=高优先级在前），`applySheetRules` 经门面放回界面（**条件格式倒着插**，因为这一版门面按插入顺序的倒序吐规则；builder 无 `setRanges`，作用区在 `build()` 之后挂产物），`buildDataValidation` 只建门面表达得出的四类 + custom；归一化（`normColor` 收 rgb/#、`normDateValue` 收 ISO、`listOf` 拆 JSON 数组串与区域引用、`neg === pos` 的负色丢掉）与 `aggregateNotes`（同类收成"文案×N"）都在这，`textLength`/`time`/`any` 这类摆不进模型的退成边界账而不是硬建一条；**v0.64 那三句"没能还原"后面的原串改走 `lib/fail-msg.ts` 的 `failText`**（账目本来就上状态栏，原话只该有一份出处）
  lib/sheet-cell-side.ts 批注与超链接的前端桥（v0.48，纯函数、零 DOM、Node 直测）：`extractCellSide` 从 `resources` 的 `SHEET_NOTE_PLUGIN` 按表取批注、从每格 `p.body.customRanges`（`rangeType` 只认 HYPERLINK）取链接，`noteResourceOf` 反向建 resources（实测裸写即可被门面读回，所以**不发消息不走门面**），`richTextOf`/`richTextBox` 负责"链接格吃的是 p 不是 v"这一层，`univerUrlOf`/`locationOfUniverUrl` 在 OOXML 的 `Sheet2!A1` 与 Univer 的 `#gid=<表 id>&range=` 之间换算（`quoteSheetName`：含空格或长得像单元格引用的表名要加单引号、`''` 是引号本身），`restampCellSide` 存盘前按格子把 Univer 模型装不下的 `author`/`tip` 回贴（**只在缺的时候贴**，界面上新写的那一枚不冒用别人的署名），装不下的形状退成边界账而不是挑个像样的凑数
  lib/chart.ts        ChartPayload → VChart spec → 离屏 canvas PNG dataURL（动态导入分包）
  lib/docx.ts         docx 导入导出（ProseMirror JSON ↔ docx，字色/字族/字号/高亮/页眉页脚/TOC 域/批注/页面设置 sectPr（纸张·四边距·w:cols 栏数栏距）/页码格式（PAGE·NUMPAGES）/分页符/表格合并映射（首行行级 tableHeader、列表 numbering.config 真编号）、单元格四边 `w:tcBorders`（**显式去边写 `w:val="nil"`**——none 压不住表级默认边框）、`w:shd` 底纹、`w:vAlign` 竖排、`w:tblInd` 表缩进、`w:vertAlign` 上下标、段落 `w:spacing`（行距 + 段前段后，**只写声明过的**）/`w:shd`/`w:pBdr`、run 级字符间距 `w:rPr/w:spacing@w:val`（缇＝磅×20；0 那枚被写手库的真值闸整枚吞掉而不写——字符写侧第一笔账）、脚注与尾注（`footnotes`/`endnotes` 记录 + 正文各带自动编号 `<w:footnoteRef/>`、多段拆多个 `w:p`、部件与 rels 注册）、**表格列宽（v0.89 建通道、v0.90 把认账松成「有几枚写几枚」）**：`gridPxOf(rows, contentTwips)` 把行 0 各格的 `colwidth`（按 colspan 展开的数组）摊成 `laid: (number | null)[]`，三道形状门（数组长度必须等于该格 colspan / 枚枚必须是正数——`0` = 该列没账是库自己的约定 / **每行在网格上的占位必须铺满列数**——v0.91 把这一道从"数行内自己的格子"改成按占位走 `gridShapeOf`，被竖跨压掉的格子算占位而不算缺格，此前含竖跨的表整表判成形状不合、宽度账整表作废）任一不合 ⇒ 整表按「无宽度账」处理且**七个出口全返 null 不返空数组**；一枚账都没有才走无账那一档，**部分账（界面上拖一次得到的 `[248]|null|null` 那一型）按 `fill = max(1, floor((contentPx − Σknown) / rest))` 补平**——齐账时 `rest === 0` 直接返回、不进补平分路，只有未带账的格子吃补出来的那一份，补完的总宽必然 = 版心；有账时表级写 `{w:tblW 绝对值 = 网格和, w:tblLayout fixed}` + `columnWidths` 真网格 + 逐格 `w:tcW` = 所跨网格列之和（网格游标按 `gridShapeOf` 给的**真格子起始列**走（v0.91：`start = shape.starts[ri][ck++] ?? gc` 后 `gc = start + cs`；被竖跨压掉的列不省，省了就把整行往左错一枚、键进去的账落错格子），无账时只把 `w:gridCol` 按版心等分写真值（`equalGridPx`：px→twips 那条唯一换算的逆用，保底 1）而**表级仍 100% 百分比、不声明 fixed、不盖逐格 tcW**——这一档买的是「别再写 docx 库默认的 `w:gridCol w="100"` 那枚 6.7px 假网格」（它读回来是一枚荒谬但真实的 [7]px 并被下一趟当宽度存下去），不是替用户决定布局；版心由 `contentTwipsOf(pg)` 一处算出（页宽 − 左右边距 − `colGap×(栏数−1)` 再按栏数分；v0.91 从导出入口内联的那份搬出来，`contentPxOf` 是它的 px 口径、界面上的精确列宽同吃它）并经 `blocksOf` 第 4 参穿过四处递归，形参兜底 `CONTENT_TWIPS_FALLBACK` 由 A4 + 默认边距算出而非硬编码）；文本节点兼容顶层 text 与 attrs.text；字节经 Packer.toBase64String + atob 取（toBuffer 走 jszip 的 nodebuffer 通道，浏览器里没有 Buffer））
  lib/ooxml.ts        迷你 OOXML XML 解析器（零依赖、不碰 DOM）：parseXml/find/findDesc/all/allL/attr/attrL/val/valNum/textOf + decodeEnt 实体表——让 docx 读侧能在 Node 里直测
  lib/ooxml-graphics.ts 图形部件读侧（v0.42，零依赖、不碰 DOM 所以 Node 侧可直测）：`smartArtToHtml(dataXml, inCell)` 解 DiagramML dataModel 的 ptLst/cxnLst（parOf 建树 + srcOrd 定序、空节点下钻、首次认父挡回边、`a:fld` 域编号不采）→ 嵌套 `bulletList`（格内改段落 `margin-left` 表层级）；`chartToHtml(chartSpaceXml, inCell)` 解 ChartML 缓存值（下钻找系列、`strRef`/`numRef` 中间层、`c:pt/@idx` 空洞留格、`multiLvlStrRef` 各级拼一格、轴标题不当图表标题）→ 标题段 + 数据表，无缓存只取标题；两者都返 `{html, kept}` 让调用方按"真取回多少"说告警
  lib/cfb.ts          复合文档（OLE 2 / MS-C 容器）读侧（v0.44，零依赖、不碰 DOM）：`isCfb` 认魔数、`openCfb(bytes)` 走 DIFAT（109 直槽 + 链）→ FAT（扇区编号即下标）→ 128 字节目录项的红黑树（left/right 兄弟 + child 指孩子根，`assigned` 兼防环），小于 4096 的流从根存储链装的迷你流按 64 字节迷你扇区拼；扇区 512/4096、v3/v4 都认，**结构不合返回 null 不抛**（坏件要"少部分内容照出"而不是整篇打不开），截断的件按 `floor(len/sec)-1` 收边界、v4 高 32 位非零的流只报名字不去碰
  lib/ole.ts          OLE 嵌入对象的**内容**提取（v0.44）：`unwrapEmbed` 拆容器（现代形状=部件本身就是原生文件；老形状=复合文档里的流 `\x01Ole10Native`），`oleNativePayload` 按实测字段布局走一遍、走不通再按"哪枚 DWORD 能把数据吃到接近结尾"扫兜底（数据不贴着流末尾，按流长反推必错）；`classifyEmbed` 先魔数后文件名，`embedHtml(content, depth)` 分派 docx（递归 `docxToHtmlFidelity`，depth≥2 停）/ xlsx（只要值，`r="C5"` 定位、空列不挤位）/ CSV（首行嗅探分隔符 + RFC4180 引号）/ txt（空行分段，UTF-8 出替换符换 GBK 重试），取不出的一律给带真名与大小的 `note`；上限 24MB / 200 行 × 40 列 × 4 表 / 64KB × 200 段，**截断写进告警不静默少给**；`inlineFlatten` 把块级正文压成行内（单元格放不下第二层表）
  lib/docx-fidelity.ts OOXML → HTML 保真导入器（v0.37）：run 级 rPr（粗斜/删除线/下划线/字色/高亮/字族/字号/上下标 `w:vertAlign`）、段落 pPr（jc/`w:ind` 左右与首行悬挂四种缩进写法/pStyle 样式链）、numPr+numbering.xml → 有序无序与 ilvl 层级（**跳档按 numId 折基准层**，不凭空补中间层）、表格 gridSpan/vMerge + tblGrid 列宽（**表格读侧第十笔账起，列账第一次由 `w:tblLayout` 分流且所有行一起上账**：`layFixed` 由 `w:tblPr/w:tblLayout@w:type` 是否为 `fixed` 决定——fixed 那一档 `w:gridCol` 是**地板**（逐格 `tcWpx` 只往宽里抬 `total > acct[k]`、两行同列取最大、跨列格的正差落所跨**最后一条**而负差丢、`c.cont`（`w:vMerge=continue`）那一格 `continue` 不参与、跨到缺账列时把正差补进缺口），autofit 与 layout 缺失那一档反过来（另立一盘 `pure`，逐列取各行 tcW 的最大且**缩小照落**、跨列格 `total / span.length` **均摊**、最后 `pure[k] > 0` 才覆盖网格，一行都没说话的列退网格）；**第十一笔账把逐格那一族按型别收口**（`tcWpx` 由排除法换成白名单：只有 `dxa`（缺省也算 `dxa`）才是数字，`auto`/`pct`/`nil`/规格外一律 `null`＝账外——nil 跟着当数字读会造出一枚假宽（`p_type_nil` 旧 [75|90|120] ↔ Word [60|90|120]＝网格），而 pct 的基数是**表宽**不是版心、表宽那道门仍关着）；出账闸门与发射门仍不动（`acctKnown = gridKnown || !!tblTotal`、`ri === 0 && acctKnown` 配 `.filter((v) => v > 0)`）；**表格读侧第八笔账起，整盘账都没说的那些列改由表级 `w:tblW` 折宽后等分**：`tblWpx` 吃 dxa/pct 两档而 pct 按五十分之一百分点折版心（**第十二笔账把 `nil` 并入 `auto` 那一档**：带正数的 nil 在 Word 门面报 `pwtype=1 pw=0.00`，而规格外与缺 `w:type` 在这一层仍复用数字 ⇒ 表级不设格级那道 dxa 白名单、两族方向相反；表宽折算的 pctype 门与逐格白名单本轮一字未改；**第十三笔账把表级 `@w:w` 的字符串字面接上**——旧那句 `const raw = attr(tblW, 'w')` 只匹配无前缀的 `w=` 键，而真 OOXML（含自家写侧）落的是带前缀的 `w:w="30%"` ⇒ 那一档在真件上从不达；改成 `attr(tblW,'w') ?? attrL(tblW,'w')` 后**字面按百分之几折而数值按 5000 分之一**，字面另过一枚形状闸 `/^-?\d+(?:\.\d+)?%$/`（`"30 %"` 在 Word 报 `pw=0` 故与 `abc%` / 空 / `"-10%"` / `"0%"` 同归账外））、`contentTwipsOf` 从 body 末尾 `sectPr` 的 `pgSz` 减左右 `pgMar` 算版心、出账闸门由 `gridKnown` 换成 `acctKnown`；**真数 `w:tblW` 压过逐格账那两道门（fixed 等比缩 / autofit 除以首行格数）第十笔账量清机理仍不开**——动它要重标 v0.92/v0.93/v0.94 三批屏上与纸面基线）+ 单元格四边 `w:tcBorders`（含 val=nil 的显式去边；**表格读侧第十四笔账起这条边的粗细带一枚最小发墨档**：`w:sz` 低于 2 抬到 2，三族——表级六槽、逐格四边、段落四边——共用 `edgeCss` 那一枚换算）/底纹 `w:shd fill`/竖排 `w:vAlign`/表级 `w:tblInd`、段落 `w:spacing`（行距两档 + 段前后，含按行的 `w:*Lines` 估算）/`w:shd` 底纹/`w:pBdr` 四边、脚注与尾注引用（`w:footnoteReference`/`w:endnoteReference` 按 `w:id` 配 `word/footnotes.xml`·`endnotes.xml` 正文，跳过 separator/continuationSeparator，正文缺失记告警且不留空标记）、图片 rels→dataURL、内外超链接、分页符、批注三态锚点、域代码文字不外泄、**域编号重算**（v0.43：`fldChar` begin/separate/end 三道门接 `docx-fields` 的 `FieldEngine`——`SEQ` 现算并压掉缓存、`REF` 无缓存按书签段落文本兜底（书签表渲染前预扫）、算不了的沿缓存且无缓存记边界、`fldSimple` 同路、被跳过的分支不占号）、`w:object` 嵌入对象（v0.43 预览是 EMF/WMF 解不开时留一行可见占位，ProgID + rels 反查的部件文件名；**v0.44 先走 `lib/ole` 取内容**——取到就把内层正文接为段落兄弟块（格内改压行内）且不再叠占位，取不到才留占位）、文本框 `w:txbxContent`（`wps:txbx` 与旧式 `v:textbox`）展平为段落、OMML 公式线性化、`mc:AlternateContent` 只取 Choice（空则退 Fallback，避免同一份正文翻倍）、drawing 锚点经 rels 找图示/图表部件（v0.42，部件缺失与关系缺失各记一条告警）、**格底纹的三层取一与格边距的六层逐边合并（表格读侧第六、七、十五笔账；第十五笔账把行条件层 `w:tr/w:tblPrEx/w:tblCellMar` 铺在条件层 `mar` 槽之上、逐格 `w:tcMar` 之下——它是 `w:tr` 的首子而不是 `w:trPr` 的孩子，顺着 `w:trPr` 找就永远够不着）**：底纹按「哪一层的 `w:shd` 在场」比（逐格 > 条件层含四枚角型 > 被引用样式的 `w:tcPr/w:shd` 基座，沿 `w:basedOn` 本体说了才覆盖祖先），条件块从此**两格分开记账**（`CondCell = {mar, tblMar, shd}`：`w:tcPr/w:tcMar` 那格交回 `mar`、`w:tblPr/w:tblCellMar` 那格交回 `tblMar` 而归**样式层**——压过样式基座而压不过表自身），两族的落点各走一枚 8 档梯子而**梯子反着**（底纹在 `condShadingFor` 里按 角型 > 行型 > 列型、首行压末行、末列压首列且角型只落那一角那一格；边距按具名的 `condMarginLadder` 列型 > 角型 > 末行 > 首行，角型按其所在那一整行落），两族都要 `w:tblLook` 的对应位说话（角型要那一角的两枚位都开，`@w:val` 那位十六进制从不被 consult），内建 `TableNormal` 走替换名单（`SUBSTITUTED_TABLE_STYLES`：Word 打开时换上自己的定义，文件里往它身上写的数从不落地）而「默认标记」不再当门，图案档 `@w:val=pct50` 只读 fill 并按型别记一句；认不出就抛错或 blocks=0，调用方回退 mammoth；格里的 `w:tbl`（第十六笔账）不再展平为段落，走同一枚 `table()` 出真嵌套表；**段落读侧第一笔账**把样式链上 `mergePPr` 的叠法改了口——只有 `w:ind` 那一枝从「整枚元素替换」换成 `mergeIndAttrs` 「逐属性合并」（同名者后写层压前写层、段落没写的属性留样式那一枚，`firstLine`|`hanging` 与 `firstLineChars`|`hangingChars` 各一枚槽而**同槽只认后写那层**，其余同名子元素与孩子的取法一字未改），字符那一档的宽度底数从硬写的 16px 换成段落自己的字号（`paraCss` 新吃第三枚参数 `baseSz`，与正文渲染同一份字号账，解不出才退 `.doc-content` 的 15px）；**段落读侧第二笔账**把这枝通用化——`IND_SLOTS`/`mergeIndAttrs` 退场，换成一张 `PPR_ATTR_SLOTS` 表配一枚通用 `mergeAttrAttrs`，`w:spacing` 从此与 `w:ind` 同走属性名合并（`w:line`|`w:lineRule` 是一枚槽、后写那层要连主属性 `w:line` 一起写才整槽归它；段落层丢掉的最大头 `line(正)=679` 段第一次够得着），段前/段后仍按「行档压缇档、缇档的 0 是真值而行档的 0 只压同名前写层」判；`w:shd`/`w:pBdr` 量到真件里两层都在场 0 段 ⇒ 照旧整枚替换、只留注释；**字符读侧第一笔账**在 run 那一层接上字符间距——`readRPr` 收 `w:spacing` 的 `sp`（单位留缇，闸门是「这一层写没写这枚数」，所以 0 压过样式而缺省才留样式），`baseRunProps` 里段落标记那层（`w:pPr/w:rPr`）的间距一律不进正文基准，`cssOf` 出口 `letter-spacing: ${sp/20}pt`
  lib/docx-fields.ts 域重算引擎（v0.43，零依赖、纯 Node 可直测）：`parseInstr` 拆 `命令 参数 \开关`（**开关 token 原样保留大小写**——Word 就按它决定结果形态）、`seqText` 按 `\* ROMAN`/`roman`/`ALPHABETIC`/`alphabetic`/`Alpha` 出对应形态、`FieldEngine`（`from(doc)` 渲染前扫全篇建书签表（只排 `_GoBack`，`_Ref…`/`_Toc…` 必须留）+ `seqValue` 跟着文档顺序走 + `refText` 兜底段落文本）、`recomputable`（只有带 label 的 SEQ 现算）、`fieldLabel`/`paraText`（域代码与已删文字不算正文）
  lib/cell-style.ts   单元格样式扩展（v0.38）：tableCell/tableHeader 的 bdTop/bdRight/bdBottom/bdLeft + background + vAlign、table 的 marginLeft 全局属性（只声明属性不改内容模型）；边框统一规范串 `"0.67px solid #8899aa"`，三态 null 未声明/'none' 显式去边/有值；`inlineBorder()` 读 CSSOM longhand（shorthand 对 none 返回空串）、`IndentTableView` 子类补 marginLeft（resizable 的节点视图不传 HTMLAttributes；**v0.92 起 `applyIndent` 里加一枚宽度判定**——`accountTotalPx(node)` 非零就写 `width: Σpx`，否则才退回 `calc(100% − ml)` / `''`，缺陷在自家这一层而不是库）、`eighthsToPx`/`pxToEighths` 管 1/8 磅换算、命令 setCellBackground/setCellVAlign；**v0.88 拆掉两处静默**——① `CSS_BORDER_STYLE` 补上 Word「虚线」对话框实际写出的那几档 token（`dashSmallGap`/`dashLargeGap`/`dotDotDash`/`dashDotStroked` → `dashed`；原先只有 `dotDash` 会被小写归一命中，`dashSmallGap` 命不中 ⇒ Word 里的虚线导进来显示成实线、再导出也是实线且零告警），② 表头格那枚 no-op：`setCell` 原来是 `updateAttributes('tableCell',…) && updateAttributes('tableHeader',…)`，表头行上第一型返回 false 就整条短路 ⇒ **边框/底纹/竖排对齐在表头格上从 v0.38 起全是静默失败**，改成 `[两型].some(Boolean)`（段落那一头 v0.39 早就是这个形状）；同轮新出界面用的四味：`bdAttr`（边名 → 属性名）、`edgeAttrs`（若干条边 → 一份 patch）、`BORDER_STYLES`/`BORDER_WIDTH_PT`/`borderCss`（磅 → 规范串，换算只写这一处）与 `EDGE_LABEL`；**v0.95 加表头行克隆**（`scheduleReplica`/`syncReplica`，`spec.update` 里排队走 `queueMicrotask`——PM 重画行在同一趟之后）：把「开头连续的全部表头行」克隆进 `<thead class="doc-th">` 并给表加 `doc-th-rep`，供纸上 `table-header-group` 重复。三条形状由实测钉住：只克隆不搬移（搬走 `rows 23→22`、`thRows 1→0` 把模型吃了）、标记住 `<table>` 而不 `tr`（PM 会擦 `contentDOM` 里行的 `class`，实测 `tagged=0`）、那道门只认开头连着的那几行（`leading.length === 全部表头行数` 才过门，且撤旧克隆排在过门之前，中途夹一枚表头行的表整块不建克隆）
  lib/table-width.ts  精确列宽的把手（v0.91，252 行）：`tableGrid` 自己的占位遍历算出每格的**起始**行列与绝对位置（不借 prosemirror-tables 的 `TableMap`——它不是本项目的声明依赖、TipTap 也没转出来；跨列的格按起点记，实测跨两列那一格里光标认到的是第 0 列），`gridAccount` 只取行 0 摊平出的逐网格列账（与 docx 写侧同一份权威），`accountTotalPx`（v0.92 新立的导出纯函数，+19 行）把这份账折成一枚绝对像素数——任一网格列没账或 <1 就整表 `return null`，屏上的表宽就吃这一枚数，`baseWidths` 给没带账的列补 `max(1, floor((可用宽 − Σ已有账)/未带账列数))`（屏上那一档实测 `[248,null,null]` → 248/188.7/188.7 而 (626−248)/2 = 189，与写侧同一算法），`redistribute` 是键入一列之后的整表账（四道门：列数非零 / 列号在范围内 / 可用宽 ≥ 列数 / 键入值 ≥ 1px；键入列夹到 `min(键入值, 可用宽 − (列数−1))` 给其余列各留 1px；其余列按各自现有账**等比**分享剩下的那一份，舍入用最大余项法配平、每列至少 1px ⇒ Σ 恰等于可用宽，这是"键入值 1:1 上屏"的条件，否则浏览器按 `table-layout: auto` 把整表比例缩走），`tableTargetPx` = 版心 px − 表级 `marginLeft`（屏上写的是 `width: calc(100% - Npx)`，不扣它键入值照样被缩），`caretColumn` 给界面用（光标在哪一列 / 一共几列 / 当前显示值，没带账的列显示等分那一份与屏上一致）；`TableWidth` 扩展的 `setGridColumnWidth(px, targetPx)` **一次事务写遍该网格列的每一格**（只写行 0 会在同一次 dispatch 里被 `tableEditing` 的 `appendTransaction` 按其余各行抹回去）、先验齐再落（任一格的 `colwidth.length` 不等于它的 colspan 就整表拒绝，不写半份账进去）、**账本来就是这一份的格子跳过**（PM 的 `setNodeMarkup` 即便属性相同也推一步 ⇒ 重打同一个数字会凭空多一枚撤销步），全部跳过则返回 false 不派发
  lib/paragraph-style.ts 段落排版扩展（v0.39）：paragraph/heading 的 lineHeight/lineRule/spaceBefore/spaceAfter/background/bdTop..bdLeft 全局属性，一组属性拼**一条** style（多条各写一份会互相盖掉）；`ooxmlLine`/`lineToOoxml`/`ruleOf` 管 1/240 行与二十分之一磅两套语义，"最小值"档 CSS 表达不了就修行内自定义属性 `--oof-lr` 带回；命令 setParagraphStyle/setLineSpacing/setSpaceAround/setParaBackground；**v0.88 多一条 `setParaBorders(edges, value)`**（走 `edgeAttrs`，与单元格共用那一份「边名 → 属性名」的换算），段落这一头界面只给「清除」（写 `null` 收回未声明）不给「压掉」（`'none'`）——读侧早把样式链那层 `w:pBdr` 合并进段落自己名下（docx-fidelity 的 `effPPr`），编辑器里没有「一条样式边框等着被盖」这一层，而实测 Word 去掉段落某条边时也是干脆不写那一枚
  lib/indent-extension.ts 段落全局属性 indentLeft/indentFirst（32px 一档、上限 320px）+ setIndent/indent/outdent 命令 + Ctrl+] / Ctrl+[ + 悬挂缩进感知的出退格
  lib/char-spacing.ts 字符间距的一处换算（字符写侧第一笔账，71 行）：`toLetterSpacingPt` 只收 pt/px 两档（px 按 96dpi 乘 0.75，规范化到三位小数；判别式手写，所以 `em`、`calc(...)`、`1.5em`、`10pt 3pt` 简写、逗号全落不进来），`letterSpacingToTwips` 再 ×20 取整供 docx 出口，`CharSpacing` 扩展把 `letterSpacing` 挂成 `textStyle` 的全局属性（`parseHTML` 吃 `el.style.letterSpacing`、`renderHTML` 发 `letter-spacing: Npt`）——存的形状是带单位的规范化串而不是数字，因为两头写手通道只认字符串而数字在写侧会被当成「没声明」；两头单位换算与 0 那道记账闸只写这一处（ODT 读侧那一档 `normal` 不吃这扇门，由 `lib/odt.ts` 在查问处折成 `0pt` 才进模型）
  lib/toc-extension.ts TipTap 目录原子节点：按标题实时汇总、点击跳转
  lib/page-break-extension.ts TipTap pageBreak 原子块（`div[data-oo-pagebreak]`）+ insertPageBreak 命令 + Ctrl+Enter 快捷键
  lib/comment-extension.ts comment mark（cid 锚定批注）+ 加/删/定位/汇总工具
  lib/note-extension.ts 脚注/尾注的 `note` 内联原子节点（attrs kind/text，正文不摊进文档流）：`encodeNoteText`/`decodeNoteText` 管属性里的换行（XML/HTML 解析器会把属性值里的 LF 归一成空格），`notesOf`/`noteOrdinalOf`/`locateNote` 按文档顺序现算编号，命令 insertNote/setNoteText/deleteNote（只填 tr + 用给到的 dispatch，绝不自己 view.dispatch）
  lib/odt.ts          ProseMirror JSON ↔ ODT（JSZip 打包导出 + DOMParser 导入，字符样式（字族/字号/字色/上下标 `style:text-position`，落在 content.xml 自动样式）/合并表/图片尺寸/页码域与总页数/page-layout 页面设置（纸张·四边距·style:columns 多栏）/分页符 fo:break-before/单元格自动样式 `fo:border-*`（宽度写 pt，读回走 `odfBorderCss` 保留 0.67px 这类细线不整数取整）+`fo:background-color`+`style:vertical-align`、表级 `fo:margin-left`、段落直接格式 `fo:margin-top/-bottom` + `fo:line-height`（倍数写 % + proportional、绝对值写 pt + fixed/minimum，两档在 ODF 里分得清而 CSS 分不清）+ `fo:background-color` + `fo:border-*`（宽度写 pt），读侧按名字跳过具名样式与 `office:styles` 里那批，以免把整篇默认摊成每段的直接格式；脚注/尾注写 ODF 1.2 内联 `text:footnote-reference` + 同 `text:id` 的 `text:footnote`（citation 写字面序号、段间 `text:line-break`、正文段挂 `FN` 自动样式），读侧三种外壳都收（新版两个元素名 + 旧版 `text:note`/`text:note-class`/`text:note-body`），正文表先扫全文建全表，故 id 不连续或正文排在引用之前也配得上；`draw:frame` 认三类内容（`draw:image` 位图 / `draw:text-box` 文本框展平为 `<br/>` 连成的行内文字 / `draw:object` 嵌入件——`Objects/objectN/content.xml` 里有 MathML 就线性化成文本，否则 v0.44 走 `lib/ole` 取内层内容：`<office:binary-data>` 内联 base64 与 `Objects/objN/` 目录两种形状都解，摊出的块级正文由 `tail()` 作段落兄弟块接回、单元格内压成行内文本），`content.xml` 解析失败时抛出说得出是哪份 XML（否则表现为"打开了一篇空白"），读侧统一产 `warnings`（同类聚合成「文案×N」）交状态栏显示；**批注往返（v0.86）**：读侧把 `office:annotation` 收成 DocComment（`dc:creator`/`dc:date` 按**子元素**取——当属性取那一版是往返腿自己量出来的真缺陷；`annotation-end` 名字预扫配对、点批注锚在自己段落尾、annWrap 在每个块出口续挂还开着的跨段区间），写侧照 docx 那两条老规矩（`usedAnn` 同 cid 全局只一组区间、孤儿不写回），跨段区间同名 `office:annotation-end` 收口，`xmlns:dc` 声明在根 NS 上补齐——漏了它写出的字节连自家读侧都不认）；**格边距与行高（表格写侧第一笔账）**：写侧逐边落 `fo:padding-top/right/bottom/left`（cm 三位小数、0 是真值），行高走 `style:family="table-row"` 的 `style:min-row-height` + `style:use-optimal-row-height="true"`（`style:row-height` 那枚精确档 Word 门面无一例外读成会裁字的 exact，故只读不发），读侧逐边压过 `fo:padding` 简写、行高按 `style:row-height` / `style:min-row-height` / `fo:minimum-row-height` / `fo:min-height` 四档次序收、字符间距走 `fo:letter-spacing`（character / paragraph / `styles.xml` 具名样式三层在 Word 门面都进账，而 `style:letter-spacing` 与 `loext:` 那两族八臂全报 0 ⇒ 通道由门面裁；读侧（ODT 字符间距读侧第一笔账）在同一枝上查问 `fo:letter-spacing` 并从 `htmlOfStyle` 出 `letter-spacing: Npt`——字符写侧第一笔账发的形状 reopen 吃回来了；读侧第二笔账在同一枝上把声明为 `normal` 的那一档折成显式 `letter-spacing: 0pt`（Word 门面裁它是「说了 0」而不是「没声明」，而 `toLetterSpacingPt` 不吃那个词，所以只能在查问处折）；**长度 mm 档（ODT 长度 mm 档第一笔账）**：`lenPx` 与 `odfBorderCss` 各自的 mm 枝按每毫米 3.7795 px 折（曾与 terminal 那枝的 37.795 同值 ⇒ `Nmm` 字面全族 10× 偏），terminal 那枝（`cm` 与裸数共用）不动——改它会连两头都对的 `cm` 一起动，这一形状由一枚改 terminal 的变异臂量出来）；**页面块取哪一枚（ODT 页面块第一笔账）**：「这张纸」按 `<style:master-page>` 的 `style:page-layout-name` 选那一枚`<style:page-layout>` 的属性块——基座取 `styles.xml` 文档序第一枚，而真件 77 枚里 11 枚的第一枚住 `<style:default-page-layout>` 且六枚长度字面全缺 ⇒ 那 11 枚件的页账整枚没接住；引名查不到才回退文档序第一枚（回落那一档由夹具 G5 裁，型别闸由 G6 裁）；**页面长度单位（ODT 页面长度单位第一笔账）**：`cm2mm` 的单位榜从 `cm`/`mm`/`in`/裸数补成 `cm`/`mm`/`in`/`pt`/`px`/`pc`/裸数（pt 按 25.4/72、px 按 25.4/96、pc 按 25.4/6 折毫米）而末尾 `n * 10` 那一枝（`cm` 与裸数）一寸没动 ⇒ 页面族、图框 `svg:width`、栏间距三条通道同时吃新三档，`em`/`ex`/`%` 与 0 和负数仍按「没说」
  lib/find-replace.ts 查找/替换 ProseMirror 插件：按文本块匹配存 state、装饰高亮、findNext/findPrev/replaceOne/replaceAll 命令（命中上限 FR_HIT_CAP=2000 截断并标 `N+`）
  lib/doc-feed.ts     大件"喂进编辑器"这一段的阈值与通道（v0.87，137 行，纯函数 + 一条 dispatch 通道）：三枚常数 `FEED_THRESHOLD=5000` / `FEED_FIRST=12` / `FEED_BATCH=4000` 都由 release 真机量出来——5000 块那件采样空档 ≤92ms 而 5056 块那件已要 188ms（分界），400/1500/4000 三档整趟代价持平（取 4000）；`planFeed(src, hint?)` 两型输入（html 先按串长廉价预筛、再过一道"顶层裸文本就不切"的安全闸、最后用 `DOMParser` 数顶层子节点；json 直接数 `doc.content`），**hint ≤ 阈值返回 null ⇒ 调用方原样走今天的单片 `setContent`**；`runFeed(editor, plan, src, stopped)` 只吃实测唯一与整片逐节点相同的那条通道（C2）——JS 侧累加 `Fragment`（从不读活文档）、每批 `tr.replaceWith(0, doc.content.size, acc)` + `addToHistory:false`、非末批 `preventUpdate:true`（末批才 emitUpdate）、首屏两帧 rAF、批间 `setTimeout 0` 让出主线程、`stopped()` 按**这一趟的身份**取消；**为什么不能增量追加**（legC2 十五形状 + legC5 四件 A/B 逐节点对参照）：PM 的 `appendTransaction` 会在容器块之后补一枚可编辑空段，heading / bulletList / orderedList / table / blockquote / codeBlock 六类全不等（块数 5840→5841），"追加 + 边界撤填充"也补不回来
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
                      已下好的那 10 MiB 白下（dev 腿 D18 量成形状） / Workspace / SheetEditor（保存按 .xlsx/.ods/.csv 三分流，打开时把读到的规则经门面放回界面并把两侧账目显示在状态栏；**「页面设置」面板（v0.52）**——纸张/方向、六条边距（毫米）、缩放与"缩放到 N 页宽"、六个开关、打印区域与重复标题行列（可「用当前选区」「用选区首行/首列」按门面选区给）、手动分页符（按 Excel 的 `brk@id` 说法：这一行/列自己起新页）、页眉页脚三框 + 六枚格式码 + 奇/偶/首页三版 + **两枚缺省开着的开关（「页眉页脚随文档缩放」「与页边距对齐」，v0.55：勾着＝写 `null` 不声明、取消＝写 `false`，旁注一次说清哪一档我们照 Excel 乘了字号、哪一档两边差一圈）**；「确定」写进 `printRef` 侧通道、「清除这张表的设置」把它整个删掉、面板里的错把确定灰掉，做不到的那几条以账目形式随草稿说在面板上（v0.53 改了语气：页高档与居中已经接线，只剩起始页码真做不到；v0.54 之后偶数页那一版也不再是账——它真的印在偶数页上，面板这几句全部转述 `hfAndPageNumberNotes` 那一份文案）；**导出这一侧多了一段实测循环（v0.53）**——计划里勾了「缩放到 N 页高」或「上下居中」的表才走：建一次 → `measurePrintLayout` 离屏量 → `planSheetFit` 压档/算留白 → 带 `zooms` 重建，最多五趟，定档后把居中留白写回**同一份 DOM** 再交导出；账目分两头记（"压到 27%"那句要说在压它的那一趟、每张表占一格由后趟覆盖前趟，居中的账反过来只在最终缩放那份实测上算数）；DEV 门面钩子随这轮加 `printSet(表名, 载荷|null)`（落笔处＝面板「确定」那一行）与 `printHtml(zooms)`（把**将要上纸的那份 HTML**交出去，让脚本自己挂起来量真实布局）；**v0.57 工作簿默认字体走第三枚侧通道 `defaultFontRef`**（不放 Univer 快照——`IWorkbookData.defaultStyle` 在 core 里零读取、引擎兜回硬编码 Arial 11，而 `wb.save().defaultFont` 实测恒为 `null`）：加载时挂上 `dump.defaultFont`、换标签复位、在 `payloadWithCharts` 那一枚漏斗里回贴，于是存盘与导出 PDF 共吃一份而界面渲染不说谎；**v0.59 只把 DEV 钩子摊宽**（生产行为一个字没动）：`printHtml()` 的返回值多三枚——`defaultFont`（侧通道里那一层本体，冒烟据此分辨"文件说的"与"我们兜的"）、每张计划里的 `basePx`（计划算出的正文底数）、`baseVars`（那份 HTML 里所有 `--oof-print-base-size:<px>` 的含值列表，按张核）；**v0.60 添第四枚侧通道 `sheetFormatRef`**（按表名持有 `SheetFormat`，与前三枚同一脾气：加载时从 `sheets[].sheetFormat` 挂上、换标签复位、改名随 `migrateSheetName` 一起迁、在 `payloadWithCharts` 的漏斗里回贴，且 `if (f && !sheet.sheetFormat)`——快照自己说出来的那一张永远赢）；这一枚与 `defaultFontRef` 方向相反：`IWorksheetData.defaultRowHeight` 在 Univer 里是**活口**（喂了就界面认、而 Excel 根本不认它），所以这里**只收不放**——不喂编辑器也不喂纸面，只为存盘时原样落回；DEV 钩子 `printPlan()` 因此多一枚 `sheetFormats`，冒烟据此问得出"这一层交回了什么"，而结构测试那头的钉是"五个消费点里 `sheetFormat` 出现零次"；**v0.62 只撤两行**——`hasSide` 那枚判定与「ODS 暂不含批注与超链接」那句账目，因为 `.ods` 这两样现在真读得回也写得出，而另三句 ODS 账（图表／三类规则／页面设置）与 CSV 那句照旧立着（结构腿判的就是"撤干净了且只撤了这一句"）；**v0.63 只动两行**——`.ods` 那一路的 `await writeOds(...)` 改成 `writeNotes.push(...(await writeOds(path, payload)))`，于是写侧的账与 xlsx 那头走同一条汇合（`[...lost, ...writeNotes]` → 状态栏 `已保存（第一条，另有 N 条说明）`），另一行是把注释里的例子换成"规则摆不进 OOXML、批注落在被盖住的格上"；拼句的公式、`lost` 那三句 ODS 账与 CSV 那句一个字没动（本轮没有新桥：`sheet-cell-side.ts` 的取与放早就是格式无关的）；**v0.67 只动两行**——挂载点那一句 `readXlsx(tab.path)` 换成 `takeWorkbook(tab.path) ?? readXlsx(tab.path)`（这一趟的 IPC 早在外壳开标签那一刻就发出去了，这里只是把它取来用；取不到——不是从路径开的、或已被别处取走——才自己发一次，**不假设外壳一定先跑**），另一行是那条注释改口（它还写着 v0.35 的"先把 IPC 发出去，实例同时在造"，而现在发得比挂载更早）；dev 下 `React.StrictMode` 的双挂载会让第一趟消费掉 prefetch 而第二趟走自备那一路，于是**开发模式开一次表格标签读到两次件**（真机 S5 量到 `read_xlsx` 的条目 2→4）——这是 dev 独占的形状不是缺陷，判据钉的是"取在前、发在后"那个 `??` 顺序而不是"只发一次"，反过来为 dev 好看而阻塞第二趟就是拿生产行为换开发控制台；**v0.69 存盘那一段开始说话**——`busy.arm()` 排在 `wb.save()` **之前**（那是同步块的头，门晚一纳秒都量不到它）、`await pickSaveFile` 之前 `busy.cancel()` 之后取完路径再 `busy.arm()`（另存为挑路径可以挂几分钟，那句「正在保存…」留着就是说谎）、`setStatus(saveDoneText(notes))` 排在把成功交回那一路而 `finally` 里再撤一次门、失败那一句走 `failStatus(e, '保存失败')` **把「正在保存…」原地换掉**（不清就等于让用户以为还在写盘，原话照旧留在悬停里）；收尾那句的清除定时器 `doneClearRef` 挂在存盘最开头，于是同一个标签补跑的那一趟会**先把上一趟的「已保存」撤掉**（不撤的话第二趟还在写而屏上已经写着"已保存"，那是这一轮最像成功的错）；接线只有 `busy` 那三行与 `saveTab` 那两行，句子与时钟一律在 `lib/save-status.ts` / DocEditor（页面设置含分栏/页码格式、分页参考线、分页符、表格与图片上下文工具条、粘贴成图、查找替换面板、字体族·字号、缩进工具条与 Ctrl+]/[、上下标 X²/X₂、表格上下文条的底纹色与竖排对齐（上/中/下）、**v0.91 的「列宽」数字输入框**（在 `.doc-table-bar` 那一排：`caretColumn` 认光标所在的那一列、`tableTargetPx(state, contentPxOf(eff))` 给这一张表实际可用的宽（版心 px 扣表级 `marginLeft`），Enter 与失焦各走一次 `setGridColumnWidth(px, target)`；`key` 按「列号 + 当前值」重挂载，于是同一列上键入同一个数字不会留着旧输入框的脏值；不在表里整排不出现，非正数直接 return 不发事务）、脚注/尾注（工具栏插入 + 文末分区编辑与定位/删除，打印时文本框换静态块）、版本历史·自动保存、模板 seed、状态栏字数节流；**v0.88 给边框这一层建了界面上的把手**（此前读与写两条链路自 v0.38/v0.39 就齐着，而全仓 `.tsx` 里 `bd*` 零命中＝用户一个字都改不了）——段落四边（`.doc-para-bar`）与单元格四边（`.doc-table-bar`）共用同一排 `bdRow(cur, write, suppress)`：先选线型/磅/颜色，再点要加的边，点已着边的边＝取消这一边；「着边」只认真线（`borderParts(…) !== null`，`'none'` 不算），「清除」写 `null` 而单元格那一路（`suppress=true`）多一枚「压掉」写 `'none'`（表格自带一圈表级边框，不显式压就盖不掉），一次「四周」只推一枚改文档的事务；打开 .docx 保真导入优先、mammoth 兜底，保存按 .odoc/.odt/.docx 各自格式原地落盘；**v0.71 把这一头分成两层**——
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
                      fidelity-report.mjs（属性级覆盖率生成器：注入探针取分子、全树普查取分母，写
                      docs/fidelity.md 与 .json——产物只有聚合数字，不含任何路径） /
                      fidelity-census.py（独立分母腿：zipfile + xml.etree 换一条解析路，验分母不自说自话）
.github/workflows/    release.yml——tag v* 触发只打 Linux（1× 计费）；Windows（2×）与 cargo test 改手动 dispatch 勾选
```

表格文件流：`xlsx/ods 磁盘 → Rust(calamine 值 + xlsx/ods 各自 zip/quick-xml 直解样式·合并·尺寸·字族·隐藏·冻结·公式·图表·三类规则) → JSON 快照 → Univer 渲染（图表经 VChart 出 PNG 浮动图片，筛选/数据验证/条件格式经门面放回）`；**这一趟的读件请求在 shell 的 `openTab` 那一刻就出门**（v0.67：不等编辑器的 chunk 取完并求值，release 上 `read_xlsx` 的起点从起进程后 850ms 提前到 470ms，而那次读件本身 235→229ms 没变 ⇒ 省的是排队不是 Rust 变快；gating 按 `kind === 'sheet'` 而不是按后缀，所以 `.ods`／`.csv` 同走这一条在途通道——它们本来吃的是同一枚 `read_xlsx` 命令、由 Rust 那头按后缀分流），CSV 走 `csv.rs` 状态机（UTF-8/GBK 自动）→ 单表载荷；保存按扩展名分流——`.xlsx` 经 `rust_xlsxwriter`（含原生图表部件与三类规则的 OOXML 落盘，带回写侧账目）、`.ods` 经 `ods.rs` 生成 ODF 包（v0.63 起同样带回写侧账目：这一趟摆不下的批注与链接要说得出地址）、`.csv` 经 `csv.rs` 写 BOM + CRLF 文本（只存首表）。**存盘那一段现在会说话，同一个标签不再并发写**（v0.69：Rust 一个字没动，改的是前端那一层）——release 上量出的完整一趟是「取快照 + 拼载荷」115~131ms（主线程同步块，IPC 还没出门）+ `write_xlsx` 自身 471ms 中位（改前 505，同一枚 IPC 面量的两端）+ 落定，小件整趟 11~18ms、中件 45~46ms、大件 590ms，于是 200ms 那道门只让大件那一档开口（改前这一整段界面一个字都不说，用户在两次「已保存」之间什么也看不见）；而连按两次 Ctrl+S 在改前**两趟全部重叠**（`write_xlsx_sync` 是一次 `std::fs::write`，跑在不同 blocking 线程上写同一路径，谁后落地没有保证 ⇒ 表现是"后按的那次改动可能没进文件"这种数据回退），现在 `registry.saveTab` 按 `tabId` 记在途、只留一个"还要再存"的位，补的那一趟走同一个 `save()` 因而**重新取快照**（真机 x69d1/2/3 量到新页眉字面 `&LX69M*` 真在 zip 的 worksheet 部件里，第二枚在第一枚落定后 124~136ms 出门），既不排队（早先的中间态不该多落一次盘）也不丢弃（最后一次按键的改动必须进文件）。
文档文件流：`docx → lib/docx-fidelity.ts 直读 OOXML（w:rPr/w:pPr 直接格式 + numbering 层级 + 表格合并 + 图片 + 批注 + sectPr 页面设置）→ HTML/元数据 → TipTap`，
保真导入器抛错或拆不出块时回退 `mammoth 正文 + zip 直读页眉页脚/批注/sectPr`（v0.37）；`.odt` 走 `lib/odt.ts` 双向；
保存按标签扩展名分流——新建文档存 `.odoc` JSON（含 meta）、`.odt` 与 `.docx` 标签各自格式原地写回（导出走 docx/odt 链路）。
**读进编辑器这一段（v0.87）**：四分支（保真 docx / mammoth docx / odt / odoc）都经同一出口 `applyContent`，
块数超过 5000 的件走 `lib/doc-feed.ts` 的分批喂（首屏 12 块、之后每批 4000 块、通道是"JS 侧累加 `Fragment` + 每批整片换回"这一条
唯一与整片 `setContent` 逐节点相同的形状），阈值以下**原样走单片 `setContent` 一步没变**；配套的是**文档读全闸门**
（沿用 v0.81 那本按身份记、失败不记、全仓不销的账）——没读全时四个有话的写出口（`saveOdoc` / 另存为 / 导出 PDF / 历史回滚）
一起拒并说那句「文档还没读全…」，两处静默出口（自动快照、`.odoc` 定时自动保存）同吃这一判据，喂料窗口内 `editable` 关掉。
release A/B 买到的两格：大件主线程空档 fx1000.docx 951→283ms、正文首现 1106→344ms（代价全量上屏 1.17×，门 ≤1.2×），
以及"没读全就按 Ctrl+S"在 0.86 上是**真缺陷**（块数还是空种子 1 的一拍，真按键 `isTrusted:true` ⇒ 741615 B 的件被换成
8563 B 而状态栏说「已保存」），0.87 同一拍写请求 0 枚、盘上一字没动。**没做而记着的**：载入失败那一路只有拒绝没有重试把手
（把手只长在 PDF 那头）、喂料窗口内的程序化/工具栏改动会被下一批整片覆盖（`editable:false` 不挡 `view.dispatch`）、
阈值以下在载入窗口内按 Ctrl+S 会不会被拒这一格没量（A16 显式 SKIP）、解析侧那口气（fid / odt / `JSON.parse`）没拆。
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
      **更新源托管仍未定＝端点继续占位**；**签名私钥已加密备份并演练过 7 / 7**（2026-10-05，见「签名私钥备份」
      一节；它仍只在 `~/.tauri`，不入仓、不进日志、不进 argv）
- [ ] **私钥备份还有四格没闭合**（v0.86 后补记那一轮的如实记账）：**备份包与口令同机**——异地那一抄
      只能由用户手动完成，我没擅自往外发；**桌面那份口令文件仍在**
      （`~/Desktop/oof-updater-key-passphrase-DELETE-AFTER-COPY.txt`，用户唯一的口令副本，抄存后自行删，
      我没有替用户删掉别人的口令）；**`.sig` → `.pub` 验签没做**（`tauri signer` 只有 `sign` / `generate`，
      没有 `verify` 子命令，"签出的字节更新端认不认"这一格仍只有 v0.82 那臂真签名端到端在背书）；
      **私钥本体在本机仍是单点**（备份是它的副本而不是它的第二处现场，泄了那份 `.enc` + 口令等于泄钥）
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
- [x] **文档这一头也有 v0.81 那一格：没读全就按 Ctrl+S，写出去的是半份文档**（v0.87 由 release A/B **量到并修掉**）：
      v0.81 那一格当年只在 PDF 的标注上立了闸，文档这一头从未有这本账——而 A1 臂在 0.86 上按一枚 `isTrusted: true` 的
      真按键，**741615 B 的件被换成 8563 B**（按下那一刻块数还是空种子的 `1`，屏上照旧「已保存」）。修的形状与
      v0.81 那四条一致：按**身份**记「哪一份 doc 已经读全」、持有在 ref、**失败不记账**、全仓不销账；六个写出口里
      四条说话（`saveOdoc` / 另存为 / 导出 PDF / 历史回滚）两条静默（自动快照、`.odoc` 定时自动保存）。
      同轮把大件「一口气喂进编辑器」拆成阈值分批喂（块数超过 5000 才分批，以下单片一步没变）
- [ ] **阈值以下（≤5000 块）的件在载入窗口内按 Ctrl+S 会不会被拒——这一格本轮没量**（A16 显式 SKIP）：闸门判的是
      读全账、与阈值无关，形状上小件同样该被拒（`editable` 与喂料无关的那本账仍在），但**拒存的读数只在 24000 块
      那一档量过**；下一轮要判的是「小件的载入窗口」而不是再改一次闸门
- [ ] **载入失败那一路只有拒绝、没有重试把手**（v0.83 那枚把手只长在 PDF 那头）：dev E 段量的是截半 `.odoc` ⇒
      拒存句 144 拍、写 0 枚、`whole()` 永不翻真而**侧栏把手 0 枚**＝用户能做的只有关标签再开。文档这一头的
      "重跑"要吃的是整趟载入（读件 + 解析 + 喂料），比 PDF 那次重扫重，且**幂等门怎么搭没判据**
- [ ] **喂料窗口内的工具栏/程序化改动会被下一批整片覆盖**（dev C 段量成形状）：`editable: false` 只挡用户输入，
      **不挡 `view.dispatch`** ⇒ 那段窗口里程序化插进去的「探针」在下一批 `replaceWith` 出口消失。本轮的取舍是
      "拒掉写盘"（数据不丢）而不是"拒掉改动"（改动本来就丢），要补齐得给这一窗口的编辑另一条通道
- [ ] **阈值 5000 只在 5000 / 5056 这一点量过**：2000~5000 区间没扫，而夹在中间的那一档正是"单片喂已经能感觉到、
      分批又买不到多少"的灰区；下一轮若要改这个常数，判据应该是那一段的**最长同步块**而不是墙钟
- [ ] **解析侧那枚长任务没拆**：fid / odt / `JSON.parse` 仍是一口气（本轮只拆了"喂"这一段），所以小件的
      最长同步块仍在解析上而不是编辑器上；真要拆得动 worker 或 Rust 那一层，而「文档/演示仍在挂载点才发」那条
      的重新量也挂在这一头
- [ ] **非产品形状的 `.odoc` 走单片那一路**：外部产的 `{content: [节点数组]}` 在 `planFeed` 的 json 分支拿不到
      块数 hint ⇒ 落回单片 `setContent`（本轮没加兼容，我们自己不产出这种件）；这一格在夹具上真撞过一次
      （`gen-fx.mjs` 首版就是这形状，于是分批那一路从头到尾没被量到过）
- [ ] **分批喂与读全闸门只做在文档这一头**：表格 / 演示的"读没读全"仍没有这本账，它们的写出口也没有闸
      （Univer 快照与 `Deck` 是一次性到位的形状，是否需要同样的闸门要先量出"读到一半"这一档在那两头存不存在）
- [x] **文档：边框这一层在界面上没有把手**（读与写自 v0.38/v0.39 就全通，而全仓 `.tsx` 里 `bd*` 零命中 ⇒ 用户一个字
      都改不了）——**v0.88 已建**：段落四边（`.doc-para-bar`）与单元格四边（`.doc-table-bar`）共用同一排 `bdRow`
      （先选线型/磅/颜色，再点要加的边，点已着边的边＝取消这一边，一次「四周」只推一枚改文档的事务），三态各有出口
      （「清除」写 `null` 收回未声明；「压掉」写 `'none'` 落 `w:val="nil"`，只在单元格那一路出现，因为表级边框不显式压
      就盖不掉——Word 只读腿从第三方那头证实了未声明的边照样解出线来）；界面按磅显示、属性存 px，换算只写 `borderCss`
      一处（0.5 磅 → 0.67px → `w:sz="4"`，与 Word 自己写下的字节同形）。同轮修掉两处静默：**表头格上 `&&` 短路的整条
      no-op**（v0.38 起边框/底纹/竖排对齐在表头格上全都写不进去，普通格上又被第二型 false 记成失败），与
      **Word 虚线 `dashSmallGap` 一族读成实线**（`CSS_BORDER_STYLE` 补 `dashSmallGap`/`dashLargeGap`/`dotDotDash`/
      `dashDotStroked` → `dashed`）
- [x] **段落的第五边 `w:between` 仍未接**（v0.88 由字节腿当场数出代价：往返件里 **7 枚段落丢掉这一边**）：读侧没有这一枚
      ⇒ PSINGLE5 与 PSINGLE4 的 attrs 逐字相同且零告警，写侧也没有出口；COM 那头 `Borders.Item(5)` 对段落抛
      「集合要求的成员不存在」（单元格才有 e5）⇒ 这一格只能由 OOXML 字面判
      ——**v0.97 已接，按近似落**：与下一段是同一串「相同边框与底纹」（四边 + between + 底纹的生效 pPr 签名一致）时，
      between 落成**前一段**的下边框（CSS 没有"段间"这一条边；首段起每段有下边、串尾没有，方向天然同 Word）；
      显式声明了 `w:bottom` 时 between 让位。导出侧没有 between 出口，落下去的边按 `w:bottom` 回写 ⇒ 往返件里
      between 会改写成 bottom（同一条缝、同一根线，Word 读侧视觉等价，但字节形状换了档——诚实记下）。
      判据（`between-nobottom` 三段）改前 `[false,false,false]` → 改后 `[true,true,false]`，夹一张表那一臂
      `[false,true,false]`（断串的门真管得住）。
- [ ] **异形线型一律静默降档**（v0.88）：我们写的 `dashed` 在 Word 读成另一档虚线（件里 `style3` → 件外 `style4`，
      Word 对话框写 `dashSmallGap`(3) 而 `dashed` 对回 `DashLargeGap`(4)），`thinThick*` / `thickThin*` / `threeD*`
      在 CSS 里没有对应表达 ⇒ `CSS_BORDER_STYLE` 认不出的按 solid 兜底，**明写不做界面**（四档线型之外不扩张）
- [ ] **`w:val="nil"` 在 Word 的 `Borders.Item` 上读不成一致**（v0.88 Word 只读腿：我们写死的四条 nil，报 e1=`style1`、
      e2/e3=`style0`、e4=`style1`）：本轮**未归因**，且与 v0.38 那条「单元格边框的保真一律比 OOXML 字面、COM 只留外框」
      的老规矩并存 ⇒ 判据仍以字节为准，这一格只记读数不作结论
- [ ] **`w:space`（边框离字）没有到达面**：这台机器的 Word 报 `Border.Space` property not found，而它自己写出的件恒为
      `w:space="0"`（我们从不写这一枚）⇒ v0.39 那条「间距未保留」告警到 v0.88 仍只能由手造件判
- [ ] **样式级 `w:pBdr` 摊平后「清除」可能压不掉**（未量）：读侧早把样式链那层合并进段落自己名下（docx-fidelity 的
      `effPPr`），编辑器里没有「一条样式边框等着被盖」这一层，所以界面只给「清除」不给「压掉」；第三方件里由样式带来的
      边在「清除」之后 Word 那头还在不在，本轮没有判据
- [ ] **v0.88 没有 release A/B**：到得了「重跑那一拍」的注入缝是 DEV-only 的，而本轮买的是界面那一排——它在 release 上
      长同样的形状（同一个组件、同一份 CSS）却**只有形状推断**（v0.83 那条同族未勾项原样挂着）
- [x] **纸上有没有边框从来没正面量**（v0.88 前置实测明记的一条，v0.93 结掉）：那一轮的证据全在屏幕 DOM、docx/odt
      字节与 Word 只读三头，"边框进不进导出 PDF"没有判据（v0.49 那条「屏幕上的颜色先穿过 CSS 变量」管的是主题色，
      边框是内容自己声明的，照规矩该上纸而没人量过）。**v0.93 纸面腿量到了**：`borders` 臂的 PDF 上 4 枚红段落边 +
      6 枚蓝格上边 + 1 块黄段落底纹各按声明的颜色与位置真上纸（判据 P23），而**纸上零枚带 dash 的路径**——边框被
      铺成实心矩形 `fill`（`dash` 全 null）⇒ 屏幕上的 `1.5px dashed` 到纸上成实线，这一档另立未勾项
- [ ] **表级边框摊进每一枚单元格**（2 枚 `w:tcBorders` → 6 枚，外观相同而字节膨胀）：v0.88 前置实测记下的形状，没动
- [x] **文档：docx 的表格列宽写了个假网格**（导出件 `w:tblW` 恒 `pct 100%`、`w:gridCol` 恒库默认的 `w="100"`、`w:tcW` 与
      `w:tblLayout` 零枚 ⇒ Word 把 90/120/180 磅压成三等分 150.3/150.25/150.25，而这份件再导入时模型揣着 [7]px 的荒谬值
      继续往下传）——**v0.89 已建**：`gridPxOf` 把行 0 各格 `colwidth`（按 colspan 展开）摊成逐网格列并立四道认账门
      （行 0 非空 / 数组长度等于 colspan / 枚枚 >0 / 每行 colspan 之和等于网格列数），**任一不合整表按「无宽度账」处理且
      出口全返 null 不返空数组**（`w:gridCol` 枚数与跨度对不上是 Word 的损坏件档，不是"宽度不准"档）；有账时写
      `w:tblW` 绝对值（= 网格和）+ `w:tblLayout fixed` + 真 `columnWidths` + 逐格 `w:tcW` = 所跨网格列之和（游标
      `if (isCell) gc += cs` 只认真格子），无账时**只把网格按版心等分写真值**而表级仍 100% 百分比、不声明 fixed、
      不盖逐格 tcW（买的是"别写 6.7px 那种荒谬值"，不是替用户决定布局）；版心由导出入口算一次（页宽 − 左右边距 −
      `colGap×(栏数−1)` 再按栏数分）并穿到每一层递归，兜底由 A4 + 默认边距算出而非硬编码
- [x] **文档：界面上拖出来的那一枚列宽被导出整表作废 + 列边界那条缝看不见**（v0.90）：`updateColumnWidth` 的形状是
      一次拖拽只写被拖那一枚网格列（实测 `after=["[248]|null|null" ×2]`）⇒ 那是**部分账**，而 v0.89 的认账要求整表齐账，
      于是这份账在导出侧被整表判"无账"：`dragged` 与 `none` 两件字节逐枚相同（都是 `pct 100%` + 等分 3135 + 无 `tcW`），
      Word 里也读回同一个 `156.7 × 3` ⇒ 用户拖过的列**屏上有、字节里没有、第三方里也没有**；另一半是 `.column-resize-handle`
      这一族**产品里一条样式都没有**，装饰的实测 rect 是 `width 188 / height 0`（拖能拖，看不见）。v0.90 两道都补：
      `gridPxOf` 只松「每一格都得带账」那一道（另三道形状门一道不松、七个出口仍全返 null），没带账的列按
      `fill = max(1, floor((contentPx − Σknown) / rest))` 补平 ⇒ `dragged` 现在是 `3720 + 2835 + 2835` + `fixed` +
      表级 `9390` dxa + 逐格 `w:tcW`，Word 读回 `186 / 141.75 / 141.75` 磅且行宽之和正好 = 版心 469.5 磅；把手做成
      绝对定位的 6px `col-resize` 缝（实测 rect 从 `188 × 0` 变 `6 × 50`）、悬停才亮、拖拽中用 `outline` 不压底纹、
      `@media print` 里不上纸
- [ ] **ODT 的列宽两头都不往返**（v0.89 明写不开）：写侧 `content.xml` 零枚 `table:table-column`（前置实测数出来的），
      读侧也不解析 `style:column`/`table:style` 那一层的宽度；理由是**无人可裁**——本机无 ODF 第三方应用，而 ODF 1.2
      RelaxNG 的三个源全 404 ⇒ 写出的形状只有自家两头互证。这一档在 docx 那头已补（v0.89），ODT 缺的是同一层的另一半
- [x] **键入精确列宽**（v0.90 只结掉"把手可见 + 拖出来的账不丢"那一半，剩下这一半在 v0.91 建）：TipTap v3 命令里
      没有 `setColumnWidth`（只有 `addColumnBefore` 一族），而 v0.90 前置实测量清了它该长什么样的那一格在 v0.91 兑现——
      **一次事务写遍该网格列的所有行**（M2 实测只改行 0 那一枚在同一次 dispatch 里就被 `tableEditing` 的
      `appendTransaction` 按其余各行抹回 `[120,160,240]`，写遍的两臂 `[120,200,240]` 活着），其余列按各自现有的账
      **等比**分享剩下的可用宽、Σ 恰等于可用宽（M3：`widths=[90,268,268]` 量到 rect `[89.94,267.73,267.74]`＝键入值
      1:1 上屏，而保持旧账的 `[90,160,240]`（Σ=490）被浏览器按 `table-layout: auto` 缩成 `[114.86,204.21,306.33]`）；
      可用宽从 `contentPxOf(resolvePage(meta.page))` 一处来再扣表级 `marginLeft`（M7：单栏 626 / 两栏 304 / 三栏 196）
- [x] **含竖跨（rowspan）的表整表丢账**（v0.89 立起宽度写侧就带着的那格静默，v0.91 顺手挖掉）：「每行 colspan 之和
      等于网格列数」那道形状门把"被上一行的竖跨压掉的格子"读成少了几枚 ⇒ 含 rowspan 的表整表判为没有宽度账、
      导出成 `[3135,3135,3135]` 的等分而不是 `[1800,2400,3600]` 的夹具账；改成按占位走的 `gridShapeOf`（竖跨算占位
      不算缺格），字节腿 X18 判的就是这一枚形状、Word 腿 W1×5 里 rowspan 那一件现在逐格 = 自家 `w:gridCol/20`
- [ ] **单列表（`cols === 1`）键入后 Σ ≠ 可用宽**：`redistribute` 那一档没有"其余列"可分享，返回的是
      `[键入值]` 本身而这一列的和就不再等于 `targetPx`（本轮只保证不早退崩，没替这一档作主——把单列钉成可用宽是
      替用户改表宽）；**屏上那一半 v0.92 已经结掉**：v0.91 那句"照样被 `table-layout: auto` 按比例放大"不再成立，
      单列件现在读 inline `width: 90px` 而 rect 89.33（前置实测手写成 Σpx 那一档的同枚读数）
- [ ] **被跨列格盖住的后续列没有独立把手**：跨列的格按**起点**记列号（M1 实测跨两列那一格里光标认到的是第 0 列），
      在跨列格上键入 90 写的是它第一枚网格列，而跨列格的 `colwidth` 是它覆盖的**各列**（C4 实测那一格写成
      `[90,269]`）⇒ 界面上没有"这一枚跨两列的格整体 180px"这一档
- [ ] **屏上 626px 与 `contentPxOf` 的 627 那一枚 1px 口径差**：9405 twip ÷ 15 = 627 而 `.doc-editor` 的
      `clientWidth` 实测 626（A1 同屏读出 `avail=626 / max=627`，输入框的 `max` 用的是后者）⇒ 键入 627 时
      屏上会被缩走 1px；根因是 CSS 的 20mm 边距取整与 twip 取整不同路，本轮只记账没合
- [ ] **等分补平那一档的算法住了两处**：`docx.ts` 的 `fill` 与 `table-width.ts` 的 `baseWidths` 是同一算法的两份
      实现（注释互相指着但没有合一）⇒ 改一处不改另一处时，屏上显示的宽度与导出字节会分叉
- [x] **键入值超出版心时整表不夹取 ⇒ 屏上如实溢出，纸面那一头 v0.93 已量并收口**：`redistribute` 只夹"给其余列各留 1px"，
      不夹整表不超过可用宽（X20 `over` 臂 `[90,300,300]` 仍写 `[4500,4500,4500]`、表级绝对宽 13500 dxa ≈ 比版心宽 43%）；
      v0.92 起屏上跟字节同一形状（`over` 臂 inline 900px、`contentScroll` 900 > `clientWidth` 626、表右沿 1259.29 顶出
      文档右沿 985.36），**不缩表是刻意的**——Word 16.0 对同一件读回 225 磅 ×3（和 675 > 可用 470.6）也不缩，第三方
      不替用户作主，屏上就不该假装缩了；**纸面 v0.93 第一次正面量**（文档导出 PDF 走 WebView2 `PrintToPdf` 吃的就是这份
      DOM）：量出来不是"裁掉 / 缩下一页 / 出血"三选一，而是**整页被按比例缩小**——超宽件纸上 scale 0.6981（= 627/899），
      正文 15px 在纸上只有 10.5px，是 Blink 打印替整页作了主；修法一枚 `@media print` 的 `.doc-content{overflow:hidden}`，
      改后 scale 回到 1.0004、前两列按 300px 真尺寸上纸（纸上间距 299.86/298.86）、第三列被裁在版心右沿（P5/P24/P27）
- [ ] **超宽表被裁掉的那一列在纸上没有任何提示**（v0.93 新开）：现在的形状是"静静裁掉"——第三列的起点 681.72 在版心内
      而它的文字不在纸上（P25），屏幕上却看得见（v0.92 的如实溢出）。Word 那头同样出血不提示，但我们的裁位与它不同：
      自家裁在版心右沿（710px = 532.5pt，纸的右白边不画），Word 裁在纸边（595.32pt），同一件两头的纸面形状不同形
- [ ] **纸面把虚线边框降成实线**（v0.93 新开）：`borders` 臂纸上量到红 4 条段落边 / 蓝 6 枚格上边 / 黄 1 块底纹（P23）而
      **带 dash 的路径零枚**——`setStrokeRGBColor` 与 fill 都上纸而线型分不出。这一枚与 v0.88 记的"纸上有无边框从来没
      正面量过"是同一层：那一轮结掉了"有没有"，本轮量出"线型在纸上丢档"
- [x] **超高表被 `break-inside:avoid` 整张推到后面一页，前一页近空白**（v0.93 量出，v0.94 结掉）：`longtall` 臂第 1、2 页纸面上
      **0 枚格标**而 22 行全在后面的页（P19），`wide-tall` 臂第 1 页同样 0 枚——表比一页高时 `avoid` 无法满足，Blink
      选择整张往后推而不是在页边断开。v0.94 把 `.doc-content table` 从这一族摘出来显式写 `page-break-inside:auto` +
      `break-inside:auto`：`tall` 3→**2 页**且第 1 页 54 枚格标（改前 0 枚）、22 行一枚不丢一枚不重（行号连续 0..21）、
      **没有任何一行被劈开**（十臂每页 `partial=-`）、`mid` 的页边空档从 304.9px 被表格填上（墨底 681.7→986.6）、
      页边三臂第 1 页行数恰为剩余空间容得下的那一档 1/2/4、`short` 与 `precise` 两臂逐页回归改前读数（没动的族不碰）；
      Word 16.0 只读腿第三方纸面对照（每行强制 60 磅那一档）逐行落页映射与自家改后同向＝表级流、行边界切、不劈行
- [x] **表头行在纸上不重复**（v0.94 量出，v0.95 结掉）：`b4-hdr` 臂第 1 页 `head=3` 而第 2 页 `head=0` ⇒ 跨页后
      第二页没有表头，Word 的默认是重复标题行。写侧那一档一直是齐的（同一件字节腿数出 23 行且带 `w:tblHeader`），
      缺的是屏上渲染这一头的 `<thead>`。v0.95 由 `IndentTableView` 按模型那份行属性**克隆**开头连续的表头行成
      `thead.doc-th`（标记住 `<table>`，因为 PM 擦行的 `class`），屏上 `display:none`、纸上一枚 `table-header-group`
      加一枚藏原行：`hdr` 纸上 `head 3/0 →` **3/3**、`hdr2` **6/6**、`span` **2/2**，每页表头枚数 = 表头标总数
      （整行重复而不是只重复一枚格）、数据标不丢不重（`distinct=66/60/60/6`）、逐页数据枚数与改前相同（没有因重复表头
      而重新分页）；那道门拒开火的两臂（`mixth` 中途夹表头行 / `nohdr` 无表头行）纸面与改前**逐枚同形**
- [ ] **中途夹表头行那一档在纸上不重复、也没有任何提示**（v0.95 量出）：`mixth` 臂那道门只认「开头连续的全部表头行」，
      实测 `gated=0`、纸面 `head 3/0` 与改前同形——而字节里 `w:tblHeader` 明晃晃住在第 2 行，Word 也只读得到那枚标志
      （`HeadingFormat` 行 1 = 0 而整表 1 枚）。要么把它也做成表头组（语义上 Word 也不这么干），要么在界面上说这一档
      纸上不重复，两条都没选
- [ ] **嵌套表的表头行克隆未量**（v0.95 记）：本轮那道门只认最外层 `table` 的 `contentDOM` 行，而 `nest` 臂前置实测里读到
      的是 `rowCount 24` 那种外层吞内层的形状 ⇒ 内层表的表头行会不会被外层克隆重复、或外层自己的表头行被内层行数带偏，
      两头都没有读数；这一臂的**可达性到第十六笔账才第一次成立**（此前那 11 枚格内表压根不在 DOM 里，内层表头行无从被克隆）
- [ ] **屏上藏克隆靠 CSS 而非 DOM，重建路径只量了两趟**（v0.95 记）：屏上「表头行只有一份」是 `display:none` 撑的，
      克隆靠 `spec.update` 重建——本轮 `D10`（隔 600ms 两趟逐枚相同）与 `PERSIST-DATA`（真编辑数据格之后前后同形）
      只量了收敛与真编辑，撤销栈回放、协作式远端改动那一类路径没有读数
- [x] **`pre` / `img` / `blockquote` / `.doc-toc` 同族仍整块推页**（v0.94 对照组，v0.96 结掉除图片之外的三件）：
      40 行代码块那一件纸上是 **3 页而第 1 页 0 枚行标**（只有两段正文，`inkBottom=99.7`）、60 段引用 **4 页而第 1 页
      0 枚**、目录摆在正文中间时第 1 页下部约 338pt 空着。v0.96 把 `.doc-content pre` / `blockquote` / `.doc-toc`
      从 `avoid` 家族摘出来显式写两门（与 v0.94 表那一格同一形状）：`pre40` 3→**2 页**且第 1 页 38 枚、`pre90`
      4→**3 页**且第 1 页 40 枚、`quote60` 4→**3 页**且第 1 页 28 枚、页边六档里 `fill27`/`fill28` 的第 1 页墨底
      从 `704.7`/`728.7` 推到 `769.9`/`777.4`（吃掉 3/2 行）；**每一臂行标一枚不丢不重**（40→40、90→90、60→60）、
      **断开只发生在行边界**（每页族标是连续升段）、三枚图片臂与四枚短件臂和 `toc40` **逐页同形**（没动的档不碰）、
      纸张仍 595×841.9、没有一臂多出空页；写侧由独立字节腿以 `document.xml` **逐字节相同**为证（`pre40` 两趟同
      `sha=e7c03e7e`），第三方由 Word 腿以**逐段落页映射全同**为证。**图片这一件刻意留在家族里**：注入 `j4`（跟着摘
      `img`）与 `j3` 逐页同形且裁剪框位置逐枚同 ⇒ 摘它是纯 no-op（替换件没有内部断点），剩下的那一半另开成下面第
      一条
- [ ] **图片仍整块推页，而摘掉 `avoid` 不换来任何形状**（v0.96 量出）：`img300`（400×300px）与 `img1200`
      （600×1200px，比一页高）在 `j4` 那一档与基准**逐页同形**、`imgmid` 那一档第 1 页下部空着而图整块住在第 2 页——
      替换件没有内部断点，`auto` 对它是惰性的。要让它不推页得给它一条能断的通道（把它包进可断的容器、或按剩余空间
      缩放），那是产品语义而不是 CSS 开关，本轮没有做也没有量
- [ ] **跨页的代码块/引用没有孤行寡行下限**（v0.96 新开）：`p{orphans/widows:2}` 管不到块内部，实测 `pre40` 改后
      第 2 页只落 2 行、`quote60` 改后第 3 页只落 2 段——末段在新页上只留一行也不算错。要不要给块补一枚
      `orphans`（Blink 在 print 媒体里对 `pre` 认不认这一档）没有读数
- [ ] **代码块/引用被切开之后底纹带是否连续没量**（v0.96 新开）：`--code-bg` / `--quote-bg` 在打印态被 v0.49 那套
      规则换过颜色，而「同一块跨页时左右边界与底色带接不接得上、断口处会不会各画一次圆角」本轮只有行标几何读数，
      没有墨色几何读数
- [ ] **比一页高的图整块住在某一页而纸面装不下它**（v0.93 那一族的纵向对应档，v0.96 没有重做图片）：
      `img1200`（600×1200px，比可印高度还高）三页而图落在第 2 页——纵向出血的具体分寸本轮没有重算（几何量具只存了
      落页与 `yTop`，裁剪框的宽高没落盘）。v0.93 结掉的是横向（超宽件裁在版心右沿），纵向这一头改前后同形
- [ ] **`h1..h4{break-after:avoid}` 自己造出的空白没有量也没有提示**（v0.96 顺带现形）：`toc40` 第 2 页只有 8 枚 `hd`
      标而墨底停在 `221.2`（下部约 555pt 空着）——一枚标题不能独自坐在页底，它后面的正文被推走。这一档与本轮的开关
      无关（改前后逐页同形），但它和「整块推页」在用户眼里是同一族观感问题
- [ ] **v0.96 没有 release A/B**：改的是 `@media print` 里非表族那一档，dev 与 release 走同一份 CSS，但纸面证据
      只在 dev 一头（19 份 PDF 全部由 dev 腿落盘）⇒ release 真机上"代码块/引用/目录跨页流着排"只有形状推断
- [ ] **纸面行高仍比 Word 那一档厚约 3×**（v0.94 量出）：屏幕上每行 `trHeight` 50.9px，纸上第 1 页 18 行 × 50.9 = 916
      与墨底 920.6 对上（＝38.2 磅/行）而 Word 自然行高在 ~12 磅那一档；同一件 Word 强制 60 磅/行时 22 行只吃 2 页。
      根子在单元格的 padding 与行盒（v0.59 那一档行盒是 `PRINT_ROW_BIAS_PX` 的标定条件，动它必须重跑表格纸面实测）
- [ ] **Word 的 `ExportAsFixedFormat` 在本机挂**（v0.94 撞到）：属性读之后再导出就 CPU 空转不出件（420s 超时转后台），
      而分页读数（`ComputeStatistics(2)` / `Range.Information(3)`）在导出之前就已经落盘 ⇒ 第三方纸面那一头本轮只能吃
      Word 自己的分页账，不能吃它导出的 PDF
- [ ] **v0.94 没有 release A/B**：改的是 `@media print` 里表级那一档，dev 与 release 走同一份 CSS，但纸面证据只在 dev
      一头（几何判据吃的十份 PDF 全部由 dev 腿落盘）⇒ release 真机上"表跨页流着排"只有形状推断
- [ ] **部分账那一档纸面仍是比例**（v0.93 量出）：`partial` 臂纸上间距 247.88 / 188.91 / 188.91——248 那一枚按真尺寸上纸，
      剩下两枚分享剩余版心（与屏上 248/188.7/188.71 同形），而字节里是 3720/2835/2835 = 248/189/189。数值接近是浏览器
      算法与补平算法碰巧同形，不是同一份账上了屏（v0.92 那条"屏上 vs 字节"的未合一口径在纸上的对应）
- [ ] **v0.93 没有 release A/B**：改的是 `@media print` 的内联样式那一半，到不了 release 的注入缝；纸面形状由 dev 腿
      落盘的件交几何腿裁，写侧不回归由独立字节腿裁 ⇒ release 上这条收口只有形状推断
- [ ] **v0.91 没有 release A/B**：界面那一半（「列宽」输入框与真光标）到不了 release 的注入缝，字节那一半由
      dev 腿落盘的件交独立字节腿 + Word 只读腿裁 ⇒ 输入框在 release 上只有形状推断
- [x] **读侧只吃 `w:gridCol`，不读 `w:tblLayout` / `w:tcW` / `w:tblCellMar` / `w:trHeight`**：第三方件里 `w:tcW` 与
      `w:gridCol` 打架时以谁为准**未量**（我们自己的件两边自洽，判据买不到这一格）；单元格边距与行高两头都没有通道
      ——**v0.97 已接三笔**：**`w:gridCol` 先占、`w:tcW` 只补缺账的列**（holes；跨列格的 tcW 按「这一跨的总账减掉已知列
      再平摊给 holes」，auto/pct 不吃；没有 `w:tblGrid` 的表列数取网格枚数与行 0 跨界的较大者）、`w:tblCellMar` /
      `w:tcMar` 落 cell-style 的 `pad*` 四属性（0 是真值，**逐边覆盖**而不是整组替换）且导出逐边回写 `w:tcMar`（缇）、
      `w:trHeight` 落 `rowHeight` 属性（数住 `@w:val`、hRule 缺省按 atLeast）且导出按 atLeast 回写（exact 的裁剪档
      CSS 表达不了，导入记一枚告警）。判据不是自造件独证：三方同一趟 `RESULT judge pass=28 fail=0`（自家读手 /
      Word 16.0 只读 COM / 独立字节腿），`gridzero` 臂 ours[120,160,240]px ↔ word[90,120,180]pt 同账、`rowh` 臂
      40/80/60px ↔ 30/60/45 磅、`mar-tbl` 臂 108 缇 ↔ 7.2px ↔ 5.4 磅。
- [ ] **`w:tblLayout` 仍不读**（v0.97 明写）：自动/固定布局那一档吃不到，第三方件里 `w:tblLayout w:type="autofit"`
      与我们的固定布局解释不同形——本轮只补了宽度/行高/边距三笔账，布局档原样挂着——**表格读侧第八笔账把它的落点量清了但仍不吃**：网格有账而表宽也说时 Word 按 `w:tblLayout` 分流
      （`ta_tblw_big_fixed` 7200 缇 → 106.67/160/213.33 按网格 8:12:16 缩、`ta_tblw_big_none` 与 `ta_tblw_small_auto` 一律三等分 160/80、`ta_tblw_zero_fixed` 说 0 时干脆跟网格），
      而那一批 12 枚不等里七枚住在这档 ⇒ 动它要重标 v0.92/v0.93/v0.94 三批屏上与纸面基线，原样挂着
- [x] **Word 的文档级默认格边距那一层不读也不铺**（v0.97 量出）：字节里没有 `w:tblCellMar` 时 Word 的 COM 那头读回 0.5/0.5
      磅（`mar-zero` 臂第二枚格），而独立字节腿在同一批夹具上数到 15 枚 `TBLCELLMAR|None` ⇒ 当时判它住在 styles.xml 而不是表上——**本轮已接，
      且量出来那一层住的不是「文档默认」而是「表样式」**：表引用的样式（`w:tblPr/w:tblStyle` → 其 `w:tblCellMar`，沿 `w:basedOn` 自根向下、
      叶子覆盖根）是格边距的基座，表自身逐边盖它、逐格再盖表（三方同一趟 `RESULT judge pass=15 fail=0`，13 臂：`a1_ref108` ours=[7.2,9.6,
      7.2,9.6]px ↔ Word=[5.4,7.2,5.4,7.2] 磅、`a7_basedon` 叶子什么都没说而祖先说 216 ⇒ ours 四边 14.4px、
      `a12_chain_override` ours=[14.4,14.4,14.4,7.2] ↔ Word=[10.8,10.8,10.8,5.4]、`a4_precedence` 表的
      108 压住样式的 216 ⇒ 7.2 而不是 14.4、`a3_stylezero` 样式说 0 ⇒ ours 与 Word 都是 0）。而 **`w:default="1"`
      的默认表样式不算一层**（`a2_defaultonly` / `a10_default_nosemi` / `a11_default_as_ref` /
      `a13_default_mid_chain` 四臂各砍一种备选解释：ours 全空而 Word 三臂同一读数 top/bottom 0 磅、left/right 5.4 磅，
      `a8_default_vs_ref` 把这条钉死），Word 自带的那组数是应用默认而不是文档说了的数 ⇒ 仍不铺；`a5_none` 臂 ours 全空而 Word=[0,0,0,0]
      磅，与那组 0/5.4/0/5.4 **不同形**——引用一枚什么都没说过的样式，Word 连自带的左右边距也不铺
- [x] **表样式条件层 `w:tblStylePr`（firstRow/lastRow/oddRow…）不接**：本轮已接，而量出来的形状比原话窄得多——只有 firstRow/lastRow/firstColumn/lastColumn
      四型会把边距落到实处（`g_oddRow_L4_bands` / `g_evenRow_L4_bands` / `g_band1H_L4_bands` / `g_band2H_L4_bands` / `k13_wholetable` / `k15_band_alias` /
      `k17_unknown_type` 七臂 ours 与 Word 在九枚格上**都**不落，空集对空集），`w:val` 那位十六进制从不被 consult（`k4_zero` val=0000 六型全声明 ⇒ 全不落；
      `k5_attr_beats_val` val=0000 而 firstRow=1 firstColumn=1 ⇒ 未说的末行末列照落 left 22.5 磅 / right 25.5 磅；`k6_val_beats_attr` 反向），
      闸门只吃表上那一枚（`r_style_look_on_L3` 与 `r_style_look_off_L3` 逐格同形），首末列那两型的边距落到**全表每一格**（`g_firstCol_L4_full` ours 22px ↔
      Word 16.5 磅，九枚分毫不差）而同一型换成 `w:rPr` 载荷时才是真按列落（`q_bold_firstCol_L3` 只 R1C1 bold=-1），同一型的两块条件与 basedOn 链上的同型是
      **整块**替换（`r_dup_type_firstRow_L3` 里 A 的 top 一次没出现、`q_basedon_L3` 里祖先的 left 一次没出现）；
      **表格读侧第七笔账把「只有那四型会把边距落到实处」这一句改口**——同一闸门下四枚角型也真落边距，而边距那族的梯子自低向高是 **列型 > 角型 > 末行 > 首行**、
      角型按其所在那一**整行**落（`sb_nw_all_on` 首行三枚格各 40px 而其余九枚全空）且要那一角的两枚位都开；同一趟还量出条件块里 `w:tblPr/w:tblCellMar` 那一格照样落（下面那枚未勾项兑现）
- [ ] **内建 `TableNormal` 身上 Word 自带的那套默认不读也不铺**：上一轮立的门是「`w:default="1"` 的默认表样式不算一层」，**表格读侧第六笔账把它换成按引用与内建替换判定**
      （`r1_def_referenced` / `v1_def_referenced_mar` 量的就是那枚旧门的过杀：自造 id 而带默认标记、被表引用时 Word 会落，而我们当时连边距带底纹一起不读），
      于是剩下的只有替换名单里那一枚：`q21_default_referenced`（往 TableNormal 写 `w:shd` D9D9D9，Word 九枚格全读回无底色而 `word_style=????`）与
      `u6_normal_substitution`（同一枚写 400 缇边距，Word 读回 5.4 磅 = 7.2px）⇒ 它自带的定义我们既读不到也不铺。上一轮那句
      `默认表样式的条件层格边距未铺：<型名>` 的告警随这道门一起删掉了（不再有一种「默认标记」需要它）；`r_default_style_cond_L3` 那一臂当时 ours 全空而 Word R1C1 left 15 磅 = 20px，
      按新的判据现在两头同判（引用就落）
- [x] **条件块里那格的载荷只接了 `w:tcMar` 与 `w:shd` 两样**：同一块写在 `w:tblPr/w:tblCellMar` 那一格时 Word 照样落（`r_slot_tblpr_firstRow_L3` 九枚读数在字节账外，
      COM 报 -1 磅）而我们不接；`w:rPr` / `w:pPr` 两格本轮只当探针量过一次（加粗的作用域），实现没有——**本轮把同一块里的 `w:tcPr/w:shd` 接上了**（底纹三层里的那一层）；
      **表格读侧第七笔账把 `w:tblPr/w:tblCellMar` 那一格接上**（46 臂三方同一趟：`sa_slot_top_only` 第 0 行两枚格各位移 +39.67 磅而 `sa_slot_fr_off` 0.00，slot 归**样式层**——
      `sc_slot_top_vs_tbl` 里表自身压过它而差 0.00、`sc_slot_top_vs_stylebase` 里它压过样式基座而差 +32.87 磅；读侧从此两格分开记账 `CondCell = {mar, tblMar, shd}`）；
      剩下的只有 `w:rPr` / `w:pPr` 两格没有实现 ⇒ 这一项按「边距半勾」结掉，字体与段落那一半另立一轮（`wholeTable` 那一格两族都不落，见上面那枚已勾项）
- [x] **oddRow/evenRow/band1H/band2H/wholeTable 各型的其余载荷没接**：**底纹那一半本轮量到它们连底纹也不落**（`q1_band1HV_A` / `q3_band1HV_C` / `q4_band1HV_D` /
      `q10_band2V_B` / `p10_evenRow` / `p11_wholeTable` / `p12_band1H` 七臂 Word 九枚格全 `000000/0` 而 ours 同一趟全空 ⇒ 空集对空集，落点集合逐枚相同），
      与上一轮边距那头的读数同一形状；剩下的只有**字体那一档**没量（`k15_band_alias` 与本轮各臂都只问了边距与底纹）⇒ 这一项按「底纹半勾」结掉，字体另立一轮
- [ ] **样式层读进来的数在写侧没有出口**：写件里既没有 `w:tblStyle` 也没有表级 `w:tblCellMar`， styles.xml 里也没有 `w:tblStylePr`（往返件独立字节腿 `R6`/`R7`/`R8`
      三枚零计数），样式层与条件层的边距落盘时都以逐格 `w:tcMar` 的形式重住 ⇒ 同一趟 63 臂里 **60 臂换档**（`shiftArms=60`，`expCells=553` / `expEdges=2176` 的数
      换档之后仍逐边相等）；往返视觉等价而**字节换档**，第三方件重存一趟之后，原来那份样式层/条件层声明不再活着，那句「默认表样式未铺」的告警也不在往返之后回来
      （`warnsBefore=1|warnsAfter=0`）；**底纹这一族本轮同一趟再量一遍**：写件里没有任何样式层/条件层的底纹出口，样式与条件的色落盘时全部重住逐格 `w:shd`
      （`COLLAPSE|arms=29 src_cells=6 exp_cells=169`：69 臂里 29 臂换档，6 枚「文件只说样式」的格在往返件里变成 169 枚逐格 `w:shd`），往返视觉等价而**字节换档**；
      **表格读侧第七笔账在边距这一族同一趟再量一遍**：46 臂里 **41 臂换档**（不换的正是 5 臂只说逐格的标定件），夹具的样式基座 20 枚 + 条件块 50 枚 + 表级 4 枚在导出件里恒为 0
      而逐格 `w:tcMar` 从 9 枚涨到 131 枚（`EDGES|等=149 不等=0 原沉默后说话=0 原说话后沉默=0` ⇒ 换档之后仍逐边相等）
- [ ] **条件层这一趟没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 条件层读进来的边距在屏上和纸上的形状本轮
      **没有读数**；证据全在离线三头 + 往返腿 + 独立字节腿
- [ ] **本轮没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑） ⇒
      样式层读进来的边距在屏上和纸上的形状本轮**没有读数**；证据全在离线三头 + 往返腿
- [ ] **图案底纹（`w:shd @w:val` 非 clear/none）只读纯色**（表格读侧第六笔账量出）：`p19_pct50` 在 Word 那头是 FF0000 配 Texture 500，CSS 里没有这一档 ⇒ 只把 fill 当纯色读、
      按型别记一句 `图案底纹（w:shd @w:val=pct50）按纯色读入，图案那一半没铺`（同一条在样式层那档 `×9`、在逐格那一档 `r7_cell_pct50` 只 `×1`，门发在应该发的那一枚上）⇒ 图案那一半在屏上、
      纸与字节三头都没有承载
- [x] **角型只铺了底纹，没铺它的格边距**（表格读侧第六笔账量出）：`u4_corner_margins` 臂 nwCell 那一块说 left 600 缇，Word 三枚格读回 40.0px 而 ours `lp` 全空 ⇒
      边距那一族上一轮按「只有 firstRow/lastRow/firstColumn/lastColumn 四型落地」立了门，本轮的底纹则真按角型落；同一型在两族里的落点集合不同，判据里以残余 diff 记着；
      **表格读侧第七笔账把边距这一族的角型接上并把落点集合量清**：角型在边距这族按**整行**落而不是那一角（`sb_nw_all_on` / `sb_ne_all_on` / `sb_sw_all_on` / `sb_se_all_on`，四枚位都开那一臂那一行四边都有 40/20/8/4），
      要那一角的两枚位都开（`sb_nw_fr_only` / `sb_nw_fc_only` 九枚全空），尊卑按型别而不按声明次序（`sb_nw_declared_last` 把 nw 写在最末仍一次没赢），逐格 `w:tcMar` 照旧压它且 0 是真值（`sb_nw_cell_wins` / `sb_nw_zero`），
      1×1 表那一枚格同时是四角（`sb_nw_1x1`）；而底纹那族的梯子与之相反（角型只落那一角那一格）⇒ 两族不并成一条梯子，残余 diff 从 9 枚降到 0（同一批夹具、改前 `等=75 不等=9` 而改后 `等=120 不等=0`）
- [ ] **条件层底纹的往返没有样式层出口**（表格读侧第六笔账）：样式与条件的色在导出时塌成逐格 `w:shd`，第三方件重存一趟之后原来那份样式层/条件层声明不再活着；
      往返腿 69 臂 `same=69 drift=0` 判的是**色**回来而不是**层的形状**回来
- [ ] **表格读侧第六笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 底纹三层读进来的色在屏上和纸上的形状本轮
      **没有读数**；证据全在离线三头 + 往返腿 + 独立字节腿（`RESULT|rt_bytes pass=69 fail=0 miss=0`）
- [ ] **表格读侧第六笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [ ] **条件块里 `w:tblPr/w:tblCellMar` 那一格只验了竖直方向**（表格读侧第七笔账）：COM 的 `Cell.*Padding` 在样式层与条件层说的边距上返回 -1（本轮 57 枚计入账外），
      只有位移读得到数 ⇒ 竖直位置尺 `Cell.Range.Information(6)` 是这一族的第三方头（10 对全过，含 s0 那对标定：逐格 600 缇该位移 30 磅而尺读 39.67px，标定偏差 -0.25 磅 ⇒ 容差 1.5px，
      与逐边判据那把 0.34px 的不是同一把），而**水平边（left/right）在这一层没有第三方标量读数**；`Cell.Information(5)` 在这批表上什么都读不出而 `(6)` 读得到（基线 72.65）
- [ ] **同一行里两枚角型说同一枚边没量**（表格读侧第七笔账）：nw 与 ne 都写 top 时按谁——本序按后入的 necell 取，而这批 46 枚夹具没有这一臂；
      `w:tblLook` 的 `w:val` 与位属性打架时以位属性为准那一档沿第五笔账 `k5_attr_beats_val` / `k6_val_beats_attr` 的读数，本轮不复测
- [ ] **本轮夹具没有 `w:trHeight`**（表格读侧第七笔账明写）：行高通道这一趟没有读数（往返腿 `ROW|两头都无行高=109` 只是「两头都没有」的自证，不是往返对得上）⇒
      slot 那一格与行高同写一表时谁撑开那一行，量不到
- [ ] **往返腿的 HTML → ProseMirror JSON 那一半是镜像适配器**（表格读侧第七笔账）：按 `cell-style.ts` 三处属性映射写的，而不是浏览器 DOMParser + schema 解析
      （以 `MAP|padding 简写出现=0` 担保它没绕过逐边形状，但它不是真浏览器解析路径 ⇒ 屏上那一头的 DOM 形状本轮仍未量）
- [ ] **表格读侧第七笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）；Word 导出 PDF 那一头本轮只出得来
      `IDENT|wordpdf-b1` 一行、整趟挂住 ⇒ 屏上与纸面本轮**没有读数**，连第三方的纸面头也给不出；证据全在离线三头 + 竖直位置尺 + 往返腿 + 独立字节腿
- [ ] **表格读侧第七笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [x] **表级那一层的 `w:tblW` 在读侧没有位置**（表格读侧第八笔账接上）：当时 19 臂三方同一趟里两臂（`tb_pct30_nogrid` / `tc_only_tblw`）整盘无账 ⇒ 交给浏览器自动布局，而 Word 在同一批件上说
      「表宽折算后按列等分」（120.67/120.60/120.60px 与 100/100/100px）⇒ 现在 `gridKnown` 为假时才吃表宽，同一把尺的 `判定分布` 从 `{'等':5,'不等':12,'自家缺口':2}` 变成 `{'等':7,'不等':12}`、
      往返腿 `RT重读换账的臂数` 从 2 变 0；pct 那档的口径本轮量清为**五十分之一百分点**（`PCT|命中=B` 三臂：3000 → 361.04px ↔ Word 361.87、5000 → 601.73 ↔ 603.07，按百分之几折的 A 档 180.52/300.87 差一整倍）
- [x] **Word 在网格与 tcW 打架时跟 tcW、ours 跟网格**（表格读侧第九笔账改的次序；**第十笔账量出这一句要按 layout 拆成两档**）：
      26 臂三方同一趟的 `判定分布(松1.0磅)` 从 `{"不等":18,"等":6,"账外":2}`（改前同一把尺、
      同一批件）变成 `{"不等":6,"等":18,"账外":2}` ⇒ 12 臂翻成等且**没有一枚原本相等的臂翻成不等**；跨列格那一档的形状（正差落这一跨的最后一条、负差整格跳过）
      由 `f_span` 三臂与 `i_span_under` 两臂同时钉住，
      五枚变异腿各抓各的臂。**这一轮重测发现「单列格连缩小也盖过网格、与 layout 三档无关」那一句只在 autofit/缺失那一档成立**（fixed 那一档 Word 落网格地板 75|90|120 而不是 75|75|75）⇒ 见下一节的第十笔账
- [ ] **`w:tblLayout` 缺失且只有网格时 Word 按内容重排**（`t0_grid_only` 本轮同一趟读回 10.55|10.55|10.55 磅而 ours 跟网格 60|90|120 磅）：
      这一档从声明里读不出来 ⇒ 判据只能标 `无候选匹配`
- [ ] **COM 的 `PreferredWidth` 在 12/19 臂上是 9999999 哨兵**（表宽由布局算出来时不给标量），而 `prefType ∈ {1,2,3}` 三档语义没译 ⇒ 这一格在第三方头上只能计账外而不是不等
- [ ] **写侧把表宽一律写成 `w:tblW dxa` 真值、且把 layout 一律写成 `fixed`**：往返一趟（30 臂、两条链同一趟）`表宽值` 26 臂换档、`表宽type` 24 臂换档、`layout` 16 臂换档 ⇒ 第三方件重存之后
      pct 声明塌成 dxa、autofit 与缺失塌成 fixed（读侧第八笔账起懂 pct，写侧还没有这两档的出口；第九笔账把行 0 改吃 tcW 之后 `表宽值` 反少换 2 臂而 `网格合计` 多换 11 臂——写回的是 tcW 那一盘账）；
      **表格读侧第十笔账把这一格数到 59 臂**：
      `盘的 layout 档={"fixed":36,"autofit":13,"缺":10} 往返件的 layout 档={"fixed":59}` ⇒ 三档在写侧全塌成一档，而宽度账本身 59/59「账不动」
- [ ] **表格读侧第八笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 屏上与纸面本轮**没有读数**，
      证据全在离线三头 + 往返腿 + 独立字节腿
- [ ] **表格读侧第八笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [x] **tcW 与 gridCol 打架时两头次序不同**（v0.97 量出、第八笔账读数补齐、第九笔账把行 0 的次序改过来、**第十笔账量出这一句其实是 layout 分流的两档**）：
      fixed 那一档 `w:gridCol` 是地板（`c_clash_sum_under` 落 60|90|120 而不是 tcW 原样的 30|45|60、`x_fix_nw` 75|90|120），
      autofit 与缺失那一档才是「逐格说了就算、缩小也落」
      （`x_aut_aw_shrink` 30|30|30、`x_non_nw_shrink` 30|30|30）；跨列格两族反着——fixed 只有正差上账且落这一跨的最后一条，autofit 把整份均摊到所跨各列；
      v0.90「有几枚写几枚」那一档与 `gridKnown` 为假时的摊平路径都没动，出账闸门与发射门也没动
- [ ] **表级精确宽压过逐格 tcW、而压过来之后怎么分列仍看 `w:tblLayout`**（第九笔账立、**表格读侧第十笔账把它的形状量清并数不等**：56 臂同一趟 16 枚不等里 11 枚是这一档）：
      fixed 那一档 Word 把 max 形状**等比缩到表宽**（`x_fix_d3000` 39.70|47.40|62.90 而本读手 75|90|120、
      `x_fix_d3000_shrink` 33.65|50.00|66.35 而 60|90|120、
      `d_clash_tblw_pct30_fixed` 35.95|42.90|56.85、
      `e_tblw_dxa4500_fixed` 与 `tc_span_tcw` 同为 50.10|75.00|99.90、`n_row1_tblw_present` 59.30|71.10|94.60、
      `tc_tcw_vs_tblw` 72.60|65.40|87.00），
      autofit 与缺失那一档是**表宽 ÷ 首行格数**（`x_aut_d3000` 与 `x_non_d3000` 50|50|50、`z_aut_d3000_shrink` 同 50|50|50 而本读手落 tcW 的 30|30|30、
      `x_aut_d3000_span` 37.50|37.50|75.00 而本读手 90|90|75）⇒ 两道门要一起开，而开它要重标 v0.92/v0.93/v0.94 三批屏上与纸面基线
- [x] **非首行的逐格 `w:tcW` 只扩不缩**（第九笔账量的 `m_tcw_row1_only_fixed` 差 15.0 磅 ⇒ **表格读侧第十笔账接上**）：列账现在扫**所有行**——fixed 那一档逐列取「各行 tcW 与网格」的最大
      （`m_tcw_row1_only_fixed` 75|90|120、`n_row12_big_first` / `_big_last` 两序都 105|90|120、
      `n_row1_middle_only` 60|150|120、`n_row0_shrink_row1_wider` 75|90|120），
      autofit 与缺失那一档逐列取各行 tcW 的最大而网格让位（`n_row1_only_autofit` / `n_row1_only_none` 75|75|45）；「只扩不缩」那一句量出来只在 fixed 那一档成立
- [ ] **`w:tblLayout` 缺失或 autofit 且只有网格时 Word 按内容重排**（表格读侧第十笔账在同一把尺下复现三臂）：`b_grid_autofit` 133.75|10.55|10.55 磅、
      `b_grid_nolayout` 144.55|10.55|10.55 磅、`z_aut_row12` 的第二三列 10.55 磅，而本读手落网格 60|90|120 磅 ⇒ 这一档从声明里读不出来，只能挂账外；
      `autofit` 那一档「一行都没说话的列退网格」是本轮跟着数据选的兜底（`n_row1_only_autofit` 75|75|45 那一列说了话就等分成功）
- [ ] **表格读侧第九笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 屏上与纸面本轮**没有读数**，
      证据全在离线三头 + 往返腿 + 独立字节腿；往返腿只用行 0 的账（`rowspan` 恒 1），竖跨那一格不进这一趟
- [ ] **表格读侧第九笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [ ] **fixed 那一档跨两枚以上网格缺口的正差不按内容分**（表格读侧第十笔账量出）：`q_fix_span_hole1`（跨列格的正差补**一枚**缺口列）Word 与本读手同为 60|120|120，
      而补**两枚**缺口列时 Word 把那一格自己的 180 磅按内容分成 18|162|120、本读手均摊成 90|90|120（合计同为 300 磅）⇒ 与 autofit 的内容重排同一族账外，本轮只挂不补
- [ ] **第九笔账那批 `c_clash_*` 的 Word 读数本轮不复现**（表格读侧第十笔账的独立 Word 腿：b6 与 b6h 两次跑 `ARM` 行逐字节相同）：
      那里记的是「行 0 各 1500 缇 ⇒ 75|75|75 磅、半宽 ⇒ 30|45|60 磅、且与 `w:tblLayout` 三档无关」，
      本轮同一枚臂名读回 75|90|120 与 60|90|120（= 网格那一头）⇒ 「连缩小也盖过去」只在 autofit/缺失那一档成立，「覆盖」那条与文件清单已按新读数改口；两批件的差在哪一枚字面上**没量**（`tmp/xmar9` 那批已按惯例删除）
- [ ] **往返件一律塌到 `layout=fixed`**（表格读侧第十笔账往返腿 59 臂同一趟）：
      盘的 layout 档 `{fixed:36, autofit:13, 缺:10}` 而往返件 `{fixed:59}` ⇒ 第三方件重存一趟之后 autofit 与缺失两档的声明消失（写侧只有 fixed 那一档的出口；
      与上面「写侧把表宽一律写成 dxa 真值」同一族，本轮读侧刚学会吃 layout，写侧这一格仍不给出口）
- [ ] **表格读侧第十笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 屏上与纸面本轮**没有读数**，
      证据全在离线三头 + 往返腿 + 独立字节腿；往返腿仍只用行 0 的账（发射门没动，`rowspan` 恒 1），竖跨那一格不进这一趟
- [ ] **表格读侧第十笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [x] **逐格 `w:tcW` 的型别只认 `dxa`**（**表格读侧第十一笔账接上**）：旧闸 `type === 'auto' || type === 'pct'` 把 `nil` 与规格外型别当数字读，
      新闸 `type !== 'dxa'` 一律账外（缺省 `w:type` 按规格算 dxa 那条不动）。43 臂同一趟里两链读数差恰好 6 臂（`p_type_nil` [75|90|120]→[60|90|120]、
      `t_nil_aut` [75|75|75]→[60|90|120]、`t_nil_mix_aut`、`t_nil_span_aut`、`t_foo_fix`、`t_foo_aut`）而其余 37 臂逐字节相同；
      同一把尺改前 `等(松)=等(严)=8`、改后 9/9（新转等 `p_type_nil`、`t_nil_aut`，丢了等 `t_foo_aut`）；真件不变腿 6 枚可读件 HTML 摘要 6/6 相同、
      40196 枚 `w:tcW` 里 nil 与规格外 0 命中 ⇒ 对真件可证 no-op；`tblWpx` 那侧没跟着动（见下面新开那枚）
- [x] **表级 `w:tblW` 的 nil 同族缺口没跟着补**（表格读侧第十一笔账只动逐格那一族时立下、**第十二笔账接上**）：`tblWpx` 那道闸由 `type === 'auto'` 改成
      `type === 'auto' || type === 'nil'`——37 臂同一趟里「nil 带正数造宽」的 7 臂（`w_nog_nil4513_fix` ours [75|75|75] ↔ Word [18|18|18] 且门面 `pwtype=1 pw=0.00`、
      `w_tcw_nilpct_fix` ours [75|75|75] ↔ Word [2|2.4|2.25]）全部翻成账外：`nil造宽臂` 7→0、`不等` 11→4，而 `等(严)=5`、`等(松含严)=16` 两份点名**逐字相同**
      （原本相等的 16 臂一枚没翻红）；这一层**不设 dxa 白名单**（规格外 `w_nog_foo4513_fix` Word `pwtype=3 pw=225.65` 与 dxa 臂同形、缺 `w:type` 同形，
      套白名单那枚变异件在类型层面就不成立：`src/lib/__q12m2.ts(1680,7): error TS2367: ... types '"dxa"' and '"pct"' have no overlap`）⇒ 与第十一笔账的格级闸方向相反、
      两族各立一道闸；真件那侧可证 no-op（250 枚件 / 1253 枚表 HEAD 与候选产出 0 处不同，1302 枚表里 nil 与规格外各 0 命中）
- [ ] **规格外型别（`w:type` 不在 auto/dxa/nil/pct 四档里）Word 把数字继续用而我们是账外**（表格读侧第十一笔账唯一一枚「改前等、改后不等」的臂）：
      `t_foo_aut` Word [75|75|75]（= tcW 的数字）而本读手 [60|90|120]（退网格）；266 枚可读件里规格外 0 命中 ⇒ 本轮按「读不出来就账外」处理并如实挂着
- [ ] **pct 那一档折的是表宽而不是版心**（表格读侧第十一笔账前置实测 32 臂 + 真件 266 枚 pct 对表）：`r_fix_dxa4513_uneven` 表宽 225.65 磅时
      pct 折宽离 Word 差 0.02 磅/格、折版心差 90.27 磅/格；真件里首行带 pct 的 30 枚表全为「缺 `w:tblLayout` × 有真数表宽」，pct 折宽离声明网格
      19 枚 ≤1 磅、11 枚差 2.08–65.28 磅，而 Word 能开的 6 枚件里 11 枚同族表有 10 枚读的就是声明网格 ⇒ 这一档要等「真数表宽压过逐格账」那两道门开了才接得上
- [ ] **表格读侧第十一笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 屏上与纸面本轮**没有读数**，
      证据全在离线三头 + 真件不变腿 + 结构/变异腿；读侧闸门只收窄范围而不新增出口 ⇒ 往返形状按机理不变，本轮没重跑往返腿
- [ ] **表格读侧第十一笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [x] **`w:tblW` 的 `w:w` 写成字符串字面那一档 Word 读成百分数而我们账外**（表格读侧第十二笔账量出、**第十三笔账接上**）：那一档从来够不着——`tblWpx` 读字面用的是
      `attr(tblW, 'w')`，它只匹配**无前缀**的 `w=` 键，而真 OOXML（含我们自己的写侧）落的是带前缀的 `w:w="30%"`（探针腿 b2 `attr('w')=undefined attrL('w')="30%"`、
      字节腿 b2 `带冒号 w:w 的臂=23/23 无冒号裸 w 的臂=0`）⇒ 改成 `attr(...) ?? attrL(...)` 再配形状闸 `/^-?\d+(?:\.\d+)?%$/`：23 臂同一趟 `转有账臂=10`（读手账外 16→6），
      `"100%"` 两臂**严等**（150.75×3 ↔ Word 150.8|150.75|150.75，总差 −0.05 磅），`"30 %"`（Word `pw=0`）/`abc%`/空/`"-10%"`/`"0%"` 按形状闸留在账外、
      `新造账而Word门面不说pct=0`；真件那侧可证 no-op（1154 表枚里百分号字面 0 枚，150 枚可读件 HEAD 与提交件产出 0 处不同）
- [ ] **规格外型别两族方向相反、本轮没去统一**（表格读侧第十二笔账）：表级 Word 复用那枚数字（`w_nog_foo4513_fix` / `_aut` `pwtype=3 pw=225.65` = 与 dxa 臂同形）
      而格级把它请出门（第十一笔账的白名单）⇒ 两族各立一道闸；265 枚可读件里表级规格外 0 命中，真件上这一格量不到
- [ ] **「真数表宽压过逐格账」那两道门仍不开，门挡那一侧的 4 枚不等挂账**（表格读侧第十二笔账）：`w_g_dxa4513_fix` / `w_g_foo4513_fix` Word 50.25|75.20|100.20、
      `w_g_pct5000_fix` 100.55|150.75|201.00 而 ours 落网格 60|90|120（按份额分列那一档），`w_g_nil4513_aut` Word 11.80×3（内容重排那一档）⇒ 开它要重标
      v0.92 / v0.93 / v0.94 三批屏上与纸面基线
- [ ] **pct 在两层的基数不同、只记注释而不并账**（表格读侧第十二笔账）：表级折**版心**（`w_nog_pct5000_fix` 严等 150.75×3 = 451.3 磅的 100%、`w_narrow_pct2500` 在
      4520 缇窄版心上 37.50 磅 = 226.0×50%/3），格级折**表宽**（第十一笔账的 `r_fix_dxa4513_uneven` 差 0.02 磅/格而折版心差 90.27 磅/格）⇒ 给 `tcWpx` 传表宽就等于
      开上面那两道门，本轮只在源文注释里把两档基数写清
- [ ] **表格读侧第十二笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 屏上与纸面本轮**没有读数**，
      证据全在离线三头 + 真件对照腿 + 结构/变异腿；读侧闸门只把 nil 取出去而不新增出口 ⇒ 往返形状按机理不变，本轮没重跑往返腿
- [ ] **表格读侧第十二笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.98.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [ ] **缺 `w:type` 而字面带百分号时 Word 推断成 pct 而我们落空**（表格读侧第十三笔账量出）：`x_pctstr_notype_fix`（`w:w="30%"` 而无 `w:type`）Word `pwtype=2 pw=30.00`、
      首行 45.20|45.25|45.25 而本读手账外——表级缺省型别是 `dxa`，走不到 pct 分枝；接它要先决定这一格算不算 pct 声明，而第十二笔账刚立的「缺 `w:type` 在表级复用数字」正压着这枚
- [ ] **门关一侧 `autofit` 与缺 `w:tblLayout` 那三臂 Word 按内容重排而等分给不出**（表格读侧第十三笔账）：`x_pctstr30_aut` 68.15|68.15|68.15、`x_pctstr30_none` 与
      `x_pctstr50_none` 77.15×3，而我们按 30% / 50% 版心等分（45.00 / 75.00 磅/格）⇒ 与「真数表宽压过逐格账」那两道门同源，开它要重标 v0.92 / v0.93 / v0.94 三批屏上与纸面基线
- [ ] **整数 px 的列账在窄版心量化不掉的那 0.7 磅**（表格读侧第十三笔账）：`x_narrow_pctstr100_fix` 版心 4520 缇 ⇒ ours 75.00 磅/格 ↔ Word 75.70|75.65|75.65（总差 −2.00，
      严尺松尺都不算等）；同族 `x_pctstr30half_fix`（`"30.5%"`）Word 把 `pw` 截成 30 而我们照 30.5 折（45.75 ↔ 45.20|45.25|45.25，松尺内）⇒ 地板是像素量化与截断，不是口径
- [x] **真件里两枚文件的 `<w:tbl>` 数与 HTML `<table>` 数不等**（表格读侧第十三笔账真件两腿，第十六笔账归因并勾掉）：「那一侧住在读手不产 `<table>`」的判断是对的，
      但不是整表被跳过——旧那对数（1154 / 1151，差 3）是在 150 枚可读件盘上数的、本轮没在那一批上重算分配；换 331 枚全清单按 b2/b3 两腿逐枚数清＝字节 1393 枚而 HEAD 读手
      1382 枚，差的 11 枚**全住 `w:tc` 那一档**（3 枚文件、每枚第 1 层、一枚不在别处）⇒ 真理由是 `cellBlocks()` 里那一枝把格里的表展平成段落，自第十六笔账起出真 `<table>`，
      x3 在同一批清单上报 `RESULT|不等文件枚=0 展平告警枚=0`
- [ ] **表格读侧第十三笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 屏上与纸面本轮**没有读数**，
      证据全在离线三头 + 结构/变异/往返腿 + 真件两腿；写侧一寸没碰而往返腿照跑（量的是「写侧落的那枚字面读不读得动」，答案是自家两臂两枝相同 = 这一档在写侧是惰的）
- [ ] **表格读侧第十三笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.116.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [ ] **条件层与样式基座层的 `w:tcBorders` 仍从不被读**（表格读侧第十四笔账量出，第十五笔账 b10 改口其覆盖面）：`CondCell` 只有 `{mar, tblMar, shd}` 三格，而「真件里唯一带条件层边框的
      UL212 那枚表」那句过窄——321 枚清单上有条件块 67 枚、带 `w:tcBorders` 的 34 枚共 175 枚边、住在 3 枚文件，引用这些样式的表 17 枚在 2 枚文件；「48 格四边在读手 b33 里全
      `(没写)`」那条读数不与改口冲突；被引用表样式基座那层的边框同理（它住在并发会话那份 hunk 上）⇒ 地板只到得了表级六槽、逐格四边与段落四边这三族
- [ ] **`w:sz` 缺省那一档仍是 8（1 磅）而不是 Word 在 `single` 那里的缺省**（表格读侧第十四笔账）：237 枚清单上省掉 `w:sz` 的在场边 0 命中（族普查 b21 无 `(缺)` 桶）
      ⇒ 本轮按「量不到就不改口径」留着，只抬已有数字的形状
- [ ] **地板只到 docx 读手，ODT 两头的粗细直译不经它**（表格读侧第十四笔账）：odt.ts 那一族按 pt 走 `odfBorderCss`，而 `w:sz` 的 1/8 磅口径只住在 docx 读侧
      ⇒ 同一份 0.25 磅的边在两头会不会分叉本轮没量（要量得先给 ODT 造一枚同形臂）
- [ ] **表级正文之外没人量过更细的档**（表格读侧第十四笔账 b21）：`sz=1` / `sz=3` 在 237 枚清单上 0 命中，而 42 枚 `sz=0` 全住在 1 枚文件的表级正文里 ⇒ 地板的
      中间档（比如真件里出现 `w:sz="1"`）今天只能由表级/样式那一族的 `{"2":8}` 反推，没有直接臂
- [ ] **表格读侧第十四笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 屏上与纸面本轮**没有读数**，
      证据全在离线三头 + 结构/变异腿 + 编译腿；写侧一寸没碰而地板对 12 枚目标件的回归可证是 no-op（b33/b34/b35 两两 diff 空）
- [ ] **表格读侧第十四笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.116.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [ ] **写侧与 ODT 两头都不落 `w:tblPrEx`**（表格读侧第十五笔账 b23 `S11 命中=0` / `S12 命中=0`）：读手现在认这一层而 `docx.ts` / `odt.ts` 从不写它 ⇒ 导入进来再存回去，
      这一行的边距账必丢；要补得先定「整行的格边距齐平时才写行级例外」还是「逐格有差异也写这一层」，本轮没定
- [ ] **行条件层与条件层（`w:tblStylePr`）、样式基座的先后无从裁决**（第十五笔账 b11：真件里同槽 0 枚、涉及表枚 0）⇒ 本轮把 `...exMar` 铺在那两层之上是**选择而不是实测**，
      Word 在这一格从没被问到过；等真件里出现同槽臂再裁
- [ ] **`w:type="auto"` 带一枚数时 Word 落 0 而我们归账外**（a8_ex_auto_type：Word 上边 0.20 磅 vs 读手 5.00 磅，是 b26 唯一那枚 `DIVERGE`）：真件里这一层 12722 枚边距**全是 dxa**
      ⇒ 那一档在真件上够不着，本轮不为它改闸（b23 `S9` 的那枚型别闸一字未动）
- [ ] **同层的 `w:tblBorders` / `w:tblLayout` / `w:shd` 仍不上账**（第十五笔账 b6/b9/b8 量出读了也不改任何一张表：39400 枚边读数全同 / 1353 与 1353 全同 / 12 枚全 `auto` 或没写）
      ⇒ 只留注释不进代码，将来真件里出现分叉再上账
- [ ] **条件层那一格 `w:tblStylePr/w:tcPr/w:tcBorders` 该上账**（第十五笔账 b10 把覆盖面从「唯一 UL212 那枚表」量宽到 34 枚条件块共 175 枚边、住在 3 枚文件，引用这些样式的表 17 枚在 2 枚文件）：
      它正压在并发会话那份「样式基座」hunk 上 ⇒ 等那份落定再接，本轮不动 `CondCell`
- [ ] **表格读侧第十五笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒ 屏上与纸面本轮**没有读数**，
      证据全在离线三头 + 结构/变异/后果腿 + 装配与编译腿
- [ ] **表格读侧第十五笔账不占版本号**：`package.json` / `Cargo.toml` / `tauri.conf.json` 现在住着并发轮次的 0.116.0 ⇒ 本轮不与之抢那三处对齐，源码形状以内容命名
- [ ] **屏上 / 纸面的嵌套表几何本轮没有读数**（表格读侧第十六笔账）：x8 只证 schema 与渲染吃得下（那两枚 `getBoundingClientRect` 不带应用 CSS），
      而 dev 树由另一会话持有、本轮的 dev 腿开头会关掉它全部标签（破坏性，不跑）⇒「格里的表在界面上摆成什么宽度」这一格两头皆空，等并发轮次落定再补
- [ ] **深度不设闸而真件只到第 1 层**（第十六笔账）：b6 `N3b|嵌套深度形状榜=第1层×11`，而 x5 的三层合成件 `S2|表枚=3 td内表枚=2` 量出递归本来走得通
      ⇒ 第 2 层往上只有合成件读数；真件里一旦出现更深的层，列账与边距怎么叠没有判据
- [ ] **格内表的「整盘没账就按版心等分」那一档吃的是版心而不是外层格宽**（第十六笔账）：本轮 11 枚枚枚带 `w:tblGrid` 与 dxa 的 `w:tcW`（b6 `N3/N5`）所以走不到；
      `N7` 那四档外层格宽 9927 / 4996 / 5505 / 6520 缇就躺在字节里，接它要把外层格的边距与所属列宽扣进 `table()` 的可用宽——现有 11 枚上这一档无关，先记不开
- [ ] **Word 门面这一头对嵌套表没有入口**（第十六笔账 w1/w2/w3）：`Document.Tables` 只数最外层（1 / 4 / 26 对字节 5 / 8 / 29）、`Table.Nested` 经 COM 取回 null、
      按行走撞合并格抛 `COMException`、`cell.Range.Tables.Count` 恒为外层那一枚 ⇒ 内层表几何在第三方那头没有判据
      （`BSUM#N|cellsScanned=76 / 63 / 379 而 cellsNotExactlyOneTable=0`），本轮判据只有自家读手 + 独立字节腿两头
- [ ] **格内 OLE 嵌入那一枝仍展平**（第十六笔账）：`embedContent` 提出来的内层形状有 docx 递归 / xlsx→表 / CSV→表 / txt→段 四种，本轮没像那 11 枚那样逐枚数过
      ⇒ 没量过的形状不改道，注释里那句假解释已换成这条真理由
- [x] **`pad*` / `rowHeight` 在 ODT 两头都没有通道**（v0.97 明写、**表格写侧第一笔账接上**）：odt.ts 写侧现在逐边落 `fo:padding-*`（cm 三位小数、
      0 是真值），行高走 `style:family="table-row"` 的 `style:min-row-height` + `style:use-optimal-row-height="true"`——`style:row-height` 那枚精确档
      Word 门面无一例外读成会裁字的 exact（w10 的 VRHFIX / VRHOPTTRUE / V3FIXTINY 三臂）⇒ 只读不发；读侧逐边压过 `fo:padding` 简写、行高按四档
      字面次序收，docx → odt 再回 docx 这两笔账不再丢
- [ ] **`style:min-row-height` 的 ODF 语法合法性本机没量具**（表格写侧第一笔账）：没装 LibreOffice 而 v0.62 那套 RelaxNG 闸只管 ODS 的 sheet 家族样式
      ⇒ 这一枚是从 Word 门面的读数反推出来的可达写法，不是规格校验器证明的；等量具到位再补校验腿
- [ ] **exact 那一档在 ODT 两头没有落点**（表格写侧第一笔账）：读侧收 `style:row-height` 而写侧从不 emit ⇒ 第三方件的精确档存回来降成下限，
      而这一档的裁剪差异在 ODT 两头都没有出口（v0.97 那枚告警只住在 docx 读侧）
- [ ] **`fo:minimum-row-height` 与 `fo:min-height` 只进不出**（表格写侧第一笔账）：Word 门面这两枚一头都不进账（VRHMIN / VRHFOMIN / V3MINTINY），
      我们读它们（收进同一档）而写侧不发 ⇒ 第三方件走 ODT 存一趟之后这一档塌成没账
- [ ] **ODT 的边距只有逐格那一档**（表格写侧第一笔账）：docx 的表级 `w:tblCellMar`、条件层与行条件层在 ODT 这一头没有对应落点，表级默认铺不进
      逐边字面 ⇒ 同一份账在 docx 是六层梯子、在 ODT 只有格上那一层
- [ ] **表格写侧第一笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿会关掉它全部标签 ⇒ 破坏性，不跑；格边距与行高在屏上的
      实际观感本轮**没有读数**，证据全在离线四头（读手往返 / ODT 字节 / Word 门面 / docx 字节）加结构、变异与编译腿
- [x] **同形状的漏账在 `w:spacing` / `w:shd` / `w:pBdr` 上一样成立而本轮没量**（段落读侧第一笔账立下、**第二笔账分两枝结掉**）：
      `w:spacing` 那一枝已并入同一张 `PPR_ATTR_SLOTS` 表按属性名合（丢账段 1801 枚/52 件、段落层丢掉的最大头 `line(正)=679` 段第一次够得着），
      而 `w:shd`/`w:pBdr` 量到真件里「两层都在场」是 0 段（c1）⇒ 照旧整枚替换，另立下面那枚可达性项
- [ ] **编号层的 `w:ind` 没接**（段落读侧第一笔账）：`numbering.xml` 里 `w:lvl/w:pPr/w:ind` 与段落自身的 `w:ind`
      之间同样是属性级的账，本轮只在样式链（`w:basedOn`）那一头做
- [ ] **字符档的字号只解两档**（段落读侧第一笔账）：段标 `w:rPr/w:sz` > 样式链，取不到退 `.doc-content` 的 15px，
      `docDefaults` 那一层的字号没接进来（c16b 量到 docDefaults 可解的有 4 枚）
- [ ] **缇值与字符档同写那一档的组合本轮没量**（段落读侧第一笔账）：`w:left="0"` 配 `w:leftChars="200"`
      现在按缇值 0 处理＝不上账，而门面那一头怎么裁不知道 ⇒ 不为它改闸
- [ ] **`rightChars` 单独出现的枚数是 0**（c16b/c17）：右缩进那一档的字符写法在真件里从不单独说话 ⇒
      本轮没有臂，`margin-right` 只从缇值那一路来（后果腿 421001 段里只落 1 枚）
- [ ] **`w:start`/`w:end` 只在同一枚 `w:ind` 上归一**（段落读侧第一笔账）：跨层混拼（样式写 `start`
      而段落写 `left`）没做别名合并——真件 0 例（c21），做了也没有读数证明该做
- [ ] **写侧没动**（段落读侧第一笔账）：docx/odt 回写仍把缩进写成整枚 `w:ind`，存—重开一趟会不会把这份属性级的账
      改写，本轮没量
- [ ] **段落读侧第一笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿会关掉它全部标签 ⇒ 破坏性，不跑；
      `margin-left` / `text-indent` 在屏上和纸上的观感本轮**没有读数**，证据全在离线四头（结构+变异 / 真件读手 /
      独立字节 / 三头判据）加后果、拆分与编译腿
- [ ] **`w:shd` / `w:pBdr` 的属性级合并在真件里够不着**（段落读侧第二笔账量出）：同一枝的漏账形状在 `w:shd` 与 `w:pBdr`
      上是「两层都在场 0 段」（c1 同普查），而在场枚数并不少（c2 `shd=1842`、`pBdr=706`）⇒ 没有臂就不改道，
      哪天第三方件写出两层并立，这一枚才有账可算
- [ ] **`w:beforeAutospacing` / `w:afterAutospacing` 两枚属性名一枚都不吃**（段落读侧第二笔账量出）：在场段 1537/1547、
      置真段 297/304、与绝对值并立 1248/1256 段、住 36/38 枚文件，另有 `跨_段autospacing压样before=621段/12件` 的形状
      ⇒ 本轮把 `w:spacing` 按属性名合之后，这两枚是那一枝上唯一还被整枚读手忽略的属性；接它要先门面量清「置真时绝对值
      还算不算」，本轮没建这一族臂
- [ ] **Word 的 Normal 自报 after=8pt、before=0，而整份没写 spacing 时我们不发言**（段落读侧第二笔账门面 14 处缺省档）：
      缺的那一层（`docDefaults` + 内建 Normal）没接进来，判据腿按「缺省档」单列而不算错
- [ ] **行档的底数是 19px/行而 Word 量成 12pt/行**（段落读侧第二笔账九枚行档臂 A4/A5/A8/A12/A14/A15/A17/A22/A23）：
      门面差 2.25~4.5pt ⇒ 底数随字号与行距倍数怎么走还没量，本轮只记读数不改道
- [ ] **写侧没动**（段落读侧第二笔账）：docx/odt 回写仍把间距写成整枚 `w:spacing`，属性级合并之后的账存—重开一趟会不会
      被改写（尤其行档与缇档并立时发哪一枚），本轮没量
- [ ] **段落读侧第二笔账没有 dev 真机腿与纸面腿**：dev 树由另一会话持有而本轮的 dev 腿会关掉它全部标签 ⇒ 破坏性，不跑；
      `margin-top` / `margin-bottom` / `line-height` 在屏上和纸上的观感本轮**没有读数**，证据全在离线两头（结构+变异 /
      真件读手对照）加后果、拆分、举例与编译腿
- [ ] **exact 行高的裁剪语义只有一枚告警**（v0.97）：读入按 atLeast（下限），屏上内容超高时不会被裁，
      而 Word 的 exact 是真裁——这一档的观感差异只在导入时说一句，没有别的到达面
- [ ] **v0.97 没有 dev 真机腿与纸面腿**：行高与格边距在屏上和纸上的形状本轮**没有读数**（dev 树由另一会话持有，
      而本轮的 dev 腿开头会关掉它全部标签 ⇒ 破坏性，不跑）；证据全在离线三头（读手/字节/Word 只读 COM）
- [ ] **默认行距 `line-height` 仍比 Word 厚**（v0.95/v0.96 记的那笔纸面行高的默认档对应）：工作树里已备好
      `.doc-content{line-height: 1.75 → normal}` 这一枚改动而**它不属于 v0.97**——它要屏上 + 纸面两腿，
      并会作废 v0.94/0.95/0.96 那三批绝对像素与纸面基线（那三批都在 `line-height: 1.75` 的树上量的），
      故另立一轮整批复跑
- [ ] **无账的表存—重开一趟之后变成"有账"**（v0.89 带来的形状改变）：等分那份真网格被读侧收下 ⇒ 下一趟按固定宽写，
      Word 只读腿实测 re2-notblwidth 的 `PreferredWidthType` 2（百分比）→ 3（固定）。等分账本身三趟逐枚稳定（字节腿 E×4
      + W11），但"表级布局档跨一趟会换"这一格只记读数未作取舍；要维持百分比那一档就得把"这表原本没有账"另记一笔
- [ ] **嵌套表的版心是按最外层算的近似**：`blocksOf` 穿下去的是所在层的版心宽，不扣外层单元格的边距与所属列宽 ⇒
      格内表的等分比实际可用宽度宽一些（本轮未量这一档的真件）
- [ ] **px 存整数的 ±0.25 磅级导出漂移**：模型 `colwidth` 是 px 整数（`PX_TWIP = 15`），夹具的 2000/5000 twip 折算成
      px 再写回必然差几 twip ⇒ 字节腿按 ±15 twip、Word 腿按 ±0.5 磅判；真要消掉得把宽度账改成 twips 层存储（牵读侧与
      prosemirror-tables 的 `colwidth` 语义，不在本轮口径内）
- [ ] **v0.89 没有 release A/B**：纯写侧字节改动，证据来自独立字节腿 + Word 16.0 只读腿 + dev 真机三头；
      "界面上看到的列宽与导出的件一致"由 dev 臂 D2/D5 判，release 上没有另立可观测面
- [ ] **含合并格的表在 Word COM 上量不到列**：`Tables(i).Columns` 集合对这类表一律抛 COMException（夹具与导出件同尺
      同读数，v0.89 Word 腿 NOTE）⇒ 跨度那一档只能退回 `Rows(1).Cells` 逐格读，"整表列宽"这一格在第三方那头没有判据
- [ ] **拖拽把屏幕位移直接当模型 px 增量**（v0.90 前置实测 P1b）：在齐账件上要 +30px，模型确实写进 150/160/240 而
      **屏上视觉只动了 +26.24px** —— 这一版 prosemirror-tables 不产出 `.column-resize-proxy`（C6 判的就是"别给它写样式"），
      于是 `updateColumnWidth` 拿的是鼠标像素而不是"按列比例折算后的像素"＝混单位。本轮只保证这份账进得了字节，
      没有替用户把这两把尺对齐
- [x] **屏上是比例、导出字节是绝对宽**（v0.90 前置实测 P4 记的那层不一致，v0.92 结掉）：`IndentTableView.applyIndent`
      把 `table.style.width` 写成 `calc(100% − Npx)`，覆盖了库按 `columnWidths` 给的绝对宽 ⇒ 齐账件模型 px 是 120/160/240
      而 rect 读数是 144.32/192.43/288.66（按 626px 比例摊开），docx 那头写的是绝对 dxa，两头各说各话。v0.92 量出
      这一枚缺陷住在**自家那一层**（库的 `updateColumnsOnResize` 本来就写 `Σ + "px"`，只是在我们 `applyIndent` 之前跑、
      被无条件盖掉）⇒ 现在整表每列都带账时表宽 = `accountTotalPx`（Σpx），没账或部分账才照旧走比例；实测 narrow
      inline 520px + rect 119.86/159.79/239.68（= 模型 px 1:1）、indent 臂 520px 而 `marginLeft` 仍 40px、
      而 `none`/`partial` 两臂逐枚回归改前读数（208.47×3 与 248/188.7/188.71）；字节与磅值两头 Y1~Y9 + W10_* 证明
      写侧一个字没动（屏上第一次吃的是同一份账，不是新造的一份）
- [ ] **部分账件存—重开一趟会变成整表齐账**（v0.89 那条「无账换档」的同族）：补平出来的那份真网格（`2835/2835`）
      被读侧逐列收下 ⇒ 下一趟每一枚网格列都带账，导出从"部分账 + 补平"变成"整表账"。字节上形状没变（仍是 `fixed` +
      绝对宽），变的是"这表原本只有拖过的那一列有账"这份信息跨一趟就没了；要留住它就得把"哪几列原本没账"另记一笔
- [ ] **`fixTables` 公开通道是 no-op 这一格只记了读数**（v0.90 前置实测 P5）：TipTap 那条命令
      `if (dispatch) fixTables(state)` 把返回的 tr 直接丢弃，真正生效的是 `tableEditing` 插件 `appendTransaction` 里
      每趟跑的那一次对账 ⇒ **任何"只写一行"的宽度设置都会在下一趟被抹回**（实测把行 0 第一格改成 [210] 之后
      `rows` 仍是 `[120,160,240] ×2`）。本轮据此定了"精确设宽必须一次写遍整列"的形状，但插件那一路本身没动
- [ ] **v0.90 没有 release A/B**：把手那一半是纯 CSS（release 上到不了注入缝，只有形状推断），字节那一半由 dev 腿
      落盘的件交给独立字节腿 + Word 16.0 只读腿裁 ⇒ "release 真机上把手看得见"这一格没有第三方证据
- [x] **纸面那一头没量**（v0.92 开，v0.93 结掉）：文档导出 PDF 走 WebView2 `PrintToPdf`，吃的就是这份 DOM，而 `over`
      臂屏上就撑出（`contentScroll` 900 > `clientWidth` 626、表右沿顶出文档右沿）⇒ 超宽表上纸是被裁掉、缩进下一页还是
      照样出血，从来没有正面量过。**量出来是一枚真缺陷**：Blink 打印遇到比版心宽的内容时把**整页**按比例缩小
      （`over` 臂纸上 `scalePx` 0.6981 = 627/899，正文 15px 在纸上只有 10.5px，而其余八臂一律 1.0004 不受影响），
      v0.93 在 `@media print` 的 `.doc-content` 上补 `overflow: hidden` 把这一档改成"裁在版心右沿"（注入五枚候选里
      只有 `.doc-content` 与 `.doc-page` 修得住 `scale`，选只管正文那一层的；Word 16.0 自己导出的同一件按真尺寸排、
      超出纸外的部分被纸裁掉 ⇒ 裁而不缩有第三方对照）。纸面判据腿 35/0、CSS 结构+变异腿 10/10 + 11 枚变异全响、
      dev 腿 45/0、字节腿 41/0（含十臂 `word/document.xml` 与改前逐字节相同 = 写侧没碰）
- [ ] **NodeView 与 `renderHTML` 两口径没合一**（v0.92 记的诚实不对称）：`IndentTableView.applyIndent` 看得见子节点
      因而能算 `accountTotalPx`，而 `marginLeft` 的 `renderHTML` 只能按属性写 `calc(100% − Npx)` ⇒ 同一张表在
      NodeView 那条路（编辑器里真渲染的那条）吃绝对宽、在 `renderHTML` 那条路（序列化/非 NodeView 渲染）仍是比例；
      本轮没把宽度账塞进 `renderHTML`（它没有列账可看）
- [ ] **部分账那一档屏上仍是比例**（v0.92 只让齐账那一路同形）：`[248,null,null]` 那型在字节里是
      `3720/2835/2835`（= 248/189/189 px）而屏上读 248/188.7/188.71 —— 数值恰好接近是浏览器 auto 布局与我们的
      补平算法碰巧同形，不是同一份账上了屏；`accountTotalPx` 对部分账整表 `return null`，故这一档照旧走比例
- [ ] **v0.92 没有 release A/B**：改的是 NodeView 内联样式那一半，到不了 release 的注入缝 ⇒ 屏上形状由 dev 真机腿裁、
      字节与磅值由两条独立腿裁，"release 真机上齐账表按绝对宽渲染"这一格只有形状推断
- [ ] **覆盖率的分母只算读手吃进去的 7 枚部件**（fidelity report 本轮量出口径）：`word/settings.xml`、
      `fontTable.xml`、`theme1.xml`、`docProps/*` 一概不在账内 ⇒ 「件里字面全集」是「读手会吃的部件」的全集，
      不是整份包的全集；把这些部件纳进来要先决定「读手有没有打算吃它」
- [ ] **探针只吃 `attr` / `attrL` 两枚漏斗**（变异腿反过来证明的）：`--mut no-attr` 让覆盖率从 17.6% 掉到 4.1%，
      说明账几乎全来自 `attr` 那一枚，而任何绕过漏斗直接读 `el.attrs[...]` 的查问**不进账** ⇒ 「从没查问」那一档
      里可能混着「其实读了而没走漏斗」的形状，本轮没逐枚排查
- [ ] **等价腿只裁 html 逐字节**（`--clean-pass` 的裁面）：比的是整份 HTML 的 md5，`blocks` 枚数与告警只在同一趟里
      顺带数过而没有单列 ⇒ 「观察者不扰动产品」这一句的范围就是 html 那一枚出口，别把它读成「所有出口都不扰动」
- [ ] **语料不可复核**：报告里的数字来自本机那 313 枚真件而产物按纪律不含任何文件名或路径 ⇒ 换一台机器、换一批件
      数字就换一批；要外部读者能复核，得有一枚公开的固定夹具包（或至少一份可发布的逐对计数），本轮没做
- [ ] **「查问过 → 落进 CSS → 屏上/纸面可见」那第二段没接**：报告裁的是运行时按名查问，不是视觉平价 ⇒ 17.6% / 50.7%
      既不等于「屏幕上对了多少」也不等于「错了多少」；`w:top/@w:space` 那种「读了只为出一句告警」的对在这一档里
      与真正上屏的对同列（要分出得给每枚对配一枚后果腿，本轮只在段落两笔账上做过）
- [ ] **噪音档按名字规则归，且变异腿缺正控制**：`rsid*` / `paraId` / `textId` 那 19 对 / 770,634 枚字面是从名字规则来的
      而不是从「零语义」的证明来的；`--mut` 只演示「漏注入会让覆盖率降」，没有「假注入会让覆盖率虚高」的正控制 ⇒
      分子的下界可信而上界没裁
- [ ] **字符间距只到 CSS 这一层，屏上与纸面两头没量**（字符读侧第一笔账开）：本轮的判据是「提交件输出的 `letter-spacing` 串」对
      Word 16.0 门面的 `Font.Spacing`，十臂 10/10 合而真件落 25,150 枚字面；但浏览器拿到这枚 `letter-spacing` 之后行宽、换点、
      是否撑出（`contentScroll`）与打印分页怎么变，一头都没量——那一头要 dev 树，而 dev 树此刻归并发会话
- [ ] **编号层 `w:lvl/w:rPr/w:spacing` 那 44 枚从不落屏**（字符读侧第一笔账 c1d 祖父榜）：`readNumbering` 只取编号的形状与层级，
      列表标记自己的字符间距在这一层而不在正文 run 那一层 ⇒ 真件 44 枚（`num/lvl`）；要接得先决定「标记的间距」在 HTML 里落到
      哪一枚元素上（`li::marker` 不吃的浏览器版本不少），不在本轮口径内
- [ ] **样式链与段落标记同写间距那一臂没进夹具**（字符读侧第一笔账）：A5/A6/A7 裁的是 run↔样式（3/5/0 磅），A8/A9 裁的是
      标记↔run（0/5 磅），而「样式说 3 而标记说 4」那一臂 Word 报什么没量过；真件里 `sty/style`=32 枚正住在这一档，E3 现在一律
      按「标记不进正文」处理，读数对了但没有臂可证
- [x] **写侧没有字符间距的出口**（字符读侧第一笔账）：docx 两头与 odt 两头都不写 `letter-spacing` / `w:rPr/w:spacing` /
      `fo:letter-spacing` ⇒ 我们打出去的文件不带这一层，界面上改了也不算数；这一笔要单独一轮（「字符写侧第一笔账」）且要先量
      ODF 那一头 Word 读得到哪条通道（表格写侧那笔账的教训：`fo:minimum-row-height` 规格允许而门面不进账）
      本轮已闭（字符写侧第一笔账）：docx 走 `w:rPr/w:spacing@w:val` 的缇、ODT 只走 `fo:letter-spacing`，
      而通道由 Word 16.0 门面八臂裁而不由 ODF 规格裁（`style:` 与 `loext:` 那两族全不进账）
- [ ] **`letter-spacing: 0pt` 的字面形状与 Word 不同**（字符读侧第一笔账 A3/A7）：Word 门面在样式链无账时把 run 写的 0 **整枚丢弃**
      （另存回来 `val=NONE`），而按「这一层有没有写」的闸门我们落 `letter-spacing: 0pt`；屏上等值（0pt 就是不加不减）而字节形状不等 ⇒
      往返腿只能按「值袋」比而不是按字面比，本轮照实记而不改成 Word 的丢弃口径
- [ ] **报告里那枚 `spacing|val` 要重跑才搬得动，而重跑要先复现同批清单**（字符读侧第一笔账）：`docs/fidelity.md` 那批是 313 枚
      而本轮的普查与后果腿都在 299 枚上 ⇒ 直接重跑会同时改分子（探针查问集）与分母（件里字面全集），两笔账混成一笔没法归因；
      要搬那一档得先把清单钉成一份可发布的固定语料（与「语料不可复核」那枚同根）
- [ ] **只有图片/域代码这类不落文本的 run 拿不到这一枚 CSS，同族分支没穷举**（字符读侧第一笔账 v7b 归因）：那 2 枚「有声明而零字面」
      归因到 `case 'drawing'` push 一块就 `return`（run 文本长度=0，且 `val` 都是 0），但同一条早退路上还住着 `w:pict`、OLE、
      图示/图表部件这些分支——它们的 `w:rPr` 带不带间距没逐枚数过，「没量过的形状不改道」这条纪律在这里同样成立
- [x] **ODT 读侧不吃 `fo:letter-spacing`（写得出去而读不回来）**（字符写侧第一笔账）：`resolveStyle` 只认字重/斜体/
      下划线/删除线/字色/底色/字族/字号/上下标那九族，本轮新发的这一族不在名单里 ⇒ 我们导出的 `.odt` 里字符间距到了 Word
      那一头读得到（门面三层进账）而自家 reopen 一件时整批丢；补法照表格写侧那笔账（读侧逐边收且简写让位直接格式）
      （ODT 字符间距读侧第一笔账已闭这一层）补法没走「简写让位直接格式」那条，而是在字号那同一个 `tp` 上加一枚查问：
      `resolveStyle` 读 `fo:letter-spacing`、`htmlOfStyle` 出 `letter-spacing: Npt`，34 枚夹具字节层那 30 枚 `fo:` 声明里字符族落回
      26 枚/24 件（差额逐枚归因到段落族、`style:default-style` 与 `em`）；通道仍只吃 `fo:`——b20 门面八臂对 `style:`/`loext:` 的裁定没变
- [ ] **界面上没有字符间距的把手**（字符写侧第一笔账）：`CharSpacing` 把属性挂上了 `textStyle`，`setContent` 从此不再
      剥掉导入发的那句 `letter-spacing: Npt`，但没有命令、没有工具栏入口、没有键入框 ⇒ 用户手动设这一层仍无路径，
      本轮打通的只有「导入→模型→导出」这一圈；要接得先定「磅」还是「缇」进界面
- [ ] **docx 那一头的 0 上不了纸**（字符写侧第一笔账 E2/m2/c1f）：`if (lsTw !== 0)` 那道闸是记账用的而撤掉它三头 `bites=0`——
      吞掉 0 的是写手库（`characterSpacing: 0` 连 `w:rPr` 都不出）；绕开库用字符串能写出 `w:val="00"` 而 Word 另存一趟又整枚
      丢弃（`ZeroRun:NOELE`）⇒ 要真落「压过样式的 0」得自己发 XML 或在模型里把「0」与「没声明」分家
- [ ] **字符间距的屏上后果没量**（字符写侧第一笔账）：本轮判据是「写手落的那枚 `w:val` / `fo:letter-spacing` 字面」对
      「Word 门面的 `Font.Spacing`」，而浏览器拿到 `letter-spacing` 之后的行宽、换点、是否撑出（`contentScroll`）与打印分页
      一头都没量；那一头要 dev 树而归并发会话（与字符读侧那枚同根）
- [ ] **样式链传下的那一步在写侧走的是 run 层出口**（字符写侧第一笔账）：真件里 character 样式层 `w:spacing` 40 枚
      （character 25 + paragraph 15）经 `w:basedOn` 传到 run，读侧把它并进 run 自己的 `letter-spacing`，导出时又按 run 层写回
      ⇒ 「样式说 3 而 run 没写」与「run 自己说 3」在打出去的文件里同形，而 Word 另存会把前者重排成后者；本轮没为它出臂
- [ ] **同族的 `w:w`（字符缩放）与 `w:position`（升高/降低）没量**（字符写侧第一笔账 c5 名单）：它们与 `w:spacing` 住同一枚
      `w:rPr`、走同一条 `readRPr` 梯子，而 `c5` 打的 ODT 字符样式发射名单（16 枚）里没有这两族；本轮只搬间距而不碰它们，
      「没量过的形状不改道」在这里同样成立
- [ ] **三批清单三个数（313 / 299 / 307）⇒ 跨轮的枚数不可互引**（字符写侧第一笔账 c4）：`docs/fidelity.md` 那批 313 枚、
      字符读侧那节的普查在 299 枚上、本轮供给普查与后果腿在 307 枚（可读 269、抛 38）上 ⇒ 写侧那 24,644 枚字面与 153 枚
      不同值只在 307 这批内成立；把清单钉成可发布的固定语料之前，任何「按枚数跨轮比较」都是把两笔账混成一笔
- [x] **ODT 字符间距读侧只在 34 枚夹具上量过（真件 `.odt` 一头没量）**（ODT 字符间距读侧第一笔账 e10）：盘上 od 族件数=34 而它们全是本轮造的夹具，
      docx 那两批真件清单（313 / 307 枚）里一枚 `.odt` 都没有 ⇒ 「真件里这一族有多少枚、住哪一层」至今没底数；要跑得先攒一份可发布的 ODT 语料
      （与「语料不可复核」那枚同根）
- [x] **`lenPx` 的 mm 档与裸数档共用 37.795 这个因子 ⇒ mm 全族 10× 偏**（ODT 字符间距读侧第一笔账 B03；ODT 长度 mm 档第一笔账闭：`lenPx` 与 `odfBorderCss` 各自的 mm 枝换成 3.7795 而 terminal 一寸没动）：`1.058mm` 折成 29.993pt 而按 mm 该是
      3.0pt（cm 那枚 `0.106cm → 3.008pt` 对、裸数按 cm 也自洽），而**同一枚梯子被 11 处 `lenPx`/`len2px` 调用吃着**（缩进、格边距、段落边距、
      表宽、行距…）⇒ 修它是整族改道且要给每档配一枚字面判据腿，本轮不为单独一枚间距撞它；长度这一轮把「整族改道」收成只换 mm 那一行，判据腿给了夹具载体榜 13 臂、单位榜 6 档、门面 7 臂、真件 77 枚 no-op 四批，而只数落屏枚数的腿会放行一枚把 mm 折成另一个错系数的变异（它的六份读数落屏枚数一毫不动而逐臂值全错）
- [x] **`normal` 那一档 ODF 合法写法落不进读侧**（ODT 字符间距读侧第二笔账闭；`em` 那一半单拆一枚）：`normal` 与 `0.2em` 曾被 `lenPx` 与 `toLetterSpacingPt`
      双双拒收 ⇒ 读成「没声明」，而门面在祖先层进账的 P15 三臂上量到 `normal` 是「说了 0」（`0:56` 对摘掉臂的 `1.5:1069`）⇒ 读手在查问处把它折成显式 `0pt`；真件那 23 枚在两头值袋全同（`e17` 变 CSS 件枚=0），`e20` 把归因追到渲染分支：那 5 枚可落形状全住 `office:annotation` 而批注正文不走行内渲染
- [ ] **段落样式身上的 `fo:letter-spacing` 那 2 枚仍不吃**（ODT 字符间距读侧第一笔账 B12/B13）：`resolveStyle` 从不为 `style:family="paragraph"`
      取任何字符属性（字重、字号、字色同样不取）⇒ 单开一条「段落的字符属性」通道不在本轮口径；等与 docx 段落标记那层（404 枚）一起量过再定次序
- [ ] **`style:default-style` 那一层整层不可达**（ODT 字符间距读侧第一笔账 B16）：读手 `styles` Map 只收 `localName === 'style'`，而它自己的注释
      写着「name → style:style / default-style」⇒ 注释与代码不合，文档默认那一层的字体/字号/间距落不进任何一块；本轮量到 1 枚，整层的账要单独一轮
- [ ] **ODT 字符间距的屏上与纸面后果没量**（ODT 字符间距读侧第一笔账）：判据是「提交件落进 HTML 的 `letter-spacing` 字面」对「字节层的
      `fo:letter-spacing`」，而浏览器拿到它之后的行宽、换点、是否撑出与打印分页一头都没量；那一头要 dev 树而归并发会话（与字符读侧、
      字符写侧那两枚同根）；下一节把「落不落屏」那一半量成了 66/89 的读数，本项剩下的是「落了之后屏上长什么样」那一半
- [ ] **给 ODT 读侧攒的真件语料没钉成可复核清单**（本轮 c0d）：75 枚取自一枚公开仓库的 odfimport 测试数据目录、2 枚自家 Word 另存（还逐字节相同），
      全住被忽略的一次性临时目录 ⇒ 下一轮重跑得重新取件，而「哪 77 枚」现在只活在本轮的日志里；要钉就得把清单与取件方式落成仓库里的东西
      （与「语料不可复核」「三批清单三个数」同一根）
- [ ] **Word 门面把 docx 另存成 odt 十臂无一回话**（本轮 c1/c1b）：逐件独立进程 + 120 秒硬看门狗，六臂全 TIMEOUT；杀掉先前会话留下的那两枚
      WINWORD 实例后重跑四臂仍旧停在 `step=save fmt=23` 而产物空 ⇒ ODT 这头的判据至今只有「自家读手 + 独立字节腿」两头，要第三头得换法
      （换 LibreOffice 无头转换、或按臂缩短夹具再看卡在哪一句）
- [ ] **具名样式的段前段后在 ODT 读侧完全不上屏**（本轮 c7/c8 的 30 枚）：读手 `resolvePara` 里那句带 `namedStyles.has(sn) || FIXED_PARA_STYLES.has(sn)`
      的 `continue` 坐在 `fo:margin-top`/`margin-bottom` 之前，注释给的理由是「摊到每一段上等于把默认写成直接格式，导出再开会长出一整篇显式行距」
      ⇒ 外部写手件的段前段后整批丢；改它要先定那笔代价怎么绕（读进来时算差值、还是写回时按样式层收口），不是补漏而是换设计
- [x] **`lenPx` 的 mm 档修它要给两头同判**（本轮把上一节那枚推断量成了读数；ODT 长度 mm 档第一笔账两头同判已兑现）：夹具上 2.12mm 落 80.13px 而按 mm 该 8.01px（10.0×），
      同一改动在 77 枚真件上动 0 枚件；⇒ 改这一档的判据腿必须同时有「夹具动 N 枚」与「真件动 0 枚」两臂，否则下一轮会把它当成没后果——ODT 长度 mm 档第一笔账正是按这一条立的腿（夹具动 10 臂而真件动 0 枚，两批同趟同日志）；字符间距这一族同样中招（夹具 `1mm` 落 28.35pt 而按 mm 该 2.835pt，而这批 89 枚里没有一枚 mm 字面）
- [x] **`odfBorderCss` 里同一枚 37.795 的 mm 因子本轮没量**（ODT 长度 mm 档第一笔账量到并改到）：它和 `lenPx` 犯的是同一个错而入口不同（边框粗细那一族），真件语料里没有字面
      走到那一枝 ⇒ 静态榜上有名而运行时零读数；按纪律不为没读数的形状改道，先量它到底有没有件走——量到的是「走到那把尺跟前的 4,436 枚输入里没有一枚长度字面」，故本轮与 `lenPx` 那道枝一起改到而判据只有 ODF 规格加夹具两臂（门面在段落边框上整臂报 off）
- [ ] **按对 29.6% 与按名 38.0% 两套口径还没合进那份公开产物**：`docs/fidelity.md` 至今只算 docx 那头的按名账，而本轮量出 ODT 读手
      88 对 / 52,071 次命中 / 69 对在分母里；把运行时口径合进去要先把「按对」与「按名」在两处文案里写清各是哪一档
- [ ] **`style:line-height` 那一族查问了而这批语一枚字面都没写**（本轮 c4j 那 19 对里的两对）：ODF 行高在真件里有 `fo:line-height`（195 枚）
      与 `style:line-height`（0 枚）两种写法，读手两头都问；⇒ 换一批写手（另两种行高写法）这 19 对就会翻成有读数，覆盖率那本账要重跑

- [ ] **落屏那 66 枚只由一枚内容撑着**（本轮 d2/d3）：77 枚真件里只有 Word 16.0 另存的那两枚 `letter-spacing` 上屏，而那两枚逐字节相同
      ⇒ 外部写手（LibreOffice 系 75 枚）在这一族上是零落屏，「ODT 字符间距测过真件」这话目前的证据宽度是一枚；语料钉死之前不能对外说测过
      （与「真件语料没钉成可复核清单」「三批清单三个数」同一根）
- [ ] **`referenced=NO` 那 8 枚字面没逐件归因**（本轮 d1 的 `referenced` 列：yes 81 / NO 8）：字节腿知道这枚样式名在这件里没被任何元素引到，
      而不知道是「本来就没人引」还是「引它的元素走不到 `span` 那一枝」；⇒ 要接「没人引的样式」这笔账得先给这两族分别配臂
- [ ] **597 回查问与 89 枚字面的逐件对账没做**（本轮 d7 只把四把尺并排放）：上一节那枚探针腿只报聚合命中数，没有 per-file 的查问数
      ⇒ 「一枚样式被多处引用」放大查问次数这一件事现在只有总量而没有分布，覆盖率那本账合进公开产物时要先补这一列
- [ ] **单位榜在真件上只有两档而夹具撑起十五档**（本轮 d1 值三档 vs d4 单位 17 臂）：真件写的只有 in 与 `normal`，`pt`/`px`/`mm`/`cm`/裸数/`em`/`%`
      全零枚 ⇒ 这批写手换掉（或语料换批）就得重量，而这一族的「拒收族覆盖面」目前完全靠夹具，没有真件侧的下界
- [ ] **屏下界与最大失真没有扫档腿**（本轮只量到 `0.00001in → 0pt`、`0.0001in → 0.008pt` 两点）：两步梯子（×96 → 2dp → ×0.75 → 3dp）的失真
      上界本轮只算了两枚值（`-0.0032pt` / `+0.0010pt`），而 `Math.round` 对负半值朝 +∞ 进位（`-0.2925 → -0.292`）没配判据臂
- [ ] **`table-cell` 载体上的字符属性要不要接没定**（本轮 A5/A6 不落屏 + 真件那 14 枚只有 `normal`）：接它就是「格子样式兜住格内没有 span 的正文」
      那笔设计账，而它与「段落样式身上的字符属性不吃」是同一族决定；按纪律不为没读数的形状改道，先定设计再动通道
- [ ] **docx 与 ODT 两头「落不落屏」的账形状不同而还没并排**（docx 字符读侧 25,150 枚/件=35 铺在 265 枚件上 vs ODT 66 枚挤在一枚内容上）：
      那份公开产物要合 ODT 一头时不能照抄 docx 那套分母口径，否则「按字面覆盖率」会在两头指两件不同的事
- [ ] **Word 不继承具名父字符样式的字距而读手继承**（ODT 字符间距读侧第二笔账 e12 对 e13）：同一批 P16 三臂在门面那头全读 `0:1069`（`ABSENT` 臂读 `1.5` 的词数=0），
      而读手把 174 枚没有自己字面的 span 涂成父层的 `1.5pt` ⇒ 两头在「具名父字符样式继不继承」这一层相反；字族字号字色同吃这条梯子，改它是换继承模型而不是补一枚漏
- [ ] **`style:default-style` 那层的字符间距两头各读什么没并排**（ODT 字符间距读侧第二笔账 e10/e11）：原件那一层六枚里带 `style:name` 的枚=0 而读手的表按名建 ⇒ 永远不可达，
      而 Word 在 P15 那批把同一层的 `1.5pt` 落了 1013 枚词（读手在同一件上 0 枚）⇒ 上一节那枚「整层不可达」在字符间距这一族有了具体读数，接它要连字体字号一起接
- [ ] **批注正文里的字符属性整批不进屏**（ODT 字符间距读侧第二笔账 e20）：真件里「族对且被 span 直接引」的 5 枚 `normal` 父链逐枚穿过 `office:annotation`，
      而读手按「不收 annotation 的孩子」那条老规矩不把批注正文走进行内渲染 ⇒ 两头值袋全同（本笔在真件上 no-op 的第二重原因）；接它就是「批注正文也吃字符样式」那笔设计账
- [ ] **读进 `normal` 而写出 `0pt` 的字节形状差没裁**（ODT 字符间距读侧第二笔账 e18）：往返腿自证整圈里 `normal` 字面一寸没出现而 `0pt` 活过整圈，
      两头在 Word 门面与浏览器屏上确实折成同一个数（`e2h`：`normal`/`0pt`/`0px`/裸 `0` 四档同宽），但外部写手与 ODF 规格看那是两种字面；要不要原样写回 `normal` 属于形状保真那一族
- [ ] **门面第一批对 `normal` 没有独立判据**（ODT 字符间距读侧第二笔账 e3）：同一载体件的 `NORM`/`ZERO`/`ABSENT` 三臂值袋全同，只有把祖先档补上（P15 那批）才分得开
      ⇒ 这一档的判据腿必须固定带一枚「祖先进账」的臂，换一枚祖先层不进账的载体就会重新变成裁不出；校准臂（`CAL15`）在场时三臂同数才不是尺瞎
- [ ] **`em` 那一档仍落不进读侧**（从「`em` 与 `normal` 两档落不进读侧」拆出的另一半）：`0.2em` 被 `lenPx` 与 `toLetterSpacingPt` 双双拒收 ⇒ 读成「没声明」；
      要接得先定 `em` 的底数取段落自己的字号还是样式那一份（与段落读侧第一笔账那枚 `charPx` 是同一件事），而这批真件里 `em` 零枚
- [ ] **ODF 裸数那一档门面整臂读 0 而我们按 cm 进账**（ODT 长度 mm 档第一笔账 `ARMBARE`）：规格说裸数是 cm，我们把 `10` 折成 283.5px 而 Word 门面
      同臂 `indent=0.0 sb=0.0`（与「整枚不写」那一臂 `ARMNONE` 读数相同）⇒ 两头对「写了而没单位」的裁定相反；改它要么把裸数归入「没说」要么照门面丢弃，
      而 `lenPx` 的 terminal 正被 `cm` 那档吃着（`v4` 量出改它会连 `cm` 一起动），所以这一档的取舍不能顺手夹在 mm 那一轮里
- [ ] **`odfBorderCss` 的 mm 枝没有第三头判据**（同上一笔账 裁定五）：`ARDBM`/`ARDBC` 两臂 Word 报 `borderLeft=off`（段落左边框没启用）⇒ 门面这一族
      整族不进账，提交件把 0.5mm 从 14.175 改成 1.417 只有 ODF 规格 + 夹具两头撑着；要第三头得换载体（表格格边框或 `fo:border` 写在能启用的那一层）
- [ ] **真件里 A 类那 85 枚 mm 字面住三种载体，接不接是设计账**（同上一笔账 `e4`）：`graphic-properties` 57 / `list-level-label-alignment` 20 /
      `page-layout-properties` 8——属性名对得上而元素不在查问表上；页布局那一族今天吃 `cm2mm` 那把尺（上一节 12 枚的归因；页面块第一笔账量出它在 `cm`/`mm`/`in`/裸数四档同值而 `pt`/`px`/`pc`/`em`/`ex`/`%` 全拒收；其中 pt/px/pc 三档已由 ODT 页面长度单位第一笔账接住（77 枚件从 75 有账走到 77 有账而正文一字不丢）而 em/ex/% 仍不收，那两件（tdf116195、unreferenced_stream）现在有账），另两族要不要长度进屏没定
- [ ] **`len2px` 把 0 当「没说」而 `lenPx` 落 `0px`，那 4 枚 `0mm` 正卡在两把尺的分界上**（同上一笔账 `e4` 的 D 桶）：同一枚「显式写了 0」在行高/缩进那一族
      读成未声明而在边距那一族读成 0px；`0` 是不是真值这条纪律本轮在字符间距那两笔账里已按「在场而非非零」立过，长度这一族还没统一
- [ ] **`fo:font-size` 自带的 3.78 与本轮的 3.7795 并存没并档**（同上一笔账 `e6` 的 `char_font_size` 臂）：同一枚 `3mm` 走字号那一枝落 11px 而其余十臂走
      `lenPx`，三头同读数说明它没被本轮改到；把两处系数并成一枚常数是一件事而给字号配 mm 判据是另一件事，先各自记着
- [ ] **mm 这一档自家写手零出现 ⇒ 本轮修复在自家往返里自证不了**（同上一笔账 `e8b`）：六件 375 枚长度字面 `cm:249 pt:96 %:6 in:6` 而 mm 枚=0（反控制注入
      两枚后尺数出 2 枚 ⇒ 不是尺瞎）⇒ 往返腿只能证「写侧没退化」，mm 的判据永远只有外部件一头；要不要让写侧在 mm 源单位上发 mm 属于形状保真那一族
- [x] **`cm2mm` 不收 pt/px/pc/em/ex/% ⇒ 两件真件的页账整枚进不了账**（ODT 页面块第一笔账 `f3`/`h5b`）：`tdf116195` 九枚属性块、`unreferenced_stream` 一枚的字面全 pt（432/648、595.3/841.89pt），
      门面那头它们有账（152.4×228.6mm 与 210.01×297mm）而我们的尺把它们整族拒收；`f6` 的 124 枚档里 pt 有 10 枚。接它是给 `cm2mm` 补档还是让页面族改吃 `lenPx`，两头的判据形状不同（`lenPx` 不收 cm 之外的写法不同）——已由 ODT 页面长度单位第一笔账闭：只给 `cm2mm` 补三枝而不让页面族改吃 `lenPx`（候选B 会连改 `cm`/`mm`/裸数三档，`g3` 量出来之后否掉），em/ex/% 另开
- [ ] **`"` 后缀在 `cm2mm` 的正则里在场而换算没给档**（同上一笔账 `f3` 的 `inchquote` 档）：`2"` 折成 20mm 而不是 50.8mm（倍数 0.394，页面族两臂同读数）；真件里 `"` 档 0 枚（`f1b` 六臂），而门面那一臂（`f4d` QT）报的是 7.2pt 的退化页
      ⇒ 两头都不对而形状不同，接它前先定「Word 把带引号的英寸读成退化页」算不算这一族的判据
- [ ] **页面族显式 0 被 `n <= 0` 读成「没说」**（同上一笔账 `commit/odt.ts` 那三行；上一轮未勾那枚「`len2px` 把 0 当没说而 `lenPx` 落 `0px`」的范围其实是三把尺）：`cm2mm` 在 `Number.isFinite` 之后立的是 `n <= 0`，而字符间距那两笔账已按「在场而非非零」立过纪律
      ⇒ 「0 是不是真值」这条纪律在 `lenPx`/`len2px`/`cm2mm` 三把尺上还没统一，而真件里页面族问位上的显式 0 已扫过（`g8`：35 枚，单位分布 cm 29 / pt 5 / in 1，住 13 枚件）⇒ 两把尺在这一档同按「没说」处理，而门面对 ZERO 臂给的是 `[7.2,7.2,0,0,0,0]`
- [ ] **多枚 master-page 只取文档序第一枚，首页/奇偶页那一层未接**（同上一笔账 `f7`/`f12`）：真件 15 枚件有多枚 master-page（`tdf116195` 一件 10 枚、`tdf167774` 一件 11 枚），引名里出现 `First_20_Page`、`Left_20_Page`/`Right_20_Page`、`Index`、`Endnote`、`Envelope` 那一族
      而我们只有一条 `master` ⇒ 一张纸；`h5` 里 `V_back`/`V_fwd` 两臂 `secs=2` 而宽高边距仍合 ⇒ 这一层的后果在门面这一族还没暴露出来，接它等于换页面模型
- [ ] **两枚门面距差指向页眉页脚/首页另版那一层进 Word 的页账而不进我们的**（同上一笔账 `h5`）：`tdf167774` bottom 门面 29.99mm 而我们 20mm（−9.99）；`tdf41542_borderlessPadding` 门面 `orient=1` 而距差 top/bottom=−11.42、left/right=−5.08；同一臂的宽高都合
      ⇒ 差只出现在边距那一层；先量「页眉高度/页脚高度/首页边距」在 ODF 里写在哪一枚（`style:header-footer-properties` 与 `fo:margin-*` 的分配）再决定接不接
- [ ] **同一枚「裸数」在不同载体上门面裁出两种数 ⇒ 上一轮 `ARMBARE` 那笔取舍不能跨载体搬**（同上一笔账 `f4c`/`f4d` vs 上一节 `ARMBARE`）：页面族 BARE 臂门面读 7.2/7.2/90/90（退化页）而缩进族整臂读 0；我们的 `cm2mm` 把裸数按 cm 进账（`f3` 四档同值 50.8mm；同一族里带空格的 `15.24 cm` 那一档现尺与提交件都按 cm 收而门面给退化页，`g7` SPACE 臂差 149.86mm ⇒ 空格档与裸数档在门面上同袋）
      而真件查问位裸数 0 枚（`f1b` 六臂 裸=0；全属性名裸数底数 5,647 枚，`f1`）⇒ 这一档在页面上同样是「夹具能造而件里没有」
- [ ] **自家写手只发一枚属性块 ⇒「取哪一枚」在自家往返里自证不了**（同上一笔账 `h6`）：5 件写回的部件里 `plp枚=1`、`master=["Standard->pm1"]`，六枚全 cm 三位小数；三臂跨六份读手页账与部件字节全同（`h4`）
      ⇒ 与上一轮 mm 零档同形状：往返腿只能证「写侧没退化」，取枚的判据永远只有外部件一头；要不要让写侧写出首页/奇偶页多枚 master-page 属于页面模型那一族的事
- [ ] **`fdo47267-3` 那一臂 Word 报 THREW ⇒ 页面族门面判据是 15/16 臂**（同上一笔账 `h5`）：门面对那枚件回「文件可能已经损坏」，本臂不进合裁；这枚件在自家读手与 `f12b` 两头都有账（A4 而四边 6.5/15.5/28.4/8.8）
      另 `frame_svg_width|cm2mm@1422` 那六档「无出口」（`f13` 汇总格，全住同一臂）还没并进这一族的账——图框那一枝的出口与页面那一枝不是同一条
- [ ] **`em`/`ex`/`%` 三档仍不进 `cm2mm` 而门面对它们只给一枚退化页 ⇒ 这一族没有第三头判据**（ODT 页面长度单位第一笔账 `g7`/`g11`）：候选A 不收的 11 臂里 `EM`/`EX`/`PCT` 三臂门面读
      `[7.2,7.2,90,90,72,72]`（与 BARE/COMMA/DOTS/PS/QT/SPACE 同袋）⇒ 门面既没说「收」也没给一个能对齐的值，接它只能按 ODF 规格定底数（`em` 的底数在页面上取谁的字号）
- [ ] **px 与 pc 两枝在真件页面族问位上 0 枚 ⇒ 本轮那两枝的判据只有夹具一头**（同上一笔账 `g1`/`g8`）：普查给出页族榜 `{cm, in, pt, mm}`
      而 `px`/`pc` 枚=0，夹具 29 臂与三头表撑着它们；要不要等一枚真带 `fo:page-width="816px"` 的件，还是按规格直接算定，是同一件事的两半
- [ ] **`lenPx` 与 `cm2mm` 的单位榜并成一档没做（`pc` 只有页面族吃）**（同上一笔账 `g0`/`g8`）：同一份文档里 `fo:margin-top` 在段落层走 `lenPx`（收
      `cm|mm|in|"|pt|px` 而拒 `pc`）而在页面层走 `cm2mm`（本轮起收 `pc`）⇒ 一枚 `1pc` 在两种载体上一个进账一个「没说」；两把尺的单位榜要不要共用一份表先定口径
- [ ] **`DEFAULT_COL_GAP = 8mm ± 0.6` 那道门会把错系数读成「整枚没账」**（同上一笔账 `g11` 的 `colgap_px` 在 `m3` 下）：23px 被写错的枝折成 8.12mm
      正落在默认值带里而被当成「没说」，同枚变异在 `frame_px` 臂上照报 31px ⇒ 凡靠「落没落」判的腿都会放过这一族，判据得打值袋；`style:distance` 那一枚同门而本轮 0 枚
- [ ] **size 归进 A4/Letter 那一档之后 w/h 不再落账 ⇒ 往返写回的纸尺寸来自档位默认而不是件里那一枚**（同上一笔账 `g4`/`g10`）：`unreferenced_stream`
      的 595.3pt 折成 210.0mm 被 `near()` 认进 A4（基座 75 有账→提交件 77 全有账里的一条），提交件页账是 `size=A4 w=undefined h=undefined` ⇒ 那 0.005mm 的差被抹平而没量过
- [ ] **`cm` 折 mm 的 ×10 与 `lenPx` 那套 px→mm 并存，同一物理宽度差 0.003mm**（同上一笔账 `g3` 的候选B 那一列）：`21.59cm` 在 `cm2mm` 下精确 215.9
      而在「先折 px 再折 mm」那条路上是 215.897；本轮选前者是因为候选B 会连改四档，但两把尺今天对同一枚 `cm` 给两个数，并档是一件事而换算口径是另一件
- [ ] **负长度那一档两把尺都拒而门面给出一枚怪页**（同上一笔账 `g7` 的 NEG/NEGPT 两臂）：`-15.24cm` 与 `-432pt` 门面都读
      `[1584.05,-648,0,0,72,72]`（页宽翻成 1584.05pt 而页高吃负值、左右边距归零）⇒ 我们的 `n <= 0` 把它们整枚挡掉，这一档要不要照门面进账没定而真件问位上负数 3 枚（`g4b`，住 `table-properties`）

- [ ] macOS 打包（需签名/公证凭据）

## License

本项目代码 MIT；各内核组件遵循上表各自许可证。
