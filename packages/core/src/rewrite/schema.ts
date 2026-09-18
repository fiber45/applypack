/**
 * 改写产物的 schema —— 严格模式（ADR-8：未知字段直接报错）。
 *
 * ## 与 DESIGN 8.3 的字面片段有一处偏离，需要记下来
 *
 * 8.3 给的形状是：
 *
 * ```ts
 * { bullets: [{ text, sourceSpan, evidence[], keywordsHit[] }] }
 * ```
 *
 * 而 8.4 同时规定「改写逐条并发，不批量」。两者不能同时落地：既然一次调用
 * 只改写一条，外层那个 `bullets` 数组就永远只有一个元素 —— 留着一个恒为
 * 长度 1 的数组，会让读代码的人以为这里支持批量，也会让闸门的失败定位
 * 多一层无意义的路径前缀（`bullets.0.text` 而不是 `text`）。
 *
 * 所以采纳的是**内层对象**：`text` / `sourceSpan` / `evidence` / `keywordsHit`。
 * 8.3 想表达的是「这几个字段必须存在」，这一点被完整保留了；
 * 被删掉的只是与 8.4 冲突的那一层容器。**清单与 ADR 冲突时改清单，
 * 两个都写进 DESIGN 的段落冲突时，采纳被 ADR 支撑的那一条。**
 *
 * ## `evidence` 不是装饰
 *
 * 它和 `sourceSpan` 都会被本地逐字比对（`isGroundedIn`），比对不过就重试。
 * 一个不会被核对的字段，模型填什么都不会有人知道 —— 而 schema 里
 * 留一个不受约束的字段，比没有这个字段更糟：它会让读者以为系统在做事实溯源。
 */

import { z } from 'zod'

export const rewriteOutputSchema = z.strictObject({
  /** 改写后的 bullet。一句话，动宾结构。 */
  text: z.string().min(1),
  /** 本条改写所依据的原文片段。必须逐字来自 `sourceText`。 */
  sourceSpan: z.string().min(1),
  /** 支撑 `text` 中每个断言的原文片段，至少一条。每一项都必须逐字来自 `sourceText`。 */
  evidence: z.array(z.string().min(1)).min(1),
  /** 模型自报命中的 JD 关键词。不参与判定，仅作诊断。 */
  keywordsHit: z.array(z.string()),
})

export type RewriteOutput = z.infer<typeof rewriteOutputSchema>
