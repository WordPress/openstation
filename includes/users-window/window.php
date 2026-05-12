<?php
/**
 * Desktop Mode — Native Users Window: registration, template, REST fields.
 *
 * Mirrors the structure of the Posts/Pages windows
 * (`includes/posts-window/`, `includes/pages-window/`) adapted for
 * the user collection — `/wp/v2/users` rather than `/wp/v2/posts`,
 * a Role/Email column set instead of taxonomies, and a much heavier
 * permission story (see `permissions.php` + `rest.php`).
 *
 * @package WPDesktopMode
 * @since   0.18.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the native Users window's template body.
 *
 * Same toolbar/table/pager structure as the Posts and Pages
 * windows. Reuses the `data-desktop-mode-posts-*` selectors so the
 * shared JS bundle binds to the same hooks regardless of window
 * mode (the namespace is an internal contract — both windows use
 * the same template machinery).
 *
 * @since 0.18.0
 */
function desktop_mode_users_window_render_template() {
	$can_create = current_user_can( 'create_users' );
	ob_start();
	?>
	<div class="desktop-mode-posts desktop-mode-users" data-desktop-mode-posts-root>
		<wpd-tabs value="all" class="desktop-mode-users__tabs" data-desktop-mode-users-tabs>
			<wpd-tab value="all"><?php esc_html_e( 'All users', 'desktop-mode' ); ?></wpd-tab>
			<?php if ( $can_create ) : ?>
				<wpd-tab value="add-new"><?php esc_html_e( 'Add new', 'desktop-mode' ); ?></wpd-tab>
			<?php endif; ?>
			<?php /* Profile tab — always visible, always shows the
			       CURRENT logged-in user. Other-user row clicks
			       open a separate `desktop-mode-user-edit`
			       window. */ ?>
			<wpd-tab value="edit" data-desktop-mode-users-edit-tab>
				<?php esc_html_e( 'Profile', 'desktop-mode' ); ?>
			</wpd-tab>
		</wpd-tabs>

		<wpd-tabpanel for="all" class="desktop-mode-posts__panel">
			<header class="desktop-mode-posts__toolbar" data-desktop-mode-posts-toolbar>
				<div class="desktop-mode-posts__toolbar-left">
					<wpd-segmented data-desktop-mode-posts-status value=""></wpd-segmented>
					<wpd-text-field
						data-desktop-mode-posts-search
						placeholder="<?php esc_attr_e( 'Search name, username, email…', 'desktop-mode' ); ?>"
					></wpd-text-field>
				</div>
				<div class="desktop-mode-posts__toolbar-right" data-desktop-mode-posts-bulk hidden>
					<span class="desktop-mode-posts__count" data-desktop-mode-posts-count></span>
					<span class="desktop-mode-posts__bulk-actions" data-desktop-mode-posts-bulk-actions></span>
				</div>
				<div class="desktop-mode-posts__toolbar-trailing">
					<span class="desktop-mode-posts__toolbar-extras" data-desktop-mode-posts-toolbar-extras></span>
					<wpd-button variant="ghost" data-desktop-mode-posts-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>">
						<span class="dashicons dashicons-update" aria-hidden="true"></span>
					</wpd-button>
					<wpd-button variant="primary" data-desktop-mode-posts-new>
						<span class="dashicons dashicons-plus" aria-hidden="true"></span>
						<?php esc_html_e( 'Add new', 'desktop-mode' ); ?>
					</wpd-button>
				</div>
			</header>
			<div class="desktop-mode-posts__body" data-desktop-mode-posts-body>
				<wpd-table
					data-desktop-mode-posts-table
					selectable="multi"
					sticky-header
					sticky-columns="1"
					hover
					striped
					bordered
					loading
				>
					<div slot="empty" class="desktop-mode-posts__empty">
						<span class="dashicons dashicons-admin-users" aria-hidden="true"></span>
						<p><?php esc_html_e( 'No users found.', 'desktop-mode' ); ?></p>
						<p class="desktop-mode-posts__empty-hint">
							<?php esc_html_e( 'Try a different search or change the role filter.', 'desktop-mode' ); ?>
						</p>
					</div>
				</wpd-table>
			</div>
			<footer class="desktop-mode-posts__pager" data-desktop-mode-posts-pager>
				<div class="desktop-mode-posts__pager-meta">
					<span data-desktop-mode-posts-page-indicator>—</span>
				</div>
				<div class="desktop-mode-posts__pager-nav">
					<wpd-button variant="ghost" data-desktop-mode-posts-prev disabled>
						<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>
						<?php esc_html_e( 'Previous', 'desktop-mode' ); ?>
					</wpd-button>
					<wpd-button variant="ghost" data-desktop-mode-posts-next disabled>
						<?php esc_html_e( 'Next', 'desktop-mode' ); ?>
						<span class="dashicons dashicons-arrow-right-alt2" aria-hidden="true"></span>
					</wpd-button>
					<label class="desktop-mode-posts__pager-perpage">
						<?php esc_html_e( 'Per page', 'desktop-mode' ); ?>
						<select data-desktop-mode-posts-per-page>
							<option value="10">10</option>
							<option value="20" selected>20</option>
							<option value="50">50</option>
							<option value="100">100</option>
						</select>
					</label>
				</div>
			</footer>
		</wpd-tabpanel>

		<?php if ( $can_create ) : ?>
		<wpd-tabpanel for="add-new" class="desktop-mode-users__add-panel">
			<wpd-form
				data-desktop-mode-users-add-form
				submit-label="<?php esc_attr_e( 'Add user', 'desktop-mode' ); ?>"
				reset-label="<?php esc_attr_e( 'Reset', 'desktop-mode' ); ?>"
			>
				<div slot="header">
					<h2><?php esc_html_e( 'Add a new user', 'desktop-mode' ); ?></h2>
					<p class="desktop-mode-users__form-lede">
						<?php esc_html_e( 'WordPress will create the account and (optionally) email the user a notification with a link to set their own password.', 'desktop-mode' ); ?>
					</p>
				</div>

				<wpd-text-field
					name="username"
					label="<?php esc_attr_e( 'Username (required)', 'desktop-mode' ); ?>"
					placeholder="<?php esc_attr_e( 'e.g. jane.doe', 'desktop-mode' ); ?>"
					autocomplete="off"
					required
				></wpd-text-field>
				<wpd-text-field
					name="email"
					type="email"
					label="<?php esc_attr_e( 'Email (required)', 'desktop-mode' ); ?>"
					placeholder="<?php esc_attr_e( 'jane@example.com', 'desktop-mode' ); ?>"
					autocomplete="off"
					required
				></wpd-text-field>
				<wpd-text-field
					name="first_name"
					label="<?php esc_attr_e( 'First name', 'desktop-mode' ); ?>"
					autocomplete="off"
				></wpd-text-field>
				<wpd-text-field
					name="last_name"
					label="<?php esc_attr_e( 'Last name', 'desktop-mode' ); ?>"
					autocomplete="off"
				></wpd-text-field>
				<wpd-text-field
					name="url"
					type="url"
					label="<?php esc_attr_e( 'Website', 'desktop-mode' ); ?>"
					placeholder="https://example.com"
					autocomplete="off"
					full-width
				></wpd-text-field>
				<?php /* The `role` and `locale` selects are declared here
				       so the components upgrade with the rest of the
				       form; the option list (which depends on the
				       viewer's `editable_roles` map and the install's
				       available languages) is appended JS-side in
				       `mountAddUserForm`. */ ?>
				<wpd-select
					name="role"
					label="<?php esc_attr_e( 'Role', 'desktop-mode' ); ?>"
				></wpd-select>
				<wpd-select
					name="locale"
					label="<?php esc_attr_e( 'Language', 'desktop-mode' ); ?>"
				></wpd-select>
				<wpd-text-field
					name="password"
					type="password"
					reveal
					label="<?php esc_attr_e( 'Password', 'desktop-mode' ); ?>"
					placeholder="<?php esc_attr_e( 'Auto-generated; click Generate to set one.', 'desktop-mode' ); ?>"
					autocomplete="new-password"
					full-width
				></wpd-text-field>
				<div class="desktop-mode-users__form-pwd-actions" full-width>
					<wpd-button
						variant="ghost"
						type="button"
						data-action="generate-password"
					>
						<span class="dashicons dashicons-randomize" aria-hidden="true"></span>
						<?php esc_html_e( 'Generate strong password', 'desktop-mode' ); ?>
					</wpd-button>
					<p class="desktop-mode-users__form-hint">
						<?php esc_html_e( 'Leave blank to let WordPress generate one and email it to the user.', 'desktop-mode' ); ?>
					</p>
				</div>
				<wpd-checkbox-label
					name="send_notification"
					label="<?php esc_attr_e( 'Send the new user an email about their account', 'desktop-mode' ); ?>"
					checked
					full-width
				></wpd-checkbox-label>
			</wpd-form>
		</wpd-tabpanel>
		<?php endif; ?>

		<wpd-tabpanel for="edit" class="desktop-mode-users__edit-panel">
			<?php
			/* The Profile tab is hard-wired to the viewer's own user
			 * id — the JS render shell sets the `user-id` attribute
			 * once the window is mounted. The component does the
			 * rest (lazy-loads data, paints sidebar + form +
			 * activity). Other-user editing happens in the dedicated
			 * `desktop-mode-user-edit` window via row-click. */
			?>
			<wpd-user-profile data-wpd-user-profile-self></wpd-user-profile>
		</wpd-tabpanel>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the native Users window's template HTML.
	 *
	 * @since 0.18.0
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'desktop_mode_users_window_template_html', $html );

	if ( function_exists( 'desktop_mode_kses_native_window_template' ) ) {
		echo desktop_mode_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		// Backwards-compatible fallback for the rare case the helper
		// isn't loaded yet (e.g. a plugin echoing the template
		// outside the framework's lifecycle).
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

/**
 * Register the native Users window on `init` (priority 20).
 *
 * @since 0.18.0
 */
function desktop_mode_users_window_register_window() {
	if ( ! desktop_mode_users_window_user_can_register() ) {
		return;
	}

	$viewer_id = (int) get_current_user_id();

	$window_args = array(
		'title'      => __( 'Users', 'desktop-mode' ),
		'icon'       => 'dashicons-admin-users',
		'template'   => 'desktop_mode_users_window_render_template',
		// Reuse the Posts bundle — same script + style handles. The
		// shared module branches on `cfg.mode` to render the Users
		// view.
		'script'     => 'desktop-mode-posts-window',
		'style'      => 'desktop-mode-posts-window',
		'width'      => 1100,
		'height'     => 720,
		'min_width'  => 720,
		'min_height' => 480,
		'placement'  => 'none',
		'config'     => array(
			'mode'             => 'users',
			'introSlug'        => 'users',
			'restRoot'         => esc_url_raw( rest_url() ),
			'restNonce'        => wp_create_nonce( 'wp_rest' ),
			'postsUrl'         => esc_url_raw( rest_url( 'wp/v2/users' ) ),
			'editPostUrlBase'  => esc_url_raw( admin_url( 'user-edit.php' ) ),
			'newPostUrl'       => esc_url_raw( admin_url( 'user-new.php' ) ),
			'usersUrl'         => esc_url_raw( rest_url( 'wp/v2/users' ) ),
			'currentUserId'    => $viewer_id,
			'defaultPerPage'   => 20,
			'queryArgs'        => desktop_mode_users_window_default_query_args(),
			'introSeen'        => desktop_mode_has_seen_intro( $viewer_id, 'users' ),
			'introUrl'         => esc_url_raw( rest_url( 'desktop-mode/v1/intros/seen' ) ),

			// Capability flags surfaced to the JS — UI hides actions
			// the viewer can't perform. Server still re-checks every
			// mutation, so a tampered flag here changes nothing
			// security-wise.
			'canEdit'          => current_user_can( 'edit_users' ),
			'canPromote'       => current_user_can( 'promote_users' ),
			'canCreate'        => current_user_can( 'create_users' ),
			'canDelete'        => is_multisite()
				? current_user_can( 'remove_users' )
				: current_user_can( 'delete_users' ),
			'isMultisite'      => is_multisite(),

			// Role list — `{ slug: name }` for every role the viewer
			// can assign. Empty when the viewer lacks `promote_users`.
			'assignableRoles'  => desktop_mode_users_window_role_label_map( $viewer_id ),
			// Full role catalog for the role-FILTER dropdown (which
			// shows EVERY role on the site, even those the viewer
			// can't assign — they can still filter by them).
			'allRoles'         => desktop_mode_users_window_all_roles_map(),

			// Available site locales for the Add User form's
			// language dropdown. `'site-default'` = empty string
			// (the user inherits the site's locale).
			'locales'          => desktop_mode_users_window_locales_map(),
			'siteLocale'       => (string) get_locale(),
			'defaultRole'      => (string) get_option( 'default_role', 'subscriber' ),
			'createUserUrl'    => esc_url_raw(
				rest_url( 'desktop-mode/v1/users' )
			),

			// REST mutation routes — the JS bundle reads these so a
			// rename or namespace move stays in one place.
			'bulkRoleUrl'      => esc_url_raw(
				rest_url( 'desktop-mode/v1/users/bulk-role' )
			),
			'bulkDeleteUrl'    => esc_url_raw(
				rest_url( 'desktop-mode/v1/users/bulk-delete' )
			),
			// Profile sub-tab — uses the same config blob to read
			// the user-edit field option lists, the insights
			// endpoint base, and the locale/role maps.
			'insightsUrlBase'  => esc_url_raw(
				rest_url( 'desktop-mode/v1/users/' )
			),
			'contactMethods'   => (array) apply_filters(
				'user_contactmethods',
				array(),
				null
			),
			'colorSchemes'     => function_exists( 'desktop_mode_user_edit_window_color_schemes' )
				? desktop_mode_user_edit_window_color_schemes()
				: array(),
			'sendResetUrlBase' => esc_url_raw(
				rest_url( 'desktop-mode/v1/users/' )
			),
		),
	);

	/**
	 * Filter the args used to register the native Users window.
	 *
	 * @since 0.18.0
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'desktop_mode_users_window_args', $window_args );

	$registered = desktop_mode_register_window( 'desktop-mode-users', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Native Users window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'desktop_mode_users_window_register_window', 20 );

/**
 * Default REST query args for the Users window.
 *
 * @since 0.18.0
 *
 * @return array
 */
function desktop_mode_users_window_default_query_args() {
	$args = array(
		// `_fields` whitelists the columns we render plus the four
		// REST fields registered below. Skipping the whitelist would
		// pull every meta + every embedded link the user controller
		// emits — heavy on every page change.
		'_fields'  =>
			'id,name,slug,email,url,description,roles,registered_date,avatar_urls,'
			. 'desktop_mode_user_stats,desktop_mode_last_login,desktop_mode_presence,'
			. 'desktop_mode_can_edit,desktop_mode_assignable_roles',
		// `who=authors` would hide subscribers — we want the full
		// list. `context=edit` is required because `email`, `roles`,
		// and `registered_date` are edit-context-only on
		// `/wp/v2/users`; in `view` they're omitted from the response
		// entirely (independent of `_fields`), which paints the
		// table as "No role" / empty email / empty registered date.
		// The window is already gated on `list_users`, the cap
		// `context=edit` requires, so this is safe.
		'context'  => 'edit',
		'per_page' => 20,
	);

	/**
	 * Filter the default outbound REST query args for the Users window.
	 *
	 * @since 0.18.0
	 *
	 * @param array $args Default args.
	 */
	return (array) apply_filters( 'desktop_mode_users_window_query_args', $args );
}

/**
 * Build the `{ slug: label }` map for every role on the install.
 *
 * Used by the Users window's role FILTER (vs. role-CHANGE menu —
 * see {@see desktop_mode_users_window_role_label_map()} for that).
 *
 * @since 0.18.0
 *
 * @return array<string,string>
 */
function desktop_mode_users_window_all_roles_map() {
	$roles = wp_roles();
	$map   = array();
	foreach ( (array) $roles->roles as $slug => $info ) {
		$map[ (string) $slug ] = isset( $info['name'] )
			? translate_user_role( (string) $info['name'] )
			: (string) $slug;
	}
	return $map;
}

/**
 * Build the `{ slug: label }` map for roles the viewer is allowed
 * to assign. Empty when the viewer lacks `promote_users`.
 *
 * @since 0.18.0
 *
 * @param int $viewer_id Viewer's user id.
 * @return array<string,string>
 */
function desktop_mode_users_window_role_label_map( $viewer_id ) {
	$slugs = desktop_mode_users_window_assignable_roles( (int) $viewer_id );
	if ( empty( $slugs ) ) {
		return array();
	}
	$all = desktop_mode_users_window_all_roles_map();
	$out = array();
	foreach ( $slugs as $slug ) {
		if ( isset( $all[ $slug ] ) ) {
			$out[ $slug ] = $all[ $slug ];
		}
	}
	return $out;
}

/**
 * Register the Users-window REST fields on the `user` resource.
 *
 * Fields:
 *
 *   - desktop_mode_user_stats         — `{ posts: int, pages: int, comments: int }`
 *   - desktop_mode_last_login         — UTC unix timestamp, or null when never
 *   - desktop_mode_presence           — 'online' | 'inactive' | 'offline'
 *   - desktop_mode_can_edit           — viewer can edit / promote this row
 *   - desktop_mode_assignable_roles   — role slugs the viewer can assign to this row
 *
 * Each field returns sensible empty defaults when the viewer lacks
 * the cap to see the value, so the JS never has to defend against
 * "field present but null".
 *
 * @since 0.18.0
 */
function desktop_mode_users_window_register_rest_fields() {
	register_rest_field(
		'user',
		'desktop_mode_user_stats',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 ) {
					return array(
						'posts'    => 0,
						'pages'    => 0,
						'comments' => 0,
					);
				}
				$posts = (int) count_user_posts( $id, 'post', true );
				$pages = post_type_exists( 'page' )
					? (int) count_user_posts( $id, 'page', true )
					: 0;
				$comments = (int) get_comments(
					array(
						'user_id' => $id,
						'count'   => true,
						'status'  => 'approve',
					)
				);
				return array(
					'posts'    => $posts,
					'pages'    => $pages,
					'comments' => $comments,
				);
			},
			'schema'       => array(
				'description' => __( 'Per-user content stats: published post / page / comment counts.', 'desktop-mode' ),
				'type'        => 'object',
				'context'     => array( 'view', 'edit', 'embed' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'user',
		'desktop_mode_last_login',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 ) {
					return null;
				}
				$ts = (int) get_user_meta( $id, DESKTOP_MODE_LAST_LOGIN_META_KEY, true );
				return $ts > 0 ? $ts : null;
			},
			'schema'       => array(
				'description' => __( 'UTC unix timestamp of this user’s last successful login, or null when never recorded.', 'desktop-mode' ),
				'type'        => array( 'integer', 'null' ),
				'context'     => array( 'view', 'edit', 'embed' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'user',
		'desktop_mode_presence',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 || ! function_exists( 'desktop_mode_presence_status_for_user' ) ) {
					return 'offline';
				}
				return (string) desktop_mode_presence_status_for_user( $id );
			},
			'schema'       => array(
				'description' => __( 'Live presence status: online / inactive / offline.', 'desktop-mode' ),
				'type'        => 'string',
				'enum'        => array( 'online', 'inactive', 'offline' ),
				'context'     => array( 'view', 'edit', 'embed' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'user',
		'desktop_mode_can_edit',
		array(
			'get_callback' => static function ( $row ) {
				$id     = isset( $row['id'] ) ? (int) $row['id'] : 0;
				$viewer = (int) get_current_user_id();
				if ( $id <= 0 || $viewer <= 0 ) {
					return false;
				}
				return (bool) user_can( $viewer, 'edit_user', $id );
			},
			'schema'       => array(
				'description' => __( 'Whether the requester can edit this user.', 'desktop-mode' ),
				'type'        => 'boolean',
				'context'     => array( 'view', 'edit', 'embed' ),
				'readonly'    => true,
			),
		)
	);

	register_rest_field(
		'user',
		'desktop_mode_assignable_roles',
		array(
			'get_callback' => static function ( $row ) {
				$id     = isset( $row['id'] ) ? (int) $row['id'] : 0;
				$viewer = (int) get_current_user_id();
				if ( $id <= 0 || $viewer <= 0 ) {
					return array();
				}
				return array_values( desktop_mode_users_window_assignable_roles( $viewer, $id ) );
			},
			'schema'       => array(
				'description' => __( 'Role slugs the requester can assign to this user.', 'desktop-mode' ),
				'type'        => 'array',
				'items'       => array( 'type' => 'string' ),
				'context'     => array( 'view', 'edit', 'embed' ),
				'readonly'    => true,
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_users_window_register_rest_fields' );

/**
 * Build the `[ slug => label ]` map for the Add User locale picker.
 *
 * Site default is keyed under `''` (empty string) so the form can
 * reflect "Site default — English (United States)" as the default
 * choice without forcing the user to know which slug to send.
 *
 * @since 0.18.0
 *
 * @return array<string,string>
 */
function desktop_mode_users_window_locales_map() {
	$out = array(
		'' => sprintf(
			// translators: %s is the site's current locale (e.g. "en_US").
			__( 'Site default — %s', 'desktop-mode' ),
			get_locale()
		),
	);
	if ( ! function_exists( 'get_available_languages' ) ) {
		require_once ABSPATH . 'wp-admin/includes/translation-install.php';
	}
	$languages = (array) get_available_languages();
	foreach ( $languages as $slug ) {
		$out[ (string) $slug ] = (string) $slug;
	}
	// Always offer en_US even if no .mo file is installed — core
	// always treats it as available.
	if ( ! isset( $out['en_US'] ) ) {
		$out['en_US'] = 'en_US';
	}
	return $out;
}
