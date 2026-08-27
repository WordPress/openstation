<?php
/**
 * OpenStation — Recycle Bin: window registration.
 *
 * Native window with id `desktop-mode-recycle-bin`, pinned to the dock.
 * Like the code editor, the template body is a static skeleton that the
 * JS bundle enhances on first open — the table is populated from the
 * REST list endpoint at render time.
 *
 * The bin lands on the dock and nowhere else. It used to also register
 * a wallpaper icon, which put the same target on two surfaces at once
 * and made the desktop something the shell furnished rather than
 * something the user did. That is a default, not a rule: the tile is
 * `placeable`, so the wallpaper is one pick away in Apps & Plugins.
 *
 * The registration is filterable via `openstation_recycle_bin_window_args`
 * so a plugin can swap the icon, change the dimensions, or restrict who
 * sees the bin without touching this file.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The bin SVG, used by the window icon and its dock tile.
 *
 * The bin used to be `dashicons-trash`, which worked but wore the
 * wrong clothes. Dashicons are WP core's icon set: solid fills on a
 * 20-unit grid, tuned for admin-menu sizes. The shell's own icons are
 * outlined vessels on a 64-unit grid at stroke 3. Sitting next to
 * WP Explorer, Corkboard and Games in the dock, the Dashicon was
 * visibly a guest from another system: heavier, tighter, and drawn to
 * a different rhythm.
 *
 * So this is the same object, redrawn to the house rule the other
 * three follow: an outlined vessel with solid content, three elements
 * because it renders as small as 20px in the dock. The lid is the
 * solid one, which gives the mark a single dense horizontal to be
 * recognised by when the tapered body below it thins out.
 *
 * Drawn in `currentColor`, so `renderIcon()` paints it as a CSS mask
 * and it takes the surface's own text colour. Dashicons already
 * inherited colour, being font glyphs; the point of the change is the
 * drawing, not the theming.
 *
 * Note that the row actions inside the bin window, and the "Move to
 * trash" entries in context menus, stay on `dashicons-trash`. Those
 * are menu glyphs sitting among other menu glyphs, and they should
 * match their neighbours rather than this icon.
 *
 * The bin has two states. Empty is the vessel on its own; full adds
 * three crumpled balls inside it and knocks the lid askew. See
 * {@link openstation_recycle_bin_icon_svg()} for why the lid only
 * moves 8 degrees.
 *
 * @param bool $full Whether to draw the bin holding something.
 * @return string Raw `<svg>` markup.
 */
function openstation_recycle_bin_icon_svg( $full = false ) {
	// The lid and the handle travel together. In the full state the
	// pair is knocked askew, which is the whole difference at the top
	// of the mark.
	$lid_transform = $full
		? ' transform="translate(0 -2.5) rotate(8 32 21.5)"'
		: '';

	$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		. '<g' . $lid_transform . '>'
		// The handle, outlined so it reads as a loop rather than a tab.
		. '<path d="M25 19v-2.5a3.5 3.5 0 0 1 3.5-3.5h7a3.5 3.5 0 0 1 3.5 3.5V19" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
		// The lid: the one solid element, and the widest, so it anchors
		// the mark at small sizes.
		. '<rect x="10" y="19" width="44" height="5" rx="2.5" fill="currentColor"/>'
		. '</g>'
		// The body, tapered towards the base the way a real bin is, which
		// is also what separates it from a plain bucket.
		//
		// 27 units tall, narrowing to 71% of its top width. It was 24
		// tall at 59%, which drew a shallower, more conical tub than a
		// bin actually is, and left an interior too cramped to hold
		// anything. Taken further, to a bottom much past 75%, the walls
		// go vertical and the mark reads as a bucket; this sits at the
		// edge of that.
		. '<path d="M15.5 28.5h33l-1.2 24a3.5 3.5 0 0 1-3.5 3H20.2a3.5 3.5 0 0 1-3.5-3z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';

	if ( $full ) {
		// Three crumpled balls, one path with three subpaths so the
		// mark stays at four elements rather than six.
		//
		// Each is a seven-point polygon on a radius jittered between
		// 0.81 and 1.0, with a same-colour round-joined stroke that
		// turns the corners into creases instead of points. Seven
		// points rather than nine because a ball this small needs
		// deeper, fewer facets to keep any texture at all.
		//
		// The layout is staggered deliberately. Two balls at the same
		// height with a third centred under them reads as a face, and
		// it cannot be unseen once noticed, so no two share a y (the
		// top pair are 4.2 units apart) and the third sits below-left
		// rather than on the centreline. Every gap in the mark clears
		// 2 units: 5.1 to the left wall, 4.4 to the right, 2.8 to the
		// rim, 2.5 to the base, and 2.5 to 4.2 between the balls. Those
		// last three decide how far down the size ladder they stay
		// three things instead of one.
		$svg .= '<path d="M29.7 38 27.4 39.5 24.7 39.6 23.6 37.1 24.1 34.4 26.8 34.1 29.2 35.1'
			. 'ZM39.4 44.1 36.7 43.5 34.8 41.6 35.8 39.1 38.1 37.6 40.2 39.3 41.1 41.8'
			. 'ZM28.1 50.4 27 47.9 27.4 45.2 30 44.6 32.6 45.6 32.4 48.3 31 50.5Z"'
			. ' fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>';
	}

	return $svg . '</svg>';
}

