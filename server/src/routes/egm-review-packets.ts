import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { prepareEgmPacketSchema, clearEgmPacketSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { egmReviewPacketService } from "../services/native-runtime/egm-review-packets.js";

/** Native task/run resource. Service owns current actor, source and reviewer
 * authorization inside admission locks, including direct non-HTTP callers. */
export function egmReviewPacketRoutes(db: Db) {
  const router = Router(), service = egmReviewPacketService(db);
  const params = z.object({ id: z.string().uuid(), sourceRunId: z.string().uuid() });
  const scope = (value: unknown) => { const p = params.parse(value); return { issueId: p.id, sourceRunId: p.sourceRunId }; };
  const path = "/issues/:id/runs/:sourceRunId/egm-packet";
  router.put(path, validate(prepareEgmPacketSchema), async (req, res) => { res.json(await service.prepare(req.actor, scope(req.params), req.body)); });
  router.get(path, async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await service.read(req.actor, scope(req.params))); });
  router.delete(path, validate(clearEgmPacketSchema), async (req, res) => { res.json(await service.clear(req.actor, scope(req.params), req.body.requestSha256)); });
  return router;
}
