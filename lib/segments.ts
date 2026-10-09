import type { Segment, Word } from "./types";

// Group word timestamps into sentence-sized segments for notes, search, and the AI.
export function wordsToSegments(words: Word[]): Segment[] {
  const segments: Segment[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    segments.push({
      id: segments.length,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(" ").replace(/\s+([,.!?;:])/g, "$1"),
    });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > 1.0) flush(); // long pause = new thought
    cur.push(w);
    const sentenceEnd = /[.!?]["')\]]?$/.test(w.text);
    if ((sentenceEnd && cur.length >= 4) || cur.length >= 30) flush();
  }
  flush();
  return segments;
}

// Plain-text transcript -> evenly spaced pseudo words (for the "paste a transcript" path).
export function textToWords(text: string, wordsPerSecond = 2.6): Word[] {
  const tokens = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return tokens.map((t, i) => ({ text: t, start: i / wordsPerSecond, end: (i + 1) / wordsPerSecond }));
}
