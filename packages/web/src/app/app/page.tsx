import type { Metadata } from "next";
import { Desk } from "@/components/desk/desk";

export const metadata: Metadata = {
  title: "Olai: the owner's desk",
  description: "Write the rulebook, ask Olai a question, approve the trade, read the ledger.",
};

export default function DeskPage() {
  return <Desk />;
}
