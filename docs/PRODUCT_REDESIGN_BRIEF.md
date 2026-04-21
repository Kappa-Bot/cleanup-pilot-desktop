# Product Redesign Brief

This file is meant to help ChatGPT or human reviewers evaluate the product honestly and propose a stronger redesign.

## Current product thesis

Cleanup Pilot Desktop should compete on:

- trust
- reversibility
- clarity of action
- machine-level diagnostics depth

It should not try to win by showing more raw telemetry than everyone else.

## Status correction

The current UX is still **transitional**.

That matters because the repo now has a calmer shell and stronger product language, but the interaction model still feels too close to the old tool-first architecture. A serious redesign should not treat the current UI as “basically done”.

Future redesign work should assume:

- the current UX is a stepping stone
- full flow redesign is allowed
- page composition can be rebuilt from zero
- preserving current chrome/layout is **not** a goal by itself

## Current strengths

- quarantine-first cleanup
- reversible optimization actions
- installed-app-aware protections
- structured diagnostics and performance analysis
- driver guidance and AI-assisted review
- a strong local-first posture

## Current weaknesses

- still not enough curated app coverage to beat mature cleaners on breadth
- Smart Check is present and significantly stronger, but still not the only product loop a new user will discover
- some parts of the UI still reflect older tool-first architecture underneath
- before/after reporting can be stronger
- trust messaging can still be sharper and more consistent

## What a strong redesign should optimize for

A strong redesign should:

1. reduce noise on first load
2. surface one recommended action clearly
3. make safety evidence easy to understand
4. keep detail secondary
5. avoid forcing users into large tables early
6. keep advanced power accessible for review and debugging

## Product question to keep asking

For any screen:

- What is the next safe action?
- Why should the user trust it?
- What data can be hidden until explicitly requested?

## Areas that deserve aggressive improvement

### Home
- keep `Smart Check` as the dominant hero
- continue strengthening before/after summaries
- continue improving ranking of cross-domain issues and health trend readability

### Cleaner
- more category-first grouping
- more container-level reasoning
- better explanation of safe wins vs review items
- stronger duplicate integration

### Optimize
- stronger issue-first summary
- clearer startup/service/task action ranking
- charts only when they change a decision

### Release / trust
- keep a single Windows packaging path
- preserve Electron hardening
- keep AI contextual and structured instead of chat-first

### Vault
- tighter narrative around reversibility and recovery
- clearer purge safety and retention framing

## Objective benchmark vs CCleaner

The repo should be evaluated honestly.

Today it is stronger in:
- trust and reversibility
- diagnostics depth
- local-first behavior

Today it is still weaker in:
- breadth of curated support
- polished maintenance automation
- software updater breadth
- fully productized mass-market simplicity

## Good redesign outputs

A strong redesign proposal usually includes:

- new information architecture
- what to hide from first view
- what to elevate to first view
- trust language and evidence strategy
- performance implications of the new flows
- migration steps from the current shell/tab layering

## What a real redesign should be willing to delete

- duplicated summaries that say the same thing twice
- legacy deep links promoted too early
- first-load tables
- telemetry blocks that do not change a decision
- routebar clutter
- “workspace” concepts that exist only because of historical implementation
- AI surfaces that behave like separate tools instead of guidance layers

## What a real redesign should feel like

- premium Windows desktop software
- quiet, decisive, trustworthy
- visually strong without becoming noisy
- more intentional, more minimal, more industrial
- clearly stronger than a cosmetic refresh
