/**
 * 改写编排 —— 逐条并发 + 失败隔离 + 风格锚点。
 *
 * ## 一、并发是「全量同时发起」，不是「线程池」
 *
 * DESIGN 8.4 说：每条 bullet 一次调用、并发发出，总延迟 ≈ 最慢一条。
 * 实现上就是一句 `Promise.all(candidates.map(rewriteOne))` —— 不在这个文件里
 * 造一个并发度上限、队列或信号量。理由是这套调用是 **I/O 等待型**：
 * 40 个请求各自的绝大部分时间花在等服务端返回，本地占用近乎为零。
 * 加一个 `p-limit(5)` 之类的东西，唯一效果是把 200ms 的墙钟时间拉成 1.6 秒，
 * 而它「防止打爆 rate limit」的收益，在单用户本地应用里根本不存在
 * （用户只有一个，配额是他自己买的）。
 *
 * `concurrencyPeak` 被记进报告，就是为了让这句话可以被断言而不是被相信。
 *
 * ## 二、锚点与并发之间的矛盾，以及本层的处理
 *
 * TASKS.md 的两条要求互相拉扯：
 *
 *   - 「40 条并发：总延迟 ≈ 最慢一条」
 *   - 「风格锚点：已定稿前 3 条带入后续调用」
 *
 * 若 40 条同时发出，那么在它们**开始的时候**不存在任何「已定稿」的条目 ——
 * 后一条不可能成立。反过来，若严格串行地先跑出 3 条作锚点，前一条就废了。
 *
 * 处理办法是把「锚点从哪来」分成两种，而不是选一个折中：
 *
 * | 场景 | 锚点来源 | 是否分批 | 延迟 |
 * |---|---|---|---|
 * | 常规（默认） | `options.anchors`，来自**上一轮**已定稿的条目 | 不分批 | ≈ 最慢一条 |
 * | 首轮就要锚点（`bootstrapAnchors`） | 本轮前 `anchorCount` 条 | 分两批 | ≈ 两段之和 |
 *
 * 默认走第一种：Agent 循环（T3.3）本来就会多轮，第二轮天然有上一轮的定稿，
 * 于是「全量并发」与「有风格锚点」同时成立，一分钱不用多付。
 * 第二种只在「必须一次成型」的场景打开，代价是延迟翻倍 ——
 * 而这个代价写在参数说明里，不是让调用方事后自己撞上。
 *
 * @see DESIGN 8.4 · TASKS.md T3.1
 */

import { DEFAULT_MAX_ATTEMPTS } from '../compile/index'
import { DEFAULT_ANCHOR_COUNT, selectAnchors } from './anchors'
import { createCounter, rewriteOne, type RewriteContext } from './runner'
import type {
  RewriteFailureEntry,
  RewriteOptions,
  RewriteReport,
  RewrittenBullet,
  StyleAnchor,
} from './types'

function isSuccess(entry: RewrittenBullet | RewriteFailureEntry): entry is RewrittenBullet {
  return 'text' in entry
}

/**
 * 批量改写。
 *
 * 返回的报告满足一条恒等式，它是「失败隔离」的可断言形式：
 *
 *   rewritten.length + failed.length === candidates.length
 *
 * 也就是说：**没有任何一条会被静默丢掉。** 无论它是因为模型不听话、
 * 还是因为闸门判定它编了数字 —— 用户拿到的清单里一定有它，
 * 以及它为什么没通过。
 */
export async function rewriteBullets(options: RewriteOptions): Promise<RewriteReport> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))
  const anchorCount = Math.max(0, Math.floor(options.anchorCount ?? DEFAULT_ANCHOR_COUNT))
  const counter = createCounter()

  const shared: Omit<RewriteContext, 'anchors'> = {
    client: options.client,
    model: options.model,
    ...(options.jd === undefined ? {} : { jd: options.jd }),
    ...(options.archive === undefined ? {} : { archive: options.archive }),
    ...(options.reference === undefined ? {} : { reference: options.reference }),
    maxAttempts,
    counter,
  }

  const external = options.anchors ?? []
  const shouldBootstrap =
    options.bootstrapAnchors === true &&
    external.length === 0 &&
    anchorCount > 0 &&
    options.candidates.length > anchorCount

  let anchors: readonly StyleAnchor[] = external
  let entries: ReadonlyArray<RewrittenBullet | RewriteFailureEntry>

  if (shouldBootstrap) {
    // 第一批：自己不带锚点，跑出本轮的第一组定稿。
    const head = options.candidates.slice(0, anchorCount)
    const headEntries = await Promise.all(
      head.map((candidate) => rewriteOne(candidate, { ...shared, anchors: [] })),
    )
    // 只有通过闸门的那些才配当锚点，见 anchors.ts。
    anchors = selectAnchors(headEntries.filter(isSuccess), anchorCount)
    // 第二批：带锚点全量并发。
    const tail = options.candidates.slice(anchorCount)
    const tailEntries = await Promise.all(
      tail.map((candidate) => rewriteOne(candidate, { ...shared, anchors })),
    )
    entries = [...headEntries, ...tailEntries]
  } else {
    entries = await Promise.all(
      options.candidates.map((candidate) => rewriteOne(candidate, { ...shared, anchors })),
    )
  }

  return {
    rewritten: entries.filter(isSuccess),
    failed: entries.filter((entry): entry is RewriteFailureEntry => !isSuccess(entry)),
    anchors,
    calls: counter.calls,
    concurrencyPeak: counter.peak,
  }
}
