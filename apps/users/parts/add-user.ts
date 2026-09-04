/**
 * Users app — the Add User tab: the `<os-form>` of `user-new.php`,
 * as a template. Its submit dispatches the `create` action; the
 * server answers with the failure (and the field it names) in the
 * state, which `syncAddUserForm()` paints onto the form.
 */

import { __, html, type TemplateResult } from '@openstation/app';
import { copyQuietly } from '../profile/client';
import { generateStrongPassword } from './password';
import type { OsFormElement, ProfileConfig } from '../profile/types';
import type { UsersState } from './types';

function options( map: Record< string, string > ): TemplateResult[] {
	return Object.entries( map ).map( ( [ value, label ] ) => html`<os-option value=${ value }>${ label }</os-option>` );
}

/** The form. Submit is the natural `os-form-submit` → `create` with `$args['values']`. */
export function addUserForm( cfg: ProfileConfig, toast: ( message: string ) => void ): TemplateResult {
	const defaultRole = cfg.defaultRole ?? 'subscriber';
	const roles =
		cfg.assignableRoles && Object.keys( cfg.assignableRoles ).length > 0
			? cfg.assignableRoles
			: { [ defaultRole ]: defaultRole };
	const locales = cfg.locales ?? { '': __( 'Site default' ) };
	const generatePassword = ( e: Event ): void => {
		e.preventDefault();
		e.stopPropagation();
		const form = ( e.currentTarget as HTMLElement ).closest( 'os-form' );
		const pwdField = form?.querySelector< HTMLElement & { value?: string } >( 'os-text-field[name="password"]' );
		const pwd = generateStrongPassword( 18 );
		if ( pwdField ) {
			pwdField.value = pwd;
			pwdField.setAttribute( 'value', pwd );
		}
		copyQuietly( pwd );
		toast( __( 'Generated password copied to clipboard.' ) );
	};
	return html`<os-form
		data-os-users-add-form
		os-action="create"
		submit-label=${ __( 'Add user' ) }
		reset-label=${ __( 'Reset' ) }
	>
		<div slot="header">
			<h2>${ __( 'Add a new user' ) }</h2>
			<p class="os-users__form-lede">
				${ __( 'WordPress will create the account and (optionally) email the user a notification with a link to set their own password.' ) }
			</p>
		</div>
		<os-text-field name="username" label=${ __( 'Username (required)' ) } placeholder=${ __( 'e.g. jane.doe' ) } autocomplete="off" required></os-text-field>
		<os-text-field name="email" type="email" label=${ __( 'Email (required)' ) } placeholder=${ __( 'jane@example.com' ) } autocomplete="off" required></os-text-field>
		<os-text-field name="first_name" label=${ __( 'First name' ) } autocomplete="off"></os-text-field>
		<os-text-field name="last_name" label=${ __( 'Last name' ) } autocomplete="off"></os-text-field>
		<os-text-field name="url" type="url" label=${ __( 'Website' ) } placeholder="https://example.com" autocomplete="off" full-width></os-text-field>
		<os-select name="role" label=${ __( 'Role' ) } value=${ roles[ defaultRole ] !== undefined ? defaultRole : '' }>${ options( roles ) }</os-select>
		<os-select name="locale" label=${ __( 'Language' ) }>${ options( locales ) }</os-select>
		<os-text-field
			name="password"
			type="password"
			reveal
			label=${ __( 'Password' ) }
			placeholder=${ __( 'Auto-generated; click Generate to set one.' ) }
			autocomplete="new-password"
			full-width
		></os-text-field>
		<div class="os-users__form-pwd-actions" full-width>
			<os-button variant="ghost" type="button" @click=${ generatePassword }>
				<span class="dashicons dashicons-randomize" aria-hidden="true"></span>
				${ __( 'Generate strong password' ) }
			</os-button>
			<p class="os-users__form-hint">${ __( 'Leave blank to let WordPress generate one and email it to the user.' ) }</p>
		</div>
		<os-checkbox-label name="send_notification" label=${ __( 'Send the new user an email about their account' ) } checked full-width></os-checkbox-label>
	</os-form>`;
}

/** What the form was last painted for, so a repaint that changes nothing touches nothing. */
export interface AddUserFormSync {
	created: number;
	error: string;
	field: string;
}

/**
 * Paint the server's answer onto the form after a render: the error
 * banner and the field it names, or — after a successful create —
 * a fresh form. Touches the form only when the answer changed, so a
 * selection repaint never wipes a field's invalid state.
 */
export function syncAddUserForm( root: HTMLElement, state: UsersState, painted: AddUserFormSync ): AddUserFormSync {
	const form = root.querySelector< OsFormElement >( '[data-os-users-add-form]' );
	if ( ! form ) {
		return painted;
	}
	const next: AddUserFormSync = { created: state.created, error: state.createError, field: state.createField };
	if ( state.created !== painted.created ) {
		form.reset();
		form.clearErrors();
		return next;
	}
	if ( state.createError === painted.error && state.createField === painted.field ) {
		return painted;
	}
	form.clearErrors();
	if ( state.createError ) {
		form.setError( state.createError );
		if ( state.createField ) {
			form.setFieldInvalid( state.createField );
		}
	}
	return next;
}
