/**
 * Phase 3H, W115 — Personnel File Registry & PIF Linkage.
 * Every route here is gated by personnel_file.read/personnel_file.manage
 * (org_admin/hr_manager only, never employee) — deliberately never the
 * broad employee.read/.write, per the frozen plan's own least-privilege
 * instruction.
 */
import { Router } from "express";
import { CreatePersonnelFileBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, resolveOrganizationId, resolveActorMembershipId, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { getEmployeeById } from "../lib/employees";
import {
  createGeneratedPersonnelFile,
  createManualPersonnelFile,
  getPersonnelFileByEmployee,
  getPersonnelFileById,
  searchPersonnelRecords,
  auditPersonnelFileCreated,
  EmployeeNotFoundForPersonnelFileError,
  PersonnelFileAlreadyExistsError,
  PifNumberCollisionError,
  InvalidManualPifNumberError,
} from "../lib/personnelFiles";
import { EmployeeNumberMissingTokenDataError } from "../lib/numbering";
import { db, type PersonnelFile } from "@workspace/db";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function formatPersonnelFile(p: PersonnelFile) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    employeeId: p.employeeId,
    pifNumber: p.pifNumber,
    allocationMethod: p.allocationMethod,
    allocatedByMembershipId: p.allocatedByMembershipId,
    currentLocationId: p.currentLocationId,
    currentCustodyState: p.currentCustodyState,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// POST /organizations/:organizationId/employees/:employeeId/personnel-file
router.post(
  "/organizations/:organizationId/employees/:employeeId/personnel-file",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const parsed = CreatePersonnelFileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    try {
      const personnelFile =
        parsed.data.mode === "manual"
          ? await createManualPersonnelFile(db, {
              organizationId,
              employeeId,
              pifNumber: parsed.data.pifNumber ?? "",
              actorMembershipId: req.membership!.id,
            })
          : await createGeneratedPersonnelFile(db, {
              organizationId,
              employeeId,
              actorMembershipId: req.membership!.id,
            });

      await auditPersonnelFileCreated({
        organizationId,
        employeeId,
        personnelFile,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });

      res.status(201).json(formatPersonnelFile(personnelFile));
    } catch (err) {
      if (err instanceof EmployeeNotFoundForPersonnelFileError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PersonnelFileAlreadyExistsError || err instanceof InvalidManualPifNumberError || err instanceof EmployeeNumberMissingTokenDataError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof PifNumberCollisionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/employees/:employeeId/personnel-file
router.get(
  "/organizations/:organizationId/employees/:employeeId/personnel-file",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const organizationId = resolveOrganizationId(req);
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const personnelFile = await getPersonnelFileByEmployee(organizationId, employeeId);
    if (!personnelFile) {
      res.status(404).json({ error: "This employee has no personnel file yet" });
      return;
    }

    // WS-3 (Owner Decision #18): a specific personnel file's own details are
    // a deliberate, higher-value sensitive read (a named, confidential
    // record, unlike the search endpoint below, which returns only a
    // routine list and stays unaudited to avoid noise — §16 of the frozen
    // review). WS-4: actorMembershipId is null and breakGlassGrantId is
    // auto-attached (see auditLog.ts) when this read happens under an
    // active break-glass grant rather than a real membership.
    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: resolveActorMembershipId(req),
      organizationId,
      eventType: "personnel_file.viewed",
      targetType: "personnel_file",
      targetId: String(personnelFile.id),
      outcome: "success",
    });

    res.json(formatPersonnelFile(personnelFile));
  },
);

// GET /organizations/:organizationId/personnel-files/:personnelFileId
router.get(
  "/organizations/:organizationId/personnel-files/:personnelFileId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const idRaw = Array.isArray(req.params.personnelFileId) ? req.params.personnelFileId[0] : req.params.personnelFileId;
    const personnelFileId = parseInt(idRaw, 10);
    if (isNaN(personnelFileId)) {
      res.status(400).json({ error: "Invalid personnel file ID" });
      return;
    }

    const organizationId = resolveOrganizationId(req);
    const personnelFile = await getPersonnelFileById(organizationId, personnelFileId);
    if (!personnelFile) {
      res.status(404).json({ error: "Personnel file not found" });
      return;
    }

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: resolveActorMembershipId(req),
      organizationId,
      eventType: "personnel_file.viewed",
      targetType: "personnel_file",
      targetId: String(personnelFile.id),
      outcome: "success",
    });

    res.json(formatPersonnelFile(personnelFile));
  },
);

// GET /organizations/:organizationId/personnel-records/search
router.get(
  "/organizations/:organizationId/personnel-records/search",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const searchRaw = req.query.search;
    const search = typeof searchRaw === "string" ? searchRaw.trim() : "";
    if (!search) {
      res.json([]);
      return;
    }

    const organizationId = resolveOrganizationId(req);
    const results = await searchPersonnelRecords(organizationId, search);
    res.json(results);
  },
);

export default router;
