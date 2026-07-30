/**
 * Public Careers Portal — read side (Phase 3A, W49). Every function here is
 * reachable with no authentication, so each independently re-derives its
 * own trust boundary rather than accepting anything from a caller as given
 * (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §6): an organization is
 * resolved only by its own `slug` (never a client-supplied numeric ID), and
 * "not found," "suspended," and "careers portal disabled" are all
 * deliberately collapsed into the same null/404 outcome so a probing
 * request can never distinguish a nonexistent org from a real one that
 * simply hasn't turned careers on (§6's cross-tenant-disclosure rule,
 * applied to org existence itself).
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db,
  organizationsTable,
  vacanciesTable,
  vacancyLocationsTable,
  jobRequisitionsTable,
  branchesTable,
  departmentsTable,
  type Vacancy,
  type VacancyLocation,
  type JobRequisition,
} from "@workspace/db";
import { getRecruitmentSettings } from "./recruitmentSettings";

export interface PublicOrganization {
  id: number;
  slug: string;
  name: string;
  logoUrl: string | null;
}

/**
 * Resolves an organization for public access. Returns null for every
 * disqualifying condition alike (doesn't exist, suspended, recruitment
 * module/careers portal disabled) — callers must render the same
 * public-safe 404 regardless of which one occurred.
 */
export async function resolvePublicOrganization(slug: string): Promise<PublicOrganization | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.slug, normalized)).limit(1);
  if (!org) return null;
  if (org.status === "suspended") return null;

  const settings = await getRecruitmentSettings(org.id);
  if (!settings.enabled || !settings.externalRecruitmentEnabled) return null;

  return { id: org.id, slug: org.slug, name: org.name, logoUrl: org.logoUrl };
}

function isVacancyPubliclyEligible(vacancy: Vacancy): boolean {
  if (vacancy.status !== "published") return false;
  if (vacancy.visibility === "internal") return false;
  // The public boundary applies its own full eligibility predicate,
  // independent of whatever internal transition got the vacancy to
  // "published" — including W47's documented manual-flip override, which
  // lets an operator deliberately publish (internally) before openDate.
  // That override affects internal/staff visibility only; it does not
  // bypass the public read layer's own openDate/closeDate gates. No
  // background scheduler flips status on close either (W47's documented
  // limitation), so a "published" vacancy past its own closeDate must
  // still be excluded here — reads never mutate the stored status either
  // way.
  if (vacancy.openDate != null && vacancy.openDate.getTime() > Date.now()) return false;
  if (vacancy.closeDate != null && vacancy.closeDate.getTime() < Date.now()) return false;
  return true;
}

export interface PublicVacancySummary {
  publicId: string;
  title: string;
  departmentName: string | null;
  locations: string[];
  employmentType: string | null;
  workplaceType: string | null;
  openingsCount: number;
  openDate: string | null;
  closeDate: string | null;
  summary: string | null;
  featured: boolean;
}

