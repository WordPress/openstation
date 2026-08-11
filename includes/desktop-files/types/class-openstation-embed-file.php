<?php
/**
 * OpenStation — `embed` file type.
 *
 * An "embedded web window" tile — double-click opens the stored URL
 * in an iframe-based desktop window so the page renders inside the
 * shell instead of a new browser tab. The URL is the entity
 * reference; an optional human-friendly name lives on the
 * placement row's `meta.name`. The window's last `{ x, y, width,
 * height }` is persisted on `meta.window` after every drag /
 * resize end so the next open restores that geometry (clamped to
 * the current desktop area on the JS side).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `embed` desktop file type.
 */
class OpenStation_Embed_File extends OpenStation_File {

	/**
	 * Get the file type identifier.
	 *
	 * @return string
	 */
	public static function type(): string {
		return 'embed';
	}

	/**
	 * Whether the embed URL is non-empty.
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return '' !== $this->url();
	}

	/**
	 * Get a label from the embed URL's host.
	 *
	 * @return string
	 */
	public function title(): string {
		$url = $this->url();
		if ( '' === $url ) {
			return __( '(missing embed)', 'desktop-mode' );
		}
		$host = wp_parse_url( $url, PHP_URL_HOST );
		return is_string( $host ) && '' !== $host ? $host : $url;
	}

	/**
	 * Get the Dashicon class for embed tiles.
	 *
	 * @return string
	 */
	public function icon(): string {
		return 'dashicons-welcome-view-site';
	}

	/**
	 * Augment the base serialized shape with the embed URL.
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
