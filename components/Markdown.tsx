// A tiny, safe markdown renderer: headings, bullets, quotes, **bold**, `code`.
// Builds React elements (no innerHTML), so model output can't inject markup.
import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-white/10 px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`} className="mb-4 ml-5 list-disc space-y-1.5 marker:text-accent">{list}</ul>);
    list = [];
  };
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (/^[-*] /.test(t)) { list.push(<li key={i}>{inline(t.slice(2))}</li>); return; }
    flush();
    if (!t) return;
    if (t.startsWith("### ")) out.push(<h4 key={i} className="mb-2 mt-4 text-sm font-semibold text-white">{inline(t.slice(4))}</h4>);
    else if (t.startsWith("## ") || t.startsWith("# ")) out.push(<h3 key={i} className="mb-2 mt-6 text-base font-semibold text-white first:mt-0">{inline(t.replace(/^#+ /, ""))}</h3>);
    else if (t.startsWith("> ")) out.push(<blockquote key={i} className="mb-3 border-l-2 border-accent/60 pl-3 italic text-white/70">{inline(t.slice(2))}</blockquote>);
    else out.push(<p key={i} className="mb-3">{inline(t)}</p>);
  });
  flush();
  return <div className="text-[15px] leading-relaxed text-white/75">{out}</div>;
}
