import { afterEach, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
const mock = vi.hoisted(() => ({ product: vi.fn() }));
vi.mock("../services/model-intelligence.js", () => ({ modelIntelligenceProduct: mock.product }));
import { modelRoutingDeliveryService } from "../services/model-routing-delivery.js";
afterEach(() => { vi.clearAllMocks(); });

it("awaits remote deadlines only during reconciliation and keeps scheduler reads free of I/O", async () => {
  let release!: (value: number | null) => void;
  const deadline = vi.fn(() => new Promise<number | null>(resolve => { release = resolve; }));
  mock.product.mockReturnValue({ nextRoutingDeadline: deadline });
  const limit = vi.fn(async () => []), db = { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) } as unknown as Db;
  const service = modelRoutingDeliveryService(db);
  expect(service.nextRunAt()).toBeNull(); expect(deadline).not.toHaveBeenCalled();
  const pending = service.hasPending(); expect(limit).not.toHaveBeenCalled();
  release(123456); expect(await pending).toBe(false); expect(service.nextRunAt()).toBe(123456);
  for (let i = 0; i < 20; i++) expect(service.nextRunAt()).toBe(123456);
  expect(deadline).toHaveBeenCalledOnce();
  deadline.mockRejectedValueOnce(new Error("Storage unavailable")); await expect(service.hasPending()).rejects.toThrow("Storage unavailable");
  expect(service.nextRunAt()).toBe(123456);
  mock.product.mockReturnValue(null); expect(await service.hasPending()).toBe(false); expect(service.nextRunAt()).toBeNull();
});
