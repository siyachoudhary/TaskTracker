import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Link, useNavigate } from 'react-router-dom'

function TopNav(){
  const nav = useNavigate()
  async function logout() {
    try { await api.post('/auth/logout') } catch {}
    nav('/', { replace: true })
  }
  return (
    <div className="sticky top-0 z-10 border-b bg-white/70 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <div className="font-semibold tracking-tight">TaskTracker</div>
        <button className="btn-outline" onClick={logout}>Logout</button>
      </div>
    </div>
  )
}

export default function Orgs(){
  const qc = useQueryClient();
  const { data: me, isLoading: meLoading }   = useQuery({ queryKey:['me'],   queryFn: async()=> (await api.get('/me')).data })
  const { data: orgs, isLoading: orgLoading } = useQuery({ queryKey:['orgs'], queryFn: async()=> (await api.get('/orgs')).data })

  const createOrgInput = useRef<HTMLInputElement>(null)
  const createOrg = useMutation({
  mutationFn: async (name: string) => (await api.post('/orgs', { name })).data,
  onSuccess: async (created) => {
    // instantly show the new org
    qc.setQueryData(['orgs'], (prev: any[] = []) => [created, ...prev])
    if (createOrgInput.current) createOrgInput.current.value = ''
    // also refetch to stay authoritative
    await qc.invalidateQueries({ queryKey: ['orgs'], refetchType: 'active' })
    await qc.invalidateQueries({ queryKey: ['me'],   refetchType: 'active' })
  },
})

  const greeting = useMemo(()=> me?.name || me?.handle || 'there', [me])
  const greeting2 = useMemo(()=> me?.handle || 'there', [me])

  return (
    <div className="min-h-screen">
      <TopNav/>
      <div className="container py-8 space-y-8">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Hello {greeting}</h2>
            <p className="text-slate-600">User ID: {greeting2}</p>
            <p className="text-slate-600">Your organizations</p>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Create org */}
          <div className="card">
            <h3 className="font-semibold mb-2">Create a new organization</h3>
            <div className="flex gap-2">
              <input ref={createOrgInput} className="input flex-1" placeholder="Org name (e.g., Design Guild)"/>
              <button
                className="btn"
                onClick={()=>{
                  const n = createOrgInput.current?.value?.trim()
                  if(n) createOrg.mutate(n)
                }}
                disabled={createOrg.isPending}
              >
                {createOrg.isPending ? 'Creating…' : 'Create Organization'}
              </button>
            </div>
          </div>

          {/* Join org */}
          <JoinOrg />
        </div>

        {/* Orgs grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(meLoading || orgLoading) && [0,1,2].map(i=>(
            <div key={i} className="card animate-pulse h-40" />
          ))}
          {(!orgLoading && !orgs?.length) && (
            <div className="card">
              <div className="text-slate-700 font-medium">You’re not in any orgs yet.</div>
              <div className="text-slate-600 text-sm">Create one above, or paste a join code.</div>
            </div>
          )}
          {orgs?.map((o:any)=> {
            const membership = me?.memberships?.find((m:any)=> m.orgId === o.id)
            const isAdmin = membership?.role === 'ADMIN'
            return (
              <div key={o.id} className="card">
                {/* Title row */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold leading-tight">{o.name}</div>
                    {/* <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                      <code className="bg-slate-100 px-2 py-1 rounded">{o.id}</code>
                      <CopyButton text={o.id} />
                    </div> */}
                  </div>
                  <RoleBadge admin={isAdmin}/>
                </div>

                {/* Manage Organization Action */}
                <div className="mt-3 flex gap-2">
                  {isAdmin && <Link className="btn-outline" to={`/org/${o.id}/admin`}>Manage org</Link>}
                </div>

                {/* Teams list */}
                <OrgTeams orgId={o.id} isAdmin={!!isAdmin} />

                
              </div>
            )
          })}
        </div>
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

//   const createTeam = async()=>{
//     const name = inputRef.current?.value?.trim()
//     if(!name) return
//     await api.post(`/orgs/${orgId}/teams`,{name})
//     if (inputRef.current) inputRef.current.value = ''
//     await refetch()
//   }

  return (
    <div className="mt-4 space-y-3">
      {/* {isAdmin && (
        <div className="flex gap-2">
          <input ref={inputRef} className="input flex-1" placeholder="New team name"/>
          <button className="btn" onClick={createTeam}>Create Team</button>
        </div>
      )} */}

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

  // hit enter to submit
  useEffect(()=>{
    const el = inputRef.current
    if(!el) return
    const onKey=(e:KeyboardEvent)=>{ if(e.key==='Enter'){ e.preventDefault(); const c=el.value.trim(); if(c) join.mutate(c) } }
    el.addEventListener('keydown', onKey as any)
    return ()=> el.removeEventListener('keydown', onKey as any)
  },[])

  return (
    <div className="card">
      <h3 className="font-semibold mb-2">Join an organization</h3>
      <div className="flex gap-2">
        <input ref={inputRef} className="input flex-1" placeholder="Paste org join code" />
        <button
          className="btn"
          onClick={() => {
            const c = inputRef.current?.value?.trim()
            if (c) join.mutate(c)
          }}
          disabled={join.isPending}
        >
          {join.isPending ? 'Joining…' : 'Join'}
        </button>
      </div>
      {join.isError && <div className="text-sm text-red-600 mt-2">Invalid or expired code.</div>}
      {join.isSuccess && <div className="text-sm text-emerald-700 mt-2">Joined! Your orgs list is updated.</div>}
    </div>
  );
}
