// api/src/server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";

import passport from "./sso";
import { env as appEnv } from "./env";
import { prisma } from "./prisma";
import { issueJwt, auth } from "./auth";
import { randomBytes } from "crypto";

/* ------------------------------------------------------------------ */
/* Environment helpers                                                */
/* ------------------------------------------------------------------ */

const corsCsv = String(
  process.env.CORS_ORIGINS ??
    (appEnv as any).CORS_ORIGINS ??
    process.env.CLIENT_URL ??
    (appEnv as any).CLIENT_URL ??
    ""
);

const ENV = {
  NODE_ENV: process.env.NODE_ENV || appEnv.NODE_ENV || "development",
  PORT: Number(process.env.PORT || appEnv.PORT || 4000),
  CORS_ORIGINS: corsCsv.split(",").map((s: string) => s.trim()).filter(Boolean),
  CLIENT_URL:
    process.env.CLIENT_URL || (appEnv as any).CLIENT_URL || "http://localhost:5173",
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || (appEnv as any).COOKIE_DOMAIN || "",
};


const IS_PROD = ENV.NODE_ENV === "production";

/** Build consistent cookie options (used for set + clear). */
function cookieOpts() {
  return {
    httpOnly: true,
    secure: IS_PROD, // required for SameSite=None
    sameSite: IS_PROD ? ("none" as const) : ("lax" as const),
    domain: ENV.COOKIE_DOMAIN || undefined,
    path: "/",
  };
}

/* ------------------------------------------------------------------ */
/* App setup                                                          */
/* ------------------------------------------------------------------ */

const app = express();

// behind Nginx/ALB so trust x-forwarded-* to get correct protocol/ips
app.set("trust proxy", 1);

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
if (!IS_PROD) app.use(morgan("dev"));
else app.use(morgan("combined"));

/** CORS (allow list) */
const allowlist = new Set(ENV.CORS_ORIGINS);
app.use(
  cors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // allow non-browser/health/curl (no Origin header) and exact allowlisted origins
      if (!origin || allowlist.has(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true, // you set/clear a cookie called "token"
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// auth bootstrap
app.use(passport.initialize());
app.use(auth);

/* ------------------------------------------------------------------ */
/* Health                                                             */
/* ------------------------------------------------------------------ */

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, env: ENV.NODE_ENV });
});

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */

app.get(
  "/auth/google/start",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { session: false }),
  (req: any, res) => {
    const token = issueJwt(req.user.id);
    res.cookie("token", token, cookieOpts());
    res.redirect(ENV.CLIENT_URL);
  }
);

app.post("/auth/logout", (_req, res) => {
  // use same options to ensure the browser removes the exact cookie
  res.clearCookie("token", cookieOpts());
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
async function requireOrgRole(
  orgId: string,
  userId: string,
  roles: ("ADMIN" | "MEMBER")[]
) {
  const m = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  return !!m && roles.includes(m.role as any);
}
async function requireTeamRole(
  teamId: string,
  userId: string,
  roles: ("LEADER" | "MEMBER")[]
) {
  const m = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  return !!m && roles.includes(m.role as any);
}
function requireUser(req: any, res: any) {
  if (!req.user?.sub) {
    res.sendStatus(401);
    return null;
  }
  return String(req.user.sub);
}
async function isOrgAdmin(orgId: string, userId: string) {
  return await requireOrgRole(orgId, userId, ["ADMIN"]);
}
async function isTeamLeader(teamId: string, userId: string) {
  const m = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  return !!m && m.role === "LEADER";
}
async function canReadTeam(teamId: string, userId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return false;
  if (await isOrgAdmin(team.orgId, userId)) return true;
  const m = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
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
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
  return out;
}

/* ------------------------------------------------------------------ */
/* Me                                                                 */
/* ------------------------------------------------------------------ */

// server.ts (/me route)
app.get("/me", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;

  const user = await prisma.user.findUnique({
    where: { id: uid },
    include: {
      memberships: { include: { org: true } },
      teamMemberships: { include: { team: true } },
    },
  });

  if (!user) {
    // user row is gone -> kill app session and force re-auth
    res.clearCookie("token", cookieOpts());
    return res.sendStatus(401);
  }

  res.json(user);
});


/* ------------------------------------------------------------------ */
/* Orgs & Teams                                                       */
/* ------------------------------------------------------------------ */

app.post("/orgs", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const org = await prisma.organization.create({
    data: {
      name: req.body.name,
      createdBy: uid,
      memberships: { create: { userId: uid, role: "ADMIN" } },
    },
  });
  res.json(org);
});

