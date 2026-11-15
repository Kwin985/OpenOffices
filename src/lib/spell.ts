// 拼写检查（v0.132）
//
// 分两档，两档的**可信度**不一样，UI 上也不该画成同一种线：
//
//   确认档（误报为零）：规则 + 常见错词表。只认表上那些确凿的错，代价是漏报。
//     typo   —— 常见错词表（英汉各一张），给得出建议
//     repeat —— 重复字词（「的的」这类）与任意汉字的三连
//     pair   —— 中文语境里成对出现的错字（「帐号→账号」这类同音/形近误用）
//
//   疑似档（有误报，默认关）：英文全量词典（27.4 万词，来自 `word-list`）。
//     unknown —— 词典里没有这个词。人名、品牌、术语会被划上，所以要单独开关、
//                一键加进"我的词典"，而且**默认不开**。
//
// 中文没有走词典：中文的"错字"要先分词再拿语言模型判，缺了这两样就只能靠表，
// 拿一个几千词的词表硬当词典的代价是满屏误报。这一层的中文做的是**重复词组**这一条零误报规则。

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export type SpellKind = 'typo' | 'repeat' | 'pair' | 'unknown' | 'punct'

export interface SpellIssue {
  from: number
  to: number
  /** 命中的原文（划波浪线的那一段） */
  text: string
  kind: SpellKind
  /** 建议改成的写法；没有好建议就空着，UI 不该编一个 */
  suggest: string
  /** 说给用户的那一句：为什么这一段被判有问题 */
  note: string
}

/** 英文常见错拼 → 正确写法。只收确凿的：方言缩写、口语、专有名词一概不进表 */
const EN_TYPO: Record<string, string> = {
  teh: 'the', hte: 'the', ths: 'this',
  tihs: 'this', taht: 'that', thta: 'that',
  nad: 'and', adn: 'and', nda: 'and',
  tehcnical: 'technical', recieve: 'receive', recieved: 'received',
  reciever: 'receiver', seperate: 'separate', seprate: 'separate',
  seperated: 'separated', occured: 'occurred', occurence: 'occurrence',
  occassion: 'occasion', definately: 'definitely', definatly: 'definitely',
  definate: 'definite', accomodate: 'accommodate', acommodate: 'accommodate',
  wich: 'which', whcih: 'which', wiht: 'with',
  whith: 'with', becuase: 'because', becasue: 'because',
  beacuse: 'because', untill: 'until', untilll: 'until',
  sucessful: 'successful', sucess: 'success', successfull: 'successful',
  neccessary: 'necessary', neccesary: 'necessary',
  acheive: 'achieve', acheivement: 'achievement', acheived: 'achieved',
  beleive: 'believe', beleiveve: 'believe', calender: 'calendar',
  calander: 'calendar', collegue: 'colleague', collegate: 'colleague',
  enviroment: 'environment', enviromental: 'environmental', goverment: 'government',
  govenment: 'government', independant: 'independent', maintainance: 'maintenance',
  maintanance: 'maintenance', managment: 'management', manageement: 'management',
  refered: 'referred', referal: 'referral', relevent: 'relevant',
  relevently: 'relevantly', temperture: 'temperature', temprature: 'temperature',
  tommorow: 'tomorrow', tommorrow: 'tomorrow', tomorow: 'tomorrow',
  wether: 'whether', wierd: 'weird', freind: 'friend',
  freinds: 'friends', lenght: 'length', heigth: 'height',
  widht: 'width', adress: 'address', adresss: 'address',
  begining: 'beginning', beginnin: 'beginning', busness: 'business',
  buisness: 'business', busines: 'business', cemetary: 'cemetery',
  changable: 'changeable', comming: 'coming', commited: 'committed',
  experment: 'experiment', extreem: 'extreme', familar: 'familiar',
  finaly: 'finally', foward: 'forward', gaurd: 'guard',
  greatful: 'grateful', harrass: 'harass', humourous: 'humorous',
  immidiately: 'immediately', immediatly: 'immediately', joyfull: 'joyful',
  knwo: 'know', knw: 'know', liason: 'liaison',
  libary: 'library', lisense: 'license', mispell: 'misspell',
  mispellings: 'misspellings', noticable: 'noticeable', nucular: 'nuclear',
  ommision: 'omission', ommited: 'omitted', peculure: 'peculiar',
  persistant: 'persistent', posession: 'possession', priviledge: 'privilege',
  pronounciation: 'pronunciation', publically: 'publicly', quater: 'quarter',
  realy: 'really', reciept: 'receipt', recomend: 'recommend',
  resistence: 'resistance', sence: 'sense', similer: 'similar',
  sincerly: 'sincerely', speach: 'speech', suprise: 'surprise',
  suprised: 'surprised', tendancy: 'tendency', therefor: 'therefore',
  truely: 'truly', twelth: 'twelfth', usefull: 'useful',
  vaccuum: 'vacuum', vegtable: 'vegetable', writting: 'writing',
  writen: 'written', yeild: 'yield', youghurt: 'yoghurt',
  accessable: 'accessible', alot: 'a lot', amoung: 'among',
  aranged: 'arranged', assocation: 'association', bizzare: 'bizarre',
  camoflage: 'camouflage', concensus: 'consensus', contians: 'contains',
  dissapear: 'disappear', dissapoint: 'disappoint', embarass: 'embarrass',
  equiptment: 'equipment', foriegn: 'foreign', fourty: 'forty',
  glimps: 'glimpse', hight: 'height', instalation: 'installation',
  irrestible: 'irresistible', knowlege: 'knowledge', lastr: 'last',
  millenium: 'millennium', miniscule: 'minuscule', neice: 'niece',
  noticible: 'noticeable', ocassion: 'occasion', pavillion: 'pavilion',
  perseverence: 'perseverance', questionaire: 'questionnaire', restarant: 'restaurant',
  sieze: 'seize', supercede: 'supersede', threshhold: 'threshold',
  twelveth: 'twelfth', unforseen: 'unforeseen', upholstry: 'upholstery',
}

