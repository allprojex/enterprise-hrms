/**
 * WS-18 Pass 3 — targeted DAST probes against the disposable stack.
 *
 * Complements the ZAP baseline scan rather than replacing it: ZAP is good at
 * passive/generic web weaknesses, but the frozen owner decisions (OD-WS18-9
 * TRUST_PROXY, OD-WS18-10 CORS) and this platform's tenant model need exact,
 * asserted probes that a generic crawler cannot express.
 *
 * Read-only or additive against disposable synthetic tenants only. No
 * destructive or availability testing.
 */
const BASE = process.env.DAST_BASE ?? "http://127.0.0.1:55441";

// NOT A SECRET. This is a synthetic password for disposable fixture accounts in a
// throwaway local database, seeded and destroyed within a single security-test
// run. It never applies to any real account, environment, or deployment. Kept
// literal (rather than env-driven) so a security run is reproducible from the
// repository alone; override with DAST_FIXTURE_PASSWORD if a scanner policy
// requires it.
const PW = process.env.DAST_FIXTURE_PASSWORD ?? "DisposableDastPassw0rd!";

const results = [];
function record(section, name, pass, detail) {
  results.push({ section, name, pass, detail });
  const mark = pass === true ? "PASS" : pass === false ? "FAIL" : "INFO";
  console.log(`  [${mark}] ${name}${detail ? " — " + detail : ""}`);
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: "manual", ...opts });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, text, body };
}

async function login(email) {
  const r = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  return r.body?.token ?? r.body?.session?.token ?? null;
}

const ORG_A = Number(process.env.ORG_A);
const ORG_B = Number(process.env.ORG_B);

// Tokens are acquired FIRST and reused for the whole run.
//
// /auth/login has its own 10-per-15-minute per-IP limiter, and the TRUST_PROXY
// probe deliberately exhausts a limiter. Authenticating after that probe would
// throttle every later request and turn the entire tenant section into false
// 401s that read like passing denials — a security suite failing open. Order
// matters here; do not rearrange.
const TOK = {};

