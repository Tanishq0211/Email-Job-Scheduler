import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell, PageHeading } from "../components/layout/AppShell";
import { CsvUploader, } from "../components/compose/CsvUploader";
import { Button } from "../components/ui/Button";
import { Input, Label, Textarea } from "../components/ui/Input";
import { useSenders } from "../hooks/useAuth";
import { useScheduleEmails } from "../hooks/useEmails";
import { useToast } from "../components/ui/Toast";
import { apiErrorMessage } from "../lib/api";
import { isValidEmailValue, type CsvParseResult } from "../lib/csv";

function defaultStartTime(): string {
  const d = new Date(Date.now() + 10 * 60 * 1000);
  d.setSeconds(0, 0);
  // datetime-local wants local time without timezone
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function ComposePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: senders, isLoading: sendersLoading } = useSenders();
  const schedule = useScheduleEmails();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [senderId, setSenderId] = useState("");
  const [recipients, setRecipients] = useState<CsvParseResult | null>(null);
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [delaySeconds, setDelaySeconds] = useState("2");
  const [hourlyLimit, setHourlyLimit] = useState("200");
  const [manual, setManual] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const manualValid = useMemo(() => {
    const list = manual
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((v) => v.trim().toLowerCase());
    const seen = new Set(recipients?.valid ?? []);
    const valid: string[] = [];
    for (const v of list) {
      if (isValidEmailValue(v) && !seen.has(v)) {
        seen.add(v);
        valid.push(v);
      }
    }
    return valid;
  }, [manual, recipients]);

  const allRecipients = [...(recipients?.valid ?? []), ...manualValid];
  const totalInvalid = (recipients?.invalid.length ?? 0) + countInvalid(manual);

  const canSubmit =
    !submitting &&
    subject.trim() &&
    body.trim() &&
    senderId &&
    allRecipients.length > 0 &&
    Number(delaySeconds) >= 0 &&
    Number(hourlyLimit) > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const localDate = new Date(startTime);
      const result = await schedule.mutateAsync({
        subject: subject.trim(),
        body: body.trim(),
        senderId,
        startTime: localDate,
        delayBetweenEmailsMs: Math.round(Number(delaySeconds) * 1000),
        hourlyLimit: Number(hourlyLimit),
        recipients: allRecipients,
      });
      qc.invalidateQueries({ queryKey: ["emails"] });
      toast(
        "success",
        `Scheduled ${result.scheduledCount} email${result.scheduledCount === 1 ? "" : "s"}${
          result.duplicatesRemoved
            ? ` (${result.duplicatesRemoved} duplicates removed)`
            : ""
        }.`,
      );
      navigate("/");
    } catch (err) {
      toast("error", apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <PageHeading
        title="Compose New Email"
        subtitle="Upload your leads, write the message, and control exactly how it goes out."
      />

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Message</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Hello from ReachInbox"
                  maxLength={500}
                  required
                />
              </div>
              <div>
                <Label htmlFor="body">Body</Label>
                <Textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your email…"
                  rows={8}
                  required
                />
              </div>
              <div>
                <Label htmlFor="sender">Sender</Label>
                <select
                  id="sender"
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  required
                >
                  <option value="" disabled>
                    {sendersLoading ? "Loading senders…" : "Choose a sender"}
                  </option>
                  {(senders ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName} &lt;{s.email}&gt;
                    </option>
                  ))}
                </select>
                {senders && senders.length === 0 && (
                  <p className="mt-1.5 text-xs text-amber-600">
                    No senders yet — run <code>npm run db:seed</code> or add one via the
                    API to get started.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Recipients</h2>
            <CsvUploader result={recipients} onChange={setRecipients} onError={(m) => toast("error", m)} />
            <div className="mt-4">
              <Label htmlFor="manual">Add addresses manually (optional)</Label>
              <Textarea
                id="manual"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="One or more email addresses, separated by spaces, commas, or new lines"
                rows={2}
              />
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Schedule</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="startTime">Start time</Label>
                <Input
                  id="startTime"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="delay">Delay between emails (seconds)</Label>
                <Input
                  id="delay"
                  type="number"
                  min={0}
                  step={0.5}
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="hourlyLimit">Hourly limit</Label>
                <Input
                  id="hourlyLimit"
                  type="number"
                  min={1}
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(e.target.value)}
                  required
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Emails beyond this limit are automatically rescheduled to the
                  next hour.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Summary</h2>
            <ul className="space-y-1.5 text-sm text-slate-600">
              <li>
                <span className="font-medium text-emerald-700">
                  {allRecipients.length} valid
                </span>{" "}
                recipients
              </li>
              {totalInvalid > 0 && <li className="text-red-600">{totalInvalid} invalid skipped</li>}
              {(recipients?.duplicatesRemoved ?? 0) > 0 && (
                <li>{recipients?.duplicatesRemoved} duplicates removed</li>
              )}
            </ul>
            <Button
              type="submit"
              className="mt-5 w-full"
              loading={submitting}
              disabled={!canSubmit}
            >
              Schedule Emails
            </Button>
            {submitting && (
              <p className="mt-2 text-center text-xs text-slate-400">
                Scheduling — this can take a moment for large lists.
              </p>
            )}
          </div>
        </div>
      </form>
    </AppShell>
  );
}

function countInvalid(manual: string): number {
  const list = manual.split(/[\s,;]+/).filter(Boolean);
  return list.filter((v) => !isValidEmailValue(v.trim().toLowerCase())).length;
}
