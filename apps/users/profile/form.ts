/**
 * `<os-user-profile>` — the editable form: every field from
 * `wp-admin/user-edit.php` (identity, contact methods, bio, language,
 * role, personal options + colour scheme, password + confirm,
 * sessions, application passwords), saved through core's
 * `PUT /wp/v2/users/<id>`.
 */

import { __, sprintf } from '@openstation/app';
import { applyAvatarSrc } from '../../../src/ui/util/avatar-resolve';
import '../../../src/ui/components/os-avatar/os-avatar';
import '../../../src/ui/components/os-button/os-button';
import '../../../src/ui/components/os-form/os-form';
import '../../../src/ui/components/os-icon/os-icon';
import '../../../src/ui/components/os-select/os-select';
import '../../../src/ui/components/os-text-field/os-text-field';
import '../../../src/ui/components/os-textarea/os-textarea';
import { generateStrongPassword } from '../parts/password';
import { copyQuietly, fetchUser, saveUser } from './client';
import { roleChips } from './insights';
import { buildAdminColorPicker, buildAppPasswordsRow, buildSessionsRow, checkboxField } from './options';
import type { OsFormElement, OsSelectElement, ProfileHost, UserEditRecord } from './types';

const HEADING =
	'margin:18px 0 4px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--os-ui-fg-muted, #50575e);';

export interface ProfileFormHooks {
	/** The record saved: the host repaints what else shows it (the aside). */
	onSaved?: ( user: UserEditRecord ) => void;
}

/**
 * Load the user and mount the form into `host`. Resolves with the
 * record; rejects (after painting the failure) when the load fails.
 */
export async function mountProfileFormAt(
	el: HTMLElement,
	userId: number,
	host: ProfileHost,
	hooks: ProfileFormHooks = {},
): Promise< UserEditRecord > {
	el.replaceChildren();
	const skeleton = document.createElement( 'div' );
	skeleton.className = 'os-user-edit__skeleton';
	skeleton.style.cssText =
		'display:flex;align-items:center;justify-content:center;padding:48px;color:var(--os-ui-fg-muted, #50575e);font-size:13px;';
	skeleton.textContent = __( 'Loading profile…' );
	el.appendChild( skeleton );

	let user: UserEditRecord;
	try {
		user = await fetchUser( host, userId );
	} catch ( err ) {
		el.replaceChildren();
		const msg = document.createElement( 'p' );
		msg.style.cssText = 'padding:32px;color:var(--os-ui-danger, #b32d2e);font-size:13px;text-align:center;';
		// translators: %s is an error message.
		msg.textContent = sprintf( __( 'Could not load profile (%s).' ), String( ( err as Error ).message ?? err ) );
		el.appendChild( msg );
		throw err;
	}
	el.replaceChildren();
	mountProfileForm( el, user, userId, host, hooks );
	return user;
}

function heading( text: string ): HTMLElement {
	const el = document.createElement( 'h3' );
	el.setAttribute( 'full-width', '' );
	el.textContent = text;
	el.style.cssText = HEADING;
	return el;
}

function select( name: string, label: string, items: Record< string, string >, value: string ): OsSelectElement {
	const el = document.createElement( 'os-select' ) as OsSelectElement;
	el.setAttribute( 'name', name );
	el.setAttribute( 'label', label );
	el.items = Object.entries( items ).map( ( [ v, l ] ) => ( { value: v, label: l } ) );
	el.value = value;
	return el;
}

function passwordField( name: string, label: string, placeholder: string ): HTMLElement & { value?: string } {
	const el = document.createElement( 'os-text-field' ) as HTMLElement & { value?: string };
	el.setAttribute( 'name', name );
	el.setAttribute( 'type', 'password' );
	el.setAttribute( 'reveal', '' );
	el.setAttribute( 'label', label );
	el.setAttribute( 'placeholder', placeholder );
	el.setAttribute( 'autocomplete', 'new-password' );
	return el;
}

interface TextFieldOpts {
	required?: boolean;
	type?: string;
	readonly?: boolean;
}

function textField( name: string, label: string, value: string, opts: TextFieldOpts = {} ): HTMLElement {
	const el = document.createElement( 'os-text-field' ) as HTMLElement & { value?: string };
	el.setAttribute( 'name', name );
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
	return el;
}