(async () => {
  TOK.a = await login("alpha.admin@dast.invalid");
  TOK.b = await login("beta.admin@dast.invalid");
  TOK.emp = await login("alpha.employee@dast.invalid");

  console.log("\n=== §9 SECURITY HEADERS ===");
  {
    const r = await req("/api/healthz");
    const h = (n) => r.headers.get(n);
    record("headers", "Content-Security-Policy present", !!h("content-security-policy"), h("content-security-policy")?.slice(0, 60) + "…");
    record("headers", "CSP default-src 'none'", (h("content-security-policy") || "").includes("default-src 'none'"));
    record("headers", "CSP frame-ancestors set", (h("content-security-policy") || "").includes("frame-ancestors"));
    record("headers", "X-Content-Type-Options: nosniff", h("x-content-type-options") === "nosniff");
    record("headers", "Referrer-Policy set", !!h("referrer-policy"), h("referrer-policy"));
    record("headers", "X-Frame-Options set", !!h("x-frame-options"), h("x-frame-options"));
    record("headers", "HSTS present", !!h("strict-transport-security"), h("strict-transport-security"));
    record("headers", "X-Powered-By suppressed", !h("x-powered-by"), h("x-powered-by") ?? "absent");
  }

  console.log("\n=== §10 CORS (OD-WS18-10) ===");
  {
    // Case A — production default, no CORS_ORIGIN. A hostile Origin must not be
    // authorized to read responses.
    const hostile = await req("/api/healthz", { headers: { Origin: "https://evil.invalid" } });
    const acao = hostile.headers.get("access-control-allow-origin");
    record("cors", "Case A: hostile Origin receives no ACAO header", !acao, acao ?? "absent");
    record("cors", "Case A: no wildcard ACAO", acao !== "*", acao ?? "absent");

    // Case C — an Authorization-bearing cross-origin request must not become
    // browser-readable via wildcard or reflection.
    const tok = TOK.a;
    const authed = await req(`/api/organizations/${ORG_A}/branches`, {
      headers: { Origin: "https://evil.invalid", Authorization: `Bearer ${tok}` },
    });
    const acao2 = authed.headers.get("access-control-allow-origin");
    record("cors", "Case C: authenticated cross-origin gets no ACAO", !acao2, acao2 ?? "absent");
    record("cors", "Case C: credentials not blanket-allowed", authed.headers.get("access-control-allow-credentials") !== "true");

    // Same-origin equivalent (no Origin header) must still work normally.
    const same = await req("/api/healthz");
    record("cors", "same-origin request succeeds", same.status === 200, `status ${same.status}`);

    // Preflight from a hostile origin must not be authorized.
    const pre = await req(`/api/organizations/${ORG_A}/branches`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.invalid",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    record("cors", "hostile preflight not authorized", !pre.headers.get("access-control-allow-origin"), `status ${pre.status}`);
  }

  // Defined here for readability, invoked LAST — it exhausts a limiter.
  async function trustProxyProbe() {
    console.log("\n=== §11 TRUST_PROXY (OD-WS18-9) ===");
    // Trust is OFF in this container (TRUST_PROXY unset). A client-supplied
    // X-Forwarded-For must NOT be able to mint fresh rate-limit identities.
    let throttled = false;
    let attempts = 0;
    for (let i = 0; i < 14; i += 1) {
      attempts += 1;
      const r = await req("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.9.9.${i}` },
        body: JSON.stringify({ email: "nobody@dast.invalid", password: "wrong" }),
      });
      if (r.status === 429) {
        throttled = true;
        break;
      }
    }
    record(
      "trustproxy",
      "spoofed X-Forwarded-For cannot evade the limiter when trust is off",
      throttled,
      throttled ? `throttled after ${attempts} spoofed identities` : "NEVER throttled — spoofing worked",
    );
  }

  console.log("\n=== §12 PASSWORD RECOVERY ===");
  {
    const a = await req("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alpha.admin@dast.invalid" }),
    });
    const b = await req("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "definitely-not-registered@dast.invalid" }),
    });
    record("f2", "registered vs unregistered: identical status", a.status === b.status, `${a.status} vs ${b.status}`);
    record("f2", "registered vs unregistered: identical body", a.text === b.text);

    let rl = false;
    for (let i = 0; i < 10; i += 1) {
      const r = await req("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `probe${i}@dast.invalid` }),
      });
      if (r.status === 429) {
        rl = true;
        break;
      }
    }
    record("f2", "forgot-password is rate limited", rl);

    const bad = await req("/api/auth/reset-password/not-a-real-token-aaaaaaaa");
    record("f2", "malformed token: no stack leak", !/\s+at\s+\S+\s+\(/.test(bad.text), `status ${bad.status}`);

    const badPost = await req("/api/auth/reset-password/not-a-real-token-aaaaaaaa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "SomeNewPassw0rd!" }),
    });
    record("f2", "invalid token rejected", badPost.status >= 400, `status ${badPost.status}`);
    record("f2", "invalid token: no source paths", !badPost.text.includes("api-server/src"));
  }

  console.log("\n=== §13 ERROR HANDLING ===");
  {
    const tok = TOK.a;
    const auth = { Authorization: `Bearer ${tok}` };

    const probes = [
      ["malformed JSON", await req(`/api/organizations/${ORG_A}/branches`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{ not json" })],
      ["non-numeric route param", await req("/api/organizations/not-a-number/branches", { headers: auth })],
      ["huge route param", await req(`/api/organizations/${"9".repeat(400)}/branches`, { headers: auth })],
      ["unsupported method", await req(`/api/organizations/${ORG_A}/branches`, { method: "PATCH", headers: auth })],
      ["unexpected content type", await req(`/api/organizations/${ORG_A}/branches`, { method: "POST", headers: { ...auth, "Content-Type": "text/xml" }, body: "<a/>" })],
      ["unknown route", await req("/api/does-not-exist", { headers: auth })],
      ["SQL-ish param", await req(`/api/organizations/${ORG_A}/branches?code='%20OR%201=1--`, { headers: auth })],
      ["path traversal", await req("/api/../../etc/passwd", { headers: auth })],
      ["null byte", await req(`/api/organizations/${ORG_A}%00/branches`, { headers: auth })],
    ];

    const leakPatterns = [
      [/\s+at\s+\S+\s+\(/, "stack frame"],
      [/api-server[\/\\]src/, "source path"],
      [/node_modules/, "node_modules path"],
      [/postgres(ql)?:\/\//, "connection string"],
      [/\bSELECT\b.*\bFROM\b/i, "SQL"],
      [/<!DOCTYPE html>/i, "HTML error page"],
      [/DATABASE_URL/, "env var name"],
    ];
    for (const [name, r] of probes) {
      const found = leakPatterns.filter(([re]) => re.test(r.text)).map(([, n]) => n);
      record("errors", `${name} (status ${r.status})`, found.length === 0, found.length ? "LEAKED: " + found.join(", ") : "no leakage");
    }
  }

  console.log("\n=== §8/§15 TENANT + IDOR INDICATORS ===");
  {
    const tokA = TOK.a, tokB = TOK.b, tokEmp = TOK.emp;
    record("tenant", "disposable logins succeed", !!tokA && !!tokB && !!tokEmp);

    const ownA = await req(`/api/organizations/${ORG_A}/branches`, { headers: { Authorization: `Bearer ${tokA}` } });
    record("tenant", "positive control: Alpha reads own branches", ownA.status === 200, `status ${ownA.status}`);

    const cross = await req(`/api/organizations/${ORG_B}/branches`, { headers: { Authorization: `Bearer ${tokA}` } });
    record("tenant", "Alpha CANNOT read Beta branches", cross.status === 403 || cross.status === 404, `status ${cross.status}`);
    record("tenant", "cross-tenant denial leaks no data", !cross.text.includes("Beta Confidential Site"));

    const reverse = await req(`/api/organizations/${ORG_A}/branches`, { headers: { Authorization: `Bearer ${tokB}` } });
    record("tenant", "Beta CANNOT read Alpha branches", reverse.status === 403 || reverse.status === 404, `status ${reverse.status}`);

    const forced = await req(`/api/organizations/${ORG_B}/branches`);
    record("tenant", "forced browsing without auth is rejected", forced.status === 401, `status ${forced.status}`);

    // Predictable identifier walk — organization ids are sequential integers.
    const walk = [];
    for (let id = 1; id <= 8; id += 1) {
      const r = await req(`/api/organizations/${id}/branches`, { headers: { Authorization: `Bearer ${tokA}` } });
      if (r.status === 200) walk.push(id);
    }
    record("tenant", "identifier walk exposes only the caller's own org", walk.length === 1 && walk[0] === ORG_A, `readable org ids: ${walk.join(",") || "none"}`);

    // Body-supplied organizationId must not relocate a write.
    const mass = await req(`/api/organizations/${ORG_A}/branches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "DAST Probe", code: `DP-${Date.now()}`, organizationId: ORG_B }),
    });
    const landedIn = mass.body?.organizationId;
    record("tenant", "mass-assigned organizationId ignored", mass.status === 201 && landedIn === ORG_A, `created in org ${landedIn}`);

    // Platform-operation surface sampled separately, with a non-super_admin.
    const plat = await req("/api/installations", { headers: { Authorization: `Bearer ${tokA}` } });
    record("tenant", "tenant admin denied platform surface", plat.status === 401 || plat.status === 403 || plat.status === 404, `status ${plat.status}`);
  }

  console.log("\n=== §15 OPEN REDIRECT / HEADER INJECTION ===");
  {
    const tok = TOK.a;
    const redir = await req("/api/auth/login?next=https://evil.invalid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "alpha.admin@dast.invalid", password: PW }) });
    const loc = redir.headers.get("location");
    record("webattacks", "no open redirect via next param", !loc || !loc.includes("evil.invalid"), loc ?? "no Location header");

    const inj = await req(`/api/organizations/${ORG_A}/branches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "hdr\r\nX-Injected: yes", code: `HI-${Date.now()}` }),
    });
    record("webattacks", "CRLF in field does not inject a header", !inj.headers.get("x-injected"), `status ${inj.status}`);

    const xss = await req(`/api/organizations/${ORG_A}/branches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "<script>alert(1)</script>", code: `XS-${Date.now()}` }),
    });
    const list = await req(`/api/organizations/${ORG_A}/branches`, { headers: { Authorization: `Bearer ${tok}` } });
    record("webattacks", "stored payload returned as JSON not HTML", (list.headers.get("content-type") || "").includes("application/json"), list.headers.get("content-type"));
    record("webattacks", "stored payload response is not an HTML document", !list.text.includes("<!DOCTYPE"), `status ${xss.status}`);
  }

  await trustProxyProbe();

  const failed = results.filter((r) => r.pass === false);
  console.log(`\n=== SUMMARY: ${results.filter((r) => r.pass === true).length} pass, ${failed.length} fail, ${results.length} total ===`);
  if (failed.length) {
    console.log("FAILURES:");
    for (const f of failed) console.log(`  - [${f.section}] ${f.name} — ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("PROBE HARNESS ERROR:", e);
  process.exit(2);
});
