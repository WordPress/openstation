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
class OpenStation_Folder_File extends OpenStation_File {

	/**
	 * Get the file type identifier.
	 *
	 * @return string
	 */
	public static function type(): string {
		return 'folder';
	}

	/**
	 * Whether the folder row still exists in the database.
	 *
	 * @return bool
	 */
	public function exists(): bool {
		return null !== $this->folder();
	}

	/**
	 * Get the folder name, falling back to a generic label.
	 *
	 * @return string
	 */
	public function title(): string {
		$row = $this->folder();
		if ( ! $row ) {
			return __( 'Folder', 'desktop-mode' );
		}
		return '' !== (string) $row['name'] ? (string) $row['name'] : __( 'Folder', 'desktop-mode' );
	}

	/**
	 * Get the Dashicon class for folder tiles.
	 *
	 * @return string
	 */
	public function icon(): string {
		return 'dashicons-portfolio';
	}

	/**
	 * Check whether the user owns the folder, has a direct share,
	 * or reaches it via cascade from a parent folder.
	 *
	 * @param int $user_id
	 * @return bool
	 */
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
		if ( function_exists( 'openstation_folder_share_user_capability' ) ) {
			$cap = openstation_folder_share_user_capability( (int) $row['id'], (int) $user_id );
			if ( 'none' !== $cap ) {
				return true;
			}
		}
		// Back-compat fallback for legacy `share_meta` rows that
		// pre-date the shares table.
		$visible_ids = wp_list_pluck( openstation_files_get_visible_folders( $user_id ), 'id' );
		return in_array( (int) $row['id'], array_map( 'intval', (array) $visible_ids ), true );
	}

	/**
	 * Augment the base serialized shape with owner id, share mode and
	 * the share summary.
	 *
	 * `shareSummary` is the same shape the folder response carries
	 * (see {@see openstation_files_folder_share_summary()}) and it
	 * belongs here for one reason: a folder on the desktop is a
	 * PLACEMENT, and a placement's `file` is whatever this method
	 * returns. Without it the shared badge had nothing to read — the
	 * summary existed only on the separate folder response, which the
	 * tile renderer never sees — so an accepted share was invisible
	 * to owner and recipient alike.
	 *
	 * @return array
	 */
	public function serialize(): array {
		$shape              = parent::serialize();
		$row                = $this->folder();
		$shape['ownerId']   = $row ? (int) $row['owner_id'] : 0;
		$shape['shareMode'] = $row ? (string) $row['share_mode'] : 'private';
		if ( $row && function_exists( 'openstation_files_folder_share_summary' ) ) {
			$shape['shareSummary'] = openstation_files_folder_share_summary( $row );
		}
		return $shape;
	}

	/**
	 * Lazily resolve the folder row from the stored ref.
	 *
	 * @return array|null Null when the folder is gone or the ref is invalid.
	 */
	private function folder(): ?array {
		$id = (int) $this->ref;
		if ( $id <= 0 ) {
			return null;
		}
		if ( ! function_exists( 'openstation_files_get_folder' ) ) {
			return null;
		}
		return openstation_files_get_folder( $id );
	}
}
