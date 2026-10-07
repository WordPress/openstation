<?php

defined( 'ABSPATH' ) || exit;

class OpenStation_Bookmark_File extends OpenStation_File {

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
		$shape        = parent::serialize();
		$shape['url'] = $this->url();
		return $shape;
	}

	private function url(): string {
		$url = esc_url_raw( $this->ref );
		return is_string( $url ) ? $url : '';
	}
}
