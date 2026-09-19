/**
 * jsdom 的最小 ambient 声明 —— 只声明本包测试真正用到的那一小块 API 面。
 *
 * 为什么不用 `@types/jsdom`：extension 的 tsconfig 是 `types: []`（零环境类型），
 * 引一整套 DOM 类型库进来，等于把「这个包里的代码能不能碰 DOM」重新变成
 * 靠自觉的问题。这里反着走：**类型面上只存在我们声明的这一小块**，
 * DOM 的真实形态由 `dom.ts` 里的结构接口（`DomElement` / `DomDocument`）约束，
 * jsdom 只是在测试里充当那个「恰好满足接口的解析器」。
 */
declare module 'jsdom' {
  export interface JSDOMWindow {
    readonly document: unknown
  }

  export class JSDOM {
    constructor(input: string, options?: Readonly<Record<string, unknown>>)
    readonly window: JSDOMWindow
  }
}
