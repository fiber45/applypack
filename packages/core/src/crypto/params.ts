/**
 * 加密参数与取值依据。
 *
 * `TASKS.md` 的 T1.2 明确要求「参数写进代码注释与文档，并说明取值依据」。
 * 理由很直接：KDF 参数是**唯一一个「改小一点就悄悄变弱、且没有任何功能会坏掉」**的地方。
 * 没有依据的注释挡不住「为了让测试跑快点把内存调成 8 MiB」这种改动，
 * 所以下面每一档都写上它对齐的是哪份公开建议。
 */
import { CryptoError } from './errors'

/** localStorage 里的密文库在长期存续中会反复派生密钥，这是唯一的口令强度来源。 */
export interface KdfParams {
  /** 目前只支持 Argon2id —— 它是 Argon2 家族中抗侧信道与抗 GPU 的折中方案。 */
  readonly algorithm: 'argon2id'
  /** 内存开销（KiB）。这是抗 GPU/ASIC 的主要成本项。 */
  readonly memoryKiB: number
  /** 时间开销（迭代轮数）。 */
  readonly iterations: number
  /** 并行度（lane 数）。 */
  readonly parallelism: number
  /** 派生密钥长度（字节）。本层只服务 32 字节对称密钥。 */
  readonly keyLength: number
}

/** 盐长度。Argon2 规范要求 ≥ 8 字节，16 是通行做法（与密码哈希惯例一致）。 */
export const KDF_SALT_BYTES = 16

/** 对称密钥长度。XChaCha20 与 Poly1305 都使用 256-bit 密钥。 */
export const KEY_BYTES = 32

/**
 * AEAD nonce 长度。XChaCha20-Poly1305 用的是**扩展** nonce（192-bit），
 * 这正是选它的关键原因 —— 见下方 `AEAD_ALGORITHM` 注释。
 */
export const AEAD_NONCE_BYTES = 24

/** Poly1305 认证标签长度。 */
export const AEAD_TAG_BYTES = 16

/**
 * AEAD 算法。
 *
 * ── 为什么不是 AES-256-GCM ──
 * `DESIGN.md` 初稿写的是 AES-GCM。实现时实测发现 **libsodium.js 的 WASM 构建
 * （含 `libsodium-wrappers-sumo`）根本不包含 AES-256-GCM**：
 * `crypto_aead_aes256gcm_is_available` 在标准版里压根不存在，在 sumo 版里是 `undefined`。
 * 不是配置问题 —— wasm 没有 AES-NI 指令，上游选择不编译这条路径。
 * 要用 AES-GCM 就只能改走 WebCrypto，那意味着 `core` 必须放弃「零全局依赖」，
 * 改成由 Web 端与扩展端各自注入原语实现，多出一整层间接。
 *
 * ── 为什么 XChaCha20-Poly1305 反而是更好的选择 ──
 * 1. **随机 nonce 就安全**：192-bit nonce 允许每条记录独立随机生成，无需计数器。
 *    AES-GCM 只有 96-bit nonce，同一密钥下随机使用约 2^32 条记录后就有碰撞风险，
 *    而 **nonce 复用对 GCM 是灾难性的**（泄漏明文异或，且认证密钥可被恢复）。
 *    选一个「随机就安全」的算法，等于消掉了一整类事故。
 * 2. **不依赖硬件**：wasm 里没有 AES-NI，ChaCha20 是纯软件友好的 ARX 结构。
 * 3. 它是 libsodium 推荐的默认 AEAD，且随 libsodium 一起经过长期审计。
 *
 * 代价：偏离了「NIST 标准算法」的合规叙事（Poly1305 是 RFC 8439，XChaCha20 是
 * libsodium 的 IETF 草案扩展，在 TLS 1.3 中已是标准套件）。对个人求职工具而言可接受。
 * 记录见 `DESIGN.md` 的 ADR-9。
 */
export const AEAD_ALGORITHM = 'XChaCha20-Poly1305'

/** 本实现当前能解开的 AEAD 算法集合。未来的新算法只需加进来，信封格式不必变。 */
export const SUPPORTED_AEAD_ALGORITHMS: readonly string[] = [AEAD_ALGORITHM]

