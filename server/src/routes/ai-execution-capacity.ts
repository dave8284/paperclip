import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { saveAiExecutionCapacitySchema } from "@paperclipai/shared";
import { assertCompanyAccess, assertInstanceAdmin, getActorInfo } from "./authz.js";
import { aiExecutionCapacityService } from "../services/ai-execution-capacity.js";

export function aiExecutionCapacityRoutes(db: Db) {
  const router = Router(), service = aiExecutionCapacityService(db);
  router.get("/instance/ai-execution-capacity", async (req, res) => {
    assertInstanceAdmin(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.overview({ userId: getActorInfo(req).actorId,
      local: req.actor.source === "local_implicit",
      companyIds: req.actor.source === "local_implicit" ? null : req.actor.companyIds ?? [] }));
  });
  router.post("/instance/ai-execution-capacity", async (req, res) => {
    assertInstanceAdmin(req);
    const input = saveAiExecutionCapacitySchema.parse(req.body);
    for (const binding of input.bindings) assertCompanyAccess(req, binding.companyId);
    res.json(await service.save(input, { userId: getActorInfo(req).actorId,
      local: req.actor.source === "local_implicit",
      companyIds: req.actor.source === "local_implicit" ? null : req.actor.companyIds ?? [] }));
  });
  return router;
}
