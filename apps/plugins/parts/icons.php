<?php
/**
 * Plugins app — the card icon of an installed plugin.
 *
 * Part of the `desktop-mode-plugins` app: required by `plugins.os.php`,
 * plain `.php` on purpose — only `*.os.php` files are app entries to
 * the framework loader. Resolves `openstation_icon_url` for a row: a
 * file the plugin ships in its own folder first, then the `icons` map
 * wp.org returned, then a guessed SVN asset URL. Every callback uses
 * only `wp-includes/` functions.
 *
 * @package OpenStation
 */

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * `openstation_icon_url` callback.
 *
 * Resolves a card icon URL for an installed plugin row, in priority:
 *
 *   1. **Local file** — the plugin's own folder ships an icon at a
 *      conventional path (`assets/icon.svg`, `assets/icon-256x256.png`,
 *      `assets/icon-128x128.png`, or the same names at the folder
 *      root). This is what makes premium, internal and native-bundled
 *      plugins display correctly — they aren't on `ps.w.org/<slug>/`.
 *   2. **The `icons` map wp.org returned** for this plugin, cached in
 *      the `update_plugins` transient — a URL the directory gave us
 *      rather than one we built.
 *   3. **Guessed SVN asset** — `https://ps.w.org/<slug>/assets/icon.svg`,
 *      for when that metadata isn't cached. `<slug>` prefers the
 *      directory slug, then the folder name, then the textdomain.
 *      Last, because both halves of the guess are unknowable: the
 *      format (Gutenberg and UpdraftPlus ship JPEG only) and the slug
 *      (`hello.php` is listed as `hello-dolly`).
 *
 * Skipped entirely when step 2 established the plugin uploaded no art:
 * `null` paints the placeholder without a request, where guessing would
 * spend a 404 per candidate arriving at the same picture.
 *
 * @param array $row Core REST plugin row.
 * @return string|null
 */
function openstation_plugins_window_field_icon_url( $row ) {
	$plugin_file = openstation_plugins_window_row_plugin_file( $row );
	$entry       = openstation_plugins_window_update_entry( $plugin_file );
	$folder      = '' !== $plugin_file ? dirname( $plugin_file ) : '';
	$slug        = ( '' !== $folder && '.' !== $folder ) ? $folder : '';

	// wp.org's own slug when it knows the plugin; the rest are inferred.
	if ( null !== $entry && ! empty( $entry['slug'] ) ) {
		$slug = (string) $entry['slug'];
	} elseif ( '' === $slug ) {
		// Single-file plugin (e.g. hello.php at the plugins root) —
		// no folder slug, so fall back to the text domain.
		$slug = isset( $row['textdomain'] ) ? (string) $row['textdomain'] : '';
	}

	$slug = sanitize_key( $slug );
	if ( '' === $slug ) {
		return null;
	}

	$default = openstation_plugins_window_local_icon_url( $plugin_file );
	$no_art  = false;
	if ( null === $default && null !== $entry ) {
		$default = openstation_plugins_window_directory_icon_url( $entry );
		$no_art  = ( null === $default && ! empty( $entry['icons'] ) );
	}
	if ( null === $default && ! $no_art ) {
		/*
		 * `ps.w.org` is WordPress.org's own plugin-asset host — the same
		 * origin Core's "Add Plugins" screen paints its cards from. This
		 * is directory artwork for plugins we do not ship and cannot
		 * bundle: there is nothing local to offload FROM, and the
		 * alternative is not "host it ourselves" but "no icon". It is
		 * already the last resort, becomes an `<img src>` rather than a
		 * script or stylesheet, and degrades to a dashicon placeholder
		 * when the host is blocked — so the offloading rule's suppression
		 * is one line wide and says why.
		 */
		// phpcs:ignore PluginCheck.CodeAnalysis.Offloading.OffloadedContent -- wp.org's own asset host, for directory art this plugin cannot bundle; degrades to a placeholder.
		$default = 'https://ps.w.org/' . $slug . '/assets/icon.svg';
	}

	/**
	 * Filter the resolved icon URL for a plugin row.
	 *
	 * Return `null` to suppress the icon (forces the placeholder).
	 * Return a different URL to override the default — useful for
	 * custom CDN art or for overriding the auto-detected local icon.
	 *
	 * The `$url` parameter is a local `plugins_url()`, a URL from
	 * wp.org's `icons` map, or the guessed
	 * `ps.w.org/<slug>/assets/icon.svg`. Only that last shape walks the
	 * client's candidate chain on `<img>` error; every other URL is
	 * one-shot, then placeholder.
	 *
	 * @param string|null $url  Default URL — see the ladder above.
	 * @param string      $slug Directory slug when wp.org knows the
	 *                          plugin, else folder name or textdomain.
	 * @param array       $row  Core REST plugin row.
	 */
	return apply_filters( 'openstation_plugins_window_icon_url', $default, $slug, $row );
}

