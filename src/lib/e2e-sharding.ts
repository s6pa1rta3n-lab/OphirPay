/**
 * OphirPay E2E Test Sharding & Parallel Worker Utilities
 * 
 * Provides deterministic spec partition algorithms, shard validation,
 * Playwright CLI argument construction, and report aggregation helpers
 * for cutting CI wall-clock execution time.
 */

import * as fs from "fs";
import * as path from "path";

export interface ShardOptions {
  failedOnly?: boolean;
  project?: string;
  reporter?: string;
  grep?: string;
  grepInvert?: string;
}

export interface ShardValidationResult {
  isBalanced: boolean;
  maxDiff: number;
  distribution: Record<number, number>;
  totalSpecs: number;
  shardTotal: number;
}

/**
 * Deterministically distributes spec files evenly across N parallel shards (1-indexed).
 * Sorts files alphabetically first to guarantee idempotent assignment across CI workers.
 *
 * @param specFiles List of relative or absolute spec file paths.
 * @param shardTotal Total number of parallel worker shards (must be >= 1).
 * @returns Map mapping 1-based shard index (1..shardTotal) to array of spec files.
 */
export function calculateShards(specFiles: string[], shardTotal: number): Map<number, string[]> {
  if (shardTotal < 1) {
    throw new Error(`shardTotal must be >= 1, received: ${shardTotal}`);
  }

  const sortedFiles = [...specFiles].sort();
  const shards = new Map<number, string[]>();

  for (let i = 1; i <= shardTotal; i++) {
    shards.set(i, []);
  }

  sortedFiles.forEach((file, index) => {
    const shardIndex = (index % shardTotal) + 1;
    shards.get(shardIndex)?.push(file);
  });

  return shards;
}

/**
 * Retrieves the subset of spec files assigned to a specific 1-based shard index.
 *
 * @param specFiles Complete list of spec files.
 * @param shardIndex 1-based shard index (1..shardTotal).
 * @param shardTotal Total number of shards.
 * @returns Array of spec files for the requested shard.
 */
export function getShardForIndex(specFiles: string[], shardIndex: number, shardTotal: number): string[] {
  if (shardIndex < 1 || shardIndex > shardTotal) {
    throw new Error(`shardIndex must be between 1 and ${shardTotal}, received: ${shardIndex}`);
  }

  const shards = calculateShards(specFiles, shardTotal);
  return shards.get(shardIndex) || [];
}

/**
 * Validates that spec files are distributed evenly across shards.
 * In an optimal partition, the difference between the most loaded and least loaded shard is <= 1.
 *
 * @param specFiles List of spec files.
 * @param shardTotal Total number of shards.
 * @returns Validation result with balance flag and distribution counts.
 */
export function validateShardDistribution(specFiles: string[], shardTotal: number): ShardValidationResult {
  const shards = calculateShards(specFiles, shardTotal);
  const distribution: Record<number, number> = {};
  let minCount = Infinity;
  let maxCount = -Infinity;

  shards.forEach((files, index) => {
    const count = files.length;
    distribution[index] = count;
    if (count < minCount) minCount = count;
    if (count > maxCount) maxCount = count;
  });

  if (specFiles.length === 0) {
    minCount = 0;
    maxCount = 0;
  }

  const maxDiff = maxCount - minCount;
  const isBalanced = maxDiff <= 1;

  return {
    isBalanced,
    maxDiff,
    distribution,
    totalSpecs: specFiles.length,
    shardTotal,
  };
}

/**
 * Constructs command line argument strings for Playwright test execution.
 *
 * @param shardIndex 1-based shard index.
 * @param shardTotal Total number of shards.
 * @param options Optional overrides (failedOnly, project, reporter).
 * @returns Array of CLI flags.
 */
export function getPlaywrightShardArgs(
  shardIndex: number,
  shardTotal: number,
  options: ShardOptions = {}
): string[] {
  const args: string[] = [];

  if (options.failedOnly) {
    args.push("--last-failed");
  } else if (shardTotal > 1) {
    if (shardIndex < 1 || shardIndex > shardTotal) {
      throw new Error(`Invalid shardIndex: ${shardIndex}. Must be 1 <= shardIndex <= ${shardTotal}`);
    }
    args.push(`--shard=${shardIndex}/${shardTotal}`);
  }

  if (options.project) {
    args.push(`--project=${options.project}`);
  }

  if (options.reporter) {
    args.push(`--reporter=${options.reporter}`);
  }

  if (options.grep) {
    args.push(`--grep=${options.grep}`);
  }

  if (options.grepInvert) {
    args.push(`--grep-invert=${options.grepInvert}`);
  }

  return args;
}

/**
 * Generates an ASCII summary table of the shard distribution for CI logging and CLI output.
 *
 * @param shards Map of shard index to file array.
 * @returns Formatted table string.
 */
export function formatShardSummary(shards: Map<number, string[]>): string {
  const lines: string[] = [
    "┌─────────────┬─────────────┬────────────────────────────────────────────────┐",
    "│ Shard Index │ Spec Count  │ Assigned Spec Files                            │",
    "├─────────────┼─────────────┼────────────────────────────────────────────────┤",
  ];

  shards.forEach((files, index) => {
    const fileList = files.map((f) => path.basename(f)).join(", ") || "(empty)";
    const shardCol = `Shard ${index}`.padEnd(11);
    const countCol = `${files.length} file(s)`.padEnd(11);
    const filesCol = fileList.length > 46 ? fileList.slice(0, 43) + "..." : fileList.padEnd(46);
    lines.push(`│ ${shardCol} │ ${countCol} │ ${filesCol} │`);
  });

  lines.push("└─────────────┴─────────────┴────────────────────────────────────────────────┘");
  return lines.join("\n");
}

/**
 * Discovers all `.spec.ts` or `.test.ts` files in the target directory.
 *
 * @param e2eDir Path to E2E test directory.
 * @returns Array of relative file paths sorted alphabetically.
 */
export function discoverSpecFiles(e2eDir: string): string[] {
  if (!fs.existsSync(e2eDir)) {
    return [];
  }

  const entries = fs.readdirSync(e2eDir, { withFileTypes: true });
  const specs: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".spec.js"))) {
      specs.push(entry.name);
    }
  }

  return specs.sort();
}
