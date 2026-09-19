import type { DomDocument, DomElement } from './dom'

/**
 * 页面特征提取 —— 内容脚本的第一段（DESIGN 3.4）。
 *
 * 输入是页面，输出是**纯数据**：每个可交互字段有哪些文案线索
 * （label / aria / placeholder / name / id）、是什么类型、是否必填。
 * 「这些线索说明该填什么」是 plan 层（heuristics + catalog）的事 ——
 * 拆开的理由：本层对 HTML 语义负责，plan 层对档案负责，各自的断言
 * 各有各的造假方式，混在一起谁也说不清是谁的锅。
 */

/** 提取层认得的字段类型。`file` / `checkbox` 保留在特征里但不可填（见 plan）。 */
export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'month'
  | 'select'
  | 'radio'
  | 'textarea'
  | 'file'
  | 'checkbox'

const INPUT_KINDS: Readonly<Record<string, FieldKind>> = Object.freeze({
  text: 'text',
  email: 'email',
  tel: 'tel',
  url: 'url',
  number: 'number',
  date: 'date',
  month: 'month',
  file: 'file',
  checkbox: 'checkbox',
})

/** 提取阶段直接丢弃的 input 类型 —— 不是字段，是控件或不可见状态。 */
const SKIP_INPUT_KINDS: ReadonlySet<string> = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
])

export interface SelectOption {
  readonly value: string
  readonly text: string
}

export interface FieldFeature {
  /**
   * 字段唯一标识：id 优先，退到 name，再退到 `#N`（DOM 序号）。
   * plan / 预览 UI / ground truth 断言都靠它寻址。
   */
  readonly key: string
  readonly kind: FieldKind
  readonly required: boolean
  /**
   * 文案线索，优先级降序：label[for] → 包裹式 label → aria-labelledby →
   * aria-label。空文案（含纯符号）已剔除。
   */
  readonly labels: readonly string[]
  readonly name: string | null
  readonly id: string | null
  readonly placeholder: string | null
  /** select / radio 组专有：value 与文本分开 —— 匹配用文本，回填用 value。 */
  readonly options: readonly SelectOption[] | null
}

/**
 * 从页面提取全部字段特征，保持 DOM 顺序。
 *
 * radio 组（T5.2）：同 name 的多个 radio 合成**一个**带 options 的特征，
 * 在第一个成员的 DOM 位置出现 —— 用户面对的是一道单选题，
 * 不是 N 个控件；组内后续成员不再单独产出特征。
 */
export function extractFieldFeatures(doc: DomDocument): readonly FieldFeature[] {
  const features: FieldFeature[] = []
  const seenKeys = new Map<string, number>()
  const emittedRadioGroups = new Set<string>()

  const elements = doc.querySelectorAll('input, textarea, select')
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]
    if (element === undefined) continue // noUncheckedIndexedAccess：索引访问的窄化
    const feature = isRadioInput(element)
      ? radioGroupFeature(element, doc, emittedRadioGroups)
      : featureFor(element, doc, index)
    if (feature === null) continue

    // key 冲突只可能来自「无 id 也无 name」的兜底序号或重复 id 的坏 HTML。
    // 确定性消歧：同 key 第二次出现加 `~2`、第三次加 `~3`。
    const count = seenKeys.get(feature.key) ?? 0
    seenKeys.set(feature.key, count + 1)
    const key = count === 0 ? feature.key : `${feature.key}~${count + 1}`
    features.push({ ...feature, key })
  }

  return features
}

function isRadioInput(element: DomElement): boolean {
  return (
    element.tagName.toUpperCase() === 'INPUT' &&
    (element.getAttribute('type') ?? '').toLowerCase() === 'radio'
  )
}

/**
 * radio 组特征：由第一个成员代表全组。
 *
 * - key / name = 组的 name 属性（组身份；无 name 的 radio 是坏 HTML，
 *   逐个丢弃 —— 与旧版「不提取」时的行为一致）；
 * - options = 各成员的选项文案（label[for] 或包裹式 label，**不含**
 *   aria —— aria 指向的是题干不是选项），文案缺失时落回成员 value；
 * - labels（题干）= 成员上的 aria-label / aria-labelledby 文案去重。
 *   fieldset/legend 分组语义不在 DomElement 的最小接口里，站点若
 *   只用 legend 出题干，本层看不见 —— 这是已声明的提取缺口，
 *   不是启发式的错；适配器选择器或 aria 化的站点不受影响。
 * - required = 任一（未禁用）成员的 required / aria-required / 题干 `*`。
 */
function radioGroupFeature(
  firstMember: DomElement,
  doc: DomDocument,
  emitted: Set<string>,
): FieldFeature | null {
  const name = firstMember.getAttribute('name')
  if (name === null) return null
  if (emitted.has(name)) return null // 组内后续成员：已被第一个成员代表
  emitted.add(name)

  const members = doc.querySelectorAll(`input[type="radio"][name="${cssEscape(name)}"]`)
  const options: SelectOption[] = []
  const headingTexts = new Set<string>()
  /** `pushText` 的 Set 版：radio 组的题干来自多个成员，需要去重。 */
  const pushHeading = (raw: string | null): void => {
    if (raw === null) return
    const text = raw.trim()
    if (text !== '') headingTexts.add(text)
  }
  let required = false

  for (const member of members) {
    if (member.getAttribute('disabled') !== null) continue
    if (
      member.getAttribute('required') !== null ||
      member.getAttribute('aria-required') === 'true'
    ) {
      required = true
    }

    const value = member.getAttribute('value') ?? ''
    const labelText = widgetLabelText(member, doc)
    const optionText = labelText !== '' ? labelText : value
    if (optionText !== '') options.push({ value, text: optionText })

    pushHeading(member.getAttribute('aria-label'))
    const labelledBy = member.getAttribute('aria-labelledby')
    if (labelledBy !== null) {
      for (const refId of labelledBy.split(/\s+/)) {
        const ref = doc.getElementById(refId)
        if (ref !== null) pushHeading(ref.textContent)
      }
    }
  }

  return {
    key: name,
    kind: 'radio',
    required:
      required || [...headingTexts].some((text) => text.includes('*')),
    labels: [...headingTexts],
    name,
    id: null,
    placeholder: null,
    options,
  }
}

