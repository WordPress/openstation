# `includes/rest/` — REST route map

Discoverability index for the REST surface. Routes are still registered in their owning subsystem files (where the callback closures and module state live), so moving the `register_rest_route()` calls into a single directory would have been a paperwork rename that broke nothing and improved nothing. This document is the central grep target instead.

Plugin authors looking for the canonical route URL → handler map start here; the implementation file is one open away.

## Namespace

All in-tree routes register under `desktop-mode/v1`. Extensions are expected to register under `desktop-mode-<extension>/v1` (the `extensions/base/Desktop_Mode_Extension_Rest` base enforces this).

## Routes

| Route | Verb | Handler file | Permission |
|---|---|---|---|
| `/session` | GET / POST / DELETE | `includes/session.php` | logged-in + `read` |
| `/default-window` | GET / POST | `includes/default-window.php` | logged-in + `read` |
| `/seen-intros` | GET / POST | `includes/seen-intros.php` | logged-in + `read` |
| `/os-settings` | GET / POST | `includes/os-settings.php` | logged-in + `read` |
| `/extended-options/*` | various | `includes/extended-options.php` | `manage_options` |
| `/pwa/*` | various | `includes/pwa.php` | logged-in + `read` |
| `/devtools/*` | various | `includes/devtools.php` | `manage_options` |
| `/presence` | GET | `includes/presence.php` | logged-in + `read` |
| `/posts/*` | various | `includes/posts-window/window.php` | `edit_posts` |
| `/my-wordpress/comments/*` | various | `includes/my-wordpress/comment-stats.php` | `read` |
| `/my-wordpress/terms/*` | various | `includes/my-wordpress/term-stats.php` | `read` |
| `/my-wordpress/users/*` | various | `includes/my-wordpress/user-stats.php` | `list_users` |
| `/recycle-bin/*` | various | `includes/recycle-bin/rest.php` | `delete_posts` (per-route gate) |
| `/desktop-files/*` | various | `includes/desktop-files/rest.php` | logged-in + per-file caps |
| `/ai/search` | POST | `includes/ai-copilot/search.php` | logged-in + AI feature flag |
| `/ai/platform-settings` | GET / POST | `includes/ai-copilot/platform-settings.php` | `manage_options` |
| `/ai/reindex` | POST | `includes/ai-copilot/reindex.php` | `manage_options` |

## Conventions

- **Nonce.** Every state-changing route requires `X-WP-Nonce` (the standard REST nonce). Read routes that depend on per-user state also require it.
- **Permission.** Permission callbacks use either `is_user_logged_in()` + capability checks or domain predicates (`desktop_mode_is_enabled()` for shell-internal endpoints). Filtering with `desktop_mode_*` hooks lets plugins extend or harden access.
- **Errors.** Failures return `WP_Error` with a stable `code`, a translated `message`, and a `data: { status: <int> }` block. Codes are documented per-endpoint in `docs/hooks-reference.md`.

## Why no central registration

PHP `register_rest_route()` calls execute on `rest_api_init`. The callback closures in the existing files capture per-module state — the recycle-bin store, the desktop-files registry, the AI provider — that lives in the same module. Moving the registration calls out of those files would force every callback to re-look-up its dependencies, increasing surface area without reducing coupling. The route → handler-file map above is the discoverability win we wanted; the per-module registrations are the layout that minimises blast radius.

If a future extension adds REST routes that don't fit any existing module, the `extensions/base/Desktop_Mode_Extension_Rest` base class is the cheapest path. See `extensions/base/README.md`.
