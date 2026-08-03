---
title: "feat: AI Agents as synthetic users with user-meta storage (PR #240, restoraged)"
type: feat
status: draft
date: 2026-07-27
---

# feat: AI Agents as synthetic users with user-meta storage (PR #240, restoraged)

## Summary

Implement OpenStation Agents: durable, addressable workers that live on the site as real WordPress users, take orders by chat, send-to, drag, hook, or HTTP, and act through the WordPress Abilities API under the agent's own role and capabilities. The objectives, trigger model, tools model, security posture, and build order come from PR #240. The one deliberate departure from that PR: there is no `wp_guideline` CPT layer. Everything that defines an agent beyond its `wp_users` row (system prompt, description, ability allowlist, triggers, model override, rate limit) is stored as user meta on the agent's user. Two layers instead of three: the user row is the identity, its meta is the definition.

---

## Problem Frame

PR #240 ([WordPress/desktop-mode#240](https://github.com/WordPress/desktop-mode/pull/240), branch `origin/my-agents`) shipped a UX mock plus an architecture manifesto, and the branch actually carries a near-complete implementation (~12k lines: identity, behaviour, bindings, abilities bridge, runner, REST, My WordPress UI, run window, send-to dispatcher, six PHPUnit suites, three vitest suites). Two reasons we cannot merge or rebase it as-is:

1. **Storage direction changed.** The PR stores agent behaviour in the `wp_guideline` CPT (the Dolly / Push MD / Guidelines-experiment shape) to get ecosystem portability. Product direction is now: agent data lives as user meta on the agent's user row. This also removes the branch's hardest dependency, the Gutenberg Guidelines experiment soft-gate (`gutenberg-gate.php`, the 412 "storage unavailable" path, the `read_guidelines` capability shims), because user meta always exists.
2. **The branch is on a stale base.** It forked at 0.8.8, before the 0.9.4 AI migration. Trunk (0.9.7) removed `openstation_register_ai_tool()` and `openstation_register_ai_provider()`; tools are now the WP Abilities API (`wp_register_ability` / `wp_get_abilities`) and the LLM is reached through WP 7.0 Core Connectors + AI Client (`wp_ai_client_prompt()` via `includes/ai-copilot/client.php`). The branch's runner calls `openstation_ai_openai_responses_call()`, which no longer exists.

So the work is: re-extract PR #240's requirements, keep its build order and security model, port the branch's good parts onto trunk's current AI substrate, and collapse the behaviour layer into user meta.

---

## Requirements

Extracted from PR #240's body. Markers: **[kept]** unchanged, **[adapted]** same objective with a trunk-reality or storage change, **[dropped]** consciously not carried over.

### Identity (Layer 1) — [kept]

- R1. Each agent is a real `wp_users` row with a standard WP role (`administrator`, `editor`, `author`, `contributor`). Capability checks are real WP checks; a tool call the agent's role cannot perform fails the same way it would for a human.
- R2. Login is fully blocked: the `authenticate` filter rejects agents, password resets are disabled, cookie/REST auth refuses them, application passwords cannot be created for them, no email is ever sent to them (synthetic reserved address).
- R3. Identity surface works end to end: avatar, display name, attribution on revisions, comments, `_edit_lock`, and audit trails show the agent as the actor.

### Definition (was Layers 2+3) — [adapted: all user meta]

- R4. The agent's behaviour (system prompt, "when to use" description, ability allowlist) is editable from the OpenStation UI. **Adapted:** stored as user meta on the agent's row, not as a `wp_guideline` post.
- R5. Site-specific bindings (trigger configuration, per-agent model override, per-agent rate limit) are user meta on the agent's row. This part already matched the PR (its Layer 3).
- R6. **[dropped]** Push MD / Claude Code / Codex ecosystem portability via `wp_guideline` (`skills/{slug}/SKILL.md` materialisation), and skills-as-attachable-child-guidelines. With user-meta storage there is no CPT for those tools to consume. If portability returns later it will be an explicit export surface, not the storage layer.

### Triggers — [kept]