app.get("/orgs", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const orgs = await prisma.organization.findMany({
    where: { memberships: { some: { userId: uid } } },
  });
  res.json(orgs);
});

app.post("/orgs/:orgId/teams", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"]))) return res.sendStatus(403);
  const team = await prisma.team.create({
    data: {
      orgId,
      name: req.body.name,
      createdBy: uid,
      memberships: { create: { userId: uid, role: "LEADER" } },
    },
  });
  res.json(team);
});

app.get("/orgs/:orgId/teams", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN", "MEMBER"])))
    return res.sendStatus(403);
  if (await isOrgAdmin(orgId, uid))
    return res.json(await prisma.team.findMany({ where: { orgId } }));
  const teams = await prisma.team.findMany({
    where: { orgId, memberships: { some: { userId: uid } } },
  });
  res.json(teams);
});

// Rename an organization (ADMIN only)
app.patch("/orgs/:orgId", async (req: any, res) => {
  const uid = requireUser(req, res); if (!uid) return;
  const { orgId } = req.params;

  // Only org admins can rename
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"]))) return res.sendStatus(403);

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "invalid_name" });

  const updated = await prisma.organization.update({ where: { id: orgId }, data: { name } })
    .catch(() => null);

  if (!updated) return res.sendStatus(404);
  // return a minimal shape the client can use
  res.json({ id: updated.id, name: updated.name });
});

/* ------------------------------------------------------------------ */
/* Team members & perms                                               */
/* ------------------------------------------------------------------ */

app.get("/teams/:teamId/members", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  if (!(await canReadTeam(teamId, uid))) return res.sendStatus(403);
  const members = await prisma.teamMembership.findMany({
    where: { teamId },
    include: { user: true },
    orderBy: { role: "desc" },
  });
  res.json(
    members.map((m) => ({
      userId: m.userId,
      handle: m.user.handle,
      name: m.user.name,
      role: m.role,
    }))
  );
});

app.get("/teams/:teamId/permissions", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  const member = !!(await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: uid } },
  }));
  if (!(admin || leader || member)) return res.sendStatus(403);
  res.json({
    role: admin ? "ADMIN" : leader ? "LEADER" : "MEMBER",
    canCreateTasks: admin || leader,
    canAssign: admin || leader,
    canWriteAll: admin || leader,
  });
});

/* ------------------------------------------------------------------ */
/* Org Join Codes                                                     */
/* ------------------------------------------------------------------ */

app.post("/orgs/:orgId/join-codes", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"]))) return res.sendStatus(403);
  const [, latest] = await prisma.$transaction([
    prisma.orgJoinCode.deleteMany({ where: { orgId } }),
    prisma.orgJoinCode.create({
      data: {
        orgId,
        code: randCode(12),
        expiresAt: req.body.expiresAt ?? null,
        maxUses: req.body.maxUses ?? null,
      },
    }),
  ]);
  res.json(latest);
});

app.get("/orgs/:orgId/join-codes", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"]))) return res.sendStatus(403);
  const current = await prisma.orgJoinCode.findFirst({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
  res.json(current ? [current] : []);
});

app.post("/orgs/join", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { code } = req.body as { code: string };
  const jc = await prisma.orgJoinCode.findUnique({
    where: { code },
    include: { org: true },
  });
  if (!jc) return res.status(400).json({ error: "invalid" });
  if (jc.expiresAt && new Date() > jc.expiresAt)
    return res.status(400).json({ error: "expired" });
  if (jc.maxUses && jc.uses >= jc.maxUses)
    return res.status(400).json({ error: "exhausted" });
  await prisma.orgMembership.upsert({
    where: { orgId_userId: { orgId: jc.orgId, userId: uid } },
    update: {},
    create: { orgId: jc.orgId, userId: uid, role: "MEMBER" },
  });
  await prisma.orgJoinCode.update({
    where: { id: jc.id },
    data: { uses: { increment: 1 } },
  });
  res.json({ ok: true, orgId: jc.orgId });
});

