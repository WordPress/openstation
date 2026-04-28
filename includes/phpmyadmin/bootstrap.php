<?php
/**
 * Desktop Mode — phpMyAdmin app.
 *
 * Embeds a bundled phpMyAdmin install (~5.2.x) as a built-in app:
 * registered as a native desktop window (`wpdc-phpmyadmin`), pinned to
 * the bottom taskbar, with a matching wallpaper icon.
 *
 * Hard constraints — fail-closed if any of these aren't met:
 *
 *   1. `wp_get_environment_type() === 'local'`. phpMyAdmin runs with
 *      `auth_type=config`, reusing the WordPress DB credentials, so any
 *      visitor that finds the URL gets full DB access. We refuse to
 *      register the shortcut on production / staging environments.
 *   2. `current_user_can( 'manage_options' )`. Hides the shortcut from
 *      lower-privilege users — does NOT gate the underlying URL, which
 *      is why constraint #1 above also matters.
 *   3. `assets/vendor/phpmyadmin/index.php` exists. The vendor dir is
 *      gitignored and populated by `bin/fetch-phpmyadmin.sh`; without
 *      it there's nothing to embed.
 *
 * @package WPDesktopMode
 * @since 0.19.0
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/window.php';
