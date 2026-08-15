/**
 * Исполнение команд для инструментов bash/job-output/job-kill (docs/bash-tool.md).
 *
 * Всё исполнение живёт здесь, в воркере плагина. Причина — в рантайме bash не было ни лимита вывода
 * (stdout копился в память без ограничений, пока жив процесс), ни потолка таймаута, ни убийства
 * дерева процессов; у плагина всё это есть. Вывод каждого потока держится bounded-хвостом в памяти,
 * переполнение уезжает в файл `<dataDirectory>/tmp`; команда живёт в своей process group
 * (detached) и убивается деревом: SIGTERM → grace 3 c → SIGKILL.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";

/** Хвост одного потока, который держится в памяти. Дальше — только файл. */
export const MAX_TAIL_BYTES = 64 * 1024;

/** Grace между SIGTERM и SIGKILL при убийстве дерева. */
const KILL_GRACE_MS = 3_000;

/**
 * Модельно-дружелюбное окружение: без цвета, пейджеров и интерактивных режимов — иначе вывод
 * калечится управляющими кодами и зависаниями на `less`.
 */
const ENV_OVERRIDES = { NO_COLOR: "1", TERM: "dumb", PAGER: "cat", GIT_PAGER: "cat" } as const;

/** Что модель видит по одному потоку команды. */
export type CollectedOutput = {
  /** Текст: весь, если не превысил лимит, иначе хвост. */
  text: string;
  truncated: boolean;
  /** Путь файла с полным выводом; есть только при усечении. */
  spillPath?: string;
};

/**
 * Один поток команды: bounded-хвост в памяти и слив полного вывода в файл при переполнении.
 * Слив синхронный намеренно: асинхронная цепочка записей в чанковом потоке породила бы очередь
 * промисов, которую надо ещё и ограничивать, а синхронный `writeSync` на чанке 64 КБ стоит
 * микросекунды.
 */
export class OutputCollector {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private total = 0;
  private truncated = false;
  private spillPath: string | undefined;
  private spillFd: number | undefined;
  private spillCounter = 0;

  private readonly maxBytes: number;
  private readonly directory: string;
  private readonly label: string;

  constructor(maxBytes: number, directory: string, label: string) {
    this.maxBytes = maxBytes;
    this.directory = directory;
    this.label = label;
  }

  /** Принять один чанк потока: удержать хвост в памяти, переполнение слить в файл. */
  push(chunk: Buffer): void {
    this.total += chunk.length;
    if (this.spillFd !== undefined) {
      this.writeSpill(chunk);
    } else if (this.bytes + chunk.length > this.maxBytes) {
      this.truncated = true;
      this.openSpill();
      this.writeSpill(chunk);
    }
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > this.maxBytes) {
      const head = this.chunks[0]!;
      const excess = this.bytes - this.maxBytes;
      if (head.length <= excess) {
        this.chunks.shift();
        this.bytes -= head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.bytes -= excess;
      }
    }
  }

  private openSpill(): void {
    try {
      mkdirSync(this.directory, { recursive: true });
      const name = `bash-${process.pid}-${++this.spillCounter}-${randomBytes(6).toString("hex")}-${this.label}.log`;
      // `wx` и 0600: предсказуемый путь в общей директории — это симлинк-атака.
      this.spillFd = openSync(join(this.directory, name), "wx", 0o600);
      this.spillPath = join(this.directory, name);
      for (const prior of this.chunks) writeSync(this.spillFd, prior);
    } catch {
      // Слив — лучшая попытка: память и так держит хвост, падать из-за файла нельзя.
      this.discardSpill();
    }
  }

  private writeSpill(chunk: Buffer): void {
    try {
      writeSync(this.spillFd!, chunk);
    } catch {
      this.discardSpill();
    }
  }

  private discardSpill(): void {
    if (this.spillFd !== undefined) {
      try {
        closeSync(this.spillFd);
      } catch {
        // Дескриптор остаётся открытым — процесс всё равно жив, и файл доедет до конца.
      }
      this.spillFd = undefined;
    }
    this.spillPath = undefined;
  }

  /** Закрыть файл: только после этого путь можно показывать модели. */
  seal(): void {
    if (this.spillFd === undefined) return;
    try {
      closeSync(this.spillFd);
    } catch {
      // Запись могла не доехать: файл недописан, и показывать его путь — врать.
      this.spillPath = undefined;
    }
    this.spillFd = undefined;
  }

  /** Весь накопленный текст (хвост), признак усечения и путь файла. */
  output(): CollectedOutput {
    return {
      text: Buffer.concat(this.chunks).toString("utf8"),
      truncated: this.truncated,
      ...(this.spillPath === undefined ? {} : { spillPath: this.spillPath }),
    };
  }

  /**
   * Дельта с байтовой позиции `from` (для job-output): текст, следующий сдвиг и признак, что
   * прочитанное успело выпасть из памяти (тогда остаток — только в файле).
   */
  readFrom(from: number): { text: string; nextOffset: number; lossy: boolean; spillPath?: string } {
    const windowStart = this.total - this.bytes;
    const buffer = Buffer.concat(this.chunks);
    const lossy = from < windowStart;
    const slice = lossy ? buffer : buffer.subarray(from - windowStart);
    return {
      text: slice.toString("utf8"),
      nextOffset: this.total,
      lossy,
      ...(this.spillPath === undefined ? {} : { spillPath: this.spillPath }),
    };
  }
}

