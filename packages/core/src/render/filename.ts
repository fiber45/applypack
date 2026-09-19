/**
 * 投递包的文件名规范 —— T4c 第一条勾（`^[A-Za-z0-9_\-]+\.pdf$`）的执行者。
 *
 * ## 这条规范为什么是「无中文、无空格」，而不是「好看」
 *
 * 名字被处理的地方不是用户的文件夹，而是**上传链路**：
 *
 * | 输入 | 常见后果 |
 * |---|---|
 * | `张智远_简历.pdf` | 被 percent-encode 成 `%E5%BC%A0….pdf`，或被整段替换成 `____.pdf` |
 * | `Resume CN.pdf` | 空格编码成 `%20`，部分系统在拼 multipart 边界时直接截断 |
 * | `../../x.pdf` | 路径分隔符在拼 URL / 落磁盘时改变含义 |
 * | `Resume_EN.PDF` | 大小写敏感的上传控件按「不是 PDF」拒绝 |
 *
 * 所以判据是**运输安全性**：文件名要能原样穿过 HTML 表单、multipart 边界、
 * 各家 ATS 的存储层，而不变成另一个名字。它和「简历好不好看」无关。
 *
 * ## 为什么这里有一个「净化器」，而不是只写一条断言
 *
 * 只写断言的话，被断言的是一串常量（`'Resume_EN' + '.pdf'`）。那是一条**恒真**的检查
 * —— 它无法与「测试根本没在跑」区分开（T1.4 的教训）。所以文件名在这里是
 * **输入的函数**：用户可以给一个词干（招聘系统常要求「姓名_岗位.pdf」这种命名），
 * 净化器负责把它变成合规的名字，断言负责证明净化器的契约**对任何输入都成立**。
 *
 * 三件被刻意做成「不可能」而不是「被检测到」的事：
 *
 * 1. **三份文件撞名。** 后缀（`CN` / `EN` / `Bilingual`）由代码在**净化之后**追加，
 *    于是「不同的 (词干, 后缀) 必然给出不同的名字」是一条可证的命题，而不是
 *    一条需要运行时检查的性质。若将来改成「每份文件各自接受一个完整文件名」，
 *    这个性质立刻不再成立 —— `filename.test.ts` 里那条断言会红。
 * 2. **Windows 保留设备名。** 名字永远是 `{词干}_{后缀}.pdf`，而设备名
 *    （`CON` / `NUL` / `COM1`…）要求**整个** basename 精确匹配，`CON_CN.pdf` 不是设备名。
 * 3. **路径穿越。** `/` 与 `\` 不在允许字符集里，会被替换掉，
 *    于是产物里不可能出现第二个路径段。
 *
 * ## 一个必须显式说出来的回落
 *
 * 「张智远」净化之后什么都不剩。此时**不能**静默地丢掉用户的词干 —— 那正是
 * 「看起来在工作」那一类问题：文件生成了、名字合规、没有任何报错，
 * 而用户拿到的名字不是他要求的。所以 `resolveNaming` 把
 * `requestedStem`（要求了什么）与 `usedStem`（实际用了什么）分开返回，
 * 并用 `fellBack` 显式标出回落。界面照着它说一句「姓名部分含非拉丁字符，
 * 已回落为 `Resume`；如需带姓名请用拉丁字母」。
 *
 * **它不是失败**：投递包本身没问题，三份文件都合规。所以 `fellBack` 不参与
 * `PackageCheck.pass`。
 *
 * @see TASKS.md T4c · DESIGN 10.1
 */

/** 唯一的输出格式。扩展名**恒为小写**：大小写敏感的上传控件会拒掉 `.PDF`。 */
export const DELIVERY_EXTENSION = '.pdf'

/**
 * 文件名规范。这条正则的来源是 TASKS.md T4c 的原文，**不是**本文件的实现细节：
 * `filename.test.ts` 里有一条断言逐字比对的正是它的 `source`，
 * 这样「有人顺手放宽了正则」会当场变红。
 */
export const DELIVERY_FILE_NAME_PATTERN = /^[A-Za-z0-9_-]+\.pdf$/

/** 没有自定义词干时用的词干。加上后缀即得到 T4b 的三个视图名。 */
export const DEFAULT_FILE_STEM = 'Resume'

