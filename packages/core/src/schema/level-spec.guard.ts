/**
 * `LevelSpec` 的**编译期守卫**。
 *
 * 这个文件不产出任何运行时价值，它的全部作用是让「分级声明漏字段会在编译期被抓到」这句承诺
 * 可以被持续验证，而不是一句写在注释里的口头保证。
 *
 * 做法：用 `@ts-expect-error` 标注**必须报错**的那一行。
 * 如果哪天 `LevelSpec` 被改松了、导致这些声明不再报错，
 * tsc 会因为「未使用的 @ts-expect-error 指令」而失败 —— 守卫自己会报警。
 *
 * 注意指令必须紧贴**出错的属性行**，而不是声明行：
 * 类型不匹配报在属性位置，写在声明行会被判为未使用。
 *
 * 这里用玩具类型而非真实档案类型：守卫要测的是 `LevelSpec` 这个**类型构造器**本身，
 * 与具体 schema 无关；真实分级表由 `archive.ts` 的 `satisfies LevelSpec<ArchiveV1>` 覆盖。
 */

import type { LevelSpec } from './level'

type Toy = {
  a: string
  nested: { b: string; c: number }
  list: string[]
}

/** 正例：每个键都声明了，且数组整体只需一个级别 */
export const completeSpec: LevelSpec<Toy> = {
  a: 'A',
  nested: { b: 'A', c: 'A' },
  list: 'B',
}

export const missingNestedKey: LevelSpec<Toy> = {
  a: 'A',
  // @ts-expect-error 缺少 nested.c 的声明必须报错 —— 这正是「漏标字段」的形态
  nested: { b: 'A' },
  list: 'A',
}

export const extraKey: LevelSpec<Toy> = {
  a: 'A',
  nested: { b: 'A', c: 'A' },
  list: 'A',
  // @ts-expect-error 声明了不存在的键必须报错 —— 这正是「写过时字段名」的形态
  nope: 'A',
}

export const illegalLevel: LevelSpec<Toy> = {
  // @ts-expect-error 级别只能是 A 或 B
  a: 'C',
  nested: { b: 'A', c: 'A' },
  list: 'A',
}
