import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AppShell } from '@/components/layout/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';
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
import Departments from '@/pages/departments';
import Positions from '@/pages/positions';
import Employees from '@/pages/employees';
import EmployeeDetail from '@/pages/employee-detail';
import Admin from '@/pages/admin';
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
import PerformanceTemplates from '@/pages/performance-templates';
import PerformanceCycles from '@/pages/performance-cycles';
import PerformanceTeam from '@/pages/performance-team';
import EmployeeSelfService from '@/pages/employee-self-service';
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
      <Route path="/employees/:id">
        {() => <SecureRoute component={EmployeeDetail} />}
      </Route>
      <Route path="/employees">
        {() => <SecureRoute component={Employees} />}
      </Route>
      <Route path="/admin">
        {() => <SecureRoute component={Admin} />}
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
      <Route path="/performance-templates">
        {() => <SecureRoute component={PerformanceTemplates} moduleKey="performance" />}
      </Route>
      <Route path="/performance-cycles">
        {() => <SecureRoute component={PerformanceCycles} moduleKey="performance" />}
      </Route>
      <Route path="/performance-team">
        {() => <SecureRoute component={PerformanceTeam} moduleKey="performance" />}
      </Route>
      <Route path="/self-service">
        {() => <SecureRoute component={EmployeeSelfService} moduleKey="employee_self_service" />}
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

      {/* 404 fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
