"use client";

import { useMemo } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { FullVisibilityEvidence } from "@/components/clients/use-brand-detail";

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: "var(--success)",
  Neutral: "var(--muted-foreground)",
  Negative: "var(--destructive)",
};

/** How the AI's own wording portrays this brand's mentions -- aggregated
 * from Mention.sentiment across every real mention found (design bible
 * #36 "insights should feel extracted from the system"), never a guess
 * about the response as a whole. Empty (no mentions yet) renders nothing
 * rather than a misleading all-one-color chart. */
export function SentimentChart({ score }: { score: FullVisibilityEvidence | null }) {
  const counts = useMemo(() => {
    const tally = { Positive: 0, Neutral: 0, Negative: 0 };
    for (const run of score?.prompt_runs ?? []) {
      for (const mention of run.mentions) {
        if (mention.sentiment === "positive") tally.Positive += 1;
        else if (mention.sentiment === "negative") tally.Negative += 1;
        else tally.Neutral += 1;
      }
    }
    return tally;
  }, [score]);

  const total = counts.Positive + counts.Neutral + counts.Negative;
  const data = (["Positive", "Neutral", "Negative"] as const)
    .map((label) => ({ name: label, value: counts[label] }))
    .filter((d) => d.value > 0);

  const posPct = total > 0 ? Math.round((counts.Positive / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sentiment</CardTitle>
            <CardDescription>Tone of the text around each real mention, not a guess about the whole answer.</CardDescription>
          </div>
          {total > 0 && (
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
              {posPct}% Positive
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No mentions yet to measure sentiment from.</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={SENTIMENT_COLORS[entry.name]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--foreground)",
                    fontSize: "12px",
                  }}
                  formatter={(value, name) => {
                    const count = Number(value);
                    const pctVal = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
                    return [`${count} mention${count === 1 ? "" : "s"} (${pctVal}%)`, name];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)", paddingTop: 8 }}
                  formatter={(value) => {
                    const item = data.find((d) => d.name === value);
                    const count = item?.value ?? 0;
                    const pctVal = total > 0 ? Math.round((count / total) * 100) : 0;
                    return `${value}: ${count} (${pctVal}%)`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
