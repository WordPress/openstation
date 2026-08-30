# Migration — the shell boots from its own screen

**Who this affects:** anything that keyed shell behaviour on the admin
screen the shell happened to be painted over — `$pagenow === 'index.php'`,
`get_current_screen()->id === 'dashboard'`, a `load-index.php` hook, or a
script enqueued "on the Dashboard" that only reached the desktop because
the desktop *was* the Dashboard. Also anything that built a desktop URL
by hand as `wp-admin/index.php?desktop_mode_portal=1`.

**What to do:** gate on `openstation_is_shell_request()` instead of a
screen id, and build desktop URLs with `openstation_shell_url()` (or
`openstation_portal_url()`). Nothing else changes: every
`openstation_register_*` call, the payload shape, `wp.os.*`, the events
and `openStationConfig` are untouched.

## What changed

The desktop shell used to be injected on top of whichever admin screen
the `/openstation/` portal forwarded to: the Dashboard by default, the
last-focused window's URL otherwise, `edit.php` or `post.php` if that is
where the user had been. The shell document therefore inherited that
screen's whole script and style queue, its server-side render, and its
hidden HTML — and then loaded the same screen again inside a window.

On a site running the Gutenberg plugin the cost was the whole editor
closure: Gutenberg's experimental Dashboard page enqueues its loader on
`index.php`, the loader depends on `wp-editor`, and since the shell
document *was* `index.php`, 162 requests / 20 MB raw printed, parsed and
executed in the shell's realm where nothing ever rendered them.

The shell now boots from a screen OpenStation owns:

```
admin.php?page=openstation[&target=<admin path>][&intent=1]
```

It is registered under an empty parent, so it appears in no menu, and
its capability is `read` — the same floor the portal applies. Its
screen id is `admin_page_openstation`; `$hook_suffix` on
`admin_enqueue_scripts` is the same string.

`is_admin()` is true there and `admin_menu` / `admin_enqueue_scripts`
fire exactly as before, which is why it is an admin page rather than a
standalone document: those hooks are the contract behind every
`openstation_register_*` call and every plugin that gates registration
on `is_admin()` at load time.

## Routing

