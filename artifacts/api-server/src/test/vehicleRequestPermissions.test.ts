/**
 * VR-02A — the permission family and its one template grant.
 *
 * These assertions encode owner decisions that are easy to erode by accident
 * later: the family is exactly four keys, an ordinary employee gets the
 * own-request key and nothing else, and none of the four is ever a substitute
 * for `asset_management.manage`.
 */
import { describe, it, expect } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@workspace/db/seed/roles-permissions-definitions";

const VEHICLE_REQUEST_KEYS = PERMISSIONS.filter((p) => p.key.startsWith("vehicle_request.")).map((p) => p.key);

describe("the vehicle_request permission family", () => {
  it("is exactly these four keys — no more, no fewer", () => {
    expect([...VEHICLE_REQUEST_KEYS].sort()).toEqual([
      "vehicle_request.approve",
      "vehicle_request.read.all",
      "vehicle_request.write.department",
      "vehicle_request.write.own",
    ]);
  });

  it("registers no key for reading your OWN requests", () => {
    // Owning your own data is not an operational grant: ownership is proved
    // server-side from the caller's own membership instead.
    expect(VEHICLE_REQUEST_KEYS).not.toContain("vehicle_request.read.own");
  });

  it("registers no separate key for configuring the approval chain", () => {
    // Stage configuration deliberately reuses asset_management.manage.
    expect(VEHICLE_REQUEST_KEYS.some((k) => /configure|settings|stage/.test(k))).toBe(false);
  });

  it("does not reintroduce the rejected VR-01 administrative keys", () => {
    const all = PERMISSIONS.map((p) => p.key);
    expect(all).not.toContain("vehicle.read");
    expect(all).not.toContain("vehicle.manage");
  });

  it("declares a consistent resource and action for each key", () => {
    for (const permission of PERMISSIONS.filter((p) => p.key.startsWith("vehicle_request."))) {
      expect(permission.resource).toBe("vehicle_request");
      expect(permission.key).toBe(`${permission.resource}.${permission.action}`);
    }
  });
});

describe("role templates", () => {
  it("gives an ordinary employee the own-request key", () => {
    expect(ROLE_PERMISSIONS.employee).toContain("vehicle_request.write.own");
  });

  it("gives an ordinary employee NOTHING departmental, approving or oversight-wide", () => {
    expect(ROLE_PERMISSIONS.employee).not.toContain("vehicle_request.write.department");
    expect(ROLE_PERMISSIONS.employee).not.toContain("vehicle_request.approve");
    expect(ROLE_PERMISSIONS.employee).not.toContain("vehicle_request.read.all");
  });

  it("never grants an employee vehicle administration through this family", () => {
    // The whole point of VR-02A's split: requesting a vehicle must not carry
    // any ability to administer the register.
    expect(ROLE_PERMISSIONS.employee).not.toContain("asset_management.manage");
  });

  it("puts the three non-employee keys in NO tenant template at all", () => {
    // They are granted deliberately, per organization — the Office Inventory
    // precedent. A template grant would silently reach every holder of that
    // role in every organization.
    //
    // super_admin is excluded because it is not a hand-listed template: it is
    // `PERMISSIONS.map(p => p.key)`, the platform blanket map, so every key
    // ever registered appears there by construction.
    for (const [roleName, keys] of Object.entries(ROLE_PERMISSIONS)) {
      if (roleName === "super_admin") continue;
      for (const key of ["vehicle_request.write.department", "vehicle_request.approve", "vehicle_request.read.all"]) {
        expect({ roleName, key, present: (keys as readonly string[]).includes(key) }).toEqual({
          roleName,
          key,
          present: false,
        });
      }
    }
  });
});
