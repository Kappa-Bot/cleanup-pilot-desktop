# Cleanup Pilot Desktop - Wireframes

These are Markdown-first wireframes with inline SVG layouts. They describe the intended product structure for the Wave 1 redesign, not the current implementation.

## 1. Home

Intent: make Smart Check the first action and show one ranked issue, not a wall of metrics.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760" width="100%" height="auto" role="img" aria-label="Home wireframe">
  <rect x="20" y="20" width="1160" height="720" rx="24" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="40" y="40" width="240" height="680" rx="18" fill="#20324a" stroke="#20324a"/>
  <rect x="300" y="40" width="860" height="120" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="300" y="180" width="560" height="250" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="880" y="180" width="280" height="250" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="300" y="450" width="860" height="250" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <text x="60" y="78" fill="#e8f1fb" font-family="Arial" font-size="22">Brand + status</text>
  <text x="60" y="120" fill="#b6c7d8" font-family="Arial" font-size="16">Home</text>
  <text x="330" y="86" fill="#102233" font-family="Arial" font-size="28">PC health, recommended issue, Smart Check</text>
  <text x="330" y="125" fill="#587088" font-family="Arial" font-size="16">One decisive next action plus a compact evidence strip</text>
  <text x="330" y="218" fill="#102233" font-family="Arial" font-size="22">Primary hero</text>
  <text x="330" y="252" fill="#587088" font-family="Arial" font-size="16">Health score, reclaimable bytes, safety state</text>
  <text x="330" y="290" fill="#587088" font-family="Arial" font-size="16">Run Smart Check button</text>
  <text x="910" y="218" fill="#102233" font-family="Arial" font-size="22">Why this is safe</text>
  <text x="910" y="252" fill="#587088" font-family="Arial" font-size="16">Evidence chips and a deeper inspector</text>
  <text x="330" y="488" fill="#102233" font-family="Arial" font-size="22">Top issues / before-after strip</text>
  <text x="330" y="522" fill="#587088" font-family="Arial" font-size="16">Ranked issue cards and compact results history</text>
</svg>
```

## 2. Smart Check

Intent: turn a scan into a ranked, explainable recommendation flow.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760" width="100%" height="auto" role="img" aria-label="Smart Check wireframe">
  <rect x="20" y="20" width="1160" height="720" rx="24" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="40" y="40" width="1120" height="86" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="146" width="380" height="554" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="440" y="146" width="720" height="554" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <text x="66" y="94" fill="#102233" font-family="Arial" font-size="26">Smart Check in progress / ready</text>
  <text x="66" y="176" fill="#102233" font-family="Arial" font-size="22">Ranked issues</text>
  <text x="66" y="212" fill="#587088" font-family="Arial" font-size="16">Each issue shows confidence, reversibility, and impact</text>
  <text x="470" y="176" fill="#102233" font-family="Arial" font-size="22">Inspector</text>
  <text x="470" y="212" fill="#587088" font-family="Arial" font-size="16">Why this issue matters, what is safe, what is blocked</text>
  <text x="470" y="255" fill="#587088" font-family="Arial" font-size="16">Primary action</text>
  <text x="470" y="292" fill="#587088" font-family="Arial" font-size="16">Secondary action</text>
  <text x="470" y="328" fill="#587088" font-family="Arial" font-size="16">Evidence chips</text>
  <text x="470" y="364" fill="#587088" font-family="Arial" font-size="16">Coverage + trust notes</text>
</svg>
```

## 3. Cleaner

Intent: present cleanup as one guided workspace with scan, review, duplicates, and evidence.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 780" width="100%" height="auto" role="img" aria-label="Cleaner wireframe">
  <rect x="20" y="20" width="1160" height="740" rx="24" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="40" y="40" width="1120" height="90" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="150" width="1120" height="74" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="244" width="720" height="496" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="780" y="244" width="380" height="496" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <text x="66" y="96" fill="#102233" font-family="Arial" font-size="26">Cleaner workspace</text>
  <text x="66" y="178" fill="#587088" font-family="Arial" font-size="16">Tabs become task steps: Smart Check, Review Plan, Explore Disk, Duplicates, AI Guidance, Blocked Items</text>
  <text x="66" y="290" fill="#102233" font-family="Arial" font-size="22">Grouped review plan</text>
  <text x="66" y="326" fill="#587088" font-family="Arial" font-size="16">Category tiles, safe wins, review items, blocked items</text>
  <text x="808" y="290" fill="#102233" font-family="Arial" font-size="22">Action rail</text>
  <text x="808" y="326" fill="#587088" font-family="Arial" font-size="16">Preview, confirm, or drill into evidence</text>
