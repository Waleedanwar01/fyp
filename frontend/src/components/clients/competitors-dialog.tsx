"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  Edit2,
  Plus,
  Search,
  Sparkles,
  Swords,
  Tag,
  Trash2,
} from "lucide-react";

import { FormField } from "@/components/auth/form-field";
import { MatchTester } from "@/components/clients/match-tester";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, extractErrorMessage } from "@/lib/api";
import { competitorSchema, type CompetitorInput } from "@/lib/validation";
import { cn } from "@/lib/utils";

export type CompetitorRecord = {
  id: string;
  client: string;
  name: string;
  aliases: string[];
  created_at: string;
};

const toList = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function CompetitorsDialog({
  clientId,
  clientName,
  competitors,
  onClose,
  onChanged,
}: {
  clientId: string;
  clientName: string;
  competitors: CompetitorRecord[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CompetitorRecord | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  const filteredCompetitors = competitors.filter((c) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.aliases.some((a) => a.toLowerCase().includes(q))
    );
  });

  const deleteCompetitor = async (id: string, name: string) => {
    if (!window.confirm(`Delete competitor "${name}"? This can't be undone.`)) return;
    setRowError(null);
    try {
      await api.delete(`/competitors/${id}/`);
      onChanged();
    } catch (error) {
      setRowError(extractErrorMessage(error));
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-xl max-h-[88vh] flex flex-col p-6 gap-5">
          {/* Header */}
          <DialogHeader className="gap-1.5 pb-3 border-b border-border/70">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <Swords className="size-4.5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  Competitor Intelligence Tracking
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Benchmark rival brands against <strong className="font-semibold text-foreground">{clientName}</strong> in AI search visibility audits.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-lg bg-secondary/70 border border-border/60 px-2.5 py-1 text-xs font-semibold text-foreground font-mono">
                {competitors.length} Tracked Rival{competitors.length === 1 ? "" : "s"}
              </span>
              {competitors.length > 3 && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                  <Input
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filter rivals..."
                    className="h-8 pl-8 pr-3 text-xs w-36 sm:w-44 rounded-lg bg-secondary/20"
                  />
                </div>
              )}
            </div>

            <Button
              type="button"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="h-8 px-3 text-xs font-semibold rounded-lg gap-1.5 shadow-2xs"
            >
              <Plus className="size-3.5" />
              <span>Add Competitor</span>
            </Button>
          </div>

          {rowError && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{rowError}</span>
            </div>
          )}

          {/* Competitors List */}
          {competitors.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center flex flex-col items-center justify-center bg-secondary/10">
              <Swords className="size-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs font-semibold text-foreground">No competitors configured</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-sm">
                Add your direct rivals to compare share of voice, mention frequencies, and citation rankings.
              </p>
            </div>
          ) : filteredCompetitors.length === 0 ? (
            <div className="rounded-xl border border-border/70 p-6 text-center text-xs text-muted-foreground">
              No competitors match &quot;{searchFilter}&quot;.
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5 overflow-y-auto max-h-[52vh] pr-1 no-scrollbar">
              {filteredCompetitors.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs transition-all flex flex-col gap-3",
                    testingId === c.id ? "ring-1 ring-primary/40 border-primary/40" : "hover:border-border hover:shadow-xs"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary border border-border/60 text-foreground font-bold text-xs">
                        {c.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-xs font-bold text-foreground">{c.name}</p>
                        {c.aliases.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {c.aliases.map((alias, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 rounded-md bg-secondary/80 border border-border/60 px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground"
                              >
                                <Tag className="size-2.5 opacity-60" />
                                <span>{alias}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10.5px] text-muted-foreground/70 italic">No aliases set</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        variant={testingId === c.id ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setTestingId(testingId === c.id ? null : c.id)}
                        className="h-8 px-2.5 text-xs rounded-lg gap-1 font-medium"
                      >
                        <Sparkles className="size-3 text-primary" />
                        <span>{testingId === c.id ? "Hide Test" : "Test Match"}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(c)}
                        className="h-8 px-2.5 text-xs rounded-lg gap-1"
                      >
                        <Edit2 className="size-3" />
                        <span>Edit</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteCompetitor(c.id, c.name)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                        title="Delete Competitor"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {testingId === c.id && (
                    <div className="border-t border-border/60 pt-3">
                      <MatchTester testUrl={`/competitors/${c.id}/test-match/`} label="competitor" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {addOpen && (
        <CompetitorFormDialog
          clientId={clientId}
          competitor={null}
          onClose={() => setAddOpen(false)}
          onSaved={onChanged}
        />
      )}

      {editing && (
        <CompetitorFormDialog
          clientId={clientId}
          competitor={editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </>
  );
}

function CompetitorFormDialog({
  clientId,
  competitor,
  onClose,
  onSaved,
}: {
  clientId: string;
  competitor: CompetitorRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CompetitorInput>({
    resolver: zodResolver(competitorSchema),
    defaultValues: { name: competitor?.name ?? "", aliases: competitor?.aliases.join(", ") ?? "" },
  });

  const submit = async (data: CompetitorInput) => {
    setFormError(null);
    try {
      const payload = { name: data.name, aliases: toList(data.aliases) };
      if (competitor) {
        await api.patch(`/competitors/${competitor.id}/`, payload);
      } else {
        await api.post("/competitors/", { client: clientId, ...payload });
      }
      onSaved();
      onClose();
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md p-6 gap-5">
        <DialogHeader className="gap-1.5 pb-2 border-b border-border/70">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Swords className="size-4" />
            </div>
            <DialogTitle className="text-base font-bold text-foreground">
              {competitor ? "Edit Competitor Brand" : "Add Competitor Brand"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            A rival brand to monitor head-to-head in AI visibility audits, plus any alternate aliases it uses.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <FormField label="Competitor Brand Name" htmlFor="competitor-name" error={errors.name?.message} required>
              <Input
                id="competitor-name"
                placeholder="e.g. Daily Deli Co."
                className="rounded-xl text-xs"
                autoFocus
                {...register("name")}
              />
            </FormField>

            <FormField
              label="Aliases & Name Variations"
              htmlFor="competitor-aliases"
              error={errors.aliases?.message}
            >
              <Input
                id="competitor-aliases"
                placeholder="e.g. Daily Deli, DDC Lahore"
                className="rounded-xl text-xs"
                {...register("aliases")}
              />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated alternative names or acronyms.
              </p>
            </FormField>
          </div>

          {formError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {formError}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting} className="rounded-xl text-xs">
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-xl text-xs font-semibold px-4">
              {isSubmitting ? "Saving Competitor…" : competitor ? "Save Changes" : "Add Competitor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
