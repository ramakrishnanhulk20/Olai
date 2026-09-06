export default function DeskLoading() {
  return (
    <main className="min-h-[100svh] bg-ground pb-24">
      <div className="flex h-16 items-center gap-3 border-b border-ink/10 px-[clamp(1rem,3vw,2.75rem)]">
        <span className="block size-2.5 rounded-[2px] bg-amber" />
        <span className="font-display text-[1.05rem] font-medium tracking-[-0.02em] text-ink">
          Olai
        </span>
      </div>

      <div className="grid gap-6 px-[clamp(1rem,3vw,2.75rem)] pt-8 lg:grid-cols-12 lg:gap-7 lg:pt-12">
        <div className="flex flex-col gap-6 lg:col-span-3 lg:pt-14">
          <div className="desk-panel h-[26rem] p-6">
            <div className="desk-skeleton h-5 w-24" />
          </div>
          <div className="desk-panel h-[14rem] p-6">
            <div className="desk-skeleton h-5 w-20" />
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-5">
          <div className="desk-panel h-[15rem] p-6">
            <div className="desk-skeleton h-5 w-28" />
          </div>
          <div className="desk-panel h-[20rem] p-6">
            <div className="desk-skeleton h-5 w-24" />
          </div>
        </div>

        <div className="lg:col-span-4 lg:pt-14">
          <div className="desk-panel h-[30rem] p-6">
            <div className="desk-skeleton h-5 w-20" />
          </div>
        </div>
      </div>
    </main>
  );
}
