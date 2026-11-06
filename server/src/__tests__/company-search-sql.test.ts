import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { issues, projects, type Db } from "@paperclipai/db";
import { companySearchQuerySchema } from "@paperclipai/shared";
import { routineSearchBranch } from "../services/company-search-routines.js";
import { companyArtifactsService } from "../services/company-artifacts.js";
import { companySearchService } from "../services/company-search.js";

// Exercise Drizzle's actual SQL construction without a socket or fake query
// builder. Persisted authorization semantics are covered by the DB suite.
function recordingDatabase() {
  const statements: Array<{ text: string; params: unknown[] }> = [];
  const db = drizzle(async (text, params) => {
    statements.push({ text, params });
    return { rows: text.includes('from "companies"') ? [["company-1", "PAP"]] : [] };
  }) as unknown as Db;
  return { db, statements };
}

describe("company search SQL boundaries", () => {
  it("narrows conversation retrieval before matching, ranking and facets while retaining native task privacy", async () => {
    const { db, statements } = recordingDatabase();
    const result = await companySearchService(db).search("company-1", companySearchQuerySchema.parse({ q: "launch plan", scope: "conversations" }), {
      issueReadCondition: eq(issues.title, "authorized-chat"),
    });
    expect(result.scope).toBe("conversations");
    const search = statements.find(statement => statement.text.includes("search_flags AS MATERIALIZED"))!;
    expect(search).toBeDefined();
    expect(search.text).toContain('"issues"."conversation_agent_id" is not null');
    expect(search.text).toContain('"issues"."conversation_user_id" is not null');
    expect(search.text).toContain('"issues"."title" =');
    expect(search.params).toContain("authorized-chat");
    expect(search.text).toContain("comment_matches AS MATERIALIZED");
    expect(search.text).toContain("type:issue");
    expect(search.text).not.toContain('"agent_task_sessions"');
  });
  it("binds project and task guards before routine rows, counts and facets", async () => {
    const { db, statements } = recordingDatabase();
    const branch = routineSearchBranch(db, {
      companyId: "company-1", query: companySearchQuerySchema.parse({ q: "needle", scope: "routines", limit: 1 }),
      normalizedQuery: "needle", tokens: ["needle"], containsPattern: "%needle%",
      tokenPatternArray: sql`array[${"%needle%"}]::text[]`, fetchLimit: 2,
      issueReadCondition: eq(issues.title, "readable-task"),
      projectReadCondition: eq(projects.name, "readable-project"),
    });
    await branch.rows();
    await branch.count();
    await branch.facets();
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement.text).toContain('"projects"."id" = "routines"."project_id"');
      expect(statement.text).toContain('"issues"."id" = "routines"."parent_issue_id"');
      expect(statement.text).toContain('"projects"."company_id" =');
      expect(statement.text).toContain('"issues"."company_id" =');
      expect(statement.text).toContain('"issues"."hidden_at" is null');
      expect(statement.params).toContain("readable-task");
      expect(statement.params).toContain("readable-project");
    }
    expect(statements[0].text).toMatch(/order by.*starts_with[\s\S]*limit/s);
    expect(statements[0].params.at(-1)).toBe(2);
    expect(statements[0].text).not.toContain('"env"');
    expect(statements[2].text).toContain("union all");
    // Every facet branch must retain the guards, including filter omission.
    for (const branchSql of statements[2].text.split(" union all ")) {
      expect(branchSql).toContain('"issues"."title" =');
      expect(branchSql).toContain('"projects"."name" =');
    }
  });

  it("limits artifact project metadata in each left join without filtering out shared tasks", async () => {
    const { db, statements } = recordingDatabase();
    await companyArtifactsService(db).list("company-1", { q: "needle" }, {
      issueConditions: [eq(issues.title, "readable-task")],
      projectReadCondition: eq(projects.name, "readable-project"),
    });
    const artifactQueries = statements.filter(statement => statement.text.includes('left join "projects"'));
    expect(artifactQueries).toHaveLength(3);
    for (const { text, params } of artifactQueries) {
      const [joins, where] = text.split(" where ");
      expect(joins).toContain('"projects"."name" =');
      expect(where).not.toContain('"projects"."name" =');
      expect(where).toContain('"issues"."title" =');
      expect(params).toContain("readable-project");
      expect(params).toContain("readable-task");
    }
  });

  it("applies task privacy even when selecting an empty artifact group", async () => {
    const { db, statements } = recordingDatabase();
    const groupIssueId = "11111111-1111-4111-8111-111111111111";
    await companyArtifactsService(db).list("company-1", { groupBy: "task", groupIssueId }, {
      issueConditions: [eq(issues.title, "readable-task")],
    });
    const groupReads = statements.filter(statement => statement.text.includes('from "issues"') && !statement.text.includes(" join "));
    expect(groupReads).toHaveLength(1);
    expect(groupReads[0].text).toContain('"issues"."title" =');
    expect(groupReads[0].text).toContain('"issues"."hidden_at" is null');
    expect(groupReads[0].params).toContain("readable-task");
    expect(groupReads[0].params).toContain(groupIssueId);
  });
});
