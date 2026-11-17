"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Calendar,
  CheckCircle2,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchClientPdfBlob,
  downloadPdfBlob,
  openPdfBlobInNewTab,
} from "@/lib/pdf-export";
import { extractErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

type ClientOption = {
  id: string;
  name: string;
};

type DatePreset = "all" | "7d" | "30d" | "90d" | "month" | "custom";

function formatIsoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function PdfExportModal({
  isOpen,
  onClose,
  initialClientId,
  initialClientName,
  clients = [],
  initialDateFilter,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialClientId?: string;
  initialClientName?: string;
  clients?: ClientOption[];
  initialDateFilter?: { since: string | null; until: string | null };
}) {
  const [selectedClientId, setSelectedClientId] = useState<string>(
    initialClientId || (clients[0]?.id ?? "")
  );
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>(
    initialDateFilter?.since ? "custom" : "all"
  );
  const [since, setSince] = useState<string>(initialDateFilter?.since ?? "");
  const [until, setUntil] = useState<string>(initialDateFilter?.until ?? "");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  // Sync initial client ID if passed
  useEffect(() => {
    if (initialClientId) {
      setSelectedClientId(initialClientId);
    } else if (clients.length > 0 && !selectedClientId) {
      setSelectedClientId(clients[0].id);
    }
  }, [initialClientId, clients, selectedClientId]);

  // Handle Preset Changes
  const applyPreset = (preset: DatePreset) => {
    setSelectedPreset(preset);
    const today = new Date();
    const todayStr = formatIsoDate(today);

    if (preset === "all") {
      setSince("");
      setUntil("");
    } else if (preset === "7d") {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setSince(formatIsoDate(d));
      setUntil(todayStr);
    } else if (preset === "30d") {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setSince(formatIsoDate(d));
      setUntil(todayStr);
    } else if (preset === "90d") {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      setSince(formatIsoDate(d));
      setUntil(todayStr);
    } else if (preset === "month") {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      setSince(formatIsoDate(firstDay));
      setUntil(todayStr);
    }
  };

  // Generate / Fetch PDF Blob
  const generatePdf = useCallback(async () => {
    if (!selectedClientId) return;
    setIsLoading(true);
    setError(null);

    try {
      if (pdfBlobUrl) {
        window.URL.revokeObjectURL(pdfBlobUrl);
        setPdfBlobUrl(null);
      }

      const { blob, blobUrl } = await fetchClientPdfBlob({
        clientId: selectedClientId,
        since: since || null,
        until: until || null,
      });

      setPdfBlob(blob);
      setPdfBlobUrl(blobUrl);
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Failed to compile PDF report.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, since, until, pdfBlobUrl]);

  // Load PDF on open or client change
  useEffect(() => {
    if (isOpen && selectedClientId) {
      generatePdf();
    }
    return () => {
      if (pdfBlobUrl) {
        window.URL.revokeObjectURL(pdfBlobUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedClientId]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const clientName = selectedClient?.name || initialClientName || "Client";

  const handleDownload = () => {
    if (!pdfBlob) return;
    const cleanName = clientName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const dateSuffix = since
      ? `_${since.replace(/-/g, "")}${until ? `_to_${until.replace(/-/g, "")}` : ""}`
      : "_all_time";
    downloadPdfBlob(pdfBlob, `${cleanName}_ai_visibility_report${dateSuffix}.pdf`);
  };

  const handleOpenNewTab = () => {
    if (pdfBlobUrl) {
      openPdfBlobInNewTab(pdfBlobUrl);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] w-full max-w-5xl overflow-hidden p-0 sm:max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/80 bg-card px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <FileDown className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground sm:text-lg">
                Executive AI Visibility PDF Report
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                White-label multi-model audit report with customizable date filtering &amp; live preview.
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* 2-Column Body: Controls on Left, PDF Viewer on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[560px] max-h-[calc(92vh-130px)] overflow-y-auto">
          {/* Left Column: Filter & Client Settings (4 cols) */}
          <div className="flex flex-col justify-between border-r border-border/70 bg-card p-5 lg:col-span-4 gap-5">
            <div className="flex flex-col gap-4">
              {/* Client Selection */}
              {clients.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-foreground">Select Brand / Client</label>
                  <select
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Date Range Presets */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">Reporting Date Range</label>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {since ? `${since} → ${until || "Today"}` : "All-Time Records"}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  {[
                    { id: "all", label: "All Time" },
                    { id: "7d", label: "Last 7 Days" },
                    { id: "30d", label: "Last 30 Days" },
                    { id: "90d", label: "Last 90 Days" },
                    { id: "month", label: "This Month" },
                    { id: "custom", label: "Custom Range" },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id as DatePreset)}
                      className={cn(
                        "rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-all text-center",
                        selectedPreset === p.id
                          ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "border-border/70 bg-secondary/30 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Custom Date Inputs */}
                {selectedPreset === "custom" && (
                  <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-border/80 bg-secondary/20 p-2.5">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">Start Date (Since)</span>
                      <Input
                        type="date"
                        value={since}
                        onChange={(e) => setSince(e.target.value)}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">End Date (Until)</span>
                      <Input
                        type="date"
                        value={until}
                        onChange={(e) => setUntil(e.target.value)}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Report Contents Highlights */}
              <div className="rounded-xl border border-border/60 bg-secondary/25 p-3 text-xs">
                <span className="font-semibold text-foreground block mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Included Sections:
                </span>
                <ul className="space-y-1.5 text-[11px] text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                    <span>Executive Summary &amp; 4-Pillar Score</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                    <span>Multi-Engine Breakdown (ChatGPT, Gemini, etc.)</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                    <span>Competitive Share of Voice &amp; Head-to-Head</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                    <span>Prompt Ranking Evidence &amp; Citations</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Action Buttons in Left Panel */}
            <div className="flex flex-col gap-2 pt-3 border-t border-border/60">
              <Button
                onClick={generatePdf}
                disabled={isLoading}
                variant="outline"
                className="w-full gap-2 text-xs font-semibold h-9"
              >
                {isLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                <span>Update Preview with Selected Date</span>
              </Button>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={handleOpenNewTab}
                  disabled={!pdfBlobUrl || isLoading}
                  variant="secondary"
                  className="gap-1.5 text-xs font-semibold h-9"
                  title="Open full-screen PDF in a new browser tab"
                >
                  <ExternalLink className="size-3.5" />
                  <span>Open Tab</span>
                </Button>

                <Button
                  onClick={handleDownload}
                  disabled={!pdfBlob || isLoading}
                  className="gap-1.5 text-xs font-semibold h-9 shadow-xs"
                >
                  <Download className="size-3.5" />
                  <span>Download PDF</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Live PDF Preview (8 cols) */}
          <div className="flex flex-col bg-muted/20 p-4 lg:col-span-8 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FileText className="size-3.5 text-primary" />
                <span>Live Interactive PDF Preview</span>
              </span>
              {pdfBlobUrl && (
                <button
                  onClick={handleOpenNewTab}
                  className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span>Open in Full Window</span>
                  <ExternalLink className="size-3" />
                </button>
              )}
            </div>

            {isLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-border bg-card p-12 text-center shadow-inner min-h-[480px]">
                <Loader2 className="size-8 animate-spin text-primary mb-3" />
                <h4 className="text-sm font-bold text-foreground">Compiling Executive PDF Report</h4>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  Fetching multi-model AI audit logs, calculating visibility metrics, and rendering high-resolution ReportLab document...
                </p>
              </div>
            ) : error ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 p-12 text-center min-h-[480px]">
                <p className="text-sm font-semibold text-destructive">{error}</p>
                <Button
                  onClick={generatePdf}
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-1.5 text-xs"
                >
                  <RefreshCw className="size-3.5" />
                  <span>Retry PDF Generation</span>
                </Button>
              </div>
            ) : pdfBlobUrl ? (
              <iframe
                src={pdfBlobUrl}
                className="w-full flex-1 rounded-xl border border-border/80 bg-white shadow-xs min-h-[500px]"
                title="White-label AI Visibility PDF Report Preview"
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-border/60 bg-card p-12 text-center min-h-[480px]">
                <Sparkles className="size-6 text-muted-foreground/50 mb-2" />
                <p className="text-xs text-muted-foreground">Select a client and click Generate Preview.</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
