# Security Policy

## Supported scope

This project is a local Windows desktop app. Security-sensitive areas include:

- cleanup execution
- quarantine/restore/purge flows
- protection policy
- installed-app detection
- Windows startup/service/task optimization actions
- driver guidance
- AI provider integration
- credential/env handling

## Reporting a vulnerability

If you find a vulnerability, do not open a public issue with exploit details.

Use a private channel to contact the maintainer first. Include:

- affected file/module
- impact
- reproduction steps
- whether data loss, privilege escalation, or unsafe cleanup is involved

## Design expectations

Security regressions are treated seriously. Changes must preserve:

- quarantine-first cleanup
- preview-first destructive flows
- protected root and binary blocking
- installed-app-aware protections
- reversible optimization changes
- no hardcoded secrets in the repository

## Electron hardening

The desktop shell is expected to keep the renderer constrained:

- `contextIsolation` stays enabled.
- `nodeIntegration` stays disabled.
- `sandbox` stays enabled.
- `BrowserWindow` navigation and new-window creation stay blocked unless explicitly reviewed.
- The preload bridge stays minimal, frozen, and wrapper-based for compatibility.

## Release hygiene

Windows releases are built through GitHub Actions and published to GitHub Releases with `electron-builder`.

Operational requirements:

- release artifacts must be produced from tagged commits only
- installer publishing tokens live in CI secrets, not in the repository
- update metadata must come from the same release channel that the app uses at runtime
- any fallback update feed must be treated as legacy and non-default
