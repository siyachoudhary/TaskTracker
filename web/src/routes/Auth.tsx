import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FluxLogo } from "../components/FluxLogo";

const envBase = import.meta.env.VITE_API_BASE?.replace(/\/$/, "");
const API_BASE =
  envBase ||
  (location.hostname === "localhost"
    ? "http://localhost:4000"
    : "https://api.fluxtasktracker.com");
    
export default function Auth() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [active, setActive] = useState<"kanban" | "calendar" | "notes">("kanban");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/me`, { credentials: "include" });
        if (res.ok) { navigate("/orgs"); return; }
      } catch {}
      setChecking(false);
    })();
  }, [navigate]);

  // auto-rotate preview every 4s (pause when user clicks)
  useEffect(() => {
    const id = setInterval(() => {
      setActive(p => (p === "kanban" ? "calendar" : p === "calendar" ? "notes" : "kanban"));
    }, 4000);
    return ()=> clearInterval(id);
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Brand gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-50 via-sky-50 to-white" />
      <FluxWaves />

      {/* NOTE: mobile gets top padding; desktop uses layout spacing */}
      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 pt-8 sm:pt-12 lg:pt-0">
        {/* Hero row */}
        <div className="grid min-h-[72svh] items-start md:items-center gap-8 sm:gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 xl:gap-18">
          {/* Left: copy */}
          <div className="text-left">
            <div className="inline-flex items-center gap-3 rounded-2xl border bg-white/70 px-4 py-2 shadow-sm backdrop-blur">
              <FluxLogo className="text-slate-900" />
              <span className="text-xs font-medium text-slate-600">Team execution, simplified</span>
            </div>

            <h1 className="mt-6 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
              Stay on track, together.
            </h1>
            <p className="mt-3 max-w-xl text-slate-600">
              Plan tasks, share context, and hit your deadlines. Sign in to jump back into your teams.
            </p>

            <h2 className="mt-6 mb-3 sm:mb-4 text-2xl font-extrabold tracking-tight text-slate-900">
              Different solutions, one place — Flux.
            </h2>

            {/* 3 chips: side-by-side on md+, hidden on phones */}
            <div className="hidden md:grid max-w-2xl grid-cols-3 gap-3 lg:gap-4">
              <StatPill>Organizations</StatPill>
              <StatPill>Teams</StatPill>
              <StatPill>Tasks</StatPill>
            </div>

            {/* Feature bullets */}
            <ul className="mt-6 grid gap-2 max-w-xl text-slate-700">
              <li className="inline-flex items-center gap-2"><Dot /> Unified Kanban + calendar</li>
              <li className="inline-flex items-center gap-2"><Dot /> Mentions, notes, assignments</li>
              <li className="inline-flex items-center gap-2"><Dot /> Clear org & team roles</li>
            </ul>
          </div>

          {/* Right: auth card + tiny product previews */}
          <div className="justify-self-start sm:justify-self-center lg:justify-self-end w-full max-w-sm">
            <div className="rounded-3xl border bg-white/85 p-6 shadow-xl backdrop-blur">
              <h2 className="text-center text-2xl font-bold text-slate-900">Welcome back</h2>
              <p className="mt-1 text-center text-slate-600">Sign in to continue</p>

              <div className="mt-6 space-y-3">
                <a
                  className="btn w-full justify-center bg-gradient-to-r from-indigo-600 to-cyan-500 text-white hover:opacity-95 border-0 shadow-md"
                  href={`${API_BASE}/auth/google/start`}
                  aria-label="Continue with Google"
                >
                  <GoogleIcon className="mr-2 h-5 w-5" />
                  Continue with Google
                </a>

                {checking && (
                  <div className="flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm text-slate-600 bg-white/60">
                    <Spinner /> Checking your session…
                  </div>
                )}
              </div>

              {/* Mini product strip */}
              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-center gap-2 text-xs">
                  <TabChip active={active==="kanban"} onClick={()=>setActive("kanban")}>Kanban</TabChip>
                  <TabChip active={active==="calendar"} onClick={()=>setActive("calendar")}>Calendar</TabChip>
                  <TabChip active={active==="notes"} onClick={()=>setActive("notes")}>Notes</TabChip>
                </div>
                <PreviewCard active={active} />
              </div>
            </div>

            <div className="mt-4 text-center text-xs text-slate-500">
              Trouble signing in? Allow third-party cookies for{" "}
              <code className="rounded bg-slate-100 px-1">localhost</code>.
            </div>
          </div>
        </div>

        {/* Below-the-fold: feature cards fill tall screens */}
        <section className="mb-10 mt-6 grid gap-4 md:grid-cols-3">
          <FeatureCard
            title="Plan visually"
            blurb="Drag cards across statuses and see deadlines inline."
            icon={<BoardIcon className="h-5 w-5" />}
          />
          <FeatureCard
            title="Never miss a date"
            blurb="Month, week, or day—deadlines glow when near or overdue."
            icon={<CalendarIcon className="h-5 w-5" />}
          />
          <FeatureCard
            title="Work in context"
            blurb="Notes with mentions keep decisions attached to tasks."
            icon={<NoteIcon className="h-5 w-5" />}
          />
        </section>
      </div>
    </div>
  );
}

/* ------------------------ building blocks ------------------------ */

function StatPill({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white/70 py-4 text-center font-semibold text-slate-900 shadow-sm">
      {children}
    </div>
  );
}

// function Metric({ n, label }: { n: string; label: string }) {
//   return (
//     <div className="rounded-xl bg-white/70 py-3 shadow-sm">
//       <div className="text-xl font-extrabold text-slate-900">{n}</div>
//       <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
//     </div>
//   );
// }

function TabChip({ active, onClick, children }:{
  active:boolean; onClick:()=>void; children:React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition
        ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white/70 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}

function PreviewCard({ active }:{ active: "kanban"|"calendar"|"notes" }) {
  const content = useMemo(() => ({
    kanban: {
      title: "Kanban",
      lines: ["Design mockups", "API integration", "QA checklist"],
    },
    calendar: {
      title: "Calendar",
      lines: ["Sprint planning 10:00", "Release 16:00", "Retro 17:30"],
    },
    notes: {
      title: "Notes",
      lines: ["@alex ship the draft", "scope: v1 only", "link: /spec"],
    },
  } as const), []);

  const data = content[active];
  return (
    <div
      className="rounded-2xl border bg-white p-3 shadow-sm transition hover:shadow-md"
      style={{ transform: "translateZ(0)" }}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-700">{data.title}</div>
        <div className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-indigo-400" />
          <span className="h-2 w-2 rounded-full bg-cyan-400" />
        </div>
      </div>
      <ul className="space-y-1.5">
        {data.lines.map((l, i) => (
          <li
            key={i}
            className="truncate rounded-lg border bg-white/80 px-2 py-1 text-xs text-slate-700"
          >
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureCard({ title, blurb, icon }:{
  title:string; blurb:string; icon:React.ReactNode
}) {
  return (
    <div className="rounded-2xl border bg-white/80 p-4 shadow-sm backdrop-blur transition hover:shadow-md">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500/15 to-cyan-500/15">
          {icon}
        </div>
        <div className="font-semibold">{title}</div>
      </div>
      <p className="mt-2 text-sm text-slate-600">{blurb}</p>
    </div>
  );
}

/* ------------------------ tiny UI helpers ------------------------ */

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" className="opacity-25" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4A4 4 0 008 12H4z" />
    </svg>
  );
}
function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 533.5 544.3" {...props} aria-hidden="true">
      <path fill="#4285f4" d="M533.5 278.4c0-18.5-1.7-36.3-4.9-53.6H272v101.5h147.2c-6.4 34.7-25.7 64.1-54.8 83.7v69.4h88.7c52 47.9 80.4 118.7 80.4 197.4 0 12.6-.9 25-2.6 37.1h2.6c161.4 0 292.1-130.7 292.1-292.1z" transform="translate(-272 -122.1)"/>
      <path fill="#34a853" d="M272 666.4c78.7 0 144.9-25.9 193.2-70.1l-88.7-69.4c-24.7 16.6-56.3 26.5-104.5 26.5-79.9 0-147.7-53.9-171.8-126.4H8.7v73.9C57 611.1 157.5 666.4 272 666.4z" transform="translate(-272 -122.1)"/>
      <path fill="#fbbc04" d="M100.2 426.9c-11.6-34.7-11.6-72.3 0-106.9v-73.9H8.7c-37.4 74.7-37.4 160 0 234.7l91.5-53.9z" transform="translate(-272 -122.1)"/>
      <path fill="#ea4335" d="M272 222c45.1 0 85.5 15.6 117.3 46.2l88-88C417.1 135 350.9 109.1 272 109.1 157.5 109.1 57 164.4 8.7 256.1l91.5 73.9C124.3 275.9 192.1 222 272 222z" transform="translate(-272 -122.1)"/>
    </svg>
  );
}
function Dot() { return <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500" />; }

/* Icons */
function BoardIcon(props: React.SVGProps<SVGSVGElement>) {
  return (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm4 2h4v12H8V7zm6 0h4v6h-4V7z"/></svg>);
}
function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v3H3V6a2 2 0 0 1 2-2h2V2zm14 8v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8h18z"/></svg>);
}
function NoteIcon(props: React.SVGProps<SVGSVGElement>) {
  return (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1v5h5"/></svg>);
}

/* Decorative background */
function FluxWaves() {
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[520px] w-full opacity-60"
      viewBox="0 0 1440 560"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="flux-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
        <linearGradient id="flux-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.6" />
          <stop offset="1" stopColor="white" stopOpacity="1" />
        </linearGradient>
        <mask id="flux-mask">
          <rect width="100%" height="100%" fill="url(#flux-fade)" />
        </mask>
      </defs>
      <g mask="url(#flux-mask)" fill="none" stroke="url(#flux-grad)" strokeWidth="2">
        <path d="M-20 120 C200 40, 380 200, 620 120 S1100 40, 1460 160" opacity="0.9" />
        <path d="M-20 220 C220 140, 420 260, 640 180 S1120 100, 1460 240" opacity="0.7" />
        <path d="M-20 320 C240 240, 460 320, 680 260 S1140 180, 1460 320" opacity="0.5" />
      </g>
    </svg>
  );
}