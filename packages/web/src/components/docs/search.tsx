"use client";

export function DocsSearch({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  id: string;
}) {
  return (
    <div className="docs-search">
      <label className="sr-only" htmlFor={id}>
        Filter the documentation
      </label>
      <span className="docs-search-mark" aria-hidden />
      <input
        id={id}
        type="search"
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder="Filter pages"
        onChange={(event) => onChange(event.target.value)}
        className="docs-input"
      />
    </div>
  );
}
