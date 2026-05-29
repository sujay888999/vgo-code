# VGO CODE Architecture

## Desktop Runtime

VGO CODE is now a single Electron desktop application with one renderer path:

- `src/`: React + Vite + TypeScript source.
- `dist-web/`: built renderer bundle loaded by Electron.
- `electron/`: main process, preload bridge, and desktop agent runtime.
- `server/`: local API template used by the desktop app.
- `vendor/`: bundled runtime dependencies required by the agent.

## Renderer Loading

`electron/main.js` loads only `dist-web/index.html`.

The old static `ui/` fallback has been removed. If `dist-web/index.html` is missing, the app shows a build error page instead of falling back to another UI version.

## Release Flow

1. Edit UI source under `src/`.
2. Run `npm run build:web` to refresh `dist-web/`.
3. Run `npm run pack` or `npm run dist` for Electron packaging.

New UI work should only target `src/`; do not reintroduce a second renderer tree.