/**
 * 选项文案（radio 成员）：label[for=id] 或包裹式 label 的文本。
 * 刻意不含 aria —— 成员的 aria-label / aria-labelledby 是**题干**，
 * 混进选项会让「男 / 女」变成「性别 / 性别」。
 */
function widgetLabelText(member: DomElement, doc: DomDocument): string {
  const id = member.getAttribute('id')
  if (id !== null) {
    for (const label of doc.querySelectorAll(`label[for="${cssEscape(id)}"]`)) {
      const text = label.textContent.trim()
      if (text !== '') return text
    }
  }

  let ancestor = member.parentElement
  for (let depth = 0; ancestor !== null && depth < 4; depth += 1) {
    if (ancestor.tagName.toUpperCase() === 'LABEL') {
      const text = ancestor.textContent.trim()
      if (text !== '') return text
      break
    }
    ancestor = ancestor.parentElement
  }

  return ''
}

/** 单个元素的特征提取；返回 null = 不是用户要填的字段（hidden/submit/…）。 */
function featureFor(
  element: DomElement,
  doc: DomDocument,
  domIndex: number,
): FieldFeature | null {
  const tagName = element.tagName.toUpperCase()
  const attr = (name: string): string | null => {
    const value = element.getAttribute(name)
    return value === null || value === '' ? null : value
  }

  let kind: FieldKind
  let id = attr('id')
  let name = attr('name')

  if (tagName === 'TEXTAREA') {
    kind = 'textarea'
  } else if (tagName === 'SELECT') {
    kind = 'select'
  } else if (tagName === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase()
    if (SKIP_INPUT_KINDS.has(type)) return null
    const mapped = INPUT_KINDS[type]
    if (mapped === undefined) return null // 未知类型宁可不提，不猜（radio 走 radioGroupFeature）
    kind = mapped
  } else {
    return null
  }

  if (element.getAttribute('disabled') !== null) return null

  const labels = collectLabels(element, doc, id)

  // 必填的三种信号里实现两种（DESIGN 11.2 例外条款）：required 属性、
  // aria-required、标签里的 `*`。红色边框样式依赖 computed style，
  // 结构接口拿不到 —— 那是内容脚本接缝的职责，留下的缺口写在了 plan 注释里。
  const required =
    element.getAttribute('required') !== null ||
    element.getAttribute('aria-required') === 'true' ||
    labels.some((text) => text.includes('*'))

  return {
    key: id ?? name ?? `#${domIndex}`,
    kind,
    required,
    labels,
    name,
    id,
    placeholder: attr('placeholder'),
    options: kind === 'select' ? collectOptions(element) : null,
  }
}

/** 文案线索按优先级收集；`*` 保留在文本里（required 判定要用），匹配时再剥。 */
function collectLabels(
  element: DomElement,
  doc: DomDocument,
  id: string | null,
): string[] {
  const texts: string[] = []

  if (id !== null) {
    for (const label of doc.querySelectorAll(`label[for="${cssEscape(id)}"]`)) {
      pushText(texts, label.textContent)
    }
  }

  // 包裹式 label：最近的 LABEL 祖先。
  let ancestor = element.parentElement
  for (let depth = 0; ancestor !== null && depth < 4; depth += 1) {
    if (ancestor.tagName.toUpperCase() === 'LABEL') {
      pushText(texts, ancestor.textContent)
      break
    }
    ancestor = ancestor.parentElement
  }

  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy !== null) {
    for (const refId of labelledBy.split(/\s+/)) {
      const ref = doc.getElementById(refId)
      if (ref !== null) pushText(texts, ref.textContent)
    }
  }

  pushText(texts, element.getAttribute('aria-label'))

  return texts
}

/** select 的选项：value 缺省时落回选项文本（DOM 的 value 规则）。 */
function collectOptions(select: DomElement): SelectOption[] {
  const options: SelectOption[] = []
  for (const option of select.querySelectorAll('option')) {
    const text = option.textContent.trim()
    if (text === '') continue
    const value = option.getAttribute('value') ?? text
    options.push({ value, text })
  }
  return options
}

function pushText(texts: string[], raw: string | null): void {
  if (raw === null) return
  const text = raw.trim()
  if (text !== '') texts.push(text)
}

/**
 * CSS 属性选择器里的值的转义。fixture 与真实站点都用无害 id，
 * 但 `label[for="..."]` 的值直接拼进选择器，遇到引号就是注入点 ——
 * 不赌上游，统一转义。CSSOM 的 `CSS.escape` 在 `lib: ["ES2023"]` 下
 * 不存在（零 DOM 类型），这里手写最小版：反斜杠与引号前加反斜杠。
 */
function cssEscape(value: string): string {
  return value.replace(/[\\"]/g, '\\$&')
}
