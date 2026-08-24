/**
 * Office Inventory, Workstream 9 — Reporting & Dashboard routes
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §43, §44). A dedicated,
 * ADR-016 route (not the generic GET .../reports/:reportKey/run — that
 * route's RUNNERS map has no entries for these keys, so it safely 404s
 * "Unknown report" for any of them), mirroring assetReporting.ts/
 * performanceReporting.ts exactly in shape, but simpler: Office Inventory
 * reporting has no own/manager/organization-wide visibility tiers, so both
 * routes are gated solely by `office_inventory.reports.read` — no new
 * permission key, and a Department Head's own scoped W8 accountability
 * context is never widened by holding this one.
 *
 * CSV FORMULA-INJECTION HARDENING (Owner Decision 22, the frozen plan's own
 * explicit requirement for this module — NOT the platform's shared default):
 * every other CSV export on this platform (lib/reporting.ts's own generic
 * toCsv, assetReporting.ts/performanceReporting.ts/learningReporting.ts's
 * own local toCsv) shares one disclosed, pre-existing gap — no leading-
 * character escaping against spreadsheet formula injection. This file does
 * NOT share that gap: `safeCsvCell` mirrors payrollPaymentBatches.ts's own
 * proven hardening (a leading `'` guard on any cell beginning with
 * =, +, -, @, tab, or CR, before normal CSV quoting) — required here because
 * Office Inventory rows routinely carry free-text employee/item/store/
 * department display names and reasons a spreadsheet user could paste
 * directly, exactly the payment-batch precedent's own risk profile.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { getReportDefinition } from "../lib/reporting";
import { getOfficeInventoryDashboard, runOfficeInventoryReport, isKnownOfficeInventoryReportKey, OfficeInventoryReportNotFoundError, type OfficeInventoryReportFilters } from "../lib/officeInventoryReporting";
import type { OfficeInventoryMovementType } from "../lib/officeInventoryLedger";

const router = Router();

function optionalId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}
function optionalString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value !== "" ? value : undefined;
}

function safeCsvCell(value: string | number | boolean | null): string {
  let str = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(columns: { key: string; label: string }[], rows: Record<string, string | number | boolean | null>[]): string {
  const header = columns.map((c) => safeCsvCell(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => safeCsvCell(row[c.key])).join(","));
  return [header, ...body].join("\n");
}

// GET /organizations/:organizationId/office-inventory/dashboard
router.get(
  "/organizations/:organizationId/office-inventory/dashboard",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const dashboard = await getOfficeInventoryDashboard(req.membership!.organizationId);
    res.json(dashboard);
  },
);

// GET /organizations/:organizationId/office-inventory/reports/:reportKey?itemId=&storeId=&employeeId=&departmentId=&movementType=&status=&dateFrom=&dateTo=&format=
router.get(
  "/organizations/:organizationId/office-inventory/reports/:reportKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reportKey = Array.isArray(req.params.reportKey) ? req.params.reportKey[0] : req.params.reportKey;

    const definition = await getReportDefinition(reportKey);
    if (!definition || definition.category !== "office_inventory" || !isKnownOfficeInventoryReportKey(reportKey)) {
      res.status(404).json({ error: `Unknown Office Inventory report "${reportKey}"` });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      const filters: OfficeInventoryReportFilters = {
        itemId: optionalId(req.query.itemId),
        storeId: optionalId(req.query.storeId),
        employeeId: optionalId(req.query.employeeId),
        departmentId: optionalId(req.query.departmentId),
        movementType: optionalString(req.query.movementType) as OfficeInventoryMovementType | undefined,
        status: optionalString(req.query.status),
        dateFrom: optionalString(req.query.dateFrom),
        dateTo: optionalString(req.query.dateTo),
      };

      const result = await runOfficeInventoryReport({ key: definition.key, label: definition.label, description: definition.description, organizationId, filters });

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
