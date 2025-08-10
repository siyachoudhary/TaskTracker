import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import passport from "./sso";
import { env } from "./env";
import { prisma } from "./prisma";
import { issueJwt, auth } from "./auth";
import { randomBytes } from "crypto";

const app = express();

/* ------------------------------ Middleware ------------------------------ */
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());
app.use(auth);

if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });
}

/* --------------------------------- Auth --------------------------------- */
// Google SSO (Passport) — login only
app.get("/auth/google/start", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get(
  "/auth/google/callback",
  passport.authenticate("google", { session: false }),
  (req: any, res) => {
    const token = issueJwt(req.user.id);
    res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
    res.redirect(env.CLIENT_URL);
  }
);

app.post("/auth/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

/* ------------------------------- Helpers -------------------------------- */
async function requireOrgRole(orgId: string, userId: string, roles: ("ADMIN" | "MEMBER")[]) {
  const m = await prisma.orgMembership.findUnique({ where: { orgId_userId: { orgId, userId } } });
  return !!m && roles.includes(m.role as any);
}
async function requireTeamRole(teamId: string, userId: string, roles: ("LEADER" | "MEMBER")[]) {
  const m = await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } } });
  return !!m && roles.includes(m.role as any);
}
function requireUser(req: any, res: any) {
  if (!req.user?.sub) { res.sendStatus(401); return null; }
  return String(req.user.sub);
}
async function isOrgAdmin(orgId: string, userId: string) { return await requireOrgRole(orgId, userId, ["ADMIN"]); }
async function isTeamLeader(teamId: string, userId: string) {
  const m = await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } } });
  return !!m && m.role === "LEADER";
}
async function canReadTeam(teamId: string, userId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return false;
  if (await isOrgAdmin(team.orgId, userId)) return true;
  const m = await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } } });
  return !!m;
}
async function canWriteTeam(teamId: string, userId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return false;
  if (await isOrgAdmin(team.orgId, userId)) return true;
  return await isTeamLeader(teamId, userId);
}
function randCode(len = 12) {
  const bytes = randomBytes(len);
  let out = ""; for (let i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
  return out;
}

/* ----------------------------------- Me --------------------------------- */
app.get("/me", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const user = await prisma.user.findUnique({
    where: { id: uid },
    include: {
      memberships: { include: { org: true } },
      teamMemberships: { include: { team: true } },
    },
  });
  res.json(user);
});

/* ---------------------------- Orgs & Teams ------------------------------ */
app.post("/orgs", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const org = await prisma.organization.create({
    data: { name: req.body.name, createdBy: uid, memberships: { create: { userId: uid, role: "ADMIN" } } },
  });
  res.json(org);
});
app.get("/orgs", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const orgs = await prisma.organization.findMany({ where: { memberships: { some: { userId: uid } } } });
  res.json(orgs);
});
app.post("/orgs/:orgId/teams", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"]))) return res.sendStatus(403);
  const team = await prisma.team.create({
    data: { orgId, name: req.body.name, createdBy: uid, memberships: { create: { userId: uid, role: "LEADER" } } },
  });
  res.json(team);
});
app.get("/orgs/:orgId/teams", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN","MEMBER"]))) return res.sendStatus(403);
  if (await isOrgAdmin(orgId, uid)) return res.json(await prisma.team.findMany({ where: { orgId } }));
  const teams = await prisma.team.findMany({ where: { orgId, memberships: { some: { userId: uid } } } });
  res.json(teams);
});

/* ------------------------- Team members & perms ------------------------- */
app.get("/teams/:teamId/members", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  if (!(await canReadTeam(teamId, uid))) return res.sendStatus(403);
  const members = await prisma.teamMembership.findMany({
    where: { teamId }, include: { user: true }, orderBy: { role: "desc" }
  });
  res.json(members.map(m => ({ userId: m.userId, handle: m.user.handle, name: m.user.name, role: m.role })));
});
app.get("/teams/:teamId/permissions", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin  = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  const member = !!(await prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: uid } } }));
  if (!(admin || leader || member)) return res.sendStatus(403);
  res.json({ role: admin ? "ADMIN" : leader ? "LEADER" : "MEMBER", canCreateTasks: admin || leader, canAssign: admin || leader, canWriteAll: admin || leader });
});

