/**
 * fixture 与断言共用的 hex 编解码。
 *
 * 刻意用同步的纯逻辑实现，不经过 libsodium：
 * 测试向量的**读取**环节如果也依赖被测对象，出现偏差时就分不清是
 * 「向量读错了」还是「实现算错了」。
 */

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`hex 长度必须是偶数，收到 ${hex.length}`)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error(`hex 含非法字符：${hex.slice(i * 2, i * 2 + 2)}`)
    bytes[i] = byte
  }
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}
