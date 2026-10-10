// The offline engine: a no-API-key analyzer so Recap always produces *something*.
// Plain text statistics - keyword frequency, cue phrases, sentence shape. Every
// number it outputs can be explained in one sentence, which is the point.
import { clamp, formatTime, scoreFrom } from "./format";
import { cosine, textRank, tfidf, topicBreaks, type Vec } from "./textrank";
import type { AskAnswer, Chapter, Highlight, QuizQuestion, Recap, ScoreBreakdown, Segment } from "./types";

const STOP = new Set(
  `a about above after again against all also am an and any are aren't as at be because been before being below between both
but by can can't could couldn't did didn't do does doesn't doing don't down during each few for from further get gets got had
hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm
i've if in into is isn't it it's its itself just know let's like lot make me more most mustn't my myself no nor not now of off
on once one only or other ought our ours ourselves out over own really right same say says see she she'd she'll she's should
shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're
they've thing things think this those through to too um uh under until up us very want was wasn't way we we'd we'll we're we've
well were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't
yeah yes you you'd you'll you're you've your yours yourself yourselves going gonna actually okay ok go two first next kind sort
mean new time call called even still much many every something because take look let use used
remember three four five six seven eight nine ten hundred thousand able exactly almost`.split(/\s+/),
);

const HOOK_CUES = /^(so here'?s|here'?s|imagine|the (secret|key|trick|problem|reason)|what if|why|how|did you know|most people|the biggest|never|stop|if you)/i;
const ENERGY_CUES = /\b(really|never|always|most|important|huge|incredible|amazing|crucial|surprising|wrong|secret|best|worst|biggest)\b/gi;
const TRANSITION = /^(so,? (here|now|let'?s|what|the next)|now,? |okay,? |ok,? |alright,? |let'?s |next,? |moving on|another |the (next|second|third|last) |first,? |finally,? )/i;
const DANGLING_START = /^(and|but|so|it|this|that|they|he|she|which|because|also|then)\b/i;
const ACTION_CUES = /\b(need to|make sure|remember to|don'?t forget|homework|is due|are due|due (on|by|at)|deadline|for next (time|week|class)|action item|follow up|by (monday|tuesday|wednesday|thursday|friday|tomorrow))\b/i;

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
}

function keywordCounts(segments: Segment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of segments) for (const w of words(s.text)) if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return counts;
}

