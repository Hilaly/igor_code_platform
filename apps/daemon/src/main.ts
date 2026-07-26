import { createDaemonServer } from "./server.ts";

// Порт и директория данных пока не имеют своего разбора аргументов: способ конфигурации
// демона ещё не выбран. Переменная окружения — временная заглушка для dev-режима.
const port = Number(process.env["SOVEREIGN_PORT"] ?? 8787);

const server = createDaemonServer(new Date());

server.listen(port, "127.0.0.1", () => {
  console.log(`daemon listening on http://127.0.0.1:${port}`);
});