/* ------------------------------------------------------------------ */
/* Org delete + leave                                                 */
/* ------------------------------------------------------------------ */
app.delete("/me", async (req: any, res: any, next: any) => {
  try {
    const uid = requireUser(req, res);
    if (!uid) return;

    const adminCount = await prisma.orgMembership.count({
      where: { userId: uid, role: "ADMIN" as any },
    });
    if (adminCount > 0) return res.status(400).json({ error: "cannot_delete_admin" });

    const GHOST_USER_ID = process.env.GHOST_USER_ID?.trim();

    const ops: any[] = [
      // --- hard deps that FK back to user ---
      prisma.identity.deleteMany({ where: { userId: uid } }),            // <-- NEW
      // if you have other auth tables, add them too:
      // prisma.session.deleteMany({ where: { userId: uid } }),
      // prisma.apiKey.deleteMany({ where: { userId: uid } }),
      // prisma.notification.deleteMany({ where: { userId: uid } }),

      // app-level relations
      prisma.taskNoteMention.deleteMany({ where: { userId: uid } }),
      prisma.taskAssignment.deleteMany({ where: { userId: uid } }),
      prisma.teamMembership.deleteMany({ where: { userId: uid } }),
      prisma.orgMembership.deleteMany({ where: { userId: uid } }),
      prisma.taskNote.deleteMany({ where: { authorId: uid } }),
    ];

    if (GHOST_USER_ID) {
      // reassign creator fields instead of nulling (for non-null columns)
      ops.push(prisma.task.updateMany({ where: { createdBy: uid }, data: { createdBy: GHOST_USER_ID } }));
      ops.push(prisma.team.updateMany({ where: { createdBy: uid }, data: { createdBy: GHOST_USER_ID } }));
      ops.push(prisma.organization.updateMany({ where: { createdBy: uid }, data: { createdBy: GHOST_USER_ID } }));
    }

    // finally delete the user
    ops.push(prisma.user.delete({ where: { id: uid } }));

    await prisma.$transaction(ops);

    res.clearCookie("token", cookieOpts());
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete("/orgs/:orgId", async (req: any, res: any, next: any) => {
  try {
    const uid = requireUser(req, res);
    if (!uid) return;
    const { orgId } = req.params;

    if (!(await requireOrgRole(orgId, uid, ["ADMIN"])))
      return res.sendStatus(403);
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return res.sendStatus(404);

    const teams = await prisma.team.findMany({
      where: { orgId },
      select: { id: true },
    });
    const teamIds = teams.map((t) => t.id);

    const tasks = teamIds.length
      ? await prisma.task.findMany({
          where: { teamId: { in: teamIds } },
          select: { id: true },
        })
      : [];
    const taskIds = tasks.map((t) => t.id);

    const notes = taskIds.length
      ? await prisma.taskNote.findMany({
          where: { taskId: { in: taskIds } },
          select: { id: true },
        })
      : [];
    const noteIds = notes.map((n) => n.id);

    const ops: any[] = [];
    if (noteIds.length)
      ops.push(
        prisma.taskNoteMention.deleteMany({ where: { noteId: { in: noteIds } } })
      );
    if (taskIds.length)
      ops.push(
        prisma.taskNote.deleteMany({ where: { taskId: { in: taskIds } } })
      );
    if (taskIds.length)
      ops.push(
        prisma.taskAssignment.deleteMany({ where: { taskId: { in: taskIds } } })
      );
    if (teamIds.length)
      ops.push(
        prisma.calendarEvent.deleteMany({ where: { teamId: { in: teamIds } } })
      );
    if (taskIds.length)
      ops.push(prisma.task.deleteMany({ where: { id: { in: taskIds } } }));

    if (teamIds.length)
      ops.push(prisma.goal.deleteMany({ where: { teamId: { in: teamIds } } }));
    if (teamIds.length)
      ops.push(
        prisma.teamLink.deleteMany({ where: { teamId: { in: teamIds } } })
      );
    if (teamIds.length)
      ops.push(
        prisma.teamJoinCode.deleteMany({ where: { teamId: { in: teamIds } } })
      );
    if (teamIds.length)
      ops.push(
        prisma.teamMembership.deleteMany({ where: { teamId: { in: teamIds } } })
      );
    if (teamIds.length)
      ops.push(prisma.team.deleteMany({ where: { id: { in: teamIds } } }));

    ops.push(prisma.orgJoinCode.deleteMany({ where: { orgId } }));
    ops.push(prisma.orgMembership.deleteMany({ where: { orgId } }));
    ops.push(prisma.organization.delete({ where: { id: orgId } }));

    await prisma.$transaction(ops);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function leaveOrgHandler(req: any, res: any) {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId } = req.params;

  const membership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId: uid } },
  });
  if (!membership) return res.sendStatus(404);

  if (membership.role === "ADMIN") {
    return res.status(400).json({ error: "cannot_leave_admin" });
  }

  await prisma.$transaction([
    prisma.teamMembership.deleteMany({ where: { userId: uid, team: { orgId } } }),
    prisma.orgMembership.delete({
      where: { orgId_userId: { orgId, userId: uid } },
    }),
  ]);

  return res.json({ ok: true });
}
app.post("/orgs/:orgId/leave", leaveOrgHandler);
app.delete("/orgs/:orgId/members/me", leaveOrgHandler);
app.delete("/orgs/:orgId/leave", leaveOrgHandler);

/* ------------------------------------------------------------------ */
/* Team CRUD bits                                                     */
/* ------------------------------------------------------------------ */

app.delete("/teams/:teamId", async (req: any, res: any, next: any) => {
  try {
    const uid = requireUser(req, res);
    if (!uid) return;
    const { teamId } = req.params;
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return res.sendStatus(404);
    if (!(await requireOrgRole(team.orgId, uid, ["ADMIN"])))
      return res.sendStatus(403);

    const tasks = await prisma.task.findMany({
      where: { teamId },
      select: { id: true },
    });
    const taskIds = tasks.map((t) => t.id);
    const notes = taskIds.length
      ? await prisma.taskNote.findMany({
          where: { taskId: { in: taskIds } },
          select: { id: true },
        })
      : [];
    const noteIds = notes.map((n) => n.id);

    const ops: any[] = [];
    if (noteIds.length)
      ops.push(
        prisma.taskNoteMention.deleteMany({ where: { noteId: { in: noteIds } } })
      );
    if (taskIds.length)
      ops.push(
        prisma.taskNote.deleteMany({ where: { taskId: { in: taskIds } } })
      );
    if (taskIds.length)
      ops.push(
        prisma.taskAssignment.deleteMany({ where: { taskId: { in: taskIds } } })
      );
    ops.push(prisma.task.deleteMany({ where: { teamId } }));
    ops.push(prisma.goal.deleteMany({ where: { teamId } }));
    ops.push(prisma.teamJoinCode.deleteMany({ where: { teamId } }));
    ops.push(prisma.teamMembership.deleteMany({ where: { teamId } }));
    ops.push(prisma.team.delete({ where: { id: teamId } }));

    await prisma.$transaction(ops);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete("/teams/:teamId/members/:userId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId, userId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const can =
    (await requireOrgRole(team.orgId, uid, ["ADMIN"])) ||
    (await requireTeamRole(teamId, uid, ["LEADER"]));
  if (!can) return res.sendStatus(403);
  await prisma.teamMembership
    .delete({ where: { teamId_userId: { teamId, userId } } })
    .catch(() => {});
  res.json({ ok: true });
});

app.get("/teams/:teamId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  if (!(await canReadTeam(teamId, uid))) return res.sendStatus(403);
  res.json({ id: team.id, name: team.name, orgId: team.orgId });
});

app.patch("/teams/:teamId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "invalid_name" });
  const updated = await prisma.team.update({
    where: { id: teamId },
    data: { name },
  });
  res.json(updated);
});

app.post("/teams/:teamId/members", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  const { userId } = req.body as { userId: string };
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { org: true },
  });
  if (!team) return res.sendStatus(404);
  if (!(await requireOrgRole(team.orgId, uid, ["ADMIN"])))
    return res.sendStatus(403);
  await prisma.orgMembership.upsert({
    where: { orgId_userId: { orgId: team.orgId, userId } },
    update: {},
    create: { orgId: team.orgId, userId, role: "MEMBER" },
  });
  const m = await prisma.teamMembership.upsert({
    where: { teamId_userId: { teamId, userId } },
    update: { role: "MEMBER" },
    create: { teamId, userId, role: "MEMBER" },
  });
  res.json(m);
});

