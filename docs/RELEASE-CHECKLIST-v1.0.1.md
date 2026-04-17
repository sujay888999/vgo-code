# VGO CODE v1.0.1 Release Checklist

## Goal
- Ship a stable patch release on top of `v1.0.0`.
- Ensure first-round de-branding and logo replacement are consistent.
- Guarantee packaging and basic runtime paths are verifiable before publish.

## Auto Gate
- Run `npm run verify:release`.
- Expected result:
  - Brand audit passes.
  - Next-version plan is regenerated.
  - Frontend build succeeds.
  - Local API smoke (`/health`, `/models`, `/auth/login`, `/chat`) passes.
  - Desktop package build succeeds.
  - `dist/win-unpacked/VGO CODE.exe` exists.

## Manual Gate
- Launch `dist/win-unpacked/VGO CODE.exe`.
- Confirm top-left old homepage logo is removed.
- Confirm product title shows `VGO CODE`.
- Confirm model labels show `VGO AI Pro` / `VGO AI Fast`.
- Confirm login default display name is `VGO AI Developer`.
- Confirm session create/switch/reset still works.

## Publish Gate
- Commit message format: `YYYYMMDD注释: ...`.
- Push to GitHub remote.
- Tag release package and retain checksum.

## Rollback
- Keep previous installer from `dist` as fallback.
- If any P0 regression appears, roll back to the last stable commit and re-package.
