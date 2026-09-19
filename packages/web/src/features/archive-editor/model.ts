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
export function editCandidate(
  _state: EditorState,
  saved: ArchiveV1,
  candidate: unknown,
): EditorState {
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
