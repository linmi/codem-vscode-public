// Asset modules used by Solid components and re-exported OpenCode primitives.
declare module "*.svg" {
  const src: string
  export default src
}

declare module "*.png" {
  const src: string
  export default src
}

declare module "*.css"

// Vite/Bun worker URL imports used by OpenCode markdown and Pierre diffs.
declare module "*?worker&url" {
  const src: string
  export default src
}
