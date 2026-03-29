import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["libraw-wasm", "dcraw-wasm"]
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
