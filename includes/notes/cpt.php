<?php
/**
 * OpenStation — Pinned notes CPT.
 *
 * Registers the `wpd_note` post type backing the pinned-notes feature:
 * paper notes the user writes in the Note Pad widget (or straight on
 * the wallpaper, via its right-click menu) and pins to the desktop.
 *
 * Visibility model: the "public" checkbox maps to `post_status`.
 *
 *   'private' — default; only the owner sees the note.
 *   'publish' — public; every openstation user sees it (read-only
 *               for non-owners). Nothing leaks outside the plugin's
 *               own REST controller because the CPT is not publicly
 *               queryable, excluded from search, and absent from the
 *               core REST API.
 *
 * Position (normalized 0–1 of the desktop area), paper color, and
 * z-order live in postmeta — per-owner placement is the canonical
 * placement every viewer sees.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

const OPENSTATION_NOTES_POST_TYPE = 'wpd_note';

/**
 * The pastel paper color slugs a note may use.
 *
 * Mirrored client-side in `src/notes/colors.ts` — keep both lists in
 * sync (the CSS custom properties in `assets/css/notes.css` are keyed
 * by these slugs).
 *
 * @return string[] Color slugs.
 */
function openstation_notes_colors() {
	$colors = array( 'butter', 'blush', 'sky', 'mint', 'lilac', 'peach' );

	/**
	 * Filters the allowed pinned-note paper colors.
	 *
	 * Slugs added here must also ship CSS custom properties
	 * (`--dm-note-paper` / `--dm-note-paper-deep` / `--dm-note-ink`)
	 * for a `[data-note-color="<slug>"]` selector, otherwise notes
	 * using them render with the fallback (butter) paper.
	 *
	 * @param string[] $colors Allowed color slugs.
	 */
	$colors = apply_filters( 'openstation_notes_colors', $colors );

	return array_values( array_filter( array_map( 'sanitize_key', (array) $colors ) ) );
}

/**
 * Register the `wpd_note` post type + its meta.
 */
function openstation_notes_register_cpt() {
	register_post_type(
		OPENSTATION_NOTES_POST_TYPE,
		array(
			'label'               => __( 'Desktop Notes', 'desktop-mode' ),
			'public'              => false,
			'publicly_queryable'  => false,
			'exclude_from_search' => true,
			'show_ui'             => false,
			'show_in_menu'        => false,
			'show_in_rest'        => false, // Custom controller in includes/notes/rest.php.
			'supports'            => array( 'title', 'editor', 'author', 'custom-fields' ),
			'capability_type'     => 'post',
			'map_meta_cap'        => true,
			'delete_with_user'    => true,
			'rewrite'             => false,
			'query_var'           => false,
		)
	);

	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_color',
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => 'butter',
			'sanitize_callback' => 'openstation_notes_sanitize_color',
		)
	);

	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_x',
		array(
			'type'              => 'number',
			'single'            => true,
			'default'           => 0.1,
			'sanitize_callback' => 'openstation_notes_sanitize_fraction',
		)
	);

	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_y',
		array(
			'type'              => 'number',
			'single'            => true,
			'default'           => 0.1,
			'sanitize_callback' => 'openstation_notes_sanitize_fraction',
		)
	);

	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_z',
		array(
			'type'              => 'integer',
			'single'            => true,
			'default'           => 1,
			'sanitize_callback' => 'absint',
		)
	);

	// Jitter seed — hashed from the note's text once at CREATION and
	// never rewritten, so the paper's subtle tilt survives edits.
	register_post_meta(
		OPENSTATION_NOTES_POST_TYPE,
		'_wpd_note_seed',
		array(
			'type'              => 'integer',
			'single'            => true,
			'default'           => 0,
			'sanitize_callback' => 'absint',
		)
	);
}
add_action( 'init', 'openstation_notes_register_cpt' );

/**
 * Clamp a note color to the allowed pastel whitelist.
 *
 * @param mixed $color Raw value.
 * @return string Whitelisted slug (falls back to 'butter').
 */
function openstation_notes_sanitize_color( $color ) {
	$color  = is_scalar( $color ) ? sanitize_key( (string) $color ) : '';
	$colors = openstation_notes_colors();
	if ( in_array( $color, $colors, true ) ) {
		return $color;
	}
	return isset( $colors[0] ) ? $colors[0] : 'butter';
}

/**
 * Clamp a note position coordinate to the normalized 0–1 range.
 *
 * @param mixed $value Raw value.
 * @return float
 */
function openstation_notes_sanitize_fraction( $value ) {
	return (float) min( 1, max( 0, (float) $value ) );
}

/**
 * Restore a note's pre-trash status on untrash.
 *
 * Core's default untrash status is 'draft', which would silently flip
 * a public note private (and make it invisible to its own list query,
 * which only looks at private + publish). Restore what the note was.
 *
 * @param string $new_status      Status the post is about to get.
 * @param int    $post_id         Post ID.
 * @param string $previous_status Status the post had before trashing.
 * @return string
 */
function openstation_notes_untrash_status( $new_status, $post_id, $previous_status ) {
	if ( OPENSTATION_NOTES_POST_TYPE !== get_post_type( $post_id ) ) {
		return $new_status;
	}
	if ( in_array( $previous_status, array( 'private', 'publish' ), true ) ) {
		return $previous_status;
	}
	return 'private';
}
add_filter( 'wp_untrash_post_status', 'openstation_notes_untrash_status', 10, 3 );
