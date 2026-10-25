import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { fridayWorkQuerySchema } from "@paperclipai/shared";
import { fridayAwarenessService } from "../services/friday-awareness.js";
import { forbidden } from "../errors.js";
import { assertCompanyAccess } from "./authz.js";
import { authorizationService } from "../services/authorization.js";

export function fridayRoutes(db: Db) {
  const router = Router();
  const service = fridayAwarenessService(db);
  router.use("/companies/:companyId/friday", async (req, _res, next) => {
    const companyId = z.string().uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "agent" && req.actor.keyScope && req.actor.keyScope.kind !== "standard") throw forbidden("Friday awareness requires standard company access");
    const [access] = await authorizationService(db).decideReads(req.actor, [{ type: "company", companyId }]);
    if (!access.allowed) throw forbidden("Company discovery access required");
    next();
  });
  router.get("/companies/:companyId/friday/work", async (req, res) => res.json(await service.work(req.params.companyId as string, req.actor, fridayWorkQuerySchema.parse(req.query))));
  return router;
}
