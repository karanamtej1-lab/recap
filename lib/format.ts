import type { ScoreBreakdown, Segment } from "./types";

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// The score is always computed here from the breakdown, so a model can't just
// claim "98/100" - every point traces back to four visible sub-scores.
export const SCORE_WEIGHTS: ScoreBreakdown = { hook: 0.35, insight: 0.3, standalone: 0.2, energy: 0.15 };

export function scoreFrom(b: ScoreBreakdown): number {
  const raw =
    b.hook * SCORE_WEIGHTS.hook +
    b.insight * SCORE_WEIGHTS.insight +
    b.standalone * SCORE_WEIGHTS.standalone +
    b.energy * SCORE_WEIGHTS.energy;
  return Math.round(raw * 10);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

// "[83.2] text" lines: compact for the model, and the timestamps let it cite moments.
export function transcriptForPrompt(segments: Segment[]): string {
  return segments.map((s) => `[${s.start.toFixed(1)}] ${s.text.trim()}`).join("\n");
}

export function segmentsBetween(segments: Segment[], start: number, end: number): Segment[] {
  return segments.filter((s) => s.end > start && s.start < end);
}

// Snap a timestamp the model gave us onto a real segment boundary.
export function snapToSegment(segments: Segment[], t: number): number {
  if (!segments.length) return 0;
  let best = segments[0];
  for (const s of segments) if (Math.abs(s.start - t) < Math.abs(best.start - t)) best = s;
  return best.start;
}

export function snapEnd(segments: Segment[], t: number): number {
  if (!segments.length) return 0;
  let best = segments[0];
  for (const s of segments) if (Math.abs(s.end - t) < Math.abs(best.end - t)) best = s;
  return best.end;
}
