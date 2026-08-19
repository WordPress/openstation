<?php
/**
 * OpenStation — "My WordPress" module bootstrap.
 *
 * Pinned virtual folder on the desktop wallpaper that opens a native
 * file-explorer window for browsing WordPress entities (Posts,
 * Pages, Users, and Media today). Future phases add Comments, Tags,
 * Categories, Themes, and Plugins as additional sub-folders.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/assets.php';
require_once __DIR__ . '/window.php';
require_once __DIR__ . '/owner.php';
require_once __DIR__ . '/post-types.php';
require_once __DIR__ . '/class-openstation-my-wordpress-post-type-controller.php';
require_once __DIR__ . '/rest-post-type.php';
require_once __DIR__ . '/lock.php';
require_once __DIR__ . '/user-stats.php';
require_once __DIR__ . '/user-list-fields.php';
require_once __DIR__ . '/user-footprint.php';
require_once __DIR__ . '/users-list-footprint.php';
require_once __DIR__ . '/term-stats.php';
require_once __DIR__ . '/comment-stats.php';
require_once __DIR__ . '/media-usage.php';
require_once __DIR__ . '/attached-media.php';
require_once __DIR__ . '/preview-actions.php';

// Third-party integrations. Each file is inert unless its plugin is
// active, so requiring them unconditionally costs one include.
require_once __DIR__ . '/integrations/woocommerce.php';
require_once __DIR__ . '/integrations/woocommerce-product-studio.php';
require_once __DIR__ . '/integrations/woocommerce-customers.php';
require_once __DIR__ . '/integrations/woocommerce-customer-window.php';
require_once __DIR__ . '/integrations/woocommerce-relations.php';
