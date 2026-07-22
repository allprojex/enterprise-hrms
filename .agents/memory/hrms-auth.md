---
name: HRMS auth pattern
description: How authentication works in Enterprise HRMS — token sessions, password hashing, middleware
---

Token-based auth stored in `sessions` table (no JWT, no cookies).

**Why:** Portable across all deployment targets without Redis or session middleware complexity.

**How to apply:**
- Passwords hashed with node:crypto `scrypt` in `artifacts/api-server/src/lib/auth.ts`
- `generateToken()` returns 32-byte hex random token
- Sessions expire after 7 days, stored in `sessions` table with `expires_at`
- `requireAuth` middleware in `artifacts/api-server/src/middlewares/requireAuth.ts` reads `Authorization: Bearer <token>`, joins sessions→users
- Frontend sends token as `Authorization: Bearer <token>` header; token stored in localStorage/state after login

Demo seed credentials: admin@acme.com / Admin@1234, james@acme.com / Employee@1234
