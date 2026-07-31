<?php
/**
 * Desktop Mode — `bookmark` file type.
 *
 * Reference is the URL itself (validated against `esc_url_raw`).
 * Title falls back to the host when the user hasn't set one — the
 * UI promotes a separate `title` field stored alongside the
 * placement in the placement row's `meta` column (Phase 2), but
 * the base shape works without it.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `bookmark` desktop file type.
 */
class Desktop_Mode_Bookmark_File extends Desktop_Mode_File {

	public static function type(): string {
		return 'bookmark';
	}

	public function exists(): bool {
		return '' !== $this->url();
	}

	public function title(): string {
		$url = $this->url();
		if ( '' === $url ) {
			return __( '(missing bookmark)', 'desktop-mode' );
		}
		$host = wp_parse_url( $url, PHP_URL_HOST );
		return is_string( $host ) && '' !== $host ? $host : $url;
	}

	public function icon(): string {
		return 'dashicons-admin-links';
	}

	public function serialize(): array {
		$shape         = parent::serialize();
		$shape['url']  = $this->url();
		return $shape;
	}

	private function url(): string {
		$url = esc_url_raw( $this->ref );
		return is_string( $url ) ? $url : '';
	}
}