/* ---------------------------- Org Join Codes ---------------------------- */
app.post("/orgs/:orgId/join-codes", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"]))) return res.sendStatus(403);
  const [, latest] = await prisma.$transaction([
    prisma.orgJoinCode.deleteMany({ where: { orgId } }),
    prisma.orgJoinCode.create({ data: { orgId, code: randCode(12), expiresAt: req.body.expiresAt ?? null, maxUses: req.body.maxUses ?? null } })
  ]);
  res.json(latest);
});
app.get("/orgs/:orgId/join-codes", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"]))) return res.sendStatus(403);
  const current = await prisma.orgJoinCode.findFirst({ where: { orgId }, orderBy: { createdAt: 'desc' } });
  res.json(current ? [current] : []);
});
app.post("/orgs/join", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { code } = req.body as { code: string };
  const jc = await prisma.orgJoinCode.findUnique({ where: { code }, include: { org: true } });
  if (!jc) return res.status(400).json({ error: "invalid" });
  if (jc.expiresAt && new Date() > jc.expiresAt) return res.status(400).json({ error: "expired" });
  if (jc.maxUses && jc.uses >= jc.maxUses) return res.status(400).json({ error: "exhausted" });
  await prisma.orgMembership.upsert({ where: { orgId_userId: { orgId: jc.orgId, userId: uid } }, update: {}, create: { orgId: jc.orgId, userId: uid, role: "MEMBER" } });
  await prisma.orgJoinCode.update({ where: { id: jc.id }, data: { uses: { increment: 1 } } });
  res.json({ ok: true, orgId: jc.orgId });
});

/* ----------------------------- Team CRUD bits --------------------------- */
app.delete("/teams/:teamId", async (req: any, res: any, next: any) => {
  try {
    const uid = requireUser(req, res); if (!uid) return;
    const { teamId } = req.params;
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return res.sendStatus(404);
    if (!(await requireOrgRole(team.orgId, uid, ["ADMIN"]))) return res.sendStatus(403);

    const tasks = await prisma.task.findMany({ where: { teamId }, select: { id: true } });
    const taskIds = tasks.map(t => t.id);
    const notes = taskIds.length ? await prisma.taskNote.findMany({ where: { taskId: { in: taskIds } }, select: { id: true } }) : [];
    const noteIds = notes.map(n => n.id);

    const ops: any[] = [];
    if (noteIds.length) ops.push(prisma.taskNoteMention.deleteMany({ where: { noteId: { in: noteIds } } }));
    if (taskIds.length) ops.push(prisma.taskNote.deleteMany({ where: { taskId: { in: taskIds } } }));
    if (taskIds.length) ops.push(prisma.taskAssignment.deleteMany({ where: { taskId: { in: taskIds } } }));
    ops.push(prisma.task.deleteMany({ where: { teamId } }));
    ops.push(prisma.goal.deleteMany({ where: { teamId } }));
    ops.push(prisma.teamJoinCode.deleteMany({ where: { teamId } }));
    ops.push(prisma.teamMembership.deleteMany({ where: { teamId } }));
    ops.push(prisma.team.delete({ where: { id: teamId } }));

    await prisma.$transaction(ops);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
app.delete("/teams/:teamId/members/:userId", async (req:any, res)=>{
  const uid = requireUser(req,res); if(!uid) return;
  const { teamId, userId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if(!team) return res.sendStatus(404);
  const can = (await requireOrgRole(team.orgId, uid, ["ADMIN"])) || (await requireTeamRole(teamId, uid, ["LEADER"]));
  if(!can) return res.sendStatus(403);
  await prisma.teamMembership.delete({ where: { teamId_userId: { teamId, userId } } }).catch(()=>{});
  res.json({ ok: true });
});
app.get("/teams/:teamId", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  if (!(await canReadTeam(teamId, uid))) return res.sendStatus(403);
  res.json({ id: team.id, name: team.name, orgId: team.orgId });
});
app.patch("/teams/:teamId", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin  = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "invalid_name" });
  const updated = await prisma.team.update({ where: { id: teamId }, data: { name } });
  res.json(updated);
});
app.post("/teams/:teamId/members", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params; const { userId } = req.body as { userId: string };
  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { org: true } });
  if (!team) return res.sendStatus(404);
  if (!(await requireOrgRole(team.orgId, uid, ["ADMIN"]))) return res.sendStatus(403);
  await prisma.orgMembership.upsert({ where: { orgId_userId: { orgId: team.orgId, userId } }, update: {}, create: { orgId: team.orgId, userId, role: "MEMBER" } });
  const m = await prisma.teamMembership.upsert({ where: { teamId_userId: { teamId, userId } }, update: { role: "MEMBER" }, create: { teamId, userId, role: "MEMBER" } });
  res.json(m);
});
app.post("/teams/:teamId/leader", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params; const { userId } = req.body as { userId: string };
  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { org: true } });
  if (!team) return res.sendStatus(404);
  if (!(await requireOrgRole(team.orgId, uid, ["ADMIN"]))) return res.sendStatus(403);
  await prisma.orgMembership.upsert({ where: { orgId_userId: { orgId: team.orgId, userId } }, update: {}, create: { orgId: team.orgId, userId, role: "MEMBER" } });
  const m = await prisma.teamMembership.upsert({ where: { teamId_userId: { teamId, userId } }, update: { role: "LEADER" }, create: { teamId, userId, role: "LEADER" } });
  res.json(m);
});

