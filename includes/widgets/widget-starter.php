<?php
/**
 * =============================================================================
 * Desktop Mode — Starter Widget PHP registration
 * =============================================================================
 *
 * WHAT THIS FILE DOES
 * -------------------
 * This is the PHP side of a Desktop Mode widget. It has three jobs:
 *
 *   1. Register the JS bundle and CSS with WordPress so they can be loaded.
 *   2. Enqueue the CSS eagerly on shell pages (prevents flash of unstyled content).
 *   3. Announce the widget to Desktop Mode via desktop_mode_register_widget()
 *      so it appears in the widget picker.
 *
 * The PHP side does NOT contain any widget logic. All the rendering, data
 * fetching, and interactivity lives in the JS file (index.ts). PHP just
 * tells the system "this widget exists, here is its metadata, here is its
 * script handle."
 *
 * HOW TO USE THIS AS A TEMPLATE
 * ------------------------------
 * 1. Copy this file to includes/widgets/widget-my.php
 * 2. Replace every "starter" in function names with your widget name
 *    e.g. desktop_mode_register_starter_* → desktop_mode_register_my_*
 * 3. Replace "widget-starter" in asset filenames with "widget-my"
 * 4. Replace 'desktop-mode/starter' with your widget id — must match
 *    the WIDGET_ID constant in your JS file exactly
 * 5. Update label, description, icon, and size constraints
 * 6. Add a require_once line for this file in desktop-mode.php
 *
 * Requires: Desktop Mode 0.18.0+ (desktop_mode_register_widget).
 *
 * @package WPDesktopMode
 * @since   0.26.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the JS bundle and CSS stylesheet handles.
 *
 * WHY wp_register_script AND NOT wp_enqueue_script?
 * The shell's server-sync loads widget scripts lazily — only when the
 * picker opens or a widget that needs this script is about to mount.
 * wp_register_script() makes the handle known to WordPress without
 * actually outputting a <script> tag. The shell requests the script
 * via its own enqueue path at the right moment. Using wp_enqueue_script()
 * here would output the tag unconditionally on every admin page, wasting
 * bandwidth for users who never open the widget picker.
 *
 * WHY IS THE CSS REGISTERED HERE BUT ENQUEUED SEPARATELY?
 * Styles do not have a lazy-load mechanism equivalent to scripts. If we
 * registered the CSS but never enqueued it, the widget would flash as
 * unstyled on first mount while the stylesheet is fetched. So we register
 * both the JS and the CSS here, then eagerly enqueue just the CSS in a
 * separate function below that only runs on shell pages.
 *
 * SCRIPT_DEBUG CONVENTION
 * When SCRIPT_DEBUG is true WordPress loads the unminified development
 * build (widget-starter.js). In production it loads the minified build
 * (widget-starter.min.js). Both are produced by `npm run build:widget-starter`.
 *
 * VERSION STRINGS
 * Using filemtime() as the version means the browser cache is busted
 * automatically whenever the file changes on disk — no manual version bumping.
 * Falls back to DESKTOP_MODE_VERSION if the file does not exist yet (e.g.
 * during development before the first build).
 */
function desktop_mode_register_starter_widget_assets() {
	$suffix  = desktop_mode_asset_suffix();
	$version = defined( 'DESKTOP_MODE_VERSION' ) ? DESKTOP_MODE_VERSION : '0';

	$js_path  = DESKTOP_MODE_DIR . 'assets/js/widget-starter' . $suffix . '.js';
	$css_path = DESKTOP_MODE_DIR . 'assets/js/widget-starter' . $suffix . '.css';

	wp_register_style(
		'desktop-mode-starter-widget',                              // Handle name — referenced in wp_enqueue_style() below.
		DESKTOP_MODE_URL . 'assets/js/widget-starter' . $suffix . '.css',
		array(),                                                    // No CSS dependencies.
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'desktop-mode-starter-widget',                              // Handle name — passed as 'script' to desktop_mode_register_widget().
		DESKTOP_MODE_URL . 'assets/js/widget-starter' . $suffix . '.js',
		array( 'wp-api-fetch' ),                                    // List WordPress script handles your widget depends on.
		                                                            // 'wp-api-fetch' is available on every admin page and handles
		                                                            // REST nonces automatically. Remove it if your widget does
		                                                            // not make REST API calls.
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true                                                        // Load in the footer — always true for widget scripts.
	);
}
add_action( 'init', 'desktop_mode_register_starter_widget_assets', 5 );
// Priority 5 — must run before desktop_mode_register_starter_widget() at priority 6
// so the script handle exists when register_widget() looks it up.

