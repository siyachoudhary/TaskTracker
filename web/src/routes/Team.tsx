import { useEffect, useMemo, useState, useLayoutEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../api";
import { FluxMarkWithWaves, FluxLogo } from "../components/FluxLogo";

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

const STATUS_LABEL: Record<StatusKey, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

type ActivityRow = {
  id: string;
  taskId: string;
  taskTitle: string;
  oldStatus: StatusKey | null;
  newStatus: StatusKey;
  changedAt: string;
  changedBy: { id: string; name?: string | null; handle?: string | null };
  link?: string;
};

type Perms = {
  role: "ADMIN" | "LEADER" | "MEMBER";
  canCreateTasks: boolean;
  canAssign: boolean;
  canWriteAll: boolean; // admin/leader
};

const DUE_SOON_HOURS = 48;
const isOverdue = (t: any) =>
  !!t.dueDate && dayjs(t.dueDate).isBefore(dayjs()) && t.status !== "DONE";
const isDueSoon = (t: any) =>
  !!t.dueDate &&
  !isOverdue(t) &&
  dayjs(t.dueDate).isBefore(dayjs().add(DUE_SOON_HOURS, "hour")) &&
  t.status !== "DONE";

/* --- Calendar color helpers (status-based + overdue/soon halos) -------- */

type TaskLike = { status?: StatusKey; dueDate?: string | null };
function calChipClasses(t: TaskLike) {
  const s = (t.status as StatusKey) || "TODO";
  const base = "w-full text-left text-xs truncate px-2 py-0.5 rounded border transition";
  const byStatus: Record<StatusKey, string> = {
    TODO:        "bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800",
    IN_PROGRESS: "bg-indigo-100 hover:bg-indigo-200 border-indigo-200 text-indigo-800",
    BLOCKED:     "bg-rose-100 hover:bg-rose-200 border-rose-200 text-rose-800",
    DONE:        "bg-emerald-100 hover:bg-emerald-200 border-emerald-200 text-emerald-800",
  };
  const halo = isOverdue(t) ? " ring-1 ring-rose-400/70" : isDueSoon(t) ? " ring-1 ring-amber-400/70" : "";
  return `${base} ${byStatus[s]}${halo}`;
}
function dayCardClasses(t: TaskLike) {
  const s = (t.status as StatusKey) || "TODO";
  const base = "w-full text-left rounded-xl p-3 hover:bg-slate-50 border";
  const byStatusBorder: Record<StatusKey, string> = {
    TODO:        "border-slate-200 border-l-4 border-l-slate-400/80",
    IN_PROGRESS: "border-indigo-200 border-l-4 border-l-indigo-400/80",
    BLOCKED:     "border-rose-200 border-l-4 border-l-rose-400/80",
    DONE:        "border-emerald-200 border-l-4 border-l-emerald-400/80",
  };
  const halo = isOverdue(t) ? " ring-1 ring-rose-400/70" : isDueSoon(t) ? " ring-1 ring-amber-400/70" : "";
  return `${base} ${byStatusBorder[s]}${halo}`;
}

/* ---------------------------------------------------------------------- */
/* Page                                                                    */
/* ---------------------------------------------------------------------- */


function normalizeActivityPayload(d: any): ActivityRow[] {
  const list = Array.isArray(d) ? d
    : Array.isArray(d?.items) ? d.items
    : Array.isArray(d?.rows) ? d.rows
    : Array.isArray(d?.activity) ? d.activity
    : [];

  return list.map((r: any): ActivityRow => {
    // Support multiple possible shapes/field names defensively
    const taskTitle =
      r.taskTitle ??
      r.task?.title ??
      r.task_name ??
      "Untitled task";

    const oldStatus: StatusKey | null =
      (r.oldStatus ?? r.fromStatus ?? r.prevStatus ?? null) as StatusKey | null;

    const newStatus: StatusKey =
      (r.newStatus ?? r.toStatus ?? r.status ?? "TODO") as StatusKey;

    // changedBy can be a string id + a separate name, or a nested user object
    const changedById =
      r.changedBy?.id ?? r.changedBy ?? r.userId ?? r.user?.id ?? "";
    const changedByName =
      r.changedBy?.name ?? r.changedByName ?? r.user?.name ?? r.user_name ?? null;
    const changedByHandle =
      r.changedBy?.handle ?? r.user?.handle ?? r.user_handle ?? null;

    const when =
      r.changedAt ?? r.createdAt ?? r.timestamp ?? new Date().toISOString();
    const taskId = String(r.taskId ?? r.task_id ?? r.task?.id ?? "");
  const link = r.link ?? (taskId ? `/tasks/${taskId}` : undefined);

    return {
    id: String(r.id ?? `${changedById}:${when}:${taskTitle}`),
    taskId,
    taskTitle,
    oldStatus,
    newStatus,
    changedAt: typeof when === "string" ? when : new Date(when).toISOString(),
    changedBy: { id: String(changedById || ""), name: changedByName, handle: changedByHandle },
    link,
  };
  });
}


export default function Team() {
  const { id } = useParams<{ id: string }>();
  type TabKey = "tasks" | "deadlines" | "info" | "activity";
  const [tab, setTab] = useState<TabKey>("tasks");
  const [teamName, setTeamName] = useState("Team");
  const { data: perms } = useQuery<Perms>({
  queryKey: ["perms", id],
  queryFn: async () => (await api.get(`/teams/${id}/permissions`)).data,
  enabled: !!id,
});
const canSeeActivity = !!perms && (perms.role === "ADMIN" || perms.role === "LEADER");


  // read tab from URL hash
  useEffect(() => {
  const m = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const t = m.get("tab");
  if (t === "deadlines" || t === "info" || t === "tasks" || t === "activity") {
    if (t === "activity" && !canSeeActivity) setTab("tasks");
    else setTab(t as any);
  }
}, [canSeeActivity]);

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
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Background layer (always behind) */}
      <div aria-hidden className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-indigo-50 to-sky-50" />
        <div className="absolute -top-28 -left-28 h-[520px] w-[520px] rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute -bottom-28 -right-28 h-[520px] w-[520px] rounded-full bg-indigo-200/40 blur-3xl" />
      </div>

      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b bg-white/70 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-3">
          
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
          <h1 className="min-w-0 flex items-center gap-2 text-lg sm:text-xl font-semibold leading-none">
            <FluxMarkWithWaves size={18} />
            <span className="truncate bg-gradient-to-r from-indigo-600 to-cyan-500 text-transparent bg-clip-text">
              {teamName}
            </span>
          </h1>
          <div className="inline-flex rounded-xl border bg-white p-1 shrink-0">
            <TabButton active={tab==="tasks"} onClick={()=>setTab("tasks")}>Tasks</TabButton>
            <TabButton active={tab==="deadlines"} onClick={()=>setTab("deadlines")}>Deadlines</TabButton>
            <TabButton active={tab==="info"} onClick={()=>setTab("info")}>Info</TabButton>
            {canSeeActivity && (
              <TabButton active={tab==="activity"} onClick={()=>setTab("activity")}>Activity</TabButton>
            )}

          </div>
        </div>
      </div>

      {/* Content above background */}
      <div className="relative z-10 container py-6 space-y-8">
        {tab === "tasks"     && <TasksTab teamId={id} />}
        {tab === "deadlines" && <DeadlinesTab teamId={id} />}
        {tab === "info"      && <InfoTab teamId={id} onRenamed={(n)=>setTeamName(n)} />}
        {tab === "activity"  && canSeeActivity && <ActivityTab teamId={id} />}

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

/* Small collapsible */
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
    p.startsWith("@") ? <span key={i} className="mention">{p}</span> : <span key={i}>{p}</span>
  );
}