/* --------------------------------- Tasks -------------------------------- */
app.get("/teams/:teamId/tasks", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  if (!(await canReadTeam(teamId, uid))) return res.sendStatus(403);
  const tasks = await prisma.task.findMany({
    where: { teamId },
    include: { assignees: { include: { user: { select: { id: true, name: true, handle: true } } } }, notes: true }
  });
  res.json(tasks);
});
app.post("/teams/:teamId/tasks", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  if (!(await canWriteTeam(teamId, uid))) return res.sendStatus(403);
  const t = await prisma.task.create({
    data: { teamId, title: req.body.title, description: req.body.description ?? null, dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null, priority: req.body.priority ?? "MEDIUM", createdBy: uid }
  });
  res.json(t);
});
app.patch("/tasks/:taskId", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const task = await prisma.task.findUnique({ where: { id: req.params.taskId }, include: { team: true, assignees: true } });
  if (!task) return res.sendStatus(404);
  const adminOrLeader = await canWriteTeam(task.teamId, uid);
  if (!adminOrLeader) {
    const isAssignee = task.assignees.some(a => a.userId === uid);
    const onlyStatus = Object.keys(req.body).every(k => k === "status");
    if (!(isAssignee && onlyStatus)) return res.sendStatus(403);
  }
  const updated = await prisma.task.update({ where: { id: task.id }, data: req.body });
  res.json(updated);
});
app.post("/tasks/:taskId/assignees", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const task = await prisma.task.findUnique({ where: { id: req.params.taskId }, include: { team: true } });
  if (!task) return res.sendStatus(404);
  if (!(await canWriteTeam(task.teamId, uid))) return res.sendStatus(403);
  const row = await prisma.taskAssignment.upsert({
    where: { taskId_userId: { taskId: task.id, userId: req.body.userId } },
    update: {},
    create: { taskId: task.id, userId: req.body.userId }
  });
  res.json(row);
});
app.delete("/tasks/:taskId/assignees/:userId", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { taskId, userId } = req.params;
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { team: true } });
  if (!task) return res.sendStatus(404);
  if (!(await canWriteTeam(task.teamId, uid))) return res.sendStatus(403);
  await prisma.taskAssignment.deleteMany({ where: { taskId, userId } });
  res.json({ ok: true });
});
// Delete a task (admins/leaders only)
app.delete("/tasks/:taskId", async (req: any, res: any, next: any) => {
  try {
    const uid = requireUser(req, res); if (!uid) return;

    const task = await prisma.task.findUnique({
      where: { id: req.params.taskId },
      include: { team: true },
    });
    if (!task) return res.sendStatus(404);

    // Only org ADMIN or team LEADER may delete tasks
    const can = await canWriteTeam(task.teamId, uid);
    if (!can) return res.sendStatus(403);

    // Cascade deletes: mentions -> notes -> assignments -> calendar events -> task
    const notes = await prisma.taskNote.findMany({
      where: { taskId: task.id },
      select: { id: true },
    });
    const noteIds = notes.map(n => n.id);

    await prisma.$transaction([
      prisma.taskNoteMention.deleteMany({ where: { noteId: { in: noteIds } } }),
      prisma.taskNote.deleteMany({ where: { taskId: task.id } }),
      prisma.taskAssignment.deleteMany({ where: { taskId: task.id } }),
      prisma.calendarEvent.deleteMany({ where: { relatedTaskId: task.id } }),
      prisma.task.delete({ where: { id: task.id } }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- Notes & Info ------------------------------ */
app.post("/tasks/:taskId/notes", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (!task) return res.sendStatus(404);
  const ok = (await requireTeamRole(task.teamId, uid, ["LEADER", "MEMBER"])) || (await canWriteTeam(task.teamId, uid));
  if (!ok) return res.sendStatus(403);
  const content: string = req.body.content ?? "";
  const handles = Array.from(content.matchAll(/@([a-zA-Z0-9_.~-]{2,30})/g)).map(m => m[1]);
  const users = handles.length ? await prisma.user.findMany({ where: { handle: { in: handles } } }) : [];
  const note = await prisma.taskNote.create({
    data: { taskId: task.id, authorId: uid, content, mentions: { create: users.map(u => ({ userId: u.id })) } },
    include: { mentions: true }
  });
  res.json(note);
});

/* ---------------- Team info + links ---------------- */
app.get("/teams/:teamId/info", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  if (!(await canReadTeam(teamId, uid))) return res.sendStatus(403);
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, info: true, links: { orderBy: { ordinal: "asc" } } }
  });
  if (!team) return res.sendStatus(404);
  res.json(team);
});
app.patch("/teams/:teamId/info", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin  = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  const info = typeof req.body?.info === "string" ? req.body.info : null;
  const updated = await prisma.team.update({ where: { id: teamId }, data: { info } });
  res.json({ ok: true, info: updated.info });
});
app.post("/teams/:teamId/links", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin  = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  const { label, url } = req.body as { label: string; url: string };
  if (!label || !url) return res.status(400).json({ error: "label_and_url_required" });
  const max = await prisma.teamLink.aggregate({ where: { teamId }, _max: { ordinal: true } });
  const link = await prisma.teamLink.create({ data: { teamId, label, url, ordinal: (max._max.ordinal ?? 0) + 1 } });
  res.json(link);
});
app.patch("/teams/:teamId/links/:linkId", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId, linkId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin  = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  const { label, url, ordinal } = req.body as Partial<{ label: string; url: string; ordinal: number }>;
  const updated = await prisma.teamLink.update({
    where: { id: linkId },
    data: { ...(typeof label === "string" ? { label } : {}), ...(typeof url === "string" ? { url } : {}), ...(typeof ordinal === "number" ? { ordinal } : {}) }
  });
  res.json(updated);
});
app.delete("/teams/:teamId/links/:linkId", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId, linkId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin  = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  await prisma.teamLink.delete({ where: { id: linkId } });
  res.json({ ok: true });
});

