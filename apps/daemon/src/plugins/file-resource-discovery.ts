import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  diagnostic,
  parseAgentFile,
  parseSkillFile,
  type FileResourceDefinition,
  type ParsedFileResource,
} from "./file-resource-parser.ts";

const maximumEntryBytes = 1_048_576;

export type DiscoveredFileResource = {
  entryPath: string;
  directoryPath: string;
  parsed: ParsedFileResource<FileResourceDefinition>;
};

export type FileResourceDiscoveryOptions = {
  kind: FileResourceDefinition["kind"];
  root: string;
};

export function discoverFileResources(
  options: FileResourceDiscoveryOptions,
): DiscoveredFileResource[] {
  let entries;
  try {
    entries = readdirSync(options.root, { withFileTypes: true });
  } catch (cause) {
    if (isFileSystemError(cause, "ENOENT")) {
      return [];
    }
    throw cause;
  }

  const entryName = options.kind === "agent" ? "AGENT.md" : "SKILL.md";

  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .map((entry) => {
      const directoryPath = join(options.root, entry.name);
      const entryPath = join(directoryPath, entryName);

      let directoryStat;
      try {
        directoryStat = lstatSync(directoryPath);
      } catch (cause) {
        return discoveredInvalid(
          entryPath,
          directoryPath,
          "unreadable-entry",
          `the definition directory cannot be inspected: ${errorMessage(cause)}`,
        );
      }

      if (directoryStat.isSymbolicLink()) {
        return discoveredInvalid(
          entryPath,
          directoryPath,
          "unsupported-symlink",
          "symbolic links cannot be definition directories",
        );
      }
      if (!directoryStat.isDirectory()) {
        return undefined;
      }

      let entryStat;
      try {
        entryStat = lstatSync(entryPath);
      } catch (cause) {
        if (isFileSystemError(cause, "ENOENT")) {
          return undefined;
        }
        return discoveredInvalid(
          entryPath,
          directoryPath,
          "missing-entry",
          `the definition entry cannot be inspected: ${errorMessage(cause)}`,
        );
      }

      if (entryStat.isSymbolicLink()) {
        return discoveredInvalid(
          entryPath,
          directoryPath,
          "unsupported-symlink",
          "symbolic links cannot be definition entries",
        );
      }
      if (!entryStat.isFile()) {
        return discoveredInvalid(
          entryPath,
          directoryPath,
          "invalid-entry",
          "the definition entry must be a regular file",
        );
      }
      if (entryStat.size > maximumEntryBytes) {
        return discoveredInvalid(
          entryPath,
          directoryPath,
          "entry-too-large",
          `the definition entry exceeds ${maximumEntryBytes} bytes`,
        );
      }

      let text: string;
      try {
        text = readFileSync(entryPath, "utf8");
      } catch (cause) {
        return discoveredInvalid(
          entryPath,
          directoryPath,
          "unreadable-entry",
          `the definition entry cannot be read: ${errorMessage(cause)}`,
        );
      }

      return {
        entryPath,
        directoryPath,
        parsed:
          options.kind === "agent"
            ? parseAgentFile({ path: entryPath, directoryName: entry.name, text })
            : parseSkillFile({ path: entryPath, directoryName: entry.name, text }),
      };
    })
    .filter((resource): resource is DiscoveredFileResource => resource !== undefined);
}

function discoveredInvalid(
  entryPath: string,
  directoryPath: string,
  code: string,
  message: string,
): DiscoveredFileResource {
  return {
    entryPath,
    directoryPath,
    parsed: { kind: "invalid", diagnostics: [diagnostic(code, message, entryPath)] },
  };
}

function isFileSystemError(cause: unknown, code: string): boolean {
  return cause instanceof Error && (cause as { code?: unknown }).code === code;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