/**
 * 生产默认 KDF 参数：**m=64 MiB, t=3, p=1**。
 *
 * 依据：
 * - **对照 OWASP Password Storage Cheat Sheet**（Argon2id 推荐档）：
 *   最低档 m=19 MiB / t=2 / p=1，次低档 m=47 MiB / t=1 / p=1。
 *   这里取 m=64 MiB / t=3 / p=1，**高于 OWASP 的两个档位**。
 * - **对照 RFC 9106 §4**「内存受限环境」建议 m=64 MiB / t=3 / p=4：
 *   内存与轮数与之对齐，但并行度取 1。
 * - **p=1 的理由**：OWASP 的每一档推荐都是 p=1；并行度主要影响实现能否吃满多核，
 *   而 p>1 会在低端移动设备上抬高内存峰值与调度差异。浏览器场景下 p=1 最稳。
 * - **为什么是 64 MiB 而不是更高**：这是 libsodium `crypto_pwhash` 的 INTERACTIVE
 *   档内存量（用户可感知等待与强度的平衡点）。再往上（如 256 MiB）会让低端手机
 *   在解锁时明显卡顿甚至触发标签页 OOM，而这一点会直接转化为「用户放弃设置口令」。
 *
 * 实测：本机 Node 22 下约 250–350 ms。浏览器端同量级。
 */
export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
  keyLength: 32,
}

/**
 * 参数上限。
 *
 * **这不是为了限制用户，而是因为信封里的 KDF 参数是外部输入。**
 * 一个 `.vault` 文件可以被任何人构造 —— 攻击者只要写一个 `memoryKiB: 4194304`
 * （4 GiB）的信封，受害者一点「导入」就会让浏览器尝试分配 4 GiB 内存。
 * 同理，`iterations: 100000` 可以让解锁变成分钟级的卡死。
 * 因此这些字段必须按不可信输入校验，而不是信任它们来自自己人。
 *
 * 上限取值：256 MiB 覆盖了合理范围内的未来调参（当前默认 64 MiB 的 4 倍），
 * 同时远低于会让浏览器标签页崩溃的量级。
 */
export const MAX_KDF_MEMORY_KIB = 262_144
export const MAX_KDF_ITERATIONS = 64
export const MAX_KDF_PARALLELISM = 16

/**
 * 校验一组 KDF 参数是否合法。
 *
 * 分两类拒绝：
 *   1. **技术非法** —— 违反 Argon2 规范本身（内存 < 8×并行度、轮数为 0 等），
 *      这类参数会让底层库行为未定义。
 *   2. **越界** —— 超出上面的安全上限（防 DoS）。
 */
export function assertKdfParams(params: KdfParams): void {
  if (params.algorithm !== 'argon2id') {
    throw new CryptoError('invalid_params', `不支持的 KDF 算法：${String(params.algorithm)}`)
  }

  for (const [field, value] of [
    ['memoryKiB', params.memoryKiB],
    ['iterations', params.iterations],
    ['parallelism', params.parallelism],
    ['keyLength', params.keyLength],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new CryptoError('invalid_params', `KDF 参数 ${field} 必须是正整数，收到 ${String(value)}`)
    }
  }

  // Argon2 规范要求：内存块数至少是并行度的 8 倍。
  if (params.memoryKiB < 8 * params.parallelism) {
    throw new CryptoError(
      'invalid_params',
      `KDF 内存 ${params.memoryKiB} KiB 低于 8 × 并行度（${8 * params.parallelism} KiB）的规范下限`,
    )
  }

  if (params.memoryKiB > MAX_KDF_MEMORY_KIB) {
    throw new CryptoError(
      'invalid_params',
      `KDF 内存 ${params.memoryKiB} KiB 超过上限 ${MAX_KDF_MEMORY_KIB} KiB`,
    )
  }
  if (params.iterations > MAX_KDF_ITERATIONS) {
    throw new CryptoError(
      'invalid_params',
      `KDF 迭代次数 ${params.iterations} 超过上限 ${MAX_KDF_ITERATIONS}`,
    )
  }
  if (params.parallelism > MAX_KDF_PARALLELISM) {
    throw new CryptoError(
      'invalid_params',
      `KDF 并行度 ${params.parallelism} 超过上限 ${MAX_KDF_PARALLELISM}`,
    )
  }

  // 本层只服务 32 字节对称密钥 —— 允许其他长度只会让「信封声称的密钥长度」
  // 与实际解密用的长度有分歧的空间。
  if (params.keyLength !== KEY_BYTES) {
    throw new CryptoError(
      'invalid_params',
      `KDF 密钥长度必须是 ${KEY_BYTES} 字节，收到 ${params.keyLength}`,
    )
  }
}