</svg>
```

## 4. Optimize

Intent: make the dominant bottleneck obvious and keep startup, services, tasks, and drivers as drill-downs.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760" width="100%" height="auto" role="img" aria-label="Optimize wireframe">
  <rect x="20" y="20" width="1160" height="720" rx="24" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="40" y="40" width="1120" height="110" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="170" width="1120" height="120" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="310" width="560" height="430" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="620" y="310" width="540" height="430" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <text x="66" y="88" fill="#102233" font-family="Arial" font-size="26">Optimize</text>
  <text x="66" y="124" fill="#587088" font-family="Arial" font-size="16">Main bottleneck hero with startup impact and driver risk summary</text>
  <text x="66" y="210" fill="#102233" font-family="Arial" font-size="22">Dominant bottleneck</text>
  <text x="66" y="246" fill="#587088" font-family="Arial" font-size="16">One issue, one recommendation, one reversible action path</text>
  <text x="66" y="348" fill="#102233" font-family="Arial" font-size="22">Startup optimizer</text>
  <text x="66" y="384" fill="#587088" font-family="Arial" font-size="16">Impact, origin, delay, disable, and rollback</text>
  <text x="646" y="348" fill="#102233" font-family="Arial" font-size="22">Other diagnostics</text>
  <text x="646" y="384" fill="#587088" font-family="Arial" font-size="16">Services, tasks, processes, and drivers only when needed</text>
</svg>
```

## 5. Vault

Intent: frame recovery, restore, and purge as a ledger of reversible change.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760" width="100%" height="auto" role="img" aria-label="Vault wireframe">
  <rect x="20" y="20" width="1160" height="720" rx="24" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="40" y="40" width="1120" height="110" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="170" width="340" height="540" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="400" y="170" width="760" height="250" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="400" y="440" width="760" height="270" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <text x="66" y="88" fill="#102233" font-family="Arial" font-size="26">Vault</text>
  <text x="66" y="124" fill="#587088" font-family="Arial" font-size="16">Recovery ledger, retention, purge safety, and system settings</text>
  <text x="66" y="208" fill="#102233" font-family="Arial" font-size="22">Quarantine list</text>
  <text x="66" y="244" fill="#587088" font-family="Arial" font-size="16">Active items, restore, purge, retention filter</text>
  <text x="430" y="208" fill="#102233" font-family="Arial" font-size="22">Recovery summary</text>
  <text x="430" y="244" fill="#587088" font-family="Arial" font-size="16">Active count, total records, retention policy, last action</text>
  <text x="430" y="478" fill="#102233" font-family="Arial" font-size="22">Advanced settings</text>
  <text x="430" y="514" fill="#587088" font-family="Arial" font-size="16">Protection profiles, allowlists, exports, imports, and audit history</text>
</svg>
```

## 6. Safe Confirmation Modal

Intent: make every risky action explicit about scope, reversibility, and blocked items.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" width="100%" height="auto" role="img" aria-label="Safe confirmation modal wireframe">
  <rect x="20" y="20" width="1160" height="680" rx="24" fill="#eef3f8" stroke="#b9c7d6"/>
  <rect x="250" y="110" width="700" height="500" rx="24" fill="#ffffff" stroke="#8ea3b7"/>
  <rect x="280" y="150" width="640" height="74" rx="16" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="280" y="244" width="640" height="116" rx="16" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="280" y="380" width="308" height="84" rx="16" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="612" y="380" width="308" height="84" rx="16" fill="#f7fafc" stroke="#b9c7d6"/>
  <text x="310" y="196" fill="#102233" font-family="Arial" font-size="24">Confirm safe action</text>
  <text x="310" y="285" fill="#587088" font-family="Arial" font-size="16">Scope, item count, bytes, and what stays protected</text>
  <text x="310" y="414" fill="#102233" font-family="Arial" font-size="18">Reversible</text>
  <text x="642" y="414" fill="#102233" font-family="Arial" font-size="18">Blocked items</text>
</svg>
```

