import { create } from 'zustand';
import { LIMITS } from '@shared/limits';
import { isStandardTermName, termNameKey } from '@shared/term-library';
import type { ErrorCode } from '@/lib/utils/errors';
import { customTermSchema } from '@/lib/validation/contract';

export type ContractType = 'NDA' | 'MSA';

export type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; progress: number } // 0–100, bytes sent
  | { kind: 'extracting' } // bytes sent, awaiting the server
  | { kind: 'uploaded'; contractId: string; pageCount: number; fileStored: boolean }
  | { kind: 'error'; code: ErrorCode };

export type ProcessingState =
  | { kind: 'idle' }
  | { kind: 'running'; step: 2 | 3 }
  | { kind: 'error'; code: ErrorCode };

export type AddTermResult = { ok: true } | { ok: false; reason: string };

type ReviewSessionState = {
  contractType: ContractType | null;
  file: File | null;
  upload: UploadState;
  customTerms: string[];
  processing: ProcessingState;
  setContractType: (type: ContractType) => void;
  setFile: (file: File | null) => void;
  setUpload: (upload: UploadState) => void;
  setProcessing: (processing: ProcessingState) => void;
  /** Clears the file and upload but keeps the chosen type (Spec 05 §5.3 "Remove"). */
  clearFile: () => void;
  addCustomTerm: (name: string) => AddTermResult;
  removeCustomTerm: (name: string) => void;
  reset: () => void;
};

const initial = {
  contractType: null,
  file: null,
  upload: { kind: 'idle' },
  customTerms: [],
  processing: { kind: 'idle' },
} as const satisfies Partial<ReviewSessionState>;

// In-memory wizard state for /contracts/new (Spec 05 §5.4). Never persisted.
export const useReviewSessionStore = create<ReviewSessionState>()((set, get) => ({
  ...initial,
  customTerms: [],
  setContractType: (contractType) => set({ contractType }),
  setFile: (file) => set({ file }),
  setUpload: (upload) => set({ upload }),
  setProcessing: (processing) => set({ processing }),
  clearFile: () => set({ file: null, upload: { kind: 'idle' }, processing: { kind: 'idle' } }),

  // Spec 06 §6.3 validation.
  addCustomTerm: (name) => {
    const parsed = customTermSchema.safeParse(name);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]!.message };

    const { customTerms, contractType } = get();
    if (customTerms.length >= LIMITS.maxCustomTerms) {
      return { ok: false, reason: 'Maximum 5 custom terms' };
    }
    const key = termNameKey(parsed.data);
    const duplicate =
      customTerms.some((t) => termNameKey(t) === key) ||
      (contractType !== null && isStandardTermName(contractType, parsed.data));
    if (duplicate) return { ok: false, reason: 'That term is already in the list' };

    set({ customTerms: [...customTerms, parsed.data] });
    return { ok: true };
  },
  removeCustomTerm: (name) =>
    set((state) => ({ customTerms: state.customTerms.filter((t) => t !== name) })),

  reset: () => set({ ...initial, customTerms: [] }),
}));
