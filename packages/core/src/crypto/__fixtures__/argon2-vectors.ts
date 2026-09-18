/**
 * Argon2id **跨实现测试向量**。
 *
 * 本文件由 `scripts/gen-vectors.py` 生成 —— **不要手工编辑**。
 * 手工转录过一次，当场就抄错了一个字符；密码学向量不该经过人手。
 *
 * 来源：`argon2-cffi`（绑定 phc-winner-argon2 官方 C 实现），
 * 用 `argon2.low_level.hash_secret_raw(type=Type.ID)` 生成。
 *
 * 为什么要硬编码参考实现的结果，而不是「再调一次自己」：
 * 自证只能证明代码可重复执行，证明不了**算法实现是对的**。
 * Argon2id 的参数（内存 / 迭代 / 并行度）与输出编码只要有一处理解偏差，
 * 推导出来的密钥就完全是另一串字节 —— 而且不会有任何报错，
 * 用户只会遇到「口令明明对却打不开」。这条用例正是为了让那种偏差无法悄悄上线。
 *
 * 注意盐是**固定值**且仅供测试 —— 生产代码里的盐必须每次随机（见 `kdf.ts`）。
 */

export interface Argon2Vector {
  readonly name: string
  /** 口令原文，按 UTF-8 编码后作为 Argon2 的密码输入。 */
  readonly passphrase: string
  readonly saltHex: string
  readonly memoryKiB: number
  readonly iterations: number
  readonly parallelism: number
  readonly keyLength: number
  /** 参考实现输出的原始密钥，hex 编码。 */
  readonly kekHex: string
}

export const ARGON2ID_VECTORS: readonly Argon2Vector[] = [
  {
    name: "ASCII 口令 · 小参数",
    passphrase: "correct horse battery staple",
    saltHex: "00000000000000000000000000000000",
    memoryKiB: 1024,
    iterations: 2,
    parallelism: 1,
    keyLength: 32,
    kekHex: "fe8abf22c00e762524d9da62137d8555fde4f36c1b161489168ef54f1dc0f058"
  },
  {
    name: "UTF-8 中文口令 · p=2",
    passphrase: "简历智能生成 applypack",
    saltHex: "0102030405060708090a0b0c0d0e0f10",
    memoryKiB: 2048,
    iterations: 3,
    parallelism: 2,
    keyLength: 32,
    kekHex: "ceb2bb8c1ad9cfd34d81f55cb4719a34a2bbdf433719f47537bb95012d51c61c"
  },
  {
    name: "单字符口令 · t=4",
    passphrase: "x",
    saltHex: "ffffffffffffffffffffffffffffffff",
    memoryKiB: 1024,
    iterations: 4,
    parallelism: 1,
    keyLength: 32,
    kekHex: "74f3509bd433c8e910f3cf028e15881a64474234b720e15d825496f700cf44e8"
  },
  {
    name: "生产默认参数（m=64 MiB, t=3, p=1）",
    passphrase: "fiber45",
    saltHex: "00112233445566778899aabbccddeeff",
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
    keyLength: 32,
    kekHex: "12238e94a44106159ef4df62d1646fbed6f64c923e9876479179a4b48f2cc8ce"
  },
]
