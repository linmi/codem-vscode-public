// highlight.js 只为包入口和 lib/core 提供类型，语法模块没有声明文件。
declare module "highlight.js/lib/languages/*" {
  import type { LanguageFn } from "highlight.js"
  const language: LanguageFn
  export default language
}
