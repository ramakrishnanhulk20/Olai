import { notFound } from "next/navigation";
import { Hero } from "@/components/hero";
import { Story } from "@/components/story";

// The lab is where a section is looked at before it lands on the real page. It is a
// working surface, not a page anyone should meet, so a production build answers 404.
export default function LabPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main>
      <Hero />
      <Story />
    </main>
  );
}
