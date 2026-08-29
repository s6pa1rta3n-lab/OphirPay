import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  calculateShards,
  getShardForIndex,
  validateShardDistribution,
  getPlaywrightShardArgs,
  formatShardSummary,
  discoverSpecFiles,
} from "@/lib/e2e-sharding";

describe("E2E Test Sharding Utilities", () => {
  const sampleSpecs = [
    "api.spec.ts",
    "contracts.spec.ts",
    "critical-flows.spec.ts",
    "dashboard.spec.ts",
    "error-codes.spec.ts",
    "governance.spec.ts",
    "multisig.spec.ts",
    "titles.spec.ts",
  ];

  describe("calculateShards", () => {
    it("evenly partitions 8 spec files across 4 shards (2 files per shard)", () => {
      const shards = calculateShards(sampleSpecs, 4);
      expect(shards.size).toBe(4);

      expect(shards.get(1)).toEqual(["api.spec.ts", "error-codes.spec.ts"]);
      expect(shards.get(2)).toEqual(["contracts.spec.ts", "governance.spec.ts"]);
      expect(shards.get(3)).toEqual(["critical-flows.spec.ts", "multisig.spec.ts"]);
      expect(shards.get(4)).toEqual(["dashboard.spec.ts", "titles.spec.ts"]);

      // Verify every file is assigned to exactly one shard
      const allAssigned = Array.from(shards.values()).flat();
      expect(allAssigned.length).toBe(sampleSpecs.length);
      expect(new Set(allAssigned).size).toBe(sampleSpecs.length);
    });

    it("handles non-divisible spec file counts with max delta of 1", () => {
      const fiveSpecs = ["a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts", "e.spec.ts"];
      const shards = calculateShards(fiveSpecs, 3);
      expect(shards.size).toBe(3);

      expect(shards.get(1)?.length).toBe(2); // a, d
      expect(shards.get(2)?.length).toBe(2); // b, e
      expect(shards.get(3)?.length).toBe(1); // c

      const validation = validateShardDistribution(fiveSpecs, 3);
      expect(validation.isBalanced).toBe(true);
      expect(validation.maxDiff).toBe(1);
    });

    it("handles single shard (shardTotal = 1) containing all files", () => {
      const shards = calculateShards(sampleSpecs, 1);
      expect(shards.size).toBe(1);
      expect(shards.get(1)).toEqual(sampleSpecs);
    });

    it("handles more shards than files gracefully", () => {
      const twoSpecs = ["a.spec.ts", "b.spec.ts"];
      const shards = calculateShards(twoSpecs, 4);
      expect(shards.size).toBe(4);
      expect(shards.get(1)).toEqual(["a.spec.ts"]);
      expect(shards.get(2)).toEqual(["b.spec.ts"]);
      expect(shards.get(3)).toEqual([]);
      expect(shards.get(4)).toEqual([]);
    });

    it("throws an error if shardTotal < 1", () => {
      expect(() => calculateShards(sampleSpecs, 0)).toThrow(/shardTotal must be >= 1/);
      expect(() => calculateShards(sampleSpecs, -2)).toThrow(/shardTotal must be >= 1/);
    });

    it("is deterministic regardless of input unsorted ordering", () => {
      const unsorted = [...sampleSpecs].reverse();
      const shards1 = calculateShards(sampleSpecs, 4);
      const shards2 = calculateShards(unsorted, 4);

      for (let i = 1; i <= 4; i++) {
        expect(shards1.get(i)).toEqual(shards2.get(i));
      }
    });
  });

  describe("getShardForIndex", () => {
    it("returns correct partition for a valid 1-based index", () => {
      const shard2 = getShardForIndex(sampleSpecs, 2, 4);
      expect(shard2).toEqual(["contracts.spec.ts", "governance.spec.ts"]);
    });

    it("throws error for out-of-bounds shardIndex", () => {
      expect(() => getShardForIndex(sampleSpecs, 0, 4)).toThrow(/shardIndex must be between 1 and 4/);
      expect(() => getShardForIndex(sampleSpecs, 5, 4)).toThrow(/shardIndex must be between 1 and 4/);
      expect(() => getShardForIndex(sampleSpecs, -1, 4)).toThrow(/shardIndex must be between 1 and 4/);
    });
  });

  describe("validateShardDistribution", () => {
    it("returns balanced true for evenly distributed suite", () => {
      const res = validateShardDistribution(sampleSpecs, 4);
      expect(res.isBalanced).toBe(true);
      expect(res.maxDiff).toBe(0);
      expect(res.totalSpecs).toBe(8);
      expect(res.shardTotal).toBe(4);
      expect(res.distribution).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2 });
    });

    it("handles empty spec list", () => {
      const res = validateShardDistribution([], 3);
      expect(res.isBalanced).toBe(true);
      expect(res.maxDiff).toBe(0);
      expect(res.totalSpecs).toBe(0);
    });
  });

  describe("getPlaywrightShardArgs", () => {
    it("builds standard shard arguments for multi-worker CI", () => {
      const args = getPlaywrightShardArgs(2, 4);
      expect(args).toEqual(["--shard=2/4"]);
    });

    it("omits --shard flag when shardTotal is 1", () => {
      const args = getPlaywrightShardArgs(1, 1);
      expect(args).toEqual([]);
    });

    it("builds --last-failed argument for flaky triage mode", () => {
      const args = getPlaywrightShardArgs(1, 4, { failedOnly: true });
      expect(args).toEqual(["--last-failed"]);
    });

    it("appends project and reporter options when provided", () => {
      const args = getPlaywrightShardArgs(3, 4, {
        project: "chromium",
        reporter: "blob",
        grep: "@smoke",
      });
      expect(args).toEqual([
        "--shard=3/4",
        "--project=chromium",
        "--reporter=blob",
        "--grep=@smoke",
      ]);
    });

    it("throws on invalid shard index", () => {
      expect(() => getPlaywrightShardArgs(5, 4)).toThrow(/Invalid shardIndex: 5/);
    });
  });

  describe("formatShardSummary", () => {
    it("formats summary table string containing all shards", () => {
      const shards = calculateShards(sampleSpecs, 2);
      const summary = formatShardSummary(shards);
      expect(summary).toContain("Shard 1");
      expect(summary).toContain("Shard 2");
      expect(summary).toContain("4 file(s)");
      expect(summary).toContain("api.spec.ts");
    });
  });

  describe("discoverSpecFiles", () => {
    it("discovers all E2E spec files in repository e2e directory", () => {
      const e2eDir = path.resolve(process.cwd(), "e2e");
      const specs = discoverSpecFiles(e2eDir);
      expect(specs.length).toBeGreaterThanOrEqual(8);
      expect(specs).toContain("api.spec.ts");
      expect(specs).toContain("contracts.spec.ts");
      expect(specs).toContain("critical-flows.spec.ts");
      expect(specs).toContain("dashboard.spec.ts");
      expect(specs).toContain("error-codes.spec.ts");
      expect(specs).toContain("governance.spec.ts");
      expect(specs).toContain("multisig.spec.ts");
      expect(specs).toContain("titles.spec.ts");
    });

    it("returns empty array for nonexistent directory", () => {
      const specs = discoverSpecFiles("/nonexistent/e2e/dir");
      expect(specs).toEqual([]);
    });
  });

  describe("CI Workflow & Package Integration Integrity", () => {
    it("verifies package.json contains all required E2E sharding and triage scripts", () => {
      const pkgPath = path.resolve(process.cwd(), "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

      expect(pkg.scripts["test:e2e"]).toBe("playwright test");
      expect(pkg.scripts["test:e2e:shard"]).toBe("node scripts/e2e-sharding.mjs run");
      expect(pkg.scripts["test:e2e:failed"]).toBe("playwright test --last-failed");
      expect(pkg.scripts["test:e2e:merge-reports"]).toBe(
        "playwright merge-reports --reporter=html,list ./all-blob-reports"
      );
      expect(pkg.scripts["test:e2e:inspect-shards"]).toBe("node scripts/e2e-sharding.mjs list");
    });

    it("verifies playwright.config.ts configures blob reporting on CI and shard env support", () => {
      const configPath = path.resolve(process.cwd(), "playwright.config.ts");
      const configContent = fs.readFileSync(configPath, "utf-8");

      expect(configContent).toContain("process.env.SHARD_INDEX");
      expect(configContent).toContain("process.env.SHARD_TOTAL");
      expect(configContent).toContain('process.env.CI\n    ? [["blob"], ["list"], ["github"]]');
    });

    it("verifies .github/workflows/ci.yml configures matrix sharding and merge reports job", () => {
      const workflowPath = path.resolve(process.cwd(), ".github/workflows/ci.yml");
      const workflowContent = fs.readFileSync(workflowPath, "utf-8");

      // Verify matrix setup
      expect(workflowContent).toContain("shardIndex: [1, 2, 3, 4]");
      expect(workflowContent).toContain("shardTotal: [4]");
      expect(workflowContent).toContain("--shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}");

      // Verify blob report upload per shard
      expect(workflowContent).toContain("blob-report-shard-${{ matrix.shardIndex }}");

      // Verify merge job
      expect(workflowContent).toContain("e2e-report-merge:");
      expect(workflowContent).toContain("needs: e2e-tests");
      expect(workflowContent).toContain("playwright merge-reports");
      expect(workflowContent).toContain("name: playwright-report");

      // Verify workflow_dispatch triage triggers
      expect(workflowContent).toContain("workflow_dispatch:");
      expect(workflowContent).toContain("shard_total:");
      expect(workflowContent).toContain("failed_only:");
    });
  });
});
