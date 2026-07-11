export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Jeeves — AI Governance Gateway (Meridian Health demo)
        </h1>
        <p className="max-w-xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Governance workflow demo for AI initiatives at a fictional healthcare
          payer. Under construction.
        </p>
      </main>
      <footer className="border-t border-zinc-200 px-8 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Fictional demo. Synthetic data only. Not affiliated with any real
        organization.
      </footer>
    </div>
  );
}
