<?php
/**
 * OpenStation — deactivation feedback: the screen hook, the payload
 * and the forwarder.
 *
 * Three surfaces show the dialog and all three call the same REST
 * route: the classic `plugins.php` (the primary surface — the sites
 * we most need to hear from never opened OpenStation), the same page
 * inside a chromeless window, and the native Plugins app. The first
 * two get the bundle from `admin_enqueue_scripts` below; the app
 * lazy-loads it from the config block `apps/plugins/plugins.os.php`
 * ships through {@see openstation_deactivation_feedback_client_config()}.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** The reasons the dialog offers, as the slugs the intake stores. */
const OPENSTATION_FEEDBACK_REASONS = array( 'changed_too_much', 'missing_features', 'too_buggy', 'other' );

/** Where a submission came from. */
const OPENSTATION_FEEDBACK_CONTEXTS = array( 'classic', 'chromeless', 'app' );

/** Longest free-text `details` forwarded, in characters. */
const OPENSTATION_FEEDBACK_DETAILS_MAX = 1000;

/**
 * The static half of what the dialog needs, shared by the screen hook
 * and the Plugins app config.
 *
 * @param string $context One of {@see OPENSTATION_FEEDBACK_CONTEXTS}.
 * @return array{ plugin:string, restUrl:string, restNonce:string, context:string }
 */
function openstation_deactivation_feedback_client_config( $context ) {
	if ( ! in_array( $context, OPENSTATION_FEEDBACK_CONTEXTS, true ) ) {
		$context = 'classic';
	}
	return array(
		'plugin'    => plugin_basename( OPENSTATION_FILE ),
		'restUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/feedback/deactivation' ) ),
		'restNonce' => wp_create_nonce( 'wp_rest' ),
		'context'   => $context,
	);
}

/**
 * What the native Plugins app needs to lazy-load the dialog, or
 * `null` when the feature is off. Rides the app's per-viewer config
 * (`apps/plugins/plugins.os.php`).
 *
 * The bundle goes through the shell's `loadVendorScript`, which
 * appends a raw `<script src>` and never prints the handle, so the
 * translations `wp_set_script_translations()` attached are harvested
 * here the way every other lazy bundle's are.
 *
 * @return array{ script:array{ url:string, translations:string }, styleUrl:string, restUrl:string }|null
 */
function openstation_deactivation_feedback_app_config() {
	if ( ! openstation_deactivation_feedback_enabled() ) {
		return null;
	}
	$script = function_exists( 'openstation_resolve_script_payload' )
		? openstation_resolve_script_payload( 'os-deactivation-feedback' )
		: array();
	$url    = ! empty( $script['url'] )
		? (string) $script['url']
		: OPENSTATION_URL . 'assets/js/deactivation-feedback' . openstation_asset_suffix() . '.js';
	return array(
		'script'   => array(
			'url'          => esc_url_raw( $url ),
			'translations' => isset( $script['translations'] ) ? (string) $script['translations'] : '',
		),
		'styleUrl' => esc_url_raw( OPENSTATION_URL . 'assets/css/deactivation-feedback.css' ),
		'restUrl'  => esc_url_raw( rest_url( 'desktop-mode/v1/feedback/deactivation' ) ),
	);
}

/**
 * Enqueue the dialog bundle on the Plugins screen — classic admin,
 * chromeless window and network admin alike — for anyone who can
 * deactivate a plugin.
 *
 * The bundle intercepts the Deactivate link on OpenStation's own row.
 * It is not in the chromeless trim list (`includes/render/chromeless-trim.php`
 * drops the admin-bar family only), so it survives inside a window.
 *
 * @param string $hook_suffix Current admin page.
 */
function openstation_feedback_enqueue_deactivation_dialog( $hook_suffix ) {
	if ( 'plugins.php' !== $hook_suffix || ! current_user_can( 'activate_plugins' ) ) {
		return;
	}
	if ( ! openstation_deactivation_feedback_enabled() ) {
		return;
	}
	$context = function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request()
		? 'chromeless'
		: 'classic';
	wp_enqueue_style( 'os-deactivation-feedback' );
	wp_enqueue_script( 'os-deactivation-feedback' );
	wp_add_inline_script(
		'os-deactivation-feedback',
		'window.openStationDeactivationFeedbackConfig = ' . wp_json_encode( openstation_deactivation_feedback_client_config( $context ) ) . ';',
		'before'
	);
}
add_action( 'admin_enqueue_scripts', 'openstation_feedback_enqueue_deactivation_dialog' );

/**
 * The real moment a first-run stamp records, in epoch seconds, or
 * `null` when it is absent or its age is unknown.
 *
 * `includes/first-run/stamps.php` writes `{ at, via }`: `via` is
 * `activation` when the stamp was written at the real moment and
 * `backfill` when it was reconstructed later for an install that
 * predates it. A backfilled `at` is the moment we noticed, not the
 * moment it happened, so it is reported as unknown rather than as a
 * number wrong by an arbitrary amount.
 *
 * @param array{at:int,via:string}|null $stamp A normalised stamp.
 * @return int|null
 */
