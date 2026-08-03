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
class Open_Station_Link_File extends Open_Station_File {

	public static function type(): string {
		return 'link';
	}

	public function exists(): bool {
		return '' !== $this->url();
	}

	public function title(): string {
		$url = $this->url();
		if ( '' === $url ) {
			return __( '(missing link)', 'desktop-mode' );
		}
		$host = wp_parse_url( $url, PHP_URL_HOST );
		return is_string( $host ) && '' !== $host ? $host : $url;
	}

	public function icon(): string {
		return 'dashicons-admin-links';
	}

	public function serialize(): array {
		$shape        = parent::serialize();
		$shape['url'] = $this->url();
		return $shape;
	}

	private function url(): string {
		$url = esc_url_raw( $this->ref );
		return is_string( $url ) ? $url : '';
	}
}
