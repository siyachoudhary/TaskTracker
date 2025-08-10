import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../api";

/* ---------------------------------------------------------------------- */
/* Types & constants                                                      */
/* ---------------------------------------------------------------------- */

type StatusKey = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
const STATUS = [
  { key: "TODO",        label: "To do" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "BLOCKED",     label: "Blocked" },
  { key: "DONE",        label: "Done" },
] as const;

type Perms = {
  role: "ADMIN" | "LEADER" | "MEMBER";
  canCreateTasks: boolean;
  canAssign: boolean;   // assign/unassign
  canWriteAll: boolean; // admin/leader
};

const DUE_SOON_HOURS = 48;

/* Helpers */
const isOverdue = (t: any) =>
  !!t.dueDate && dayjs(t.dueDate).isBefore(dayjs()) && t.status !== "DONE";
const isDueSoon = (t: any) =>
  !!t.dueDate &&
  !isOverdue(t) &&
  dayjs(t.dueDate).isBefore(dayjs().add(DUE_SOON_HOURS, "hour")) &&
  t.status !== "DONE";

/* ---------------------------------------------------------------------- */
/* Page                                                                    */
/* ---------------------------------------------------------------------- */

export default function Team() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"tasks" | "deadlines" | "info">("tasks");
  const [teamName, setTeamName] = useState("Team");

  // read tab from URL hash
  useEffect(() => {
    const m = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const t = m.get("tab");
    if (t === "deadlines" || t === "info" || t === "tasks") setTab(t as any);
  }, []);
  useEffect(() => {
    const m = new URLSearchParams();
    m.set("tab", tab);
    window.location.hash = m.toString();
  }, [tab]);

  // fetch team name for nav
  useEffect(() => {
    if (!id) return;
    api.get(`/teams/${id}`)
      .then(res => setTeamName(res.data?.name || "Team"))
      .catch(() => setTeamName("Team"));
  }, [id]);

  if (!id) return null;

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b bg-white/70 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-3">
          <Link to="/orgs" className="btn-outline shrink-0">← Back</Link>

          <h1 className="text-lg font-semibold truncate">{teamName}</h1>

          <div className="inline-flex rounded-xl border bg-white p-1 shrink-0">
            <TabButton active={tab==="tasks"} onClick={()=>setTab("tasks")}>Tasks</TabButton>
            <TabButton active={tab==="deadlines"} onClick={()=>setTab("deadlines")}>Deadlines</TabButton>
            <TabButton active={tab==="info"} onClick={()=>setTab("info")}>Info</TabButton>
          </div>
        </div>
      </div>

      <div className="container py-6 space-y-8">
        {tab === "tasks"     && <TasksTab teamId={id} />}
        {tab === "deadlines" && <DeadlinesTab teamId={id} />}
        {tab === "info"      && <InfoTab teamId={id} onRenamed={(n)=>setTeamName(n)} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Tabs                                                                    */
/* ---------------------------------------------------------------------- */

function TabButton({ active, children, onClick }:{
  active:boolean; children: React.ReactNode; onClick:()=>void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition
        ${active ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}

/* Small collapsible container */
function Collapsible({
  title, open, setOpen, children
}:{
  title: React.ReactNode; open:boolean; setOpen:(v:boolean)=>void; children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <button
        className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm font-medium"
        onClick={()=>setOpen(!open)}
      >
        <span className="flex items-center gap-2">{title}</span>
        <span className="opacity-70">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/* =============================== TASKS ================================= */

function highlightMentions(text: string) {
  const parts = (text || "").split(/(@[a-zA-Z0-9_.~-]{2,30})/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="mention">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function TasksTab({ teamId }: { teamId: string }) {
  const qc = useQueryClient();

  // local UI (create)
  const [newTask, setNewTask] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDue, setNewDue]   = useState<string>(""); // datetime-local value
  const [showCreateMore, setShowCreateMore] = useState(false);

  // local UI (per-task)
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [assignPick, setAssignPick] = useState<Record<string, string>>({});

  // filters
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState<"ALL" | StatusKey>("ALL");
  const [filterAssignee, setFilterAssignee] = useState<string>("ALL");
  const [filterFrom, setFilterFrom] = useState<string>(""); // due from
  const [filterTo, setFilterTo] = useState<string>("");     // due to
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [filterSoon, setFilterSoon] = useState(false);

  // data
  const { data: me } = useQuery({ queryKey:["me"], queryFn: async()=> (await api.get("/me")).data });
  const { data: tasks } = useQuery({
    queryKey: ["tasks", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/tasks`)).data,
    enabled: !!teamId,
  });
  const { data: members } = useQuery({
    queryKey: ["members", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/members`)).data,
    enabled: !!teamId,
  });
  const { data: perms } = useQuery<Perms>({
    queryKey: ["perms", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/permissions`)).data,
    enabled: !!teamId,
  });

  // id -> display name
  const nameById = useMemo(
    () => new Map<string, string>((members || []).map((m: any) => [m.userId, m.name || m.handle || m.userId])),
    [members]
  );

  /* ----------------------------- Actions -------------------------------- */

  async function createTask() {
    const title = newTask.trim();
    const description = newDesc.trim() || null;
    const dueDate = newDue ? new Date(newDue).toISOString() : null;
    if (!title) return;
    try {
      await api.post(`/teams/${teamId}/tasks`, { title, description, dueDate });
      setNewTask("");
      setNewDesc("");
      setNewDue("");
      setShowCreateMore(false);
      qc.invalidateQueries({ queryKey: ["tasks", teamId] });
    } catch (e) { console.error(e); }
  }

  // optimistic status switch
  async function updateStatus(taskId: string, status: StatusKey) {
    const key = ["tasks", teamId] as const;
    const prev = qc.getQueryData<any[]>(key);
    qc.setQueryData<any[]>(key, (old) =>
      old ? old.map((t) => (t.id === taskId ? { ...t, status } : t)) : old
    );
    try {
      await api.patch(`/tasks/${taskId}`, { status });
    } catch (e) {
      console.error(e);
      qc.setQueryData(key, prev); // rollback
    } finally {
      qc.invalidateQueries({ queryKey: key });
    }
  }

  async function addNote(taskId: string) {
    const text = (noteText[taskId] || "").trim();
    if (!text) return;
    try {
      await api.post(`/tasks/${taskId}/notes`, { content: text });
      setNoteText((s) => ({ ...s, [taskId]: "" }));
      qc.invalidateQueries({ queryKey: ["tasks", teamId] });
    } catch (e) { console.error(e); }
  }

  async function assign(taskId: string) {
    if (!perms?.canAssign) return;
    const userId = assignPick[taskId];
    if (!userId) return;

    // prevent duplicate assignment locally
    const current = qc.getQueryData<any[]>(["tasks", teamId]);
    const t = current?.find((x) => x.id === taskId);
    if (t?.assignees?.some((a: any) => a.userId === userId)) return;

    try {
      await api.post(`/tasks/${taskId}/assignees`, { userId });
      setAssignPick((s) => ({ ...s, [taskId]: "" }));
      qc.invalidateQueries({ queryKey: ["tasks", teamId] });
    } catch (e) { console.error(e); }
  }

  async function unassign(taskId: string, userId: string) {
    if (!perms?.canAssign) return;
    try {
      await api.delete(`/tasks/${taskId}/assignees/${userId}`);
      qc.invalidateQueries({ queryKey: ["tasks", teamId] });
    } catch (e) { console.error(e); }
  }

  async function deleteTask(taskId: string) {
    if (!perms?.canWriteAll) return;
    if (!confirm("Delete this task? This cannot be undone.")) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      qc.invalidateQueries({ queryKey: ["tasks", teamId] });
    } catch (e) {
      console.error(e);
      alert("Failed to delete. Make sure the server has DELETE /tasks/:taskId.");
    }
  }

  /* ------------------------------ Filtering ----------------------------- */

  const myId = me?.id;

  const filteredTasks = useMemo(() => {
    let list = (tasks || []) as any[];

    if (onlyMine && myId) {
      list = list.filter(t => t.assignees?.some((a:any)=> a.userId === myId));
    }
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter(t =>
        (t.title || "").toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "ALL") {
      list = list.filter(t => t.status === filterStatus);
    }
    if (filterAssignee !== "ALL") {
      list = list.filter(t => t.assignees?.some((a:any)=> a.userId === filterAssignee));
    }
    if (filterFrom) {
      const from = dayjs(filterFrom);
      list = list.filter(t => t.dueDate ? dayjs(t.dueDate).isSame(from, "minute") || dayjs(t.dueDate).isAfter(from) : false);
    }
    if (filterTo) {
      const to = dayjs(filterTo);
      list = list.filter(t => t.dueDate ? dayjs(t.dueDate).isSame(to, "minute") || dayjs(t.dueDate).isBefore(to) : false);
    }
    if (filterOverdue) {
      list = list.filter(t => isOverdue(t));
    }
    if (filterSoon) {
      list = list.filter(t => isDueSoon(t));
    }

    return list;
  }, [tasks, onlyMine, myId, filterText, filterStatus, filterAssignee, filterFrom, filterTo, filterOverdue, filterSoon]);

  // group by status
  const grouped: Record<StatusKey, any[]> = { TODO: [], IN_PROGRESS: [], BLOCKED: [], DONE: [] };
  for (const t of filteredTasks) grouped[t.status as StatusKey]?.push(t);
  // sort by due date (nulls last)
  for (const k of Object.keys(grouped) as StatusKey[]) {
    grouped[k].sort((a:any, b:any) => {
      const da = a.dueDate ? dayjs(a.dueDate).valueOf() : Number.POSITIVE_INFINITY;
      const db = b.dueDate ? dayjs(b.dueDate).valueOf() : Number.POSITIVE_INFINITY;
      return da - db;
    });
  }

  const isMine = (t: any) => !!myId && t.assignees?.some((a: any) => a.userId === myId);

  /* ------------------------------ Render -------------------------------- */

  const filterCount =
    (onlyMine ? 1 : 0) +
    (filterText ? 1 : 0) +
    (filterStatus !== "ALL" ? 1 : 0) +
    (filterAssignee !== "ALL" ? 1 : 0) +
    (filterFrom ? 1 : 0) +
    (filterTo ? 1 : 0) +
    (filterOverdue ? 1 : 0) +
    (filterSoon ? 1 : 0);

  return (
    <>
      {/* Quick add */}
      {perms?.canCreateTasks && (
        <div className="rounded-2xl border bg-white shadow-sm p-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto] items-center">
            <input
              className="input"
              placeholder="Add a task…"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createTask()}
            />
            <div className="flex gap-2 justify-end">
              <button
                className="btn-outline"
                onClick={() => setShowCreateMore(s => !s)}
                title="Description & deadline"
              >
                {showCreateMore ? "Fewer options" : "More options"}
              </button>
              <button className="btn" onClick={createTask}>Add</button>
            </div>
          </div>

          {showCreateMore && (
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_260px]">
              <input
                className="input"
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <input
                className="input"
                type="datetime-local"
                value={newDue}
                onChange={(e)=> setNewDue(e.target.value)}
                title="Deadline (optional)"
              />
            </div>
          )}
        </div>
      )}

      {/* Filters (compact header + collapsible content) */}
      <Collapsible
        open={filtersOpen}
        setOpen={setFiltersOpen}
        title={
          <>
            <span className="rounded-full border px-2 py-0.5 bg-slate-50">Filters</span>
            {filterCount > 0 && (
              <span className="text-xs rounded-full bg-slate-900 text-white px-2 py-0.5">
                {filterCount}
              </span>
            )}
          </>
        }
      >
        <div className="grid gap-2 md:grid-cols-6">
          <input
            className="input md:col-span-2"
            placeholder="Search title/description…"
            value={filterText}
            onChange={(e)=>setFilterText(e.target.value)}
          />
          <select
            className="select"
            value={filterStatus}
            onChange={(e)=>setFilterStatus(e.target.value as any)}
          >
            <option value="ALL">All statuses</option>
            {STATUS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select
            className="select"
            value={filterAssignee}
            onChange={(e)=>setFilterAssignee(e.target.value)}
          >
            <option value="ALL">All assignees</option>
            {(members || []).map((m:any)=>(
              <option key={m.userId} value={m.userId}>{m.name || m.handle || m.userId}</option>
            ))}
          </select>
          <input className="input" type="datetime-local" value={filterFrom} onChange={(e)=>setFilterFrom(e.target.value)} title="Due from" />
          <input className="input" type="datetime-local" value={filterTo}   onChange={(e)=>setFilterTo(e.target.value)}   title="Due to" />
        </div>
        <div className="flex flex-wrap gap-4 mt-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            Only my tasks
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={filterOverdue} onChange={e=>setFilterOverdue(e.target.checked)} />
            Overdue only
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={filterSoon} onChange={e=>setFilterSoon(e.target.checked)} />
            Due soon (48h)
          </label>
        </div>
      </Collapsible>

      {/* Kanban: each column is its own scroll view */}
      <div className="grid md:grid-cols-4 gap-4">
        {STATUS.map((col) => {
          const items = grouped[col.key] || [];
          return (
            <section
              key={col.key}
              className="flex flex-col rounded-2xl border bg-white shadow-sm"
              style={{
                maxHeight: "calc(100vh - 260px)",
                minHeight: "520px",
              }}
            >
              <header className="sticky top-0 z-10 bg-white/85 backdrop-blur border-b px-4 py-2">
                <h3 className="text-lg font-semibold text-slate-700">{col.label}</h3>
              </header>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {items.map((t: any) => {
                  const overdue = isOverdue(t);
                  const soon = isDueSoon(t);
                  return (
                    <div
                      key={t.id}
                      className={`rounded-2xl border bg-white p-4 shadow-sm group ${
                        isMine(t) ? "ring-2 ring-indigo-300" : ""
                      }`}
                    >
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-start">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <div className="font-semibold leading-6 truncate" title={t.title}>
                              {t.title}
                            </div>
                            {overdue && (
                              <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                Overdue
                              </span>
                            )}
                            {!overdue && soon && (
                              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                Due soon
                              </span>
                            )}
                          </div>

                          {t.description && (
                            <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap break-words line-clamp-3">
                              {t.description}
                            </div>
                          )}

                          {t.dueDate && (
                            <div className="mt-1 text-xs">
                              <span className="font-medium text-slate-600">Due:</span>{" "}
                              <span
                                className={
                                  overdue
                                    ? "text-rose-700 font-medium"
                                    : soon
                                    ? "text-amber-700 font-medium"
                                    : "text-slate-700"
                                }
                              >
                                {dayjs(t.dueDate).format("MMM D, YYYY HH:mm")}
                              </span>
                            </div>
                          )}
                        </div>

                        <select
                          className="select sm:justify-self-end"
                          defaultValue={t.status}
                          onChange={(e) => updateStatus(t.id, e.target.value as StatusKey)}
                        >
                          {STATUS.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </select>

                        {perms?.canWriteAll && (
                          <button
                            className="btn-outline sm:justify-self-end shrink-0 opacity-0 group-hover:opacity-100"
                            title="Delete task"
                            onClick={() => deleteTask(t.id)}
                          >
                            🗑
                          </button>
                        )}
                      </div>

                      {/* Assignees */}
                      <div className="mt-3 text-sm text-slate-700">
                        <div className="font-medium mb-1">Assigned</div>
                        {t.assignees?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {t.assignees.map((a: any) => (
                              <span
                                key={a.userId}
                                className="inline-flex items-center gap-2 rounded-full border px-2 py-0.5"
                              >
                                {nameById.get(a.userId) || a.userId}
                                {perms?.canAssign && (
                                  <button
                                    className="text-slate-500 hover:text-slate-800"
                                    title="Unassign"
                                    onClick={() => unassign(t.id, a.userId)}
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500">none</span>
                        )}
                      </div>

                      {/* Assign */}
                      {perms?.canAssign && (
                        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                          <select
                            className="select w-full"
                            value={assignPick[t.id] || ""}
                            onChange={(e) =>
                              setAssignPick((s) => ({ ...s, [t.id]: e.target.value }))
                            }
                          >
                            <option value="" disabled>
                              Assign to…
                            </option>
                            {members?.map((m: any) => (
                              <option key={m.userId} value={m.userId}>
                                {m.name || m.handle || m.userId}{" "}
                                {m.role === "LEADER" ? "• LEAD" : ""}
                              </option>
                            ))}
                          </select>
                          <button className="btn w-full sm:w-auto" onClick={() => assign(t.id)}>
                            Assign
                          </button>
                        </div>
                      )}

                      {/* Notes compact toggle */}
                      <div className="mt-3">
                        <button
                          className="btn-outline w-full justify-between"
                          onClick={() =>
                            setOpenNotes((s) => ({ ...s, [t.id]: !s[t.id] }))
                          }
                        >
                          <span>Notes ({t.notes?.length || 0})</span>
                          <span className="ml-2">{openNotes[t.id] ? "▲" : "▼"}</span>
                        </button>

                        {openNotes[t.id] && (
                          <div className="mt-2 space-y-2 max-h-40 overflow-auto pr-1">
                            {t.notes?.length ? (
                              t.notes.map((n: any) => (
                                <div key={n.id} className="note text-sm">
                                  {highlightMentions(n.content)}
                                  <div className="text-xs text-slate-500 mt-1">
                                    {dayjs(n.createdAt).format("MMM D, HH:mm")}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-xs text-slate-500">No notes yet.</div>
                            )}
                          </div>
                        )}

                        {/* Add note inline */}
                        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                          <input
                            className="input w-full"
                            placeholder="Add note (use @handle)"
                            value={noteText[t.id] || ""}
                            onChange={(e) =>
                              setNoteText((s) => ({ ...s, [t.id]: e.target.value }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && addNote(t.id)}
                          />
                          <button className="btn w-full sm:w-auto" onClick={() => addNote(t.id)}>
                            Post
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/* ============================== DEADLINES =============================== */

type CalView = "day" | "week" | "month" | "year";

function DeadlinesTab({ teamId }: { teamId: string }) {
  const qc = useQueryClient();

  const { data: perms } = useQuery<Perms>({
    queryKey: ["perms", teamId],
    queryFn: async()=> (await api.get(`/teams/${teamId}/permissions`)).data,
    enabled: !!teamId
  });

  const { data: me } = useQuery({ queryKey:["me"], queryFn: async()=> (await api.get("/me")).data });

  // use tasks as the single source of truth (deadline = task.dueDate)
  const { data: tasks } = useQuery({
    queryKey: ["tasks", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/tasks`)).data,
    enabled: !!teamId,
  });

  // need members for assignee filter
  const { data: members } = useQuery({
    queryKey: ["members", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/members`)).data,
    enabled: !!teamId,
  });

  const [view, setView] = useState<CalView>("month");
  const [cursor, setCursor] = useState<dayjs.Dayjs>(dayjs());

  // filters
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [filterAssignee, setFilterAssignee] = useState<string>("ALL");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [filterSoon, setFilterSoon] = useState(false);

  const myId = me?.id;

  // filter tasks first, then map to deadlines
  const filteredTasks = useMemo(() => {
    let list = (tasks || []) as any[];
    if (onlyMine && myId) {
      list = list.filter(t => t.assignees?.some((a:any)=> a.userId === myId));
    }
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter(t =>
        (t.title || "").toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q)
      );
    }
    if (filterAssignee !== "ALL") {
      list = list.filter(t => t.assignees?.some((a:any)=> a.userId === filterAssignee));
    }
    if (filterFrom) {
      const from = dayjs(filterFrom);
      list = list.filter(t => t.dueDate ? dayjs(t.dueDate).isSame(from, "minute") || dayjs(t.dueDate).isAfter(from) : false);
    }
    if (filterTo) {
      const to = dayjs(filterTo);
      list = list.filter(t => t.dueDate ? dayjs(t.dueDate).isSame(to, "minute") || dayjs(t.dueDate).isBefore(to) : false);
    }
    if (filterOverdue) list = list.filter(t => isOverdue(t));
    if (filterSoon)    list = list.filter(t => isDueSoon(t));
    return list;
  }, [tasks, onlyMine, myId, filterText, filterAssignee, filterFrom, filterTo, filterOverdue, filterSoon]);

  const deadlines = useMemo(() => {
    return filteredTasks
      .filter(t => !!t.dueDate)
      .map(t => ({
        id: t.id,
        title: t.title,
        startAt: t.dueDate,
        endAt: t.dueDate,
        task: t,
      }));
  }, [filteredTasks]);

  function shift(k: 1 | -1) {
    setCursor(v =>
      view === "day" ? v.add(k, "day")
      : view === "week" ? v.add(k, "week")
      : view === "month" ? v.add(k, "month")
      : v.add(k, "year"));
  }
  function today() { setCursor(dayjs()); }

  // modal for details
  const [open, setOpen] = useState(false);
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [newNote, setNewNote] = useState("");

  function openModal(task: any) { setActiveTask(task); setNewNote(""); setOpen(true); }
  function closeModal() { setOpen(false); setActiveTask(null); }

  async function addNoteToActive() {
    if (!activeTask) return;
    const text = newNote.trim();
    if (!text) return;
    await api.post(`/tasks/${activeTask.id}/notes`, { content: text });
    setNewNote("");
    await qc.invalidateQueries({ queryKey: ["tasks", teamId] });
    const updated = (await api.get(`/teams/${teamId}/tasks`)).data.find((t:any)=> t.id === activeTask.id);
    if (updated) setActiveTask(updated);
  }

  const filterCount =
    (onlyMine ? 1 : 0) +
    (filterText ? 1 : 0) +
    (filterAssignee !== "ALL" ? 1 : 0) +
    (filterFrom ? 1 : 0) +
    (filterTo ? 1 : 0) +
    (filterOverdue ? 1 : 0) +
    (filterSoon ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-2xl border bg-white shadow-sm p-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-2">
          <button className="btn-outline" onClick={today}>Today</button>
          <button className="btn-outline" onClick={()=>shift(-1)}>‹</button>
          <button className="btn-outline" onClick={()=>shift(1)}>›</button>
        </div>
        <div className="ml-2 font-semibold">
          {cursor.format(
            view === "year" ? "YYYY" :
            view === "month" ? "MMMM YYYY" :
            "MMM D, YYYY"
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select className="select" value={view} onChange={e=>setView(e.target.value as CalView)}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>

          <button
            className="btn-outline"
            onClick={()=>setFiltersOpen(s=>!s)}
            title="Show filters"
          >
            Filters {filterCount ? `(${filterCount})` : ""}
          </button>
        </div>
      </div>

      {/* Filters */}
      {filtersOpen && (
        <div className="rounded-2xl border bg-white shadow-sm p-3 space-y-3">
          <div className="grid gap-2 md:grid-cols-6">
            <input
              className="input md:col-span-2"
              placeholder="Search title/description…"
              value={filterText}
              onChange={(e)=>setFilterText(e.target.value)}
            />
            <select
              className="select"
              value={filterAssignee}
              onChange={(e)=>setFilterAssignee(e.target.value)}
            >
              <option value="ALL">All assignees</option>
              {(members || []).map((m:any)=>(
                <option key={m.userId} value={m.userId}>{m.name || m.handle || m.userId}</option>
              ))}
            </select>
            <input className="input" type="datetime-local" value={filterFrom} onChange={(e)=>setFilterFrom(e.target.value)} title="Due from" />
            <input className="input" type="datetime-local" value={filterTo}   onChange={(e)=>setFilterTo(e.target.value)}   title="Due to" />
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={onlyMine}
                onChange={(e) => setOnlyMine(e.target.checked)}
              />
              Only my deadlines
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={filterOverdue} onChange={e=>setFilterOverdue(e.target.checked)} />
              Overdue only
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={filterSoon} onChange={e=>setFilterSoon(e.target.checked)} />
              Due soon (48h)
            </label>
          </div>
        </div>
      )}

      {/* Calendar-like views */}
      <div className="card">
        {view === "day"   && <DayGrid   date={cursor} events={deadlines} onPick={t=>openModal(t)} />}
        {view === "week"  && <WeekGrid  date={cursor} events={deadlines} onPick={t=>openModal(t)} />}
        {view === "month" && <MonthGrid date={cursor} events={deadlines} onPick={t=>openModal(t)} />}
        {view === "year"  && <YearGrid  date={cursor} events={deadlines} onPick={t=>openModal(t)} />}
      </div>

      {/* Modal: task details + notes */}
      {open && activeTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={closeModal} />
          <div className="relative z-10 w-[min(720px,92vw)] rounded-2xl border bg-white p-5 shadow-xl" role="dialog" aria-modal="true">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold truncate">{activeTask.title}</h3>
                <div className="mt-1 text-sm text-slate-600">
                  Status: <span className="font-medium">{activeTask.status}</span>
                  {activeTask.dueDate && (
                    <>
                      {" · "}Deadline: {dayjs(activeTask.dueDate).format("MMM D, YYYY HH:mm")}
                    </>
                  )}
                </div>
                <div className="mt-1 flex gap-2">
                  {isOverdue(activeTask) && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">Overdue</span>
                  )}
                  {isDueSoon(activeTask) && !isOverdue(activeTask) && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Due soon</span>
                  )}
                </div>
              </div>
              <button className="btn-outline" onClick={closeModal}>Close</button>
            </div>

            {activeTask.description && (
              <div className="mt-3 text-slate-800">{activeTask.description}</div>
            )}

            <div className="mt-4">
              <div className="font-medium mb-1 text-sm">Assignees</div>
              {activeTask.assignees?.length ? (
                <div className="flex flex-wrap gap-2 text-sm">
                  {activeTask.assignees.map((a:any)=>(
                    <span key={a.userId} className="rounded-full border px-2 py-0.5">
                      {a.user?.name || a.user?.handle || a.userId}
                    </span>
                  ))}
                </div>
              ) : <div className="text-sm text-slate-500">None</div>}
            </div>

            {/* Notes in modal */}
            <div className="mt-5">
              <div className="font-semibold">Notes</div>
              <div className="mt-2 space-y-2 max-h-48 overflow-auto pr-1">
                {activeTask.notes?.length ? (
                  activeTask.notes.map((n:any)=> (
                    <div key={n.id} className="note text-sm">
                      {highlightMentions(n.content)}
                      <div className="text-xs text-slate-500 mt-1">
                        {dayjs(n.createdAt).format("MMM D, HH:mm")}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500">No notes yet.</div>
                )}
              </div>

              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <input
                  className="input"
                  placeholder="Add note (use @handle)"
                  value={newNote}
                  onChange={(e)=>setNewNote(e.target.value)}
                  onKeyDown={(e)=> e.key === "Enter" && addNoteToActive()}
                />
                <button className="btn" onClick={addNoteToActive}>Post</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Calendar renderers (super lightweight)
   Expect events: { id, title, startAt, endAt, task } and call onPick(task) */

function MonthGrid({ date, events, onPick }:{
  date:Dayjs; events:any[]; onPick:(task:any)=>void
}) {
  const start = date.startOf("month").startOf("week");
  const days = Array.from({length: 42}, (_,i)=> start.add(i, "day"));
  return (
    <div>
      <div className="grid grid-cols-7 text-xs text-slate-600 mb-2 px-1">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=> <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map(d=>{
          const dayEvents = events.filter((e:any)=>{
            const s = dayjs(e.startAt);
            return d.isSame(s, "day");
          }).slice(0,4);
          const muted = d.month()!==date.month();
          return (
            <div key={d.toString()} className={`border rounded-xl p-2 min-h-[96px] ${muted?"bg-slate-50 text-slate-400":""}`}>
              <div className="text-xs font-medium">{d.date()}</div>
              <div className="mt-1 space-y-1">
                {dayEvents.map((e:any)=>(
                  <button
                    key={e.id}
                    className="w-full text-left text-xs truncate px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200"
                    onClick={()=>onPick(e.task)}
                    title={e.title}
                  >
                    {e.title}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekGrid({ date, events, onPick }:{
  date:Dayjs; events:any[]; onPick:(task:any)=>void
}) {
  const start = date.startOf("week");
  const days = Array.from({length:7}, (_,i)=> start.add(i, "day"));
  return (
    <div>
      <div className="grid grid-cols-7 text-xs text-slate-600 mb-2 px-1">
        {days.map(d=> <div key={d.toString()}>{d.format("ddd D")}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map(d=>{
          const dayEvents = events.filter((e:any)=> dayjs(e.startAt).isSame(d, "day"));
          return (
            <div key={d.toString()} className="border rounded-xl p-2 min-h-[120px]">
              {dayEvents.length ? dayEvents.map((e:any)=>(
                <button
                  key={e.id}
                  className="w-full text-left text-xs truncate px-2 py-0.5 rounded bg-slate-100 mb-1 hover:bg-slate-200"
                  onClick={()=>onPick(e.task)}
                  title={e.title}
                >
                  {dayjs(e.startAt).format("HH:mm")} {e.title}
                </button>
              )) : <div className="text-xs text-slate-400">No deadlines</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayGrid({ date, events, onPick }:{
  date:Dayjs; events:any[]; onPick:(task:any)=>void
}) {
  const dayEvents = events
    .filter((e:any)=> dayjs(e.startAt).isSame(date, "day"))
    .sort((a:any,b:any)=> dayjs(a.startAt).valueOf() - dayjs(b.startAt).valueOf());
  return (
    <div className="space-y-1">
      {dayEvents.length ? dayEvents.map((e:any)=>(
        <button
          key={e.id}
          className="w-full text-left border rounded-xl p-3 hover:bg-slate-50"
          onClick={()=>onPick(e.task)}
          title={e.title}
        >
          <div className="font-medium">{e.title}</div>
          <div className="text-sm text-slate-600">
            {dayjs(e.startAt).format("HH:mm")}
          </div>
        </button>
      )) : <div className="text-sm text-slate-500">No deadlines for this day.</div>}
    </div>
  )
}

function YearGrid({ date, events, onPick }:{
  date:Dayjs; events:any[]; onPick:(task:any)=>void
}) {
  const months = Array.from({length:12}, (_,i)=> date.month(i).startOf("month"));
  return (
    <div className="grid md:grid-cols-3 gap-3">
      {months.map(m=>(
        <div key={m.toString()} className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">{m.format("MMMM YYYY")}</div>
          <MonthGrid date={m} events={events} onPick={onPick} />
        </div>
      ))}
    </div>
  )
}

/* ================================ INFO ================================= */
function InfoTab({ teamId, onRenamed }:{ teamId:string; onRenamed:(name:string)=>void }) {
  const qc = useQueryClient();

  // 1) fetch team (gives us orgId + name)
  const { data: team } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}`)).data,
    enabled: !!teamId,
  });

  // 2) team members (for roster + roles)
  const { data: members } = useQuery({
    queryKey: ["members", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/members`)).data,
    enabled: !!teamId,
  });

  // 3) permissions (who can manage)
  const { data: perms } = useQuery<Perms>({
    queryKey: ["perms", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/permissions`)).data,
    enabled: !!teamId,
  });

  // 4) **org members** for the searchable dropdown
  const orgId = team?.orgId;
  const { data: orgMembers, error: orgMembersErr } = useQuery({
    queryKey: ["orgMembers-for-info", orgId],
    queryFn: async () => (await api.get(`/orgs/${orgId}/members`)).data,
    enabled: !!orgId && !!perms,
    retry: false,
  });

  const rename = useMutation({
    mutationFn: async (name: string) => (await api.patch(`/teams/${teamId}`, { name })).data,
    onSuccess: (t: any) => {
      qc.invalidateQueries({ queryKey: ["team", teamId] });
      onRenamed(t.name);
    }
  });

  const addToTeam = useMutation({
    mutationFn: async (userId: string) => (await api.post(`/teams/${teamId}/members`, { userId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", teamId] })
  });

  const removeFromTeam = useMutation({
    mutationFn: async (userId: string) => (await api.delete(`/teams/${teamId}/members/${userId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", teamId] })
  });

  const makeLeader = useMutation({
    mutationFn: async (userId: string) => (await api.post(`/teams/${teamId}/leader`, { userId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", teamId] })
  });

  const { data: infoBundle, refetch: refetchInfo } = useQuery({
    queryKey: ["team-info", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/info`)).data,
    enabled: !!teamId,
  });

  /* ---- Team info text ---- */
  const saveInfo = useMutation({
    mutationFn: async (info: string) => (await api.patch(`/teams/${teamId}/info`, { info })).data,
    onSuccess: () => refetchInfo()
  });

  /* ---- Links CRUD ---- */
  const addLink = useMutation({
    mutationFn: async ({ label, url }: {label:string; url:string}) =>
      (await api.post(`/teams/${teamId}/links`, { label, url })).data,
    onSuccess: () => refetchInfo()
  });

  const updateLink = useMutation({
    mutationFn: async ({ id, label, url }: { id:string; label:string; url:string }) =>
      (await api.patch(`/teams/${teamId}/links/${id}`, { label, url })).data,
    onSuccess: () => refetchInfo()
  });

  const removeLink = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/teams/${teamId}/links/${id}`)).data,
    onSuccess: () => refetchInfo()
  });

  // --- Searchable combobox state
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{userId:string; label:string} | null>(null);

  const options = (orgMembers || []).map((m:any)=> ({
    userId: m.userId,
    label: `${m.name || m.handle || m.userId}  ·  @${m.handle || m.userId}`
  }));

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function pick(o:{userId:string; label:string}) {
    setSelected(o);
    setQuery(o.label);
    setOpen(false);
  }

  return (
    <div className="space-y-6">
      {/* Rename team (admins + leaders) */}
      <div className="card">
        <h3 className="font-semibold mb-2">Team details</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="teamNameEdit"
            className="input"
            defaultValue={team?.name || ""}
            placeholder="Team name"
            disabled={!perms?.canWriteAll}
          />
          {perms?.canWriteAll && (
            <button
              className="btn"
              onClick={() => {
                const el = document.getElementById("teamNameEdit") as HTMLInputElement;
                const n = el?.value?.trim();
                if (n && n !== team?.name) rename.mutate(n);
              }}
            >
              {rename.isPending ? "Saving…" : "Save name"}
            </button>
          )}
        </div>
      </div>

      {/* Team info */}
      <div className="card">
        <h3 className="font-semibold mb-2">Team info</h3>
        <textarea
          id="teamInfo"
          className="input w-full h-28"
          defaultValue={infoBundle?.info || ""}
          placeholder="Add notes, goals, norms, anything useful…"
          disabled={!perms?.canWriteAll}
        />
        {perms?.canWriteAll && (
          <div className="mt-2">
            <button
              className="btn"
              onClick={()=>{
                const el = document.getElementById("teamInfo") as HTMLTextAreaElement;
                saveInfo.mutate(el.value ?? "");
              }}
            >
              {saveInfo.isPending ? "Saving…" : "Save info"}
            </button>
          </div>
        )}
      </div>

      {/* Useful links */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Useful links</h3>
          {perms?.canWriteAll && (
            <AddLinkInline
              onAdd={(label, url)=>{
                if (!label || !url) return;
                addLink.mutate({ label, url });
              }}
            />
          )}
        </div>

        <ul className="mt-3 space-y-2">
          {(infoBundle?.links || []).map((ln:any)=> (
            <li key={ln.id} className="flex items-center justify-between">
              <a href={ln.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                {ln.label}
              </a>
              {perms?.canWriteAll && (
                <div className="flex gap-2">
                  <button
                    className="btn-outline"
                    onClick={()=>{
                      const newLabel = prompt("Link text", ln.label) ?? ln.label;
                      const newUrl   = prompt("URL", ln.url) ?? ln.url;
                      if (newLabel && newUrl) updateLink.mutate({ id: ln.id, label: newLabel, url: newUrl });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-outline"
                    onClick={()=>{
                      if (confirm(`Remove link “${ln.label}”?`)) removeLink.mutate(ln.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
          {!infoBundle?.links?.length && (
            <li className="text-sm text-slate-500">No links yet.</li>
          )}
        </ul>
      </div>

      {/* Members management */}
      <div className="card relative">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Team members</h3>

          {perms?.canWriteAll && (
            <div className="w-full max-w-md flex gap-2">
              {/* Combobox input */}
              <div className="relative flex-1">
                <input
                  className="input w-full"
                  placeholder={orgMembersErr ? "Org roster unavailable" : "Search people…"}
                  value={query}
                  disabled={!!orgMembersErr}
                  onChange={e => {
                    setQuery(e.target.value);
                    setOpen(true);
                  }}
                  onFocus={() => setOpen(true)}
                  onBlur={() => setTimeout(() => setOpen(false), 120)}
                />

                {open && !orgMembersErr && (
                  <div className="absolute z-10 mt-1 w-full rounded-xl border bg-white shadow-sm max-h-64 overflow-auto">
                    {filtered.length ? filtered.map(o => (
                      <button
                        key={o.userId}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => pick(o)}
                      >
                        {o.label}
                      </button>
                    )) : (
                      <div className="px-3 py-2 text-sm text-slate-500">No matches</div>
                    )}
                  </div>
                )}
              </div>

              {/* Button */}
              <button
                className="btn"
                disabled={!selected}
                onClick={() => selected && addToTeam.mutate(selected.userId)}
              >
                Add to team
              </button>
            </div>
          )}
        </div>

        <ul className="divide-y mt-3">
          {(members||[]).map((m:any)=> (
            <li key={m.userId} className="py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{m.name || m.handle || m.userId}</div>
                <div className="text-xs text-slate-600">
                  @{m.handle || m.userId} — {m.role}
                </div>
              </div>
              <div className="flex gap-2">
                {perms?.role === "ADMIN" && m.role !== "LEADER" && (
                  <button className="btn-outline" onClick={()=>makeLeader.mutate(m.userId)}>
                    Make Lead
                  </button>
                )}
                {perms?.canWriteAll && (
                  <button className="btn-outline" onClick={()=>removeFromTeam.mutate(m.userId)}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
          {!members?.length && <li className="py-3 text-sm text-slate-500">No members yet.</li>}
        </ul>
      </div>
    </div>
  );
}

/* Small inline “add link” control */
function AddLinkInline({ onAdd }:{ onAdd:(label:string, url:string)=>void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div className="flex gap-2">
      <input
        className="input"
        placeholder="Link text"
        value={label}
        onChange={e=>setLabel(e.target.value)}
      />
      <input
        className="input"
        placeholder="https://…"
        value={url}
        onChange={e=>setUrl(e.target.value)}
      />
      <button
        className="btn"
        onClick={()=>{ if(label && url) { onAdd(label, url); setLabel(""); setUrl(""); } }}
      >
        Add
      </button>
    </div>
  );
}