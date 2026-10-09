// Shapes shared by the browser and the API routes.

export type Segment = {
  id: number;
  start: number; // seconds
  end: number;
  text: string;
};

export type ScoreBreakdown = {
  hook: number; // 0-10: would the first line stop a scroll?
  insight: number; // 0-10: does it teach or reveal something?
  standalone: number; // 0-10: does it make sense without the rest of the talk?
  energy: number; // 0-10: emphasis, emotion, pace
};

export type Highlight = {
  start: number;
  end: number;
  title: string;
  hook: string; // on-screen caption for the top of the vertical clip
  score: number; // 0-100, computed from the breakdown, never trusted from the model
  breakdown: ScoreBreakdown;
  reason: string; // why this moment was picked
};

export type Chapter = { start: number; title: string };

export type QuizQuestion = {
  question: string;
  choices: string[];
  answer: number; // index into choices
  explanation: string;
  at: number; // seconds where the answer is discussed
};

export type Recap = {
  title: string;
  tldr: string;
  keyPoints: { text: string; at: number }[];
  notes: string; // markdown
  chapters: Chapter[];
  highlights: Highlight[];
  quiz: QuizQuestion[];
  actionItems: string[];
  terms: { term: string; definition: string }[];
  provider: string; // which engine produced this: claude | gemini | publik | offline
};

export type AskAnswer = {
  answer: string;
  citations: number[]; // seconds
  provider: string;
};

export type Word = { text: string; start: number; end: number };
