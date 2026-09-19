import type { FillPreview, FileSlotItem, FillItem, GapItem } from './preview'

/**
 * 提交前审核摘要 —— 「护栏，而非功能」（TASKS T5.5，DESIGN 11.4）。
 *
 * DESIGN 第 7 节第七句话：「本项目不代为提交。提交前你会看到一份逐项
 * 摘要，确认之后由你自己点下提交按钮。」本文件把这句话拆成两个纯逻辑
 * 部件，真正的提交事件拦截属于确认 UI：
 *
 * 1. **`buildSubmitSummary`** —— 摘要本身。关键设计（DESIGN 11.4）：
 *    **把「自动填的」与「猜的」分开标注**。adapter 来源进
 *    `autoFilled`（全部来自档案），heuristic 来源进 `heuristicGuessed`
 *    （请重点核对，UI 高亮）。用户只需重点核对猜的部分，不必逐项
 *    复核全部 —— 比让他检查十几项高效得多。两列是 plan 的投影，
 *    不是新算的：混列、漏列都过不了测试。
 * 2. **`createSubmitGate` + `releaseSubmit`** —— 只拦截一次的执行点。
 *    创建门 = 拦截（每份计划内容一次）；`releaseSubmit` 就是用户
 *    那一下点击在纯逻辑层的化身，一次性消费。DESIGN 11.4 的两个
 *    反面教材在这落的钉子：
 *    - **拦截后不放行 = 阻碍** → 门不带任何「驳回后表单自己继续」
 *      的路径，不放行就是不放行，决定权全在 UI 与用户；
 *    - **拦截后静默放行 = 欺骗** → 本模块不存在任何绕过
 *      `releaseSubmit` 产出合法凭据的路径（品牌 symbol 模块私有 +
 *      门由 WeakMap 登记），没有点击就没有凭据。
 *
 * ## 已声明缺口
 *
 * DESIGN 11.4 摘要的第四行「本次新录入 N 项 · 待确认是否存档」
 * 依赖 T5.6 回填闭环的手填捕获数据，本文件不预置占位字段 ——
 * 数据源存在之前先给形状，就是给猜留门。
 */

export interface SubmitSummary {
  /** 与预览一致的 fill 内容摘要 —— 放行凭据与它绑定。 */
  readonly digest: string
  /** 自动填的：适配器绑定来源（全部来自档案）。 */
  readonly autoFilled: readonly FillItem[]
  /** 启发式猜的：评分器竞标来源（请重点核对，UI 高亮）。 */
  readonly heuristicGuessed: readonly FillItem[]
  /** 仍为空的必填 —— 即预览的 blocking 缺口，一等公民通道（DESIGN 11.2）。 */
  readonly emptyRequired: readonly GapItem[]
  /** 上传槽位（红线 5：只提示不代填）。 */
  readonly fileSlots: readonly FileSlotItem[]
}

export function buildSubmitSummary(preview: FillPreview): SubmitSummary {
  const fills = preview.plan.items.filter((i) => i.kind === 'fill')
  return {
    digest: preview.digest,
    autoFilled: fills.filter((f) => f.source === 'adapter'),
    heuristicGuessed: fills.filter((f) => f.source === 'heuristic'),
    // 投影而非重算：blocking 缺口的口径只有 preview 一处（T5.3），
    // 这里若再写一遍过滤条件，两处口径迟早漂移。
    emptyRequired: preview.blockingGaps,
    fileSlots: preview.fileSlots,
  }
}

export interface SubmitGate {
  /** 拦截时针对的摘要 digest。 */
  readonly digest: string
  /** 拦截时展示给用户的摘要 —— UI 渲染的唯一数据源。 */
  readonly summary: SubmitSummary
  /** 是否已放行（供 UI 观测；重复放行在 releaseSubmit 内拒绝）。 */
  readonly released: boolean
}

export interface SubmitRelease {
  /** 放行时所针对摘要的内容 digest。 */
  readonly digest: string
  readonly [submitReleaseBrand]: 'SubmitRelease'
}

/**
 * 凭据的品牌字段：模块私有 symbol，字面量造不出来（编译期门），
 * 运行时也拿不到这个 symbol 值 —— 与 preview.ts 的确认凭据同一套机制。
 */
const submitReleaseBrand: unique symbol = Symbol('SubmitRelease')

/**
 * 门的状态登记表。gate 对外是只读数据，`released` 的翻转只发生在
 * 这张表里 —— 外部伪造一个形状相同的对象，在这里查无此门。
 */
const gateStates = new WeakMap<SubmitGate, { released: boolean }>()

export function createSubmitGate(summary: SubmitSummary): SubmitGate {
  const state = { released: false }
  const gate: SubmitGate = {
    get digest() {
      return summary.digest
    },
    get summary() {
      return summary
    },
    get released() {
      return state.released
    },
  }
  gateStates.set(gate, state)
  return gate
}

/**
 * 放行 —— 用户点击提交按钮这一动作在纯逻辑层的化身。
 *
 * 一次性消费：一次拦截对应一次放行。第二次调用不是「再确认一遍」，
 * 是 UI 的双重提交 bug，直接抛错而不是静默返回第二张票。
 */
export function releaseSubmit(gate: SubmitGate): SubmitRelease {
  const state = gateStates.get(gate)
  if (state === undefined) {
    throw new Error('releaseSubmit：对象不是由 createSubmitGate 产出 —— 凭据只能来自真门')
  }
  if (state.released) {
    throw new Error('releaseSubmit：这道门已经放行过 —— 只拦截一次，一次放行')
  }
  state.released = true
  return {
    digest: gate.digest,
    [submitReleaseBrand]: 'SubmitRelease',
  }
}

/**
 * 消费方（提交事件放行点）的验收：凭据形状正确、且与**当前**摘要的
 * digest 一致。拦截之后页面变过（重算过计划）→ digest 对不上 →
 * 旧凭据作废，重新拦截。伪造凭据（缺品牌）与过期凭据死在同一条路上。
 */
function isSubmitReleaseShape(candidate: unknown): candidate is SubmitRelease {
  if (typeof candidate !== 'object' || candidate === null) return false
  const c = candidate as Partial<SubmitRelease>
  return (
    typeof c.digest === 'string' && c.digest !== '' && c[submitReleaseBrand] === 'SubmitRelease'
  )
}

export function verifySubmitRelease(release: unknown, summary: SubmitSummary): void {
  if (!isSubmitReleaseShape(release)) {
    throw new Error('verifySubmitRelease：凭据形状不对 —— 它只能由 releaseSubmit 产出')
  }
  if (release.digest !== summary.digest) {
    throw new Error(
      'verifySubmitRelease：放行凭据与当前摘要的内容摘要不一致 —— ' +
        '页面在拦截之后变过，旧凭据作废，请重新拦截确认',
    )
  }
}
