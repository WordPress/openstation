# phpMyAdmin shortcut (built-in app)

Desktop Mode ships an optional **phpMyAdmin** built-in app (`wpdc-phpmyadmin`) — registered as a native window pinned to the taskbar with a matching desktop icon. It mirrors the Code editor pattern: PHP-side window registration + a tiny TS shim that mounts an `<iframe>` against a bundled phpMyAdmin distribution.

This page documents the moving parts so you can extend it (custom icon, replacement template, alternate config) — and so you understand the security model + the compatibility shims before enabling it on a server you don't fully control.

## Status

**Experimental.** Local-only by design — see "Hard constraints" below. Tested against:

- Self-hosted MySQL/MariaDB (e.g. `wordpress-develop` running in Docker)
- WordPress Studio (SQLite-backed, via the bundled SQLite adapter — see "Studio / SQLite compatibility")

Not supported on managed hosts (wordpress.com, WP Engine, etc.) — those don't expose raw MySQL credentials, so phpMyAdmin can't connect even if you bypass the local-only gate.

## What it does

A taskbar icon labelled "phpMyAdmin". Click it → a native window opens containing a same-origin iframe pointing at `wp-content/plugins/desktop-mode/assets/vendor/phpmyadmin/index.php`. phpMyAdmin auto-logs in using the WordPress site's MySQL credentials and lands on the database the WP install uses.

## Hard constraints — fail-closed

The shortcut self-disables (no window, no icon, no script enqueue) unless **all three** of these hold:

1. `wp_get_environment_type() === 'local'`. phpMyAdmin runs with `auth_type = 'config'` so any visitor that finds the URL gets full DB access. We refuse to register on production / staging.
2. `current_user_can( 'manage_options' )`. Hides the shortcut from lower-privilege users — does **not** gate the underlying URL, which is why constraint #1 also matters.
3. `assets/vendor/phpmyadmin/index.php` exists. The vendor dir is gitignored and populated by `bin/fetch-phpmyadmin.sh`; without it there's nothing to embed.

If you need this on staging or production, switch `includes/phpmyadmin/config.inc.php` to `auth_type = 'cookie'` and remove the local-env gate. That gives every visitor a phpMyAdmin login screen instead of free access — at the cost of users needing to know their DB password.

## Bundling phpMyAdmin

The vendor directory is gitignored because the extracted distribution is ~50MB and changes on phpMyAdmin's release cadence, not this plugin's. To bundle it:

```bash
bin/fetch-phpmyadmin.sh           # downloads + verifies + extracts
npm run vendor:phpmyadmin         # equivalent — wraps the script above
```

The script downloads `phpMyAdmin-5.2.3-english.zip` from `files.phpmyadmin.net`, verifies it against the published `.sha256`, extracts into `assets/vendor/phpmyadmin/`, removes `setup/` + `examples/` to trim attack surface, saves a `.stock` backup of the MySQL driver (see below), and `touch`es every PHP file so OPcache picks them up correctly across re-fetches.

