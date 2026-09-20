declare module "observedAppServer" {
  export const timings: { stage: string; ms: number }[]
  export const counts: { auth: number; list: number; prepare: number; brokers: number }
}
