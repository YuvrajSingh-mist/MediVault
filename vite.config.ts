import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Local emulator ports (see firebase.json -> emulators).
 */
const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
  storage: 9199,
}

/** Rewrites absolute emulator URLs returned in headers to the proxied origin. */
function rewriteOrigin(port: number, origin: string) {
  return (proxy: { on: (event: string, cb: (res: any) => void) => void }) => {
    proxy.on('proxyRes', (res: any) => {
      const location = res.headers?.location
      if (typeof location === 'string' && location.includes(`:${port}`)) {
        res.headers.location = location.replace(`http://127.0.0.1:${port}`, origin)
      }
    })
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const origin = `http://127.0.0.1:5173`
  const proxyEnabled = env.VITE_EMULATOR_PROXY === 'true'

  /**
   * Single-origin mode: every Firebase service is reached through the Vite dev
   * server instead of its own port. Some sandboxed browsers and corporate
   * networks block extra localhost ports, so this keeps the emulator suite
   * usable there. Enable with VITE_EMULATOR_PROXY=true.
   */
  const proxy: Record<string, ProxyOptions> | undefined = proxyEnabled
    ? {
        '/__emu/auth': {
          target: `http://127.0.0.1:${EMULATOR_PORTS.auth}`,
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/__emu\/auth/, ''),
        },
        '/google.firestore.v1.Firestore': {
          target: `http://127.0.0.1:${EMULATOR_PORTS.firestore}`,
          changeOrigin: false,
        },
        '/emulator/v1': {
          target: `http://127.0.0.1:${EMULATOR_PORTS.firestore}`,
          changeOrigin: false,
        },
        '/v1/projects/demo-medivault': {
          target: `http://127.0.0.1:${EMULATOR_PORTS.firestore}`,
          changeOrigin: false,
        },
        '/demo-medivault': {
          target: `http://127.0.0.1:${EMULATOR_PORTS.functions}`,
          changeOrigin: false,
        },
        '/v0': {
          target: `http://127.0.0.1:${EMULATOR_PORTS.storage}`,
          changeOrigin: false,
          configure: rewriteOrigin(EMULATOR_PORTS.storage, origin),
        },
        '/upload': {
          target: `http://127.0.0.1:${EMULATOR_PORTS.storage}`,
          changeOrigin: false,
        },
      }
    : undefined

  return {
    plugins: [react()],
    server: { port: 5173, strictPort: false, proxy },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  }
})
