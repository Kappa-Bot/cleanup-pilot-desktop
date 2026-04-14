import { AppDatabase } from "./db";
import { ServiceAnalyzer } from "./serviceAnalyzer";
import { StartupAnalyzer } from "./startupAnalyzer";
import { SystemDiagnostics } from "./systemDiagnostics";
import {
  OptimizationActionSuggestion,
  SystemDoctorDiagnosis,
  SystemDoctorReport,
  SystemSnapshot,
  SystemSnapshotHistoryPoint
} from "./types";
import { TaskSchedulerAnalyzer } from "./taskSchedulerAnalyzer";
import { runSystemDoctorAi, toDoctorHistoryPayload } from "./ai/runtime";

interface SystemDoctorDependencies {
  db: AppDatabase;
  diagnostics: SystemDiagnostics;
  startupAnalyzer?: StartupAnalyzer;
  serviceAnalyzer?: ServiceAnalyzer;
  taskSchedulerAnalyzer?: TaskSchedulerAnalyzer;
}

function uniqueSuggestions(actions: OptimizationActionSuggestion[]): OptimizationActionSuggestion[] {
  const seen = new Set<string>();
  return actions.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function buildHeuristicDiagnoses(
  snapshot: SystemSnapshot,
  safeWins: OptimizationActionSuggestion[]
): SystemDoctorDiagnosis[] {
  const diagnoses: SystemDoctorDiagnosis[] = [];

  if (snapshot.diskIo.activeTimePct >= 80) {
    diagnoses.push({
      id: "disk-io-pressure",
      title: "Disk I/O pressure",
      confidence: 0.84,
      risk: "low",
      summary: "Disk active time is elevated and active writers are visible in the current sample.",
      evidence: snapshot.bottleneck.evidence,
      suggestions: safeWins.filter((item) => item.targetKind === "startup_entry").slice(0, 2)
    });
  }

  if (snapshot.memory.usedPct >= 85) {
    diagnoses.push({
      id: "ram-pressure",
      title: "RAM pressure",
      confidence: 0.78,
      risk: "low",
      summary: "Committed memory is high enough to degrade background responsiveness.",
      evidence: [`RAM used ${snapshot.memory.usedPct.toFixed(1)}%`],
      suggestions: safeWins.filter((item) => item.targetKind === "service").slice(0, 2)
    });
  }

  if (snapshot.drivers.latencyRisk !== "low") {
    diagnoses.push({
      id: "driver-latency",
      title: "Driver overhead",
      confidence: snapshot.drivers.latencyRisk === "high" ? 0.82 : 0.66,
      risk: "medium",
      summary: "Driver latency indicators and virtualization signals suggest kernel overhead.",
      evidence: [
        `Latency risk ${snapshot.drivers.latencyRisk}`,
        ...snapshot.drivers.suspectedDrivers.flatMap((item) => item.reason)
      ].slice(0, 4),
      suggestions: []
    });
  }

  if (!diagnoses.length) {
    diagnoses.push({
      id: "balanced-system",
      title: "No dominant bottleneck",
      confidence: 0.55,
      risk: "low",
      summary: "No subsystem crossed the current threshold strongly enough to identify a dominant bottleneck.",
      evidence: snapshot.bottleneck.evidence,
      suggestions: safeWins.slice(0, 3)
    });
  }

  return diagnoses;
}

export class SystemDoctor {
  private readonly db: AppDatabase;
  private readonly diagnostics: SystemDiagnostics;
  private readonly startupAnalyzer: StartupAnalyzer;
  private readonly serviceAnalyzer: ServiceAnalyzer;
  private readonly taskSchedulerAnalyzer: TaskSchedulerAnalyzer;

  constructor(dependencies: SystemDoctorDependencies) {
    this.db = dependencies.db;
    this.diagnostics = dependencies.diagnostics;
    this.startupAnalyzer = dependencies.startupAnalyzer ?? new StartupAnalyzer();
    this.serviceAnalyzer = dependencies.serviceAnalyzer ?? new ServiceAnalyzer();
    this.taskSchedulerAnalyzer = dependencies.taskSchedulerAnalyzer ?? new TaskSchedulerAnalyzer();
  }

  async diagnose(args?: {
    snapshotId?: string;
    includeHistory?: boolean;
  }): Promise<{ report: SystemDoctorReport; snapshot: SystemSnapshot }> {
    const snapshot =
      (args?.snapshotId ? this.db.getSystemSnapshot(args.snapshotId) : null) ??
      (await this.diagnostics.captureSnapshot({ source: "manual" }));

    this.db.addSystemSnapshot(snapshot);
    const history = args?.includeHistory ? this.db.listSystemSnapshotHistory({ limit: 20 }) : [];
    const [startup, services, tasks] = await Promise.all([
      this.startupAnalyzer.scan(snapshot.cpu.topProcesses),
      this.serviceAnalyzer.scan(),
      this.taskSchedulerAnalyzer.scan()
    ]);
    const safeWins = uniqueSuggestions(
      [...startup.suggestedActions, ...services.suggestedActions, ...tasks.suggestedActions]
        .filter((item) => !item.blocked && item.risk !== "high")
        .sort((left, right) => right.estimatedBenefitScore - left.estimatedBenefitScore)
        .slice(0, 8)
    );

    const heuristicReport: SystemDoctorReport = {
      generatedAt: Date.now(),
      provider: "heuristic",
      primaryBottleneck: snapshot.bottleneck.primary,
      overallHealthScore: Math.max(0, 100 - Math.round(snapshot.cpu.avgUsagePct * 0.2 + snapshot.memory.usedPct * 0.25 + snapshot.diskIo.activeTimePct * 0.3)),
      diagnoses: buildHeuristicDiagnoses(snapshot, safeWins),
      safeWins
    };

    try {
      const aiReport = await runSystemDoctorAi({
        snapshot: {
          cpu: { avgUsagePct: snapshot.cpu.avgUsagePct },
          memory: { usedPct: snapshot.memory.usedPct },
          diskIo: { activeTimePct: snapshot.diskIo.activeTimePct, topWriters: snapshot.diskIo.topWriters.slice(0, 5) },
          startup: { impactScore: snapshot.startup.impactScore },
          drivers: { latencyRisk: snapshot.drivers.latencyRisk, activeSignals: snapshot.drivers.activeSignals }
        },
        history: toDoctorHistoryPayload(history),
        safeWins
      });

      if (aiReport) {
        return {
          report: {
            ...aiReport,
            provider: "cerebras",
            model: "gpt-oss-120b",
            safeWins: aiReport.safeWins.length ? aiReport.safeWins : safeWins
          },
          snapshot
        };
      }
    } catch {
      // fall back to heuristic report
    }

    return { report: heuristicReport, snapshot };
  }

  listHistory(limit = 50): SystemSnapshotHistoryPoint[] {
    return this.db.listSystemSnapshotHistory({ limit });
  }
}
