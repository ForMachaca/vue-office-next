import type { App, DefineComponent, Ref } from 'vue'

export interface VueOfficePdfProps {
  src: string | ArrayBuffer | Blob
  requestOptions?: {
    withCredentials?: boolean
  }
  staticFileUrl?: string
  options?: Record<string, unknown>
  defaultScale?: number
}

export type VueOfficePdfEmits = {
  rendered: () => void
  error: (error: unknown) => void
}

export interface VueOfficePdfExposed {
  numPages: number
  currentPage: number
  userScale: number
  rotation: number
  getScale: () => Ref<number>
  setScale: (scale: number) => void
  getRotation: () => Ref<number>
  setRotation: (deg: number) => void
  scrollToPage: (page: number) => void
  rerender: () => void
  save: (fileName?: string) => void
}

declare const VueOfficePdf: DefineComponent<
  VueOfficePdfProps,
  VueOfficePdfExposed,
  unknown,
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  VueOfficePdfEmits
> & {
  install(app: App): void
}

export default VueOfficePdf
