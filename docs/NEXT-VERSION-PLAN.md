# VGO CODE Next Version Plan

Generated: 2026-04-19T18:35:33.081Z
Current Version: 1.0.10
Target Version: 1.1.0

## Release Objective
- Productize desktop agent experience for external users.
- Remove legacy/old-brand traces and unify VGO naming.
- Improve feature completeness and release confidence.

## Milestones
1. Brand cleanup
- Audit and replace legacy naming in UI, docs, and metadata.
- Standardize app title/icon/update channel naming.
2. Product hardening
- Add first-run onboarding and health-check guidance.
- Add error boundaries and actionable failure messages.
3. Feature completion
- Session management polish and data persistence checks.
- Engine adapter fallback and timeout controls.
4. Release quality
- Expand smoke tests and packaging verification.
- Build release checklist for go/no-go decisions.

## Definition of Done
- No P0/P1 known issues in release checklist.
- Brand audit report has zero critical legacy terms.
- `npm run verify:release` passes on CI/local.
- Installer package generated and launch smoke test passed.
