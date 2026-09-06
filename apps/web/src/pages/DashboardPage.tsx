import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { AppShell, PageHeading, ComposeButton } from "../components/layout/AppShell";
import { EmailTable } from "../components/emails/EmailTable";
import { SlackConnection } from "../components/slack/SlackConnection";
import { EmptyState, ErrorState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { useScheduledEmails, useSentEmails, useSearchEmails } from "../hooks/useEmails";
import { apiErrorMessage } from "../lib/api";
import { useToast } from "../components/ui/Toast";

type Tab = "scheduled" | "sent";

const PAGE_SIZE = 10;

export function DashboardPage() {
  const [tab, setTab] = useState<Tab>("scheduled");
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [params] = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    if (params.get("slack") === "connected") {
      toast("success", "Slack workspace connected.");
    }
    if (params.get("slack") === "failed") {
      toast("error", "Slack connection failed. Please try again.");
    }
    if (params.get("login") === "success") {
      toast("success", "Welcome back!");
    }
  }, [params, toast]);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  const scheduled = useScheduledEmails({ page, pageSize: PAGE_SIZE, search });
  const sent = useSentEmails({ page, pageSize: PAGE_SIZE, search });
  const searched = useSearchEmails({ page, pageSize: PAGE_SIZE, search });

  const usingSearch = Boolean(search);
  const active = usingSearch ? searched : tab === "scheduled" ? scheduled : sent;

  return (
    <AppShell headerRight={<SlackConnection />}>
      <PageHeading
        title="Dashboard"
        subtitle="Track every scheduled and delivered email in one place."
        action={<ComposeButton />}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(["scheduled", "sent"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setPage(1);
              }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                tab === t && !usingSearch
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t === "scheduled" ? "Scheduled Emails" : "Sent Emails"}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search emails…"
            className="pl-9"
            aria-label="Search emails"
          />
        </div>
      </div>

      {usingSearch && (
        <p className="mb-3 text-sm text-slate-500">
          Elasticsearch results for “{search}”
          {typeof searched.data?.total === "number" && ` — ${searched.data.total} found`}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-card">
        {active.isError ? (
          <ErrorState
            message={apiErrorMessage(active.error)}
            onRetry={() => active.refetch()}
          />
        ) : !active.isLoading && active.data?.items.length === 0 ? (
          usingSearch ? (
            <EmptyState
              title="No results"
              description={`No emails match “${search}”. Try a different search term.`}
            />
          ) : tab === "scheduled" ? (
            <EmptyState
              title="No scheduled emails yet."
              description="Schedule your first email campaign to see it here."
              action={<ComposeButton />}
            />
          ) : (
            <EmptyState
              title="Nothing sent yet."
              description="Once your scheduled emails are processed, they will appear here."
            />
          )
        ) : (
          <EmailTable
            items={active.data?.items ?? []}
            isLoading={active.isLoading}
            page={page}
            pageSize={PAGE_SIZE}
            total={active.data?.total ?? 0}
            totalPages={active.data?.totalPages ?? 1}
            onPageChange={setPage}
            timeColumn={usingSearch || tab === "sent" ? "sentAt" : "scheduledAt"}
            timeLabel={usingSearch || tab === "sent" ? "Sent time" : "Scheduled time"}
          />
        )}
      </div>
    </AppShell>
  );
}
