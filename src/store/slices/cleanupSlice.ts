import { StateCreator } from "zustand";

export interface CleanupSlice {
  cleanupUiReady: boolean;
}

export const createCleanupSlice: StateCreator<CleanupSlice, [], [], CleanupSlice> = () => ({
  cleanupUiReady: true
});
