/**
 * PDF AcroForm 表单：读侧归类（纯函数，可在 node 侧直接测）+ pdf-lib 写回。
 *
 * 读侧走 pdf.js 的逐页注解扫描（widget 就是 /Subtype=Widget 的注解，getAnnotations 会把
 * 字段名/类型/值/选项一并解出来）——这与标注读取同一条增量通道，不为表单多付一次全量解析；
 * 写侧走 pdf-lib 的 PDFForm（getForm() 一直在依赖树里）：按全限定名找到字段，值赋进去。
 * 两边的名字都是 AcroForm 全限定名（A.B.C），按名对接，不需要别的桥。
 */
import type { PdfRect, Rot } from './pdf-geo'
import { toDisplayRect } from './pdf-geo'

export type FormFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature'

export interface FormOption {
  /** 导出值：写回文件里存的是它 */
  v: string
  /** 显示值：界面上给人看的是它（没设 displayValue 时与 v 相同） */
  label: string
}

/** 一个 widget = 字段在某一页上的一块可点区域（同一字段可以跨页多块，radio 组每格一块） */
export interface FormWidget {
  /** AcroForm 全限定名：写回时按它找 pdf-lib 的字段 */
  name: string
  type: FormFieldType
  page: number
  /** 显示空间（已按 /Rotate 旋转、左上原点、1x pt） */
  rect: PdfRect
  /** checkbox: 是否勾中；radio: 该格是否为组内选中格；文本: 字符串；选择: 导出值（多选为数组） */
  value: string | boolean | string[]
  /** checkbox/radio 的导出值（写回 select() 与勾选判断都用它） */
  onValue?: string
  options?: FormOption[]
  readOnly: boolean
  multiline?: boolean
  maxLen?: number
}

export type RawAnno = {
  subtype?: string
  rect?: number[]
  fieldName?: unknown
  fieldType?: unknown
  fieldValue?: unknown
  buttonValue?: unknown
  options?: unknown
  readOnly?: unknown
  hidden?: unknown
  multiLine?: unknown
  maxLen?: unknown
  /** pdf.js 对按钮域（Ff 位 17）给的这个标志：按钮没有可填的值，不渲染屏幕编辑件 */
  pushButton?: unknown
}

// —— 字节 ↔ base64（图章图片在内存里以 dataURL 存，写回时解出字节交给 pdf-lib embed）——

/** 大数组分块转 base64（一次 String.fromCharCode(...args) 有栈上限） */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

/** dataURL → 字节（头与载荷分开给：mime 判断 png/jpeg 用） */
export function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) return null
  const bin = atob(m[2])
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return { mime: m[1], bytes: out }
}

const FIELD_TYPES: Record<string, FormFieldType> = {
  Tx: 'text',
  Btn: 'checkbox', // checkbox / radio 由上层按组内格数判定后改写
  Ch: 'dropdown', // 下拉 / 列表由 options 数量与多选标志判定后改写
  Sig: 'signature',
}

/**
 * pdf.js 的 widget 注解 → FormWidget。rect 是「未旋转 + 左下原点」，
 * 与标注同一条换算（pdf-geo）。读不出字段名/尺寸的丢弃；隐藏的不给渲染。
 */
