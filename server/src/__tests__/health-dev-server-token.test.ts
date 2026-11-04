import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { IncomingMessage } from "node:http";
import { inject } from "light-my-request";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { healthRoutes } from "../routes/health.js";
import * as devServerStatus from "../dev-server-status.js";
import { readHotRestartIntent, resumePendingHotRestartIntent, resolveHotRestartIntentPath } from "../services/hot-restart.js";
import { devRestartIdentityStatus } from "../../../scripts/dev-runner-restart.js";

vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(),
  // Keep native intent/file coordination real; OS probing is a controlled
  // boundary because this test runs without process-spawn permission.
  execFile: vi.fn((_command, _args, _options, callback) => callback(null, "Wed Nov 4 10:00:00 2026\n")),
}));

const tempDirs: string[] = [];

async function dispatch(app: express.Express, method: "GET" | "POST", headers?: Record<string, string>) {
  // Isolate Express prototypes when injecting real HTTP messages without a socket.
  for (const target of [app.request, app.response]) {
    const parent = Object.getPrototypeOf(target);
    Object.setPrototypeOf(target, Object.create(Object.getPrototypeOf(parent), Object.getOwnPropertyDescriptors(parent)));
  }
  const result = await inject(app, { method, url: method === "GET" ? "/health" : "/health/dev-server/restart", headers, Request: IncomingMessage });
  return { status: result.statusCode, body: result.json() };
}

function createDevServerStatusFile(payload: unknown) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paperclip-health-dev-server-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "dev-server-status.json");
  writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  return filePath;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /health dev-server supervisor access", () => {
  it("exposes dev-server metadata to the supervising dev runner in authenticated mode", async () => {
    const previousFile = process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
    const previousToken = process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN;
    process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = createDevServerStatusFile({
      dirty: true,
      lastChangedAt: "2026-03-20T12:00:00.000Z",
      changedPathCount: 1,
      changedPathsSample: ["server/src/routes/health.ts"],
      pendingMigrations: [],
      lastRestartAt: "2026-03-20T11:30:00.000Z",
    });
    process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN = "dev-runner-token";

    let selectCall = 0;
    const db = {
      execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
      select: vi.fn(() => {
        selectCall += 1;
        if (selectCall === 1) {
          return {
            from: vi.fn(() => ({
              where: vi.fn().mockResolvedValue([{ count: 1 }]),
            })),
          };
        }
        if (selectCall === 2) {
          return {
            from: vi.fn(() => ({
              where: vi.fn().mockResolvedValue([
                {
                  id: "settings-1",
                  general: {},
                  experimental: { autoRestartDevServerWhenIdle: true },
                  createdAt: new Date("2026-03-20T11:00:00.000Z"),
                  updatedAt: new Date("2026-03-20T11:00:00.000Z"),
                },
              ]),
            })),
          };
        }
        return {
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          })),
        };
      }),
    } as unknown as Db;

    try {
      const app = express();
      app.use((req, _res, next) => {
        (req as any).actor = { type: "none", source: "none" };
        next();
      });
      app.use(
        "/health",
        healthRoutes(db, {
          deploymentMode: "authenticated",
          deploymentExposure: "private",
          authReady: true,
          companyDeletionEnabled: true,
          // Pin server info so the commit field is deterministic (null)
          // instead of picking up the checkout's real git metadata.
          serverInfo: {
            processStartedAt: "2026-03-20T11:00:00.000Z",
            git: { available: false, unavailableReason: "git_unavailable" },
          },
        }),
      );

      const res = await dispatch(app, "GET", { "X-Paperclip-Dev-Server-Status-Token": "dev-runner-token" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: "ok",
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        localAiLoginSupported: true,
        commit: null,
        bootstrapStatus: "ready",
        bootstrapInviteActive: false,
        serverInfo: { processStartedAt: "2026-03-20T11:00:00.000Z" },
        devServer: {
          enabled: true,
          restartRequired: true,
          reason: "backend_changes",
          lastChangedAt: "2026-03-20T12:00:00.000Z",
          changedPathCount: 1,
          changedPathsSample: ["server/src/routes/health.ts"],
          pendingMigrations: [],
          autoRestartEnabled: true,
          activeRunCount: 0,
          waitingForIdle: false,
          lastRestartAt: "2026-03-20T11:30:00.000Z",
        },
      });
      expect(devRestartIdentityStatus(res.body, "2026-03-20T11:00:00.000Z")).toBe("current");
      for (const headers of [{}, { "X-Paperclip-Dev-Server-Status-Token": "wrong-token" }]) {
        const anonymous = await dispatch(app, "GET", headers);
        expect(anonymous.body).not.toHaveProperty("serverInfo");
        expect(anonymous.body).not.toHaveProperty("devServer");
      }
    } finally {
      if (previousFile === undefined) {
        delete process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
      } else {
        process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = previousFile;
      }
      if (previousToken === undefined) {
        delete process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN;
      } else {
        process.env.PAPERCLIP_DEV_SERVER_STATUS_TOKEN = previousToken;
      }
    }
  });
});

