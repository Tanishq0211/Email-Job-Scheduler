import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Mail } from "lucide-react";
import { useLogout } from "../../hooks/useAuth";

export function Header({
  user,
  right,
}: {
  user: { name: string; email: string; avatarUrl: string | null };
  right?: ReactNode;
}) {
  const logout = useLogout();
  const navigate = useNavigate();

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2.5"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Mail className="h-4 w-4" />
          </span>
          <span className="text-left">
            <span className="block text-sm font-semibold leading-tight text-slate-900">
              ReachInbox
            </span>
            <span className="block text-xs leading-tight text-slate-500">
              Email Scheduler
            </span>
          </span>
        </button>

        <div className="flex items-center gap-3">
          {right}
          <div className="hidden items-center gap-2.5 sm:flex">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="h-9 w-9 rounded-full ring-1 ring-slate-200"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                {initials}
              </span>
            )}
            <span className="text-left">
              <span className="block text-sm font-medium leading-tight text-slate-900">
                {user.name}
              </span>
              <span className="block max-w-44 truncate text-xs leading-tight text-slate-500">
                {user.email}
              </span>
            </span>
          </div>
          <button
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
