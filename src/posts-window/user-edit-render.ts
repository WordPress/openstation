/**
 * Native User Edit window — render entry point.
 *
 * Two tabs:
 *
 *   - **Profile** — every editable field from `wp-admin/user-edit.php`
 *     (first/last name, nickname, display name, email, website,
 *     biographical info, plugin-extensible contact methods,
 *     language, role assignment, new password). Saved via core's
 *     `PUT /wp/v2/users/<id>?context=edit`.
 *   - **Insights** — KPI tiles, profile completeness, recent
 *     posts + comments, active sessions, application-password
 *     summary, monthly-content sparkline. Read-only; fetched once
 *     on tab activation, refreshable.
 *
 * Per-instance state (the target user id) is read from the
 * shared store in `./user-edit-target` — the Users-table click
 * handler sets it before invoking `openById`.
 *
 * @public
 * @since 0.8.1
 */

import { __, _n, sprintf } from '../i18n';
import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import { applyAvatarSrc } from '../ui/util/avatar-resolve';
import { type PostsWindowConfig } from './rest';
import {
	createUserEditClient,
	type UserEditClient,
	type UserEditRecord,
	type UserInsightsPayload,
} from './user-edit-rest';
import '../ui/components/wpd-avatar/wpd-avatar';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-checkbox-label/wpd-checkbox-label';
import '../ui/components/wpd-form/wpd-form';
import '../ui/components/wpd-icon/wpd-icon';
import '../ui/components/wpd-select/wpd-select';
import '../ui/components/wpd-text-field/wpd-text-field';
import '../ui/components/wpd-textarea/wpd-textarea';

/**
 * Resolve a {@link UserEditClient} from whichever window happens to
 * host the user-edit surface right now.
 *
 * `<wpd-user-profile>` mounts in two contexts: the dedicated
 * `desktop-mode-user-edit` window AND the Users window's Profile
 * sub-tab (viewer's own profile). Both windows ship a compatible
 * config blob (`restRoot` / `restNonce` / `usersUrl` /
 * `insightsUrlBase`), so a fallback chain works without each
 * caller knowing which window it's running in.
 *
 * Prefer the user-edit window's own blob when present so the
 * spinner attribution lights up the right title bar.
 */
function resolveUserEditClient(): UserEditClient {
	const store = (
		window as unknown as {
			desktopModeWindowConfig?: Record< string, unknown >;
		}
	).desktopModeWindowConfig;
	if ( store?.[ 'desktop-mode-user-edit' ] ) {
		return createUserEditClient( 'desktop-mode-user-edit' );
	}
	if ( store?.[ 'desktop-mode-users' ] ) {
		return createUserEditClient( 'desktop-mode-users' );
	}
	// Last-resort — let the client itself throw with the canonical
	// error message so the call site doesn't have to invent one.
	return createUserEditClient( 'desktop-mode-user-edit' );
}
// `./user-edit-target` is read by the Users-window render shell
// (`users-render.ts:wireProfileSubTab`); this module exposes
// mount points only.

interface ShellToastApi {
	showToast?( opts: { message: string; duration?: number } ): () => void;
}

/**
 * Surface a transient notice at the desktop level using the
 * shell's `<wpd-toast-container>` (`wp.desktop.showToast`). The
 * shell handles stacking + auto-dismiss; we just hand it the
 * message and an optional duration override. `kind` is accepted
 * for source compatibility but the underlying toast doesn't yet
 * carry per-kind styling — leave the door open for it without
 * forcing every call site to change shape today.
 */
function notifyToast(
	body: string,
	kind: 'success' | 'error' | 'info' = 'info',
): void {
	void kind;
	const api = ( window as unknown as { wp?: { desktop?: ShellToastApi } } ).wp
		?.desktop;
	if ( api?.showToast ) {
		// 5s for success, 8s for error so the user has time to
		// read the failure reason. Pass through the default for
		// `info` (the shell's own duration).
		let duration: number | undefined;
		if ( kind === 'error' ) {
			duration = 8000;
		} else if ( kind === 'success' ) {
			duration = 5000;
		}
		api.showToast( { message: body, duration } );
		return;
	}
	// eslint-disable-next-line no-console
	console.info( '[user-edit-window]', body );
}

interface WpdFormElement extends HTMLElement {
	getValues(): Record< string, unknown >;
	setValues( patch: Record< string, unknown > ): void;
	setBusy( busy: boolean ): void;
	setError( message: string | null ): void;
	setFieldInvalid(
		name: string,
		invalid?: boolean,
		message?: string | null,
	): void;
	clearErrors(): void;
}

interface WpdSelectElement extends HTMLElement {
	items: ReadonlyArray< { value: string; label: string } >;
	value: string;
}

/**
 * Profile sub-tab in the Users window. The standalone-window
 * entry point was removed in 0.8.1 — see `mountProfileFormAt`,
 * `mountProfileAsideAt`, `mountProfileActivityAt` below for the
 * canonical mount surface.
 */

// ─── Profile tab ─────────────────────────────────────────────────────

/**
 * Public mount points used by the Users window's Profile tab.
 *
 * The Profile tab uses a sidebar layout — the **aside** carries
 * the at-a-glance summary (avatar, role, completeness bar,
 * compact stat tiles, sparkline), while the **main** column
 * carries the editable form and an activity feed below it.
 *
 * Each function loads fresh data on its first call per
 * `(host, userId)` pair — caller is responsible for not
 * re-mounting redundantly. Idempotency is cheap (memoised on
 * the host element) so re-firing on a different user is the
 * canonical "switch user" gesture.
 *
 * @since 0.8.1
 */
export async function mountProfileFormAt(
	host: HTMLElement,
	userId: number,
): Promise< UserEditRecord > {
	return loadAndMountProfile( host, userId );
}

/**
 * Mount the at-a-glance summary into the Profile tab's left
 * sidebar (`<aside>`). Replaces the nested-tabs design — the
 * summary is always visible while the user edits, no clicks
 * needed to see "is this profile healthy?".
 */
export async function mountProfileAsideAt(
	host: HTMLElement,
	userId: number,
	fresh: boolean,
): Promise< void > {
	return renderInsightsAside( host, userId, fresh );
}

/**
 * Mount the activity feed (Recent posts + Recent comments +
 * sparkline + sessions) below the form, full width. Cheaper
 * to re-fetch than the form, so this can refresh independently
 * after a save.
 */
export async function mountProfileActivityAt(
	host: HTMLElement,
	userId: number,
	fresh: boolean,
): Promise< void > {
	return renderInsightsActivity( host, userId, fresh );
}

async function loadAndMountProfile(
	host: HTMLElement,
	userId: number,
): Promise< UserEditRecord > {
	host.replaceChildren();

	const skeleton = document.createElement( 'div' );
	skeleton.className = 'desktop-mode-user-edit__skeleton';
	skeleton.style.cssText =
		'display:flex;align-items:center;justify-content:center;padding:48px;color:var(--desktop-mode-muted, #50575e);font-size:13px;';
	skeleton.textContent = __( 'Loading profile…' );
	host.appendChild( skeleton );

	let user: UserEditRecord;
	try {
		user = await resolveUserEditClient().fetchUser( userId );
	} catch ( err ) {
		host.replaceChildren();
		const msg = document.createElement( 'p' );
		msg.style.cssText =
			'padding:32px;color:#b32d2e;font-size:13px;text-align:center;';
		msg.textContent = sprintf(
			// translators: %s is an error message.
			__( 'Could not load profile (%s).' ),
			String( ( err as Error ).message ?? err ),
		);
		host.appendChild( msg );
		throw err;
	}

	host.replaceChildren();
	mountProfileForm( host, user, userId );
	return user;
}

/**
 * Merged config bag for the user-edit form.
 *
 * `<wpd-user-profile>` mounts in either the user-edit window or
 * the Users window's Profile sub-tab. Sibling-window configs
 * (Posts, Pages, …) carry `restRoot` / `restNonce` but lack
 * profile-specific keys (`allRoles`, `assignableRoles`,
 * `colorSchemes`, `locales`, `contactMethods`, `canPromote`).
 * Merge user-edit on top of users on top of the resolved client
 * config so every key has a backstop without depending on which
 * window the component happens to live in.
 */
function resolveProfileConfig(): Record< string, unknown > {
	const store = ( window as unknown as {
		desktopModeWindowConfig?: Record<
			string,
			Record< string, unknown >
		>;
	} ).desktopModeWindowConfig;
	const userEdit = store?.[ 'desktop-mode-user-edit' ];
	const users = store?.[ 'desktop-mode-users' ];
	return {
		...( users ?? {} ),
		...( userEdit ?? {} ),
	};
}