/** Чем закончилась команда. `exitCode` null означает смерть от сигнала или сбой запуска. */
export type CommandSettled = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Таймаут сработал первым: команду убил потолок, а не её собственная судьба. */
  timedOut: boolean;
};

/** Сигнал всей process group (POSIX) или дереву через taskkill (Windows). Никогда не бросает. */
function signalTree(platform: NodeJS.Platform, pid: number | undefined, sig: NodeJS.Signals): void {
  if (pid === undefined || pid <= 0) return;
  if (platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, sig);
  } catch {
    // Группа уже умерла или pid переиспользован — сигналить нечего.
  }
}

export type SpawnCommandOptions = {
  command: string;
  cwd: string;
  /** Куда падают spill-файлы вывода: `<dataDirectory>/tmp`. */
  tmpDir: string;
  /** Потолок команды; undefined — без таймаута (фоновое задание). */
  timeoutMs?: number;
};

/**
 * Одна команда в своей process group. `done` резолвится, когда процесс закрылся — или по grace
 * после `exit`, если унаследовавший pipe потомок держит канал открытым (это и есть висящий вывод,
 * из-за которого память демона росла без ограничений).
 */
export class CommandHandle {
  readonly stdout: OutputCollector;
  readonly stderr: OutputCollector;
  readonly done: Promise<CommandSettled>;
  /** Лидер process group: тестам и диагностике нужен настоящий pid, а не только handle. */
  readonly pid: number | undefined;

  private readonly child: ChildProcess;
  private readonly platform = process.platform;
  private readonly settle: (settled: CommandSettled) => void;
  private settled = false;
  private sigkillTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SpawnCommandOptions) {
    this.stdout = new OutputCollector(MAX_TAIL_BYTES, options.tmpDir, "stdout");
    this.stderr = new OutputCollector(MAX_TAIL_BYTES, options.tmpDir, "stderr");

    this.child = spawn("bash", ["-c", options.command], {
      cwd: options.cwd,
      // Наследуем окружение процесса: команды агента живут в том же мире, что и демон.
      env: { ...process.env, ...ENV_OVERRIDES },
      stdio: ["ignore", "pipe", "pipe"],
      // Своя process group: дерево убивается одним сигналом (docs/bash-tool.md).
      detached: this.platform !== "win32",
    });
    this.pid = this.child.pid;

    this.child.stdout?.on("data", (chunk: Buffer) => this.stdout.push(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => this.stderr.push(chunk));

    let resolveSettled: (settled: CommandSettled) => void = () => {};
    this.done = new Promise((resolve) => {
      resolveSettled = resolve;
    });
    this.settle = (settled) => {
      if (this.settled) return;
      this.settled = true;
      // SIGKILL-таймер намеренно не гасится: дерево могло пережить SIGTERM, и обещание убить
      // его обязано дожить до выстрела. Выстрел по мёртвой группе — безопасный no-op.
      this.stdout.seal();
      this.stderr.seal();
      resolveSettled(settled);
    };

    const timeoutTimer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.escalate();
            this.settle({ exitCode: null, signal: null, timedOut: true });
          }, options.timeoutMs);

    let exitGraceTimer: ReturnType<typeof setTimeout> | undefined;
    this.child.on("error", () => {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      this.settle({ exitCode: null, signal: null, timedOut: false });
    });
    this.child.on("exit", (exitCode, signal) => {
      // Потомок с унаследованным pipe держит `close` открытым: закрываем по grace.
      exitGraceTimer = setTimeout(() => {
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        this.settle({ exitCode, signal, timedOut: false });
      }, KILL_GRACE_MS);
    });
    this.child.on("close", (exitCode, signal) => {
      if (exitGraceTimer !== undefined) clearTimeout(exitGraceTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      this.settle({ exitCode, signal, timedOut: false });
    });
  }

  /** Вежливое убийство: SIGTERM дереву, затем SIGKILL по grace. */
  escalate(): void {
    signalTree(this.platform, this.pid, "SIGTERM");
    this.sigkillTimer = setTimeout(
      () => signalTree(this.platform, this.pid, "SIGKILL"),
      KILL_GRACE_MS,
    );
  }

  /** Решительное убийство для выгрузки плагина: SIGKILL сейчас, grace не ждём. */
  forceKill(): void {
    signalTree(this.platform, this.pid, "SIGKILL");
  }
}

