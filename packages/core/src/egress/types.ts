/**
 * 出网请求的类型层。
 *
 * 形状本身就是设计文档：`cachedPrefix` 与 `volatile` 的切分**编码了缓存断点**。
 * DESIGN.md 8.1 说「把 JD 摆在档案之前会让缓存全部失效」——那是一句会在代码里
 * 被忘记的劝告。把它变成两个字段之后，调用方**在类型上就无法**把易变内容塞进
 * 缓存前缀：`assembleLLMRequest` 独占 `cachedPrefix` 的构造权。
 *
 * @see DESIGN.md 8.1 · 附录 A
 */

export type LLMRole = 'user' | 'assistant'

export interface LLMMessage {
  readonly role: LLMRole
  readonly content: string
}

/**
 * 一次出网请求的全部内容。
 *
 * 这个对象是**唯一允许离开设备的东西**。任何新增的出网能力都必须扩展它，
 * 而不是另开一条通道 —— `egress/index.ts` 的导出面有断言守着。
 */
export interface LLMRequest {
  readonly model: string
  /**
   * 稳定前缀：系统提示 → 参考资料 → A 级档案。
   * 排列顺序从「永不变」到「会话内不变」，因此整段可被 provider 缓存。
   */
  readonly cachedPrefix: readonly LLMMessage[]
  /** 易变部分：结构化 JD → 本轮任务。每次请求都不同，必须落在缓存断点之后。 */
  readonly volatile: readonly LLMMessage[]
}

export interface LLMResponse {
  readonly text: string
  /**
   * provider 报的用量，**可选**。
   *
   * core 不依赖它 —— 它的唯一用途是让 Agent 的 token 预算用上比估算更准的
   * 数字（见 `agent/budget.ts` 的 `usageOf`）。厂商不报就退回估算，
   * 于是「预算」这根绳子的精度随实现变化，但不会因为缺这个字段而失效。
   */
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
  }
}

/**
 * 出网客户端。core 只定义接口，不提供实现 —— 真实实现（Vercel AI SDK）在 Web 端。
 *
 * 这样安排的理由是`core` 的零依赖约束，但它顺带带来一个测试上的好处：
 * 评测集可以注入一个**只会记录 payload 的假客户端**，于是「有没有 B 级数据出网」
 * 从一句承诺变成一份可读的捕获记录。
 */
export interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>
}
