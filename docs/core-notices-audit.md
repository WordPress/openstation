# Core global admin-notice audit

Desktop Mode renders each admin screen as its own chromeless window, so any
notice WordPress Core prints **globally** (on `admin_notices` /
`network_admin_notices` / `user_admin_notices`, ungated to a screen) repeats
in every open window. The parent work handled the update nag; this audit
enumerates the **rest** of Core's global notices so each can be detached
in-window and surfaced **once** at the shell — always re-derived from
authoritative state, never by scraping notice HTML.

**Scope:** Core notices only. We deliberately do not hijack plugin
`admin_notices` — their screen-gating is arbitrary PHP we can't classify, and
they may be intentionally contextual. The one exception is a small, opt-in
[allowlist of shared *library* notices](#allowlisted-pluginlibrary-notices)
(e.g. Action Scheduler) — see below.

## Method

Every callback Core attaches to a global notice hook is registered in one of
three files (verified against `wordpress-develop` @ 7.1-alpha): [`admin-filters.php`],
[`ms-admin-filters.php`], and [`class-wp-privacy-policy-content.php`]. A notice
is **global** only if its callback renders on essentially every admin screen;
several callbacks are registered globally but self-gate to one screen (those
never actually duplicate, so they're out of scope).

[`admin-filters.php`]: https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-admin/includes/admin-filters.php
[`ms-admin-filters.php`]: https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-admin/includes/ms-admin-filters.php
[`class-wp-privacy-policy-content.php`]: https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-admin/includes/class-wp-privacy-policy-content.php

## In scope — truly global

Each of these renders on (nearly) every admin screen and duplicates across
windows. All have authoritative state to re-derive from.

| Notice | Hook / priority | Source | Renders when | Re-derivable from | Proposed desktop surface |
|---|---|---|---|---|---|
| `update_nag` | `admin_notices`/3, `network_admin_notices`/3 | `update.php` | Core upgrade available; cap `update_core` | `get_preferred_from_update_core()` | **✅ Done (parent)** — release card / toast |
| `maintenance_nag` | `admin_notices`/10, `network_admin_notices`/10 | `update.php` | `$upgrading` set, or `auto_core_update_failed['critical']` | `$GLOBALS['upgrading']` + `get_site_option('auto_core_update_failed')` | Persistent toast (warning) + "Retry update" → `update-core.php`. Already suppressed in-window; not yet surfaced. |
| `wp_recovery_mode_nag` | `admin_notices`/1 | `update.php` | `wp_is_recovery_mode()` | `wp_is_recovery_mode()` | Persistent toast (info) + "Exit Recovery Mode" link |
| `default_password_nag` | `admin_notices`/10 | `wp-admin/user.php` | `get_user_option('default_password_nag')`; not on `profile.php` | `get_user_option('default_password_nag')` (per-user) | Dismissible toast + "Change password" → profile; dismiss hits `?default_password_nag=0` |
| `deactivated_plugins_notice` | `admin_notices`/5 | `plugin.php` | `wp_force_deactivated_plugins` non-empty; cap `activate_plugins`; not on `plugins.php` | option `wp_force_deactivated_plugins` (+ site option on MS) | Toast (error), one line per plugin, → `plugins.php` |
| `paused_plugins_notice` | `admin_notices`/5 | `plugin.php` | recovery-mode paused plugins; cap `resume_plugins`; not on `plugins.php` | `wp_paused_plugins()->get_all()` | Toast (error) → `plugins.php?plugin_status=paused` (recovery-mode only) |
| `paused_themes_notice` | `admin_notices`/5 | `theme.php` | recovery-mode paused themes; cap `resume_themes`; not on `themes.php` | `wp_paused_themes()->get_all()` | Toast (error) → `themes.php` (recovery-mode only) |
| `site_admin_notice` | `admin_notices`/10, `network_admin_notices`/10 | `ms.php` | **multisite**; `wpmu_upgrade_site` ≠ DB version; cap `upgrade_network`; not on `upgrade.php` | `get_site_option('wpmu_upgrade_site')` vs `$wp_db_version` | Toast (warning) → network `upgrade.php` (multisite only) |

## Out of scope — self-gated to one screen

Registered on a global hook but the callback returns early unless on a specific
screen, so they never duplicate across windows. Leave them alone.

| Notice | Hook | Only renders on |
|---|---|---|
| `new_user_email_admin_notice` | `admin_notices`, `network_admin_notices`, `user_admin_notices` | `profile.php` with `?updated` |
| `WP_Privacy_Policy_Content::notice` | `admin_notices` | editing the privacy-policy page (`post` base) |
| `WP_Privacy_Policy_Content::policy_text_changed_notice` | `admin_notices` (conditional) | the `privacy` screen |

## Out of scope — not a global `admin_notices` at all

Candidates from the issue that turned out not to be global notices:

| Candidate | What it actually is |
|---|---|
| PHP update required/recommended (`wp_dashboard_php_nag`) | Dashboard **widget** (`wp_add_dashboard_widget`), not a notice |
| "Search engines discouraged" (`blog_public = 0`) | Text in the **At a Glance** dashboard widget + a front-end admin-bar hint, not a notice |
| Auto-update failure (plugin/theme/core) | Delivered by **email**; core-critical failure is already covered by `maintenance_nag`; per-item status shows on the Plugins/Themes/Site-Health screens |
| HTTPS / persistent object cache / cron suggestions | **Site Health** screen only |
| `settings_errors()` | Screen-specific (printed by the settings screen that set them) |
| Single-site database-update-required | A **redirect** to `upgrade.php`, not a notice (the multisite variant `site_admin_notice` *is* a notice — in scope above) |
| Plugin/theme "update available" counts | Menu **bubbles**, not notices |

## Implementation

The parent shipped a single `coreUpdate` config key; the rest are handled by a
small, core-only state-derivation layer:

1. **Suppress in-window** — `desktop_mode_chromeless_suppress_core_notices()`
   ([`includes/core/routing.php`]) targets each in-scope callback with
   `remove_action()`, alongside the update/maintenance nags handled by
   `desktop_mode_chromeless_suppress_update_nags()`.
2. **Derive once** — `desktop_mode_get_core_notices()`
   ([`includes/core-notices.php`]) returns an array of
   `{ id, title, message, actionLabel, actionUrl }` descriptors, each
   re-derived from the authoritative state in the table above and
   capability-gated exactly as Core gates it. Filterable via
   `desktop_mode_core_notices`.
3. **Surface once** — the array ships in the shell config as `coreNotices`, and
   `maybeShowCoreNotices()` ([`src/core-notices.ts`]) renders each as a
   persistent shell toast, keyed `desktop-mode/core-notice:<id>` for per-notice
   dismissal.

[`includes/core/routing.php`]: ../includes/core/routing.php
[`includes/core-notices.php`]: ../includes/core-notices.php
[`src/core-notices.ts`]: ../src/core-notices.ts

**Dismissibility.** Every notice renders as a **persistent, dismissible**
toast: persistent because these report conditions the user should act on (never
auto-dismissed after a timeout), dismissible because a persistent toast must
always have a way to be closed — a toast is never permanent. Dismissal is keyed
`desktop-mode/<core|plugin>-notice:<id>` and persisted client-side
(`localStorage`), so it is per-browser and per-notice.

**Screen exclusion doesn't apply.** Core hides e.g. `paused_plugins_notice` on
`plugins.php` because you're already there; the shell toast is orthogonal to any
open window, so it always surfaces once.

### Not yet implemented

- `site_admin_notice` (multisite network DB upgrade) — deferred; needs a
  multisite test environment. Same pattern applies: add a builder gated on
  `is_multisite()` + `upgrade_network`, and a `remove_action()` on both
  `admin_notices` and `network_admin_notices`.

## Allowlisted plugin/library notices

Arbitrary plugin `admin_notices` stay untouched. The exception is a narrow,
opt-in allowlist ([`includes/plugin-notices.php`]) for shared **libraries** —
bundled across many plugins, printed globally, and re-derivable from their own
state. These aren't a single plugin's contextual UX; they're infrastructure
warnings that duplicate per window exactly like the core nags. Same pattern:
detach in-window (`desktop_mode_chromeless_suppress_plugin_notices()`),
re-derive (`desktop_mode_get_plugin_notices()`, filterable via
`desktop_mode_plugin_notices`), surface once. Adding a library is a new builder
plus a `remove_action()`; the bar is "shared library, re-derivable, global."

[`includes/plugin-notices.php`]: ../includes/plugin-notices.php

| Library | Notice | Re-derived from | Desktop surface |
|---|---|---|---|
| **Action Scheduler** (WooCommerce, Jetpack, …) | "N past-due actions found; something may be wrong." Printed on `admin_notices` with no throttle while past-due actions exist, so it repeats in every window. | `ActionScheduler_Store::instance()->query_actions()` for pending actions older than the threshold — mirrors `ActionScheduler_AdminView::check_pastdue_actions()`, including its filters, so the count matches. | Dismissible toast → `tools.php?page=action-scheduler&status=past-due` |
