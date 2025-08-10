/*
  Warnings:

  - A unique constraint covering the columns `[googleEventId]` on the table `CalendarEvent` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."CalendarItemType" AS ENUM ('TASK', 'EVENT');

-- AlterTable
ALTER TABLE "public"."CalendarEvent" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "googleEventId" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3),
ADD COLUMN     "type" "public"."CalendarItemType" NOT NULL DEFAULT 'EVENT';

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "googleEmail" TEXT,
ADD COLUMN     "googleRefreshToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_googleEventId_key" ON "public"."CalendarEvent"("googleEventId");
