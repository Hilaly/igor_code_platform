import { lstatSync, watch, type FSWatcher, type Stats } from "node:fs";
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
  inspectPath?: (path: string) => Stats | undefined;
  watchDirectory?: (
    directory: string,
    recursive: boolean,
    listener: (event: string, name: string | Buffer | null) => void,
  ) => FSWatcher;
  scheduleDebounce?: (callback: () => void, delay: number) => NodeJS.Timeout;
  cancelDebounce?: (timer: NodeJS.Timeout) => void;
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
  const inspectPath =
    options.inspectPath ?? ((path: string) => lstatSync(path, { throwIfNoEntry: false }));
  const watchFactory =
    options.watchDirectory ??
    ((directory, recursive, listener) => watch(directory, { recursive }, listener));
  const scheduleDebounce = options.scheduleDebounce ?? setTimeout;
  const cancelDebounce = options.cancelDebounce ?? clearTimeout;

  const disarm = (): void => {
    generation += 1;
    for (const watcher of watchers) watcher.close();
    watchers.length = 0;
  };

  const changed = (): void => {
    if (closed) return;
    if (timer !== undefined) cancelDebounce(timer);
    timer = scheduleDebounce(() => {
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
    const watcher = watchFactory(directory, recursive, (event, name) => {
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
    const rootIsUsableDirectory = (): boolean => {
      const stat = inspectPath(root.directory);
      return stat?.isDirectory() === true && !stat.isSymbolicLink();
    };

    const rootStat = inspectPath(root.directory);
    if (rootStat?.isDirectory() === true && !rootStat.isSymbolicLink()) {
      watchDirectory(root.directory, true, generation, (_event, name) => {
        if (name === "" || name === ".") return false;
        try {
          if (name === basename(root.directory)) {
            const namedChild = inspectPath(join(root.directory, name));
            if (namedChild === undefined) {
              return inspectPath(root.directory) === undefined;
            }
          }
          inspectPath(join(root.directory, name));
        } catch (cause) {
          options.logger.error("inspecting a standalone file resource change failed", {
            directory: root.directory,
            path: join(root.directory, name),
            reason: cause instanceof Error ? cause.message : String(cause),
          });
        }
        return true;
      });
      return;
    }

    let candidate = root.directory;
    const filesystemRoot = parse(candidate).root;
    while (candidate !== filesystemRoot) {
      candidate = dirname(candidate);
      const stat = inspectPath(candidate);
      if (stat === undefined) continue;
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        const nextSegment = relative(candidate, root.directory).split(sep)[0];
        if (nextSegment === undefined || nextSegment === "") return;
        watchDirectory(candidate, false, generation, (_event, name) => {
          if (name === nextSegment || name.startsWith(`${nextSegment}${sep}`)) {
            try {
              return rootIsUsableDirectory();
            } catch (cause) {
              options.logger.error("inspecting a standalone file resource root failed", {
                directory: root.directory,
                reason: cause instanceof Error ? cause.message : String(cause),
              });
              return false;
            }
          }
          // macOS can coalesce a nested create and report the watched parent's own basename. In
          // that case the event name is unrelated, but inspection confirms the target appeared.
          try {
            return rootIsUsableDirectory();
          } catch (cause) {
            options.logger.error("inspecting a standalone file resource root failed", {
              directory: root.directory,
              reason: cause instanceof Error ? cause.message : String(cause),
            });
            return false;
          }
        });
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
        cancelDebounce(timer);
        timer = undefined;
      }
      disarm();
      arm();
    },
    close: () => {
      closed = true;
      if (timer !== undefined) {
        cancelDebounce(timer);
        timer = undefined;
      }
      disarm();
    },
  };
}
