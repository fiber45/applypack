/**
 * T8.1 档案编辑器 —— 纯逻辑状态机：`clean / dirty / invalid` 三态互斥。
 *
 * ## 状态即 UI 契约（与 T7.2 面板同构）
 *
 * ```
 * clean ──(合法且≠已保存)──→ dirty ──(saveEditor)──→ clean
 *   │  └──────────(改回保存值)──────────┘
 *   └──(过不了 schema)──→ invalid（没有 archive 字段可取）
 * ```
 *
 * - **「错误状态与已保存状态互斥」不是渲染纪律**：`invalid` 分枝
 *   结构上没有 `archive`，`saveEditor` 只收 dirty —— 想把半成品存进
 *   密文库，类型与运行时两头都拦。
 * - **clean / dirty 的判定是逐字节比较**（`serializeArchive` 相等），
 *   不是「有输入就 dirty」—— 用户把值改回原样，状态应当干净地回到
 *   clean，而不是永远顶着「未保存」的狼来了。
 * - **校验零复写**：候选对象直接过 core 的严格 zod（未知字段报错），
 *   编辑器不比 schema 更宽容，也不比它更狭窄。
 */

import {
  archiveV1Schema,
  describeZodIssues,
  serializeArchive,
  type ArchiveV1,
} from '../../../../core/src/schema/index'

export type EditorState =
  | { readonly kind: 'clean'; readonly archive: ArchiveV1 }
  | { readonly kind: 'dirty'; readonly archive: ArchiveV1 }
  | {
      readonly kind: 'invalid'
      /** 原始表单内容 —— 供 UI 回显用户输错的东西，但它不是档案。 */
      readonly raw: unknown
      readonly issues: readonly string[]
    }

export type PersistArchive = (archive: ArchiveV1) => void

/** 起点即 clean：能传进来的档案必然过过 schema（它是 ArchiveV1）。 */
export function startEditor(archive: ArchiveV1): EditorState {
  return { kind: 'clean', archive }
}

/**
 * 表单内容候选 → 状态转移。
 *
 * - 过不了 schema → `invalid`（issues 来自 core 的 zod 描述，路径指到字段）；
 * - 合法且与已保存逐字节一致 → `clean`（改回原样 ≠ 未保存）；
 * - 合法但有变化 → `dirty`。
 */
export function editCandidate(saved: ArchiveV1, candidate: unknown): EditorState {
  const parsed = archiveV1Schema.safeParse(candidate)
  if (!parsed.success) {
    return { kind: 'invalid', raw: candidate, issues: describeZodIssues(parsed.error) }
  }
  const next = parsed.data as ArchiveV1
  if (serializeArchive(next) === serializeArchive(saved)) {
    return { kind: 'clean', archive: next }
  }
  return { kind: 'dirty', archive: next }
}

/**
 * 保存。只有 dirty 有东西可存：
 * - clean → no-op（没有变化就没有写盘 —— 假保存是骗人的仪式）；
 * - invalid → 抛错（这不该被调到：类型上 invalid 没有 archive）；
 * - dirty → 恰好一次持久化，回到 clean。
 */
export function saveEditor(state: EditorState, persist: PersistArchive): EditorState {
  if (state.kind === 'invalid') {
    throw new Error(
      'saveEditor：当前内容过不了 schema 校验 —— 只有 dirty 能保存，invalid 连档案都拿不出来',
    )
  }
  if (state.kind === 'clean') return state
  persist(state.archive)
  return { kind: 'clean', archive: state.archive }
}

// ---------------------------------------------------------------------------
// 全库编辑的结构算术（2026-09-20 扩展）。
//
// 引擎（匹配 / 渲染 / 自我介绍 / 填表）消费的是**全量档案**，而 T8.1 的
// 编辑器只露了 basics 五个字段 —— 用户建不出自己的「数据库」。
// 这一组纯函数把「改哪个分区哪条哪个字段」收敛成可测的结构操作：
// 组件只做文本 ↔ 数据的换算和接线，不再自己 structuredClone + 乱戳。
//
// 不变量：**所有操作结构不可变**（structuredClone 后修改，输入绝不改动）——
// 组件的草稿可以随时被丢弃或与已保存值逐字节比较，前提是它从不共享引用。
// ---------------------------------------------------------------------------

/** 有列表形态的档案分区。customFields 不在此列（open slot 不做结构化 UI）。 */
export type SectionName =
  | 'work'
  | 'education'
  | 'projects'
  | 'skills'
  | 'languages'
  | 'certificates'
  | 'awards'

export const SECTION_NAMES: readonly SectionName[] = [
  'work',
  'education',
  'projects',
  'skills',
  'languages',
  'certificates',
  'awards',
]

function isSectionName(value: string): value is SectionName {
  return (SECTION_NAMES as readonly string[]).includes(value)
}

function cloneArchive(archive: ArchiveV1): ArchiveV1 {
  return structuredClone(archive) as ArchiveV1
}

/**
 * 按 `basics.` 下的点路径写入（如 `label.zh` / `contact.phone` /
 * `emergencyContact.phone`）。中间对象不存在就创建；value 为 undefined
 * 时**删除键**而不是留一个 undefined 字段 —— 序列化口径与 JSON 一致，
* 但删除让「字段不存在」在对象字面上就是事实。
 */
