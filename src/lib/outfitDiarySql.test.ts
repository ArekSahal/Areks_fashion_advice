// #56: the outfit diary (outfits, outfit_items, item_wear_stats) is owner-only, can only link the user's own photo and
// items, and derives wear counts instead of storing them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
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

  it('allows one entry per user per day and only a photo with the same owner', () => {
    expect(sql).toMatch(/unique \(owner_id, worn_on\)/i);
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

  it('derives wear counts instead of storing them', () => {
    expect(sql).not.toMatch(/\b(wear_count|last_worn_on)\b[^,;]*\b(integer|int|date)\b[^,;]*(default|not null)/i);
    expect(sql).not.toMatch(/alter table public\.clothing_items\s+add column (wear_count|last_worn)/i);
  });
});
