# Routines — visual automation for WordPress

> **Status:** Phase 3 (Stable engine, visual canvas + JSON editor, trigger picker, payload-aware variable autocomplete, **AI "Describe it"**). Record Mode and Listen Mode are deferred — `from-prompt` covers the killer-feature use case.

Routines are the Desktop Mode answer to *"when X happens on my site, do Y"*. A trigger fires (a comment is posted, a post is published, a custom hook from your plugin), an optional condition gate evaluates, and a chain of typed steps runs.

Every Desktop Mode primitive — slash-commands, AI tools, broadcast topics, hooks — is reachable as a step or a trigger. Plugin authors get the entire automation engine for free the moment they register a command with `aiCallable: true` or a server tool with `desktop_mode_register_ai_tool()`.

---

## At a glance

```
┌─ TRIGGER ─────────────┐
│ comment_post (hook)   │
└──────────┬────────────┘
           ▼
┌─ CONDITION ───────────┐
│ comment.content       │
│   matches /casino/i   │
└──────────┬────────────┘
           ▼
┌─ STEPS ───────────────┐
│ 1. log "spam blocked" │
│ 2. action: trash      │
└───────────────────────┘
```

The same shape, expressed as JSON, is what the engine actually stores and executes.

---

## Definition shape

```jsonc
{
  "version": 1,
  "trigger": {
    "kind": "hook",          // or "broadcast"
    "id":   "comment_post",
    "priority": 10
  },
  "conditions": [
    { "left": "{{payload.comment.content}}", "op": "matches", "right": "/(casino|bitcoin)/i" }
  ],
  "steps": [
    {
      "kind": "if",
      "condition": { "left": "{{payload.approved}}", "op": "eq", "right": 1 },
      "then": [
        { "kind": "log", "args": { "level": "info", "message": "Approved comment {{payload.comment_id}}" } }
      ],
      "else": [
        { "kind": "action", "id": "wpdm.comment.trash",
          "args": { "comment_id": "{{payload.comment_id}}" } }
      ]
    }
  ],
  "run_as": "system",
  "settings": {
    "rate_limit":    { "max": 60, "per_seconds": 60 },
    "timeout_ms":    5000,
    "stop_on_error": false
  }
}
```

### Step kinds

| Kind        | Purpose                                                           |
|-------------|-------------------------------------------------------------------|
| `command`   | Queue a registered slash-command (`wp.desktop.registerCommand`).  |
| `ai_tool`   | Invoke a registered server-side AI tool.                          |
| `action`    | Invoke a `desktop_mode_register_routine_action`-registered handler. |
| `email`     | `wp_mail` — args: `to, subject, body, headers`.                   |
| `http`      | Outbound HTTP — host must be in the allowlist (see Security).     |
| `log`       | Write to `error_log` and the run history.                         |
| `wait`      | Sleep up to 5 seconds (longer waits land in Phase 2).             |
| `if`        | Branch on a `condition`. Children at `then` / `else`.             |
| `set_var`   | Store a value at `vars.<name>` for downstream interpolation.      |
| `stop`      | Cleanly halt the routine.                                          |
| `classify`  | AI-powered classification — input + buckets → bucket id, confidence, reasoning. See below. |

### Operators

