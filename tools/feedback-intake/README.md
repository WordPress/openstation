# OpenStation Feedback Intake

A small WordPress plugin that runs on **openstation.blog** and nowhere else. It receives the anonymous feedback an OpenStation site sends when an administrator deactivates the plugin and clicks **Send and deactivate**, stores it in one table, and shows it under **Tools → OpenStation feedback**.

It never ships to wp.org. It is not an OpenStation extension: everything under the plugin's `extensions/` runs on OpenStation sites, and this runs on ours.

## The route

```
POST /wp-json/openstation-feedback/v1/deactivation     public, throttled
GET  /wp-json/openstation-feedback/v1/deactivation     manage_options (cookie or application password)
```

The POST body is the payload `includes/feedback/deactivation.php` in the OpenStation plugin builds. Every key is typed and bounded, the enums are closed, and an unknown key is a 400. A submission is one `INSERT IGNORE` keyed on its uuid, so a retried send is a 200 and not a second row.

The GET returns rows newest first as JSON with an `X-WP-Total` header, and takes `after` (ISO 8601), `per_page` (max 1000) and `page`. The marketing metrics script pulls it with an application password.

## What keeps the public route cheap under abuse

In the order the checks run, all of them before Core's schema validation:

1. Wrong content type, empty body or a body over 2 KB: rejected.
2. Per-IP throttle: 5 submissions a minute. Global throttle: 300 a minute across every sender, so a distributed flood is bounded before it reaches the database. Both are counters in transients (the object cache when the host has one). Over either answers 429.
3. An unknown key in the JSON: rejected.

The client IP is hashed with a site salt to make the throttle key and is never stored. Nothing logs the request.

## What the table holds

`{$wpdb->prefix}openstation_feedback_deactivations`, one row per submission:

| Column | Note |
|---|---|
| `id` | the submission uuid, primary key |
| `received_at_ms` | server clock |
| `reasons` | the dialog's slugs, comma-joined in the dialog's order |
| `details` | free text, at most 1000 characters |
| `plugin_version`, `wp_version`, `php_version`, `locale` | short strings |
| `multisite`, `ever_enabled`, `deactivator_enabled` | flags |
| `install_age_days`, `first_enable_delay_days` | `NULL` when the sending site has no stamp |
| `enabled_user_bucket` | `0`, `1`, `2-5`, `6+` (the exact count is bucketed on ingest) |
| `active_plugins_bucket` | `<10`, `10-29`, `30+` |
| `context` | `classic`, `chromeless`, `app` |

## What it never holds

No IP address, no user agent, no referer, no site URL or hash of one, no site id, no user name or email, no plugin names. Nothing that identifies the site or the person. Rows are never pruned: they are small, and the trend over years is the point.

## Install

From the OpenStation repo root, `npm run package:feedback-intake` writes `openstation-feedback-intake.zip`; upload it on openstation.blog through Plugins → Add New → Upload and activate it. Activation creates the table; a file-copy install heals it on the next admin page load.