/**
 * 词干长度上限。大多数招聘系统的上传控件与前端路由对文件名长度有 64–255 的
 * 隐含上限，而**超长被截断时先丢掉的是后缀** —— 一个没有 `.pdf` 的文件会被
 * 「只接受 PDF」的控件拒绝。
 *
 * 64 是保守取值，不是测量值。它被断言钉住只是为了让改动是显式的。
 */
export const MAX_FILE_STEM_LENGTH = 64

/** 三个视图的后缀。顺序与 `PackageViewName` 一致（有断言）。 */
export const VIEW_SUFFIXES = ['CN', 'EN', 'Bilingual'] as const

export type ViewSuffix = (typeof VIEW_SUFFIXES)[number]

/** 允许的字符集之外的一切（一个或多个连续字符）。 */
const DISALLOWED_RUN = /[^A-Za-z0-9_-]+/g

/** 首尾的下划线。净化后为空串时要靠它判断「什么都不剩」。 */
const EDGE_UNDERSCORES = /^_+|_+$/g

/** 用来定位违规字符 —— 与 `DELIVERY_FILE_NAME_PATTERN` 的字符集是同一份。 */
const FIRST_DISALLOWED = /[^A-Za-z0-9_-]/

/**
 * 把一个任意字符串变成合规的词干。**契约：输出必定只含 `[A-Za-z0-9_-]`**，
 * 可能为空串（表示「这个词干不可用」，由调用方决定回落）。
 *
 * 顺序不可换：
 *
 * 1. **先去首尾空白**，否则 `'  Resume  '` 净化出来是 `_Resume_`。
 * 2. **再摘掉一个 `.pdf` 后缀**（大小写不敏感）。放在替换之前，
 *    否则 `'Resume.pdf'` 会变成 `Resume_pdf`，追加后缀后得到
 *    `Resume_pdf_EN.pdf` —— 难看但更重要的是「用户以为自己给的是名字，
 *    结果最外层多了个 `_pdf`」这类错误会一路传到招聘方那里。
 * 3. **替换不合规字符**（连续的一段替换成一个 `_`）。
 * 4. **去掉首尾下划线**，并把结果截到上限。截断之后要**再修一次尾部** ——
 *    截断点落在 `_` 上时尾部会留一个下划线。
 *
 * `_` 与 `-` 是允许的，所以用户自己写的连续下划线会被保留（`A__B` 不折叠）。
 * 这是刻意的：那是他的输入，不是我们该替他决定的样式。
 */
export function sanitizeFileStem(raw: string): string {
  const trimmed = raw.trim().replace(/\.pdf$/i, '')
  const replaced = trimmed.replace(DISALLOWED_RUN, '_')
  const bounded = replaced.replace(EDGE_UNDERSCORES, '')
  return bounded.slice(0, MAX_FILE_STEM_LENGTH).replace(EDGE_UNDERSCORES, '')
}

/**
 * 判定一个文件名是否合规。**独立的判定函数**，不读 `sanitizeFileStem` 的结果 ——
 * 若「净化」与「判定」共用一个实现，净化器的 bug 会定义上不可见。
 */
export function isDeliveryFileName(fileName: string): boolean {
  return DELIVERY_FILE_NAME_PATTERN.test(fileName)
}

/**
 * 拼出文件名。`stem` 为空串时回落到 `DEFAULT_FILE_STEM`。
 *
 * 后缀在**净化之后**追加，所以词干里带着 `_CN` 之类的字样也不会改变后缀的位置：
 * `sanitizeFileStem('Resume_CN')` = `Resume_CN` ⇒ 中版的文件名是
 * `Resume_CN_CN.pdf`。看起来笨，但它是对的 —— 「词干」是用户给的标识，
 * 「后缀」是代码给的身份，两者不该互相覆盖。
 */
export function deliveryFileName(stem: string, suffix: ViewSuffix): string {
  const usable = stem === '' ? DEFAULT_FILE_STEM : stem
  return `${usable}_${suffix}${DELIVERY_EXTENSION}`
}

