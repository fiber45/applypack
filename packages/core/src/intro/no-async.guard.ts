/**
 * 「`core/intro` 整条链路是同步的」—— **类型级守卫**。
 *
 * 这一条不是洁癖。`DESIGN` 1.3 要求自我介绍里的姓名、公司、学校等 B 级字段
 * 由**确定性代码**写进产物，绝不经过模型请求。而「不经过模型」这件事
 * 在别的模块里只能靠纪律（提示词里写上「不要……」），在这里可以是**一条类型事实**：
 *
 * > 一次真实的网络调用必然是异步的。`buildIntroViews` 的返回类型不是 `Promise`，
 * > 所以它**不可能**等待任何一次网络调用。
 *
 * 下面的写法与 `../no-runtime-deps.guard.ts` 同款，但更严一档：
 * 那个文件证明「某个全局不存在」，这个文件证明「某个形状不成立」。
 * 两个方向都会报错 ——
 *
 * | 情况 | 会发生什么 |
 * |---|---|
 * | 函数变成 `async` | `Assert<...>` 得到 `true`，`@ts-expect-error` 变成未使用指令 → tsc 失败 |
 * | 函数保持同步 | `Assert<false>` 违反 `T extends true` → 错误被 `@ts-expect-error` 吃掉 → 通过 |
 *
 * 也就是说：**它不能靠「删掉一条断言」被绕过**，只能靠改这段注释被绕过 ——
 * 而那是看得见的。
 *
 * 全程只用类型（没有 `export const`），所以本文件不产出任何运行时代码。
 *
 * ## 这条守卫**没有**证明什么（写清楚，免得被当成更强的保证）
 *
 * 它证明的是「没有 `await`」。一个同步函数仍然可以 `void fetch(...)` 点火就走 ——
 * 那需要 `no-floating-promises` 那类 lint 才能抓。本模块真正的第二层保证是
 * **依赖清单**：`core/intro` 只 import 了 `../render/model`、`../schema`、
 * `../verify/*` 与自身，全是纯模块（`no-runtime-deps.guard.ts` 守着
 * 它们不碰 DOM / Node 全局）。两层合起来才是「不出网」。
 */

import { checkIntros } from './check'
import { composeIntroPair } from './compose'
import { introFacts } from './facts'
import { buildIntroViews } from './index'

type Assert<T extends true> = T

/** 一个函数的返回类型是不是 `Promise`。 */
type ReturnsPromise<F extends (...args: never[]) => unknown> =
  ReturnType<F> extends Promise<unknown> ? true : false

/**
 * **阳性对照**：同一个宏在异步函数上必须给出 `true`。
 *
 * 没有它的话，上面四条 `@ts-expect-error` 有可能只是因为 `ReturnsPromise`
 * 永远返回 `false` 而通过 —— 那样这个守卫就什么都没证明。
 * 这一行一旦报错，说明判据本身坏了，而不是被测的函数变好了。
 */
declare function asyncProbe(): Promise<void>
export type AsyncControlDetectsAsync = Assert<ReturnsPromise<typeof asyncProbe>>

// @ts-expect-error `buildIntroViews` 必须是同步的。见本文件头。
export type BuildIntroViewsNotAsync = Assert<ReturnsPromise<typeof buildIntroViews>>

// @ts-expect-error `composeIntroPair` 必须是同步的（它是「不经过模型」这条性质的核心）。
export type ComposeIntroPairNotAsync = Assert<ReturnsPromise<typeof composeIntroPair>>

// @ts-expect-error `checkIntros` 必须是同步的 —— 一个可以被模型影响的验收器会答应「这次就算了吧」（红线 6）。
export type CheckIntrosNotAsync = Assert<ReturnsPromise<typeof checkIntros>>

// @ts-expect-error `introFacts` 必须是同步的（它读的是已经建好的文档模型）。
export type IntroFactsNotAsync = Assert<ReturnsPromise<typeof introFacts>>