/* ----------------------------- Calendar API ----------------------------- */
// (Pure app DB calendar — no Google sync)
app.get("/teams/:teamId/calendar", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const allowed = (await requireTeamRole(teamId, uid, ["LEADER", "MEMBER"])) || (await requireOrgRole(team.orgId, uid, ["ADMIN"]));
  if (!allowed) return res.sendStatus(403);
  const events = await prisma.calendarEvent.findMany({ where: { teamId } });
  res.json(events);
});

app.post("/teams/:teamId/calendar", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId } = req.params;
  if (!(await canWriteTeam(teamId, uid))) return res.sendStatus(403);

  const { title, startAt, endAt, relatedTaskId, description, type } = req.body;

  const created = await prisma.calendarEvent.create({
    data: {
      teamId,
      title,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      description: description ?? null,
      relatedTaskId: relatedTaskId ?? null,
      type: type === "TASK" ? "TASK" : "EVENT",
    } as any,
  });

  res.json(created);
});

app.patch("/teams/:teamId/calendar/:eventId", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId, eventId } = req.params;
  const { title, description, type, startAt, endAt, durationMinutes } = req.body;

  const ev = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.teamId !== teamId) return res.sendStatus(404);
  const team = await prisma.team.findUnique({ where: { id: teamId } }); if (!team) return res.sendStatus(404);
  const can = (await requireTeamRole(teamId, uid, ["LEADER"])) || (await requireOrgRole(team.orgId, uid, ["ADMIN"]));
  if (!can) return res.sendStatus(403);

  const data: any = {};
  if (typeof title === "string") data.title = title;
  if (typeof description === "string") data.description = description;
  if (type === "TASK" || type === "EVENT") data.type = type;

  if (type === "TASK" || data.type === "TASK") {
    const base = new Date(startAt || ev.startAt);
    const s = new Date(base); s.setHours(0,0,0,0);
    const e = new Date(base); e.setHours(23,59,59,999);
    data.startAt = s; data.endAt = e;
  } else if (type === "EVENT" || data.type === "EVENT") {
    const s = startAt ? new Date(startAt) : ev.startAt;
    let e: Date;
    if (endAt) e = new Date(endAt);
    else if (durationMinutes && durationMinutes > 0) e = new Date(s.getTime() + durationMinutes * 60_000);
    else e = ev.endAt;
    data.startAt = s; data.endAt = e;
  } else {
    if (startAt) data.startAt = new Date(startAt);
    if (endAt) data.endAt = new Date(endAt);
  }

  const updated = await prisma.calendarEvent.update({ where: { id: eventId }, data });
  res.json(updated);
});

app.delete("/teams/:teamId/calendar/:eventId", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { teamId, eventId } = req.params;
  const ev = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.teamId !== teamId) return res.sendStatus(404);
  const team = await prisma.team.findUnique({ where: { id: teamId } }); if (!team) return res.sendStatus(404);
  const can = (await requireTeamRole(teamId, uid, ["LEADER"])) || (await requireOrgRole(team.orgId, uid, ["ADMIN"]));
  if (!can) return res.sendStatus(403);
  await prisma.calendarEvent.delete({ where: { id: eventId } });
  res.json({ ok: true });
});

/* ------------------------ 404 & Error middleware ------------------------ */
app.use((req, res) => { res.status(404).json({ error: "not_found" }); });
app.use((err: any, _req: any, res: any, _next: any) => { console.error(err); res.status(500).json({ error: "server_error" }); });

/* -------------------------------- Listen -------------------------------- */
app.listen(4000, () => console.log("API running on http://localhost:4000"));