<?php
/**
 * OpenStation widget/window and asset registration.
 *
 * @package OpenStationFeedBuddy
 */

defined( 'ABSPATH' ) || exit;

/**
 * Attach UI hooks when OpenStation is available.
 */
function feed_buddy_maybe_boot_ui() {
	if ( ! function_exists( 'open_station_register_window' )
		|| ! function_exists( 'open_station_register_widget' ) ) {
		return;
	}

	add_action( 'init', 'feed_buddy_register_assets', 20 );
	add_action( 'init', 'feed_buddy_register_surfaces', 30 );
	add_action( 'admin_enqueue_scripts', 'feed_buddy_enqueue_widget_style', 30 );
}

/**
 * Register the authored stylesheet and generated script bundles.
 */
function feed_buddy_register_assets() {
	wp_register_script(
		'desktop-mode-feed-buddy',
		FEED_BUDDY_URL . 'assets/js/feed-buddy.min.js',
		array( 'wp-i18n', 'openstation' ),
		FEED_BUDDY_VERSION,
		true
	);
	if ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) {
		wp_deregister_script( 'desktop-mode-feed-buddy' );
		wp_register_script(
			'desktop-mode-feed-buddy',
			FEED_BUDDY_URL . 'assets/js/feed-buddy.js',
			array( 'wp-i18n', 'openstation' ),
			FEED_BUDDY_VERSION,
			true
		);
	}

	wp_register_style(
		'desktop-mode-feed-buddy',
		FEED_BUDDY_URL . 'assets/css/feed-buddy.css',
		array( 'os-variables', 'dashicons' ),
		FEED_BUDDY_VERSION
	);

	wp_set_script_translations(
		'desktop-mode-feed-buddy',
		'desktop-mode-feed-buddy',
		FEED_BUDDY_DIR . 'languages'
	);
}

/**
 * Register the buddy widget, the native reader window, and the
 * launcher icon.
 *
 * The window's own `placement => 'dock'` puts a launcher tile on the
 * dock, but a docked native window is not a *placeable item* — the
 * OS Settings "Apps & Icons" tab builds its list from the dock-item
 * payload plus `open_station_register_icon()` registrations, so a
 * window-only registration never shows up there and the user has no
 * way to move it to the wallpaper or hide it. Registering the icon
 * alongside the window is the pattern the other bundled extensions
 * follow; the shell dedupes the two (an icon whose `window` target
 * is already a docked native window is not synthesized onto the dock
 * a second time).
 */
