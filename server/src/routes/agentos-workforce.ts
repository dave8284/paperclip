import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createAgentosPortfolioSchema, createAgentosEmployeeSchema, createAgentosAssignmentSchema, retireAgentosAssignmentSchema } from "@paperclipai/shared";
import { agentosWorkforceService } from "../services/agentos-workforce.js";
import { assertBoard, getActorInfo } from "./authz.js";

export function agentosWorkforceRoutes(db: Db) {
  const router = Router();
  const service = agentosWorkforceService(db);
  router.use("/agentos/portfolios", (req, _res, next) => { assertBoard(req); next(); });
  const id = (value: unknown) => z.uuid().parse(value);
  router.get("/agentos/portfolios", async (req, res) => res.json(await service.list(req.actor)));
  router.post("/agentos/portfolios", async (req, res) => res.status(201).json(await service.create(req.actor, getActorInfo(req), createAgentosPortfolioSchema.parse(req.body))));
  router.get("/agentos/portfolios/:portfolioId", async (req, res) => res.json(await service.read(req.actor, id(req.params.portfolioId))));
  router.post("/agentos/portfolios/:portfolioId/companies", async (req, res) => {
    const body = z.object({ companyId: z.uuid() }).strict().parse(req.body);
    res.status(201).json(await service.linkCompany(req.actor, getActorInfo(req), id(req.params.portfolioId), body.companyId));
  });
  router.post("/agentos/portfolios/:portfolioId/employees", async (req, res) => res.status(201).json(await service.createEmployee(req.actor, getActorInfo(req), id(req.params.portfolioId), createAgentosEmployeeSchema.parse(req.body))));
  router.post("/agentos/portfolios/:portfolioId/assignments", async (req, res) => res.status(201).json(await service.assign(req.actor, getActorInfo(req), id(req.params.portfolioId), createAgentosAssignmentSchema.parse(req.body))));
  router.post("/agentos/portfolios/:portfolioId/assignments/:assignmentId/retire", async (req, res) => res.json(await service.retire(req.actor, getActorInfo(req), id(req.params.portfolioId), id(req.params.assignmentId), retireAgentosAssignmentSchema.parse(req.body))));
  return router;
}
