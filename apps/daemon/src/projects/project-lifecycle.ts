/**
 * Serializes mutations that can create or remove the same project's persisted state.
 *
 * The lock is per project: unrelated projects never wait for each other.
 */
export type ProjectLifecycle = {
  run: <Result>(projectId: string, operation: () => Promise<Result> | Result) => Promise<Result>;
};

export function createProjectLifecycle(): ProjectLifecycle {
  const tails = new Map<string, Promise<void>>();

  return {
    run: async (projectId, operation) => {
      const previous = tails.get(projectId) ?? Promise.resolve();
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => held);

      tails.set(projectId, tail);
      await previous;

      try {
        return await operation();
      } finally {
        release();

        if (tails.get(projectId) === tail) {
          tails.delete(projectId);
        }
      }
    },
  };
}
