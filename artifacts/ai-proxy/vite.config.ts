import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import monacoEditorPlugin from "vite-plugin-monaco-editor";
import path from "path";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    // Bundles Monaco Editor workers locally so IntelliSense works without CDN
    (monacoEditorPlugin as any).default({
      languageWorkers: [
        "editorWorkerService",
        "typescript",
        "json",
        "css",
        "html",
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Target modern browsers — smaller output, no legacy polyfills
    target: "es2020",
    // Disable source maps in production for smaller deploy bundle;
    // enable in development for debugging.
    sourcemap: !isProduction,
    // Monaco Editor bundles are inherently large; raise warning threshold.
    chunkSizeWarningLimit: 4000,
    // Use esbuild for minification (default, fastest)
    minify: "esbuild",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Explicit chunk splitting strategy:
        //   monaco-*      — Editor + language workers (each can be >1 MB)
        //   react-vendor  — React + React-DOM (stable across deploys → better caching)
        //   ui-vendor     — Radix / Lucide / shadcn components
        //   query-vendor  — TanStack React Query
        //   router-vendor — Wouter router
        //   utils-vendor  — all other node_modules
        manualChunks(id) {
          // Monaco Editor — give each worker its own chunk
          if (id.includes("monaco-editor") || id.includes("vite-plugin-monaco-editor")) {
            return "monaco-editor";
          }
          // Core React runtime (tiny, loads first)
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "react-vendor";
          }
          // Radix UI + Lucide icons + shadcn primitives
          if (
            id.includes("@radix-ui") ||
            id.includes("lucide-react") ||
            id.includes("class-variance-authority") ||
            id.includes("clsx") ||
            id.includes("tailwind-merge")
          ) {
            return "ui-vendor";
          }
          // TanStack Query
          if (id.includes("@tanstack/react-query")) {
            return "query-vendor";
          }
          // Wouter (router)
          if (id.includes("node_modules/wouter")) {
            return "router-vendor";
          }
          // CodeMirror (lightweight editor fallback used in some panels)
          if (id.includes("codemirror") || id.includes("@codemirror")) {
            return "codemirror-vendor";
          }
          // Sonner toasts
          if (id.includes("node_modules/sonner")) {
            return "ui-vendor";
          }
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: false,
        secure: false,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
