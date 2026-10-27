import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { companiesApi } from "@/api/companies";
import { projectsApi } from "@/api/projects";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "./ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

/** Native APIs own authorization, retention rules and deletion. Opening a
 * confirmation never mutates a record; failure leaves the record in place. */
export function AgentOSDelete({ kind, id, companyId, name, compact = false, onRemoved }: {
  kind: "company" | "project" | "task"; id: string; companyId: string; name: string;
  compact?: boolean; onRemoved?: () => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const action = useMutation({
    mutationFn: async (archive: boolean) => {
      if (archive && kind === "company") return companiesApi.archive(id);
      if (archive && kind === "project") return projectsApi.update(id, { archivedAt: new Date().toISOString() }, companyId);
      if (kind === "company") return companiesApi.remove(id);
      if (kind === "project") return projectsApi.remove(id, companyId);
      return issuesApi.remove(id);
    },
    onSuccess: async () => {
      setOpen(false); onRemoved?.();
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.companies.all }),
        client.invalidateQueries({ predicate: query => query.queryKey.includes(companyId) || query.queryKey.includes(id) }),
      ]);
    },
  });
  return <><Button type="button" className={compact ? "agentos-card-delete" : undefined} variant="ghost" size={compact ? "icon-sm" : "sm"} aria-label={`Delete ${kind}: ${name}`} onClick={() => { action.reset(); setConfirmation(""); setOpen(true); }}><Trash2 />{!compact && `Delete ${kind}`}</Button>
    <AlertDialog open={open} onOpenChange={next => { if (!action.isPending) setOpen(next); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {name}?</AlertDialogTitle><AlertDialogDescription>
        {kind === "company" ? "This permanently removes this company and its company-owned work, agents and history. Shared employees assigned to other companies are retained. The portfolio administration company cannot be permanently deleted."
          : kind === "project" ? "This permanently removes this project. Linked tasks, accounting records or retained workspaces can prevent deletion; archive it to keep its work and history."
            : "This permanently removes this task and its attached conversation and outputs. Other records that depend on it can prevent deletion."}
      </AlertDialogDescription></AlertDialogHeader>
      <label className="space-y-2 text-sm"><span>Type <strong>{name}</strong> to confirm permanent deletion.</span><input aria-label="Confirm name to delete" className="w-full rounded-lg border bg-background px-3 py-2" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={action.isPending} /></label>
      {action.error && <p role="alert" className="text-sm text-destructive">{action.error.message}</p>}
      <AlertDialogFooter><Button variant="ghost" disabled={action.isPending} onClick={() => setOpen(false)}>Cancel</Button>{kind !== "task" && <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate(true)}>Archive instead</Button>}<Button variant="destructive" disabled={action.isPending || confirmation !== name} onClick={() => action.mutate(false)}>{action.isPending ? "Applying…" : `Delete ${kind}`}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
