# VGO AI Project Memory

Last refreshed: 2026-03-30

## Identity

- Project name: VGO AI
- Workspace path: `E:\api-platform网站平台\api-platform`
- Public site: `https://vgoai.cn/`
- Legacy redirect domain: `https://vgo-ai.duckdns.org/`
- Server IP: `139.180.213.100`
- Server hostname: `vgo-ai-sg-01`
- Main deploy script: `scripts/deploy.ps1`
- Server deploy path: `/opt/vgo-ai/api-platform`
- Memory mirror path: `C:\Users\one\.codex\memories\vgo-ai-memory.md`

## Architecture

VGO AI is a full-stack AI workspace built with:

- Next.js 14 frontend
- NestJS 10 backend
- PostgreSQL
- Redis
- Nginx
- Docker Compose

Main runtime containers:

- `api-platform-frontend`
- `api-platform-backend`
- `api-platform-postgres`
- `api-platform-redis`
- `api-platform-nginx`

## Main product surfaces

Frontend routes:

- `/chat`
- `/dashboard`
- `/developers`
- `/models`
- `/pricing`
- `/privacy`
- `/terms`
- `/login`
- `/register`
- `/recharge`
- `/skills`
- `/admin`
- `/admin/channels`
- `/admin/logs`
- `/admin/recharges`
- `/admin/users`

Backend modules:

- `auth`
- `user`
- `chat`
- `gateway`
- `channel`
- `recharge`
- `order`
- `admin`

## Core business behavior

### Chat workspace

- Main entry: `/chat`
- Persistence tables: `chat_conversations`, `chat_messages`
- Main flow: `ChatController -> ChatService -> ChatAgentService / GatewayService`

### Gateway

- Public gateway base target: `https://vgoai.cn/api/v1/gateway/v1`
- Selects active channel by model
- Forwards requests to upstream providers
- Calculates usage cost
- Writes request logs

### Billing

- Usage-based charging
- Request cost is recorded in `request_logs`
- Normal users follow balance checks
- Admin users can use chat without being blocked by the regular balance gate

## Important completed fixes on 2026-03-26

### Chat and gateway

- Fixed duplicate `/v1` upstream URL issue
- Fixed zero-balance channel fallback problem
- Fixed admin workspace chat availability

### Frontend stability

- Reduced incorrect jumps back to `/login`
- Tightened auth clearing to real `401/403`
- Replaced old pricing content with current billing explanation
- Updated model catalog billing entry

## Agent capability status

The `/chat` workspace is now a lightweight server-side agent, not only plain text forwarding.

Core files:

- `backend/src/modules/chat/chat-agent.service.ts`
- `backend/src/modules/chat/chat.service.ts`
- `backend/src/modules/chat/chat.module.ts`
- `backend/src/modules/gateway/gateway.service.ts`

Current user tools:

- `get_my_profile`
- `get_my_balance`
- `list_available_models`
- `get_recent_recharges`
- `get_usage_summary`
- `get_recharge_packages`
- `preview_recharge_bonus`
- `describe_payment_methods`
- `recommend_recharge_package`
- `create_recharge_order`
- `get_recharge_order_status`

Current admin-only tools:

- `admin_list_channels`
- `admin_recent_request_errors`

MiniMax compatibility:

- Backend supports both standard `tool_calls` and text-style `[TOOL_CALL]`

## Skill and install status

- Skill catalog API: `/api/v1/chat/skills`
- Installed skill state API: `/api/v1/chat/skills/installed`
- Persistent storage file: `/app/data/chat-skill-installs.json`
- Backend docker volume for `/app/data` is already configured

Important files:

- `backend/src/modules/chat/chat-skill-install.service.ts`
- `backend/src/modules/chat/chat.controller.ts`
- `frontend/app/skills/page.tsx`

## Agent UX already added

- Backend returns structured `toolTraces`
- Chat UI renders tool labels and result summaries
- Recharge recommendation cards are available
- Recharge confirmation cards are available
- Recharge order cards can show payment links and status actions

## Recharge agent behavior

- Can explain payment methods
- Can preview recharge bonus
- Can recommend recharge packages by budget
- Creates recharge orders only when amount and payment method are explicit
- Uses confirmation before really creating an order
- Users can only query and refresh their own recharge orders
- Admin tools do not automatically grant cross-user order control

## Latest milestone: automatic role-based agent profile

This milestone changes the product from manual mode switching to automatic role-based behavior.

Implemented in code:

- Same public assistant identity: `VGO AI`
- Backend automatically selects agent profile by account role
- Normal users default to `user-agent`
- Admin accounts default to `admin-agent`
- Chat page no longer needs a manual mode/persona switch
- Permissions are enforced by backend tool allowlist

Key files:

