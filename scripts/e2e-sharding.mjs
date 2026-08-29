#!/usr/bin/env node
/**
 * OphirPay E2E Test Sharding & Report Merge CLI Utility
 *
 * Provides commands for:
 *   1. Listing and validating spec distribution across parallel workers
 *   2. Running individual shards or rerun-only-failed mode
 *   3. Merging Playwright blob reports into combined HTML reports
 *
 * Usage:
 *   node scripts/e2e-sharding.mjs list [shards]
 *   node scripts/e2e-sharding.mjs run --shard=1/4 [--project=chromium]
 *   node scripts/e2e-sharding.mjs failed-only [--project=chromium]
 *   node scripts/e2e-sharding.mjs merge [--input=all-blob-reports] [--output=playwright-report]
 */

import { readdirSync, existsSync, statSync } from "fs";
import { resolve, join, basename } from "path";
import { spawnSync } from "child_process";

const ROOT_DIR = resolve(process.cwd());
const E2E_DIR = join(ROOT_DIR, "e2e");

function getSpecFiles() {
  if (!existsSync(E2E_DIR)) {
    console.error(`❌ E2E directory not found: ${E2E_DIR}`);
    process.exit(1);
  }
  return readdirSync(E2E_DIR)
    .filter((file) => file.endsWith(".spec.ts") || file.endsWith(".spec.js"))
    .sort();
}

function calculateShards(specFiles, shardTotal) {
  const shards = new Map();
  for (let i = 1; i <= shardTotal; i++) {
    shards.set(i, []);
  }
  specFiles.forEach((file, index) => {
    const shardIndex = (index % shardTotal) + 1;
    shards.get(shardIndex).push(file);
  });
  return shards;
}

function printSummaryTable(shards) {
  console.log("┌─────────────┬─────────────┬────────────────────────────────────────────────┐");
  console.log("│ Shard Index │ Spec Count  │ Assigned Spec Files                            │");
  console.log("├─────────────┼─────────────┼────────────────────────────────────────────────┤");
  shards.forEach((files, index) => {
    const shardCol = `Shard ${index}`.padEnd(11);
    const countCol = `${files.length} file(s)`.padEnd(11);
    const fileList = files.join(", ") || "(empty)";
    const filesCol = fileList.length > 46 ? fileList.slice(0, 43) + "..." : fileList.padEnd(46);
    console.log(`│ ${shardCol} │ ${countCol} │ ${filesCol} │`);
  });
  console.log("└─────────────┴─────────────┴────────────────────────────────────────────────┘");
}

const args = process.argv.slice(2);
const command = args[0] || "list";

switch (command) {
  case "list": {
    const shardTotal = parseInt(args[1] || "4", 10);
    const specs = getSpecFiles();
    console.log(`\n🔍 Found ${specs.length} E2E spec file(s) in '${basename(E2E_DIR)}/'`);
    console.log(`📊 Distributing across ${shardTotal} parallel worker shard(s):\n`);
    const shards = calculateShards(specs, shardTotal);
    printSummaryTable(shards);

    let min = Infinity;
    let max = -Infinity;
    shards.forEach((files) => {
      if (files.length < min) min = files.length;
      if (files.length > max) max = files.length;
    });
    const diff = max - min;
    if (diff <= 1) {
      console.log(`\n✅ Shard distribution is optimally balanced (max delta = ${diff} spec file).\n`);
    } else {
      console.log(`\n⚠️  Shard distribution imbalance detected (max delta = ${diff} spec files).\n`);
    }
    break;
  }

  case "run": {
    let shard = "";
    let project = "chromium";
    let extraArgs = [];

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith("--shard=")) {
        shard = arg;
      } else if (arg.startsWith("--project=")) {
        project = arg.split("=")[1];
      } else {
        extraArgs.push(arg);
      }
    }

    const cmdArgs = ["playwright", "test"];
    if (shard) cmdArgs.push(shard);
    if (project) cmdArgs.push(`--project=${project}`);
    cmdArgs.push(...extraArgs);

    console.log(`🚀 Executing: npx ${cmdArgs.join(" ")}`);
    const result = spawnSync("npx", cmdArgs, { stdio: "inherit", shell: true });
    process.exit(result.status ?? 0);
    break;
  }

  case "failed-only": {
    let project = "chromium";
    let extraArgs = [];

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith("--project=")) {
        project = arg.split("=")[1];
      } else {
        extraArgs.push(arg);
      }
    }

    const cmdArgs = ["playwright", "test", "--last-failed"];
    if (project) cmdArgs.push(`--project=${project}`);
    cmdArgs.push(...extraArgs);

    console.log(`🔁 Rerunning ONLY failed E2E tests for flaky triage:`);
    console.log(`🚀 Executing: npx ${cmdArgs.join(" ")}`);
    const result = spawnSync("npx", cmdArgs, { stdio: "inherit", shell: true });
    process.exit(result.status ?? 0);
    break;
  }

  case "merge": {
    let inputDir = "./all-blob-reports";
    let reporter = "html,list";

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith("--input=")) {
        inputDir = arg.split("=")[1];
      } else if (arg.startsWith("--reporter=")) {
        reporter = arg.split("=")[1];
      }
    }

    console.log(`📦 Merging Playwright blob reports from '${inputDir}'...`);
    const cmdArgs = ["playwright", "merge-reports", `--reporter=${reporter}`, inputDir];
    console.log(`🚀 Executing: npx ${cmdArgs.join(" ")}`);
    const result = spawnSync("npx", cmdArgs, { stdio: "inherit", shell: true });
    process.exit(result.status ?? 0);
    break;
  }

  default:
    console.log(`OphirPay E2E Sharding CLI\n`);
    console.log(`Commands:`);
    console.log(`  list [shards]                 - List spec distribution across parallel shards`);
    console.log(`  run --shard=X/Y               - Run specific shard`);
    console.log(`  failed-only [--project=name]  - Rerun only failed tests (flaky triage)`);
    console.log(`  merge [--input=dir]           - Merge blob reports into combined report`);
    break;
}
