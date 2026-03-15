import type { RequestHandler } from 'express';

// ── Lightweight Prometheus counter / histogram (no external dep) ──────────────
// Uses prom-client if available, falls back to an in-process accumulator
// that serialises to the Prometheus text exposition format.

interface LabelSet {
  [key: string]: string;
}

class Counter {
  private counts = new Map<string, number>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[],
  ) {}

  inc(labels: LabelSet, value = 1): void {
    const key = this.labelKey(labels);
    this.counts.set(key, (this.counts.get(key) ?? 0) + value);
  }

  serialise(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    for (const [key, val] of this.counts) {
      lines.push(`${this.name}{${key}} ${val}`);
    }
    return lines.join('\n');
  }

  private labelKey(labels: LabelSet): string {
    return this.labelNames
      .map(n => `${n}="${labels[n] ?? ''}"`)
      .join(',');
  }
}

class Histogram {
  private buckets: number[];
  private counts   = new Map<string, number[]>();
  private sums     = new Map<string, number>();
  private totals   = new Map<string, number>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[],
    buckets: number[],
  ) {
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(labels: LabelSet, value: number): void {
    const key = this.labelKey(labels);
    if (!this.counts.has(key)) {
      this.counts.set(key, new Array(this.buckets.length).fill(0));
      this.sums.set(key, 0);
      this.totals.set(key, 0);
    }
    const bucketCounts = this.counts.get(key)!;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) bucketCounts[i]++;
    }
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.totals.set(key, (this.totals.get(key) ?? 0) + 1);
  }

  serialise(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    for (const [key, bucketCounts] of this.counts) {
      for (let i = 0; i < this.buckets.length; i++) {
        lines.push(`${this.name}_bucket{${key},le="${this.buckets[i]}"} ${bucketCounts[i]}`);
      }
      lines.push(`${this.name}_bucket{${key},le="+Inf"} ${this.totals.get(key) ?? 0}`);
      lines.push(`${this.name}_sum{${key}} ${this.sums.get(key) ?? 0}`);
      lines.push(`${this.name}_count{${key}} ${this.totals.get(key) ?? 0}`);
    }
    return lines.join('\n');
  }

  private labelKey(labels: LabelSet): string {
    return this.labelNames
      .map(n => `${n}="${labels[n] ?? ''}"`)
      .join(',');
  }
}

// ── Metric instances (singletons) ─────────────────────────────────────────────

export const requestsTotal = new Counter(
  'crust_requests_total',
  'Total CRUST-validated requests by decision and route',
  ['decision', 'route'],
);

export const failuresTotal = new Counter(
  'crust_failures_total',
  'Total CRUST validation failures by reason and route',
  ['reason', 'route'],
);

export const validationDurationMs = new Histogram(
  'crust_validation_duration_ms',
  'JWT validation duration in milliseconds',
  ['route'],
  [0.1, 0.5, 1, 2, 5, 10],
);

// ── /crust/metrics Express handler ────────────────────────────────────────────

export const metricsHandler: RequestHandler = (_req, res) => {
  const body = [
    requestsTotal.serialise(),
    failuresTotal.serialise(),
    validationDurationMs.serialise(),
  ].join('\n\n') + '\n';

  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(body);
};
