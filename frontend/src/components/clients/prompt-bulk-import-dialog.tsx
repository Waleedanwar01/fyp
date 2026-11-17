"use client";

import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  UploadCloud,
  XCircle,
} from "lucide-react";

import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, extractErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const CSV_TEMPLATE = [
  "text,category,service_tags,location_tags,schedule,is_active",
  '"Which restaurant serves the best crispy chicken burgers in Lahore?",Discovery & Fast Food,Crispy Chicken Fillets,Lahore;Gulberg Lahore,daily,true',
  '"Top rated local fast food spots in DHA Lahore for students",Local Search Intent,Gourmet Burgers,DHA Lahore;Johar Town Lahore,daily,true',
].join("\n");

type ImportError = { row: number; errors: Record<string, unknown> };
type ImportResult = { created: number; errors: ImportError[] };

const flattenRowErrors = (errors: Record<string, unknown>) =>
  Object.entries(errors)
    .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(", ") : String(messages)}`)
    .join("; ");

function downloadCsvTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "avtr-prompts-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function PromptBulkImportDialog({
  clientId,
  clientName,
  onClose,
  onImported,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);
  const [defaultCategory, setDefaultCategory] = useState("");
  const [defaultLocationTags, setDefaultLocationTags] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const submit = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setFormError("Please select a CSV file to upload.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("client", clientId);
      formData.append("file", file);
      if (defaultCategory.trim()) formData.append("default_category", defaultCategory.trim());
      if (defaultLocationTags.trim()) formData.append("default_location_tags", defaultLocationTags.trim());
      const { data } = await api.post<ImportResult>("/prompts/bulk-import/", formData);
      setResult(data);
      if (data.created > 0) onImported();
    } catch (error) {
      setFormError(extractErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto p-6 gap-5">
        <DialogHeader className="gap-1.5 pb-3 border-b border-border/70">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <FileSpreadsheet className="size-4.5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  Bulk Import Prompts from CSV
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Upload multiple search queries for <strong className="font-semibold text-foreground">{clientName}</strong> in a single batch.
                </DialogDescription>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadCsvTemplate}
              className="h-8 px-2.5 text-xs rounded-lg gap-1.5 shrink-0 hidden sm:inline-flex"
            >
              <Download className="size-3" />
              <span>CSV Template</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Default Tags Settings */}
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-secondary/15 p-4">
            <span className="text-xs font-semibold text-foreground">
              Default Metadata (Applied to rows missing category/locations)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Default Category" htmlFor="default-category">
                <Input
                  id="default-category"
                  placeholder="e.g. Local Search Intent"
                  className="rounded-xl text-xs bg-background"
                  value={defaultCategory}
                  onChange={(e) => setDefaultCategory(e.target.value)}
                />
              </FormField>
              <FormField label="Default Location(s)" htmlFor="default-location-tags">
                <Input
                  id="default-location-tags"
                  placeholder="e.g. Lahore, Gulberg"
                  className="rounded-xl text-xs bg-background"
                  value={defaultLocationTags}
                  onChange={(e) => setDefaultLocationTags(e.target.value)}
                />
              </FormField>
            </div>
          </div>

          {/* Upload Dropzone */}
          <label
            htmlFor="prompt-csv-file"
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-all",
              fileName
                ? "border-primary/50 bg-primary/5"
                : "border-border/80 bg-card hover:border-primary/40 hover:bg-secondary/20"
            )}
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <UploadCloud className="size-5" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-foreground">
                {fileName ? fileName : "Click to select or drop a CSV file"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {fileSize ? `${fileSize} • Ready to import` : "Supports up to 500 queries per batch (max 1 MB)"}
              </span>
            </div>
            <input
              id="prompt-csv-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setFileName(file.name);
                  setFileSize(`${(file.size / 1024).toFixed(1)} KB`);
                } else {
                  setFileName(null);
                  setFileSize(null);
                }
                setResult(null);
                setFormError(null);
              }}
            />
          </label>

          <div className="sm:hidden">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadCsvTemplate}
              className="w-full h-8 text-xs rounded-lg gap-1.5"
            >
              <Download className="size-3" />
              <span>Download CSV Template</span>
            </Button>
          </div>

          {formError && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* Result Card */}
          {result && (
            <div className="flex flex-col gap-2 rounded-xl border border-border/80 bg-card p-4 shadow-2xs">
              <div className="flex items-center gap-2">
                {result.created > 0 ? (
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="size-4 text-destructive" />
                )}
                <span className="text-xs font-bold text-foreground">
                  {result.created} prompt{result.created === 1 ? "" : "s"} successfully imported
                </span>
              </div>

              {result.errors.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2 text-xs">
                  <span className="text-destructive font-semibold text-[11px]">
                    {result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped due to errors:
                  </span>
                  <ul className="max-h-28 list-disc overflow-y-auto pl-4 text-[11px] text-muted-foreground space-y-0.5">
                    {result.errors.map((rowErr) => (
                      <li key={rowErr.row}>
                        <strong>Row {rowErr.row}:</strong> {flattenRowErrors(rowErr.errors)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting} className="rounded-xl text-xs">
            {result ? "Done" : "Cancel"}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={isSubmitting || !fileName}
            className="rounded-xl text-xs font-semibold px-4"
          >
            {isSubmitting ? "Importing Prompts…" : "Start CSV Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
