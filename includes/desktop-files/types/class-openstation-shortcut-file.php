<?php

defined( 'ABSPATH' ) || exit;

class OpenStation_Shortcut_File extends OpenStation_File {

	private $resolved_entry = false;

	public static function type(): string {
		return 'shortcut';
	}

	public function exists(): bool {
		return null !== $this->entry();
	}

	public function title(): string {
		$entry = $this->entry();
		if ( ! $entry ) {
			return __( '(missing shortcut)', 'desktop-mode' );
		}
		return (string) $entry['title'];
	}

	public function icon(): string {
		$entry = $this->entry();
		if ( ! $entry ) {
			return 'dashicons-warning';
		}
		return (string) $entry['icon'];
	}

	public function can_read( int $user_id ): bool {

		return null !== $this->entry();
	}

	public function serialize(): array {
		$shape = parent::serialize();
		$entry = $this->entry();

		$shape['shortcutWindow'] = $entry ? (string) $entry['window'] : '';
		$shape['shortcutUrl']    = $entry ? (string) $entry['url'] : '';

		$shape['pinned'] = $entry ? ! empty( $entry['pinned'] ) : false;
		return $shape;
	}

	private function entry(): ?array {
		if ( false !== $this->resolved_entry ) {
			return $this->resolved_entry;
		}
		$id                   = (string) $this->ref;
		$this->resolved_entry = ( '' !== $id && function_exists( 'openstation_desktop_icon_entry' ) )
			? openstation_desktop_icon_entry( $id )
			: null;
		return $this->resolved_entry;
	}
}