app.post("/teams/:teamId/leader", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  const { userId } = req.body as { userId: string };
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { org: true },
  });
  if (!team) return res.sendStatus(404);
  if (!(await requireOrgRole(team.orgId, uid, ["ADMIN"])))
    return res.sendStatus(403);
  await prisma.orgMembership.upsert({
    where: { orgId_userId: { orgId: team.orgId, userId } },
    update: {},
    create: { orgId: team.orgId, userId, role: "MEMBER" },
  });
  const m = await prisma.teamMembership.upsert({
    where: { teamId_userId: { teamId, userId } },
    update: { role: "LEADER" },
    create: { teamId, userId, role: "LEADER" },
  });
  res.json(m);
});

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

app.get("/teams/:teamId/tasks", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  if (!(await canReadTeam(teamId, uid))) return res.sendStatus(403);
  const tasks = await prisma.task.findMany({
    where: { teamId },
    include: {
      assignees: { include: { user: { select: { id: true, name: true, handle: true } } } },
      notes: true,
    },
  });
  res.json(tasks);
});

app.post("/teams/:teamId/tasks", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  if (!(await canWriteTeam(teamId, uid))) return res.sendStatus(403);
  const t = await prisma.task.create({
    data: {
      teamId,
      title: req.body.title,
      description: req.body.description ?? null,
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
      priority: req.body.priority ?? "MEDIUM",
      createdBy: uid,
    },
  });
  res.json(t);
});

