import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  catalogTeamInstallSchema,
  catalogTeamListQuerySchema,
  catalogTeamPreviewSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { accessService } from "../services/index.js";
import {
  getCatalogTeamOrThrow,
  listCatalogTeams,
  readCatalogTeamFile,
  teamsCatalogService,
} from "../services/teams-catalog.js";
import { forbidden } from "../errors.js";
import { assertAuthenticated, assertCompanyAccess, getActorInfo } from "./authz.js";

export function teamsCatalogRoutes(db: Db) {
  const router = Router();
  const access = accessService(db);
  const svc = teamsCatalogService(db);

  function firstQueryString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return undefined;
  }

  async function assertCanInstallCatalogTeam(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);

    const decision = await access.decide({ actor: req.actor, action: "agents:create", resource: { type: "company", companyId } });
    if (!decision.allowed) throw forbidden(decision.explanation);
  }

  router.get("/teams/catalog", async (req, res) => {
    assertAuthenticated(req);
    const query = catalogTeamListQuerySchema.parse({
      kind: firstQueryString(req.query.kind),
      category: firstQueryString(req.query.category),
      q: firstQueryString(req.query.q),
    });
    res.json(await listCatalogTeams(query));
  });

  router.get("/teams/catalog/:catalogId/files", async (req, res) => {
    assertAuthenticated(req);
    const catalogRef = firstQueryString(req.query.ref) ?? (req.params.catalogId as string);
    const relativePath = firstQueryString(req.query.path) ?? "TEAM.md";
    res.json(await readCatalogTeamFile(catalogRef, relativePath));
  });

  router.get("/teams/catalog/:catalogId", async (req, res) => {
    assertAuthenticated(req);
    const catalogRef = firstQueryString(req.query.ref) ?? (req.params.catalogId as string);
    res.json(await getCatalogTeamOrThrow(catalogRef));
  });

  router.get("/companies/:companyId/teams/catalog/installed", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listInstalledCatalogTeams(companyId));
  });

  router.post(
    "/companies/:companyId/teams/catalog/:catalogId/preview",
    validate(catalogTeamPreviewSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const catalogRef = firstQueryString(req.query.ref) ?? (req.params.catalogId as string);
      assertCompanyAccess(req, companyId);
      const result = await svc.previewCatalogTeamImport(companyId, catalogRef, {
        ...req.body,
        actor: getActorInfo(req),
        authorizationActor: req.actor,
      });
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/teams/catalog/:catalogId/install",
    validate(catalogTeamInstallSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const catalogRef = firstQueryString(req.query.ref) ?? (req.params.catalogId as string);
      await assertCanInstallCatalogTeam(req, companyId);
      const result = await svc.installCatalogTeam(companyId, catalogRef, {
        ...req.body,
        actor: getActorInfo(req),
        authorizationActor: req.actor,
      });
      res.status(201).json(result);
    },
  );

  return router;
}
