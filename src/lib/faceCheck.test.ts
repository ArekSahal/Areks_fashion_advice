// process-image's faces_blurred_at decision and the column grants that keep clients from setting it.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { facesBlurredAt } from '../../supabase/functions/_shared/face-check';

describe('facesBlurredAt', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  it('marks the item when the device blurred faces or found none', () => {
    expect(facesBlurredAt('blurred', now)).toBe('2026-11-14T10:00:00.000Z');
    expect(facesBlurredAt('none', now)).toBe('2026-11-14T10:00:00.000Z');
  });
  it('leaves it unset otherwise (fail closed)', () => {
    for (const value of ['skipped', undefined, null, '', 'BLURRED', true, 1, ['blurred'], { blurred: true }]) {
      expect(facesBlurredAt(value, now)).toBeNull();
    }
  });
});

describe('clients cannot set clothing_items.faces_blurred_at', () => {
  const dir = join(process.cwd(), 'supabase/migrations');
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, ''))
    .join('\n');
  const grants = [...sql.matchAll(/grant\s+([^;]*?)\s+on\s+(?:table\s+)?public\.clothing_items\s+to\s+([^;]+);/gi)];

  it('finds the clothing_items grants', () => {
    expect(grants.length).toBeGreaterThan(0);
  });

  it('never grants insert/update on the whole table, or on faces_blurred_at, to clients', () => {
    for (const [, privileges = '', grantees = ''] of grants) {
      if (!/\b(anon|authenticated|public)\b/i.test(grantees)) continue;
      expect(privileges).not.toMatch(/faces_blurred_at/i);
      expect(privileges).not.toMatch(/\ball\b/i);
      // insert/update must always be column-limited: "insert (...)", never a bare "insert".
      for (const priv of ['insert', 'update']) {
        const bare = new RegExp(`\\b${priv}\\b(?!\\s*\\()`, 'i');
        expect(privileges, `table-wide ${priv} on clothing_items`).not.toMatch(bare);
      }
    }
  });
});
