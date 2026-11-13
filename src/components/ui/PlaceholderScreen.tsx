type PlaceholderScreenProps = {
  title: string;
  description: string;
};

export function PlaceholderScreen({ title, description }: PlaceholderScreenProps) {
  return (
    <section className="mx-auto max-w-3xl">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">
        Próximamente
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5 sm:p-8">
        <div className="h-1.5 w-16 rounded-full bg-teal-600" />
        <p className="mt-5 max-w-lg text-base leading-7 text-slate-600 dark:text-slate-300">
          {description}
        </p>
        <p className="mt-7 text-sm text-slate-500 dark:text-slate-400">
          Esta pantalla es una reserva visual de F0: todavía no contiene datos ni lógica de negocio.
        </p>
      </div>
    </section>
  );
}
