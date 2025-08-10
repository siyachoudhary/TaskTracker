import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

function MiniBtn({
  children,
  variant = 'solid',
  onClick,
  disabled
}: {
  children: React.ReactNode
  variant?: 'solid' | 'outline'
  onClick?: () => void
  disabled?: boolean
}) {
  const base = 'px-3 py-1.5 rounded-lg text-sm'
  const solid = 'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50'
  const outline = 'border border-slate-300 hover:bg-slate-100 disabled:opacity-50'
  return (
    <button
      className={`${base} ${variant === 'solid' ? solid : outline}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function MiniSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`border border-slate-300 rounded-lg px-2 py-1.5 text-sm ${props.className || ''}`}
    />
  )
}

function OrgJoinCode({ orgId }: { orgId: string }) {
  const { data: codes, refetch, isFetching } = useQuery({
    queryKey: ['orgJoinCodes', orgId],
    queryFn: async () => (await api.get(`/orgs/${orgId}/join-codes`)).data,
    enabled: !!orgId
  })
  const gen = async () => { await api.post(`/orgs/${orgId}/join-codes`, {}); await refetch() }
  const code = codes?.[0]
  return (
    <div className="mt-3 flex items-center gap-3">
      <button className="btn" onClick={gen} disabled={isFetching}>
        {isFetching ? 'Generating…' : 'Generate org join code'}
      </button>
      {code ? (
        <div className="text-sm">
          <code className="bg-slate-100 px-2 py-1 rounded">{code.code}</code>
          <span className="ml-2 text-slate-600">uses: {code.uses}</span>
        </div>
      ) : <div className="text-sm text-slate-500">No active code</div>}
    </div>
  )
}

export default function OrgAdmin(){
  const { id } = useParams()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [openTeams, setOpenTeams] = useState<Record<string, boolean>>({})

  const { data: details, isLoading, isError } = useQuery({
    queryKey: ['orgDetails', id],
    queryFn: async () => (await api.get(`/orgs/${id}/details`)).data,
    enabled: !!id
  })

  const { data: orgMembers } = useQuery({
    queryKey: ['orgMembers', id],
    queryFn: async () => (await api.get(`/orgs/${id}/members`)).data,
    enabled: !!id
  })

  const { data: teams } = useQuery({
    queryKey: ['teamsForAdmin', id],
    queryFn: async () => (await api.get(`/orgs/${id}/teams`)).data,
    enabled: !!id
  })

  const updateOrgRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "ADMIN" | "MEMBER" }) =>
      (await api.patch(`/orgs/${id}/members/${userId}`, { role })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgMembers', id] })
      qc.invalidateQueries({ queryKey: ['orgDetails', id] })
    }
  })

  const rename = useMutation({
    mutationFn: async (name: string) => (await api.patch(`/orgs/${id}`, { name })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgDetails', id] })
  })

  const addToTeam = useMutation({
    mutationFn: async ({ userId, teamId }: { userId: string; teamId: string }) =>
      (await api.post(`/teams/${teamId}/members`, { userId })).data,
    onSuccess: () => qc.invalidateQueries()
  })

  const makeLeader = useMutation({
    mutationFn: async ({ userId, teamId }: { userId: string; teamId: string }) =>
      (await api.post(`/teams/${teamId}/leader`, { userId })).data,
    onSuccess: () => qc.invalidateQueries()
  })

  const deleteTeam = useMutation({
    mutationFn: async (teamId: string) => (await api.delete(`/teams/${teamId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teamsForAdmin', id] })
      qc.invalidateQueries({ queryKey: ['orgDetails', id] })
    }
  })

  const removeFromTeam = useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: string; userId: string }) =>
      (await api.delete(`/teams/${teamId}/members/${userId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teamsForAdmin', id] })
      qc.invalidateQueries({ queryKey: ['orgDetails', id] })
    }
  })

  const deleteOrg = useMutation({
    mutationFn: async () => (await api.delete(`/orgs/${id}`)).data,
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['orgs'] })
      window.location.href = '/orgs'
    }
  })

  const removeFromOrg = useMutation({
    mutationFn: async (userId: string) => (await api.delete(`/orgs/${id}/members/${userId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgMembers', id] })
      qc.invalidateQueries({ queryKey: ['orgDetails', id] })
      qc.invalidateQueries({ queryKey: ['teamsForAdmin', id] })
      alert('Removed from organization.')
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error === 'cannot_remove_admin'
        ? 'Admins cannot be removed.'
        : 'Failed to remove from organization.'
      alert(msg)
    }
  })

  const filtered = useMemo(()=>{
    if(!q.trim()) return orgMembers || []
    const s = q.trim().toLowerCase()
    return (orgMembers||[]).filter((m:any)=>(
      (m.name||'').toLowerCase().includes(s) ||
      (m.handle||'').toLowerCase().includes(s) ||
      m.userId.toLowerCase().includes(s) ||
      (m.role||'').toLowerCase().includes(s)
    ))
  }, [q, orgMembers])

  if (isLoading) return <Shell><div className="card">Loading…</div></Shell>
  if (isError)   return <Shell><div className="card">You don't have access to this org.</div></Shell>
  if (!details)  return <Shell><div className="card">Org not found.</div></Shell>

  const onSave = () => {
    const el = document.getElementById('orgNameEdit') as HTMLInputElement
    const name = el?.value?.trim()
    if (name && name !== details.name) rename.mutate(name)
  }

  return (
    <Shell>
      <div className="card">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Manage {details.name}</h2>
          </div>
          <Link to="/orgs" className="btn-outline">← Back To All Your Organizations</Link>
        </div>

        {/* Join code just under title */}
        <OrgJoinCode orgId={details.id} />

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          {/* Rename org + destructive action */}
          <div className="card">
            <h3 className="font-semibold mb-2">Organization details</h3>
            <label className="text-sm text-slate-600">Name</label>
            <input id="orgNameEdit" className="input w-full mt-1" defaultValue={details.name}/>
            <div className="mt-3 flex gap-2">
              <button className="btn" onClick={onSave} disabled={rename.isPending}>
                {rename.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button
                className="btn-outline"
                onClick={()=>{
                  if (confirm('Delete this organization? This removes all teams and data.')) {
                    deleteOrg.mutate()
                  }
                }}
              >
                Delete organization
              </button>
            </div>
          </div>

          {/* Members with search + controls (scroll shows ~3 rows) */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Members ({details.memberCount})</h3>
              <input
                value={q}
                onChange={e=>setQ(e.target.value)}
                className="input h-9 text-sm"
                placeholder="Search by name, handle, role…"
              />
            </div>

            <ul className="max-h-[228px] overflow-auto pr-1 divide-y divide-slate-200 bg-white rounded-xl border border-slate-200">
              {!filtered?.length && (
                <li className="py-3 px-3 text-sm text-slate-500">No matching members.</li>
              )}

              {filtered?.map((m:any)=> {
                const isAdminUser = m.role === 'ADMIN'
                return (
                  <li key={m.userId} className="py-2 px-3">
                    {/* Top: identity */}
                    <div className="mb-2">
                      <div className="font-medium truncate">{m.name || m.handle}</div>
                      <div className="text-xs text-slate-600 truncate">
                        @{m.handle || m.userId} — {m.role}
                      </div>
                    </div>

                    {/* Bottom: actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Org role */}
                      <MiniSelect
                        defaultValue={isAdminUser ? 'ADMIN' : 'MEMBER'}
                        onChange={(e)=>{
                          const newRole = e.target.value as 'ADMIN'|'MEMBER'
                          if (newRole !== (isAdminUser ? 'ADMIN' : 'MEMBER')) {
                            updateOrgRole.mutate({ userId: m.userId, role: newRole })
                          }
                        }}
                        title="Change org role"
                      >
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                      </MiniSelect>

                      {/* Team selection + add */}
                      <MiniSelect id={`teamSel-${m.userId}`} defaultValue="">
                        <option value="" disabled>Choose team…</option>
                        {teams?.map((t:any)=> <option key={t.id} value={t.id}>{t.name}</option>)}
                      </MiniSelect>
                      <MiniBtn
                        variant="outline"
                        onClick={()=>{
                          const sel = document.getElementById(`teamSel-${m.userId}`) as HTMLSelectElement
                          if (!sel?.value) return
                          addToTeam.mutate({ userId: m.userId, teamId: sel.value })
                        }}
                      >
                        Add
                      </MiniBtn>

                      {/* Make leader */}
                      <MiniBtn
                        onClick={()=>{
                          const sel = document.getElementById(`teamSel-${m.userId}`) as HTMLSelectElement
                          if (!sel?.value) return
                          makeLeader.mutate({ userId: m.userId, teamId: sel.value })
                        }}
                      >
                        Make Lead
                      </MiniBtn>

                      {/* Remove from org (disabled for admins) */}
                      <MiniBtn
                        variant="outline"
                        onClick={()=>{
                          if (isAdminUser) return
                          if (confirm(`Remove ${m.handle || m.name || m.userId} from this organization?`)) {
                            removeFromOrg.mutate(m.userId)
                          }
                        }}
                        disabled={isAdminUser}
                        title={isAdminUser ? "Admins cannot be removed" : "Remove from organization"}
                      >
                        Remove Member
                      </MiniBtn>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* Teams — collapsible member lists, delete team, remove members */}
        <div className="mt-6">
          <h3 className="font-semibold mb-2">Teams</h3>
          {/* Create team */}
<div className="card mb-4">
  <h3 className="font-semibold mb-2">Create a new team</h3>
  <div className="flex gap-2">
    <input
      id="newTeamName"
      className="input flex-1"
      placeholder="New team name"
    />
    <button
      className="btn"
      onClick={() => {
        const el = document.getElementById('newTeamName') as HTMLInputElement
        const name = el?.value.trim()
        if (!name) return
        api.post(`/orgs/${id}/teams`, { name }).then(() => {
          el.value = ''
          qc.invalidateQueries({ queryKey: ['teamsForAdmin', id] })
          qc.invalidateQueries({ queryKey: ['orgDetails', id] })
        })
      }}
    >
      Create Team
    </button>
  </div>
</div>

          <div className="grid md:grid-cols-2 gap-3">
            {details.teams.map((t:any)=> {
              const isOpen = openTeams[t.id]
              const toggle = () => setOpenTeams(s => ({ ...s, [t.id]: !s[t.id] }))
              const roster = [
                ...(t.leaders || []).map((u:any)=> ({ ...u, _role: 'LEADER' })),
                ...(t.members || []).map((u:any)=> ({ ...u, _role: 'MEMBER' }))
              ]
              return (
                <div className="card" key={t.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-sm text-slate-600 mt-1">
                        Leaders: {t.leaders.map((x:any)=> x.handle || x.name).join(', ') || 'none'}
                      </div>
                      <div className="text-sm text-slate-600">
                        Members: {t.members.length}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-outline" onClick={toggle}>
                        {isOpen ? 'Hide members' : 'Show members'}
                      </button>
                      <button
                        className="btn-outline"
                        onClick={()=>{
                          if (confirm(`Delete team "${t.name}"?`)) deleteTeam.mutate(t.id)
                        }}
                      >
                        Delete team
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3">
                      {!roster.length && <div className="text-sm text-slate-500">No members yet.</div>}
                      <ul className="space-y-2 max-h-56 overflow-auto pr-1">
                        {roster.map((u:any)=> (
                          <li key={u.userId} className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">{u.name || u.handle}</div>
                              <div className="text-xs text-slate-600">@{u.handle || u.userId} — {u._role}</div>
                            </div>
                            <button
                              className="btn-outline"
                              onClick={()=>{
                                if (confirm(`Remove ${u.handle || u.name || u.userId} from team "${t.name}"?`)) {
                                  removeFromTeam.mutate({ teamId: t.id, userId: u.userId })
                                }
                              }}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Link className="btn-outline mt-3 inline-flex" to={`/team/${t.id}`}>Open team</Link>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }){
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-10 border-b bg-white/60 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="font-semibold">TaskTracker</div>
          <Link to="/orgs" className="btn-outline">All Organizations</Link>
        </div>
      </div>
      <div className="container py-6 space-y-6">
        {children}
      </div>
    </div>
  )
}