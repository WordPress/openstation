<?php
/**
 * OpenStation — Files-on-the-desktop bootstrap.
 *
 * Loads the `Open_Station_File` base class, the type registry, the
 * built-in leaf-type subclasses, and the registration of the
 * built-in file types on `init` priority 5.
 *
 * Future phases (schema/REST, UI, sharing, drag-from-recycle-bin)
 * will require additional files from this directory; new
 * `require_once` lines belong here so the rest of the codebase
 * keeps loading the feature through one entry point.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once OPEN_STATION_DIR . 'includes/desktop-files/class-open-station-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/registry.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-post-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-user-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-attachment-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-term-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-comment-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-bookmark-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-folder-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-shortcut-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-link-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-embed-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/types/class-open-station-upload-file.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/built-in-types.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/openers.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/built-in-openers.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/schema.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/store.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/folders-store.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/stored-files-store.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/shares-store.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/file-shares.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/trash.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/cascade-cleanup.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/favicon.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/rest.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/rest-uploads.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/downloads.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/wallpaper-menu.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/sharing.php';
require_once OPEN_STATION_DIR . 'includes/desktop-files/heartbeat.php';