- `backend/src/modules/chat/chat-skill-registry.ts`
- `backend/src/modules/chat/chat-agent.service.ts`
- `frontend/app/chat/page.tsx`

## Current deployment note

Local status on 2026-03-26:

- Backend build passed
- Frontend build passed

Deployment note:

- Latest role-based agent profile changes are completed locally
- Deployment could not be confirmed during this refresh window because the server became unstable
- SSH to `139.180.213.100` timed out or hung
- HTTPS fallback domain `https://vgo-ai.duckdns.org/` remained available while the main domain migration to `https://vgoai.cn/` was being prepared

## Next node

As soon as the server is stable again:

1. Reconnect to `139.180.213.100`
2. Rebuild and restart `backend` and `frontend`
3. Verify `/chat` with a normal user and an admin account
4. Confirm tool labels show correct Chinese text
5. Sync this memory file to `C:\Users\one\.codex\memories\vgo-ai-memory.md`

After deployment is confirmed, the next product milestone should be:

- Continue strengthening automatic admin/user agent behavior
- Add richer structured tool steps in chat
- Decide whether in-site skills should remain hidden infrastructure or become true installable capability bundles

## Latest milestone: stronger admin agent diagnostics

Added in the current local build:

- Admin agent can now call `admin_platform_overview`
- Admin agent can now call `admin_model_health_summary`
- Admin agent can now call `admin_channel_diagnostics`

What these tools provide:

- `admin_platform_overview`: 7-day user, balance, recharge, request, error, and average latency overview
- `admin_model_health_summary`: recent model request volume, success rate, latency, and cost summary
- `admin_channel_diagnostics`: per-channel request count, error count, latency, cost, balance, and active status summary

Frontend chat refresh completed in the same milestone:

- Rewrote `/chat` page text and interaction copy to remove garbled Chinese content
- Preserved role-aware agent badge, tool traces, recharge confirmation cards, order cards, and recommendation cards
- Added clean labels for the new admin diagnostics tools

## Latest milestone: login and register visual refresh

Landing/auth visual work completed:

- `/login` was redesigned as the actual animated landing screen
- geometric mascot shapes were refined for better depth, color balance, and silhouette quality
- eye-follow interaction was preserved
- new idle blink behavior was added so different shapes occasionally blink when the pointer is still
- soft floating motion was added to create a more alive first screen
- `/register` was refreshed into the same visual language so auth pages now feel consistent

Content cleanup included:

- removed garbled Chinese copy from `/login`
- removed garbled Chinese copy from `/register`
- cleaned shared frontend API fallback error text in `frontend/lib/api.ts`

## Latest milestone: admin incident analysis

Added a new admin-only agent tool:

- `admin_incident_analysis`

Purpose:

- move admin chat from raw data lookup to conclusion-oriented troubleshooting
- summarize recent instability, likely problematic model/channel, dominant error codes, and concrete next-step recommendations

Implementation notes:

- tool is available only inside the automatic `admin-agent` profile
- it aggregates data from platform overview, model health, channel diagnostics, and recent error requests
- recommendations are heuristic and currently focus on:
  - elevated overall error rate
  - top failing model
  - top failing channel
- frequent `429` rate-limit errors
- frequent `5xx` upstream/server errors

## Latest milestone: free support mode for zero-balance users

Problem solved:

- before this milestone, normal users with zero balance could not really talk to the workspace
- they were blocked from useful interaction unless they recharged first

Current behavior:

- admin users still use the normal admin agent path
- paid users still use the normal full agent path
- normal users with zero balance now enter a free lightweight support mode automatically

Free support mode scope:

- balance queries
- recharge packages and bonus explanation
- payment methods
- recent recharge history
- recharge order status lookup by order number
- available model catalog guidance
- developer / API access FAQ-style guidance

Implementation:

- backend service: `backend/src/modules/chat/chat-customer-support.service.ts`
- routing entry: `backend/src/modules/chat/chat.service.ts`
- frontend now shows a small badge in `/chat` when the current user is in free support mode

Important constraint:

- free support mode is intentionally narrow and deterministic
- it does not provide full creative / open-ended model chatting
- it is designed to cover basic customer service tasks without consuming paid model quota

## Latest milestone: FAQ-backed free support mode

The lightweight free support path now includes an internal FAQ knowledge layer.

Current FAQ-style support topics:

- recharge bonus rules
- payment methods
- order arrival / status explanation
- model selection guidance
- API / developer access basics
- admin entry / backend navigation basics

Behavior:

- zero-balance users still do not enter full paid model chat
- but the support service can now answer a wider range of common customer-service questions with more natural phrasing
- when no strong FAQ match is found, it falls back to a guided support response with suggested question directions

## Latest milestone: suggested prompts for free support mode

