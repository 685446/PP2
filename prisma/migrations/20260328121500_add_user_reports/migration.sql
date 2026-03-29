ALTER TYPE "ReportTargetType" ADD VALUE 'USER';

ALTER TABLE "Report"
ADD COLUMN "reportedUserId" INTEGER;

CREATE INDEX "Report_reportedUserId_idx" ON "Report"("reportedUserId");

ALTER TABLE "Report"
ADD CONSTRAINT "Report_reportedUserId_fkey"
FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
