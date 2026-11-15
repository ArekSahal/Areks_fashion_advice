// #34 M1.5 Shop: the Channel3 cache tables are server-only and never hold buy links.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261115140000_channel3_shop_cache.sql'), 'utf8').replace(
  /--.*$/gm,
  '',
);

describe('channel3 shop cache tables', () => {
  for (const table of ['external_products', 'channel3_search_cache']) {
    it(`${table} has RLS on, no policies and no client grants`, () => {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
      expect(sql).not.toMatch(new RegExp(`create policy[^;]*on public\\.${table}`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${table} from anon, authenticated`, 'i'));
      expect(sql).not.toMatch(new RegExp(`grant [^;]* on (table )?public\\.${table}`, 'i'));
    });
  }

  it('has no column for the offer url', () => {
    const table = /create table public\.external_products \(([\s\S]*?)\n\);/i.exec(sql)?.[1] ?? '';
    expect(table).not.toBe('');
    expect(table).not.toMatch(/\b(url|offer_url|buy_url)\b/i);
  });

  it('cleans up expired rows daily', () => {
    expect(sql).toMatch(/cron\.schedule\(\s*'channel3-cache-cleanup'/);
  });
});
