/**
 * Инструменты bash/job-output/job-kill (docs/bash-tool.md).
 *
 * Bash переехал сюда из рантайма: исполнение команды — это лимиты (вывод, таймаут, дерево
 * процессов), и они живут рядом с инструментом, а не в ядре. Foreground-команда обязана уложиться
 * в таймаут вызова плагина (`callTimeoutMilliseconds` из invocation) — дольше только background.
 *
 * Фоновое задание — обычная команда без таймаута: bash с `run_in_background: true` возвращает
 * `jobId` сразу, job-output читает вывод дельтами, job-kill убивает дерево.
 */

import { join } from "node:path";

import { contribute, z } from "@sovereign/sdk";
import type { PluginToolInvocation } from "@sovereign/sdk";

import {
  CommandHandle,
  findJob,
  killJob,
  startJob,
  type BackgroundJob,
  type CollectedOutput,
  type CommandSettled,
} from "./bash.ts";

/**
 * Запас под саму передачу вызова: команда обязана закончиться до того, как демон снимет ожидание
 * ответа воркера (`pluginToolTimeoutMilliseconds`), иначе модель увидит «инструмент не ответил»,
 * а команда останется доживать.
 */
const FOREGROUND_MARGIN_MS = 2_000;

const bashParameters = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      "The bash command to execute. Each call runs in a fresh shell: no state (cwd, variables, " +
        "functions) persists between calls — pass `cd`-free commands or use absolute paths.",
    ),
  timeout: z
    .number()
    .positive()
    .optional()
    .describe(
      "Timeout in seconds. Capped by the platform — a longer command must set " +
        "`run_in_background: true` instead. Omitted — the platform cap applies.",
    ),
  run_in_background: z
    .boolean()
    .optional()
    .describe(
      "Run in the background: the call returns a job id immediately, then job-output reads the " +
        "output and job-kill stops the command. Use it for anything that may outlive the cap.",
    ),
});

const jobParameters = z.object({
  jobId: z.string().min(1).describe("The job id returned by bash with run_in_background: true."),
});

const failed = (content: string) => ({ content, isError: true });

