"use client";

import { useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock,
  Coins,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Printer,
  ShieldCheck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, extractErrorMessage } from "@/lib/api";
import { type BillingPeriod, type SubscriptionSummary } from "@/lib/subscription";
import { cn, formatCompactNumber } from "@/lib/utils";

export function InvoiceModal({
  isOpen,
  onClose,
  period,
  subscription,
  agencyName,
  userEmail,
}: {
  isOpen: boolean;
  onClose: () => void;
  period: BillingPeriod | null;
  subscription: SubscriptionSummary | null;
  agencyName?: string;
  userEmail?: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [openingExternal, setOpeningExternal] = useState(false);

  if (!period) return null;

  const planName = subscription?.plan?.name ?? "Growth";
  const monthlyPrice =
    subscription?.plan?.name?.toLowerCase() === "starter"
      ? "$49.00"
      : subscription?.plan?.name?.toLowerCase() === "agency"
      ? "$349.00"
      : "$149.00";

  const periodStartObj = new Date(period.period_start);
  const monthName = periodStartObj.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const invoiceNum = `INV-${period.period_start.replace(/-/g, "").substring(0, 6)}-${(period.id ?? "ACME").substring(0, 6).toUpperCase()}`;

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const endpoint = period.id
        ? `/subscription/history/${period.id}/pdf/`
        : `/subscription/history/current/pdf/`;
      const response = await api.get(endpoint, { responseType: "blob" });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RankLens_Invoice_${monthName.replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert("Could not generate invoice PDF: " + extractErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenExternal = async () => {
    setOpeningExternal(true);
    try {
      const endpoint = period.id
        ? `/subscription/history/${period.id}/pdf/`
        : `/subscription/history/current/pdf/`;
      const response = await api.get(endpoint, { responseType: "blob" });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      alert("Could not open external invoice preview: " + extractErrorMessage(err));
    } finally {
      setOpeningExternal(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl border-border bg-card shadow-2xl p-0 overflow-hidden">
        {/* Modal Header */}
        <div className="bg-secondary/40 border-b border-border p-6 pb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
                  Invoice &amp; Receipt Preview
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Official billing statement for {monthName}
                </DialogDescription>
              </div>
            </div>

            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              <span>Paid &amp; Settled</span>
            </span>
          </div>
        </div>

        {/* Invoice Printable Preview Container */}
        <div className="p-6 max-h-[60vh] overflow-y-auto flex flex-col gap-6 text-sm">
          {/* Top Invoice Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/80 pb-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Invoice Number</p>
              <p className="text-lg font-mono font-bold text-foreground">{invoiceNum}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Billing Period</p>
              <p className="text-sm font-medium text-foreground">
                {period.period_start} &rarr; {period.period_end}
              </p>
            </div>
          </div>

          {/* Billed To & Payment Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-secondary/30 p-4 text-xs">
            <div>
              <p className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider mb-1">
                Billed To
              </p>
              <p className="font-bold text-sm text-foreground">{agencyName ?? "Agency Account"}</p>
              <p className="text-muted-foreground mt-0.5">{userEmail ?? "billing@agency.dev"}</p>
              <p className="text-muted-foreground">United States</p>
            </div>

            <div className="sm:text-right">
              <p className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider mb-1">
                Payment Details
              </p>
              <p className="font-medium text-foreground flex items-center sm:justify-end gap-1.5">
                <CreditCard className="size-3.5 text-primary" />
                <span>VISA ending in <strong>4242</strong></span>
              </p>
              <p className="text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">
                Settled (Test Mode Gateway)
              </p>
              <p className="text-muted-foreground text-[11px]">Next auto-renewal: 1st of next month</p>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="overflow-hidden rounded-xl border border-border/80">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/50 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase">
                <tr>
                  <th className="p-3">Description</th>
                  <th className="p-3 text-center">Allowance</th>
                  <th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                <tr>
                  <td className="p-3 font-medium">
                    <p className="text-foreground font-semibold">RankLens {planName} Tier</p>
                    <p className="text-muted-foreground text-[11px]">
                      Multi-Engine AI Search Visibility, Sentiments &amp; Citation Audits
                    </p>
                  </td>
                  <td className="p-3 text-center font-medium">
                    {period.base_prompt_run_allowance.toLocaleString()} Runs / mo
                  </td>
                  <td className="p-3 text-right font-bold text-foreground">{monthlyPrice}</td>
                </tr>
                <tr>
                  <td className="p-3 font-medium">
                    <p className="text-foreground">AI Citation &amp; Evidence Grounding</p>
                    <p className="text-muted-foreground text-[11px]">OpenAI, Claude, Gemini &amp; Perplexity trace</p>
                  </td>
                  <td className="p-3 text-center text-muted-foreground">Included</td>
                  <td className="p-3 text-right text-muted-foreground">$0.00</td>
                </tr>
                <tr>
                  <td className="p-3 font-medium">
                    <p className="text-foreground">Zero Data-Loss Archive &amp; RLS Isolation</p>
                    <p className="text-muted-foreground text-[11px]">Strict multi-tenant security</p>
                  </td>
                  <td className="p-3 text-center text-muted-foreground">Included</td>
                  <td className="p-3 text-right text-muted-foreground">$0.00</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Summary Breakdown */}
          <div className="flex flex-col gap-1.5 border-t border-border pt-4 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{monthlyPrice}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Estimated Tax (0%)</span>
              <span>$0.00</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-foreground">
              <span>Total Paid</span>
              <span className="text-primary">{monthlyPrice} USD</span>
            </div>
          </div>
        </div>

        {/* Modal Action Footer */}
        <div className="bg-secondary/40 border-t border-border p-4 px-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Close
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenExternal}
              disabled={openingExternal}
              className="text-xs gap-1.5"
            >
              {openingExternal ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ExternalLink className="size-3.5" />
              )}
              <span>External View</span>
            </Button>

            <Button
              size="sm"
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="text-xs gap-1.5 bg-primary text-primary-foreground font-semibold"
            >
              {downloading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              <span>Download PDF</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
