# Product Redesign Brief

This file is meant to help ChatGPT or human reviewers evaluate the product honestly and propose a stronger redesign.

## Current product thesis

Cleanup Pilot Desktop should compete on:

- trust
- reversibility
- clarity of action
- machine-level diagnostics depth

It should not try to win by showing more raw telemetry than everyone else.

## Current strengths

- quarantine-first cleanup
- reversible optimization actions
- installed-app-aware protections
- structured diagnostics and performance analysis
- driver guidance and AI-assisted review
- a strong local-first posture

## Current weaknesses

- still not enough curated app coverage to beat mature cleaners on breadth
- Smart Check is present as a direction, but not yet the fully dominant product flow
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
- stronger `Smart Check` hero experience
- clearer before/after summaries
- stronger ranking of cross-domain issues

### Cleaner
- more category-first grouping
- more container-level reasoning
- better explanation of safe wins vs review items
- stronger duplicate integration

### Optimize
- stronger issue-first summary
- clearer startup/service/task action ranking
- charts only when they change a decision

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