function mountProfileForm(
	host: HTMLElement,
	user: UserEditRecord,
	userId: number,
): void {
	const cfg = resolveProfileConfig() as unknown as PostsWindowConfig & {
		currentUserId?: number;
	};
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-user-edit__profile';

	const form = document.createElement( 'wpd-form' ) as WpdFormElement;
	form.setAttribute( 'submit-label', __( 'Save changes' ) );
	form.setAttribute( 'reset-label', __( 'Revert' ) );
	form.setAttribute( 'columns', 'auto' );

	// Header — avatar + display name + role chips. Kept in a
	// dedicated `profileHeader` reference so the post-save refresh
	// can swap it in place via `replaceWith` rather than wiping the
	// slot's whole subtree.
	const header = document.createElement( 'div' );
	header.setAttribute( 'slot', 'header' );
	let profileHeader = buildProfileHeader( user );
	header.appendChild( profileHeader );
	form.appendChild( header );

	// — Identity —
	form.appendChild( textField( 'username', __( 'Username' ), user.username, {
		readonly: true,
	} ) );
	form.appendChild( textField( 'first_name', __( 'First name' ), user.first_name ) );
	form.appendChild( textField( 'last_name', __( 'Last name' ), user.last_name ) );
	form.appendChild(
		textField( 'nickname', __( 'Nickname' ), ( user.nickname as string ) ?? '', {
			required: true,
			fullWidth: false,
		} ),
	);

	// Display name — populated with WP-style candidate combinations.
	const displaySelect = document.createElement( 'wpd-select' ) as WpdSelectElement;
	displaySelect.setAttribute( 'name', 'name' );
	displaySelect.setAttribute( 'label', __( 'Display name publicly as' ) );
	displaySelect.items = displayNameCandidates( user );
	displaySelect.value = user.name;
	form.appendChild( displaySelect );

	// — Contact —
	form.appendChild(
		textField( 'email', __( 'Email (required)' ), user.email, {
			required: true,
			type: 'email',
		} ),
	);
	form.appendChild( textField( 'url', __( 'Website' ), user.url, { type: 'url' } ) );

	// Plugin-extensible contact methods (`user_contactmethods`).
	const contactMethods =
		( cfg as unknown as { contactMethods?: Record< string, string > } )
			.contactMethods ?? {};
	for ( const [ slug, label ] of Object.entries( contactMethods ) ) {
		const value =
			typeof user.meta === 'object' && user.meta !== null
				? String(
					( user.meta as Record< string, unknown > )[ slug ] ?? '',
				)
				: '';
		form.appendChild(
			textField( `meta.${ slug }`, label, value, {
				name: slug,
				dataset: { meta: slug },
			} ),
		);
	}

	// — Bio —
	const bio = document.createElement( 'wpd-textarea' );
	bio.setAttribute( 'name', 'description' );
	bio.setAttribute( 'label', __( 'Biographical info' ) );
	bio.setAttribute(
		'placeholder',
		__( 'Share a little about yourself — visible on author archives.' ),
	);
	bio.setAttribute( 'rows', '4' );
	bio.setAttribute( 'full-width', '' );
	( bio as HTMLElement & { value?: string } ).value = user.description;
	bio.setAttribute( 'value', user.description );
	form.appendChild( bio );

	// — Account —
	const localeSelect = document.createElement( 'wpd-select' ) as WpdSelectElement;
	localeSelect.setAttribute( 'name', 'locale' );
	localeSelect.setAttribute( 'label', __( 'Language' ) );
	const locales =
		( cfg as unknown as { locales?: Record< string, string > } ).locales ??
		{ '': __( 'Site default' ) };
	localeSelect.items = Object.entries( locales ).map( ( [ value, label ] ) => ( {
		value,
		label,
	} ) );
	localeSelect.value = String( user.locale ?? '' );
	form.appendChild( localeSelect );

	// Role select — only hidden when the viewer is editing
	// themselves (admins demoting themselves is a footgun; core's
	// profile.php hides it for the same reason). Capability gating
	// happens server-side in `update_item_permissions_check`; a
	// viewer without `promote_users` who tries to assign a role
	// will get a 403 they can act on. We intentionally do NOT gate
	// the dropdown on `cfg.canPromote` because a strict gate hides
	// the control for admins in any config that happens to omit
	// the flag (older registrations, payloads that lost it through
	// a filter). Always-render-for-non-self matches the pre-0.18
	// behavior and is what plugin authors expect.
	const isSelfEdit = userId === ( cfg.currentUserId ?? 0 );
	// Prefer `assignableRoles` (the viewer's `editable_roles`) when
	// the server sent it — surfacing only roles the viewer can
	// actually assign closes the "pick a role, hit save, get
	// rejected" loop. Fall back to `allRoles` so the dropdown still
	// has options for configs registered before the assignableRoles
	// field landed. `resolveProfileConfig()` above already merges
	// the user-edit window's blob underneath the live `cfg`, so
	// these keys are present even if the active window id has
	// drifted to a sibling that doesn't carry them.
	const roleMap: Record< string, string > = ( () => {
		const assignable = ( cfg as unknown as {
			assignableRoles?: Record< string, string >;
		} ).assignableRoles;
		if ( assignable && Object.keys( assignable ).length > 0 ) {
			return assignable;
		}
		return (
			( cfg as unknown as { allRoles?: Record< string, string > } )
				.allRoles ?? {}
		);
	} )();
	if ( ! isSelfEdit ) {
		const roleSelect = document.createElement( 'wpd-select' ) as WpdSelectElement;
		roleSelect.setAttribute( 'name', 'roles[0]' );
		roleSelect.setAttribute( 'label', __( 'Role' ) );
		roleSelect.items = Object.entries( roleMap ).map( ( [ value, label ] ) => ( {
			value,
			label,
		} ) );
		const currentRole = Array.isArray( user.roles ) ? user.roles[ 0 ] ?? '' : '';
		roleSelect.value = currentRole;
		form.appendChild( roleSelect );
	}

	// — Personal Options — matches the `Personal Options` section
	// of `wp-admin/user-edit.php`. Core renders these for ANY user
	// the viewer can edit, not just self: the visual editor toggle,
	// syntax-highlighting toggle, admin-bar-on-front toggle, comment
	// keyboard shortcuts, AND the admin colour scheme are all stored
	// as per-user meta. An admin editing user N legitimately sets
	// N's own preferences, so we surface the same controls in the
	// native window. Earlier this section was gated on `isSelfEdit`,
	// which dropped the colour-scheme picker (and the rest) for
	// every "edit someone else" flow.
	{
		const optsHeading = document.createElement( 'h3' );
		optsHeading.setAttribute( 'full-width', '' );
		optsHeading.textContent = __( 'Personal options' );
		optsHeading.style.cssText =
			'margin:18px 0 4px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);';
		form.appendChild( optsHeading );

		const meta = ( user.meta ?? {} ) as Record< string, unknown >;
		const richEditing = String( meta.rich_editing ?? '' ) !== 'false';
		const syntaxHighlighting = String( meta.syntax_highlighting ?? '' ) !== 'false';
		const commentShortcuts = String( meta.comment_shortcuts ?? 'false' ) === 'true';
		const adminBarFront = String( meta.show_admin_bar_front ?? 'true' ) !== 'false';

		form.appendChild(
			checkboxField(
				'meta.rich_editing',
				__( 'Disable the visual editor when writing' ),
				! richEditing,
				{ trueValue: 'false', falseValue: 'true', fullWidth: true },
			),
		);
		form.appendChild(
			checkboxField(
				'meta.syntax_highlighting',
				__( 'Disable syntax highlighting when editing code' ),
				! syntaxHighlighting,
				{ trueValue: 'false', falseValue: 'true', fullWidth: true },
			),
		);
		form.appendChild(
			checkboxField(
				'meta.comment_shortcuts',
				__( 'Enable keyboard shortcuts for comment moderation' ),
				commentShortcuts,
				{ trueValue: 'true', falseValue: 'false', fullWidth: true },
			),
		);
		form.appendChild(
			checkboxField(
				'meta.show_admin_bar_front',
				__( 'Show toolbar when viewing site' ),
				adminBarFront,
				{ trueValue: 'true', falseValue: 'false', fullWidth: true },
			),
		);

		// Admin colour scheme — radio grid with mini-swatch previews
		// matching WP core's profile.php picker. Each option shows
		// the scheme name + 3 swatches (its colour tuple). Selected
		// scheme is reflected on a hidden `meta.admin_color` field
		// the form auto-collects, so the wpd-form pipeline picks it
		// up without special-casing. On self-edit, picking a tile
		// also live-previews the scheme in the shell (matches
		// `wp-admin/js/user-profile.js`'s `#color-picker .color-option`
		// handler).
		const colorSchemes =
			( cfg as unknown as {
				colorSchemes?: Record<
					string,
					{
						name: string;
						url?: string;
						colors: string[];
						icon_colors?: Record< string, string >;
					}
				>;
			} ).colorSchemes ?? {};
		const currentScheme = String( meta.admin_color ?? 'fresh' );
		form.appendChild(
			buildAdminColorPicker( colorSchemes, currentScheme, {
				livePreview: isSelfEdit,
			} ),
		);
	}

	// — New password —
	const pwdHeading = document.createElement( 'h3' );
	pwdHeading.setAttribute( 'full-width', '' );
	pwdHeading.textContent = __( 'Account management' );
	pwdHeading.style.cssText =
		'margin:18px 0 4px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);';
	form.appendChild( pwdHeading );

	const pwdRow = document.createElement( 'div' );
	pwdRow.setAttribute( 'full-width', '' );
	pwdRow.style.cssText =
		'display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;';
	const pwd = document.createElement( 'wpd-text-field' ) as HTMLElement & {
		value?: string;
	};
	pwd.setAttribute( 'name', 'password' );
	pwd.setAttribute( 'type', 'password' );
	pwd.setAttribute( 'reveal', '' );
	pwd.setAttribute( 'label', __( 'New password' ) );
	pwd.setAttribute(
		'placeholder',
		__( 'Leave blank to keep the current password.' ),
	);
	pwd.setAttribute( 'autocomplete', 'new-password' );
	pwd.style.flex = '1 1 280px';
	pwdRow.appendChild( pwd );

	const genBtn = document.createElement( 'wpd-button' );
	genBtn.setAttribute( 'variant', 'ghost' );
	genBtn.setAttribute( 'type', 'button' );
	const genIcon = document.createElement( 'wpd-icon' );
	genIcon.setAttribute( 'name', 'randomize' );
	genIcon.setAttribute( 'size', '14' );
	genBtn.appendChild( genIcon );
	genBtn.appendChild( document.createTextNode( __( 'Generate strong' ) ) );
	genBtn.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		const next = generateStrongPassword( 18 );
		pwd.value = next;
		pwd.setAttribute( 'value', next );
		const pwdConfirmEl = form.querySelector(
			'wpd-text-field[name="password_confirm"]',
		) as ( HTMLElement & { value?: string } ) | null;
		if ( pwdConfirmEl ) {
			pwdConfirmEl.value = next;
			pwdConfirmEl.setAttribute( 'value', next );
		}
		void navigator.clipboard?.writeText( next ).catch( () => {} );
		notifyToast( __( 'Password generated and copied to clipboard.' ), 'success' );
	} );
	pwdRow.appendChild( genBtn );
	form.appendChild( pwdRow );

	// Confirm-password field — matches WP core's pass1/pass2 pair.
	// Non-required (the form treats blank password as "no change");
	// validated against `password` at submit time.
	const pwdConfirm = document.createElement( 'wpd-text-field' ) as HTMLElement & {
		value?: string;
	};
	pwdConfirm.setAttribute( 'name', 'password_confirm' );
	pwdConfirm.setAttribute( 'type', 'password' );
	pwdConfirm.setAttribute( 'reveal', '' );
	pwdConfirm.setAttribute( 'label', __( 'Confirm new password' ) );
	pwdConfirm.setAttribute(
		'placeholder',
		__( 'Type the new password again.' ),
	);
	pwdConfirm.setAttribute( 'autocomplete', 'new-password' );
	pwdConfirm.setAttribute( 'full-width', '' );
	form.appendChild( pwdConfirm );

	// Sessions: Log out everywhere(/else) button.
	form.appendChild(
		buildSessionsRow( userId, isSelfEdit ),
	);

	// Application Passwords list + new-password creator.
	form.appendChild( buildAppPasswordsRow( userId ) );

	// Multisite super-admin grant — only shown when the viewer is
	// a super-admin AND editing someone else (and on a multisite).
	if (
		! isSelfEdit &&
		( cfg as unknown as { isMultisite?: boolean } ).isMultisite &&
		( user.meta as Record< string, unknown > | undefined )?.is_super_admin !==
			undefined
	) {
		form.appendChild(
			checkboxField(
				'meta.is_super_admin',
				__( 'Grant super admin privileges for the network' ),
				Boolean(
					( user.meta as Record< string, unknown > | undefined )
						?.is_super_admin,
				),
				{ trueValue: 'true', falseValue: 'false', fullWidth: true },
			),
		);
	}

	// Submit handler.
	let pending = false;
	form.addEventListener( 'wpd-form-submit', ( e ) => {
		const detail = ( e as CustomEvent< { values: Record< string, unknown > } > )
			.detail;
		void onSubmit( detail.values );
	} );

	const onSubmit = async (
		values: Record< string, unknown >,
	): Promise< void > => {
		if ( pending ) {
			return;
		}
		pending = true;
		form.setBusy( true );
		form.clearErrors();

		const patch: Record< string, unknown > = {
			first_name: values.first_name,
			last_name: values.last_name,
			nickname: values.nickname,
			name: values.name,
			email: values.email,
			url: values.url,
			description: values.description,
			locale: values.locale ?? '',
		};
		if ( typeof values.password === 'string' && values.password !== '' ) {
			// Password confirm match — WP-core parity.
			const confirm = String( values.password_confirm ?? '' );
			if ( confirm !== values.password ) {
				form.setError( __( 'The two password fields do not match.' ) );
				form.setFieldInvalid( 'password_confirm' );
				pending = false;
				form.setBusy( false );
				return;
			}
			patch.password = values.password;
		}
		// Role on the role-select arrives keyed as `roles[0]` because
		// core's REST takes an array; coerce to a single-element array.
		if ( typeof values[ 'roles[0]' ] === 'string' && values[ 'roles[0]' ] ) {
			patch.roles = [ values[ 'roles[0]' ] ];
		}
		// Flatten every `meta.foo` field into a `meta` object —
		// covers plugin contact methods AND the personal-options
		// keys (rich_editing, syntax_highlighting, admin_color,
		// comment_shortcuts, show_admin_bar_front).
		//
		// `wpd-form`'s value harvest reads `field.checked` (boolean)
		// for `<wpd-checkbox-label>`, but core stores the matching
		// user-meta keys as STRING `'true'` / `'false'`. Sending a
		// boolean trips the REST schema check (`meta.rich_editing
		// is not of type string`). The `checkboxField` helper already
		// keeps the right `trueValue` / `falseValue` string on the
		// element's `value` attribute, so when the harvested value
		// is a boolean we look the element up and use its current
		// `value` attribute instead. Falls back to `String(v)` for
		// any element we can't find (shouldn't happen, but keeps the
		// patch shape sound if a name gets typo'd).
		const meta: Record< string, unknown > = {};
		for ( const [ k, v ] of Object.entries( values ) ) {
			if ( ! k.startsWith( 'meta.' ) ) {
				continue;
			}
			let resolved: unknown = v;
			if ( typeof v === 'boolean' ) {
				const field = form.querySelector( `[name="${ k }"]` );
				const valueAttr = field?.getAttribute( 'value' );
				resolved = valueAttr ?? String( v );
			}
			meta[ k.slice( 5 ) ] = resolved;
		}
		if ( Object.keys( meta ).length > 0 ) {
			patch.meta = meta;
		}

		const result = await resolveUserEditClient().saveUser( userId, patch );

		pending = false;
		form.setBusy( false );

		if ( ! result.ok ) {
			const summary =
				result.message ?? mapErrorCode( result.error ) ?? __( 'Save failed.' );
			form.setError( summary );
			notifyToast( summary, 'error' );
			if ( result.fieldErrors ) {
				for ( const field of Object.keys( result.fieldErrors ) ) {
					form.setFieldInvalid( field );
				}
			}
			// eslint-disable-next-line no-console
			console.warn( '[user-edit] save failed', {
				code: result.error,
				message: result.message,
			} );
			return;
		}

		notifyToast( __( 'Profile saved.' ), 'success' );

		// Broadcast so the Users window (and any other live listener)
		// can refresh its row for this user without an F5. Mirrors the
		// `desktop-mode.post.changed` pattern used by Posts.
		const broadcastApi = (
			window as unknown as {
				wp?: {
					desktop?: {
						broadcast?: (
							channel: string,
							payload: unknown,
						) => void;
					};
				};
			}
		).wp?.desktop;
		broadcastApi?.broadcast?.( 'desktop-mode.user.changed', {
			source: 'user-edit-window',
			action: 'updated',
			ids: [ userId ],
		} );
		// Clear password fields after a successful change so a Save
		// after another edit doesn't accidentally re-submit them.
		pwd.value = '';
		pwd.setAttribute( 'value', '' );
		pwdConfirm.value = '';
		pwdConfirm.setAttribute( 'value', '' );

		// Reflect the server's view of the saved record so the
		// header chips (display name, role) and the sidebar insights
		// repaint with the new values. Without this, a successful
		// role change leaves the chip text stuck on the pre-save
		// role and reads as "the update didn't take" — even though
		// the database row is now correct.
		if ( result.user ) {
			Object.assign( user, result.user );
			// Swap just the profile-header div in place — keeps the
			// save banner (its sibling) untouched.
			const next = buildProfileHeader( user );
			profileHeader.replaceWith( next );
			profileHeader = next;
			const aside = host.ownerDocument?.querySelector< HTMLElement >(
				'[data-wpd-user-profile-aside]',
			);
			if ( aside ) {
				void mountProfileAsideAt( aside, userId, true );
			}
		}
	};

	wrap.appendChild( form );
	host.appendChild( wrap );
}

