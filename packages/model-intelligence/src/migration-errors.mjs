export class ModelMigrationError extends Error {}
export const safeMigrationOperation = fn => async (...args) => {
  try { return await fn(...args); }
  catch (error) {
    if (error instanceof ModelMigrationError) throw error;
    const code = typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? ` (${error.code})` : "";
    throw new ModelMigrationError(`Migration could not be confirmed${code}; retry only with the same destination and manifest`);
  }
};
