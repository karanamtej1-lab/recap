"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck, X } from "lucide-react";
import { PROVIDERS, type AIConfig, type ProviderId } from "@/lib/llm";

export function Settings({ config, onSave, onClose }: { config: AIConfig; onSave: (c: AIConfig) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<AIConfig>(config);
  const p = PROVIDERS[draft.provider];
  const set = (patch: Partial<AIConfig>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-md rounded-2xl p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI settings">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4 text-accent-soft" /> AI engine</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/50 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/5 p-1 text-sm">
          {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
            <button key={id} onClick={() => set({ provider: id, model: "" })}
              className={`rounded-lg py-2 transition ${draft.provider === id ? "bg-accent text-white" : "text-white/60 hover:text-white"}`}>
              {PROVIDERS[id].label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-white/55">{p.help}</p>

        {draft.provider !== "offline" && (
          <div className="mt-4 space-y-3">
            {draft.provider === "custom" && (
              <label className="block text-xs text-white/60">Base URL
                <input value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://openrouter.ai/api/v1"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 font-mono text-sm text-white outline-none focus:border-accent" />
              </label>
            )}
            <label className="block text-xs text-white/60">API key
              <input type="password" autoComplete="off" value={draft.key} onChange={(e) => set({ key: e.target.value.trim() })} placeholder={p.keyHint}
                className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 font-mono text-sm text-white outline-none focus:border-accent" />
            </label>
            <label className="block text-xs text-white/60">Model
              <input value={draft.model} onChange={(e) => set({ model: e.target.value.trim() })} placeholder={p.defaultModel || "e.g. llama3.1"}
                className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 font-mono text-sm text-white outline-none focus:border-accent" />
            </label>
            <p className="flex gap-2 rounded-lg bg-emerald-400/10 p-3 text-xs leading-relaxed text-emerald-100/90">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Your key is saved only in this browser and sent only to {p.label === "Custom" ? "the endpoint above" : p.label}. Recap has no server. Your
              transcript (never the audio) is what gets sent for analysis.
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {draft.key && (
            <button onClick={() => set({ key: "" })} className="mr-auto text-xs text-white/45 hover:text-hot">Forget key</button>
          )}
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-white/60 hover:text-white">Cancel</button>
          <button onClick={() => { onSave(draft); onClose(); }} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">Save</button>
        </div>
      </div>
    </div>
  );
}
