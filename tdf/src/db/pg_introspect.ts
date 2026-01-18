// src/db/pg_introspect.ts
import pg from "pg";
import type { SchemaModel } from "../types/schema.js";

const { Client } = pg;

export async function introspectPostgres(
  connectionString: string,
): Promise<SchemaModel> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // 1) Tables (public schema)
    const tablesRes = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const tableNames = tablesRes.rows.map((r) => r.table_name);

    // 2) Columns (+ detect enums via USER-DEFINED udt_name)
    const colsRes = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: "YES" | "NO";
      column_default: string | null;
    }>(`
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position;
    `);

    // 3) Primary keys (composite-safe)
    const pkRes = await client.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      ordinal_position: number;
    }>(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
    `);

    // 4) Foreign keys (composite-safe)
    const fkRes = await client.query<{
      constraint_name: string;
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      ordinal_position: number;
    }>(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        kcu2.table_name AS foreign_table_name,
        kcu2.column_name AS foreign_column_name,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
       AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.key_column_usage kcu2
        ON rc.unique_constraint_name = kcu2.constraint_name
       AND kcu.ordinal_position = kcu2.ordinal_position
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
    `);

    // 5) Unique constraints (composite-safe)
    const uniqRes = await client.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      ordinal_position: number;
    }>(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'UNIQUE'
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
    `);

    // 6) Enum values (native PG enums)
    const enumRes = await client.query<{
      enum_type: string;
      enum_value: string;
      enum_sort: number;
    }>(`
      SELECT
        t.typname AS enum_type,
        e.enumlabel AS enum_value,
        e.enumsortorder AS enum_sort
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      ORDER BY t.typname, e.enumsortorder;
    `);

    const enumMap = new Map<string, string[]>();
    for (const r of enumRes.rows) {
      const arr = enumMap.get(r.enum_type) ?? [];
      arr.push(r.enum_value);
      enumMap.set(r.enum_type, arr);
    }

    // 7) Indexes (including unique and partial unique indexes)
    const indexRes = await client.query<{
      table_name: string;
      index_name: string;
      column_name: string;
      is_unique: boolean;
      index_def: string;
      ordinal_position: number;
    }>(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        a.attname AS column_name,
        ix.indisunique AS is_unique,
        pg_get_indexdef(ix.indexrelid) AS index_def,
        a.attnum AS ordinal_position
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = 'public'
        AND t.relkind = 'r'
      ORDER BY t.relname, i.relname, a.attnum;
    `);

    // 8) Check constraints
    const checkRes = await client.query<{
      table_name: string;
      constraint_name: string;
      check_clause: string;
    }>(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        pg_get_constraintdef(c.oid) AS check_clause
      FROM information_schema.table_constraints tc
      JOIN pg_namespace n ON n.nspname = tc.constraint_schema
      JOIN pg_constraint c ON c.conname = tc.constraint_name
        AND c.connamespace = n.oid
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'CHECK'
      ORDER BY tc.table_name, tc.constraint_name;
    `);

    // ---------- Build SchemaModel ----------
    const schema: SchemaModel = {
      dialect: "postgres",
      tables: {},
    };

    // init tables
    for (const t of tableNames) {
      schema.tables[t] = {
        name: t,
        columns: {},
        primaryKey: [],
        foreignKeys: [],
        uniques: [],
        indexes: [],
        checks: [],
      };
    }

    // fill columns
    for (const r of colsRes.rows) {
      const table = schema.tables[r.table_name];
      if (!table) continue;

      // udt_name is more precise than data_type (e.g. "int4" vs "integer", enum names, etc.)
      const dbType = r.udt_name;
      const enumValues = enumMap.get(r.udt_name);

      table.columns[r.column_name] = {
        name: r.column_name,
        dbType,
        isNullable: r.is_nullable === "YES",
        defaultExpr: r.column_default ?? null,
        isPrimaryKey: false,
        ...(enumValues ? { enumValues } : {}),
      };
    }

    // group PKs by table
    const pkByTable = new Map<string, { cols: string[] }>();
    for (const r of pkRes.rows) {
      const entry = pkByTable.get(r.table_name) ?? { cols: [] };
      entry.cols.push(r.column_name);
      pkByTable.set(r.table_name, entry);
    }
    for (const [tableName, pk] of pkByTable.entries()) {
      const table = schema.tables[tableName];
      if (!table) continue;
      table.primaryKey = pk.cols;
      for (const col of pk.cols) {
        if (table.columns[col]) table.columns[col].isPrimaryKey = true;
      }
    }

    // foreign keys - group by constraint_name to handle composite FKs
    const fkGroup = new Map<
      string,
      {
        table: string;
        cols: string[];
        refTable: string;
        refCols: string[];
        constraint: string;
      }
    >();
    for (const r of fkRes.rows) {
      const key = `${r.table_name}::${r.constraint_name}`;
      const g = fkGroup.get(key) ?? {
        table: r.table_name,
        cols: [],
        refTable: r.foreign_table_name,
        refCols: [],
        constraint: r.constraint_name,
      };
      g.cols.push(r.column_name);
      g.refCols.push(r.foreign_column_name);
      fkGroup.set(key, g);
    }
    for (const g of fkGroup.values()) {
      const table = schema.tables[g.table];
      if (!table) continue;
      table.foreignKeys.push({
        constraintName: g.constraint,
        columns: g.cols,
        refTable: g.refTable,
        refColumns: g.refCols,
      });
    }

    // unique constraints grouping by constraint_name
    const uniqGroup = new Map<
      string,
      { table: string; cols: string[]; constraint: string }
    >();
    for (const r of uniqRes.rows) {
      const key = `${r.table_name}::${r.constraint_name}`;
      const g = uniqGroup.get(key) ?? {
        table: r.table_name,
        cols: [],
        constraint: r.constraint_name,
      };
      g.cols.push(r.column_name);
      uniqGroup.set(key, g);
    }
    for (const g of uniqGroup.values()) {
      const table = schema.tables[g.table];
      if (!table) continue;
      table.uniques.push({ columns: g.cols, constraintName: g.constraint });
    }

    // indexes - group by index_name to handle composite indexes
    const indexGroup = new Map<
      string,
      {
        table: string;
        name: string;
        cols: string[];
        isUnique: boolean;
        def: string;
      }
    >();
    for (const r of indexRes.rows) {
      const key = `${r.table_name}::${r.index_name}`;
      const g = indexGroup.get(key) ?? {
        table: r.table_name,
        name: r.index_name,
        cols: [],
        isUnique: r.is_unique,
        def: r.index_def,
      };
      g.cols.push(r.column_name);
      indexGroup.set(key, g);
    }
    for (const g of indexGroup.values()) {
      const table = schema.tables[g.table];
      if (!table) continue;

      // Extract WHERE predicate from index definition
      const whereMatcher = /\sWHERE\s+(.+)$/i;
      const match = g.def.match(whereMatcher);
      const predicate = match ? match[1]!.trim() : null;

      table.indexes.push({
        name: g.name,
        columns: g.cols,
        isUnique: g.isUnique,
        predicate,
      });
    }

    // check constraints
    for (const r of checkRes.rows) {
      const table = schema.tables[r.table_name];
      if (!table) continue;

      // pg_get_constraintdef returns "CHECK (expression)"
      // Strip the "CHECK " prefix
      const expr = r.check_clause
        .replace(/^CHECK\s*\(/i, "")
        .replace(/\)$/, "");

      table.checks.push({
        name: r.constraint_name,
        expression: expr,
      });
    }

    return schema;
  } finally {
    await client.end();
  }
}
