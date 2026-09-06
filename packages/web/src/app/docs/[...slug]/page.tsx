import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DocArticle } from "@/components/docs/article";
import { pageForSlug, readingOrder } from "@/lib/docs/content";

// Every page is listed, so anything else is a 404 rather than a runtime read.
export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string[] }> {
  return readingOrder()
    .filter((page) => page.slug.length > 0)
    .map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const page = pageForSlug((await params).slug);
  if (!page) return {};
  return { title: page.title, description: page.description ?? undefined };
}

export default async function DocsPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const page = pageForSlug((await params).slug);
  if (!page) notFound();
  return <DocArticle page={page} />;
}
