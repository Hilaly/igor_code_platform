import {
  isThinkingLevel,
  type FileResourceDiagnostic,
  type NamePatternSelection,
  type ThinkingLevel,
} from "@sovereign/protocol";
import { isMap, isScalar, parseDocument } from "yaml";

export type AgentFileDefinition = {
  kind: "agent";
  name: string;
  description: string;
  instructions: string;
  tools: NamePatternSelection;
  skills: NamePatternSelection;
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

export type SkillFileDefinition = {
  kind: "skill";
  name: string;
  description: string;
  location: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  disableModelInvocation: boolean;
};

export type FileResourceDefinition = AgentFileDefinition | SkillFileDefinition;

export type ParsedFileResource<T> =
  | { kind: "valid"; definition: T; diagnostics: FileResourceDiagnostic[] }
  | { kind: "invalid"; diagnostics: FileResourceDiagnostic[] };

type InvalidFileResource = Extract<ParsedFileResource<never>, { kind: "invalid" }>;

export type FileResourceInput = {
  path: string;
  directoryName: string;
  text: string;
};

type Frontmatter = Record<string, unknown>;

const emptySelection = (): NamePatternSelection => ({ include: [], exclude: [] });

export function parseAgentFile(input: FileResourceInput): ParsedFileResource<AgentFileDefinition> {
  const split = splitFrontmatter(input.text, input.path);

  if (split.kind === "invalid") {
    return split;
  }

  const nameProblem = validateName(split.frontmatter.name, input.directoryName, input.path, false);
  if (nameProblem !== undefined) {
    return invalid(nameProblem);
  }

  const description = requiredString(split.frontmatter.description);
  if (description === undefined) {
    return invalid(
      diagnostic("missing-description", "the agent description is required", input.path),
    );
  }

  const tools = parseSelection(split.frontmatter.tools, input.path);
  if (tools.kind === "invalid") {
    return tools;
  }

  const skills = parseSelection(split.frontmatter.skills, input.path);
  if (skills.kind === "invalid") {
    return skills;
  }

  const instructions = split.body.trim();
  if (instructions === "") {
    return invalid(
      diagnostic("missing-instructions", "the agent instructions are required", input.path),
    );
  }

  const model = optionalString(split.frontmatter.model);
  if (split.frontmatter.model !== undefined && model === undefined) {
    return invalid(diagnostic("invalid-model", "model must be a non-empty string", input.path));
  }

  const thinkingLevel = split.frontmatter["thinking-level"];
  if (thinkingLevel !== undefined && !isThinkingLevel(thinkingLevel)) {
    return invalid(
      diagnostic(
        "invalid-thinking-level",
        "thinking-level must be a supported thinking level",
        input.path,
      ),
    );
  }

  return {
    kind: "valid",
    definition: {
      kind: "agent",
      name: split.frontmatter.name as string,
      description,
      instructions,
      tools: tools.selection,
      skills: skills.selection,
      ...(model === undefined ? {} : { model }),
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    },
    diagnostics: [],
  };
}

export function parseSkillFile(input: FileResourceInput): ParsedFileResource<SkillFileDefinition> {
  const split = splitFrontmatter(input.text, input.path);

  if (split.kind === "invalid") {
    return split;
  }

  const nameProblem = validateName(split.frontmatter.name, input.directoryName, input.path, true);
  if (nameProblem !== undefined && nameProblem.severity === "error") {
    return invalid(nameProblem);
  }

  const description = requiredString(split.frontmatter.description);
  if (description === undefined) {
    return invalid(
      diagnostic("missing-description", "the skill description is required", input.path),
    );
  }
  if (description.length > 1_024) {
    return invalid(
      diagnostic(
        "invalid-description",
        "the skill description must not exceed 1024 characters",
        input.path,
      ),
    );
  }

  const license = optionalString(split.frontmatter.license);
  if (split.frontmatter.license !== undefined && license === undefined) {
    return invalid(diagnostic("invalid-license", "license must be a non-empty string", input.path));
  }

  const compatibility = optionalString(split.frontmatter.compatibility);
  if (
    split.frontmatter.compatibility !== undefined &&
    (compatibility === undefined || compatibility.length > 500)
  ) {
    return invalid(
      diagnostic(
        "invalid-compatibility",
        "compatibility must be a non-empty string no longer than 500 characters",
        input.path,
      ),
    );
  }

  const metadata = parseMetadata(split.frontmatter.metadata);
  if (
    split.frontmatter.metadata !== undefined &&
    (metadata === undefined || split.metadataIsStringMap !== true)
  ) {
    return invalid(
      diagnostic("invalid-metadata", "metadata must map strings to strings", input.path),
    );
  }

  const allowedToolsValue = split.frontmatter["allowed-tools"];
  if (allowedToolsValue !== undefined && typeof allowedToolsValue !== "string") {
    return invalid(
      diagnostic("invalid-allowed-tools", "allowed-tools must be a string", input.path),
    );
  }
  const allowedTools =
    typeof allowedToolsValue === "string"
      ? allowedToolsValue.split(/\s+/u).filter((tool) => tool !== "")
      : undefined;

  const disableModelInvocationValue = split.frontmatter["disable-model-invocation"];
  if (
    disableModelInvocationValue !== undefined &&
    typeof disableModelInvocationValue !== "boolean"
  ) {
    return invalid(
      diagnostic(
        "invalid-disable-model-invocation",
        "disable-model-invocation must be a boolean",
        input.path,
      ),
    );
  }

  return {
    kind: "valid",
    definition: {
      kind: "skill",
      name: split.frontmatter.name as string,
      description,
      location: input.path,
      ...(license === undefined ? {} : { license }),
      ...(compatibility === undefined ? {} : { compatibility }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(allowedTools === undefined ? {} : { allowedTools }),
      disableModelInvocation: disableModelInvocationValue ?? false,
    },
    diagnostics: nameProblem === undefined ? [] : [nameProblem],
  };
}

function splitFrontmatter(
  text: string,
  path: string,
):
  | {
      kind: "valid";
      frontmatter: Frontmatter;
      body: string;
      metadataIsStringMap: boolean | undefined;
    }
  | InvalidFileResource {
  const match = /^(?:\uFEFF)?---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)([\s\S]*)$/u.exec(
    text,
  );

  if (match === null) {
    return invalid(
      diagnostic("invalid-frontmatter", "the file must start with YAML frontmatter", path),
    );
  }

  const source = match[1] ?? "";
  const document = parseDocument(source, { version: "1.2", uniqueKeys: true });

  if (document.errors.length > 0) {
    return invalid(
      diagnostic("invalid-frontmatter", `invalid YAML: ${document.errors[0]?.message}`, path),
    );
  }

  const metadataNode = isMap(document.contents)
    ? document.contents.items.find((pair) => isScalar(pair.key) && pair.key.value === "metadata")
        ?.value
    : undefined;
  const metadataIsStringMap =
    metadataNode === undefined
      ? undefined
      : isMap(metadataNode) &&
        metadataNode.items.every(
          (pair) =>
            isScalar(pair.key) &&
            typeof pair.key.value === "string" &&
            isScalar(pair.value) &&
            typeof pair.value.value === "string",
        );

  let parsed: unknown;
  try {
    parsed = document.toJS();
  } catch (cause) {
    return invalid(
      diagnostic(
        "invalid-frontmatter",
        `invalid YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
        path,
      ),
    );
  }

  if (!isRecord(parsed)) {
    return invalid(diagnostic("invalid-frontmatter", "YAML frontmatter must be a mapping", path));
  }

  return {
    kind: "valid",
    frontmatter: parsed,
    body: match[2] ?? "",
    metadataIsStringMap,
  };
}

function parseSelection(
  value: unknown,
  path: string,
):
  | { kind: "valid"; selection: NamePatternSelection; diagnostics: FileResourceDiagnostic[] }
  | InvalidFileResource {
  if (value === undefined) {
    return { kind: "valid", selection: emptySelection(), diagnostics: [] };
  }
  if (!isRecord(value)) {
    return invalid(diagnostic("invalid-selector", "a selector must be a mapping", path));
  }

  const include = value.include ?? [];
  const exclude = value.exclude ?? [];
  if (!isStringArray(include) || !isStringArray(exclude)) {
    return invalid(
      diagnostic("invalid-selector", "selector include and exclude must be string arrays", path),
    );
  }

  return { kind: "valid", selection: { include, exclude }, diagnostics: [] };
}

function validateName(
  value: unknown,
  directoryName: string,
  path: string,
  warnAboutUnderscore: boolean,
): FileResourceDiagnostic | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/u.test(value) ||
    value.includes("--")
  ) {
    return diagnostic(
      "invalid-name",
      "name must contain 1-64 lowercase letters, digits, underscores, or non-repeated inner hyphens",
      path,
    );
  }
  if (value !== directoryName) {
    return diagnostic(
      "name-directory-mismatch",
      "name must match the definition directory name",
      path,
    );
  }
  if (warnAboutUnderscore && value.includes("_")) {
    return diagnostic(
      "nonstandard-underscore",
      "underscores are not portable to strict Agent Skills clients",
      path,
      "warning",
    );
  }
  return undefined;
}

function parseMetadata(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    return undefined;
  }
  return value as Record<string, string>;
}

function requiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredString(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function diagnostic(
  code: string,
  message: string,
  path: string,
  severity: FileResourceDiagnostic["severity"] = "error",
): FileResourceDiagnostic {
  return { severity, code, message, path };
}

function invalid(diagnosticEntry: FileResourceDiagnostic): InvalidFileResource {
  return { kind: "invalid", diagnostics: [diagnosticEntry] };
}
