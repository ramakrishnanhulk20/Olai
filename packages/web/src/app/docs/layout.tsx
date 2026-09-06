import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsShell } from "@/components/docs/shell";
import { navTree } from "@/lib/docs/content";

export const metadata: Metadata = {
  title: { default: "Olai documentation", template: "%s · Olai docs" },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <DocsShell nav={navTree()}>{children}</DocsShell>;
}
