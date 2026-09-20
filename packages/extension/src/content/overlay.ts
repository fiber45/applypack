/**
 * T9.2b —— overlay 渲染层：PanelState → 页面上的真 DOM。
 *
 * ## 位置：状态机与真实 DOM 之间最后一层皮
 *
 * 面板状态机（panel.ts）的判别联合**就是** UI 契约：`locked` 结构上
 * 没有 preview，渲染层想画半残面板都拿不到数据 —— 这一层不做任何
 * 业务判断，只把状态画出来，把用户动作递回 actions。
 *
 * ## DOM 接口：自己声明，不用 `lib: ["DOM"]`
 *
 * 与 `fill/dom.ts`（读页面）同一个理由：extension 的 tsconfig 里
 * `document` 这个全局不存在，渲染层的可测性不允许靠「测试机恰好有
 * DOM」活着。本层声明的是**写入侧**的最小结构面（createElement /
 * appendChild / addEventListener / value / checked），生产里传真实
 * `document`，测试里传 jsdom —— 谁也不 import 谁。
 *
 * ## 零样式依赖
 *
 * 内容脚本没有样式表注入通道（那要加 manifest 字段），全部样式走
 * 内联 style。面板固定在视口右上，z-index 拉满 —— 网申表单自己的
 * 浮层不该盖住确认面板。
 */
import type { BackfillDecision } from '../fill/backfill'
import type { PanelState } from './panel'

// ─────────────────────── 结构化 DOM 接口（写入侧） ───────────────────────

export interface OverlayNode {
  readonly tagName: string
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | null
  appendChild<T extends OverlayNode>(child: T): T
  /** 清空宿主用的快捷面（元素都支持）。 */
  textContent: string
  /** input / textarea 专用；其他元素天然不用。 */
  value: string
  checked: boolean
  disabled: boolean
  readOnly: boolean
  addEventListener(type: string, listener: () => void): void
}

export interface OverlayRoot {
  createElement(tag: string): OverlayNode
}

export interface OverlayHost {
  appendChild<T extends OverlayNode>(child: T): T
  textContent: string
}

/** 正控守卫：结构不符当场抛错，而不是三层之后的 undefined 里炸出来。 */
export function asOverlayRoot(candidate: unknown): OverlayRoot {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as OverlayRoot).createElement !== 'function'
  ) {
    throw new TypeError('asOverlayRoot：入参缺少 createElement，不是 Document 形状')
  }
  return candidate as OverlayRoot
}

function asOverlayHost(candidate: unknown): OverlayHost {
  const host = candidate as OverlayHost
  if (typeof candidate !== 'object' || candidate === null || typeof host.appendChild !== 'function') {
    throw new TypeError('asOverlayHost：入参缺少 appendChild，不是元素形状')
  }
  return host
}

// ─────────────────────────────── 动作契约 ───────────────────────────────

/** 面板只递动作，不递状态 —— 状态推进是会话控制器（T9.2c）的事。 */
export interface OverlayActions {
  unlock(envelopeText: string, passphrase: string): void
  approve(keys: readonly string[]): void
  review(): void
  release(decisions: readonly BackfillDecision[]): void
}

/** 状态之外、渲染需要的附加数据（判别联合装不下的页面事实）。 */
export interface OverlayExtra {
  /** submit-released：回填后的新信封文本（vault.toVaultText()），回 Web 端粘贴落库。 */
  readonly envelopeText?: string
  /** 会话级错误（控制器接住的意外失败）—— 画成红条，绝不静默。 */
  readonly errorText?: string
}

// ─────────────────────────────── 渲染 ───────────────────────────────

const PANEL_STYLE =
  'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;max-height:80vh;' +
  'overflow:auto;background:#ffffff;color:#0f172a;border:1px solid #cbd5e1;border-radius:8px;' +
  'padding:12px;font:12px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px rgba(15,23,42,.18)'
const TEXT_STYLE = 'width:100%;box-sizing:border-box;margin:4px 0 8px;padding:4px;' +
  'border:1px solid #cbd5e1;border-radius:4px;font:12px/1.4 monospace'
const BUTTON_STYLE =
  'display:inline-block;padding:4px 10px;border:0;border-radius:4px;background:#0f172a;' +
  'color:#ffffff;font:12px system-ui;cursor:pointer'
