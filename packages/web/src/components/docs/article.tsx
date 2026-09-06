import { groupTitleFor, neighbours, type DocPage } from "@/lib/docs/content";
import { renderDoc } from "@/lib/docs/render";
import { CodeBlock } from "./code-block";
import { MermaidBlock } from "./mermaid-block";
import { DocsPrevNext } from "./prev-next";
import { DocsToc } from "./toc";

export async function DocArticle({ page }: { page: DocPage }) {
  const { parts, headings } = await renderDoc(page.body, page.dir);
  const { previous, next } = neighbours(page);

  return (
    <div className="docs-columns" key={page.href}>
      <article className="docs-main">
        <header className="docs-enter">
          <p className="docs-eyebrow">
            <span className="docs-eyebrow-mark" aria-hidden />
            {groupTitleFor(page) ?? "Documentation"}
          </p>
          <h1 className="docs-title">{page.title}</h1>
          {page.description ? <p className="docs-lede">{page.description}</p> : null}
        </header>

        <div className="docs-article docs-enter docs-enter-late">
          {parts.map((part, index) => {
            if (part.kind === "html") {
              return <div key={index} dangerouslySetInnerHTML={{ __html: part.html }} />;
            }
            if (part.kind === "mermaid") {
              return <MermaidBlock key={index} code={part.code} />;
            }
            return <CodeBlock key={index} language={part.language} code={part.code} />;
          })}
        </div>

        <DocsPrevNext
          previous={previous ? { title: previous.navTitle, href: previous.href } : null}
          next={next ? { title: next.navTitle, href: next.href } : null}
        />
      </article>

      <DocsToc headings={headings} />
    </div>
  );
}
