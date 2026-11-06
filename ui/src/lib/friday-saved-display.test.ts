import { describe, expect, it } from "vitest";
import type { IssueDocument } from "@paperclipai/shared";
import { parseFridaySavedDisplay, savedFridayDisplays, scopedFridaySavedDisplay, type FridayDisplayScope } from "./friday-saved-display";

const companyId = "00000000-0000-4000-8000-000000000001", projectId = "00000000-0000-4000-8000-000000000002";
const body = { version: 1, kind: "table", title: "Current launch work", source: "tasks", companyId, projectId };
const document = { issueId: "conversation", companyId: "source", key: "friday-display-launch", body: JSON.stringify(body) } as IssueDocument;
const scope: FridayDisplayScope = { issueId: "conversation", sourceCompanyId: "source", accessibleCompanyIds: [companyId], companyId, projectId };
describe("saved live display contract", () => {
  it("accepts bounded native tables and supplies safe defaults", () => {
    expect(parseFridaySavedDisplay(document.body)).toEqual({ ...body, status: "all", limit: 50 });
    expect(parseFridaySavedDisplay(JSON.stringify({ ...body, source: "projects", limit: 100 }))).toMatchObject({ source: "projects", limit: 100 });
  });
  it("accepts registered lists and task boards while rejecting unsupported board sources", () => {
    expect(parseFridaySavedDisplay(JSON.stringify({ ...body, kind: "list", source: "projects" }))).toMatchObject({ kind: "list", source: "projects" });
    expect(parseFridaySavedDisplay(JSON.stringify({ ...body, kind: "board" }))).toMatchObject({ kind: "board", source: "tasks" });
    expect(parseFridaySavedDisplay(JSON.stringify({ ...body, kind: "board", source: "projects" }))).toBeNull();
  });
  it.each([{ version: 2 }, { kind: "html" }, { source: "credentials" }, { companyId: "all" }, { projectId: null }, { status: "deleted" }, { status: null }, { limit: 0 }, { limit: 101 }, { limit: "50" }, { limit: null }, { url: "https://other.invalid" }, { code: "fetch('/api/secrets')" }, { title: " " }, { title: "x".repeat(121) }, { source: "projects", status: "active" }])("rejects unsupported or executable fields: %j", patch => {
    expect(parseFridaySavedDisplay(JSON.stringify({ ...body, ...patch }))).toBeNull();
  });
  it("rejects invalid and oversized JSON", () => {
    for (const value of ["null", "[]", "<script/>", " ".repeat(8193)]) expect(parseFridaySavedDisplay(value)).toBeNull();
  });
  it("requires the authorized conversation and selected company/project without expanding scope", () => {
    expect(scopedFridaySavedDisplay(document, scope)).not.toBeNull();
    for (const patch of [{ issueId: "other" }, { sourceCompanyId: "other" }, { companyId: projectId }, { projectId: companyId }, { accessibleCompanyIds: [] }]) {
      expect(scopedFridaySavedDisplay(document, { ...scope, ...patch })).toBeNull();
    }
    expect(scopedFridaySavedDisplay({ ...document, key: "friday-display-../../secrets" }, scope)).toBeNull();
    const companyWide = { ...document, body: JSON.stringify({ ...body, projectId: undefined }) };
    expect(savedFridayDisplays([document, companyWide], scope)).toHaveLength(1);
    expect(savedFridayDisplays([companyWide], { ...scope, projectId: undefined, companyId: undefined })).toHaveLength(1);
  });
});