Frontend chat UX for zero-balance users now includes clickable suggested prompts in the empty-state view.

Current suggested prompt examples:

- recharge packages
- payment methods
- order arrival time
- model recommendation
- API access
- admin/backend entry

Purpose:

- reduce friction for first-time users
- make the free support path more discoverable
- help zero-balance users understand what can be asked before upgrading to the full paid agent

## Latest milestone: internal beta models only for site chat

The beta model mechanism has been tightened so it is now site-only.

Current rules:

- beta models are only for the website chat workspace / internal learning use
- beta models are not exposed through public API routes
- beta models do not enter the public model sales pool
- zero-balance regular users can still use a beta model inside `/chat`
- beta free deadline is currently `2026-04-15`

Implementation details:

- beta config service remains: `backend/src/modules/channel/channel-public-beta.service.ts`
- production config storage remains: `/app/data/channel-public-beta.json`
- admin channel page still supports marking a channel as beta and setting its free-until date
- gateway public catalog excludes beta models
- removed beta API access path and beta catalog route
- standard API route selection now excludes beta channels even if the model ID is guessed manually

Current verified state:

- `/api/v1/gateway/beta/models/catalog` now returns `404`
- public `/api/v1/gateway/models/catalog` still works
- public `/models` page only shows sales-pool models

Next recommended steps:

- mark one real channel as site-only beta and test it with a zero-balance user in `/chat`
- if needed later, add a dedicated “内测体验” block inside chat instead of exposing anything on the public model page

## Latest milestone: beta switched to MiniMax-M2.5 with per-user free token cap

What changed:

- removed the invalid iFlow beta channel completely
- current site-only beta model is now `MiniMax-M2.5`
- public sales pool is intentionally empty for that model while it is in beta
- regular users now have a hard cap of `100000` free beta tokens per account

Verified state:

- `chat/models` returns `MiniMax-M2.5 (站内内测至 2026-04-15)`
- public `gateway/models/catalog` stays empty for the beta model
- direct chat send on `MiniMax-M2.5` succeeded with `cost: 0`

Implementation note:

- free beta token cap is enforced in `backend/src/modules/chat/chat.service.ts`
- current cap constant: `100000`

## Latest milestone: registration email verification added

Registration now requires an email verification code before a new account can be created.

What changed:

- backend added `POST /api/v1/auth/send-registration-code`
- registration now requires `verificationCode` in `POST /api/v1/auth/register`
- verification codes are 6 digits, valid for 10 minutes
- resend cooldown is 60 seconds
- max verification attempts per code is 5
- verification records are stored in `/app/data/auth-email-verifications.json` in production

Implementation details:

- backend service: `backend/src/modules/auth/auth-email-verification.service.ts`
- auth flow updated in `backend/src/modules/auth/auth.service.ts`
- auth module now provides the verification service in `backend/src/modules/auth/auth.module.ts`
- frontend registration page was rewritten in `frontend/app/register/page.tsx`
- frontend API helpers updated in `frontend/lib/api.ts`
- docker compose now passes SMTP env vars into the backend container

Current verified state:

- `/register` loads normally online
- `POST /api/v1/auth/send-registration-code` is online
- current server `.env` does not yet contain SMTP settings
- without SMTP config, the API returns: `邮件服务未配置，请先在服务器配置 SMTP 参数`
- temporary registration bypass code is active: `000000`
- backend container confirms `REGISTRATION_BYPASS_CODE=000000`

Important note:

- `Qwen3-235B-A22B-Thinking-2507` is a manually deployed model added by the user, not a model created by testing scripts

Next recommended step:

- add real SMTP settings to `/opt/vgo-ai/api-platform/.env` (or the linked server env file), then rebuild backend/frontend once so registration emails can actually send
- after SMTP is ready, remove or override `REGISTRATION_BYPASS_CODE` so the temporary bypass no longer works

## Latest milestone: digital employee team workspace (first version)

A first version of the multi-agent digital employee feature is now online.

Entry point:

- left navigation in the main chat workspace now includes `/teams`

Current first-version capability:

- users can create their own digital employee team
- each team currently supports 2 to 6 members
- each member can be configured with:
  - name
  - role title
  - model
  - skill
  - responsibility
  - leader flag
- the team owner can submit one task
- the leader first decomposes the task
- each member then produces one round of contribution
- the leader finally synthesizes the outputs into one delivery result
- latest run result is persisted and visible in the UI

Implementation details:

- backend storage service: `backend/src/modules/chat/chat-team.service.ts`
- routes added under `backend/src/modules/chat/chat.controller.ts`
- provider wired in `backend/src/modules/chat/chat.module.ts`
- frontend page: `frontend/app/teams/page.tsx`
- frontend API helpers extended in `frontend/lib/api.ts`
- chat left nav now links to `/teams` via `frontend/app/chat/page.tsx`
- production store file is persisted under backend data volume as `/app/data/chat-teams.json`