// Repeated two-word phrases ("spacing effect") are usually the real key terms.
function topPhrases(segments: Segment[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const s of segments) {
    const ws = words(s.text);
    for (let i = 0; i + 1 < ws.length; i++) {
      if (STOP.has(ws[i]) || STOP.has(ws[i + 1])) continue;
      const p = `${ws[i]} ${ws[i + 1]}`;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, n).map(([p]) => p);
}

function topKeywords(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function density(text: string, counts: Map<string, number>, maxCount: number): number {
  const ws = words(text);
  if (!ws.length) return 0;
  const sum = ws.reduce((acc, w) => acc + (STOP.has(w) ? 0 : (counts.get(w) ?? 0) / maxCount), 0);
  return sum / Math.sqrt(ws.length);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sentenceCase(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return cap(t.endsWith(".") || t.endsWith("?") || t.endsWith("!") ? t : `${t}.`);
}

function shorten(text: string, n = 60): string {
  const t = text.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n).replace(/\s+\S*$/, "")}…`;
}

function scoreWindow(win: Segment[], counts: Map<string, number>, maxCount: number): { breakdown: ScoreBreakdown; reason: string } {
  const text = win.map((s) => s.text).join(" ");
  const first = win[0].text.trim();
  const reasons: string[] = [];

  let hook = 3;
  if (HOOK_CUES.test(first)) { hook += 4; reasons.push(`opens with a hook phrase ("${shorten(first, 30)}")`); }
  if (/\?/.test(first)) { hook += 2; reasons.push("opens on a question"); }
  if (/\b\d+(\.\d+)?\s*(%|percent|times|x)\b/i.test(first)) { hook += 2; reasons.push("leads with a number"); }

  const d = density(text, counts, maxCount);
  const insight = clamp(Math.round(d * 9), 1, 10);
  if (insight >= 6) reasons.push("dense with the talk's main terms");

  let standalone = 8;
  if (DANGLING_START.test(first)) { standalone -= 4; reasons.push("starts mid-thought (lower standalone)"); }
  if (!/[.!?]$/.test(win[win.length - 1].text.trim())) standalone -= 1;

  const energyHits = (text.match(ENERGY_CUES) ?? []).length + (text.match(/!/g) ?? []).length;
  const energy = clamp(3 + energyHits * 2, 0, 10);
  if (energyHits >= 2) reasons.push(`${energyHits} emphasis cues`);

  return {
    breakdown: { hook: clamp(hook, 0, 10), insight, standalone: clamp(standalone, 0, 10), energy },
    reason: reasons.length ? cap(reasons.join("; ")) + "." : "Steady, on-topic stretch of the talk.",
  };
}

export function findHighlights(segments: Segment[], counts: Map<string, number>, howMany = 3): Highlight[] {
  const maxCount = Math.max(1, ...counts.values());
  const candidates: Highlight[] = [];
  for (let i = 0; i < segments.length; i++) {
    const win: Segment[] = [];
    for (let j = i; j < segments.length; j++) {
      win.push(segments[j]);
      const len = segments[j].end - segments[i].start;
      if (len >= 15 && len <= 60) {
        const { breakdown, reason } = scoreWindow(win, counts, maxCount);
        const text = win.map((s) => s.text).join(" ");
        candidates.push({
          start: segments[i].start,
          end: segments[j].end,
          title: cap(shorten(segments[i].text, 48)),
          hook: shorten(sentenceCase(segments[i].text), 70),
          score: scoreFrom(breakdown),
          breakdown,
          reason,
        });
        if (len > 35 && /[.!?]$/.test(text.trim())) break;
      }
      if (len > 60) break;
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked: Highlight[] = [];
  for (const c of candidates) {
    if (picked.every((p) => c.end <= p.start || c.start >= p.end)) picked.push(c);
    if (picked.length === howMany) break;
  }
  return picked.sort((a, b) => b.score - a.score);
}

// Chapters from topic shifts (TextTiling), titled by the phrase most distinctive to each
// chapter compared to the whole talk. Falls back to even splits for very short talks.
function chaptersFor(segments: Segment[], vecs: Vec[], phrases: string[]): Chapter[] {
  if (!segments.length) return [];
  const duration = segments[segments.length - 1].end;
  // A chapter should be at least ~1/10 of the talk: 20 s for a short clip, 90 s for a long lecture.
  let breaks = topicBreaks(vecs, segments.map((s) => s.start), { block: 4, minGapSec: clamp(duration / 10, 20, 90), maxChapters: 8 });
  // TextTiling finds roughly where the vocabulary changes; speakers announce the exact spot
  // ("So here's…", "Now, …", "Let's…"). Snap each break to a nearby sentence that opens with a cue.
  breaks = [...new Set(breaks.map((b) => {
    if (b === 0) return 0;
    for (const d of [0, -1, 1, -2, 2, -3, 3]) {
      const j = b + d;
      if (j > 0 && j < segments.length && TRANSITION.test(segments[j].text.trim())) return j;
    }
    return b;
  }))].sort((a, b) => a - b);
  if (breaks.length === 1) {
    const n = clamp(Math.round(duration / 120), 1, 6);
    const size = Math.ceil(segments.length / n);
    breaks = Array.from({ length: n }, (_, k) => k * size).filter((i) => i < segments.length);
  }
  const parts = breaks.map((b, k) => segments.slice(b, breaks[k + 1] ?? segments.length));
  const texts = parts.map((p) => p.map((s) => s.text.toLowerCase()).join(" "));

  // Give each repeated phrase to the chapter that says it most often (by density), one
  // phrase per chapter: an intro that lists every topic once loses to the chapter that explains it.
  const titles: (string | undefined)[] = parts.map(() => undefined);
  const pairs = phrases.flatMap((p) => texts.map((t, k) => ({ p, k, n: t.split(p).length - 1, d: (t.split(p).length - 1) / Math.max(1, t.length) })))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.d - a.d);
  const usedPhrases = new Set<string>();
  for (const { p, k } of pairs) {
    if (titles[k] || usedPhrases.has(p)) continue;
    titles[k] = p;
    usedPhrases.add(p);
  }

  // Fallback: the two words most distinctive to this chapter (said at least twice here).
  const docCounts = keywordCounts(segments);
  const docTotal = [...docCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const used = new Set<string>([...usedPhrases].flatMap((p) => p.split(" ")));
  return parts.map((part, k) => {
    let title = titles[k];
    if (!title) {
      const counts = keywordCounts(part);
      const total = [...counts.values()].reduce((a, c) => a + c, 0) || 1;
      const best = [...counts.entries()]
        .filter(([w, c]) => c >= 2 && !used.has(w))
        .map(([w, c]) => ({ w, s: (c / total) / ((docCounts.get(w) ?? c) / docTotal) * Math.log(1 + c) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 2)
        .map((x) => x.w);
      best.forEach((w) => used.add(w));
      title = best.length ? best.join(" & ") : shorten(part[0].text, 32);
    }
    return { start: part[0].start, title: title.split(" ").map((w) => (w === "&" ? w : cap(w))).join(" ") };
  });
}

// TextRank picks, with redundancy control: skip a sentence too similar to one already chosen.
function pickRanked(cands: { s: Segment; v: Vec; r: number }[], k: number, maxSim = 0.45) {
  const chosen: typeof cands = [];
  for (const c of [...cands].sort((a, b) => b.r - a.r)) {
    if (chosen.every((x) => cosine(x.v, c.v) < maxSim)) chosen.push(c);
    if (chosen.length === k) break;
  }
  return chosen;
}

function quizFor(segments: Segment[], keywords: string[]): QuizQuestion[] {
  const quiz: QuizQuestion[] = [];
  const usedWords = new Set<string>();
  const usedSegs = new Set<number>();
  for (const kw of keywords) {
    if (quiz.length === 4) break;
    // Prefer a sentence that explains the term ("X means/is ..."), one question per sentence.
    const candidates = segments.filter((s) => !usedSegs.has(s.id) && new RegExp(`\\b${kw}\\b`, "i").test(s.text) && words(s.text).length >= 8);
    const seg = candidates.find((s) => new RegExp(`\\b${kw}\\b[^.]{0,20}\\b(is|are|means)\\b`, "i").test(s.text)) ?? candidates[0];
    if (!seg || usedWords.has(kw)) continue;
    usedSegs.add(seg.id);
    const distractors = keywords.filter((k) => k !== kw && !usedWords.has(k) && !new RegExp(`\\b${k}\\b`, "i").test(seg.text)).slice(0, 3);
    if (distractors.length < 3) continue;
    usedWords.add(kw);
    const blanked = seg.text.trim().replace(new RegExp(`\\b${kw}\\b`, "i"), "_____");
    const choices = [kw, ...distractors];
    // Deterministic shuffle so the same transcript always gives the same quiz.
    const rot = quiz.length % choices.length;
    const rotated = [...choices.slice(rot), ...choices.slice(0, rot)];
    quiz.push({
      question: `Fill in the blank: "${sentenceCase(blanked)}"`,
      choices: rotated,
      answer: rotated.indexOf(kw),
      explanation: `At ${formatTime(seg.start)} the speaker says "${shorten(seg.text, 120)}"`,
      at: seg.start,
    });
  }
  return quiz;
}

function termsFor(segments: Segment[], keywords: string[]) {
  const terms: { term: string; definition: string }[] = [];
  for (const kw of keywords) {
    if (terms.some((t) => t.term.toLowerCase().includes(kw))) continue;
    const seg = segments.find((s) => new RegExp(`\\b${kw}s?\\b[^.]{0,30}\\b(is|are|means|refers to)\\b`, "i").test(s.text));
    if (seg) terms.push({ term: kw.split(" ").map(cap).join(" "), definition: sentenceCase(seg.text) });
    if (terms.length === 6) break;
  }
  return terms;
}

export function offlineRecap(segments: Segment[]): Recap {
  const counts = keywordCounts(segments);
  const maxCount = Math.max(1, ...counts.values());
  const keywords = topKeywords(counts, 14);
  const phrases = topPhrases(segments, 6);
  const vocab = [...phrases, ...keywords.filter((k) => !phrases.some((p) => p.includes(k)))];

  const vecs = tfidf(segments.map((s) => words(s.text).filter((w) => !STOP.has(w))));
  const rank = textRank(vecs);
  // Candidates: full sentences of a readable length that don't start mid-thought.
  const cands = segments
    .map((s, i) => ({ s, v: vecs[i], r: rank[i] }))
    // No questions (rhetorical setups, not facts) and no fragments that start lowercase
    // (Whisper split them off the previous sentence).
    .filter(({ s }) => { const n = words(s.text).length; const t = s.text.trim(); return n >= 6 && n <= 45 && !t.endsWith("?") && !/^[a-z]/.test(t); })
    .map((c) => (DANGLING_START.test(c.s.text.trim()) ? { ...c, r: c.r * 0.6 } : c));
  const keyPoints = pickRanked(cands, 6).sort((a, b) => a.s.start - b.s.start)
    .map(({ s }) => ({ text: sentenceCase(s.text), at: s.start }));
  const tldrPicks = pickRanked(cands.filter(({ s }) => words(s.text).length <= 30), 2, 0.3).sort((a, b) => a.s.start - b.s.start);

  const chapters = chaptersFor(segments, vecs, phrases);
  const notes = chapters.map((c, i) => {
    const end = chapters[i + 1]?.start ?? Infinity;
    const inChapter = pickRanked(cands.filter(({ s }) => s.start >= c.start && s.start < end), 3)
      .sort((a, b) => a.s.start - b.s.start);
    return `## ${c.title} (${formatTime(c.start)})\n${inChapter.map(({ s }) => `- ${sentenceCase(s.text)}`).join("\n")}`;
  }).join("\n\n");

  return {
    title: phrases.length ? phrases[0].split(" ").map(cap).join(" ") + (keywords[0] && !phrases[0].includes(keywords[0]) ? ` & ${cap(keywords[0])}` : "")
      : keywords.length >= 2 ? `${cap(keywords[0])} & ${cap(keywords[1])}` : "Untitled recording",
    tldr: tldrPicks.map(({ s }) => sentenceCase(s.text)).join(" ") || "Not enough speech to summarize.",
    keyPoints,
    notes,
    chapters,
    highlights: findHighlights(segments, counts),
    quiz: quizFor(segments, vocab),
    actionItems: segments.filter((s) => ACTION_CUES.test(s.text)).slice(0, 6).map((s) => sentenceCase(s.text)),
    terms: termsFor(segments, vocab),
    provider: "offline",
  };
}

// Offline Q&A: return the passages that share the most words with the question.
export function offlineAsk(question: string, segments: Segment[]): AskAnswer {
  const q = new Set(words(question).filter((w) => !STOP.has(w)));
  const counts = keywordCounts(segments);
  // A match on a rare word ("problem", "due") says more than one on the talk's main topic.
  const weight = (w: string) => 1 / Math.log(2 + (counts.get(w) ?? 0));
  const scored = segments
    .map((s) => ({ s, hits: [...new Set(words(s.text))].filter((w) => q.has(w)).reduce((a, w) => a + weight(w), 0) }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const best = scored[0]?.hits ?? 0;
  const top = scored
    .filter((x) => x.hits >= best / 2) // drop weak, one-word coincidences
    .slice(0, 3)
    .sort((a, b) => a.s.start - b.s.start);
  if (!top.length) {
    return { answer: "I couldn't find that in the recording. (Offline mode only matches words; add an AI key for real answers.)", citations: [], provider: "offline" };
  }
  return {
    answer: `Closest passages in the recording:\n\n${top.map(({ s }) => `> ${s.text.trim()}`).join("\n\n")}`,
    citations: top.map(({ s }) => s.start),
    provider: "offline",
  };
}
