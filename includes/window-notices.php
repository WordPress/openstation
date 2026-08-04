<?php
/**
 * Window notices — declarative top-of-window banners.
 *
 * Plugins call `openstation_register_window_notice()` to surface a
 * tone-coded banner at the top of every window matching a `match`
 * predicate (or every window by default). The shell renders the
 * notice via the `<os-notice>` web component inside the window's
 * `after-titlebar` slot, and records the user's dismissal in
 * `localStorage` so the same notice never reappears.
 *
 * Notices are pure declarative data — no JS handle is needed.
 *
 * Example:
 *
 * ```php
 * openstation_register_window_notice( array(
 *     'id'      => 'my-plugin/welcome',
 *     'tone'    => 'info',
 *     'message' => '<strong>Welcome!</strong> Read the <a href="…">docs</a>.',
 *     'match'   => array( 'window' => 'edit-php' ), // optional
 * ) );
 * ```
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Allowed tones — mirror the `<os-notice>` component's `tone`
 * attribute.
 *
 * @return string[]
 */
function openstation_window_notice_tones() {
	return array( 'info', 'success', 'warning', 'error', 'danger', 'neutral' );
}

/**
 * Register (or replace) a declarative window notice.
 *
 * @param array $args {
 *     @type string $id          Required. Persistence + dedupe key.
 *                               Recommended format `<plugin>/<slug>`.
 *     @type string $message     Required. HTML body. Passed through
 *                               `wp_kses_post()` before shipping, so
 *                               links + basic formatting are allowed
 *                               but `<script>` and other unsafe
 *                               markup are stripped.
 *     @type string $tone        Optional. One of
 *                               {@see openstation_window_notice_tones()}.
 *                               Default `info`.
 *     @type bool   $dismissible Optional. Show a close button.
 *                               Default `true`.
 *     @type string $icon        Optional. Dashicons class for a
 *                               leading glyph (e.g.
 *                               `dashicons-info`). Must match
 *                               `/^dashicons-[a-z0-9-]+$/`; values
 *                               that don't are silently dropped to
 *                               `''` rather than failing the
 *                               registration.
 *     @type array  $match       Optional. Per-window selector. Pick
 *                               any of:
 *                                 - `'window' => 'edit-php'` — single
 *                                   window id (e.g. `edit-php` for
 *                                   Posts, `plugins` for the native
 *                                   Plugins window).
 *                                 - `'windows' => array( 'edit-php',
 *                                   'edit-php-pagename' )` — multiple
 *                                   window ids ("all windows of kind
 *                                   X / Y / Z"). Within the array the
 *                                   semantics is OR (any id matches).
 *                                 - `'urlContains' => 'wc-admin'` —
 *                                   case-insensitive URL substring
 *                                   match. Useful for plugin pages
 *                                   whose id is derived from a long
 *                                   URL.
 *
 *                               When more than one selector type is
 *                               present, all of them must match
 *                               (AND). E.g. `array( 'windows' =>
 *                               array( 'edit-php' ), 'urlContains'
 *                               => 'wc-admin' )` shows the notice
 *                               only on the Posts window when its
 *                               URL also contains `wc-admin` — not
 *                               on every Posts window AND every
 *                               wc-admin-URL window. Use two
 *                               separate `openstation_register_window_notice()`
 *                               calls for OR-across-selector-types.
 *
 *                               When omitted, the notice paints on
 *                               every window.
 *     @type int    $order       Optional. Sort order — lower
 *                               renders higher in a stack of
 *                               notices. Default 100.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` on validation
 *                       failure.
 */
