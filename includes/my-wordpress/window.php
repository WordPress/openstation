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
 * Build the entity list shipped to the bundle. Posts, Pages, and —
 * since 0.20.0 — Users. Future phases add Comments, Tags,
 * Categories, Themes, and Plugins.
 *
 * The optional `kind` field tells the bundle how to render entries
 * of this entity: `'post'` (default) renders the standard
 * title/excerpt/featured-image tile and the rendered-HTML preview;
 * `'user'` renders an avatar + display-name tile and routes to the
 * user dossier preview. Plugins extending the entity list with a
 * post-shaped collection can omit the field; user-shaped
 * collections must set `'user'`.
 *
 * @since 0.8.0
 *
 * @return array[] Each entry is `array( 'id', 'label', 'icon',
 *                 'restPath', 'kind' )`. `restPath` is appended to
 *                 the `restRoot` config to derive the list URL.
 */
/**
 * Inline-SVG bot glyph used by the Agents entity tile. Returns a
 * `data:image/svg+xml;base64,…` URI so the shared `renderIcon`
 * helper (`src/icon.ts`) paints it via the existing SVG-data-URI
 * branch without any tile/icon plumbing changes.
 *
 * Color is hard-coded to the WordPress admin accent blue (`#2271b1`)
 * because data-URI SVGs are loaded as a CSS background-image, which
 * does not inherit `currentColor`. The Agents surface is a UX mock,
 * so a single brand-coloured glyph is acceptable for now; if the
 * section graduates to production we can switch to a CSS-mask
 * approach for theme-aware tinting.
 *
 * @since 0.22.0
 *
 * @return string Data URI.
 */
function desktop_mode_my_wordpress_agents_icon() {
	// Keep this SVG byte-identical to the `BOT_ICON_SVG` constant in
	// `src/my-wordpress/agents-mock.ts` so the section folder tile
	// (painted from this PHP descriptor) and the individual agent
	// tiles (painted from the JS constant) read as the same glyph.
	$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1d2327" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'
		. '<circle cx="12" cy="3.25" r="0.95" fill="#1d2327"/>'
		. '<line x1="12" y1="4.25" x2="12" y2="7"/>'
		. '<rect x="4" y="7" width="16" height="12" rx="2.5"/>'
		. '<line x1="2" y1="12.5" x2="4" y2="12.5"/>'
		. '<line x1="20" y1="12.5" x2="22" y2="12.5"/>'
		. '<circle cx="9" cy="12" r="1.15" fill="#1d2327"/>'
		. '<circle cx="15" cy="12" r="1.15" fill="#1d2327"/>'
		. '<path d="M9.25 15.5 Q12 17 14.75 15.5"/>'
		. '</svg>';
	return 'data:image/svg+xml;base64,' . base64_encode( $svg );
}

function desktop_mode_my_wordpress_entities() {
	$entities = array(
		array(
			'id'       => 'posts',
			'label'    => __( 'Posts', 'desktop-mode' ),
			'icon'     => 'dashicons-admin-post',
			'restPath' => 'wp/v2/posts',
			'kind'     => 'post',
		),
		array(
			'id'       => 'pages',
			'label'    => __( 'Pages', 'desktop-mode' ),
			'icon'     => 'dashicons-admin-page',
			'restPath' => 'wp/v2/pages',
			'kind'     => 'post',
		),
		array(
			'id'       => 'users',
			'label'    => __( 'Users', 'desktop-mode' ),
			'icon'     => 'dashicons-admin-users',
			'restPath' => 'wp/v2/users',
			'kind'     => 'user',
		),
		array(
			'id'       => 'media',
			'label'    => __( 'Media', 'desktop-mode' ),
			'icon'     => 'dashicons-admin-media',
			'restPath' => 'wp/v2/media',
			'kind'     => 'media',
		),
		array(
			'id'       => 'agents',
			'label'    => __( 'Agents', 'desktop-mode' ),
			// Inline SVG bot. The shared `renderIcon` helper
			// (assets/js/desktop.min.js) already understands the
			// `data:image/svg+xml;base64,…` shape, so no client-side
			// plumbing changes are needed to paint this on the root
			// folder tile or in breadcrumbs. The Agents section is a
			// UX mock — see `src/my-wordpress/agents-mock.ts` and
			// `src/my-wordpress/agents-renderer.ts`.
			'icon'     => desktop_mode_my_wordpress_agents_icon(),
			// Empty — the mock renderer ignores `restPath` and
			// reads from its own hard-coded MOCK_AGENTS array.
			'restPath' => '',
			'kind'     => 'agents',
		),
	);

	/**
	 * Filter the list of entity types shown inside the My WordPress
	 * window. Each entry must declare `id`, `label`, `icon`, and
	 * `restPath`. Returning a reordered or extended array shows up
	 * in the bundle on the next render.
	 *
	 * **Status: Experimental** — the entity descriptor shape may
	 * gain fields as new entity kinds land (Comments, Tags,
	 * Categories, Themes, Plugins). Stable id/label/icon/restPath
	 * fields will continue to work; new optional fields will not
	 * break existing consumers. The `kind` field is optional and
	 * defaults to `'post'` for back-compat.
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
		<header data-desktop-mode-my-wordpress-breadcrumbs></header>
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
			'editUserUrlBase' => esc_url_raw( admin_url( 'user-edit.php' ) ),
			'entities'        => desktop_mode_my_wordpress_entities(),
			'perPage'         => 24,
			'mediaPerPage'    => 48,
			'previewActions'  => function_exists( 'desktop_mode_my_wordpress_collect_preview_actions' )
				? desktop_mode_my_wordpress_collect_preview_actions()
				: array(),
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
