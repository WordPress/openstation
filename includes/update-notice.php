<?php
/**
 * Core-update notice — the desktop-native replacement for WordPress's
 * per-screen update nag.
 *
 * WordPress core prints "WordPress X is available! Please update now."
 * on *every* admin screen (`update_nag()` on `admin_notices`). Because
 * Desktop Mode renders each screen as its own window, that banner would
 * repeat in every open window. So we:
 *
 *   1. Detach core's nag inside every chromeless window — see
 *      `desktop_mode_chromeless_suppress_update_nags()` in
 *      `includes/core/routing.php`.
 *   2. Surface the update *once* in the desktop shell, driven by the
 *      descriptor this file computes and ships in the shell config as
 *      `coreUpdate`.
 *
 * For a routine minor release the shell shows a single persistent
 * toast. For a **major** release the shell upgrades the moment to an
 * album-sleeve card whose vinyl slides out — see
 * `src/ui/components/wpd-release-card/`. WordPress ships music-themed
 * "Release Edition" art with every major, so the art is resolved *live*
 * from the wordpress.org/news REST API (cached, fetched in the
 * background so the admin render never blocks) rather than bundled —
 * that way past and future releases work without a plugin update. When
 * no art is available the shell falls back to the plain toast.
 *
 * @since 0.9.3
 * @package DesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** Transient key prefix for a resolved release descriptor, keyed by X.Y. */
const DESKTOP_MODE_RELEASE_ART_PREFIX = 'desktop_mode_release_art_';

/** Cron hook that resolves release art off the render path. */
const DESKTOP_MODE_FETCH_RELEASE_ART_HOOK = 'desktop_mode_fetch_release_art';

/**
 * Whether `$available` is a new **major** (X.Y branch) relative to the
 * installed version — i.e. `6.9.2 -> 7.0` is major, `7.0 -> 7.0.2` is
 * not. WordPress's own major/minor definition: majors bump X.Y, minors
 * bump the third segment.
 *
 * @since 0.9.3
 *
 * @param string $installed Installed version (e.g. `6.9.2`).
 * @param string $available Available version (e.g. `7.0`).
 * @return bool
 */
function desktop_mode_is_major_update( $installed, $available ) {
	$branch = static function ( $v ) {
		$p = explode( '.', (string) $v );
		return ( isset( $p[0] ) ? $p[0] : '0' ) . '.' . ( isset( $p[1] ) ? $p[1] : '0' );
	};
	return version_compare( $branch( $available ), $branch( $installed ), '>' );
}

/**
 * The X.Y branch key for a version (`7.0.2` -> `7.0`).
 *
 * @since 0.9.3
 *
 * @param string $version Version string.
 * @return string
 */
function desktop_mode_release_branch( $version ) {
	$p = explode( '.', (string) $version );
	return ( isset( $p[0] ) ? $p[0] : '0' ) . '.' . ( isset( $p[1] ) ? $p[1] : '0' );
}

/**
 * Resolve the release-art descriptor for a major update, if available.
 *
 * The descriptor ({name, artUrl, accent, accentInk}) is resolved live
 * from wordpress.org (see {@see desktop_mode_fetch_release_art()}) and
 * cached; a cache miss schedules a background fetch and returns `null`
 * for now (the shell shows the plain toast until the art warms up). The
 * `desktop_mode_core_update_release` filter runs last, so a site can
 * supply art synchronously (e.g. for a release the news feed hasn't
 * announced yet) or force the toast by returning `null`.
 *
 * @since 0.9.3
 *
 * @param string $version Available version (e.g. `7.0`).
 * @return array{name:string,artUrl:string,accent:string,accentInk:string}|null
 */
function desktop_mode_core_update_release( $version ) {
	$key     = desktop_mode_release_branch( $version );
	$release = desktop_mode_lookup_release_art( $key );

	/**
	 * Filter the release-art descriptor for a major update. Return a
	 * descriptor (`name`, `artUrl`, `accent`, `accentInk`) to give the
	 * shell an album sleeve to animate, or `null` to fall back to the
	 * plain update toast.
	 *
	 * Runs after the live wordpress.org lookup, so returning a value
	 * here overrides it — handy for supplying art for a brand-new
	 * release before the news feed announces it, or for self-hosted
	 * setups that can't reach wordpress.org.
	 *
	 * @since 0.9.3
	 *
	 * @param array|null $release The resolved descriptor, or null.
	 * @param string     $version The full available version.
	 * @param string     $key     The X.Y branch key.
	 */
	return apply_filters( 'desktop_mode_core_update_release', $release, $version, $key );
}