const GHOST_BUTTON_STYLE = BUTTON_STYLE.replace('#0f172a', '#e2e8f0').replace('#ffffff', '#0f172a')
const ERROR_STYLE =
  'background:#fee2e2;color:#991b1b;border-radius:4px;padding:6px 8px;margin:4px 0 8px'

function el(root: OverlayRoot, tag: string, text?: string): OverlayNode {
  const node = root.createElement(tag)
  if (text !== undefined) node.textContent = text
  return node
}

function button(root: OverlayRoot, testid: string, text: string, style = BUTTON_STYLE): OverlayNode {
  const node = el(root, 'button')
  node.setAttribute('type', 'button')
  node.setAttribute('data-testid', testid)
  node.setAttribute('style', style)
  node.textContent = text
  return node
}

function label(root: OverlayRoot, text: string): OverlayNode {
  return el(root, 'div', text)
}

/** 顶部标题 + 平台行：各状态共用的头（applied / submit-review 无平台信息）。 */
function header(root: OverlayRoot, platform: string | null): OverlayNode {
  const head = el(root, 'div', 'applypack · 投递包')
  head.setAttribute('style', 'font-weight:700;margin-bottom:4px')
  const meta = label(root, `平台：${platform ?? '未识别（按字段特征填充）'}`)
  meta.setAttribute('style', 'color:#475569;margin-bottom:8px')
  head.appendChild(meta)
  return head
}

/**
 * 把状态画进宿主。**每次全量重绘**：面板是纯函数式的状态投影，
 * 增量更新省下的几次 DOM 操作，抵不上状态与画面悄悄分叉的风险。
 */
