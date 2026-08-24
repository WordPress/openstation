# `includes/rest/` — REST route map

Discoverability index for the REST surface. Routes are still registered in their owning subsystem files (where the callback closures and module state live), so moving the `register_rest_route()` calls into a single directory would have been a paperwork rename that broke nothing and improved nothing. This document is the central grep target instead.

Plugin authors looking for the canonical route URL → handler map start here; the implementation file is one open away.

## Namespace

All in-tree routes register under `desktop-mode/v1`. Extensions are expected to register under `os-<extension>/v1` (declared via the `extensions/base/OpenStation_Extension_Rest` base's `namespace()` method; the base does not enforce a particular namespace — its docblock also permits `desktop-mode/v1`).

## Routes

| Route | Verb | Handler file | Permission |
|---|---|---|---|
| `/session` | GET / POST / DELETE | `includes/session.php` | logged-in + OpenStation enabled |
| `/default-window` | POST | `includes/default-window.php` | logged-in + OpenStation enabled |
| `/intros/seen` | POST | `includes/seen-intros.php` | logged-in + OpenStation enabled |
| `/intros` | DELETE | `includes/seen-intros.php` | logged-in + OpenStation enabled |
| `/os-settings` | GET / POST | `includes/os-settings.php` | logged-in + OpenStation enabled |
| `/extended-options` | GET / POST | `includes/extended-options.php` | `manage_options` |
| `/pwa-state` | GET / POST | `includes/pwa.php` | logged-in + OpenStation enabled |
| `/debug` | GET | `includes/devtools.php` | `manage_options` (filterable via `openstation_debug_rest_permission`) |
| `/presence` | GET / POST | `includes/presence.php` | logged-in + OpenStation enabled |
| `/oauth/start` | POST | `includes/oauth-relay.php` | logged-in |
| `/oauth/callback` | GET | `includes/oauth-relay.php` | public (validated by the state nonce) |
| `/term-counts` | GET | `includes/posts-window/window.php` | `edit_posts` |
| `/tag-cooccurrence` | GET | `includes/posts-window/window.php` | `edit_posts` |
| `/users` | POST | `includes/users-window/rest.php` | `create_users` |
| `/users/bulk-role` | POST | `includes/users-window/rest.php` | `promote_users` |
| `/users/bulk-delete` | POST | `includes/users-window/rest.php` | `delete_users` (`remove_users` on multisite) |
| `/users/{id}/send-password-reset` | POST | `includes/users-window/rest.php` | `edit_users` |
| `/users/{id}/resend-welcome` | POST | `includes/users-window/rest.php` | `edit_users` |
| `/users/{id}/insights` | GET | `includes/user-edit-window/rest.php` | `edit_user` on the target user |
| `/users/{id}/destroy-sessions` | POST | `includes/user-edit-window/rest.php` | `edit_user` on the target user |
| `/users/{id}/application-passwords` | GET / POST | `includes/user-edit-window/rest.php` | `edit_user` on the target user |
| `/users/{id}/application-passwords/{uuid}` | DELETE | `includes/user-edit-window/rest.php` | `edit_user` on the target user |
| `/comments/bulk` | POST | `includes/comments-window/rest.php` | `moderate_comments` |
| `/comments/reply` | POST | `includes/comments-window/rest.php` | `edit_posts` |
| `/comments/insights/{email}` | GET | `includes/comments-window/rest.php` | `moderate_comments` |
| `/comments/counts` | GET | `includes/comments-window/rest.php` | `edit_posts` |
| `/comments/ai-settings` | GET / POST | `includes/comments-window/ai-moderation.php` | `manage_options` |
| `/content-graph/post-types` | GET | `includes/content-graph/rest.php` | `edit_posts` (filterable via `openstation_content_graph_user_can_use`) |
| `/content-graph/nodes` | GET | `includes/content-graph/rest.php` | `edit_posts` (filterable via `openstation_content_graph_user_can_use`) |
| `/content-graph/post/{id}` | GET | `includes/content-graph/rest.php` | `edit_posts` (filterable via `openstation_content_graph_user_can_use`) |
| `/code-blue/sources` | GET | `includes/code-blue/rest.php` | Developer mode + `manage_options` (`manage_network_options` on multisite; filterable via `openstation_code_blue_user_can_use`) |
| `/code-blue/entries` | GET / DELETE | `includes/code-blue/rest.php` | Developer mode + `manage_options` (`manage_network_options` on multisite; filterable via `openstation_code_blue_user_can_use`) |
| `/comment-stats/{id}` | GET | `includes/my-wordpress/comment-stats.php` | logged-in |
| `/term-stats/{taxonomy}/{id}` | GET | `includes/my-wordpress/term-stats.php` | logged-in + `read` |
| `/user-stats/{id}` | GET | `includes/my-wordpress/user-stats.php` | logged-in |
| `/user-footprint/{id}` | GET | `includes/my-wordpress/user-footprint.php` | logged-in |
| `/media-usage/{id}` | GET | `includes/my-wordpress/media-usage.php` | `read_post` on the attachment |
| `/recycle-bin/*` | various | `includes/recycle-bin/rest.php` | `delete_posts` (per-route gate) |
| `/files/*` | various | `includes/desktop-files/rest.php` | logged-in + OpenStation enabled (share routes add a sharing gate) |
| `/ai/search` | POST | `includes/ai-copilot/search.php` | logged-in + AI feature flag |
| `/ai/platform-settings` | GET / POST | `includes/ai-copilot/platform-settings.php` | `manage_options` |
| `/games/{game}/scores` | GET / POST | `includes/games/rest.php` | logged-in + OpenStation enabled + `read` (filterable via `openstation_games_rest_permission`) |
| `/games/{game}/playtime` | POST | `includes/games/rest.php` | same games gate |
| `/games/playtime` | GET | `includes/games/rest.php` | same games gate |
| `/games/challenges` | GET / POST | `includes/games/rest.php` | same games gate (create also passes `openstation_games_can_challenge`) |
| `/games/challenges/{id}/accept` | POST | `includes/games/rest.php` | same games gate + challenge recipient |
| `/games/challenges/{id}/decline` | POST | `includes/games/rest.php` | same games gate + challenge recipient |
| `/games/challenges/{id}/complete` | POST | `includes/games/rest.php` | same games gate + challenge recipient |
| `/games/users/search` | GET | `includes/games/rest.php` | same games gate |
| `/agents` | GET / POST | `includes/agents/rest.php` | GET `edit_posts`, POST `edit_users` (both filterable; whole module behind the `agents` extended option) |
| `/agents/{id}` | GET / POST / DELETE | `includes/agents/rest.php` | GET `edit_posts`, POST/DELETE `edit_users` (filterable) |
| `/agents/{id}/invoke` | POST | `includes/agents/rest.php` | `edit_posts` (filterable via `openstation_agents_user_can_invoke`), then the per-agent gate `openstation_agent_user_can_invoke_agent()` (honours the trigger's `capability`) + per-invoker and per-agent rate limits. The run itself is ceilinged at the caller's own capabilities — see [`docs/agents-security.md`](../../docs/agents-security.md) |
| `/agents/abilities` | GET | `includes/agents/rest.php` | `edit_posts` (filterable) |
| `/agents/trigger-kinds` | GET | `includes/agents/rest.php` | `edit_posts` (filterable) |
| `/agents/hooks-catalogue` | GET | `includes/agents/rest.php` | `edit_posts` (filterable) |
| `/agents/roles` | GET | `includes/agents/rest.php` | `edit_users` (filterable) |

## Conventions

- **Nonce.** Every state-changing route requires `X-WP-Nonce` (the standard REST nonce). Read routes that depend on per-user state also require it.
- **Permission.** Permission callbacks use either `is_user_logged_in()` + capability checks or domain predicates. Shell-internal endpoints that only touch the caller's own per-user desktop state (`/session`, `/default-window`, `/intros`, `/os-settings`, `/pwa-state`, `/presence`) share the `openstation_rest_require_enabled()` gate (`includes/helpers.php`): logged-in **and** `openstation_is_enabled()`, returning `401` when logged out and `403` when OpenStation is off. `read` alone is deliberately not enough — every authenticated role carries it. Filtering with `openstation_*` hooks lets plugins extend or harden access.
- **Errors.** Failures return `WP_Error` with a stable `code`, a translated `message`, and a `data: { status: <int> }` block. Codes are documented per-endpoint in `docs/hooks-reference.md`.

## Why no central registration

PHP `register_rest_route()` calls execute on `rest_api_init`. The callback closures in the existing files capture per-module state — the recycle-bin store, the desktop-files registry, the AI provider — that lives in the same module. Moving the registration calls out of those files would force every callback to re-look-up its dependencies, increasing surface area without reducing coupling. The route → handler-file map above is the discoverability win we wanted; the per-module registrations are the layout that minimises blast radius.

If a future extension adds REST routes that don't fit any existing module, the `extensions/base/OpenStation_Extension_Rest` base class is the cheapest path. See `extensions/base/README.md`.