/**
 * Read the cached release descriptor for a branch, scheduling a
 * background fetch on a cold cache. Never performs a synchronous remote
 * request — the admin render must not block on wordpress.org.
 *
 * @since 0.9.3
 *
 * @param string $key X.Y branch key.
 * @return array|null Cached descriptor, or null when not (yet) resolved.
 */
function desktop_mode_lookup_release_art( $key ) {
	$cached = get_transient( DESKTOP_MODE_RELEASE_ART_PREFIX . $key );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	if ( 'none' === $cached ) {
		return null; // Resolved to "no art" recently; don't refetch yet.
	}

	// Cold cache — resolve in the background so the vinyl appears on a
	// later load instead of blocking this render on an external request.
	if ( ! wp_next_scheduled( DESKTOP_MODE_FETCH_RELEASE_ART_HOOK, array( $key ) ) ) {
		wp_schedule_single_event( time(), DESKTOP_MODE_FETCH_RELEASE_ART_HOOK, array( $key ) );
	}
	return null;
}

/**
 * Background job: resolve a branch's release art from the
 * wordpress.org/news REST API and cache the result.
 *
 * The release announcement post is titled `WordPress <X.Y> "Codename"`;
 * we search the feed, match that exact shape (which excludes maintenance
 * releases and unrelated posts), and take the post's featured image as
 * the album sleeve. A hit caches for a week; a miss caches briefly so we
 * retry once the announcement lands.
 *
 * @since 0.9.3
 *
 * @param string $key X.Y branch key.
 */
function desktop_mode_fetch_release_art( $key ) {
	$transient = DESKTOP_MODE_RELEASE_ART_PREFIX . $key;

	$endpoint = add_query_arg(
		array(
			'search'   => $key,
			'per_page' => 20,
			'_embed'   => 1,
		),
		'https://wordpress.org/news/wp-json/wp/v2/posts'
	);

	$response = wp_remote_get(
		$endpoint,
		array(
			'timeout'    => 8,
			'user-agent' => 'desktop-mode/' . DESKTOP_MODE_VERSION . '; ' . home_url( '/' ),
		)
	);

	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		set_transient( $transient, 'none', 6 * HOUR_IN_SECONDS );
		return;
	}

	$posts = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( is_array( $posts ) ) {
		foreach ( $posts as $post ) {
			$release = desktop_mode_parse_release_post( $post, $key );
			if ( $release ) {
				set_transient( $transient, $release, WEEK_IN_SECONDS );
				return;
			}
		}
	}

	// No matching announcement yet — cache a short-lived miss so a new
	// release is picked up soon after its post goes live.
	set_transient( $transient, 'none', 6 * HOUR_IN_SECONDS );
}
add_action( DESKTOP_MODE_FETCH_RELEASE_ART_HOOK, 'desktop_mode_fetch_release_art' );

/**
 * Parse a news-feed post into a release descriptor if it's the major
 * announcement for `$key`. Returns `null` for non-matching posts
 * (maintenance releases, recaps, …).
 *
 * @since 0.9.3
 *
 * @param mixed  $post Decoded REST post (associative array).
 * @param string $key  X.Y branch key.
 * @return array{name:string,artUrl:string,accent:string,accentInk:string}|null
 */
