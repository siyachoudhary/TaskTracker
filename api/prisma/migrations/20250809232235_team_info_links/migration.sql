-- AlterTable
ALTER TABLE "public"."Team" ADD COLUMN     "info" TEXT;

-- CreateTable
CREATE TABLE "public"."TeamLink" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TeamLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamLink_teamId_ordinal_idx" ON "public"."TeamLink"("teamId", "ordinal");

-- AddForeignKey
ALTER TABLE "public"."TeamLink" ADD CONSTRAINT "TeamLink_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
