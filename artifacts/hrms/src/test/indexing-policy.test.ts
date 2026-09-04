/**
 * Indexing policy guard (post-deployment edge hardening).
 *
 * The application is authenticated, multi-tenant HR data: it must never be
 * indexed. The policy is declared at SOURCE here (document meta + robots.txt)
 * and additionally enforced at the edge (X-Robots-Tag, deploy/nginx). These
 * assertions stop a template regression from shipping "index, follow" again.
 * A future public-careers exception is a deliberate, tenant-level feature,
 * not a change to these defaults.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const robotsTxt = readFileSync(resolve(root, 'public', 'robots.txt'), 'utf8');

describe('indexing policy at source', () => {
  it('index.html declares the no-index robots meta', () => {
    expect(indexHtml).toMatch(/<meta name="robots" content="noindex, nofollow, noarchive, nosnippet" \/>/);
    expect(indexHtml).not.toMatch(/content="index, follow"/);
  });

  it('index.html carries no placeholder SEO text', () => {
    expect(indexHtml).not.toMatch(/Update this description/i);
  });

  it('robots.txt disallows everything', () => {
    expect(robotsTxt.replace(/\r\n/g, '\n').trim()).toBe('User-agent: *\nDisallow: /');
  });

  it('no sitemap is shipped', () => {
    expect(() => readFileSync(resolve(root, 'public', 'sitemap.xml'))).toThrow();
  });
});
