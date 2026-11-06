export function SectionCard({
  children,
  header,
  className,
}: {
  children: React.ReactNode;
  header?: { title: string; subtitle?: string; icon?: React.ReactNode };
  className?: string;
}) {
  return (
    <div className={`glass rounded-3xl overflow-hidden ${className ?? ""}`}>
      {header && (
        <div className="px-5 py-4 sm:px-6 border-b border-white/60">
          <div className="flex items-center gap-3">
            {header.icon && (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50/60 text-indigo-600"
              >
                {header.icon}
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-ink">
                {header.title}
              </h3>
              {header.subtitle && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {header.subtitle}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "indigo",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "indigo" | "amber" | "emerald" | "rose" | "purple";
}) {
  const dot = {
    indigo: "bg-indigo-400",
    amber: "bg-amber-400",
    emerald: "bg-emerald-400",
    rose: "bg-rose-400",
    purple: "bg-purple-400",
  }[tone];
  return (
    <div className="glass-soft stat-tile">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div
        className="empty-icon text-slate-400"
        style={{ width: 72, height: 72 }}
      >
        {icon}
      </div>
      <h3 className="font-semibold text-ink">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      {action}
    </div>
  );
}
