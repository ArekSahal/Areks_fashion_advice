// #56: the outfit diary (outfits, outfit_items, item_wear_stats) is owner-only, can only link the user's own photo and
// items, and derives wear counts instead of storing them. Behaviour (RLS, cascades) is tested in
// supabase/tests/outfit_diary_rls.sql.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OCCASIONS } from './taxonomy';

const dir = join(process.cwd(), 'supabase/migrations');
const DIARY_MIGRATION = '20261117090000_outfit_diary.sql';
const diarySql = readFileSync(join(dir, DIARY_MIGRATION), 'utf8').replace(/--.*$/gm, '');
const sql = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, ''))
  .join('\n');

function clientGrants(table: string): string[] {
  return [...sql.matchAll(new RegExp(`grant\\s+([^;]*?)\\s+on\\s+(?:table\\s+)?public\\.${table}\\s+to\\s+([^;]+);`, 'gi'))]
    .filter(([, , grantees = '']) => /\b(anon|authenticated|public)\b/i.test(grantees))
    .map(([, privileges = '']) => privileges);
}

function expectNoTableWideWrites(table: string, serverColumns: RegExp) {
  const grants = clientGrants(table);
  expect(grants.length).toBeGreaterThan(0);
  for (const privileges of grants) {
    expect(privileges).not.toMatch(serverColumns);
    expect(privileges).not.toMatch(/\ball\b/i);
    for (const priv of ['insert', 'update']) {
      expect(privileges, `table-wide ${priv} on ${table}`).not.toMatch(new RegExp(`\\b${priv}\\b(?!\\s*\\()`, 'i'));
    }
  }
}

describe('outfits (diary entries)', () => {
  it('has RLS and owner-only policies for every action', () => {
    expect(sql).toMatch(/alter table public\.outfits enable row level security/i);
    for (const action of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`on public\\.outfits for ${action} to authenticated[^;]*auth\\.uid\\(\\)\\) = owner_id`, 'i'));
    }
  });

  it('revokes anon and never lets clients write owner_id or ids', () => {
    expect(sql).toMatch(/revoke all on public\.outfits from anon/i);
    expectNoTableWideWrites('outfits', /owner_id|\bid\b|created_at|updated_at/i);
  });

  it('allows several entries per day (indexed, not unique) and no future days', () => {
    expect(sql).not.toMatch(/unique\s*\(\s*owner_id\s*,\s*worn_on\s*\)/i);
    expect(sql).toMatch(/create index \w+ on public\.outfits \(owner_id, worn_on desc\)/i);
    expect(diarySql).toMatch(/worn_on date not null check \(worn_on <= current_date \+ 1\)/i);
  });

  it('constrains occasion to the taxonomy and lets clients write it', () => {
    const constraint = diarySql.match(/occasion text check \(occasion in \(([^)]*)\)\)/i);
    expect(constraint, 'occasion check constraint').not.toBeNull();
    const values = [...(constraint?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '').sort();
    expect(values).toEqual([...OCCASIONS].sort());
    for (const priv of ['insert', 'update']) {
      expect(clientGrants('outfits').some((g) => new RegExp(`\\b${priv}\\s*\\([^)]*\\boccasion\\b`, 'i').test(g))).toBe(true);
    }
  });

  it('links only a photo with the same owner', () => {
    expect(sql).toMatch(
      /foreign key \(photo_id, owner_id\)\s+references public\.wardrobe_photos \(id, owner_id\) on delete set null \(photo_id\)/i,
    );
  });
});

describe('outfit_items (items worn)', () => {
  it('has RLS and owner-only policies, and no client update', () => {
    expect(sql).toMatch(/alter table public\.outfit_items enable row level security/i);
    for (const action of ['select', 'insert', 'delete']) {
      expect(sql).toMatch(new RegExp(`on public\\.outfit_items for ${action} to authenticated[^;]*auth\\.uid\\(\\)\\) = owner_id`, 'i'));
    }
    for (const privileges of clientGrants('outfit_items')) expect(privileges).not.toMatch(/\bupdate\b/i);
  });

  it('revokes anon and never lets clients write owner_id', () => {
    expect(sql).toMatch(/revoke all on public\.outfit_items from anon/i);
    expectNoTableWideWrites('outfit_items', /owner_id|created_at/i);
  });

  it('requires the entry and the item to belong to the same owner, and cascades', () => {
    expect(sql).toMatch(/foreign key \(outfit_id, owner_id\)\s+references public\.outfits \(id, owner_id\) on delete cascade/i);
    expect(sql).toMatch(
      /foreign key \(item_id, owner_id\)\s+references public\.clothing_items \(id, owner_id\) on delete cascade/i,
    );
  });
});

describe('item_wear_stats', () => {
  it('is a security_invoker view readable only by signed-in users', () => {
    expect(sql).toMatch(/create view public\.item_wear_stats\s+with \(security_invoker = true\)/i);
    expect(sql).toMatch(/revoke all on public\.item_wear_stats from anon/i);
    expect(clientGrants('item_wear_stats')).toEqual(['select']);
  });

  it('derives wear counts (distinct days) instead of storing them', () => {
    const view = sql.match(/create view public\.item_wear_stats[\s\S]*?;/i)?.[0] ?? '';
    expect(view).toMatch(/count\(distinct o\.worn_on\)::integer as wear_count/i);
    expect(view).toMatch(/max\(o\.worn_on\) as last_worn_on/i);
    // Outside the view, no table, column, trigger or function may hold a wear counter.
    expect(sql.replace(view, '')).not.toMatch(/wear_count|last_worn|times_worn|worn_count/i);
  });
});
