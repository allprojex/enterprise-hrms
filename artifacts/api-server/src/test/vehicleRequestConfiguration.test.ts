/**
 * VR-02A — the Vehicle Request organization configuration namespace.
 *
 * The namespace exists so VR-02B has somewhere to read its reference format
 * from. It is asserted here rather than there because the decisions it encodes
 * are the kind that erode silently: the module gate, and the sequence length.
 *
 * The sequence length is not incidental. `formatGeneratedNumber` pads to
 * `config.sequenceLength ?? 4`, so a namespace that merely omits the field
 * produces VR-0001. The locked reference format is VR-00001, which only holds
 * because this default states 5 explicitly.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { MODULE_DEFINITIONS } from "@workspace/db/seed/module-definitions";

type NamespaceRegistry = Awaited<typeof import("../services/organizationConfig")>["CONFIG_NAMESPACES"];
let CONFIG_NAMESPACES: NamespaceRegistry;

// Imported once, with room for the first-load cost of the service's module
// graph — the default 5s timeout is not generous enough under a full parallel run.
beforeAll(async () => {
  ({ CONFIG_NAMESPACES } = await import("../services/organizationConfig"));
}, 60_000);

describe("the vehicle_requests configuration namespace", () => {
  it("is registered", () => {
    expect(CONFIG_NAMESPACES.vehicle_requests).toBeDefined();
    expect(CONFIG_NAMESPACES.vehicle_requests.schemaVersion).toBe(1);
  });

  it("is gated behind the EXISTING asset_management module, exactly", () => {
    expect(CONFIG_NAMESPACES.vehicle_requests.moduleKey).toBe("asset_management");
  });

  it("introduces no module of its own", () => {
    // VR-02 rides on Assets. A `vehicle`/`vehicle_management` module was
    // considered and rejected during VR-01; nothing here may reintroduce it.
    const keys = MODULE_DEFINITIONS.map((m) => m.key);
    expect(keys).toContain("asset_management");
    expect(keys.filter((k) => k.includes("vehicle"))).toEqual([]);
  });

  it("defaults to the locked VR-00001 reference format", () => {
    const defaults = CONFIG_NAMESPACES.vehicle_requests.defaults();
    expect(defaults).toEqual({
      requestNumber: {
        prefix: "VR",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
    });
  });

  it("states sequenceLength explicitly, because the engine's own fallback is 4", () => {
    const { requestNumber } = CONFIG_NAMESPACES.vehicle_requests.defaults() as {
      requestNumber: { prefix: string; separator: string; sequenceLength: number };
    };
    // The assertion that actually matters: the rendered shape, not the field.
    const rendered = `${requestNumber.prefix}${requestNumber.separator}${String(1).padStart(requestNumber.sequenceLength, "0")}`;
    expect(rendered).toBe("VR-00001");
  });

  it("accepts an organization's own override of the format", () => {
    const parsed = CONFIG_NAMESPACES.vehicle_requests.schema.safeParse({
      requestNumber: { prefix: "WWM/VR", separator: "/", sequenceLength: 3, startingSequence: 10, resetPolicy: "yearly" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed format rather than storing it", () => {
    expect(CONFIG_NAMESPACES.vehicle_requests.schema.safeParse({ requestNumber: { sequenceLength: 0 } }).success).toBe(false);
    expect(CONFIG_NAMESPACES.vehicle_requests.schema.safeParse({ requestNumber: { resetPolicy: "hourly" } }).success).toBe(false);
    expect(CONFIG_NAMESPACES.vehicle_requests.schema.safeParse({ requestNumber: { sequenceLength: 99 } }).success).toBe(false);
  });

  it("carries only the request-number format — no VR-02B+ settings have crept in", () => {
    expect(Object.keys(CONFIG_NAMESPACES.vehicle_requests.defaults())).toEqual(["requestNumber"]);
  });
});