/**
 * Both bin states as base64 data URIs, ready for `renderIcon()`.
 *
 * The client swaps between these as the count crosses zero, so both
 * have to reach the page on the first paint. Cheap: two string
 * builds and two base64 encodes, no queries.
 *
 * @return array{empty:string,full:string}
 */
function openstation_recycle_bin_icon_uris() {
	return array(
		'empty' => 'data:image/svg+xml;base64,' . base64_encode( openstation_recycle_bin_icon_svg( false ) ),
		'full'  => 'data:image/svg+xml;base64,' . base64_encode( openstation_recycle_bin_icon_svg( true ) ),
	);
}

/**
 * Echoes the recycle bin window's template body.
 *
 * The shell wraps this in `<template id="os-native-window-desktop-mode-recycle-bin">`
 * and clones it into the window body BEFORE the JS render callback runs.
 * The `data-os-recycle-bin-*` hooks below are the contract the JS
 * relies on — keep them intact (or rename via the filter) when
 * customizing the layout.
 */
function openstation_recycle_bin_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-recycle-bin" data-os-recycle-bin-root>
		<header class="os-recycle-bin__toolbar" data-os-recycle-bin-toolbar>
			<div class="os-recycle-bin__toolbar-left">
				<os-segmented data-os-recycle-bin-filter>
					<os-segment value="" selected><?php esc_html_e( 'All', 'desktop-mode' ); ?></os-segment>
					<os-segment value="post"><?php esc_html_e( 'Posts', 'desktop-mode' ); ?></os-segment>
					<os-segment value="page"><?php esc_html_e( 'Pages', 'desktop-mode' ); ?></os-segment>
					<?php
					// The Media segment is only useful when WP itself routes
					// attachment deletions through Trash. That gate is the
					// `MEDIA_TRASH` constant — defaults to false in core, can
					// be flipped to true from `wp-config.php`. Without it,
					// attachments permanent-delete on first click and the
					// Trash bin will never have anything in this bucket, so
					// the tab would always read "0" and confuse users.
					if ( defined( 'MEDIA_TRASH' ) && MEDIA_TRASH ) :
						?>
						<os-segment value="attachment"><?php esc_html_e( 'Media', 'desktop-mode' ); ?></os-segment>
						<?php
					endif;
					?>
					<os-segment value="comment"><?php esc_html_e( 'Comments', 'desktop-mode' ); ?></os-segment>
					<os-segment value="desktop"><?php esc_html_e( 'Desktop', 'desktop-mode' ); ?></os-segment>
				</os-segmented>
				<os-text-field
					data-os-recycle-bin-search
					placeholder="<?php esc_attr_e( 'Search trash…', 'desktop-mode' ); ?>"
				></os-text-field>
			</div>
			<div class="os-recycle-bin__toolbar-right" data-os-recycle-bin-bulk hidden>
				<span class="os-recycle-bin__count" data-os-recycle-bin-count></span>
				<os-button variant="secondary" data-os-recycle-bin-restore-selected>
					<span class="dashicons dashicons-image-rotate" aria-hidden="true"></span>
					<?php esc_html_e( 'Restore', 'desktop-mode' ); ?>
				</os-button>
				<os-button variant="secondary" data-os-recycle-bin-pin-to-desktop>
					<span class="dashicons dashicons-desktop" aria-hidden="true"></span>
					<?php esc_html_e( 'Pin to desktop', 'desktop-mode' ); ?>
				</os-button>
				<os-button variant="danger" data-os-recycle-bin-purge-selected>
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<?php esc_html_e( 'Delete forever', 'desktop-mode' ); ?>
				</os-button>
			</div>
			<div class="os-recycle-bin__toolbar-trailing">
				<os-button variant="ghost" data-os-recycle-bin-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</os-button>
				<os-button variant="danger" data-os-recycle-bin-empty>
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					<?php esc_html_e( 'Empty Trash', 'desktop-mode' ); ?>
				</os-button>
			</div>
		</header>
		<div class="os-recycle-bin__body" data-os-recycle-bin-body>
			<div class="os-recycle-bin__empty" data-os-recycle-bin-empty-state hidden>
				<span class="dashicons dashicons-trash" aria-hidden="true"></span>
				<p><?php esc_html_e( 'The Trash is empty.', 'desktop-mode' ); ?></p>
				<p class="os-recycle-bin__empty-hint">
					<?php esc_html_e( 'Deleted posts, pages, and media show up here. Restoring puts them back where they were.', 'desktop-mode' ); ?>
				</p>
			</div>
			<os-table
				data-os-recycle-bin-table
				selectable="multi"
				sticky-header
				hover
				striped
				loading
				empty="<?php esc_attr_e( 'No items match the current filter or search.', 'desktop-mode' ); ?>"
			></os-table>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the recycle bin window's template HTML.
	 *
	 * Keep the `data-os-recycle-bin-*` hooks intact so the JS render
	 * callback can find its mount points, or rename them and update the
	 * matching constants in `src/recycle-bin/index.ts`.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_recycle_bin_template_html', $html );
	echo wp_kses( $filtered, openstation_native_window_allowed_html() );
}

