<?php
/**
 * OpenStation — Native Users Window: registration, template, REST fields.
 *
 * Mirrors the structure of the Posts/Pages windows
 * (`includes/posts-window/`, `includes/pages-window/`) adapted for
 * the user collection — `/wp/v2/users` rather than `/wp/v2/posts`,
 * a Role/Email column set instead of taxonomies, and a much heavier
 * permission story (see `permissions.php` + `rest.php`).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the native Users window's template body.
 *
 * Same toolbar/table/pager structure as the Posts and Pages
 * windows. Reuses the `data-os-posts-*` selectors so the
 * shared JS bundle binds to the same hooks regardless of window
 * mode (the namespace is an internal contract — both windows use
 * the same template machinery).
 */
function openstation_users_window_render_template() {
	$can_create = current_user_can( 'create_users' );
	ob_start();
	?>
	<div class="desktop-mode-posts desktop-mode-users" data-os-posts-root>
		<os-tabs value="all" class="os-users__tabs" data-os-users-tabs>
			<os-tab value="all"><?php esc_html_e( 'All users', 'desktop-mode' ); ?></os-tab>
			<?php if ( $can_create ) : ?>
				<os-tab value="add-new"><?php esc_html_e( 'Add new', 'desktop-mode' ); ?></os-tab>
			<?php endif; ?>
			<?php
			/*
			 * Profile tab — always visible, always shows the
			 * CURRENT logged-in user. Other-user row clicks
			 * open a separate `desktop-mode-user-edit`
			 * window.
			 */
			?>
			<os-tab value="edit" data-os-users-edit-tab>
				<?php esc_html_e( 'Profile', 'desktop-mode' ); ?>
			</os-tab>
		</os-tabs>

		<os-tabpanel for="all" class="os-posts__panel">
			<header class="os-posts__toolbar" data-os-posts-toolbar>
				<div class="os-posts__toolbar-left">
					<os-segmented data-os-posts-status value=""></os-segmented>
					<os-text-field
						data-os-posts-search
						placeholder="<?php esc_attr_e( 'Search name, username, email…', 'desktop-mode' ); ?>"
					></os-text-field>
				</div>
				<div class="os-posts__toolbar-right" data-os-posts-bulk hidden>
					<span class="os-posts__count" data-os-posts-count></span>
					<span class="os-posts__bulk-actions" data-os-posts-bulk-actions></span>
				</div>
				<div class="os-posts__toolbar-trailing">
					<span class="os-posts__toolbar-extras" data-os-posts-toolbar-extras></span>
					<os-button variant="ghost" data-os-posts-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>">
						<span class="dashicons dashicons-update" aria-hidden="true"></span>
					</os-button>
					<os-button variant="primary" data-os-posts-new>
						<span class="dashicons dashicons-plus" aria-hidden="true"></span>
						<?php esc_html_e( 'Add new', 'desktop-mode' ); ?>
					</os-button>
				</div>
			</header>
			<div class="os-posts__body" data-os-posts-body>
				<os-table
					data-os-posts-table
					selectable="multi"
					sticky-header
					sticky-columns="1"
					hover
					striped
					bordered
					loading
				>
					<div slot="empty" class="os-posts__empty">
						<span class="dashicons dashicons-admin-users" aria-hidden="true"></span>
						<p><?php esc_html_e( 'No users found.', 'desktop-mode' ); ?></p>
						<p class="os-posts__empty-hint">
							<?php esc_html_e( 'Try a different search or change the role filter.', 'desktop-mode' ); ?>
						</p>
					</div>
				</os-table>
			</div>
			<footer class="os-posts__pager" data-os-posts-pager>
				<div class="os-posts__pager-meta">
					<span data-os-posts-page-indicator>—</span>
				</div>
				<div class="os-posts__pager-nav">
					<os-button variant="ghost" data-os-posts-prev disabled>
						<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>
						<?php esc_html_e( 'Previous', 'desktop-mode' ); ?>
					</os-button>
					<os-button variant="ghost" data-os-posts-next disabled>
						<?php esc_html_e( 'Next', 'desktop-mode' ); ?>
						<span class="dashicons dashicons-arrow-right-alt2" aria-hidden="true"></span>
					</os-button>
					<label class="os-posts__pager-perpage">
						<?php esc_html_e( 'Per page', 'desktop-mode' ); ?>
						<select data-os-posts-per-page>
							<option value="10">10</option>
							<option value="20" selected>20</option>
							<option value="50">50</option>
							<option value="100">100</option>
						</select>
					</label>
				</div>
			</footer>
		</os-tabpanel>

		<?php if ( $can_create ) : ?>
		<os-tabpanel for="add-new" class="os-users__add-panel">
			<os-form
				data-os-users-add-form
				submit-label="<?php esc_attr_e( 'Add user', 'desktop-mode' ); ?>"
				reset-label="<?php esc_attr_e( 'Reset', 'desktop-mode' ); ?>"
			>
				<div slot="header">
					<h2><?php esc_html_e( 'Add a new user', 'desktop-mode' ); ?></h2>
					<p class="os-users__form-lede">
						<?php esc_html_e( 'WordPress will create the account and (optionally) email the user a notification with a link to set their own password.', 'desktop-mode' ); ?>
					</p>
				</div>

				<os-text-field
					name="username"
					label="<?php esc_attr_e( 'Username (required)', 'desktop-mode' ); ?>"
					placeholder="<?php esc_attr_e( 'e.g. jane.doe', 'desktop-mode' ); ?>"
					autocomplete="off"
					required
				></os-text-field>
				<os-text-field
					name="email"
					type="email"
					label="<?php esc_attr_e( 'Email (required)', 'desktop-mode' ); ?>"
					placeholder="<?php esc_attr_e( 'jane@example.com', 'desktop-mode' ); ?>"
					autocomplete="off"
					required
				></os-text-field>
				<os-text-field
					name="first_name"
					label="<?php esc_attr_e( 'First name', 'desktop-mode' ); ?>"
					autocomplete="off"
				></os-text-field>
				<os-text-field
					name="last_name"
					label="<?php esc_attr_e( 'Last name', 'desktop-mode' ); ?>"
					autocomplete="off"
				></os-text-field>
				<os-text-field
					name="url"
					type="url"
					label="<?php esc_attr_e( 'Website', 'desktop-mode' ); ?>"
					placeholder="https://example.com"
					autocomplete="off"
					full-width
				></os-text-field>
				<?php
				/*
				 * The `role` and `locale` selects are declared here
				 * so the components upgrade with the rest of the
				 * form; the option list (which depends on the
				 * viewer's `editable_roles` map and the install's
				 * available languages) is appended JS-side in
				 * `mountAddUserForm`.
				 */
				?>
				<os-select
					name="role"
					label="<?php esc_attr_e( 'Role', 'desktop-mode' ); ?>"
				></os-select>
				<os-select
					name="locale"
					label="<?php esc_attr_e( 'Language', 'desktop-mode' ); ?>"
				></os-select>
				<os-text-field
					name="password"
					type="password"
					reveal
					label="<?php esc_attr_e( 'Password', 'desktop-mode' ); ?>"
					placeholder="<?php esc_attr_e( 'Auto-generated; click Generate to set one.', 'desktop-mode' ); ?>"
					autocomplete="new-password"
					full-width
				></os-text-field>
				<div class="os-users__form-pwd-actions" full-width>
					<os-button
						variant="ghost"
						type="button"
						data-action="generate-password"
					>
						<span class="dashicons dashicons-randomize" aria-hidden="true"></span>
						<?php esc_html_e( 'Generate strong password', 'desktop-mode' ); ?>
					</os-button>
					<p class="os-users__form-hint">
						<?php esc_html_e( 'Leave blank to let WordPress generate one and email it to the user.', 'desktop-mode' ); ?>
					</p>
				</div>
				<os-checkbox-label
					name="send_notification"
					label="<?php esc_attr_e( 'Send the new user an email about their account', 'desktop-mode' ); ?>"
					checked
					full-width
				></os-checkbox-label>
			</os-form>
		</os-tabpanel>
		<?php endif; ?>

		<os-tabpanel for="edit" class="os-users__edit-panel">
			<?php
			/*
			 * The Profile tab is hard-wired to the viewer's own user
			 * id — the JS render shell sets the `user-id` attribute
			 * once the window is mounted. The component does the
			 * rest (lazy-loads data, paints sidebar + form +
			 * activity). Other-user editing happens in the dedicated
			 * `desktop-mode-user-edit` window via row-click.
			 */
			?>
			<os-user-profile data-os-user-profile-self></os-user-profile>
		</os-tabpanel>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the native Users window's template HTML.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_users_window_template_html', $html );

	if ( function_exists( 'openstation_kses_native_window_template' ) ) {
		echo openstation_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		// Backwards-compatible fallback for the rare case the helper
		// isn't loaded yet (e.g. a plugin echoing the template
		// outside the framework's lifecycle).
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

/**
 * Register the native Users window on `init` (priority 20).
 */
function openstation_users_window_register_window() {
	if ( ! openstation_users_window_user_can_register() ) {
		return;
	}

	$viewer_id = (int) get_current_user_id();

	$window_args = array(
		'title'      => __( 'Users', 'desktop-mode' ),
		'icon'       => 'dashicons-admin-users',
		'template'   => 'openstation_users_window_render_template',
		// Reuse the Posts bundle — same script + style handles. The
		// shared module branches on `cfg.mode` to render the Users
		// view.
		'script'     => 'os-posts-window',
		'style'      => 'os-posts-window',
		'width'      => 1100,
		'height'     => 720,
		'min_width'  => 720,
		'min_height' => 480,
		'placement'  => 'none',
		'config'     => array(
			'mode'             => 'users',
			'restRoot'         => esc_url_raw( rest_url() ),
			'restNonce'        => wp_create_nonce( 'wp_rest' ),
			'postsUrl'         => esc_url_raw( rest_url( 'wp/v2/users' ) ),
			'editPostUrlBase'  => esc_url_raw( admin_url( 'user-edit.php' ) ),
			'newPostUrl'       => esc_url_raw( admin_url( 'user-new.php' ) ),
			'usersUrl'         => esc_url_raw( rest_url( 'wp/v2/users' ) ),
			'currentUserId'    => $viewer_id,
			'defaultPerPage'   => 20,
			'queryArgs'        => openstation_users_window_default_query_args(),

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
			'assignableRoles'  => openstation_users_window_role_label_map( $viewer_id ),
			// Full role catalog for the role-FILTER dropdown (which
			// shows EVERY role on the site, even those the viewer
			// can't assign — they can still filter by them).
			'allRoles'         => openstation_users_window_all_roles_map(),

			// Available site locales for the Add User form's
			// language dropdown. `'site-default'` = empty string
			// (the user inherits the site's locale).
			'locales'          => openstation_users_window_locales_map(),
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
			/** This filter is documented in wp-includes/user.php */
			// phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's filter; the window must offer the same contact fields profile.php does.
			'contactMethods'   => (array) apply_filters(
				'user_contactmethods',
				array(),
				null
			),
			// phpcs:enable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound
			'colorSchemes'     => function_exists( 'openstation_user_edit_window_color_schemes' )
				? openstation_user_edit_window_color_schemes()
				: array(),
			'sendResetUrlBase' => esc_url_raw(
				rest_url( 'desktop-mode/v1/users/' )
			),
		),
	);

	/**
	 * Filter the args used to register the native Users window.
	 *
	 * @param array $window_args Args passed to `openstation_register_window()`.
	 */
	$window_args = (array) apply_filters( 'openstation_users_window_args', $window_args );

	$registered = openstation_register_window( 'desktop-mode-users', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Native Users window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'openstation_users_window_register_window', 20 );

/**
 * Default REST query args for the Users window.
 *
 * @return array
 */
function openstation_users_window_default_query_args() {
	$args = array(
		// `_fields` whitelists the columns we render plus the four
		// REST fields registered below. Skipping the whitelist would
		// pull every meta + every embedded link the user controller
		// emits — heavy on every page change.
		'_fields'  =>
			'id,name,slug,email,url,description,roles,registered_date,avatar_urls,'
			. 'openstation_user_stats,openstation_last_login,openstation_presence,'
			. 'openstation_can_edit,openstation_assignable_roles',
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
	 * @param array $args Default args.
	 */
	return (array) apply_filters( 'openstation_users_window_query_args', $args );
}

/**
 * Build the `{ slug: label }` map for every role on the install.
 *
 * Used by the Users window's role FILTER (vs. role-CHANGE menu —
 * see {@see openstation_users_window_role_label_map()} for that).
 *
 * @return array<string,string>
 */
function openstation_users_window_all_roles_map() {
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
 * @param int $viewer_id Viewer's user id.
 * @return array<string,string>
 */
function openstation_users_window_role_label_map( $viewer_id ) {
	$slugs = openstation_users_window_assignable_roles( (int) $viewer_id );
	if ( empty( $slugs ) ) {
		return array();
	}
	$all = openstation_users_window_all_roles_map();
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
 *   - openstation_user_stats         — `{ posts: int, pages: int, comments: int }`
 *   - openstation_last_login         — UTC unix timestamp, or null when never
 *   - openstation_presence           — 'online' | 'inactive' | 'offline'
 *   - openstation_can_edit           — viewer can edit / promote this row
 *   - openstation_assignable_roles   — role slugs the viewer can assign to this row
 *
 * Each field returns sensible empty defaults when the viewer lacks
 * the cap to see the value, so the JS never has to defend against
 * "field present but null". The fields register on every REST request
 * (the `user` resource is partially public — published authors are
 * visible to anyone), so `openstation_last_login` and
 * `openstation_presence` gate on `list_users` (or self) inside their
 * callbacks; `openstation_user_stats` stays open because it only
 * counts published content.
 */
function openstation_users_window_register_rest_fields() {
	register_rest_field(
		'user',
		'openstation_user_stats',
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
		'openstation_last_login',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 ) {
					return null;
				}
				// Last-login time is sensitive. Only viewers who can see
				// the Users list — or the user themselves — get the
				// real value.
				if ( get_current_user_id() !== $id && ! current_user_can( 'list_users' ) ) {
					return null;
				}
				$ts = (int) get_user_meta( $id, OPENSTATION_LAST_LOGIN_META_KEY, true );
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
		'openstation_presence',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 || ! function_exists( 'openstation_presence_status_for_user' ) ) {
					return 'offline';
				}
				// Live presence is sensitive. Only viewers who can see
				// the Users list — or the user themselves — get the
				// real value.
				if ( get_current_user_id() !== $id && ! current_user_can( 'list_users' ) ) {
					return 'offline';
				}
				return (string) openstation_presence_status_for_user( $id );
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
		'openstation_can_edit',
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
		'openstation_assignable_roles',
		array(
			'get_callback' => static function ( $row ) {
				$id     = isset( $row['id'] ) ? (int) $row['id'] : 0;
				$viewer = (int) get_current_user_id();
				if ( $id <= 0 || $viewer <= 0 ) {
					return array();
				}
				return array_values( openstation_users_window_assignable_roles( $viewer, $id ) );
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
add_action( 'rest_api_init', 'openstation_users_window_register_rest_fields' );

/**
 * Build the `[ slug => label ]` map for the Add User locale picker.
 *
 * Site default is keyed under `''` (empty string) so the form can
 * reflect "Site default — English (United States)" as the default
 * choice without forcing the user to know which slug to send.
 *
 * @return array<string,string>
 */
function openstation_users_window_locales_map() {
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
