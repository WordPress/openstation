<?php
/**
 * OpenStation Preferences — the settings window, as an OpenStation app.
 *
 * THE Preferences window: the App Framework rebuild replaced the
 * legacy JS-registered native window and its lazy panel bundle, and
 * claims its id — `desktop-mode-os-settings` is a frozen identifier
 * (see AGENTS.md), so saved sessions, the System tile's flyout row,
 * `wp.os.openOsSettings()` and the default-window marker keep working
 * unchanged. The window is this file; the body is `os-settings.os.ts`,
 * a client view painting every page from the shell's settings store
 * through the public `wp.os` API.
 *
 * The settings are NOT this app's state — they are per-user meta the
 * shell applies before its first paint (`includes/os-settings.php`,
 * `src/settings/`). This app's state is the page; its server surface
 * is the handful of writes that are site truth rather than a
 * preference, plus `data()` for the facts that can change mid-session.
 *
 * (Header kept short on purpose: Plugin Check's direct-access scan
 * reads only the first 50 raw lines, and the guard below must land
 * inside that window.)
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\OsSettings;

use OpenStation\App;
use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/** The window id — a frozen identifier, see the file header. */
const ID = 'desktop-mode-os-settings';

/**
 * The gear the Preferences window wears — the same eight-toothed
 * annulus the System tile's flyout draws (`src/ui/gear-icon.ts`).
 * Hand-drawn rather than `dashicons-admin-generic`, which is also the
 * fallback every registry hands a plugin that registered without art:
 * the one window that should be findable at a glance would have
 * looked exactly like the tiles nobody bothered to draw. Drawn in
 * `currentColor`, like every other piece of shell art.
 *
 * @return string SVG markup.
 */
function gear_svg() {
	$teeth = '';
	for ( $i = 0; $i < 8; $i++ ) {
		$teeth .= sprintf(
			'<rect x="28" y="5" width="8" height="12" rx="2" fill="currentColor" transform="rotate(%d 32 32)"/>',
			45 * $i
		);
	}
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' . $teeth
		. '<circle cx="32" cy="32" r="15.5" fill="none" stroke="currentColor" stroke-width="9"/></svg>';
}

/**
 * Refuse an action that changes SITE truth to anyone who may not.
 * The app itself is open to every shell user; these actions are not.
 *
 * @param Os $os Host handle.
 * @return void
 * @throws \RuntimeException When the acting user lacks `manage_options`.
 */
function require_admin( Os $os ) {
	if ( ! $os->can( 'manage_options' ) ) {
		throw new \RuntimeException( esc_html__( 'You are not allowed to change site-wide options.', 'desktop-mode' ) );
	}
}

/**
 * The server facts the client view paints from — the ones that can
 * change while the window is open. The `focus` lifecycle action
 * recomputes them whenever the window regains focus, which is how the
 * AI toggle un-gates after the user connects a provider elsewhere.
 *
 * @param State $state Unused — nothing here depends on the page.
 * @param Os    $os    Host handle.
 * @return array<string,mixed>
 */
function data( State $state, Os $os ) {
	$admin = $os->can( 'manage_options' );
	return array(
		'isAdmin'                => $admin,
		'canUpload'              => $os->can( 'upload_files' ),
		'canManageDesktopThemes' => function_exists( 'openstation_desktop_theme_upload_capability' )
			&& $os->can( openstation_desktop_theme_upload_capability() ),
		'extendedOptions'        => $admin && function_exists( 'openstation_get_extended_options' )
			? openstation_get_extended_options()
			: null,
		'commentsAi'             => $admin && function_exists( 'openstation_comments_ai_is_enabled' )
			? array(
				'enabled'            => openstation_comments_ai_is_enabled(),
				'providerConfigured' => openstation_comments_ai_provider_configured(),
			)
			: null,
		'aiAssistant'            => function_exists( 'openstation_ai_assistant_config' )
			? openstation_ai_assistant_config( $os->auth->user_id() )
			: null,
	);
}

/**
 * The comments-AI toggle: a site option, the same write the
 * `POST desktop-mode/v1/comments/ai-settings` route makes.
 *
 * @param State               $state Unused.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  `enabled` (bool).
 * @return void
 */
