// Prompts, schemas, and the cleanup step that turns a model's JSON into a trusted Recap.
import "server-only";
import { clamp, scoreFrom, snapEnd, snapToSegment, transcriptForPrompt } from "./format";
import { generateJson, type Provider } from "./llm";
import { offlineRecap } from "./offline";
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

const RECAP_SCHEMA = obj({
  title: str,
  tldr: str,
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
});

const RECAP_SYSTEM = `You turn a timestamped transcript of a lecture or meeting into study material.
Each transcript line is "[seconds] text". Every timestamp you output must be one of those seconds values.

- title: short, specific (not "Lecture Recap").
- tldr: 2-3 sentences a student could read instead of watching.
- keyPoints: 4-7 points in the order they come up, each with the time it's discussed.
- notes: well-structured markdown study notes using "## " headings per topic and "- " bullets; bold key terms with **term**. No top-level "# " title.
- chapters: 3-8 topic changes with start times; the first starts at the first timestamp.
- highlights: the 3 moments (15-60 seconds each, non-overlapping) that would work best as standalone vertical clips. "hook" is a punchy on-screen caption (max 70 chars). Score each 0-10 on: hook (would the opening line stop a scroll), insight (does it teach something), standalone (makes sense with no context), energy (emphasis, emotion). Be a harsh, honest grader; "reason" explains the scores in one sentence.
- quiz: 4-5 multiple-choice questions testing understanding (not trivia), 4 choices each, "answer" is the 0-based index of the correct choice, "at" is when it's covered.
- actionItems: assignments, deadlines, follow-ups, or decisions mentioned. Empty if none.
- terms: up to 8 key terms with one-sentence definitions grounded in what the speaker said.
Use only what is in the transcript.`;

type RawRecap = Omit<Recap, "provider" | "highlights"> & {
  highlights: (Omit<Recap["highlights"][number], "score">)[];
};

export async function aiRecap(segments: Segment[], provider: Provider): Promise<Recap> {
  const raw = await generateJson<RawRecap>(RECAP_SYSTEM, transcriptForPrompt(segments), RECAP_SCHEMA);
  return normalizeRecap(raw, segments, provider);
}

// Never trust model numbers blindly: snap times to real segments, clamp sub-scores,
// recompute the overall score, and drop malformed quiz questions.
export function normalizeRecap(raw: RawRecap, segments: Segment[], provider: string): Recap {
  const last = segments[segments.length - 1]?.end ?? 0;
  const at = (t: number) => snapToSegment(segments, clamp(t, 0, last));
  const highlights = (raw.highlights ?? [])
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

  return {
    title: raw.title || "Untitled recording",
    tldr: raw.tldr ?? "",
    keyPoints: (raw.keyPoints ?? []).map((k) => ({ text: k.text, at: at(k.at) })),
    notes: (raw.notes ?? "").replace(/^# .*\n/, ""),
    chapters: (raw.chapters ?? []).map((c) => ({ title: c.title, start: at(c.start) })).sort((a, b) => a.start - b.start),
    highlights,
    quiz: (raw.quiz ?? [])
      .filter((q) => Array.isArray(q.choices) && q.choices.length >= 2 && q.answer >= 0 && q.answer < q.choices.length)
      .map((q) => ({ ...q, at: at(q.at) })),
    actionItems: raw.actionItems ?? [],
    terms: raw.terms ?? [],
    provider,
  };
}

export { offlineRecap };

const ASK_SCHEMA = obj({ answer: str, citations: arr(num) });

const ASK_SYSTEM = `Answer the question using only the timestamped transcript ("[seconds] text" lines).
Be concise and direct (markdown ok). "citations" lists the seconds values of the 1-3 lines that support the answer.
If the transcript doesn't cover it, say so plainly and return no citations.`;

export async function aiAsk(question: string, segments: Segment[], provider: Provider): Promise<AskAnswer> {
  const raw = await generateJson<{ answer: string; citations: number[] }>(
    ASK_SYSTEM,
    `<transcript>\n${transcriptForPrompt(segments)}\n</transcript>\n\nQuestion: ${question}`,
    ASK_SCHEMA,
    4000,
  );
  return {
    answer: raw.answer,
    citations: [...new Set((raw.citations ?? [])
      .filter((t) => t >= 0 && t <= (segments[segments.length - 1]?.end ?? 0)) // drop invented timestamps
      .map((t) => snapToSegment(segments, t)))].slice(0, 3),
    provider,
  };
}
