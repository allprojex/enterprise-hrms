import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { hasPermission } from "../lib/permissions";
import { EMPLOYEE_SENSITIVE_WRITE_PERMISSION, EMPLOYEE_NOTES_PERMISSION } from "../lib/employeeRecordPolicy";
import {
  convertApplicationToEmployee,
  ApplicationNotFoundForConversionError,
  ApplicationNotHiredError,
  PreEmploymentRequirementsNotSatisfiedError,
  HireNotAuthorizedError,
  OfferNotAcceptedError,
  AlreadyConvertedError,
} from "../lib/employeeConversion";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// POST /organizations/:organizationId/applications/:applicationId/convert-to-employee
// Requires BOTH candidate.convert_to_employee (the recruitment-side
// trigger, §7's own row) AND employee.write (the actual employee-creation
// authority this reuses) — neither permission alone can bypass the other,
// mirroring §7's own "reused, not reinvented" note.
router.post(
  "/organizations/:organizationId/applications/:applicationId/convert-to-employee",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("candidate.convert_to_employee"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    try {
      // Employee backend hardening (final review): the converting actor's own
      // sensitive-write grant decides whether the candidate's contact/identity
      // fields are copied onto the employee record. Resolved from effective
      // permissions, never from the body.
      const [canWriteSensitive, canWriteNotes] = await Promise.all([
        hasPermission(req.membership!.id, EMPLOYEE_SENSITIVE_WRITE_PERMISSION),
        hasPermission(req.membership!.id, EMPLOYEE_NOTES_PERMISSION),
      ]);
      const result = await convertApplicationToEmployee({
        organizationId: req.membership!.organizationId,
        applicationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        authorization: { canWriteSensitive, canWriteNotes },
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof ApplicationNotFoundForConversionError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof ApplicationNotHiredError || err instanceof PreEmploymentRequirementsNotSatisfiedError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof AlreadyConvertedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
