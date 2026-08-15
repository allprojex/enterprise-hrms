/**
 * Unit tests for /api/healthz (liveness) and /api/readyz (readiness).
 * Uses supertest to verify both routes without a real database connection —
 * @workspace/db's pool is constructed against the placeholder DATABASE_URL
 * from test/setup.ts, which genuinely refuses the connection /readyz's
 * "not ready" path relies on; the "ready" path is mocked separately, since
 * this test suite never opens a real database connection anywhere.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../app';

describe('GET /api/healthz', () => {
  it('returns 200 with status ok, unaffected by database reachability', async () => {
    const res = await request(app).get('/api/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('includes a version field, falling back to "unknown" when no release version is configured', async () => {
    const res = await request(app).get('/api/healthz');
    expect(res.body.version).toBe('unknown');
  });
});

describe('GET /api/readyz', () => {
  it('returns 503 with database: "error" when the database is unreachable', async () => {
    const res = await request(app).get('/api/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready', database: 'error' });
  });

  it('returns 200 with database: "ok" when the database responds', async () => {
    const { pool } = await import('@workspace/db');
    const originalQuery = pool.query;
    pool.query = vi.fn().mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) as never;

    try {
      const res = await request(app).get('/api/readyz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ready', database: 'ok' });
    } finally {
      pool.query = originalQuery;
    }
  });
});
