<?php

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

require_once __DIR__ . '/integrations/woocommerce.php';
require_once __DIR__ . '/integrations/woocommerce-customers.php';
require_once __DIR__ . '/integrations/woocommerce-customer-window.php';
require_once __DIR__ . '/integrations/woocommerce-relations.php';
