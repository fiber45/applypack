/**
 * T7.4 —— 保存胶水：`submit-released.archiveAfter` → 持久化的最后一跳。
 *
 * ## 为什么这一跳值得一个独立模块
 *
 * T7.3 的状态机刻意不知道密文的存在（`archiveAfter` 带出来就完了）；
 * T1.5 的 vault 又在 core 里，与 DOM 无关。两者之间的接缝如果随手
 * 写在 entry 的副作用块里，就没有任何断言能钉住它。本模块把这条缝
 * 做成纯函数：
 *
 * - **保存只能发生在放行之后**：任何其他状态传入都抛错 ——
 *   「填了一半就存档案」等于把半成品当完整事实污染密文；
 * - **不静默保存**：调不调、什么时候调，是 UI（入口胶水）的显式决策，
 *   本模块只是把「放行后的档案可以安全持久化」这个事实变成类型可查；
 * - **保存器失败不吞**：vault 写盘失败被吞掉 = 用户以为存了其实没存
 *   （「忘记口令数据就没了」的镜像谎言）。错误原样上抛。
 *
 * 保存器注入而不直调 vault：内容脚本保持零 core 依赖的密文知识，
 * entry 胶水把 `vault.saveArchive.bind(vault)` 递进来即可。
 */

import type { ArchiveV1 } from '../../../core/src/schema/index'
import type { PanelState } from './panel'

/** 持久化接缝：与 `Vault.saveArchive` 同签名，注入解耦。 */
export type SaveArchive = (archive: ArchiveV1) => Promise<void>

export type PersistOutcome = 'saved'

/**
 * 放行后的档案持久化。只有 `submit-released` 状态携带 `archiveAfter`
 * （判别联合保证其他状态**没有**这个字段可取），本函数把这一点
 * 变成运行时事实：状态不对就是抛错，不是返回 undefined 让调用方猜。
 */
export async function persistArchiveAfterRelease(
  state: PanelState,
  saveArchive: SaveArchive,
): Promise<PersistOutcome> {
  if (state.kind !== 'submit-released') {
    throw new Error(
      `persistArchiveAfterRelease：状态是 ${state.kind} —— 只有 submit-released ` +
        '携带放行后的档案，保存不能发生在填完之前或拦截之前',
    )
  }
  await saveArchive(state.archiveAfter)
  return 'saved'
}