## 7. Startup Optimizer

Intent: show startup impact as a ranked action list with rollback context.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" width="100%" height="auto" role="img" aria-label="Startup optimizer wireframe">
  <rect x="20" y="20" width="1160" height="680" rx="24" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="40" y="40" width="1120" height="110" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="170" width="1120" height="70" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="260" width="760" height="400" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="820" y="260" width="340" height="400" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <text x="66" y="88" fill="#102233" font-family="Arial" font-size="26">Startup optimizer</text>
  <text x="66" y="124" fill="#587088" font-family="Arial" font-size="16">Ranked startup items with impact, vendor, and reversible action</text>
  <text x="66" y="214" fill="#587088" font-family="Arial" font-size="16">Filter: safe to disable / needs review / not recommended</text>
  <text x="66" y="302" fill="#102233" font-family="Arial" font-size="22">Ranked startup list</text>
  <text x="66" y="338" fill="#587088" font-family="Arial" font-size="16">Name, origin, boot impact, confidence, action</text>
  <text x="850" y="302" fill="#102233" font-family="Arial" font-size="22">Inspector</text>
  <text x="850" y="338" fill="#587088" font-family="Arial" font-size="16">Why it matters, what changes, how to undo it</text>
</svg>
```

## 8. Safe Auto-Clean Wizard

Intent: keep cleanup inside a controlled preview -> confirm -> execute sequence.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760" width="100%" height="auto" role="img" aria-label="Safe auto-clean wizard wireframe">
  <rect x="20" y="20" width="1160" height="720" rx="24" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="260" y="70" width="680" height="72" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="260" y="162" width="680" height="110" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="260" y="292" width="680" height="110" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="260" y="422" width="680" height="110" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="260" y="552" width="680" height="100" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <text x="290" y="116" fill="#102233" font-family="Arial" font-size="24">Step 1: scan and group</text>
  <text x="290" y="208" fill="#102233" font-family="Arial" font-size="24">Step 2: review safety and protection</text>
  <text x="290" y="338" fill="#102233" font-family="Arial" font-size="24">Step 3: preview what will move</text>
  <text x="290" y="468" fill="#102233" font-family="Arial" font-size="24">Step 4: confirm and execute</text>
  <text x="290" y="610" fill="#102233" font-family="Arial" font-size="24">Step 5: show result report</text>
</svg>
```

## 9. Before / After Report

Intent: close the loop with a result story, not just a finished task.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760" width="100%" height="auto" role="img" aria-label="Before after report wireframe">
  <rect x="20" y="20" width="1160" height="720" rx="24" fill="#f7fafc" stroke="#b9c7d6"/>
  <rect x="40" y="40" width="1120" height="90" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="150" width="540" height="500" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="620" y="150" width="540" height="500" rx="18" fill="#ffffff" stroke="#b9c7d6"/>
  <rect x="40" y="670" width="1120" height="50" rx="12" fill="#ffffff" stroke="#b9c7d6"/>
  <text x="66" y="94" fill="#102233" font-family="Arial" font-size="26">Before / after report</text>
  <text x="66" y="190" fill="#102233" font-family="Arial" font-size="22">Before</text>
  <text x="66" y="226" fill="#587088" font-family="Arial" font-size="16">Health score, space, bottleneck, blocked items</text>
  <text x="646" y="190" fill="#102233" font-family="Arial" font-size="22">After</text>
  <text x="646" y="226" fill="#587088" font-family="Arial" font-size="16">Recovered bytes, resolved items, remaining work</text>
  <text x="66" y="688" fill="#587088" font-family="Arial" font-size="16">Next safe action: open cleaner, optimize, or vault depending on what remains</text>
</svg>
```