Verified state:

- `/teams` is online and returns `200` internally
- `POST /api/v1/chat/teams` successfully creates a team
- `POST /api/v1/chat/teams/:id/run` successfully runs one collaboration round
- a real end-to-end test on server completed and returned:
  - leader task planning
  - per-member assignments
  - per-member outputs
  - final synthesized summary

Current limitation of v1:

- team collaboration currently uses model-to-model orchestration only
- assigned `skillId` is used as role style / prompt context, not as full tool-executing skill runtime
- there is no internal multi-round debate loop yet, only one planning round + one contribution round + one final summary round
- one real test showed the leader member failed one upstream call with `Failed to connect to upstream channel`, while the rest of the team still completed and the final summary was produced

Next recommended step:

- add structured retry / fallback for member execution so one member upstream failure does not degrade the role output
- then extend team members from prompt-only skills to true tool-enabled worker agents

## Latest milestone: digital employee teams now support model fallback and stronger role skills

The team workspace has now been upgraded beyond the initial prompt-only version.

What changed:

- team members now retry with fallback models when the assigned primary model fails
- run results now store:
  - attempted models
  - whether fallback was used
  - execution notes
- chat skills were expanded with role-oriented presets:
  - `product-strategist`
  - `operations-executor`
  - `research-analyst`
  - `customer-success`
- team execution now consumes skill-specific role prompts and output rules instead of only treating skillId as a shallow label

Implementation details:

- team fallback and richer orchestration live in `backend/src/modules/chat/chat-team.service.ts`
- richer skill definitions live in `backend/src/modules/chat/chat-skill-registry.ts`
- team UI now shows fallback status, attempted models, and execution notes in `frontend/app/teams/page.tsx`

Verified state:

- a real server-side run was executed with the leader intentionally configured to an invalid model id: `invalid-model-for-fallback`
- the system automatically fell back to `MiniMax-M2.5`
- the stored result included:
  - `attemptedModels: ["invalid-model-for-fallback", "MiniMax-M2.5"]`
  - `usedFallbackModel: true`
  - execution note explaining that fallback happened

Current limitation:

- team skills are now meaningfully injected into execution prompts and output structure
- but they are still not yet full tool-calling worker runtimes like the main chat agent path

Next recommended step:

- upgrade selected team roles to true tool-enabled workers by routing eligible members through the existing agent/tool chain rather than plain completion calls

## Latest milestone: company workspace phase 1-3 skeleton is now online

VGO AI now has a first real `/workspace` product skeleton, moving the product from a chat-first site toward an agent company workspace.

What changed:

- added a new workspace page at `frontend/app/workspace/page.tsx`
- added persistent backend workspace orchestration in `backend/src/modules/chat/chat-workspace.service.ts`
- added workspace routes in `backend/src/modules/chat/chat.controller.ts`
- wired the workspace provider into `backend/src/modules/chat/chat.module.ts`
- rewrote `frontend/lib/api.ts` cleanly and extended it with workspace APIs

Current workspace capabilities:

- task center
  - create tasks
  - edit title, brief, priority, owner note
  - assign a digital employee team
- approval center
  - tasks can require approval before execution
  - approval records are stored and can be approved or rejected
- delivery center
  - running a task uses the assigned digital employee team
  - successful team execution produces a persisted deliverable
  - latest deliverable can be read directly on the workspace page
- operations overview
  - overview metrics
  - recent activity log
  - recent approvals
  - recent deliverables

Persistence details:

- workspace store persists in backend data volume as `/app/data/chat-workspace.json`
- this follows the same no-migration lightweight persistence pattern already used by teams and skill installs

Verified state:

- local backend build passed
- local frontend build passed
- production deploy completed successfully
- `http://127.0.0.1:3000/workspace` returns `200` on server
- `GET /api/v1/chat/workspace/overview` returns `401` when unauthenticated, confirming route protection is active
- backend data file exists on server: `/app/data/chat-workspace.json`

Current limitation of this workspace phase:

- workspace tasks currently execute through assigned digital employee teams only
- approvals are user-scoped and lightweight; there is not yet a multi-reviewer or platform-level approval matrix
- deliverables currently store the final summary plus linked team run, but not yet separate artifacts like files, tables, or generated documents
- the chat left sidebar has not yet been upgraded into a full workspace navigation shell; `/workspace` is online as a dedicated entry page

Next recommended step:

- connect selected workspace task types to true tool-enabled worker agents
- add artifact outputs and execution step traces
- then evolve `/workspace` into the main company operating surface with modules for tasks, approvals, deliverables, and memory

