# Cleanup Pilot Desktop - Wave 1 UX/Product Audit

## Baseline

Cleanup Pilot Desktop already has the right product thesis for a Windows maintenance app: quarantine-first cleanup, reversible optimization, local-first behavior, and trust-oriented evidence. The current shell also confirms the intended four-area model:

- Home
- Cleaner
- Optimize
- Vault

Wave 1 baseline, however, is still mixed. The product has strong technical depth but the current information architecture still exposes legacy tool-first behavior, and several high-value flows are not yet presented as a single decisive next action.

## What Is Working

- Home already centers on machine health, reclaimable space, and a recommended issue.
- Cleanup and optimization both retain reversible semantics.
- Trust and protection are visible in the product language.
- The app already distinguishes summary, review, and execution states.
- The core data model supports a stronger Smart Check story than the current UI fully surfaces.

## Wave 1 Problem List

Ranked from highest product risk to lowest.

| Rank | Problem | Why it matters | Wave 1 recommendation |
| --- | --- | --- | --- |
| 1 | Home is not yet a true Smart Check cockpit | The first screen still feels like a summary dashboard instead of the place where the app decisively tells the user what to do next. | Make Smart Check the dominant first action and let everything else defer to the ranked issue. |
| 2 | The legacy tool-first taxonomy still leaks through the shell | Navigation still exposes internal terminology and subviews that make the product feel larger and more technical than the user needs. | Collapse the UI around the four product areas and only reveal tools as drill-downs. |
| 3 | Cleanup lacks a single guided safe flow | Users can still feel they are entering a workspace of many tabs rather than one controlled cleanup decision. | Introduce a safe auto-clean wizard with preview, protection checks, and clear commit gating. |
| 4 | Optimize does not yet lead with one dominant bottleneck | Performance, startup, services, tasks, and drivers are all valid, but the screen must tell one coherent story first. | Make the main bottleneck the hero and demote secondary diagnostics until requested. |
| 5 | Safe confirmation states are under-designed | Risky actions need a stronger review layer so users can see what will happen before they commit. | Add a dedicated confirmation modal with scope, reversibility, and blocked-item evidence. |
| 6 | Before/after reporting is too weak for trust building | Cleanup and optimization should close the loop with visible results, not just a completed action. | Create an outcome report that compares before, action, and after in one narrative. |
| 7 | Vault is functional but not yet a recovery narrative | Quarantine and reversible history should feel like a recovery ledger, not a settings bucket. | Reframe Vault around restore, purge, retention, and provenance. |
| 8 | Evidence density is too high on first pass | Long lists of paths, findings, and diagnostics can overwhelm users before they trust the recommendation. | Summarize evidence into small, explainable chips with a deeper drill-down only on demand. |
| 9 | AI guidance is present but not clearly bounded | AI should feel like a guided assistant that supports local evidence, not a separate product layer. | Keep AI inside Smart Check and cleanup review as contextual suggestions only. |
| 10 | Duplicate review needs stronger decision framing | Duplicate cleanup is high value but can become risky if the app does not make confidence and impact easy to compare. | Add duplicate confidence, size, and safety labels to every decision row. |
| 11 | Startup optimization needs clearer causality | Startup items are only useful if the user understands why they matter and what reversibility exists. | Show startup impact, origin, and rollback path before exposing the action. |
| 12 | Settings and protection management are too advanced for default exposure | Allowlist and protection profile tools are necessary, but they should not compete with the primary maintenance loop. | Hide advanced settings behind a deliberate advanced mode and keep them out of the main hero flow. |
| 13 | Visual hierarchy is too similar across areas | If every page looks equally important, then nothing feels prioritized. | Create stronger visual contrast between summary, review, and execution surfaces. |
| 14 | Multi-step operations need clearer progress semantics | Long-running cleanup and purge tasks need a more reassuring live state than a generic overlay. | Use a dedicated progress layout with stage, progress, counts, and explicit completion criteria. |
| 15 | The post-action state does not yet feel like a product moment | A maintenance app needs a satisfying close: what changed, what was saved, and what remains. | Make success states more explicit and link them to the next safe action. |

## Wave 1 Conclusion

The product is technically credible and already stronger than many cleaners on reversibility and diagnostics depth. The main UX gap is not functionality; it is sequencing. The app needs to reduce visible complexity, move Smart Check to the front, and make each risky action pass through a clearer trust and confirmation story.

