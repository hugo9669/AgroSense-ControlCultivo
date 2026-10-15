import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 700, // la vista Historial (recharts) se carga aparte con React.lazy
  },
  server: {
    // Desarrollo local contra el servidor desplegado:  crea app/frontend/.env.local con
    //   VITE_API=http://100.31.47.204     y ejecuta  npm run dev
    proxy: { '/api': loadEnv(mode, '.', '').VITE_API || 'http://localhost:8000' },
  },
}))
