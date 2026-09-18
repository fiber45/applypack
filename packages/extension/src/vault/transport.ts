/**
 * 密文推送的接缝 —— 「Web 端更新了档案，扩展怎么知道」被隔离在这一个接口后面。
 *
 * 与 `core/vault` 的 `VaultStore` 同一个套路：本模块不碰任何具体机制。
 * 真实实现有两种，都属于扩展入口（T5.1）：
 *
 *   - `chrome.storage.onChanged`：扩展自己的多个上下文（service worker /
 *     side panel / content script）之间共享同一份密文时用它，一条写入全网可见。
 *   - `chrome.runtime.onMessage` + manifest 的 `externally_connectable`：
 *     **Web 端**（另一个来源）推送给扩展时用它。
 *
 * ## 一句必须写在这儿的话：本模块不是来源认证
 *
 * 推送进来的东西，本模块只能验证两件事：**它是不是一个结构合法的信封**、
 * 以及（在已解锁时）**手里的 DEK 打不打得开它**。它拿不到发送方身份 ——
 * 「这份密文是不是我们自己的 Web 端发来的」由 manifest 的
 * `externally_connectable` 白名单决定，那才是第一道门。
 *
 * 别把这里的校验当成来源认证：一个被允许调用扩展的外部页面，
 * 有本事把**它自己那个库**的密文推过来。它推不动的是「让你读到它的内容」——
 * 换一把密钥就是换一个库，同源判定会拒绝，扩展手里的副本不被替换。
 *
 * ## 契约只有两条
 *
 * 1. `subscribe` 是**可重复、可取消**的：返回的取消函数必须真的断开。
 * 2. handler 可以返回 Promise。实现要保证「同一条消息不会被并发地喂进来」——
 *    做不到也没关系（会话自己会串行化），但做到了更好诊断。
 */

export type CiphertextUnsubscribe = () => void

export type CiphertextPushHandler = (text: string) => void | Promise<void>

export interface CiphertextTransport {
  /** 订阅密文推送，返回取消订阅的函数。 */
  subscribe(handler: CiphertextPushHandler): CiphertextUnsubscribe
}

/**
 * 内存实现。用途有两个：单测，以及「Web 端与扩展端跑在同一个上下文里」的
 * 本地调试（Vite 开发页 + 扩展 side panel 同一个 page 脚本时最省事的接法）。
 *
 * 与 `createMemoryVaultStore` 一样，它是**本包唯一自带的具体实现**，
 * 也因此是其余实现的参照：任何传输只要行为与它一致，会话层就不需要知道差别。
 */
export function createMemoryTransport(): CiphertextTransport & {
  /** 向所有订阅者推一份密文，**等它们全部处理完**再返回。 */
  push(text: string): Promise<void>
  /** 累计被推过多少次（含没有订阅者的时候）—— 测试用它数「回声」的次数。 */
  readonly pushCount: number
} {
  const handlers = new Set<CiphertextPushHandler>()
  let pushCount = 0

  return {
    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    async push(text) {
      pushCount += 1
      // 先快照再遍历：handler 里取消订阅（或新订阅）不该改变本次投递的受众。
      for (const handler of [...handlers]) {
        await handler(text)
      }
    },
    get pushCount() {
      return pushCount
    },
  }
}
