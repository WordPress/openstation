/**
 * `<os-user-profile>` — the Personal Options widgets of the form:
 * string-valued checkboxes, the admin colour scheme picker with its
 * live preview, the sessions row and the application passwords panel.
 */

import { __, sprintf } from '@openstation/app';
import '../../../src/ui/components/os-button/os-button';
import '../../../src/ui/components/os-checkbox-label/os-checkbox-label';
import '../../../src/ui/components/os-text-field/os-text-field';
import {
	copyQuietly,
	createAppPassword,
	destroySessions,
	listAppPasswords,
	relativeTime,
	revokeAppPassword,
	toast,
} from './profile-client';
import type { AppPasswordItem, ColorSchemeInfo } from './types';

interface CheckboxFieldOpts {
	trueValue?: string;
	falseValue?: string;
	fullWidth?: boolean;
}

/**
 * A `<os-checkbox-label>` that carries a string value (`'true'` /
 * `'false'`) on its `value` attribute, so it round-trips through WP's
 * user-meta storage where the personal-options keys are strings.
 */
export function checkboxField(
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
	const cb = document.createElement( 'os-checkbox-label' ) as HTMLElement & { value?: string };
	cb.setAttribute( 'label', label );
	cb.setAttribute( 'name', name );
	cb.setAttribute( 'value', checked ? trueValue : falseValue );
	cb.value = checked ? trueValue : falseValue;
	if ( checked ) {
		cb.setAttribute( 'checked', '' );
	}
	cb.addEventListener( 'os-checkbox-change', ( e: Event ) => {
		const v = ( e as CustomEvent< { checked: boolean } > ).detail?.checked ? trueValue : falseValue;
		cb.value = v;
		cb.setAttribute( 'value', v );
	} );
	wrap.appendChild( cb );
	return wrap;
}

/**
 * Swap the shell's admin-colors stylesheet + body class to live-
 * preview the picked scheme (`wp-admin/js/user-profile.js`'s
 * `#color-picker .color-option` handler) — only on self-edit, since
 * previewing another user's scheme would change the viewer's chrome.
 */
export function applyColorSchemePreview( slug: string, info: ColorSchemeInfo ): void {
	if ( info.url ) {
		let link = document.getElementById( 'colors-css' ) as HTMLLinkElement | null;
		if ( ! link ) {
			link = document.createElement( 'link' );
			link.rel = 'stylesheet';
			link.id = 'colors-css';
			document.head.appendChild( link );
		}
		link.href = info.url;
	}
	// The desktop shell's per-scheme variables key on this attribute.
	document.querySelector< HTMLElement >( '.os-shell' )?.setAttribute( 'data-os-scheme', slug );
	const next = `admin-color-${ slug }`;
	for ( const cls of Array.from( document.body.classList ) ) {
		if ( cls.startsWith( 'admin-color-' ) && cls !== next ) {
			document.body.classList.remove( cls );
		}
	}
	document.body.classList.add( next );
}

/**
 * Radio-grid picker for the WP admin colour schemes: scheme name +
 * a strip of mini swatches per tile. Emits the chosen slug through a
 * hidden `<os-text-field name="meta.admin_color">` so the form's
 * value collection picks it up unchanged.
 */
