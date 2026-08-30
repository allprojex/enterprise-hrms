import { Router } from "express";
import { ExecuteActionCentreCommandBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { resolveActionCentre, resolveActionCentreCounts, type ActionCentreQuery } from "../lib/actionCentre/aggregate";
import { resolveEssActions } from "../lib/actionCentre/ess";
import {
  executeInlineCommand,
  CommandNotAllowedError,
  CommandTargetNotFoundError,
  CommandStateConflictError,
} from "../lib/actionCentre/commands";
import { isInlineCommand, type ActionScope, type DueState } from "../lib/actionCentre/types";

/**
 * WS-15 — the HR Action Centre (§31.33).
 *
 * FOUR ENDPOINTS, AND NO DETAIL ENDPOINT (§31.33). A row's detail is the
 * owning module's own surface, reached through `deepLink`. There is deliberately
 * no `GET /action-centre/{id}`: adding one would be the first step toward WS-15
 * returning sensitive detail, and §31.15 exists to keep that from happening
 * quietly.
 *
 * NO PERMISSION IS MINTED HERE (§31.12). These routes carry `requireAuth` and
 * `requireMembership` and nothing else, following the Manager Portal precedent
 * of shipping with zero new permissions. Visibility comes entirely from the
 * source providers, each enforcing its own module's permission — so a caller
 * with no eligible source access receives an empty queue rather than a 403, and
 * cannot tell which modules exist. A coarse gate here would be the umbrella
 * permission §31.12 forbids.
 *
 * THE ORGANIZATION IS NEVER TAKEN FROM THE CLIENT. Every handler reads
 * `req.membership!.organizationId`, so a forged `:organizationId` fails safely
 * and providers scope every query to it (§31.24).
 *
 * NO SENSITIVE-READ AUDIT IS RECORDED HERE (§31.15). These surfaces return
 * generic redacted rows and nothing else; the owning module's OD #18 path
 * remains authoritative at the deep link, and auditing a pointer would
 * double-count a read that never happened.
 */

const router = Router();

const SCOPES: readonly ActionScope[] = ["my_actions", "assigned", "oversight"];
const DUE_STATES: readonly DueState[] = ["overdue", "due_soon", "undated"];

function readQuery(req: MembershipRequest): ActionCentreQuery {
  const raw = (key: string): string | undefined => {
    const value = req.query[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const scopeParam = raw("scope");
  const scope: ActionScope =
    scopeParam && (SCOPES as readonly string[]).includes(scopeParam) ? (scopeParam as ActionScope) : "my_actions";

  const dueStateParam = raw("dueState");
  const dueState =
    dueStateParam && (DUE_STATES as readonly string[]).includes(dueStateParam)
      ? (dueStateParam as DueState)
      : undefined;

  const employeeIdParam = raw("employeeId");
  const employeeId = employeeIdParam ? Number(employeeIdParam) : undefined;

  // Filters are read permissively and applied AFTER the providers have already
  // returned only permitted rows (§31.19). An unrecognized value narrows to
  // nothing; it can never widen what a provider returned.
  return {
    scope,
    sourceModule: raw("sourceModule") as ActionCentreQuery["sourceModule"],
    actionKind: raw("actionKind"),
    status: raw("status"),
    dueState,
    employeeId: Number.isInteger(employeeId) && (employeeId as number) > 0 ? employeeId : undefined,
  };
}

router.get(
  "/organizations/:organizationId/action-centre",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const result = await resolveActionCentre(
      {
        organizationId: req.membership!.organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      },
      readQuery(req),
    );
    res.json(result);
  },
);

router.get(
  "/organizations/:organizationId/action-centre/counts",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    // Counts run the same providers as rows, so a source the caller cannot read
    // is absent from `byModule` rather than reported as zero (§31.19).
    const counts = await resolveActionCentreCounts(
      {
        organizationId: req.membership!.organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      },
      readQuery(req),
    );
    res.json(counts);
  },
);

/** ESS My Actions — the §31.13 allow-list. The subject is server-derived. */
router.get(
  "/organizations/:organizationId/my-action-centre",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    // No employee identifier is accepted, and none would be read if supplied.
    res.json(await resolveEssActions(req.membership!.organizationId, req.userId!));
  },
);

/**
 * The one inline-command endpoint (§31.33).
 *
 * The command name is validated against the closed §31.8 vocabulary BEFORE
 * anything else happens — so a client can never name a module, a table or a
 * method, and there is no generic command bus. Authority is then re-checked at
 * action time by the command handler and again inside the owning module's own
 * service (§31.8, §31.34).
 */
router.post(
  "/organizations/:organizationId/action-centre/actions/:command",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const command = String(req.params["command"] ?? "");
    if (!isInlineCommand(command)) {
      res.status(404).json({ error: "Unknown action." });
      return;
    }

    const parsed = ExecuteActionCentreCommandBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const result = await executeInlineCommand(command, {
        organizationId: req.membership!.organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
        sourceId: parsed.data.sourceId,
        reason: parsed.data.reason ?? null,
        notes: parsed.data.notes ?? null,
        levelId: parsed.data.levelId ?? null,
        assessedAt: parsed.data.assessedAt ? new Date(parsed.data.assessedAt) : null,
      });
      // The source's own fresh truth is returned — never a WS-15 view of it.
      res.json({ ok: true, result });
    } catch (err) {
      if (err instanceof CommandNotAllowedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof CommandTargetNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof CommandStateConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      // Every other failure is the owning module's own domain error. It is
      // surfaced with the source's message and status where the source defines
      // one, and never replayed (§31.22).
      const name = (err as Error)?.name ?? "";
      const message = (err as Error)?.message ?? "That action could not be completed.";
      if (/NotAuthorized|SelfApproval|Forbidden/i.test(name)) {
        res.status(403).json({ error: message });
        return;
      }
      if (/NotFound/i.test(name)) {
        res.status(404).json({ error: message });
        return;
      }
      if (/NotOpen|NotSatisfied|Required|Invalid|Conflict|AlreadyDecided/i.test(name)) {
        res.status(409).json({ error: message });
        return;
      }
      throw err;
    }
  },
);

export default router;
