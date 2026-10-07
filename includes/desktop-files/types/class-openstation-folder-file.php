<?php

defined( 'ABSPATH' ) || exit;

class OpenStation_Folder_File extends OpenStation_File {

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

		if ( function_exists( 'openstation_folder_share_user_capability' ) ) {
			$cap = openstation_folder_share_user_capability( (int) $row['id'], (int) $user_id );
			if ( 'none' !== $cap ) {
				return true;
			}
		}

		$visible_ids = wp_list_pluck( openstation_files_get_visible_folders( $user_id ), 'id' );
		return in_array( (int) $row['id'], array_map( 'intval', (array) $visible_ids ), true );
	}

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