export function buildAdminColorPicker(
	schemes: Record< string, ColorSchemeInfo >,
	current: string,
	opts: { livePreview?: boolean } = {},
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.setAttribute( 'full-width', '' );
	wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

	const label = document.createElement( 'span' );
	label.style.cssText =
		'font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--os-ui-fg-muted, #50575e);font-weight:600;';
	label.textContent = __( 'Admin colour scheme' );
	wrap.appendChild( label );

	const hidden = document.createElement( 'os-text-field' ) as HTMLElement & { value?: string };
	hidden.setAttribute( 'name', 'meta.admin_color' );
	hidden.setAttribute( 'value', current );
	hidden.value = current;
	hidden.style.display = 'none';
	wrap.appendChild( hidden );

	const grid = document.createElement( 'div' );
	grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:8px;';
	wrap.appendChild( grid );

	const updateSelected = ( slug: string ): void => {
		hidden.value = slug;
		hidden.setAttribute( 'value', slug );
		for ( const t of Array.from( grid.children ) ) {
			const tile = t as HTMLElement;
			const on = tile.dataset.scheme === slug;
			tile.style.borderColor = on ? 'var(--wp-admin-theme-color, #2271b1)' : 'var(--os-ui-border, #dcdcde)';
			tile.style.boxShadow = on ? '0 0 0 1px var(--wp-admin-theme-color, #2271b1) inset' : 'none';
			tile.setAttribute( 'aria-checked', on ? 'true' : 'false' );
		}
	};

	for ( const [ slug, info ] of Object.entries( schemes ) ) {
		const tile = document.createElement( 'button' );
		tile.type = 'button';
		tile.setAttribute( 'role', 'radio' );
		tile.dataset.scheme = slug;
		tile.style.cssText = [
			'appearance:none',
			'border:1px solid var(--os-ui-border, #dcdcde)',
			// Palette card surface — a `--wp-admin-theme-*` name is not
			// an OpenStation token; on a dark desktop the tile fell back
			// to white and the inherited theme text vanished on it.
			'background:var(--os-ui-card-bg, var(--os-ui-surface, #fff))',
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
			'display:flex;height:18px;border-radius:4px;overflow:hidden;border:1px solid var(--os-ui-border, rgba(0,0,0,0.06));';
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
	updateSelected( current );
	return wrap;
}

/**
 * "Log out everywhere else" — on admin-edits-other this is "log them
 * out everywhere"; on self-edit it spares the current device.
 */
export function buildSessionsRow( userId: number, isSelfEdit: boolean ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.setAttribute( 'full-width', '' );
	wrap.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;';

	const label = document.createElement( 'span' );
	label.style.cssText = 'font-size:13px;color:var(--os-fg, inherit);';
	label.textContent = __( 'Active sessions' );
	wrap.appendChild( label );

	const btn = document.createElement( 'os-button' );
	btn.setAttribute( 'variant', 'ghost' );
	btn.setAttribute( 'type', 'button' );
	btn.textContent = isSelfEdit ? __( 'Log out everywhere else' ) : __( 'Log this user out everywhere' );
	btn.addEventListener( 'click', async ( e ) => {
		e.preventDefault();
		try {
			await destroySessions( userId, isSelfEdit ? 'others' : 'all' );
			toast( __( 'Sessions destroyed.' ), 'success' );
		} catch ( err ) {
			// translators: %s is an error message.
			toast( sprintf( __( 'Could not destroy sessions (%s).' ), String( ( err as Error ).message ?? err ) ), 'error' );
		}
	} );
	wrap.appendChild( btn );
	return wrap;
}

/** Application Passwords: the list, revoke per row, and a creator. */
export function buildAppPasswordsRow( userId: number ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.setAttribute( 'full-width', '' );
	wrap.style.cssText =
		'display:flex;flex-direction:column;gap:8px;border:1px solid var(--os-ui-border, #dcdcde);border-radius:8px;padding:12px 14px;';

	const heading = document.createElement( 'div' );
	heading.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
	const headLabel = document.createElement( 'span' );
	headLabel.textContent = __( 'Application passwords' );
	headLabel.style.cssText = 'font-size:13px;font-weight:600;';
	heading.appendChild( headLabel );
	wrap.appendChild( heading );

	const list = document.createElement( 'ul' );
	list.style.cssText = 'list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;';
	wrap.appendChild( list );

	const createRow = document.createElement( 'div' );
	createRow.style.cssText = 'display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:6px;';
	const nameInput = document.createElement( 'os-text-field' ) as HTMLElement & { value?: string };
	nameInput.setAttribute( 'label', __( 'New application password name' ) );
	nameInput.setAttribute( 'placeholder', __( 'e.g. iPhone, WP-CLI, Backup tool' ) );
	nameInput.style.flex = '1 1 220px';
	createRow.appendChild( nameInput );
	const createBtn = document.createElement( 'os-button' );
	createBtn.setAttribute( 'variant', 'primary' );
	createBtn.setAttribute( 'type', 'button' );
	createBtn.textContent = __( 'Create' );
	createRow.appendChild( createBtn );
	wrap.appendChild( createRow );

	const renderItems = ( items: AppPasswordItem[] ): void => {
		list.replaceChildren();
		if ( items.length === 0 ) {
			const empty = document.createElement( 'li' );
			empty.style.cssText = 'font-size:12px;color:var(--os-ui-fg-muted, #50575e);';
			empty.textContent = __( 'No application passwords issued yet.' );
			list.appendChild( empty );
			return;
		}
		for ( const item of items ) {
			const row = document.createElement( 'li' );
			row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;';
			const nameSpan = document.createElement( 'span' );
			nameSpan.style.cssText = 'flex:1 1 auto;font-weight:500;';
			nameSpan.textContent = item.name;
			row.appendChild( nameSpan );
			const meta = document.createElement( 'span' );
			meta.style.cssText = 'color:var(--os-ui-fg-muted, #8c8f94);';
			if ( item.last_used ) {
				// translators: %s is a relative time.
				meta.textContent = sprintf( __( 'last used %s' ), relativeTime( item.last_used ) );
			} else {
				meta.textContent = __( 'never used' );
			}
			row.appendChild( meta );
			const revoke = document.createElement( 'os-button' );
			revoke.setAttribute( 'variant', 'ghost' );
			revoke.setAttribute( 'type', 'button' );
			revoke.textContent = __( 'Revoke' );
			revoke.addEventListener( 'click', async ( e ) => {
				e.preventDefault();
				try {
					await revokeAppPassword( userId, item.uuid );
					row.remove();
					toast( __( 'Application password revoked.' ), 'success' );
				} catch ( err ) {
					toast( String( ( err as Error ).message ?? err ), 'error' );
				}
			} );
			row.appendChild( revoke );
			list.appendChild( row );
		}
	};

	const refresh = async (): Promise< void > => {
		try {
			renderItems( await listAppPasswords( userId ) );
		} catch {
			// non-fatal; leave list empty
		}
	};
	void refresh();

	createBtn.addEventListener( 'click', async ( e ) => {
		e.preventDefault();
		const name = String( nameInput.value ?? '' ).trim();
		if ( ! name ) {
			toast( __( 'Application password name is required.' ), 'error' );
			return;
		}
		try {
			const password = await createAppPassword( userId, name );
			// translators: %s is an application password.
			toast( sprintf( __( 'Created. Copy the password now: %s' ), password ), 'success' );
			copyQuietly( password );
			nameInput.value = '';
			nameInput.setAttribute( 'value', '' );
			void refresh();
		} catch ( err ) {
			toast( String( ( err as Error ).message ?? err ), 'error' );
		}
	} );

	return wrap;
}
