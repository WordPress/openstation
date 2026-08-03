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
class Open_Station_Embed_File extends Open_Station_File {

	public static function type(): string {
		return 'embed';
	}

	public function exists(): bool {
		return '' !== $this->url();
	}

	public function title(): string {
		$url = $this->url();
		if ( '' === $url ) {
			return __( '(missing embed)', 'desktop-mode' );
		}
		$host = wp_parse_url( $url, PHP_URL_HOST );
		return is_string( $host ) && '' !== $host ? $host : $url;
	}

	public function icon(): string {
		return 'dashicons-welcome-view-site';
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
