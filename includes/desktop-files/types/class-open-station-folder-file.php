<?php
/**
 * OpenStation — `folder` file type.
 *
 * Folders are first-class files. The reference is the folder's
 * row id in `{$wpdb->prefix}desktop_mode_folders`. When the row
 * is missing, title() falls back to a generic "Folder" label and
 * `exists()` returns false.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The `folder` desktop file type.
 */
class Open_Station_Folder_File extends Open_Station_File {

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
		if ( (int) $row['owner_id'] === (int) $user_id ) {
			return true;
		}
		// The capability resolver is the authority —
		// it knows about direct shares, role decisions, AND cascade
		// (a folder nested inside a shared folder is reachable).
		if ( function_exists( 'open_station_folder_share_user_capability' ) ) {
			$cap = open_station_folder_share_user_capability( (int) $row['id'], (int) $user_id );
			if ( 'none' !== $cap ) {
				return true;
			}
		}
		// Back-compat fallback for legacy `share_meta` rows that
		// pre-date the shares table.
		$visible_ids = wp_list_pluck( open_station_files_get_visible_folders( $user_id ), 'id' );
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
		if ( ! function_exists( 'open_station_files_get_folder' ) ) {
			return null;
		}
		return open_station_files_get_folder( $id );
	}
}