export function renderOverlay(
  rootCandidate: OverlayRoot,
  hostCandidate: unknown,
  state: PanelState,
  actions: OverlayActions,
  extra: OverlayExtra = {},
): void {
  const root = asOverlayRoot(rootCandidate)
  const host = asOverlayHost(hostCandidate)
  host.textContent = '' // 全量重绘：先清场

  if (state.kind === 'closed') return

  const panel = el(root, 'div')
  panel.setAttribute('data-testid', 'overlay-panel')
  panel.setAttribute('style', PANEL_STYLE)
  if (extra.errorText !== undefined) {
    const sessionError = el(root, 'div', extra.errorText)
    sessionError.setAttribute('data-testid', 'overlay-session-error')
    sessionError.setAttribute('style', ERROR_STYLE)
    panel.appendChild(sessionError)
  }
  host.appendChild(panel)

  if (state.kind === 'locked' || state.kind === 'unlock-failed') {
    panel.appendChild(header(root, state.platform))
    const featureLine = label(root, `特征 ${state.featureCount} 处`)
    featureLine.setAttribute('style', 'color:#475569;margin-bottom:8px')
    panel.appendChild(featureLine)
    if (state.kind === 'unlock-failed') {
      const error = el(root, 'div', '解锁失败：口令不对，或信封已损坏。')
      error.setAttribute('data-testid', 'overlay-error')
      error.setAttribute('style', ERROR_STYLE)
      panel.appendChild(error)
    }
    panel.appendChild(label(root, '① 打开 Web 端「档案」页，点「复制密文信封」'))
    panel.appendChild(label(root, '② 粘贴信封文本：'))
    const envelope = root.createElement('textarea')
    envelope.setAttribute('data-testid', 'overlay-envelope')
    envelope.setAttribute('style', TEXT_STYLE + 'height:72px')
    envelope.setAttribute('placeholder', '在此粘贴密文信封（JSON）')
    panel.appendChild(envelope)
    panel.appendChild(label(root, '③ 输入口令：'))
    const pass = root.createElement('input')
    pass.setAttribute('type', 'password')
    pass.setAttribute('data-testid', 'overlay-passphrase')
    pass.setAttribute('style', TEXT_STYLE)
    panel.appendChild(pass)
    const unlockBtn = button(root, 'overlay-unlock', '解锁并预览')
    unlockBtn.addEventListener('click', () => {
      actions.unlock(envelope.value, pass.value)
    })
    panel.appendChild(unlockBtn)
    return
  }

  if (state.kind === 'ready') {
    panel.appendChild(header(root, state.platform))
    if (state.staleAdapter) {
      const warn = el(root, 'div', '平台页面版本与适配器不一致 —— 匹配可能过时，请重点核对。')
      warn.setAttribute('style', ERROR_STYLE)
      panel.appendChild(warn)
    }
    const counts = state.preview.counts
    panel.appendChild(
      label(
        root,
        `自动填 ${counts.fillByAdapter} · 启发式猜 ${counts.fillByHeuristic} · ` +
          `缺口 ${counts.gap}（拦路 ${counts.blockingGap}）· 上传槽 ${counts.fileSlot}`,
      ),
    )
    const list = el(root, 'div')
    const checkboxes: { key: string; node: OverlayNode }[] = []
    for (const item of state.preview.plan.items) {
      if (item.kind !== 'fill') continue
      const row = el(root, 'label')
      row.setAttribute('data-testid', `overlay-item-${checkboxes.length}`)
      row.setAttribute('style', 'display:block;margin:2px 0')
      const box = root.createElement('input')
      box.setAttribute('type', 'checkbox')
      box.checked = true
      row.appendChild(box)
      const tag = item.source === 'heuristic' ? '（猜）' : ''
      row.appendChild(el(root, 'span', `${tag}${item.path} = ${item.value}`))
      list.appendChild(row)
      checkboxes.push({ key: item.key, node: box })
    }
    panel.appendChild(list)
    for (const gap of state.preview.blockingGaps) {
      const warn = el(root, 'div', `缺：${gap.path}（档案里没有对应值）`)
      warn.setAttribute('style', 'color:#b45309')
      panel.appendChild(warn)
    }
    const approveBtn = button(root, 'overlay-approve', '批准写入')
    approveBtn.addEventListener('click', () => {
      actions.approve(checkboxes.filter((c) => c.node.checked).map((c) => c.key))
    })
    panel.appendChild(approveBtn)
    return
  }

  if (state.kind === 'applied') {
    panel.appendChild(header(root, null))
    panel.appendChild(label(root, `已写入 ${state.result.appliedKeys.length} 个字段。`))
    panel.appendChild(
      label(root, '填完表单、点提交前，先回来做「提交前审查」—— 页面新填的值可以回写进档案。'),
    )
    const reviewBtn = button(root, 'overlay-review', '提交前审查 / 回填', GHOST_BUTTON_STYLE)
    reviewBtn.addEventListener('click', () => {
      actions.review()
    })
    panel.appendChild(reviewBtn)
    return
  }

  if (state.kind === 'submit-review') {
    panel.appendChild(header(root, null))
    panel.appendChild(
      label(
        root,
        `本次提交：自动填 ${state.summary.autoFilled.length} · ` +
          `启发式猜 ${state.summary.heuristicGuessed.length}` +
          (state.summary.emptyRequired.length > 0
            ? ` · 必填未填 ${state.summary.emptyRequired.length}`
            : ''),
      ),
    )
    if (state.proposal.items.length > 0) {
      panel.appendChild(label(root, '页面新填、档案没有的值：'))
      for (const item of state.proposal.items) {
        panel.appendChild(
          label(
            root,
            `· ${item.target}：页面「${item.pageValue}」 ${item.status === 'new' ? '（档案没有）' : `（档案现为「${item.archiveValue ?? ''}」）`}`,
          ),
        )
      }
    } else {
      panel.appendChild(label(root, '页面没有档案缺的新值，无需回填。'))
    }
    const releaseBackfill = button(root, 'overlay-release-backfill', '放行并回填')
    releaseBackfill.addEventListener('click', () => {
      actions.release(state.proposal.items.map((item) => ({ id: item.id })))
    })
    panel.appendChild(releaseBackfill)
    const releasePlain = button(root, 'overlay-release', '放行（不回填）', GHOST_BUTTON_STYLE)
    releasePlain.addEventListener('click', () => {
      actions.release([])
    })
    releasePlain.setAttribute('style', GHOST_BUTTON_STYLE + 'margin-left:6px')
    panel.appendChild(releasePlain)
    return
  }

  // submit-released：终态。新信封文本是回填的落库出口 —— 粘回 Web 端。
  panel.appendChild(el(root, 'div', '已放行，档案已按回填决策更新。'))
  panel.appendChild(label(root, '新信封（复制回 Web 端「导入信封」落库）：'))
  const out = root.createElement('textarea')
  out.setAttribute('data-testid', 'overlay-envelope-out')
  out.setAttribute('style', TEXT_STYLE + 'height:72px')
  out.readOnly = true
  out.value = extra.envelopeText ?? ''
  panel.appendChild(out)
}