function openstation_register_window_notice( $args = array() ) {
	$defaults = array(
		'id'          => '',
		'message'     => '',
		'tone'        => 'info',
		'dismissible' => true,
		'icon'        => '',
		'match'       => array(),
		'order'       => 100,
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = (string) $args['id'];
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Window notice registration requires a non-empty `id`.', 'desktop-mode' )
		);
	}
	if ( ! preg_match( '/^[a-z0-9_\\/-]+$/i', $id ) ) {
		return openstation_registration_error(
			'openstation_invalid_id',
			__( 'Window notice `id` must be alphanumeric with hyphens, underscores, or slashes.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	if ( '' === (string) $args['message'] ) {
		return openstation_registration_error(
			'openstation_missing_message',
			__( 'Window notice registration requires a non-empty `message`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$tone = (string) $args['tone'];
	if ( ! in_array( $tone, openstation_window_notice_tones(), true ) ) {
		return openstation_registration_error(
			'openstation_invalid_tone',
			__( 'Window notice `tone` must be one of the documented values.', 'desktop-mode' ),
			array(
				'id'   => $id,
				'tone' => $tone,
			)
		);
	}

	// Icon validation. Dashicons class names are alphanumeric with
	// hyphens and always start with `dashicons-`. Anything else is
	// either a typo or attempted styling-injection; drop silently
	// rather than reject the whole registration so a minor mistake
	// in one field doesn't kill the banner entirely.
	$icon_raw = (string) $args['icon'];
	$icon     = preg_match( '/^dashicons-[a-z0-9-]+$/', $icon_raw ) ? $icon_raw : '';

	$entry = array(
		'id'          => strtolower( $id ),
		'message'     => wp_kses_post( (string) $args['message'] ),
		'tone'        => $tone,
		'dismissible' => (bool) $args['dismissible'],
		'icon'        => $icon,
		'match'       => is_array( $args['match'] ) ? $args['match'] : array(),
		'order'       => (int) $args['order'],
	);

	openstation_window_notice_registry( $entry['id'], $entry );

	/**
	 * Fires after a window notice is successfully registered.
	 *
	 * @param string $id    The notice id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'openstation_window_notice_registered', $entry['id'], $entry );

	return true;
}

/**
 * Internal module-level registry for window notices.
 *
 * @internal
 *
 * @param string     $id    Id to read or write.
 * @param array|null $entry Entry to store, or `null` to read.
 * @return array|null
 */
function openstation_window_notice_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '__flush__' === (string) $id ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

/**
 * Drop every registered window notice. Intended for PHPUnit `set_up()`
 * so a previous test's notices can't leak into the next test's
 * payload-build assertions. **Not** a public API — production code
 * that calls this would wipe every plugin's registered notice on the
 * current request. Mirrors the same `flush_*` shape the
 * commands / settings-tabs / window-chrome registries expose.
 *
 * @internal
 */
function openstation_flush_window_notice_registry() {
	openstation_window_notice_registry( '__flush__' );
}

/**
 * Build the payload shipped to the shell. Each entry is the stored
 * registry record, runnable through the
 * `openstation_window_notices` filter so plugins can mutate the
 * final list (e.g. add a dynamic notice computed at request time).
 *
 * @return array[]
 */
function openstation_build_window_notices_payload() {
	$registry = openstation_window_notice_registry();
	$entries  = is_array( $registry ) ? array_values( $registry ) : array();

	/**
	 * Filter the assembled list of window notices before it ships to
	 * the shell. Plugins can append/remove/mutate notices here for
	 * request-dependent banners (e.g. "your trial expires today")
	 * without registering them statically.
	 *
	 * @param array[] $entries List of notice entries.
	 */
	$entries = apply_filters( 'openstation_window_notices', $entries );

	// Re-sort by order for deterministic emission, then by id.
	usort(
		$entries,
		static function ( $a, $b ) {
			$oa = isset( $a['order'] ) ? (int) $a['order'] : 100;
			$ob = isset( $b['order'] ) ? (int) $b['order'] : 100;
			if ( $oa !== $ob ) {
				return $oa - $ob;
			}
			return strcmp( (string) $a['id'], (string) $b['id'] );
		}
	);

	return $entries;
}
