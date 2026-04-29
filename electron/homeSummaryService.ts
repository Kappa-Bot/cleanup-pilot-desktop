import { HomeSummarySnapshot } from "./types";
import { SmartCheckService } from "./smartCheckService";

export class HomeSummaryService {
  constructor(private readonly smartCheckService: SmartCheckService) {}

  async getSnapshot(): Promise<HomeSummarySnapshot> {
    return this.smartCheckService.getLightweightHomeSnapshot();
  }
}
