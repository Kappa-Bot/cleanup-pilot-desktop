# UX Reset Brief

This document exists to remove ambiguity for future redesign work.

## Non-negotiable message

The current UX is **not** the final product UX.

It is more product-shaped than before, but it still feels too close to a tool suite with calmer chrome layered on top. That is not enough.

If a future ChatGPT or contributor is asked to redesign the app, the correct interpretation is:

- redesign the UX from zero when needed
- challenge the current shell and flows
- do not preserve the current layout out of inertia
- optimize for product quality, not just for continuity

## Design target

The app should feel like:

- premium Windows desktop software
- industrial and trustworthy
- visually strong, elegant, and calm
- decisive instead of chatty
- minimal without becoming generic

It should not feel like:

- an internal tool
- a developer dashboard
- a pile of tabs
- “the same app but prettier”

## Product-level design principles

- one dominant action per screen
- low noise / high signal
- progressive disclosure
- trust and reversibility always visible
- power secondary, not first-load
- fewer controls, better grouped
- visible cause/effect for every important action

## What should be reconsidered from scratch

### Shell
- header weight
- routebar structure
- deep-link exposure
- command palette positioning and scope
- section summaries vs repeated chrome

### Home
- hero structure
- Smart Check prominence
- issue ranking presentation
- score/trend visualization
- before/after storytelling

### Cleaner
- how scan, review, AI, blocked items, and duplicates are sequenced
- whether the current master-detail pattern is the right final pattern
- how bulk actions, filters, and evidence are surfaced

### Optimize
- whether live performance should be a first interaction or a secondary drill-down
- how startup optimization should dominate the page
- how services/tasks/drivers become contextual, not parallel noise

### Vault
- how restore, purge, history, and settings are sequenced
- whether settings belong as a page or a side utility

## What should be aggressively removed

- duplicated summaries
- telemetry blocks that do not change a decision
- giant first-load tables
- routebar clutter
- badges that do not carry risk/action meaning
- cards that repeat the same KPI in different wording
- AI panels that behave like a separate app

## What “serious and industrial” means here

- spacing is disciplined
- hierarchy is obvious
- copy is short and deliberate
- confirmation flows feel safe and expensive in the right way
- loading, error, empty, and success states feel designed, not incidental
- the UI looks intentional on desktop, not web-app-like by accident

## What “llamativo” should mean

Not louder.

It should mean:

- stronger visual identity
- clearer shape language
- more confident composition
- more premium motion and presentation
- more memorable surfaces

It should **not** mean:

- more badges
- more gradients for their own sake
- more charts
- more widgets
- more decorative noise

## Required mindset for future redesign sessions

Before implementing a major redesign, future sessions should answer:

1. What should disappear completely?
2. What should move behind explicit intent?
3. What is the one action this page exists to drive?
4. What evidence must remain visible for trust?
5. What is still too “tool-first”?

## Acceptance bar

A successful redesign should make a reviewer say:

- this feels like a real product, not a collection of tools
- I know what to do next without scanning the whole page
- I trust the app more because it explains less, but explains the right things
- the app feels more expensive, more deliberate, and more modern

If the result still feels like the current app with better styling, the redesign failed.
