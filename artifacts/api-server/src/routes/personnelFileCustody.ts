/**
 * Phase 3H, W116 — Personnel File Volumes & Physical Custody/Movement.
 * Read routes (custody detail, volumes, movement history) require
 * personnel_file.read; volume creation requires personnel_file.manage;
 * every custody-changing action (checkout/return/mark-missing/recover)
 * requires the separate personnel_file.movement.write — a user who can only
 * view files does not automatically gain the ability to move them.
 */
import { Router, type Response } from "express";
import {
  CheckoutPersonnelFileBody,
  ReturnPersonnelFileBody,
  MarkPersonnelFileMissingBody,
  RecoverPersonnelFileBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { getPersonnelFileById } from "../lib/personnelFiles";
import {
  createNextPersonnelFileVolume,
  listPersonnelFileVolumes,
  checkoutPersonnelFile,
  returnPersonnelFile,
  markPersonnelFileMissing,
  recoverPersonnelFile,
  listMovementHistory,
  getFileCustodyDetail,
  PersonnelFileNotFoundForCustodyError,
  PersonnelFileVolumeNotFoundError,
  RecordsLocationNotFoundForCustodyError,
  RecordsLocationRetiredForCustodyError,
  IllegalCustodyTransitionError,
  MissingReasonRequiredError,
} from "../lib/personnelFileCustody";
import { db, type PersonnelFile, type PersonnelFileVolume, type PersonnelFileMovement } from "@workspace/db";

const router = Router();

function formatVolume(v: PersonnelFileVolume) {
  return {
    id: v.id,
    organizationId: v.organizationId,
    personnelFileId: v.personnelFileId,
    volumeNumber: v.volumeNumber,
    status: v.status,
    currentLocationId: v.currentLocationId,
    currentCustodyState: v.currentCustodyState,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

function formatMovement(m: PersonnelFileMovement) {
  return {
    id: m.id,
    organizationId: m.organizationId,
    personnelFileId: m.personnelFileId,
    volumeId: m.volumeId,
    eventType: m.eventType,
    occurredAt: m.occurredAt,
    actorMembershipId: m.actorMembershipId,
    purpose: m.purpose,
    destination: m.destination,
    expectedReturnDate: m.expectedReturnDate,
    notes: m.notes,
    createdAt: m.createdAt,
  };
}

async function requireOwnPersonnelFile(req: MembershipRequest, res: Response): Promise<PersonnelFile | null> {
  const raw = Array.isArray(req.params.personnelFileId) ? req.params.personnelFileId[0] : req.params.personnelFileId;
  const personnelFileId = parseInt(raw, 10);
  if (isNaN(personnelFileId)) {
    res.status(400).json({ error: "Invalid personnel file ID" });
    return null;
  }
  const file = await getPersonnelFileById(req.membership!.organizationId, personnelFileId);
  if (!file) {
    res.status(404).json({ error: "Personnel file not found" });
    return null;
  }
  return file;
}

function handleCustodyError(err: unknown, res: Response): boolean {
  if (err instanceof PersonnelFileNotFoundForCustodyError || err instanceof PersonnelFileVolumeNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof RecordsLocationNotFoundForCustodyError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof RecordsLocationRetiredForCustodyError || err instanceof MissingReasonRequiredError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof IllegalCustodyTransitionError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/personnel-files/:personnelFileId/custody
router.get(
  "/organizations/:organizationId/personnel-files/:personnelFileId/custody",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const file = await requireOwnPersonnelFile(req, res);
    if (file == null) return;
    const detail = await getFileCustodyDetail(file);
    res.json(detail);
  },
);

// GET /organizations/:organizationId/personnel-files/:personnelFileId/volumes
router.get(
  "/organizations/:organizationId/personnel-files/:personnelFileId/volumes",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const file = await requireOwnPersonnelFile(req, res);
    if (file == null) return;
    const personnelFileId = file.id;
    const volumes = await listPersonnelFileVolumes(req.membership!.organizationId, personnelFileId);
    res.json(volumes.map(formatVolume));
  },
);

// POST /organizations/:organizationId/personnel-files/:personnelFileId/volumes
router.post(
  "/organizations/:organizationId/personnel-files/:personnelFileId/volumes",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const file = await requireOwnPersonnelFile(req, res);
    if (file == null) return;
    const personnelFileId = file.id;
    try {
      const volume = await createNextPersonnelFileVolume(db, {
        organizationId: req.membership!.organizationId,
        personnelFileId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(formatVolume(volume));
    } catch (err) {
      if (handleCustodyError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/personnel-files/:personnelFileId/movements
router.get(
  "/organizations/:organizationId/personnel-files/:personnelFileId/movements",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const file = await requireOwnPersonnelFile(req, res);
    if (file == null) return;
    const personnelFileId = file.id;
    const volumeIdRaw = req.query.volumeId;
    const volumeId = typeof volumeIdRaw === "string" && volumeIdRaw.trim() ? parseInt(volumeIdRaw, 10) : undefined;
    const movements = await listMovementHistory(req.membership!.organizationId, personnelFileId, volumeId);
    res.json(movements.map(formatMovement));
  },
);

// POST /organizations/:organizationId/personnel-files/:personnelFileId/checkout
router.post(
  "/organizations/:organizationId/personnel-files/:personnelFileId/checkout",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.movement.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const file = await requireOwnPersonnelFile(req, res);
    if (file == null) return;
    const personnelFileId = file.id;
    const parsed = CheckoutPersonnelFileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const movement = await checkoutPersonnelFile(db, {
        organizationId: req.membership!.organizationId,
        personnelFileId,
        volumeId: parsed.data.volumeId,
        purpose: parsed.data.purpose,
        destination: parsed.data.destination,
        expectedReturnDate: parsed.data.expectedReturnDate ? new Date(parsed.data.expectedReturnDate) : null,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(formatMovement(movement));
    } catch (err) {
      if (handleCustodyError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/personnel-files/:personnelFileId/return
router.post(
  "/organizations/:organizationId/personnel-files/:personnelFileId/return",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.movement.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const file = await requireOwnPersonnelFile(req, res);
    if (file == null) return;
    const personnelFileId = file.id;
    const parsed = ReturnPersonnelFileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const movement = await returnPersonnelFile(db, {
        organizationId: req.membership!.organizationId,
        personnelFileId,
        volumeId: parsed.data.volumeId,
        locationId: parsed.data.locationId,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(formatMovement(movement));
    } catch (err) {
      if (handleCustodyError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/personnel-files/:personnelFileId/mark-missing
router.post(
  "/organizations/:organizationId/personnel-files/:personnelFileId/mark-missing",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.movement.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const file = await requireOwnPersonnelFile(req, res);
    if (file == null) return;
    const personnelFileId = file.id;
    const parsed = MarkPersonnelFileMissingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const movement = await markPersonnelFileMissing(db, {
        organizationId: req.membership!.organizationId,
        personnelFileId,
        volumeId: parsed.data.volumeId,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(formatMovement(movement));
    } catch (err) {
      if (handleCustodyError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/personnel-files/:personnelFileId/recover
router.post(
  "/organizations/:organizationId/personnel-files/:personnelFileId/recover",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.movement.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const file = await requireOwnPersonnelFile(req, res);
    if (file == null) return;
    const personnelFileId = file.id;
    const parsed = RecoverPersonnelFileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const movement = await recoverPersonnelFile(db, {
        organizationId: req.membership!.organizationId,
        personnelFileId,
        volumeId: parsed.data.volumeId,
        locationId: parsed.data.locationId,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(formatMovement(movement));
    } catch (err) {
      if (handleCustodyError(err, res)) return;
      throw err;
    }
  },
);

export default router;