/* Fit-to-viewport helper (for columns / calendar) */
function useFitToViewport(ref: React.RefObject<HTMLElement>, bottomGap = 24) {
  const [h, setH] = useState(560);
  useLayoutEffect(() => {
    const calc = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const next = Math.max(360, Math.floor(window.innerHeight - top - bottomGap));
      setH(next);
    };
    calc();
    window.addEventListener("resize", calc);
    const obs = new ResizeObserver(calc);
    obs.observe(document.body);
    return () => {
      window.removeEventListener("resize", calc);
      obs.disconnect();
    };
  }, [ref, bottomGap]);
  return h;
}

/* --------------------------- Shared Task Modal -------------------------- */

function TaskModal({
  task,
  teamId,
  perms,
  members,
  onClose,
}:{
  task: any;
  teamId: string;
  perms?: Perms;
  members?: any[];
  onClose: ()=>void;
}) {
  const qc = useQueryClient();
  const [working, setWorking] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [title, setTitle] = useState(task.title || "");
  const [description, setDescription] = useState(task.description || "");
  const [due, setDue] = useState<string>(task.dueDate ? dayjs(task.dueDate).format("YYYY-MM-DDTHH:mm") : "");
  const [note, setNote] = useState("");
  const [assignPick, setAssignPick] = useState("");

  const nameById = useMemo(
    () => new Map<string, string>((members || []).map((m: any) => [m.userId, m.name || m.handle || m.userId])),
    [members]
  );

  // FIX: subscribe to the shared tasks list and select the live version of this task.
  const { data: tasksLive } = useQuery({
    queryKey: ["tasks", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/tasks`)).data,
    enabled: !!teamId,
  });

  const liveTask = useMemo(
    () => (tasksLive || []).find((t: any) => t.id === task.id) ?? task,
    [tasksLive, task]
  );

  const key = ["tasks", teamId] as const;

  async function refreshSelf() {
    await qc.invalidateQueries({ queryKey: key });
  }

  // FIX: optimistic status update so the controlled select reflects immediately.
  async function setStatus(status: StatusKey) {
    setWorking(true);
    const prev = qc.getQueryData<any[]>(key);
    qc.setQueryData<any[]>(key, (old) =>
      old ? old.map((t) => (t.id === task.id ? { ...t, status } : t)) : old
    );
    try {
      await api.patch(`/tasks/${task.id}`, { status });
    } catch (e) {
      qc.setQueryData(key, prev);
      console.error(e);
    } finally {
      await refreshSelf();
      setWorking(false);
    }
  }

  // FIX: optimistic patch for title/description/dueDate so the read view updates instantly.
  async function saveEdits() {
    if (!perms?.canWriteAll) return;
    setWorking(true);
    const next = {
      title: title.trim() || "Untitled task",
      description: description.trim() || null,
      dueDate: due ? new Date(due).toISOString() : null,
    };
    const prev = qc.getQueryData<any[]>(key);
    qc.setQueryData<any[]>(key, (old) =>
      old ? old.map((t) => (t.id === task.id ? { ...t, ...next } : t)) : old
    );
    try {
      await api.patch(`/tasks/${task.id}`, next);
      await refreshSelf();
      setEditMode(false);
    } catch (e) {
      qc.setQueryData(key, prev);
      console.error(e);
      alert("Failed to save changes.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteTask() {
    if (!perms?.canWriteAll) return;
    if (!confirm("Delete this task? This cannot be undone.")) return;
    setWorking(true);
    try {
      await api.delete(`/tasks/${task.id}`);
      await refreshSelf();
      onClose();
    } finally { setWorking(false); }
  }

  async function postNote() {
    const text = note.trim();
    if (!text) return;
    setWorking(true);
    try {
      await api.post(`/tasks/${task.id}/notes`, { content: text });
      setNote("");
      await refreshSelf();
    } finally { setWorking(false); }
  }

  async function assign() {
    if (!perms?.canWriteAll || !assignPick) return;
    setWorking(true);
    try {
      await api.post(`/tasks/${task.id}/assignees`, { userId: assignPick });
      setAssignPick("");
      await refreshSelf();
    } finally { setWorking(false); }
  }

  async function unassign(userId: string) {
    if (!perms?.canWriteAll) return;
    setWorking(true);
    try {
      await api.delete(`/tasks/${task.id}/assignees/${userId}`);
      await refreshSelf();
    } finally { setWorking(false); }
  }

  // FIX: compute badges from live data
  const overdue = isOverdue(liveTask);
  const soon = isDueSoon(liveTask);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-[min(760px,92vw)] max-h-[90vh] overflow-auto rounded-2xl border bg-white p-5 shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          {!editMode ? (
            <div className="min-w-0">
              <h3 className="text-lg font-semibold truncate">{liveTask.title}</h3>
              <div className="mt-1 text-sm text-slate-600">
                Status:&nbsp;
                {/* FIX: controlled select bound to live status */}
                <select
                  className="select inline-block"
                  value={liveTask.status}
                  onChange={(e)=>setStatus(e.target.value as StatusKey)}
                  disabled={working}
                >
                  {STATUS.map(s=> <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                {liveTask.dueDate && <> · Deadline: {dayjs(liveTask.dueDate).format("MMM D, YYYY HH:mm")}</>}
              </div>
              <div className="mt-1 flex gap-2">
                {overdue && <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">Overdue</span>}
                {!overdue && soon && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Due soon</span>}
              </div>
            </div>
          ) : (
            <div className="flex-1">
              <input className="input w-full" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title" />
              <div className="mt-2 grid gap-2 md:grid-cols-[1fr_240px]">
                <input className="input" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Description" />
                <input className="input" type="datetime-local" value={due} onChange={e=>setDue(e.target.value)} title="Deadline" />
              </div>
            </div>
          )}

          <div className="flex gap-2 shrink-0">
            {!editMode ? (
              <>
                {perms?.canWriteAll && <button className="btn-outline" onClick={()=>setEditMode(true)}>Edit</button>}
                {perms?.canWriteAll && <button className="btn-outline" onClick={deleteTask}>Delete</button>}
                <button className="btn-outline" onClick={onClose}>X</button>
              </>
            ) : (
              <>
                <button className="btn" onClick={saveEdits} disabled={working}>{working ? "Saving…" : "Save"}</button>
                <button className="btn-outline" onClick={()=>setEditMode(false)} disabled={working}>Cancel</button>
              </>
            )}
          </div>
        </div>

        {/* Description (read mode) */}
        {!editMode && liveTask.description && (
          <div className="mt-3 text-slate-800 whitespace-pre-wrap">{liveTask.description}</div>
        )}

        {/* Assignees */}
        <div className="mt-4">
          <div className="font-medium mb-1 text-sm">Assignees</div>
          {liveTask.assignees?.length ? (
            <div className="flex flex-wrap gap-2 text-sm">
              {liveTask.assignees.map((a:any)=>(
                <span key={a.userId} className="rounded-full border px-2 py-0.5 inline-flex items-center gap-2">
                  {a.user?.name || a.user?.handle || nameById.get(a.userId) || a.userId}
                  {perms?.canWriteAll && (
                    <button className="text-slate-500 hover:text-slate-800" onClick={()=>unassign(a.userId)} title="Unassign">×</button>
                  )}
                </span>
              ))}
            </div>
          ) : <div className="text-sm text-slate-500">None</div>}

          {perms?.canWriteAll && (
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <select className="select" value={assignPick} onChange={e=>setAssignPick(e.target.value)}>
                <option value="">Assign to…</option>
                {(members||[]).map((m:any)=>(
                  <option key={m.userId} value={m.userId}>{m.name || m.handle || m.userId} {m.role === "LEADER" ? "• LEAD" : ""}</option>
                ))}
              </select>
              <button className="btn" onClick={assign} disabled={!assignPick || working}>Assign</button>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="mt-5">
          <div className="font-semibold">Notes</div>
          <div className="mt-2 space-y-2 max-h-48 overflow-auto pr-1">
            {liveTask.notes?.length ? (
              liveTask.notes.map((n:any)=> (
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
              value={note}
              onChange={(e)=>setNote(e.target.value)}
              onKeyDown={(e)=> e.key === "Enter" && postNote()}
            />
            <button className="btn" onClick={postNote} disabled={working}>Post</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================ TASKS TAB ============================= */

function TasksTab({ teamId }: { teamId: string }) {
  const qc = useQueryClient();

  // quick-create
  const [newTask, setNewTask] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDue, setNewDue] = useState<string>("");
  const [showCreateMore, setShowCreateMore] = useState(false);

  // per-task UI
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((s) => ({ ...s, [id]: !s[id] }));

  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [assignPick, setAssignPick] = useState<Record<string, string>>({});

  // filters
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState<"ALL" | StatusKey>("ALL");
  const [filterAssignee, setFilterAssignee] = useState<string>("ALL");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [filterSoon, setFilterSoon] = useState(false);

  // column height fit
  const boardRef = useRef<HTMLDivElement>(null);
  const colH = useFitToViewport(boardRef, 24);

  // data
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get("/me")).data,
  });
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

  const nameById = useMemo(
    () =>
      new Map<string, string>(
        (members || []).map((m: any) => [
          m.userId,
          m.name || m.handle || m.userId,
        ])
      ),
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
    } catch (e) {
      console.error(e);
    }
  }

  async function updateStatus(taskId: string, status: StatusKey) {
    const key = ["tasks", teamId] as const;
    const prev = qc.getQueryData<any[]>(key);
    qc.setQueryData<any[]>(key, (old) =>
      old ? old.map((t) => (t.id === taskId ? { ...t, status } : t)) : old
    );
    try {
      await api.patch(`/tasks/${taskId}`, { status });
    } catch (e) {
      qc.setQueryData(key, prev);
      console.error(e);
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
    } catch (e) {
      console.error(e);
    }
  }

  async function assign(taskId: string) {
    if (!perms?.canAssign) return;
    const userId = assignPick[taskId];
    if (!userId) return;
    try {
      await api.post(`/tasks/${taskId}/assignees`, { userId });
      setAssignPick((s) => ({ ...s, [taskId]: "" }));
      qc.invalidateQueries({ queryKey: ["tasks", teamId] });
    } catch (e) {
      console.error(e);
    }
  }

  async function unassign(taskId: string, userId: string) {
    if (!perms?.canAssign) return;
    try {
      await api.delete(`/tasks/${taskId}/assignees/${userId}`);
      qc.invalidateQueries({ queryKey: ["tasks", teamId] });
    } catch (e) {
      console.error(e);
    }
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
    if (onlyMine && myId)
      list = list.filter((t) =>
        t.assignees?.some((a: any) => a.userId === myId)
      );
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter(
        (t) =>
          (t.title || "").toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "ALL")
      list = list.filter((t) => t.status === filterStatus);
    if (filterAssignee !== "ALL")
      list = list.filter((t) =>
        t.assignees?.some((a: any) => a.userId === filterAssignee)
      );
    if (filterFrom) {
      const from = dayjs(filterFrom);
      list = list.filter((t) =>
        t.dueDate
          ? dayjs(t.dueDate).isSame(from, "minute") ||
            dayjs(t.dueDate).isAfter(from)
          : false
      );
    }
    if (filterTo) {
      const to = dayjs(filterTo);
      list = list.filter((t) =>
        t.dueDate
          ? dayjs(t.dueDate).isSame(to, "minute") ||
            dayjs(t.dueDate).isBefore(to)
          : false
      );
    }
    if (filterOverdue) list = list.filter((t) => isOverdue(t));
    if (filterSoon) list = list.filter((t) => isDueSoon(t));
    return list;
  }, [
    tasks,
    onlyMine,
    myId,
    filterText,
    filterStatus,
    filterAssignee,
    filterFrom,
    filterTo,
    filterOverdue,
    filterSoon,
  ]);

  const grouped: Record<StatusKey, any[]> = {
    TODO: [],
    IN_PROGRESS: [],
    BLOCKED: [],
    DONE: [],
  };
  for (const t of filteredTasks) grouped[t.status as StatusKey]?.push(t);
  (Object.keys(grouped) as StatusKey[]).forEach((k) => {
    grouped[k].sort((a: any, b: any) => {
      const da = a.dueDate
        ? dayjs(a.dueDate).valueOf()
        : Number.POSITIVE_INFINITY;
      const db = b.dueDate
        ? dayjs(b.dueDate).valueOf()
        : Number.POSITIVE_INFINITY;
      return da - db;
    });
  });

  const isMine = (t: any) =>
    !!myId && t.assignees?.some((a: any) => a.userId === myId);

  const filterCount =
    (onlyMine ? 1 : 0) +
    (filterText ? 1 : 0) +
    (filterStatus !== "ALL" ? 1 : 0) +
    (filterAssignee !== "ALL" ? 1 : 0) +
    (filterFrom ? 1 : 0) +
    (filterTo ? 1 : 0) +
    (filterOverdue ? 1 : 0) +
    (filterSoon ? 1 : 0);

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTask, setModalTask] = useState<any | null>(null);
  const openTaskModal = (t: any) => {
    setModalTask(t);
    setModalOpen(true);
  };
  const closeTaskModal = () => {
    setModalOpen(false);
    setModalTask(null);
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  /* ------------------------------ Render -------------------------------- */

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
                onClick={() => setShowCreateMore((s) => !s)}
                title="Description & deadline"
              >
                {showCreateMore ? "Fewer options" : "More options"}
              </button>
              <button className="btn" onClick={createTask}>
                Add
              </button>
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
                onChange={(e) => setNewDue(e.target.value)}
                title="Deadline (optional)"
              />
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <Collapsible
        open={filtersOpen}
        setOpen={setFiltersOpen}
        title={
          <>
            <span className="rounded-full border px-2 py-0.5 bg-slate-50">
              Filters
            </span>
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
            onChange={(e) => setFilterText(e.target.value)}
          />
          <select
            className="select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
          >
            <option value="ALL">All statuses</option>
            {STATUS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
          >
            <option value="ALL">All assignees</option>
            {(members || []).map((m: any) => (
              <option key={m.userId} value={m.userId}>
                {m.name || m.handle || m.userId}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="datetime-local"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            title="Due from"
          />
          <input
            className="input"
            type="datetime-local"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            title="Due to"
          />
        </div>
        <div className="flex flex-wrap gap-4 mt-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
            />
            Only my tasks
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={filterOverdue}
              onChange={(e) => setFilterOverdue(e.target.checked)}
            />
            Overdue only
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={filterSoon}
              onChange={(e) => setFilterSoon(e.target.checked)}
            />
            Due soon (48h)
          </label>
        </div>
      </Collapsible>

      {/* Kanban */}
      <div ref={boardRef} className="grid md:grid-cols-4 gap-4">
        {STATUS.map((col) => {
          const items = grouped[col.key] || [];
          return (
            <section
              key={col.key}
              className="flex flex-col rounded-2xl border bg-white shadow-sm overflow-hidden"
              style={{ height: colH }}
            >
              <header className="shrink-0 sticky top-0 z-10 bg-white/90 backdrop-blur border-b px-4 py-2">
                <h3 className="text-lg font-semibold text-slate-700">
                  {col.label}{" "}
                  <span className="ml-1 text-slate-400 text-sm">
                    ({items.length})
                  </span>
                </h3>
              </header>

              <div className="flex-1 overflow-hidden">
                <div
                  className="h-full overflow-y-auto px-3 pr-4 pt-3 pl-2 pb-5 space-y-3"
                  style={{
                    scrollbarGutter: "stable both-edges",
                    WebkitOverflowScrolling: "touch",
                    overscrollBehavior: "contain",
                  }}
                >
                  {!items.length && (
                    <div className="text-sm text-slate-500 px-2 py-6 text-center">
                      No tasks here yet.
                    </div>
                  )}

                  {items.map((t: any) => {
                    const overdue = isOverdue(t);
                    const soon = isDueSoon(t);
                    const title = (t.title || "").trim() || "Untitled task";
                    const isOpen = !!expanded[t.id];

                    const openDetails = () => openTaskModal(t);

                    return (
                      <article
                        key={t.id}
                        className={`rounded-xl border bg-white shadow-sm transition overflow-hidden ${
                          isMine(t) ? "ring-2 ring-indigo-300" : "hover:shadow-md"
                        }`}
                      >
                        {/* HEADER (compact) */}
                        <button
                          className="w-full flex items-start gap-2 px-3 py-2 text-left"
                          onClick={() => toggle(t.id)}
                          aria-expanded={isOpen}
                        >
                          <span
                            className="inline-flex h-5 w-5 items-center justify-center rounded-md border text-xs bg-white shrink-0"
                            aria-hidden
                          >
                            {isOpen ? "▲" : "▼"}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold leading-snug break-words">
                                {title}
                              </h4>
                              {overdue && (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                  Overdue
                                </span>
                              )}
                              {!overdue && soon && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                  Due soon
                                </span>
                              )}
                            </div>

                            {t.dueDate && (
                              <div className="mt-0.5 text-xs">
                                <span className="font-medium text-slate-600">
                                  Due:
                                </span>{" "}
                                <span
                                  className={
                                    overdue
                                      ? "text-rose-700 font-medium"
                                      : soon
                                      ? "text-amber-700 font-medium"
                                      : "text-slate-700"
                                  }
                                >
                                  {dayjs(t.dueDate).format(
                                    "MMM D, YYYY HH:mm"
                                  )}
                                </span>
                              </div>
                            )}
                          </div>
                        </button>

                        {/* BODY (click anywhere to open modal, except controls) */}
                        {isOpen && (
                          <div
                            className="px-4 pb-4 pt-2 border-t cursor-pointer"
                            onClick={(e) => {
                              const tag = (e.target as HTMLElement)
                                .tagName.toLowerCase();
                              if (
                                [
                                  "button",
                                  "select",
                                  "input",
                                  "textarea",
                                  "option",
                                  "a",
                                  "label",
                                ].includes(tag)
                              )
                                return;
                              openDetails();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ")
                                openDetails();
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            {/* Description */}
                            {t.description && (
                              <p className="text-sm text-slate-700 whitespace-pre-wrap break-words mb-2">
                                {t.description}
                              </p>
                            )}

                            {/* Status + Edit/Delete */}
                            <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] items-center mb-3">
                              <select
                                className="select w-full"
                                defaultValue={t.status}
                                onChange={(e) =>
                                  updateStatus(
                                    t.id,
                                    e.target.value as StatusKey
                                  )
                                }
                                title="Update status"
                                onClick={stop}
                              >
                                {STATUS.map((s) => (
                                  <option key={s.key} value={s.key}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>

                              {perms?.canWriteAll && (
                                <>
                                  <button
                                    className="btn-outline"
                                    title="Edit"
                                    onClick={(e) => {
                                      stop(e);
                                      openDetails();
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="btn-outline"
                                    title="Delete"
                                    onClick={(e) => {
                                      stop(e);
                                      deleteTask(t.id);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>

                            {/* Assigned */}
                            <div className="text-sm text-slate-700 mb-2">
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
                                          onClick={(e) => {
                                            stop(e);
                                            unassign(t.id, a.userId);
                                          }}
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
                              <div className="grid gap-2 mb-3">
                                <select
                                  className="select w-full"
                                  value={assignPick[t.id] || ""}
                                  onChange={(e) =>
                                    setAssignPick((s) => ({
                                      ...s,
                                      [t.id]: e.target.value,
                                    }))
                                  }
                                  onClick={stop}
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
                                <button
                                  className="btn w-full"
                                  onClick={(e) => {
                                    stop(e);
                                    assign(t.id);
                                  }}
                                >
                                  Assign
                                </button>
                              </div>
                            )}

                            {/* Notes */}
                            <div className="mt-2">
                              <div className="font-medium mb-1">
                                Notes ({t.notes?.length || 0})
                              </div>
                              <div className="space-y-2 max-h-40 overflow-auto pr-1">
                                {t.notes?.length ? (
                                  t.notes.map((n: any) => (
                                    <div
                                      key={n.id}
                                      className="note text-sm"
                                      onClick={stop}
                                    >
                                      {highlightMentions(n.content)}
                                      <div className="text-xs text-slate-500 mt-1">
                                        {dayjs(n.createdAt).format(
                                          "MMM D, HH:mm"
                                        )}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-xs text-slate-500">
                                    No notes yet.
                                  </div>
                                )}
                              </div>

                              <div className="mt-2 grid gap-2">
                                <input
                                  className="input w-full"
                                  placeholder="Add note (use @handle)"
                                  value={noteText[t.id] || ""}
                                  onChange={(e) =>
                                    setNoteText((s) => ({
                                      ...s,
                                      [t.id]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) =>
                                    e.key === "Enter" && addNote(t.id)
                                  }
                                  onClick={stop}
                                />
                                <button
                                  className="btn w-full"
                                  onClick={(e) => {
                                    stop(e);
                                    addNote(t.id);
                                  }}
                                >
                                  Post
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {modalOpen && modalTask && (
        <TaskModal
          task={modalTask}
          teamId={teamId}
          perms={perms}
          members={members}
          onClose={closeTaskModal}
        />
      )}
    </>
  );
}


/* ============================== DEADLINES =============================== */

type CalView = "day" | "week" | "month" | "year";

function DeadlinesTab({ teamId }: { teamId: string }) {
  // const qc = useQueryClient();

  const { data: perms } = useQuery<Perms>({
    queryKey: ["perms", teamId],
    queryFn: async()=> (await api.get(`/teams/${teamId}/permissions`)).data,
    enabled: !!teamId
  });

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

  const [view, setView] = useState<CalView>("month");
  const [cursor, setCursor] = useState<dayjs.Dayjs>(dayjs());

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [filterAssignee, setFilterAssignee] = useState<string>("ALL");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [filterSoon, setFilterSoon] = useState(false);

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

  const [open, setOpen] = useState(false);
  const [activeTask, setActiveTask] = useState<any | null>(null);

  function openModal(task: any) { setActiveTask(task); setOpen(true); }
  function closeModal() { setOpen(false); setActiveTask(null); }

  const filterCount =
    (onlyMine ? 1 : 0) +
    (filterText ? 1 : 0) +
    (filterAssignee !== "ALL" ? 1 : 0) +
    (filterFrom ? 1 : 0) +
    (filterTo ? 1 : 0) +
    (filterOverdue ? 1 : 0) +
    (filterSoon ? 1 : 0);

  const calRef = useRef<HTMLDivElement>(null);
  const calH = useFitToViewport(calRef, 24);

  return (
    <div className="space-y-4">
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

      <section
        ref={calRef}
        className="rounded-2xl border bg-white shadow-sm overflow-hidden"
        style={{ height: calH }}
      >
        <div
          className="h-full overflow-auto p-3"
          style={{ scrollbarGutter: "stable both-edges", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
        >
          {view === "day"   && <DayGrid   date={cursor} events={deadlines} onPick={t=>openModal(t)} />}
          {view === "week"  && <WeekGrid  date={cursor} events={deadlines} onPick={t=>openModal(t)} />}
          {view === "month" && <MonthGrid date={cursor} events={deadlines} onPick={t=>openModal(t)} />}
          {view === "year"  && <YearGrid  date={cursor} events={deadlines} onPick={t=>openModal(t)} />}
        </div>
      </section>

      {open && activeTask && (
        <TaskModal
          task={activeTask}
          teamId={teamId}
          perms={perms}
          members={members}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

/* Calendar renderers (unchanged, but using calChipClasses/dayCardClasses) */

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
          const dayEvents = events.filter((e:any)=> d.isSame(dayjs(e.startAt), "day")).slice(0,4);
          const muted = d.month()!==date.month();
          return (
            <div key={d.toString()} className={`border rounded-xl p-2 min-h-[96px] ${muted?"bg-slate-50 text-slate-400":""}`}>
              <div className="text-xs font-medium">{d.date()}</div>
              <div className="mt-1 space-y-1">
                {dayEvents.map((e:any)=>(
                  <button
                    key={e.id}
                    className={calChipClasses(e.task)}
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
                  className={calChipClasses(e.task)}
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
          className={dayCardClasses(e.task)}
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

  const { data: team } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}`)).data,
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

  const saveInfo = useMutation({
    mutationFn: async (info: string) => (await api.patch(`/teams/${teamId}/info`, { info })).data,
    onSuccess: () => refetchInfo()
  });

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

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{userId:string; label:string} | null>(null);

  // …above where you build options:
type Option = { userId: string; label: string };

// Build the dropdown options with an explicit type
const options: Option[] = (orgMembers ?? []).map((m: any): Option => ({
  userId: String(m.userId),
  label: `${m.name || m.handle || m.userId}  ·  @${m.handle || m.userId}`,
}));

// Filtered list is also explicitly typed
const filtered: Option[] = query.trim()
  ? options.filter((o: Option) =>
      o.label.toLowerCase().includes(query.trim().toLowerCase())
    )
  : options;

function pick(o: Option) {
  setSelected(o);
  setQuery(o.label);
  setOpen(false);
}


  return (
    <div className="space-y-6">
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

      <div className="card relative">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Team members</h3>

          {perms?.canWriteAll && (
            <div className="w-full max-w-md flex gap-2">
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

function ActivityTab({ teamId }: { teamId: string }) {
  const { data: members } = useQuery({
    queryKey: ["members", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/members`)).data,
    enabled: !!teamId,
  });

  // Filters
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "all">("7d");
  
  const [userId, setUserId] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
const [activeTask, setActiveTask] = useState<any | null>(null);

function closeModal() {
  setModalOpen(false);
  setActiveTask(null);
}
const { data: perms } = useQuery<Perms>({
    queryKey: ["perms", teamId],
    queryFn: async () => (await api.get(`/teams/${teamId}/permissions`)).data,
    enabled: !!teamId,
  });
async function openFromActivity(row: ActivityRow) {
  if (!row.taskId) return;
  try {
    const res = await api.get(`/tasks/${row.taskId}`); // uses the new GET /tasks/:taskId
    setActiveTask(res.data);
    setModalOpen(true);
  } catch (e: any) {
    // If the task was deleted (cascade), the log is gone too on new fetches,
    // but if the UI still has a stale row: show a lightweight notice.
    alert("Task no longer exists or you don't have access.");
  }
}


  const { startISO, endISO } = useMemo(() => {
    if (range === "all") return { startISO: undefined, endISO: undefined };
    const end = dayjs();
    const start =
      range === "7d"  ? end.subtract(7, "day") :
      range === "30d" ? end.subtract(30, "day") :
      end.subtract(90, "day");
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }, [range]);

  const params: Record<string, string> = {};
  if (startISO) params.from = startISO;
  if (endISO) params.to = endISO;
  if (userId !== "ALL") params.userId = userId;
  if (q.trim()) params.q = q.trim();

  

  if (startISO) params.from = startISO;
  if (endISO) params.to = endISO;
  if (userId !== "ALL") params.userId = userId;
  if (q.trim()) params.q = q.trim();

  const qs = new URLSearchParams(params).toString();
  const url = `/teams/${teamId}/activity${qs ? `?${qs}` : ""}`;

  const { data = [], isLoading } = useQuery<ActivityRow[]>({
    queryKey: ["activity", teamId, qs], // use string, not object, for stability
    queryFn: async () => {
      const res = await api.get(url);
      return normalizeActivityPayload(res.data);
    },
    enabled: !!teamId,
  });


// group by day (desc)
const grouped = useMemo(() => {
  const rows = (Array.isArray(data) ? data : []).slice().sort(
    (a, b) => dayjs(b.changedAt).valueOf() - dayjs(a.changedAt).valueOf()
  );
  const map = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const k = dayjs(r.changedAt).format("YYYY-MM-DD");
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
}, [data]);


  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="rounded-2xl border bg-white shadow-sm p-3 flex flex-wrap items-center gap-2">
        <select className="select" value={range} onChange={e=>setRange(e.target.value as any)}>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>

        <input
          className="input md:w-64"
          placeholder="Search task/user…"
          value={q}
          onChange={e=>setQ(e.target.value)}
        />

        <select className="select" value={userId} onChange={e=>setUserId(e.target.value)}>
          <option value="ALL">All users</option>
          {(members || []).map((m:any)=>(
            <option key={m.userId} value={m.userId}>
              {m.name || m.handle || m.userId}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="rounded-2xl border bg-white shadow-sm">
        {isLoading ? (
          <div className="p-4 text-sm text-slate-500">Loading…</div>
        ) : !grouped.length ? (
          <div className="p-4 text-sm text-slate-500">No activity in this range.</div>
        ) : (
          <ul className="divide-y">
            {grouped.map(([day, rows]) => (
              <li key={day} className="p-4">
                <div className="text-xs font-semibold text-slate-600 mb-2">
                  {dayjs(day).format("dddd, MMM D, YYYY")}
                </div>
                <div className="space-y-2">
                  {rows.map(r => (
  <button
    key={r.id}
    className="w-full text-left flex items-start gap-3 hover:bg-slate-50 rounded-lg px-2 py-1"
    onClick={() => openFromActivity(r)}
    title={r.link || `Open ${r.taskTitle}`}
  >
    <div className="mt-1 h-2 w-2 rounded-full bg-slate-300 shrink-0" />
    <div className="min-w-0">
      <div className="text-sm">
        <span className="font-medium">
          {r.changedBy?.name || r.changedBy?.handle || r.changedBy?.id || "Someone"}
        </span>{" "}
        moved{" "}
        <span className="font-medium underline">{r.taskTitle}</span>{" "}
        {r.oldStatus ? (
          <>
            from <span className="font-medium">{STATUS_LABEL[r.oldStatus]}</span> to{" "}
          </>
        ) : (
          <>to </>
        )}
        <span className="font-medium">{STATUS_LABEL[r.newStatus]}</span>
      </div>
      <div className="text-xs text-slate-500">
        {dayjs(r.changedAt).format("HH:mm")}
      </div>
    </div>
  </button>
))}

                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {modalOpen && activeTask && (
  <TaskModal
    task={activeTask}
    teamId={teamId}
    perms={perms}
    members={members}
    onClose={closeModal}
  />
)}

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

