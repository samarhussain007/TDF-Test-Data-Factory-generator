// src/commands/generate.ts
import { Command } from "commander";
import { readJsonFile, writeFile } from "../util/fs.js";
import { SchemaModelSchema } from "../models/schema.js";
import { ScenarioSchema, ScenariosFileSchema } from "../models/scenario.js";
import { buildPlan } from "../core/plan.js";
import { generateRows } from "../core/generate_rows.js";
import { emitSql } from "../core/emit_sql.js";
import type { SchemaModel } from "../types/schema.js";
import { prefixPath } from "../util/helper.js";
import type { GenerateOptions } from "../types/commands/generate.type.js";

export function generateCmd(): Command {
  const cmd = new Command("generate");

  cmd
    .description("Generate test data SQL from schema and scenario files")
    .requiredOption("-s, --schema <file>", "Path to schema JSON file")
    .requiredOption("-c, --scenario <file>", "Path to scenario JSON file")
    .option(
      "-n, --name <name>",
      "Scenario name to use (if file contains multiple)"
    )
    .option(
      `-o, --output <file>`,
      "Output SQL file path (defaults to stdout, auto-prefixes output/ for relative paths)"
    )
    .option("--dry-run", "Show plan without generating SQL")
    .action(async (options: GenerateOptions) => {
      try {
        const {
          schema: schemaPath,
          scenario: scenarioPath,
          name,
          output: rawOutput,
          dryRun,
        } = options;

        // Auto-prefix output/ for relative paths (unless already starting with output/ or absolute)
        const output = prefixPath("output", rawOutput);

        // Load schema
        console.error("📄 Loading schema...");
        const rawSchema = await readJsonFile(schemaPath);

        // Validate schema - handle the primaryKey field that pg_introspect adds
        const schemaResult = SchemaModelSchema.safeParse(rawSchema);
        if (!schemaResult.success) {
          // Try to parse as the pg_introspect format
          const schema = rawSchema as SchemaModel;
          if (!schema.dialect || !schema.tables) {
            throw new Error(`Invalid schema: ${schemaResult.error.message}`);
          }
          console.error("✅ Schema loaded (pg_introspect format)");
          await processGeneration(schema, scenarioPath, name, output, dryRun);
        } else {
          console.error("✅ Schema loaded");
          // Convert Zod result to SchemaModel format
          const schema = schemaResult.data as unknown as SchemaModel;
          await processGeneration(schema, scenarioPath, name, output, dryRun);
        }
      } catch (error) {
        console.error("❌ Generation failed:", (error as Error).message);
        process.exit(1);
      }
    });

  return cmd;
}

async function processGeneration(
  schema: SchemaModel,
  scenarioPath: string,
  name: string | undefined,
  output: string | undefined,
  dryRun: boolean | undefined
): Promise<void> {
  // Load scenario
  console.error("📄 Loading scenario...");
  const rawScenario = await readJsonFile(scenarioPath);

  let scenario;

  // Check if it's a multi-scenario file or single scenario
  const multiResult = ScenariosFileSchema.safeParse(rawScenario);
  if (multiResult.success) {
    const scenarios = multiResult.data;
    const scenarioNames = Object.keys(scenarios);

    if (scenarioNames.length === 0) {
      throw new Error("No scenarios found in file");
    }

    const selectedName = name ?? scenarioNames[0]!;
    const selectedScenario = scenarios[selectedName];
    if (!selectedScenario) {
      throw new Error(
        `Scenario "${selectedName}" not found. Available: ${scenarioNames.join(
          ", "
        )}`
      );
    }
    scenario = selectedScenario;
    console.error(`✅ Using scenario: ${selectedName}`);
  } else {
    // Try as single scenario
    const singleResult = ScenarioSchema.safeParse(rawScenario);
    if (!singleResult.success) {
      throw new Error(`Invalid scenario: ${singleResult.error.message}`);
    }
    scenario = singleResult.data;
    console.error("✅ Scenario loaded");
  }

  // Build plan
  console.error("🔧 Building generation plan...");
  const plan = buildPlan(schema, scenario);

  // Show plan summary
  console.error("");
  console.error("📋 Generation Plan:");
  console.error(`   Seed: ${plan.seed}`);
  console.error(`   Table order: ${plan.tableOrder.join(" → ")}`);
  console.error("");

  for (const tableName of plan.tableOrder) {
    const tablePlan = plan.tablePlans.get(tableName);
    if (!tablePlan) continue;
    console.error(
      `   ${tableName}: ${tablePlan.rowCount} rows (${tablePlan.mode})`
    );
  }
  console.error("");

  if (dryRun) {
    console.error("🚫 Dry run - skipping SQL generation");
    return;
  }

  // Generate rows
  console.error("🎲 Generating data...");
  const data = generateRows(schema, scenario, plan);

  // Emit SQL
  console.error("📝 Emitting SQL...");
  const sql = emitSql(schema, data, plan.tableOrder);

  if (output) {
    await writeFile(output, sql);
    console.error(`✅ SQL written to ${output}`);
  } else {
    console.log(sql);
  }

  // Summary
  let totalRows = 0;
  for (const rows of data.values()) {
    totalRows += rows.length;
  }
  console.error(`\n✅ Generated ${totalRows} rows across ${data.size} tables`);
}
