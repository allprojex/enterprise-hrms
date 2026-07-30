/**
 * Integration tests for the Public Careers Portal (Phase 3A, W49),
 * exercising real Express routing through supertest — no `requireAuth`/
 * `requireMembership` chain exists on these routes (they are genuinely
 * public). Mirrors vacancies.test.ts's harness style (real field-based
 * filtering, simulated unique-index/status-guard behavior). No real
 * database connection, filesystem write, or outbound email is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const rateLimitMock = vi.fn((_options?: unknown) => (_req: unknown, _res: unknown, next: () => void) => next());
vi.mock("express-rate-limit", () => ({ default: (options?: unknown) => rateLimitMock(options) }));

const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/email", () => ({ getEmailProvider: () => ({ send: sendEmailMock }) }));

const writeOrgFileMock = vi.fn().mockResolvedValue("candidate-documents/fake-key.pdf");
vi.mock("../lib/fileStorage", () => ({ writeOrgFile: (...args: unknown[]) => writeOrgFileMock(...args) }));

const {
  fixtures,
  organizationsTable,
  recruitmentSettingsTable,
  vacanciesTable,
  jobRequisitionsTable,
  vacancyLocationsTable,
  branchesTable,
  departmentsTable,
  candidatesTable,
  candidateConsentsTable,
  candidateDocumentsTable,
  applicationsTable,
  vacancyQuestionsTable,
  applicationAnswersTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      organizationRows: [] as Record<string, unknown>[],
      recruitmentSettingsRows: [] as Record<string, unknown>[],
      vacancyRows: [] as Record<string, unknown>[],
      jobRequisitionRows: [] as Record<string, unknown>[],
      vacancyLocationRows: [] as Record<string, unknown>[],
      branchRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      candidateRows: [] as Record<string, unknown>[],
      candidateConsentRows: [] as Record<string, unknown>[],
      candidateDocumentRows: [] as Record<string, unknown>[],
      applicationRows: [] as Record<string, unknown>[],
      vacancyQuestionRows: [] as Record<string, unknown>[],
      applicationAnswerRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    organizationsTable: mockTable("organizations", ["id", "slug", "name", "logoUrl", "status"]),
    recruitmentSettingsTable: mockTable("recruitment_settings", ["id", "organizationId", "enabled", "externalRecruitmentEnabled", "applicationLimitPerCandidate"]),
    vacanciesTable: mockTable("vacancies", [
      "id",
      "organizationId",
      "requisitionId",
      "publicId",
      "title",
      "visibility",
      "status",
      "openingsCount",
      "filledCount",
      "openDate",
      "closeDate",
      "jobDescription",
      "featured",
    ]),
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "departmentId", "employmentType", "workplaceType"]),
    vacancyLocationsTable: mockTable("vacancy_locations", ["id", "organizationId", "vacancyId", "branchId", "label"]),
    branchesTable: mockTable("branches", ["id", "organizationId", "name"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    candidatesTable: mockTable("candidates", ["id", "organizationId", "firstName", "lastName", "email", "phone"]),
    candidateConsentsTable: mockTable("candidate_consents", ["id", "organizationId", "candidateId", "privacyNoticeVersion", "consentText"]),
    candidateDocumentsTable: mockTable("candidate_documents", ["id", "organizationId", "candidateId", "applicationId", "categoryCode", "fileName", "mimeType", "fileSize", "storageKey"]),
    applicationsTable: mockTable("applications", ["id", "organizationId", "candidateId", "vacancyId", "publicId", "statusCheckToken", "statusCheckTokenExpiresAt", "submittedAt"]),
    vacancyQuestionsTable: mockTable("vacancy_questions", ["id", "organizationId", "vacancyId", "questionText", "questionType", "isKnockout", "expectedAnswer", "displayOrder", "isActive"]),
    applicationAnswersTable: mockTable("application_answers", ["id", "organizationId", "applicationId", "vacancyQuestionId", "answerText", "knockoutFailed"]),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | { __op: "inArray"; field: string; vals: unknown[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  return true;
}

function getRowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationsTable) return fixtures.organizationRows;
  if (table === recruitmentSettingsTable) return fixtures.recruitmentSettingsRows;
  if (table === vacanciesTable) return fixtures.vacancyRows;
  if (table === jobRequisitionsTable) return fixtures.jobRequisitionRows;
  if (table === vacancyLocationsTable) return fixtures.vacancyLocationRows;
  if (table === branchesTable) return fixtures.branchRows;
  if (table === departmentsTable) return fixtures.departmentRows;
  if (table === candidatesTable) return fixtures.candidateRows;
  if (table === candidateConsentsTable) return fixtures.candidateConsentRows;
  if (table === candidateDocumentsTable) return fixtures.candidateDocumentRows;
  if (table === applicationsTable) return fixtures.applicationRows;
  if (table === vacancyQuestionsTable) return fixtures.vacancyQuestionRows;
  if (table === applicationAnswersTable) return fixtures.applicationAnswerRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === candidatesTable) fixtures.candidateRows = rows;
  else if (table === candidateConsentsTable) fixtures.candidateConsentRows = rows;
  else if (table === candidateDocumentsTable) fixtures.candidateDocumentRows = rows;
  else if (table === applicationsTable) fixtures.applicationRows = rows;
  else if (table === applicationAnswersTable) fixtures.applicationAnswerRows = rows;
}

function selectBuilder(table: { __name: string }) {
  const rows = getRowsFor(table);
  let filtered = rows;
  const builder = {
    where(cond: Cond) {
      filtered = rows.filter((r) => matches(r, cond));
      return builder;
    },
    limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
    orderBy: () => Promise.resolve(filtered),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
  };
  return builder;
}

function insertSingleRow(table: { __name: string }, v: Record<string, unknown>): Record<string, unknown> {
  const defaults: Record<string, unknown> = table === applicationsTable ? {} : {};
  const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...v };
  const current = getRowsFor(table);
  setRowsFor(table, [...current, row]);
  return row;
}

function insertRow(table: { __name: string }, v: Record<string, unknown> | Record<string, unknown>[]) {
  const rows = Array.isArray(v) ? v.map((item) => insertSingleRow(table, item)) : [insertSingleRow(table, v)];
  return { returning: () => Promise.resolve(rows) };
}

function makeQueryClient() {
  return {
    select: () => ({ from: (table: { __name: string }) => selectBuilder(table) }),
    insert: (table: { __name: string }) => ({ values: (v: Record<string, unknown> | Record<string, unknown>[]) => insertRow(table, v) }),
  };
}

vi.mock("@workspace/db", () => ({
  organizationsTable,
  recruitmentSettingsTable,
  vacanciesTable,
  jobRequisitionsTable,
  vacancyLocationsTable,
  branchesTable,
  departmentsTable,
  candidatesTable,
  candidateConsentsTable,
  candidateDocumentsTable,
  applicationsTable,
  vacancyQuestionsTable,
  applicationAnswersTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: ReturnType<typeof makeQueryClient>) => Promise<unknown>) => cb(makeQueryClient()),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const ORG_SLUG = "acme";
const REQUISITION_ID = 500;
const DEPARTMENT_ID = 700;
const BRANCH_ID = 800;

function seedOrg(overrides: Record<string, unknown> = {}) {
  fixtures.organizationRows = [{ id: ORG_ID, slug: ORG_SLUG, name: "Acme Corp", logoUrl: null, status: "active", ...overrides }];
}

function seedSettings(overrides: Record<string, unknown> = {}) {
  fixtures.recruitmentSettingsRows = [{ id: 1, organizationId: ORG_ID, enabled: true, externalRecruitmentEnabled: true, applicationLimitPerCandidate: null, ...overrides }];
}

function seedRequisition() {
  fixtures.jobRequisitionRows = [{ id: REQUISITION_ID, organizationId: ORG_ID, departmentId: DEPARTMENT_ID, employmentType: "full_time", workplaceType: "remote" }];
  fixtures.departmentRows = [{ id: DEPARTMENT_ID, organizationId: ORG_ID, name: "Engineering" }];
}

function seedVacancy(overrides: Record<string, unknown> = {}) {
  fixtures.vacancyRows = [
    {
      id: 1,
      organizationId: ORG_ID,
      requisitionId: REQUISITION_ID,
      publicId: "vac-public-1",
      title: "Software Engineer",
      visibility: "external",
      status: "published",
      openingsCount: 2,
      filledCount: 0,
      openDate: null,
      closeDate: null,
      jobDescription: "Build things.",
      featured: false,
      ...overrides,
    },
  ];
}

beforeEach(() => {
  fixtures.organizationRows = [];
  fixtures.recruitmentSettingsRows = [];
  fixtures.vacancyRows = [];
  fixtures.jobRequisitionRows = [];
  fixtures.vacancyLocationRows = [];
  fixtures.branchRows = [];
  fixtures.departmentRows = [];
  fixtures.candidateRows = [];
  fixtures.candidateConsentRows = [];
  fixtures.candidateDocumentRows = [];
  fixtures.applicationRows = [];
  fixtures.vacancyQuestionRows = [];
  fixtures.applicationAnswerRows = [];
  fixtures.idCounters = new Map();
  // rateLimitMock is deliberately never cleared -- the real route file
  // only calls the rateLimit(...) factory once, at module load time
  // (before this beforeEach ever runs), to build each limiter middleware.
  // Clearing it here would erase the only record of that call.
  sendEmailMock.mockClear();
  writeOrgFileMock.mockClear();
  process.env.APP_BASE_URL = "https://hrms.example.com";
});

describe("GET /api/careers/:orgSlug", () => {
  it("resolves an active organization with careers enabled", async () => {
    seedOrg();
    seedSettings();
    const res = await request(app).get(`/api/careers/${ORG_SLUG}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ slug: ORG_SLUG, name: "Acme Corp", logoUrl: null });
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await request(app).get("/api/careers/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns the same 404 for a suspended organization", async () => {
    seedOrg({ status: "suspended" });
    seedSettings();
    const res = await request(app).get(`/api/careers/${ORG_SLUG}`);
    expect(res.status).toBe(404);
  });

  it("returns the same 404 when recruitment_settings.enabled is false", async () => {
    seedOrg();
    seedSettings({ enabled: false });
    const res = await request(app).get(`/api/careers/${ORG_SLUG}`);
    expect(res.status).toBe(404);
  });

  it("returns the same 404 when externalRecruitmentEnabled is false", async () => {
    seedOrg();
    seedSettings({ externalRecruitmentEnabled: false });
    const res = await request(app).get(`/api/careers/${ORG_SLUG}`);
    expect(res.status).toBe(404);
  });

  it("returns the same 404 when no recruitment_settings row exists at all (safe default)", async () => {
    seedOrg();
    const res = await request(app).get(`/api/careers/${ORG_SLUG}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/careers/:orgSlug/vacancies — eligibility", () => {
  beforeEach(() => {
    seedOrg();
    seedSettings();
    seedRequisition();
  });

  it("lists a published, externally-visible vacancy", async () => {
    seedVacancy();
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/vacancies`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ publicId: "vac-public-1", title: "Software Engineer", departmentName: "Engineering", employmentType: "full_time", workplaceType: "remote" });
    // Never leaks internal IDs.
    expect(res.body.items[0].id).toBeUndefined();
    expect(res.body.items[0].requisitionId).toBeUndefined();
  });

  it.each([
    ["draft", { status: "draft" }],
    ["scheduled", { status: "scheduled" }],
    ["paused", { status: "paused" }],
    ["closed", { status: "closed" }],
    ["archived", { status: "archived" }],
    ["internal-only", { visibility: "internal" }],
    ["future open date", { openDate: new Date(Date.now() + 86400000) }],
    ["past closing date", { closeDate: new Date(Date.now() - 86400000) }],
  ])("hides a %s vacancy from the public list", async (_label, overrides) => {
    seedVacancy(overrides);
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/vacancies`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("returns 404 when the organization can't be resolved", async () => {
    const res = await request(app).get(`/api/careers/unknown/vacancies`);
    expect(res.status).toBe(404);
  });

  it("does not leak another organization's vacancies", async () => {
    fixtures.vacancyRows = [{ id: 1, organizationId: 999, requisitionId: 1, publicId: "other-org-vac", title: "Theirs", visibility: "external", status: "published", openingsCount: 1, filledCount: 0 }];
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/vacancies`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("rejects a pageSize above the bound", async () => {
    seedVacancy();
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/vacancies?pageSize=500`);
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBeLessThanOrEqual(50);
  });
});

describe("GET /api/careers/:orgSlug/jobs/:vacancyPublicId", () => {
  beforeEach(() => {
    seedOrg();
    seedSettings();
    seedRequisition();
  });

  it("returns full public detail for an eligible vacancy", async () => {
    seedVacancy();
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/jobs/vac-public-1`);
    expect(res.status).toBe(200);
    expect(res.body.jobDescription).toBe("Build things.");
    expect(res.body.id).toBeUndefined();
  });

  it("returns 404 for a draft vacancy (same as not found)", async () => {
    seedVacancy({ status: "draft" });
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/jobs/vac-public-1`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a publicId belonging to a different organization", async () => {
    fixtures.vacancyRows = [{ id: 1, organizationId: 999, requisitionId: 1, publicId: "vac-public-1", title: "Theirs", visibility: "external", status: "published", openingsCount: 1, filledCount: 0 }];
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/jobs/vac-public-1`);
    expect(res.status).toBe(404);
  });
});

const PDF_BUFFER = Buffer.from("%PDF-1.4 fake pdf content for signature check");

describe("POST /api/careers/:orgSlug/jobs/:vacancyPublicId/apply", () => {
  beforeEach(() => {
    seedOrg();
    seedSettings();
    seedRequisition();
    seedVacancy();
  });

  it("returns 404 for a vacancy that isn't publicly eligible", async () => {
    fixtures.vacancyRows[0].status = "draft";
    const res = await request(app)
      .post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`)
      .field("firstName", "Jane")
      .field("lastName", "Doe")
      .field("email", "jane@example.com")
      .attach("resume", PDF_BUFFER, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(404);
  });

  it("rejects a submission missing required fields", async () => {
    const res = await request(app).post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`).field("firstName", "Jane");
    expect(res.status).toBe(400);
  });

  it("silently accepts (without persisting) a honeypot-triggered submission", async () => {
    const res = await request(app)
      .post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`)
      .field("firstName", "Bot")
      .field("lastName", "Bot")
      .field("email", "bot@example.com")
      .field("website", "http://spam.example")
      .attach("resume", PDF_BUFFER, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body.submitted).toBe(true);
    expect(fixtures.candidateRows).toHaveLength(0);
    expect(fixtures.applicationRows).toHaveLength(0);
  });

  it("rejects a resume whose content doesn't match its declared type", async () => {
    const res = await request(app)
      .post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`)
      .field("firstName", "Jane")
      .field("lastName", "Doe")
      .field("email", "jane@example.com")
      .attach("resume", Buffer.from("not a real pdf"), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
  });

  it("creates a candidate, application, consent, and document on a genuine submission, and emails a status link", async () => {
    const res = await request(app)
      .post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`)
      .field("firstName", "Jane")
      .field("lastName", "Doe")
      .field("email", "Jane@Example.com")
      .attach("resume", PDF_BUFFER, { filename: "resume.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body.submitted).toBe(true);
    expect(res.body.publicId).toBeTruthy();
    expect(fixtures.candidateRows).toHaveLength(1);
    expect(fixtures.candidateRows[0].email).toBe("jane@example.com"); // normalized
    expect(fixtures.applicationRows).toHaveLength(1);
    expect(fixtures.candidateConsentRows).toHaveLength(1);
    expect(fixtures.candidateDocumentRows).toHaveLength(1);
    expect(writeOrgFileMock).toHaveBeenCalledWith(ORG_ID, "candidate-documents", "pdf", expect.any(Buffer));
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("is idempotent on a repeat submission from the same email to the same vacancy", async () => {
    const submit = () =>
      request(app)
        .post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`)
        .field("firstName", "Jane")
        .field("lastName", "Doe")
        .field("email", "jane@example.com")
        .attach("resume", PDF_BUFFER, { filename: "resume.pdf", contentType: "application/pdf" });

    const first = await submit();
    expect(first.status).toBe(201);

    const second = await submit();
    expect(second.status).toBe(200);
    expect(second.body.publicId).toBe(first.body.publicId);
    expect(fixtures.candidateRows).toHaveLength(1);
    expect(fixtures.applicationRows).toHaveLength(1);
    expect(fixtures.candidateConsentRows).toHaveLength(1); // no second consent/document write on the idempotent repeat
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a new application once applicationLimitPerCandidate is reached", async () => {
    seedSettings({ applicationLimitPerCandidate: 1 });
    fixtures.candidateRows = [{ id: 1, organizationId: ORG_ID, firstName: "Jane", lastName: "Doe", email: "jane@example.com" }];
    fixtures.applicationRows = [{ id: 1, organizationId: ORG_ID, candidateId: 1, vacancyId: 999, publicId: "existing-app" }];

    const res = await request(app)
      .post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`)
      .field("firstName", "Jane")
      .field("lastName", "Doe")
      .field("email", "jane@example.com")
      .attach("resume", PDF_BUFFER, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
  });

  it("wires a rate limiter with a stricter window than login", () => {
    expect(rateLimitMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
  });

  describe("screening question answers (W52)", () => {
    const TEXT_QUESTION_ID = 1;
    const KNOCKOUT_YES_NO_ID = 2;

    beforeEach(() => {
      fixtures.vacancyQuestionRows = [
        { id: TEXT_QUESTION_ID, organizationId: ORG_ID, vacancyId: 1, questionText: "Years of experience?", questionType: "text", isKnockout: false, expectedAnswer: null, displayOrder: 0, isActive: true },
        { id: KNOCKOUT_YES_NO_ID, organizationId: ORG_ID, vacancyId: 1, questionText: "Authorized to work?", questionType: "yes_no", isKnockout: true, expectedAnswer: "yes", displayOrder: 1, isActive: true },
      ];
    });

    it("captures answers alongside the application, with no knockout failure when the answer matches", async () => {
      const res = await request(app)
        .post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`)
        .field("firstName", "Jane")
        .field("lastName", "Doe")
        .field("email", "jane@example.com")
        .field("answers", JSON.stringify([{ vacancyQuestionId: TEXT_QUESTION_ID, answerText: "5 years" }, { vacancyQuestionId: KNOCKOUT_YES_NO_ID, answerText: "yes" }]))
        .attach("resume", PDF_BUFFER, { filename: "resume.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(201);
      expect(fixtures.applicationAnswerRows).toHaveLength(2);
      const knockoutAnswer = fixtures.applicationAnswerRows.find((a) => a.vacancyQuestionId === KNOCKOUT_YES_NO_ID);
      expect(knockoutAnswer).toMatchObject({ answerText: "yes", knockoutFailed: false });
    });

    it("flags a failed knockout answer without rejecting the application", async () => {
      const res = await request(app)
        .post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`)
        .field("firstName", "Jane")
        .field("lastName", "Doe")
        .field("email", "jane@example.com")
        .field("answers", JSON.stringify([{ vacancyQuestionId: KNOCKOUT_YES_NO_ID, answerText: "no" }]))
        .attach("resume", PDF_BUFFER, { filename: "resume.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(201); // never auto-rejected, per §12
      expect(fixtures.applicationAnswerRows).toHaveLength(1);
      expect(fixtures.applicationAnswerRows[0]).toMatchObject({ answerText: "no", knockoutFailed: true });
    });

    it("silently ignores an answer for a question that doesn't belong to this vacancy", async () => {
      const res = await request(app)
        .post(`/api/careers/${ORG_SLUG}/jobs/vac-public-1/apply`)
        .field("firstName", "Jane")
        .field("lastName", "Doe")
        .field("email", "jane@example.com")
        .field("answers", JSON.stringify([{ vacancyQuestionId: 9999, answerText: "irrelevant" }]))
        .attach("resume", PDF_BUFFER, { filename: "resume.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(201);
      expect(fixtures.applicationAnswerRows).toHaveLength(0);
    });
  });
});

describe("GET /api/careers/:orgSlug/application-status/:token", () => {
  beforeEach(() => {
    seedOrg();
    seedSettings();
  });

  it("returns status for a valid, unexpired token", async () => {
    fixtures.candidateRows = [{ id: 1, organizationId: ORG_ID, firstName: "Jane", lastName: "Doe", email: "jane@example.com" }];
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: 1, publicId: "vac-1", title: "Software Engineer", visibility: "external", status: "published", openingsCount: 1, filledCount: 0 }];
    fixtures.applicationRows = [
      { id: 1, organizationId: ORG_ID, candidateId: 1, vacancyId: 1, publicId: "app-1", statusCheckToken: "good-token", statusCheckTokenExpiresAt: new Date(Date.now() + 100000), submittedAt: new Date() },
    ];
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/application-status/good-token`);
    expect(res.status).toBe(200);
    expect(res.body.vacancyTitle).toBe("Software Engineer");
    expect(res.body.status).toBe("submitted");
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/application-status/unknown-token`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an expired token", async () => {
    fixtures.applicationRows = [{ id: 1, organizationId: ORG_ID, candidateId: 1, vacancyId: 1, publicId: "app-1", statusCheckToken: "old-token", statusCheckTokenExpiresAt: new Date(Date.now() - 1000), submittedAt: new Date() }];
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/application-status/old-token`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a token that belongs to a different organization (cross-tenant protection)", async () => {
    fixtures.applicationRows = [{ id: 1, organizationId: 999, candidateId: 1, vacancyId: 1, publicId: "app-1", statusCheckToken: "their-token", statusCheckTokenExpiresAt: new Date(Date.now() + 100000), submittedAt: new Date() }];
    const res = await request(app).get(`/api/careers/${ORG_SLUG}/application-status/their-token`);
    expect(res.status).toBe(404);
  });
});
