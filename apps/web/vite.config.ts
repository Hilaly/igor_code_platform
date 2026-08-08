import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // The UI kit and React are shared by every route. Keeping them in stable vendor chunks
        // prevents the entry from growing past the browser's useful single-request size as views
        // are added, while preserving the same eager loading behaviour for the first screen.
        manualChunks(id) {
          if (id.includes("/packages/ui-kit/") || id.includes("/node_modules/@sovereign/ui-kit/")) {
            return "ui-kit";
          }

          if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) {
            return "react-vendor";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    // Порт свой, а не дефолтный 5173: он занят чуть ли не в каждом втором проекте.
    // strictPort — чтобы при занятом порте dev падал с внятной ошибкой, а не уезжал
    // молча на соседний, пока в документации написан один адрес.
    port: 5273,
    strictPort: true,

    // В dev-режиме фронтенд и демон — два разных сервера. Прокси избавляет от CORS
    // и делает пути в коде одинаковыми для dev и продакшна.
    proxy: {
      "/api": "http://127.0.0.1:8787",
      // Браузерные ассеты плагинов собирает и отдаёт демон, а не Vite: без этой строки в dev-режиме
      // бандл плагина отвечал бы 404 страницей приложения (docs/ui-extension-model.md).
      "/plugin-assets": "http://127.0.0.1:8787",
    },
  },
  test: {
    environment: "node",
  },
});