export function widgetFromAnnotation(a: RawAnno, page: number, rot: Rot, base: { w: number; h: number }): FormWidget | null {
  if (a.subtype !== 'Widget' || !Array.isArray(a.rect) || a.rect.length < 4) return null
  const name = typeof a.fieldName === 'string' ? a.fieldName : ''
  if (!name) return null
  // 按钮（pushbutton）没有值可填，渲染出来只会误导
  if (a.pushButton === true) return null
  const type = FIELD_TYPES[typeof a.fieldType === 'string' ? a.fieldType : '']
  if (!type || type === 'button') return null
  const [x1, y1, x2, y2] = a.rect
  const rect = toDisplayRect({ x: x1, y: base.h - y2, w: x2 - x1, h: y2 - y1 }, rot, base)
  let value: string | boolean | string[] = false
  let onValue: string | undefined
  let options: FormOption[] | undefined
  if (type === 'text' || type === 'signature') {
    value = typeof a.fieldValue === 'string' ? a.fieldValue : ''
  } else if (type === 'checkbox') {
    const on = typeof a.buttonValue === 'string' && a.buttonValue ? a.buttonValue : 'Yes'
    onValue = on
    // pdf.js 对 checkbox 的 fieldValue：选中时是导出值（或 true），没选是 'Off'/false/null
    value = a.fieldValue === true || a.fieldValue === on
  } else {
    // Btn 的 radio： fieldValue 是组当前选中导出值；Ch：字符串或多选时的数组
    value =
      typeof a.fieldValue === 'string'
        ? a.fieldValue
        : Array.isArray(a.fieldValue)
          ? a.fieldValue.filter((x): x is string => typeof x === 'string')
          : ''
    if (Array.isArray(a.options)) {
      options = a.options
        .map((o) => {
          if (typeof o === 'string') return { v: o, label: o }
          const rec = o as { exportValue?: unknown; displayValue?: unknown }
          const v = typeof rec.exportValue === 'string' ? rec.exportValue : ''
          const label = typeof rec.displayValue === 'string' && rec.displayValue ? rec.displayValue : v
          return v ? { v, label } : null
        })
        .filter((o): o is FormOption => !!o)
    }
    if (a.buttonValue != null && a.buttonValue !== false && typeof a.buttonValue === 'string') {
      onValue = a.buttonValue
      value = a.fieldValue === a.buttonValue
    }
  }
  return {
    name,
    type,
    page,
    rect,
    value,
    onValue,
    options,
    readOnly: a.readOnly === true,
    multiline: a.multiLine === true,
    maxLen: typeof a.maxLen === 'number' ? a.maxLen : undefined,
  }
}

/**
 * 一页的原始 widget 列表 → 归类：radio 组（同名多格）每格独立、type 改 radio；
 * Ch 且多选 → list。其余按格给出。
 */
export function groupWidgets(raw: FormWidget[]): FormWidget[] {
  const byName = new Map<string, FormWidget[]>()
  for (const w of raw) {
    const list = byName.get(w.name)
    if (list) list.push(w)
    else byName.set(w.name, [w])
  }
  const out: FormWidget[] = []
  for (const widgets of byName.values()) {
    if (widgets.length > 1 && widgets[0].type === 'checkbox') {
      // 同名多格的 Btn 是 radio 组（checkbox 只有一格；pdf.js 对每格都发 widget，buttonValue 各不相同）
      for (const w of widgets) out.push({ ...w, type: 'radio' })
    } else if (widgets.length === 1 && widgets[0].type === 'dropdown' && Array.isArray(widgets[0].value)) {
      out.push({ ...widgets[0], type: 'list' })
    } else {
      out.push(...widgets)
    }
  }
  return out.sort((a, b) => a.page - b.page || a.rect.y - b.rect.y)
}

// —— 写回（pdf-lib）——

/** 写回账里一条失败的原因 */
export interface ApplyNote {
  name: string
  why: string
}

type PdfLibField = {
  getName: () => string
  setText?: (t: string | undefined) => void
  check?: () => void
  uncheck?: () => void
  select?: (o: string | string[]) => void
}

/**
 * 把改过的值写进 pdf-lib 的 PDFField。只写 touched 里点过名的字段——文件里本来的值
 * pdf.js 读出来的未必全（密码框、富文本），不点名的字段一个字节都不动。
 * 单字段失败只记一条账，不让整趟保存失败。
 */
export function applyFormValues(form: { getFields: () => PdfLibField[] }, touched: Record<string, unknown>): ApplyNote[] {
  const notes: ApplyNote[] = []
  const byName = new Map(form.getFields().map((f) => [f.getName(), f]))
  for (const [name, v] of Object.entries(touched)) {
    const f = byName.get(name)
    if (!f) {
      notes.push({ name, why: '字段在文件里找不到了' })
      continue
    }
    try {
      // 分发按值类型走、每种类型认自己的出口：布尔→勾选；字符串→有 setText 的是文本字段，
      // 否则试 select（radio/下拉的选中值也是字符串）；数组→多选列表。
      // 字段类型不认值形状时记一条账，不让整趟保存失败
      if (typeof v === 'boolean') {
        if (!f.check || !f.uncheck) throw new Error('不是勾选类字段')
        v ? f.check() : f.uncheck()
      } else if (typeof v === 'string') {
        if (f.setText) f.setText(v === '' ? undefined : v)
        else if (f.select) f.select(v)
        else throw new Error('字段收不下这个值')
      } else if (Array.isArray(v)) {
        if (!f.select) throw new Error('不是选择类字段')
        f.select(v)
      }
    } catch (e) {
      notes.push({ name, why: e instanceof Error ? e.message : String(e) })
    }
  }
  return notes
}
