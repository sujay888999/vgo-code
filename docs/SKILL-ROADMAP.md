# VGO Code Skill Enhancement Roadmap

## Goal

Turn VGO Code from a tool-enabled desktop agent into a skill-driven agent platform with:

- reusable skill definitions
- prompt-to-skill routing
- model-family aware execution guidance
- future skill marketplace compatibility

## Current baseline

VGO Code already has:

- an agent loop
- local tool runtime
- model family adapters
- permission controls
- context compression
- task panel and execution states

What is missing is a formal skill layer that sits above tools and below the task UI.

## Target architecture

```text
User Task
  -> Skill Router
  -> Selected Skills
  -> Agent Protocol + Model Family Adapter
  -> Tool Runtime
  -> Result Verification
  -> Final Answer / Task Panel
```

## Skill model

Each skill should define:

- `id`
- `name`
- `category`
- `description`
- `triggers`
- `preferredTools`
- `systemDirectives`
- `executionChecklist`
- `verificationRules`

## Phase plan

### Phase 1: Foundation

- Add a skill registry
- Add built-in skill definitions
- Detect relevant skills from the prompt
- Inject skill directives into the system prompt
- Expose selected skills in runtime state

### Phase 2: Skill-aware execution

- Show active skills in the task panel
- Add skill-specific retries and fallback logic
- Add result verification rules per skill
- Add skill-specific permission hints

### Phase 3: Skill packs

- File Management
- Code Analysis
- Stability Check
- UI Design
- Refactor Planner
- Release Assistant

### Phase 4: Productization

- Enable/disable skills in settings
- Skill priority ordering
- Skill-scoped permissions
- Skill templates per model family
- Import/export skill packs

## First built-in skills

### 1. File Management

Purpose:
- create, move, rename, copy, delete, open, verify files and folders

Expected tools:
- `list_dir`
- `read_file`
- `write_file`
- `copy_file`
- `move_file`
- `rename_file`
- `make_dir`
- `delete_file`
- `delete_dir`
- `open_path`

### 2. Code Analysis

Purpose:
- inspect project structure, entry points, dependencies, risky modules, and refactor opportunities

Expected tools:
- `list_dir`
- `read_file`
- `search_code`
- `run_command`

### 3. Stability Check

Purpose:
- detect broken workspace assumptions, missing config, failing scripts, invalid paths, or runtime inconsistencies

Expected tools:
- `list_dir`
- `read_file`
- `search_code`
- `run_command`

### 4. UI Design

Purpose:
- improve layout hierarchy, theme consistency, interaction clarity, and design-system quality

Expected tools:
- `read_file`
- `search_code`
- `write_file`

## Design rules

- Skills are not replacements for tools; they orchestrate tools.
- New models should reuse the same skill definitions.
- Model-specific logic should stay in model-family adapters, not in individual skills.
- Skills should remain composable.

## Success criteria

VGO Code skill system is considered usable when:

- the router consistently selects the right built-in skill set
- the selected skills influence execution behavior
- task panel can display active skills
- result verification is stronger for file and code tasks
- new skills can be added without editing the core agent loop
