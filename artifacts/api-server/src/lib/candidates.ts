/**
 * Candidates — internal read side (Phase 3A, W53 — Candidate Notes, Tags,
 * and Talent Pools). Candidate records themselves are W49's — this
 * workstream never redesigns them, only adds internal read access (needed
 * to host notes/tags/pool-membership on `/candidates/:id`) and the
 * visibility resolution notes/tags/pools all reuse.
 *
 * Visibility: same assigned/organization-wide two-tier model as
 * vacancies/applications (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
 * §7 — the "Candidates" row has no "own" tier either, matching
 * Applications). A candidate carries no recruiter/hiring-manager column of
 * its own — the assigned tier is resolved three hops out: candidate ->
 * applications -> vacancies -> requisitions, checking every requisition
 * linked to any of the candidate's applications (a candidate can have
 * several applications across different vacancies with different
 * assignees).
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db,
  candidatesTable,
  applicationsTable,
  vacanciesTable,
  jobRequisitionsTable,
  type Candidate,
  type JobRequisition,
} from "@workspace/db";
import { resolveRecruitmentActorEmployeeId, hasOrgWideRecruitmentAccess, isAssignedRecruitmentActor } from "./recruitmentAuthorization";

export class CandidateNotFoundError extends Error {
  constructor() {
    super("Candidate not found");
    this.name = "CandidateNotFoundError";
  }
}

export interface CandidateVisibilityContext {
  isOrgWide: boolean;
  actorEmployeeId: number | null;
}

export async function resolveCandidateVisibilityContext(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<CandidateVisibilityContext> {
  const isOrgWide = await hasOrgWideRecruitmentAccess(params.membershipId, "candidate.manage");
  const actorEmployeeId = await resolveRecruitmentActorEmployeeId(params.organizationId, params.applicationUserId);
  return { isOrgWide, actorEmployeeId };
}

/** For each candidateId, every job_requisition reachable via any of that candidate's applications (through their vacancy) — batched, never N+1. */
async function resolveCandidateRequisitions(organizationId: number, candidateIds: number[]): Promise<Map<number, JobRequisition[]>> {
  const result = new Map<number, JobRequisition[]>();
  if (candidateIds.length === 0) return result;

  const applications = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.organizationId, organizationId), inArray(applicationsTable.candidateId, candidateIds)));
  if (applications.length === 0) return result;

  const vacancyIds = [...new Set(applications.map((a) => a.vacancyId))];
  const vacancies = await db.select().from(vacanciesTable).where(inArray(vacanciesTable.id, vacancyIds));
  const vacancyById = new Map(vacancies.map((v) => [v.id, v]));

  const requisitionIds = [...new Set(vacancies.map((v) => v.requisitionId))];
  const requisitions = requisitionIds.length ? await db.select().from(jobRequisitionsTable).where(inArray(jobRequisitionsTable.id, requisitionIds)) : [];
  const requisitionById = new Map(requisitions.map((r) => [r.id, r]));

  for (const application of applications) {
    const vacancy = vacancyById.get(application.vacancyId);
    const requisition = vacancy ? requisitionById.get(vacancy.requisitionId) : undefined;
    if (!requisition) continue;
    const list = result.get(application.candidateId) ?? [];
    list.push(requisition);
    result.set(application.candidateId, list);
  }
  return result;
}

function isVisible(candidateId: number, requisitionsByCandidate: Map<number, JobRequisition[]>, ctx: CandidateVisibilityContext): boolean {
  if (ctx.isOrgWide) return true;
  const requisitions = requisitionsByCandidate.get(candidateId) ?? [];
  return requisitions.some(
    (r) => isAssignedRecruitmentActor(ctx.actorEmployeeId, r.recruiterEmployeeId) || isAssignedRecruitmentActor(ctx.actorEmployeeId, r.hiringManagerEmployeeId),
  );
}

async function findCandidateInOrg(organizationId: number, candidateId: number): Promise<Candidate | null> {
  const [row] = await db
    .select()
    .from(candidatesTable)
    .where(and(eq(candidatesTable.id, candidateId), eq(candidatesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface ListCandidatesParams {
  organizationId: number;
  visibility: CandidateVisibilityContext;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listCandidates(params: ListCandidatesParams): Promise<{ items: Candidate[]; total: number }> {
  const rows = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.organizationId, params.organizationId))
    .orderBy(desc(candidatesTable.createdAt));

  const requisitionsByCandidate = await resolveCandidateRequisitions(
    params.organizationId,
    rows.map((r) => r.id),
  );
  let visible = rows.filter((r) => isVisible(r.id, requisitionsByCandidate, params.visibility));

  if (params.search) {
    const term = params.search.toLowerCase();
    visible = visible.filter((r) => r.email.toLowerCase().includes(term) || `${r.firstName} ${r.lastName}`.toLowerCase().includes(term));
  }

  const total = visible.length;
  const start = (params.page - 1) * params.pageSize;
  const items = visible.slice(start, start + params.pageSize);
  return { items, total };
}

/** Returns null both when the candidate doesn't exist and when it exists but isn't visible to this caller — never distinguishing the two. */
export async function getVisibleCandidateById(organizationId: number, candidateId: number, visibility: CandidateVisibilityContext): Promise<Candidate | null> {
  const candidate = await findCandidateInOrg(organizationId, candidateId);
  if (!candidate) return null;
  const requisitionsByCandidate = await resolveCandidateRequisitions(organizationId, [candidateId]);
  if (!isVisible(candidateId, requisitionsByCandidate, visibility)) return null;
  return candidate;
}
