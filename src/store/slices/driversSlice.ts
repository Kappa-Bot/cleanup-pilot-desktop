import { StateCreator } from "zustand";

export interface DriversSlice {
  driversUiReady: boolean;
}

export const createDriversSlice: StateCreator<DriversSlice, [], [], DriversSlice> = () => ({
  driversUiReady: true
});
