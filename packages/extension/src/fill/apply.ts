import { previewDigest, type FillConfirmation } from './preview'
import type { FillPlan } from './plan'

/**
 * 写入门 —— 「任何写入之前必须经过用户确认」的执行点（TASKS T5.3，DESIGN 3.4）。
 *
 * `plan.ts` 的文件头写过：真正写 DOM 的事在确认 UI 手里。这个文件就是
 * 那只手的**关节**：从「计划」到「writer 被调用」只有这一条路，而路上
 * 有三道检查，全部通过才碰得到 writer ——
 *
 * 1. 凭据形状正控（不是裸 cast：结构不符立即抛错）；
 * 2. **摘要对得上**：凭据的 digest 必须等于当前计划的内容摘要。
 *    页面在预览之后变过（字段消失、值要重算）→ 旧票作废，重新预览；
 * 3. **批的都在计划里**：凭据被裁剪/拼接过（批准了计划里不存在的 key）
 *    同样拒绝 —— 宁可误伤，不可放行。
 *
 * `FillWriter` 是平台接缝：MV3 内容脚本给真实现（写 DOM），
 * 测试给间谍。本文件不知道 DOM 的存在 —— 它只保证「没确认过的
 * 值永远到不了 writer」，至于 writer 落到页面还是落进测试，
 * 与这道门无关。
 */

/** 最小写入接口 —— 接缝只有这一个方法，多一个都是多余的攻击面。 */
export interface FillWriter {
  setValue(key: string, value: string): void
}

export interface ApplyResult {
  /** 实际写入了的 key（计划顺序）。 */
  readonly appliedKeys: readonly string[]
  /** 计划里有、但用户没批的 fill key（计划顺序）。 */
  readonly skippedKeys: readonly string[]
}

function isFillConfirmationShape(candidate: unknown): candidate is FillConfirmation {
  if (typeof candidate !== 'object' || candidate === null) return false
  const c = candidate as Record<string, unknown>
  return typeof c.digest === 'string' && c.digest !== '' && Array.isArray(c.approvedKeys)
}

export function applyFillPlan(
  plan: FillPlan,
  confirmation: FillConfirmation,
  writer: FillWriter,
): ApplyResult {
  if (!isFillConfirmationShape(confirmation)) {
    throw new Error('applyFillPlan：凭据形状不对 —— 它只能由 createConfirmation 产出')
  }

  // 门的第 2 道：摘要对不上 = 预览之后世界变过了。旧票作废。
  const currentDigest = previewDigest(plan)
  if (confirmation.digest !== currentDigest) {
    throw new Error(
      'applyFillPlan：确认凭据与当前计划的内容摘要不一致 —— ' +
        '页面在预览之后变过，旧凭据作废，请重新预览确认',
    )
  }

  // 门的第 3 道：批的每一项都必须是当前计划里的 fill 字段。
  const fillByKey = new Map(
    plan.items.filter((i) => i.kind === 'fill').map((i) => [i.key, i]),
  )
  for (const key of confirmation.approvedKeys) {
    if (!fillByKey.has(key)) {
      throw new Error(
        `applyFillPlan：凭据批准了计划里不存在的 key「${key}」—— 凭据与计划不配套`,
      )
    }
  }

  const approved = new Set(confirmation.approvedKeys)
  const appliedKeys: string[] = []
  const skippedKeys: string[] = []

  for (const item of plan.items) {
    if (item.kind !== 'fill') continue // gap / file-slot / checkbox 结构上到不了这里
    if (approved.has(item.key)) {
      writer.setValue(item.key, item.value)
      appliedKeys.push(item.key)
    } else {
      skippedKeys.push(item.key)
    }
  }

  return { appliedKeys, skippedKeys }
}
