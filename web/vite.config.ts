import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Renfe's GPS feed does not send CORS headers, so the dev server relays it.
// A deployed version will need the same relay (see README).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/renfe': {
        target: 'https://gtfsrt.renfe.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/renfe/, ''),
      },
    },
  },
})
