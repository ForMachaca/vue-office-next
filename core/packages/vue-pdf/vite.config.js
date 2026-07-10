import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pdfWorkerPath = require.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
);
const pdfWorkerVirtualId = 'virtual:pdfjs-worker-url';
const resolvedPdfWorkerVirtualId = '\0' + pdfWorkerVirtualId;

function emitPdfWorker() {
  let workerReferenceId;

  return {
    name: 'emit-pdfjs-worker',
    apply: 'build',
    buildStart() {
      workerReferenceId = this.emitFile({
        type: 'asset',
        name: 'pdf.worker.min.mjs',
        source: readFileSync(pdfWorkerPath)
      });
    },
    resolveId(id) {
      return id === pdfWorkerVirtualId ? resolvedPdfWorkerVirtualId : null;
    },
    load(id) {
      if (id !== resolvedPdfWorkerVirtualId) {
        return null;
      }
      return (
        'export default import.meta.ROLLUP_FILE_URL_' +
        workerReferenceId +
        ';'
      );
    }
  };
}

function isolatePdfjsGlobal() {
  let transformed = false;

  return {
    name: 'isolate-pdfjs-global',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('/pdfjs-dist/legacy/build/pdf.mjs')) {
        return null;
      }

      const globalStart = code.lastIndexOf('\n{\n  globalThis._pdfjsTestingUtils = {');
      const exportStart = code.indexOf('\nexport {', globalStart);
      if (globalStart === -1 || exportStart === -1) {
        throw new Error('pdfjs-dist@5.7.284 global export block was not found');
      }

      transformed = true;
      return {
        code: code.slice(0, globalStart) + code.slice(exportStart),
        map: null
      };
    },
    buildEnd(error) {
      if (!error && !transformed) {
        this.error('pdfjs-dist@5.7.284 was not transformed into an isolated module');
      }
    }
  };
}

export default defineConfig({
  plugins: [emitPdfWorker(), isolatePdfjsGlobal(), vue()],
  build: {
    target: 'es2020',
    outDir: 'lib',
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'index.js'),
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
