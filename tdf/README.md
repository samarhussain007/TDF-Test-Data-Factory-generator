# TDF (Test Data Factory)

Generate realistic test data for PostgreSQL databases using declarative scenarios.

## Installation

```bash
npm install
```

## Quick Start

### 1. Introspect Your Database

Extract your database schema to a JSON file:

```bash
npm run dev -- introspect \
  -c "postgres://user:pass@localhost:5432/mydb" \
  -o schemas/my-schema.json
```

### 2. Create a Scenario

Define how much data to generate in a JSON file (see `scenarios/eg.json` for a complete example):

```json
{
  "my_scenario": {
    "seed": 42,
    "time": { "mode": "last_n_days", "n": 90 },
    "tables": {
      "organizations": {
        "count": 10
      },
      "users": {
        "perParent": {
          "parent": "organizations",
          "fk": "org_id",
          "min": 5,
          "max": 20
        }
      }
    }
  }
}
```

### 3. Generate SQL

Generate INSERT statements:

```bash
npm run dev -- generate \
  -s schemas/my-schema.json \
  -c scenarios/my-scenario.json \
  -o output/seed.sql
```

Or preview the plan without generating:

```bash
npm run dev -- generate \
  -s schemas/my-schema.json \
  -c scenarios/my-scenario.json \
  --dry-run
```

## Project Structure

```
tdf/
├── schemas/           # Database schema JSON files
│   └── sample_schema.json
├── scenarios/         # Data generation scenarios
│   └── eg.json
├── output/           # Generated SQL files
│   └── *.sql
└── src/              # Source code
    ├── cli.ts
    ├── commands/
    ├── core/
    ├── db/
    ├── models/
    └── util/
```

## Scenario Features

### Count Modes

- **Fixed count**: `{ "count": 100 }`
- **Per-parent**: `{ "perParent": { "parent": "orgs", "fk": "org_id", "min": 5, "max": 10 } }`
- **Many-to-many**: `{ "m2m": { "left": {...}, "right": {...}, "perLeft": {...} } }`

### Column Overrides

```json
{
  "columns": {
    "status": { "oneOf": ["ACTIVE", "DISABLED"] },
    "age": { "range": { "min": 18, "max": 65 } },
    "country": { "fixed": "US" },
    "bio": { "nullRate": 0.3 }
  }
}
```

### Distributions

Weight enum values for realistic distributions:

```json
{
  "distributions": {
    "status": {
      "ACTIVE": 0.7,
      "INVITED": 0.2,
      "DISABLED": 0.1
    }
  }
}
```

### Rules

Apply conditional logic for data coherence:

```json
{
  "rules": [
    { "if": { "status": "PAID" }, "set": { "paid_at": "__AUTO_NOT_NULL__" } },
    { "if": { "status": "PENDING" }, "set": { "paid_at": null } }
  ]
}
```

## CLI Reference

### `introspect`

Extract database schema to JSON.

**Options:**

- `-c, --connection <string>` - PostgreSQL connection string (required)
- `-o, --output <file>` - Output file path (defaults to stdout)

**Example:**

```bash
npm run dev -- introspect -c $DATABASE_URL -o schemas/prod.json
```

### `generate`

Generate test data SQL from schema and scenario.

**Options:**

- `-s, --schema <file>` - Schema JSON file (required)
- `-c, --scenario <file>` - Scenario JSON file (required)
- `-n, --name <name>` - Scenario name (if file contains multiple)
- `-o, --output <file>` - Output SQL file (defaults to stdout)
- `--dry-run` - Show plan without generating SQL

**Example:**

```bash
npm run dev -- generate \
  -s schemas/prod.json \
  -c scenarios/dev-data.json \
  -n small_dev \
  -o output/dev-seed.sql
```

## Development

```bash
# Run in dev mode
npm run dev -- <command>

# Build TypeScript
npm run build

# Run built version
npm start -- <command>
```

## License

ISC