/** Статус фонового задания для модели. */
export type JobStatus = "running" | "completed" | "killed";

/** Фоновое задание: команда без таймаута, чей вывод читается дельтами через job-output. */
export type BackgroundJob = {
  id: string;
  /** Чья сессия запустила: чужой job-output/job-kill не увидит задание. */
  sessionId: string;
  status: JobStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: OutputCollector;
  stderr: OutputCollector;
  /** Позиции чтения: каждый job-output отдаёт дельту с прошлого раза. */
  stdoutOffset: number;
  stderrOffset: number;
  /** Убийство начато нами (job-kill или уборка): исход помечается killed, а не completed. */
  killed: boolean;
  handle: CommandHandle;
};

const jobs = new Map<string, BackgroundJob>();

export type StartJobOptions = {
  command: string;
  cwd: string;
  tmpDir: string;
  sessionId: string;
};

/** Запустить фоновое задание: возвращается сразу, вывод копится в bounded-коллекторах. */
export function startJob(options: StartJobOptions): BackgroundJob {
  const handle = new CommandHandle({
    command: options.command,
    cwd: options.cwd,
    tmpDir: options.tmpDir,
  });
  const job: BackgroundJob = {
    id: randomUUID(),
    sessionId: options.sessionId,
    status: "running",
    exitCode: null,
    signal: null,
    stdout: handle.stdout,
    stderr: handle.stderr,
    stdoutOffset: 0,
    stderrOffset: 0,
    killed: false,
    handle,
  };
  jobs.set(job.id, job);
  void handle.done.then((settled) => {
    job.exitCode = settled.exitCode;
    job.signal = settled.signal;
    // Смерть от сигнала — тоже killed: задание не доделалось, и модель должна это увидеть.
    job.status = job.killed || settled.signal !== null ? "killed" : "completed";
  });
  return job;
}

/** Найти задание по id; `undefined` — неизвестное или уже забытое (после перезапуска демона). */
export function findJob(jobId: string): BackgroundJob | undefined {
  return jobs.get(jobId);
}

/** Убить задание деревом. Возвращает false, если оно уже не бежало. */
export function killJob(job: BackgroundJob): boolean {
  job.killed = true;
  if (job.status !== "running") return false;
  job.status = "killed";
  job.handle.escalate();
  return true;
}

/** Убрать задания сессии: сессия закрыта, читать вывод больше некому (docs/bash-tool.md). */
export function killJobsOfSession(sessionId: string): void {
  for (const [jobId, job] of jobs) {
    if (job.sessionId !== sessionId) continue;
    killJob(job);
    jobs.delete(jobId);
  }
}

/** Убрать все задания: выгрузка плагина. SIGKILL сразу — grace не на чем ждать. */
export function killAllJobs(): void {
  for (const job of jobs.values()) {
    job.killed = true;
    job.handle.forceKill();
  }
  jobs.clear();
}
