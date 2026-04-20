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
