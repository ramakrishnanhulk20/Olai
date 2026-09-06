import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeStringify from "rehype-stringify";

export type DocHeading = { id: string; text: string; depth: 2 | 3 };

export type DocPart =
  | { kind: "html"; html: string }
  | { kind: "code"; language: string; code: string }
  | { kind: "mermaid"; code: string };

export type RenderedDoc = { parts: DocPart[]; headings: DocHeading[] };

type Node = { type: string; children?: Node[]; [key: string]: unknown };

const MARKER = /<div data-olai-block="(\d+)"><\/div>/;

/**
 * A link written for a file tree (`../security/threat-model.md`) has to become a
 * route (`/docs/security/threat-model`). Anything absolute, external or a bare
 * fragment is left exactly as the author wrote it.
 */
function docsHref(url: string, fromDir: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//") || url.startsWith("/") || url.startsWith("#")) {
    return url;
  }

  const cut = url.search(/[#?]/);
  const target = cut === -1 ? url : url.slice(0, cut);
  const tail = cut === -1 ? "" : url.slice(cut);
  if (target.length === 0) return url;

  const resolved = path.posix.normalize(path.posix.join(fromDir, target.replace(/\.mdx?$/i, "")));
  if (resolved.startsWith("..")) return url;

  const clean = resolved === "." || resolved === "index" ? "" : resolved.replace(/\/index$/, "");
  return clean.length === 0 ? `/docs${tail}` : `/docs/${clean}${tail}`;
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  const children = node.children;
  if (!Array.isArray(children)) return;
  for (const child of children) walk(child, visit);
}

function textOf(node: Node): string {
  let out = "";
  walk(node, (current) => {
    if (current.type === "text" && typeof current.value === "string") out += current.value;
  });
  return out.trim();
}

function wrapTables(node: Node): void {
  const children = node.children;
  if (!Array.isArray(children)) return;

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.type === "element" && child.tagName === "table") {
      children[i] = {
        type: "element",
        tagName: "div",
        properties: { className: ["docs-table"] },
        children: [child],
      };
      continue;
    }
    wrapTables(child);
  }
}

const anchorMark = {
  type: "element" as const,
  tagName: "span",
  properties: { className: ["docs-anchor"] },
  children: [{ type: "text" as const, value: "#" }],
};

export async function renderDoc(body: string, fromDir: string): Promise<RenderedDoc> {
  const blocks: DocPart[] = [];
  const headings: DocHeading[] = [];

  const codeHandler = (_state: unknown, node: { lang?: string | null; value?: string }) => {
    const language = (node.lang ?? "").trim().toLowerCase();
    const code = (node.value ?? "").replace(/\s+$/, "");
    blocks.push(language === "mermaid" ? { kind: "mermaid", code } : { kind: "code", language: language || "text", code });

    return {
      type: "element" as const,
      tagName: "div",
      properties: { "data-olai-block": String(blocks.length - 1) },
      children: [],
    };
  };

  const html = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(() => (tree: Node) => {
        // The page header already prints the title, so the leading h1 would read twice.
        const top = tree.children;
        if (Array.isArray(top)) {
          const at = top.findIndex((child) => child.type === "heading" && child.depth === 1);
          if (at !== -1) top.splice(at, 1);
        }
        walk(tree, (node) => {
          if (node.type === "link" && typeof node.url === "string") {
            node.url = docsHref(node.url, fromDir);
          }
        });
      })
      .use(remarkRehype, { handlers: { code: codeHandler } })
      .use(rehypeSlug)
      .use(() => (tree: Node) => {
        wrapTables(tree);
        walk(tree, (node) => {
          if (node.type !== "element") return;
          if (node.tagName !== "h2" && node.tagName !== "h3") return;
          const properties = node.properties as { id?: unknown } | undefined;
          if (typeof properties?.id !== "string") return;
          headings.push({ id: properties.id, text: textOf(node), depth: node.tagName === "h2" ? 2 : 3 });
        });
      })
      .use(rehypeAutolinkHeadings, { behavior: "append", content: anchorMark })
      .use(rehypeStringify)
      .process(body),
  );

  const parts: DocPart[] = [];
  let rest = html;

  for (let match = rest.match(MARKER); match; match = rest.match(MARKER)) {
    const at = match.index ?? 0;
    const before = rest.slice(0, at);
    if (before.trim().length > 0) parts.push({ kind: "html", html: before });
    parts.push(blocks[Number(match[1])]);
    rest = rest.slice(at + match[0].length);
  }
  if (rest.trim().length > 0) parts.push({ kind: "html", html: rest });

  return { parts, headings };
}
