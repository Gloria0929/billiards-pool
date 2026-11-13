import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    // three.js + 内嵌实录音效本身就有约 1 MB，属于预期体积
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:3210',
        ws: true,
      },
    },
  },
})
