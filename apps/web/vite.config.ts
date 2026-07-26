import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
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
    },
  },
  test: {
    environment: "node",
  },
});
