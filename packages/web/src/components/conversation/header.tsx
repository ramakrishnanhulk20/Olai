"use client";

import Link from "next/link";
import type { Health } from "@/lib/api";
import { StatusChip } from "@/components/desk/status-chip";
import { StopButton } from "./stop-button";

/**
 * The top of the desk: who you are looking at, what it is doing, the way into
 * everything else, and the one button that stops it.
 *
 * The service address and the build number are not here. They belong to the
 * person debugging the service, not to the owner reading an answer, so they sit
 * in the drawer's footer.
 */
export function Header({
  health,
  offline,
  replay = false,
  killed,
  switchBusy,
  switchDisabled,
  switchNote = null,
  switchProblem,
  drawerOpen,
  onDrawer,
  onKill,
  onResume,
}: {
  health: Health | null;
  offline: boolean;
  replay?: boolean;
  killed: boolean;
  switchBusy: boolean;
  switchDisabled: boolean;
  switchNote?: string | null;
  switchProblem: string | null;
  drawerOpen: boolean;
  onDrawer: () => void;
  onKill: () => void;
  onResume: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-ground/85 backdrop-blur-md">
      <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-[clamp(1rem,3vw,2.25rem)] py-2.5">
        <Link
          href="/"
          className="conv-tap group flex items-center gap-3 font-display text-[1.05rem] font-medium tracking-[-0.02em] text-ink transition-opacity duration-300 hover:opacity-70"
        >
          <span className="block size-2.5 rounded-[2px] bg-amber transition-transform duration-300 group-hover:rotate-45" />
          Olai
        </Link>

        <StatusChip health={health} offline={offline} replay={replay} />

        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={onDrawer}
            aria-expanded={drawerOpen}
            className="conv-drawer-button"
          >
            <span className="block size-1.5 rounded-[1px] bg-amber" aria-hidden />
            Details
          </button>

          <StopButton
            killed={killed}
            busy={switchBusy}
            disabled={switchDisabled}
            note={switchNote}
            problem={switchProblem}
            onKill={onKill}
            onResume={onResume}
          />
        </div>
      </div>
    </header>
  );
}
