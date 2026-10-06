<?php
/**
 * OpenStation — Shared workspaces: the link.
 *
 * `wp-admin/?os_workspace=<token>` claims on arrival, with no dialog:
 * that is the feature. It runs on `admin_init`, server side, because
 * the person opening it may not have OpenStation on yet — there is no
 * shell to run a client-side claim until the claim has turned it on.
 *
 * A GET that writes needs a word on CSRF. The only thing a forged visit
 * can do is apply a workspace that an admin of this site published to
 * the visitor — someone who could already change that visitor's role.
 * The token is unguessable, a disabled link claims nothing, and the
 * write is idempotent per user (a link claims once, ever).
 *
 * After claiming, the request redirects to the shell screen with
 * `os_workspace_status=<status>` so the shell can say what happened,
 * and so a reload does not re-run the claim.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Query arg carrying the claim's outcome back to the shell. */
const OPENSTATION_WORKSPACE_STATUS_QUERY_ARG = 'os_workspace_status';

/**
 * Claims the share named by the current request's link, then redirects.
 *
 * @return void
 */
function openstation_workspace_share_handle_link() {
	// phpcs:disable WordPress.Security.NonceVerification.Recommended -- an emailed link cannot carry a nonce; see the file header.
	if ( empty( $_GET[ OPENSTATION_WORKSPACE_SHARE_QUERY_ARG ] ) || wp_doing_ajax() || ! is_user_logged_in() ) {
		return;
	}
	$token = sanitize_text_field( wp_unslash( (string) $_GET[ OPENSTATION_WORKSPACE_SHARE_QUERY_ARG ] ) );
	// phpcs:enable WordPress.Security.NonceVerification.Recommended
	if ( is_network_admin() ) {
		return;
	}

	$result = openstation_workspace_share_claim( $token, get_current_user_id() );

	/**
	 * Filters where a share link lands after claiming.
	 *
	 * @param string $url    Default: the shell screen, with the status arg.
	 * @param array  $result See {@see openstation_workspace_share_claim()}.
	 */
	$url = apply_filters(
		'openstation_workspace_share_redirect',
		add_query_arg(
			array(
				OPENSTATION_WORKSPACE_STATUS_QUERY_ARG => $result['status'],
				'os_workspace_share'                   => $result['share'] ? $result['share']['id'] : 0,
			),
			// No shell for someone the link did not turn OpenStation
			// on for — they land on the classic dashboard, where
			// `openstation_workspace_share_classic_notice()` says why.
			openstation_is_enabled() ? openstation_shell_url() : admin_url()
		),
		$result
	);
	wp_safe_redirect( $url );
	exit;
}
add_action( 'admin_init', 'openstation_workspace_share_handle_link', 1 );

/**
 * What the shell should say about the link the user just opened.
 *
 * Read once, from the redirect, into the shell config. The label
 * comes from the share itself rather than the URL, so the toast can
 * never be made to say something the admin did not write.
 *
 * @return array{status:string, label:string, desktop:string}|null
 */
function openstation_workspace_share_arrival() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display-only.
	$status = isset( $_GET[ OPENSTATION_WORKSPACE_STATUS_QUERY_ARG ] ) ? sanitize_key( wp_unslash( (string) $_GET[ OPENSTATION_WORKSPACE_STATUS_QUERY_ARG ] ) ) : '';
	if ( ! in_array( $status, array( 'pinned', 'added', 'already', 'managed', 'disabled', 'not-allowed', 'invalid' ), true ) ) {
		return null;
	}
	$label   = '';
	$desktop = '';
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display-only.
	$share_id = isset( $_GET['os_workspace_share'] ) ? absint( $_GET['os_workspace_share'] ) : 0;
	$claims   = openstation_workspace_claims_get( get_current_user_id() );
	// Named only when this user holds a claim on it: the id in the URL
	// is a hint, and the label is never shown to someone the share
	// did not reach.
	if ( $share_id && isset( $claims[ $share_id ] ) ) {
		$share = openstation_workspace_share_get( $share_id );
		if ( $share ) {
			$label   = $share['label'];
			$desktop = $claims[ $share_id ]['desktop'];
		}
	}
	return array(
		'status'  => $status,
		'label'   => $label,
		'desktop' => $desktop,
	);
}

/**
 * Says what a share link did to someone without OpenStation — the
 * classic-admin counterpart of the shell's toast. Only the outcomes
 * that change nothing reach here: a claim that went through switched
 * OpenStation on and landed in the shell.
 *
 * @return void
 */
function openstation_workspace_share_classic_notice() {
	if ( openstation_is_enabled() ) {
		return;
	}
	$arrival = openstation_workspace_share_arrival();
	if ( ! $arrival ) {
		return;
	}
	$messages = array(
		'not-allowed' => __( 'This workspace link is not for your account, so nothing was changed.', 'desktop-mode' ),
		'disabled'    => __( 'That workspace link has been turned off.', 'desktop-mode' ),
		'invalid'     => __( 'That workspace link does not exist.', 'desktop-mode' ),
	);
	if ( ! isset( $messages[ $arrival['status'] ] ) ) {
		return;
	}
	printf(
		'<div class="notice notice-warning is-dismissible"><p>%s</p></div>',
		esc_html( $messages[ $arrival['status'] ] )
	);
}
add_action( 'admin_notices', 'openstation_workspace_share_classic_notice' );
