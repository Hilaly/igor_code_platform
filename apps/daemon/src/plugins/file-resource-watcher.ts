import { lstatSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, join, parse, relative, sep } from "node:path";

import type { Logger } from "../platform/public.ts";
import type { StandaloneResourceRoot } from "./file-resource-roots.ts";

export type FileResourceWatcher = {
  start: () => void;
  rearm: (roots: StandaloneResourceRoot[]) => void;
  close: () => void;
};

export type CreateFileResourceWatcherOptions = {
  roots: StandaloneResourceRoot[];
  logger: Logger;
  onChange: () => void;
  debounceMilliseconds?: number;
};

const defaultDebounceMilliseconds = 75;

export function createFileResourceWatcher(
  options: CreateFileResourceWatcherOptions,
): FileResourceWatcher {
  let roots = options.roots;
  let closed = false;
  let started = false;
  let generation = 0;
  let timer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [];
  const debounceMilliseconds = options.debounceMilliseconds ?? defaultDebounceMilliseconds;

  const disarm = (): void => {
    generation += 1;
    for (const watcher of watchers) watcher.close();
    watchers.length = 0;
  };

  const changed = (): void => {
    if (closed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (closed) return;

      // Появившийся ранее отсутствовавший root должен сразу перейти с parent watch на recursive.
      disarm();
      arm();
      options.onChange();
    }, debounceMilliseconds);
    timer.unref();
  };

  const watchDirectory = (
    directory: string,
    recursive: boolean,
    armedGeneration: number,
    shouldReport: (event: string, name: string) => boolean,
  ): void => {
    const watcher = watch(directory, { recursive }, (event, name) => {
      const relativeName = typeof name === "string" ? name : "";
      if (armedGeneration === generation && shouldReport(event, relativeName)) changed();
    });
    watcher.on("error", (cause: Error) => {
      options.logger.error("the standalone file resource watcher failed", {
        directory,
        reason: cause.message,
      });
    });
    watchers.push(watcher);
  };

  const armRoot = (root: StandaloneResourceRoot): void => {
    const armedAt = Date.now();
    const rootStat = lstatSync(root.directory, { throwIfNoEntry: false });
    if (rootStat?.isDirectory() === true && !rootStat.isSymbolicLink()) {
      watchDirectory(root.directory, true, generation, (event, name) => {
        if (name === "" || name === ".") return false;
        if (name === basename(root.directory)) {
          const namedChild = lstatSync(join(root.directory, name), { throwIfNoEntry: false });
          if (namedChild === undefined) {
            return lstatSync(root.directory, { throwIfNoEntry: false }) === undefined;
          }
        }
        const stat = lstatSync(join(root.directory, name), { throwIfNoEntry: false });
        return stat === undefined || event === "change" || stat.mtimeMs >= armedAt;
      });
      return;
    }

    let candidate = root.directory;
    const filesystemRoot = parse(candidate).root;
    while (candidate !== filesystemRoot) {
      candidate = dirname(candidate);
      const stat = lstatSync(candidate, { throwIfNoEntry: false });
      if (stat === undefined) continue;
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        const nextSegment = relative(candidate, root.directory).split(sep)[0];
        watchDirectory(
          candidate,
          false,
          generation,
          (_event, name) => name === nextSegment || name.startsWith(`${nextSegment}${sep}`),
        );
      }
      return;
    }
  };

  const arm = (): void => {
    for (const root of roots) {
      try {
        armRoot(root);
      } catch (cause) {
        options.logger.error("the standalone file resource root cannot be watched", {
          directory: root.directory,
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  };

  return {
    start: () => {
      if (closed || started) return;
      started = true;
      arm();
    },
    rearm: (next) => {
      roots = next;
      if (!started || closed) return;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      disarm();
      arm();
    },
    close: () => {
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      disarm();
    },
  };
}
