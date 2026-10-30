# `includes/rest/` — REST route map

Discoverability index for the REST surface. Routes are still registered in their owning subsystem files (where the callback closures and module state live), so moving the `register_rest_route()` calls into a single directory would have been a paperwork rename that broke nothing and improved nothing. This document is the central grep target instead.

Plugin authors looking for the canonical route URL → handler map start here; the implementation file is one open away.

## Namespace

All in-tree routes register under `desktop-mode/v1`. Extensions are expected to register under `os-<extension>/v1` (declared via the `extensions/base/OpenStation_Extension_Rest` base's `namespace()` method; the base does not enforce a particular namespace — its docblock also permits `desktop-mode/v1`).

## Routes

| Route | Verb | Handler file | Permission |
|---|---|---|---|
| `/session` | GET / POST / DELETE | `includes/session.php` | logged-in + OpenStation enabled + `read` |
| `/default-window` | POST | `includes/default-window.php` | logged-in + OpenStation enabled + `read` |
| `/intros/seen` | POST | `includes/seen-intros.php` | logged-in + OpenStation enabled + `read`; the two classic-admin slugs (`activation-welcome`, `activation-nudge`) are accepted from any logged-in `read` account, since both render only while OpenStation is off |
| `/intros` | DELETE | `includes/seen-intros.php` | logged-in + OpenStation enabled + `read` |
| `/os-settings` | GET / POST | `includes/os-settings.php` | logged-in + OpenStation enabled + `read` |
| `/extended-options` | GET / POST | `includes/extended-options.php` | `manage_options` |
| `/pwa-state` | GET / POST | `includes/pwa.php` | logged-in + OpenStation enabled + `read` |
| `/feedback/deactivation` | POST | `includes/feedback/rest.php` | `activate_plugins` + `openstation_deactivation_feedback_enabled()`; deliberately not `openstation_rest_require_enabled()` (the person deactivating usually has OpenStation off). No object-level checks: the route stores nothing on the site, it forwards an anonymous payload to the intake on openstation.blog and answers `{ sent }` |
| `/feedback/usage` | POST | `includes/feedback/usage.php` | logged-in + OpenStation enabled + `read` + `openstation_usage_feedback_enabled()`. No object-level checks: the route stores nothing on the site but the caller's own `usage-feedback` seen-intro flag, forwards the typed answers (and an email only when one was typed) to the intake on openstation.blog and answers `{ sent }` (`400` for an empty form or a malformed address, `502` when the forward failed) |
| `/debug` | GET | `includes/devtools.php` | `manage_options` (filterable via `openstation_debug_rest_permission`) |
| `/presence` | GET / POST | `includes/presence.php` | logged-in + OpenStation enabled + `read` |
| `/notes` | GET / POST | `includes/notes/rest.php` | logged-in + OpenStation enabled + `read` (`openstation_notes_rest_permission()`). GET lists the caller's own notes plus every public one |
| `/notes/{id}` | PATCH / DELETE | `includes/notes/rest.php` | same notes gate + the caller is the note's author (administrators included) |
| `/notes/{id}/restore` | POST | `includes/notes/rest.php` | same notes gate + note author |
| `/notes/{id}/convert` | POST | `includes/notes/rest.php` | same notes gate + note author + `edit_posts` |
| `/content-identity` | GET | `includes/window-links.php` | logged-in + OpenStation enabled + `read` + `edit_post` on `post`. Linked posts and media in `links` and in the related items are filtered per item on the caller's `read_post` |
| `/network/link` | POST | `includes/network/hop.php` | logged-in + OpenStation enabled + `read` |
| `/network/hop` | POST | `includes/network/hop.php` | logged-in + OpenStation enabled + `read` |
| `/desktop-themes` | GET | `includes/desktop-themes/rest.php` | logged-in + OpenStation enabled + `read`. The same entries the boot payload carries |
| `/desktop-themes` | POST | `includes/desktop-themes/rest.php` | logged-in + OpenStation enabled + `read` + `openstation_desktop_theme_upload_capability` (`manage_options` by default) |
| `/desktop-themes/{slug}` | DELETE | `includes/desktop-themes/rest.php` | same as POST |
| `/oauth/start` | POST | `includes/oauth-relay.php` | logged-in |
| `/oauth/callback` | GET | `includes/oauth-relay.php` | public (validated by the state nonce) |
| `/term-counts` | GET | `apps/posts/parts/terms-rest.php` | `edit_posts` |
| `/tag-cooccurrence` | GET | `apps/posts/parts/terms-rest.php` | `edit_posts` |
| `/users` | POST | `apps/users/parts/rest.php` | `create_users` |
| `/users/bulk-role` | POST | `apps/users/parts/rest.php` | `promote_users` |
| `/users/bulk-delete` | POST | `apps/users/parts/rest.php` | `delete_users` (`remove_users` on multisite) |
| `/users/activity-summary` | GET | `apps/users/parts/activity-summary.php` | `list_users` |
| `/users/roles-summary` | GET | `apps/users/parts/roles-summary.php` | `list_users` |
| `/users/{id}/send-password-reset` | POST | `apps/users/parts/rest.php` | `edit_users` |
| `/users/{id}/resend-welcome` | POST | `apps/users/parts/rest.php` | `edit_users` |
| `/users/{id}/insights` | GET | `apps/user-edit/parts/insights.php` | `edit_user` on the target user |
| `/users/{id}/destroy-sessions` | POST | `apps/user-edit/parts/account.php` | `edit_user` on the target user |
| `/users/{id}/application-passwords` | GET / POST | `apps/user-edit/parts/account.php` | `edit_user` on the target user |
| `/users/{id}/application-passwords/{uuid}` | DELETE | `apps/user-edit/parts/account.php` | `edit_user` on the target user |
| `/comments/bulk` | POST | `apps/comments/parts/rest.php` | `moderate_comments` |
| `/comments/reply` | POST | `apps/comments/parts/rest.php` | `edit_posts` |
| `/comments/insights/{email}` | GET | `apps/comments/parts/rest.php` | `moderate_comments`. The matching account (`userId`, `userName`) is resolved only for a `list_users` holder; anyone else gets `0` / `''` |
| `/comments/counts` | GET | `apps/comments/parts/rest.php` | `edit_posts` |
| `/post-stats` | GET | `includes/widgets/widget-post-stats.php` | `edit_posts`. Drafts and pending counts cover the caller's own posts unless they hold `edit_others_posts` |
| `/draft-suggestions` | POST | `includes/widgets/widget-drafts.php` | `edit_post` on the draft + a configured AI provider |
| `/draft-apply` | POST | `includes/widgets/widget-drafts.php` | `edit_post` on the draft |
| `/site-views-jetpack` | GET | `includes/widgets/widget-site-views.php` | `edit_posts`, then Jetpack's own stats gate in the handler: `manage_options` or `view_stats` (the roles picked in Jetpack's Stats settings), mirroring Jetpack's stats-app REST controller. A caller without it gets `available: false`, `restricted: true` and no rows; a site where Jetpack Stats cannot answer gets `available: false`. Site-wide daily totals only, no per-post data |
| `/site-views-meta` | GET | `includes/widgets/widget-site-views.php` | `edit_posts`. Site-wide daily sums of `_post_views_YYYY-MM-DD` post meta, no per-post data; cached for every caller in one transient |
| `/living-tree/snapshot` | GET | `includes/living-tree/snapshot.php` | `read` (filterable via `openstation_living_tree_user_can_use`). Site-wide aggregates only, cached for every caller in one transient. `traffic` is settled per caller after the cache: the Jetpack Stats total goes only to a caller who passes Jetpack's stats gate (`manage_options` or `view_stats`), anyone else gets the `_post_views_YYYY-MM-DD` sum, cached alongside it |
| `/content-graph/post-types` | GET | `includes/content-graph/rest.php` | `edit_posts` (filterable via `openstation_content_graph_user_can_use`) |
| `/content-graph/nodes` | GET | `includes/content-graph/rest.php` | `edit_posts` (filterable via `openstation_content_graph_user_can_use`). Shaped per caller after the shared cache: `contributor_ids` only on posts the caller can `edit_post`, and the edges out of a password-protected post only when the caller entered its password or can `edit_post` it; `stats.edges` counts the edges returned |
| `/content-graph/post/{id}` | GET | `includes/content-graph/rest.php` | `edit_posts` (filterable via `openstation_content_graph_user_can_use`) + `read_post`, and `edit_post` when the post type is not viewable. Comments and comment-author contributors only when the `/comment-stats` parent gate passes; revisions and revision-author contributors only with `edit_post` |
| `/apps/(?P<app>[a-z0-9][a-z0-9_-]*)/dispatch` | POST | `includes/framework/wordpress.php` | Logged in + the app exists + `App::allows()` (its `capabilities()` and `can()` gate). Every `.os.php` window — Code Blue included, behind Developer mode + `manage_options` (`manage_network_options` on multisite), filterable via `openstation_code_blue_user_can_use` — is served by this one route; there are no per-app routes. |
| `/comment-stats/{id}` | GET | `includes/my-wordpress/comment-stats.php` | `edit_posts` (filterable via `openstation_my_wordpress_user_can_use`) + parent post readable: `read_post`, but `edit_post` when the parent is still sealed by a password (a caller who already entered it reads on `read_post` like anyone else) or when its post type has no readable front end, and `moderate_comments` when the parent is gone |
| `/term-stats/{taxonomy}/{id}` | GET | `includes/my-wordpress/term-stats.php` | `edit_posts` (filterable via `openstation_my_wordpress_user_can_use`), then narrowed per caller: a non-viewable taxonomy answers 400 unless the caller holds its `manage_terms`, and every post-level aggregate (`counts.posts`, `recent`) is scoped to the statuses the caller may read, with `recent` gated per row on `read_post`. The payload is viewer-dependent — never cache it under a term-only key |
| `/user-stats/{id}` | GET | `includes/my-wordpress/user-stats.php` | `edit_posts` (filterable via `openstation_my_wordpress_user_can_use`), then tiered in the handler on `list_users` (or the subject viewing their own dossier). Without it: no email / username / registered / roles, and every count and `recent` covers published content only. `counts.cpt` and both comment counts additionally require a viewable post type, since `publish` rows of an internal type have no front end, and the comment counts skip password-protected and deleted parents and ask the `/comment-stats` parent gate of each parent they count, so a plugin's per-post `read_post` filter moves them. Viewer-dependent payload |
| `/user-footprint/{id}` | GET | `includes/my-wordpress/user-footprint.php` | `edit_posts` (filterable via `openstation_my_wordpress_user_can_use`), then gated per post rather than per tier. A timeline row needs the caller to see its post: a public status of a viewable type, else `read_post`; `edit_post` for a type with no front end; the `/comment-stats` parent gate for comment rows, sealed and deleted parents included. Every count that can reach those posts (`totals`, each day's `comments` and `updates`, and the streak built from them) asks the same gate of each post it counts, so a count never reports activity the rows withhold, a plugin's per-post capability filter included. `list_users` (or self) only adds `roleLabels` / `registered`. Viewer-dependent payload |
| `/media-usage/{id}` | GET | `includes/my-wordpress/media-usage.php` | `read_post` on the attachment |
| `/post-type/{type}`, `/post-type/{type}/{id}` | GET (+ DELETE on `{id}`) | `includes/my-wordpress/class-openstation-my-wordpress-post-type-controller.php` | The type's `edit_posts` in every context, then Core's `WP_REST_Posts_Controller` checks. Registered only for eligible non-REST types while `openstation_my_wordpress_user_can_use` passes |
| `/woocommerce/orders`, `/woocommerce/orders/{id}` | GET | `includes/my-wordpress/integrations/woocommerce.php` | `shop_order`'s `edit_posts` (`manage_woocommerce` when the type is not registered) |
| `/woocommerce/store` | GET | `includes/my-wordpress/integrations/woocommerce.php` | same orders gate |
| `/woocommerce/summary/{type}/{id}` | GET | `includes/my-wordpress/integrations/woocommerce.php` | `order`: the orders gate. Other types: `openstation_my_wordpress_woo_summary_capability` when it answers, else `edit_post` on `{id}` |
| `/woocommerce/customers`, `/woocommerce/customers/{id}` | GET | `includes/my-wordpress/integrations/woocommerce-customers.php` | the orders gate + `list_users` |
| `/recycle-bin/*` | various | `includes/recycle-bin/rest.php` | logged-in + OpenStation enabled + `read` on the current site, then per item in the store: posts list on `edit_post` and restore / purge on `delete_post`, comments on `edit_comment`; desktop-file items (placements, folders) are the owner's only. Each per-item check is filterable (`openstation_recycle_bin_user_can_*`, `openstation_files_user_can_*`) |
| `/files/*` | various | `includes/desktop-files/rest.php` (+ `rest-uploads.php`, `media-library.php`, `file-shares.php`, `downloads.php`) | logged-in + OpenStation enabled + `read` on the current site, per-row gating in the store. Share routes add the sharing gate; `/files/uploads` and `/files/uploads/paths` need `upload_files` (filterable via `openstation_stored_files_upload_capability`); the media routes (`/files/uploads/{id}/media`, `/files/uploads/{id}/post`, `/files/posts/{id}/uploads`) need `upload_files`; `/files/users/search` needs `edit_posts` and matches on `user_email` only for a `list_users` holder; `/files/folder-sharing-tables/purge` needs `manage_options` |
| `/ai/search` | POST | `includes/ai-copilot/search.php` | `read` + `openstation_ai_is_available()` (`503` without it) + the caller's own AI assistant toggle in Preferences → Features (`403` when off). Every tool the server runs is a read-only ability dispatched through `WP_Ability::execute()`, so each one's own `permission_callback` still applies (see [`docs/agents-security.md`](../../docs/agents-security.md)); a picked client command comes back as a `tool_call` for the browser to run |
| `/ai/status` | GET | `includes/ai-copilot/settings.php` | `read`. Answers only the caller's own assistant config (availability, provider configured, their own toggle, the Connectors URL); no site content |
| `/mio/turn` | POST | `includes/ai-copilot/mio.php` | The caller's own MIO API preference (`403` when off), then the `/ai/search` gate, then a configured assistant provider (`503` without one). Stateless: stores nothing and runs no server-side tool; the window's tools call the existing write endpoints, which keep their own permissions |
| `/games/{game}/scores` | GET / POST | `includes/games/rest.php` | logged-in + OpenStation enabled + `read` (filterable via `openstation_games_rest_permission`) |
| `/games/{game}/playtime` | POST | `includes/games/rest.php` | same games gate |
| `/games/playtime` | GET | `includes/games/rest.php` | same games gate |
| `/games/challenges` | GET / POST | `includes/games/rest.php` | same games gate (create also passes `openstation_games_can_challenge`) |
| `/games/challenges/{id}/accept` | POST | `includes/games/rest.php` | same games gate + challenge recipient |
| `/games/challenges/{id}/decline` | POST | `includes/games/rest.php` | same games gate + challenge recipient |
| `/games/challenges/{id}/complete` | POST | `includes/games/rest.php` | same games gate + challenge recipient |
| `/games/users/search` | GET | `includes/games/rest.php` | same games gate; matches on `user_email` only for a `list_users` holder |
| `/agents` | GET / POST | `includes/agents/rest.php` | GET `edit_posts`, POST `edit_users` (both filterable; whole module behind the `agents` extended option) |
| `/agents/{id}` | GET / POST / DELETE | `includes/agents/rest.php` | GET `edit_posts`, POST/DELETE `edit_users` (filterable) |
| `/agents/{id}/invoke` | POST | `includes/agents/rest.php` | `edit_posts` (filterable via `openstation_agents_user_can_invoke`), then the per-agent gate `openstation_agent_user_can_invoke_agent()` (the caller must hold every `capability` declared on any of the agent's triggers; the client-supplied `source` does not select which apply) + per-invoker and per-agent rate limits. The run itself is ceilinged at the caller's own capabilities — see [`docs/agents-security.md`](../../docs/agents-security.md) |
| `/agents/{id}/jobs/{jobId}` | GET | `includes/agents/jobs.php` | Authenticated invoker + exact job owner and agent match. Constant-cost status read, no worker dispatch. |
| `/agents/conversations` | GET / POST | `includes/agents/conversations.php` | `edit_posts` (filterable via `openstation_agents_user_can_invoke`). GET lists only the caller's own conversations; POST creates one owned by the caller and answers `404` unless `agentId` is an agent |
| `/agents/conversations/{id}` | GET / PUT / DELETE | `includes/agents/conversations.php` | same gate + the caller is the conversation's author; anyone else's, like a missing one, answers the same `404` |
| `/agents/abilities` | GET | `includes/agents/rest.php` | `edit_posts` (filterable) |
| `/agents/draft` | POST | `includes/agents/rest.php` | `edit_users` (filterable). One AI generate call with a strict answer schema; creates nothing. `503` without the AI Client, `502` when the provider fails or answers unreadably |
| `/agents/trigger-kinds` | GET | `includes/agents/rest.php` | `edit_posts` (filterable) |
| `/agents/hooks-catalogue` | GET | `includes/agents/rest.php` | `edit_posts` (filterable) |
| `/agents/roles` | GET | `includes/agents/rest.php` | `edit_users` (filterable) |

## Conventions

- **Nonce.** Every state-changing route requires `X-WP-Nonce` (the standard REST nonce). Read routes that depend on per-user state also require it.
- **Permission.** Permission callbacks use either `is_user_logged_in()` + capability checks or domain predicates. Shell-internal endpoints (`/session`, `/default-window`, `/intros`, `/os-settings`, `/pwa-state`, `/presence`, `/network/link`, `/network/hop`, `GET /desktop-themes`, and the base of `/content-identity`) share the `openstation_rest_require_enabled()` gate (`includes/helpers.php`): logged-in **and** `openstation_is_enabled()` **and** `read` on the current site, returning `401` when logged out and `403` when OpenStation is off or the account has no role on the site. `read` alone is deliberately not enough — every authenticated role carries it — but it is the floor: the opt-in is network-wide user meta and the REST nonce is not site-bound, so on multisite a user with no role on this site (super admins excepted) is refused. `/notes*` applies the same three checks in its own helper. Filtering with `openstation_*` hooks lets plugins extend or harden access.
- **Errors.** Failures return `WP_Error` with a stable `code`, a translated `message`, and a `data: { status: <int> }` block. Codes are documented per-endpoint in `docs/hooks-reference.md`.

## Why no central registration

PHP `register_rest_route()` calls execute on `rest_api_init`. The callback closures in the existing files capture per-module state — the recycle-bin store, the desktop-files registry, the AI provider — that lives in the same module. Moving the registration calls out of those files would force every callback to re-look-up its dependencies, increasing surface area without reducing coupling. The route → handler-file map above is the discoverability win we wanted; the per-module registrations are the layout that minimises blast radius.

If a future extension adds REST routes that don't fit any existing module, the `extensions/base/OpenStation_Extension_Rest` base class is the cheapest path. See `extensions/base/README.md`.

Agent invocation supports `async: true` plus a UUID `requestId`, returning HTTP 202. See [async jobs](../../docs/architecture.md#async-agent-jobs) for the status contract and worker requirements.
