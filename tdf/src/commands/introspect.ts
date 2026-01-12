// src/commands/introspect.ts
import { Command } from "commander";
import { introspectPostgres } from "../db/pg_introspect.js";
import { writeFile } from "../util/fs.js";
import { prefixPath } from "../util/helper.js";
import type { IntrospectOptions } from "../types/commands/introspect.type.js";

export function introspectCmd(): Command {
  const cmd = new Command("introspect");

  cmd
    .description("Introspect a PostgreSQL database and output its schema")
    .requiredOption(
      "-c, --connection <string>",
      "PostgreSQL connection string (e.g., postgres://user:pass@host:5432/db)"
    )
    .option("-o, --output <file>", "Output file path (defaults to stdout)")
    .action(async (options: IntrospectOptions) => {
      try {
        const { connection, output: rawOutput } = options;

        console.error("🔍 Introspecting database...");
        const schema = await introspectPostgres(connection);

        const json = JSON.stringify(schema, null, 2);

        let finalOutputPath = prefixPath("schemas", rawOutput);

        if (finalOutputPath) {
          await writeFile(finalOutputPath, json);
          console.error(`✅ Schema written to ${finalOutputPath}`);
        } else {
          console.log(json);
        }
      } catch (error) {
        console.error("❌ Introspection failed:", (error as Error).message);
        process.exit(1);
      }
    });

  return cmd;
}
