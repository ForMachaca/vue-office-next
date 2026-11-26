import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { vueOfficePdfSource } from './packages/vue-pdf/vite.config.js';

export default defineConfig({
  server: {
    host: '0.0.0.0'
  },
  resolve:{
    alias:{
      'vue-demi': 'vue3'
    },
    dedupe: ['vue']
  },
  plugins: [
      vue(),
      vueOfficePdfSource(),
  ],
  base:'/vue-office/examples/dist',
  build:{
    outDir: '../examples/dist'
  }
});
