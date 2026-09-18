#!/usr/bin/env python3
"""生成 `src/crypto/__fixtures__/` 下的跨实现测试向量。

为什么要有这个脚本：这些 hex 值第一次是手抄进 fixture 的，**当场就抄错了一个字符**
（两个独立实现的输出一致、唯独 fixture 不同，才暴露出问题）。
密码学测试向量的值不该经过人手 —— 一旦抄错，测试会以「实现有问题」的面目失败，
排查方向从一开始就是歪的。

用法：
    python -m venv .venv && .venv/bin/pip install argon2-cffi pynacl
    python scripts/gen-vectors.py

依赖的是**两个参考实现**，而不是本项目自己的 JS 库：
  - argon2-cffi  → 绑定 phc-winner-argon2（Argon2 官方 C 实现）
  - PyNaCl       → 绑定 libsodium（XChaCha20-Poly1305 官方 C 实现）
"""

from __future__ import annotations

import json
from pathlib import Path

import nacl.bindings
from argon2.low_level import Type, hash_secret_raw

FIXTURES = Path(__file__).resolve().parent.parent / "src" / "crypto" / "__fixtures__"


def hexed(data: bytes) -> str:
    return data.hex()


# ---------------------------------------------------------------- Argon2id


def build_argon2_vectors() -> list[dict[str, object]]:
    def case(name: str, passphrase: str, salt: bytes, m: int, t: int, p: int, keylen: int = 32):
        kek = hash_secret_raw(
            secret=passphrase.encode("utf-8"),
            salt=salt,
            time_cost=t,
            memory_cost=m,
            parallelism=p,
            hash_len=keylen,
            type=Type.ID,
        )
        return {
            "name": name,
            "passphrase": passphrase,
            "saltHex": hexed(salt),
            "memoryKiB": m,
            "iterations": t,
            "parallelism": p,
            "keyLength": keylen,
            "kekHex": hexed(kek),
        }

    return [
        case("ASCII 口令 · 小参数", "correct horse battery staple", bytes(16), 1024, 2, 1),
        case("UTF-8 中文口令 · p=2", "简历智能生成 applypack", bytes(range(1, 17)), 2048, 3, 2),
        case("单字符口令 · t=4", "x", bytes([0xFF]) * 16, 1024, 4, 1),
        case(
            "生产默认参数（m=64 MiB, t=3, p=1）",
            "fiber45",
            bytes.fromhex("00112233445566778899aabbccddeeff"),
            65536,
            3,
            1,
        ),
    ]


ARGON2_HEADER = '''/**
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
'''

# hex 编解码由 `__fixtures__/hex.ts` 提供 —— 测试向量的读取环节不该依赖被测对象。
ARGON2_FOOTER = ']\n'


# ------------------------------------------------- XChaCha20-Poly1305


def build_xchacha_vectors() -> list[dict[str, str]]:
    key = bytes(range(32))

    def case(name: str, msg: bytes, aad: bytes, nonce: bytes) -> dict[str, str]:
        ct = nacl.bindings.crypto_aead_xchacha20poly1305_ietf_encrypt(msg, aad, nonce, key)
        # 自校验：生成时就把往返跑一遍，避免把一个不通的组合写进 fixture
        assert nacl.bindings.crypto_aead_xchacha20poly1305_ietf_decrypt(ct, aad, nonce, key) == msg
        return {
            "name": name,
            "keyHex": hexed(key),
            "nonceHex": hexed(nonce),
            "aadHex": hexed(aad),
            "plaintextHex": hexed(msg),
            "ciphertextHex": hexed(ct),
        }

    return [
        case("空明文 + 空 AAD（只剩认证标签）", b"", b"", bytes(range(24))),
        case("ASCII 明文 + 非空 AAD", b"applypack probe", b"applypack/v1/payload", bytes([0xAA]) * 24),
        case("UTF-8 中文明文", "简历智能生成".encode("utf-8"), b"ctx", bytes([0x5A]) * 24),
        case("40 字节明文（验证只多出 16 字节标签）", bytes([0x11]) * 40, b"", bytes(24)),
    ]


XCHACHA_HEADER = '''/**
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
'''

XCHACHA_FOOTER = ''']
'''


def render_ts(header: str, rows: list[dict[str, object]], footer: str) -> str:
    lines: list[str] = []
    for row in rows:
        lines.append("  {")
        for index, (key, value) in enumerate(row.items()):
            literal = json.dumps(value, ensure_ascii=False)
            comma = "" if index == len(row) - 1 else ","
            lines.append(f"    {key}: {literal}{comma}")
        lines.append("  },")
    return header + "\n".join(lines) + "\n" + footer


def main() -> None:
    targets = [
        ("argon2-vectors.ts", ARGON2_HEADER, build_argon2_vectors(), ARGON2_FOOTER),
        ("xchacha-vectors.ts", XCHACHA_HEADER, build_xchacha_vectors(), XCHACHA_FOOTER),
    ]
    for filename, header, rows, footer in targets:
        path = FIXTURES / filename
        # newline="\n" 是刻意的：默认会按平台写 CRLF，在 Windows 上生成的文件
        # 与仓库里其余文件（.gitattributes 统一为 LF）不一致，每次生成都会多出无意义的 diff。
        path.write_text(render_ts(header, rows, footer), encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(FIXTURES.parent.parent.parent.parent)} ({len(rows)} vectors)")


if __name__ == "__main__":
    main()