function openstation_feedback_stamp_moment( $stamp ) {
	if ( null === $stamp || 'activation' !== $stamp['via'] || $stamp['at'] <= 0 ) {
		return null;
	}
	return (int) $stamp['at'];
}

/**
 * Whole days between two moments, floored at zero, or `null` when
 * either is unknown.
 *
 * @param int|null $from Earlier moment, epoch seconds.
 * @param int|null $to   Later moment, epoch seconds.
 * @return int|null
 */
function openstation_feedback_days_between( $from, $to ) {
	if ( null === $from || null === $to ) {
		return null;
	}
	return max( 0, (int) floor( ( $to - $from ) / DAY_IN_SECONDS ) );
}

/**
 * Build the anonymous payload for one submission.
 *
 * Deliberately no site id, no home URL hash, no user data. The random
 * per-submission id exists only so the intake can ignore a retry.
 * Every field is listed in `readme.txt` under "External services";
 * add one here and add it there in the same change.
 *
 * @param string[] $reasons Any of {@see OPENSTATION_FEEDBACK_REASONS}; the
 *                          dialog lets the admin tick several.
 * @param string   $details Free text, optional.
 * @param string   $context One of {@see OPENSTATION_FEEDBACK_CONTEXTS}.
 * @return array
 */
function openstation_deactivation_feedback_payload( $reasons, $details = '', $context = 'classic' ) {
	// Known slugs only, deduplicated, in the dialog's own order.
	$reasons = array_values(
		array_intersect( OPENSTATION_FEEDBACK_REASONS, array_map( 'strval', (array) $reasons ) )
	);
	if ( empty( $reasons ) ) {
		$reasons = array( 'other' );
	}
	if ( ! in_array( $context, OPENSTATION_FEEDBACK_CONTEXTS, true ) ) {
		$context = 'classic';
	}
	$details = sanitize_textarea_field( (string) $details );
	if ( mb_strlen( $details ) > OPENSTATION_FEEDBACK_DETAILS_MAX ) {
		$details = mb_substr( $details, 0, OPENSTATION_FEEDBACK_DETAILS_MAX );
	}

	$enabled_users = function_exists( 'openstation_users_with_prior_desktop_use' )
		? openstation_users_with_prior_desktop_use()
		: array();

	$php = explode( '.', PHP_VERSION );

	$installed_at     = openstation_feedback_stamp_moment( openstation_get_install_stamp() );
	$first_enabled_at = openstation_feedback_stamp_moment( openstation_get_first_enabled_stamp() );

	// Site-activated plugins, plus the network-activated ones on a
	// multisite: `active_plugins` alone would under-count a network.
	// Deduplicated, because network activation does not remove a
	// plugin from a site's own list.
	$active_plugins = count(
		array_unique(
			array_merge(
				(array) get_option( 'active_plugins', array() ),
				is_multisite() ? array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) ) : array()
			)
		)
	);

	return array(
		'id'                      => wp_generate_uuid4(),
		'reasons'                 => $reasons,
		'details'                 => $details,
		'plugin_version'          => OPENSTATION_VERSION,
		'wp_version'              => get_bloginfo( 'version' ),
		'php_version'             => $php[0] . '.' . ( isset( $php[1] ) ? $php[1] : '0' ),
		'locale'                  => get_locale(),
		'multisite'               => is_multisite(),
		'install_age_days'        => openstation_feedback_days_between( $installed_at, time() ),
		'ever_enabled'            => count( $enabled_users ) > 0,
		'enabled_user_count'      => count( $enabled_users ),
		'first_enable_delay_days' => openstation_feedback_days_between( $installed_at, $first_enabled_at ),
		'deactivator_enabled'     => openstation_is_enabled(),
		'active_plugins'          => $active_plugins,
		'context'                 => $context,
	);
}

/**
 * Forward one payload to the intake. Synchronous, short and
 * best-effort: the plugin is about to be deactivated, so a cron job
 * would never run, and the admin should wait three seconds at most.
 *
 * @param array $payload The filtered payload.
 * @return bool True on a 2xx answer.
 */
function openstation_deactivation_feedback_forward( array $payload ) {
	/**
	 * Filters the intake URL. Hosts that run their own intake (an
	 * internal one, say) point this at it; it receives the JSON
	 * payload by POST.
	 *
	 * @param string $endpoint Default {@see OPENSTATION_FEEDBACK_ENDPOINT}.
	 */
	$endpoint = (string) apply_filters( 'openstation_deactivation_feedback_endpoint', OPENSTATION_FEEDBACK_ENDPOINT );
	if ( '' === $endpoint ) {
		return false;
	}
	$response = wp_remote_post(
		$endpoint,
		array(
			'timeout'     => 3,
			'redirection' => 0,
			'user-agent'  => 'WP OpenStation feedback/' . OPENSTATION_VERSION,
			'headers'     => array( 'Content-Type' => 'application/json' ),
			'body'        => wp_json_encode( $payload ),
		)
	);
	return ! is_wp_error( $response ) && 2 === (int) floor( wp_remote_retrieve_response_code( $response ) / 100 );
}
