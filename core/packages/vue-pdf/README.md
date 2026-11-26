# vue-office-pdf-isolated

Vue 3 PDF preview component with a package-private PDF.js runtime.

## Runtime boundary

- Uses the PDF.js 5.7.284 legacy build and its matching module worker.
- Loads PDF.js only when the component starts a PDF preview.
- Does not read or replace `window`/`globalThis.pdfjsLib` or `globalThis.pdfjsWorker`, including when PDF.js falls back to running the worker on the main thread.
- Keeps the PDF.js module, worker, CMaps, standard fonts, and WASM inside this package build with no default public CDN dependency.

## Usage

The default entry uses the modern build and automatically resolves bundled CMaps, standard fonts, and WASM relative to the package unless explicitly overridden via `options` or `staticFileUrl`:

```ts
import VueOfficePdf from 'vue-office-pdf-isolated'

app.component('VueOfficePdf', VueOfficePdf)
```

Use the independent compat entry for Chromium 102/110 based browsers:

```ts
import VueOfficePdf from 'vue-office-pdf-isolated/compat'

app.component('VueOfficePdf', VueOfficePdf)
```

The component supports `src`, `requestOptions`, `staticFileUrl`, `options`, `defaultScale`, `rendered`/`error` events, and exposes `numPages`, `currentPage`, `userScale`, `rotation`, `setScale`, `getScale`, `setRotation`, `getRotation`, `scrollToPage`, `rerender`, and `save`. `rendered` fires once per document, when its first visible pages finish rendering; zooming, rotating, scrolling, resizing, and `rerender` do not emit it again.

Override PDF.js document options through `options` when needed:

```vue
<VueOfficePdf
  :src="url"
  :options="{ wasmUrl: '/pdfjs/wasm/' }"
  @rendered="handleRendered"
  @error="handleError"
/>
```

For the default entry, any custom `wasmUrl` / `cMapUrl` / `standardFontDataUrl` directory must contain resources from `pdfjs-dist@5.7.284`. Resources that fall back to the bundled copies are loaded on the main thread with `useWorkerFetch: false`; pass all three directories, or your own `BinaryDataFactory`, to keep the PDF.js defaults. Bundled standard fonts are used when PDF.js requests standard font data (for example with `useSystemFonts: false`); other non-embedded fonts fall back to locally installed fonts.

With `useWorkerFetch: false` (bundled resources and the compat entry), PDF.js skips ICC color management (qcms) and renders ICC-based colors through their alternate color spaces. The package ships only the CMap, standard-font, and JBIG2/OpenJPEG WASM files that PDF.js loads in this mode; the no-WebAssembly JS fallback (`useWasm: false`, or a CSP that blocks WebAssembly) needs a custom `wasmUrl` directory that contains the `*_nowasm_fallback.js` files, so it is not available in the compat entry.

The compat entry targets Chromium 102. Its main module is built for that target, and it shares the published PDF.js worker, CMap, WASM, and standard-font resources with the default entry. The compat entry resolves those resources relative to itself, does not use a public CDN, and overrides `cMapUrl`, `standardFontDataUrl`, `wasmUrl`, `useWorkerFetch`, and `BinaryDataFactory` options to preserve that self-contained boundary.

Customize the viewer backdrop via the `--vue-office-pdf-bg` CSS custom property (defaults to `#f2f3f5`).

Vue 2 and CommonJS/UMD builds are not supported.

## Publishing

Run the following commands from the repository root:

```sh
cd core/packages/vue-pdf
npm pkg get name version
npm publish . --access public --registry=https://registry.npmjs.org
```

Confirm that `npm pkg get` reports `vue-office-pdf-isolated` before publishing.
Do not run `npm publish` from the `core` directory because that directory is the `vue-office` package.
