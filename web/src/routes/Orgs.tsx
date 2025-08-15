import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Link, useNavigate } from "react-router-dom";
import { FluxLogo, FluxMarkWithWaves, FluxWaves } from "../components/FluxLogo";

/* ------------------------------ Top nav -------------------------------- */

function TopNav() {
  const nav = useNavigate();
  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch {}
    nav("/", { replace: true });
  }
  return (
    <div className="sticky top-0 z-20 border-b bg-white/70 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <Link
            to="/orgs"
            aria-label="Go to home"
            className="inline-flex items-center gap-3 group rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 cursor-pointer"
          >
            <FluxLogo size={20} />
            <span className="hidden sm:inline text-xs font-medium text-slate-500 group-hover:text-slate-700">
              Team execution, simplified
            </span>
          </Link>
        <button className="btn-outline" onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
}

/* -------------------------------- Page --------------------------------- */

export default function Orgs() {
  const qc = useQueryClient();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get("/me")).data,
  });

  const { data: orgs, isLoading: orgLoading } = useQuery({
    queryKey: ["orgs"],
    queryFn: async () => (await api.get("/orgs")).data,
  });

  // Always render over an array
  const orgList = useMemo<any[]>(() => (Array.isArray(orgs) ? orgs : []), [orgs]);

  const createOrgInput = useRef<HTMLInputElement>(null);
  const createOrg = useMutation({
    mutationFn: async (name: string) => (await api.post("/orgs", { name })).data,
    onSuccess: async (created) => {
      qc.setQueryData(["orgs"], (prev: any[] = []) => [created, ...prev]);
      if (createOrgInput.current) createOrgInput.current.value = "";
      await qc.invalidateQueries({ queryKey: ["orgs"], refetchType: "active" });
      await qc.invalidateQueries({ queryKey: ["me"], refetchType: "active" });
    },
  });

  // Leave organization (self-serve) with fallbacks compatible with your server
  const leaveOrg = useMutation({
    mutationFn: async (orgId: string) => {
      try {
        return (await api.delete(`/orgs/${orgId}/leave`)).data; // matches server.ts
      } catch (e: any) {
        const s = e?.response?.status;
        if (s !== 404) throw e;

        // Fallbacks for older servers
        try {
          return (await api.post(`/orgs/${orgId}/leave`)).data;
        } catch (e2: any) {
          const s2 = e2?.response?.status;
          if (s2 !== 404) throw e2;
          try {
            return (await api.delete(`/orgs/${orgId}/members/me`)).data;
          } catch (e3: any) {
            const userId = me?.id;
            if (!userId) throw new Error("user not loaded");
            return (await api.delete(`/orgs/${orgId}/members/${userId}`)).data;
          }
        }
      }
    },
    onMutate: async (orgId: string) => {
      await qc.cancelQueries({ queryKey: ["orgs"] });
      const prev = qc.getQueryData<any[]>(["orgs"]) || [];
      qc.setQueryData(["orgs"], (old: any[] = []) => old.filter((o) => o.id !== orgId));
      return { prev };
    },
    onError: (err: any, _orgId, ctx) => {
      if (ctx?.prev) qc.setQueryData(["orgs"], ctx.prev);
      const s = err?.response?.status;
      if (s === 403) {
        alert("You do not have permission to remove members via this route. Ask an admin or enable the self-leave endpoint.");
      } else if (s === 409 || s === 400) {
        alert("Leaving is blocked (e.g., you may be the only admin).");
      } else {
        alert("Could not leave this organization.");
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orgs"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const greeting = useMemo(() => me?.name || me?.handle || "there", [me]);
  const handleTag = useMemo(() => me?.handle || "user", [me]);

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <TopNav />

      {/* --- Decorative background layer --- */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-sky-50 to-white" />
        {/* Brand waves */}
        <FluxWaves className="absolute inset-x-0 -top-16" />
      </div>

      {/* Content */}
      <div className="relative z-10 container space-y-8 py-8">
        {/* Hero */}
        <header className="rounded-3xl border bg-white/80 p-5 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar seed={me?.id || "me"} label={greeting} />
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-xs text-slate-600">
                <FluxMarkWithWaves size={18} />
                <span>Flux workspace</span>
              </div>
              <h2 className="text-2xl font-bold leading-tight">Hey, {greeting}</h2>
              <p className="text-slate-600">
                @{handleTag} ·{" "}
                {orgLoading ? "—" : `${orgList.length} organization${orgList.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
        </header>

        {/* Quick actions */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* Create org */}
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <Sparkle className="h-5 w-5" />
              <h3 className="font-semibold">Create a new organization</h3>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                ref={createOrgInput}
                className="input"
                placeholder="Org name (e.g., Design Guild)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = createOrgInput.current?.value?.trim();
                    if (n) createOrg.mutate(n);
                  }
                }}
              />
              <button
                className="btn border-0 bg-gradient-to-r from-indigo-600 to-cyan-500 text-white"
                onClick={() => {
                  const n = createOrgInput.current?.value?.trim();
                  if (n) createOrg.mutate(n);
                }}
                disabled={createOrg.isPending}
                title="Create organization"
              >
                {createOrg.isPending ? "Creating…" : "Create"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">You’ll become the admin and can invite teammates.</p>
          </div>

          {/* Join org */}
          <JoinOrg />
        </section>

        {/* Orgs grid */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Your organizations</h3>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(meLoading || orgLoading) &&
              [0, 1, 2].map((i) => (
                <div key={i} className="h-40 rounded-3xl border bg-white shadow-sm animate-pulse" />
              ))}

            {!orgLoading && orgList.length === 0 && (
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <div className="font-medium text-slate-800">You’re not in any orgs yet.</div>
                <div className="text-sm text-slate-600">Create one above, or paste a join code to get started.</div>
              </div>
            )}

            {orgList.map((o: any) => {
              const membership = me?.memberships?.find((m: any) => m.orgId === o.id);
              const isAdmin = membership?.role === "ADMIN";
              const deco = bannerFor(o.id);
              return (
                <div
                  key={o.id}
                  className="group overflow-hidden rounded-3xl border bg-white shadow-sm transition hover:shadow-md"
                >
                  {/* Banner */}
                  <div className={`flex h-16 items-center justify-between px-5 ${deco.banner}`}>
                    <div className="inline-flex items-center gap-2">
                      <FluxMarkWithWaves size={16} />
                      <div className="truncate font-semibold text-slate-900/90">{o.name}</div>
                    </div>
                    <RoleBadge admin={!!isAdmin} />
                  </div>

                  {/* Body */}
                  <div className="p-4">
                    <div className="flex flex-wrap gap-2">
                      {isAdmin && (
                        <Link className="btn-outline" to={`/org/${o.id}/admin`}>
                          Manage {o.name}
                        </Link>
                      )}

                      {!isAdmin && (
                        <button
                          className="btn-outline border-rose-200 text-rose-700 hover:bg-rose-50"
                          onClick={() => {
                            if (confirm(`Leave “${o.name}”? You will lose access to its teams and tasks.`)) {
                              leaveOrg.mutate(o.id);
                            }
                          }}
                          disabled={leaveOrg.isPending}
                          title="Leave this organization"
                        >
                          {leaveOrg.isPending ? "Leaving…" : "Leave org"}
                        </button>
                      )}
                    </div>

                    <p className="mt-2 text-xs text-slate-600">
                      {isAdmin ? "You are an admin; manage this organization's details." : "Member access."}
                    </p>

                    <OrgTeams orgId={o.id} isAdmin={!!isAdmin} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------------------------- Pieces ----------------------------------- */

function RoleBadge({ admin }: { admin: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs ${
        admin ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"
      }`}
    >
      {admin ? "Admin" : "Member"}
    </span>
  );
}

function OrgTeams({ orgId }: { orgId: string; isAdmin: boolean }) {
  const { data: teams, isLoading } = useOrgTeams(orgId);
  const teamList = useMemo<any[]>(() => (Array.isArray(teams) ? teams : []), [teams]);

  return (
    <div className="mt-4 space-y-2">
      <div className="text-sm text-slate-600">My Teams</div>
      {isLoading && <div className="text-sm text-slate-500">Loading teams…</div>}
      {!isLoading && teamList.length === 0 && <div className="text-sm text-slate-500">No teams yet.</div>}

      <ul className="flex flex-wrap gap-2">
        {teamList.map((t: any) => (
          <li key={t.id}>
            <Link className="btn-outline" to={`/team/${t.id}`}>
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useOrgTeams(orgId?: string) {
  return useQuery({
    queryKey: ["teams", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      try {
        const res = await api.get(`/orgs/${orgId}/teams`);
        return Array.isArray(res.data) ? res.data : [];
      } catch {
        return []; // avoid breaking the UI if the request fails
      }
    },
    enabled: !!orgId,
    initialData: [], // ensures an array on first render
  });
}

function JoinOrg() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const join = useMutation({
    mutationFn: async (code: string) => (await api.post("/orgs/join", { code })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orgs"] });
      if (inputRef.current) inputRef.current.value = "";
    },
  });

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const c = el.value.trim();
        if (c) join.mutate(c);
      }
    };
    el.addEventListener("keydown", onKey as any);
    return () => el.removeEventListener("keydown", onKey as any);
  }, []);

  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <LinkIcon className="h-5 w-5" />
        <h3 className="font-semibold">Join an organization</h3>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input ref={inputRef} className="input" placeholder="Paste org join code" />
        <button
          className="btn border-0 bg-gradient-to-r from-indigo-600 to-cyan-500 text-white"
          onClick={() => {
            const c = inputRef.current?.value?.trim();
            if (c) join.mutate(c);
          }}
          disabled={join.isPending}
        >
          {join.isPending ? "Joining…" : "Join"}
        </button>
      </div>
      {join.isError && <div className="mt-2 text-sm text-rose-600">Invalid or expired code.</div>}
      {join.isSuccess && <div className="mt-2 text-sm text-emerald-700">Joined! Your orgs list is updated.</div>}
    </div>
  );
}

/* --------------------------- Tiny helpers ------------------------------ */

function Avatar({ seed, label }: { seed: string; label: string }) {
  const color = hue(seed);
  const initial = (label || "U").trim().charAt(0).toUpperCase();
  return (
    <div
      className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl font-semibold text-white"
      style={{
        background: `linear-gradient(135deg, hsl(${color}, 70%, 55%), hsl(${(color + 40) % 360}, 70%, 55%))`,
      }}
      aria-hidden
    >
      {initial}
    </div>
  );
}

function bannerFor(id: string) {
  const h = hue(id);
  return {
    banner: `bg-gradient-to-r from-[hsl(${h},80%,96%)] to-[hsl(${(h + 24) % 360},80%,96%)]`,
    badgeBg: "bg-white/70",
  };
}
function hue(s: string) {
  return Math.abs(hash(s)) % 360;
}
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

function Sparkle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2l1.8 4.7L18 8.6l-4.2 1.9L12 15l-1.8-4.5L6 8.6l4.2-1.9L12 2zM5 16l1 2.5L8.5 19l-2.5 1.1L5 22.5 4 20.1 1.5 19 4 17.9 5 16zm14 0l1 2.5L22.5 19 20 20.1 19 22.5 18 20.1 15.5 19 18 18.5 19 16z" />
    </svg>
  );
}
function LinkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M10.6 13.4a1 1 0 001.4 1.4l4.6-4.6a3 3 0 00-4.2-4.2l-1.9 1.9a1 1 0 101.4 1.4l1.9-1.9a1 1 0 011.4 1.4L10.6 13.4zm2.8-2.8a1 1 0 00-1.4-1.4L7.4 13.8a3 3 0 104.2 4.2l1.9-1.9a1 1 0 10-1.4-1.4l-1.9 1.9a1 1 0 11-1.4-1.4l5.0-5.0z" />
    </svg>
  );
}