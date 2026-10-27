import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { instanceUserRoles, type Db } from "@paperclipai/db";
import { adminInvitationCreateSchema, adminUserDeleteSchema, adminUserUpdateSchema } from "@paperclipai/shared";
import { googleSignInConfiguration, readUserApproval } from "../auth/agentos-registration.js";
import { administrationService, assertAdministration, type AdminPrincipal } from "../services/agentos-administration.js";
import { assertBoard } from "./authz.js";
import type { Request } from "express";
import { modelIntelligenceProduct, evaluateModelRun } from "../services/model-intelligence.js";
import { conflict } from "../errors.js";
import { logActivity } from "../services/activity-log.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { modelIntelligenceAnalytics } from "../services/agentos-model-analytics.js";

export function agentosAdministrationRoutes(db: Db, options: { deploymentMode: "local_trusted" | "authenticated"; authDisableSignUp?: boolean }) {
  const router = Router();
  const service = administrationService(db);
  router.use("/admin", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  const principal = (req: Request): AdminPrincipal => {
    assertBoard(req);
    return { userId: req.actor.userId ?? "", local: req.actor.source === "local_implicit" };
  };
  router.get("/registration/options", (_req, res) => res.json({
    googleEnabled: options.deploymentMode === "authenticated" && Boolean(googleSignInConfiguration()),
    passwordSignUpEnabled: options.deploymentMode === "authenticated" && !options.authDisableSignUp,
    approvalRequired: options.deploymentMode === "authenticated",
  }));
  router.get("/registration", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.actor.type !== "board") return res.json({ status: "anonymous", userId: null, isInstanceAdmin: false });
    if (req.actor.source === "local_implicit") return res.json({ status: "approved", userId: "local-board", isInstanceAdmin: true });
    const userId = req.actor.userId ?? null;
    const status = userId ? await readUserApproval(db, userId) : null;
    const [role] = userId && status === "approved" ? await db.select({ id: instanceUserRoles.id }).from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin"))).limit(1) : [];
    res.json({ status: status ?? "anonymous", userId, isInstanceAdmin: Boolean(role) });
  });
  router.get("/admin/overview", async (req, res) => res.json({
    counts: await service.overview(principal(req)),
    google: { configured: Boolean(googleSignInConfiguration()), callbackPath: "/api/auth/callback/google" },
    mode: options.deploymentMode,
  }));
  router.get("/admin/people", async (req, res) => res.json(await service.people(principal(req), req.query)));
  router.patch("/admin/people/:userId", async (req, res) => {
    const { id, approvalRevision } = await service.updatePerson(principal(req), req.params.userId as string, adminUserUpdateSchema.parse(req.body));
    res.json({ id, approvalRevision });
  });
  router.delete("/admin/people/:userId", async (req, res) => res.json(await service.deletePerson(principal(req), req.params.userId as string, adminUserDeleteSchema.parse(req.body))));
  router.get("/admin/preapprovals", async (req, res) => res.json(await service.invitations(principal(req))));
  router.post("/admin/preapprovals", async (req, res) => res.status(201).json(await service.invite(principal(req), adminInvitationCreateSchema.parse(req.body))));
  router.delete("/admin/preapprovals/:id", async (req, res) => res.json(await service.revokeInvitation(principal(req), z.uuid().parse(req.params.id))));
  router.get("/admin/events", async (req, res) => res.json(await service.events(principal(req))));
  router.get("/admin/model-intelligence", async (req, res) => res.json(await modelIntelligenceAnalytics(db, principal(req))));
  router.get("/admin/model-intelligence/learning", async (req, res) => {
    await assertAdministration(db, principal(req));
    res.json(modelIntelligenceProduct()?.analytics() ?? null);
  });
  router.post("/admin/model-intelligence/evaluations", async (req, res) => {
    await assertAdministration(db, principal(req));
    const input = z.object({ companyId: z.string().uuid(), runId: z.string().uuid(), passed: z.boolean(), evidenceRef: z.string().trim().min(10).max(300) }).strict().parse(req.body);
    assertCompanyAccess(req, input.companyId);
    res.json(await evaluateModelRun(db, input.companyId, input.runId, input, getActorInfo(req)));
  });
  router.post("/admin/model-intelligence/policy", async (req, res) => {
    await assertAdministration(db, principal(req));
    const input = z.object({ namespace: z.string().uuid(), candidateId: z.string().min(1).max(300), action: z.enum(["block", "restore"]), reason: z.string().trim().min(10).max(300) }).strict().parse(req.body);
    assertCompanyAccess(req, input.namespace);
    const engine = modelIntelligenceProduct(); if (!engine) throw conflict("Model Intelligence is not configured");
    const event = engine.policy(input);
    await logActivity(db, { ...getActorInfo(req), companyId: input.namespace, action: "model_intelligence.policy_changed", entityType: "model_policy", entityId: event.id, details: { candidateId: input.candidateId, action: input.action, reason: input.reason } });
    res.json(event);
  });
  return router;
}
