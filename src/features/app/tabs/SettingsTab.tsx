import { useState } from "react";

const SETTINGS_SECTION_PREFS_KEY = "cleanup-pilot.settingsSectionPrefs.v1";

export function SettingsTab(props: any) {
  const {
    settings,
    setSettings,
    scheduler,
    updates,
    dayLabel,
    presetLabel,
    driverStackOptions,
    hiddenDriverStackLabels,
    allowlistImportInputRef,
    protectionProfileImportInputRef,
    protectionDiffImportInputRef,
    protectionProfiles,
    activeProtectionProfile,
    compareProtectionProfile,
    protectionProfileNameInput,
    setProtectionProfileNameInput,
    protectionProfileComparison,
    promoteComparisonDiff,
    selectedPromotionPaths,
    selectedPromotionApps,
    selectedPromotionPathSet,
    selectedPromotionAppSet,
    defaultProtectionProfileName,
    currentSettingsCompareId,
    onSaveSettings,
    onSaveScheduler,
    onCheckUpdates,
    onExportAllowlistProfile,
    onTriggerAllowlistImport,
    onImportAllowlistProfile,
    onSaveCurrentAsProtectionProfile,
    onRenameActiveProtectionProfile,
    onUpdateActiveProtectionProfileFromSettings,
    onApplyActiveProtectionProfileToSettings,
    onPromoteComparisonDiffToCurrent,
    onExportProtectionProfileDiff,
    onExportActiveProtectionProfile,
    onExportAllProtectionProfiles,
    onTriggerProtectionProfileImport,
    onTriggerProtectionDiffImport,
    onImportProtectionProfiles,
    onImportProtectionDiffPatch,
    onDeleteActiveProtectionProfile,
    onSetActiveProtectionProfileId,
    onSetCompareProtectionProfileId,
    onSelectAllPromotionEntries,
    onClearPromotionEntries,
    onTogglePromotionEntry
  } = props;

  const parseLines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const dedupeStrings = (values: string[]) => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return false;
      }
      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  };
  const updateSetting = (patch: Record<string, unknown>) => setSettings((current: any) => ({ ...current, ...patch }));
  const [settingsSection, setSettingsSection] = useState<"all" | "core" | "drivers" | "automation" | "profiles">(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_SECTION_PREFS_KEY);
      if (raw === "all" || raw === "core" || raw === "drivers" || raw === "automation" || raw === "profiles") {
        return raw;
      }
    } catch {
      // Ignore localStorage read errors.
    }
    return "all";
  });

  const setSection = (next: "all" | "core" | "drivers" | "automation" | "profiles") => {
    setSettingsSection(next);
    try {
      window.localStorage.setItem(SETTINGS_SECTION_PREFS_KEY, next);
    } catch {
      // Ignore localStorage write errors.
    }
  };

  return (
    <section className="panel panel-fade tab-surface settings-studio">
      <header className="panel-header tab-header">
        <div>
          <h2>Machine Settings</h2>
          <p className="muted">Tune cleanup safety, driver suppression, scheduling, monitoring, and machine-local protection profiles.</p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={onSaveSettings}>Save Settings</button>
          <button className="btn secondary" onClick={onSaveScheduler}>Save Scheduler</button>
          <button className="btn secondary" onClick={onCheckUpdates}>Check Updates</button>
        </div>
      </header>

      <div className="settings-summary-grid">
        <article className="stat-tile"><small>Protected Paths</small><strong>{settings.neverCleanupPaths.length}</strong><span>{settings.neverCleanupApps.length} protected apps</span></article>
        <article className="stat-tile"><small>Driver Rules</small><strong>{settings.driverIgnoredInfNames.length + settings.driverIgnoredDeviceIds.length}</strong><span>{settings.driverHiddenSuggestionIds.length} hidden stack preferences</span></article>
        <article className="stat-tile"><small>Monitoring</small><strong>{settings.performanceLiveSampleIntervalMs} ms</strong><span>{settings.performancePinnedMonitoring ? "Pinned" : "On-demand"}</span></article>
        <article className="stat-tile"><small>Scheduler</small><strong>{scheduler.enabled ? "Enabled" : "Manual"}</strong><span>{scheduler.enabled ? `${dayLabel[scheduler.dayOfWeek]} ${scheduler.time}` : "No weekly run configured"}</span></article>
      </div>

      <div className="row wrap">
        <button className={settingsSection === "all" ? "pill active" : "pill"} onClick={() => setSection("all")}>All Sections</button>
        <button className={settingsSection === "core" ? "pill active" : "pill"} onClick={() => setSection("core")}>Core + Safety</button>
        <button className={settingsSection === "drivers" ? "pill active" : "pill"} onClick={() => setSection("drivers")}>Drivers</button>
        <button className={settingsSection === "automation" ? "pill active" : "pill"} onClick={() => setSection("automation")}>Automation + Monitor</button>
        <button className={settingsSection === "profiles" ? "pill active" : "pill"} onClick={() => setSection("profiles")}>Protection Profiles</button>
      </div>

      <div className="settings-grid">
        {settingsSection === "all" || settingsSection === "core" ? (
          <article className="card settings-card settings-card--half settings-card--core">
          <small className="section-kicker">Core Defaults</small>
          <h3>Scan Defaults</h3>
          <div className="settings-form-grid">
            <label>
              Default preset
              <select value={settings.defaultPreset} onChange={(event) => updateSetting({ defaultPreset: event.target.value })}>
                {Object.keys(presetLabel).map((preset) => (<option key={preset} value={preset}>{presetLabel[preset]}</option>))}
              </select>
            </label>
            <label>
              Quarantine retention (days)
              <input type="number" min={1} max={365} value={settings.quarantineRetentionDays} onChange={(event) => updateSetting({ quarantineRetentionDays: Math.max(1, Number(event.target.value) || 30) })} />
            </label>
            <label>
              AI provider
              <select value={settings.aiProvider} onChange={(event) => updateSetting({ aiProvider: event.target.value })}>
                <option value="auto">Auto</option>
                <option value="cerebras">Cerebras</option>
                <option value="local">Local</option>
              </select>
            </label>
          </div>
          <details className="settings-advanced-panel">
            <summary>Advanced custom roots ({settings.customRoots.length})</summary>
            <label className="settings-field-span-full">
              Custom roots (one per line)
              <textarea value={settings.customRoots.join("\n")} rows={7} onChange={(event) => updateSetting({ customRoots: parseLines(event.target.value) })} />
            </label>
            <p className="muted">Whole-machine coverage is the default. Only use custom roots if you need to extend or override the detected machine scope.</p>
          </details>
          </article>
        ) : null}

        {settingsSection === "all" || settingsSection === "core" ? (
          <article className="card settings-card settings-card--half settings-card--allowlist">
          <small className="section-kicker">Protection Layer</small>
          <h3>Never-Cleanup Allowlist</h3>
          <div className="settings-button-strip">
            <button className="btn secondary" onClick={onExportAllowlistProfile}>Export Profile</button>
            <button className="btn secondary" onClick={() => onTriggerAllowlistImport("merge")}>Import Merge</button>
            <button className="btn secondary" onClick={() => onTriggerAllowlistImport("replace")}>Replace From File</button>
          </div>
          <input ref={allowlistImportInputRef} type="file" accept=".json,application/json" aria-label="Allowlist import file" style={{ display: "none" }} onChange={onImportAllowlistProfile} />
          <div className="settings-form-grid">
            <label className="settings-field-span-full">
              Protected paths (one per line)
              <textarea value={settings.neverCleanupPaths.join("\n")} rows={7} onChange={(event) => updateSetting({ neverCleanupPaths: parseLines(event.target.value) })} placeholder={"C:\\Users\\edfpo\\AppData\\Roaming\\Blackmagic Design"} />
            </label>
            <label className="settings-field-span-full">
              Protected installed app names (one per line)
              <textarea value={settings.neverCleanupApps.join("\n")} rows={5} onChange={(event) => updateSetting({ neverCleanupApps: parseLines(event.target.value) })} placeholder={"DaVinci Resolve\nAdobe Premiere Pro"} />
            </label>
          </div>
          <p className="muted">These entries are blocked in scan and cleanup. Matching paths move to Safety instead of Cleanup Plan.</p>
          <p className="muted">{settings.neverCleanupPaths.length} protected paths, {settings.neverCleanupApps.length} protected apps.</p>
          </article>
        ) : null}

        {settingsSection === "all" || settingsSection === "drivers" ? (
          <article className="card settings-card settings-card--third">
          <small className="section-kicker">Driver Review</small>
          <h3>Driver Suppression</h3>
          <label className="checkbox"><input type="checkbox" checked={settings.driverAutoSuppressSafeSuggestions} onChange={(event) => updateSetting({ driverAutoSuppressSafeSuggestions: event.target.checked })} />Auto-apply high-confidence suppression suggestions on the first driver scan for this machine</label>
          <div className="settings-button-strip">
            <button className="btn secondary" onClick={() => updateSetting({ driverAutoSuppressionApplied: false })}>Re-arm First Auto-Apply</button>
          </div>
          <div className="settings-toggle-grid">
            {driverStackOptions.filter((item: any) => item.id !== "system-infrastructure").map((item: any) => {
              const checked = settings.driverHiddenSuggestionIds.includes(item.id);
              return (
                <label key={item.id} className="checkbox">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => updateSetting({
                      driverHiddenSuggestionIds: event.target.checked
                        ? dedupeStrings([...settings.driverHiddenSuggestionIds, item.id])
                        : settings.driverHiddenSuggestionIds.filter((value: string) => value !== item.id)
                    })}
                  />
                  Hide {item.label} stack forever
                </label>
              );
            })}
          </div>
          <label>
            Ignored INF names (one per line)
            <textarea value={settings.driverIgnoredInfNames.join("\n")} rows={4} onChange={(event) => updateSetting({ driverIgnoredInfNames: parseLines(event.target.value) })} placeholder={"oem43.inf\noem113.inf"} />
          </label>
          <label>
            Ignored device IDs (one per line)
            <textarea value={settings.driverIgnoredDeviceIds.join("\n")} rows={5} onChange={(event) => updateSetting({ driverIgnoredDeviceIds: parseLines(event.target.value) })} placeholder={"PCI\\VEN_8086&DEV_..."} />
          </label>
          <p className="muted">Hidden stacks: {settings.driverHiddenSuggestionIds.length}{hiddenDriverStackLabels.length ? ` (${hiddenDriverStackLabels.join(", ")})` : ""}</p>
          </article>
        ) : null}

        {settingsSection === "all" || settingsSection === "automation" ? (
          <article className="card settings-card settings-card--third">
          <small className="section-kicker">Automation</small>
          <h3>Scheduler</h3>
          <label className="checkbox"><input type="checkbox" checked={settings.scheduleEnabled} onChange={(event) => updateSetting({ scheduleEnabled: event.target.checked })} />Enable weekly schedule</label>
          <div className="settings-form-grid">
            <label>
              Day of week
              <select value={settings.scheduleDayOfWeek} onChange={(event) => updateSetting({ scheduleDayOfWeek: Number(event.target.value) })}>
                {dayLabel.map((label: string, index: number) => (<option key={label} value={index}>{label}</option>))}
              </select>
            </label>
            <label>
              Time
              <input value={settings.scheduleTime} onChange={(event) => updateSetting({ scheduleTime: event.target.value })} />
            </label>
          </div>
          </article>
        ) : null}

        {settingsSection === "all" || settingsSection === "automation" ? (
          <article className="card settings-card settings-card--third">
            <small className="section-kicker">Performance Policy</small>
            <h3>Performance Monitoring</h3>
            <label className="checkbox"><input type="checkbox" checked={settings.performanceAutoSnapshotOnLaunch} onChange={(event) => updateSetting({ performanceAutoSnapshotOnLaunch: event.target.checked })} />Auto snapshot on launch</label>
            <label className="checkbox"><input type="checkbox" checked={settings.performanceAutoSnapshotOnCleanup} onChange={(event) => updateSetting({ performanceAutoSnapshotOnCleanup: event.target.checked })} />Auto snapshot around cleanup</label>
            <label className="checkbox"><input type="checkbox" checked={settings.performanceAutoSnapshotOnOptimization} onChange={(event) => updateSetting({ performanceAutoSnapshotOnOptimization: event.target.checked })} />Auto snapshot around optimizations</label>
            <div className="settings-form-grid">
              <label>
                Snapshot retention (days)
                <input type="number" min={1} max={365} value={settings.performanceSnapshotRetentionDays} onChange={(event) => updateSetting({ performanceSnapshotRetentionDays: Number(event.target.value) || 30 })} />
              </label>
              <label>
                Live sample interval (ms)
                <input type="number" min={500} max={60000} step={250} value={settings.performanceLiveSampleIntervalMs} onChange={(event) => updateSetting({ performanceLiveSampleIntervalMs: Number(event.target.value) || 2000 })} />
              </label>
            </div>
            <label className="checkbox"><input type="checkbox" checked={settings.performancePinnedMonitoring} onChange={(event) => updateSetting({ performancePinnedMonitoring: event.target.checked })} />Keep monitor running when leaving Performance tab</label>
          </article>
        ) : null}

        {settingsSection === "all" || settingsSection === "core" ? (
          <article className="card settings-card settings-card--third">
            <small className="section-kicker">Interface + Modules</small>
            <h3>App Behavior</h3>
            <label className="checkbox"><input type="checkbox" checked={settings.reducedMotion} onChange={(event) => updateSetting({ reducedMotion: event.target.checked })} />Reduced motion</label>
            <label className="checkbox"><input type="checkbox" checked={settings.highContrast} onChange={(event) => updateSetting({ highContrast: event.target.checked })} />High contrast</label>
            <label className="checkbox"><input type="checkbox" checked={settings.compactUi} onChange={(event) => updateSetting({ compactUi: event.target.checked })} />Compact UI density</label>
            <label className="checkbox"><input type="checkbox" checked={settings.includeInstalledApps} onChange={(event) => updateSetting({ includeInstalledApps: event.target.checked })} />Include installed apps in storage scan</label>
            <label className="checkbox"><input type="checkbox" checked={settings.driverToolsEnabled} onChange={(event) => updateSetting({ driverToolsEnabled: event.target.checked })} />Enable driver tools (v1.1)</label>
            <details className="settings-advanced-panel">
              <summary>Advanced update settings</summary>
              <label>
                Update feed URL
                <input value={settings.updatesFeedUrl} onChange={(event) => updateSetting({ updatesFeedUrl: event.target.value })} />
              </label>
            </details>
            {updates && <p className="muted">Current {updates.currentVersion} - Latest {updates.latestVersion} - {updates.hasUpdate ? "Update available" : "Up to date"}</p>}
          </article>
        ) : null}

        {settingsSection === "all" || settingsSection === "profiles" ? (
          <article className="card settings-card settings-card--wide settings-card--profiles">
          <small className="section-kicker">Profile Control</small>
          <h3>Protection Profiles</h3>
          <div className="settings-action-groups">
            <div className="settings-action-group">
              <span className="settings-action-group-label">Profile lifecycle</span>
              <div className="settings-button-strip">
                <button className="btn secondary" onClick={onSaveCurrentAsProtectionProfile}>Save Current As New</button>
                <button className="btn secondary" onClick={onRenameActiveProtectionProfile} disabled={!activeProtectionProfile}>Rename Profile</button>
                <button className="btn secondary" onClick={onUpdateActiveProtectionProfileFromSettings} disabled={!activeProtectionProfile}>Update Active From Current</button>
                <button className="btn secondary" onClick={onDeleteActiveProtectionProfile} disabled={!activeProtectionProfile}>Delete Profile</button>
              </div>
            </div>
            <div className="settings-action-group">
              <span className="settings-action-group-label">Apply and promote</span>
              <div className="settings-button-strip">
                <button className="btn secondary" onClick={() => onApplyActiveProtectionProfileToSettings("replace")} disabled={!activeProtectionProfile}>Replace With Active</button>
                <button className="btn secondary" onClick={() => onApplyActiveProtectionProfileToSettings("merge")} disabled={!activeProtectionProfile}>Merge Active Into Current</button>
                <button className="btn secondary" onClick={() => onPromoteComparisonDiffToCurrent("all")} disabled={!promoteComparisonDiff || (!promoteComparisonDiff.pathsToPromote.length && !promoteComparisonDiff.appsToPromote.length)}>{promoteComparisonDiff?.actionLabel ?? "Promote Diff To Current"}</button>
                <button className="btn secondary" onClick={() => onPromoteComparisonDiffToCurrent("paths")} disabled={!promoteComparisonDiff || !promoteComparisonDiff.pathsToPromote.length}>{promoteComparisonDiff?.pathsActionLabel ?? "Promote Paths To Current"}</button>
                <button className="btn secondary" onClick={() => onPromoteComparisonDiffToCurrent("apps")} disabled={!promoteComparisonDiff || !promoteComparisonDiff.appsToPromote.length}>{promoteComparisonDiff?.appsActionLabel ?? "Promote Apps To Current"}</button>
              </div>
            </div>
            <div className="settings-action-group">
              <span className="settings-action-group-label">Import and export</span>
              <div className="settings-button-strip">
                <button className="btn secondary" onClick={() => onExportProtectionProfileDiff("json")} disabled={!protectionProfileComparison}>Export Diff JSON</button>
                <button className="btn secondary" onClick={() => onExportProtectionProfileDiff("csv")} disabled={!protectionProfileComparison}>Export Diff CSV</button>
                <button className="btn secondary" onClick={onExportActiveProtectionProfile} disabled={!activeProtectionProfile}>Export Active Profile</button>
                <button className="btn secondary" onClick={onExportAllProtectionProfiles} disabled={!protectionProfiles.length}>Export All Profiles</button>
                <button className="btn secondary" onClick={onTriggerProtectionProfileImport}>Import Profiles</button>
                <button className="btn secondary" onClick={onTriggerProtectionDiffImport}>Import Diff Patch</button>
              </div>
            </div>
          </div>
          <input ref={protectionProfileImportInputRef} type="file" accept=".json,application/json" aria-label="Protection profiles import file" style={{ display: "none" }} onChange={onImportProtectionProfiles} />
          <input ref={protectionDiffImportInputRef} type="file" accept=".json,application/json" aria-label="Protection diff import file" style={{ display: "none" }} onChange={onImportProtectionDiffPatch} />
          <div className="settings-form-grid settings-form-grid--profiles">
            <label>
              Active profile
              <select aria-label="Active protection profile" value={activeProtectionProfile?.id ?? ""} onChange={(event) => onSetActiveProtectionProfileId(event.target.value)} disabled={!protectionProfiles.length}>
                {!protectionProfiles.length && <option value="">No saved profiles</option>}
                {protectionProfiles.map((profile: any) => (<option key={profile.id} value={profile.id}>{profile.name}</option>))}
              </select>
            </label>
            <label>
              Profile name
              <input value={protectionProfileNameInput} onChange={(event) => setProtectionProfileNameInput(event.target.value)} placeholder={defaultProtectionProfileName} />
            </label>
            <label>
              Compare against
              <select aria-label="Compare protection profile" value={compareProtectionProfile?.id ?? ""} onChange={(event) => onSetCompareProtectionProfileId(event.target.value)} disabled={!activeProtectionProfile}>
                {!activeProtectionProfile && <option value="">Need an active profile</option>}
                {activeProtectionProfile && <option value={currentSettingsCompareId}>Current Settings</option>}
                {protectionProfiles.filter((profile: any) => profile.id !== activeProtectionProfile?.id).map((profile: any) => (<option key={profile.id} value={profile.id}>{profile.name}</option>))}
              </select>
            </label>
          </div>
          <p className="muted">{activeProtectionProfile ? `"${activeProtectionProfile.name}" protects ${activeProtectionProfile.neverCleanupPaths.length} paths and ${activeProtectionProfile.neverCleanupApps.length} apps.` : "Save the current allowlist as a named profile for this machine, work setup, or gaming setup."}</p>
          <p className="muted">{protectionProfiles.length} saved protection profile{protectionProfiles.length === 1 ? "" : "s"}</p>
          {promoteComparisonDiff && (<><p className="muted">Promote source: {promoteComparisonDiff.sourceName} - {selectedPromotionPaths.length}/{promoteComparisonDiff.pathsToPromote.length} paths selected - {selectedPromotionApps.length}/{promoteComparisonDiff.appsToPromote.length} apps selected</p><div className="settings-button-strip"><button className="btn secondary" onClick={onSelectAllPromotionEntries}>Select All Diff</button><button className="btn secondary" onClick={onClearPromotionEntries}>Clear Diff Selection</button></div></>)}
          {protectionProfileComparison && activeProtectionProfile && compareProtectionProfile && (
            <details className="settings-advanced-panel" open={Boolean(promoteComparisonDiff)}>
              <summary>
                Profile comparison details ({protectionProfileComparison.activeOnlyPaths.length + protectionProfileComparison.compareOnlyPaths.length + protectionProfileComparison.sharedPaths.length} path groups)
              </summary>
              <div className="profile-compare-grid">
                <article className="card import-review-card">
                  <h4>Only In {activeProtectionProfile.name}</h4>
                  <p className="muted">{protectionProfileComparison.activeOnlyPaths.length} paths - {protectionProfileComparison.activeOnlyApps.length} apps</p>
                  {protectionProfileComparison.activeOnlyPaths.length ? (compareProtectionProfile.id === currentSettingsCompareId ? <ul className="import-diff-list is-selectable">{protectionProfileComparison.activeOnlyPaths.map((item: string) => (<li key={`active-only-path-${item}`}><label className="diff-entry-toggle"><input type="checkbox" checked={selectedPromotionPathSet.has(item.toLowerCase())} onChange={() => onTogglePromotionEntry("path", item)} /><span>{item}</span></label></li>))}</ul> : <ul className="import-diff-list">{protectionProfileComparison.activeOnlyPaths.map((item: string) => (<li key={`active-only-path-${item}`}>{item}</li>))}</ul>) : <p className="muted">No unique protected paths.</p>}
                  {protectionProfileComparison.activeOnlyApps.length ? (compareProtectionProfile.id === currentSettingsCompareId ? <ul className="import-diff-list is-selectable">{protectionProfileComparison.activeOnlyApps.map((item: string) => (<li key={`active-only-app-${item}`}><label className="diff-entry-toggle"><input type="checkbox" checked={selectedPromotionAppSet.has(item.toLowerCase())} onChange={() => onTogglePromotionEntry("app", item)} /><span>{item}</span></label></li>))}</ul> : <ul className="import-diff-list">{protectionProfileComparison.activeOnlyApps.map((item: string) => (<li key={`active-only-app-${item}`}>{item}</li>))}</ul>) : <p className="muted">No unique protected apps.</p>}
                </article>
                <article className="card import-review-card">
                  <h4>Only In {compareProtectionProfile.name}</h4>
                  <p className="muted">{protectionProfileComparison.compareOnlyPaths.length} paths - {protectionProfileComparison.compareOnlyApps.length} apps</p>
                  {protectionProfileComparison.compareOnlyPaths.length ? (compareProtectionProfile.id !== currentSettingsCompareId ? <ul className="import-diff-list is-danger is-selectable">{protectionProfileComparison.compareOnlyPaths.map((item: string) => (<li key={`compare-only-path-${item}`}><label className="diff-entry-toggle"><input type="checkbox" checked={selectedPromotionPathSet.has(item.toLowerCase())} onChange={() => onTogglePromotionEntry("path", item)} /><span>{item}</span></label></li>))}</ul> : <ul className="import-diff-list is-danger">{protectionProfileComparison.compareOnlyPaths.map((item: string) => (<li key={`compare-only-path-${item}`}>{item}</li>))}</ul>) : <p className="muted">No unique protected paths.</p>}
                  {protectionProfileComparison.compareOnlyApps.length ? (compareProtectionProfile.id !== currentSettingsCompareId ? <ul className="import-diff-list is-danger is-selectable">{protectionProfileComparison.compareOnlyApps.map((item: string) => (<li key={`compare-only-app-${item}`}><label className="diff-entry-toggle"><input type="checkbox" checked={selectedPromotionAppSet.has(item.toLowerCase())} onChange={() => onTogglePromotionEntry("app", item)} /><span>{item}</span></label></li>))}</ul> : <ul className="import-diff-list is-danger">{protectionProfileComparison.compareOnlyApps.map((item: string) => (<li key={`compare-only-app-${item}`}>{item}</li>))}</ul>) : <p className="muted">No unique protected apps.</p>}
                </article>
                <article className="card import-review-card profile-shared-card">
                  <h4>Shared Coverage</h4>
                  <p className="muted">{protectionProfileComparison.sharedPaths.length} shared paths - {protectionProfileComparison.sharedApps.length} shared apps</p>
                  {protectionProfileComparison.sharedPaths.length ? <ul className="import-diff-list">{protectionProfileComparison.sharedPaths.map((item: string) => (<li key={`shared-path-${item}`}>{item}</li>))}</ul> : <p className="muted">No shared protected paths.</p>}
                  {protectionProfileComparison.sharedApps.length ? <ul className="import-diff-list">{protectionProfileComparison.sharedApps.map((item: string) => (<li key={`shared-app-${item}`}>{item}</li>))}</ul> : <p className="muted">No shared protected apps.</p>}
                </article>
              </div>
            </details>
          )}
          </article>
        ) : null}
      </div>
    </section>
  );
}
