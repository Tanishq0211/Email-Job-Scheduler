import type { ReactNode } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { Header } from "./Header";
import { LoadingBlock } from "../ui/Spinner";

export function AppShell({
  headerRight,
  children,
}: {
  headerRight?: ReactNode;
  children?: ReactNode;
}) {
  const { user, isLoading } = useRequireAuth();

  if (isLoading || !user) {
    return (
      <div className="min-h-screen">
        <LoadingBlock label="Loading your workspace…" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header user={user} right={headerRight} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {children ?? <Outlet context={user} />}
      </main>
    </div>
  );
}

export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ComposeButton() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate("/compose")}
      className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
    >
      <Plus className="h-4 w-4" />
      Compose New Email
    </button>
  );
}
