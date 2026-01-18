// src/util/toposort.ts

/**
 * Topological sort for table ordering based on FK dependencies.
 * Returns tables in an order where parent tables come before children.
 */
export function toposort(
  tables: string[],
  edges: Array<{ from: string; to: string }>, // from depends on to (from has FK to to)
): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const table of tables) {
    inDegree.set(table, 0);
    adjacency.set(table, []);
  }

  // Build graph: edge from -> to means "from" depends on "to"
  // So we need to insert "to" before "from"
  // In adjacency, we track: to -> [from, ...] (to must come before from)
  for (const { from, to } of edges) {
    if (!tables.includes(from) || !tables.includes(to)) continue;
    if (from === to) continue; // self-reference, skip

    adjacency.get(to)!.push(from);
    inDegree.set(from, (inDegree.get(from) ?? 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [table, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(table);
    }
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Check for cycles
  if (result.length !== tables.length) {
    const remaining = tables.filter((t) => !result.includes(t));
    throw new Error(
      `Circular dependency detected involving tables: ${remaining.join(", ")}`,
    );
  }

  return result;
}

/**
 * Build FK edges from a schema for use with toposort.
 */
export function buildFkEdges(
  tables: Record<
    string,
    {
      foreignKeys: Array<{
        constraintName: string;
        columns: string[];
        refTable: string;
        refColumns: string[];
      }>;
    }
  >,
): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];

  for (const [tableName, table] of Object.entries(tables)) {
    for (const fk of table.foreignKeys) {
      edges.push({ from: tableName, to: fk.refTable });
    }
  }

  return edges;
}
