import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Ensure Vite uses index.html at project root
  root: ".",

  publicDir: "public",

  // Build settings
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },

  resolve: {
    alias: {
      "@": "/src",
    },
  },

  server: {
    port: 5173,
    open: true,
  },

  preview: {
    port: 5173,
  },
});