/** 中文常见错写 → 正确写法。只收同音/形近造成的固定误用，不收有争议的异形词 */
const ZH_TYPO: Record<string, string> = {
  按装: '安装', 报消: '报销', 必需要: '必须要',
  不勉: '不免', 成份: '成分',
  穿流不息: '川流不息', 带替: '代替',
  耽心: '担心', 地址薄: '地址簿', 渡假: '度假',
  防碍: '妨碍', 份量: '分量', 服合: '符合',
  复盖: '覆盖', 干予: '干预', 各别: '个别',
  跟据: '根据', 关健: '关键', 好象: '好像',
  化装品: '化妆品', 欢渡: '欢度', 汇根: '汇总',
  即然: '既然', 既使: '即使', 家俱: '家具',
  坚苦: '艰苦', 交代待: '交代', 桔子: '橘子',
  决对: '绝对', 开使: '开始', 苦脑: '苦恼',
  蓝球: '篮球', 立既: '立即', 联连: '连接',
  另售: '零售', 罗卜: '萝卜', 满州: '满洲',
  免强: '勉强', 年青: '年轻', 排泻: '排泄',
  凭介: '凭借', 其它: '其他', 汽球: '气球',
  前题: '前提', 亲蜜: '亲密', 全愈: '痊愈',
  认请: '认清', 沙摊: '沙滩',
  身分: '身份', 水蒸汽: '水蒸气', 松驰: '松弛',
  趟水: '蹚水', 提昌: '提倡', 停辛: '停薪',
  完强: '顽强', 唯护: '维护', 无耐: '无奈',
  西爪: '西瓜', 先躯: '先驱', 相辅相承: '相辅相成',
  泻露: '泄露', 渲然大波: '轩然大波', 寻问: '询问',
  压仰: '压抑', 严历: '严厉', 一愁莫展: '一筹莫展',
  一柱香: '一炷香', 遗误: '贻误', 荧火虫: '萤火虫',
  尤如: '犹如', 有持无恐: '有恃无恐',
  原素: '元素', 再接再励: '再接再厉', 沾污: '玷污',
  帐蓬: '帐篷', 帐号: '账号', 震奋: '振奋',
  直接了当: '直截了当', 至使: '致使',
  专研: '钻研', 装钉: '装订', 姿式: '姿势',
  自悲: '自卑', 做为: '作为', 坐阵: '坐镇',
  作出了: '做出了',
}

