<?php
/**
 * OpenStation — `term` file type. Covers any taxonomy term
 * (category, tag, custom). Reference shape: `"<taxonomy>:<term_id>"`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `term` desktop file type.
 */
class OpenStation_Term_File extends OpenStation_File {

	/**
	 * Get the file type identifier.
	 *
	 * @return string
	 */
	public static function type(): string {
		return 'term';
	}

	/**
	 * Whether the term still exists.
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return $this->term() instanceof WP_Term;
	}

	/**
	 * Get the term name.
	 *
	 * @return string
	 */
	public function title(): string {
		$term = $this->term();
		if ( ! $term ) {
			return __( '(missing term)', 'desktop-mode' );
		}
		return wp_strip_all_tags( $term->name );
	}

	/**
	 * Resolve a Dashicon class based on the taxonomy.
	 *
	 * @return string
	 */
	public function icon(): string {
		$term = $this->term();
		if ( ! $term ) {
			return 'dashicons-warning';
		}
		switch ( $term->taxonomy ) {
			case 'category':
				return 'dashicons-category';
			case 'post_tag':
				return 'dashicons-tag';
			default:
				return 'dashicons-tagcloud';
		}
	}

	/**
	 * Check whether the user can edit terms in this taxonomy or
	 * has the base `read` capability.
	 *
	 * @param int $user_id
	 * @return bool
	 */
	public function can_read( int $user_id ): bool {
		$term = $this->term();
		if ( ! $term ) {
			return false;
		}
		$tax = get_taxonomy( $term->taxonomy );
		if ( ! $tax ) {
			return false;
		}
		return user_can( $user_id, $tax->cap->edit_terms ) || user_can( $user_id, 'read' );
	}

	/**
	 * Augment the base serialized shape with taxonomy and post
	 * count.
	 *
	 * @return array
	 */
	public function serialize(): array {
		$shape             = parent::serialize();
		$term              = $this->term();
		$shape['taxonomy'] = $term ? (string) $term->taxonomy : '';
		$shape['count']    = $term ? (int) $term->count : 0;
		return $shape;
	}

	/**
	 * Lazily resolve the underlying WP_Term from the stored ref.
	 *
	 * @return WP_Term|null Null when the term is gone or the ref is invalid.
	 */
	private function term(): ?WP_Term {
		[ $taxonomy, $term_id ] = $this->parse_ref();
		if ( '' === $taxonomy || $term_id <= 0 ) {
			return null;
		}
		$term = get_term( $term_id, $taxonomy );
		return $term instanceof WP_Term ? $term : null;
	}

	/**
	 * @return array{0: string, 1: int}
	 */
	private function parse_ref(): array {
		$parts = explode( ':', $this->ref, 2 );
		if ( count( $parts ) !== 2 ) {
			return array( '', 0 );
		}
		return array( (string) $parts[0], (int) $parts[1] );
	}
}
