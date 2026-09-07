/**
 * The shape of the conversation before it has anything to say: the header bar,
 * the one column the thread runs down, and the composer waiting at the bottom.
 * It uses the same measurements as the real screen so nothing jumps when the
 * screen arrives.
 */
export default function DeskLoading() {
  return (
    <main className="min-h-[100svh] bg-ground">
      <div className="flex min-h-16 items-center gap-4 border-b border-ink/10 px-[clamp(1rem,3vw,2.25rem)] py-2.5">
        <span className="block size-2.5 rounded-[2px] bg-amber" />
        <span className="font-display text-[1.05rem] font-medium tracking-[-0.02em] text-ink">
          Olai
        </span>
        <div className="desk-skeleton h-5 w-24" />
        <div className="ml-auto flex items-center gap-2.5">
          <div className="desk-skeleton h-9 w-24" />
          <div className="desk-skeleton h-9 w-20" />
        </div>
      </div>

      <div className="conv-shell">
        <div className="conv-main">
          <div className="conv-column flex min-h-[calc(100svh-4rem)] flex-col gap-8 pt-7">
            <div className="conv-welcome p-6 sm:p-8">
              <div className="desk-skeleton h-3 w-24" />
              <div className="desk-skeleton mt-5 h-11 w-[min(22rem,80%)]" />
              <div className="mt-8 flex flex-col gap-7">
                <div className="desk-skeleton h-14 w-full" />
                <div className="desk-skeleton h-14 w-[86%]" />
                <div className="desk-skeleton h-14 w-[72%]" />
              </div>
            </div>

            <div className="mt-auto pt-6">
              <div className="conv-composer-box">
                <div className="desk-skeleton h-12 w-full" />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="desk-skeleton h-4 w-[min(20rem,55%)]" />
                  <div className="desk-skeleton h-11 w-28" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
