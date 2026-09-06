import Link from "next/link";

type Step = { title: string; href: string } | null;

export function DocsPrevNext({ previous, next }: { previous: Step; next: Step }) {
  if (previous === null && next === null) return null;

  return (
    <nav aria-label="Previous and next page" className="docs-prevnext">
      {previous ? (
        <Link href={previous.href} className="docs-step">
          <span className="docs-step-label">Previous</span>
          <span className="docs-step-title">{previous.title}</span>
        </Link>
      ) : (
        <span />
      )}

      {next ? (
        <Link href={next.href} className="docs-step is-next">
          <span className="docs-step-label">Next</span>
          <span className="docs-step-title">{next.title}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
