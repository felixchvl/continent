import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API comes from the Continent server (LXC 145 by default).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.CONTINENT_API ?? 'http://192.168.1.65:8080', changeOrigin: true },
    },
  },
})