## Latest milestone: workspace teams now run as true tool-enabled workers

The company workspace has moved beyond prompt-only collaboration.

What changed:

- `backend/src/modules/chat/chat-agent.service.ts`
  - fixed `skillId` handling so agent execution now truly uses the selected skill definition instead of always falling back to the default profile
- `backend/src/modules/chat/chat-team.service.ts`
  - rewritten into a cleaner and more stable version
  - team members now choose between:
    - plain completion mode
    - agent mode with real tool calls
  - tool-enabled roles run through the existing chat agent chain and can use site tools based on their assigned skill
  - fallback model logic still applies if the primary model fails
- `backend/src/modules/chat/chat-workspace.service.ts`
  - deliverables now include:
    - artifacts
    - execution steps
    - tool labels per step when tools were used
- `frontend/app/workspace/page.tsx`
  - workspace now renders:
    - step-by-step execution trace
    - artifact cards
    - visible worker tool usage summary

Verified state:

- local backend build passed
- local frontend build passed
- production deploy completed successfully
- a real end-to-end production test was executed with a temporary user:
  - register temporary user
  - create digital employee team
  - create workspace task
  - run workspace task
  - inspect returned deliverable
- verified result:
  - task status became `completed`
  - both team members executed in `agent` mode
  - the leader used tools:
    - `list_available_models`
    - `describe_payment_methods`
    - `get_recharge_packages`
  - the support member used tools:
    - `get_my_balance`
    - `list_available_models`
    - `get_recharge_packages`
  - workspace deliverable steps now show tool labels such as:
    - model catalog
    - balance lookup
    - recharge packages
    - payment methods

Current limitation:

- worker agents still execute as bounded single-turn assignment workers rather than multi-round self-negotiating autonomous loops
- tool access is still derived from assigned skill definitions, not yet from a full installable per-worker skill runtime with connectors
- workspace artifacts are structured cards, but not yet downloadable documents, tables, or generated files

Next recommended step:

- introduce task-type templates like research, operations, customer support, and implementation
- add approval-gated executable actions for sensitive operations
- add dedicated artifact generation such as briefs, tables, and exportable reports

## Latest milestone: workspace now supports task templates and markdown export

The workspace has been pushed further toward a real operating surface.

What changed:

- `backend/src/modules/chat/chat-workspace.service.ts`
  - added built-in workspace task templates:
    - `research-brief`
    - `ops-rollout`
    - `customer-response`
    - `implementation-plan`
  - create-task flow now accepts `templateId`
  - deliverables can now be exported as markdown
- `backend/src/modules/chat/chat.controller.ts`
  - added:
    - `GET /api/v1/chat/workspace/templates`
    - `GET /api/v1/chat/workspace/deliverables/:id/export`
- `frontend/app/workspace/page.tsx`
  - added template cards at the top of the editor
  - added approval note input
  - added `Export Markdown` button on the latest deliverable card
- `frontend/lib/api.ts`
  - added workspace template and deliverable export helpers

Verified state:

- local backend build passed
- local frontend build passed
- production deploy completed successfully
- real authenticated production validation completed:
  - fetched workspace templates
  - created a team
  - created a workspace task using `templateId: research-brief`
  - ran the task
  - exported the deliverable as markdown
- verified template names:
  - `Research Brief`
  - `Operations Rollout`
  - `Customer Response Pack`
  - `Implementation Plan`
- verified export result:
  - filename: `research-and-recommendation-brief.md`
  - markdown content returned correctly from export endpoint

Current limitation:

- templates are currently built-in server presets, not yet user-editable or admin-configurable
- export format is markdown only for now
- approval notes are stored on the approval record, but there is not yet a deeper approval workflow history UI

Next recommended step:

- make task templates configurable in admin
- add deliverable export formats like JSON and PDF-ready print view
- introduce approval-gated executable actions for high-risk admin operations

## Latest milestone: workspace templates are now admin-configurable

The workspace template system has now moved beyond fixed built-in presets.

What changed:

- `backend/src/modules/chat/chat-workspace.service.ts`
  - added a dedicated template store file: `data/chat-workspace-templates.json`
  - workspace templates now merge:
    - built-in templates
    - admin-created custom templates
  - added create / update / delete logic for custom templates
- `backend/src/modules/admin/admin.controller.ts`
  - added admin template management routes:
    - `GET /api/v1/admin/workspace/templates`
    - `POST /api/v1/admin/workspace/templates`
    - `PUT /api/v1/admin/workspace/templates/:id`
    - `DELETE /api/v1/admin/workspace/templates/:id`
- `backend/src/modules/admin/admin.module.ts`
  - now imports `ChatModule` so the admin controller can manage workspace templates through the shared workspace service
