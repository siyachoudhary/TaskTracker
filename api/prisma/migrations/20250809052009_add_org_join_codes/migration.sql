-- CreateTable
CREATE TABLE "public"."OrgJoinCode" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrgJoinCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgJoinCode_code_key" ON "public"."OrgJoinCode"("code");

-- AddForeignKey
ALTER TABLE "public"."OrgJoinCode" ADD CONSTRAINT "OrgJoinCode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
