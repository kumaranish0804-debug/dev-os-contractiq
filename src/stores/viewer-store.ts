import { create } from 'zustand';

type ViewerState = {
  targetPage: number | null;
  highlightText: string | null;
  /** Increments on every focus() so re-clicking the same page re-scrolls (Spec 08 §8.2). */
  focusNonce: number;
  /** Increments only for user-initiated focus: on mobile it switches to the Document tab. */
  revealNonce: number;
  currentPage: number;
  focus: (page: number, text?: string | null, options?: { reveal?: boolean }) => void;
  setCurrentPage: (page: number) => void;
  reset: () => void;
};

// Cross-panel navigation: page links, citation chips and auto-focus all call focus().
export const useViewerStore = create<ViewerState>()((set) => ({
  targetPage: null,
  highlightText: null,
  focusNonce: 0,
  revealNonce: 0,
  currentPage: 1,
  focus: (page, text = null, options = {}) =>
    set((s) => ({
      targetPage: page,
      highlightText: text,
      focusNonce: s.focusNonce + 1,
      revealNonce: options.reveal === false ? s.revealNonce : s.revealNonce + 1,
    })),
  setCurrentPage: (currentPage) => set({ currentPage }),
  reset: () => set({ targetPage: null, highlightText: null, focusNonce: 0, revealNonce: 0, currentPage: 1 }),
}));
