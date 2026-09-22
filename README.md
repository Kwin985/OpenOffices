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
- **本机产物链路**：`pnpm tauri build` 全量走通——release+lto 首编 4m54s，产物 NSIS 8.5MB /
  MSI 9.5MB；NSIS 静默安装→`%LOCALAPPDATA%\OpenOffices` 用户级免管理员→注册表 `.ods/.xlsx/
  .opd` 等 ProgId 与 `"%1"` 打开命令齐备→带文件参数启动真实出标签→静默卸载清理干净
- **修 MSI 打包阻塞 bug**：fileAssociations 的中文 `description` 会让 WiX light.exe 在
  en-US 代码页 1252 下报 LGHT0311（每个扩展名一条），关联描述须用 ASCII
- **修「点 X 无法退出」bug**（用户实报）：Tauri v2 关闭链路在 JS 确认后调 `plugin:window|destroy`，
  capabilities 缺 `core:window:allow-destroy` 时 ACL 拒绝、窗口静默卡死；dev 期全用强杀故未暴露。
  同期修正异步确认框时序：`preventDefault()` 必须同步调用、用户同意后再自行 `destroy()`，
  否则"未保存确认"形同虚设
- **后续发布项**：自动更新通道（私有仓库无公开 metadata URL，须先定公开或另托管）、macOS 打包

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
- **自动保存**：每 30 秒对已落盘的 `.odoc` 静默写回并清 dirty，工具栏显示「已自动保存 HH:MM:SS」；
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
| React 19 + Vite | UI 框架与构建 | MIT |

## 架构

