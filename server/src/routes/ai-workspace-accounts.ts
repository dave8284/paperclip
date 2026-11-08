import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { enrollAiWorkspaceAccountSchema, installAiWorkspaceAccountSchema, updateAiWorkspaceAccountSchema, finishAiWorkspaceAccountSetupSchema } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { aiWorkspaceAccountService, type AiWorkspaceAccountScope } from "../services/ai-workspace-accounts.js";
import { aiWorkspaceAccountSetupService } from "../services/ai-workspace-account-setup.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function aiWorkspaceAccountRoutes(db: Db) {
  const router = Router(), service = aiWorkspaceAccountService(db), setup = aiWorkspaceAccountSetupService(db);
  const scope = (req: Request): AiWorkspaceAccountScope => {
    assertBoard(req);
    if (!req.actor.userId) throw forbidden("Sign in as the account owner");
    return { userId: req.actor.userId, companyIds: req.actor.companyIds ?? [] };
  };
  router.get("/instance/ai-accounts", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.list(scope(req)));
  });
  router.post("/instance/ai-accounts/enroll", async (req, res) => {
    const actor = scope(req), input = enrollAiWorkspaceAccountSchema.parse(req.body);
    assertCompanyAccess(req, input.sourceCompanyId);
    res.setHeader("Cache-Control", "no-store");
    const account = await service.enroll(actor, input);
    res.json({ ...account, aiAccountSetup: await setup.reconcile(actor, account.id) });
  });
  router.post("/instance/ai-accounts/setup", async (req, res) => {
    const actor = scope(req), input = finishAiWorkspaceAccountSetupSchema.parse(req.body);
    assertCompanyAccess(req, input.companyId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await setup.finishConnection({ ...input, userId: actor.userId }, actor.companyIds));
  });
  router.post("/instance/ai-accounts/:accountId/setup", async (req, res) => {
    const actor = scope(req), accountId = z.uuid().parse(req.params.accountId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await setup.reconcile(actor, accountId));
  });
  router.post("/instance/ai-accounts/companies/:companyId/setup", async (req, res) => {
    const actor = scope(req), companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await setup.inherit(companyId, actor.userId, { ceiling: actor.companyIds }));
  });
  router.get("/instance/ai-accounts/companies/:companyId/setup", async (req, res) => {
    const actor = scope(req), companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await setup.inspectCompany(companyId, actor.userId, actor.companyIds));
  });
  router.patch("/instance/ai-accounts/:accountId", async (req, res) => {
    const actor = scope(req), accountId = z.uuid().parse(req.params.accountId);
    res.setHeader("Cache-Control", "no-store");
    const account = await service.update(actor, accountId, updateAiWorkspaceAccountSchema.parse(req.body));
    res.json({ ...account, aiAccountSetup: await setup.reconcile(actor, account.id) });
  });
  router.post("/instance/ai-accounts/:accountId/companies/:companyId", async (req, res) => {
    const actor = scope(req), accountId = z.uuid().parse(req.params.accountId), companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.install(actor, accountId, companyId, installAiWorkspaceAccountSchema.parse(req.body)));
  });
  router.delete("/instance/ai-accounts/:accountId/companies/:companyId", async (req, res) => {
    const actor = scope(req), accountId = z.uuid().parse(req.params.accountId), companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.revoke(actor, accountId, companyId, installAiWorkspaceAccountSchema.parse(req.body)));
  });
  return router;
}
