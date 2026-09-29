/**
 * 用户可见的失败归因：把「一串只有写代码的人才懂的原始信息」翻成一句用户能照着办事的中文。
 *
 * 两条纪律（都不是本轮新立的）：
 * - 文案只写在这一处（先例 v0.54「纸上账目的文案只写一处」）。四个编辑器与首页只调 failText /
 *   failDialog，不各自拼句子，否则同一件事在表格上叫「被占用」、在文档上叫「拒绝访问」就分叉了。
 * - 认不出来的**原样带出，不编原因**（先例 v0.45 的更新通道）。猜错原因比不说更糟：用户会照着一个
 *   不存在的理由去折腾。
 *
 * 下面每一条判据都是本轮在真机上量出来的原串（探针见 tmp/x64，README 的 v0.64 一节列了读数），
 * 不是按「通常长这样」写的。两个实测结论改变了当初的设想：
 * 1. Windows 那一层**本机已经是中文**（「拒绝访问。 (os error 5)」「另一个程序正在使用此文件，
 *    进程无法访问。 (os error 32)」），所以真正看不懂的只有第三方库那几档（calamine / zip /
 *    cfb / JSZip / pdf.js / JSON.parse）；
 * 2. **路径过长报的是 os error 3**（「系统找不到指定的路径」）而不是专门的"文件名太长"错误——
 *    所以 error 3 那句话必须把"太长"也带上，只说"目录不存在"会把人引去建目录。
 */

/** 一条规则：命中判据 + 交给用户的那句话 */
interface Rule {
  /** 原始信息（已转小写、已把 Error 的 name 也拼进来供匹配） */
  hit: (probe: string) => boolean
  say: string
}

/** 归因表按"具体在前"排：先按第三方库的专属词形命中，落到后面的才是 os error 编号这类通用尾巴 */
const RULES: Rule[] = [
  {
    // rust zip 8.6 与 JSZip 的"这根本不是 zip 包"两种写法（同一种失败，两家各说各的）
    hit: (s) => s.includes('could not find eocd') || s.includes("can't find end of central directory"),
    say: '这个文件里找不到压缩包的目录。xlsx/ods/docx/pptx 这类办公文件本质都是一个 zip 包，所以多半是：后缀被手动改过、下载或传输时截断了，或者它本来就是别的格式。',
  },
  {
    // calamine 按文件魔数嗅探（.csv 我们自己在它前面分流，所以到这里的一定是它认不出的）
    hit: (s) => s.includes('cannot detect file format'),
    say: '按后缀这该是 Excel/ODF 的文件，但里面的内容不是它们中的任何一种（把一个纯文本文件改名成 .xlsx 就会得到这一条）。',
  },
  {
    hit: (s) => s.includes('cfb error') || s.includes('not an office document'),
    say: '后缀是 .xls（老版 Excel 的复合文档格式），而里面不是那种结构。新版 .xlsx 是 zip 包，改名成 .xls 就会读成这一条——把后缀改回真实格式即可。',
  },
  {
    // JSON.parse 的原串带"Unexpected token"与"is not valid JSON"两段，取后者（前者在别的运行时写法不同）
    hit: (s) => s.includes('is not valid json'),
    say: 'OpenOffices 自己的 .odoc/.opd 里面就是一段 JSON，而这段不是合法 JSON：文件被截断过，或被别的程序按同名改写过。这类文件不适合拿到外部编辑器里另存。',
  },
  {
    // pdf.js 的两个专属档：结构不合 / 设了口令
    hit: (s) => s.includes('invalid pdf structure'),
    say: '这份 PDF 的结构读不出（文件损坏，或其实不是标准 PDF）。可以用别的工具重新导出或另存一份。',
  },
  {
    hit: (s) => s.includes('no password given') || s.includes('passwordexception'),
    say: '这份 PDF 设了打开密码，而我们的查看器还没有输密码的地方。要在这里看，得先在别处把密码去掉。',
  },
  {
    hit: (s) => s.includes('os error 32'),
    say: '这个文件正被别的程序占用（最常见的情况是它还开着在 Excel/WPS 里）。关掉那边再存一次。',
  },
  {
    // 实测：拒绝访问、只读文件、目标是文件夹，三种都归到这一条
    hit: (s) => s.includes('os error 5'),
    say: '这个位置不让写：可能是没有权限（比如往系统目录里存）、文件被设成了只读，或者那个路径其实是个文件夹。',
  },
  {
    hit: (s) => s.includes('os error 2'),
    say: '这个文件已经不在了（可能被移动、改名或删除）。',
  },
  {
    hit: (s) => s.includes('os error 3'),
    say: '这个路径走不通：要么中间某个文件夹不存在，要么路径太长（Windows 一般限 260 个字符，报错不会专门说"太长"）。',
  },
  {
    // 我们自己写侧的前置检查（ods.rs）：它只报了"不存在"，没说"我们不会替你建"
    hit: (s) => s.includes('目录不存在'),
    say: '保存位置里的这个文件夹不存在，而我们不会自动新建目录。先在文件管理器里建好它，或者换一个已有的文件夹。',
  },
]

/** Error → 可匹配的串：把 name 也带上，pdf.js 那类只靠 name 分类的才有得匹配 */
function probeOf(err: unknown): string {
  if (err instanceof Error) return `${err.name} ${err.message}`.toLowerCase()
  return String(err).toLowerCase()
}

/** 原始信息（永远照实），供状态栏的悬停提示与 console */
export function failRaw(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface Failure {
  /** 交给用户的那句话：已知档是中文归因，未知档就是原话 */
  text: string
  /** 原话（已知档也留着，诊断时不能丢） */
  raw: string
  /** 有没有归因上——本轮的判据用它来"不许凭空造句子"，调用方一般不需要 */
  known: boolean
}

export function describeFailure(err: unknown): Failure {
  const raw = failRaw(err)
  const probe = probeOf(err)
  for (const r of RULES) {
    if (r.hit(probe)) return { text: r.say, raw, known: true }
  }
  return { text: raw, raw, known: false }
}

/** 状态栏用：只出一句中文（未知档原样带出），行短、不吞掉后面的账目 */
export function failText(err: unknown): string {
  return describeFailure(err).text
}

/**
 * 弹窗用：中文一句 + 原话。原生对话框装得下两行，而"原话"是用户提 issue 时唯一能贴给我们的东西；
 * 归因没命中时就不重复一遍（同一段话出现两次只会让人以为有两个不同的原因）。
 */
export function failDialog(err: unknown): string {
  const f = describeFailure(err)
  return f.known ? `${f.text}\n\n（原始信息：${f.raw}）` : f.raw
}

/**
 * 状态栏用的一条：可见那一行是中文归因，换行后面挂原话（悬停看得到，但不占满本就很窄的一行）。
 * 之所以要塞进同一个字符串：状态栏只有 `status` 一枚字符串，为"悬停能看原话"再给四个编辑器各加一份
 * 状态，就会多出一条"文字与提示不同步"的新分叉（说了 A 却悬停出 B）。
 */
export function failStatus(err: unknown, prefix = '失败'): string {
  const f = describeFailure(err)
  return f.known ? `${prefix}: ${f.text}\n${f.raw}` : `${prefix}: ${f.raw}`
}

/** 状态栏显示的那一行（账目类文案不带换行，原样通过） */
export function statusText(status: string): string {
  const i = status.indexOf('\n')
  return i < 0 ? status : status.slice(0, i)
}

/** 状态栏的悬停提示：没有第二行就没有提示 */
export function statusTip(status: string): string {
  const i = status.indexOf('\n')
  return i < 0 ? '' : status.slice(i + 1)
}
