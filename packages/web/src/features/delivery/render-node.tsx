/**
 * Node 侧的渲染入口（测试 / 未来的 CLI 用）。
 *
 * 与 `render-browser.tsx` 分开，不是为了好看：`@react-pdf/renderer` 的
 * `package.json` 有一个 `browser` 字段，把 `lib/react-pdf.js` 换成
 * `lib/react-pdf.browser.js`，而这两个构建的渲染入口**不同名**
 * （Node 是 `renderToBuffer`，浏览器是 `pdf(...).toBlob()`）。
 *
 * 因此不能写成「一个函数内部分支」—— 打包器在构建期就会按 `browser` 字段
 * 决定 import 到哪个构建，运行期的判断来不及。分成两个文件，每个文件里的
 * import 都在自己那个环境里成立。
 *
 * 两个入口渲染的是**同一个 `DeliveryDocument`**，所以「CI 验过的 PDF」
 * 与「用户下载到的 PDF」是同一段模板代码的产物，而不是两条相似的路。
 */

import { renderToBuffer } from '@react-pdf/renderer'
import type { PackageView } from '../../../../core/src/render/index'
import { DeliveryDocument } from './document'

/** 渲染一版投递包为 PDF 字节。 */
export async function renderViewToBytes(view: PackageView): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<DeliveryDocument view={view} />)
  return new Uint8Array(buffer)
}