- R7. Five trigger kinds, one engine: **chat** (double-click the agent, conversation window), **drag & drop** (drop a tile onto the agent), **hook** (subscribe to a WP action such as `save_post` / `wp_insert_comment`), **REST endpoint** (authenticated `POST` to a per-agent route), **agent-to-agent** (one agent's output feeds another). The branch added a sixth that we keep because it shipped as the mock's first working surface: **send-to** (agent appears in the right-click "Send to…" menu for chosen entity kinds).
- R8. All triggers collapse to the same loop: a message arrives, the agent's system prompt + message become an LLM call, the model picks tools off the allowlist, tools run as the agent's user, the result is the trigger's return value. Drag is chat with a payload; a hook is chat where the message is the hook args; an endpoint is chat where the body is the message.
- R9. Trigger configuration carries its own auth (capability for chat, REST permission for endpoints, the firing context for hooks). The agent never runs un-gated.

### Tools — [adapted to trunk]

- R10. Tools are the WordPress Abilities API: the picker is a view over `wp_get_abilities()`, each pick is stored on the agent (allowlist meta), each call is dispatched through `WP_Ability::execute()` so the ability's own `permission_callback` and schemas gate it. Any plugin that registers an ability becomes agent-compatible with zero bespoke integration. **Adapted:** the PR's fallback registry `openstation_register_ai_tool()` no longer exists; abilities are the only tool source.
- R11. Selecting a tool never elevates: capabilities are inherited from the agent's role, not granted by the picker.

### LLM — [adapted to trunk]

- R12. Bring-your-own model via WP Core Connectors + AI Client (trunk reality; the PR predates the removal of `openstation_register_ai_provider`). No connector configured: "Create agent" is disabled with a notice linking `options-connectors.php`; existing agents remain visible for audit. Availability check is the existing `openstation_ai_is_available()` / `openstation_ai_provider_configured()` pair.
- R13. Per-agent model override is a binding (user meta), passed to the AI Client per call when set.

### Security — [kept]

- R14. Agents are users: every action lands in the existing audit trail with the agent's user ID as actor. No parallel ACL.
- R15. Tool results are sanitised before re-entering the LLM context; no outbound credentials in payloads.
- R16. Behaviour changes are auditable. **Adapted:** user meta has no revisions (this is the real cost of leaving `wp_guideline`). Mitigation in D6 below.

### Surface and rollout — [kept]

- R17. UI home is an "Agents" section in the My WordPress window: list on the left, Define / Tools / Triggers panes on the right, "+ Create agent" flow.
- R18. Everything ships behind a feature flag until the contract settles.
- R19. **[deferred]** Marketplace (packaged agent definitions shipped by third parties) is out of scope for this plan; noted as future work.

---

## Scope Boundaries

- No `wp_guideline` reads or writes anywhere in the module. No Gutenberg or Guidelines-experiment dependency, no `gutenberg-gate.php` port, no `read_guidelines` capability shims.
- No Push MD export in v1 (candidate follow-up: a read-only exporter that projects agent meta into SKILL.md shape).
- No skills entity in v1. The system prompt is the behaviour. If reusable snippets are wanted later they can become an additional meta key or the export surface above.
- No streaming in the chat window v1 (the invoke REST route is request/response; the existing admin-ajax SSE pattern from AI Copilot is the follow-up path).
- No anonymous REST-endpoint trigger in v1; endpoint auth is capability or application-password based. Anonymous mode with rate limits is a follow-up.
- No conversation-history persistence in v1 (the PR's "history per user × agent"); the chat window keeps history in a shared store for the session. Persistence is a follow-up decision (likely user meta on the human, not the agent).
- No marketplace.
- WordPress < 7.0 (no Abilities API / AI Client): the module loads its storage + UI but the runner and invoke routes return the same unavailability the AI Copilot does; creation is gated exactly like R12.

### Deferred to Follow-Up Work

- Streaming invocations over the existing SSE pattern.
- Anonymous endpoint trigger + per-route rate limiting UI.
- Conversation persistence and a transcript viewer.
- Push MD-shaped exporter.
- Marketplace / packaged agents.
- Desktop tiles for agents as first-class desktop icons (v1 reaches agents through My WordPress and the send-to menu; a per-agent desktop tile rides the existing icons registry once drag lands).

---

## Context & Research

### Trunk surfaces this builds on (verified on 0.9.7)

- **AI substrate:** `includes/ai-copilot/client.php` (`openstation_ai_client_generate()` adapter over `wp_ai_client_prompt()`, token/model telemetry helpers), `settings.php` (`openstation_ai_is_available()`, `openstation_ai_provider_configured()`, `/ai/status` route, `connectorsUrl`), `abilities.php` (ability category, tool-name mangling `openstation_ai_ability_tool_name()`, output-schema helper).
- **Windows:** `openstation_register_window()` (`includes/registries/native-windows.php:143`) + `openstation_register_icon()`; multi-instance support in `src/window-manager/index.ts` (`open()` by baseId, `openNew()`); `config` arg surfaces as `wp.os.getWindowConfig(id)`.
- **My WordPress:** `openstation_my_wordpress_entities()` + filter `openstation_my_wordpress_entities` (`includes/my-wordpress/window.php:69`); TS seam `registerEntityKind( kind, renderer )` in `src/my-wordpress/kind-registry.ts` (no monolith edits to `index.ts` needed).
- **Drag:** `wp.os.dragManager` (`src/drag/manager.ts`, `drop-target-registry.ts`: `DropTarget { id, element, accept, onDrop, acceptLabel }`), cross-iframe carrier `src/drag-bridge.ts`.
- **Feature flag:** `includes/extended-options.php` (`openstation_get_extended_options()` defaults + REST), bootstrap early-return pattern at `includes/games/bootstrap.php:40-47`, admin-only checkbox in `src/settings/sections/extended.ts`.
- **REST conventions:** namespace `desktop-mode/v1`, routes registered in the owning module on `rest_api_init`, central index `includes/rest/README.md` must gain rows.
- **Users:** users window enriches core `wp/v2/users` via `register_rest_field` (`includes/users-window/window.php:466`); existing plugin user-meta keys all use a `openstation_` / `_openstation_` prefix; avatars via `get_avatar_url()` server-side and `<os-avatar>` client-side.
- **Async jobs precedent:** `includes/ai-copilot/{jobs,hooks}.php` (cron single-event + transient dedup) for the hook trigger.

### Prior art: branch `origin/my-agents` (fork point 0.8.8)

Port targets, in decreasing reusability:

- **Port nearly as-is:** `identity.php` (marker meta `_desktop_mode_agent`, `agent-<slug>` login resolution, synthetic email, login/reset/app-password blocks, wp-admin Users column), `bindings.php` (trigger kinds registry + `openstation_agent_trigger_kinds` filter, triggers/model/rate-limit meta), `privacy.php`, `run-window.php` + `src/agent-run-window.ts` (shared-store-driven run window), `src/agents-send-to.ts`, most of `src/my-wordpress/agents-*.ts`, all test suites (rewritten expectations, same coverage map).
- **Port with rework:** `rest.php` (route map is right: CRUD + `/invoke` + `/abilities` + `/trigger-kinds` + `/hooks-catalogue` + `/send-to-targets` + `/dossier`; drop the 412 storage soft-gate and guideline capability shims, swap permissions per D7), `abilities.php` (catalogue shape stays, feed from `wp_get_abilities()` with the readonly/mutating distinction per D4), `runner.php` (keep the loop shape, turn cap, and identity switch; replace the OpenAI Responses transport with `openstation_ai_client_generate()`).
- **Do not port:** `behaviour.php`, `gutenberg-gate.php`, everything referencing `wp_guideline`, `guideline_source`, `wp_guideline_type`, `_openstation_agent_guideline_id`.

### Implementation gotchas surfaced by research

- The AI Copilot advertises only `readonly`-annotated abilities to its assistant (prompt-injection posture, `includes/ai-copilot/abilities.php:66`). Agents deliberately differ: mutating abilities are the point ("an agent that does things"). The compensating controls are the explicit per-agent allowlist set by a privileged human, the agent's role, and each ability's own `permission_callback` (D4).
- `wp_insert_user` requires an email; the branch's synthetic reserved-address helper exists precisely to satisfy schema validation while guaranteeing nothing is ever delivered. Keep it, and keep `email_exists()` uniqueness.
- Role assignment on create must respect `get_editable_roles()` for the acting user, or a lower-privileged user could mint an administrator agent (WP's own promote semantics).
- The runner switches identity (`wp_set_current_user`) so ability permission callbacks see the agent. The switch must be wrapped so the original user is restored on every path including exceptions, and nothing else in the request (nonce checks already done, response rendering) runs as the agent.
- Hook triggers must not run the LLM synchronously inside `save_post` (blocks the editor save round-trip). Reuse the AI Copilot's cron single-event + transient dedup pattern.
- Agents appear in `wp/v2/users` and the Users window like any user. They need a visible badge and a way to exclude them from "real people" flows (bulk password reset, welcome emails) without hiding them from audit.

---

## Key Technical Decisions

- **D1. Storage model: one user, one meta namespace.** All agent data hangs off the agent's `wp_users` row:

  | Meta key | Content | Notes |
  |---|---|---|
  | `_desktop_mode_agent` | `'1'` marker | Existence test; from the branch, unchanged |
  | `_desktop_mode_agent_description` | "when to use" short text | Was `post_excerpt` |
  | `_desktop_mode_agent_instructions` | system prompt (markdown, `wp_kses_post` on write) | Was `post_content` |
  | `_desktop_mode_agent_abilities` | JSON array of ability slugs | Was post meta on the guideline |
  | `_desktop_mode_agent_triggers` | JSON array of `{ kind, config }` | Same shape as the branch |
  | `_desktop_mode_agent_model` | string, empty = platform default | Same as branch |
  | `_desktop_mode_agent_rate_limit` | int invocations/hour, 0 = default | Same as branch |
  | `_desktop_mode_agent_created_by` | creating user ID | New; audit aid |

  Name = `display_name`; slug = `user_login` minus the `agent-` prefix; avatar = the user's avatar. Single-value meta, JSON-encoded arrays (one row each) so a read is one `get_user_meta` call and the shape round-trips through REST cleanly. All keys registered via `register_meta( 'user', … )` with sanitize callbacks, `show_in_rest => false` (the module's own REST surface is the only reader/writer; core `wp/v2/users` never exposes them).
- **D2. No substrate gate.** User meta always exists, so the branch's `openstation_agents_storage_available()` soft-gate, the 412 responses, and the "Enable Guidelines experiment" empty state are deleted, not ported. The only gates left are the feature flag and AI availability.
- **D3. Runner on the Core AI Client.** `openstation_agent_invoke( $agent_user_id, $message, $context )` builds function declarations from the allowlisted abilities' `input_schema`, calls `openstation_ai_client_generate()` (which wraps `wp_ai_client_prompt()`), executes returned function calls via `wp_get_ability()->execute()` as the agent user, feeds outputs back, loops to a hard cap (`OPENSTATION_AGENT_RUNNER_MAX_TURNS = 8`), returns `{ text, toolCalls, turns }`. Model override meta is applied per call when the AI Client supports model selection for the active connector.
- **D4. Ability catalogue: full registry, honest labelling.** The picker lists every registered ability (not only readonly ones), grouped by category, with a clear read-only vs mutating badge driven by `meta.annotations.readonly`. Execution-time safety is the ability's `permission_callback` evaluated against the agent user plus the agent's role. A filter `openstation_agent_allowed_abilities` lets sites narrow the pickable set.
- **D5. Feature flag `agents`** in `openstation_get_extended_options()` defaults (off). `includes/agents/bootstrap.php` early-returns when off, mirroring `includes/games/bootstrap.php`, so no windows, icons, REST routes, or hook subscriptions exist until an admin opts in.
- **D6. Audit without revisions.** Every mutation through the module fires `openstation_agent_updated( $agent_id, $changed_fields, $actor_id )` (plus `_created` / `_deleted` siblings) carrying before/after values, so logging plugins can persist a trail. v1 does not write its own changelog storage. This is the accepted trade-off vs `wp_guideline`'s free revisions, and it is called out in the docs.
- **D7. Permission model.**
  - Read (list/get/catalogues): filterable, default `edit_posts` (matches the My WordPress gate so the section is visible to the same audience as the window hosting it).
  - Create/update/delete: `edit_users` (agents are real users; managing them is user management), and role assignment additionally constrained by `get_editable_roles()`.
  - Invoke (chat/send-to/drag): filterable capability, default `edit_posts`, plus the per-agent rate limit.
  - Hook trigger: runs in whatever context fired the hook; the subscription itself can only be configured by `edit_users`.
  - Endpoint trigger: per-trigger auth choice (capability | application password), configured with the trigger.
- **D8. Identity switch is scoped.** The runner wraps `wp_set_current_user( $agent )` in try/finally and restores the invoking user immediately after the tool loop; the REST response is composed as the human. Nested invocations (agent-to-agent) re-enter the same wrapper with a depth guard.
- **D9. UI integration via existing seams only.** `openstation_my_wordpress_entities` filter adds the Agents entry; `registerEntityKind( 'agent', renderer )` renders it; the run/chat window is a normal `openstation_register_window()` registration with multi-instance opens per agent; drop targets go through `wp.os.dragManager.registerDropTarget`. No new mechanisms.

---

## Open Questions

### Resolved During Planning

- Storage layer: user meta on the agent's user row, per product direction (this is the reason this plan exists). The `wp_guideline` path and its Gutenberg dependency are out.
- Tool source: Abilities API only; the removed `openstation_register_ai_tool` registry is not resurrected.
- LLM transport: Core Connectors + AI Client through the existing `client.php` adapter; no plugin-owned provider registry or API key.
- Send-to stays as the sixth trigger kind (proven in the mock, cheapest real invocation surface).

### Deferred to Implementation

- Whether the Users window badges agents inline (default assumption: yes, via the existing `register_rest_field` enrichment plus a `<os-*>` badge) or offers a filter toggle to hide them.
- Exact chat-window layout (single run window with per-agent instances vs a dedicated chat window; default assumption: evolve the branch's run window into the chat surface).
- Whether model override is exposed in v1 UI or meta-only until the AI Client's model enumeration is ergonomic.
- Rate-limit accounting storage (transient per agent-hour is the default assumption).

---

## High-Level Technical Design

```
wp_users row (role, display_name, user_login 'agent-<slug>', avatar)
  └── user meta                            ← the whole agent definition
      _desktop_mode_agent                = '1'
      _desktop_mode_agent_description    ┐
      _desktop_mode_agent_instructions   ├ behaviour  (was wp_guideline)
      _desktop_mode_agent_abilities      ┘
      _desktop_mode_agent_triggers       ┐
      _desktop_mode_agent_model          ├ bindings   (unchanged from PR)
      _desktop_mode_agent_rate_limit     ┘

Trigger intakes                     Engine                        Effects
  chat window        ─┐
  send-to menu       ─┤   POST /desktop-mode/v1/agents/{id}/invoke
  drag drop          ─┼─► openstation_agent_invoke()             ─► WP_Ability::execute()
  hook subscription ─┤     (switch to agent user,                     as the agent user
  endpoint route     ─┤      prompt+message → wp_ai_client_prompt,  ─► openstation_agent_completed
  agent-to-agent    ─┘      tool loop ≤ 8 turns, restore user)         (feeds chaining + run window)
```

Module layout mirrors the branch minus the guideline files:

```
includes/agents/            src/
  bootstrap.php               my-wordpress/agents-renderer.ts   (kind renderer + panes)
  identity.php                my-wordpress/agents-rest.ts       (client for /agents)
  store.php     (meta CRUD)   my-wordpress/agents-types.ts
  abilities.php (catalogue)   my-wordpress/agents-abilities.ts  (picker)
  runner.php                  my-wordpress/agents-triggers-ui.ts
  rest.php                    agents-send-to.ts                 (send-to + drop targets)
  triggers.php  (hook/endpoint wiring)
  run-window.php              agent-run-window.ts               (chat/run window bundle)
  privacy.php
```

`store.php` replaces the branch's `behaviour.php` + the meta halves of `bindings.php`: one module owning every meta key, its sanitization, `register_meta` calls, and the `openstation_agent_{created,updated,deleted}` actions.

---

## Implementation Units

### U1. Scaffold, flag, storage, identity *(Phase A)*

`agents` key in extended options (default off) + checkbox in `src/settings/sections/extended.ts`; `includes/agents/bootstrap.php` with the games-style early return; `store.php` (meta keys, `register_meta`, CRUD helpers `openstation_agent_create/update/delete/get/list`, JSON sanitization, audit actions); `identity.php` ported (marker meta, unique `agent-` login, synthetic email, `authenticate` + `allow_password_reset` + application-password + REST cookie blocks, editable-roles enforcement, wp-admin Users column, delete = `wp_delete_user` with content reassignment choice); `privacy.php` ported. Uninstall cleanup added to the plugin's existing uninstall path.
PHPUnit: `agentsStore.php`, `agentsIdentity.php` (adapt branch suites). No UI yet.

### U2. Abilities bridge + runner *(Phase A)*

`abilities.php`: catalogue helper over `wp_get_abilities()` with readonly/mutating annotation and the `openstation_agent_allowed_abilities` filter; projection of an ability's `input_schema` into a function declaration (reuse `openstation_ai_ability_tool_name()` and the copilot's schema normalisation). `runner.php`: `openstation_agent_invoke()` per D3/D8, rate-limit check, `openstation_agent_completed` action, turn cap, tool-result sanitization mirroring the copilot's.
PHPUnit: `agentsRunner.php` with a stubbed AI client (network-free, following `aiSearchExtensibility.php`'s pure-function style), `agentsAbilities.php`.

### U3. REST surface *(Phase A)*

`rest.php`: `GET/POST /agents`, `GET/POST/DELETE /agents/{id}`, `POST /agents/{id}/invoke`, `GET /agents/abilities`, `GET /agents/trigger-kinds`, `GET /agents/hooks-catalogue`. Drop `/dossier` and `/send-to-targets` from v1 unless the UI port needs them. Permissions per D7. Rows added to `includes/rest/README.md`.
PHPUnit: `agentsRest.php` (adapt branch suite; delete every 412/guideline expectation).

### U4. My WordPress Agents UI *(Phase A)*

PHP: add the `agents` entity through the `openstation_my_wordpress_entities` filter (bot SVG icon from the branch), gated on the read permission. TS: `registerEntityKind( 'agent', … )` renderer with list + Define / Tools / Triggers panes, create dialog (`<os-text-field>`, role select from an editable-roles endpoint field, `<os-confirm-dialog>` for delete), abilities picker (`<os-checkbox-label>` list with mutating badges), provider-not-configured notice reusing `aiStatus` + `connectorsUrl`. All requests via `trackedFetch` with `source: 'desktop-mode/agents'`.
Vitest: `agents-renderer.test.ts`, `agents-rest.test.ts` (adapt branch suites).

### U5. Chat trigger + run window *(Phase A)*

`run-window.php` + `src/agent-run-window.ts` ported: native window (multi-instance per agent via `openNew`/baseId-per-agent), shared store (`createSharedStore`) the dispatcher writes invocation progress into, chat input posting to `/invoke`, transcript rendered in-window for the session. Double-click on an agent row opens it.
Vitest: run-window store/render tests.

### U6. Send-to + drag triggers *(Phase B)*

`src/agents-send-to.ts` ported: harvest agents whose triggers include `send-to` for the matching entity kind, inject into tile context menus, dispatch to `/invoke` with the entity payload serialised into the message, open the run window. Drag: register `DropTarget`s for agent rows (and future tiles) accepting the payload manifest from the trigger config (`entityKinds` / `mimeTypes`), `drag-bridge.ts` for iframe-sourced drags. Trigger config UI for both kinds in the Triggers pane.
Vitest: `agents-send-to.test.ts`, drop-target acceptance tests.

### U7. Hook trigger *(Phase C)*

`triggers.php`: on init (flag on), read all agents' `hook` triggers, subscribe to a **whitelisted** hooks catalogue (`save_post`, `wp_insert_comment`, `transition_post_status`, filterable via `openstation_agent_hook_catalogue`); on fire, enqueue a cron single event with transient dedup (copilot jobs pattern), serialise hook args into the message, invoke asynchronously. Loop guard: suppress subscriptions while a runner invocation is in flight for the same agent.
PHPUnit: `agentsTriggers.php` (subscription build, dedup, loop guard).

### U8. Endpoint trigger *(Phase C)*

Per-agent route `POST /desktop-mode/v1/agents/{slug}/endpoint`, registered only for agents with an `endpoint` trigger; auth mode from trigger config (capability check or application-password identity of the caller; anonymous deferred). Body becomes the message; response is the runner result.
PHPUnit: route registration on/off per trigger presence, auth modes.

### U9. Agent-to-agent trigger *(Phase C)*

Chaining consumer on `openstation_agent_completed`: agents with an `agent` trigger naming a source agent receive the source's result as their message. Depth cap (reuse the runner's turn-cap constant family) + cycle detection on the chain path.
PHPUnit: chain execution, loop detection.

### U10. Documentation *(rides each phase's PR)*

See Documentation Plan.

---

## System-Wide Impact

- **Users surfaces:** agents appear in `wp/v2/users`, the Users window, and author dropdowns. U1 ships the wp-admin column; U4 adds the OpenStation badge via the existing users-window `register_rest_field` enrichment. Bulk actions that email users (password reset, welcome) must skip agents (guard in the existing bulk routes).
- **Presence:** agents never heartbeat, so they read as `offline`; no change needed, but the badge should prevent "why is this user always offline" confusion.
- **Payload:** no changes to `openstation_build_menu_payload()` in v1 (Agents lives inside My WordPress + its own window registration, both already carried). A future per-agent desktop tile would ride `openstation_icons`.
- **AI Copilot:** untouched. The runner reuses `client.php` helpers but registers nothing on the copilot's hook surface. A follow-up could expose agents to the copilot as commands.
- **Uninstall/cleanup:** deleting the plugin must decide what happens to agent users (default: leave them, they are inert without the module; document it). Deactivating the flag hides surfaces but keeps data.

---

## Risk Analysis & Mitigation

- **Prompt injection into mutating tools** (agent reads attacker-controlled content, model calls a destructive ability): per-agent explicit allowlist set by `edit_users` humans, agent role capping blast radius, ability `permission_callback` as the hard gate, tool-result sanitization, turn cap, `openstation_agent_completed` audit action. Recommend-in-docs: least-privilege roles (`author` for content agents, never `administrator` unless unavoidable).
- **Privilege escalation via agent creation:** role constrained by `get_editable_roles()` of the acting user; create/update/delete gated on `edit_users`; the runner refuses users lacking the marker meta.
- **Login-surface regressions:** the branch's three-layer block (authenticate filter, password reset, app passwords) plus REST cookie refusal, each covered by dedicated PHPUnit cases; synthetic email never deliverable.
- **Runaway cost:** hard turn cap, per-agent rate-limit meta enforced in the runner, cron dedup on hook triggers, chain depth cap + cycle detection.
- **Audit gap (no revisions on meta):** D6 actions with before/after payloads; documented loudly as the trade-off of the storage model; changelog storage is a clean follow-up if needed.
- **Stale-branch drift during the port:** treat `origin/my-agents` as reference only; every file is re-authored against trunk, never cherry-picked, and the test suites are the checklist of behaviours to preserve.
- **WP < 7.0 sites:** storage and UI degrade to read-only-with-notice exactly like the AI Copilot; no fatal paths (`function_exists` guards mirror `includes/ai-copilot/`).

---

## Phased Delivery

- **Phase A (U1-U5 + docs):** flag, storage, identity, runner, REST, My WordPress UI, chat. Outcome: an admin can flip the flag, create an agent, pick abilities, chat with it, and watch it call tools as itself. This is the PR's build-order steps 1-3, 5, 6 with user-meta storage (step 4, the Push MD audit, is dropped with the storage change).
- **Phase B (U6 + docs):** send-to and drag intake. Outcome: "drop the post onto the agent" works, the PR's North Star.
- **Phase C (U7-U9 + docs):** hook, endpoint, and agent-to-agent triggers. Outcome: full five-trigger model.

Each phase is a separate branch + PR, feature flag stays off by default throughout; the flag's default flips only when the contract is declared stable (separate decision).

---

## Documentation Plan

- `docs/hooks-reference.md`: `openstation_agent_{created,updated,deleted,completed}` actions; `openstation_agent_trigger_kinds`, `openstation_agent_allowed_abilities`, `openstation_agent_hook_catalogue`, permission filters.
- `docs/javascript-reference.md`: agents REST client surface, run-window shared-store key, send-to integration points.
- `docs/api-index.md` + `includes/rest/README.md`: new PHP functions and REST routes.
- `docs/architecture.md`: the two-layer agent model (user row + meta), runner flow, trigger engine.
- `docs/examples/agents.md`: rewrite of the branch's example for the meta-backed API (register a trigger kind, invoke an agent programmatically), indexed in `docs/examples/README.md`.
- Migration note: none needed (new surface, flag off), but the audit trade-off (D6) and the least-privilege role recommendation go in the example and architecture docs.

---

## Sources & References

- PR #240 body (objectives, three-layer model, five triggers, abilities-as-tools, security posture, build order): https://github.com/WordPress/desktop-mode/pull/240
- Branch `origin/my-agents` (commits `6b598c80`, `c3e3b1a5`, `13f830f5`): prior implementation used as reference, fork point 0.8.8.
- Trunk AI substrate: `includes/ai-copilot/{client,settings,abilities,search}.php`, `docs/migration-ai-connectors.md` (removal of provider registry + tool registry in 0.9.4).
- Extension seams: `includes/registries/native-windows.php`, `includes/my-wordpress/window.php`, `src/my-wordpress/kind-registry.ts`, `src/drag/`, `includes/extended-options.php`, `includes/games/bootstrap.php` (flag pattern), `includes/ai-copilot/{jobs,hooks}.php` (async pattern).