`bin/package.sh` splices the vendor dir into the release zip when present and prints a warning when absent — building a release without `bin/fetch-phpmyadmin.sh` ships a working plugin in which the phpMyAdmin shortcut is inert (the gate fails on constraint #3).

## How the config gets installed

`includes/phpmyadmin/config.inc.php` is the **template** that `wpdc_phpmyadmin_install_config()` copies verbatim into the vendor directory on every WP page load. It walks up the filesystem looking for `wp-load.php`, loads WordPress with `SHORTINIT`, then maps the WP DB constants onto phpMyAdmin's `$cfg['Servers'][1]` config:

```php
$cfg['Servers'][ $i ]['auth_type'] = 'config';
$cfg['Servers'][ $i ]['host']      = DB_HOST;
$cfg['Servers'][ $i ]['user']      = DB_USER;
$cfg['Servers'][ $i ]['password']  = DB_PASSWORD;
$cfg['Servers'][ $i ]['only_db']   = DB_NAME;
```

The `blowfish_secret` is derived from `AUTH_KEY` so it stays stable across requests without requiring a separate constant.

When `DB_USER` isn't defined (Studio / SQLite installs — wp-config.php skips DB constants there), the config falls back to the Studio-style defaults (`host=127.0.0.1`, `user=root`, `password=''`, `AllowNoPassword=true`).

## Studio / SQLite compatibility

phpMyAdmin is a MySQL/MariaDB tool by design, but Studio runs WordPress on SQLite via the `sqlite-database-integration` plugin. To make phpMyAdmin work against SQLite, we ship `includes/phpmyadmin/DbiMysqli-sqlite.php` — a custom database driver originally written by the WordPress Studio team that delegates phpMyAdmin's MySQLi calls to `WP_SQLite_Driver`.

`wpdc_phpmyadmin_install_config()` detects SQLite (via the presence of `WP_SQLite_Driver` class, the `wp-content/db.php` drop-in, or the `sqlite-database-integration` plugin under mu-plugins/plugins). When SQLite is detected, it overlays our adapter on phpMyAdmin's stock `libraries/classes/Dbal/DbiMysqli.php`. On non-SQLite installs, it leaves the stock driver alone.

### The `.stock` backup

When the plugin is moved between environments (e.g. from a Studio workspace where the adapter is in place to a Docker MySQL setup), our adapter would otherwise persist and die at load time with "WP_SQLite_Driver class not found". To recover, `bin/fetch-phpmyadmin.sh` saves a copy of the stock driver as `DbiMysqli.php.stock` right after extraction. `wpdc_phpmyadmin_install_config()` restores from that backup whenever it sees our adapter in place but no SQLite indicators.

## Compatibility shims (the non-obvious bits)

Several workarounds in `config.inc.php` exist because of how phpMyAdmin interacts with WordPress + the WASM/PHP-FPM environments. None are optional — removing them breaks the shortcut.

### Suppressing WordPress's bootstrap output

Loading `wp-load.php` from inside phpMyAdmin's bootstrap can emit deprecation notices, "WP_DEBUG already defined" warnings (on PHP-WASM where constants persist between requests), and other chatter. phpMyAdmin's error handler displays those at the top of the iframe and — worse — the output makes the later `header('X-Frame-Options: SAMEORIGIN')` call fail with "headers already sent", which causes phpMyAdmin to clear the entire response. We wrap the require in `set_error_handler() / ob_start() / display_errors=0 / error_reporting(0)` to swallow everything WP emits.

### Removing `wp_ob_end_flush_all`

WordPress hooks `wp_ob_end_flush_all` onto the `shutdown` action, which forcibly flushes every open output buffer — including phpMyAdmin's main response buffer, before phpMyAdmin can send its headers. We `remove_action( 'shutdown', 'wp_ob_end_flush_all', 1 )` after the wp-load require so phpMyAdmin owns its own flush.

### `NavigationTreeEnableGrouping = false`

phpMyAdmin's left-nav uses MySQL's `SUBSTRING_INDEX` to group databases by prefix. SQLite doesn't have that function and Studio's translator doesn't emulate it, so the nav-tree query throws and the tree renders empty. Disabling grouping makes phpMyAdmin fall back to a simpler listing query that works on both backends.

### `AllowThirdPartyFraming = 'sameorigin'`

phpMyAdmin defaults to `X-Frame-Options: DENY`. Without this override, our same-origin iframe is blocked.

### Session save path override

PHP-WASM environments (Studio, wp-now, WordPress Playground) ship a default `session.save_path` of `/home/web_user` which doesn't exist on disk. phpMyAdmin's first `session_start()` then fails. We `ini_set( 'session.save_path', sys_get_temp_dir() . '/wpdc-phpmyadmin-sessions' )` and `mkdir` it ahead of time.

### Cache-busting iframe URL

`src/phpmyadmin/index.ts` appends `?_=<timestamp>` to the iframe `src`. Without it, browsers serve a cached iframe response after the user moves the plugin between environments (e.g. SQLite → MySQL), even though the underlying file changed.

## Customising

### Replace the icon

The shortcut uses `dashicons-database`. Fork the registration call in `includes/phpmyadmin/window.php`, or override per-user via your own `desktop_mode_register_icon` call.

### Custom phpMyAdmin config

`includes/phpmyadmin/config.inc.php` is the source of truth. Edit it — the file gets copied into the vendor dir on every page load (cheap), so changes ship with plugin updates. If you need site-specific config (per-site themes, language overrides), add the logic directly in that file; it's plain PHP with full access to WordPress functions after the `wp-load.php` walk.

### Replace the bundled phpMyAdmin

If you need a different version or a custom fork, drop your install into `assets/vendor/phpmyadmin/` directly (and re-run `bin/fetch-phpmyadmin.sh` to refresh the `.stock` backup). Make sure your version is at least 5.2.x so `DbiMysqli-sqlite.php` overlays cleanly.

## Related

- [Native windows — overview + render-callback contract](./native-windows.md) — the underlying API
- [Register a desktop icon](./register-icon.md) — for shortcuts that aren't backed by a registered window
- [`desktop_mode_register_window`](../hooks-reference.md) — full PHP signature
