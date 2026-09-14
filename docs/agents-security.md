# Agents security model

Agents are the only part of OpenStation that **acts with capability on
a user's behalf**. Everything else in the framework renders, routes, or
stores. An agent creates posts, edits media, and changes site state,
driven by a language model reading text it did not write.

This document is the trust model. Read it before you register an
ability agents can call, add a trigger intake, or widen any of the
gates in [hooks-reference.md](./hooks-reference.md#ai-agents).

## The one-sentence version

**An agent must never do on your behalf what you could not do
yourself**, and anything an agent *reads* is untrusted input.

## The four boundaries

### 1. Agents cannot authenticate

An agent is a real `wp_users` row, so capability checks, edit locks,
comment attribution, and the audit trail work without a parallel ACL.
The row is synthetic only in that no credential may ever resolve to it.

`includes/agents/guard.php` blocks two distinct halves of WordPress:

| Path | Block |
|---|---|
| wp-login.php, XML-RPC, application passwords | `authenticate` @ 30 |
| Auth cookies, JWT / SSO / magic-link plugins | `determine_current_user` @ `PHP_INT_MAX` |
| Password reset | `allow_password_reset` |
| Application password creation | `wp_is_application_passwords_available_for_user` |
| `/?author=N` enumeration | `pre_get_posts` → 404 on the front end |

The `determine_current_user` guard is the one that matters, and it is
easy to leave out. **The `authenticate` chain never runs for cookie
validation** — a third-party plugin calling
`wp_set_auth_cookie( $agent_id )` (social login, passwordless login, a
"log in as user" admin tool) would hand out a live agent session with
no credential involved at all. The session guard is the catch-all
because every authenticated request funnels through it.

It does not interfere with the runner: `wp_set_current_user()` sets the
global directly and never re-runs the filter.

**guard.php loads unconditionally**, ahead of the `agents` feature
flag. Turning the feature off does not delete the agent rows, and rows
whose blocks unloaded with the feature would start accepting
application passwords again. If you move code in this module, keep the
blocks out of the flag.

### 2. A run is ceilinged at the invoker's capabilities

The runner switches the current user to the agent for the whole tool
loop, so each ability's `permission_callback` evaluates against the
agent's role. That is an intentional privilege change, so it is bounded
on both sides: a `user_has_cap` filter installed alongside the switch
turns off every primitive capability the invoker does not hold.

Without it the module is a textbook confused deputy:

- invoking is gated on `edit_posts` (contributor level),
- agents may hold `administrator`,
- so a contributor could ask an editor-role agent to publish, and the
  agent's own `permission_callback` would happily allow it.

Intersecting **primitive** caps is the correct level: `user_has_cap`
fires after `map_meta_cap()` has resolved `edit_post` into the
primitive that specific post actually needs, so object-level ownership
still resolves per-user and the intersection only removes reach the
invoker never had. It can never grant anything — an admin invoking a
contributor-role agent still gets contributor reach.

The ceiling is skipped only when there is no invoker (`$invoker_id` 0 —
a hook or cron-driven run), because intersecting with the logged-out
cap set would leave the agent unable to act at all. **A system-context
run therefore executes with the agent's full role.** If you add a
trigger intake that runs without a human, that is the decision you are
making; `openstation_agent_restrict_to_invoker` is where you change
it.

New trigger intakes must pass `$context['invoker']` when a human is
behind the run. It defaults to `get_current_user_id()`, which is
correct for a REST request and wrong for a deferred job.

### 3. Tool output is untrusted input

The AI Copilot solves prompt injection structurally: it only ever
offers the model read-only abilities, so a poisoned tool result can at
worst mislead an answer. **Agents deliberately hold mutating
abilities**, so that structural defence is unavailable here.

A tool result can carry text authored by someone far less privileged
than the invoker — a comment body, a contributor's draft, an uploaded
file's metadata. The runner therefore wraps every result in an
`<untrusted-tool-output>` fence (with any occurrence of the delimiter
inside the payload neutralized first, so content cannot close the fence
early) and the system prompt instructs the model to treat everything
inside as data.

**Treat this as mitigation, not a guarantee.** It is the third layer,
behind the invoker cap ceiling and each ability's own
`permission_callback`. Do not let it be the reason a mutating ability
is considered safe. When an ability returns fields the model has no
business seeing, strip them in
[`openstation_agent_tool_result`](./hooks-reference.md#openstation_agent_tool_result--experimental-filter).

### 4. Granting a role is granting capability

An agent acts with its role's capabilities, so minting one is a
promotion and is gated like one: `promote_users`, plus a genuine
administrator (super admin on multisite) for the `administrator` role.

`get_editable_roles()` is **not** sufficient on its own, despite the
name. Core implements it as a bare
`apply_filters( 'editable_roles', wp_roles()->roles )` with no
reference to the current user, so on a stock install it excludes
nothing. It is a useful constraint because plugins like WooCommerce
filter it, but the real gate is
`openstation_agent_actor_can_assign_role()`. The scenario it closes:
a role plugin hands `edit_users` to a shop-manager-shaped role, which
mints an administrator agent, which then acts with capabilities its
creator never had.

## Identity is not a new privilege boundary

An agent carries a **voice** (`vibes`), one short line of character that
is appended to its instructions before a run. It reaches a language
model, so it is worth being explicit about what that does and does not
change.

**It adds no reach.** Writing `vibes` requires `edit_users`, the same
capability that already lets you write `instructions` — the entire
system prompt. A 120-character tone line is strictly less than that, so
it deliberately sits behind the same gate. Do not "harden" it onto a
different capability later: that buys nothing and creates a confusing
split where the smaller field is the harder one to set.

Two structural guards it does have, both cheap and both load-bearing:

- **No line breaks.** `openstation_agent_sanitize_vibes()` routes
  through `sanitize_text_field()`, which strips them. The composed
  prompt marks operator turns, so a multi-line voice line could
  otherwise fake a turn boundary. `agentsIdentity2.php` pins this;
  swapping in `sanitize_textarea_field()` would quietly remove the
  guard.
- **It goes after the instructions, never before.** A voice and a
  workflow can disagree, and when they do the workflow should win.
  Position is the whole mechanism: `openstation_agent_apply_vibes()`
  appends, and a test asserts the ordering.

**The face is data, not text.** An agent's portrait is a Mio look:
numbers and a silhouette name, clamped to their ranges by
`openstation_mio_clamp_look()` before anything draws with them. The
generated SVG contains no text nodes and no caller-supplied string at
all — every value in it is a number the renderer computed. That rule is
what makes it safe to write those files into uploads and serve them;
`Tests_OpenStation_MioPortrait` asserts it in both languages.

The face directory is hardened **exec-off, not deny-all**: portraits
have to stay servable or every agent avatar on the site breaks. PHP
cannot execute there.

That hardening is `.htaccess`, so it is **defence in depth and Apache
only**: the `php_flag` and `<FilesMatch>` rules are inert on nginx,
the same limitation WordPress's own `uploads/.htaccess` has. The
control that actually holds is the one above it: the renderer cannot
be made to emit anything but inert SVG, because it never interpolates
a caller-supplied string. Read in that order if you are adding to this
directory later. A **different** file type dropped in beside the
portraits would not inherit the renderer's guarantee, and the
`.htaccess` is not enough on its own to cover it.

**The one thing to be careful with is a roster digest.** Telling agent A
about agent B — so it can hand work over by name — would put text one
`edit_users` holder wrote into another's system prompt. On a
single-admin site that is nothing; on a multi-editor site it is a
lateral channel. Nothing ships that today. If it is added, it needs the
same fencing the runner already applies to tool output, a hard cap on
how many rows it carries, and `vibes` left out of it entirely: a
hand-off needs a name and a job, not a personality.

## Rate limits

Two independent buckets, both hourly:

- **Per agent** (`openstation_agent_default_rate_limit`, default 60,
  overridable per agent) — bounds one agent.
- **Per invoker** (`openstation_agent_invoker_rate_limit`, default
  120) — bounds one person across every agent on the site.

The second exists because the first does not stop a single `edit_posts`
user walking every agent in turn and spending the AI budget N times
over.

## Checklist for new work

Registering an ability agents can call:

- [ ] Does its `permission_callback` check a capability for the
      **specific object**, not just a blanket `edit_posts`?
- [ ] If it returns a post body, does it gate the **post password**
      separately from `read_post`? WordPress splits the two on purpose:
      `read_post` decides visibility (published / private / draft),
      `post_password_required()` decides whether the body may be shown.
      A read ability that returns raw `post_content` has no empty
      rendered field to fall back to, so it must refuse a sealed post
      unless the caller can `edit_post` it — the escape hatch Core's
      `WP_REST_Posts_Controller::check_password_required()` grants.
      `desktop-mode/get-post` is the worked example.
- [ ] If it returns a **child** object, does it gate the **parent** too?
      A comment record carries its post's title and permalink, so
      approval alone does not make it public: an approved comment
      outlives its post being switched to private or back to draft, and
      returning it hands out exactly what the post's own gate withholds.
      Gate the parent by the same rule as the post itself. Note the
      trade: per-caller readability cannot be expressed as query vars —
      an Administrator reads private posts, a reader who entered a post
      password reads that post — so the filter runs per row and `total`
      counts rows the batch withholds. Gate in the query only where the
      rule is the same for every caller, as `search_posts` does with
      `has_password => false`.
- [ ] Does it ask the **post type** whether it has a readable front
      end? `map_meta_cap()` resolves `read_post` on a *published* post
      to the type's `read` cap — plain `read` on any type registered
      with `map_meta_cap`, which every logged-in user holds. So a
      published row of a plugin's internal CPT (an order, a submission
      log, a queue entry) reads like a public post until
      `is_post_type_viewable()` is asked separately. Fall back to
      `edit_post` for a non-viewable type.
- [ ] Do the **counts** cover the same set as the items? `found_posts`,
      `total` and a per-status breakdown answer "does the hidden thing
      match?" — an oracle for exactly what the item list withheld.
      Filter both over one set, or say on the surface that `total`
      over-counts (which is what a per-row gate forces, and what Core's
      comments controller also does).
- [ ] Does it guard a **zero id** before fetching? `get_post( 0 )` and
      `get_comment( 0 )` fall back to `$GLOBALS['post']` /
      `$GLOBALS['comment']`, so an orphaned comment — or a `\d+` route
      parameter that matched a zero — is otherwise authorized against
      whatever another plugin left in the global.
- [ ] If an id reaches it from **model output**, does it re-check
      readability itself? `/ai/search`'s `entity_id` comes out of the
      model's answer and the user's query steers it, so it is
      attacker-controlled: a turn can be driven by comment or post text
      someone else wrote. Never treat "the search tools only return
      readable rows" as proof of where an id came from.
- [ ] Would a contributor invoking it through an admin-role agent get
      more than they should? (If the ceiling is doing all the work,
      say so in the ability's description.)
- [ ] Does it return fields that should be stripped in
      `openstation_agent_tool_result`?
- [ ] Is `meta.annotations.readonly` set honestly? The Copilot's
      server-dispatched tool loop uses it as a security boundary.
- [ ] Does the `description` state every fact the model needs to use
      the result safely? It is the ONLY place such a fact reaches every
      caller: abilities are offered as native function declarations, so
      the description is in context whether or not any agent's prompt
      mentions the tool. `desktop-mode/get-post` saying its `content` is
      raw stored markup is the worked example — an agent told only by
      its own instructions leaves every other agent guessing, and a
      cautious one stops rather than risk writing rendered HTML back.

Adding a REST route or an app action that READS content:

The same checklist applies — an ability is only one dispatch shape, and
the leaks that were plain REST routes were leaks for the same reasons.
Four additions specific to a route:

- [ ] Is the `permission_callback` the **module's own gate**, not
      `is_user_logged_in()`? A window gated at `edit_posts` whose route
      admits any logged-in user has no gate. Route through the
      filterable helper — `openstation_my_wordpress_user_can_use()` is
      the pattern — so a site that narrows the window narrows the data
      with it.
- [ ] Do the **object-level** checks live in the callback rather than
      the permission callback, where an in-process caller that invokes
      the callback directly still hits them?
- [ ] Does the aggregate it returns stay scoped to the caller? A
      per-status count, a "recent" list or a top-authors roll-up is
      about the objects *inside* the container, and the container being
      public says nothing about them. A viewer-dependent payload must
      never be cached under a container-only key.
- [ ] Is the route's real gate written into the table in
      [`includes/rest/README.md`](../includes/rest/README.md)?

Adding a trigger intake:

- [ ] Call `openstation_agent_user_can_invoke_agent()` before
      `openstation_agent_invoke()`.
- [ ] Pass `$context['invoker']` when a human is behind the run.
- [ ] If it runs without a human, confirm the agent's full role is an
      acceptable ceiling for a message you do not control.

Touching guard.php:

- [ ] Keep it out of the `agents` feature flag.
- [ ] Keep both the `authenticate` and `determine_current_user` halves.
      They cover different things and neither is redundant.

## Tests

`tests/phpunit/tests/agentsSecurity.php` asserts each boundary above as
a property rather than as behavior. If you change anything in this
document, that suite should change with it.

The read-path checklist above has its own guards, each pinning a
Subscriber against a restricted object rather than pinning a return
shape: `aiNativeSearch.php` (search tools and entity hydration),
`agentsAbilities.php` (the get-post password gate),
`myWordpressCommentStats.php` (route gate, parent-post readability,
thread scoping, zero ids) and `myWordpressTermStats.php` (readable
statuses, count oracle, hidden taxonomies). A new read path gets a test
in that shape: give a low-capability user a restricted object and assert
on what does **not** come back, counters included.

## See also

- [Hooks reference — AI Agents](./hooks-reference.md#ai-agents)
- [Architecture](./architecture.md)
- [Event-driven framework](./event-driven-framework.md)

## Async job ownership

Async REST submissions store the authenticated human id, never an invoker
supplied in JSON. The background worker rechecks the human's existence,
feature flag, invocation gate and trigger gate, and passes that id explicitly
to the runner's capability intersection. Cron does not turn a human request
into a system invocation. Status reads require the original owner even when
another caller is an administrator; inputs and history never appear in status
responses. Completed results retain the same sensitivity as chat transcripts.

An atomic claim prevents duplicate execution. A failed or interrupted worker
is never automatically replayed: tools may already have applied changes. Jobs
and claims expire through cron after one day; see
[storage and scheduling](./architecture.md#async-agent-jobs).
