/**
 * WS-26B — signature slot context.
 *
 * Lets the form renderer stay unchanged: SignatureSlot reads this context and,
 * when a submission provides it, renders a live SignatureField; with no
 * provider (e.g. a blank template preview) it falls back to the WS-26A
 * placeholder. The submission page supplies the per-slot policy, applied
 * signature and signing authority.
 */
import { createContext } from "react";
import type { FormSignatureView } from "@workspace/api-client-react";
import type { SignatureMethod } from "./signature-providers";

export interface SignatureSlotContextValue {
  organizationId: number;
  submissionId: number;
  /** Methods the slot's policy permits (defaults handled by the caller). */
  allowedMethods: (slotKey: string) => SignatureMethod[];
  /** The active applied signature for the slot, if any. */
  applied: (slotKey: string) => FormSignatureView | null;
  /** Whether THIS viewer may sign THIS slot right now (server still enforces). */
  canSign: (slotKey: string) => boolean;
  onChanged?: () => void;
}

export const SignatureSlotContext = createContext<SignatureSlotContextValue | null>(null);
export const SignatureSlotProvider = SignatureSlotContext.Provider;
