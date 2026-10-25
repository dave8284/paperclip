import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { updateOperatingProfileSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { operatingProfileService } from "../services/operating-profile.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function operatingProfileRoutes(db: Db) {
  const router = Router();
  const service = operatingProfileService(db);
  router.get("/companies/:companyId/operating-profile", async (req, res) => {
    const companyId = z.string().uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    res.json(await service.read(companyId));
  });
  router.put("/companies/:companyId/operating-profile", validate(updateOperatingProfileSchema), async (req, res) => {
    const companyId = z.string().uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    res.json(await service.update(companyId, req.actor, getActorInfo(req), req.body));
  });
  return router;
}