`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `starts_with`, `ends_with`, `matches` (regex), `in`, `not_in`, `truthy`, `falsy`.

### Placeholder syntax

`{{path.through.payload}}` resolves against `payload.*`, `vars.*`, `user.id`, `site.url`, `site.name`. A *single* placeholder string returns the underlying type as-is (`{{payload.post_id}}` → `42` as int); *mixed* strings interpolate (`Hi {{payload.name}}!`).

---

## Security model — read this

- **Authoring:** gated to `manage_options`. Routines are an admin-only surface.
- **Execution:** a routine runs as its **author**, not the user whose action triggered the hook. This is the single most important security property — capability checks inside steps and actions reflect *who built the routine*, not *who fired the event*.
- **`run_as: "system"`:** elevates to a synthetic admin context. Required when a routine must mutate other users' data (e.g. trashing a comment posted by an anonymous user). Visibly badged in the UI.
- **HTTP allowlist:** the `http` step is gated by `desktop_mode_routine_http_allowlist`. Default is empty — every host must be opted in. Returning `[ '*' ]` opens the floodgates; do not unless you trust every routine author.
- **Rate limit:** every routine carries `settings.rate_limit.{max, per_seconds}`. The engine counts recent runs in the runs table before executing.
- **Run history:** stored in a custom table `{prefix}wpdm_routine_runs`, pruned daily (default 30 days, filterable via `desktop_mode_routine_run_retention_days`).

---

## REST API

All routes under `/wp-desktop/v1/routines`, all `manage_options`:

| Method | Path                              | Purpose                       |
|--------|-----------------------------------|-------------------------------|
| GET    | `/`                               | List routines                 |
| POST   | `/`                               | Create                        |
| GET    | `/<id>`                           | Read one                      |
| PATCH  | `/<id>`                           | Partial update                |
| DELETE | `/<id>`                           | Delete                        |
| POST   | `/<id>/test`                      | Dry-run with caller payload   |
| POST   | `/<id>/run`                       | Fire for real                 |
| POST   | `/<id>/enable`                    | Toggle enabled                |
| GET    | `/<id>/runs?limit=50`             | Recent run history            |
| GET    | `/catalog`                        | Triggers + actions + AI tools |
| GET    | `/templates`                      | Registered starter recipes    |
| POST   | `/from-template`                  | Install a template            |

---

## Plugin author API

Three entry points, all loaded automatically by Desktop Mode.

### Declare a triggerable hook

```php
desktop_mode_register_routine_trigger( array(
    'id'             => 'woocommerce_new_order',
    'label'          => 'WooCommerce — Order received',
    'group'          => 'WooCommerce',
    'icon'           => 'dashicons-cart',
    'kind'           => 'hook',
    'priority'       => 10,
    'accepted_args'  => 1,
    'payload_schema' => array(
        'order.id'    => array( 'type' => 'integer' ),
        'order.total' => array( 'type' => 'number' ),
        'order.email' => array( 'type' => 'string' ),
    ),
    'sample_payload' => array( 'order' => array( 'id' => 42, 'total' => 99.5, 'email' => 'a@b.com' ) ),
    'binder'         => function ( $order_id ) {
        $order = wc_get_order( $order_id );
        return array(
            'order_id' => (int) $order_id,
            'order'    => array(
                'id'    => $order->get_id(),
                'total' => (float) $order->get_total(),
                'email' => $order->get_billing_email(),
            ),
        );
    },
) );
```

### Declare a custom action

Most plugins won't need this — every command and AI tool is automatically usable as a step. Use this when you have a dedicated handler that's neither.

```php
desktop_mode_register_routine_action( array(
    'id'         => 'my_plugin.send_slack',
    'label'      => 'Send Slack message',
    'icon'       => 'dashicons-format-chat',
    'group'      => 'Notifications',
    'capability' => 'manage_options',
    'args_schema'=> array(
        'channel' => array( 'type' => 'string', 'required' => true ),
        'text'    => array( 'type' => 'string', 'required' => true ),
    ),
    'handler'    => function ( $args, $context ) {
        // returns array | WP_Error
        return array( 'sent' => true );
    },
) );
```

### Ship a starter recipe

```php
desktop_mode_register_routine_template( array(
    'id'          => 'wc-big-order-alert',
    'title'       => 'Slack me on big WooCommerce orders',
    'description' => 'When an order over $500 lands, ping #sales.',
    'icon'        => 'dashicons-cart',
    'group'       => 'WooCommerce',
    'def'         => array(
        'version' => 1,
        'trigger' => array( 'kind' => 'hook', 'id' => 'woocommerce_new_order' ),
        'conditions' => array(
            array( 'left' => '{{payload.order.total}}', 'op' => 'gte', 'right' => 500 ),
        ),
        'steps' => array(
            array(
                'kind' => 'action',
                'id'   => 'my_plugin.send_slack',
                'args' => array(
                    'channel' => '#sales',
                    'text'    => 'New big order: #{{payload.order.id}} — {{payload.order.email}}',
                ),
            ),
        ),
        'run_as' => 'system',
        'settings' => array(
            'rate_limit'    => array( 'max' => 0, 'per_seconds' => 60 ),
            'timeout_ms'    => 5000,
            'stop_on_error' => true,
        ),
    ),
) );
```

---

## Hook reference

### Filters

- `desktop_mode_routine_user_can_manage` (bool $can) — gate the manage permission.
- `desktop_mode_routine_payload` (array $payload, array $routine) — last-chance shape adjuster before evaluation.
- `desktop_mode_routine_can_run` (bool $can, array $routine, array $payload) — kill-switch hook. Returning false halts before any step runs.
- `desktop_mode_routine_http_allowlist` (string[] $hosts) — outbound HTTP allowlist. Default empty.
- `desktop_mode_routine_system_user_id` (int $admin_id, int $routine_id) — pin the user that `run_as: "system"` resolves to.
- `desktop_mode_routine_run_retention_days` (int $days) — run-history retention window.
- `desktop_mode_routines_template_html` (string $html) — replace the window template body.

### Actions

- `desktop_mode_routine_trigger_registered` (string $id, array $entry)
- `desktop_mode_routine_action_registered` (string $id, array $entry)
- `desktop_mode_routine_template_registered` (string $id, array $entry)
- `desktop_mode_routine_seeded` — built-in triggers + templates have been registered.
- `desktop_mode_routine_saved` (int $id, array $def, bool $enabled)
- `desktop_mode_routine_deleted` (int $id)
- `desktop_mode_routine_before_run` (array $routine, array $payload)
- `desktop_mode_routine_after_run` (array $routine, array $payload, string $status, array $steps_log)
- `desktop_mode_routine_step_failed` (array $step, array $context, WP_Error $error)

---

## Visual canvas (Phase 2)

The window opens to a vertical pipeline: trigger card at the top, a conditions gate below, then steps in execution order. `if` steps split into two indented sub-pipelines (then / else) with colour-coded headers. Click any card to open the inspector on the right; click empty rail to dismiss.

The canvas is **hybrid-rendered**:

- **DOM** holds the cards, inputs, textareas, focus ring, and a11y. Form controls have to be native — no compromises on keyboard nav or screen readers.
- **PixiJS** (loaded lazily from `assets/vendor/pixi.min.js`) draws the connectors, pulsing halos, the drifting dot grid, and the run-flow animation. The library mounts a `<canvas>` underneath the cards; reads anchor positions from the DOM after each rerender; redraws at 60fps.

When the user hits **Test (dry-run)** or **Run now**, a packet of light traces the connector flow from the trigger card through every executed step in sequence, lighting each card with a colour-coded burst (blue→success, red→failure). The animation is tied to the actual step log returned by the engine — the order, the timing, and the success/failure state are all real.

### Variable autocomplete

Every text field that can interpolate placeholders (step args, condition operands, email body, …) carries an inline autocomplete popover. Type `{{` and the suggestion list appears with:

- **`payload.*`** — every key declared in the trigger's `payload_schema` (defaulting to `payload.arg0..argN` when undeclared).
- **`vars.<step.id>`** — every upstream step's id, available for chaining.
- **`site.url`, `site.name`, `user.id`** — globals always in scope.

Arrow keys + Tab/Enter pick a suggestion; Escape dismisses.

### JSON escape hatch

A **Visual / JSON** toggle in the editor header swaps the canvas for a JSON textarea. Both modes mutate the same in-memory definition; switching from JSON back to Visual parses the textarea on the way through. Power users can copy/paste a routine definition directly without ever opening the canvas.

### Trigger picker

Tabbed dialog: **Common** (declared triggers grouped by plugin), **By plugin** (third-party-only), **Hook search** (any WordPress action by name + priority), **Broadcast** (cross-window topic listener). The picker covers every reachable trigger in the system; declared triggers get friendly labels and payload schemas, undeclared hooks fall back to positional payload binding without losing functionality.

---

## Classify step (AI-powered routing)

A step kind that hands a piece of text to OpenAI with a user-defined list of buckets and gets back a structured `{ bucket_id, confidence, reasoning }` for downstream branching.

**Args:**

| Arg | Type | Required | Notes |
|---|---|---|---|
| `input` | string | yes | The text to classify. Use `{{payload.…}}` / `{{vars.…}}` placeholders. |
| `buckets` | `[ { id, description } ]` | yes (≥2) | Bucket ids must match `[a-z0-9_-]{1,64}`; descriptions help the model pick. |
| `instructions` | string | no | Extra context for the classifier (e.g. "treat brand-name mentions as `important`"). |

**Result** (available downstream as `vars.<step.id>`):

```jsonc
{
  "bucket_id":  "spam",
  "confidence": 0.92,
  "reasoning":  "Mentions 'casino' and bitcoin-style payouts."
}
```

**Typical pattern** — classify, then branch:

```jsonc
[
  { "kind": "classify",
    "id":   "triage",
    "args": {
      "input":   "{{payload.comment.content}}",
      "buckets": [
        { "id": "spam",   "description": "Spam / promotional / off-topic" },
        { "id": "ham",    "description": "Legitimate engagement" },
        { "id": "review", "description": "Borderline — needs a human" }
      ]
    } },
  { "kind": "if",
    "condition": { "left": "{{vars.triage.bucket_id}}", "op": "eq", "right": "spam" },
    "then": [ { "kind": "action", "id": "wpdm.comment.spam",
                "args": { "comment_id": "{{payload.comment_id}}" } } ],
    "else": [] }
]
```

**Cost / safety:**

- Each fire is a paid API call. Pair with **rate limits** in `settings.rate_limit` for high-volume triggers (every comment, every form submission).
- Reuses the existing AI Copilot key + provider settings (OS Settings → AI). When AI is disabled for the run-as user, the step returns a `WP_Error` instead of silently bypassing the classification.
- Strict structured output — the model is constrained to one of the bucket ids. We re-validate server-side in case strict mode misbehaves.

**Action:**

- `desktop_mode_routine_step_classify_completed` (`$result, $context, $args`) — fired on every successful classification. Useful for cost telemetry.

---

## AI "Describe it" (Phase 3)

A composer at the top of the Designer pane: type a natural-language description of what you want and the AI generates a fully-validated routine.

**How it works:**

1. The user types `"When a comment with 'casino' arrives, trash it and email me."`
2. The plugin sends `POST /wp-desktop/v1/routines/from-prompt { prompt }` to its server
3. The server builds a system prompt embedding the **catalog** (every registered trigger + action + AI tool the current user is allowed to see) so the model picks valid identifiers
4. OpenAI's Responses API is called with **structured output** — `text.format = json_schema, strict: true` — guaranteeing the response conforms to the routine schema. No regex-parsing of model output, no retry loops.
5. The response is **revalidated server-side** via `wpdm_routine_validate_def` (defence in depth) before reaching the client
6. The client replaces `routine.def` in place; the canvas rerenders; the user reviews and Saves

Keyboard shortcut: **Cmd/Ctrl+K** focuses the composer from anywhere in the routines window. **Cmd/Ctrl+Enter** submits.

**Filters:**

- `desktop_mode_routine_ai_prompt` (string, array $catalog, string $prompt) — mutate the system prompt (e.g. add site-specific tone or restrict actions).
- `desktop_mode_ai_model` — model name (shared with the AI Copilot).

**Action:**

- `desktop_mode_routine_ai_generated` ($validated, $prompt, $user_id) — fired after successful generation.

**Permissions:** `manage_options` + AI must be enabled for the user (OS Settings → AI). Generation is admin-only by design — it produces routines that mutate site state.

---

## Roadmap

Phase 4 candidates and beyond live in their own contributor-facing
doc — three tracks (Integrations / Polish / Sharing) with file
pointers, gotchas, and cost estimates so anyone can pick a feature
and ship it.

→ [Routines roadmap & contributor guide](./routines-roadmap.md)
