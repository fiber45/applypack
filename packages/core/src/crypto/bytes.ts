/**
 * 字节与字符串的编解码，以及随机数。
 *
 * **这个文件是 crypto 层里唯一直接接触 libsodium 的地方。**
 *
 * 为什么编码也走 libsodium 而不是自己写：`core` 的 `lib` 白名单里没有 DOM，
 * 因此 `TextEncoder` / `TextDecoder` / `btoa` / `atob` / `Buffer` 全都不可用 ——
 * 这正是「零全局依赖」约束想要的效果。剩下两条路是「用 libsodium 的
 * `from_string` / `to_base64`」或「自己手写 UTF-8 与 base64」。
 * 手写编码的 bug（代理对、非法码点、base64 padding）不会崩溃，只会产出别的字节，
 * 属于「不会报错的那类错误」—— 所以用库。
 *
 * 代价：所有编解码函数都是异步的（libsodium 的 wasm 需要先就绪）。
 * 这是刻意选择：伪装成同步只会制造「忘了初始化」这一类难查的 bug，
 * 而调用方本来就在异步的存储路径上。
 */
/**
 * ⚠️ 必须用 **default 导入**，不能用 `import * as sodium`。
 *
 * libsodium-wrappers 的 ESM 入口只把编码类工具（`from_string` / `to_base64` /
 * `base64_variants` …）作为具名导出，**全部 `crypto_*` 函数与 `randombytes_buf`
 * 都挂在 default 对象上，而且要等 `ready` resolve 之后才被挂上去**。
 * 用命名空间导入会拿到一个「有 ready 但没有 randombytes_buf」的对象 ——
 * 报错信息是 `randombytes_buf is not a function`，看起来像用法问题，实为导入方式问题。
 */
import sodium from 'libsodium-wrappers'

import { CryptoError } from './errors'

let readyPromise: Promise<void> | undefined

/**
 * 初始化密码学后端（libsodium 的 wasm 模块）。幂等，可重复调用。
 *
 * 所有加密 API 内部都会先 `await` 它，因此调用方通常不需要显式调用；
 * 需要提前把 wasm 加载完（避免用户第一次点「解锁」时才等）时才有用。
 */
export async function initCrypto(): Promise<void> {
  readyPromise ??= sodium.ready
  return readyPromise
}

/** UTF-8 文本 → 字节。 */
export async function utf8ToBytes(text: string): Promise<Uint8Array> {
  await initCrypto()
  return sodium.from_string(text)
}

/**
 * 字节 → UTF-8 文本。
 *
 * 只在字节不是合法 UTF-8 时抛错。本层不包装这个错误 ——
 * 「解出来的东西不是文本」在调用方（信封层）的语境里含义是「数据已损坏」，
 * 由那一层转成 `decryption_failed` 更准确。
 */
export async function bytesToUtf8(bytes: Uint8Array): Promise<string> {
  await initCrypto()
  return sodium.to_string(bytes)
}

/** 字节 → 标准 base64（带 padding）。与外部工具互操作时选这个变体。 */
export async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  await initCrypto()
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL)
}

/** 标准 base64 → 字节。非法输入抛 `malformed_envelope`。 */
export async function base64ToBytes(text: string): Promise<Uint8Array> {
  await initCrypto()
  try {
    return sodium.from_base64(text, sodium.base64_variants.ORIGINAL)
  } catch {
    throw new CryptoError('malformed_envelope', 'base64 字段无法解码')
  }
}

/**
 * 密码学安全随机字节。
 *
 * libsodium 内部使用运行环境的 CSPRNG（浏览器为 `crypto.getRandomValues`），
 * 绝不用 `Math.random`。
 */
export async function randomBytes(length: number): Promise<Uint8Array> {
  await initCrypto()
  if (!Number.isInteger(length) || length < 0) {
    throw new CryptoError('invalid_params', `随机字节长度必须是非负整数，收到 ${String(length)}`)
  }
  if (length === 0) return new Uint8Array(0)
  return sodium.randombytes_buf(length)
}