/**
 * Pick a card icon out of the `icons` map wp.org returned.
 *
 * `svg` → `2x` → `1x`, the ladder Core's Add Plugins cards use (see
 * `WP_Plugin_Install_List_Table::display_rows()`); matching it is what
 * makes the two screens agree. `default` — wp.org's geopattern for
 * plugins that uploaded no art — is skipped, so those keep the
 * window's own placeholder.
 *
 * @param array $entry An `update_plugins` entry.
 * @return string|null Null when the entry carries no art.
 */
function openstation_plugins_window_directory_icon_url( $entry ) {
	if ( empty( $entry['icons'] ) || ! is_array( $entry['icons'] ) ) {
		return null;
	}
	$icons = $entry['icons'];
	foreach ( array( 'svg', '2x', '1x' ) as $size ) {
		if ( empty( $icons[ $size ] ) || ! is_string( $icons[ $size ] ) ) {
			continue;
		}
		$url = esc_url_raw( $icons[ $size ] );
		if ( '' !== $url ) {
			return $url;
		}
	}
	return null;
}

/**
 * Probe an installed plugin's own folder for a card icon.
 *
 * Plugins that ship art mostly do so at a conventional location inside
 * their own folder — `assets/icon.svg` mirroring the wp.org SVN
 * layout, occasionally bare `icon.svg` at the root. Both shapes are
 * probed; the first hit wins. The answer is memoised for the request
 * (the row is decorated once per paint, but the flyout and the table
 * can ask twice), and a folder with no `assets/` directory skips the
 * seven `assets/*` probes in one `is_dir()`.
 *
 * Single-file plugins (no folder) return `null` immediately.
 *
 * The candidate list is filterable via
 * `openstation_plugins_window_local_icon_candidates` so a host can
 * support a custom convention (e.g. an `icon@2x.svg` shape).
 *
 * @param string $plugin_file Plugin file (e.g. `"akismet/akismet.php"`).
 * @return string|null URL of the first local icon found, or null.
 */
function openstation_plugins_window_local_icon_url( $plugin_file ) {
	if ( '' === $plugin_file ) {
		return null;
	}
	$folder = dirname( $plugin_file );
	if ( '' === $folder || '.' === $folder ) {
		// Single-file plugin — no folder to scan.
		return null;
	}

	$found = false;
	$memo  = wp_cache_get( 'icon:' . $plugin_file, OPENSTATION_PLUGINS_CACHE_GROUP, false, $found );
	if ( $found ) {
		return is_string( $memo ) ? $memo : null;
	}

	/**
	 * Filter the ordered list of relative paths probed inside an
	 * installed plugin's folder when looking for a card icon. The
	 * first existing file wins; later entries are ignored.
	 *
	 * @param string[] $candidates Relative paths under the plugin folder.
	 * @param string   $folder     Plugin folder name (e.g. `"akismet"`).
	 */
	$candidates = apply_filters(
		'openstation_plugins_window_local_icon_candidates',
		array(
			'assets/icon.svg',
			'assets/icon-256x256.png',
			'assets/icon-256x256.jpg',
			'assets/icon-256x256.jpeg',
			'assets/icon-128x128.png',
			'assets/icon-128x128.jpg',
			'assets/icon-128x128.jpeg',
			'icon.svg',
			'icon-256x256.png',
			'icon-256x256.jpg',
			'icon-256x256.jpeg',
			'icon-128x128.png',
			'icon-128x128.jpg',
			'icon-128x128.jpeg',
		),
		$folder
	);

	$plugin_root = WP_PLUGIN_DIR . '/' . $folder;
	$has_assets  = is_dir( $plugin_root . '/assets' );
	$url         = null;
	foreach ( (array) $candidates as $relative ) {
		$relative = (string) $relative;
		if ( '' === $relative ) {
			continue;
		}
		if ( ! $has_assets && 0 === strpos( $relative, 'assets/' ) ) {
			continue;
		}
		if ( file_exists( $plugin_root . '/' . $relative ) ) {
			$url = plugins_url( $relative, WP_PLUGIN_DIR . '/' . $plugin_file );
			break;
		}
	}

	wp_cache_set( 'icon:' . $plugin_file, null === $url ? 0 : $url, OPENSTATION_PLUGINS_CACHE_GROUP );
	return $url;
}
