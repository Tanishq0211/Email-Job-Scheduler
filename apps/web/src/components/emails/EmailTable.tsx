import type { ApiEmail } from "@reachinbox/shared";
import { formatDateTime } from "../../lib/format";
import { StatusBadge } from "./EmailStatusBadge";
import { SkeletonRows } from "../ui/Spinner";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  items: ApiEmail[];
  isLoading: boolean;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  timeColumn: "scheduledAt" | "sentAt";
  timeLabel: string;
}

export function EmailTable({
  items,
  isLoading,
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  timeColumn,
  timeLabel,
}: Props) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">{timeLabel}</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          {isLoading ? (
            <SkeletonRows rows={pageSize > 5 ? 5 : pageSize} />
          ) : (
            <tbody>
              {items.map((email) => (
                <tr
                  key={email.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                >
                  <td className="px-4 py-3.5 font-medium text-slate-900">
                    {email.recipient}
                  </td>
                  <td className="max-w-72 truncate px-4 py-3.5 text-slate-600">
                    {email.subject}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">
                    {formatDateTime(timeColumn === "sentAt" ? email.sentAt : email.scheduledAt)}
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={email.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>
            Showing {from}–{to} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || isLoading}
              className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 text-xs">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || isLoading}
              className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
