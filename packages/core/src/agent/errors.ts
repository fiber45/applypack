/**
 * `core/agent` 的错误类型。
 *
 * 本层只有一种错误，因为其余所有「不顺利」都是**返回值** ——
 * 轮数用尽是 `termination`，改写失败是 `RewriteFailureEntry`，
 * 闸门不过关是 `failures`。把正常工况做成异常，会让调用方被迫写
 * `try/catch` 去接住一件本来该被展示给用户看的事。
 *
 * `UnknownToolError` 是例外，因为它代表**代码错误**而非工况：
 * 白名单里不存在的东西被调用了，只可能是本层自己写错了。
 * 它必须响亮 —— 静默降级成「这个工具不可用」会让白名单形同虚设。
 */

export class UnknownToolError extends Error {
  readonly code = 'unknown_tool'

  constructor(name: string) {
    super(`工具「${name}」不在白名单里。可用工具见 agent/tools.ts 的 TOOL_SPECS。`)
    this.name = 'UnknownToolError'
  }
}