export interface NamingReport {
  /** 用户要求的词干原样保留（`null` = 没要求）。界面要能说出「你要的是哪一个」。 */
  readonly requestedStem: string | null
  /** 实际使用的词干（已净化）。 */
  readonly usedStem: string
  /**
   * 用户给了词干，但净化后一个可用字符都不剩 ⇒ 回落为 `DEFAULT_FILE_STEM`。
   *
   * 单独一个布尔而不是让调用方去比 `requestedStem !== usedStem`：
   * 用户要求的恰好就是 `'Resume'` 时两者相等，而那不是回落。
   */
  readonly fellBack: boolean
}

/**
 * 从「用户要求的词干」解出「实际使用的词干」。
 *
 * 参数类型写成 `string | undefined` 而不是 `stem?: string`，是为了让
 * 「没要求」与「要求了空串」两种情况在实现里都必须被处理 ——
 * 两者都会回落到默认词干，但只有后者算回落。
 */
export function resolveNaming(requestedStem: string | undefined): NamingReport {
  if (requestedStem === undefined) {
    return { requestedStem: null, usedStem: DEFAULT_FILE_STEM, fellBack: false }
  }
  const sanitized = sanitizeFileStem(requestedStem)
  if (sanitized === '') {
    return { requestedStem, usedStem: DEFAULT_FILE_STEM, fellBack: true }
  }
  return { requestedStem, usedStem: sanitized, fellBack: false }
}

export type FileNameProblemReason = /** 词干里出现了允许集之外的字符。 */ | 'illegal_character'
  /** 字符都合法，问题出在后缀（缺了、不是小写 `.pdf`、或者名字本身为空）。 */
  | 'bad_extension'

export interface FileNameProblem {
  readonly fileName: string
  readonly reason: FileNameProblemReason
  /** 违规字符在 `fileName` 里的下标（0 起）。`bad_extension` 时为 -1。 */
  readonly index: number
  /** 违规的那个字符。`bad_extension` 时为空串。 */
  readonly character: string
}

/**
 * 找出一个文件名不合规的**位置**，合规时返回 `null`。
 *
 * 分两类而不是只给一个布尔：「第 10 个字符「.」不在允许集内」对
 * `Resume_EN.PDF` 是误导 —— 那个位置上的点本来就是该有的，
 * 问题在后缀的大小写。所以后缀先判，判完再在**词干**里找违规字符：
 * 这样 `Resume_EN.pdf ` 报的是「后缀不对」，而不是「第 10 个字符有问题」。
 *
 * 这个函数的调用点在 `checkPackage` 里，而它在**实践中到不了** ——
 * 净化器的契约保证了任何输入都产出合规名字（本文件的 `filename.test.ts`
 * 用二十几个对抗性输入证明了这一点）。所以它是一条**回归绊线**：
 * 它响的时候说的是「我们自己的契约被绕过了」，不是「用户填错了」。
 * 它必须仍然能响 —— `package.test.ts` 里有一条断言手工构造坏名字喂给它。
 */
export function checkFileName(fileName: string): FileNameProblem | null {
  if (isDeliveryFileName(fileName)) return null

  // 后缀先判：缺后缀、`.PDF`、名字本身就是 `.pdf`、词干为空 —— 这些都报成
  // 后缀问题。它们在名字里的位置各不相同，而共同点是「字符集没毛病」。
  if (!fileName.endsWith(DELIVERY_EXTENSION)) {
    return { fileName, reason: 'bad_extension', index: -1, character: '' }
  }
  const stem = fileName.slice(0, -DELIVERY_EXTENSION.length)
  if (stem === '') return { fileName, reason: 'bad_extension', index: -1, character: '' }

  const illegal = FIRST_DISALLOWED.exec(stem)
  if (illegal === null) {
    return { fileName, reason: 'bad_extension', index: -1, character: '' }
  }
  return {
    fileName,
    reason: 'illegal_character',
    index: illegal.index,
    character: illegal[0] ?? '',
  }
}

/** 逐个检查一份投递包的三份文件名。空数组表示全部合规。 */
export function checkFileNames(
  files: readonly { readonly name: string; readonly fileName: string }[],
): readonly FileNameProblem[] {
  const problems: FileNameProblem[] = []
  for (const file of files) {
    const problem = checkFileName(file.fileName)
    if (problem !== null) problems.push(problem)
  }
  return problems
}