function feed_buddy_register_surfaces() {
	if ( ! is_user_logged_in() || ! current_user_can( 'read' ) ) {
		return;
	}

	$config = array(
		'restBase'  => esc_url_raw( rest_url( 'feed-buddy/v1/' ) ),
		'restNonce' => wp_create_nonce( 'wp_rest' ),
		'pollMs'    => 300000,
	);

	$window = open_station_register_window(
		'feed-buddy-reader',
		array(
			'title'        => __( 'SOL Inbound Monologue', 'desktop-mode-feed-buddy' ),
			'icon'         => 'dashicons-rss',
			'template'     => 'feed_buddy_render_reader_template',
			'script'       => 'desktop-mode-feed-buddy',
			'style'        => 'desktop-mode-feed-buddy',
			'width'        => 760,
			'height'       => 600,
			'min_width'    => 420,
			'min_height'   => 360,
			'placement'    => 'dock',
			'capabilities' => array( 'read' ),
			'config'       => $config,
		)
	);
	if ( is_wp_error( $window ) ) {
		error_log( '[feed-buddy] reader registration failed: ' . $window->get_error_message() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
	}

	$widget = open_station_register_widget(
		'feed-buddy/buddy-list',
		array(
			'label'          => __( 'SOL Inbound Monologue', 'desktop-mode-feed-buddy' ),
			'description'    => __( 'Syndicated links presented as an inbound-only buddy list.', 'desktop-mode-feed-buddy' ),
			'icon'           => 'dashicons-rss',
			'script'         => 'desktop-mode-feed-buddy',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 280,
			'max_width'      => 420,
			'max_height'     => 720,
			'default_width'  => 280,
			'default_height' => 460,
			'capabilities'   => array( 'read' ),
		)
	);
	if ( is_wp_error( $widget ) ) {
		error_log( '[feed-buddy] widget registration failed: ' . $widget->get_error_message() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
	}

	// Guarded: older OpenStation builds shipped the window and widget
	// registries without the icon one. Missing icon support costs the
	// Apps & Icons row, not the extension.
	if ( ! function_exists( 'open_station_register_icon' ) ) {
		return;
	}

	$icon = open_station_register_icon(
		'feed-buddy-reader',
		array(
			'title'        => __( 'SOL Inbound Monologue', 'desktop-mode-feed-buddy' ),
			'icon'         => 'dashicons-rss',
			'window'       => 'feed-buddy-reader',
			'position'     => 70,
			'capabilities' => array( 'read' ),
		)
	);
	if ( is_wp_error( $icon ) ) {
		error_log( '[feed-buddy] icon registration failed: ' . $icon->get_error_message() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
	}
}

/**
 * Ensure widget-only sessions receive the companion stylesheet.
 */
function feed_buddy_enqueue_widget_style() {
	if ( function_exists( 'open_station_is_enabled' ) && open_station_is_enabled() ) {
		wp_enqueue_style( 'desktop-mode-feed-buddy' );
	}
}

/**
 * Reader markup cloned into the native window.
 */
function feed_buddy_render_reader_template() {
	?>
	<div class="feed-buddy-reader" data-feed-buddy-reader>
		<nav class="feed-buddy-reader__menubar" aria-label="<?php esc_attr_e( 'SOL Inbound Monologue commands', 'desktop-mode-feed-buddy' ); ?>">
			<os-button variant="ghost" data-feed-buddy-manage>
				<?php esc_html_e( 'Feeds', 'desktop-mode-feed-buddy' ); ?>
			</os-button>
			<os-button variant="ghost" data-feed-buddy-refresh>
				<?php esc_html_e( 'Refresh', 'desktop-mode-feed-buddy' ); ?>
			</os-button>
			<os-button variant="ghost" data-feed-buddy-sound aria-pressed="false">
				<?php esc_html_e( 'Sound off', 'desktop-mode-feed-buddy' ); ?>
			</os-button>
			<os-button variant="ghost" data-feed-buddy-about>
				<?php esc_html_e( 'About', 'desktop-mode-feed-buddy' ); ?>
			</os-button>
		</nav>

		<header class="feed-buddy-reader__conversation">
			<div class="feed-buddy-reader__identity">
				<span class="feed-buddy-presence feed-buddy-presence--online" aria-hidden="true"></span>
				<div>
					<strong data-feed-buddy-conversation-name><?php esc_html_e( 'All buddies', 'desktop-mode-feed-buddy' ); ?></strong>
					<small data-feed-buddy-presence-copy><?php esc_html_e( 'Online — incoming articles', 'desktop-mode-feed-buddy' ); ?></small>
				</div>
			</div>
			<os-select data-feed-buddy-feed-select label="<?php esc_attr_e( 'Conversation', 'desktop-mode-feed-buddy' ); ?>">
				<os-option value=""><?php esc_html_e( 'All feeds', 'desktop-mode-feed-buddy' ); ?></os-option>
			</os-select>
		</header>

		<main class="feed-buddy-reader__main">
			<div class="feed-buddy-reader__empty" data-feed-buddy-empty>
				<span class="dashicons dashicons-rss" aria-hidden="true"></span>
				<h2 data-feed-buddy-empty-title><?php esc_html_e( 'Your buddy list is quiet', 'desktop-mode-feed-buddy' ); ?></h2>
				<p data-feed-buddy-empty-copy><?php esc_html_e( 'Add an RSS or Atom feed to start a conversation.', 'desktop-mode-feed-buddy' ); ?></p>
				<os-button variant="primary" data-feed-buddy-add-first>
					<?php esc_html_e( 'Add a feed', 'desktop-mode-feed-buddy' ); ?>
				</os-button>
			</div>
			<ol class="feed-buddy-transcript" data-feed-buddy-items aria-label="<?php esc_attr_e( 'Feed articles', 'desktop-mode-feed-buddy' ); ?>"></ol>
			<div class="feed-buddy-reader__loading" data-feed-buddy-loading hidden>
				<os-spinner preset="dots"></os-spinner>
				<span><?php esc_html_e( 'Contacting buddies…', 'desktop-mode-feed-buddy' ); ?></span>
			</div>
		</main>

		<footer class="feed-buddy-reader__actionbar">
			<os-button variant="secondary" data-feed-buddy-mark-all>
				<?php esc_html_e( 'Mark all read', 'desktop-mode-feed-buddy' ); ?>
			</os-button>
			<os-button variant="secondary" data-feed-buddy-manage>
				<?php esc_html_e( 'Manage feeds', 'desktop-mode-feed-buddy' ); ?>
			</os-button>
			<span data-feed-buddy-flavor><?php esc_html_e( 'RSS conversation', 'desktop-mode-feed-buddy' ); ?></span>
		</footer>

		<aside class="feed-buddy-manager" data-feed-buddy-manager hidden aria-label="<?php esc_attr_e( 'Manage feeds', 'desktop-mode-feed-buddy' ); ?>">
			<header>
				<div>
					<h2><?php esc_html_e( 'Manage feeds', 'desktop-mode-feed-buddy' ); ?></h2>
					<p><?php esc_html_e( 'Paste a feed or website URL. SOL Inbound Monologue will look for RSS or Atom.', 'desktop-mode-feed-buddy' ); ?></p>
				</div>
				<os-button variant="ghost" data-feed-buddy-close-manager>
					<?php esc_html_e( 'Close', 'desktop-mode-feed-buddy' ); ?>
				</os-button>
			</header>
			<form class="feed-buddy-manager__add" data-feed-buddy-add-form>
				<os-text-field type="url" name="url" required label="<?php esc_attr_e( 'Feed or website URL', 'desktop-mode-feed-buddy' ); ?>" placeholder="https://example.com/feed"></os-text-field>
				<os-text-field name="group" label="<?php esc_attr_e( 'Buddy group', 'desktop-mode-feed-buddy' ); ?>" placeholder="<?php esc_attr_e( 'Feeds', 'desktop-mode-feed-buddy' ); ?>"></os-text-field>
				<os-button type="submit" variant="primary" data-feed-buddy-add-submit><?php esc_html_e( 'Add buddy', 'desktop-mode-feed-buddy' ); ?></os-button>
			</form>
			<div class="feed-buddy-manager__list" data-feed-buddy-manager-list></div>
		</aside>

		<div class="feed-buddy-reader__status" data-feed-buddy-status role="status" aria-live="polite"></div>
	</div>
	<?php
}
