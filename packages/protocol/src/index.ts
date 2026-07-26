/**
 * Контракт веб-API. Единственный источник правды об этих типах: и демон, и веб-интерфейс
 * импортируют их отсюда, поэтому расхождение между сервером и клиентом ловится компилятором.
 */

export const healthPath = "/api/health";

export type Health = {
  status: "ok";
  /** Момент старта демона, ISO 8601. */
  startedAt: string;
  uptimeSeconds: number;
};
