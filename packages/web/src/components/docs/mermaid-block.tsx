"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./docs-chrome.module.css";

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

// Under this much shrink the labels stop being comfortable, so the caption says so.
const TIGHT = 0.6;

function naturalSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.viewBox.baseVal;
  if (box !== null && box.width > 0 && box.height > 0) return { width: box.width, height: box.height };
  const rect = svg.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

/**
 * One diagram, drawn in the browser. Mermaid is loaded only when a page that
 * carries a diagram is opened, which keeps it out of every other bundle.
 */
export function MermaidBlock({ code }: { code: string }) {
  const raw = useId();
  const id = `olai-diagram-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const frameRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [tight, setTight] = useState(false);

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
          // Fitted to the column, because a diagram drawn at its own size reads as one
          // chopped off at the right edge. Full size is one click away instead.
          flowchart: { useMaxWidth: true, padding: 12 },
          sequence: { useMaxWidth: true },
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

  useEffect(() => {
    if (svg === null) return;
    const node = frameRef.current?.querySelector("svg");
    if (!node) return;

    const measure = () => {
      const natural = naturalSize(node);
      const drawn = node.getBoundingClientRect().width;
      setTight(natural.width > 0 && drawn / natural.width < TIGHT);
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [svg]);

  const openFullSize = useCallback(() => {
    const node = frameRef.current?.querySelector("svg");
    if (!node) return;

    const natural = naturalSize(node);
    const clone = node.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute("style");
    clone.setAttribute("width", String(Math.round(natural.width)));
    clone.setAttribute("height", String(Math.round(natural.height)));
    clone.style.background = "#0a0a0a";

    const markup = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    window.open(url, "_blank", "noopener,noreferrer");
    // The tab holds its own copy once it has loaded, so the handle can go.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, []);

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
    <figure className={`docs-mermaid ${styles.diagram}`}>
      {svg === null ? (
        <span className="docs-mermaid-wait">diagram</span>
      ) : (
        <>
          <div
            ref={frameRef}
            className={`docs-mermaid-svg ${styles.diagramFrame}`}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <figcaption className={styles.diagramFoot}>
            <button type="button" onClick={openFullSize} className={styles.diagramOpen}>
              Open full size
            </button>
            {tight ? (
              <span className={styles.diagramNote}>
                Scaled to fit. Open full size to read every label.
              </span>
            ) : null}
          </figcaption>
        </>
      )}
    </figure>
  );
}
