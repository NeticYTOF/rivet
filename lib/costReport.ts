// Nightly API cost digest. Small by design: one Slack message in the report
// channel, posted once a day. Reads the already-recorded llm_usage rows, so
// it costs nothing to compute and cannot invent numbers.

const db = require("./db");
const brand = require("./brand");

const COST_METRIC = "daily_cost_report";
const DAY_MS = 24 * 60 * 60 * 1000;

function cents(usd: number | null | undefined): number {
  if (!Number.isFinite(usd as number)) return 0;
  return Math.round((usd as number) * 100);
}

function dayKey(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

function costDigestText(rows: Array<Record<string, unknown>> = [], at = new Date()): string | null {
  const ops: Record<string, { requests: number; inTok: number; outTok: number; usd: number; unknownCost: number }> = {};
  let totalUsd = 0;
  let totalReq = 0;
  let unknownCostRequests = 0;
  let pricedRequests = 0;
  for (const r of rows) {
    const op = String(r.operation || "other");
    const acc = ops[op] || (ops[op] = { requests: 0, inTok: 0, outTok: 0, usd: 0, unknownCost: 0 });
    const requests = Number(r.requests) || 0;
    const knownCost = r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd);
    acc.requests += requests;
    acc.inTok += Number(r.prompt_tokens) || 0;
    acc.outTok += Number(r.completion_tokens) || 0;
    totalReq += requests;
    const unknownForRow =
      r.unknown_cost_requests === undefined
        ? knownCost === null || !Number.isFinite(knownCost)
          ? requests
          : 0
        : Math.min(requests, Math.max(0, Number(r.unknown_cost_requests) || 0));
    acc.unknownCost += unknownForRow;
    unknownCostRequests += unknownForRow;
    pricedRequests += requests - unknownForRow;
    if (knownCost !== null && Number.isFinite(knownCost)) {
      acc.usd += knownCost;
      totalUsd += knownCost;
    }
  }
  if (totalReq === 0) return null;
  const parts = Object.entries(ops)
    .sort((a, b) => b[1].usd - a[1].usd)
    .map(([op, o]) => {
      const priced = o.requests - o.unknownCost;
      return o.unknownCost > 0
        ? `${op} ${priced} priced, ${o.unknownCost} unpriced ($${o.usd.toFixed(3)} known)`
        : `${op} ${o.requests} ($${o.usd.toFixed(3)})`;
    });
  const date = dayKey(at);
  const totals =
    unknownCostRequests > 0
      ? `known subtotal $${totalUsd.toFixed(3)}; ${unknownCostRequests} calls have unknown cost (${pricedRequests}/${totalReq} priced calls)`
      : `total $${totalUsd.toFixed(3)}`;
  return `${brand.name()} api costs ${date}: ${parts.join(" · ")} — ${totals} (${totalReq} calls)`;
}

function lastCostReportDay(): string | null {
  try {
    const row = db
      .handle()
      .query("SELECT detail FROM metrics WHERE kind = ? ORDER BY created_at DESC LIMIT 1")
      .get(COST_METRIC) as { detail?: string } | null;
    return (row && typeof row.detail === "string" && row.detail) || null;
  } catch {
    return null;
  }
}

function markCostReportSent(day: string): void {
  db.recordMetric(COST_METRIC, null, day, null);
}

function isCostReportDue(at = new Date()): boolean {
  return lastCostReportDay() !== dayKey(at);
}

export = { costDigestText, lastCostReportDay, markCostReportSent, isCostReportDue, COST_METRIC, DAY_MS, cents, dayKey };
