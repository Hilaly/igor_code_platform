import { escapeXml } from "./xml.ts";

export function renderAgentData(directory?: string): string {
  if (directory === undefined) {
    return "";
  }

  return `<agent_data>\n  <directory>${escapeXml(directory)}</directory>\n</agent_data>`;
}
