/**
 *
 * @param prefix
 * @param rawOutput
 * @returns
 *
 * Prefixes the given rawOutput with the specified prefix if it's a relative path.
 */

export function prefixPath(
  prefix: string,
  rawOutput?: string
): string | undefined {
  if (!rawOutput) return undefined;
  if (rawOutput.startsWith("/") || rawOutput.startsWith(`${prefix}/`)) {
    return rawOutput;
  }
  return `${prefix}/${rawOutput}`;
}