/**
 * Whether the current user should see the recycle bin at all.
 *
 * Filterable so plugins can hide it from authors/contributors who
 * don't manage trash, or invert the gate to expose it to a custom
 * role.
 *
 * @return bool
 */
function openstation_recycle_bin_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the recycle bin window.
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'openstation_recycle_bin_user_can_use', $can );
}

/**
 * Register the recycle bin window on `init`.
 *
 * Hooked at priority 20, after `components.php` has bootstrapped the
 * native-window registry — same timing as the code editor.
 */
function openstation_recycle_bin_register_window() {
	if ( ! openstation_recycle_bin_user_can_use() ) {
		return;
	}

	$icon_uris = openstation_recycle_bin_icon_uris();
	$icon_uri  = $icon_uris['empty'];

	$window_args = array(
		'title'      => __( 'Trash', 'desktop-mode' ),
		'icon'       => $icon_uri,
		'template'   => 'openstation_recycle_bin_render_template',
		'script'     => 'desktop-mode-recycle-bin',
		'width'      => 880,
		'height'     => 560,
		'min_width'  => 520,
		'min_height' => 360,
		'placement'  => 'dock',
		'nav_kind'   => 'control',
		// Last on the rail, after the shell's own cluster (Mio 10,
		// Overview 20, System 30). Trash is where things END UP, and a
		// dock reads left to right: putting it anywhere but the end
		// makes it one more app rather than the bottom of the pile.
		'dock_order' => 40,
		// The bin is the one dock tile a user can reasonably not want,
		// so it gets a row in Apps & Plugins: dock (the default),
		// desktop, both, or hidden. It registers no desktop icon, so
		// that row is its only control.
		'placeable'  => true,
	);

	/**
	 * Filter the args used to register the recycle bin native window.
	 *
	 * @param array $window_args Args passed to `openstation_register_window()`.
	 */
	$window_args = (array) apply_filters( 'openstation_recycle_bin_window_args', $window_args );

	$registered = openstation_register_window( 'desktop-mode-recycle-bin', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Recycle bin window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'openstation_recycle_bin_register_window', 20 );

/**
 * Localize REST endpoints for the JS bundle.
 *
 * Same pattern as the code editor: the bundle reads its config off
 * `window.openStationRecycleBinConfig` and never hardcodes URLs.
 */
function openstation_recycle_bin_localize_config() {
	if ( ! openstation_recycle_bin_user_can_use() ) {
		return;
	}

	wp_localize_script(
		'desktop-mode-recycle-bin',
		'openStationRecycleBinConfig',
		array(
			'restNonce'  => wp_create_nonce( 'wp_rest' ),
			'listUrl'    => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin' ) ),
			'restoreUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/restore' ) ),
			'purgeUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/purge' ) ),
			'emptyUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/empty' ) ),
			'countUrl'   => esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/count' ) ),
			'postTypes'  => openstation_recycle_bin_capture_post_types(),
		)
	);

	wp_enqueue_style( 'desktop-mode-recycle-bin' );
}
// Priority 5, not an afterthought: `openstation_enqueue_assets()` (default 10)
// harvests every lazy window's `wp_localize_script` data into the shell
// payload, so config attached after 10 ships the bundle with no config — the
// exact "openStationRecycleBinConfig is missing" failure the bundle warns
// about. This ran at 30 and got away with it only while the bundle was
// enqueued eagerly and WordPress printed the data itself at print time.
add_action( 'admin_enqueue_scripts', 'openstation_recycle_bin_localize_config', 5 );

/**
 * Inject the initial trash count and both bin drawings into the
 * shell config, so the dock tile (and any icon a user or plugin has
 * placed against this window) shows the right one on the very first
 * paint, before the bin window has ever opened.
 *
 * Both drawings travel together rather than the server picking one:
 * the count changes without a reload, and shipping the pair makes
 * crossing zero a local swap instead of a round trip.
 *
 * @param array $config Shell config blob.
 * @return array
 */
function openstation_recycle_bin_inject_shell_config( $config ) {
	if ( ! is_array( $config ) ) {
		return $config;
	}
	$icons = openstation_recycle_bin_icon_uris();

	$config['recycleBinCount']     = openstation_recycle_bin_count();
	$config['recycleBinCountUrl']  = esc_url_raw( rest_url( 'desktop-mode/v1/recycle-bin/count' ) );
	$config['recycleBinPostTypes'] = openstation_recycle_bin_capture_post_types();
	$config['recycleBinIconEmpty'] = $icons['empty'];
	$config['recycleBinIconFull']  = $icons['full'];
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_recycle_bin_inject_shell_config', 20 );
