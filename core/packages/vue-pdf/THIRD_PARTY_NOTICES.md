# Third-party notices

This package bundles Mozilla PDF.js 5.7.284.

PDF.js is licensed under the Apache License 2.0. The full license text is
included in LICENSE-PDFJS.

The bundled PDF.js main module and lib/compat/assets/pdf.worker.min.js are
modified only to stop reading and writing the globalThis.pdfjsLib and
globalThis.pdfjsWorker globals.

Both entries use the PDF.js CMap, JBIG2/OpenJPEG WASM, and standard-font
runtime files published under lib/compat/assets. Their accompanying license
files are retained under lib/compat/assets/cmaps, lib/compat/assets/wasm, and
lib/compat/assets/standard_fonts in the npm package.
