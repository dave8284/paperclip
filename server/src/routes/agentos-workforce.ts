import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createAgentosPortfolioSchema, createAgentosEmployeeSchema, createAgentosAssignmentSchema, retireAgentosAssignmentSchema,
  publishAgentosCapabilitySchema, decideAgentosCapabilitySchema, savePortfolioReadMandateSchema, revokePortfolioReadMandateSchema, setBoardDirectionAuthoritySchema } from "@paperclipai/shared";
import { agentosWorkforceService } from "../services/agentos-workforce.js";
import { agentosCapabilityService } from "../services/agentos-capabilities.js";
import { agentosPortfolioMandateService } from "../services/agentos-portfolio-mandates.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function agentosWorkforceRoutes(db: Db) {
  const router = Router();
  const service = agentosWorkforceService(db);
  const capabilities = agentosCapabilityService(db);
  const mandates = agentosPortfolioMandateService(db);
  const id = (value: unknown) => z.uuid().parse(value);
  router.get("/companies/:companyId/workforce", async (req, res) => {
    const companyId = id(req.params.companyId);
    assertCompanyAccess(req, companyId);
    res.json(await service.readCompany(req.actor, companyId));
  });
  router.post("/companies/:companyId/workforce/assignments", async (req, res) => {
    const companyId = id(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const input = createAgentosAssignmentSchema.omit({ companyId: true }).parse(req.body);
    res.status(201).json(await service.assignCompany(req.actor, getActorInfo(req), companyId, input));
  });
  router.post("/companies/:companyId/workforce/assignments/:assignmentId/retire", async (req, res) => {
    const companyId = id(req.params.companyId);
    assertCompanyAccess(req, companyId);
    res.json(await service.retireCompany(req.actor, getActorInfo(req), companyId, id(req.params.assignmentId), retireAgentosAssignmentSchema.parse(req.body)));
  });
  router.use("/agentos/portfolios", (req, _res, next) => { assertBoard(req); next(); });
  router.get("/agentos/portfolios", async (req, res) => res.json(await service.list(req.actor)));
  router.post("/agentos/portfolios", async (req, res) => res.status(201).json(await service.create(req.actor, getActorInfo(req), createAgentosPortfolioSchema.parse(req.body))));
  router.get("/agentos/portfolios/:portfolioId", async (req, res) => res.json(await service.read(req.actor, id(req.params.portfolioId))));
  router.get("/agentos/portfolios/:portfolioId/read-mandates", async (req, res) =>
    res.set("Cache-Control", "no-store").json(await mandates.list(req.actor, id(req.params.portfolioId))));
  router.post("/agentos/portfolios/:portfolioId/read-mandates", async (req, res) =>
    res.json(await mandates.save(req.actor, getActorInfo(req), id(req.params.portfolioId), savePortfolioReadMandateSchema.parse(req.body))));
  router.post("/agentos/portfolios/:portfolioId/read-mandates/:mandateId/revoke", async (req, res) =>
    res.json(await mandates.revoke(req.actor, getActorInfo(req), id(req.params.portfolioId), id(req.params.mandateId), revokePortfolioReadMandateSchema.parse(req.body).expectedRevision)));
  router.post("/agentos/portfolios/:portfolioId/read-mandates/:mandateId/board-direction-authority", async (req, res) =>
    res.json(await mandates.setBoardDirectionAuthority(req.actor, getActorInfo(req), id(req.params.portfolioId), id(req.params.mandateId), setBoardDirectionAuthoritySchema.parse(req.body))));
  router.get("/agentos/portfolios/:portfolioId/employees/:employeeId/capabilities", async (req, res) =>
    res.json(await capabilities.read(req.actor, id(req.params.portfolioId), id(req.params.employeeId), z.coerce.number().int().min(0).max(100000).parse(req.query.offset ?? 0))));
  router.post("/agentos/portfolios/:portfolioId/capabilities", async (req, res) =>
    res.status(201).json(await capabilities.publish(req.actor, getActorInfo(req), id(req.params.portfolioId), publishAgentosCapabilitySchema.parse(req.body))));
  router.post("/agentos/portfolios/:portfolioId/assignments/:assignmentId/capabilities", async (req, res) =>
    res.json(await capabilities.decide(req.actor, getActorInfo(req), id(req.params.portfolioId), id(req.params.assignmentId), decideAgentosCapabilitySchema.parse(req.body))));
  router.post("/agentos/portfolios/:portfolioId/companies", async (req, res) => {
    const body = z.object({ companyId: z.uuid() }).strict().parse(req.body);
    res.status(201).json(await service.linkCompany(req.actor, getActorInfo(req), id(req.params.portfolioId), body.companyId));
  });
  router.post("/agentos/portfolios/:portfolioId/employees", async (req, res) => res.status(201).json(await service.createEmployee(req.actor, getActorInfo(req), id(req.params.portfolioId), createAgentosEmployeeSchema.parse(req.body))));
  router.post("/agentos/portfolios/:portfolioId/assignments", async (req, res) => res.status(201).json(await service.assign(req.actor, getActorInfo(req), id(req.params.portfolioId), createAgentosAssignmentSchema.parse(req.body))));
  router.post("/agentos/portfolios/:portfolioId/assignments/:assignmentId/retire", async (req, res) => res.json(await service.retire(req.actor, getActorInfo(req), id(req.params.portfolioId), id(req.params.assignmentId), retireAgentosAssignmentSchema.parse(req.body))));
  return router;
}
