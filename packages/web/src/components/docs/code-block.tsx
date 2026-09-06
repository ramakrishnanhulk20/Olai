"use client";

import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

export function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copy, setCopy] = useState<CopyState>("idle");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
    window.setTimeout(() => setCopy("idle"), 1800);
  };

  return (
    <div className="docs-code">
      <div className="docs-code-bar">
        <span className="docs-code-lang">{language}</span>
        <button type="button" onClick={() => void onCopy()} className="docs-code-copy">
          {copy === "copied" ? "Copied" : copy === "failed" ? "Select it by hand" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
