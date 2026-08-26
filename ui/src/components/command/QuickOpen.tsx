import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Node } from "../../api";
import { iconFor, colorFor } from "../explorer/NodeRow";
import { fuzzy } from "../../lib/fuzzy";

// 快速打开(⌘P):模糊搜索整棵树,回车打开
export function QuickOpen({
  onPick,
  onClose,
}: {
  onPick: (n: Node) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<Node[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 只列可打开的(智能体/文件);空间只在树里展开,不开标签
    api.listAllNodes().then((r) => setAll((r.nodes || []).filter((n) => n.kind !== "space"))).catch(() => setAll([]));
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const scored = all
      .map((n) => ({ n, s: fuzzy(q, n.title) }))
      .filter((x) => x.s !== null) as { n: Node; s: number }[];
    scored.sort((a, b) => b.s - a.s || a.n.title.localeCompare(b.n.title));
    return scored.slice(0, 50).map((x) => x.n);
  }, [all, q]);

  useEffect(() => { setSel(0); }, [q]);

  const choose = (n?: Node) => {
    const target = n || results[sel];
    if (target) { onPick(target); onClose(); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-bg rounded-xl shadow-2xl shadow-black/25 border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="按名称搜索 智能体 / 文件…"
          className="w-full px-4 py-3 text-[15px] bg-transparent text-text outline-none border-b border-border"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-text-faint">无匹配</div>
          )}
          {results.map((n, i) => {
            const Icon = iconFor(n.kind, n.title);
            return (
              <button
                key={n.id}
                onClick={() => choose(n)}
                onMouseEnter={() => setSel(i)}
                className={[
                  "w-full flex items-center gap-2.5 px-4 py-1.5 text-left",
                  i === sel ? "bg-accent-soft" : "hover:bg-bg-hover",
                ].join(" ")}
              >
                <Icon size={14} className={`shrink-0 ${colorFor(n.kind)}`} />
                <span className="text-[14px] text-text truncate">{n.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