// ─── Profile header ──────────────────────────────────────────────────

function buildProfileHeader( user: UserEditRecord ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-user-edit__header';
	wrap.style.cssText =
		'display:flex;align-items:center;gap:16px;margin:0 0 12px;';

	// `<wpd-avatar>` with the shared Gravatar probe — initials when
	// the user has no registered avatar, real image otherwise. The
	// 3D hover lift gives the profile header a touch of physicality.
	const avatar = document.createElement( 'wpd-avatar' );
	avatar.setAttribute( 'size', '64' );
	if ( user.name || user.username ) {
		avatar.setAttribute( 'name', user.name || user.username || '' );
	}
	if ( user.id > 0 ) {
		avatar.setAttribute( 'user-id', String( user.id ) );
	}
	const avatars = user.avatar_urls ?? {};
	const rawAvatar = avatars[ '96' ] ?? avatars[ '48' ] ?? '';
	if ( rawAvatar ) {
		applyAvatarSrc( avatar, rawAvatar );
	}
	wrap.appendChild( avatar );

	const text = document.createElement( 'div' );
	text.style.cssText = 'min-width:0;display:flex;flex-direction:column;gap:4px;';

	const name = document.createElement( 'div' );
	name.style.cssText = 'font-size:18px;font-weight:600;letter-spacing:-0.01em;';
	name.textContent = user.name || user.username || `#${ user.id }`;
	text.appendChild( name );

	const sub = document.createElement( 'div' );
	sub.style.cssText =
		'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--desktop-mode-muted, #50575e);flex-wrap:wrap;';
	const handle = document.createElement( 'span' );
	handle.textContent = `@${ user.username }`;
	sub.appendChild( handle );

	const dot = document.createElement( 'span' );
	dot.textContent = '·';
	dot.setAttribute( 'aria-hidden', 'true' );
	sub.appendChild( dot );

	const roleStr = Array.isArray( user.roles )
		? user.roles.join( ', ' )
		: '';
	const roleSpan = document.createElement( 'span' );
	roleSpan.textContent = roleStr || __( 'No role' );
	sub.appendChild( roleSpan );
	text.appendChild( sub );
	wrap.appendChild( text );

	return wrap;
}

