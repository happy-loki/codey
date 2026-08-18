const SLASH_REGEX = /\\/g;

export function normalizeForCompare(value: string): string {
  return value.replace(SLASH_REGEX, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export function splitPath(value: string) {
  const normalized = normalizeForCompare(value.trim());
  const driveMatch = /^[a-zA-Z]:/.test(normalized) ? normalized.slice(0, 2) : null;
  const withoutDrive = driveMatch ? normalized.slice(2) : normalized;
  const trimmed = withoutDrive.replace(/^\//, "");
  const segments = trimmed.length === 0 ? [] : trimmed.split("/");
  return { drive: driveMatch ? driveMatch.toLowerCase() : null, segments };
}

export function isLikelyFilePath(value: string): boolean {
  return /\.[^./\\]+$/.test(value);
}

export function dirnameNormalized(value: string): string {
  const normalized = normalizeForCompare(value);
  if (!normalized) return normalized;
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return normalized.slice(0, lastSlash);
}

export function joinSegments(segments: string[]): string {
  return segments.join("/");
}

export function tryRelativePath(target: string, base: string | null | undefined): string | null {
  if (!base) return null;
  const basePath = isLikelyFilePath(base) ? dirnameNormalized(base) : base;
  if (!basePath) return null;

  const targetInfo = splitPath(target);
  const baseInfo = splitPath(basePath);
  if (targetInfo.drive && baseInfo.drive && targetInfo.drive !== baseInfo.drive) {
    return null;
  }

  const max = Math.min(targetInfo.segments.length, baseInfo.segments.length);
  let common = 0;
  for (let i = 0; i < max; i += 1) {
    if (targetInfo.segments[i].toLowerCase() === baseInfo.segments[i].toLowerCase()) {
      common += 1;
    } else {
      break;
    }
  }

  const upSegments = baseInfo.segments.slice(common).map(() => "..");
  const downSegments = targetInfo.segments.slice(common);
  if (upSegments.length === 0 && downSegments.length === 0) {
    return "./";
  }
  if (upSegments.length === 0) {
    return joinSegments(downSegments);
  }
  return joinSegments([...upSegments, ...downSegments]);
}

export function computeRelativePath(target: string, references: Array<string | null | undefined>): string | null {
  for (const ref of references) {
    const relative = tryRelativePath(target, ref ?? undefined);
    if (relative) {
      return relative;
    }
  }
  return null;
}

export function toForwardSlash(path: string): string {
  return typeof path === "string" ? path.replace(SLASH_REGEX, "/") : path;
}

export function ensureRelativePrefix(path: string): string {
  const normalized = toForwardSlash(path);
  if (!normalized) return normalized;
  if (
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.startsWith("asset://") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  ) {
    return normalized;
  }
  return `./${normalized}`;
}