/** Текст потока: при усечении — хвост плюс путь к полному выводу. */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text;
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? "(unavailable)"}]`;
}

/** Маркеры исхода команды: таймаут, сигнал, код выхода. Ненулевой код — текст, а не ошибка. */
function outcomeMarkers(settled: CommandSettled, timeoutSeconds: number | undefined): string[] {
  const markers: string[] = [];
  if (settled.timedOut) {
    markers.push(`[timed out after ${timeoutSeconds ?? "the platform cap"} seconds]`);
  }
  if (settled.signal !== null) {
    markers.push(`[killed by signal: ${settled.signal}]`);
  } else if (settled.exitCode !== null && settled.exitCode !== 0) {
    markers.push(`[exit code: ${settled.exitCode}]`);
  }
  return markers;
}

function withMarkers(body: string, markers: string[]): string {
  if (markers.length === 0) return body;
  return `${body}${body.endsWith("\n") ? "" : "\n"}${markers.join("\n")}`;
}

/** Foreground-результат: stdout, секция stderr, пометка об усечении. Маркеры исхода — снаружи. */
function renderForeground(stdout: CollectedOutput, stderr: CollectedOutput): string {
  const out = streamText(stdout);
  const err = streamText(stderr);

  let body = out;
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith("\n")) body += "\n";
    body += `[stderr]\n${err}`;
  }
  if (body.length === 0) body = "(no output)";

  return body;
}

/** Дельта вывода задания: stdout, секция stderr, пометка о потерянном, статус и маркеры исхода. */
function renderJobRead(job: BackgroundJob): string {
  const out = job.stdout.readFrom(job.stdoutOffset);
  const err = job.stderr.readFrom(job.stderrOffset);
  job.stdoutOffset = out.nextOffset;
  job.stderrOffset = err.nextOffset;

  let delta = out.text;
  if (err.text.length > 0) {
    if (delta.length > 0 && !delta.endsWith("\n")) delta += "\n";
    delta += `[stderr]\n${err.text}`;
  }

  const notices: string[] = [];
  if (out.lossy || err.lossy) {
    const paths = [out.spillPath, err.spillPath].filter(
      (path): path is string => path !== undefined,
    );
    notices.push(
      `[some output was dropped from memory; full output: ${paths.length > 0 ? paths.join(", ") : "(unavailable)"}]`,
    );
  }

  const markers: string[] = [];
  if (job.status === "running") {
    markers.push("[status: running]");
  } else {
    markers.push(`[status: ${job.status}]`);
    if (job.status === "completed" || job.status === "killed") {
      markers.push(
        ...outcomeMarkers(
          { exitCode: job.exitCode, signal: job.signal, timedOut: false },
          undefined,
        ),
      );
    }
  }

  const body = delta.length === 0 ? "(no new output)" : delta;
  return withMarkers(`${body}${notices.length > 0 ? `\n${notices.join("\n")}` : ""}`, markers);
}

function tmpDirectory(invocation: PluginToolInvocation): string {
  return join(invocation.dataDirectory, "tmp");
}

/** Потолок foreground-команды: таймаут вызова плагина минус запас на передачу ответа. */
function foregroundCapMilliseconds(invocation: PluginToolInvocation): number {
  return Math.max(1, invocation.callTimeoutMilliseconds - FOREGROUND_MARGIN_MS);
}

function commandTimeoutSeconds(
  requested: number | undefined,
  invocation: PluginToolInvocation,
): { seconds: number; clamped: boolean } {
  const capSeconds = Math.floor(foregroundCapMilliseconds(invocation) / 1000);
  if (requested === undefined || requested > capSeconds) {
    return { seconds: capSeconds, clamped: requested !== undefined };
  }
  return { seconds: requested, clamped: false };
}

export async function contributeBashTools(): Promise<void> {
  await contribute.tool({
    id: "bash",
    title: "Run a bash command",
    description:
      "Execute a bash command in the project folder and return its stdout and stderr. " +
      "Output is truncated to its tail; the full output is saved to a file whose path is reported. " +
      "The timeout is capped by the platform — commands that may run longer must set " +
      "`run_in_background: true`: the call returns a job id immediately, then job-output reads " +
      "the output and job-kill stops the command.",
    parameters: bashParameters,
    invoke: async (arguments_, invocation) => {
      const { seconds, clamped } = commandTimeoutSeconds(arguments_.timeout, invocation);
      const cwd = invocation.folder;
      const tmpDir = tmpDirectory(invocation);

      if (arguments_.run_in_background === true) {
        const job = startJob({
          command: arguments_.command,
          cwd,
          tmpDir,
          sessionId: invocation.sessionId,
        });

        return [
          `background job ${job.id} started`,
          "",
          `Poll it with job-output {jobId: "${job.id}"}, stop it with job-kill.`,
        ].join("\n");
      }

      const handle = new CommandHandle({
        command: arguments_.command,
        cwd,
        tmpDir,
        timeoutMs: seconds * 1000,
      });
      const settled = await handle.done;
      const markers = outcomeMarkers(settled, seconds);
      if (clamped) {
        markers.unshift(`[timeout clamped to ${seconds} seconds by the platform]`);
      }

      return withMarkers(renderForeground(handle.stdout.output(), handle.stderr.output()), markers);
    },
  });

  await contribute.tool({
    id: "job-output",
    title: "Read a background job output",
    description:
      "Read the output a background job (started with bash run_in_background: true) produced " +
      "since the previous read, with its status. Call it repeatedly to follow progress.",
    parameters: jobParameters,
    invoke: async (arguments_, invocation) => {
      const job = findJob(arguments_.jobId);

      if (job === undefined) {
        return failed(`unknown job ${arguments_.jobId}: jobs do not survive a daemon restart`);
      }
      if (job.sessionId !== invocation.sessionId) {
        return failed(`job ${arguments_.jobId} belongs to another session`);
      }

      return renderJobRead(job);
    },
  });

  await contribute.tool({
    id: "job-kill",
    title: "Stop a background job",
    description:
      "Stop a background job (started with bash run_in_background: true): the whole process " +
      "tree is terminated, SIGTERM first, SIGKILL after a short grace.",
    parameters: jobParameters,
    invoke: async (arguments_, invocation) => {
      const job = findJob(arguments_.jobId);

      if (job === undefined) {
        return failed(`unknown job ${arguments_.jobId}: jobs do not survive a daemon restart`);
      }
      if (job.sessionId !== invocation.sessionId) {
        return failed(`job ${arguments_.jobId} belongs to another session`);
      }

      return killJob(job) ? `killed job ${job.id}` : `job ${job.id} already finished`;
    },
  });
}
