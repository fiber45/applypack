/**
 * 测试装置：可控时钟、记账存储、会回声的存储、以及一个扮演「Web 端」的密文库。
 *
 * 为什么不需要 `setTimeout`、`await sleep()` 之类的等待：
 * 本模块的时间**全部**来自注入的时钟，事件**全部**来自注入的传输，
 * 存储是一段被记下来的文本。于是每个用例都是「把表拨一下 → 调一个方法 → 看结果」，
 * 没有任何一处依赖真实时间过去多久 —— 慢的测试迟早会被跳过，会闪断的测试更糟。
 */
import type { ArchiveV1 } from '../../../../core/src/schema/index'
import { maximalArchiveV1 } from '../../../../core/src/schema/__fixtures__/maximal-archive'
import { TEST_KDF_PARAMS } from '../../../../core/src/vault/__fixtures__/test-params'
import { Vault, type VaultStore } from '../../../../core/src/vault/index'

import type { Clock } from '../clock'

/** 用来扮演 Web 端的口令。**绝不出现在落盘内容里**，有断言守着。 */
export const WEB_PASSPHRASE = 'correct horse battery staple'

export const OTHER_PASSPHRASE = 'a-completely-different-passphrase'

// ─────────────────────────────── 时钟 ───────────────────────────────

export interface FakeClock extends Clock {
  /** 把表往前拨。超时因此可以被「瞬间」复现，而不是等 15 分钟。 */
  advance(ms: number): void
}

export function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let now = start
  return {
    now: () => now,
    advance(ms: number) {
      now += ms
    },
  }
}

// ─────────────────────────────── 存储 ───────────────────────────────

export interface RecordingStore extends VaultStore {
  /**
   * 每一次写入的**原文**，按顺序。
   *
   * 这就是「密钥与明文永不落盘」这条断言的扫描对象：本模块能落盘的地方
   * 只有这一个 store，而它的每一次写入都在这里留下了备份。
   * 换句话说，那条性质在本包内是**可判定的**，不是一句承诺。
   */
  readonly writes: string[]
  readonly readCount: number
  /** 当前存着的原文（不计数：查状态不该改变被测对象的读数）。 */
  peek(): string | null
}

export function createRecordingStore(initial: string | null = null): RecordingStore {
  let current = initial
  const writes: string[] = []
  let readCount = 0

  return {
    async read() {
      readCount += 1
      return current
    },
    async write(text: string) {
      writes.push(text)
      current = text
    },
    async remove() {
      current = null
    },
    get writes() {
      return writes
    },
    get readCount() {
      return readCount
    },
    peek() {
      return current
    },
  }
}

export interface EchoingStore extends RecordingStore {
  /** 回声次数。一次写入恰好引发一次回声时它等于 1 —— 用来证明不会级联。 */
  readonly echoes: number
}

/**
 * 写入时**同步**回声的存储 —— 模拟 `chrome.storage.onChanged`：
 * 我们自己的写入会再触发一次变更通知，而那次通知又会被推回会话。
 *
 * 特意做成同步的（比 Chrome 更凶）：它同时验证「不会级联」与「不会死锁」。
 * 幂等快路径如果在排队之后，这个装置会当场把测试挂死。
 */
export function createEchoingStore(
  initial: string | null,
  onWrite: (text: string) => Promise<void>,
): EchoingStore {
  let current = initial
  const writes: string[] = []
  let echoes = 0

  return {
    async read() {
      return current
    },
    async write(text: string) {
      writes.push(text)
      current = text
      echoes += 1
      await onWrite(text)
    },
    async remove() {
      current = null
    },
    get writes() {
      return writes
    },
    get readCount() {
      return 0
    },
    get echoes() {
      return echoes
    },
    peek() {
      return current
    },
  }
}

export interface DelayingStore extends RecordingStore {
  /** 第 n 次写入完成前让出的微任务数（按请求顺序取）。 */
  readonly delays: readonly number[]
}

/**
 * 写入有「耗时」的存储 —— 第 n 次写入要等 `delays[n]` 个微任务才落定。
 *
 * 存在的理由只有一个：**让「并发推送不交错」这条断言真的能失败。**
 * 用普通的内存存储时，写入都是立即完成的，顺序天然正确，
 * 于是那条断言在「没有排队」的实现下也会通过 —— 一条永远绿的断言不算断言
 * （与 T1.4 的反向验证、T3.4 的 `clean` 用例同一个道理）。
 *
 * 不用 `setTimeout`：本包的 tsconfig 里根本没有它（见 `clock.ts`）。
 * 微任务是同一件事的、不依赖真实时间的形式。
 */
export function createDelayingStore(
  initial: string | null,
  delays: readonly number[],
): DelayingStore {
  let current = initial
  const writes: string[] = []
  let call = 0

  const yieldTimes = async (times: number): Promise<void> => {
    for (let i = 0; i < times; i += 1) await Promise.resolve()
  }

  return {
    async read() {
      return current
    },
    async write(text: string) {
      // 请求顺序记在这里，落定顺序记在 `current` —— 两者的差别正是本装置要制造的东西。
      writes.push(text)
      const index = call
      call += 1
      await yieldTimes(delays[index] ?? 0)
      current = text
    },
    async remove() {
      current = null
    },
    get writes() {
      return writes
    },
    get readCount() {
      return 0
    },
    get delays() {
      return delays
    },
    peek() {
      return current
    },
  }
}

// ───────────────────────────── Web 端（扮演） ─────────────────────────────
/**
 * 扮演 Web 端：建一个密文库并立即解锁。
 *
 * 用 core 的 `Vault` 而不是另写一套 —— 测试要证明的性质正是
 * 「扩展端的第二个会话与 Web 端的第一个会话是同一个库」，
 * 两边的加密都必须是同一份实现，否则证明了别的东西。
 */
export function createWebVault(archive: ArchiveV1 = maximalArchiveV1): Promise<Vault> {
  return Vault.create(WEB_PASSPHRASE, { params: TEST_KDF_PARAMS, archive })
}

/** 一份档案的明文 JSON —— 用来当「不该落盘的明文」的反向验证样本。 */
export function plaintextOf(archive: ArchiveV1 = maximalArchiveV1): string {
  return JSON.stringify(archive)
}
