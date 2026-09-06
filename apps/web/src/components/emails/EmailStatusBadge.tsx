import type { EmailStatus } from "@reachinbox/shared";

const styles: Record<string, string> = {
  scheduled: "bg-amber-50 text-amber-700 ring-amber-200",
  processing: "bg-blue-50 text-blue-700 ring-blue-200",
  sent: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
};

const dots: Record<string, string> = {
  scheduled: "bg-amber-500",
  processing: "bg-blue-500 animate-pulse",
  sent: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-slate-400",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${
        styles[status] ?? styles.cancelled
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dots[status] ?? dots.cancelled}`} />
      {status}
    </span>
  );
}

export type { EmailStatus };
