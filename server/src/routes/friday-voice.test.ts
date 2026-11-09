import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import type { Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { fridayRoutes } from "./friday.js";

const voice = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../services/friday-voice.js", () => ({ fridayVoiceStatus: async () => ({ available: true }), fridayVoiceRequest: voice.request }));
vi.mock("../services/authorization.js", async importOriginal => ({
  ...await importOriginal<object>(),
  authorizationService: () => ({ decideReads: async () => [{ allowed: true }] }),
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const path = `/api/companies/${companyId}/friday/voice`;
const actor: Express.Request["actor"] = { type: "board", source: "session", userId: "voice-user", companyIds: [companyId] };
function app(currentActor = actor) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.actor = currentActor; next(); });
  server.use("/api", fridayRoutes({} as Db));
  server.use(errorHandler);
  return server;
}
beforeEach(() => {
  vi.clearAllMocks();
  voice.request.mockResolvedValue({ audio: "synthetic-wav", sampleRate: 24000 });
});

describe("local Friday voice request lifetime", () => {
  it("retains a successful response without cancelling settled speech", async () => {
    await request(app()).post(path).send({ op: "speak", text: "Hello." }).expect(200);
    expect(voice.request).toHaveBeenCalledOnce();
    expect(voice.request.mock.calls[0][0]).toEqual({ op: "speak", text: "Hello." });
    expect(voice.request.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(voice.request.mock.calls[0][1].aborted).toBe(false);
  });

  it.each([
    { type: "agent", source: "agent_key", companyId },
    { ...actor, companyIds: [] },
  ] as Express.Request["actor"][])("retains board and company access checks", async currentActor => {
    await request(app(currentActor)).post(path).send({ op: "speak", text: "Private speech." }).expect(403);
    expect(voice.request).not.toHaveBeenCalled();
  });

  it.each([{ op: "speak", text: "" }, { op: "speak", text: "x".repeat(1001) }, { op: "transcribe", audio: "not base64" }, { op: "speak", text: "Hello", cancelOtherUser: true }])(
    "rejects malformed input before starting speech", async body => {
      await request(app()).post(path).send(body).expect(400);
      expect(voice.request).not.toHaveBeenCalled();
    },
  );

  it("propagates a real HTTP disconnect to the pending operation", async () => {
    let started!: () => void, cancelled!: () => void;
    const operationStarted = new Promise<void>(resolve => { started = resolve; });
    const operationCancelled = new Promise<void>(resolve => { cancelled = resolve; });
    voice.request.mockImplementation((_input, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { cancelled(); reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
      started();
    }));
    const server = app().listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const abort = new AbortController();
      const response = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "speak", text: "Interrupted." }), signal: abort.signal,
      });
      const rejected = expect(response).rejects.toMatchObject({ name: "AbortError" });
      await operationStarted;
      abort.abort();
      await rejected;
      await operationCancelled;
      expect(voice.request.mock.calls[0][1].aborted).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
