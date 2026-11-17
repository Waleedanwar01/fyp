"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  ExternalLink,
  Globe,
  Layers,
  Link2,
  Search,
  Share2,
  Sparkles,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClientScore } from "@/components/dashboard/use-client-visibility";
import { PROVIDER_LABELS } from "@/lib/providers";

type DomainStat = {
  domain: string;
  totalCitations: number;
  uniqueClients: Set<string>;
  sampleUrls: { title: string; url: string }[];
  providerCounts: Record<string, number>;
};

export function CitationReportingView({ entries }: { entries: ClientScore[] | null }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");

  if (!entries) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-4 w-28 rounded bg-muted" />
            </CardHeader>
            <CardContent className="h-28" />
          </Card>
        ))}
      </div>
    );
  }

  // Aggregate domain frequency across all mentions and prompt runs
  const domainMap = new Map<string, DomainStat>();
  let totalCitations = 0;
  let totalMentions = 0;
  const providerCitationCounts: Record<string, number> = {};

  entries.forEach((e) => {
    (e.score?.prompt_runs ?? []).forEach((run) => {
      const p = run.provider || "openai";
      if (!providerCitationCounts[p]) providerCitationCounts[p] = 0;

      run.mentions.forEach((m) => {
        totalMentions += 1;
        (m.citations ?? []).forEach((c) => {
          totalCitations += 1;
          providerCitationCounts[p] += 1;

          let rawDomain = c.domain?.toLowerCase().trim();
          if (!rawDomain && c.url) {
            try {
              rawDomain = new URL(c.url).hostname.replace(/^www\./, "");
            } catch {
              rawDomain = c.url;
            }
          }
          if (!rawDomain) rawDomain = "unknown-source";

          let stat = domainMap.get(rawDomain);
          if (!stat) {
            stat = {
              domain: rawDomain,
              totalCitations: 0,
              uniqueClients: new Set<string>(),
              sampleUrls: [],
              providerCounts: {},
            };
            domainMap.set(rawDomain, stat);
          }

          stat.totalCitations += 1;
          stat.uniqueClients.add(e.client.name);
          if (!stat.providerCounts[p]) stat.providerCounts[p] = 0;
          stat.providerCounts[p] += 1;

          if (stat.sampleUrls.length < 3 && c.url) {
            const alreadyHasUrl = stat.sampleUrls.some((u) => u.url === c.url);
            if (!alreadyHasUrl) {
              stat.sampleUrls.push({
                title: c.title || c.domain || c.url,
                url: c.url,
              });
            }
          }
        });
      });
    });
  });

  // Convert to sorted array
  const domainList = Array.from(domainMap.values()).sort(
    (a, b) => b.totalCitations - a.totalCitations
  );

  const topDomain = domainList[0]?.domain ?? "None yet";
  const uniqueDomainsCount = domainList.length;
  const citationsPerMention = totalMentions > 0 ? (totalCitations / totalMentions).toFixed(2) : "0.00";

  // Filter domain list by search query and provider
  const filteredDomains = domainList.filter((d) => {
    const matchesSearch =
      d.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
      Array.from(d.uniqueClients).some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesProvider =
      selectedProvider === "all" || (d.providerCounts[selectedProvider] ?? 0) > 0;

    return matchesSearch && matchesProvider;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Citations
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Link2 className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-foreground">
              {totalCitations.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Source URLs &amp; references cited by AI engines
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Unique Source Domains
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                <Globe className="size-4 text-emerald-700" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-foreground">
              {uniqueDomainsCount}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Distinct web domains generating authority citations
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Citations Per Mention
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <Layers className="size-4 text-muted-foreground" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-foreground">
              {citationsPerMention}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Average reference density per brand identification
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Top Cited Domain
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <Share2 className="size-4 text-amber-600" />
              </span>
            </div>
            <p className="mt-2 text-xl font-bold font-mono truncate text-foreground" title={topDomain}>
              {topDomain}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Highest frequency source cited in AI responses
            </p>
          </CardContent>
        </Card>
      </div>

      {/* AI Engine Citation Volume Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Citations by AI Engine</CardTitle>
          <CardDescription className="text-xs">
            Volume of grounding source citations returned across each LLM search provider
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {["openai", "claude", "gemini", "perplexity"].map((p) => {
              const count = providerCitationCounts[p] ?? 0;
              const share = totalCitations > 0 ? count / totalCitations : 0;
              return (
                <div
                  key={p}
                  className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">
                      {PROVIDER_LABELS[p] ?? p}
                    </span>
                    <Bot className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-bold font-mono text-foreground">{count}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      ({Math.round(share * 100)}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Source-Domain Frequency Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Source-Domain Frequency Leaderboard</CardTitle>
              <CardDescription className="text-xs">
                Ranking the external publications, platforms, and directory domains cited by AI models
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Filters */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search domain or client brand..."
                className="pl-9 text-xs h-9"
              />
              <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground font-medium">Filter Engine:</span>
              {["all", "openai", "claude", "gemini", "perplexity"].map((p) => (
                <button
                  key={p}
                  onClick={() => setSelectedProvider(p)}
                  className={cn(
                    "rounded-md px-2 py-1 font-medium capitalize transition-colors",
                    selectedProvider === p
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {p === "all" ? "All" : PROVIDER_LABELS[p] ?? p}
                </button>
              ))}
            </div>
          </div>

          {filteredDomains.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No citation domains detected matching the filter.
            </p>
          ) : (
            <div className="max-h-[500px] overflow-x-auto overflow-y-auto rounded-lg border border-border">
              <Table className="min-w-[650px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank &amp; Source Domain</TableHead>
                    <TableHead>Citation Frequency</TableHead>
                    <TableHead>Share of Citations</TableHead>
                    <TableHead>Associated Clients</TableHead>
                    <TableHead>Sample URLs Cited</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDomains.map((item, idx) => {
                    const share = totalCitations > 0 ? (item.totalCitations / totalCitations) * 100 : 0;
                    return (
                      <TableRow key={item.domain}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-secondary text-[11px] font-mono font-semibold text-muted-foreground">
                              #{idx + 1}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <a
                                href={item.domain.startsWith("http://") || item.domain.startsWith("https://") ? item.domain : `https://${item.domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-foreground hover:text-primary hover:underline inline-flex items-center gap-1 transition-colors cursor-pointer"
                                title={`Visit ${item.domain}`}
                              >
                                <span>{item.domain}</span>
                                <ExternalLink className="size-3 text-muted-foreground" />
                              </a>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell>
                          <span className="font-mono font-bold text-foreground">
                            {item.totalCitations}
                          </span>
                          <span className="text-xs text-muted-foreground ml-1">times</span>
                        </TableCell>

                        <TableCell className="w-48">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between text-xs font-mono">
                              <span>{share.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${Math.min(100, Math.round(share))}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {Array.from(item.uniqueClients).map((clientName) => (
                              <span
                                key={clientName}
                                className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
                              >
                                {clientName}
                              </span>
                            ))}
                          </div>
                        </TableCell>

                        <TableCell className="max-w-xs">
                          {item.sampleUrls.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {item.sampleUrls.map((s, i) => {
                                const raw = s.url || s.title;
                                const targetUrl = raw?.startsWith("http://") || raw?.startsWith("https://") ? raw : `https://${raw}`;
                                return (
                                  <a
                                    key={i}
                                    href={targetUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 truncate text-xs text-primary hover:underline cursor-pointer"
                                    title={s.url}
                                  >
                                    <span className="truncate">{s.title || s.url}</span>
                                    <ExternalLink className="size-3 shrink-0" />
                                  </a>
                                );
                              })}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
