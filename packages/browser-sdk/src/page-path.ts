/**
 * Keeps a plugin-owned path inside its page while preserving each ordinary segment exactly as the
 * plugin wrote it. A decoded dot segment is navigation, not data, even when it was percent-encoded.
 */
export function normalizePagePath(path: string): string {
  const segments: string[] = [];

  for (const segment of path.split("/")) {
    const decoded = decodedSegment(segment);

    if (segment === "" || decoded === ".") {
      continue;
    }

    if (decoded === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function decodedSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch (cause) {
    if (cause instanceof URIError) {
      return undefined;
    }

    throw cause;
  }
}
