export const healthPath = "/api/health";

export type Health = {
  status: "ok";
  /** Момент старта демона, ISO 8601. */
  startedAt: string;
  uptimeSeconds: number;
};
