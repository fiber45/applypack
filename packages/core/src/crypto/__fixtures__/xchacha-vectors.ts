/**
 * XChaCha20-Poly1305 的**跨实现测试向量**。
 *
 * 本文件由 `scripts/gen-vectors.py` 生成 —— **不要手工编辑**。
 *
 * 来源：`PyNaCl`（绑定 libsodium 官方 C 实现）通过
 * `nacl.bindings.crypto_aead_xchacha20poly1305_ietf_encrypt` 生成。
 * 用途是验证 JS 包装层的**参数传递顺序与编码**没搞错 ——
 * 这类错误（nonce 与 AAD 传反、把 tag 也算进明文长度）不会崩溃，只会静默产出别的结果。
 *
 * 另有一个独立纯 JS 实现（`@noble/ciphers`）在 `aead.test.ts` 里做双向互解，
 * 验证算法本身而非传参。
 *
 * ── 为什么不是 AES-256-GCM ──
 * `DESIGN.md` 最初写的是 AES-GCM，实现时实测发现 **libsodium.js 的 WASM 构建
 * （含 `libsodium-wrappers-sumo`）根本不包含 AES-256-GCM** ——
 * `crypto_aead_aes256gcm_is_available` 在标准版里不存在、在 sumo 版里是 `undefined`。
 * 这不是配置问题，是构建时就没有（wasm 无 AES-NI 指令，上游选择不编译）。
 * 要用 AES-GCM 就只能改用 WebCrypto，那意味着 `core` 必须放弃零全局依赖、
 * 改成由 Web 端与扩展端各自注入原语实现 —— 多一整层间接。
 * 故改用 libsodium 官方推荐、且永远可用的 XChaCha20-Poly1305。记录见 DESIGN.md ADR-9。
 */

export interface XChaChaVector {
  readonly name: string
  readonly keyHex: string
  readonly nonceHex: string
  readonly aadHex: string
  readonly plaintextHex: string
  /** 密文与 16 字节 Poly1305 认证标签拼接后的完整输出。 */
  readonly ciphertextHex: string
}

export const XCHACHA_VECTORS: readonly XChaChaVector[] = [
  {
    name: "空明文 + 空 AAD（只剩认证标签）",
    keyHex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    nonceHex: "000102030405060708090a0b0c0d0e0f1011121314151617",
    aadHex: "",
    plaintextHex: "",
    ciphertextHex: "2d351a65cd1abe591f22dc1269c82d90"
  },
  {
    name: "ASCII 明文 + 非空 AAD",
    keyHex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    nonceHex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    aadHex: "6170706c797061636b2f76312f7061796c6f6164",
    plaintextHex: "6170706c797061636b2070726f6265",
    ciphertextHex: "e283292bb8e28d3eaea512a28cbefc78a58d2cbbece0403cef60d6a84f4026"
  },
  {
    name: "UTF-8 中文明文",
    keyHex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    nonceHex: "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a",
    aadHex: "637478",
    plaintextHex: "e7ae80e58e86e699bae883bde7949fe68890",
    ciphertextHex: "76c8a08be12cd04b998adedc2bd1bd0b115ea35fbcd6d5d80f1b868037ba52075dd2"
  },
  {
    name: "40 字节明文（验证只多出 16 字节标签）",
    keyHex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    nonceHex: "000000000000000000000000000000000000000000000000",
    aadHex: "",
    plaintextHex: "11111111111111111111111111111111111111111111111111111111111111111111111111111111",
    ciphertextHex: "84179dd6fd99f408079f6e28fd072ffb2dadbc826b815c1adafc844cc6f70b20779b71a928534be12f82cca734abc7beb2dd638c9014ed3d"
  },
]
