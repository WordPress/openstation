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
they may be intentionally contextual.

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

## Proposed implementation (Part 2)

The parent shipped a single `coreUpdate` config key. Generalizing to the eight
in-scope notices calls for a small, core-only state-derivation layer rather than
eight bespoke paths:

1. **Suppress in-window** — extend `desktop_mode_chromeless_suppress_update_nags()`
   with targeted `remove_action()` for each in-scope callback (keep the CSS
   `.update-nag` net as backstop).
2. **Derive once** — a `desktop_mode_get_core_notices()` builder returning an
   array of `{ id, level, message, action?, dismissible?, dismissKey? }`
   descriptors, each computed from the authoritative state in the table above,
   capability-gated exactly as Core gates them.
3. **Surface once** — ship the array in the shell config and have a client
   module render each as a shell toast (reusing the `dismissible` / `persistent`
   toast support from the parent), keyed for per-notice dismissal.

Each row's capability gate and screen exclusion (e.g. don't surface
`paused_plugins_notice` when the active window *is* `plugins.php`) carries over
from Core verbatim.