// ─── Insights tab ────────────────────────────────────────────────────

async function loadInsightsInto(
	host: HTMLElement,
	userId: number,
	fresh: boolean,
): Promise< UserInsightsPayload | null > {
	host.replaceChildren();
	const skeleton = document.createElement( 'div' );
	skeleton.style.cssText =
		'display:flex;align-items:center;justify-content:center;padding:32px;color:var(--desktop-mode-muted, #50575e);font-size:13px;';
	skeleton.textContent = __( 'Loading insights…' );
	host.appendChild( skeleton );
	try {
		return await resolveUserEditClient().fetchInsights( userId, { fresh } );
	} catch ( err ) {
		host.replaceChildren();
		const msg = document.createElement( 'p' );
		msg.style.cssText =
			'padding:24px;color:#b32d2e;font-size:13px;text-align:center;';
		msg.textContent = sprintf(
			// translators: %s is an error message.
			__( 'Could not load insights (%s).' ),
			String( ( err as Error ).message ?? err ),
		);
		host.appendChild( msg );
		return null;
	}
}

/**
 * Compact summary card for the Profile sidebar (`<aside>`).
 * Avatar + name + role chip + completeness bar + 4 small stat
 * tiles in a 2x2 grid + a 12-month posts sparkline. The
 * highest-signal-per-pixel slice of the insights payload.
 */
async function renderInsightsAside(
	host: HTMLElement,
	userId: number,
	fresh: boolean,
): Promise< void > {
	const data = await loadInsightsInto( host, userId, fresh );
	if ( ! data ) {
		return;
	}
	host.replaceChildren();
	host.appendChild( buildAsideSummary( data ) );
	host.appendChild( buildAsideStatGrid( data ) );
	host.appendChild( buildContentSparkline( data ) );
}

/**
 * Full-width activity feed for below the Profile form.
 * Recent posts + recent comments + sessions/app-passwords. Lower
 * priority than the form itself — lives below the fold so users
 * editing fields aren't distracted by it.
 */
async function renderInsightsActivity(
	host: HTMLElement,
	userId: number,
	fresh: boolean,
): Promise< void > {
	const data = await loadInsightsInto( host, userId, fresh );
	if ( ! data ) {
		return;
	}
	host.replaceChildren();
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-user-edit__activity';
	const heading = document.createElement( 'h3' );
	heading.textContent = __( 'Recent activity' );
	heading.style.cssText =
		'margin:24px 0 12px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);';
	wrap.appendChild( heading );
	wrap.appendChild( buildRecentLists( data ) );
	wrap.appendChild( buildSecurityPanel( data ) );
	host.appendChild( wrap );
}

/** Aside top — avatar + name + role chip + completeness bar. */
function buildAsideSummary( data: UserInsightsPayload ): HTMLElement {
	const card = document.createElement( 'div' );
	card.style.cssText = [
		'display:flex',
		'flex-direction:column',
		'align-items:center',
		'text-align:center',
		'gap:6px',
		'padding:16px',
		'border:1px solid var(--desktop-mode-border, #dcdcde)',
		'border-radius:12px',
		'background:var(--wp-admin-theme-bg-elevated, #f6f7f7)',
	].join( ';' );

	const avatar = document.createElement( 'img' );
	avatar.src = data.avatarUrl;
	avatar.alt = '';
	avatar.style.cssText =
		'width:72px;height:72px;border-radius:50%;flex-shrink:0;';
	card.appendChild( avatar );

	const name = document.createElement( 'div' );
	name.style.cssText = 'font-size:15px;font-weight:600;letter-spacing:-0.01em;';
	name.textContent = data.displayName || `#${ data.userId }`;
	card.appendChild( name );

	const roles = document.createElement( 'div' );
	roles.style.cssText =
		'display:flex;flex-wrap:wrap;gap:4px;justify-content:center;';
	for ( const role of data.roles ) {
		const chip = document.createElement( 'span' );
		chip.textContent = role;
		chip.style.cssText = [
			'display:inline-flex',
			'padding:2px 8px',
			'border-radius:10px',
			'background:rgba(34,113,177,0.10)',
			'color:#0a4b78',
			'font-size:11px',
			'font-weight:600',
		].join( ';' );
		roles.appendChild( chip );
	}
	if ( data.roles.length === 0 ) {
		const noRole = document.createElement( 'span' );
		noRole.textContent = __( 'No role' );
		noRole.style.cssText =
			'font-size:11px;color:var(--desktop-mode-muted, #8c8f94);';
		roles.appendChild( noRole );
	}
	card.appendChild( roles );

	// Completeness bar at the bottom of the summary card.
	const completeness = data.profileCompleteness;
	if ( completeness && completeness.total > 0 ) {
		const cwrap = document.createElement( 'div' );
		cwrap.style.cssText =
			'display:flex;flex-direction:column;gap:4px;width:100%;margin-top:6px;';
		const top = document.createElement( 'div' );
		top.style.cssText =
			'display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--desktop-mode-muted, #50575e);';
		const lbl = document.createElement( 'span' );
		lbl.textContent = __( 'Profile completeness' );
		const pct = document.createElement( 'span' );
		pct.style.cssText = 'font-variant-numeric:tabular-nums;font-weight:600;';
		pct.textContent = `${ completeness.percent }%`;
		top.appendChild( lbl );
		top.appendChild( pct );
		cwrap.appendChild( top );
		const track = document.createElement( 'div' );
		track.style.cssText = [
			'height:4px',
			'border-radius:999px',
			'background:rgba(0,0,0,0.06)',
			'position:relative',
			'overflow:hidden',
		].join( ';' );
		const bar = document.createElement( 'div' );
		bar.style.cssText = [
			'position:absolute',
			'inset:0',
			`width:${ completeness.percent }%`,
			'background:var(--wp-admin-theme-color, #2271b1)',
			'transition:width 360ms ease',
		].join( ';' );
		track.appendChild( bar );
		cwrap.appendChild( track );
		card.appendChild( cwrap );
	}

	return card;
}

