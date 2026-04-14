jest.mock("../electron/windowsSources/powershell", () => ({
  runPowerShellJson: jest.fn()
}));

import { probeCapabilities } from "../electron/windowsSources/capabilityProbe";

const { runPowerShellJson } = jest.requireMock("../electron/windowsSources/powershell") as {
  runPowerShellJson: jest.Mock;
};

describe("probeCapabilities", () => {
  beforeEach(() => {
    runPowerShellJson.mockReset();
  });

  it("maps detected capabilities instead of forcing GPU support", async () => {
    runPowerShellJson.mockResolvedValue({
      gpuSupported: false,
      perProcessGpuSupported: false,
      perProcessNetworkSupported: false,
      diagnosticsEventLogSupported: true,
      taskDelaySupported: true,
      serviceDelayedAutoStartSupported: true
    });

    await expect(probeCapabilities()).resolves.toEqual({
      gpuSupported: false,
      perProcessGpuSupported: false,
      perProcessNetworkSupported: false,
      diagnosticsEventLogSupported: true,
      taskDelaySupported: true,
      serviceDelayedAutoStartSupported: true
    });
  });

  it("falls back safely when probing returns no data", async () => {
    runPowerShellJson.mockResolvedValue({});

    await expect(probeCapabilities()).resolves.toEqual({
      gpuSupported: false,
      perProcessGpuSupported: false,
      perProcessNetworkSupported: false,
      diagnosticsEventLogSupported: false,
      taskDelaySupported: false,
      serviceDelayedAutoStartSupported: true
    });
  });
});
