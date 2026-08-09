const toolCallPlacePrefix = "core.session.tool-call";

export function toolCallPlaceId(toolName: string): string {
  const encoded = [...new TextEncoder().encode(toolName)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${toolCallPlacePrefix}.t-${encoded}`;
}