/**
 * Eagerly enqueue the CSS on Desktop Mode shell pages.
 *
 * The JS loads lazily (server-sync handles it). The CSS must load early
 * so it is in the DOM before the widget's first render — otherwise there
 * is a visible flash of unstyled content while the browser fetches the
 * stylesheet after mount.
 *
 * The two guards below prevent the stylesheet loading on pages where
 * Desktop Mode is not active:
 *   desktop_mode_is_enabled()            — user has Desktop Mode turned on
 *   desktop_mode_is_chromeless_request() — not an iframe content request
 */
function desktop_mode_enqueue_starter_widget_styles() {
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled() ) {
		return;
	}
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-starter-widget' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_starter_widget_styles', 20 );

/**
 * Announce the widget to Desktop Mode.
 *
 * This call stores the widget's metadata in Desktop Mode's registry so
 * it appears in the widget picker. The shell reads this registry at boot
 * and on every session refresh — adding or removing a widget definition
 * takes effect without a browser reload.
 *
 * AVAILABLE ARGUMENTS
 * -------------------
 *   label          string   Human-readable name shown in the picker. Required.
 *   description    string   One-line subtitle shown beneath the label.
 *   icon           string   Any dashicons class, e.g. 'dashicons-chart-bar'.
 *                           Full list: https://developer.wordpress.org/resource/dashicons/
 *   script         string   The wp_register_script() handle from above.
 *   movable        bool     true  = user can drag the widget off the right column
 *                                   and float it anywhere on the desktop.
 *                           false = widget stays in the column (default).
 *   resizable      bool     true  = user can resize the widget card.
 *                                   Requires movable: true for all 8 handles.
 *                                   Column-docked widgets only get a bottom handle.
 *   min_width      int      Smallest width the user can drag the card to (px).
 *   min_height     int      Smallest height the user can drag the card to (px).
 *   max_width      int      Optional ceiling on user-driven width resize (px).
 *   max_height     int      Optional ceiling on user-driven height resize (px).
 *   default_width  int      Starting width when first added as a floating widget.
 *   default_height int      Starting height when first added as a floating widget.
 *   capabilities   array    Optional. ALL listed capabilities must be held by the
 *                           current user or the widget will not register for them.
 *                           e.g. array( 'edit_posts', 'publish_posts' )
 */
function desktop_mode_register_starter_widget() {
	if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
		// Desktop Mode is not active — bail gracefully.
		return;
	}

	desktop_mode_register_widget(
		// First argument: widget id.
		// Must exactly match the WIDGET_ID constant in your JS file and the
		// key used in window.desktopModeWidgets[ id ] at the bottom of index.ts.
		'desktop-mode/starter',
		array(
			'label'          => __( 'Starter Widget', 'desktop-mode' ),
			'description'    => __( 'A skeleton widget — copy this to build your own.', 'desktop-mode' ),
			'icon'           => 'dashicons-welcome-widgets-menus',
			'script'         => 'desktop-mode-starter-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 200,
			'min_height'     => 140,
			'default_width'  => 280,
			'default_height' => 200,
		)
	);
}
add_action( 'init', 'desktop_mode_register_starter_widget', 6 );
// Priority 6 — runs after the asset registration at priority 5.
