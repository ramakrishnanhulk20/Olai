import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DocArticle } from "@/components/docs/article";
import { pageForSlug } from "@/lib/docs/content";

export function generateMetadata(): Metadata {
  const page = pageForSlug([]);
  if (!page) return {};
  return { title: page.title, description: page.description ?? undefined };
}

export default function DocsIndexPage() {
  const page = pageForSlug([]);
  if (!page) notFound();
  return <DocArticle page={page} />;
}
