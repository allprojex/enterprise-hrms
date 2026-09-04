// Edge header consistency probes (post-deployment edge hardening).
//
// Verifies, against a running deployment, that the browser-facing security
// headers are exactly as designed in deploy/nginx/*:
//   - exactly ONE Strict-Transport-Security on the SPA document and on /api/*
//     (Helmet's copy is hidden at the edge; the edge emits the single header);
//   - no duplicated X-Frame-Options / X-Content-Type-Options / Referrer-Policy
//     on /api/* (Helmet is authoritative there);
//   - the static surface carries HSTS, X-Robots-Tag, XFO DENY, nosniff,
//     Referrer-Policy, Permissions-Policy and a REPORT-ONLY CSP (never enforced
//     by this release);
//   - X-Robots-Tag on every surface, /robots.txt disallows /, /sitemap.xml 404,
//     the served document carries the no-index meta;
//   - the plain-HTTP 301 carries no HSTS.
//
// Plain Node ESM, no dependencies (repo convention — see tools/ci/*.mjs).
// Usage: node tools/security/edge-header-probes.mjs https://hrms.afripebbles.com
// Exit code 0 = all probes pass, 1 = at least one failed.

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!base) {
  console.error("usage: node tools/security/edge-header-probes.mjs <https://host>");
  process.exit(2);
}

const failures = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures.push(msg);
};

async function probe(path, init = {}) {
  const res = await fetch(base + path, { redirect: "manual", ...init });
  // Node's fetch merges duplicate headers with ", "; count instances from the raw entries.
  const counts = {};
  for (const [k] of res.headers.entries()) counts[k.toLowerCase()] = (counts[k.toLowerCase()] ?? 0) + 1;
  const raw = res.headers.get("strict-transport-security") ?? "";
  // A merged value with a comma means two headers were sent.
  const hstsCount = raw ? raw.split(",").length : 0;
  const body = await res.text();
  return { status: res.status, headers: res.headers, counts, hstsCount, body };
}

const HSTS = "max-age=31536000; includeSubDomains";
const ROBOTS = "noindex, nofollow, noarchive, nosnippet";

const home = await probe("/");
ok(home.status === 200, "GET / is 200");
ok(home.hstsCount === 1 && home.headers.get("strict-transport-security") === HSTS, "exactly one HSTS on / with the designed value (no preload)");
ok(home.headers.get("x-robots-tag") === ROBOTS, "X-Robots-Tag on /");
ok(home.headers.get("x-frame-options") === "DENY", "X-Frame-Options DENY on static surface");
ok(home.headers.get("x-content-type-options") === "nosniff", "nosniff on static surface");
ok(home.headers.get("referrer-policy") === "strict-origin-when-cross-origin", "Referrer-Policy on static surface");
ok(home.headers.get("permissions-policy") === "camera=(), microphone=(), geolocation=()", "Permissions-Policy on static surface");
ok(!!home.headers.get("content-security-policy-report-only"), "CSP Report-Only present on SPA document");
ok(!home.headers.get("content-security-policy"), "CSP is NOT enforced on the SPA document in this release");
ok(/<meta name="robots" content="noindex, nofollow, noarchive, nosnippet"/.test(home.body), "served document carries the no-index meta");
ok(!/content="index, follow"/.test(home.body), "served document has no index,follow meta");

const login = await probe("/login");
ok(login.status === 200 && /<meta name="robots" content="noindex/.test(login.body), "SPA fallback route /login serves the document with no-index meta");

const robots = await probe("/robots.txt");
ok(robots.status === 200 && /User-agent: \*\s+Disallow: \/\s*$/.test(robots.body), "/robots.txt disallows /");
ok(robots.headers.get("x-robots-tag") === ROBOTS && robots.hstsCount === 1, "/robots.txt carries X-Robots-Tag and one HSTS");

const sitemap = await probe("/sitemap.xml");
ok(sitemap.status === 404, "/sitemap.xml is 404");

const api = await probe("/api/healthz");
ok(api.status === 200 && /"version":"[0-9a-f]{40}"/.test(api.body), "/api/healthz 200 with a release SHA");
ok(api.hstsCount === 1 && api.headers.get("strict-transport-security") === HSTS, "exactly one HSTS on /api/healthz");
ok((api.counts["x-frame-options"] ?? 0) === 1 && api.headers.get("x-frame-options") === "SAMEORIGIN", "single X-Frame-Options on API (Helmet's)");
ok((api.counts["x-content-type-options"] ?? 0) === 1, "single X-Content-Type-Options on API");
ok((api.counts["referrer-policy"] ?? 0) === 1 && api.headers.get("referrer-policy") === "no-referrer", "single Referrer-Policy on API (Helmet's no-referrer)");
ok(!!api.headers.get("content-security-policy") && !api.headers.get("content-security-policy-report-only"), "API keeps Helmet's enforced CSP and no report-only CSP");
ok(api.headers.get("x-robots-tag") === ROBOTS, "X-Robots-Tag on API");
ok(!api.headers.get("x-powered-by"), "no X-Powered-By");

const spoof = await probe("/api/tenant-context", { headers: { "X-Tenant-Hostname": "wwm.localhost", "X-Forwarded-Host": "wwm.localhost" } });
ok(spoof.status === 200 && /"resolved":false/.test(spoof.body), "tenant override headers are stripped at the edge");

if (base.startsWith("https://")) {
  const http = await probe("/".replace(/^/, ""), {});
  const plain = await fetch(base.replace(/^https:/, "http:") + "/", { redirect: "manual" });
  ok(plain.status === 301 && /^https:\/\//.test(plain.headers.get("location") ?? ""), "HTTP redirects 301 to HTTPS");
  ok(!plain.headers.get("strict-transport-security"), "HTTP 301 carries no HSTS");
  void http;
}

console.log(failures.length ? `\n${failures.length} probe(s) FAILED` : "\nAll edge header probes passed.");
process.exit(failures.length ? 1 : 0);