// app.patch("/tasks/:taskId", async (req: any, res) => {
//   const uid = requireUser(req, res);
//   if (!uid) return;
//   const task = await prisma.task.findUnique({
//     where: { id: req.params.taskId },
//     include: { team: true, assignees: true },
//   });
//   if (!task) return res.sendStatus(404);
//   const adminOrLeader = await canWriteTeam(task.teamId, uid);
//   if (!adminOrLeader) {
//     const isAssignee = task.assignees.some((a) => a.userId === uid);
//     const onlyStatus = Object.keys(req.body).every((k) => k === "status");
//     if (!(isAssignee && onlyStatus)) return res.sendStatus(403);
//   }
//   const updated = await prisma.task.update({
//     where: { id: task.id },
//     data: req.body,
//   });
//   res.json(updated);
// });

app.post("/tasks/:taskId/assignees", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;

  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: { team: true },
  });
  if (!task) return res.sendStatus(404);

  // Acting user must have write permission
  if (!(await canWriteTeam(task.teamId, uid))) return res.sendStatus(403);

  const targetUserId: string = req.body.userId;

  // NEW: target must be a member of the task's team
  const targetIsOnTeam = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId: task.teamId, userId: targetUserId } },
  });
  if (!targetIsOnTeam) {
    return res.status(400).json({ error: "user_not_in_team" });
  }

  const row = await prisma.taskAssignment.upsert({
    where: { taskId_userId: { taskId: task.id, userId: targetUserId } },
    update: {},
    create: { taskId: task.id, userId: targetUserId },
  });
  res.json(row);
});

app.delete("/tasks/:taskId/assignees/:userId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { taskId, userId } = req.params;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { team: true },
  });
  if (!task) return res.sendStatus(404);
  if (!(await canWriteTeam(task.teamId, uid))) return res.sendStatus(403);
  await prisma.taskAssignment.deleteMany({ where: { taskId, userId } });
  res.json({ ok: true });
});

// DELETE /tasks/:taskId
app.delete("/tasks/:taskId", async (req: any, res: any) => {
  const uid = requireUser(req, res);
  if (!uid) return;

  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: { team: true },
  });
  if (!task) return res.sendStatus(404);
  if (!(await canWriteTeam(task.teamId, uid))) return res.sendStatus(403);

  // Single delete — DB cascades will clear TaskStatusLog, TaskNote, Mentions,
  // Assignments, and (depending on your choice) CalendarEvent
  await prisma.task.delete({ where: { id: task.id } });

  res.json({ ok: true });
});

// GET /tasks/:taskId
app.get("/tasks/:taskId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;

  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: {
      team: { select: { id: true, name: true, orgId: true } },
      assignees: { include: { user: { select: { id: true, name: true, handle: true } } } },
      notes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!task) return res.sendStatus(404);
  if (!(await canReadTeam(task.teamId, uid))) return res.sendStatus(403);

  res.json(task);
});


