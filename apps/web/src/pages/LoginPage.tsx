import { Mail } from "lucide-react";
import { useSearchParams } from "react-router-dom";

export function LoginPage() {
  const [params] = useSearchParams();
  const oauthError = params.get("error");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-card">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Mail className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-lg font-semibold text-slate-900">ReachInbox</h1>
          <p className="text-sm text-slate-500">Email Scheduler</p>
          <p className="mt-3 text-sm text-slate-500">
            Sign in to schedule, throttle, and track your email campaigns.
          </p>
        </div>

        {oauthError && (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
            Sign-in failed. Please try again.
          </div>
        )}

        <a
          href="/auth/google"
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
        >
          <GoogleIcon />
          Continue with Google
        </a>

        <p className="mt-6 text-center text-xs text-slate-400">
          You'll be redirected to Google to sign in securely.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4.5 w-4.5 h-5 w-5" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-8.6z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.1 0-5.8-2.1-6.7-5l-3.9 3C3.3 21.3 7.3 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.4c-.3-.7-.4-1.5-.4-2.4s.2-1.7.4-2.4l-3.9-3C.5 8.2 0 10 0 12s.5 3.8 1.4 5.4l3.9-3z"
      />
      <path
        fill="#EA4335"
        d="M12 4.6c2.2 0 3.7.9 4.5 1.7l3.3-3.2C17.9 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.4 6.6l3.9 3c.9-2.9 3.6-5 6.7-5z"
      />
    </svg>
  );
}
