/**
 * `@applypack/core/crypto` —— 加密原语层。
 *
 * 职责边界：**只回答「怎么安全地加密一段字节」，不回答「存在哪、存几条、什么时候存」**。
 * 存储与多记录的组织属于 `vault` 层（T1.3）。
 *
 * ```
 * 口令 ──Argon2id(salt, m=64MiB/t=3/p=1)──► KEK ──封装──► DEK ──加密──► 密文
 * ```
 *
 * 加密算法为 **XChaCha20-Poly1305**（不是 AES-256-GCM，原因见 `params.ts` 与 ADR-9）。
 *
 * 所有异步函数内部都会确保 libsodium 的 wasm 已就绪，调用方通常无需显式初始化。
 *
 * @see DESIGN.md 3.2 · AGENTS.md §5 §6 · TASKS.md T1.2
 */

export {
  aeadOpen,
  aeadSeal,
  generateDek,
  type SealedBox,
} from './aead'

export {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  initCrypto,
  randomBytes,
  utf8ToBytes,
} from './bytes'

export { CryptoError, type CryptoErrorCode } from './errors'

export {
  ENVELOPE_FORMAT,
  ENVELOPE_VERSION,
  openArchive,
  sealArchive,
  type EnvelopeKdf,
  type EnvelopeSealedBox,
  type EncryptedEnvelope,
} from './envelope'

export { deriveKek } from './kdf'

export {
  AEAD_ALGORITHM,
  AEAD_NONCE_BYTES,
  AEAD_TAG_BYTES,
  DEFAULT_KDF_PARAMS,
  KDF_SALT_BYTES,
  KEY_BYTES,
  MAX_KDF_ITERATIONS,
  MAX_KDF_MEMORY_KIB,
  MAX_KDF_PARALLELISM,
  SUPPORTED_AEAD_ALGORITHMS,
  assertKdfParams,
  type KdfParams,
} from './params'
