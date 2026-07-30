import { Router } from "express";
import { CreateTalentPoolBody, UpdateTalentPoolBody, AddTalentPoolMemberBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { isUniqueViolation } from "../lib/dbErrors";
import { CandidateNotFoundError } from "../lib/candidates";
import {
  listTalentPools,
  getTalentPoolById,
  createTalentPool,
  updateTalentPool,
  archiveTalentPool,
  reactivateTalentPool,
  listTalentPoolMembers,
  addTalentPoolMember,
  removeTalentPoolMember,
  TalentPoolNotFoundError,
  DuplicateTalentPoolNameError,
  TalentPoolMemberNotFoundError,
  DuplicateTalentPoolMemberError,
} from "../lib/talentPools";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/talent-pools
router.get(
  "/organizations/:organizationId/talent-pools",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("talent_pool.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const pools = await listTalentPools(req.membership!.organizationId);
    res.json(pools);
  },
);

// POST /organizations/:organizationId/talent-pools
router.post(
  "/organizations/:organizationId/talent-pools",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("talent_pool.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateTalentPoolBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const pool = await createTalentPool({
        organizationId: req.membership!.organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(pool);
    } catch (err) {
      if (err instanceof DuplicateTalentPoolNameError || isUniqueViolation(err)) {
        res.status(409).json({ error: "A talent pool with this name already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/talent-pools/:poolId
router.get(
  "/organizations/:organizationId/talent-pools/:poolId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("talent_pool.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const poolId = parseId(req.params.poolId);
    if (isNaN(poolId)) {
      res.status(400).json({ error: "Invalid talent pool ID" });
      return;
    }
    const pool = await getTalentPoolById(req.membership!.organizationId, poolId);
    if (!pool) {
      res.status(404).json({ error: "Talent pool not found" });
      return;
    }
    res.json(pool);
  },
);

// PATCH /organizations/:organizationId/talent-pools/:poolId
router.patch(
  "/organizations/:organizationId/talent-pools/:poolId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("talent_pool.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const poolId = parseId(req.params.poolId);
    if (isNaN(poolId)) {
      res.status(400).json({ error: "Invalid talent pool ID" });
      return;
    }
    const parsed = UpdateTalentPoolBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const pool = await updateTalentPool({
        organizationId: req.membership!.organizationId,
        poolId,
        name: parsed.data.name,
        description: parsed.data.description,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(pool);
    } catch (err) {
      if (err instanceof TalentPoolNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof DuplicateTalentPoolNameError || isUniqueViolation(err)) {
        res.status(409).json({ error: "A talent pool with this name already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/talent-pools/:poolId/archive
router.post(
  "/organizations/:organizationId/talent-pools/:poolId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("talent_pool.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const poolId = parseId(req.params.poolId);
    if (isNaN(poolId)) {
      res.status(400).json({ error: "Invalid talent pool ID" });
      return;
    }
    try {
      const pool = await archiveTalentPool({
        organizationId: req.membership!.organizationId,
        poolId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(pool);
    } catch (err) {
      if (err instanceof TalentPoolNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/talent-pools/:poolId/reactivate
router.post(
  "/organizations/:organizationId/talent-pools/:poolId/reactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("talent_pool.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const poolId = parseId(req.params.poolId);
    if (isNaN(poolId)) {
      res.status(400).json({ error: "Invalid talent pool ID" });
      return;
    }
    try {
      const pool = await reactivateTalentPool({
        organizationId: req.membership!.organizationId,
        poolId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(pool);
    } catch (err) {
      if (err instanceof TalentPoolNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/talent-pools/:poolId/members
router.get(
  "/organizations/:organizationId/talent-pools/:poolId/members",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("talent_pool.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const poolId = parseId(req.params.poolId);
    if (isNaN(poolId)) {
      res.status(400).json({ error: "Invalid talent pool ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const pool = await getTalentPoolById(organizationId, poolId);
    if (!pool) {
      res.status(404).json({ error: "Talent pool not found" });
      return;
    }
    const members = await listTalentPoolMembers(organizationId, poolId);
    res.json(members);
  },
);

// POST /organizations/:organizationId/talent-pools/:poolId/members
router.post(
  "/organizations/:organizationId/talent-pools/:poolId/members",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("talent_pool.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const poolId = parseId(req.params.poolId);
    if (isNaN(poolId)) {
      res.status(400).json({ error: "Invalid talent pool ID" });
      return;
    }
    const parsed = AddTalentPoolMemberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const member = await addTalentPoolMember({
        organizationId: req.membership!.organizationId,
        poolId,
        candidateId: parsed.data.candidateId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(member);
    } catch (err) {
      if (err instanceof TalentPoolNotFoundError || err instanceof CandidateNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof DuplicateTalentPoolMemberError || isUniqueViolation(err)) {
        res.status(409).json({ error: "Candidate is already a member of this talent pool" });
        return;
      }
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/talent-pools/:poolId/members/:candidateId
router.delete(
  "/organizations/:organizationId/talent-pools/:poolId/members/:candidateId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("talent_pool.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const poolId = parseId(req.params.poolId);
    const candidateId = parseId(req.params.candidateId);
    if (isNaN(poolId) || isNaN(candidateId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      await removeTalentPoolMember({
        organizationId: req.membership!.organizationId,
        poolId,
        candidateId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(204).send();
    } catch (err) {
      if (err instanceof TalentPoolMemberNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
