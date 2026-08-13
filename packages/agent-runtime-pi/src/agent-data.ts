import { escapeXml } from "./xml.ts";

type RuntimeContext = {
  cwd: string;
  agentPersonalDirectory?: string;
  sovereignDataDirectory: string;
};

const directoryGuidance = [
  "Work on the current project in cwd. Use it as the default location for project files and project-relative operations.",
  "The agent personal directory contains this agent's definition and private persistent files, such as its own notes. Do not treat it as the project workspace.",
  "The Sovereign data directory contains platform-managed shared data. Use it only when the task requires Sovereign resources or state; do not treat it as the current project.",
];

export function renderRuntimeContext(context: RuntimeContext): string {
  const personalDirectory =
    context.agentPersonalDirectory === undefined
      ? []
      : [
          `  <agent_personal_directory>${escapeXml(context.agentPersonalDirectory)}</agent_personal_directory>`,
        ];

  return [
    "<runtime_context>",
    `  <cwd>${escapeXml(context.cwd)}</cwd>`,
    ...personalDirectory,
    `  <sovereign_data_directory>${escapeXml(context.sovereignDataDirectory)}</sovereign_data_directory>`,
    "",
    "  <directory_guidance>",
    ...directoryGuidance.map((line) => `    ${escapeXml(line)}`),
    "  </directory_guidance>",
    "</runtime_context>",
  ].join("\n");
}
