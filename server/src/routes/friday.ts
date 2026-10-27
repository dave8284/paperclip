import { Router, json } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { fridayWorkQuerySchema, createDepartmentSchema, updateDepartmentSchema, assignDepartmentProjectSchema, createPerformanceReportSchema, performancePeriodSchema } from "@paperclipai/shared";
import { modelCatalog } from "../services/model-intelligence.js";
import { fridayVoiceStatus, fridayVoiceRequest } from "../services/friday-voice.js";
import { companyPerformanceService } from "../services/company-performance.js";
import { departmentService } from "../services/agentos-departments.js";
import { fridayAwarenessService } from "../services/friday-awareness.js";
import { forbidden } from "../errors.js";
import { assertCompanyAccess, assertBoard, getActorInfo } from "./authz.js";
import { authorizationService } from "../services/authorization.js";

export function fridayRoutes(db: Db) {
  const router = Router();
  const service = fridayAwarenessService(db);
  const departments = departmentService(db);
  const performance = companyPerformanceService(db);
  router.use("/companies/:companyId/friday", async (req, _res, next) => {
    const companyId = z.string().uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "agent" && req.actor.keyScope && req.actor.keyScope.kind !== "standard") throw forbidden("Friday awareness requires standard company access");
    const [access] = await authorizationService(db).decideReads(req.actor, [{ type: "company", companyId }]);
    if (!access.allowed) throw forbidden("Company discovery access required");
    next();
  });
  router.get("/companies/:companyId/friday/work", async (req, res) => res.json(await service.work(req.params.companyId as string, req.actor, fridayWorkQuerySchema.parse(req.query))));
  router.get("/companies/:companyId/friday/departments", async (req, res) => res.json(await departments.list(req.params.companyId as string, req.actor)));
  router.post("/companies/:companyId/friday/departments", async (req, res) => res.status(201).json(await departments.save(req.params.companyId as string, req.actor, getActorInfo(req), createDepartmentSchema.parse(req.body))));
  router.patch("/companies/:companyId/friday/departments/:id", async (req, res) => res.json(await departments.save(req.params.companyId as string, req.actor, getActorInfo(req), updateDepartmentSchema.parse(req.body), z.string().uuid().parse(req.params.id))));
  router.delete("/companies/:companyId/friday/departments/:id", async (req, res) => {
    await departments.remove(req.params.companyId as string, z.string().uuid().parse(req.params.id), z.coerce.number().int().positive().parse(req.query.revision), req.actor, getActorInfo(req));
    res.status(204).end();
  });
  router.put("/companies/:companyId/friday/projects/:projectId/department", async (req, res) => res.json(await departments.assign(req.params.companyId as string, z.string().uuid().parse(req.params.projectId), assignDepartmentProjectSchema.parse(req.body).departmentId, req.actor, getActorInfo(req))));
  router.get("/companies/:companyId/friday/performance", async (req, res) => res.json(await performance.list(req.params.companyId as string, performancePeriodSchema.parse(req.query.period), req.actor)));
  router.post("/companies/:companyId/friday/performance", async (req, res) => res.status(201).json(await performance.record(req.params.companyId as string, createPerformanceReportSchema.parse(req.body), req.actor, getActorInfo(req))));
  router.get("/companies/:companyId/friday/models", async (req, res) => {
    assertBoard(req);
    // Company-wide learning contains receipts from private projects. It follows
    // the same instance-admin boundary as the evaluation ledger.
    const includeLearning = req.actor.type === "board" && (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin === true);
    res.json(await modelCatalog(db, req.params.companyId as string, includeLearning));
  });
  router.get("/companies/:companyId/friday/voice", async (req, res) => { assertBoard(req); res.json(await fridayVoiceStatus()); });
  router.post("/companies/:companyId/friday/voice", json({ limit: "8mb" }), async (req, res) => {
    assertBoard(req);
    const input = z.discriminatedUnion("op", [z.object({ op: z.literal("prepare") }).strict(), z.object({ op: z.literal("speak"), text: z.string().trim().min(1).max(1000) }).strict(), z.object({ op: z.literal("transcribe"), audio: z.string().min(44).max(8_000_000).regex(/^[A-Za-z0-9+/=]+$/) }).strict()]).parse(req.body);
    res.set("Cache-Control", "no-store").json(await fridayVoiceRequest(input));
  });
  return router;
}