function desktop_mode_parse_release_post( $post, $key ) {
	if ( ! is_array( $post ) || ! isset( $post['title']['rendered'] ) ) {
		return null;
	}

	$title = html_entity_decode( (string) $post['title']['rendered'], ENT_QUOTES );

	// Major announcement: "WordPress <X.Y> "Codename"" — the version is
	// immediately followed by a quoted codename. Excludes "7.0.1
	// Maintenance Release" (version continues with `.1`) and unrelated
	// posts. Both curly and straight quotes are accepted.
	$pattern = '/^WordPress ' . preg_quote( $key, '/' ) . '\s*[\x{201C}"]([^\x{201D}"]+)[\x{201D}"]/u';
	if ( ! preg_match( $pattern, $title, $m ) ) {
		return null;
	}

	$art = desktop_mode_pick_media_size( $post );
	if ( '' === $art ) {
		return null;
	}

	return array(
		'name'      => trim( $m[1] ),
		'artUrl'    => esc_url_raw( $art ),
		// A classic cream vinyl label reads well over any release's
		// sleeve; the "Update now" button uses the WordPress blue set in
		// the component. Override both via the filter for a per-release
		// color match.
		'accent'    => '#efe6d3',
		'accentInk' => '#1a1a1a',
	);
}

/**
 * Pick a sensibly-sized featured image URL from an embedded post —
 * `medium_large` is plenty for the ~150px sleeve; fall back up the size
 * ladder, then to the full image.
 *
 * @since 0.9.3
 *
 * @param array $post Decoded REST post with `_embed`.
 * @return string Image URL, or `''`.
 */
function desktop_mode_pick_media_size( $post ) {
	if ( ! isset( $post['_embedded']['wp:featuredmedia'][0] ) ) {
		return '';
	}
	$media = $post['_embedded']['wp:featuredmedia'][0];
	$sizes = isset( $media['media_details']['sizes'] ) ? $media['media_details']['sizes'] : array();
	foreach ( array( 'medium_large', 'large', '1536x1536', 'medium' ) as $pref ) {
		if ( isset( $sizes[ $pref ]['source_url'] ) ) {
			return (string) $sizes[ $pref ]['source_url'];
		}
	}
	return isset( $media['source_url'] ) ? (string) $media['source_url'] : '';
}

/**
 * Resolve the pending WordPress core update, if any, into the compact
 * descriptor the shell renders.
 *
 * Reads WordPress's authoritative update state (the same
 * `get_preferred_from_update_core()` core's own `update_nag()` uses),
 * gated on the `update_core` capability so users who can't update never
 * see the notice. Returns `null` when no upgrade is pending or the user
 * lacks the capability.
 *
 * @since 0.9.3
 *
 * @return array{version:string,url:string,major:bool,release:?array}|null
 */
function desktop_mode_get_core_update() {
	if ( ! current_user_can( 'update_core' ) ) {
		return null;
	}

	// `get_preferred_from_update_core()` lives in
	// wp-admin/includes/update.php, loaded on admin requests. Guard
	// defensively in case this runs in an unusual context.
	if ( ! function_exists( 'get_preferred_from_update_core' ) ) {
		require_once ABSPATH . 'wp-admin/includes/update.php';
	}
	if ( ! function_exists( 'get_preferred_from_update_core' ) ) {
		return null;
	}

	$cur = get_preferred_from_update_core();
	if ( ! isset( $cur->response ) || 'upgrade' !== $cur->response ) {
		return null;
	}

	$version = isset( $cur->current ) ? (string) $cur->current : '';
	if ( '' === $version ) {
		return null;
	}

	$major = desktop_mode_is_major_update( get_bloginfo( 'version' ), $version );

	$update = array(
		'version' => $version,
		// `self_admin_url()` resolves to the network update screen on
		// multisite (where `update_core` is a super-admin action) and
		// the site update screen otherwise — matching where the
		// capability actually lets the user act.
		'url'     => self_admin_url( 'update-core.php' ),
		'major'   => $major,
		// Release art only matters for a major; the shell ignores it
		// for minors and shows the plain toast.
		'release' => $major ? desktop_mode_core_update_release( $version ) : null,
	);

	/**
	 * Filter the core-update descriptor before it ships to the shell.
	 *
	 * Return `null` to suppress the desktop update notice entirely —
	 * useful for sites that manage core updates out-of-band and don't
	 * want the nag surfaced at all.
	 *
	 * @since 0.9.3
	 *
	 * @param array{version:string,url:string,major:bool,release:?array}|null $update The descriptor.
	 */
	$update = apply_filters( 'desktop_mode_core_update_notice', $update );

	return ( is_array( $update ) && ! empty( $update['version'] ) ) ? $update : null;
}
