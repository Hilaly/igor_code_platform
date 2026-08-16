/**
 * Разбор результата инструментов bash/job-output/job-kill (docs/bash-tool.md). Чистая функция:
 * контракт маркеров — ровно тот, что строит tools.ts.
 *
 * Формат результата: тело (stdout, затем строка `[stderr]` и stderr) → финальные маркеры исхода;
 * пометки усечения живут внутри своих секций.
 */

export type ParsedBashResult = {
  stdout: string;
  stderr: string;
  /** Тело было `(no output)` или `(no new output)`: показывать приглушённой строкой. */
  noOutput: boolean;
  /** `[exit code: N]` — приходит только для ненулевого кода. */
  exitCode?: number;
  /** `[timed out after … seconds]` (включая «the platform cap»). */
  timedOut?: boolean;
  /** `[killed by signal: SIG]`. */
  killedBy?: string;
  /** `[timeout clamped to N seconds by the platform]`. */
  clampedSeconds?: number;
  /** `[status: running|completed|killed]` — статус фонового задания у job-output. */
  jobStatus?: "running" | "completed" | "killed";
  /** stdout-секция усечена или её кусок выпал из памяти: путь к полному выводу. */
  truncatedPath?: string;
  /** stderr-секция усечена или её кусок выпал из памяти: путь(ы) к полному выводу. */
  stderrTruncatedPath?: string;
};

const outcomeMarkerPatterns = [
  /^\[exit code: (\d+)\]$/,
  /^\[timed out after .* seconds\]$/,
  /^\[killed by signal: (.+)\]$/,
  /^\[timeout clamped to (\d+) seconds by the platform\]$/,
  /^\[status: (running|completed|killed)\]$/,
];

/** Пометка усечения внутри секции: `[output truncated; full output: …]` и job-вариант. */
const truncatedMarkerPattern =
  /^\[(?:output truncated|some output was dropped from memory); full output: (.+)\]$/;

/**
 * Секция без пометок усечения: сами пометки — структура, а не содержимое. tools.ts кладёт в одну
 * секцию не более одной пометки, поэтому последняя вхождения побеждает, а список не нужен.
 */
function section(text: string): { text: string; truncatedPath?: string } {
  let truncatedPath: string | undefined;
  const kept: string[] = [];

  for (const line of text.split("\n")) {
    const match = truncatedMarkerPattern.exec(line);
    if (match === null) {
      kept.push(line);
    } else {
      truncatedPath = match[1];
    }
  }

  return {
    text: kept.join("\n"),
    ...(truncatedPath === undefined ? {} : { truncatedPath }),
  };
}

export function parseBashResult(text: string): ParsedBashResult {
  const lines = text.split("\n");
  const markers: string[] = [];

  // Маркеры исхода — последние строки результата; отделяются от тела с конца.
  while (
    lines.length > 0 &&
    outcomeMarkerPatterns.some((pattern) => pattern.test(lines[lines.length - 1] as string))
  ) {
    markers.unshift(lines.pop() as string);
  }

  let exitCode: number | undefined;
  let timedOut: boolean | undefined;
  let killedBy: string | undefined;
  let clampedSeconds: number | undefined;
  let jobStatus: "running" | "completed" | "killed" | undefined;

  for (const marker of markers) {
    let match = /^\[exit code: (\d+)\]$/.exec(marker);
    if (match !== null) {
      exitCode = Number(match[1]);
      continue;
    }
    match = /^\[timed out after .* seconds\]$/.exec(marker);
    if (match !== null) {
      timedOut = true;
      continue;
    }
    match = /^\[killed by signal: (.+)\]$/.exec(marker);
    if (match !== null) {
      killedBy = match[1];
      continue;
    }
    match = /^\[timeout clamped to (\d+) seconds by the platform\]$/.exec(marker);
    if (match !== null) {
      clampedSeconds = Number(match[1]);
      continue;
    }
    match = /^\[status: (running|completed|killed)\]$/.exec(marker);
    if (match !== null) {
      jobStatus = match[1] as "running" | "completed" | "killed";
    }
  }

  const stderrIndex = lines.findIndex((line) => line === "[stderr]");
  const stdoutBody = stderrIndex === -1 ? lines.join("\n") : lines.slice(0, stderrIndex).join("\n");
  const stderrBody = stderrIndex === -1 ? "" : lines.slice(stderrIndex + 1).join("\n");

  const trimmedBody = stdoutBody.trim();
  const noOutput =
    stderrBody === "" && (trimmedBody === "(no output)" || trimmedBody === "(no new output)");

  const out = section(noOutput ? "" : stdoutBody);
  const err = section(stderrBody);

  return {
    stdout: out.text,
    stderr: err.text,
    noOutput,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(timedOut === undefined ? {} : { timedOut }),
    ...(killedBy === undefined ? {} : { killedBy }),
    ...(clampedSeconds === undefined ? {} : { clampedSeconds }),
    ...(jobStatus === undefined ? {} : { jobStatus }),
    ...(out.truncatedPath === undefined ? {} : { truncatedPath: out.truncatedPath }),
    ...(err.truncatedPath === undefined ? {} : { stderrTruncatedPath: err.truncatedPath }),
  };
}
