/**
 * 测试用 KDF 参数（降档，**只降耗时，不降被测性质**）。
 *
 * 生产档位是 m=64 MiB / t=3，一次派生约 250–350 ms。密文库的每个用例
 * 至少要派生两次密钥（封 DEK + 解 DEK），几十个用例就是几十秒 ——
 * 而一个跑得慢的测试套件迟早会被跳过，被跳过的测试等于不存在。
 *
 * 这里降到 1 MiB / t=1。**参数校验与上限守卫由 `crypto/params.ts` 的单测覆盖**，
 * 密文库层要验的是「编排顺序对不对」，不是「Argon2 强不强」。
 * 所以降档不影响本层任何一条断言的有效性。
 *
 * ⚠️ 反过来，**不要**在 crypto 层用这组参数 —— 那里有一条断言专门盯着
 * 「生产默认值不得被悄悄调小」。
 */
import type { KdfParams } from '../../crypto/index'

export const TEST_KDF_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 1024,
  iterations: 1,
  parallelism: 1,
  keyLength: 32,
}
