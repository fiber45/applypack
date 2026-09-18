/**
 * `@applypack/core` —— 纯 TS 业务核心。
 *
 * 约束（由 `tsconfig.base.json` 的 `lib: ["ES2023"]` 在编译期强制）：
 * **零 DOM、零 Node 运行时依赖**。任何一处 `document` / `window` / `process` 都会让 typecheck 失败。
 * Web 端与扩展端共享本包，因此它只能是纯逻辑。
 *
 * @see AGENTS.md §3
 */

export * from './crypto/index'
export * from './schema/index'
