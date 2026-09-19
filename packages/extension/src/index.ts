/**
 * `@applypack/extension` —— 浏览器扩展（MV3）。
 *
 * 已落地的两块，都是纯逻辑层（平台接缝各自留最小接口）：
 *   - `vault/` —— 扩展侧密文副本（T1.5）：独立解锁、会话超时、密文推送。
 *   - `fill/`  —— 填充引擎（T5.1）：页面特征提取 + 适配器注册表 +
 *     启发式匹配 + 填充计划。只读页面；写 DOM 属 T5.3 预览确认 UI。
 *
 * WXT 与 manifest 仍未建（M5 后续任务）：`chrome.*` 全局在本包不可写
 * 由 tsconfig 的 `types: []` 保证。
 *
 * @see AGENTS.md §3
 */

export * from './vault/index'
export * from './fill/index'