- `frontend/app/workspace/page.tsx`
  - admin users now see a `Template Studio` panel directly inside `/workspace`
  - custom templates can be created, edited, reset, and deleted without leaving the workspace
  - built-in templates remain available to all users as fixed presets
- `frontend/lib/api.ts`
  - added admin workspace template API helpers

Verified state:

- local backend build passed
- local frontend build passed
- production deploy completed successfully
- `/workspace` remains in production build output after this change

Current limitation:

- custom templates are platform-level and file-backed, not yet versioned or scoped per organization
- built-in templates are still not editable, only custom templates are mutable
- SSH-based post-deploy admin CRUD re-verification was attempted but the network path was unstable during the final remote validation window, so this round relies on successful build + deploy and the existing server-side deployment path

Next recommended step:

- add approval-gated executable admin actions
- add organization / team-scoped template ownership
- add more export targets such as JSON and print-friendly report view

## Latest milestone: local executor path is now defined and Open Interpreter is installed on the local E drive

VGO AI now has a concrete local-execution direction for digital teams instead of only producing discussion outputs.

What changed:

- local machine setup
  - installed Python 3.12 to `E:\Python312`
  - created Open Interpreter runtime at `E:\VGO-Local-Executor\oi312-env`
  - verified `E:\VGO-Local-Executor\oi312-env\Scripts\interpreter.exe --help` runs successfully
  - added local launcher:
    - `E:\VGO-Local-Executor\launch-open-interpreter.bat`
  - added local readme:
    - `E:\VGO-Local-Executor\README.txt`
- `frontend/app/developers/page.tsx`
  - fully rewrote the developer docs landing page in clean readable Chinese
  - added a dedicated local-executor section and download entry
- `frontend/app/developers/local-executor/page.tsx`
  - added a full in-site execution-plan page for:
    - cloud orchestration
    - approval flow
    - local bridge
    - Open Interpreter execution
    - result reporting
- `frontend/public/downloads/vgo-open-interpreter-installer.ps1`
  - added downloadable installer script for local setup on Windows / E drive
- `frontend/public/downloads/vgo-local-bridge.example.json`
  - added local bridge configuration template
- `docs/local-executor-bridge.md`
  - added engineering documentation for the full cloud-local execution chain

Execution chain currently defined:

1. digital team plans and breaks down work in the cloud
2. approval-gated local tasks are packaged as structured actions
3. a future local bridge service polls and receives approved jobs
4. the bridge invokes Open Interpreter locally
5. logs, artifacts, and execution receipts are returned to VGO AI

Verified state:

- Open Interpreter local install completed successfully on the E drive
- verified local runtime entry:
  - `E:\VGO-Local-Executor\oi312-env\Scripts\interpreter.exe`
- local frontend build passed
- production deploy completed successfully
- verified on server:
  - `/developers` returns `200`
  - `/developers/local-executor` returns `200`
  - `/downloads/vgo-open-interpreter-installer.ps1` returns `200`

Current limitation:

- there is not yet a running local bridge daemon that polls cloud tasks automatically
- website execution is currently documented and prepared, but not yet wired to a live bridge registration / device binding flow
- full bilingual cleanup is still incomplete in other legacy pages; the runtime translation layer was improved, but some older page strings still need direct source cleanup

Next recommended step:

- build the first real `local bridge` service with:
  - device registration
  - polling / heartbeat
  - approved job execution
  - artifact upload
- add a bridge status panel inside `/workspace` or `/teams`
- convert digital-team outputs from pure text into structured executable action lists

## Latest milestone: first local bridge runtime and cloud endpoints are now live

The local-execution direction is no longer only documentation. A first bridge skeleton now exists both in the backend and in the workspace UI.

What changed:

- `backend/src/modules/chat/chat-local-bridge.service.ts`
  - added file-backed local bridge store: `data/chat-local-bridge.json`
  - supports:
    - bridge creation
    - bridge listing
    - local job queue
    - agent heartbeat
    - next-job polling
    - start / complete / fail state transitions
- `backend/src/modules/chat/chat-local-bridge.controller.ts`
  - added management and agent endpoints under:
    - `/api/v1/chat/local-bridge/*`
- `backend/src/modules/chat/chat.module.ts`
  - now registers the local bridge controller and service
- `frontend/lib/api.ts`
  - added local bridge API helpers
- `frontend/app/workspace/page.tsx`
  - added a `Local Bridge` panel inside `/workspace`
  - users can now:
    - create a bridge
    - see token preview and last seen time
    - queue local jobs
    - view recent local job statuses
- `frontend/public/downloads/vgo-local-bridge.py`
  - added first Python polling bridge script
  - supports:
    - first-time bridge bootstrap with user token
    - heartbeat
    - next-job polling
    - running Open Interpreter
    - completion / failure reporting