/** Aside KPI tiles — 2x2 grid of compact stat cards. */
function buildAsideStatGrid( data: UserInsightsPayload ): HTMLElement {
	const grid = document.createElement( 'div' );
	grid.style.cssText = [
		'display:grid',
		'grid-template-columns:1fr 1fr',
		'gap:8px',
		'margin-top:12px',
	].join( ';' );

	const tile = ( label: string, value: string, sub?: string ): HTMLElement => {
		const card = document.createElement( 'div' );
		card.style.cssText = [
			'border:1px solid var(--desktop-mode-border, #dcdcde)',
			'border-radius:8px',
			'padding:8px 10px',
			'display:flex',
			'flex-direction:column',
			'gap:1px',
			'min-width:0',
		].join( ';' );
		const lbl = document.createElement( 'div' );
		lbl.style.cssText =
			'font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);font-weight:600;';
		lbl.textContent = label;
		const val = document.createElement( 'div' );
		val.style.cssText =
			'font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;';
		val.textContent = value;
		card.appendChild( lbl );
		card.appendChild( val );
		if ( sub ) {
			const subEl = document.createElement( 'div' );
			subEl.style.cssText =
				'font-size:10px;color:var(--desktop-mode-muted, #8c8f94);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			subEl.title = sub;
			subEl.textContent = sub;
			card.appendChild( subEl );
		}
		return card;
	};

	const stats = data.stats;
	let postsSub: string | undefined;
	if ( stats.pages > 0 ) {
		postsSub = sprintf(
			// translators: %d is a count of pages.
			_n( '+ %d page', '+ %d pages', stats.pages ),
			stats.pages,
		);
	}
	grid.appendChild(
		tile( __( 'Posts' ), String( stats.posts ), postsSub ),
	);
	let commentsSub: string | undefined;
	if ( stats.commentsReceived > 0 ) {
		commentsSub = sprintf(
			// translators: %d is a count of received comments.
			__( '%d received' ),
			stats.commentsReceived,
		);
	}
	grid.appendChild(
		tile( __( 'Comments' ), String( stats.commentsAuthored ), commentsSub ),
	);
	grid.appendChild(
		tile(
			__( 'Last login' ),
			stats.lastLoginAt ? relativeTime( stats.lastLoginAt ) : __( 'Never' ),
			stats.lastLoginAt
				? new Date( stats.lastLoginAt * 1000 ).toLocaleDateString()
				: undefined,
		),
	);
	let memberValue = '—';
	if ( stats.daysSinceRegistration !== null ) {
		memberValue = sprintf(
			// translators: %d is a number of days.
			__( '%d days' ),
			stats.daysSinceRegistration,
		);
	}
	grid.appendChild(
		tile(
			__( 'Member' ),
			memberValue,
			stats.registeredAt
				? new Date( stats.registeredAt * 1000 ).toLocaleDateString()
				: undefined,
		),
	);
	return grid;
}

function buildContentSparkline( data: UserInsightsPayload ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.style.cssText = [
		'border:1px solid var(--desktop-mode-border, #dcdcde)',
		'border-radius:10px',
		'padding:14px 16px',
		'margin:0 0 22px',
	].join( ';' );

	const head = document.createElement( 'div' );
	head.style.cssText =
		'display:flex;justify-content:space-between;align-items:baseline;margin:0 0 8px;';
	const title = document.createElement( 'div' );
	title.style.cssText = 'font-size:13px;font-weight:600;';
	title.textContent = __( 'Posts published — last 12 months' );
	head.appendChild( title );

	const total = data.contentByMonth.reduce( ( s, m ) => s + m.count, 0 );
	const sub = document.createElement( 'div' );
	sub.style.cssText =
		'font-size:11px;color:var(--desktop-mode-muted, #50575e);';
	sub.textContent = sprintf(
		// translators: %d is a count of posts.
		__( '%d total' ),
		total,
	);
	head.appendChild( sub );
	wrap.appendChild( head );

	if ( data.contentByMonth.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.style.cssText =
			'margin:0;color:var(--desktop-mode-muted, #50575e);font-size:12px;';
		empty.textContent = __( 'No activity in the last 12 months.' );
		wrap.appendChild( empty );
		return wrap;
	}

	const max = Math.max( 1, ...data.contentByMonth.map( ( m ) => m.count ) );
	const bars = document.createElement( 'div' );
	bars.style.cssText = [
		'display:grid',
		`grid-template-columns:repeat(${ data.contentByMonth.length }, 1fr)`,
		'gap:4px',
		'align-items:end',
		'height:60px',
	].join( ';' );

	for ( const month of data.contentByMonth ) {
		const col = document.createElement( 'div' );
		col.style.cssText =
			'display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;';
		const bar = document.createElement( 'div' );
		const heightPct = Math.round( ( month.count / max ) * 100 );
		bar.style.cssText = [
			'width:100%',
			`height:${ Math.max( 3, heightPct ) }%`,
			'background:var(--wp-admin-theme-color, #2271b1)',
			month.count === 0 ? 'opacity:0.18' : 'opacity:1',
			'border-radius:3px 3px 0 0',
			'transition:height 360ms ease',
		].join( ';' );
		bar.title = sprintf(
			// translators: %1$s is a YYYY-MM month, %2$d is post count.
			__( '%1$s — %2$d posts' ),
			month.month,
			month.count,
		);
		col.appendChild( bar );
		wrap.appendChild( col );
		bars.appendChild( col );
	}
	wrap.appendChild( bars );

	const labels = document.createElement( 'div' );
	labels.style.cssText = [
		'display:grid',
		`grid-template-columns:repeat(${ data.contentByMonth.length }, 1fr)`,
		'gap:4px',
		'margin-top:4px',
		'font-size:10px',
		'color:var(--desktop-mode-muted, #8c8f94)',
		'text-align:center',
	].join( ';' );
	for ( const month of data.contentByMonth ) {
		const span = document.createElement( 'span' );
		// Show only the month abbreviation; full year tooltip on the bar.
		const parts = month.month.split( '-' );
		span.textContent = parts.length === 2 ? parts[ 1 ] : month.month;
		labels.appendChild( span );
	}
	wrap.appendChild( labels );

	return wrap;
}

function buildRecentLists( data: UserInsightsPayload ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.style.cssText =
		'display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px;margin:0 0 22px;';

	wrap.appendChild(
		buildRecentList(
			__( 'Recent posts' ),
			__( 'No recent posts.' ),
			data.recentPosts.map( ( p ) => ( {
				primary: p.title,
				secondary: relativeFromIso( p.dateGmt ),
				tag: p.status !== 'publish' ? p.status : null,
				badge:
					p.commentCount > 0
						? sprintf(
							// translators: %d is a count of comments.
							__( '%d 💬' ),
							p.commentCount,
						)
						: null,
			} ) ),
		),
	);

	wrap.appendChild(
		buildRecentList(
			__( 'Recent comments' ),
			__( 'No recent comments.' ),
			data.recentComments.map( ( c ) => {
				const when = relativeFromIso( c.dateGmt );
				return {
					primary: c.excerpt || __( '(empty comment)' ),
					secondary: c.postTitle
						? `${ __( 'on' ) } "${ c.postTitle }" · ${ when }`
						: when,
					tag: c.approved ? null : __( 'pending' ),
					badge: null,
				};
			} ),
		),
	);

	return wrap;
}

function buildRecentList(
	title: string,
	emptyText: string,
	items: Array< {
		primary: string;
		secondary: string;
		tag: string | null;
		badge: string | null;
	} >,
): HTMLElement {
	const card = document.createElement( 'div' );
	card.style.cssText = [
		'border:1px solid var(--desktop-mode-border, #dcdcde)',
		'border-radius:10px',
		'padding:14px 16px',
		'min-width:0',
	].join( ';' );

	const head = document.createElement( 'div' );
	head.style.cssText = 'font-size:13px;font-weight:600;margin:0 0 10px;';
	head.textContent = title;
	card.appendChild( head );

	if ( items.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.style.cssText =
			'margin:0;color:var(--desktop-mode-muted, #50575e);font-size:12px;';
		empty.textContent = emptyText;
		card.appendChild( empty );
		return card;
	}

	const list = document.createElement( 'ul' );
	list.style.cssText = 'list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;';
	for ( const item of items ) {
		const li = document.createElement( 'li' );
		li.style.cssText = 'min-width:0;';

		const top = document.createElement( 'div' );
		top.style.cssText =
			'display:flex;align-items:baseline;gap:6px;min-width:0;';
		const primary = document.createElement( 'span' );
		primary.style.cssText =
			'font-size:13px;line-height:1.35;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		primary.textContent = item.primary;
		primary.title = item.primary;
		top.appendChild( primary );
		if ( item.tag ) {
			const tag = document.createElement( 'span' );
			tag.style.cssText =
				'font-size:10px;text-transform:uppercase;letter-spacing:0.04em;background:rgba(0,0,0,0.06);padding:1px 6px;border-radius:8px;flex-shrink:0;';
			tag.textContent = item.tag;
			top.appendChild( tag );
		}
		if ( item.badge ) {
			const badge = document.createElement( 'span' );
			badge.style.cssText =
				'font-size:11px;color:var(--desktop-mode-muted, #50575e);flex-shrink:0;';
			badge.textContent = item.badge;
			top.appendChild( badge );
		}
		li.appendChild( top );

		const sub = document.createElement( 'div' );
		sub.style.cssText =
			'font-size:11px;color:var(--desktop-mode-muted, #8c8f94);';
		sub.textContent = item.secondary;
		li.appendChild( sub );

		list.appendChild( li );
	}
	card.appendChild( list );
	return card;
}

