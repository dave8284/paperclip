// Policy programs yield storage requests. The embedded driver resolves them
// synchronously; remote drivers await them. Policy rules have one owner in both
// cases. These internal programs never open connections or own transactions.
export const storageRequests = {
  prepare(sql) {
    return Object.fromEntries(["get", "all", "run"].map(method => [method, (...parameters) => ({ kind: "query", sql, method, parameters })]));
  },
};
export const readOnlyMethods = new Set([
  "selectionReceipt", "analytics", "comparisonDefinition", "comparisonCatalog", "comparisonReport",
  "routingRollouts", "hasRoutingRelease", "routingPolicy", "nextRoutingDeadline",
]);

// Ordering identifiers are int64, not JSON numbers. Other public counters and
// deadlines have a safe-number contract; reject overflow instead of rounding.
export function normalizeStorageRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value === null || !["bigint", "number"].includes(typeof value)) return [key, value];
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Stored integer exceeds the supported range");
    if (["rowid", "sequence", "receipt_cutoff"].includes(key)) return [key, BigInt(value)];
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error("Stored integer exceeds the supported range");
    return [key, number];
  })));
}
export function* mapEffects(items, visit) {
  const result = [];
  for (const item of items) result.push(yield* visit(item));
  return result;
}
export function* findEffects(items, matches) {
  for (const item of items) if (yield* matches(item)) return item;
}
export function runSync(program, resolve) {
  let step = program.next();
  while (!step.done) {
    let value;
    try { value = resolve(step.value); }
    catch (error) { step = program.throw(error); continue; }
    step = program.next(value);
  }
  return step.value;
}
export async function runAsync(program, resolve) {
  let step = program.next();
  while (!step.done) {
    let value;
    try { value = await resolve(step.value); }
    catch (error) { step = program.throw(error); continue; }
    step = program.next(value);
  }
  return step.value;
}
export function routingSubscriptions() {
  const listeners = new Set();
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    notify() { for (const listener of listeners) { try { listener(); } catch { /* Committed evidence remains committed. */ } } },
    clear() { listeners.clear(); },
  };
}
