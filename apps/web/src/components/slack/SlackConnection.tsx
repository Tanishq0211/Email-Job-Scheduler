import { useState } from "react";
import { Link } from "react-router-dom";
import { Slack, Link2, Unlink } from "lucide-react";
import { useSlackStatus, useSlackDisconnect } from "../../hooks/useAuth";
import { Button } from "../ui/Button";

export function SlackConnection() {
  const { data, isLoading } = useSlackStatus();
  const disconnect = useSlackDisconnect();
  const [confirming, setConfirming] = useState(false);

  if (isLoading) {
    return <div className="h-10 w-48 animate-pulse rounded-lg bg-slate-100" />;
  }

  if (!data?.connected) {
    return (
      <a
        href="/auth/slack"
        className="inline-flex items-center gap-2 rounded-lg bg-[#4A154B] px-4 py-2 text-sm font-medium text-white hover:bg-[#3d0f3e]"
      >
        <Slack className="h-4 w-4" />
        Connect Slack
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <Link2 className="h-4 w-4" />
        Slack: {data.teamName}
      </span>
      {confirming ? (
        <>
          <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
            Confirm disconnect
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          <Unlink className="h-4 w-4" />
          Disconnect
        </Button>
      )}
    </div>
  );
}

export function SlackCard() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="mb-1 flex items-center gap-2">
        <Slack className="h-5 w-5 text-[#4A154B]" />
        <h2 className="text-sm font-semibold text-slate-900">Slack notifications</h2>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Get a Slack message when a sender reaches its hourly rate limit. Emails
        keep flowing either way — nothing is dropped.
      </p>
      <SlackConnection />
    </div>
  );
}

export function SlackLink() {
  return (
    <Link
      to="/settings/slack"
      className="text-sm font-medium text-brand-600 hover:text-brand-700"
    >
      Slack settings
    </Link>
  );
}