export function setBasicsPath(archive: ArchiveV1, path: string, value: unknown): ArchiveV1 {
  const next = cloneArchive(archive)
  const keys = path.split('.').filter((k) => k !== '')
  if (keys.length === 0) {
    throw new Error(`setBasicsPath：路径为空 —— "${path}" 不是 basics 下的合法路径`)
  }
  const root = next.basics as unknown as Record<string, unknown>
  // 走栈记下每一层 {父对象, 键}，删除时才能逐级回收空对象。
  const trail: Array<{ parent: Record<string, unknown>; key: string }> = []
  let cursor: Record<string, unknown> = root
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i] as string
    const existing = cursor[key]
    if (existing === undefined || existing === null || typeof existing !== 'object') {
      cursor[key] = {}
    }
    trail.push({ parent: cursor, key })
    cursor = cursor[key] as Record<string, unknown>
  }
  const last = keys[keys.length - 1] as string
  if (value === undefined) {
    delete cursor[last]
    // 空对象逐级回收：本地化字段的 refine 禁止 `{ zh: undefined }` 留成
    // `{}`（「至少一种语言」），而 contact / identity 这类有 default 的
    // 容器留空对象与不存在等价 —— 统一删到 basics 根为止，语义最干净。
    for (let i = trail.length - 1; i >= 0; i--) {
      const step = trail[i] as { parent: Record<string, unknown>; key: string }
      const obj = step.parent[step.key]
      if (obj !== null && obj !== undefined && typeof obj === 'object' && Object.keys(obj).length === 0) {
        delete step.parent[step.key]
      } else {
        break
      }
    }
  } else {
    cursor[last] = value
  }
  return next
}

function sectionOf(archive: ArchiveV1, section: SectionName): unknown[] {
  return archive[section] as unknown[]
}

/**
 * 追加一个空条目。**返回值预期过不了 schema**（每个分区都有必填字段）——
 * 「新增即 invalid、填上必填项才恢复」是刻意的：占位数据是对用户的撒谎，
 * invalid 态的 issues 列表就是「还差什么」的清单。
 */
export function addSectionEntry(archive: ArchiveV1, section: SectionName): ArchiveV1 {
  const next = cloneArchive(archive)
  ;(next[section] as unknown[]).push({})
  return next
}

/** 删除指定下标的条目。越界抛错 —— 静默 no-op 会把「删除」变成骗人的按钮。 */
export function removeSectionEntry(
  archive: ArchiveV1,
  section: SectionName,
  index: number,
): ArchiveV1 {
  const next = cloneArchive(archive)
  const list = sectionOf(next, section)
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    throw new Error(
      `removeSectionEntry：${section}[${String(index)}] 越界（长度 ${String(list.length)}）`,
    )
  }
  list.splice(index, 1)
  return next
}

/** 写入条目的一个字段。value 的形状由调用方换算好（localized 对象、字符串数组等）。 */
export function setSectionField(
  archive: ArchiveV1,
  section: SectionName,
  index: number,
  field: string,
  value: unknown,
): ArchiveV1 {
  if (!isSectionName(section)) {
    throw new Error(`setSectionField：未知分区 "${section}"`)
  }
  const next = cloneArchive(archive)
  const list = sectionOf(next, section)
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    throw new Error(
      `setSectionField：${section}[${String(index)}] 越界（长度 ${String(list.length)}）`,
    )
  }
  const entry = list[index] as Record<string, unknown>
  if (value === undefined) {
    delete entry[field]
  } else {
    entry[field] = value
  }
  return next
}

// ---------------------------------------------------------------------------
// 表单草稿换算：UI 的每一格都是字符串，schema 的数据形状不是。
// 「空进空出」是这些换算的统一契约 —— 空字符串/空数组不得变成
// `{}` / `['']` 这类过不了 refine 的半成品。
// ---------------------------------------------------------------------------

export interface LocalizedDraft {
  readonly zh: string
  readonly en: string
}

/** 任意形状 → 两个输入框的值。缺什么补什么，绝不抛错（渲染路径必须稳）。 */
export function localizedOf(value: unknown): LocalizedDraft {
  if (value === undefined || value === null || typeof value !== 'object') {
    return { zh: '', en: '' }
  }
  const record = value as Record<string, unknown>
  return {
    zh: typeof record.zh === 'string' ? record.zh : '',
    en: typeof record.en === 'string' ? record.en : '',
  }
}

/** 两个输入框的值 → localized 字段。双语都空 = 字段不存在（refine 的要求）。 */
export function localizedFrom(
  draft: LocalizedDraft,
): { zh?: string; en?: string } | undefined {
  const zh = draft.zh.trim()
  const en = draft.en.trim()
  if (zh === '' && en === '') return undefined
  if (zh === '') return { en }
  if (en === '') return { zh }
  return { zh, en }
}

/** highlights 等字符串数组 → 每行一条的 textarea 值。 */
export function linesOf(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.filter((v): v is string => typeof v === 'string').join('\n')
}

/** textarea 值 → 字符串数组：按行切、去首尾空白、丢空行。 */
export function linesFrom(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** keywords 等字符串数组 → 逗号分隔的单行输入值。 */
export function csvOf(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.filter((v): v is string => typeof v === 'string').join(', ')
}

/** 单行输入 → 字符串数组：逗号（半全角）切、去空白、丢空段。 */
export function csvFrom(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}
