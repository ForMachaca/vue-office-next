import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const pdfWorkerVirtualId = 'virtual:pdfjs-worker-url'
const resolvedPdfWorkerVirtualId = '\0' + pdfWorkerVirtualId
const pdfWorkerStub = {
  name: 'pdf-worker-stub',
  resolveId(id) {
    return id === pdfWorkerVirtualId ? resolvedPdfWorkerVirtualId : null
  },
  load(id) {
    return id === resolvedPdfWorkerVirtualId
      ? "export default '/assets/pdf.worker.min.mjs'"
      : null
  }
}

const pdfResourcesVirtualId = 'virtual:pdfjs-resources'
const resolvedPdfResourcesVirtualId = '\0' + pdfResourcesVirtualId
const pdfResourcesStub = {
  name: 'pdf-resources-stub',
  resolveId(id) {
    return id === pdfResourcesVirtualId
      ? resolvedPdfResourcesVirtualId
      : null
  },
  load(id) {
    return id === resolvedPdfResourcesVirtualId ? 'export default {}' : null
  }
}

export default defineConfig({
  resolve: {
    alias: {
      'virtual:vue-office-pdf-runtime': resolve(
        import.meta.dirname,
        'src/runtime/modern.js'
      )
    }
  },
  plugins: [pdfWorkerStub, pdfResourcesStub, vue()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js']
  }
})
