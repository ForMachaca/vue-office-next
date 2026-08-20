# vue-office-pdf-isolated

Vue 3 PDF preview component with a package-private PDF.js runtime.

## Runtime boundary

- Uses the PDF.js 5.7.284 legacy build and its matching module worker.
- Loads PDF.js only when the component starts a PDF preview.
- Does not read or replace window/globalThis.pdfjsLib.
- Keeps the PDF.js module and worker inside this package build.

## Usage

The default entry keeps the existing modern build:

    import VueOfficePdf from 'vue-office-pdf-isolated'

    app.component('VueOfficePdf', VueOfficePdf)

Use the independent compat entry for Chromium 102/110 based browsers:

    import VueOfficePdf from 'vue-office-pdf-isolated/compat'

    app.component('VueOfficePdf', VueOfficePdf)

The component keeps the upstream src, requestOptions, staticFileUrl, options,
defaultScale, rendered/error events, scale methods, and save method.

Pass PDF.js document options through options. For example:

    <VueOfficePdf
      :src="url"
      :options="{ wasmUrl: '/pdfjs/wasm/' }"
      @rendered="handleRendered"
      @error="handleError"
    />

For the default entry, the wasmUrl directory must contain resources from
pdfjs-dist 5.7.284.

The compat entry targets Chromium 102. Its main module and module worker are
built together, and matching CMap, WASM, and standard-font resources are
published with the package. The compat entry resolves those resources relative
to itself, does not use a public CDN, and overrides cMapUrl,
standardFontDataUrl, wasmUrl, useWorkerFetch, and BinaryDataFactory options to
preserve that self-contained boundary.

Vue 2 and CommonJS/UMD builds are not supported.

## Publishing

Run the following commands from the repository root:

```sh
cd core/packages/vue-pdf
npm pkg get name version
npm publish . --access public --registry=https://registry.npmjs.org
```

Confirm that `npm pkg get` reports `vue-office-pdf-isolated` before publishing.
Do not run `npm publish` from the `core` directory because that directory is
the `vue-office` package.
