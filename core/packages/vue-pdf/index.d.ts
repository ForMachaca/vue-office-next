import type { App, DefineComponent } from 'vue'

export interface VueOfficePdfProps {
  src: string | ArrayBuffer | Blob
  requestOptions?: {
    withCredentials?: boolean
  }
  staticFileUrl?: string
  options?: Record<string, unknown>
  defaultScale?: number
}

declare const VueOfficePdf: DefineComponent<VueOfficePdfProps> & {
  install(app: App): void
}

export default VueOfficePdf
