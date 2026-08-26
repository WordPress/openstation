<?php
/**
 * OpenStation — `bookmark` file type.
 *
 * Reference is the URL itself (validated against `esc_url_raw`).
 * Title falls back to the host when the user hasn't set one — the
 * UI promotes a separate `title` field stored alongside the
 * placement in the placement row's `meta` column (Phase 2), but
 * the base shape works without it.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `bookmark` desktop file type.
 */
class OpenStation_Bookmark_File extends OpenStation_File {

	/**
	 * Get the file type identifier.
	 *
	 * @return string
	 */
	public static function type(): string {
		return 'bookmark';
	}

	/**
	 * Whether the bookmark URL is non-empty.
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return '' !== $this->url();
	}

	/**
	 * Get a label from the bookmark URL's host.
	 *
	 * @return string
	 */
	public function title(): string {
		$url = $this->url();
		if ( '' === $url ) {
			return __( '(missing bookmark)', 'desktop-mode' );
		}
		$host = wp_parse_url( $url, PHP_URL_HOST );
		return is_string( $host ) && '' !== $host ? $host : $url;
	}

	/**
	 * Get the Dashicon class for bookmark tiles.
	 *
	 * @return string
	 */
	public function icon(): string {
		return 'dashicons-admin-links';
	}

	/**
	 * Augment the base serialized shape with the bookmark URL.
	 *
	 * @return array
	 */
	public function serialize(): array {
		$shape        = parent::serialize();
		$shape['url'] = $this->url();
		return $shape;
	}

	/**
	 * Sanitize the stored ref into a valid URL.
	 *
	 * @return string Empty string when the ref is not a valid URL.
	 */
	private function url(): string {
		$url = esc_url_raw( $this->ref );
		return is_string( $url ) ? $url : '';
	}
}
