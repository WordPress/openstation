<?php
/**
 * OpenStation — Station Home native-window registration.
 *
 * The normal WordPress Dashboard menu item keeps its existing `index.php`
 * URL. The shell's native URL-remap registry claims that URL and opens this
 * window, which means every existing menu, shortcut, portal, and default-
 * window path keeps working without a second Dashboard tile.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Stable native-window id used by the Dashboard URL remap. */
const OPENSTATION_STATION_HOME_WINDOW_ID = 'desktop-mode-dashboard';

/**
 * Render the declarative Station Home frame cloned before the bundle mounts.
 */
function openstation_station_home_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-station-home" data-os-station-home-root data-state="loading">
		<div class="os-station-home__layout">
			<aside class="os-station-home__rail" aria-label="<?php esc_attr_e( 'Station Home', 'desktop-mode' ); ?>">
				<div class="os-station-home__brand">
					<img
						class="os-station-home__brand-mark"
						src="<?php echo esc_url( OPENSTATION_URL . 'assets/images/openstation-mark.svg' ); ?>"
						alt=""
						width="36"
						height="36"
					/>
					<span>OpenStation</span>
				</div>
				<div class="os-station-home__location" aria-current="page">
					<span aria-hidden="true"></span>
					<?php esc_html_e( 'Station Home', 'desktop-mode' ); ?>
				</div>
				<div class="os-station-home__mesh" aria-hidden="true"></div>
				<nav
					class="os-station-home__actions"
					data-os-station-home-actions
					aria-label="<?php esc_attr_e( 'Quick actions', 'desktop-mode' ); ?>"
				></nav>
			</aside>

			<main class="os-station-home__main">
				<header class="os-station-home__intro">
					<div>
						<h1 id="os-station-home-title" data-os-station-home-greeting>
							<?php esc_html_e( 'Station Home', 'desktop-mode' ); ?>
						</h1>
						<p data-os-station-home-summary><?php esc_html_e( 'Your site at a glance.', 'desktop-mode' ); ?></p>
					</div>
					<os-button
						class="os-station-home__refresh"
						variant="ghost"
						data-os-station-home-refresh
						aria-label="<?php esc_attr_e( 'Refresh Station Home', 'desktop-mode' ); ?>"
						title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>"
					>
						<span class="dashicons dashicons-update" aria-hidden="true"></span>
					</os-button>
				</header>

				<div class="os-station-home__error" data-os-station-home-error role="alert" hidden></div>

				<section class="os-station-home__section" aria-labelledby="os-station-home-work-heading">
					<h2 id="os-station-home-work-heading"><?php esc_html_e( 'Continue working', 'desktop-mode' ); ?></h2>
					<div class="os-station-home__work" data-os-station-home-work></div>
				</section>

				<section class="os-station-home__section" aria-labelledby="os-station-home-pulse-heading">
					<h2 id="os-station-home-pulse-heading"><?php esc_html_e( 'Site pulse', 'desktop-mode' ); ?></h2>
					<div class="os-station-home__pulse" data-os-station-home-pulse></div>
				</section>

				<section class="os-station-home__section" aria-labelledby="os-station-home-attention-heading">
					<h2 id="os-station-home-attention-heading"><?php esc_html_e( 'Needs attention', 'desktop-mode' ); ?></h2>
					<div class="os-station-home__attention" data-os-station-home-attention></div>
				</section>

				<section
					class="os-station-home__section os-station-home__cards-section"
					data-os-station-home-cards-section
					aria-labelledby="os-station-home-cards-heading"
					hidden
				>
					<div class="os-station-home__section-heading">
						<h2 id="os-station-home-cards-heading"><?php esc_html_e( 'From your plugins', 'desktop-mode' ); ?></h2>
						<os-button variant="ghost" size="sm" data-os-station-home-customize>
							<span class="dashicons dashicons-admin-generic" aria-hidden="true"></span>
							<?php esc_html_e( 'Customize', 'desktop-mode' ); ?>
						</os-button>
					</div>
					<div class="os-station-home__cards" data-os-station-home-cards></div>
				</section>
			</main>
		</div>

		<os-modal
			class="os-station-home__card-modal"
			data-os-station-home-card-modal
			title="<?php esc_attr_e( 'Customize Station Home', 'desktop-mode' ); ?>"
			size="md"
		>
			<p class="os-station-home__card-modal-intro">
				<?php esc_html_e( 'Choose which plugin cards can show information on your Station Home.', 'desktop-mode' ); ?>
			</p>
			<div class="os-station-home__card-preferences" data-os-station-home-card-preferences></div>
		</os-modal>

		<div class="os-station-home__loading" data-os-station-home-loading role="status">
			<os-spinner></os-spinner>
			<span><?php esc_html_e( 'Preparing your station…', 'desktop-mode' ); ?></span>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	if ( function_exists( 'openstation_kses_native_window_template' ) ) {
		echo openstation_kses_native_window_template( $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
		return;
	}

	echo wp_kses( $html, wp_kses_allowed_html( 'post' ) );
}

/**
 * Register Station Home for every OpenStation user with admin-read access.
 */
function openstation_station_home_register_window() {
	if ( ! current_user_can( 'read' ) ) {
		return;
	}

	$registered = openstation_register_window(
		OPENSTATION_STATION_HOME_WINDOW_ID,
		array(
			'title'            => __( 'Station Home', 'desktop-mode' ),
			'icon'             => 'dashicons-dashboard',
			'template'         => 'openstation_station_home_render_template',
			'script'           => 'os-station-home',
			'style'            => 'os-station-home',
			'width'            => 1240,
			'height'           => 760,
			'min_width'        => 640,
			'min_height'       => 480,
			'placement'        => 'none',
			'main_tab_padding' => 0,
			'capabilities'     => array( 'read' ),
			'config'           => array(
				'endpoint'      => esc_url_raw( rest_url( 'desktop-mode/v1/station-home' ) ),
				'cardsEndpoint' => esc_url_raw( rest_url( 'desktop-mode/v1/station-home/cards' ) ),
			),
		)
	);

	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Station Home registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'openstation_station_home_register_window', 20 );