| Request | Before | Now |
|---|---|---|
| `/openstation/` | 302 → `index.php?desktop_mode_portal=1` (or the focused window's URL) | 302 → `admin.php?page=openstation`; the screen resolves the entry itself |
| `/openstation/?target=/wp-admin/edit.php` | 302 → `edit.php?desktop_mode_portal=1&desktop_mode_portal_intent=1` | 302 → `admin.php?page=openstation&target=%2Fwp-admin%2Fedit.php&intent=1` |
| `/wp-admin/edit.php` (plain GET, user enabled) | rendered in place with the shell over it | 302 → the shell screen with `target=/wp-admin/edit.php&intent=1` (one hop) |
| `/wp-admin/network/sites.php` (not allowlisted) | 302 → `/openstation/?target=…` → focused window | unchanged, ending on the shell screen |
| `index.php?desktop_mode_portal=1` (old bookmark, PWA start URL) | rendered in place | 302 → the shell screen with that URL as `target` |
| `/wp-admin/admin.php` (no `page` arg) | rendered in place | 302 → `admin.php?page=openstation`; the screen resolves the entry itself |

`desktop_mode_portal` and `desktop_mode_portal_intent` stay frozen (see
AGENTS.md). They are aliases now: a URL carrying them is the desktop's
pre-screen address and redirects to the screen. Nothing that emits them
breaks; nothing new should emit them.

## `target` and `intent` are one-shot

They are an instruction — "open this page first" — not an address. The
screen reads them once, on the request that carries them, and hands the
answer to the shell as `currentPage` and `fromPortalIntent`; nothing on
the JS side reads them from the URL. So the shell strips both with a
`history.replaceState()` at boot, leaving the canonical
`admin.php?page=openstation`.

Left in place they stop being one-shot: every reload re-reads the same
`target`, and `intent=1` re-opens that page on top of the restored
session — for the life of the tab, and past it through a bookmark or a
browser session restore. `openstation_shell_boot_target()` has always
documented that a reload of the bare screen URL re-resolves against the
live session; stripping the args is what makes the address bar hold that
URL.

The address bar is **not** normalised to `/openstation/`. That was tried
and reverted: the portal path costs an HTTP redirect on every reload,
which the user sees as an address-bar flash. Dropping two consumed args
stays on the same screen and the same route.

### A target must be a page, not just an allowlisted file

`openstation_admin_target_allowlist()` matches filenames and cannot see
the query. `admin.php` is on it — every plugin screen in the admin lives
there — but `admin.php` **without** a `page` arg is core's bootstrap with
nothing to dispatch to: it falls through the last `else` in
`wp-admin/admin.php` and answers 200 with an empty body. A URL like that
resolves, passes every same-origin and allowlist check, and renders a
window showing nothing.

`openstation_sanitize_portal_target()` refuses it, beside the guard that
refuses the shell screen itself, and the caller falls back to the entry
resolver: the saved session's focused window, else the default window,
else the Dashboard. A plugin extending the allowlist gets the same
treatment for free — the check is on the resolved URL, not the list.

`currentPage`, `fromPortal` and `fromPortalIntent` in `openStationConfig`
keep their meaning. `currentPage` is the validated `target` (else the
session's focused window, the default window, the Dashboard);
`fromPortal` is true on the screen by construction; `fromPortalIntent`
is the `intent` arg. The auto-open matrix in `src/boot/auto-open.ts` is
unchanged.

## The symptoms

**A script that only reached the desktop because the desktop was the
Dashboard.** Something enqueued when `$hook_suffix === 'index.php'`, or
inside `load-index.php`, or behind `get_current_screen()->id ===
'dashboard'`, used to print in the shell document. It now prints in the
Dashboard *window* and nowhere else — which is where it was always
meant to run. If it genuinely needs to run in the shell's own realm
(it publishes a `window.openStation*` global the shell reads, say),
enqueue it when `openstation_is_shell_request()` is true.

**A hand-built desktop URL.** `admin_url( 'index.php?desktop_mode_portal=1' )`
still works through the alias, at the cost of one redirect. Build the
URL with `openstation_shell_url()` (bare, or with a target and an
intent flag) or link to `openstation_portal_url()`.

**`openstation_admin_redirect_to_portal` returning `false`.** That filter
used to keep the shell on the page the user asked for; it now keeps the
user on a *classic* page, because the shell has no way to render there
any more. With the redirect disabled the desktop lives at
`/openstation/` and its screen only. The frozen-flag alias still
redirects: a URL naming the desktop is not a plain admin page.

**`$pagenow` / `get_current_screen()` inside a shell-only hook.** On a
shell boot they now report `admin.php` and `admin_page_openstation`.
Inside windows (chromeless requests) they report the window's page, as
always.

## Predicates

- `openstation_is_shell_request()` — true when this request paints the
  shell: the shell screen for a user with OpenStation enabled, or a
  solo boot (`?openstation_solo=<id>`, which renders in place). Never
  inside a window, never on a classic-flagged request. Every render
  hook that used to spell out "enabled, not chromeless, not classic"
  reads this now.
- `openstation_is_shell_screen_request()` — true on the shell screen
  regardless of whether the shell renders there (a disabled user, a
  window, a classic-flagged request can all address it).
- `openstation_url_is_shell_screen( $url )` — whether a URL names the
  screen. The shell never opens itself: the portal sanitiser, the
  session entry resolver, the iframe URL builder, session restore,
  hover prewarming and the service worker's speculative documents all
  refuse it.

## Trimming what still prints

With no host screen, the shell document carries OpenStation's own
assets, Core's every-admin-page set, and whatever plugins enqueue on
every admin page. The framework does not guess which of the last group
belongs in the shell; the site says so:

```php
add_filter( 'openstation_shell_dequeue_handles', function ( $handles, $kind ) {
    if ( 'script' === $kind ) {
        $handles[] = 'acme-upsell-nag';
    }
    return $handles;
}, 10, 2 );
```

A handle that a surviving script or style still depends on is refused
with a `_doing_it_wrong()` rather than dropped. See
[`hooks-reference.md`](./hooks-reference.md#openstation_shell_dequeue_handles--experimental).
