/**
 * 「`core` 零 DOM、零 Node 运行时依赖」的**编译期守卫**。
 *
 * `AGENTS.md` §3 要求 core 是纯逻辑（Web 端与扩展端共享）。这条要求的执行手段有两层：
 *   1. `tsconfig.base.json` 的 `lib: ["ES2023"]` —— 不提供 DOM 类型
 *   2. `tsconfig.base.json` 的 `types: []` —— 不自动注入任何 @types 包
 *
 * 两层都是配置，配置会被人改。这个文件的作用是**让改动立刻可见**：
 * 下面每个 `@ts-expect-error` 都指着一个「本不该存在的全局」。一旦某个全局真的变得可用，
 * tsc 会因「未使用的 @ts-expect-error 指令」失败，而不是安静地放行。
 *
 * 全部用类型探针（`typeof X`）而非真实代码，因此不产出任何运行时代码。
 */

// @ts-expect-error core 中不得出现 document —— DOM 类型不在 lib 白名单里
export type DocumentProbe = typeof document

// @ts-expect-error core 中不得出现 window —— 同上
export type WindowProbe = typeof window

// @ts-expect-error core 中不得出现 process —— 不自动注入 @types/node
export type ProcessProbe = typeof process
