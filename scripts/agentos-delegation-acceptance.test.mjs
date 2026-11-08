import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, newAcceptanceState, prepareAcceptance } from "./agentos-delegation-acceptance.mjs";

function controlled() {
  const state = newAcceptanceState(), records = new Map(), calls = [], saved = [];
  let failAfterCommit = null, deny = false;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (deny) throw new Error("Unavailable or unauthorized");
    if (path === "/api/health") return { status: "ok" };
    if (method === "GET") return records.get(path) ?? [];
    const resource = path.split("/").at(-1);
    const key = resource === "companies" ? "company" : resource === "goals" ? "goal" : "project";
    assert.equal(saved.at(-1).resources[key].phase, "creating", "durable intent must precede POST");
    const row = { ...body, id: randomUUID(), ...(resource !== "companies" ? { companyId: path.split("/")[3] } : {}) };
    records.set(path, [...records.get(path) ?? [], row]);
    if (failAfterCommit === key) throw new Error("Reply lost after commit");
    return row;
  };
  return { state, records, calls, saved, prepare: () => prepareAcceptance({ api, state, persist: async value => { saved.push(structuredClone(value)); } }),
    setFailure: value => { failAfterCommit = value; }, deny: () => { deny = true; } };
}
test("preparation creates only native company/planned goal/project and retains unrun acceptance", async () => {
  const f = controlled(), result = await f.prepare();
  assert.equal(result.status, "prepared"); assert.equal(result.acceptance, "not_run");
  assert.equal(f.calls.filter(call => call.method === "POST").length, 3);
  assert.equal(f.calls.find(call => call.path.endsWith("/goals") && call.method === "POST").body.status, "planned");
  assert.equal(f.calls.find(call => call.path.endsWith("/projects") && call.method === "POST").body.goalId, result.goalId);
  assert(!f.calls.some(call => /agents|wakeup|board-directions|keys|permissions|connections|issues/.test(call.path)));
  await f.prepare(); assert.equal(f.calls.filter(call => call.method === "POST").length, 3);
});
for (const resource of ["company", "goal", "project"]) test(`recovers a committed ${resource} after response loss without duplicate writes`, async () => {
  const f = controlled(); f.setFailure(resource);
  await assert.rejects(f.prepare(), /Reply lost/); assert.equal(f.state.resources[resource].phase, "uncertain");
  f.setFailure(null); await f.prepare();
  assert.equal(f.calls.filter(call => call.method === "POST").length, 3);
  assert.equal(f.state.acceptance, "not_run");
});
test("uncertain absence does not license repeating a non-idempotent company create", async () => {
  const f = controlled(); f.state.resources.company = { phase: "uncertain" };
  await assert.rejects(f.prepare(), /unresolved/); assert(!f.calls.some(call => call.method === "POST"));
});
test("inaccessible runtime makes no native changes", async () => {
  const f = controlled(); f.deny(); await assert.rejects(f.prepare(), /Unavailable/);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, "/api/health");
  assert.equal(f.saved.length, 0); assert.deepEqual(f.state.resources, {});
});
test("changed fixture and duplicate resource markers require inspection", async () => {
  const f = controlled(); f.state.fixtureHash = "changed";
  await assert.rejects(f.prepare(), /state or fixture changed/); assert.equal(f.calls.length, 0);
  const duplicate = controlled(), description = `AgentOS test qualification: ${duplicate.state.qualificationId}`;
  duplicate.records.set("/api/companies", [{ id: randomUUID(), description }, { id: randomUUID(), description }]);
  await assert.rejects(duplicate.prepare(), /Multiple company/);
  assert(!duplicate.calls.some(call => call.method === "POST"));
});
test("a removed prepared company is never recreated by setup retry", async () => {
  const f = controlled(); await f.prepare(); f.records.set("/api/companies", []);
  await assert.rejects(f.prepare(), /removed or changed/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 3);
});
test("fictional acceptance arithmetic is internally consistent", () => {
  const f = fixture.facts, a = fixture.expectedArithmetic;
  assert.equal(a.labourCostPerBooking, f.labourMinutesPerBooking * f.labourCostPerHour / 60);
  assert.equal(a.totalCostPerBooking, a.labourCostPerBooking + f.materialsPerBooking + f.travelAllocationPerBooking + f.overheadAllocationPerBooking);
  assert.equal(a.contributionPerBooking, f.pricePerBooking - a.totalCostPerBooking);
  assert.equal(a.contributionMarginPercent, a.contributionPerBooking / f.pricePerBooking * 100);
  assert.equal(a.monthOneRevenue, f.pricePerBooking * f.forecastBookingsMonthOne);
  assert.equal(a.monthOneCost, a.totalCostPerBooking * f.forecastBookingsMonthOne);
  assert.equal(a.monthOneContribution, a.monthOneRevenue - a.monthOneCost);
  assert.equal(a.monthOneCapacity, f.capacityBookingsPerWeek * f.forecastWeeks);
  assert.equal(a.capacityUtilizationPercent, f.forecastBookingsMonthOne / a.monthOneCapacity * 100);
});
