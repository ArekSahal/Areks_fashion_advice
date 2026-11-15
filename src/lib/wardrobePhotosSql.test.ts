// #36: wardrobe_photos is owner-only and its server-managed columns stay out of the client grants.
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

describe('wardrobe_photos', () => {
  it('has RLS and owner-only policies for every action', () => {
    expect(sql).toMatch(/alter table public\.wardrobe_photos enable row level security/i);
    for (const action of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`on public\\.wardrobe_photos for ${action} to authenticated[^;]*auth\\.uid\\(\\)\\) = owner_id`, 'i'));
    }
  });

  it('never lets clients write paths or faces_blurred_at', () => {
    const grants = clientGrants('wardrobe_photos');
    expect(grants.length).toBeGreaterThan(0);
    for (const privileges of grants) {
      expect(privileges).not.toMatch(/image_path|thumb_path|faces_blurred_at|owner_id|\ball\b/i);
      for (const priv of ['insert', 'update']) {
        expect(privileges, `table-wide ${priv}`).not.toMatch(new RegExp(`\\b${priv}\\b(?!\\s*\\()`, 'i'));
      }
    }
  });
});

describe('clothing_items source photo link', () => {
  it('keeps source_photo_id and source_box server-managed', () => {
    for (const privileges of clientGrants('clothing_items')) {
      expect(privileges).not.toMatch(/source_photo_id|source_box/i);
    }
  });
});
