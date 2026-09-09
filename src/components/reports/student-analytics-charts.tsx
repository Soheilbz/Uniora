"use client";

import { useFormatter, useLocale } from "next-intl";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const colorAt = (index: number) => COLORS[index % COLORS.length] as string;

export function StudentTrendChart({
  points,
  yearLabels,
  empty,
  countLabel,
}: {
  points: { year: number; count: number }[];
  yearLabels: Record<string, string>;
  empty: string;
  countLabel: string;
}) {
  const format = useFormatter();
  if (!points.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ChartContainer
      config={{ count: { label: countLabel, color: "var(--chart-1)" } }}
      className="h-64 w-full min-h-64 aspect-auto"
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={200}
        initialDimension={{ width: 1, height: 200 }}
      >
        <LineChart
          data={points.map((point) => ({
            ...point,
            yearLabel: yearLabels[String(point.year)] ?? String(point.year),
          }))}
          margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
        >
          <XAxis dataKey="yearLabel" tickLine={false} axisLine={false} tickMargin={10} />
          <YAxis
            allowDecimals={false}
            width={32}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => format.number(Number(value))}
          />
          <Tooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltipContent />} />
          <Line
            type="monotone"
            dataKey="count"
            name="count"
            stroke="var(--chart-1)"
            strokeWidth={3}
            dot={{ r: 4, fill: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function StudentCompositionChart({
  rows,
  labels,
  empty,
}: {
  rows: { value: string; count: number }[];
  labels: Record<string, string>;
  empty: string;
}) {
  const format = useFormatter();
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const data = rows.map((row) => ({ ...row, label: labels[row.value] ?? row.value }));
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(140px,0.9fr)_minmax(0,1.1fr)] sm:items-center">
      <ChartContainer
        config={Object.fromEntries(
          data.map((row, index) => [row.value, { label: row.label, color: colorAt(index) }]),
        )}
        className="mx-auto h-52 w-full max-w-52 aspect-square"
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={200}
          initialDimension={{ width: 1, height: 200 }}
        >
          <PieChart>
            <Tooltip content={<ChartTooltipContent />} />
            <Pie
              data={data}
              dataKey="count"
              nameKey="value"
              innerRadius="57%"
              outerRadius="82%"
              paddingAngle={3}
              strokeWidth={0}
            >
              {data.map((row, index) => (
                <Cell key={row.value} fill={colorAt(index)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </ChartContainer>
      <ul className="flex flex-col gap-2">
        {data.map((row, index) => (
          <li
            key={row.value}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/15 px-3 py-2 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorAt(index) }}
              />
              <span className="min-w-0 whitespace-normal break-words text-end leading-relaxed">
                {row.label}
              </span>
            </span>
            <span className="numeric shrink-0 font-semibold tabular-nums">
              {format.number(row.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type StudentAnalyticsBlock =
  | {
      id: string;
      type: "trend";
      title: string;
      description?: string;
      points: { year: number; count: number }[];
      yearLabels: Record<string, string>;
      countLabel: string;
      empty: string;
    }
  | {
      id: string;
      type: "composition";
      title: string;
      description?: string;
      rows: { value: string; count: number }[];
      labels: Record<string, string>;
      empty: string;
    }
  | {
      id: string;
      type: "distribution";
      title: string;
      description?: string;
      rows: { value: string; count: number }[];
      labels: Record<string, string>;
      empty: string;
    }
  | {
      id: string;
      type: "cohort";
      title: string;
      description?: string;
      rows: { year: number; status: string; count: number }[];
      yearLabels: Record<string, string>;
      statusLabels: Record<string, string>;
      empty: string;
    };

/** A serializable block registry that selects the right visual for each dataset. */
export function StudentAnalyticsEngine({
  blocks,
  columns = 2,
}: {
  blocks: StudentAnalyticsBlock[];
  columns?: 2 | 3;
}) {
  return (
    <div className={`grid gap-4 ${columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
      {blocks.map((block) => (
        <Card key={block.id} className="overflow-hidden border border-border/90 bg-card shadow-2xs">
          <CardHeader className="border-b border-border/50 bg-muted/20 px-5 py-3.5">
            <CardTitle className="text-sm font-semibold sm:text-base">{block.title}</CardTitle>
            {block.description && (
              <CardDescription className="text-xs">{block.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="p-5">
            {block.type === "trend" && <StudentTrendChart {...block} />}
            {block.type === "composition" && <StudentCompositionChart {...block} />}
            {block.type === "distribution" && <StudentDistributionChart {...block} />}
            {block.type === "cohort" && <StudentCohortChart {...block} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StudentDistributionChart({
  rows,
  labels,
  empty,
}: Extract<StudentAnalyticsBlock, { type: "distribution" }>) {
  const format = useFormatter();
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const peak = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div
          key={row.value}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5"
        >
          <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium">{labels[row.value] ?? row.value}</span>
            <span className="numeric shrink-0 text-muted-foreground">
              {format.number(row.count)} ·{" "}
              {format.number(total ? row.count / total : 0, {
                style: "percent",
                maximumFractionDigits: 0,
              })}
            </span>
          </div>
          <div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full bg-primary/75"
              style={{ width: `${Math.max((row.count / peak) * 100, row.count ? 3 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function StudentCohortChart({
  rows,
  yearLabels,
  statusLabels,
  empty,
}: Extract<StudentAnalyticsBlock, { type: "cohort" }>) {
  const format = useFormatter();
  const locale = useLocale();
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const years = [...new Set(rows.map((row) => row.year))];
  const statuses = [...new Set(rows.map((row) => row.status))];
  const data = years.map((year) => ({
    year: yearLabels[String(year)] ?? String(year),
    ...Object.fromEntries(
      statuses.map((status) => [
        status,
        rows.find((row) => row.year === year && row.status === status)?.count ?? 0,
      ]),
    ),
  }));
  return (
    <div className="flex flex-col gap-3">
      <ChartContainer
        config={Object.fromEntries(
          statuses.map((status, index) => [
            status,
            { label: statusLabels[status] ?? status, color: colorAt(index) },
          ]),
        )}
        className="h-64 w-full min-h-64 aspect-auto"
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={200}
          initialDimension={{ width: 1, height: 200 }}
        >
          <BarChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <XAxis dataKey="year" tickLine={false} axisLine={false} tickMargin={10} />
            <YAxis
              allowDecimals={false}
              width={32}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => format.number(Number(value))}
            />
            <Tooltip content={<ChartTooltipContent />} />
            {statuses.map((status, index) => (
              <Bar
                key={status}
                dataKey={status}
                name={status}
                stackId="status"
                fill={colorAt(index)}
                radius={index === statuses.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        {statuses
          .map((status) => statusLabels[status] ?? status)
          .join(locale.toLowerCase().startsWith("fa") ? "، " : ", ")}
      </p>
    </div>
  );
}
