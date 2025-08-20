-- CreateTable
CREATE TABLE "public"."TaskStatusLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskStatusLog_teamId_changedAt_idx" ON "public"."TaskStatusLog"("teamId", "changedAt");

-- CreateIndex
CREATE INDEX "TaskStatusLog_teamId_changedBy_changedAt_idx" ON "public"."TaskStatusLog"("teamId", "changedBy", "changedAt");

-- CreateIndex
CREATE INDEX "TaskStatusLog_taskId_changedAt_idx" ON "public"."TaskStatusLog"("taskId", "changedAt");
