# ChatGPT Analysis Guide

This repo is intentionally prepared for deep ChatGPT review. Use this guide if you want ChatGPT to critique, redesign, or implement changes with good context.

## Recommended prompt shape

A strong prompt usually includes:

- the product goal
- the exact area to improve
- the quality bar
- the files or docs to read first
- whether code changes are expected immediately

## Recommended files to read first

1. `README.md`
2. `CHATGPT_CONTEXT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PRODUCT_REDESIGN_BRIEF.md`
5. `docs/UX_RESET_BRIEF.md`
6. `electron/types.ts`
7. `src/types.ts`
8. `electron/ipc.ts`
9. the specific feature or engine files involved

## Good requests for ChatGPT

### Product redesign
Ask for:
- information architecture critique
- what should and should not be first-load UI
- how to make the app objectively stronger than CCleaner in trust and clarity
- whether the current UX should be partially preserved or rebuilt from zero
- what should be deleted, not just improved

### Cleanup safety
Ask for:
- false positive review
- protection rule hardening
- install-root and app-awareness improvements
- preview and quarantine UX review

### Performance and diagnostics
Ask for:
- profiler overhead analysis
- chart rendering review
- monitor architecture review
- startup/service/task prioritization logic

### AI
Ask for:
- structured output improvements
- trust explanation improvements
- token reduction strategies
- fallback heuristics review

## What ChatGPT should not do carelessly

- weaken quarantine-first cleanup
- bypass preview requirements
- relax protected root or binary protections without explicit justification
- send raw logs to AI providers
- assume old many-tab IA is the desired future direction

## Best implementation behavior

The strongest ChatGPT sessions usually:

- propose product-level rationale first
- map changes to concrete files
- keep contracts aligned across renderer and electron
- run `typecheck`, `test`, and `build`
- update docs when architecture changes

## Important warning for future redesign sessions

Do not treat the current UX as a finished redesign baseline.

If asked for a “real” redesign, the correct default is:

- challenge the current layout aggressively
- remove noise instead of relocating it
- prefer new flows over preserving historical tab structure
- optimize for product feel, not just functional completeness

## If asking ChatGPT to redesign brutally

Say explicitly:
- that it may challenge the current UI and IA
- that it should remove noise, not preserve it by default
- that it should optimize for trust, speed, and product clarity
- that it should be objective about where the app still trails CCleaner
