<?php
/**
 * OpenStation — Games: hub window + desktop icon registration.
 *
 * Native window with id `desktop-mode-games` — the "Games folder"
 * fixture on the wallpaper. The template body is a static skeleton
 * (a game grid + a detail panel, Steam-library style) that the JS
 * bundle enhances on first open: the grid paints from the games
 * registry; selecting a game reveals its description, Play +
 * Challenge actions, its scoreboard, and its challenges below.
 *
 * Both registrations are filterable via
 * `openstation_games_window_args` / `openstation_games_icon_args`,
 * mirroring the Recycle Bin.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The shared gamepad SVG used by the window icon and the desktop
 * icon.
 *
 * Drawn in `currentColor`, which is what makes it a silhouette:
 * `isSilhouetteSvg()` in `src/icon.ts` looks for exactly that token
 * and, finding it, paints the art as a CSS mask instead of a
 * background-image, so it takes whatever colour the surface is
 * already using for text.
 *
 * This icon used to be the only fixed-colour one in the shell, in
 * four hues (`#6c5ce7`, white, `#ffd166`, `#06d6a0`) that belong to
 * no palette the plugin ships. Two things followed from that. It
 * could not invert on a light title bar or a light desktop theme,
 * because a background-image has no colour to inherit. And under a
 * desktop theme's icon tint it collapsed outright: that path runs
 * `applyIconMask()`, which keeps only the artwork's alpha, and every
 * pixel of the old gamepad was opaque, so the d-pad and the buttons
 * vanished into a featureless blob.
 *
 * Redrawn as an outlined body with the controls knocked into it, the
 * detail is carried by negative space rather than by colour, so it
 * survives both. Held to five elements because it renders as small as
 * 20px in the dock: body, two d-pad bars, two buttons.
 *
 * @return string Raw `<svg>` markup.
 */
function openstation_games_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		// The body: outlined, so what sits inside it reads as detail
		// rather than as more fill.
		. '<path d="M21 21h22a13 13 0 0 1 12.6 9.8l2.8 11.2a7.5 7.5 0 0 1-13.6 5.8L40.5 41h-17l-4.3 6.8A7.5 7.5 0 0 1 5.6 42l2.8-11.2A13 13 0 0 1 21 21z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
		// D-pad, two crossed bars sharing a centre.
		. '<rect x="14" y="28.5" width="14" height="4.6" rx="2.3" fill="currentColor"/>'
		. '<rect x="18.7" y="23.8" width="4.6" height="14" rx="2.3" fill="currentColor"/>'
		// Face buttons, offset on the diagonal the way a real pad has
		// them. Two, not four: four would not separate at 20px.
		. '<circle cx="40.5" cy="34" r="3.1" fill="currentColor"/>'
		. '<circle cx="47.5" cy="28.5" r="3.1" fill="currentColor"/>'
		. '</svg>';
}

/**
 * Whether the current user can use desktop games.
 *
 * @return bool
 */
function openstation_games_user_can_use() {
	$can = is_user_logged_in() && current_user_can( 'read' );

	/**
	 * Filter whether the current user can see the Games window,
	 * icon, and play games.
	 *
	 * @param bool $can Default: logged-in + `read` capability.
	 */
	return (bool) apply_filters( 'openstation_games_user_can_use', $can );
}

/**
 * Echoes the Games window's template body.
 *
 * The `data-os-games-*` hooks are the contract the JS
 * render callback relies on — keep them intact (or rename via the
 * filter) when customizing the layout.
 */
function openstation_games_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-games" data-os-games-root>
		<div class="os-games__library">
			<div class="os-games__grid" data-os-games-grid role="listbox" aria-label="<?php esc_attr_e( 'Games', 'desktop-mode' ); ?>"></div>
			<div class="os-games__detail" data-os-games-detail hidden></div>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the Games window's template HTML.
	 *
	 * Keep the `data-os-games-*` hooks intact so the JS
	 * render callback can find its mount points.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_games_template_html', $html );
	echo wp_kses( $filtered, openstation_native_window_allowed_html() );
}

/**
 * Register the Games window + desktop icon on `init`.
 *
 * Priority 20, after the native-window registry bootstraps — same
 * timing as the Recycle Bin.
 */
function openstation_games_register_window() {
	if ( ! openstation_games_user_can_use() ) {
		return;
	}

	$icon_uri = 'data:image/svg+xml;base64,' . base64_encode( openstation_games_icon_svg() );

	$window_args = array(
		'title'      => __( 'Games', 'desktop-mode' ),
		'icon'       => $icon_uri,
		'template'   => 'openstation_games_render_template',
		'script'     => 'desktop-mode-games',
		// Companion styles load with the games bundle on first open.
		// Every game window (`os-game-<id>`) is opened by
		// `launchGame()`, which lives in that bundle — so a sheet
		// riding it here is guaranteed in the tab before any game
		// paints. Built-in games append their own via the
		// `openstation_games_window_args` filter below.
		'styles'     => array( 'desktop-mode-games' ),
		'width'      => 900,
		'height'     => 600,
		'min_width'  => 560,
		'min_height' => 400,
		// No dock tile from the window registration: the desktop icon
		// below is this app's one launcher. Registering both used to
		// mint two entries for one app, each with its own default, and
		// the dock painted a tile while Preferences said "On the
		// desktop". The navigation model collapses them either way —
		// this keeps Games matching how My WordPress and Corkboard
		// already register.
		'placement'  => 'none',
	);

	/**
	 * Filter the args used to register the Games native window.
	 *
	 * @param array $window_args Args passed to `openstation_register_window()`.
	 */
	$window_args = (array) apply_filters( 'openstation_games_window_args', $window_args );

	$registered = openstation_register_window( 'desktop-mode-games', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Games window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Games', 'desktop-mode' ),
		'icon_svg' => openstation_games_icon_svg(),
		'window'   => 'desktop-mode-games',
		'position' => 85,
	);

	/**
	 * Filter the args used to register the Games desktop icon.
	 *
	 * @param array $icon_args Args passed to `openstation_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'openstation_games_icon_args', $icon_args );

	openstation_register_icon( 'desktop-mode-games', $icon_args );
}
add_action( 'init', 'openstation_games_register_window', 20 );

/**
 * Localize REST endpoints for the JS bundle.
 *
 * The bundle reads its config off `window.openStationGamesConfig`
 * and never hardcodes URLs.
 */
function openstation_games_localize_config() {
	if ( ! openstation_games_user_can_use() ) {
		return;
	}

	wp_localize_script(
		'desktop-mode-games',
		'openStationGamesConfig',
		array(
			'restNonce'      => wp_create_nonce( 'wp_rest' ),
			'gamesUrlBase'   => esc_url_raw( rest_url( 'desktop-mode/v1/games' ) ),
			'challengesUrl'  => esc_url_raw( rest_url( 'desktop-mode/v1/games/challenges' ) ),
			'usersSearchUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/games/users/search' ) ),
		)
	);
}
// Priority 5 for the same reason as the recycle bin: the lazy-load payload is
// built at priority 10, and localize data attached after that never reaches a
// bundle that loads on window open.
add_action( 'admin_enqueue_scripts', 'openstation_games_localize_config', 5 );
