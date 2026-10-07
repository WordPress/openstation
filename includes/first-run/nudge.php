<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG = 'activation-nudge';

const OPENSTATION_ACTIVATION_NUDGE_MAX_AGE_DAYS = 14;

function openstation_activation_nudge_screens() {
	return array( 'dashboard', 'plugins', 'dashboard-network', 'plugins-network' );
}

function openstation_should_show_activation_nudge() {
	if ( ! is_user_logged_in() || ! current_user_can( 'activate_plugins' ) ) {
		return false;
	}
	if ( openstation_is_enabled() ) {
		return false;
	}
	if ( null !== openstation_get_first_enabled_stamp() ) {
		return false;
	}
	$age = openstation_install_age_days();
	if ( null === $age || $age >= OPENSTATION_ACTIVATION_NUDGE_MAX_AGE_DAYS ) {
		return false;
	}
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( ! $screen || ! in_array( $screen->id, openstation_activation_nudge_screens(), true ) ) {
		return false;
	}
	if ( openstation_is_chromeless_request() ) {
		return false;
	}
	$user_id = get_current_user_id();
	if ( openstation_has_seen_intro( $user_id, OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG ) ) {
		return false;
	}

	if ( function_exists( 'openstation_should_show_welcome_dialog' ) && openstation_should_show_welcome_dialog() ) {
		return false;
	}

	return (bool) apply_filters( 'openstation_show_activation_nudge', true, $user_id );
}

function openstation_activation_nudge_markup() {
	$portal_url = openstation_portal_url();

	$message = sprintf(
		'<strong>%s</strong> %s',
		esc_html__( 'OpenStation is installed but not turned on.', 'desktop-mode' ),
		esc_html__( 'It changes wp-admin only for the people who turn it on.', 'desktop-mode' )
	);

	$actions = sprintf(
		'<p class="os-activation-nudge__actions"><a class="button button-primary" href="%1$s">%2$s</a> <button type="button" class="button-link os-activation-nudge__dismiss">%3$s</button></p>',
		esc_url( $portal_url ),
		esc_html__( 'Turn on OpenStation', 'desktop-mode' ),
		esc_html__( 'Not now', 'desktop-mode' )
	);

	return '<p>' . $message . '</p>' . $actions;
}

function openstation_render_activation_nudge() {
	if ( ! openstation_should_show_activation_nudge() ) {
		return;
	}

	$markup = openstation_activation_nudge_markup();
	if ( function_exists( 'wp_admin_notice' ) ) {
		wp_admin_notice(
			$markup,
			array(
				'type'               => 'info',
				'id'                 => 'os-activation-nudge',
				'additional_classes' => array( 'os-activation-nudge' ),
				'paragraph_wrap'     => false,
			)
		);
	} else {
		echo '<div id="os-activation-nudge" class="notice notice-info os-activation-nudge">' . $markup . '</div>';
	}

	$rest_url   = esc_url_raw( rest_url( 'desktop-mode/v1/intros/seen' ) );
	$rest_nonce = wp_create_nonce( 'wp_rest' );
	?>
<style id="os-activation-nudge-style">
	.os-activation-nudge__actions { margin: 0.5em 0 0.75em; }
	.os-activation-nudge__actions .button-link { margin-left: 8px; }
</style>
<script id="os-activation-nudge-script">
( function () {
	var notice = document.getElementById( 'os-activation-nudge' );
	if ( ! notice ) {
		return;
	}
	var dismiss = notice.querySelector( '.os-activation-nudge__dismiss' );
	if ( ! dismiss ) {
		return;
	}
	dismiss.addEventListener( 'click', function () {
		notice.remove();
		try {
			fetch( <?php echo wp_json_encode( $rest_url ); ?>, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': <?php echo wp_json_encode( $rest_nonce ); ?>
				},
				body: JSON.stringify( { slug: <?php echo wp_json_encode( OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG ); ?> } )
			} ).catch( function () {} );
		} catch ( e ) {}
	} );
} )();
</script>
	<?php
}
add_action( 'admin_notices', 'openstation_render_activation_nudge' );
add_action( 'network_admin_notices', 'openstation_render_activation_nudge' );
