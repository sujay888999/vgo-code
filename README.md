# VGO CODE

VGO CODE is a professional desktop agent workspace designed for advanced conversational AI workflows, built on Electron with a React + Vite rendering layer.

## Overview

VGO CODE delivers a polished desktop application experience for managing multiple AI sessions, switching between model engines, and integrating remote AI backends. Its architecture is optimized for desktop deployment and includes a local API template service for rapid extension.

## Key Features

- Fully packaged Electron desktop application
- Multi-session chat management
- Multiple engine selection with VGO Remote support
- VGO AI account binding and model selection
- Local API service template in `server/`
- Production-ready desktop installer distribution

## Installation

Download the latest installer from:

- <https://vgoai.cn/downloads/vgo-code/VGO-CODE-Setup-1.3.0.exe>

For registration, deployment, or product updates, visit:

- <https://vgoai.cn>

## Repository Structure

```text
E:\VGO-CODE
├─ build/                # Electron build resources
├─ docs/                 # Project documentation
├─ electron/             # Electron main process and preload logic
│  ├─ main.js
│  ├─ preload.js
│  └─ core/
├─ src/                  # Frontend source code
├─ dist-web/             # Built frontend assets for Electron rendering
├─ server/               # Local API and integration service templates
├─ scripts/              # Utility and release scripts
├─ ui/                   # Legacy static UI fallback assets
├─ vendor/               # Embedded third-party libraries
├─ package.json          # Project metadata and scripts
└─ README.md             # Project overview and instructions
```

## Rendering Strategy

The Electron main process loads `dist-web/index.html` by default. Legacy UI fallback to `ui/index.html` is only allowed during development or when explicitly enabled.

## Recommended Development Commands

Start the application in development mode:

```powershell
npm start
```

Build the frontend assets:

```powershell
npm run build:web
```

Create directory-based Electron package:

```powershell
npm run pack
```

Generate the installer package:

```powershell
npm run dist
```

## Local API Service

Start the API server independently from the repository root:

```powershell
cd E:\VGO-CODE\server
npm start
```

Common endpoints:

- `GET /health`
- `GET /models`
- `POST /auth/register`
- `POST /auth/login`
- `POST /chat`

## Documentation

- `docs/ARCHITECTURE.md`
- `docs/VGO-CORE-ROADMAP.md`

## Support

For guided setup, installer downloads, and release notes, visit:

- <https://vgoai.cn>
