<?php
/**
 * Desktop Mode — Toast notification type registry.
 *
 * The shell surfaces user-visible toast notifications (save succeeded,
 * upload failed, a plugin crashed, …). Each toast carries a `type`
 * slug that the shell maps to a color + icon. The defaults cover
 * `success`, `warning`, `error`, and `shell-error`; plugins and themes
 * extend the list via the {@see 'wp_desktop_toast_types'} filter to
 * register their own slugs (e.g. `update-available`).
 *
 * @package WPDesktopMode
 * @since   0.11.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the map of toast-notification type slugs shipped to the shell.
 *
 * Each entry is an array shaped `{ id, label, icon, tone }`:
 *
 *   - `id` is a stable slug plugins call with `wp.desktop.toast( id, … )`.
 *   - `label` is the default aria-label used when a toast omits one.
 *   - `icon` is a Dashicons class rendered alongside the message.
 *   - `tone` is one of `positive | warning | critical | neutral` — the
 *     shell maps this to its color palette.
 *
 * @since 0.11.0
 *
 * @return array<int, array{id: string, label: string, icon: string, tone: string}>
 */
function wpdm_get_toast_types() {
	$defaults = array(
		array(
			'id'    => 'success',
			'label' => __( 'Success', 'desktop-mode' ),
			'icon'  => 'dashicons-yes-alt',
			'tone'  => 'positive',
		),
		array(
			'id'    => 'warning',
			'label' => __( 'Warning', 'desktop-mode' ),
			'icon'  => 'dashicons-warning',
			'tone'  => 'warning',
		),
		array(
			'id'    => 'error',
			'label' => __( 'Error', 'desktop-mode' ),
			'icon'  => 'dashicons-dismiss',
			'tone'  => 'critical',
		),
		array(
			'id'    => 'shell-error',
			'label' => __( 'Shell error', 'desktop-mode' ),
			'icon'  => 'dashicons-bug',
			'tone'  => 'critical',
		),
	);

	$allowed_tones = array( 'positive', 'warning', 'critical', 'neutral' );

	/**
	 * Filters the toast-notification type map.
	 *
	 * ```php
	 * add_filter( 'wp_desktop_toast_types', function ( $types ) {
	 *     $types[] = array(
	 *         'id'    => 'update-available',
	 *         'label' => __( 'Update available', 'my-plugin' ),
	 *         'icon'  => 'dashicons-update',
	 *         'tone'  => 'neutral',
	 *     );
	 *     return $types;
	 * } );
	 * ```
	 *
	 * Non-array returns fall back to defaults. Entries whose `id` is
	 * empty, whose `tone` is not one of `positive|warning|critical|
	 * neutral`, or whose `icon` isn't a sanitizable Dashicons-shaped
	 * class are dropped.
	 *
	 * @since 0.11.0
	 *
	 * @param array $defaults Built-in toast types.
	 */
	$filtered = apply_filters( 'wp_desktop_toast_types', $defaults );
	if ( ! is_array( $filtered ) ) {
		return $defaults;
	}

	$clean = array();
	$seen  = array();
	foreach ( $filtered as $entry ) {
		if ( ! is_array( $entry ) ) {
			continue;
		}
		$id    = isset( $entry['id'] ) ? sanitize_key( (string) $entry['id'] ) : '';
		$label = isset( $entry['label'] ) ? wp_strip_all_tags( (string) $entry['label'] ) : '';
		$icon  = isset( $entry['icon'] ) ? sanitize_html_class( (string) $entry['icon'] ) : '';
		$tone  = isset( $entry['tone'] ) ? sanitize_key( (string) $entry['tone'] ) : '';
		if ( '' === $id || '' === $tone || ! in_array( $tone, $allowed_tones, true ) ) {
			continue;
		}
		if ( isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;
		$clean[]     = array(
			'id'    => $id,
			'label' => '' !== $label ? $label : ucfirst( $id ),
			'icon'  => '' !== $icon ? $icon : 'dashicons-info',
			'tone'  => $tone,
		);
	}

	return empty( $clean ) ? $defaults : $clean;
}
