import type { Segment } from "./types";

const MAX_SEGMENTS = 6000; // ~3+ hours of speech
const MAX_CHARS = 400_000;

// Request bodies come from the browser, so check their shape before using them.
export function parseSegments(input: unknown): Segment[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SEGMENTS) return null;
  let chars = 0;
  const out: Segment[] = [];
  for (const [i, s] of input.entries()) {
    if (!s || typeof s !== "object") return null;
    const { start, end, text } = s as Record<string, unknown>;
    if (typeof start !== "number" || typeof end !== "number" || typeof text !== "string") return null;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    chars += text.length;
    if (chars > MAX_CHARS) return null;
    out.push({ id: i, start, end: Math.max(end, start), text: text.slice(0, 2000) });
  }
  return out;
}
