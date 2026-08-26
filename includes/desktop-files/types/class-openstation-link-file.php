<?php
/**
 * OpenStation — `link` file type.
 *
 * A "web link" tile — double-click opens the stored URL in a new
 * browser tab via `window.open( url, '_blank', 'noopener,noreferrer' )`.
 * The URL itself is the entity reference; an optional human-friendly
 * name lives on the placement row's `meta.name` so two tiles
 * pointing at the same URL can carry different labels.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `link` desktop file type.
 */
class OpenStation_Link_File extends OpenStation_File {

	/**
	 * Get the file type identifier.
	 *
	 * @return string
	 */
	public static function type(): string {
		return 'link';
	}

	/**
	 * Whether the link URL is non-empty.
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return '' !== $this->url();
	}

	/**
	 * Get a label from the link URL's host.
	 *
	 * @return string
	 */
	public function title(): string {
		$url = $this->url();
		if ( '' === $url ) {
			return __( '(missing link)', 'desktop-mode' );
		}
		$host = wp_parse_url( $url, PHP_URL_HOST );
		return is_string( $host ) && '' !== $host ? $host : $url;
	}

	/**
	 * Get the Dashicon class for link tiles.
	 *
	 * @return string
	 */
	public function icon(): string {
		return 'dashicons-admin-links';
	}

	/**
	 * Augment the base serialized shape with the link URL.
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