export interface PublicVacancyDetail extends PublicVacancySummary {
  jobDescription: string | null;
  responsibilities: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

const SUMMARY_MAX_LENGTH = 220;

function toSummary(jobDescription: string | null): string | null {
  if (!jobDescription) return null;
  const trimmed = jobDescription.trim();
  if (trimmed.length <= SUMMARY_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, SUMMARY_MAX_LENGTH).trimEnd()}…`;
}

interface EnrichedContext {
  requisitionById: Map<number, JobRequisition>;
  departmentNameById: Map<number, string>;
  branchNameById: Map<number, string>;
  locationsByVacancy: Map<number, VacancyLocation[]>;
}

async function loadEnrichmentContext(vacancies: Vacancy[]): Promise<EnrichedContext> {
  const requisitionIds = [...new Set(vacancies.map((v) => v.requisitionId))];
  const requisitions = requisitionIds.length
    ? await db.select().from(jobRequisitionsTable).where(inArray(jobRequisitionsTable.id, requisitionIds))
    : [];
  const requisitionById = new Map(requisitions.map((r) => [r.id, r]));

  const departmentIds = [...new Set(requisitions.map((r) => r.departmentId).filter((id): id is number => id != null))];
  const departments = departmentIds.length ? await db.select().from(departmentsTable).where(inArray(departmentsTable.id, departmentIds)) : [];
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

  const vacancyIds = vacancies.map((v) => v.id);
  const locations = vacancyIds.length ? await db.select().from(vacancyLocationsTable).where(inArray(vacancyLocationsTable.vacancyId, vacancyIds)) : [];
  const locationsByVacancy = new Map<number, VacancyLocation[]>();
  for (const loc of locations) {
    const list = locationsByVacancy.get(loc.vacancyId) ?? [];
    list.push(loc);
    locationsByVacancy.set(loc.vacancyId, list);
  }

  const branchIds = [...new Set(locations.map((l) => l.branchId).filter((id): id is number => id != null))];
  const branches = branchIds.length ? await db.select().from(branchesTable).where(inArray(branchesTable.id, branchIds)) : [];
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  return { requisitionById, departmentNameById, branchNameById, locationsByVacancy };
}

function locationLabels(vacancyId: number, ctx: EnrichedContext): string[] {
  const rows = ctx.locationsByVacancy.get(vacancyId) ?? [];
  return rows.map((r) => (r.branchId != null ? (ctx.branchNameById.get(r.branchId) ?? r.label ?? "Unspecified") : (r.label ?? "Unspecified")));
}

function toSummaryDto(vacancy: Vacancy, ctx: EnrichedContext): PublicVacancySummary {
  const requisition = ctx.requisitionById.get(vacancy.requisitionId);
  return {
    publicId: vacancy.publicId,
    title: vacancy.title,
    departmentName: requisition?.departmentId != null ? (ctx.departmentNameById.get(requisition.departmentId) ?? null) : null,
    locations: locationLabels(vacancy.id, ctx),
    employmentType: requisition?.employmentType ?? null,
    workplaceType: requisition?.workplaceType ?? null,
    openingsCount: vacancy.openingsCount,
    openDate: vacancy.openDate ? vacancy.openDate.toISOString() : null,
    closeDate: vacancy.closeDate ? vacancy.closeDate.toISOString() : null,
    summary: toSummary(vacancy.jobDescription),
    featured: vacancy.featured,
  };
}

export interface ListPublicVacanciesParams {
  organizationId: number;
  search?: string;
  department?: string;
  location?: string;
  employmentType?: string;
  workplaceType?: string;
  page: number;
  pageSize: number;
}

export async function listPublicVacancies(params: ListPublicVacanciesParams): Promise<{ items: PublicVacancySummary[]; total: number }> {
  const rows = await db
    .select()
    .from(vacanciesTable)
    .where(eq(vacanciesTable.organizationId, params.organizationId))
    .orderBy(desc(vacanciesTable.featured), desc(vacanciesTable.createdAt));

  let eligible = rows.filter(isVacancyPubliclyEligible);
  const ctx = await loadEnrichmentContext(eligible);

  if (params.employmentType) {
    eligible = eligible.filter((v) => ctx.requisitionById.get(v.requisitionId)?.employmentType === params.employmentType);
  }
  if (params.workplaceType) {
    eligible = eligible.filter((v) => ctx.requisitionById.get(v.requisitionId)?.workplaceType === params.workplaceType);
  }
  if (params.department) {
    const term = params.department.toLowerCase();
    eligible = eligible.filter((v) => {
      const requisition = ctx.requisitionById.get(v.requisitionId);
      const name = requisition?.departmentId != null ? ctx.departmentNameById.get(requisition.departmentId) : null;
      return name?.toLowerCase().includes(term) ?? false;
    });
  }
  if (params.location) {
    const term = params.location.toLowerCase();
    eligible = eligible.filter((v) => locationLabels(v.id, ctx).some((l) => l.toLowerCase().includes(term)));
  }
  if (params.search) {
    const term = params.search.toLowerCase();
    eligible = eligible.filter((v) => v.title.toLowerCase().includes(term) || (v.jobDescription ?? "").toLowerCase().includes(term));
  }

  const total = eligible.length;
  const start = (params.page - 1) * params.pageSize;
  const page = eligible.slice(start, start + params.pageSize);
  return { items: page.map((v) => toSummaryDto(v, ctx)), total };
}

/** Returns null both when the vacancy doesn't exist and when it exists but isn't publicly eligible — never distinguishing the two (same 404 discipline as every internal visibility check in this codebase). */
export async function getPublicVacancyByPublicId(organizationId: number, vacancyPublicId: string): Promise<PublicVacancyDetail | null> {
  const [vacancy] = await db
    .select()
    .from(vacanciesTable)
    .where(and(eq(vacanciesTable.organizationId, organizationId), eq(vacanciesTable.publicId, vacancyPublicId)))
    .limit(1);
  if (!vacancy || !isVacancyPubliclyEligible(vacancy)) return null;

  const ctx = await loadEnrichmentContext([vacancy]);
  return {
    ...toSummaryDto(vacancy, ctx),
    jobDescription: vacancy.jobDescription,
    responsibilities: vacancy.responsibilities,
    requirements: vacancy.requirements,
    preferredQualifications: vacancy.preferredQualifications,
    seoTitle: vacancy.seoTitle,
    seoDescription: vacancy.seoDescription,
  };
}

/** Internal helper for the apply route — resolves the raw (still org/eligibility-checked) vacancy row, since the apply flow needs the internal `id`, which the public DTO never exposes. */
export async function resolveEligibleVacancyForApply(organizationId: number, vacancyPublicId: string): Promise<Vacancy | null> {
  const [vacancy] = await db
    .select()
    .from(vacanciesTable)
    .where(and(eq(vacanciesTable.organizationId, organizationId), eq(vacanciesTable.publicId, vacancyPublicId)))
    .limit(1);
  if (!vacancy || !isVacancyPubliclyEligible(vacancy)) return null;
  return vacancy;
}
