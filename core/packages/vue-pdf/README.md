# @formachaca/vue-office-pdf

Vue 3 PDF preview component with a package-private PDF.js runtime.

## Runtime boundary

- Uses the PDF.js 5.7.284 legacy build and its matching module worker.
- Loads PDF.js only when the component starts a PDF preview.
- Does not read or replace window/globalThis.pdfjsLib.
- Keeps the PDF.js module and worker inside this package build.

## Usage

    import VueOfficePdf from '@formachaca/vue-office-pdf'

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

The wasmUrl directory must contain resources from pdfjs-dist 5.7.284.

Vue 2 and CommonJS/UMD builds are not supported.
