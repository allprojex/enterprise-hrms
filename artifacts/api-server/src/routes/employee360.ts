import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { resolveEmployee360, Employee360EmployeeNotFoundError } from "../lib/employee360/aggregate";

/**
 * WS-15 P2/P3 — Employee 360 sections (§31.29).
 *
 * ONE ENDPOINT, AND IT IS NOT A GIANT EMPLOYEE DTO. §31.29 forbids "a single
 * endpoint returning everything about a person", and this is not one: it
 * returns a bounded SUMMARY per module — a few headline figures, at most five
 * recent rows, and a deep link — with the detail left where it lives. What it
 * gives that eight separate endpoints could not is the omission semantics
 * §31.29 actually requires: a section the caller may not read is simply absent
 * from the array, indistinguishable from a disabled module or an employee with
 * nothing recorded. Eight endpoints would have had to answer 403 or 404 per
 * section, and either answer confirms the module exists.
 *
 * NO PERMISSION IS MINTED HERE. `requireAuth` and `requireMembership` only,
 * following the same reasoning as the Action Centre (§31.12): each provider
 * enforces its own module's permission, so a caller with no eligible section
 * receives an empty array rather than a 403.
 *
 * THE ORGANIZATION IS NEVER TAKEN FROM THE CLIENT, and the employee is proved
 * to belong to it before any provider runs — so a forged cross-tenant employee
 * id fails once, cleanly, rather than eight times over (§31.24).
 *
 * NOTHING HERE WRITES, AND NOTHING HERE AUDITS. Every section is a redacted
 * summary, so no OD #18 sensitive-read event is recorded: the owning module's
 * own path remains authoritative at the deep link, and auditing a pointer would
 * double-count a read that never happened (§31.15).
 */

const router = Router();

router.get(
  "/organizations/:organizationId/employees/:employeeId/360-sections",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = Number(req.params["employeeId"]);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      res.status(400).json({ error: "Invalid employee" });
      return;
    }

    try {
      const result = await resolveEmployee360({
        organizationId: req.membership!.organizationId,
        employeeId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof Employee360EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
