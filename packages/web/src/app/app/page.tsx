import type { Metadata } from "next";
import { Conversation } from "@/components/conversation/conversation";

export const metadata: Metadata = {
  title: "Olai: the owner's desk",
  description:
    "Ask Olai a question, watch it work, approve the trade, and read every cent it spent.",
};

export default function DeskPage() {
  return <Conversation />;
}
