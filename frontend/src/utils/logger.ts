export const isProd = import.meta.env.PROD === true
const VERBOSE_ENABLED = !isProd && ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true'

export const log = (...args: any[]) => {
  if (VERBOSE_ENABLED) console.log(...args)
}

export const warn = (...args: any[]) => {
  if (!isProd) console.warn(...args)
}

export const error = (...args: any[]) => {
  // always show errors
  console.error(...args)
}

