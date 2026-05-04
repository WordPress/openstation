# Routines — roadmap & contributor guide

> **Audience:** anyone picking up Routines work — current maintainer onboarding, AI agents, contractors, future-you in three months.
>
> Goal: pick a feature, find the files, ship it. No tribal knowledge required.

This document is the companion to [`routines.md`](./routines.md) (architecture + public API). Read that first if you haven't built against the engine yet.

---

## What's shipped

| Phase | Surface | Status |
|---|---|---|
| **P1 — Engine** | CPT + schema validator, executor, trigger listener, run history table, REST CRUD, JSON editor UI, 3 starter recipes, 19 PHPUnit tests | Stable since 0.22.0 |
| **P2 — Visual canvas** | PixiJS-rendered connectors / halos / flow animation, hybrid DOM-cards over WebGL canvas, trigger picker, side-panel inspector with payload-aware autocomplete, pan / zoom, hover-to-trace, vertical condition rows, variable picker `{x}` button | Stable since 0.22.0 |
| **P3 — AI "Describe it"** | OpenAI Responses API with structured output, server-side revalidation, catalog injection, Cmd/Ctrl+K composer, 12 more triggers + 8 more actions, friendlier "Gate" card with humanized expressions | Stable since 0.22.0 |

The branch with everything is **`feat/routines`** — 25+ commits, all on a single branch (intentional — see `AGENTS.md`'s "ONLY one branch" rule).

---

## Phase 4 — three candidate tracks

Pick **one** track per release window. Don't mix unless you have multiple people working in parallel — the surfaces overlap (especially the trigger system).

### Track A — Integrations (the platform bet)

Turn Routines from "WP hook listener" into "Zapier inside WP". Biggest leverage per day spent.

#### A1. Scheduled trigger (cron)
**Why:** "Run every Monday at 9am", "Daily report", "Weekly cleanup". The single most-asked-for trigger type after hooks.

**Cost:** 1–2 days.

**Implementation sketch:**
- New trigger `kind: 'schedule'` in `includes/routines/schema.php`.
- Schedule fields: `cron` (string, e.g. `"0 9 * * MON"`) or `interval` (e.g. `"daily"` / `"hourly"`).
- In `includes/routines/triggers.php`:
  - On routine save, if trigger is `schedule`, call `wp_schedule_event()` (or `as_schedule_recurring_action()` when Action Scheduler is loaded — check via `function_exists`).
  - On routine delete / disable, `wp_unschedule_event()`.
  - The cron callback fires `wpdm_routine_run( $id, [], 'schedule' )`.
- Inspector UI: when trigger kind is `schedule`, show a cron-builder (preset rows: every hour / day / week + a custom cron field).
- Add to AI catalog so "describe it" can generate scheduled routines: "every Monday at 9am, email a digest of new posts".

**Files:** `schema.php`, `triggers.php`, `picker.ts` (add Schedule tab), `inspector.ts` (cron field component), `seed.php` (register sample schedule trigger), tests.

**Gotchas:**
- WP-Cron is request-driven; on low-traffic sites schedules drift. Document this; recommend a real cron line in the README.
- Action Scheduler (when present, e.g. WooCommerce sites) is the better backend — autodetect.

#### A2. Webhook trigger (incoming HTTP)
**Why:** "Stripe payment received → routine fires", "Slack slash-command → routine fires", "GitHub Actions ping → routine fires". External triggers complete the integration story.

**Cost:** 2 days.

**Implementation sketch:**
- New trigger `kind: 'webhook'` with auto-generated `secret` (HMAC key).
- New REST route `POST /wp-desktop/v1/routines/<id>/webhook` (no auth — payload-signature gates it).
- Verify `X-WPDM-Signature: sha256=<hmac>` header against the routine's secret. Return 403 on mismatch.
- The handler hands `$_POST` (or `php://input` JSON) to `wpdm_routine_run`.
- Inspector UI: when trigger kind is `webhook`, show the URL + secret with a "rotate secret" button.
- Throttle: per-routine rate limit + IP allowlist filter (`desktop_mode_routine_webhook_allowed_ips`).

**Files:** `schema.php`, new `webhook.php` in `includes/routines/`, REST integration, `inspector.ts` (URL display + rotate), `seed.php` (register webhook trigger so it shows in catalog), tests.

**Gotchas:**
- DO NOT log the HMAC secret. Period.
- The route is unauthenticated by design — defence is the signature. Add brute-force protection (per-IP rate limit) or it becomes a CPU DoS vector.
- Some external services send `application/x-www-form-urlencoded` (Stripe), some JSON (Slack), some XML (PayPal). Decode based on `Content-Type` and surface the parsed payload at `payload.body`.

#### A3. Outbound HTTP allowlist UI
**Why:** Currently `desktop_mode_routine_http_allowlist` requires a `add_filter` PHP edit to add a Slack / Discord webhook host. Users won't do that — they'll write a routine that silently fails or beg an admin.

**Cost:** 0.5 day.

**Implementation sketch:**
- New OS Settings tab section "Routines outbound hosts" (use existing `desktop_mode_register_settings_tab`).
- Stores an array of hosts in `wp_options` (autoload=false).
- The default `desktop_mode_routine_http_allowlist` filter reads from that option.
- Inspector UI on the `http` step: when the URL's host isn't allowed, show a yellow banner + "Add to allowlist" button.

**Files:** new `includes/routines/http-allowlist.php`, settings tab registration, `inspector.ts` (banner + button), `steps.php` (read the option).

**Gotchas:**
- Don't allow `*` wildcard from the UI — power users use the filter. UI should be hosts-only, no wildcards.

---

### Track B — Polish + debuggability (deepens the existing surface)

If the canvas + AI feel "good but not great", this is the track. No new use cases; existing surfaces become delightful.

#### B1. Run replay
**Why:** When something fails in production, the user wants to *see* what happened. We have the run history (steps_log per run); the canvas can re-play the exact flow animation that fired then, with the real success/failure colours frozen on each step.

**Cost:** 1 day.

**Implementation sketch:**
- "Recent runs" tab already exists. Add a "Replay" button to each row.
- On click: load the run's `steps_log`, switch to Designer tab, call `canvasHandle.playRun(steps_log)` with the historical log.
- Add a "Time travel" indicator banner ("Replaying run from 2026-01-12 14:33") that the user dismisses.
- Optional: a slider that scrubs through the replay (frame-by-frame).

**Files:** `index.ts` (history tab — replay button), `canvas.ts` (already has `playRun`), `pixi-layer.ts` (extend `playRun` to support a "frozen final state" mode that doesn't disappear after the animation).

**Gotchas:**
- Run history retention is 30 days by default. A replay button on a row > 30 days is a 404. Display "Run too old to replay" instead of failing silently.

#### B2. Drag-to-reorder steps
**Why:** Right now reorder = delete + re-add. Painful for routines with 5+ steps.

**Cost:** 1 day.

**Implementation sketch:**
- PointerEvent-based drag on each step card (NOT HTML5 drag — that conflicts with the canvas pan).
- `pointerdown` on a card's grip handle (a small `⋮⋮` icon top-left of the card, only shown on hover).
- During drag: set `data-dragging` on the card, follow the pointer, render drop indicators between siblings.
- On `pointerup`: compute the new index from the drop indicator's position, splice the steps array, rerender.
- Branch boundaries: dropping inside a different `then`/`else` is allowed (path rewrite); dropping into a different routine is not.

**Files:** new `src/routines/drag-reorder.ts`, hooked from `canvas.ts` after each step card render.

**Gotchas:**
- The pan handler in `viewport.ts` allowlists targets via `closest(...)`. The grip handle should NOT match — the drag system needs to win pointerdown on it.
- Dropping a step right after itself is a no-op; guard against the "splice to same index" case.
- Animate the post-drop layout shift with a simple transition.

#### B3. Inline step-failed banner
**Why:** Right now if a step fails, the run history says so but the canvas is silent. The user has to switch tabs and read.

**Cost:** 0.5 day.

**Implementation sketch:**
- Track the **last run's** per-step results in canvas state.
- When a step has `ok: false`, add `is-failed` class to its card → red border + a small banner inside ("comment_id missing").
- After a successful subsequent run, clear it.
- Pixi: when a card has `state: 'error'`, draw a red halo (already supported via `CardAnchor.state`).

**Files:** `canvas.ts` (track last-run-per-step), `pixi-layer.ts` (already supports state).

#### B4. Empty-state polish
**Why:** A brand-new routine renders just `[ trigger ] [ + Add step ]`. Cold start. Could be a coaching moment — show a "Start with a trigger" hint and three pre-baked AI prompts the user can click.

**Cost:** 0.5 day.

**Files:** `canvas.ts` (when `def.steps.length === 0`, render an empty-state card with sample prompts).

---

### Track C — Sharing & community (drives adoption)

If the bottleneck is "users can't find routines, and authors can't ship them", this is the track.

#### C1. Import / export JSON
**Why:** Lowest-friction sharing primitive. Copy a routine def → paste in Slack → someone else imports.

**Cost:** 0.5 day.

**Implementation sketch:**
- Add "Export" button in the editor header → opens a modal with the JSON in a textarea + a Copy button.
- Add "Import" button → modal accepts pasted JSON, runs it through `wpdm_routine_validate_def`, shows errors if any, otherwise creates a new routine in `draft` state.

**Files:** `index.ts` (two buttons + modal), reuses `installTemplate` REST shape.

#### C2. Templates gallery
**Why:** Currently we ship 3 starter recipes via `desktop_mode_register_routine_template`. A real gallery — searchable, categorised, with previews — would let plugin authors and the community contribute idiomatic routines.

**Cost:** 1 day.

**Implementation sketch:**
- Existing REST: `GET /wp-desktop/v1/routines/templates` returns registered templates. Already in catalog.
- Existing modal: a basic "Browse templates" picker in `index.ts`.
- Upgrade: tabbed by category, search field, preview pane that mounts the canvas in read-only mode for the selected template, "Install" button at the bottom.
- Plugin authors get more `desktop_mode_register_routine_template` hooks called from their bootstrap.

**Files:** `index.ts` (rewrite the templates picker into a real gallery), maybe a new `gallery.ts`.

#### C3. Sub-routines (call routine from routine)
**Why:** Lets users factor common sequences into reusable named routines. Pair with the existing `desktop_mode_routine_after_run` trigger for chaining.

**Cost:** 0.5 day.

**Implementation sketch:**
- New step kind `sub_routine` with `args.id` (target routine id).
- Handler in `includes/routines/steps.php`: looks up the routine, calls `wpdm_routine_run( $args['id'], $context['payload'] )`. The payload passes through.
- Loop detection: track a `_sub_routine_stack` in context, refuse to enter a routine already on the stack.

**Files:** `schema.php` (add to known step kinds), `steps.php` (handler), `executor.php` (loop detection in dispatch), `picker.ts` (list available routines as targets).

**Gotchas:**
- Capability check: the sub-routine runs with the OUTER routine's `run_as`. Document clearly.
- Infinite loops: bound the stack depth to ~10. Surface as a step-failed.

#### C4. Public shareable URL
**Why:** "Hey, install my Big-Order-Slack routine" → click a URL → land in your site's Routines window with the def pre-loaded for review.

**Cost:** 1 day.

**Implementation sketch:**
- Export uses base64url-encoded JSON in the URL fragment (`#/import?def=<base64>`).
- On window open, parse fragment, show "Someone shared a routine with you — preview it?" banner.
- Preview = mount canvas in read-only mode; "Install" creates a draft.

**Files:** `index.ts` (URL parsing on mount), `canvas.ts` (read-only mode flag).

**Gotchas:**
- A def is bounded but can be ~5KB. URL fragments handle ~100KB on most browsers — fine.
- Re-validate after decoding (defence in depth — same posture as the AI generator).

---

## Phase 5+ — longer-term ideas (not yet scoped)

Sketched at the bottom because they need design conversations, not just implementation.

| Idea | What it is | Why |
|---|---|---|
| **Routine analytics** | Aggregate runs/errors over time per routine — "Spam Sentinel blocked 432 comments this month" | Social-proof + admin dashboard kit |
| **AI fix-it** | When a run fails, AI looks at the error + the routine def + suggests a patch | Closes the loop on the AI feature |
| **AI suggestions** | "You have 3 drafts older than 30 days — want a routine to remind you?" — proactive AI | Pull, not push |
| **Mobile-friendly canvas** | The grid + Pixi layer don't lay out cleanly on phones. Mobile = tabs of cards. | Phase 5–6 mobile work in CLAUDE.md |
| **Approval workflow** | A step kind that pauses + asks an admin to approve/deny before continuing | HR / publishing gates |
| **Multi-user collab** | Two admins editing the same routine, presence + cursors | Builds on `wp.desktop.presence` |
| **Routine REST control** | External services CRUD routines via REST + bearer | Headless integrations |
| **Activity inbox** | Cross-routine event stream — "what fired today, with what" | The killer P3 alternative I proposed earlier |

---

## How to start

1. Pick a track (A / B / C). One per release.
2. Pick a feature within the track. Read its sketch + gotchas.
3. Read the relevant files (the sketch lists them).
4. Branch from `feat/routines` if it's still active, else from `trunk`.
5. Add tests alongside the code (PHPUnit for engine, Vitest for TS where the harness exists).
6. **Update [`routines.md`](./routines.md)** with any new public surface — that doc is the contract with plugin authors.
7. Commit with a Conventional-Commits-ish prefix (`feat(routines):`, `fix(routines):`, etc.). Stay on the same branch unless told otherwise.

## How to NOT start

- **Don't add a feature without a use case.** "Wouldn't it be cool if…" features rot. Each item above has a one-line "Why" — if you can't write one for your idea, scope it down or skip it.
- **Don't break the public API.** Every `desktop_mode_register_routine_*`, `wpdm_routine_*`, `desktop_mode_routine_*` filter/action is a contract. Backwards-incompatible changes need a major-version bump.
- **Don't expand the catalog without considering AI impact.** Every new trigger or action lands in the AI generator's system prompt. Too many → context bloat → worse generations. Keep additions justified.
- **Don't bypass `wpdm_routine_validate_def`.** Every code path that creates or accepts a def must run it. Trust nothing — not user input, not the AI, not your own previous code.

## Test bar

Before merging a P4 feature:

- [ ] PHPUnit covers the new PHP surface (`@group desktop-mode`).
- [ ] Vitest covers any new TS module that's pure logic.
- [ ] `npm run lint` clean on every touched TS file.
- [ ] `tsc --noEmit` clean.
- [ ] `npm run build` produces the dev + prod bundles without warnings.
- [ ] [`routines.md`](./routines.md) updated with the new hook / step / trigger / API.
- [ ] Manual smoke test: open the Routines window, build a routine that uses the new feature, run it, verify outcome.

---

## Authoring conventions

Every new file inherits the project's style. The shortcuts:

**PHP** — `defined( 'ABSPATH' ) || exit;` first line. PHPDoc on every public function. WordPress coding standards (tabs, `snake_case`). `wp_kses` / `esc_*` / `sanitize_*` on every boundary. `WP_Error` returns, never exceptions across the public surface.

**TypeScript** — Strict mode. No `any`. Tabs, `camelCase`. JSDoc on every exported function. `import type` for type-only imports. No jQuery. PointerEvent for any drag/touch.

**CSS** — Tabs, BEM-ish (`wpdm-routines__thing`). Logical properties for RTL (`margin-inline-start`, not `margin-left`). CSS variables for accent colours.

**Tests** — Black-box behaviour, not implementation details. Each test should answer "if a routine author does X, do they get Y?" — not "did this internal helper return Z?"

**Commits** — Conventional commits, imperative mood, **Why** in the body, not just **What**. Co-author tag for AI-assisted work.

---

## Reference architecture (one diagram)

```
                 ┌────────────────────────────────────────────────┐
                 │            Routines window (native)            │
                 │  ┌──────────┐  ┌────────────────────────────┐  │
                 │  │ sidebar  │  │  ┌──── tabs ────────────┐  │  │
                 │  │ list +   │  │  │  Designer  Recent    │  │  │
                 │  │ templates│  │  └──────────────────────┘  │  │
                 │  │          │  │  ┌──── composer ────────┐  │  │
                 │  │          │  │  │  ✨ "Describe it…"   │  │  │
                 │  │          │  │  └──────────────────────┘  │  │
                 │  │          │  │  ┌──── canvas ──────────┐  │  │
                 │  │          │  │  │  trigger ▾ gate ▾    │  │  │
                 │  │          │  │  │  steps + branches    │  │  │
                 │  │          │  │  │  Pixi layer beneath  │  │  │
                 │  │          │  │  └──────────────────────┘  │  │
                 │  │          │  │  ┌──── action bar ──────┐  │  │
                 │  │          │  │  │  Save Test Run …     │  │  │
                 │  │          │  │  └──────────────────────┘  │  │
                 │  └──────────┘  └────────────────────────────┘  │
                 └────────────────────────────────────────────────┘
                                       │
                                       │  fetch
                                       ▼
                 ┌────────────────────────────────────────────────┐
                 │         REST  /wp-desktop/v1/routines/*        │
                 │   GET, POST, PATCH, DELETE, /test, /run,       │
                 │   /enable, /runs, /catalog, /templates,        │
                 │   /from-template, /from-prompt                 │
                 └────────────────────────────────────────────────┘
                                       │
                                       ▼
                 ┌────────────────────────────────────────────────┐
                 │            Engine  (includes/routines/)        │
                 │   schema.php   ← validator                     │
                 │   executor.php ← walks steps, dispatches       │
                 │   triggers.php ← add_action wires routines     │
                 │   steps.php    ← built-in step handlers        │
                 │   ai-generate  ← OpenAI structured output      │
                 │   run-history  ← custom table                  │
                 └────────────────────────────────────────────────┘
                                       │
                                       │  fires
                                       ▼
                 ┌────────────────────────────────────────────────┐
                 │            Side effects in WordPress           │
                 │     wp_mail, wp_remote_post, wp_set_role,      │
                 │     update_option, wp_trash_comment, …         │
                 └────────────────────────────────────────────────┘
```

That's the whole system in one screen. P4 features mostly extend the **engine** (new step kinds / trigger kinds) and the **canvas** (new affordances) — REST + window are stable.

---

Questions or fork-points? Open an issue tagged `routines` or DM the current maintainer.
