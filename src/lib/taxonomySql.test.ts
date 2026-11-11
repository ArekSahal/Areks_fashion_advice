import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, COLOURS, FITS, MATERIALS, OCCASIONS, PATTERNS, SEASONS } from './taxonomy';

// The database check constraints on clothing_items must allow exactly the taxonomy values.
// If you change taxonomy.ts, add a migration that updates the constraints, then point MIGRATION at it.
const MIGRATION = 'supabase/migrations/20261111064500_clothing_items.sql';
const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8');

/** Quoted values inside the check constraint of one column (text up to the column's closing paren). */
function valuesFor(column: string): string[] {
  const start = sql.search(new RegExp(`^\\s+${column} (text|smallint)`, 'm'));
  expect(start, `column ${column} not found`).toBeGreaterThanOrEqual(0);
  const rest = sql.slice(start);
  const end = rest.search(/\n {2}\w+ (text|smallint|jsonb|timestamptz|uuid)|\n\);/);
  return [...rest.slice(0, end > 0 ? end : undefined).matchAll(/'([a-z_]+(?::[a-z_]+)?)'/g)].map((m) => m[1]);
}

const sorted = (xs: readonly string[]) => [...xs].sort();

describe('clothing_items constraints match taxonomy.ts', () => {
  it('categories', () => expect(sorted(valuesFor('category'))).toEqual(sorted(Object.keys(CATEGORIES))));
  it('category:subcategory pairs', () => {
    const pairs = Object.entries(CATEGORIES).flatMap(([c, subs]) => subs.map((s) => `${c}:${s}`));
    expect(sorted(valuesFor('subcategory'))).toEqual(sorted(pairs));
  });
  it('colours', () => expect(sorted(valuesFor('colours'))).toEqual(sorted(Object.keys(COLOURS))));
  it('patterns', () => expect(sorted(valuesFor('pattern'))).toEqual(sorted(PATTERNS)));
  it('materials', () => expect(sorted(valuesFor('materials'))).toEqual(sorted(Object.keys(MATERIALS))));
  it('fits', () => expect(sorted(valuesFor('fit'))).toEqual(sorted(FITS)));
  it('seasons', () => expect(sorted(valuesFor('seasons'))).toEqual(sorted(SEASONS)));
  it('occasions', () => expect(sorted(valuesFor('occasions'))).toEqual(sorted(OCCASIONS)));
});
