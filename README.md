# VGO AI

VGO AI is a full-stack conversational AI workspace built with:

- Next.js 14
- NestJS 10
- PostgreSQL
- Redis
- Nginx
- Docker Compose

It currently includes:

- product-grade chat workspace
- account center and billing
- admin operations workspace
- payment entry points
- policy and pricing pages

## Project structure

```text
api-platform/
  backend/
  frontend/
  nginx/
  docs/
  scripts/
  docker-compose.yml
```

## Core product areas

- `/chat`: main conversational workspace
- `/dashboard`: account center with API keys and billing visibility
- `/recharge`: balance top-up and payment flow
- `/admin`: operator workspace
- `/pricing`: commercial plans
- `/privacy`: privacy policy page
- `/terms`: service terms page

## Local development

### Backend

```bash
cd backend
npm install
npm run start:dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Docker

```bash
docker compose up -d --build
```

## Deploy To Existing Server

Windows PowerShell:

```powershell
.\scripts\deploy.ps1
```

Custom example:

```powershell
.\scripts\deploy.ps1 `
  -ServerHost 139.180.213.100 `
  -ServerUser root `
  -ProjectRoot E:\api-platform网站平台\api-platform `
  -SshKeyPath C:\Users\one\.ssh\id_ed25519_vgo_ai `
  -RemotePath /opt/vgo-ai/api-platform
```

## Production guide

See:

[docs/production-deployment.md](/E:/api-platform网站平台/api-platform/docs/production-deployment.md)
