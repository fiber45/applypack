/**
 * 风格锚点的选取。
 *
 * DESIGN 8.4 的副作用与解法：逐条并发会带来风格漂移，解法是把
 * 「已定稿的前 3 条」带进后续调用。
 *
 * ## 本文件唯一真正重要的一句话
 *
 * **锚点只能来自已经通过闸门的条目。**
 *
 * 把失败条目的文字带进后续 37 次调用当范例，是本层最坏的失败方式，
 * 而且它的症状是双重的：
 *
 * 1. 一条编了数字的句子被当成「风格基准」复制 37 遍 —— 闸门会继续拦，
 *    于是 37 条跟着一起失败，一次局部错误升级成整批失败；
 * 2. 即使数字部分没被复制，**句式与语域会被复制**。风格漂移正是锚点要解决的
 *    问题，所以下游很难察觉这个基准本身是脏的。
 *
 * 因此这里的入参是 `rewritten`（只含通过闸门的条目），而不是全部产物 ——
 * 想让失败条目当锚点，必须先改这个函数的签名，而那一行会出现在 diff 里。
 */

import type { RewrittenBullet, StyleAnchor } from './types'

/** 默认锚点条数。DESIGN 8.4 写的「前 3 条」。 */
export const DEFAULT_ANCHOR_COUNT = 3

/**
 * 从已通过闸门的产物里取前 `count` 条作为锚点。
 *
 * 不足 `count` 条时就有几条用几条 —— 锚点是风格提示，不是硬性输入，
 * 缺了它改写照样能做，只是风格一致性差一些。为此报错是过度反应。
 */
export function selectAnchors(
  rewritten: readonly RewrittenBullet[],
  count: number = DEFAULT_ANCHOR_COUNT,
): readonly StyleAnchor[] {
  const limit = Math.max(0, Math.floor(count))
  if (limit === 0) return []
  return rewritten
    .slice(0, limit)
    .map((bullet) => ({ bulletId: bullet.bulletId, text: bullet.text }))
}

/** 锚点的 id 列表 —— 写进 `anchorsUsed`，让「这一条用了哪些锚点」可被断言。 */
export function anchorIds(anchors: readonly StyleAnchor[]): readonly string[] {
  return anchors.map((anchor) => anchor.bulletId)
}