/** 重复字：只有这几枚单字的二连是真错；「常常」「试试」这类叠词是合法的，不能进表 */
const REPEAT_OK = new Set(['常', '试', '看', '想', '说', '走', '吃', '高', '大', '小', '多', '好'])
const REPEAT_HARD = new Set(['的', '了', '是', '和', '在', '我', '你', '他', '们', '吗', '呢', '吧'])

const USER_DICT_KEY = 'openoffices.spell.ignored'

function loadIgnored(): Set<string> {
  try {
    const raw = localStorage.getItem(USER_DICT_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set<string>(arr.map(String)) : new Set()
  } catch {
    // localStorage 不可用（隐私模式 / 配额满）不该让检查开不起来，只是记不住
    return new Set()
  }
}

let ignored = loadIgnored()

export function spellIgnored(): string[] {
  return [...ignored]
}

/** 加进"我的词典"：下次起不再划这一处 */
export function spellIgnore(text: string): void {
  if (!text) return
  ignored.add(text)
  persist()
}

export function spellUnignore(text: string): void {
  if (ignored.delete(text)) persist()
}

function persist(): void {
  try {
    localStorage.setItem(USER_DICT_KEY, JSON.stringify([...ignored].slice(0, 2000)))
  } catch {
    /* 存不下就算了：这一版的词典是会话级的，不影响判定 */
  }
}

// ───────────────── 英文全量词典（疑似档，默认关）─────────────────
//
// 词表来自 `word-list`（27.4 万词），2.8MB 文本放在 public 下按需 fetch——
// 打进 bundle 会让首屏多下 2.8MB，而这一档默认根本不开。

export type DictState = 'off' | 'loading' | 'ready' | 'failed'

let dictState: DictState = 'off'
let dict: Set<string> | null = null
let dictSize = 0
const dictListeners = new Set<() => void>()

export function spellDictState(): DictState {
  return dictState
}

export function spellDictSize(): number {
  return dictSize
}

/** 词典状态变了要通知 UI（加载中→就绪这一跳界面上得看得见） */
export function onSpellDictChange(fn: () => void): () => void {
  dictListeners.add(fn)
  return () => {
    dictListeners.delete(fn)
  }
}

function emitDict(): void {
  for (const f of dictListeners) f()
}

const DICT_URL = 'dict/en-words.txt'

/** 只下一次：拉过就复用，重复开关不重复付 2.8MB */
export async function loadSpellDict(): Promise<DictState> {
  if (dictState === 'ready' || dictState === 'loading') return dictState
  dictState = 'loading'
  emitDict()
  try {
    const res = await fetch(new URL(DICT_URL, document.baseURI))
    if (!res.ok) throw new Error(String(res.status))
    const text = await res.text()
    const set = new Set<string>()
    for (const line of text.split('\n')) {
      const w = line.trim()
      if (w.length >= 2) set.add(w)
    }
    dict = set
    dictSize = set.size
    dictState = 'ready'
  } catch {
    // 拉不到（离线 / 资产没打进去）不该让编辑器卡住：这一档关掉，其余判定照常
    dict = null
    dictSize = 0
    dictState = 'failed'
  }
  emitDict()
  return dictState
}

/** 疑似档的总开关。与 `loadSpellDict` 分开：开关不该隐式触发下载 */
let deepOn = false

export function spellDeepOn(): boolean {
  return deepOn && dictState === 'ready'
}

export function setSpellDeep(on: boolean): void {
  deepOn = on
}

/** 「辅+元+辅」结尾、且末辅音不是 w/x/y：这类词加 -ed/-ing 时要双写末辅音。
 *  没有这条判据，occured→occur、begining→begin 都能还原成功，这两类最常见的错拼就漏掉了 */
function needsDoubling(base: string): boolean {
  if (base.length < 3) return false
  const m = base.match(/([^aeiou])([aeiou])([^aeiou])$/)
  if (!m) return false
  return !/[wxy]/.test(m[3])
}

/** 一个词的可能原形：复数/时态/比较级/-ly 都还原一遍再查，否则 walked、boxes 都会被划成错词 */
function stemsOf(w: string): string[] {
  const out = new Set<string>([w])
  const push = (x: string) => {
    if (x.length >= 2) out.add(x)
  }
  if (w.endsWith('ies')) {
    push(w.slice(0, -3) + 'y')
    push(w.slice(0, -3))
  } else if (w.endsWith('ves')) {
    push(w.slice(0, -3) + 'f')
    push(w.slice(0, -3) + 'fe')
  } else if (w.endsWith('es')) {
    push(w.slice(0, -2))
    push(w.slice(0, -1))
  } else if (w.endsWith('s') && !w.endsWith('ss')) {
    push(w.slice(0, -1))
  }
  if (w.endsWith('ed')) {
    const base = w.slice(0, -2)
    if (/([^aeiou])\1ed$/.test(w)) push(w.slice(0, -3)) // stopped → stop
    // 单写那一档要过 CVC 检查：occur 的正确过去式是 occurred，所以 occured 不能还原成 occur，
    // 否则这条最常见的双写类错拼会被当成好词放过去
    if (!needsDoubling(base)) push(base)
    push(w.slice(0, -1))
  }
  if (w.endsWith('ing')) {
    const base = w.slice(0, -3)
    if (/([^aeiou])\1ing$/.test(w)) push(w.slice(0, -4)) // running → run
    if (!needsDoubling(base)) push(base)
    push(base + 'e') // making → make
  }
  if (w.endsWith('ily')) push(w.slice(0, -3) + 'y') // happily → happy
  if (w.endsWith('ly')) push(w.slice(0, -2))
  if (w.endsWith('er')) {
    push(w.slice(0, -2))
    push(w.slice(0, -1))
    if (/([^aeiou])\1er$/.test(w)) push(w.slice(0, -3))
  }
  if (w.endsWith('est')) {
    push(w.slice(0, -3))
    push(w.slice(0, -2))
    if (/([^aeiou])\1est$/.test(w)) push(w.slice(0, -4))
  }
  return [...out]
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'

/** 两个词有多像。同一批候选里靠它定先后：首字母相同、长度相同、公共前后缀长、字母重合多 */
function likeness(a: string, b: string): number {
  let n = 0
  if (a[0] === b[0]) n += 3 // 首字母按错的概率远低于后面
  if (a.length === b.length) n += 2
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  n += p * 1.5
  let q = 0
  while (q < a.length && q < b.length && a[a.length - 1 - q] === b[b.length - 1 - q]) q++
  n += q * 1.6
  // 字母集合的重合（顺序错了但字母对：recieve/receive 这一路）
  const cnt = new Map<string, number>()
  for (const ch of a) cnt.set(ch, (cnt.get(ch) ?? 0) + 1)
  let same = 0
  for (const ch of b) {
    const k = cnt.get(ch) ?? 0
    if (k > 0) {
      same++
      cnt.set(ch, k - 1)
    }
  }
  return n + same * 0.5
}

/**
 * 编辑距离 1 的候选里挑一个真词。
 *
 * 关键在于**按错因分类**：teh→the、becuase→because、lenght→length 都是相邻两键打反（换位），
 * 而"替换"一类动辄生成 26×n 个候选，里面总有真词（teh 的替换候选里有 feh，
 * becuase 的替换候选里有 becurse）。不分类就按生成顺序取第一个，等于随机给建议。
 * 所以换位优先、替换次之、增删最后，同一类里再按 `likeness` 排。
 */
function suggest1(w: string): string {
  if (!dict) return ''
  const cands: { v: string; score: number }[] = []
  const seen = new Set<string>([w])
  const add = (v: string, score: number) => {
    if (seen.has(v) || !dict!.has(v)) return
    seen.add(v)
    cands.push({ v, score })
  }
  for (let i = 0; i + 1 < w.length; i++)
    add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), 100)
  // 多按了一次同一个键（untill→until、writting→writing）：这类不在"换位"里，
  // 得单独成一类且给高一点的份，否则会被"替换"那一堆候选里的 untile 抢掉
  for (let i = 0; i + 1 < w.length; i++)
    if (w[i] === w[i + 1]) add(w.slice(0, i) + w.slice(i + 1), 90)
  for (let i = 0; i < w.length; i++)
    for (const c of LETTERS) add(w.slice(0, i) + c + w.slice(i + 1), 50)
  for (let i = 0; i < w.length; i++) if (w.length > 3) add(w.slice(0, i) + w.slice(i + 1), 40) // 删除：多打了一个
  for (let i = 0; i <= w.length; i++)
    for (const c of LETTERS) add(w.slice(0, i) + c + w.slice(i), 45) // 插入：少打了一个
  if (!cands.length) {
    // 差两个字（tommorow→tomorrow 就是这一类）：先删一个再做一次距离 1，
    // 仍然按 likeness 取最像的，不然会给出 moron 这种
    let best = ''
    let bestScore = -1
    if (w.length <= 14) {
      for (let i = 0; i < w.length; i++) {
        const del = w.slice(0, i) + w.slice(i + 1)
        if (del.length < 3) continue
        const s2 = suggest1(del)
        if (!s2) continue
        const sc = likeness(w, s2)
        if (sc > bestScore) {
          bestScore = sc
          best = s2
        }
      }
    }
    return best
  }
  let best = cands[0]
  let bestScore = -1
  for (const c of cands) {
    const sc = c.score + likeness(w, c.v)
    if (sc > bestScore) {
      bestScore = sc
      best = c
    }
  }
  return best.v
}