function comments_ai_action( State $state, Os $os, array $args ) {
	require_admin( $os );
	if ( ! defined( 'OPENSTATION_COMMENTS_AI_OPTION' ) ) {
		return;
	}
	$enabled = ! empty( $args['enabled'] );
	update_option( OPENSTATION_COMMENTS_AI_OPTION, $enabled, false );
	/** This action is documented in includes/comments-window/ai-moderation.php */
	do_action( 'openstation_comments_ai_toggled', $enabled );
}

/**
 * Extended Options: merged over the stored set, then a menu refresh —
 * every option gates a server-side registration (`games` decides
 * whether the games module loads at all), and the shell only learns
 * what the server registers from a fresh payload.
 *
 * @param State               $state Unused.
 * @param Os                  $os    Host handle.
 * @param array<string,mixed> $args  `options` (array of bools).
 * @return void
 */
function extended_action( State $state, Os $os, array $args ) {
	require_admin( $os );
	if ( function_exists( 'openstation_save_extended_options' ) ) {
		openstation_save_extended_options( isset( $args['options'] ) && is_array( $args['options'] ) ? $args['options'] : array() );
	}
	$os->refresh_menu();
}

/**
 * "Delete folder sharing data" — drops every shares table, the same
 * destructive cleanup the files REST route performs.
 *
 * @param State $state Unused.
 * @param Os    $os    Host handle.
 * @return void
 */
function purge_shares_action( State $state, Os $os ) {
	require_admin( $os );
	if ( ! function_exists( 'openstation_files_rest_purge_sharing_tables' ) ) {
		$os->toast( __( 'Files REST endpoint is not available.', 'desktop-mode' ) );
		return;
	}
	$response = openstation_files_rest_purge_sharing_tables();
	$dropped  = $response instanceof \WP_REST_Response ? (array) $response->get_data()['dropped'] : array();
	$os->toast(
		sprintf(
			/* translators: %d: number of tables dropped. */
			__( 'Folder sharing data deleted. (%d tables)', 'desktop-mode' ),
			count( $dropped )
		)
	);
}

return App::define( ID )
	// Not translated: the product's own name, as the legacy window had it.
	->title( 'OpenStation Preferences' )
	->icon( gear_svg() )
	->size( 820, 720 )
	->min_size( 560, 480 )
	// No launcher of its own: the System tile's flyout row opens it
	// and answers for it on the rail (`NavItem.answersFor`), exactly
	// as before. `wp.os.openOsSettings()` is the portable opener.
	->placement( 'none' )
	->capabilities( 'read' )
	// The page is the whole declared state; the settings live in the
	// shell's store and reach the view through `wp.os.getOsSettings()`.
	->state( array( 'tab' => 'appearance' ) )
	// `wp.os.openOsSettings( { tabId } )` lands on the page it named.
	->mount(
		static function ( State $state, Os $os ) {
			$tab = sanitize_key( (string) $os->param( 'tab', '' ) );
			if ( '' !== $tab ) {
				$state->set( 'tab', $tab );
			}
		}
	)
	->action( 'extended', __NAMESPACE__ . '\extended_action' )
	->action( 'comments-ai', __NAMESPACE__ . '\comments_ai_action' )
	->action(
		'reset-intros',
		static function ( State $state, Os $os ) {
			if ( function_exists( 'openstation_clear_seen_intros' ) ) {
				openstation_clear_seen_intros( $os->auth->user_id() );
			}
		}
	)
	->action( 'purge-shares', __NAMESPACE__ . '\purge_shares_action' )
	// Regaining focus re-probes the server facts: nothing to run, the
	// recomputed `data()` is the point.
	->action( 'focus', static function () {} )
	->data( __NAMESPACE__ . '\data' )
	// The static facts, shipped once with the window config.
	->config(
		array(
			'mediaUrl'         => esc_url_raw( rest_url( 'wp/v2/media' ) ),
			'desktopThemesUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/desktop-themes' ) ),
			'aboutFeedUrl'     => esc_url_raw(
				add_query_arg(
					array(
						'action' => 'openstation_about_feed',
						'nonce'  => wp_create_nonce( 'openstation_about_feed' ),
					),
					admin_url( 'admin-ajax.php' )
				)
			),
			'pluginUrl'        => esc_url_raw( untrailingslashit( OPENSTATION_URL ) ),
			'pluginVersion'    => OPENSTATION_VERSION,
		)
	);
