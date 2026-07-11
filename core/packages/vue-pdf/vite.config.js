import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsDirectory = dirname(require.resolve('pdfjs-dist/package.json'));
const pdfWorkerPath = require.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
);
const pdfWorkerVirtualId = 'virtual:pdfjs-worker-url';
const resolvedPdfWorkerVirtualId = '\0' + pdfWorkerVirtualId;
const compatResourcesVirtualId = 'virtual:pdfjs-compat-resources';
const resolvedCompatResourcesVirtualId = '\0' + compatResourcesVirtualId;

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

function emitCompatResources() {
  const resourceDirectories = {
    cMapUrl: 'cmaps',
    standardFontDataUrl: 'standard_fonts',
    wasmUrl: 'wasm'
  };
  const resourceReferences = {};

  return {
    name: 'emit-pdfjs-compat-resources',
    apply: 'build',
    buildStart() {
      for (const [kind, directoryName] of Object.entries(resourceDirectories)) {
        const directory = resolve(pdfjsDirectory, directoryName);
        resourceReferences[kind] = Object.fromEntries(
          readdirSync(directory).map((filename) => [
            filename,
            this.emitFile({
              type: 'asset',
              fileName: `assets/${directoryName}/${filename}`,
              source: readFileSync(resolve(directory, filename))
            })
          ])
        );
      }
    },
    resolveId(id) {
      return id === compatResourcesVirtualId
        ? resolvedCompatResourcesVirtualId
        : null;
    },
    load(id) {
      if (id !== resolvedCompatResourcesVirtualId) {
        return null;
      }

      const entries = Object.entries(resourceReferences).map(
        ([kind, references]) => {
          const files = Object.entries(references).map(
            ([filename, referenceId]) =>
              `${JSON.stringify(filename)}: import.meta.ROLLUP_FILE_URL_${referenceId}`
          );
          return `${JSON.stringify(kind)}: {${files.join(',')}}`;
        }
      );
      return `export default {${entries.join(',')}};`;
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

export default defineConfig(({ mode }) => {
  const isCompat = mode === 'compat';

  return {
    base: './',
    resolve: {
      alias: {
        'virtual:vue-office-pdf-runtime': resolve(
          import.meta.dirname,
          isCompat ? 'src/runtime/compat.js' : 'src/runtime/modern.js'
        )
      }
    },
    plugins: [
      !isCompat && emitPdfWorker(),
      isCompat && emitCompatResources(),
      isolatePdfjsGlobal(),
      vue()
    ],
    worker: {
      format: 'es'
    },
    build: {
      target: isCompat ? 'chrome102' : 'es2020',
      outDir: isCompat ? 'lib/compat' : 'lib',
      emptyOutDir: !isCompat,
      lib: {
        entry: resolve(import.meta.dirname, isCompat ? 'compat.js' : 'index.js'),
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
  };
});
