import { BuiltOn } from "./built-on";
import { Cent } from "./cent";
import { KillSwitch } from "./kill-switch";
import { LedgerScroll } from "./ledger-scroll";
import { RulebookSheet } from "./rulebook";
import { StoryFooter } from "./footer";

export function Story() {
  return (
    <>
      <Cent />
      <RulebookSheet />
      <LedgerScroll />
      <KillSwitch />
      <BuiltOn />
      <StoryFooter />
    </>
  );
}
