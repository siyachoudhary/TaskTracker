import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Link, useNavigate } from 'react-router-dom'

/* ------------------------------ Top nav -------------------------------- */

function TopNav(){
  const nav = useNavigate()
  async function logout() {
    try { await api.post('/auth/logout') } catch {}
    nav('/', { replace: true })
  }
  return (
    <div className="sticky top-0 z-20 border-b bg-white/70 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <div className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <Logo className="h-5 w-5" />
          TaskTracker
        </div>
        <button className="btn-outline" onClick={logout}>Logout</button>
      </div>
    </div>
  )
}

/* -------------------------------- Page --------------------------------- */

export default function Orgs(){
  const qc = useQueryClient();
  const { data: me, isLoading: meLoading }    = useQuery({ queryKey:['me'],   queryFn: async()=> (await api.get('/me')).data })
  const { data: orgs, isLoading: orgLoading } = useQuery({ queryKey:['orgs'], queryFn: async()=> (await api.get('/orgs')).data })

  const createOrgInput = useRef<HTMLInputElement>(null)
  const createOrg = useMutation({
    mutationFn: async (name: string) => (await api.post('/orgs', { name })).data,
    onSuccess: async (created) => {
      qc.setQueryData(['orgs'], (prev: any[] = []) => [created, ...prev])
      if (createOrgInput.current) createOrgInput.current.value = ''
      await qc.invalidateQueries({ queryKey: ['orgs'], refetchType: 'active' })
      await qc.invalidateQueries({ queryKey: ['me'],   refetchType: 'active' })
    },
  })

  const greeting  = useMemo(()=> me?.name || me?.handle || 'there', [me])
  const handleTag = useMemo(()=> me?.handle || 'user', [me])

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <TopNav/>

      {/* --- Dedicated background layer (always behind content) --- */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-indigo-50 to-sky-50" />
        <div className="absolute -top-28 -left-28 h-[520px] w-[520px] rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute -bottom-28 -right-28 h-[520px] w-[520px] rounded-full bg-indigo-200/40 blur-3xl" />
      </div>

      {/* All page content sits above the bg */}
      <div className="relative z-10 container py-8 space-y-8">
        {/* Hero */}
        <header className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar seed={me?.id || 'me'} label={greeting}/>
            <div className="min-w-0">
              <h2 className="text-2xl font-bold leading-tight">Hey, {greeting}</h2>
              <p className="text-slate-600">
                @{handleTag} · {orgLoading ? '—' : `${orgs?.length || 0} organization${(orgs?.length||0)===1?'':'s'}`}
              </p>
            </div>
          </div>
        </header>

        {/* Quick actions */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* Create org */}
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Sparkle className="h-5 w-5" />
              <h3 className="font-semibold">Create a new organization</h3>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                ref={createOrgInput}
                className="input"
                placeholder="Org name (e.g., Design Guild)"
                onKeyDown={(e)=>{ if(e.key==='Enter'){ const n=createOrgInput.current?.value?.trim(); if(n) createOrg.mutate(n)} }}
              />
              <button
                className="btn"
                onClick={()=>{
                  const n = createOrgInput.current?.value?.trim()
                  if(n) createOrg.mutate(n)
                }}
                disabled={createOrg.isPending}
                title="Create organization"
              >
                {createOrg.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              You’ll become the admin and can invite teammates.
            </p>
          </div>

          {/* Join org */}
          <JoinOrg />
        </section>

        {/* Orgs grid */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Your organizations</h3>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(meLoading || orgLoading) && [0,1,2].map(i=>(
              <div key={i} className="h-40 rounded-3xl border bg-white shadow-sm animate-pulse" />
            ))}

            {(!orgLoading && !orgs?.length) && (
              <div className="rounded-3xl border bg-white p-5 shadow-sm">
                <div className="font-medium text-slate-800">You’re not in any orgs yet.</div>
                <div className="text-sm text-slate-600">
                  Create one above, or paste a join code to get started.
                </div>
              </div>
            )}

            {orgs?.map((o:any)=> {
              const membership = me?.memberships?.find((m:any)=> m.orgId === o.id)
              const isAdmin = membership?.role === 'ADMIN'
              const deco = bannerFor(o.id)
              return (
                <div key={o.id} className="group rounded-3xl border bg-white shadow-sm overflow-hidden transition hover:shadow-md">
                  {/* Banner */}
                  <div className={`h-16 ${deco.banner} flex items-center justify-between px-5`}>
                    <div className="inline-flex items-center gap-1">
                      <div className="font-semibold truncate text-slate-900/90">{o.name}</div>
                    </div>
                    <RoleBadge admin={isAdmin}/>
                  </div>

                  {/* Body */}
                  <div className="p-4">
                    <div className="flex gap-2">
                      {isAdmin && <Link className="btn-outline" to={`/org/${o.id}/admin`}>Manage {o.name}</Link>}
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      {isAdmin ? "You are an admin; manage this organization's details." : "Member access."}
                    </p>
                    <OrgTeams orgId={o.id} isAdmin={!!isAdmin} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

/* ---------------------------- Pieces ----------------------------------- */

function RoleBadge({ admin }:{admin:boolean}){
  return (
    <span className={`text-xs px-2 py-1 rounded-full ${admin ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
      {admin ? 'Admin' : 'Member'}
    </span>
  )
}

function CopyButton({ text }: { text: string }){
  return (
    <button
      className="btn-outline text-xs px-2 py-1"
      onClick={() => navigator.clipboard?.writeText(text)}
      title="Copy ID"
    >
      Copy
    </button>
  )
}

function OrgTeams({ orgId, isAdmin }:{orgId:string, isAdmin:boolean}){
  const { data: teams, refetch, isLoading } = useOrgTeams(orgId)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="mt-4 space-y-2">
      <div className="text-sm text-slate-600">My Teams</div>
      {isLoading && <div className="text-sm text-slate-500">Loading teams…</div>}
      {!isLoading && !teams?.length && <div className="text-sm text-slate-500">No teams yet.</div>}

      <ul className="flex flex-wrap gap-2">
        {teams?.map((t:any)=> (
          <li key={t.id}>
            <Link className="btn-outline" to={`/team/${t.id}`}>{t.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function useOrgTeams(orgId?:string){
  return useQuery({
    queryKey:['teams',orgId],
    queryFn: async()=> orgId ? (await api.get(`/orgs/${orgId}/teams`)).data : [],
    enabled: !!orgId
  })
}

function JoinOrg(){
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null)
  const join = useMutation({
    mutationFn: async (code: string) => (await api.post('/orgs/join', { code })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgs'] })
      if (inputRef.current) inputRef.current.value = ''
    }
  });

  useEffect(()=>{
    const el = inputRef.current
    if(!el) return
    const onKey=(e:KeyboardEvent)=>{ if(e.key==='Enter'){ e.preventDefault(); const c=el.value.trim(); if(c) join.mutate(c) } }
    el.addEventListener('keydown', onKey as any)
    return ()=> el.removeEventListener('keydown', onKey as any)
  },[])

  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <LinkIcon className="h-5 w-5" />
        <h3 className="font-semibold">Join an organization</h3>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input ref={inputRef} className="input" placeholder="Paste org join code" />
        <button
          className="btn"
          onClick={() => { const c = inputRef.current?.value?.trim(); if (c) join.mutate(c) }}
          disabled={join.isPending}
        >
          {join.isPending ? 'Joining…' : 'Join'}
        </button>
      </div>
      {join.isError && <div className="text-sm text-rose-600 mt-2">Invalid or expired code.</div>}
      {join.isSuccess && <div className="text-sm text-emerald-700 mt-2">Joined! Your orgs list is updated.</div>}
    </div>
  );
}

/* --------------------------- Tiny helpers ------------------------------ */

function Avatar({ seed, label }:{ seed:string; label:string }){
  const color = hue(seed);
  const initial = (label || 'U').trim().charAt(0).toUpperCase();
  return (
    <div
      className="h-12 w-12 shrink-0 grid place-items-center rounded-2xl text-white font-semibold"
      style={{ background: `linear-gradient(135deg, hsl(${color}, 70%, 55%), hsl(${(color+40)%360}, 70%, 55%))` }}
      aria-hidden
    >
      {initial}
    </div>
  )
}

function bannerFor(id:string){
  const h = hue(id);
  return {
    banner: `bg-gradient-to-r from-[hsl(${h},80%,96%)] to-[hsl(${(h+24)%360},80%,96%)]`,
    badgeBg: 'bg-white/70',
  }
}
function emojiFor(id:string){
  const list = ['🏗️','🧩','🪄','🚀','🎯','🛠️','📦','🧪','🌱','⚡️','✨','💡']
  const i = Math.abs(hash(id)) % list.length
  return list[i]
}
function hue(s:string){ return (Math.abs(hash(s)) % 360) }
function hash(s:string){ let h=0; for(let i=0;i<s.length;i++) h=(h<<5)-h+s.charCodeAt(i); return h }

function Logo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M5 4a2 2 0 00-2 2v12.5A1.5 1.5 0 004.5 20H18a2 2 0 002-2V7.5A1.5 1.5 0 0018.5 6H12l-2-2H5z" />
      <path d="M7 10h10v2H7zM7 14h6v2H7z" className="opacity-70" />
    </svg>
  )
}
function Sparkle(props: React.SVGProps<SVGSVGElement>){
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2l1.8 4.7L18 8.6l-4.2 1.9L12 15l-1.8-4.5L6 8.6l4.2-1.9L12 2zM5 16l1 2.5L8.5 19l-2.5 1.1L5 22.5 4 20.1 1.5 19 4 17.9 5 16zm14 0l1 2.5L22.5 19 20 20.1 19 22.5 18 20.1 15.5 19 18 18.5 19 16z"/>
    </svg>
  )
}
function LinkIcon(props: React.SVGProps<SVGSVGElement>){
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M10.6 13.4a1 1 0 001.4 1.4l4.6-4.6a3 3 0 00-4.2-4.2l-1.9 1.9a1 1 0 101.4 1.4l1.9-1.9a1 1 0 011.4 1.4L10.6 13.4zm2.8-2.8a1 1 0 00-1.4-1.4L7.4 13.8a3 3 0 104.2 4.2l1.9-1.9a1 1 0 10-1.4-1.4l-1.9 1.9a1 1 0 11-1.4-1.4l5.0-5.0z"/>
    </svg>
  )
}