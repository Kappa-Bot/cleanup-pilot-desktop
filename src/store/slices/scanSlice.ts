import { StateCreator } from "zustand";

export interface ScanSlice {
  scanUiReady: boolean;
}

export const createScanSlice: StateCreator<ScanSlice, [], [], ScanSlice> = () => ({
  scanUiReady: true
});
