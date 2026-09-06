"use client";

import { useEffect, useId, useState } from "react";

const THEME = {
  background: "#0a0a0a",
  primaryColor: "#141414",
  primaryTextColor: "#f2efe8",
  primaryBorderColor: "#f5a524",
  secondaryColor: "#121212",
  tertiaryColor: "#0f0f0f",
  lineColor: "rgba(242,239,232,0.45)",
  textColor: "#f2efe8",
  mainBkg: "#141414",
  nodeBorder: "rgba(245,165,36,0.75)",
  clusterBkg: "rgba(242,239,232,0.03)",
  clusterBorder: "rgba(242,239,232,0.14)",
  actorBkg: "#141414",
  actorBorder: "rgba(245,165,36,0.75)",
  actorTextColor: "#f2efe8",
  actorLineColor: "rgba(242,239,232,0.28)",
  signalColor: "rgba(242,239,232,0.7)",
  signalTextColor: "#f2efe8",
  labelBoxBkgColor: "#141414",
  labelBoxBorderColor: "rgba(245,165,36,0.6)",
  labelTextColor: "#f2efe8",
  loopTextColor: "#f2efe8",
  noteBkgColor: "rgba(245,165,36,0.12)",
  noteBorderColor: "rgba(245,165,36,0.5)",
  noteTextColor: "#f2efe8",
  edgeLabelBackground: "#0a0a0a",
  fontFamily: "var(--font-manrope), ui-sans-serif, sans-serif",
  fontSize: "14px",
};

/**
 * One diagram, drawn in the browser. Mermaid is loaded only when a page that
 * carries a diagram is opened, which keeps it out of every other bundle.
 */
export function MermaidBlock({ code }: { code: string }) {
  const raw = useId();
  const id = `olai-diagram-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "dark",
          themeVariables: THEME,
          // Drawn at its own size and scrolled sideways if it has to be. Squeezed to the
          // column width, the labels on the bigger graphs stop being readable.
          flowchart: { useMaxWidth: false, padding: 12 },
          sequence: { useMaxWidth: false },
        });
        const drawn = await mermaid.render(id, code);
        if (live) setSvg(drawn.svg);
      } catch {
        if (live) setFailed(true);
      }
    })();

    return () => {
      live = false;
    };
  }, [code, id]);

  if (failed) {
    return (
      <div className="docs-code">
        <div className="docs-code-bar">
          <span className="docs-code-lang">diagram source</span>
        </div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <figure className="docs-mermaid">
      {svg === null ? (
        <span className="docs-mermaid-wait">diagram</span>
      ) : (
        <div className="docs-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </figure>
  );
}