function buildSecurityPanel( data: UserInsightsPayload ): HTMLElement {
	const card = document.createElement( 'div' );
	card.style.cssText = [
		'border:1px solid var(--desktop-mode-border, #dcdcde)',
		'border-radius:10px',
		'padding:14px 16px',
	].join( ';' );

	const head = document.createElement( 'div' );
	head.style.cssText = 'font-size:13px;font-weight:600;margin:0 0 10px;';
	head.textContent = __( 'Active sessions & app access' );
	card.appendChild( head );

	const grid = document.createElement( 'div' );
	grid.style.cssText =
		'display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;';

	const sessionTile = document.createElement( 'div' );
	sessionTile.style.cssText =
		'display:flex;flex-direction:column;gap:2px;font-size:12px;';
	const sessionLabel = document.createElement( 'div' );
	sessionLabel.style.cssText =
		'color:var(--desktop-mode-muted, #50575e);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;';
	sessionLabel.textContent = __( 'Active sessions' );
	const sessionValue = document.createElement( 'div' );
	sessionValue.style.cssText = 'font-size:18px;font-weight:600;';
	sessionValue.textContent = String( data.sessions.length );
	const sessionSub = document.createElement( 'div' );
	sessionSub.style.cssText = 'color:var(--desktop-mode-muted, #8c8f94);';
	const currentCount = data.sessions.filter( ( s ) => s.current ).length;
	sessionSub.textContent =
		currentCount > 0
			? __( 'Includes the current device.' )
			: __( 'Logged in across multiple devices.' );
	sessionTile.appendChild( sessionLabel );
	sessionTile.appendChild( sessionValue );
	sessionTile.appendChild( sessionSub );
	grid.appendChild( sessionTile );

	const appTile = document.createElement( 'div' );
	appTile.style.cssText =
		'display:flex;flex-direction:column;gap:2px;font-size:12px;';
	const appLabel = document.createElement( 'div' );
	appLabel.style.cssText =
		'color:var(--desktop-mode-muted, #50575e);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;';
	appLabel.textContent = __( 'Application passwords' );
	const appValue = document.createElement( 'div' );
	appValue.style.cssText = 'font-size:18px;font-weight:600;';
	appValue.textContent = String( data.applicationPasswords.total );
	const appSub = document.createElement( 'div' );
	appSub.style.cssText = 'color:var(--desktop-mode-muted, #8c8f94);';
	if (
		data.applicationPasswords.lastUsedAt &&
		data.applicationPasswords.lastUsedName
	) {
		appSub.textContent = sprintf(
			// translators: %1$s is the app password name, %2$s is a relative time.
			__( '"%1$s" last used %2$s' ),
			data.applicationPasswords.lastUsedName,
			relativeTime( data.applicationPasswords.lastUsedAt ),
		);
	} else {
		appSub.textContent = data.applicationPasswords.total
			? __( 'No recent use.' )
			: __( 'No app passwords issued yet.' );
	}
	appTile.appendChild( appLabel );
	appTile.appendChild( appValue );
	appTile.appendChild( appSub );
	grid.appendChild( appTile );

	card.appendChild( grid );
	return card;
}

// ─── Helpers ─────────────────────────────────────────────────────────

interface TextFieldOpts {
	required?: boolean;
	type?: string;
	readonly?: boolean;
	fullWidth?: boolean;
	name?: string;
	dataset?: Record< string, string >;
}

function textField(
	formName: string,
	label: string,
	value: string,
	opts: TextFieldOpts = {},
): HTMLElement {
	const el = document.createElement( 'wpd-text-field' ) as HTMLElement & {
		value?: string;
	};
	el.setAttribute( 'name', formName );
	el.setAttribute( 'label', label );
	el.setAttribute( 'value', value );
	el.value = value;
	if ( opts.required ) {
		el.setAttribute( 'required', '' );
	}
	if ( opts.readonly ) {
		el.setAttribute( 'readonly', '' );
	}
	if ( opts.type ) {
		el.setAttribute( 'type', opts.type );
	}
	if ( opts.fullWidth !== false && opts.fullWidth ) {
		el.setAttribute( 'full-width', '' );
	}
	if ( opts.dataset ) {
		for ( const [ k, v ] of Object.entries( opts.dataset ) ) {
			el.dataset[ k ] = v;
		}
	}
	return el;
}

function displayNameCandidates(
	user: UserEditRecord,
): Array< { value: string; label: string } > {
	const candidates = new Set< string >();
	const add = ( s: string ): void => {
		const t = s.trim();
		if ( t !== '' ) {
			candidates.add( t );
		}
	};
	add( user.username );
	add( ( user.nickname as string ) ?? '' );
	add( user.first_name );
	add( user.last_name );
	if ( user.first_name || user.last_name ) {
		add( `${ user.first_name } ${ user.last_name }`.trim() );
		add( `${ user.last_name } ${ user.first_name }`.trim() );
	}
	if ( user.name ) {
		add( user.name );
	}
	return Array.from( candidates ).map( ( name ) => ( {
		value: name,
		label: name,
	} ) );
}

/**
 * Convenience wrapper — parses a server datetime string and returns
 * a relative-time label, or `'—'` when the string can't be parsed
 * (zero-date / empty / malformed). Use this instead of feeding
 * `msFromIso( … ) / 1000` directly into `relativeTime` — that
 * pattern silently rendered every NaN as "just now" before.
 */
function relativeFromIso( iso: string ): string {
	const ms = msFromIso( iso );
	if ( ! Number.isFinite( ms ) ) {
		return '—';
	}
	return relativeTime( Math.floor( ms / 1000 ) );
}

function relativeTime( ts: number ): string {
	if ( ! Number.isFinite( ts ) ) {
		return '—';
	}
	const now = Math.floor( Date.now() / 1000 );
	const delta = now - ts;
	if ( delta < 60 ) {
		return __( 'just now' );
	}
	if ( delta < 3600 ) {
		// translators: %d minutes ago.
		return sprintf( __( '%d min ago' ), Math.floor( delta / 60 ) );
	}
	if ( delta < 86400 ) {
		// translators: %d hours ago.
		return sprintf( __( '%d h ago' ), Math.floor( delta / 3600 ) );
	}
	if ( delta < 86400 * 30 ) {
		// translators: %d days ago.
		return sprintf( __( '%d d ago' ), Math.floor( delta / 86400 ) );
	}
	if ( delta < 86400 * 365 ) {
		// translators: %d months ago.
		return sprintf( __( '%d mo ago' ), Math.floor( delta / ( 86400 * 30 ) ) );
	}
	// translators: %d years ago.
	return sprintf( __( '%d y ago' ), Math.floor( delta / ( 86400 * 365 ) ) );
}

/**
 * Parse a server-emitted UTC datetime to a millisecond epoch.
 * Returns `NaN` when the input is empty or not parseable — the
 * caller decides what to render in that case (typically "—"
 * instead of fabricating `Date.now()`).
 *
 * Handles WordPress's SQL datetime format
 * (`YYYY-MM-DD HH:MM:SS` — space separator, no `T`, no `Z`).
 * Native `Date.parse` returns `NaN` for that on some engines
 * since it isn't ISO-8601 — we normalize to ISO before parsing.
 *
 * The "0000-00-00 …" zero-date used by WordPress for drafts is
 * NOT silently converted to `Date.now()` any more; the parser
 * returns NaN and the renderer falls back to a non-time label.
 */
function msFromIso( iso: string ): number {
	if ( ! iso ) {
		return NaN;
	}
	if ( iso.startsWith( '0000-00-00' ) ) {
		// SQL zero-date — not a real timestamp.
		return NaN;
	}
	let normalized = iso;
	if ( normalized.includes( ' ' ) ) {
		normalized = normalized.replace( ' ', 'T' );
	}
	if ( ! /Z$/.test( normalized ) && ! /[+-]\d{2}:?\d{2}$/.test( normalized ) ) {
		normalized += 'Z';
	}
	const parsed = Date.parse( normalized );
	return Number.isFinite( parsed ) ? parsed : NaN;
}

