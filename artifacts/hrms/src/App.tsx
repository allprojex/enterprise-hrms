import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AppShell } from '@/components/layout/app-shell';
import { TenantTheme } from '@/components/tenant-theme';
import { ErrorBoundary } from '@/components/error-boundary';
import { MotionConfig } from 'framer-motion';
import DesignFoundationShowcase from '@/pages/dev/design-foundation';
import Login from '@/pages/login';
import ForgotPassword from '@/pages/forgot-password';
import ResetPassword from '@/pages/reset-password';
import InviteAccept from '@/pages/invite-accept';
import Dashboard from '@/pages/dashboard';
import Profile from '@/pages/profile';
import Notifications from '@/pages/notifications';
import Organizations from '@/pages/organizations';
import Settings from '@/pages/settings';
import Unauthorized from '@/pages/unauthorized';
import NotFound from '@/pages/not-found';
import Branches from '@/pages/branches';
import OrganizationDocuments from '@/pages/organization-documents';
import DocumentTemplates from '@/pages/document-templates';
import Departments from '@/pages/departments';
import Positions from '@/pages/positions';
import Employees from '@/pages/employees';
import EmployeeDetail from '@/pages/employee-detail';
import Admin from '@/pages/admin';
import PlatformAdmin from '@/pages/platform-admin';
import LeaveTypes from '@/pages/leave-types';
import MyLeave from '@/pages/my-leave';
import LeaveBalances from '@/pages/leave-balances';
import LeaveApprovals from '@/pages/leave-approvals';
import LeaveCalendar from '@/pages/leave-calendar';
import PublicHolidays from '@/pages/public-holidays';
import AttendanceSettings from '@/pages/attendance-settings';
import AttendanceRegister from '@/pages/attendance-register';
import AttendanceDashboard from '@/pages/attendance-dashboard';
import AttendanceReports from '@/pages/attendance-reports';
import PerformanceRatingScales from '@/pages/performance-rating-scales';
import PayrollStatutoryRules from '@/pages/payroll-statutory-rules';
import PayrollEmployeeCompensation from '@/pages/payroll-employee-compensation';
import PayrollPeriods from '@/pages/payroll-periods';
import PayrollMyPayslips from '@/pages/payroll-my-payslips';
import PerformanceTemplates from '@/pages/performance-templates';
import PerformanceCycles from '@/pages/performance-cycles';
import PerformanceTeam from '@/pages/performance-team';
import PerformanceReviews from '@/pages/performance-reviews';
import PerformanceDashboard from '@/pages/performance-dashboard';
import PerformanceReports from '@/pages/performance-reports';
import LearningCourses from '@/pages/learning-courses';
import LearningTeamTraining from '@/pages/learning-team-training';
import LearningEnrollments from '@/pages/learning-enrollments';
import LearningDashboard from '@/pages/learning-dashboard';
import LearningReports from '@/pages/learning-reports';
import Assets from '@/pages/assets';
import Vehicles from '@/pages/vehicles';
import VehicleRequestApprovalsConfig from '@/pages/vehicle-request-approvals-config';
import TeamAssets from '@/pages/team-assets';
import AssetsDashboard from '@/pages/assets-dashboard';
import AssetReports from '@/pages/asset-reports';
import AssetWorkspace from '@/pages/asset-workspace';
import OfficeInventory from '@/pages/office-inventory';
import EmployeeSelfService from '@/pages/employee-self-service';
import ManagerPortal from '@/pages/manager-portal';
import RecruitmentSettings from '@/pages/recruitment-settings';
import Requisitions from '@/pages/requisitions';
import RequisitionDetail from '@/pages/requisition-detail';
import RequisitionApprovals from '@/pages/requisition-approvals';
import Vacancies from '@/pages/vacancies';
import VacancyEditor from '@/pages/vacancy-editor';
import CareersLanding from '@/pages/careers-landing';
import CareersVacancyDetail from '@/pages/careers-vacancy-detail';
import CareersApply from '@/pages/careers-apply';
import CareersStatus from '@/pages/careers-status';
import Applications from '@/pages/applications';
import ApplicationDetail from '@/pages/application-detail';
import Pipeline from '@/pages/pipeline';
import CandidateDetail from '@/pages/candidate-detail';
import TalentPools from '@/pages/talent-pools';
import Interviews from '@/pages/interviews';
import InterviewDetail from '@/pages/interview-detail';
import InterviewScorecard from '@/pages/interview-scorecard';
import Offers from '@/pages/offers';
import OfferDetail from '@/pages/offer-detail';
import RecruitmentDashboard from '@/pages/recruitment-dashboard';
import RecruitmentReports from '@/pages/recruitment-reports';
import PersonnelReports from '@/pages/personnel-reports';
import PersonnelImport from '@/pages/personnel-import';
import DataMigration from '@/pages/data-migration';
import CustomFields from '@/pages/custom-fields';
import CustomForms from '@/pages/custom-forms';
import RecruitmentApprovalsConfig from '@/pages/recruitment-approvals-config';
import Onboarding from '@/pages/onboarding';
import EmployeeRelations from '@/pages/employee-relations';
import Offboarding from '@/pages/offboarding';
import MyGrievances from '@/pages/my-grievances';
import MyRequests from '@/pages/my-requests';
import Requests from '@/pages/requests';
import RequestSettings from '@/pages/request-settings';
import SkillsSettings from '@/pages/skills-settings';
import Capability from '@/pages/capability';
import MySkills from '@/pages/my-skills';
import SuccessionPage from '@/pages/succession';
// WS-26 — Tenant Form, Workflow & Signature Engine.
import FormsPage from '@/pages/forms';
import FormSubmissionPage from '@/pages/form-submission';
import FormTemplatesPage from '@/pages/form-templates';
import ActionCentre from '@/pages/action-centre';
import MyActions from '@/pages/my-actions';
import OnboardingDetail from '@/pages/onboarding-detail';
import MyOnboarding from '@/pages/my-onboarding';
import ManualCandidateCapture from '@/pages/manual-candidate-capture';
import { ModuleGate } from '@/components/module-gate';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function SecureRoute({ component: Component, moduleKey }: { component: React.ComponentType; moduleKey?: string }) {
  const content = (
    <ErrorBoundary>
      <Component />
    </ErrorBoundary>
  );
  return <AppShell>{moduleKey ? <ModuleGate moduleKey={moduleKey}>{content}</ModuleGate> : content}</AppShell>;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Login} />
      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password/:token" component={ResetPassword} />
      <Route path="/invite/:token" component={InviteAccept} />
      <Route path="/unauthorized" component={Unauthorized} />

      {/* Public Careers Portal (Phase 3A, W49) -- no <AppShell>, no auth, never wrapped in SecureRoute */}
      <Route path="/careers/:orgSlug/jobs/:vacancyPublicId/apply" component={CareersApply} />
      <Route path="/careers/:orgSlug/jobs/:vacancyPublicId" component={CareersVacancyDetail} />
      <Route path="/careers/:orgSlug/status/:token" component={CareersStatus} />
      <Route path="/careers/:orgSlug" component={CareersLanding} />

      {/* Secure routes */}
      <Route path="/dashboard">
        {() => <SecureRoute component={Dashboard} />}
      </Route>
      <Route path="/profile">
        {() => <SecureRoute component={Profile} />}
      </Route>
      <Route path="/notifications">
        {() => <SecureRoute component={Notifications} />}
      </Route>
      <Route path="/organizations">
        {() => <SecureRoute component={Organizations} />}
      </Route>
      <Route path="/settings">
        {() => <SecureRoute component={Settings} />}
      </Route>
      <Route path="/branches">
        {() => <SecureRoute component={Branches} />}
      </Route>
      <Route path="/departments">
        {() => <SecureRoute component={Departments} />}
      </Route>
      <Route path="/positions">
        {() => <SecureRoute component={Positions} />}
      </Route>
      <Route path="/documents">
        {() => <SecureRoute component={OrganizationDocuments} />}
      </Route>
      <Route path="/document-templates">
        {() => <SecureRoute component={DocumentTemplates} />}
      </Route>
      <Route path="/employees/:id">
        {() => <SecureRoute component={EmployeeDetail} />}
      </Route>
      <Route path="/employees">
        {() => <SecureRoute component={Employees} />}
      </Route>
      <Route path="/personnel-reports">
        {() => <SecureRoute component={PersonnelReports} />}
      </Route>
      <Route path="/personnel-import">
        {() => <SecureRoute component={PersonnelImport} />}
      </Route>
      <Route path="/data-migration">
        {() => <SecureRoute component={DataMigration} />}
      </Route>
      <Route path="/custom-fields">
        {() => <SecureRoute component={CustomFields} />}
      </Route>
      <Route path="/custom-forms">
        {() => <SecureRoute component={CustomForms} />}
      </Route>
      <Route path="/recruitment-approvals-config">
        {() => <SecureRoute component={RecruitmentApprovalsConfig} />}
      </Route>
      {/*
        WS-12 — Employee Relations & Offboarding Clearance. No moduleKey: these
        are Core HR surfaces, and every endpoint behind them enforces its own
        permission server-side (§28.17). `/my-grievances` is deliberately
        ungated here beyond authentication — an employee's right to their own
        grievance comes from their employee link, resolved on the server.
      */}
      <Route path="/employee-relations">
        {() => <SecureRoute component={EmployeeRelations} />}
      </Route>
      <Route path="/offboarding">
        {() => <SecureRoute component={Offboarding} />}
      </Route>
      <Route path="/my-grievances">
        {() => <SecureRoute component={MyGrievances} />}
      </Route>
      {/*
        WS-13 — Requests and Approvals. The HR surfaces carry no moduleKey:
        they are Core HR, and every endpoint behind them enforces its own
        permission server-side (section 29.18). "/my-requests" needs no
        permission — an employee's right to ask about their own record comes
        from their employee link — but it IS an Employee Self-Service surface,
        so it follows that module exactly as its my-* API routes now do
        (Core-HR Phase 1).
      */}
      <Route path="/my-requests">
        {() => <SecureRoute component={MyRequests} moduleKey="employee_self_service" />}
      </Route>
      <Route path="/requests">
        {() => <SecureRoute component={Requests} />}
      </Route>
      <Route path="/request-settings">
        {() => <SecureRoute component={RequestSettings} />}
      </Route>
      {/*
        WS-14 — Skills, Competency and Succession. No moduleKey: capability is a
        Core HR concern, and every endpoint behind these pages enforces its own
        permission server-side (section 30.22). "/my-skills" is deliberately
        ungated beyond authentication, because an employee's right to record
        what they can do comes from their employee link.

        "/succession" is a separate route from "/capability" ON PURPOSE (section
        30.17): succession is confidential, its permissions are narrower than the
        capability keys, and folding it into the capability page would have made
        one navigation entry serve two different audiences.
      */}
      <Route path="/skills-settings">
        {() => <SecureRoute component={SkillsSettings} />}
      </Route>
      <Route path="/capability">
        {() => <SecureRoute component={Capability} />}
      </Route>
      <Route path="/my-skills">
        {() => <SecureRoute component={MySkills} />}
      </Route>
      <Route path="/succession">
        {() => <SecureRoute component={SuccessionPage} />}
      </Route>
      {/*
        WS-26 — Tenant Form, Workflow & Signature Engine. No moduleKey: a
        template carries its own optional module key, enforced server-side
        when a submission is created. "/forms" is ungated beyond
        authentication because an employee's right to their own forms comes
        from their employee link; every read is filtered server-side.
      */}
      <Route path="/forms/:submissionId">
        {() => <SecureRoute component={FormSubmissionPage} />}
      </Route>
      <Route path="/forms">
        {() => <SecureRoute component={FormsPage} />}
      </Route>
      <Route path="/form-templates">
        {() => <SecureRoute component={FormTemplatesPage} />}
      </Route>
      {/*
        WS-15 — the HR Action Centre. No moduleKey and no permission gate: it
        is a composition surface, and every row was already permission-filtered
        by its own source provider (section 31.12). A caller with no eligible
        source access sees an empty queue rather than a 403, and cannot tell
        which modules exist.

        "/my-actions" is likewise ungated beyond authentication — an employee's
        own work is theirs, resolved server-side from the employee link.
      */}
      <Route path="/action-centre">
        {() => <SecureRoute component={ActionCentre} />}
      </Route>
      <Route path="/my-actions">
        {() => <SecureRoute component={MyActions} />}
      </Route>
      <Route path="/onboarding">
        {() => <SecureRoute component={Onboarding} moduleKey="onboarding" />}
      </Route>
      <Route path="/onboarding/:instanceId">
        {() => <SecureRoute component={OnboardingDetail} moduleKey="onboarding" />}
      </Route>
      <Route path="/my-onboarding">
        {() => <SecureRoute component={MyOnboarding} moduleKey="onboarding" />}
      </Route>
      <Route path="/add-candidate">
        {() => <SecureRoute component={ManualCandidateCapture} />}
      </Route>
      <Route path="/admin/:organizationId">
        {() => <SecureRoute component={Admin} />}
      </Route>
      <Route path="/admin">
        {() => <SecureRoute component={Admin} />}
      </Route>
      <Route path="/platform-admin">
        {() => <SecureRoute component={PlatformAdmin} />}
      </Route>
      <Route path="/leave-types">
        {() => <SecureRoute component={LeaveTypes} moduleKey="leave" />}
      </Route>
      <Route path="/my-leave">
        {() => <SecureRoute component={MyLeave} moduleKey="leave" />}
      </Route>
      <Route path="/leave-balances">
        {() => <SecureRoute component={LeaveBalances} moduleKey="leave" />}
      </Route>
      <Route path="/leave-approvals">
        {() => <SecureRoute component={LeaveApprovals} moduleKey="leave" />}
      </Route>
      <Route path="/leave-calendar">
        {() => <SecureRoute component={LeaveCalendar} moduleKey="leave" />}
      </Route>
      <Route path="/public-holidays">
        {() => <SecureRoute component={PublicHolidays} moduleKey="leave" />}
      </Route>
      <Route path="/attendance-settings">
        {() => <SecureRoute component={AttendanceSettings} moduleKey="attendance" />}
      </Route>
      <Route path="/attendance-register">
        {() => <SecureRoute component={AttendanceRegister} moduleKey="attendance" />}
      </Route>
      <Route path="/attendance-dashboard">
        {() => <SecureRoute component={AttendanceDashboard} moduleKey="attendance" />}
      </Route>
      <Route path="/attendance-reports">
        {() => <SecureRoute component={AttendanceReports} moduleKey="attendance" />}
      </Route>
      <Route path="/performance-rating-scales">
        {() => <SecureRoute component={PerformanceRatingScales} moduleKey="performance" />}
      </Route>
      <Route path="/payroll-statutory-rules">
        {() => <SecureRoute component={PayrollStatutoryRules} moduleKey="payroll" />}
      </Route>
      <Route path="/payroll-employee-compensation">
        {() => <SecureRoute component={PayrollEmployeeCompensation} moduleKey="payroll" />}
      </Route>
      <Route path="/payroll-periods">
        {() => <SecureRoute component={PayrollPeriods} moduleKey="payroll" />}
      </Route>
      <Route path="/payroll-my-payslips">
        {() => <SecureRoute component={PayrollMyPayslips} moduleKey="payroll" />}
      </Route>
      <Route path="/performance-templates">
        {() => <SecureRoute component={PerformanceTemplates} moduleKey="performance" />}
      </Route>
      <Route path="/performance-cycles">
        {() => <SecureRoute component={PerformanceCycles} moduleKey="performance" />}
      </Route>
      <Route path="/performance-team">
        {() => <SecureRoute component={PerformanceTeam} moduleKey="performance" />}
      </Route>
      <Route path="/performance-reviews">
        {() => <SecureRoute component={PerformanceReviews} moduleKey="performance" />}
      </Route>
      <Route path="/performance">
        {() => <SecureRoute component={PerformanceDashboard} moduleKey="performance" />}
      </Route>
      <Route path="/performance-reports">
        {() => <SecureRoute component={PerformanceReports} moduleKey="performance" />}
      </Route>
      <Route path="/learning-courses">
        {() => <SecureRoute component={LearningCourses} moduleKey="learning" />}
      </Route>
      <Route path="/learning-team-training">
        {() => <SecureRoute component={LearningTeamTraining} moduleKey="learning" />}
      </Route>
      <Route path="/learning-enrollments">
        {() => <SecureRoute component={LearningEnrollments} moduleKey="learning" />}
      </Route>
      <Route path="/learning">
        {() => <SecureRoute component={LearningDashboard} moduleKey="learning" />}
      </Route>
      <Route path="/learning-reports">
        {() => <SecureRoute component={LearningReports} moduleKey="learning" />}
      </Route>
      <Route path="/assets">
        {() => <SecureRoute component={Assets} moduleKey="asset_management" />}
      </Route>
      {/* VR-01 — the vehicle register is Assets administration: the same
          asset_management module gate as the rest of the group, and the page's
          own controls follow asset_management.manage, which the API re-checks. */}
      <Route path="/vehicles">
        {() => <SecureRoute component={Vehicles} moduleKey="asset_management" />}
      </Route>
      {/* VR-02A — who approves a vehicle request. Administration of the vehicle
          domain, so the same asset_management gate as the register; the API
          re-checks asset_management.manage on every stage route. */}
      <Route path="/vehicle-request-approvals-config">
        {() => <SecureRoute component={VehicleRequestApprovalsConfig} moduleKey="asset_management" />}
      </Route>
      <Route path="/team-assets">
        {() => <SecureRoute component={TeamAssets} moduleKey="asset_management" />}
      </Route>
      <Route path="/assets-dashboard">
        {() => <SecureRoute component={AssetsDashboard} moduleKey="asset_management" />}
      </Route>
      <Route path="/asset-reports">
        {() => <SecureRoute component={AssetReports} moduleKey="asset_management" />}
      </Route>
      <Route path="/asset-workspace">
        {() => <SecureRoute component={AssetWorkspace} moduleKey="asset_management" />}
      </Route>
      <Route path="/office-inventory">
        {() => <SecureRoute component={OfficeInventory} moduleKey="office_inventory" />}
      </Route>
      <Route path="/self-service">
        {() => <SecureRoute component={EmployeeSelfService} moduleKey="employee_self_service" />}
      </Route>
      <Route path="/manager">
        {() => <SecureRoute component={ManagerPortal} moduleKey="manager_portal" />}
      </Route>
      <Route path="/recruitment-settings">
        {() => <SecureRoute component={RecruitmentSettings} moduleKey="recruitment" />}
      </Route>
      <Route path="/requisitions/:id">
        {() => <SecureRoute component={RequisitionDetail} moduleKey="recruitment" />}
      </Route>
      <Route path="/requisitions">
        {() => <SecureRoute component={Requisitions} moduleKey="recruitment" />}
      </Route>
      <Route path="/requisition-approvals">
        {() => <SecureRoute component={RequisitionApprovals} moduleKey="recruitment" />}
      </Route>
      <Route path="/vacancies/:id/edit">
        {() => <SecureRoute component={VacancyEditor} moduleKey="recruitment" />}
      </Route>
      <Route path="/vacancies">
        {() => <SecureRoute component={Vacancies} moduleKey="recruitment" />}
      </Route>
      <Route path="/applications/:id">
        {() => <SecureRoute component={ApplicationDetail} moduleKey="recruitment" />}
      </Route>
      <Route path="/applications">
        {() => <SecureRoute component={Applications} moduleKey="recruitment" />}
      </Route>
      <Route path="/pipeline">
        {() => <SecureRoute component={Pipeline} moduleKey="recruitment" />}
      </Route>
      <Route path="/candidates/:id">
        {() => <SecureRoute component={CandidateDetail} moduleKey="recruitment" />}
      </Route>
      <Route path="/talent-pools">
        {() => <SecureRoute component={TalentPools} moduleKey="recruitment" />}
      </Route>
      <Route path="/interviews/:id/scorecard">
        {() => <SecureRoute component={InterviewScorecard} moduleKey="recruitment" />}
      </Route>
      <Route path="/interviews/:id">
        {() => <SecureRoute component={InterviewDetail} moduleKey="recruitment" />}
      </Route>
      <Route path="/interviews">
        {() => <SecureRoute component={Interviews} moduleKey="recruitment" />}
      </Route>
      <Route path="/offers/:id">
        {() => <SecureRoute component={OfferDetail} moduleKey="recruitment" />}
      </Route>
      <Route path="/offers">
        {() => <SecureRoute component={Offers} moduleKey="recruitment" />}
      </Route>
      <Route path="/recruitment">
        {() => <SecureRoute component={RecruitmentDashboard} moduleKey="recruitment" />}
      </Route>
      <Route path="/recruitment-reports">
        {() => <SecureRoute component={RecruitmentReports} moduleKey="recruitment" />}
      </Route>

      {/* WS-25A design-foundation showcase — development builds only. The
          conditional is on a compile-time constant, so the page and its route
          are dead-code-eliminated from the production bundle; nothing here is
          reachable on a deployed host. */}
      {import.meta.env.DEV && (
        <Route path="/dev/design-foundation">
          {() => <DesignFoundationShowcase />}
        </Route>
      )}

      {/* 404 fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TenantTheme />
        {/* framer-motion honours the OS reduced-motion preference for the
            few remaining JS-driven animations; CSS motion is covered by the
            global rule in index.css. */}
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <a href="#main-content" className="skip-link">
              Skip to content
            </a>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </MotionConfig>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