/* ------------------------------------------------------------------ */
/* Org admin API                                                      */
/* ------------------------------------------------------------------ */

app.get("/orgs/:orgId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId } = req.params;
  const member = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId: uid } },
  });
  if (!member) return res.sendStatus(403);

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return res.sendStatus(404);

  const memberCount = await prisma.orgMembership.count({ where: { orgId } });
  res.json({ id: org.id, name: org.name, memberCount });
});

app.get("/orgs/:orgId/members", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"])))
    return res.sendStatus(403);

  const rows = await prisma.orgMembership.findMany({
    where: { orgId },
    include: { user: true },
    orderBy: [{ role: "desc" }, { userId: "asc" }],
  });
  res.json(
    rows.map((r) => ({
      userId: r.userId,
      name: r.user.name,
      handle: r.user.handle,
      role: r.role,
    }))
  );
});

app.get("/orgs/:orgId/users", async (req, res, next) =>
  (app as any)._router.handle(
    { ...req, url: `/orgs/${req.params.orgId}/members`, method: "GET" },
    res,
    next
  )
);

app.patch("/orgs/:orgId/members/:userId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId, userId } = req.params;
  const { role } = req.body as { role: "ADMIN" | "MEMBER" };
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"])))
    return res.sendStatus(403);
  if (role !== "ADMIN" && role !== "MEMBER")
    return res.status(400).json({ error: "invalid_role" });

  const updated = await prisma.orgMembership
    .update({
      where: { orgId_userId: { orgId, userId } },
      data: { role },
    })
    .catch(() => null);
  if (!updated) return res.sendStatus(404);
  res.json(updated);
});

app.delete("/orgs/:orgId/members/:userId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId, userId } = req.params;

  if (!(await requireOrgRole(orgId, uid, ["ADMIN"])))
    return res.sendStatus(403);

  const target = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (!target) return res.sendStatus(404);
  if (target.role === "ADMIN")
    return res.status(400).json({ error: "cannot_remove_admin" });

  await prisma.$transaction([
    // Remove from every team in this org
    prisma.teamMembership.deleteMany({
      where: { userId, team: { orgId } },
    }),
    // Remove any task assignments in this org
    prisma.taskAssignment.deleteMany({
      where: { userId, task: { team: { orgId } } },
    }),
    // (Optional) remove @mentions authored for tasks in this org
    prisma.taskNoteMention.deleteMany({
      where: { userId, note: { task: { team: { orgId } } } },
    }),
    // Finally, remove org membership
    prisma.orgMembership.delete({
      where: { orgId_userId: { orgId, userId } },
    }),
  ]);

  res.json({ ok: true });
});