- local machine files
  - copied bridge runtime to:
    - `E:\VGO-Local-Executor\vgo-local-bridge.py`
    - `E:\VGO-Local-Executor\vgo-local-bridge.example.json`
    - `E:\VGO-Local-Executor\launch-local-bridge.bat`

Verified state:

- local backend build passed
- local frontend build passed
- bridge python script syntax check passed
- production deploy completed successfully
- verified on server:
  - `/downloads/vgo-local-bridge.py` returns `200`
  - public bridge agent endpoint rejects invalid token with `401`
- locally validated the service lifecycle end-to-end by invoking the compiled service directly:
  - create bridge
  - enqueue job
  - poll next job
  - start job
  - complete job
  - final bridge status became `idle`

Current limitation:

- workspace local job queue is manual for now; digital teams do not yet auto-convert deliverables into bridge jobs
- the local bridge script currently expects you to provide a working executor command and model/API env in config
- there is still no persistent device-binding / online-status history UI beyond the first workspace panel

Next recommended step:

- automatically generate executable local actions from digital-team deliverables
- add bridge-to-workspace binding per team or per task
- add artifact uploads and screenshots to bridge completion payloads

## Latest milestone: workspace deliverables now auto-generate local execution actions

Digital-team results are no longer only prose outputs. Workspace deliverables now include structured local actions that can be queued to a local bridge.

What changed:

- `backend/src/modules/chat/chat-workspace.service.ts`
  - deliverables now include `localActions`
  - local actions are generated automatically from:
    - leader plan
    - final summary
    - selected member outputs
  - added `queueLocalActions(userId, deliverableId, bridgeId)`
  - markdown export now includes a `Local Actions` section
- `backend/src/modules/chat/chat.controller.ts`
  - added:
    - `POST /api/v1/chat/workspace/deliverables/:id/queue-local`
- `frontend/lib/api.ts`
  - added helper for deliverable local-action queueing
- `frontend/app/workspace/page.tsx`
  - latest deliverable card now shows:
    - suggested local actions
    - per-action source, working directory, job id, and status
    - `Queue all to bridge` action

Verified state:

- local backend build passed
- local frontend build passed
- local validation succeeded:
  - a synthetic workspace deliverable generated 3 local actions
  - queueing those actions produced 3 local bridge jobs
  - all generated actions switched to `queued`
- production deploy completed successfully
- server checks confirmed:
  - `/workspace` returns `200`
  - invalid local bridge token still returns `401`
  - `backend/data/chat-local-bridge.json` exists in production

Current limitation:

- local actions are heuristic first-pass actions, not yet specialized by skill or project type
- there is not yet per-action requeue / cancel UI
- bridge completion results are not yet mapped back to deliverable action status automatically

Next recommended step:

- sync bridge job completion back into `localActions`
- let teams or templates define their own action-generation presets
- allow artifacts / screenshots from local jobs to appear directly inside the deliverable card

## Latest milestone: local bridge completion now syncs back into workspace local actions

The cloud-local loop is now tighter. Workspace deliverables do not just queue local actions anymore; they now reflect actual bridge job outcomes.

What changed:

- `backend/src/modules/chat/chat-local-bridge.service.ts`
  - added `getJobMap(userId)` for workspace-side hydration
- `backend/src/modules/chat/chat-workspace.service.ts`
  - `listDeliverables()` and `getDeliverable()` now hydrate `localActions` from real bridge jobs
  - hydrated fields now include:
    - `status`
    - `resultSummary`
    - `completedAt`
    - `stdout`
    - `stderr`
  - local action status now supports:
    - `suggested`
    - `queued`
    - `running`
    - `completed`
    - `failed`
- `frontend/app/workspace/page.tsx`
  - local actions in the deliverable card now show:
    - live status
    - result summary
    - completed time
    - returned artifacts
    - expandable stdout / stderr blocks

Verified state:

- local backend build passed
- local frontend build passed
- local validation succeeded:
  - queued local actions were created from a deliverable
  - one bridge job was marked completed
  - workspace deliverable hydration reflected:
    - first action status = `completed`
    - first action result summary = returned completion text
    - remaining queued actions stayed `queued`
- production deploy completed successfully
- server checks confirmed:
  - `/workspace` returns `200`
  - invalid local bridge token still returns `401`

Current limitation:

- screenshots and richer artifact previews are not yet rendered as dedicated cards/thumbnails
- local action retry / cancel controls are not yet exposed in the UI
- action generation is still generic, not yet tailored by team template or skill

Next recommended step:

- upload artifacts / screenshots from local bridge and display them in the deliverable
- support requeueing a single failed local action
- make different team templates emit different local action types

---

Update: Payment system hardening (2026-03-29)

