import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // GitHub Pages serves the site from /aerodata-site/ — local dev/preview stay at /
  base: process.env.GITHUB_ACTIONS === "true" ? "/aerodata-site/" : "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