function generateStrongPassword( length: number ): string {
	const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
	const lower = 'abcdefghjkmnpqrstuvwxyz';
	const digits = '23456789';
	const symbols = '!@#$%^&*-_=+';
	const all = upper + lower + digits + symbols;
	const buf = new Uint32Array( length );
	crypto.getRandomValues( buf );
	let out = '';
	for ( let i = 0; i < length; i += 1 ) {
		out += all[ buf[ i ] % all.length ];
	}
	return out;
}

function mapErrorCode( code: string | undefined ): string | null {
	switch ( code ) {
		case 'rest_user_invalid_email':
		case 'invalid_email':
			return __( 'Email address is not valid.' );
		case 'rest_user_email_exists':
		case 'existing_user_email':
			return __( 'That email is already in use.' );
		case 'rest_user_invalid_role':
			return __( 'You are not allowed to assign that role.' );
		default:
			return null;
	}
}
// ─── Admin colour scheme picker ─────────────────────────────────────

interface ColorSchemeInfo {
	name: string;
	url?: string;
	colors: string[];
	icon_colors?: Record< string, string >;
}

/**
 * Swap the shell's admin-colors stylesheet + body class to live-
 * preview the picked scheme. Mirrors `wp-admin/js/user-profile.js`'s
 * `#color-picker .color-option` click handler — but only triggered
 * when the viewer is editing their OWN profile, since previewing
 * another user's preferred scheme would silently change the
 * viewer's chrome until they refresh.
 *
 * Finds (or stamps) `<link id="colors-css">` in the parent document
 * and points it at the scheme's URL. Also swaps `<body>` from
 * `admin-color-PREV` to `admin-color-NEXT` so any CSS scoped to the
 * body class re-applies.
 */
function applyColorSchemePreview( slug: string, info: ColorSchemeInfo ): void {
	if ( ! info.url ) {
		// PHP didn't surface a CSS url for this scheme — nothing we
		// can swap. Body class still flips so any custom plugin CSS
		// that keys on `body.admin-color-*` picks up the change.
		flipBodyClass( slug );
		flipShellScheme( slug );
		return;
	}
	let link = document.getElementById(
		'colors-css',
	) as HTMLLinkElement | null;
	if ( ! link ) {
		link = document.createElement( 'link' );
		link.rel = 'stylesheet';
		link.id = 'colors-css';
		document.head.appendChild( link );
	}
	link.href = info.url;
	flipBodyClass( slug );
	flipShellScheme( slug );
}

/**
 * Retune the desktop shell's per-scheme CSS variables (accent,
 * titlebar bg, focused titlebar foreground, …) live. variables.css
 * scopes its overrides to `.desktop-mode-shell[data-desktop-mode-scheme=…]`,
 * so swapping the attribute is enough to re-apply the whole block.
 * Without this, only the WP-generated `colors-css` stylesheet (which
 * the master admin bar reads from) repaints — the rest of the shell
 * keeps the previous scheme until the next full reload.
 */
function flipShellScheme( slug: string ): void {
	const shell = document.querySelector< HTMLElement >( '.desktop-mode-shell' );
	if ( shell ) {
		shell.setAttribute( 'data-desktop-mode-scheme', slug );
	}
}

function flipBodyClass( slug: string ): void {
	const body = document.body;
	const next = `admin-color-${ slug }`;
	for ( const cls of Array.from( body.classList ) ) {
		if ( cls.startsWith( 'admin-color-' ) && cls !== next ) {
			body.classList.remove( cls );
		}
	}
	body.classList.add( next );
}

/**
 * Radio-grid picker for the WP admin colour schemes. Each tile
 * shows the scheme's display name + a strip of 3 mini swatches
 * (its colour tuple) — the WP-core profile.php picker pattern.
 *
 * Emits the chosen slug as a hidden `<wpd-text-field name="meta.admin_color">`
 * so the wpd-form's auto value-collection picks it up unchanged.
 * Pass `livePreview: true` to flip the shell's stylesheet + body
 * class on every click (matches core's self-edit behavior).
 */
function buildAdminColorPicker(
	schemes: Record< string, ColorSchemeInfo >,
	current: string,
	opts: { livePreview?: boolean } = {},
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.setAttribute( 'full-width', '' );
	wrap.style.cssText =
		'display:flex;flex-direction:column;gap:6px;';

	const label = document.createElement( 'span' );
	label.style.cssText =
		'font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--desktop-mode-muted, #50575e);font-weight:600;';
	label.textContent = __( 'Admin colour scheme' );
	wrap.appendChild( label );

	// Hidden value carrier — the form's name-field collector reads
	// this on submit. Updated when the user clicks a tile.
	const hidden = document.createElement( 'wpd-text-field' ) as HTMLElement & {
		value?: string;
	};
	hidden.setAttribute( 'name', 'meta.admin_color' );
	hidden.setAttribute( 'value', current );
	hidden.value = current;
	hidden.style.display = 'none';
	wrap.appendChild( hidden );

	const grid = document.createElement( 'div' );
	grid.style.cssText = [
		'display:grid',
		'grid-template-columns:repeat(auto-fill, minmax(140px, 1fr))',
		'gap:8px',
	].join( ';' );
	wrap.appendChild( grid );

	let selected = current;
	const updateSelected = ( slug: string ): void => {
		selected = slug;
		hidden.value = slug;
		hidden.setAttribute( 'value', slug );
		for ( const t of Array.from( grid.children ) ) {
			const tile = t as HTMLElement;
			const v = tile.dataset.scheme;
			tile.style.borderColor =
				v === slug
					? 'var(--wp-admin-theme-color, #2271b1)'
					: 'var(--desktop-mode-border, #dcdcde)';
			tile.style.boxShadow =
				v === slug
					? '0 0 0 1px var(--wp-admin-theme-color, #2271b1) inset'
					: 'none';
			tile.setAttribute( 'aria-checked', v === slug ? 'true' : 'false' );
		}
	};

	for ( const [ slug, info ] of Object.entries( schemes ) ) {
		const tile = document.createElement( 'button' );
		tile.type = 'button';
		tile.setAttribute( 'role', 'radio' );
		tile.setAttribute( 'aria-checked', slug === selected ? 'true' : 'false' );
		tile.dataset.scheme = slug;
		tile.style.cssText = [
			'appearance:none',
			'border:1px solid var(--desktop-mode-border, #dcdcde)',
			'background:var(--wp-admin-theme-bg, #fff)',
			'color:inherit',
			'border-radius:8px',
			'padding:10px 10px 8px',
			'cursor:pointer',
			'display:flex',
			'flex-direction:column',
			'gap:6px',
			'text-align:left',
			'min-width:0',
			'transition:border-color 120ms ease, box-shadow 120ms ease',
		].join( ';' );

		const swatchRow = document.createElement( 'span' );
		swatchRow.style.cssText =
			'display:flex;height:18px;border-radius:4px;overflow:hidden;border:1px solid rgba(0,0,0,0.06);';
		const colors = ( info.colors ?? [] ).slice( 0, 4 );
		if ( colors.length === 0 ) {
			colors.push( '#dcdcde', '#dcdcde', '#dcdcde' );
		}
		for ( const color of colors ) {
			const swatch = document.createElement( 'span' );
			swatch.style.cssText = `flex:1 1 auto;background:${ color };`;
			swatchRow.appendChild( swatch );
		}
		tile.appendChild( swatchRow );

		const name = document.createElement( 'span' );
		name.style.cssText = 'font-size:12px;font-weight:500;';
		name.textContent = info.name;
		tile.appendChild( name );

		tile.addEventListener( 'click', () => {
			updateSelected( slug );
			if ( opts.livePreview ) {
				applyColorSchemePreview( slug, info );
			}
		} );
		grid.appendChild( tile );
	}
	updateSelected( selected );
	return wrap;
}

// ─── Personal-options helper components ─────────────────────────────

interface CheckboxFieldOpts {
	trueValue?: string;
	falseValue?: string;
	fullWidth?: boolean;
}

/**
 * Build a `<wpd-checkbox-label>` that emits a string value
 * (`'true'`/`'false'`) when the form collects values, so it
 * round-trips cleanly through WP's user-meta storage where the
 * personal-options keys are stored as strings.
 */