Completed:

- backend recharge flow was upgraded to production-style behavior:
  - added `GET /api/v1/recharge/methods` to expose which payment methods are actually configured
  - added `POST /api/v1/recharge/retry/:orderNo` to recreate checkout for a pending order
  - `GET /api/v1/recharge/order/:orderNo` is now user-scoped instead of leaking any order by order number
  - order creation now rejects unavailable payment methods instead of creating fake unusable orders
- backend env wiring was completed in `docker-compose.yml` for:
  - Stripe
  - PayPal
  - USDT / TRON / EVM verification
- frontend payment surfaces were rewritten and de-garbled:
  - `frontend/app/recharge/page.tsx`
  - `frontend/app/recharge/checkout/[orderNo]/page.tsx`
  - `frontend/app/admin/recharges/page.tsx`
  - shows method availability, disabled unconfigured methods, retry payment, refresh status, and USDT hash submission

Verified:

- local backend build passed
- local frontend build passed
- production deploy completed successfully
- server page checks passed:
  - `/recharge` -> `200`
  - `/recharge/checkout/test-order` -> `200`
  - `/admin/recharges` -> `200`
- Stripe webhook endpoint currently returns:
  - `400 Stripe is not configured`

Current server payment config status:

- `STRIPE_SECRET_KEY`: missing
- `STRIPE_WEBHOOK_SECRET`: missing
- `PAYPAL_CLIENT_ID`: missing
- `PAYPAL_CLIENT_SECRET`: missing
- `USDT_WALLET_ADDRESS`: missing
- `USDT_EVM_RPC_URL`: missing
- `USDT_ERC20_CONTRACT`: missing
- `USDT_TRC20_CONTRACT`: missing
- `TRONGRID_API_KEY`: missing

Meaning:

- payment UI is now honest and usable
- real end-to-end payment cannot be completed yet because provider credentials are not configured on the server

Next recommended step:

- configure Stripe first for the fastest real payment test:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
- optionally configure PayPal and/or USDT after Stripe
- then run a live payment test:
  - create order
  - redirect to checkout
  - complete payment
  - verify webhook writes order to `paid`
  - verify user balance increases by amount + bonus

---

Update: Payment route switched away from Stripe-first (2026-03-29)

Completed:

- recharge backend now treats these as the primary payment routes:
  - `alipay` manual transfer
  - `wechat` manual transfer
  - `paypal` API mode if credentials exist, otherwise manual transfer mode
  - `usdt` with hash submission and automatic verification where possible
- Stripe is no longer the default payment method for order creation
- recharge UI now supports:
  - manual collection details
  - payment links
  - QR code display
  - submission of transfer proof / reference number
- added new env support for manual collection:
  - `ALIPAY_DISPLAY_NAME`
  - `ALIPAY_ACCOUNT`
  - `ALIPAY_PAYMENT_LINK`
  - `ALIPAY_QR_CODE_URL`
  - `ALIPAY_RECIPIENT_NOTE`
  - `WECHAT_DISPLAY_NAME`
  - `WECHAT_ACCOUNT`
  - `WECHAT_PAYMENT_LINK`
  - `WECHAT_QR_CODE_URL`
  - `WECHAT_RECIPIENT_NOTE`
  - `PAYPAL_DISPLAY_NAME`
  - `PAYPAL_ACCOUNT_EMAIL`
  - `PAYPAL_PAYMENT_LINK`
  - `PAYPAL_RECIPIENT_NOTE`

Current real server state after switch:

- all of the above manual payment envs are still missing on production
- so payment UI logic is ready, but no payment method is actually activated yet

Next recommended step:

- fill production `.env` with the owner's real collection details for:
  - Alipay
  - WeChat
  - PayPal manual link or email
  - Binance / USDT wallet
- redeploy
- test these flows in order:
  - Alipay manual payment + proof submission + admin approval
  - WeChat manual payment + proof submission + admin approval
  - USDT payment + tx hash verification

---

Update: USDT (TRC20) production channel activated (2026-03-29)

Configured on production:

- `USDT_WALLET_ADDRESS=TWNb89age374nxQjBUQXhNeN6q5P7nfWB4`
- `USDT_NETWORK=TRC20`
- `TRONGRID_API_KEY` configured from owner-provided TronGrid key
- `USDT_TRC20_CONTRACT=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`

Verified:

- production `.env` contains the above values
- `/recharge` returns `200`
- recharge methods endpoint remains auth-protected and returns `401` when unauthenticated, which is expected

Immediate next test:

- log into the site
- open `/recharge`
- confirm `USDT (TRC20)` shows as configured / recommended
- create a very small USDT order
- send a matching TRC20 transfer
- submit the tx hash
- verify automatic status refresh and balance top-up
