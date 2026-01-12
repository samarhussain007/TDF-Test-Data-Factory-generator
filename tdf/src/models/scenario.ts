// src/models/scenario.ts
import { z } from "zod";

/**
 * Common min/max helper for ranges like:
 * - users per org
 * - roles per user
 */
export const MinMax = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  })
  .refine((v) => v.max >= v.min, {
    message: "max must be >= min",
    path: ["max"],
  });

/**
 * One-to-many configuration:
 * e.g. users per organizations, invoices per org, etc.
 */
export const PerParent = z.object({
  parent: z.string(),
  fk: z.string(),
  ...MinMax.shape,
});

/**
 * Value distribution weights (e.g. enum distributions).
 * Requires at least one weight > 0 to avoid broken weighted sampling.
 */
export const WeightMap = z
  .record(z.string(), z.number().min(0))
  .refine((m) => Object.values(m).some((x) => x > 0), {
    message: "At least one weight must be > 0",
  });

/**
 * Many-to-many / bridge table configuration
 * Example: user_roles(user_id, role_id)
 */
export const M2M = z
  .object({
    left: z.object({
      table: z.string(),
      fk: z.string(), // join-table column pointing to left.table PK
    }),
    right: z.object({
      table: z.string(),
      fk: z.string(), // join-table column pointing to right.table PK
    }),
    // MVP: define how many rights per left row
    perLeft: MinMax,
  })
  .refine((v) => v.left.table !== v.right.table, {
    message: "m2m left.table and right.table must be different",
    path: ["right", "table"],
  });

/**
 * Optional column overrides (crucial for real schemas with NOT NULL / CHECK constraints).
 */
export const ColumnOverride = z
  .object({
    fixed: z.any().optional(),
    oneOf: z.array(z.any()).min(1).optional(),
    range: z
      .object({
        min: z.number(),
        max: z.number(),
      })
      .refine((v) => v.max >= v.min, {
        message: "range.max must be >= range.min",
        path: ["max"],
      })
      .optional(),
    nullRate: z.number().min(0).max(1).optional(),
  })
  .refine(
    (v) =>
      [v.fixed != null, v.oneOf != null, v.range != null].filter(Boolean)
        .length <= 1,
    { message: "Choose only one of: fixed, oneOf, range" }
  );

/**
 * Simple rule system for coherence.
 */
export const Rule = z.object({
  if: z.record(z.string(), z.any()).optional(),
  set: z.record(z.string(), z.any()),
});

export const TableScenario = z
  .object({
    // Choose exactly one of these "count modes":
    count: z.number().int().nonnegative().optional(),
    perParent: PerParent.optional(),
    m2m: M2M.optional(),

    // columnName -> { value -> weight }
    distributions: z.record(z.string(), WeightMap).optional(),

    // columnName -> override
    columns: z.record(z.string(), ColumnOverride).optional(),

    // simple coherence rules
    rules: z.array(Rule).optional(),
  })
  .refine(
    (v) => {
      const modes = [
        v.count != null,
        v.perParent != null,
        v.m2m != null,
      ].filter(Boolean).length;
      return modes === 1; // require exactly one mode for clarity
    },
    {
      message: "Provide exactly one of: count, perParent, m2m",
    }
  );

export const ScenarioSchema = z.object({
  seed: z.number().int().optional(),

  time: z
    .object({
      mode: z.literal("last_n_days"),
      n: z.number().int().positive(),
    })
    .default({ mode: "last_n_days", n: 90 }),

  // tableName -> TableScenario
  tables: z.record(z.string(), TableScenario),
});

export const ScenariosFileSchema = z.record(z.string(), ScenarioSchema);
