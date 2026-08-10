<?php
/**
 * OpenStation — Solo window rendering mode.
 *
 * `?openstation_solo=<window-id>` boots the whole shell and then tells
 * it to paint exactly one window: no dock, no taskbar, no wallpaper,
 * no desk, no session restore.
 *
 * ## Why the framework has to come along
 *
 * OpenStation has two kinds of window. An **iframe window** is an
 * admin page, and anything that wants to show one somewhere else can
 * simply load its chromeless URL. A **native window** — the Files
 * browser, the Games hub, a plugin's own canvas — has no URL at all;
 * it is a render callback that paints into the shell's DOM. Handing
 * one to a surface outside the desk is therefore not a matter of
 * finding the right address: without the shell there is nothing to
 * render into, and a native window without its framework is not a
 * window, it is an unrendered callback.
 *
 * Solo mode is the answer: the same shell, the same registries, the
 * same render callback, the same theme and title-bar buttons the
 * plugin registered — with the desk removed from around it. What the
 * user sees is the window they already had, not a lookalike.
 *
 * ## Who uses it
 *
 * Built for the native desktop host (the Electron adapter under
 * `extensions/`), which uses it to give a native window to a real OS
 * window. Nothing here knows about Electron, and nothing should: an
 * embed, a kiosk screen, or a PWA shortcut can point at the same flag
 * and get the same single-window shell.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Query var that boots the shell in solo mode.
 *
 * The VALUE is externally visible — it appears in URLs other software
 * builds and users bookmark — so treat it as frozen.
 */
const OPENSTATION_SOLO_FLAG = 'openstation_solo';

/**
 * The window id this request should boot solo, if any.
 *
 * Only meaningful when OpenStation is enabled for the user: the flag
 * is a **rendering mode, not an access grant**. A logged-out or
 * non-OpenStation request must not be reshaped by a query string, and
 * every capability check on the underlying screen still applies
 * exactly as it would anywhere else.
 *
 * @return string Window id, or '' when this is not a solo request.
 */
function openstation_solo_window_id() {
	// `is_scalar` before unslashing, because a `?openstation_solo[]=x`
	// would otherwise reach `sanitize_text_field()` as an array and
	// warn on the way to being rejected anyway.
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only rendering mode, no state change.
	$raw = ( isset( $_GET[ OPENSTATION_SOLO_FLAG ] ) && is_scalar( $_GET[ OPENSTATION_SOLO_FLAG ] ) )
		? sanitize_text_field( wp_unslash( $_GET[ OPENSTATION_SOLO_FLAG ] ) )
		: '';
	if ( '' === $raw ) {
		return '';
	}

	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return '';
	}

	// Window ids are shell-generated slugs (`edit-php`, `os-files`,
	// plugin-registered native ids). `sanitize_key()` is the right
	// shape and drops anything that could escape an attribute or a
	// selector.
	$id = sanitize_key( $raw );

	/**
	 * Filter the window id booted in solo mode.
	 *
	 * Returning '' turns solo mode off for this request — the hook to
	 * use for gating single-window rendering by role or by window.
	 *
	 * @param string $id  Key-sanitized window id, ready to use.
	 * @param string $raw The requested value before key-sanitization.
	 */
	return (string) apply_filters( 'openstation_solo_window_id', $id, $raw );
}

/**
 * Whether this request is booting a single window in solo mode.
 *
 * @return bool True in solo mode.
 */
function openstation_is_solo_request() {
	return '' !== openstation_solo_window_id();
}
