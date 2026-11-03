import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

const scrubAxiosLocalhost = () => ({
  name: 'scrub-axios-localhost',
  transform(code, id) {
    if (id.includes('node_modules/axios') && code.includes('localhost')) {
      return code.replace(/(['"`])http:\/\/localhost\1/g, '$1http://invalid$1')
    }
  }
})

// CR-X AH-4: Port contract guard — 8011 is NOT a Local runtime surface.
// It exists only in an obsolete pre-commit hook. Reject it loudly.
const proxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8010'
if (proxyTarget.includes('8011')) {
  console.error('\n❌ FATAL: VITE_API_PROXY_TARGET contains :8011, which is NOT a Local runtime surface.')
  console.error('   8011 exists only in an obsolete pre-commit hook. Use :8010 (the default).')
  console.error('   Unset VITE_API_PROXY_TARGET or set it to http://localhost:8010.\n')
  process.exit(1)
}

export default defineConfig({
  plugins: [vue(), scrubAxiosLocalhost()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: true,
    port: parseInt(process.env.VITE_FRONTEND_PORT) || 5174,
    strictPort: true,
    proxy: process.env.VITE_API_BASE_URL ? undefined : {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    target: 'esnext'
  }
})