app.get("/orgs/:orgId/details", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { orgId } = req.params;
  if (!(await requireOrgRole(orgId, uid, ["ADMIN"])))
    return res.sendStatus(403);

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return res.sendStatus(404);

  const [memberCount, teams] = await Promise.all([
    prisma.orgMembership.count({ where: { orgId } }),
    prisma.team.findMany({
      where: { orgId },
      include: { memberships: { include: { user: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const shapedTeams = teams.map((t) => ({
    id: t.id,
    name: t.name,
    leaders: t.memberships
      .filter((m) => m.role === "LEADER")
      .map((m) => ({
        userId: m.userId,
        name: m.user.name,
        handle: m.user.handle,
      })),
    members: t.memberships
      .filter((m) => m.role === "MEMBER")
      .map((m) => ({
        userId: m.userId,
        name: m.user.name,
        handle: m.user.handle,
      })),
  }));

  res.json({ id: org.id, name: org.name, memberCount, teams: shapedTeams });
});

async function isAdminOrLeader(teamId: string, userId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return false;
  if (await isOrgAdmin(team.orgId, userId)) return true;
  return await isTeamLeader(teamId, userId);
}


app.patch("/tasks/:taskId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;

  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: { team: true, assignees: true },
  });
  if (!task) return res.sendStatus(404);

  // Permission: admins/leaders can update anything; assignees can update status only
  const adminOrLeader = await canWriteTeam(task.teamId, uid);
  if (!adminOrLeader) {
    const isAssignee = task.assignees.some((a) => a.userId === uid);
    const onlyStatus = Object.keys(req.body).every((k) => k === "status");
    if (!(isAssignee && onlyStatus)) return res.sendStatus(403);
  }

  // Keep prior status for comparison
  const prevStatus = task.status;
  const nextStatus = req.body?.status;

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: req.body,
  });

  // NEW: status-change audit
  if (
    typeof nextStatus === "string" &&
    nextStatus &&
    nextStatus !== prevStatus
  ) {
    await prisma.taskStatusLog.create({
      data: {
        taskId: task.id,
        teamId: task.teamId,
        oldStatus: prevStatus,
        newStatus: nextStatus,
        changedBy: uid,
        // changedAt defaults to now()
      },
    });
  }

  res.json(updated);
});

// GET /teams/:teamId/activity?from=ISO&to=ISO&userId=ALL|<uid>&limit=50
app.get("/teams/:teamId/activity", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;

  const { teamId } = req.params;
  if (!(await isAdminOrLeader(teamId, uid))) return res.sendStatus(403);

  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to   = req.query.to   ? new Date(String(req.query.to))   : null;
  const userId = (req.query.userId && req.query.userId !== "ALL")
    ? String(req.query.userId)
    : null;

  let limit = Number(req.query.limit ?? 50);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 200) limit = 200;

  // Build where clause
  const where: any = { teamId };
  if (from || to) {
    where.changedAt = {};
    if (from) where.changedAt.gte = from;
    if (to)   where.changedAt.lte = to;
  }
  if (userId) where.changedBy = userId;

  const rows = await prisma.taskStatusLog.findMany({
    where,
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  // Enrich with task title and user name/handle (2 small fetches)
  const taskIds = [...new Set(rows.map(r => r.taskId))];
  const userIds = [...new Set(rows.map(r => r.changedBy))];

  const [tasks, users] = await Promise.all([
    taskIds.length ? prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, title: true },
    }) : Promise.resolve([]),
    userIds.length ? prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, handle: true, email: true },
    }) : Promise.resolve([]),
  ]);

  const taskById = new Map(tasks.map(t => [t.id, t]));
  const userById = new Map(users.map(u => [u.id, u]));

  const data = rows.map(r => ({
  id: r.id,
  taskId: r.taskId,
  teamId: r.teamId,
  oldStatus: r.oldStatus,
  newStatus: r.newStatus,
  changedAt: r.changedAt,
  taskTitle: taskById.get(r.taskId)?.title ?? "Untitled task",
  link: `/tasks/${r.taskId}`, // <— add
  changedBy: {
    id: r.changedBy,
    name: userById.get(r.changedBy)?.name ?? null,
    handle: userById.get(r.changedBy)?.handle ?? null,
  },
}));
res.json(data);
});


/* ------------------------------------------------------------------ */
/* Notes & Info                                                       */
/* ------------------------------------------------------------------ */

app.post("/tasks/:taskId/notes", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
  });
  if (!task) return res.sendStatus(404);
  const ok =
    (await requireTeamRole(task.teamId, uid, ["LEADER", "MEMBER"])) ||
    (await canWriteTeam(task.teamId, uid));
  if (!ok) return res.sendStatus(403);
  const content: string = req.body.content ?? "";
  const handles = Array.from(
    content.matchAll(/@([a-zA-Z0-9_.~-]{2,30})/g)
  ).map((m) => m[1]);
  const users = handles.length
    ? await prisma.user.findMany({ where: { handle: { in: handles } } })
    : [];
  const note = await prisma.taskNote.create({
    data: {
      taskId: task.id,
      authorId: uid,
      content,
      mentions: { create: users.map((u) => ({ userId: u.id })) },
    },
    include: { mentions: true },
  });
  res.json(note);
});

/* ---------------- Team info + links ---------------- */

app.get("/teams/:teamId/info", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  if (!(await canReadTeam(teamId, uid))) return res.sendStatus(403);
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      info: true,
      links: { orderBy: { ordinal: "asc" } },
    },
  });
  if (!team) return res.sendStatus(404);
  res.json(team);
});

app.patch("/teams/:teamId/info", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  const info = typeof req.body?.info === "string" ? req.body.info : null;
  const updated = await prisma.team.update({
    where: { id: teamId },
    data: { info },
  });
  res.json({ ok: true, info: updated.info });
});

