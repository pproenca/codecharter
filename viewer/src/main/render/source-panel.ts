/**
 * Source-text panel layout, on-demand line-range computation, an LRU source
 * cache, and the annotation clipboard prompt. Line ranges are clamped to the
 * panel cap and biased toward the focused line.
 */
import type {
  Bounds,
  BoxSize,
  HorizontalBox,
  LineRange,
  MapAnnotationPlace,
  MapFile,
  Point,
  SourceCache,
  SourceLine,
  SourceRange,
} from "./types.ts";
import {
  SOURCE_CACHE_LIMIT,
  SOURCE_PANEL_CONTEXT_AFTER,
  SOURCE_PANEL_CONTEXT_BEFORE,
  SOURCE_PANEL_MAX_LINES,
} from "./constants.ts";
import { clamp, normalizeMapPath } from "./primitives.ts";
import { canRenderSourceText } from "./lod.ts";

export function sourceTextLayoutForBox(box: HorizontalBox, viewportWidth: number) {
  const visibleLeft = Math.max(box.x, 0);
  const visibleRight = Math.min(box.x + box.width, viewportWidth);
  const textX = visibleLeft + 42;
  const availableTextWidth = Math.max(0, visibleRight - textX - 6);
  return {
    lineNumberX: visibleLeft + 6,
    textX,
    maxChars: Math.max(12, Math.floor(availableTextWidth / 7.2)),
  };
}

export function visibleLineRangeForBox(file: MapFile, box: Bounds, viewportHeight: number): { start: number; end: number } | null {
  const lineCount = file.lineCount ?? 0;
  if (lineCount <= 0) return null;
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, viewportHeight);
  if (bottom <= top) return null;

  const startRatio = clamp((top - box.y) / box.height, 0, 1);
  const endRatio = clamp((bottom - box.y) / box.height, 0, 1);
  return {
    start: Math.max(1, Math.floor(startRatio * lineCount) + 1),
    end: Math.min(lineCount, Math.ceil(endRatio * lineCount)),
  };
}

export function lineAtWorldPoint(file: MapFile, worldPoint: Point): number {
  const bounds = file.bounds;
  const lineCount = file.lineCount ?? 0;
  if (!bounds || lineCount <= 0) return 1;
  const rawLine = ((worldPoint.y - bounds.y) / bounds.height) * lineCount;
  return Math.max(1, Math.min(lineCount, Math.floor(rawLine) + 1));
}

export function sourcePanelLineRangeForBox(file: MapFile, focusLine: number, box: BoxSize | Bounds, viewportHeight: number): { start: number; end: number } {
  const visibleRange = canRenderSourceText(file, box) && isPositionedBox(box)
    ? visibleLineRangeForBox(file, box, viewportHeight)
    : null;
  if (visibleRange) return capLineRange(file, visibleRange.start, visibleRange.end, focusLine);
  return capLineRange(
    file,
    Math.max(1, focusLine - SOURCE_PANEL_CONTEXT_BEFORE),
    Math.min(file.lineCount ?? focusLine, focusLine + SOURCE_PANEL_CONTEXT_AFTER),
    focusLine,
  );
}

export function sourceContextRequest(path: string, lineRange: LineRange = {}) {
  const lineStart = lineRange.start ?? 1;
  const lineEnd = lineRange.end ?? lineStart;
  const query = new URLSearchParams({
    path,
    lineStart: String(lineStart),
    lineEnd: String(lineEnd),
  }).toString();
  return {
    query,
    resolveUrl: `/api/resolve?${query}`,
    sourceUrl: `/api/source?${query}`,
    lines: `${lineStart}-${lineEnd}`,
  };
}

export function formatSourceLines(source: { lines?: SourceLine[] }): string {
  return (source.lines ?? [])
    .map((item) => item ? `${String(item.number).padStart(4, " ")}  ${item.text}` : undefined)
    .join("\n");
}

export function sourcePanelState({ path = "", deepLink = "", source = null, fallbackOutput = "" }: { path?: string; deepLink?: string; source?: SourceRange | null; fallbackOutput?: string } = {}) {
  if (source) {
    return {
      sourceTitle: path && deepLink ? `${path} · ${deepLink}` : path || deepLink,
      sourceOutput: formatSourceLines(source),
      scrollTop: 0,
    };
  }

  return {
    sourceTitle: path || deepLink,
    sourceOutput: fallbackOutput,
  };
}

export function annotationClipboardText(annotation: MapAnnotationPlace, { origin = "", href = "" }: { origin?: string; href?: string } = {}) {
  const reference = annotation.deepLink || `codecharter://annotation/${annotation.id}`;
  const serverFlag = origin ? ` --server ${doubleQuote(origin)}` : "";
  const comment = annotation.comment?.trim() || "<empty>";
  const prompt = [
    `CodeCharter annotation: ${reference}`,
    `Note: ${comment}`,
    `Resolve: npx --yes codecharter@latest --json resolve ${doubleQuote(reference)}${serverFlag}`,
  ].join("\n");
  const shareUrl = annotationShareUrl(annotation, href);
  if (!shareUrl) return prompt;
  return [
    prompt,
    "",
    `CodeCharter URL: ${shareUrl}`,
  ].join("\n");
}

export function sourceRangeCacheKey(path: string, lineStart: number, lineEnd: number): string {
  return `${normalizeMapPath(path)}:${lineStart}-${lineEnd}`;
}

export function rememberSourceRange(cache: SourceCache, cacheKey: string, source: SourceRange, limit = SOURCE_CACHE_LIMIT): void {
  if (cache.has(cacheKey)) cache.delete(cacheKey);
  cache.set(cacheKey, source);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export function cachedSourceRange(cache: SourceCache, path: string, lineStart: number, lineEnd: number): SourceRange | null {
  const normalized = normalizeMapPath(path);
  for (const [cacheKey, source] of cache) {
    if (normalizeMapPath(source.path) !== normalized) continue;
    if (!source.lineRange) continue;
    if (source.lineRange.start > lineStart || source.lineRange.end < lineEnd) continue;
    cache.delete(cacheKey);
    cache.set(cacheKey, source);
    return source;
  }
  return null;
}

function annotationShareUrl(annotation: MapAnnotationPlace, href: string): string {
  if (!href || !annotation.browserHash) return "";
  const url = new URL(href);
  url.hash = annotation.browserHash;
  return url.toString();
}

function doubleQuote(value: string): string {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function capLineRange(file: MapFile, start: number, end: number, focusLine: number): { start: number; end: number } {
  if (end - start + 1 <= SOURCE_PANEL_MAX_LINES) return { start, end };
  const before = Math.floor(SOURCE_PANEL_MAX_LINES / 2);
  const lineCount = file.lineCount ?? Math.max(end, focusLine, 1);
  const cappedStart = Math.max(1, Math.min(focusLine - before, lineCount - SOURCE_PANEL_MAX_LINES + 1));
  return {
    start: cappedStart,
    end: Math.min(lineCount, cappedStart + SOURCE_PANEL_MAX_LINES - 1),
  };
}

function isPositionedBox(box: BoxSize | Bounds): box is Bounds {
  return "y" in box && typeof box.y === "number";
}
