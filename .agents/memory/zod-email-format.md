---
name: Zod format:email codegen issue
description: Using format:email in OpenAPI spec causes broken Zod v3 codegen output
---

**Rule:** Never use `format: email` on string fields in `lib/api-spec/openapi.yaml`.

**Why:** Orval generates `zod.email()` for `format: email` fields. That method doesn't exist in Zod v3 (`zod.string().email()` is the v3 API). The generated `lib/api-zod/src/generated/api.ts` fails `typecheck:libs` with `TS2339: Property 'email' does not exist on type 'typeof zod'`.

**How to apply:** For email fields in the OpenAPI spec, use plain `type: string` without any format annotation. Apply email validation in route handlers with `z.string().email()` if needed.