app.post("/teams/:teamId/links", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  const { label, url } = req.body as { label: string; url: string };
  if (!label || !url)
    return res.status(400).json({ error: "label_and_url_required" });
  const max = await prisma.teamLink.aggregate({
    where: { teamId },
    _max: { ordinal: true },
  });
  const link = await prisma.teamLink.create({
    data: {
      teamId,
      label,
      url,
      ordinal: (max._max.ordinal ?? 0) + 1,
    },
  });
  res.json(link);
});

app.patch("/teams/:teamId/links/:linkId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId, linkId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  const { label, url, ordinal } = req.body as Partial<{
    label: string;
    url: string;
    ordinal: number;
  }>;
  const updated = await prisma.teamLink.update({
    where: { id: linkId },
    data: {
      ...(typeof label === "string" ? { label } : {}),
      ...(typeof url === "string" ? { url } : {}),
      ...(typeof ordinal === "number" ? { ordinal } : {}),
    },
  });
  res.json(updated);
});

app.delete("/teams/:teamId/links/:linkId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId, linkId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const admin = await isOrgAdmin(team.orgId, uid);
  const leader = await isTeamLeader(teamId, uid);
  if (!(admin || leader)) return res.sendStatus(403);
  await prisma.teamLink.delete({ where: { id: linkId } });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Calendar                                                           */
/* ------------------------------------------------------------------ */

app.get("/teams/:teamId/calendar", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId } = req.params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const allowed =
    (await requireTeamRole(teamId, uid, ["LEADER", "MEMBER"])) ||
    (await requireOrgRole(team.orgId, uid, ["ADMIN"]));
  if (!allowed) return res.sendStatus(403);
  const events = await prisma.calendarEvent.findMany({ where: { teamId } });
  res.json(events);
});

app.post("/teams/:teamId/calendar", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
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
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId, eventId } = req.params;
  const { title, description, type, startAt, endAt, durationMinutes } = req.body;

  const ev = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.teamId !== teamId) return res.sendStatus(404);
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const can =
    (await requireTeamRole(teamId, uid, ["LEADER"])) ||
    (await requireOrgRole(team.orgId, uid, ["ADMIN"]));
  if (!can) return res.sendStatus(403);

  const data: any = {};
  if (typeof title === "string") data.title = title;
  if (typeof description === "string") data.description = description;
  if (type === "TASK" || type === "EVENT") data.type = type;

  if (type === "TASK" || data.type === "TASK") {
    const base = new Date(startAt || ev.startAt);
    const s = new Date(base);
    s.setHours(0, 0, 0, 0);
    const e = new Date(base);
    e.setHours(23, 59, 59, 999);
    data.startAt = s;
    data.endAt = e;
  } else if (type === "EVENT" || data.type === "EVENT") {
    const s = startAt ? new Date(startAt) : ev.startAt;
    let e: Date;
    if (endAt) e = new Date(endAt);
    else if (durationMinutes && durationMinutes > 0)
      e = new Date(s.getTime() + durationMinutes * 60_000);
    else e = ev.endAt;
    data.startAt = s;
    data.endAt = e;
  } else {
    if (startAt) data.startAt = new Date(startAt);
    if (endAt) data.endAt = new Date(endAt);
  }

  const updated = await prisma.calendarEvent.update({
    where: { id: eventId },
    data,
  });
  res.json(updated);
});

app.delete("/teams/:teamId/calendar/:eventId", async (req: any, res) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const { teamId, eventId } = req.params;
  const ev = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.teamId !== teamId) return res.sendStatus(404);
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return res.sendStatus(404);
  const can =
    (await requireTeamRole(teamId, uid, ["LEADER"])) ||
    (await requireOrgRole(team.orgId, uid, ["ADMIN"]));
  if (!can) return res.sendStatus(403);
  await prisma.calendarEvent.delete({ where: { id: eventId } });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* 404 & Error                                                        */
/* ------------------------------------------------------------------ */

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

/* ------------------------------------------------------------------ */
/* Listen                                                             */
/* ------------------------------------------------------------------ */

app.listen(ENV.PORT, "0.0.0.0", () =>
  console.log(`API listening on http://0.0.0.0:${ENV.PORT} (${ENV.NODE_ENV})`)
);
