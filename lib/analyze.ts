// Prompts, schemas, chunking, and the cleanup step that turns model JSON into a trusted Recap.
import { clamp, formatTime, scoreFrom, snapEnd, snapToSegment, transcriptForPrompt } from "./format";
import { generateJson, isAIReady, LLMUnavailable, PROVIDERS, type AIConfig } from "./llm";
import { offlineAsk, offlineRecap } from "./offline";
import type { AskAnswer, Recap, ScoreBreakdown, Segment } from "./types";

const num = { type: "number" };
const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items: unknown) => ({ type: "array", items });

const PART_PROPS = {
  keyPoints: arr(obj({ text: str, at: num })),
  notes: str,
  chapters: arr(obj({ start: num, title: str })),
  highlights: arr(
    obj({
      start: num,
      end: num,
      title: str,
      hook: str,
      reason: str,
      breakdown: obj({ hook: num, insight: num, standalone: num, energy: num }),
    }),
  ),
  quiz: arr(obj({ question: str, choices: arr(str), answer: num, explanation: str, at: num })),
  actionItems: arr(str),
  terms: arr(obj({ term: str, definition: str })),
};

const RECAP_SCHEMA = obj({ title: str, tldr: str, ...PART_PROPS });
const PART_SCHEMA = obj({ summary: str, ...PART_PROPS });
const MERGE_SCHEMA = obj({ title: str, tldr: str });

const FIELD_RULES = `Each transcript line is "[seconds] text". Every timestamp you output must be one of those seconds values.
- keyPoints: 4-7 points in the order they come up, each with the time it's discussed.
- notes: well-structured markdown study notes using "## " headings per topic and "- " bullets; bold key terms with **term**. No top-level "# " title.
- chapters: 3-8 topic changes with start times; the first starts at the first timestamp.
- highlights: the 3 moments (15-60 seconds each, non-overlapping) that would work best as standalone vertical clips. "hook" is a punchy on-screen caption (max 70 chars). Score each 0-10 on: hook (would the opening line stop a scroll), insight (does it teach something), standalone (makes sense with no context), energy (emphasis, emotion). Be a harsh, honest grader; "reason" explains the scores in one sentence.
- quiz: 4-5 multiple-choice questions testing understanding (not trivia), 4 choices each, "answer" is the 0-based index of the correct choice, "at" is when it's covered.
- actionItems: assignments, deadlines, follow-ups, or decisions mentioned. Empty if none.
- terms: up to 8 key terms with one-sentence definitions grounded in what the speaker said.
Use only what is in the transcript.`;

const RECAP_SYSTEM = `You turn a timestamped transcript of a lecture or meeting into study material.
- title: short, specific (not "Lecture Recap").
- tldr: 2-3 sentences a student could read instead of watching.
${FIELD_RULES}`;

const PART_SYSTEM = `You turn ONE PART of a longer timestamped lecture or meeting transcript into study material.
Cover only this part; other parts are handled separately and merged afterwards.
- summary: 2-3 sentences on what this part covers.
${FIELD_RULES.replace("4-7 points", "3-5 points").replace("3-8 topic changes", "1-4 topic changes").replace("4-5 multiple-choice", "2-3 multiple-choice")}`;

const MERGE_SYSTEM = `You are given the summaries of consecutive parts of one lecture or meeting, in order.
- title: short, specific title for the whole recording (not "Lecture Recap").
- tldr: 2-3 sentences a student could read instead of watching the whole thing.`;

// ~30 minutes of speech. Longer transcripts are analyzed in parts, in parallel, then merged:
// each request stays small and fast, and a failed part doesn't sink the whole recap.
export const CHUNK_CHARS = 28_000;
const CONCURRENCY = 3;

type RawPart = Omit<Recap, "provider" | "highlights" | "title" | "tldr"> & {
  highlights: Omit<Recap["highlights"][number], "score">[];
};
type RawRecap = RawPart & { title: string; tldr: string };

export type Progress = (message: string) => void;

