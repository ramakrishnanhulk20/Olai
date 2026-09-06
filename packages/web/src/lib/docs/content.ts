import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type DocPage = {
  slug: string[];
  href: string;
  title: string;
  navTitle: string;
  description: string | null;
  group: string | null;
  order: number;
  body: string;
  /** Folder of the file inside content/docs, used to resolve relative links. */
  dir: string;
};

export type SidebarEntry =
  | { kind: "page"; page: DocPage }
  | { kind: "group"; id: string; title: string; pages: DocPage[] };

const ROOT = path.join(process.cwd(), "content", "docs");

// The reading order of the section. Anything not named here lands after the groups.
const GROUP_ORDER = ["getting-started", "concepts", "guides", "developers", "security"];

const GROUP_TITLES: Record<string, string> = {
  "getting-started": "Getting started",
  concepts: "Concepts",
  guides: "Guides",
  developers: "Developers",
  security: "Security",
};

function markdownFiles(dir: string, prefix: string[]): string[][] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const found: string[][] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      found.push(...markdownFiles(path.join(dir, entry.name), [...prefix, entry.name]));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push([...prefix, entry.name.slice(0, -3)]);
    }
  }

  return found;
}

function text(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function number(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstHeading(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function load(): DocPage[] {
  return markdownFiles(ROOT, []).map((segments) => {
    const file = path.join(ROOT, ...segments) + ".md";
    const parsed = matter(fs.readFileSync(file, "utf8"));
    const data = parsed.data as Record<string, unknown>;
    const isIndex = segments.length === 1 && segments[0] === "index";
    const slug = isIndex ? [] : segments;
    const title = text(data, "title") ?? firstHeading(parsed.content) ?? segments[segments.length - 1];

    return {
      slug,
      href: slug.length === 0 ? "/docs" : `/docs/${slug.join("/")}`,
      title,
      navTitle: text(data, "sidebar_label") ?? title,
      description: text(data, "description"),
      group: segments.length > 1 ? segments[0] : null,
      order: number(data, "sidebar_position") ?? 999,
      body: parsed.content,
      dir: segments.slice(0, -1).join("/"),
    } satisfies DocPage;
  });
}

let pages: DocPage[] | null = null;

function allPages(): DocPage[] {
  pages ??= load();
  return pages;
}

function byOrder(a: DocPage, b: DocPage): number {
  return a.order - b.order || a.title.localeCompare(b.title);
}

export function sidebar(): SidebarEntry[] {
  const all = allPages();
  const entries: SidebarEntry[] = [];

  const overview = all.find((page) => page.slug.length === 0);
  if (overview) entries.push({ kind: "page", page: overview });

  for (const id of GROUP_ORDER) {
    const inGroup = all.filter((page) => page.group === id).sort(byOrder);
    if (inGroup.length > 0) {
      entries.push({ kind: "group", id, title: GROUP_TITLES[id] ?? id, pages: inGroup });
    }
  }

  const loose = all
    .filter((page) => page.group === null && page.slug.length > 0)
    .sort(byOrder);
  for (const page of loose) entries.push({ kind: "page", page });

  const grouped = all.filter((page) => page.group !== null && !GROUP_ORDER.includes(page.group));
  for (const page of grouped.sort(byOrder)) entries.push({ kind: "page", page });

  return entries;
}

/** Every page in sidebar order, which is also the previous and next order. */
export function readingOrder(): DocPage[] {
  return sidebar().flatMap((entry) => (entry.kind === "page" ? [entry.page] : entry.pages));
}

export function pageForSlug(slug: string[]): DocPage | null {
  const wanted = slug.join("/");
  return allPages().find((page) => page.slug.join("/") === wanted) ?? null;
}

export function neighbours(page: DocPage): { previous: DocPage | null; next: DocPage | null } {
  const order = readingOrder();
  const at = order.findIndex((candidate) => candidate.href === page.href);
  return {
    previous: at > 0 ? order[at - 1] : null,
    next: at >= 0 && at < order.length - 1 ? order[at + 1] : null,
  };
}

export type NavItem = { title: string; href: string };

export type NavEntry =
  | { kind: "page"; item: NavItem }
  | { kind: "group"; id: string; title: string; items: NavItem[] };

/** The sidebar without the page bodies, because this crosses into the browser. */
export function navTree(): NavEntry[] {
  return sidebar().map((entry) =>
    entry.kind === "page"
      ? { kind: "page", item: { title: entry.page.navTitle, href: entry.page.href } }
      : {
          kind: "group",
          id: entry.id,
          title: entry.title,
          items: entry.pages.map((page) => ({ title: page.navTitle, href: page.href })),
        },
  );
}

export function groupTitleFor(page: DocPage): string | null {
  return page.group === null ? null : (GROUP_TITLES[page.group] ?? page.group);
}
