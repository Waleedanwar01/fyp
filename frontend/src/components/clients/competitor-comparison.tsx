"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompetitorEntry, FullVisibilityEvidence } from "@/components/clients/use-brand-detail";

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 1000) / 10}%`;
}

/** Brand vs. every tracked competitor, on the same real Visibility Score
 * (design bible #30 "Competitive Constellation" -- rendered as a direct
 * chart + table comparison here rather than a 3D scene, since exact
 * numbers are what this view needs to answer, per the bible's own "every
 * chart should answer a question"). Competitors with no scoreable runs
 * yet show "—", not a 0% that would misleadingly read as "scored zero". */
export function CompetitorComparison({
  brandName,
  brandScore,
  competitors,
}: {
  brandName: string;
  brandScore: FullVisibilityEvidence | null;
  competitors: CompetitorEntry[];
}) {
  const rows = [
    { name: brandName, isOwn: true, score: brandScore },
    ...competitors.map((c) => ({ name: c.competitor.name, isOwn: false, score: c.score })),
  ];

  const chartData = rows.map((r) => ({
    name: r.name,
    value: Math.round((r.score?.visibility_score ?? 0) * 1000) / 10,
    isOwn: r.isOwn,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Competitive Landscape</CardTitle>
        <CardDescription>Visibility Score side by side, from the same real AI runs.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 22, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} unit="%" width={40} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--foreground)",
                }}
                formatter={(value) => [`${value}%`, "Visibility Score"]}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(val: any) => `${val}%`}
                  className="fill-foreground font-mono text-[11px] font-bold"
                />
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.isOwn ? "var(--primary)" : "var(--accent)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entity</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Mention</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Sentiment</TableHead>
              <TableHead>Citation</TableHead>
              <TableHead>Runs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">
                  {row.name}
                  {row.isOwn && <span className="ml-1.5 text-xs text-primary">(you)</span>}
                </TableCell>
                <TableCell>{pct(row.score?.visibility_score)}</TableCell>
                <TableCell>{pct(row.score?.components?.mention_rate)}</TableCell>
                <TableCell>{pct(row.score?.components?.position_score)}</TableCell>
                <TableCell>{pct(row.score?.components?.sentiment_score)}</TableCell>
                <TableCell>{pct(row.score?.components?.citation_score)}</TableCell>
                <TableCell>{row.score?.total_runs ?? 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
