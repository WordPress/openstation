<?php
/**
 * Desktop Mode — My WordPress: window + pinned icon registration.
 *
 * Native window with id `desktop-mode-my-wordpress`, opened from a
 * pinned desktop icon that always sits in the top-left of the grid
 * (`pinned: true`, `position: -1`). The bundle renders a two-pane
 * file-explorer UI with breadcrumb navigation: root shows Posts and
 * Pages folder tiles, and clicking either drills into an
 * infinite-scroll list of entities with a rendered HTML preview pane.
 *
 * Filterable surface (mirrors the recycle-bin / posts-window modules):
 *
 *   - `desktop_mode_my_wordpress_window_args`
 *   - `desktop_mode_my_wordpress_icon_args`
 *   - `desktop_mode_my_wordpress_user_can_use`
 *   - `desktop_mode_my_wordpress_entities`
 *   - `desktop_mode_my_wordpress_template_html`
 *
 * @package WPDesktopMode
 * @since   0.8.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the current user should see My WordPress.
 *
 * Mirrors the recycle-bin gate — anyone who can edit posts can
 * browse posts and pages.
 *
 * @since 0.8.0
 *
 * @return bool
 */
function desktop_mode_my_wordpress_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the My WordPress
	 * pinned icon and window.
	 *
	 * @since 0.8.0
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'desktop_mode_my_wordpress_user_can_use', $can );
}

/**
 * Build the entity list shipped to the bundle. Phase 1 only declares
 * Posts and Pages; the filter exists today so plugin authors can
 * extend the list once Phase 2 wiring lands without a breaking
 * version bump.
 *
 * @since 0.8.0
 *
 * @return array[] Each entry is `array( 'id', 'label', 'icon',
 *                 'restPath' )`. `restPath` is appended to the
 *                 `restRoot` config to derive the list URL.
 */
function desktop_mode_my_wordpress_entities() {
	$entities = array(
		array(
			'id'       => 'posts',
			'label'    => __( 'Posts', 'desktop-mode' ),
			'icon'     => 'dashicons-admin-post',
			'restPath' => 'wp/v2/posts',
		),
		array(
			'id'       => 'pages',
			'label'    => __( 'Pages', 'desktop-mode' ),
			'icon'     => 'dashicons-admin-page',
			'restPath' => 'wp/v2/pages',
		),
	);

	/**
	 * Filter the list of entity types shown inside the My WordPress
	 * window. Each entry must declare `id`, `label`, `icon`, and
	 * `restPath`. Returning a reordered or extended array shows up
	 * in the bundle on the next render.
	 *
	 * **Status: Experimental** — the entity descriptor shape may
	 * gain fields as Phase 2 lands (Comments, Users, Tags,
	 * Categories, Themes, Plugins). Stable id/label/icon/restPath
	 * fields will continue to work; new optional fields will not
	 * break existing consumers.
	 *
	 * @since 0.8.0
	 *
	 * @param array[] $entities Default entities.
	 */
	$filtered = apply_filters( 'desktop_mode_my_wordpress_entities', $entities );
	return is_array( $filtered ) ? array_values( $filtered ) : $entities;
}

/**
 * Render the My WordPress window's static template body. The bundle
 * mounts its UI into `[data-desktop-mode-my-wordpress-root]`.
 *
 * @since 0.8.0
 */
function desktop_mode_my_wordpress_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-my-wordpress" data-desktop-mode-my-wordpress-root>
		<header class="desktop-mode-my-wordpress__breadcrumbs" data-desktop-mode-my-wordpress-breadcrumbs>
			<button
				type="button"
				class="desktop-mode-my-wordpress__back"
				data-desktop-mode-my-wordpress-back
				disabled
				aria-label="<?php esc_attr_e( 'Back', 'desktop-mode' ); ?>"
				title="<?php esc_attr_e( 'Back', 'desktop-mode' ); ?>"
			>
				<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>
			</button>
			<nav class="desktop-mode-my-wordpress__crumbs" data-desktop-mode-my-wordpress-crumbs aria-label="<?php esc_attr_e( 'Breadcrumb', 'desktop-mode' ); ?>"></nav>
		</header>
		<div class="desktop-mode-my-wordpress__body" data-desktop-mode-my-wordpress-body>
			<div class="desktop-mode-my-wordpress__loading" data-desktop-mode-my-wordpress-loading hidden>
				<wpd-spinner></wpd-spinner>
			</div>
		</div>
		<div class="desktop-mode-folder-status-bar" data-desktop-mode-my-wordpress-status></div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the My WordPress window's template HTML.
	 *
	 * @since 0.8.0
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'desktop_mode_my_wordpress_template_html', $html );

	$allowed_html = function_exists( 'desktop_mode_native_window_allowed_html' )
		? desktop_mode_native_window_allowed_html()
		: wp_kses_allowed_html( 'post' );

	echo wp_kses( $filtered, $allowed_html );
}

/**
 * Register the native window + the pinned wallpaper icon on `init`,
 * priority 20 — after `components.php` boots the registry.
 *
 * @since 0.8.0
 */
function desktop_mode_my_wordpress_register_window() {
	if ( ! desktop_mode_my_wordpress_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'      => __( 'My WordPress', 'desktop-mode' ),
		'icon'       => 'dashicons-wordpress',
		'template'   => 'desktop_mode_my_wordpress_render_template',
		'script'     => 'desktop-mode-my-wordpress',
		'style'      => 'desktop-mode-my-wordpress',
		'width'      => 960,
		'height'     => 640,
		'min_width'  => 640,
		'min_height' => 420,
		'placement'  => 'none',
		'config'     => array(
			'restRoot'        => esc_url_raw( rest_url() ),
			'restNonce'       => wp_create_nonce( 'wp_rest' ),
			'editPostUrlBase' => esc_url_raw( admin_url( 'post.php' ) ),
			'entities'        => desktop_mode_my_wordpress_entities(),
			'perPage'         => 24,
		),
	);

	/**
	 * Filter the args used to register the My WordPress native window.
	 *
	 * @since 0.8.0
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'desktop_mode_my_wordpress_window_args', $window_args );

	$registered = desktop_mode_register_window( 'desktop-mode-my-wordpress', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] My WordPress window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'My WordPress', 'desktop-mode' ),
		'icon'     => 'dashicons-wordpress',
		'window'   => 'desktop-mode-my-wordpress',
		'pinned'   => true,
		'position' => -1,
	);

	/**
	 * Filter the args used to register the My WordPress pinned icon.
	 *
	 * Removing `pinned` here lets the icon participate in normal
	 * sort order — useful for sites that want the shortcut to feel
	 * like any other plugin icon.
	 *
	 * @since 0.8.0
	 *
	 * @param array $icon_args Args passed to `desktop_mode_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'desktop_mode_my_wordpress_icon_args', $icon_args );

	desktop_mode_register_icon( 'desktop-mode-my-wordpress', $icon_args );
}
add_action( 'init', 'desktop_mode_my_wordpress_register_window', 20 );

/**
 * Enqueue the bundle's CSS in admin context. The script is lazy-
 * loaded by the native-window sync and so does not need an
 * `admin_enqueue_scripts` call.
 *
 * @since 0.8.0
 */
function desktop_mode_my_wordpress_enqueue_styles() {
	if ( ! desktop_mode_my_wordpress_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-my-wordpress' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_my_wordpress_enqueue_styles', 30 );
