// Flashcards with spaced review - the study method the sample lecture itself recommends.
// Scheduling is a small SM-2 variant (the algorithm behind SuperMemo and early Anki):
// each card has an ease factor, and every successful review multiplies its interval.
import type { Recap } from "./types";

export type Grade = 0 | 1 | 2 | 3; // again, hard, good, easy

export type Card = {
  id: string;
  front: string;
  back: string;
  at: number | null; // seconds in the recording, for "jump to where this was taught"
  ease: number; // starts at 2.5, never below 1.3
  interval: number; // days until the next review (0 = still learning)
  due: number; // epoch ms
  reps: number;
  lapses: number;
};

const DAY = 86_400_000;
const MIN = 60_000;

function newCard(id: string, front: string, back: string, at: number | null, now: number): Card {
  return { id, front, back, at, ease: 2.5, interval: 0, due: now, reps: 0, lapses: 0 };
}

export function makeCards(recap: Recap, now = Date.now()): Card[] {
  const cards: Card[] = [];
  recap.terms.forEach((t, i) => cards.push(newCard(`t${i}`, `What is **${t.term}**?`, t.definition, null, now)));
  recap.quiz.forEach((q, i) => {
    const answer = q.choices[q.answer];
    cards.push(newCard(`q${i}`, q.question, `**${answer}**\n\n${q.explanation}`, q.at, now));
  });
  // Key points become recall prompts: "What was said at 12:30 about …?" is too vague, so
  // only use them when there are few other cards.
  if (cards.length < 6) {
    recap.keyPoints.forEach((k, i) => cards.push(newCard(`k${i}`, `Explain this key point in your own words, then check:`, k.text, k.at, now)));
  }
  return cards;
}

// Returns the updated card. Learning steps (1 min, 10 min) come before day intervals.
export function review(card: Card, grade: Grade, now = Date.now()): Card {
  const c = { ...card, reps: card.reps + 1 };
  if (grade === 0) {
    c.lapses += 1;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.interval = 0;
    c.due = now + MIN;
    return c;
  }
  if (c.interval === 0) {
    // Still learning: hard repeats soon, good graduates to 1 day, easy to 4 days.
    if (grade === 1) { c.due = now + 10 * MIN; return c; }
    c.interval = grade === 3 ? 4 : 1;
  } else {
    const factor = grade === 1 ? 1.2 : grade === 2 ? c.ease : c.ease * 1.3;
    c.interval = Math.max(c.interval + 1, Math.round(c.interval * factor));
  }
  c.ease = Math.max(1.3, c.ease + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0));
  c.due = now + c.interval * DAY;
  return c;
}

export function nextLabel(card: Card, grade: Grade, now = Date.now()): string {
  const ms = review(card, grade, now).due - now;
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}m`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))}h`;
  const days = Math.round(ms / DAY);
  return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

export function deckStats(cards: Card[], now = Date.now()) {
  return {
    due: cards.filter((c) => c.due <= now).length,
    learning: cards.filter((c) => c.interval === 0 && c.reps > 0).length,
    fresh: cards.filter((c) => c.reps === 0).length,
    mature: cards.filter((c) => c.interval >= 21).length,
    total: cards.length,
  };
}

// Anki imports tab-separated text: front<TAB>back per line. Markdown bold -> <b>.
export function toAnkiTSV(cards: Card[]): string {
  const clean = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\t/g, " ").replace(/\n+/g, "<br>");
  return ["#separator:tab", "#html:true", ...cards.map((c) => `${clean(c.front)}\t${clean(c.back)}`)].join("\n");
}
