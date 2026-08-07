<?php
/**
 * OpenStation — `upload` file type.
 *
 * A real uploaded file with bytes on the server. The reference is
 * the row id in `{$wpdb->prefix}desktop_mode_stored_files`. Unlike
 * every other built-in type, the placement OWNS the entity — see
 * the deletion contract in `stored-files-store.php`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `upload` desktop file type.
 */
class OpenStation_Upload_File extends OpenStation_File {

	public static function type(): string {
		return 'upload';
	}

	public function exists(): bool {
		return null !== $this->row();
	}

	public function title(): string {
		$row = $this->row();
		if ( ! $row ) {
			return __( '(missing file)', 'desktop-mode' );
		}
		return '' !== (string) $row['display_name'] ? (string) $row['display_name'] : __( 'file', 'desktop-mode' );
	}

	public function icon(): string {
		switch ( $this->kind() ) {
			case 'image':
				return 'dashicons-format-image';
			case 'video':
				return 'dashicons-format-video';
			case 'audio':
				return 'dashicons-format-audio';
			case 'pdf':
				return 'dashicons-pdf';
			case 'archive':
				return 'dashicons-archive';
			case 'text':
				return 'dashicons-media-text';
			default:
				return 'dashicons-media-default';
		}
	}

	public function can_read( int $user_id ): bool {
		$row = $this->row();
		if ( ! $row ) {
			return false;
		}
		return openstation_stored_file_user_can_read( (int) $row['id'], $user_id );
	}

	public function serialize(): array {
		$shape              = parent::serialize();
		$row                = $this->row();
		$shape['ownerId']   = $row ? (int) $row['owner_id'] : 0;
		$shape['sizeBytes'] = $row ? (int) $row['size_bytes'] : 0;
		$shape['mime']      = $row ? (string) $row['mime'] : '';
		$shape['kind']      = $this->kind();
		return $shape;
	}

	/**
	 * Coarse mime-category slug used for the tile icon and by the
	 * JS type for rendering decisions.
	 *
	 * @return string image|video|audio|pdf|archive|text|file
	 */
	private function kind(): string {
		$row  = $this->row();
		$mime = $row ? strtolower( (string) $row['mime'] ) : '';
		if ( '' === $mime ) {
			return 'file';
		}
		$major = strtok( $mime, '/' );
		if ( in_array( $major, array( 'image', 'video', 'audio' ), true ) ) {
			return $major;
		}
		if ( 'application/pdf' === $mime ) {
			return 'pdf';
		}
		if ( preg_match( '#^application/(zip|x-tar|x-gzip|gzip|x-7z-compressed|x-rar-compressed|x-bzip2?)$#', $mime ) ) {
			return 'archive';
		}
		if ( 'text' === $major || in_array( $mime, array( 'application/json', 'application/xml' ), true ) ) {
			return 'text';
		}
		return 'file';
	}

	private function row(): ?array {
		$id = (int) $this->ref;
		if ( $id <= 0 || ! function_exists( 'openstation_stored_files_get' ) ) {
			return null;
		}
		return openstation_stored_files_get( $id );
	}
}
