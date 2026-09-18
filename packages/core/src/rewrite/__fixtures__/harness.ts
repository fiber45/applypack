/**
 * 改写层测试的公共夹具。
 *
 * 里面的 `mockClient` 做了一件测试专用但很关键的事：它**从请求里反解出
 * bulletId**（任务消息里那个 `<candidate id="…">`），而不是靠调用顺序去猜。
 * 靠顺序猜在并发下必然出错 —— 40 个请求的返回顺序不确定，而
 * 「这条为什么失败」正是本层最需要被验对的东西。
 */

import type { CompiledJd } from '../../compile/index'
import type { LLMClient, LLMRequest } from '../../egress/index'
import type { RewriteCandidate } from '../types'

/**
 * 原始经历描述。三个数字 12 / 4.2 / 38 是故意的：
 * 「数字只能来自原文」这条闸门需要一组可枚举的合法数字，
 * 任何第四个数字都是编的。
 */
export const SOURCE_TEXT =
  '负责推荐系统召回通道的特征工程，累计上线 12 个特征，将离线特征回填耗时从 4.2 小时降至 38 分钟。'

/** 一份合法的改写产物：强动词开头、无被动、41 字、三个数字全部来自原文。 */
export const GOOD_TEXT = '重构推荐系统召回链路，上线 12 个特征，回填耗时从 4.2 小时降至 38 分钟'

export const JD: CompiledJd = {
  title: '推荐算法工程师',
  company: '某某科技',
  hardRequirements: [{ kind: 'degree', text: '本科及以上学历', strict: true }],
  skills: [
    { name: 'Python', proficiency: 'proficient', required: true, evidence: '熟悉 Python' },
    { name: '推荐系统', proficiency: 'proficient', required: true, evidence: '有推荐系统相关经验' },
    { name: 'PyTorch', proficiency: 'familiar', required: false, evidence: '了解 PyTorch 者优先' },
  ],
  responsibilities: ['负责推荐系统召回与排序模型的迭代'],
  register: 'technical',
  language: 'zh',
}

export function candidate(
  bulletId: string,
  sourceText: string = SOURCE_TEXT,
  overrides: Partial<RewriteCandidate> = {},
): RewriteCandidate {
  return {
    bulletId,
    entryId: `work.0`,
    title: '算法工程实习生',
    organization: '某某科技有限公司',
    startDate: '2025-06',
    endDate: '2025-09',
    sourceText,
    keywordsHit: ['推荐系统'],
    score: 87.3,
    ...overrides,
  }
}

export interface OutputOptions {
  readonly sourceSpan?: string
  readonly evidence?: readonly string[]
  readonly keywordsHit?: readonly string[]
}

/** 造一条 schema 合法的模型回复。 */
export function output(text: string, options: OutputOptions = {}): string {
  return JSON.stringify({
    text,
    sourceSpan: options.sourceSpan ?? SOURCE_TEXT,
    evidence: options.evidence ?? [SOURCE_TEXT],
    keywordsHit: options.keywordsHit ?? ['推荐系统'],
  })
}

/** 从请求里反解出本条请求对应的 bulletId。 */
export function bulletIdOf(request: LLMRequest): string {
  const task = request.volatile.find((message) => message.content.includes('<candidate id="'))
  const matched = task === undefined ? null : /<candidate id="([^"]+)"/.exec(task.content)
  const id = matched?.[1]
  if (id === undefined) throw new Error('mock 无法从请求里反解 bulletId')
  return id
}

/** 本轮任务消息（易变段的第二条）。锚点、原文都在这条里。 */
export function taskOf(request: LLMRequest): string {
  return request.volatile.find((message) => message.content.includes('<candidate id="'))?.content ?? ''
}

/** JD 消息（易变段的第一条）。 */
export function jdMessageOf(request: LLMRequest): string {
  return request.volatile[0]?.content ?? ''
}

export interface MockOptions {
  /** 固定延迟，用于制造「最慢一条」。 */
  readonly delayMs?: number
  /** 按 bulletId 定制延迟，用于让某一条明显更慢。 */
  readonly delayFor?: (bulletId: string) => number
  /** 计时器实现。默认是真实计时器；注入假计时器可以让时间断言不受调度影响。 */
  readonly sleep?: (ms: number) => Promise<void>
}

export interface MockHarness {
  readonly client: LLMClient
  readonly seen: LLMRequest[]
  /** 某个 bulletId 一共被调用了几次（含重试） */
  attemptsOf(bulletId: string): number
}

/**
 * 真实计时器。
 *
 * `core` 的 `tsconfig.base.json` 里 `lib` 不含 DOM、`types` 为空，
 * 所以 `setTimeout` 在这里**没有类型** —— 那正是「零运行时依赖」在起作用
 * （`no-runtime-deps.guard.ts` 就是干这个的）。并发断言需要真实时间，
 * 于是从 `globalThis` 上取一份窄类型引用。
 *
 * 这个 cast 只存在于测试夹具里，不进产物，也不改变那条约束的效力：
 * 想在 core 的源码里用计时器，仍然要先过 `lib` / `types` 那两关。
 */
export const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const schedule = (
      globalThis as unknown as {
        setTimeout: (callback: () => void, delay: number) => unknown
      }
    ).setTimeout
    schedule(() => {
      resolve()
    }, ms)
  })

/**
 * 脚本化 mock client。
 *
 * `respond(bulletId, attemptIndex)` 返回该条这一次的模型回复原文。
 * `attemptIndex` 从 0 开始，于是「第一次编数字、第二次改好」可以写成一行。
 */
export function mockClient(
  respond: (bulletId: string, attemptIndex: number, request: LLMRequest) => string,
  options: MockOptions = {},
): MockHarness {
  const seen: LLMRequest[] = []
  const counts = new Map<string, number>()

  const client: LLMClient = {
    complete: async (request) => {
      seen.push(request)
      const bulletId = bulletIdOf(request)
      const attemptIndex = counts.get(bulletId) ?? 0
      counts.set(bulletId, attemptIndex + 1)

      const delay = options.delayFor?.(bulletId) ?? options.delayMs ?? 0
      if (delay > 0) await (options.sleep ?? realSleep)(delay)

      return { text: respond(bulletId, attemptIndex, request) }
    },
  }

  return {
    client,
    seen,
    attemptsOf: (bulletId) => counts.get(bulletId) ?? 0,
  }
}