/** 词典判定。三不判：两个字母以内、带数字的型号、全大写缩写（USA / PDF / NASA）。
 *  大写词只在**句首**照查——句中首字母大写基本都是人名、地名、月份、品牌（Tuesday、Microsoft），
 *  词表是纯小写的，照查就是满屏误报；句首那枚才是普通词，漏了它反而可惜 */
function dictUnknown(word: string, atSentenceStart: boolean): { suggest: string } | null {
  if (!dict) return null
  const lower = word.toLowerCase()
  if (lower.length < 3) return null
  if (/[0-9]/.test(lower)) return null
  if (/^[A-Z]+$/.test(word)) return null
  if (/[A-Z]/.test(word.slice(1))) return null // JavaScript / iPhone / ProseMirror
  if (/^[A-Z]/.test(word) && !atSentenceStart) return null
  if (ignored.has(lower)) return null
  for (const s of stemsOf(lower)) if (dict.has(s)) return null
  return { suggest: suggest1(lower) }
}

/** 一段文本块里的候选词：连续的英文串，或长度 ≥2 的连续汉字串（按 8 字切窗找错写） */
function* tokensOf(s: string): Generator<{ start: number; end: number; word: string }> {
  let i = 0
  while (i < s.length) {
    const c = s[i]
    // 英文串
    if (/[A-Za-z]/.test(c)) {
      let j = i
      while (j < s.length && /[A-Za-z']/.test(s[j])) j++
      const word = s.slice(i, j)
      if (j - i >= 2) yield { start: i, end: j, word }
      i = j
      continue
    }
    // 汉字串
    if (/[㐀-鿿]/.test(c)) {
      let j = i
      while (j < s.length && /[㐀-鿿]/.test(s[j])) j++
      const run = s.slice(i, j)
      // 错写表最长 4 字，按窗口从长到短试，命中即整段标出
      const maxLen = 4
      let k = 0
      while (k < run.length) {
        let hitLen = 0
        for (let len = Math.min(maxLen, run.length - k); len >= 2; len--) {
          const w = run.substr(k, len)
          if (ZH_TYPO[w] && !ignored.has(w)) {
            yield { start: i + k, end: i + k + len, word: w }
            hitLen = len
            break
          }
        }
        k += hitLen || 1
        // 命中整段前进，避免 3/4 字错写被后续窗口重复切片；未命中逐字推进
      }
      i = j
      continue
    }
    i++
  }
}

/** 单个文本块内的扫描结果（偏移是**块内**偏移，由 collectSpellIssues 换算成文档位置） */
function scanBlock(s: string, out: { start: number; end: number; kind: SpellKind; suggest: string; note: string }[]) {
  // 1. 英文错拼
  for (const t of tokensOf(s)) {
    if (!/^[A-Za-z']+$/.test(t.word)) continue
    const lower = t.word.toLowerCase()
    if (ignored.has(lower)) continue
    const fix = EN_TYPO[lower]
    if (fix) {
      out.push({
        start: t.start,
        end: t.end,
        kind: 'typo',
        // 首字母大写就跟着大写，别把句首的 Teh 改成小写 the
        suggest: /^[A-Z]/.test(t.word) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix,
        note: `常见错拼，通常写作「${fix}」`,
      })
      continue
    }
    // 疑似档：词典里没有。这一档会把人名、品牌、术语一起划上，所以默认不开，
    // 而且 note 里明说"可能是专有名词"，给用户一个一键加词典的出口
    if (spellDeepOn()) {
      const prev = t.start > 0 ? s[t.start - 1] : ''
      const atSentenceStart =
        t.start === 0 ||
        /[.!?。！？…"“‘'([{]/.test(prev) ||
        (/\s/.test(prev) && t.start >= 2 && /[.!?。！？]/.test(s[t.start - 2]))
      const u = dictUnknown(t.word, atSentenceStart)
      if (u) {
        out.push({
          start: t.start,
          end: t.end,
          kind: 'unknown',
          suggest: /^[A-Z]/.test(t.word)
            ? u.suggest.charAt(0).toUpperCase() + u.suggest.slice(1)
            : u.suggest,
          note: u.suggest
            ? `不在英文词典里（${(dictSize / 10000).toFixed(1)} 万词），最接近的是「${u.suggest}」`
            : `不在英文词典里（${(dictSize / 10000).toFixed(1)} 万词）；人名、品牌、术语请加进我的词典`,
        })
      }
    }
  }
  // 2. 中文错写（tokensOf 已把命中按最长优先切出来）
  for (const t of tokensOf(s)) {
    if (/^[A-Za-z']+$/.test(t.word)) continue
    const fix = ZH_TYPO[t.word]
    if (fix) {
      out.push({
        start: t.start,
        end: t.end,
        kind: 'pair',
        suggest: fix,
        note: `常见误用，通常写作「${fix}」`,
      })
    }
  }
  // 3. 重复字：硬错字表的二连，加任意汉字的三连
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i]
    if (a !== s[i + 1]) continue
    if (!/[㐀-鿿]/.test(a)) continue
    const triple = i + 2 < s.length && s[i + 2] === a
    if (triple) {
      out.push({ start: i, end: i + 3, kind: 'repeat', suggest: a, note: `「${a}」连写了三次` })
      i += 2
      continue
    }
    if (REPEAT_HARD.has(a) && !REPEAT_OK.has(a) && !ignored.has(a + a)) {
      out.push({ start: i, end: i + 2, kind: 'repeat', suggest: a, note: `「${a}${a}」重复了` })
      i += 1
    }
  }
  // 5. 中文语境里的半角标点：「你好,世界」这一路的误用。零误报，所以进确认档：
  //    前一字必须是汉字，后一字必须是汉字或行尾——「3.14」「etc.」「A, B」都不会命中
  const HALF2FULL: Record<string, string> = {
    ',': '，', '.': '。', ';': '；', ':': '：', '?': '？', '!': '！',
  }
  for (let i = 0; i < s.length; i++) {
    const full = HALF2FULL[s[i]]
    if (!full) continue
    if (i > 0 && !/[㐀-鿿]/.test(s[i - 1])) continue
    const next = i + 1 < s.length ? s[i + 1] : ''
    if (next && !/[㐀-鿿]/.test(next)) continue
    if (ignored.has(s[i])) continue
    out.push({
      start: i,
      end: i + 1,
      kind: 'punct',
      suggest: full,
      note: `中文里的半角「${s[i]}」，通常写作「${full}」`,
    })
  }
  // 4. 中文词组重复（只在疑似档开）：「这个这个」「因为因为」这类连写两遍。
  //    汉语的动词重叠式（研究研究、讨论讨论）长得一模一样，所以这一条**不能**进零误报档
  if (spellDeepOn()) {
    for (let len = 4; len >= 2; len--) {
      for (let i = 0; i + len * 2 <= s.length; i++) {
        const a = s.substr(i, len)
        if (!/^[㐀-鿿]+$/.test(a)) continue
        if (a !== s.substr(i + len, len)) continue
        if (ignored.has(a)) continue
        // 已被"重复字"标过的区间不再标一遍
        if (out.some((o) => o.start < i + len * 2 && o.end > i)) continue
        out.push({
          start: i,
          end: i + len * 2,
          kind: 'repeat',
          suggest: a,
          note: `「${a}」连着写了两遍；「研究研究」这类动词重叠是合法的，误报就加进我的词典`,
        })
        i += len * 2 - 1
      }
    }
  }
}

/** 整文档命中上限：与查找/替换同一条理由——超大文档每事务全量重算会拖垮输入手感 */
export const SPELL_CAP = 1200

/**
 * 扫整篇文档。跨 mark 可命中（与查找/替换同一套 run 拼接），跨段不命中。
 */
export function collectSpellIssues(doc: PMNode): { issues: SpellIssue[]; truncated: boolean } {
  const out: SpellIssue[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return out.length <= SPELL_CAP
    const runs: { start: number; end: number; docFrom: number }[] = []
    let full = ''
    node.descendants((c, cpos) => {
      if (!c.isText) return false
      const len = c.text?.length ?? 0
      runs.push({ start: full.length, end: full.length + len, docFrom: pos + 1 + cpos })
      full += c.text ?? ''
      return false
    })
    if (!runs.length || !full) return out.length <= SPELL_CAP
    const hits: { start: number; end: number; kind: SpellKind; suggest: string; note: string }[] = []
    scanBlock(full, hits)
    for (const h of hits) {
      let from = -1
      let to = -1
      for (const r of runs) {
        if (from < 0 && h.start >= r.start && h.start < r.end) from = r.docFrom + (h.start - r.start)
        if (from >= 0 && h.end > r.start && h.end <= r.end) {
          to = r.docFrom + (h.end - r.start)
          break
        }
      }
      if (from >= 0 && to > from) {
        out.push({ from, to, text: full.slice(h.start, h.end), kind: h.kind, suggest: h.suggest, note: h.note })
      }
      if (out.length > SPELL_CAP) break
    }
    return out.length <= SPELL_CAP
  })
  const truncated = out.length > SPELL_CAP
  return { issues: truncated ? out.slice(0, SPELL_CAP) : out, truncated }
}

interface SpellState {
  on: boolean
  issues: SpellIssue[]
  truncated: boolean
}

export const spellPluginKey = new PluginKey<SpellState>('spellCheck')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    spellCheck: {
      setSpellCheck: (on: boolean) => ReturnType
      /** 把这段加进"我的词典"并重扫（重扫是必要的：否则划着的线要等下一次输入才消） */
      ignoreSpell: (text: string) => ReturnType
      /** 词典档开关之后要重扫：开关本身不产生事务，不重扫界面上就不变 */
      rescanSpell: () => ReturnType
    }
  }
}

export const SpellCheck = Extension.create({
  name: 'spellCheck',

  addProseMirrorPlugins() {
    return [
      new Plugin<SpellState>({
        key: spellPluginKey,
        state: {
          init: () => ({ on: false, issues: [], truncated: false }),
          apply: (tr, prev) => {
            const meta = tr.getMeta(spellPluginKey) as { on?: boolean; rescan?: boolean } | undefined
            if (meta && typeof meta.on === 'boolean')
              return { ...collectSpellIssues(tr.doc), on: meta.on }
            if (!prev.on) return prev
            if (meta?.rescan || tr.docChanged)
              return { ...collectSpellIssues(tr.doc), on: true }
            return prev
          },
        },
        props: {
          decorations(state: EditorState) {
            const s = spellPluginKey.getState(state)
            if (!s || !s.on || !s.issues.length) return DecorationSet.create(state.doc, [])
            return DecorationSet.create(
              state.doc,
              s.issues.map((i) =>
                Decoration.inline(i.from, i.to, { class: `oo-spell oo-spell-${i.kind}` }),
              ),
            )
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setSpellCheck:
        (on) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(spellPluginKey, { on })
          return true
        },
      ignoreSpell:
        (text) =>
        ({ tr, dispatch }) => {
          spellIgnore(text.toLowerCase())
          if (dispatch) tr.setMeta(spellPluginKey, { rescan: true })
          return true
        },
      rescanSpell:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(spellPluginKey, { rescan: true })
          return true
        },
    }
  },
})
