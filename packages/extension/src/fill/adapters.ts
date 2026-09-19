import type { DomDocument } from './dom'

/**
 * 适配器注册表 —— 「适配器优先 + 强制确认」的前一半（ADR-7）。
 *
 * 命中已知平台 → 用**人工核对过的精确选择器**（`selectors`），
 * 不赌启发式；没命中 → 启发式兜底；命中了但选择器扑空（平台改版）
 * → 逐字段降级回启发式（DESIGN 232 的风险条目，降级在 plan.ts 落地）。
 *
 * T5.1 只交付注册表机制与 mockboard 这个**虚构**适配器作为测试锚点；
 * 前 3 个真实适配器是 T5.2 —— 每个带一份保存的快照 fixture。
 *
 * 注册表是进程内可变状态，但只暴露 `register` / `detect` / 测试用的
 * `reset` —— 没有「运行中动态换表」的场景，MV3 内容脚本的注册发生在
 * 入口处一次性完成。
 */

export interface PlatformAdapter {
  readonly id: string
  /**
   * 平台标记：页面上 `[data-platform="<marker>"]` 存在即命中。
   * 刻意用自申报标记而不是 URL 模式：URL 匹配规则每家一个坑
   * （子域、路径重写、短链），而 T5.2 的快照 fixture 里标记可以
   * 与真实页面核对；URL 规则留给适配器作者按需加，注册表不猜。
   */
  readonly platformMarker: string
  /** catalog path → CSS 选择器。选择器扑空 = 该字段降级，不报错。 */
  readonly selectors: Readonly<Record<string, string>>
}

/**
 * 虚构适配器 —— 注册表机制的测试锚点。
 * 它命中一个「纯启发式救不了」的表单：`mb-name` 没有任何文案线索。
 */
export const MOCKBOARD_ADAPTER: PlatformAdapter = Object.freeze({
  id: 'mockboard',
  platformMarker: 'mockboard',
  selectors: Object.freeze({
    'basics.name.zh': '#mb-name',
    'basics.contact.phone': '#mb-phone',
    'basics.contact.email': '.mb-email',
  }),
})

const registry: PlatformAdapter[] = []

export function registerPlatformAdapter(adapter: PlatformAdapter): void {
  const existing = registry.find((a) => a.id === adapter.id)
  if (existing !== undefined) {
    throw new Error(`适配器 ${adapter.id} 已注册 —— 同 id 重复注册多半是初始化代码跑了两遍`)
  }
  registry.push(adapter)
}

/** 仅测试使用：注册表是模块级状态，用例之间必须互不带走对方的注册。 */
export function resetPlatformAdaptersForTests(): void {
  registry.length = 0
}

export function detectPlatformAdapter(doc: DomDocument): PlatformAdapter | null {
  for (const adapter of registry) {
    if (doc.querySelectorAll(`[data-platform="${adapter.platformMarker}"]`).length > 0) {
      return adapter
    }
  }
  return null
}

/**
 * 把适配器的选择器解析成「字段 key → catalog path」的绑定。
 *
 * 按 **key**（id/name）而不是元素身份绑定：jsdom 与真实 DOM 对
 * `querySelectorAll` 的节点包装不保证同身份，key 是两边都稳定的寻址方式。
 * 解析不到元素、或元素不是已知字段 → 该选择器静默跳过 —— 那个字段
 * 自然落回启发式候选池，这就是降级本身，不需要专门的控制流。
 */
export function adapterBindings(
  adapter: PlatformAdapter,
  doc: DomDocument,
  knownKeys: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>()

  for (const [path, selector] of Object.entries(adapter.selectors)) {
    const element = doc.querySelectorAll(selector)[0]
    if (element === undefined) continue // 选择器扑空：平台改版，降级

    const id = element.getAttribute('id')
    const name = element.getAttribute('name')
    const key = id ?? name
    if (key === null || !knownKeys.has(key)) continue

    bindings.set(key, path)
  }

  return bindings
}