function mountProfileForm( el: HTMLElement, user: UserEditRecord, userId: number, host: ProfileHost, hooks: ProfileFormHooks ): void {
	const cfg = host.config;
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-user-edit__profile';

	const form = document.createElement( 'os-form' ) as OsFormElement;
	form.setAttribute( 'submit-label', __( 'Save changes' ) );
	form.setAttribute( 'reset-label', __( 'Revert' ) );
	form.setAttribute( 'columns', 'auto' );

	// Header — avatar + display name + roles; swapped in place after a
	// save so the chips reflect the saved record.
	const header = document.createElement( 'div' );
	header.setAttribute( 'slot', 'header' );
	let profileHeader = buildProfileHeader( user, cfg );
	header.appendChild( profileHeader );
	form.appendChild( header );

	// — Identity —
	form.appendChild( textField( 'username', __( 'Username' ), user.username, { readonly: true } ) );
	form.appendChild( textField( 'first_name', __( 'First name' ), user.first_name ) );
	form.appendChild( textField( 'last_name', __( 'Last name' ), user.last_name ) );
	form.appendChild( textField( 'nickname', __( 'Nickname' ), ( user.nickname as string ) ?? '', { required: true } ) );
	const displaySelect = document.createElement( 'os-select' ) as OsSelectElement;
	displaySelect.setAttribute( 'name', 'name' );
	displaySelect.setAttribute( 'label', __( 'Display name publicly as' ) );
	displaySelect.items = displayNameCandidates( user );
	displaySelect.value = user.name;
	form.appendChild( displaySelect );

	// — Contact —
	form.appendChild( textField( 'email', __( 'Email (required)' ), user.email, { required: true, type: 'email' } ) );
	form.appendChild( textField( 'url', __( 'Website' ), user.url, { type: 'url' } ) );
	const meta = ( user.meta ?? {} ) as Record< string, unknown >;
	for ( const [ slug, label ] of Object.entries( cfg.contactMethods ?? {} ) ) {
		form.appendChild( textField( `meta.${ slug }`, label, String( meta[ slug ] ?? '' ) ) );
	}

	// — Bio —
	const bio = document.createElement( 'os-textarea' ) as HTMLElement & { value?: string };
	bio.setAttribute( 'name', 'description' );
	bio.setAttribute( 'label', __( 'Biographical info' ) );
	bio.setAttribute( 'placeholder', __( 'Share a little about yourself — visible on author archives.' ) );
	bio.setAttribute( 'rows', '4' );
	bio.setAttribute( 'full-width', '' );
	bio.value = user.description;
	bio.setAttribute( 'value', user.description );
	form.appendChild( bio );

	// — Account —
	form.appendChild( select( 'locale', __( 'Language' ), cfg.locales ?? { '': __( 'Site default' ) }, String( user.locale ?? '' ) ) );

	// The role select is hidden only on self-edit (admins demoting
	// themselves is a footgun; core's profile.php hides it too).
	// Capability gating is the server's: a viewer without
	// `promote_users` gets a 403 they can act on. It lists the roles
	// the viewer can assign, falling back to the full catalogue.
	const isSelfEdit = userId === ( cfg.currentUserId ?? 0 );
	if ( ! isSelfEdit ) {
		const assignable = cfg.assignableRoles ?? {};
		const roleMap = Object.keys( assignable ).length > 0 ? assignable : cfg.allRoles ?? {};
		const currentRole = Array.isArray( user.roles ) ? user.roles[ 0 ] ?? '' : '';
		form.appendChild( select( 'roles[0]', __( 'Role' ), roleMap, currentRole ) );
	}

	// — Personal Options — the section of `wp-admin/user-edit.php`
	// core renders for ANY user the viewer can edit.
	form.appendChild( heading( __( 'Personal options' ) ) );
	const flag = ( key: string, fallback: string ): boolean => String( meta[ key ] ?? fallback ) !== 'false';
	form.appendChild(
		checkboxField( 'meta.rich_editing', __( 'Disable the visual editor when writing' ), ! flag( 'rich_editing', '' ), {
			trueValue: 'false',
			falseValue: 'true',
			fullWidth: true,
		} ),
	);
	form.appendChild(
		checkboxField( 'meta.syntax_highlighting', __( 'Disable syntax highlighting when editing code' ), ! flag( 'syntax_highlighting', '' ), {
			trueValue: 'false',
			falseValue: 'true',
			fullWidth: true,
		} ),
	);
	form.appendChild(
		checkboxField( 'meta.comment_shortcuts', __( 'Enable keyboard shortcuts for comment moderation' ), String( meta.comment_shortcuts ?? 'false' ) === 'true', {
			fullWidth: true,
		} ),
	);
	form.appendChild(
		checkboxField( 'meta.show_admin_bar_front', __( 'Show toolbar when viewing site' ), flag( 'show_admin_bar_front', 'true' ), { fullWidth: true } ),
	);
	const picker = buildAdminColorPicker( cfg.colorSchemes ?? {}, String( meta.admin_color ?? 'fresh' ), { livePreview: isSelfEdit } );
	form.appendChild( picker );

	// — Account management —
	form.appendChild( heading( __( 'Account management' ) ) );
	const pwdRow = document.createElement( 'div' );
	pwdRow.setAttribute( 'full-width', '' );
	pwdRow.style.cssText = 'display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;';
	const pwd = passwordField( 'password', __( 'New password' ), __( 'Leave blank to keep the current password.' ) );
	pwd.style.flex = '1 1 280px';
	pwdRow.appendChild( pwd );
	const pwdConfirm = passwordField( 'password_confirm', __( 'Confirm new password' ), __( 'Type the new password again.' ) );
	pwdConfirm.setAttribute( 'full-width', '' );

	const genBtn = document.createElement( 'os-button' );
	genBtn.setAttribute( 'variant', 'ghost' );
	genBtn.setAttribute( 'type', 'button' );
	const genIcon = document.createElement( 'os-icon' );
	genIcon.setAttribute( 'name', 'randomize' );
	genIcon.setAttribute( 'size', '14' );
	genBtn.append( genIcon, document.createTextNode( __( 'Generate strong' ) ) );
	genBtn.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		const next = generateStrongPassword( 18 );
		for ( const field of [ pwd, pwdConfirm ] ) {
			field.value = next;
			field.setAttribute( 'value', next );
		}
		copyQuietly( next );
		host.toast( __( 'Password generated and copied to clipboard.' ), 'success' );
	} );
	pwdRow.appendChild( genBtn );
	form.appendChild( pwdRow );
	form.appendChild( pwdConfirm );

	form.appendChild( buildSessionsRow( host, userId, isSelfEdit ) );
	form.appendChild( buildAppPasswordsRow( host, userId ) );

	// Revert puts the previewed chrome back with the fields.
	form.addEventListener( 'os-form-reset', () => picker.revert() );

	let pending = false;
	form.addEventListener( 'os-form-submit', ( e ) => {
		void onSubmit( ( e as CustomEvent< { values: Record< string, unknown > } > ).detail.values );
	} );

	const onSubmit = async ( values: Record< string, unknown > ): Promise< void > => {
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
			if ( String( values.password_confirm ?? '' ) !== values.password ) {
				form.setError( __( 'The two password fields do not match.' ) );
				form.setFieldInvalid( 'password_confirm' );
				pending = false;
				form.setBusy( false );
				return;
			}
			patch.password = values.password;
		}
		// Core's REST takes roles as an array.
		if ( typeof values[ 'roles[0]' ] === 'string' && values[ 'roles[0]' ] ) {
			patch.roles = [ values[ 'roles[0]' ] ];
		}
		// Every `meta.foo` field folds into `meta` — contact methods and
		// the personal-options keys. `<os-form>` harvests a checkbox as
		// a boolean, but core stores those keys as STRING 'true'/'false'
		// and its schema rejects a boolean; `checkboxField` keeps the
		// right string on the element's `value` attribute, so read that.
		const metaPatch: Record< string, unknown > = {};
		for ( const [ k, v ] of Object.entries( values ) ) {
			if ( ! k.startsWith( 'meta.' ) ) {
				continue;
			}
			metaPatch[ k.slice( 5 ) ] =
				typeof v === 'boolean' ? form.querySelector( `[name="${ k }"]` )?.getAttribute( 'value' ) ?? String( v ) : v;
		}
		if ( Object.keys( metaPatch ).length > 0 ) {
			patch.meta = metaPatch;
		}

		const result = await saveUser( host, userId, patch );
		pending = false;
		form.setBusy( false );

		if ( ! result.ok ) {
			const summary = result.message ?? mapErrorCode( result.error ) ?? __( 'Save failed.' );
			form.setError( summary );
			host.toast( summary, 'error' );
			for ( const field of Object.keys( result.fieldErrors ?? {} ) ) {
				form.setFieldInvalid( field );
			}
			// The chrome goes back to the saved scheme; the pick stays
			// so the user can fix the rest and save again.
			picker.revert();
			// eslint-disable-next-line no-console
			console.warn( '[user-edit] save failed', { code: result.error, message: result.message } );
			return;
		}

		host.toast( __( 'Profile saved.' ), 'success' );
		if ( typeof metaPatch.admin_color === 'string' ) {
			picker.commit( metaPatch.admin_color );
		}
		for ( const field of [ pwd, pwdConfirm ] ) {
			field.value = '';
			field.setAttribute( 'value', '' );
		}
		// Reflect the saved record: the header chips repaint with the
		// new display name / role; the host repaints its aside.
		if ( result.user ) {
			Object.assign( user, result.user );
			const next = buildProfileHeader( user, cfg );
			profileHeader.replaceWith( next );
			profileHeader = next;
			hooks.onSaved?.( user );
		}
	};

	wrap.appendChild( form );
	el.appendChild( wrap );
}

function buildProfileHeader( user: UserEditRecord, cfg: ProfileHost[ 'config' ] ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-user-edit__header';
	wrap.style.cssText = 'display:flex;align-items:center;gap:16px;margin:0 0 12px;';

	const avatar = document.createElement( 'os-avatar' );
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
	sub.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--os-ui-fg-muted, #50575e);flex-wrap:wrap;';
	const handle = document.createElement( 'span' );
	handle.textContent = `@${ user.username }`;
	sub.appendChild( handle );
	const chips = roleChips( Array.isArray( user.roles ) ? user.roles : [], cfg );
	chips.style.justifyContent = 'flex-start';
	sub.appendChild( chips );
	text.appendChild( sub );
	wrap.appendChild( text );
	return wrap;
}

/** WP-style display-name candidates: username, nickname, names and their combinations. */
function displayNameCandidates( user: UserEditRecord ): Array< { value: string; label: string } > {
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
	return Array.from( candidates ).map( ( name ) => ( { value: name, label: name } ) );
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
