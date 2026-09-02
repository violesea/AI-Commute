-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tripId" TEXT,
    "selectedTripId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "purpose" TEXT NOT NULL DEFAULT 'planning',
    "prompt" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "timeoutMs" INTEGER NOT NULL DEFAULT 600000,
    "routeThemesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentSession_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentSession_selectedTripId_fkey" FOREIGN KEY ("selectedTripId") REFERENCES "Trip" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentSession" ("createdAt", "id", "prompt", "purpose", "retryCount", "status", "timeoutMs", "tripId", "updatedAt", "userId") SELECT "createdAt", "id", "prompt", "purpose", "retryCount", "status", "timeoutMs", "tripId", "updatedAt", "userId" FROM "AgentSession";
DROP TABLE "AgentSession";
ALTER TABLE "new_AgentSession" RENAME TO "AgentSession";
CREATE INDEX "AgentSession_userId_idx" ON "AgentSession"("userId");
CREATE INDEX "AgentSession_tripId_idx" ON "AgentSession"("tripId");
CREATE INDEX "AgentSession_selectedTripId_idx" ON "AgentSession"("selectedTripId");
CREATE INDEX "AgentSession_status_idx" ON "AgentSession"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
