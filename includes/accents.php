<?php
/**
 * OpenStation — Accent color swatches.
 *
 * The OS Settings panel lets users pick an accent color that the shell
 * applies to `--wp-admin-theme-color` on the parent frame. Themes and
 * plugins can extend or restrict the swatch list via the
 * {@see 'open_station_accent_colors'} filter — e.g. a brand theme that
 * injects its corporate palette, or a compliance plugin that collapses
 * the list to a single approved value.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the list of accent-color swatches shown in OS Settings.
 *
 * Each entry is an array shaped `{ id, label, value }`:
 *
 *   - `id` is a stable slug (persisted in `localStorage`).
 *   - `label` is the human-readable name used in the picker tooltip.
 *   - `value` is a hex color applied to `--wp-admin-theme-color`.
 *
 * The defaults ship with six WordPress-adjacent swatches. Consumers
 * mutate the list via the `open_station_accent_colors` filter — entries
 * whose `value` fails `sanitize_hex_color()` are dropped silently so a
 * bad filter return can't inject arbitrary CSS into the shell.
 *
 * @return array<int, array{id: string, label: string, value: string}>
 */
function open_station_get_accent_colors() {
	$defaults = array(
		// The brand accents lead the list: Pulse is the identity
		// colour and the shipped default, Nebula its softer twin.
		array( 'id' => 'pulse',   'label' => __( 'Pulse', 'desktop-mode' ),          'value' => '#f252fc' ),
		array( 'id' => 'nebula',  'label' => __( 'Nebula', 'desktop-mode' ),         'value' => '#ec9bff' ),
		array( 'id' => 'wp-blue', 'label' => __( 'WordPress Blue', 'desktop-mode' ), 'value' => '#2271b1' ),
		array( 'id' => 'indigo',  'label' => __( 'Indigo', 'desktop-mode' ),         'value' => '#3858e9' ),
		array( 'id' => 'teal',    'label' => __( 'Teal', 'desktop-mode' ),           'value' => '#04a4cc' ),
		array( 'id' => 'emerald', 'label' => __( 'Emerald', 'desktop-mode' ),        'value' => '#059669' ),
		array( 'id' => 'amber',   'label' => __( 'Amber', 'desktop-mode' ),          'value' => '#d97706' ),
		array( 'id' => 'rose',    'label' => __( 'Rose', 'desktop-mode' ),           'value' => '#e11d48' ),
	);

	/**
	 * Filters the list of accent-color swatches offered in OS Settings.
	 *
	 * ```php
	 * add_filter( 'open_station_accent_colors', function ( $colors ) {
	 *     $colors[] = array(
	 *         'id'    => 'brand',
	 *         'label' => __( 'Brand', 'my-plugin' ),
	 *         'value' => '#ff00ff',
	 *     );
	 *     return $colors;
	 * } );
	 * ```
	 *
	 * Non-array return values fall back to the built-in defaults.
	 * Individual entries missing an `id`, `label`, or whose `value`
	 * isn't a valid hex color are dropped — the shell can't render
	 * half-formed swatches safely.
	 *
	 * @param array $defaults Built-in swatches.
	 */
	$filtered = apply_filters( 'open_station_accent_colors', $defaults );
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
		$value = isset( $entry['value'] ) ? sanitize_hex_color( (string) $entry['value'] ) : '';
		if ( '' === $id || '' === $label || null === $value || '' === $value ) {
			continue;
		}
		if ( isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ]  = true;
		$clean[]      = array(
			'id'    => $id,
			'label' => $label,
			'value' => $value,
		);
	}

	// If every entry was dropped (e.g. a filter returned all garbage),
	// fall back to defaults so the picker is never empty.
	return empty( $clean ) ? $defaults : $clean;
}