describe("POST /health/dev-server/restart", () => {
  it("records a manual restart request for the dev runner", async () => {
    const previousFile = process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
    const previousHome = process.env.PAPERCLIP_HOME;
    process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = createDevServerStatusFile({
      dirty: true,
      lastChangedAt: "2026-03-20T12:00:00.000Z",
      changedPathCount: 1,
      changedPathsSample: ["server/src/routes/health.ts"],
      pendingMigrations: [],
      lastRestartAt: "2026-03-20T11:30:00.000Z",
    });
    process.env.PAPERCLIP_HOME = path.dirname(
      process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE,
    );

    try {
      const app = express();
      const db = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      } as unknown as Db;
      app.use("/health", healthRoutes(db));

      const res = await dispatch(app, "POST");

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        status: "restart_requested",
        mode: "hot",
        requestId: expect.any(String),
      });

      const requestPath = path.join(
        path.dirname(process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE),
        "dev-server-restart-request.json",
      );
      expect(existsSync(requestPath)).toBe(true);
      expect(JSON.parse(readFileSync(requestPath, "utf8"))).toMatchObject({
        reason: "manual_restart_now",
        mode: "hot",
        requestId: res.body.requestId,
      });
      const originalIntent = await readHotRestartIntent();
      devServerStatus.removeDevServerRestartRequest({ requestId: res.body.requestId });
      const retry = await dispatch(app, "POST");
      expect(retry.status).toBe(202);
      expect(retry.body.requestId).toBe(res.body.requestId);
      expect(await readHotRestartIntent()).toEqual(originalIntent);
      expect(JSON.parse(readFileSync(requestPath, "utf8"))).toMatchObject({ requestId: res.body.requestId });
      vi.spyOn(devServerStatus, "writeDevServerRestartRequest").mockReturnValueOnce(false);
      const failedRetry = await dispatch(app, "POST");
      expect(failedRetry.status).toBe(404);
      expect(await readHotRestartIntent()).toEqual(originalIntent);
      // A changed boot cannot resume this pending request, even with the same PID.
      expect(await resumePendingHotRestartIntent({ previousServerPid: process.pid, previousServerIdentity: "different-boot", preflightActiveRunIds: [] })).toBeNull();
      expect(await readHotRestartIntent()).toEqual(originalIntent);
    } finally {
      if (previousFile === undefined) {
        delete process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
      } else {
        process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = previousFile;
      }
      if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousHome;
    }
  });

  it("rolls back the hot intent when the supervisor request cannot be written", async () => {
    const previousFile = process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
    const previousHome = process.env.PAPERCLIP_HOME;
    process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = createDevServerStatusFile({
      dirty: true,
      changedPathCount: 1,
      changedPathsSample: ["server/src/routes/health.ts"],
      pendingMigrations: [],
    });
    const home = mkdtempSync(path.join(os.tmpdir(), "paperclip-health-restart-home-"));
    tempDirs.push(home);
    process.env.PAPERCLIP_HOME = home;
    vi.spyOn(devServerStatus, "writeDevServerRestartRequest").mockReturnValue(false);

    try {
      const app = express();
      const db = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
        })),
      } as unknown as Db;
      app.use("/health", healthRoutes(db));

      const res = await dispatch(app, "POST");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "dev_server_supervisor_unavailable" });
      expect(existsSync(resolveHotRestartIntentPath(home))).toBe(false);
    } finally {
      if (previousFile === undefined) {
        delete process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
      } else {
        process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = previousFile;
      }
      if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousHome;
    }
  });

  it("rejects unauthenticated manual restarts in authenticated mode", async () => {
    const previousFile = process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
    process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = createDevServerStatusFile({
      dirty: true,
      changedPathCount: 1,
      changedPathsSample: ["server/src/routes/health.ts"],
      pendingMigrations: [],
    });

    try {
      const app = express();
      app.use((req, _res, next) => {
        (req as any).actor = { type: "none", source: "none" };
        next();
      });
      app.use(
        "/health",
        healthRoutes(undefined, {
          deploymentMode: "authenticated",
          deploymentExposure: "private",
          authReady: true,
          companyDeletionEnabled: true,
        }),
      );

      const res = await dispatch(app, "POST");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "board_access_required" });
    } finally {
      if (previousFile === undefined) {
        delete process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE;
      } else {
        process.env.PAPERCLIP_DEV_SERVER_STATUS_FILE = previousFile;
      }
    }
  });
});


describe("dev supervisor boot identity admission", () => {
  it("waits without discarding a restart when authenticated identity is missing", () => {
    expect(devRestartIdentityStatus({}, "boot-a")).toBe("unavailable");
    expect(devRestartIdentityStatus({ serverInfo: { processStartedAt: null } }, "boot-a")).toBe("unavailable");
    expect(devRestartIdentityStatus({ serverInfo: { processStartedAt: "boot-b" } }, "boot-a")).toBe("stale");
    expect(devRestartIdentityStatus({ serverInfo: { processStartedAt: "boot-a" } }, "boot-a")).toBe("current");
    expect(devRestartIdentityStatus({}, undefined)).toBe("current");
  });
});
