<?php
/**
 * OpenStation — My WordPress: window + pinned icon registration.
 *
 * Native window with id `desktop-mode-my-wordpress`, opened from a
 * pinned desktop icon that always sits in the top-left of the grid
 * (`pinned: true`, `position: -1`). The bundle renders a two-pane
 * file-explorer UI with breadcrumb navigation: root shows Posts,
 * Pages, Users, and Media folder tiles, and clicking one drills into
 * an infinite-scroll list of entities with a per-kind preview pane.
 *
 * Filterable surface (mirrors the recycle-bin / posts-window modules):
 *
 *   - `open_station_my_wordpress_window_args`
 *   - `open_station_my_wordpress_icon_args`
 *   - `open_station_my_wordpress_user_can_use`
 *   - `open_station_my_wordpress_entities`
 *   - `open_station_my_wordpress_template_html`
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the current user should see My WordPress.
 *
 * Mirrors the recycle-bin gate — anyone who can edit posts can
 * browse posts and pages.
 *
 * @return bool
 */
function open_station_my_wordpress_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the My WordPress
	 * pinned icon and window.
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'open_station_my_wordpress_user_can_use', $can );
}

/**
 * Build the entity list shipped to the bundle. Posts, Pages,
 * Users, and Media. Future phases add
 * Comments, Tags, Categories, Themes, and Plugins.
 *
 * The optional `kind` field tells the bundle how to render entries
 * of this entity: `'post'` (default) renders the standard
 * title/excerpt/featured-image tile and the rendered-HTML preview;
 * `'user'` renders an avatar + display-name tile and routes to the
 * user dossier preview; `'media'` renders a thumbnail-grid tile and
 * routes to the media preview pane. Plugins extending the entity
 * list with a post-shaped collection can omit the field; user- and
 * media-shaped collections must set `'user'` / `'media'`.
 * The optional `post_type` field specifies the WP post-type
 * slug used for `os.<slug>.changed` cross-window broadcasts.
 *
 * @return array[] Each entry is `array( 'id', 'label', 'icon',
 *                 'restPath', 'kind', 'post_type' )`. `restPath` is appended to
 *                 the `restRoot` config to derive the list URL.
 */
function open_station_my_wordpress_entities() {
	$entities = array(
		array(
			'id'        => 'posts',
			'label'     => __( 'Posts', 'desktop-mode' ),
			'icon'      => 'dashicons-admin-post',
			'restPath'  => 'wp/v2/posts',
			'kind'      => 'post',
			'post_type' => 'post',
		),
		array(
			'id'        => 'pages',
			'label'     => __( 'Pages', 'desktop-mode' ),
			'icon'      => 'dashicons-admin-page',
			'restPath'  => 'wp/v2/pages',
			'kind'      => 'post',
			'post_type' => 'page',
		),
		array(
			'id'       => 'users',
			'label'    => __( 'Users', 'desktop-mode' ),
			'icon'     => 'dashicons-admin-users',
			'restPath' => 'wp/v2/users',
			'kind'     => 'user',
		),
		array(
			'id'        => 'media',
			'label'     => __( 'Media', 'desktop-mode' ),
			'icon'      => 'dashicons-admin-media',
			'restPath'  => 'wp/v2/media',
			'kind'      => 'media',
			'post_type' => 'attachment',
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
	 * Optional fields:
	 *   - `kind`       — render strategy (`'post'` default, `'user'`, `'media'`).
	 *   - `post_type`  — WP post-type slug for cross-window broadcast topic `os.<slug>.changed`.
	 *   - `thumbnails` — set false to keep the section icon on every tile
	 *                    instead of the entity's featured image.
	 *   - `group`      — folder id this section nests under at the root
	 *                    (null / omitted renders it loose at the root).
	 *   - `groupLabel` — folder label. `groupIcon`, `groupOrder` follow.
	 *
	 * @param array[] $entities Default entities.
	 */
	$filtered = apply_filters( 'open_station_my_wordpress_entities', $entities );
	return is_array( $filtered ) ? array_values( $filtered ) : $entities;
}

/**
 * Render the My WordPress window's static template body. The bundle
 * mounts its UI into `[data-os-my-wordpress-root]`.
 */
function open_station_my_wordpress_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-my-wordpress" data-os-my-wordpress-root>
		<header data-os-my-wordpress-breadcrumbs></header>
		<div class="os-my-wordpress__body" data-os-my-wordpress-body>
			<div class="os-my-wordpress__loading" data-os-my-wordpress-loading hidden>
				<os-spinner></os-spinner>
			</div>
		</div>
		<div class="os-folder-status-bar" data-os-my-wordpress-status></div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the My WordPress window's template HTML.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'open_station_my_wordpress_template_html', $html );

	$allowed_html = function_exists( 'open_station_native_window_allowed_html' )
		? open_station_native_window_allowed_html()
		: wp_kses_allowed_html( 'post' );

	echo wp_kses( $filtered, $allowed_html );
}

/**
 * Register the native window + the pinned wallpaper icon on `init`,
 * priority 99 — after `components.php` boots the registry, and late
 * enough that every plugin's `register_post_type()` call has already
 * run. The entity list is frozen into the window config here and only
 * emitted later on `admin_enqueue_scripts`, so a CPT registered after
 * this point would never reach the bundle.
 */
function open_station_my_wordpress_register_window() {
	if ( ! open_station_my_wordpress_user_can_use() ) {
		return;
	}

	$site_title = open_station_site_title();

	$entities = open_station_my_wordpress_entities();

	$window_args = array(
		'title'      => $site_title,
		'icon'       => 'dashicons-wordpress',
		'template'   => 'open_station_my_wordpress_render_template',
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
			'siteName'        => $site_title,
			'entities'        => $entities,
			'groups'          => function_exists( 'open_station_my_wordpress_collect_groups' )
				? open_station_my_wordpress_collect_groups( $entities )
				: array(),
			'perPage'         => 24,
			'mediaPerPage'    => 48,
			'previewActions'  => function_exists( 'open_station_my_wordpress_collect_preview_actions' )
				? open_station_my_wordpress_collect_preview_actions()
				: array(),
		),
	);

	/**
	 * Filter the args used to register the My WordPress native window.
	 *
	 * @param array $window_args Args passed to `open_station_register_window()`.
	 */
	$window_args = (array) apply_filters( 'open_station_my_wordpress_window_args', $window_args );

	$registered = open_station_register_window( 'desktop-mode-my-wordpress', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] My WordPress window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => $site_title,
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
	 * @param array $icon_args Args passed to `open_station_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'open_station_my_wordpress_icon_args', $icon_args );

	open_station_register_icon( 'desktop-mode-my-wordpress', $icon_args );
}
add_action( 'init', 'open_station_my_wordpress_register_window', 99 );

/**
 * Enqueue the bundle's CSS in admin context. The script is lazy-
 * loaded by the native-window sync and so does not need an
 * `admin_enqueue_scripts` call.
 */
function open_station_my_wordpress_enqueue_styles() {
	if ( ! open_station_my_wordpress_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-my-wordpress' );
}
add_action( 'admin_enqueue_scripts', 'open_station_my_wordpress_enqueue_styles', 30 );
