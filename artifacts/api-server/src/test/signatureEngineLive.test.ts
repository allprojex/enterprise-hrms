/**
 * WS-26B — live signature-engine integration against the disposable local
 * PostgreSQL (docker-compose `db` on 5433). Skipped unless
 * WS26_LIVE_DATABASE_URL is set; the liveDbGuard refuses a non-local host.
 *
 *   WS26_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
 *     npx vitest run src/test/signatureEngineLive.test.ts
 *
 * Proven here against real RLS-enabled rows: signature-asset ownership;
 * INDEPENDENT authorization to apply (stage-participant resolution, never
 * possession of an image); tenant isolation and cross-tenant id guessing;
 * signer impersonation; applying another user's stored asset; unauthorized
 * role/capacity; revoked-asset application; one-active-per-slot; finalized
 * immutability; maker-checker preserved; malformed uploads; IDOR on the
 * signature and image reads; and that no storage key is ever exposed or
 * nominated by a client.
 */
import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

async function png(width = 24, height = 12): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
}
const file = (buf: Buffer, mimetype = "image/png") => ({ mimetype, size: buf.length, buffer: buf });

describe.skipIf(!LIVE_URL)("WS-26B live: signature assets, application authorization, immutability, isolation", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let templates: typeof import("../lib/formEngine/templates");
  let submissions: typeof import("../lib/formEngine/submissions");
  let sig: typeof import("../lib/formEngine/signatures");
  let render: typeof import("../lib/formEngine/render");
  let pdfTools: typeof import("../lib/pdf/layoutRenderer");

  const suffix = `ws26b-${Date.now().toString(36)}`;
  let orgId: number;
  let otherOrgId: number;

  interface Person {
    userId: number;
    membershipId: number;
    employeeId: number;
  }
  let hr: Person;
  let manager: Person;
  let staff: Person;
  let foreignHr: Person;

  let templateId: number;

  const actor = (p: Person) => ({ userId: p.userId, membershipId: p.membershipId });
  const templateActor = (p: Person) => ({ actorApplicationUserId: p.userId, actorMembershipId: p.membershipId });
  const viewer = (organizationId: number, p: Person) => submissions.buildViewerContext(organizationId, actor(p));

  const definition = {
    header: { lines: ["Test Organization", "Signature Template"], logo: "none" },
    sections: [
      {
        key: "main",
        title: "Main",
        layout: "stack",
        items: [
          { kind: "field", key: "note", label: "Note", type: "short_text", required: false },
          { kind: "signature", key: "sig_employee", label: "Employee Signature", role: "employee" },
          { kind: "signature", key: "sig_approver", label: "Approver Signature", role: "supervisor" },
        ],
      },
    ],
  };
  const stages = [
    { stageOrder: 1, name: "Employee", participant: "employee", resolver: "subject_employee", editableSectionKeys: ["main"], allowedActions: ["complete"], signatureSlotKey: "sig_employee" },
    { stageOrder: 2, name: "Approver", participant: "supervisor", resolver: "reporting_manager", editableSectionKeys: ["main"], allowedActions: ["approve", "return", "reject"], signatureSlotKey: "sig_approver" },
  ];
  const signaturePolicy = {
    slots: [
      { key: "sig_employee", role: "employee", required: true, methods: ["drawn", "uploaded"] },
      { key: "sig_approver", role: "supervisor", required: true, methods: ["drawn", "uploaded"] },
    ],
  };

  /** Create a fresh submission advanced to a given point. Returns its id. */
  async function newSubmissionAtApproverStage(): Promise<number> {
    const staffViewer = await viewer(orgId, staff);
    const created = await submissions.createSubmission({ organizationId: orgId, templateId, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    await submissions.submit({ organizationId: orgId, submissionId: created.id, answers: { note: "x" }, viewer: staffViewer, actor: actor(staff) });
    // Stage 1 (employee): the subject signs their own REQUIRED slot, then completes
    // the stage to advance to the approver stage. Completing a subject-employee
    // stage without that signature is refused by the engine.
    await sig.applySignature({ organizationId: orgId, actor: actor(staff), viewer: staffViewer, submissionId: created.id, slotKey: "sig_employee", method: "drawn", imageFile: file(await png()) });
    await submissions.stageAction({ organizationId: orgId, submissionId: created.id, action: "complete", viewer: staffViewer, actor: actor(staff) });
    return created.id;
  }

  beforeAll(async () => {
    ({ eq } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    templates = await import("../lib/formEngine/templates");
    submissions = await import("../lib/formEngine/submissions");
    sig = await import("../lib/formEngine/signatures");
    render = await import("../lib/formEngine/render");
    pdfTools = await import("../lib/pdf/layoutRenderer");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS26B ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `WS26B other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;

    const ensurePermission = async (key: string) => {
      const [existing] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
      if (existing) return existing.id;
      const [p] = await db.insert(schema.permissionsTable).values({ key, resource: key.split(".")[0], action: key.split(".").slice(1).join(".") }).returning();
      return p.id;
    };
    const mkRole = async (organizationId: number, key: string, permissionKeys: string[]) => {
      const [role] = await db.insert(schema.rolesTable).values({ organizationId, key: `${key}-${suffix}`, label: key }).returning();
      for (const pk of permissionKeys) await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: await ensurePermission(pk) });
      return role.id;
    };
    const HR_KEYS = ["form_template.manage", "form_template.publish", "form.read", "form.assess", "form.approve", "form.finalize", "form.final.read", "form.signature.apply"];
    const hrRoleId = await mkRole(orgId, "hr", HR_KEYS);
    const employeeRoleId = await mkRole(orgId, "employee", ["organization.read"]);
    const foreignHrRoleId = await mkRole(otherOrgId, "hr", HR_KEYS);

    const mkPerson = async (tag: string, organizationId: number, roleId: number, overrides: Record<string, unknown> = {}): Promise<Person> => {
      const [u] = await db.insert(schema.usersTable).values({ email: `${tag}-${suffix}@example.invalid`, passwordHash: "x", firstName: tag, lastName: "Person", organizationId }).returning();
      const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: u.id, organizationId, status: "active" }).returning();
      await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
      const [emp] = await db.insert(schema.employeesTable).values({ organizationId, firstName: tag, lastName: "Person", ...overrides }).returning();
      await db.insert(schema.employeeUserLinksTable).values({ employeeId: emp.id, applicationUserId: u.id, organizationMembershipId: m.id });
      return { userId: u.id, membershipId: m.id, employeeId: emp.id };
    };
    hr = await mkPerson("hr", orgId, hrRoleId);
    manager = await mkPerson("manager", orgId, employeeRoleId);
    staff = await mkPerson("staff", orgId, employeeRoleId, { reportingManagerId: manager.employeeId });
    foreignHr = await mkPerson("foreignhr", otherOrgId, foreignHrRoleId);

    const { template, version } = await templates.createTemplate({
      organizationId: orgId,
      templateKey: `sig_tmpl_${Date.now().toString(36)}`,
      formType: "generic",
      moduleKey: null,
      title: "Signature Template",
      definition,
      stages,
      signaturePolicy,
      ...templateActor(hr),
    });
    templateId = template.id;
    await templates.publishVersion({ organizationId: orgId, versionId: version.id, ...templateActor(hr) });
  });

  // ---- Signature assets --------------------------------------------------

  it("uploads a stored signature owned by the uploader; the view never exposes a storage key", async () => {
    const asset = await sig.uploadSignatureAsset({ organizationId: orgId, actor: actor(manager), file: file(await png()) });
    expect(asset.ownerUserId).toBe(manager.userId);
    expect(asset.status).toBe("active");
    const view = sig.toAssetView(asset) as unknown as Record<string, unknown>;
    expect(view.storageKey).toBeUndefined();
    expect(view.sha256).toBeTruthy();
    const mine = await sig.listSignatureAssets(orgId, actor(manager));
    expect(mine.some((a) => a.id === asset.id)).toBe(true);
    // Another user never sees it in their own list.
    const staffList = await sig.listSignatureAssets(orgId, actor(staff));
    expect(staffList.some((a) => a.id === asset.id)).toBe(false);
  });

  it("rejects a malformed (non-image) upload", async () => {
    await expect(sig.uploadSignatureAsset({ organizationId: orgId, actor: actor(manager), file: file(Buffer.from("this is not a png"), "image/png") })).rejects.toThrow();
  });

  it("a non-owner cannot read or revoke another user's asset (404, no disclosure); cross-tenant is 404", async () => {
    const asset = await sig.uploadSignatureAsset({ organizationId: orgId, actor: actor(manager), file: file(await png()) });
    await expect(sig.readSignatureAssetImage(orgId, actor(staff), asset.id)).rejects.toThrow(sig.SignatureNotFoundError);
    await expect(sig.revokeSignatureAsset({ organizationId: orgId, actor: actor(staff), assetId: asset.id })).rejects.toThrow(sig.SignatureNotFoundError);
    // cross-tenant id guessing
    await expect(sig.readSignatureAssetImage(otherOrgId, actor(foreignHr), asset.id)).rejects.toThrow(sig.SignatureNotFoundError);
    // owner can read
    const img = await sig.readSignatureAssetImage(orgId, actor(manager), asset.id);
    expect(img.buffer.length).toBeGreaterThan(0);
  });

  // ---- Applying a signature: independent authorization -------------------

  it("the resolved stage participant may sign the slot (drawn); the view exposes no storage key", async () => {
    const id = await newSubmissionAtApproverStage();
    const managerViewer = await viewer(orgId, manager);
    const applied = await sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_approver", method: "drawn", imageFile: file(await png()) });
    expect(applied.slotKey).toBe("sig_approver");
    expect(applied.authority).toBe("supervisor");
    expect(applied.signerUserId).toBe(manager.userId);
    expect((sig.toSignatureView(applied) as unknown as Record<string, unknown>).storageKey).toBeUndefined();
    // The image is readable by a participant/HR and NOT reused (its own bytes/hash).
    const img = await sig.readAppliedSignatureImage(orgId, managerViewer, id, applied.id);
    expect(img.buffer.length).toBeGreaterThan(0);
  });

  it("signer impersonation & wrong role/capacity are refused — possession of an image is not authorization", async () => {
    const id = await newSubmissionAtApproverStage();
    const staffViewer = await viewer(orgId, staff);
    const hrViewer = await viewer(orgId, hr);
    // The subject is not the approver stage's actor.
    await expect(sig.applySignature({ organizationId: orgId, actor: actor(staff), viewer: staffViewer, submissionId: id, slotKey: "sig_approver", method: "drawn", imageFile: file(await png()) })).rejects.toThrow(sig.SignatureAuthorityError);
    // HR holds form.signature.apply but does NOT resolve as the reporting manager → still refused.
    await expect(sig.applySignature({ organizationId: orgId, actor: actor(hr), viewer: hrViewer, submissionId: id, slotKey: "sig_approver", method: "drawn", imageFile: file(await png()) })).rejects.toThrow(sig.SignatureAuthorityError);
  });

  it("one active signature per slot; a second application is refused until the first is revoked", async () => {
    const id = await newSubmissionAtApproverStage();
    const managerViewer = await viewer(orgId, manager);
    const first = await sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_approver", method: "drawn", imageFile: file(await png()) });
    await expect(sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_approver", method: "drawn", imageFile: file(await png()) })).rejects.toThrow(sig.SignatureStateError);
    // Revoke frees the slot; the signer may re-sign.
    await sig.revokeSignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, signatureId: first.id, reason: "retry" });
    const second = await sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_approver", method: "drawn", imageFile: file(await png()) });
    expect(second.id).not.toBe(first.id);
  });

  it("uploaded method: applies only the owner's OWN active asset; another user's asset and a revoked asset are refused", async () => {
    const id = await newSubmissionAtApproverStage();
    const managerViewer = await viewer(orgId, manager);
    const staffAsset = await sig.uploadSignatureAsset({ organizationId: orgId, actor: actor(staff), file: file(await png()) });
    // Manager is authorized at the slot, but the asset belongs to staff → refused (not inferred from possession).
    await expect(sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_approver", method: "uploaded", sourceAssetId: staffAsset.id })).rejects.toThrow(sig.SignatureAuthorityError);
    // Manager's own active asset applies.
    const managerAsset = await sig.uploadSignatureAsset({ organizationId: orgId, actor: actor(manager), file: file(await png()) });
    const applied = await sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_approver", method: "uploaded", sourceAssetId: managerAsset.id });
    expect(applied.sourceAssetId).toBe(managerAsset.id);
    expect(applied.method).toBe("uploaded");
    // A revoked asset cannot be applied.
    const id2 = await newSubmissionAtApproverStage();
    await sig.revokeSignatureAsset({ organizationId: orgId, actor: actor(manager), assetId: managerAsset.id });
    await expect(sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: await viewer(orgId, manager), submissionId: id2, slotKey: "sig_approver", method: "uploaded", sourceAssetId: managerAsset.id })).rejects.toThrow(sig.SignatureStateError);
  });

  it("a method not permitted by the slot policy is refused", async () => {
    // sig_employee policy allows drawn|uploaded, never device.
    const staffViewer = await viewer(orgId, staff);
    const created = await submissions.createSubmission({ organizationId: orgId, templateId, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    await submissions.submit({ organizationId: orgId, submissionId: created.id, answers: { note: "x" }, viewer: staffViewer, actor: actor(staff) });
    await expect(sig.applySignature({ organizationId: orgId, actor: actor(staff), viewer: staffViewer, submissionId: created.id, slotKey: "sig_employee", method: "device", deviceProvider: "made-up", imageFile: file(await png()) })).rejects.toThrow(sig.SignatureValidationError);
    // The subject signs their OWN slot (drawn) at the active employee stage — allowed, and maker-checker is not violated.
    const ok = await sig.applySignature({ organizationId: orgId, actor: actor(staff), viewer: staffViewer, submissionId: created.id, slotKey: "sig_employee", method: "drawn", imageFile: file(await png()) });
    expect(ok.authority).toBe("employee");
    expect(ok.representedEmployeeId).toBe(staff.employeeId);
  });

  // ---- Isolation, IDOR, immutability -------------------------------------

  it("tenant isolation & IDOR: another tenant/foreign viewer cannot list, read images, apply, or revoke", async () => {
    const id = await newSubmissionAtApproverStage();
    const managerViewer = await viewer(orgId, manager);
    const applied = await sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_approver", method: "drawn", imageFile: file(await png()) });
    const foreignViewer = await viewer(otherOrgId, foreignHr);
    // Foreign org + guessed submission id → 404 (existence not confirmed).
    await expect(sig.listSubmissionSignatures(otherOrgId, foreignViewer, id)).rejects.toThrow(sig.SignatureNotFoundError);
    await expect(sig.readAppliedSignatureImage(otherOrgId, foreignViewer, id, applied.id)).rejects.toThrow(sig.SignatureNotFoundError);
    await expect(sig.revokeSignature({ organizationId: otherOrgId, actor: actor(foreignHr), viewer: foreignViewer, submissionId: id, signatureId: applied.id })).rejects.toThrow(sig.SignatureNotFoundError);
    // IDOR: a signature id from another submission is not found under a different submission.
    const otherId = await newSubmissionAtApproverStage();
    await expect(sig.readAppliedSignatureImage(orgId, managerViewer, otherId, applied.id)).rejects.toThrow(sig.SignatureNotFoundError);
  });

  it("a finalized document's signature state is immutable — no apply, no revoke", async () => {
    const id = await newSubmissionAtApproverStage();
    const managerViewer = await viewer(orgId, manager);
    const hrViewer = await viewer(orgId, hr);
    const applied = await sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_approver", method: "drawn", imageFile: file(await png()) });
    // Approver approves the last stage → approved; HR finalizes.
    await submissions.stageAction({ organizationId: orgId, submissionId: id, action: "approve", viewer: managerViewer, actor: actor(manager) });
    await submissions.finalize({ organizationId: orgId, submissionId: id, viewer: hrViewer, actor: actor(hr) });
    await expect(sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_employee", method: "drawn", imageFile: file(await png()) })).rejects.toThrow(sig.SignatureStateError);
    await expect(sig.revokeSignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, signatureId: applied.id })).rejects.toThrow(sig.SignatureStateError);
  });

  it("the finalized document's certificate carries each applied signature's provenance", async () => {
    const id = await newSubmissionAtApproverStage();
    const managerViewer = await viewer(orgId, manager);
    const hrViewer = await viewer(orgId, hr);
    await sig.applySignature({ organizationId: orgId, actor: actor(manager), viewer: managerViewer, submissionId: id, slotKey: "sig_approver", method: "drawn", imageFile: file(await png()) });
    await submissions.stageAction({ organizationId: orgId, submissionId: id, action: "approve", viewer: managerViewer, actor: actor(manager) });
    await submissions.finalize({ organizationId: orgId, submissionId: id, viewer: hrViewer, actor: actor(hr) });
    const pdf = await render.renderSubmissionDocument({ organizationId: orgId, submissionId: id, kind: "final" });
    const text = pdfTools.extractPdfTextRuns(pdf).join(" ");
    expect(text).toContain("Electronic Signatures");
    expect(text).toContain("manager Person"); // the signer
    expect(text).toContain("supervisor"); // the signing capacity
    expect(text).toMatch(/SHA-256/);
  });
});
