import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createManagedApplicationSchema, updateManagedApplicationSchema, managedApplicationListSchema,
  managedApplicationWorkQuerySchema, linkManagedApplicationProjectSchema } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { managedApplicationService } from "../services/managed-applications.js";
import { accessService } from "../services/access.js";
import { readPortfolioGalaxy } from "../services/portfolio-galaxy.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function managedApplicationRoutes(db: Db) {
  const router = Router();
  const service = managedApplicationService(db);
  const access = accessService(db);
  async function assertManage(req: import("express").Request) {
    const decision = await access.decide({ actor: req.actor, action: "applications:manage",
      resource: { type: "company", companyId: req.params.companyId as string } });
    if (!decision.allowed) throw forbidden(decision.explanation);
  }
  const base = "/companies/:companyId/managed-applications";
  router.use(base, (req, _res, next) => {
    const companyId = z.string().uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "agent" && req.actor.keyScope && req.actor.keyScope.kind !== "standard") {
      throw forbidden("Application discovery requires standard company access");
    }
    next();
  });
  router.get("/companies/:companyId/managed-applications", async (req, res) => {
    res.json(await service.list(req.params.companyId as string, req.actor, managedApplicationListSchema.parse(req.query)));
  });
  router.post("/companies/:companyId/managed-applications", validate(createManagedApplicationSchema), async (req, res) => {
    await assertManage(req);
    const result = await service.create(req.params.companyId as string, req.actor, getActorInfo(req), req.body);
    res.status(result.created ? 201 : 200).json(result.application);
  });
  router.get("/companies/:companyId/managed-applications/galaxy", async (req, res) => {
    res.json(await readPortfolioGalaxy(db, req.params.companyId as string, req.actor, managedApplicationListSchema.parse(req.query)));
  });
  router.get("/companies/:companyId/managed-applications/:id", async (req, res) => {
    res.json(await service.read(req.params.companyId as string, z.string().uuid().parse(req.params.id), req.actor));
  });
  router.patch("/companies/:companyId/managed-applications/:id", validate(updateManagedApplicationSchema), async (req, res) => {
    await assertManage(req);
    res.json(await service.update(req.params.companyId as string, z.string().uuid().parse(req.params.id), req.actor, getActorInfo(req), req.body));
  });
  router.get("/companies/:companyId/managed-applications/:id/work", async (req, res) => {
    res.json(await service.work(req.params.companyId as string, z.string().uuid().parse(req.params.id), req.actor,
      managedApplicationWorkQuerySchema.parse(req.query)));
  });
  router.post("/companies/:companyId/managed-applications/:id/projects", validate(linkManagedApplicationProjectSchema), async (req, res) => {
    // Like native project coordination, standard company agents can associate
    // accessible work. The service checks both project ACLs; a link grants no access.
    await service.linkProject(req.params.companyId as string, z.string().uuid().parse(req.params.id), req.body.projectId, req.actor, getActorInfo(req));
    res.status(204).end();
  });
  router.delete("/companies/:companyId/managed-applications/:id/projects/:projectId", async (req, res) => {
    await assertManage(req);
    await service.linkProject(req.params.companyId as string, z.string().uuid().parse(req.params.id),
      z.string().uuid().parse(req.params.projectId), req.actor, getActorInfo(req), true);
    res.status(204).end();
  });
  return router;
}