function checkboxField(
	name: string,
	label: string,
	checked: boolean,
	opts: CheckboxFieldOpts = {},
): HTMLElement {
	const trueValue = opts.trueValue ?? 'true';
	const falseValue = opts.falseValue ?? 'false';
	const wrap = document.createElement( 'span' );
	if ( opts.fullWidth ) {
		wrap.setAttribute( 'full-width', '' );
	}
	const cb = document.createElement( 'wpd-checkbox-label' ) as HTMLElement & {
		checked?: boolean;
		value?: string;
	};
	cb.setAttribute( 'label', label );
	cb.setAttribute( 'name', name );
	cb.setAttribute( 'value', checked ? trueValue : falseValue );
	cb.value = checked ? trueValue : falseValue;
	if ( checked ) {
		cb.setAttribute( 'checked', '' );
	}
	cb.addEventListener( 'wpd-checkbox-change', ( e: Event ) => {
		const detail = ( e as CustomEvent< { checked: boolean } > ).detail;
		const v = detail?.checked ? trueValue : falseValue;
		cb.value = v;
		cb.setAttribute( 'value', v );
	} );
	wrap.appendChild( cb );
	return wrap;
}

/**
 * "Log out everywhere else" — POST to `/users/<id>/destroy-sessions`.
 * On admin-edits-other this is "log them out everywhere"; on
 * self-edit it spares the current device.
 */
function buildSessionsRow( userId: number, isSelfEdit: boolean ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.setAttribute( 'full-width', '' );
	wrap.style.cssText =
		'display:flex;align-items:center;gap:12px;flex-wrap:wrap;';

	const label = document.createElement( 'span' );
	label.style.cssText = 'font-size:13px;color:var(--desktop-mode-fg, inherit);';
	label.textContent = __( 'Active sessions' );
	wrap.appendChild( label );

	const btn = document.createElement( 'wpd-button' );
	btn.setAttribute( 'variant', 'ghost' );
	btn.setAttribute( 'type', 'button' );
	btn.textContent = isSelfEdit
		? __( 'Log out everywhere else' )
		: __( 'Log this user out everywhere' );
	btn.addEventListener( 'click', async ( e ) => {
		e.preventDefault();
		try {
			const cfg = resolveUserEditClient().getConfig();
			const base =
				( cfg as unknown as { insightsUrlBase?: string } )
					.insightsUrlBase ??
				joinRestUrl( cfg.restRoot, 'desktop-mode/v1/users/' );
			const res = await trackedFetch(
				joinRestUrl( base, `${ userId }/destroy-sessions` ),
				{
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': cfg.restNonce,
					},
					body: JSON.stringify( {
						scope: isSelfEdit ? 'others' : 'all',
					} ),
				},
				{ source: 'user-edit-window/destroy-sessions' },
			);
			if ( ! res.ok ) {
				throw new Error( `http_${ res.status }` );
			}
			notifyToast( __( 'Sessions destroyed.' ), 'success' );
		} catch ( err ) {
			notifyToast(
				sprintf(
					// translators: %s is an error message.
					__( 'Could not destroy sessions (%s).' ),
					String( ( err as Error ).message ?? err ),
				),
				'error',
			);
		}
	} );
	wrap.appendChild( btn );
	return wrap;
}

interface AppPasswordItem {
	uuid: string;
	name: string;
	created: number;
	last_used: number | null;
	last_ip: string | null;
}

/**
 * Application Passwords list + create. Uses the new REST routes
 * `/users/<id>/application-passwords` (GET, POST) and
 * `/.../<uuid>` (DELETE).
 */
function buildAppPasswordsRow( userId: number ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.setAttribute( 'full-width', '' );
	wrap.style.cssText =
		'display:flex;flex-direction:column;gap:8px;border:1px solid var(--desktop-mode-border, #dcdcde);border-radius:8px;padding:12px 14px;';

	const heading = document.createElement( 'div' );
	heading.style.cssText =
		'display:flex;align-items:center;justify-content:space-between;gap:8px;';
	const headLabel = document.createElement( 'span' );
	headLabel.textContent = __( 'Application passwords' );
	headLabel.style.cssText = 'font-size:13px;font-weight:600;';
	heading.appendChild( headLabel );
	wrap.appendChild( heading );

	const cfg = resolveUserEditClient().getConfig();
	const base =
		( cfg as unknown as { insightsUrlBase?: string } ).insightsUrlBase ??
		joinRestUrl( cfg.restRoot, 'desktop-mode/v1/users/' );
	const list = document.createElement( 'ul' );
	list.style.cssText =
		'list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;';
	wrap.appendChild( list );

	const createRow = document.createElement( 'div' );
	createRow.style.cssText =
		'display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:6px;';
	const nameInput = document.createElement( 'wpd-text-field' ) as HTMLElement & {
		value?: string;
	};
	nameInput.setAttribute( 'label', __( 'New application password name' ) );
	nameInput.setAttribute(
		'placeholder',
		__( 'e.g. iPhone, WP-CLI, Backup tool' ),
	);
	nameInput.style.flex = '1 1 220px';
	createRow.appendChild( nameInput );
	const createBtn = document.createElement( 'wpd-button' );
	createBtn.setAttribute( 'variant', 'primary' );
	createBtn.setAttribute( 'type', 'button' );
	createBtn.textContent = __( 'Create' );
	createRow.appendChild( createBtn );
	wrap.appendChild( createRow );

	const renderItems = ( items: AppPasswordItem[] ): void => {
		list.replaceChildren();
		if ( items.length === 0 ) {
			const empty = document.createElement( 'li' );
			empty.style.cssText =
				'font-size:12px;color:var(--desktop-mode-muted, #50575e);';
			empty.textContent = __( 'No application passwords issued yet.' );
			list.appendChild( empty );
			return;
		}
		for ( const item of items ) {
			const row = document.createElement( 'li' );
			row.style.cssText =
				'display:flex;align-items:center;gap:8px;font-size:12px;';
			const nameSpan = document.createElement( 'span' );
			nameSpan.style.cssText = 'flex:1 1 auto;font-weight:500;';
			nameSpan.textContent = item.name;
			row.appendChild( nameSpan );
			const meta = document.createElement( 'span' );
			meta.style.cssText =
				'color:var(--desktop-mode-muted, #8c8f94);';
			meta.textContent = item.last_used
				? sprintf(
					// translators: %s is a relative time.
					__( 'last used %s' ),
					relativeTime( item.last_used ),
				)
				: __( 'never used' );
			row.appendChild( meta );
			const revoke = document.createElement( 'wpd-button' );
			revoke.setAttribute( 'variant', 'ghost' );
			revoke.setAttribute( 'type', 'button' );
			revoke.textContent = __( 'Revoke' );
			revoke.addEventListener( 'click', async ( e ) => {
				e.preventDefault();
				try {
					const res = await trackedFetch(
						joinRestUrl( base, `${ userId }/application-passwords/${ item.uuid }` ),
						{
							method: 'DELETE',
							credentials: 'same-origin',
							headers: { 'X-WP-Nonce': cfg.restNonce },
						},
						{ source: 'user-edit-window/app-pw-revoke' },
					);
					if ( ! res.ok ) {
						throw new Error( `http_${ res.status }` );
					}
					row.remove();
					notifyToast( __( 'Application password revoked.' ), 'success' );
				} catch ( err ) {
					notifyToast(
						String( ( err as Error ).message ?? err ),
						'error',
					);
				}
			} );
			row.appendChild( revoke );
			list.appendChild( row );
		}
	};

	const refresh = async (): Promise< void > => {
		try {
			const res = await trackedFetch(
				joinRestUrl( base, `${ userId }/application-passwords` ),
				{
					credentials: 'same-origin',
					headers: { 'X-WP-Nonce': cfg.restNonce },
				},
				{ source: 'user-edit-window/app-pw-list', silent: true },
			);
			if ( ! res.ok ) {
				return;
			}
			const data = ( await res.json() ) as { items: AppPasswordItem[] };
			renderItems( data.items ?? [] );
		} catch {
			// non-fatal; leave list empty
		}
	};
	void refresh();

	createBtn.addEventListener( 'click', async ( e ) => {
		e.preventDefault();
		const name = String( nameInput.value ?? '' ).trim();
		if ( ! name ) {
			notifyToast( __( 'Application password name is required.' ), 'error' );
			return;
		}
		try {
			const res = await trackedFetch(
				joinRestUrl( base, `${ userId }/application-passwords` ),
				{
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': cfg.restNonce,
					},
					body: JSON.stringify( { name } ),
				},
				{ source: 'user-edit-window/app-pw-create' },
			);
			if ( ! res.ok ) {
				throw new Error( `http_${ res.status }` );
			}
			const data = ( await res.json() ) as {
				ok: boolean;
				password: string;
			};
			notifyToast(
				sprintf(
					// translators: %s is an application password.
					__( 'Created. Copy the password now: %s' ),
					data.password,
				),
				'success',
			);
			void navigator.clipboard?.writeText( data.password ).catch( () => {} );
			nameInput.value = '';
			nameInput.setAttribute( 'value', '' );
			void refresh();
		} catch ( err ) {
			notifyToast(
				String( ( err as Error ).message ?? err ),
				'error',
			);
		}
	} );

	return wrap;
}
