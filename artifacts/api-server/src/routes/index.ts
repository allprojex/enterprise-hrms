import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import organizationsRouter from "./organizations";
import notificationsRouter from "./notifications";
import usersRouter from "./users";
import platformUsersRouter from "./platformUsers";
import installationsRouter from "./installations";
import breakGlassRouter from "./breakGlass";
import meRouter from "./me";
import employeesRouter from "./employees";
import employeeNumberingRouter from "./employeeNumbering";
import personnelFilesRouter from "./personnelFiles";
import recordsLocationsRouter from "./recordsLocations";
import personnelFileCustodyRouter from "./personnelFileCustody";
import personnelReportingRouter from "./personnelReporting";
import legacyImportRouter from "./legacyImport";
// WS-7 — the multi-entity migration engine. Deliberately mounted ALONGSIDE
// legacyImportRouter, which is left completely unmodified: that route pair
// (/personnel-records/import/preview|commit) is a shipped, in-use
// compatibility surface with its own permissions and its own single-file
// CSV contract, and breaking it to funnel users into the new engine would
// be a regression for no benefit. The two do not collide — different paths,
// different permission keys — and the disposition is documented in
// docs/BULK_IMPORT_MIGRATION.md.
import migrationsRouter from "./migrations";
import payrollOpeningBalancesRouter from "./payrollOpeningBalances";
import customFieldsRouter from "./customFields";
import recruitmentCompletionRouter from "./recruitmentCompletion";
import employeeSkillsQualificationsRouter from "./employeeSkillsQualifications";
import employeeDisciplinaryRecordsRouter from "./employeeDisciplinaryRecords";
import employeeExitProcessRouter from "./employeeExitProcess";
import leaveTypesRouter from "./leaveTypes";
import leaveRequestsRouter from "./leaveRequests";
import leaveBalancesRouter from "./leaveBalances";
import leaveApprovalsRouter from "./leaveApprovals";
import leaveCalendarRouter from "./leaveCalendar";
import publicHolidaysRouter from "./publicHolidays";
import recruitmentSettingsRouter from "./recruitmentSettings";
import onboardingRouter from "./onboarding";
import employmentLifecycleRouter from "./employmentLifecycle";
import employeeRelationsRouter from "./employeeRelations";
import employeeRequestsRouter from "./employeeRequests";
import skillsRouter from "./skills";
import recruitmentWorkflowsRouter from "./recruitmentWorkflows";
import jobRequisitionsRouter from "./jobRequisitions";
import vacanciesRouter from "./vacancies";
import publicCareersRouter from "./publicCareers";
import applicationsRouter from "./applications";
import candidatesRouter from "./candidates";
import talentPoolsRouter from "./talentPools";
import interviewsRouter from "./interviews";
import interviewScorecardsRouter from "./interviewScorecards";
import referenceChecksRouter from "./referenceChecks";
import backgroundChecksRouter from "./backgroundChecks";
import offersRouter from "./offers";
import preEmploymentRequirementsRouter from "./preEmploymentRequirements";
import employeeConversionRouter from "./employeeConversion";
import branchesRouter from "./branches";
import departmentsRouter from "./departments";
import positionsRouter from "./positions";
import rolesRouter from "./roles";
import permissionsRouter from "./permissions";
import membersRouter from "./members";
import primaryHrRouter from "./primaryHr";
import organizationSettingsRouter from "./organizationSettings";
import auditEventsRouter from "./auditEvents";
import modulesRouter from "./modules";
import organizationModulesRouter from "./organizationModules";
import masterDataRouter from "./masterData";
import invitationsRouter from "./invitations";
import organizationRolesRouter from "./organizationRoles";
import reportsRouter from "./reports";
import recruitmentReportingRouter from "./recruitmentReporting";
import organizationDomainsRouter from "./organizationDomains";
import tenantContextRouter from "./tenantContext";
import organizationLogoRouter from "./organizationLogo";
import attendanceEventsRouter from "./attendanceEvents";
import attendanceAdjustmentsRouter from "./attendanceAdjustments";
import attendanceDailySummaryRouter from "./attendanceDailySummary";
import attendanceRegisterRouter from "./attendanceRegister";
import attendanceReportingRouter from "./attendanceReporting";
import performanceRatingScalesRouter from "./performanceRatingScales";
import performanceReviewTemplatesRouter from "./performanceReviewTemplates";
import performanceCyclesRouter from "./performanceCycles";
import performanceReviewGoalsRouter from "./performanceReviewGoals";
import performanceSelfAssessmentRouter from "./performanceSelfAssessment";
import performanceManagerReviewRouter from "./performanceManagerReview";
import performanceHrReviewRouter from "./performanceHrReview";
import performanceReportingRouter from "./performanceReporting";
import performanceReviewEvidenceRouter from "./performanceReviewEvidence";
import performanceAcknowledgementRouter from "./performanceAcknowledgement";
import learningCoursesRouter from "./learningCourses";
import learningCourseSessionsRouter from "./learningCourseSessions";
import learningEnrollmentsRouter from "./learningEnrollments";
import learningCertificatesRouter from "./learningCertificates";
import learningEnrollmentEvidenceRouter from "./learningEnrollmentEvidence";
import learningReportingRouter from "./learningReporting";
import assetsRouter from "./assets";
import assetReportingRouter from "./assetReporting";
import managerPortalRouter from "./managerPortal";
import payrollStatutoryRulesRouter from "./payrollStatutoryRules";
import payrollCompensationRouter from "./payrollCompensation";
import payrollSensitiveRecordsRouter from "./payrollSensitiveRecords";
import payrollPeriodsRouter from "./payrollPeriods";
import payrollRunsRouter from "./payrollRuns";
import payrollCorrectionsRouter from "./payrollCorrections";
import payrollPayslipsRouter from "./payrollPayslips";
import payrollReportsRouter from "./payrollReports";
import payrollPaymentBatchesRouter from "./payrollPaymentBatches";
import departmentHeadsRouter from "./departmentHeads";
import officeInventoryCatalogRouter from "./officeInventoryCatalog";
import officeInventoryLedgerRouter from "./officeInventoryLedger";
import officeInventoryRequestsRouter from "./officeInventoryRequests";
import officeInventoryDelegationsRouter from "./officeInventoryDelegations";
import officeInventoryIssuingRouter from "./officeInventoryIssuing";
import officeInventoryTransfersRouter from "./officeInventoryTransfers";
import officeInventoryIncidentsRouter from "./officeInventoryIncidents";
import officeInventoryStocktakesRouter from "./officeInventoryStocktakes";
import officeInventoryEssRouter from "./officeInventoryEss";
import officeInventoryReportingRouter from "./officeInventoryReporting";
import officeInventoryAssetHandoffRouter from "./officeInventoryAssetHandoff";
import organizationDocumentsRouter from "./organizationDocuments";
import documentTemplatesRouter from "./documentTemplates";
import documentRecordsRouter from "./documentRecords";
import scheduledJobsRouter from "./scheduledJobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(organizationsRouter);
router.use(notificationsRouter);
router.use(usersRouter);
router.use(platformUsersRouter);
router.use(installationsRouter);
router.use(breakGlassRouter);
router.use(meRouter);
router.use(employeesRouter);
router.use(employeeNumberingRouter);
router.use(personnelFilesRouter);
router.use(recordsLocationsRouter);
router.use(personnelFileCustodyRouter);
router.use(personnelReportingRouter);
router.use(legacyImportRouter);
router.use(migrationsRouter);
router.use(payrollOpeningBalancesRouter);
router.use(customFieldsRouter);
router.use(recruitmentCompletionRouter);
router.use(employeeSkillsQualificationsRouter);
router.use(employeeDisciplinaryRecordsRouter);
router.use(employeeExitProcessRouter);
router.use(leaveTypesRouter);
router.use(leaveRequestsRouter);
router.use(leaveBalancesRouter);
router.use(leaveApprovalsRouter);
router.use(leaveCalendarRouter);
router.use(publicHolidaysRouter);
router.use(recruitmentSettingsRouter);
// WS-10. Its paths are all literal prefixes (/onboarding, /onboarding-tasks,
// /onboarding-templates, /my-onboarding, /document-acknowledgements) and do not
// collide with any sibling router's :id-style params.
router.use(onboardingRouter);
// WS-11. `/employment-terms/expiring` is registered before `/employment-terms/:termId/*`
// inside its own router, so the literal path is not shadowed by the param route.
router.use(employmentLifecycleRouter);
router.use(employeeRelationsRouter);
router.use(employeeRequestsRouter);
router.use(skillsRouter);
router.use(recruitmentWorkflowsRouter);
router.use(jobRequisitionsRouter);
router.use(vacanciesRouter);
router.use(publicCareersRouter);
router.use(applicationsRouter);
router.use(candidatesRouter);
router.use(talentPoolsRouter);
router.use(interviewsRouter);
router.use(interviewScorecardsRouter);
router.use(referenceChecksRouter);
router.use(backgroundChecksRouter);
router.use(offersRouter);
router.use(preEmploymentRequirementsRouter);
router.use(employeeConversionRouter);
router.use(branchesRouter);
router.use(departmentsRouter);
router.use(positionsRouter);
router.use(rolesRouter);
router.use(permissionsRouter);
router.use(membersRouter);
router.use(primaryHrRouter);
router.use(organizationSettingsRouter);
router.use(auditEventsRouter);
router.use(modulesRouter);
router.use(organizationModulesRouter);
router.use(masterDataRouter);
router.use(invitationsRouter);
router.use(organizationRolesRouter);
router.use(reportsRouter);
router.use(recruitmentReportingRouter);
router.use(organizationDomainsRouter);
router.use(tenantContextRouter);
router.use(organizationLogoRouter);
router.use(attendanceEventsRouter);
router.use(attendanceAdjustmentsRouter);
router.use(attendanceDailySummaryRouter);
router.use(attendanceRegisterRouter);
router.use(attendanceReportingRouter);
router.use(performanceRatingScalesRouter);
router.use(performanceReviewTemplatesRouter);
router.use(performanceCyclesRouter);
router.use(performanceReviewGoalsRouter);
router.use(performanceSelfAssessmentRouter);
router.use(performanceManagerReviewRouter);
router.use(performanceHrReviewRouter);
router.use(performanceReportingRouter);
router.use(performanceReviewEvidenceRouter);
router.use(performanceAcknowledgementRouter);
router.use(learningCoursesRouter);
router.use(learningCourseSessionsRouter);
router.use(learningEnrollmentsRouter);
router.use(learningCertificatesRouter);
router.use(learningEnrollmentEvidenceRouter);
router.use(learningReportingRouter);
// assetReportingRouter MUST be registered before assetsRouter: Express
// matches routes in registration order, and assetsRouter's own
// GET .../assets/:id would otherwise swallow GET .../assets/dashboard
// (treating "dashboard" as an invalid numeric id) — the identical ordering
// bug W98 already found and fixed for my-assets/team-assets.
router.use(assetReportingRouter);
router.use(assetsRouter);
router.use(managerPortalRouter);
router.use(payrollStatutoryRulesRouter);
router.use(payrollCompensationRouter);
router.use(payrollSensitiveRecordsRouter);
router.use(payrollPeriodsRouter);
router.use(payrollRunsRouter);
router.use(payrollCorrectionsRouter);
router.use(payrollPayslipsRouter);
router.use(payrollReportsRouter);
router.use(payrollPaymentBatchesRouter);
router.use(departmentHeadsRouter);
router.use(officeInventoryCatalogRouter);
router.use(officeInventoryLedgerRouter);
// officeInventoryIssuingRouter is registered BEFORE officeInventoryRequestsRouter
// deliberately: its literal GET .../requests/awaiting-fulfilment path would
// otherwise be shadowed by the earlier-registered GET .../requests/:id route
// (Express matches route patterns in registration order across every
// router mounted via app.use — a parameterized path registered first wins
// against a literal one registered later, even though the literal path is
// the intended match here).
router.use(officeInventoryIssuingRouter);
router.use(officeInventoryRequestsRouter);
router.use(officeInventoryDelegationsRouter);
router.use(officeInventoryTransfersRouter);
router.use(officeInventoryIncidentsRouter);
router.use(officeInventoryStocktakesRouter);
router.use(officeInventoryEssRouter);
router.use(officeInventoryReportingRouter);
router.use(officeInventoryAssetHandoffRouter);
// WS-5 — Documents & Records Foundation. organizationDocumentsRouter
// registers its literal .../documents/categories path before its own
// .../documents/:documentId, so Express's registration-order matching
// resolves the literal one correctly (the same ordering hazard documented
// for assetReporting/officeInventoryIssuing above).
router.use(organizationDocumentsRouter);
router.use(documentTemplatesRouter);
router.use(documentRecordsRouter);
// WS-6 — Scheduled Jobs / Notifications Foundation.
router.use(scheduledJobsRouter);

export default router;
