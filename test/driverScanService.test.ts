import {
  buildDriverScanResult,
  buildDriverScanResultWithPreferences,
  parseDriverDate
} from "../electron/driverScanService";

describe("DriverScanService helpers", () => {
  it("parses PowerShell JSON date payloads", () => {
    const timestamp = parseDriverDate("/Date(1150848000000)/");
    expect(timestamp).toBe(1150848000000);
  });

  it("filters noisy inbox devices and keeps meaningful outdated hardware candidates", () => {
    const result = buildDriverScanResult([
      {
        DeviceName: "WAN Miniport (IP)",
        DriverProviderName: "Microsoft",
        Manufacturer: "Microsoft",
        DriverVersion: "10.0.26100.1",
        DriverDate: "/Date(1150848000000)/",
        InfName: "netrasa.inf",
        DeviceClass: "NET",
        DeviceID: "SWD\\MSRRAS\\MS_NDISWANIP"
      },
      {
        DeviceName: "NVIDIA GeForce RTX 4080",
        DriverProviderName: "Microsoft",
        Manufacturer: "NVIDIA",
        DriverVersion: "31.0.15.0000",
        DriverDate: "/Date(1672531200000)/",
        InfName: "oem42.inf",
        DeviceClass: "DISPLAY",
        DeviceID: "PCI\\VEN_10DE&DEV_2704"
      }
    ]);

    expect(result.devices).toHaveLength(2);
    expect(result.ignoredDeviceCount).toBe(1);
    expect(result.meaningfulDeviceCount).toBe(1);
    expect(result.updateCandidates).toHaveLength(1);
    expect(result.updateCandidates[0]).toMatchObject({
      deviceName: "NVIDIA GeForce RTX 4080",
      deviceClass: "DISPLAY",
      recommendation: "oem_portal"
    });
  });

  it("suppresses driver candidates by INF and device id preferences", () => {
    const result = buildDriverScanResultWithPreferences(
      [
        {
          DeviceName: "Realtek PCIe 2.5GbE Family Controller",
          DriverProviderName: "Realtek",
          Manufacturer: "Realtek",
          DriverVersion: "10.46.1231.2020",
          DriverDate: "/Date(1609372800000)/",
          InfName: "oem113.inf",
          DeviceClass: "NET",
          DeviceID: "PCI\\VEN_10EC&DEV_8125"
        },
        {
          DeviceName: "Intel(R) Ethernet Connection (7) I219-V",
          DriverProviderName: "Intel",
          Manufacturer: "Intel",
          DriverVersion: "12.19.2.45",
          DriverDate: "/Date(1643500800000)/",
          InfName: "oem111.inf",
          DeviceClass: "NET",
          DeviceID: "PCI\\VEN_8086&DEV_15FA"
        }
      ],
      {
        ignoredInfNames: ["oem113.inf"],
        ignoredDeviceIds: ["pci\\ven_8086&dev_15fa"],
        hiddenSuggestionIds: []
      }
    );

    expect(result.meaningfulDeviceCount).toBe(2);
    expect(result.suppressedCount).toBe(2);
    expect(result.updateCandidates).toHaveLength(0);
  });

  it("builds high-confidence suppression suggestions for noisy infrastructure drivers", () => {
    const result = buildDriverScanResult([
      {
        DeviceName: "AMD Special Tools Driver",
        DriverProviderName: "Advanced Micro Devices",
        Manufacturer: "Advanced Micro Devices",
        DriverVersion: "1.7.16.218",
        DriverDate: "/Date(1590537600000)/",
        InfName: "oem22.inf",
        DeviceClass: "SYSTEM",
        DeviceID: "ROOT\\SYSTEM\\0002"
      },
      {
        DeviceName: "Intel(R) Thermal Subsystem - 06F9",
        DriverProviderName: "Intel",
        Manufacturer: "INTEL",
        DriverVersion: "10.1.31.2",
        DriverDate: "/Date(1475452800000)/",
        InfName: "oem72.inf",
        DeviceClass: "SYSTEM",
        DeviceID: "PCI\\VEN_8086&DEV_06F9"
      },
      {
        DeviceName: "Intel(R) Host Bridge/DRAM Registers - 9B33",
        DriverProviderName: "Intel",
        Manufacturer: "INTEL",
        DriverVersion: "10.1.30.4",
        DriverDate: "/Date(1475452800000)/",
        InfName: "oem106.inf",
        DeviceClass: "SYSTEM",
        DeviceID: "PCI\\VEN_8086&DEV_9B33"
      }
    ]);

    expect(result.updateCandidates).toHaveLength(3);
    expect(result.suppressionSuggestions).toHaveLength(1);
    expect(result.suppressionSuggestions[0]).toMatchObject({
      id: "system-infrastructure",
      group: "infrastructure",
      autoEligible: true,
      confidence: "high",
      matchCount: 3,
      infNames: []
    });
    expect(result.suppressionSuggestions[0].deviceIds).toEqual(
      expect.arrayContaining([
        "ROOT\\SYSTEM\\0002",
        "PCI\\VEN_8086&DEV_06F9",
        "PCI\\VEN_8086&DEV_9B33"
      ])
    );
  });

  it("builds stack-specific virtualization suppression suggestions", () => {
    const result = buildDriverScanResult([
      {
        DeviceName: "VMware Virtual Ethernet Adapter for VMnet8",
        DriverProviderName: "VMware, Inc.",
        Manufacturer: "VMware, Inc.",
        DriverVersion: "14.0.0.5",
        DriverDate: "/Date(1615248000000)/",
        InfName: "oem23.inf",
        DeviceClass: "NET",
        DeviceID: "ROOT\\VMWARE\\0001"
      },
      {
        DeviceName: "VMware VMCI Host Device",
        DriverProviderName: "VMware, Inc.",
        Manufacturer: "VMware, Inc.",
        DriverVersion: "9.8.16.0",
        DriverDate: "/Date(1562803200000)/",
        InfName: "oem71.inf",
        DeviceClass: "SYSTEM",
        DeviceID: "ROOT\\VMWVMCIHOSTDEV\\0000"
      },
      {
        DeviceName: "Microsoft Hyper-V Virtual Machine Bus Provider",
        DriverProviderName: "Microsoft",
        Manufacturer: "Microsoft",
        DriverVersion: "10.0.26100.7920",
        DriverDate: "/Date(1150848000000)/",
        InfName: "wvmbusr.inf",
        DeviceClass: "SYSTEM",
        DeviceID: "ROOT\\VMBUS\\0000"
      },
      {
        DeviceName: "Camo",
        DriverProviderName: "Reincubate",
        Manufacturer: "Reincubate",
        DriverVersion: "13.33.25.877",
        DriverDate: "/Date(1669248000000)/",
        InfName: "oem50.inf",
        DeviceClass: "CAMERA",
        DeviceID: "ROOT\\CAMERA\\0000"
      }
    ]);

    expect(result.suppressionSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "virtualization-vmware",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium"
        }),
        expect.objectContaining({
          id: "virtualization-camo",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium"
        })
      ])
    );
  });

  it("hides candidates by persistent hidden stack preference without using INF or device rules", () => {
    const result = buildDriverScanResultWithPreferences(
      [
        {
          DeviceName: "VMware Virtual Ethernet Adapter for VMnet8",
          DriverProviderName: "VMware, Inc.",
          Manufacturer: "VMware, Inc.",
          DriverVersion: "14.0.0.5",
          DriverDate: "/Date(1615248000000)/",
          InfName: "oem23.inf",
          DeviceClass: "NET",
          DeviceID: "ROOT\\VMWARE\\0001"
        },
        {
          DeviceName: "VMware VMCI Host Device",
          DriverProviderName: "VMware, Inc.",
          Manufacturer: "VMware, Inc.",
          DriverVersion: "9.8.16.0",
          DriverDate: "/Date(1562803200000)/",
          InfName: "oem71.inf",
          DeviceClass: "SYSTEM",
          DeviceID: "ROOT\\VMWVMCIHOSTDEV\\0000"
        }
      ],
      {
        ignoredInfNames: [],
        ignoredDeviceIds: [],
        hiddenSuggestionIds: ["virtualization-vmware"]
      }
    );

    expect(result.updateCandidates).toHaveLength(0);
    expect(result.stackSuppressedCount).toBe(2);
    expect(result.suppressionSuggestions).toHaveLength(0);
  });

  it("marks virtualization suggestions active when runtime signals are detected", () => {
    const result = buildDriverScanResultWithPreferences(
      [
        {
          DeviceName: "VMware Virtual Ethernet Adapter for VMnet8",
          DriverProviderName: "VMware, Inc.",
          Manufacturer: "VMware, Inc.",
          DriverVersion: "14.0.0.5",
          DriverDate: "/Date(1615248000000)/",
          InfName: "oem23.inf",
          DeviceClass: "NET",
          DeviceID: "ROOT\\VMWARE\\0001"
        }
      ],
      {
        ignoredInfNames: [],
        ignoredDeviceIds: [],
        hiddenSuggestionIds: []
      },
      {
        installedApps: [{ name: "VMware Workstation Player", installLocation: "C:\\Program Files (x86)\\VMware\\VMware Player" }],
        processes: [],
        services: [{ name: "VMware NAT Service", displayName: "VMware NAT Service", state: "Running", pathName: "C:\\WINDOWS\\SysWOW64\\vmnat.exe" }],
        features: []
      }
    );

    expect(result.suppressionSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "virtualization-vmware",
          activityState: "active",
          activitySignals: [],
          activitySignalEvidence: [],
          recommendedToHide: false
        })
      ])
    );
  });

  it("keeps Hyper-V suggestions in review when optional platform signals are installed", () => {
    const result = buildDriverScanResultWithPreferences(
      [
        {
          DeviceName: "Microsoft Hyper-V Virtual Machine Bus Provider",
          DriverProviderName: "Microsoft",
          Manufacturer: "Microsoft",
          DriverVersion: "10.0.26100.7920",
          DriverDate: "/Date(1150848000000)/",
          InfName: "wvmbusr.inf",
          DeviceClass: "SYSTEM",
          DeviceID: "ROOT\\VMBUS\\0000"
        }
      ],
      {
        ignoredInfNames: [],
        ignoredDeviceIds: [],
        hiddenSuggestionIds: []
      },
      {
        installedApps: [],
        processes: [],
        services: [],
        features: [
          {
            id: "hyperv",
            enabled: true,
            evidence: "registry: Windows virtualization platform"
          },
          {
            id: "wsl",
            enabled: true,
            evidence: "registry: 2 WSL distros"
          }
        ]
      }
    );

    expect(result.suppressionSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "virtualization-hyperv",
          activityState: "installed",
          activitySignals: ["hyperv", "wsl"],
          activitySignalEvidence: expect.arrayContaining([
            expect.objectContaining({ id: "hyperv" }),
            expect.objectContaining({ id: "wsl" })
          ]),
          recommendedToHide: false
        })
      ])
    );
    expect(result.suppressionSuggestions.find((item) => item.id === "virtualization-hyperv")?.activitySummary).toContain(
      "feature:"
    );
  });
});
