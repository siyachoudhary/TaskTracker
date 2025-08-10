import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const base = "http://localhost:4000";

export default function Auth() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch(`${base}/me`, { credentials: "include" });
        if (res.ok) {
          navigate("/orgs");
          return;
        }
      } catch (err) {
        console.error("Auth check failed", err);
      } finally {
        setChecking(false);
      }
    }
    checkAuth();
  }, [navigate]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Soft gradient backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-50 via-indigo-50 to-pink-50" />

      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full bg-sky-200/40 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-[420px] w-[420px] rounded-full bg-pink-200/40 blur-3xl animate-pulse" />

      <div className="relative z-10 container mx-auto px-6 py-10">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          {/* Hero side */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-3 rounded-2xl border bg-white/70 px-4 py-2 shadow-sm backdrop-blur">
              <Logo />
              <span className="font-semibold">TaskTracker</span>
            </div>

            <h1 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Stay on track, together.
            </h1>
            <p className="mt-3 text-slate-600">
              Plan tasks, share context, and hit your deadlines. Sign in to
              jump back into your teams.
            </p>

            <ul className="mt-6 grid gap-2 text-slate-700">
              <li className="inline-flex items-center gap-2">
                <Dot /> Kanban + calendar in one place
              </li>
              <li className="inline-flex items-center gap-2">
                <Dot /> Mentions, notes, and assignments
              </li>
              <li className="inline-flex items-center gap-2">
                <Dot /> Fine-grained org & team roles
              </li>
            </ul>
          </div>

          {/* Auth card */}
          <div className="mx-auto w-full max-w-md">
            <div className="rounded-3xl border bg-white/80 p-6 shadow-xl backdrop-blur">
              <h2 className="text-center text-2xl font-bold">Welcome back</h2>
              <p className="mt-1 text-center text-slate-600">
                Sign in to continue
              </p>

              <div className="mt-6 space-y-3">
                <a
                  className="btn w-full justify-center"
                  href={`${base}/auth/google/start`}
                  aria-label="Continue with Google"
                >
                  <GoogleIcon className="mr-2 h-5 w-5" />
                  Continue with Google
                </a>

                {/* Session check */}
                {checking && (
                  <div className="flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm text-slate-600">
                    <Spinner /> Checking your session…
                  </div>
                )}
              </div>

              {/* <div className="mt-6 border-t pt-4 text-center text-xs text-slate-500">
                By continuing you agree to our{" "}
                <a className="underline hover:text-slate-700" href="#tos">
                  Terms
                </a>{" "}
                and{" "}
                <a className="underline hover:text-slate-700" href="#privacy">
                  Privacy Policy
                </a>
                .
              </div> */}
            </div>

            {/* Subtle footer tip */}
            <div className="mt-4 text-center text-xs text-slate-500">
              Trouble signing in? Make sure third-party cookies are allowed for{" "}
              <code className="rounded bg-slate-100 px-1">localhost</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------ tiny UI helpers ------------------------ */

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        className="opacity-25"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4A4 4 0 008 12H4z"
      />
    </svg>
  );
}

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 533.5 544.3" {...props}>
      <path fill="#4285f4" d="M533.5 278.4c0-18.5-1.7-36.3-4.9-53.6H272v101.5h147.2c-6.4 34.7-25.7 64.1-54.8 83.7v69.4h88.7c52 47.9 80.4 118.7 80.4 197.4 0 12.6-.9 25-2.6 37.1h2.6c161.4 0 292.1-130.7 292.1-292.1z" transform="translate(-272 -122.1)"/>
      <path fill="#34a853" d="M272 666.4c78.7 0 144.9-25.9 193.2-70.1l-88.7-69.4c-24.7 16.6-56.3 26.5-104.5 26.5-79.9 0-147.7-53.9-171.8-126.4H8.7v73.9C57 611.1 157.5 666.4 272 666.4z" transform="translate(-272 -122.1)"/>
      <path fill="#fbbc04" d="M100.2 426.9c-11.6-34.7-11.6-72.3 0-106.9v-73.9H8.7c-37.4 74.7-37.4 160 0 234.7l91.5-53.9z" transform="translate(-272 -122.1)"/>
      <path fill="#ea4335" d="M272 222c45.1 0 85.5 15.6 117.3 46.2l88-88C417.1 135 350.9 109.1 272 109.1 157.5 109.1 57 164.4 8.7 256.1l91.5 73.9C124.3 275.9 192.1 222 272 222z" transform="translate(-272 -122.1)"/>
    </svg>
  );
}

function Logo() {
  return (
    <svg className="h-6 w-6 text-slate-900" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 4a2 2 0 00-2 2v12.5A1.5 1.5 0 004.5 20H18a2 2 0 002-2V7.5A1.5 1.5 0 0018.5 6H12l-2-2H5z" />
      <path d="M7 10h10v2H7zM7 14h6v2H7z" className="opacity-70" />
    </svg>
  );
}

function Dot() {
  return <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />;
}