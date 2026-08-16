import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Chemins relatifs: l'application peut être servie depuis n'importe quel
  // sous-répertoire (partage réseau, intranet usine).
  base: './',
  plugins: [react(), tailwindcss()],
})