```
src-tauri/            Rust 后端
  src/xlsx.rs         read_xlsx (calamine) / write_xlsx (rust_xlsxwriter) 命令，含样式、合并区、尺寸/字族、隐藏/冻结、公式（含缓存值）与图表往返；命令为 async + spawn_blocking（同步跑主线程会让窗口冻结），`.csv` 读侧分流到 csv.rs，图表网格按 has_charts 惰性构建
  src/csv.rs          CSV 往返：RFC4180 逐字符状态机（引号/转义/字段内换行）+ 分隔符嗅探（, ; 制表符）+ UTF-8 失败退 GBK 解码 + 写侧 BOM/CRLF，read_payload 供 read_xlsx 分流、write_csv 为独立命令
  src/xlsx_style.rs   zip + quick-xml 直读 xlsx 的 styles.xml（StyleBook：fonts/fills/borders/cellXfs/numFmts）/ mergeCells / col·row 尺寸（字符宽·pt→px）/ 隐藏行列 / 冻结 pane / 公式 `<f>`（GeneralRef 实体重建 + unescape，calamine 无样式/公式 API）
  src/xlsx_chart.rs   zip + quick-xml 直读 chartN.xml + drawing 锚点，系列值按实时网格解析；has_charts 只做 zip 文件名嗅探
  src/ods.rs          ODS 双向：write_ods（async 外壳 + write_ods_sync，共用 xlsx 载荷 → ODF zip，样式/尺寸去重与合并、冻结 settings.xml、公式 of:= 换算）+ read_ods_styles（直解边框/对齐/换行/列宽行高/字族/隐藏 collapse/重复单元格/合并跨度/公式 + settings.xml 冻结）
  src/pdf.rs          export_pdf 命令：with_webview → WebView2 PrintToPdf（四边距英寸四元组 + 纸张宽高/朝向，cfg windows）；file_len + read_range（raw IPC 返回 Vec<u8>，async + spawn_blocking，供大 PDF 分段读）
  src/lib.rs          OPEN_EXTS 与 argv 文件过滤纯函数、take_startup_files 命令、single-instance 文件转发
  capabilities/       dialog + fs 权限与路径作用域
src/                  React 前端
  store.ts            标签页 / 最近文件 / 主题（zustand）
  App.tsx             全局快捷键、拖拽打开、文件关联打开（启动 argv + 单实例转发）、关闭确认、懒加载路由
  lib/univer.ts       Univer 实例工厂（公式 worker + 六个社区预设，含绘图 FOverGridImage）
  lib/univer-io.ts    xlsx 数据+样式（粗斜/颜色/字族/边框/对齐/换行/数字格式）/合并/图表/列宽行高/隐藏行列/冻结窗格 ↔ Univer 快照 转换（样式去重注册）
  lib/chart.ts        ChartPayload → VChart spec → 离屏 canvas PNG dataURL（动态导入分包）
  lib/docx.ts         docx 导入导出（ProseMirror JSON ↔ docx，字色/字族/字号/高亮/页眉页脚/TOC 域/批注/页面设置 sectPr（纸张·四边距·w:cols 栏数栏距）/页码格式（PAGE·NUMPAGES）/分页符/表格合并映射（首行行级 tableHeader、列表 numbering.config 真编号）、单元格四边 `w:tcBorders`（**显式去边写 `w:val="nil"`**——none 压不住表级默认边框）、`w:shd` 底纹、`w:vAlign` 竖排、`w:tblInd` 表缩进、`w:vertAlign` 上下标）；文本节点兼容顶层 text 与 attrs.text；字节经 Packer.toBase64String + atob 取（toBuffer 走 jszip 的 nodebuffer 通道，浏览器里没有 Buffer））
  lib/ooxml.ts        迷你 OOXML XML 解析器（零依赖、不碰 DOM）：parseXml/find/findDesc/all/allL/attr/attrL/val/valNum/textOf + decodeEnt 实体表——让 docx 读侧能在 Node 里直测
  lib/docx-fidelity.ts OOXML → HTML 保真导入器（v0.37）：run 级 rPr（粗斜/删除线/下划线/字色/高亮/字族/字号/上下标 `w:vertAlign`）、段落 pPr（jc/`w:ind` 左右与首行悬挂四种缩进写法/pStyle 样式链）、numPr+numbering.xml → 有序无序与 ilvl 层级、表格 gridSpan/vMerge + tblGrid 列宽 + 单元格四边 `w:tcBorders`（含 val=nil 的显式去边）/底纹 `w:shd fill`/竖排 `w:vAlign`/表级 `w:tblInd`、图片 rels→dataURL、内外超链接、分页符、批注三态锚点、域代码文字不外泄；认不出就抛错或 blocks=0，调用方回退 mammoth
  lib/cell-style.ts  单元格样式扩展（v0.38）：tableCell/tableHeader 的 bdTop/bdRight/bdBottom/bdLeft + background + vAlign、table 的 marginLeft 全局属性（只声明属性不改内容模型）；边框统一规范串 `"0.67px solid #8899aa"`，三态 null 未声明/'none' 显式去边/有值；`inlineBorder()` 读 CSSOM longhand（shorthand 对 none 返回空串）、`IndentTableView` 子类补 marginLeft（resizable 的节点视图不传 HTMLAttributes）、`eighthsToPx`/`pxToEighths` 管 1/8 磅换算、命令 setCellBackground/setCellVAlign
  lib/indent-extension.ts 段落全局属性 indentLeft/indentFirst（32px 一档、上限 320px）+ setIndent/indent/outdent 命令 + Ctrl+] / Ctrl+[ + 悬挂缩进感知的出退格
  lib/toc-extension.ts TipTap 目录原子节点：按标题实时汇总、点击跳转
  lib/page-break-extension.ts TipTap pageBreak 原子块（`div[data-oo-pagebreak]`）+ insertPageBreak 命令 + Ctrl+Enter 快捷键
  lib/comment-extension.ts comment mark（cid 锚定批注）+ 加/删/定位/汇总工具
  lib/odt.ts          ProseMirror JSON ↔ ODT（JSZip 打包导出 + DOMParser 导入，字符样式（字族/字号/字色/上下标 `style:text-position`，落在 content.xml 自动样式）/合并表/图片尺寸/页码域与总页数/page-layout 页面设置（纸张·四边距·style:columns 多栏）/分页符 fo:break-before/单元格自动样式 `fo:border-*`（宽度写 pt，读回走 `odfBorderCss` 保留 0.67px 这类细线不整数取整）+`fo:background-color`+`style:vertical-align`、表级 `fo:margin-left`）
  lib/find-replace.ts 查找/替换 ProseMirror 插件：按文本块匹配存 state、装饰高亮、findNext/findPrev/replaceOne/replaceAll 命令（命中上限 FR_HIT_CAP=2000 截断并标 `N+`）
  lib/templates.ts    首页模板注册表与纯函数 seed：11 个模板（公文/会议纪要/周报 → ProseMirror JSON+meta，记账表/库存清单 → WorkbookPayload 含公式冻结，六套演示配色 → Deck）
  lib/ppt.ts          .opd 幻灯片数据模型（版式/主题/序列化）
  lib/pdfprint.ts     打印覆盖层：挂 DOM → 注入打印样式 → export_pdf → 清理
  lib/sheet-print.ts  WorkbookPayload → 打印 HTML 网格（值/边框/对齐/换行/数字格式/字族/合并/列宽行高/跳过隐藏行列/分页/截断）
  lib/pptx-export.ts  Deck → pptx（pptxgenjs）
  lib/pptx-import.ts  pptx → Deck（JSZip 解包 + OOXML 解析 + 媒体还原）
  lib/pdf-pages.ts    PDF 页面级操作（pdf-lib 覆盖写回）：rotatePagesInPlace / removePagesInPlace（倒序删 + 删空守卫）/ extractPages / mergePdfs / splitPdf，做完由调用方重载
  lib/pdf-geo.ts      显示空间（已套旋转·左上原点）↔ PDF 原始坐标（未旋转·左下原点）双向精确换算：normRot / displaySize / toDisplayRect / fromDisplayRect / toDisplayPoints / fromDisplayPoints + parsePageSpec（`1-3,5` 页码写法）
  lib/pdf-range.ts    大 PDF 分段读取：PDFDataRangeTransport 子类（≥4MB 才启用、64KB 文件头起手、按 begin 计数投递、abort 置 dead）+ fileSize/readRange，配 Rust 侧 file_len + read_range
  lib/editors.ts      动态 import 的唯一持有者：四类编辑器 + Workspace 外壳各自的「已解析组件表」（peekEditor/loadEditor、peekWorkspace/loadWorkspace），挂载点同步命中即不走 Suspense（v0.36）
  lib/prewarm.ts      首页空闲期预取外壳与编辑器 chunk（App 级，与 lib/editors.ts 共用同一模块 promise）：顺序为 Workspace 外壳 → 按最近文件类型的四个编辑器；实测无收益的实例级/worker 级预热与公式 worker 线程池已删除
  lib/registry.ts     跨组件保存器注册表（Ctrl+S 路由到当前标签）
  lib/open.ts         路径→标签 打开 / 带确认关闭
  lib/sync.ts         最近文件端到端加密同步（WebCrypto PBKDF2-SHA256 → AES-256-GCM，.oosync 信封）
  components/         Home（最近文件 + 从模板新建画廊） / Workspace / SheetEditor（保存按 .xlsx/.ods/.csv 三分流） / DocEditor（页面设置含分栏/页码格式、分页参考线、分页符、表格与图片上下文工具条、粘贴成图、查找替换面板、字体族·字号、缩进工具条与 Ctrl+]/[、上下标 X²/X₂、表格上下文条的底纹色与竖排对齐（上/中/下）、版本历史·自动保存、模板 seed、状态栏字数节流；打开 .docx 保真导入优先、mammoth 兜底，保存按 .odoc/.odt/.docx 各自格式原地落盘） / PptEditor / PdfViewer（pdfjs-dist 懒加载，连续多页视口虚拟渲染+Ctrl 缩放+TextLayer 文字选择+全文搜索+缩略图/大纲/标注侧栏+高亮便签与矩形·椭圆·直线·手绘形状（绘制/导入/写回 pdf-lib）+标注编辑（点选/拖移/改色/删除）+「页面」工作区旋转/删除/提取/合并/拆分；≥4MB 走分段读（lib/pdf-range.ts），卸载时 destroy openTask 并 abort transport））
scripts/              copy-pdfjs-assets.mjs（dev/build 前复制 cmaps/标准字体到 public/pdfjs）
.github/workflows/    release.yml——tag v* 触发：门禁→win/linux 矩阵打包→GitHub Release
```