export function chunkSegments(segments: Segment[], maxChars = CHUNK_CHARS): Segment[][] {
  const chunks: Segment[][] = [];
  let cur: Segment[] = [];
  let size = 0;
  for (const s of segments) {
    const len = s.text.length + 10;
    if (cur.length && size + len > maxChars) { chunks.push(cur); cur = []; size = 0; }
    cur.push(s);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export async function analyze(segments: Segment[], config: AIConfig, onProgress: Progress = () => {}): Promise<{ recap: Recap; note?: string }> {
  if (!isAIReady(config)) return { recap: offlineRecap(segments) };
  const provider = PROVIDERS[config.provider].label;
  try {
    const chunks = chunkSegments(segments);
    if (chunks.length === 1) {
      onProgress(`Asking ${provider}…`);
      const raw = await generateJson<RawRecap>(config, RECAP_SYSTEM, transcriptForPrompt(segments), RECAP_SCHEMA);
      return { recap: normalizeRecap(raw, segments, config.provider) };
    }
    let done = 0;
    onProgress(`${provider}: analyzing ${chunks.length} parts in parallel…`);
    const parts = await pool(chunks, CONCURRENCY, async (chunk, i) => {
      const header = `Part ${i + 1} of ${chunks.length} (${formatTime(chunk[0].start)}–${formatTime(chunk[chunk.length - 1].end)})\n`;
      const part = await generateJson<RawPart & { summary: string }>(config, PART_SYSTEM, header + transcriptForPrompt(chunk), PART_SCHEMA);
      onProgress(`${provider}: ${++done} of ${chunks.length} parts done`);
      return part;
    });
    onProgress(`${provider}: merging parts…`);
    const summaries = parts.map((p, i) => `Part ${i + 1}: ${p.summary}`).join("\n");
    const head = await generateJson<{ title: string; tldr: string }>(config, MERGE_SYSTEM, summaries, MERGE_SCHEMA, 2000);
    return { recap: normalizeRecap(mergeParts(head, parts), segments, config.provider) };
  } catch (error) {
    // Any AI failure still gets the user a recap - the offline one, with a note why.
    const reason = error instanceof LLMUnavailable ? error.message : "AI analysis failed";
    console.error("analyze:", error);
    return { recap: offlineRecap(segments), note: `${reason} — showing the offline analysis instead.` };
  }
}

// Merge per-part results locally. Picking the best clips is done here, from our own
// recomputed scores, so the merge step never needs to see the whole transcript.
export function mergeParts(head: { title: string; tldr: string }, parts: RawPart[]): RawRecap {
  const seenTerms = new Set<string>();
  const seenActions = new Set<string>();
  const quizPerPart = Math.max(1, Math.ceil(6 / parts.length));
  return {
    title: head.title,
    tldr: head.tldr,
    keyPoints: parts.flatMap((p) => p.keyPoints ?? []),
    notes: parts.map((p) => p.notes ?? "").filter(Boolean).join("\n\n"),
    chapters: parts.flatMap((p) => p.chapters ?? []),
    // normalizeRecap scores and sorts; the top 3 survive below.
    highlights: parts.flatMap((p) => p.highlights ?? []),
    quiz: parts.flatMap((p) => (p.quiz ?? []).slice(0, quizPerPart)).slice(0, 8),
    actionItems: parts.flatMap((p) => p.actionItems ?? []).filter((a) => {
      const k = a.toLowerCase().trim();
      return !seenActions.has(k) && seenActions.add(k);
    }),
    terms: parts.flatMap((p) => p.terms ?? []).filter((t) => {
      const k = t.term.toLowerCase().trim();
      return !seenTerms.has(k) && seenTerms.add(k);
    }).slice(0, 12),
  };
}

// Never trust model numbers blindly: snap times to real segments, clamp sub-scores,
// recompute the overall score, and drop malformed or impossible items.
export function normalizeRecap(raw: RawRecap, segments: Segment[], provider: string): Recap {
  const last = segments[segments.length - 1]?.end ?? 0;
  const at = (t: number) => snapToSegment(segments, clamp(t, 0, last));
  const scored = (raw.highlights ?? [])
    .filter((h) => h.start >= 0 && h.start < last && h.end > h.start) // impossible ranges are dropped, not "fixed"
    .map((h) => {
      const breakdown: ScoreBreakdown = {
        hook: clamp(h.breakdown?.hook, 0, 10),
        insight: clamp(h.breakdown?.insight, 0, 10),
        standalone: clamp(h.breakdown?.standalone, 0, 10),
        energy: clamp(h.breakdown?.energy, 0, 10),
      };
      const start = at(h.start);
      let end = snapEnd(segments, clamp(h.end, start + 5, last));
      if (end <= start) end = Math.min(last, start + 20);
      return { ...h, start, end, breakdown, score: scoreFrom(breakdown) };
    })
    .filter((h) => h.end - h.start >= 5)
    .sort((a, b) => b.score - a.score);
  const highlights = scored.filter((h, i) => scored.slice(0, i).every((p) => h.end <= p.start || h.start >= p.end)).slice(0, 3);

  return {
    title: raw.title || "Untitled recording",
    tldr: raw.tldr ?? "",
    keyPoints: (raw.keyPoints ?? []).map((k) => ({ text: k.text, at: at(k.at) })).sort((a, b) => a.at - b.at),
    notes: (raw.notes ?? "").replace(/^# .*\n/gm, ""),
    chapters: (raw.chapters ?? []).map((c) => ({ title: c.title, start: at(c.start) })).sort((a, b) => a.start - b.start)
      .filter((c, i, all) => i === 0 || c.start !== all[i - 1].start),
    highlights,
    quiz: (raw.quiz ?? [])
      .filter((q) => Array.isArray(q.choices) && q.choices.length >= 2 && q.answer >= 0 && q.answer < q.choices.length)
      .map((q) => ({ ...q, at: at(q.at) })),
    actionItems: raw.actionItems ?? [],
    terms: raw.terms ?? [],
    provider,
  };
}

const ASK_SCHEMA = obj({ answer: str, citations: arr(num) });

const ASK_SYSTEM = `Answer the question using only the timestamped transcript ("[seconds] text" lines).
Be concise and direct (markdown ok). "citations" lists the seconds values of the 1-3 lines that support the answer.
If the transcript doesn't cover it, say so plainly and return no citations.`;

export async function ask(question: string, segments: Segment[], config: AIConfig): Promise<AskAnswer & { note?: string }> {
  if (!isAIReady(config)) return offlineAsk(question, segments);
  try {
    const raw = await generateJson<{ answer: string; citations: number[] }>(
      config,
      ASK_SYSTEM,
      `<transcript>\n${transcriptForPrompt(segments)}\n</transcript>\n\nQuestion: ${question}`,
      ASK_SCHEMA,
      4000,
    );
    const last = segments[segments.length - 1]?.end ?? 0;
    return {
      answer: raw.answer,
      citations: [...new Set((raw.citations ?? [])
        .filter((t) => t >= 0 && t <= last) // drop invented timestamps
        .map((t) => snapToSegment(segments, t)))].slice(0, 3),
      provider: config.provider,
    };
  } catch (error) {
    const note = error instanceof LLMUnavailable ? error.message : "AI answer failed";
    return { ...offlineAsk(question, segments), note };
  }
}
