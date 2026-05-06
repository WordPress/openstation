<?php
/**
 * Desktop Mode — `folder` file type.
 *
 * Folders are first-class files. The reference is the folder's
 * row id in `{$wpdb->prefix}desktop_mode_folders` (added in
 * Phase 2). Until that table lands, instantiating a folder file
 * is harmless: title falls back to a constructor-provided label
 * stored on the placement, and `exists()` is gated on the
 * presence of the folder row.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * @since 0.9.0
 */
class Desktop_Mode_Folder_File extends Desktop_Mode_File {

	public static function type(): string {
		return 'folder';
	}

	public function exists(): bool {
		return null !== $this->folder();
	}

	public function title(): string {
		$row = $this->folder();
		if ( ! $row ) {
			return __( 'Folder', 'desktop-mode' );
		}
		return '' !== (string) $row['name'] ? (string) $row['name'] : __( 'Folder', 'desktop-mode' );
	}

	public function icon(): string {
		return 'dashicons-portfolio';
	}

	public function can_read( int $user_id ): bool {
		$row = $this->folder();
		if ( ! $row ) {
			return false;
		}
		// Owner always sees their folder. Phase 6's visibility
		// filter evaluates share modes for everyone else; we
		// reuse the same machinery here so a `can_read()` call
		// stays consistent with `desktop_mode_files_get_visible_folders`.
		if ( (int) $row['owner_id'] === (int) $user_id ) {
			return true;
		}
		$visible_ids = wp_list_pluck( desktop_mode_files_get_visible_folders( $user_id ), 'id' );
		return in_array( (int) $row['id'], array_map( 'intval', (array) $visible_ids ), true );
	}

	public function serialize(): array {
		$shape = parent::serialize();
		$row   = $this->folder();
		$shape['ownerId']   = $row ? (int) $row['owner_id'] : 0;
		$shape['shareMode'] = $row ? (string) $row['share_mode'] : 'private';
		return $shape;
	}

	private function folder(): ?array {
		$id = (int) $this->ref;
		if ( $id <= 0 ) {
			return null;
		}
		if ( ! function_exists( 'desktop_mode_files_get_folder' ) ) {
			return null;
		}
		return desktop_mode_files_get_folder( $id );
	}
}
