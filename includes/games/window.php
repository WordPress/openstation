<?php
/**
 * Desktop Mode — Games: hub window + desktop icon registration.
 *
 * Native window with id `desktop-mode-games` — the "Games folder"
 * fixture on the wallpaper. The template body is a static skeleton
 * (a game grid + a detail panel, Steam-library style) that the JS
 * bundle enhances on first open: the grid paints from the games
 * registry; selecting a game reveals its description, Play +
 * Challenge actions, its scoreboard, and its challenges below.
 *
 * Both registrations are filterable via
 * `desktop_mode_games_window_args` / `desktop_mode_games_icon_args`,
 * mirroring the Recycle Bin.
 *
 * @package WPDesktopMode
 * @since   0.9.6
 */

defined( 'ABSPATH' ) || exit;

/**
 * The shared gamepad SVG used by the window icon and the desktop
 * icon.
 *
 * @since 0.9.6
 *
 * @return string Raw `<svg>` markup.
 */
function desktop_mode_games_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		. '<path fill="#6c5ce7" d="M18 16h28a16 16 0 0 1 16 16v10a10 10 0 0 1-18.3 5.6L39.9 42H24.1l-3.8 5.6A10 10 0 0 1 2 42V32a16 16 0 0 1 16-16z"/>'
		. '<rect x="12" y="28" width="14" height="5" rx="2.5" fill="#ffffff"/>'
		. '<rect x="16.5" y="23.5" width="5" height="14" rx="2.5" fill="#ffffff"/>'
		. '<circle cx="43" cy="27" r="3.4" fill="#ffd166"/>'
		. '<circle cx="50" cy="34" r="3.4" fill="#06d6a0"/>'
		. '</svg>';
}

/**
 * Whether the current user can use desktop games.
 *
 * @since 0.9.6
 *
 * @return bool
 */
function desktop_mode_games_user_can_use() {
	$can = is_user_logged_in() && current_user_can( 'read' );

	/**
	 * Filter whether the current user can see the Games window,
	 * icon, and play games.
	 *
	 * @since 0.9.6
	 *
	 * @param bool $can Default: logged-in + `read` capability.
	 */
	return (bool) apply_filters( 'desktop_mode_games_user_can_use', $can );
}

/**
 * Echoes the Games window's template body.
 *
 * The `data-desktop-mode-games-*` hooks are the contract the JS
 * render callback relies on — keep them intact (or rename via the
 * filter) when customizing the layout.
 *
 * @since 0.9.6
 */
function desktop_mode_games_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-games" data-desktop-mode-games-root>
		<div class="desktop-mode-games__library">
			<div class="desktop-mode-games__grid" data-desktop-mode-games-grid role="listbox" aria-label="<?php esc_attr_e( 'Games', 'desktop-mode' ); ?>"></div>
			<div class="desktop-mode-games__detail" data-desktop-mode-games-detail hidden></div>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the Games window's template HTML.
	 *
	 * Keep the `data-desktop-mode-games-*` hooks intact so the JS
	 * render callback can find its mount points.
	 *
	 * @since 0.9.6
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'desktop_mode_games_template_html', $html );
	echo wp_kses( $filtered, desktop_mode_native_window_allowed_html() );
}

/**
 * Register the Games window + desktop icon on `init`.
 *
 * Priority 20, after the native-window registry bootstraps — same
 * timing as the Recycle Bin.
 *
 * @since 0.9.6
 */
function desktop_mode_games_register_window() {
	if ( ! desktop_mode_games_user_can_use() ) {
		return;
	}

	$icon_uri = 'data:image/svg+xml;base64,' . base64_encode( desktop_mode_games_icon_svg() );

	$window_args = array(
		'title'      => __( 'Games', 'desktop-mode' ),
		'icon'       => $icon_uri,
		'template'   => 'desktop_mode_games_render_template',
		'script'     => 'desktop-mode-games',
		'width'      => 900,
		'height'     => 600,
		'min_width'  => 560,
		'min_height' => 400,
		'placement'  => 'dock',
	);

	/**
	 * Filter the args used to register the Games native window.
	 *
	 * @since 0.9.6
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'desktop_mode_games_window_args', $window_args );

	$registered = desktop_mode_register_window( 'desktop-mode-games', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Games window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Games', 'desktop-mode' ),
		'icon_svg' => desktop_mode_games_icon_svg(),
		'window'   => 'desktop-mode-games',
		'position' => 85,
	);

	/**
	 * Filter the args used to register the Games desktop icon.
	 *
	 * @since 0.9.6
	 *
	 * @param array $icon_args Args passed to `desktop_mode_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'desktop_mode_games_icon_args', $icon_args );

	desktop_mode_register_icon( 'desktop-mode-games', $icon_args );
}
add_action( 'init', 'desktop_mode_games_register_window', 20 );

/**
 * Localize REST endpoints for the JS bundle.
 *
 * The bundle reads its config off `window.desktopModeGamesConfig`
 * and never hardcodes URLs.
 *
 * @since 0.9.6
 */
function desktop_mode_games_localize_config() {
	if ( ! desktop_mode_games_user_can_use() ) {
		return;
	}

	wp_localize_script(
		'desktop-mode-games',
		'desktopModeGamesConfig',
		array(
			'restNonce'      => wp_create_nonce( 'wp_rest' ),
			'gamesUrlBase'   => esc_url_raw( rest_url( 'desktop-mode/v1/games' ) ),
			'challengesUrl'  => esc_url_raw( rest_url( 'desktop-mode/v1/games/challenges' ) ),
			'usersSearchUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/games/users/search' ) ),
		)
	);

	wp_enqueue_style( 'desktop-mode-games' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_games_localize_config', 30 );