表格文件流：`xlsx/ods 磁盘 → Rust(calamine 值 + xlsx/ods 各自 zip/quick-xml 直解样式·合并·尺寸·字族·隐藏·冻结·公式·图表) → JSON 快照 → Univer 渲染（图表经 VChart 出 PNG 浮动图片）`；CSV 走 `csv.rs` 状态机（UTF-8/GBK 自动）→ 单表载荷；保存按扩展名分流——`.xlsx` 经 `rust_xlsxwriter`（含原生图表部件）、`.ods` 经 `ods.rs` 生成 ODF 包、`.csv` 经 `csv.rs` 写 BOM + CRLF 文本（只存首表）。
文档文件流：`docx → lib/docx-fidelity.ts 直读 OOXML（w:rPr/w:pPr 直接格式 + numbering 层级 + 表格合并 + 图片 + 批注 + sectPr 页面设置）→ HTML/元数据 → TipTap`，
保真导入器抛错或拆不出块时回退 `mammoth 正文 + zip 直读页眉页脚/批注/sectPr`（v0.37）；`.odt` 走 `lib/odt.ts` 双向；
保存按标签扩展名分流——新建文档存 `.odoc` JSON（含 meta）、`.odt` 与 `.docx` 标签各自格式原地写回（导出走 docx/odt 链路）。
演示文件流：`pptx → JSZip 解包 OOXML → Deck 模型 → 编辑器`；保存为 `.opd` JSON 或经 pptxgenjs 导出 pptx。
PDF 文件流：查看 `pdf 磁盘 → 小于 4MB 整本 readBytes / 大于 4MB 经 file_len + read_range 分段喂给 pdf.js（首屏只取 64KB 文件头）→ pdfjs-dist（worker + canvas）`；标注 `选区高亮/便签/拖拽画的矩形·椭圆·直线·手绘 → 内存模型（rects[0] 包围盒 + polys 几何）→ Ctrl+S 时 pdf-lib 低层写 Annotation 字典回原文件`；文档导出 `@media print 排版（分栏/分页符/避免跨页折断）+ @page margin box 逐页页眉页脚页码 → Rust export_pdf（PrintSettings 纸张与四边距）→ WebView2 PrintToPdf 落盘`；演示导出 `Deck → createRoot 离屏挂载 StaticSlide 分页 → 同上`；表格导出 `Univer 快照 → WorkbookPayload → lib/sheet-print.ts 自绘 HTML 网格 → 同上（canvas 抓不到故走数据侧重排）`；页面管理 `内存标注先写回 → pdf-lib 旋转/删除/提取/合并/拆分覆盖写回 → 重载并从 /Annots 重新导入标注（旋转页坐标按 /Rotate 经 pdf-geo.ts 换算）`。

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
- [x] 表格：边框/对齐/数字格式 xlsx 往返 + ODS 读侧样式/合并 + PDF 打印保真
- [x] 表格二期：列宽/行高/字体族 xlsx+ODS 全链路往返（读→Univer→保存→PDF 打印）
- [x] 表格三期：隐藏行列 + 冻结窗格 xlsx+ODS 全链路往返（OOXML/collapse+settings → Univer → 打印跳过）
- [x] 表格四期：公式 xlsx+ODS 全链路往返（`<f>`/of:= 换算 + 缓存值，Univer 引擎重算）
- [x] 表格：图表（VChart 渲染 PNG + Univer 社区浮动图片 + xlsx 原生图表往返，Excel 实机确认）
- [x] 文档：页眉页脚（含 PAGE 页码域）与目录（原生 TOC 域）docx 往返，Word 实机回归
- [x] 文档：批注（锚点标记 + 侧栏面板 + docx comments 往返）
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
- [ ] 文档保真续项二：脚注/尾注、题注与交叉域（图表号/题注 SEQ）、文本框与 SmartArt、嵌入对象——当前各记一条"未保留"告警
- [ ] 自动更新通道（须先决策：公开仓库或独立托管 update metadata）
- [ ] macOS 打包（需签名/公证凭据）

## License

本项目代码 MIT；各内核组件遵循上表各自许可证。
