/**
 * Themes — a card grid of every desktop theme in the site's library,
 * plus "System default". Picking is per-user and open to everyone;
 * the upload tile and the per-card delete button appear only for
 * users who hold the theme-management capability.
 *
 * Code-registered themes (`source: 'code'`) never get a delete
 * button: there is no file to remove and the REST route rightly 404s
 * on them. A plugin that ships a theme takes it away by unregistering
 * it — see the built-in "Legacy" theme.
 *
 * Activating a theme through the store seeds its recommended
 * settings once, the first time this user wears it; the "Apply
 * recommended layout and effects" row is the deliberate way back.
 */

import { __, html, sprintf } from '@openstation/app';
import {
	listDesktopThemes,
	removeDesktopTheme,
	upsertDesktopTheme,
} from '../../../src/desktop-themes/registry';
import type { DesktopThemeEntry } from '../../../src/desktop-themes/types';
import type { DesktopThemeServerEntry, DesktopWallpaperServerEntry } from '../../../src/types';
import { doAction, HOOKS } from '../../../src/hooks';
import { hasApplicableThemeRecommendations } from '../../../src/settings/theme-recommendations';
import { applyThemeRecommendations, settings, update } from './store';
import { extraOf, uiOf, type Ctx, type Section } from './types';

/** Sentinel card id for "no theme". */
const SYSTEM_DEFAULT = '';

/**
 * What the "no theme" card is called. Not a translated string: it is
 * the name of the shell's own look, the same way "Desktop Mode
 * (Legacy)" is the name of the theme beside it, and a product name
 * does not get translated.
 */
const SYSTEM_DEFAULT_NAME = 'OpenStation';

/**
 * Initials shown on a theme card that ships no preview image. Same
 * idea as the letter-badge icon fallback: something recognisable and
 * stable beats an empty rectangle.
 */
function initialsFor( name: string ): string {
	const words = name.trim().split( /\s+/ ).filter( Boolean );
	if ( words.length === 0 ) {
		return '?';
	}
	if ( words.length >= 2 ) {
		return ( words[ 0 ][ 0 ] + words[ 1 ][ 0 ] ).toUpperCase();
	}
	return words[ 0 ].slice( 0, 2 ).toUpperCase();
}

// -------------------------------------------------------------- REST

/**
 * The install pipeline returns specific, actionable `WP_Error`
 * messages ("that archive contains an unsafe file path", "theme.json
 * is not valid JSON"). Collapsing all of that into "Upload failed"
 * would throw away the only thing that tells a theme author what to
 * fix.
 */
async function errorMessage( response: Response, fallback: string ): Promise< string > {
	try {
		const data = ( await response.json() ) as { message?: unknown };
		if ( data && typeof data.message === 'string' && data.message !== '' ) {
			return data.message;
		}
	} catch {
		/* Not JSON — fall through to the generic message. */
	}
	return `${ fallback } (HTTP ${ response.status }).`;
}

/**
 * Installing or deleting a theme changes which wallpapers exist, and
 * the registry that owns them lives in the shell bundle. Both REST
 * responses carry the rebuilt list; this hands it over. Silent when
 * the response carries nothing — a theme with no wallpapers changes
 * no wallpapers.
 */
function announceWallpapers( payload: unknown ): void {
	const list = ( payload as { serverWallpapers?: unknown } )?.serverWallpapers;
	if ( Array.isArray( list ) ) {
		doAction( HOOKS.WALLPAPERS_SERVER_CHANGED, {
			wallpapers: list as DesktopWallpaperServerEntry[],
		} );
	}
}

async function uploadTheme( ctx: Ctx, file: File ): Promise< DesktopThemeServerEntry > {
	// `FormData`, not a raw body: the route reads `$_FILES['file']`,
	// which PHP only populates for genuine multipart POSTs. No
	// Content-Type either — the browser adds its own boundary.
	const form = new FormData();
	form.append( 'file', file, file.name );
	const response = await ctx.fetch( extraOf( ctx ).desktopThemesUrl, { method: 'POST', body: form } );
	if ( ! response.ok ) {
		throw new Error( await errorMessage( response, 'Theme upload failed' ) );
	}
	const installed = await response.json();
	announceWallpapers( installed );
	return installed as DesktopThemeServerEntry;
}

async function deleteTheme( ctx: Ctx, slug: string ): Promise< void > {
	const response = await ctx.fetch(
		`${ extraOf( ctx ).desktopThemesUrl }/${ encodeURIComponent( slug ) }`,
		{ method: 'DELETE' },
	);
	if ( ! response.ok ) {
		throw new Error( await errorMessage( response, 'Theme delete failed' ) );
	}
	try {
		announceWallpapers( await response.json() );
	} catch {
		/* A body-less 200 is fine — nothing to announce. */
	}
}

// ----------------------------------------------------------- actions

async function doUpload( ctx: Ctx, file: File ): Promise< void > {
	const ui = uiOf( ctx ).themes;
	if ( ui.busy ) {
		return;
	}
	ui.busy = true;
	ui.error = '';
	ctx.repaint();
	try {
		// Insert directly rather than waiting for the next payload
		// refresh — the theme the admin just uploaded should be
		// pickable the moment the spinner stops.
		upsertDesktopTheme( await uploadTheme( ctx, file ) );
	} catch ( err ) {
		ui.error = err instanceof Error ? err.message : __( 'That theme could not be installed.' );
	} finally {
		ui.busy = false;
		ctx.repaint();
	}
}

async function doDelete( ctx: Ctx, theme: DesktopThemeEntry ): Promise< void > {
	const ok = await ctx.host.confirm?.( {
		title: __( 'Delete this theme?' ),
		message: sprintf(
			/* translators: %s: theme name. */
			__( '“%s” will be removed from this site for everyone. This cannot be undone.' ),
			theme.name,
		),
		confirmLabel: __( 'Delete' ),
		danger: true,
	} );
	if ( ! ok ) {
		return;
	}
	const ui = uiOf( ctx ).themes;
	ui.error = '';
	try {
		await deleteTheme( ctx, theme.slug );
		removeDesktopTheme( theme.slug );
		// Deleting the theme THIS user is wearing has to reset their
		// selection too, or the shell would keep a stylesheet whose
		// file no longer exists until reload. Other users are handled
		// server-side: the enqueue path existence-checks every request.
		if ( settings().desktopTheme === theme.slug ) {
			update( { desktopTheme: SYSTEM_DEFAULT } );
		}
	} catch ( err ) {
		ui.error = err instanceof Error ? err.message : __( 'That theme could not be deleted.' );
	}
	ctx.repaint();
}

// ------------------------------------------------------------- cards

const themeCard = ( ctx: Ctx, theme: DesktopThemeEntry, selected: boolean, canManage: boolean ) => html`
	<div class="os-settings__theme-card-wrap">
		<button
			type="button"
			class="os-settings__theme-card"
			aria-pressed=${ selected ? 'true' : 'false' }
			data-theme-slug=${ theme.slug }
			@click=${ () => update( { desktopTheme: theme.slug } ) }
		>
			<span class="os-settings__theme-preview">
				${ theme.previewUrl
					? html`<img src=${ theme.previewUrl } alt="" aria-hidden="true" draggable="false" />`
					: html`<span class="os-settings__theme-initials" aria-hidden="true">${ initialsFor( theme.name ) }</span>` }
			</span>
			<span class="os-settings__theme-name">${ theme.name }</span>
			<span class="os-settings__theme-meta">
				${ theme.version !== ''
					? sprintf(
						/* translators: %s: theme version string. */
						__( 'Version %s' ),
						theme.version,
					)
					: '' }
			</span>
		</button>
		${ canManage && theme.source !== 'code'
			? html`<button
				type="button"
				class="os-settings__theme-delete"
				aria-label=${ sprintf(
					/* translators: %s: theme name. */
					__( 'Delete %s' ),
					theme.name,
				) }
				@click=${ () => void doDelete( ctx, theme ) }
			>×</button>`
			: '' }
	</div>
`;

const systemCard = ( selected: boolean ) => html`
	<div class="os-settings__theme-card-wrap">
		<button
			type="button"
			class="os-settings__theme-card os-settings__theme-card--system"
			aria-pressed=${ selected ? 'true' : 'false' }
			@click=${ () => update( { desktopTheme: SYSTEM_DEFAULT } ) }
		>
			<span class="os-settings__theme-preview os-settings__theme-preview--system" aria-hidden="true"></span>
			<span class="os-settings__theme-name">${ SYSTEM_DEFAULT_NAME }</span>
			<span class="os-settings__theme-meta">${ __( 'The look OpenStation ships with' ) }</span>
		</button>
	</div>
`;

const uploadTile = ( ctx: Ctx ) => {
	const ui = uiOf( ctx ).themes;
	const fileOf = ( e: Event ): File | undefined =>
		( e as DragEvent ).dataTransfer?.files?.[ 0 ] ??
		( e.currentTarget as HTMLInputElement ).files?.[ 0 ];
	return html`<div
		class=${ ui.busy ? 'os-settings__theme-upload os-settings__theme-upload--busy' : 'os-settings__theme-upload' }
		@dragover=${ ( e: DragEvent ) => {
			e.preventDefault();
			( e.currentTarget as HTMLElement ).classList.add( 'os-settings__theme-upload--dragover' );
		} }
		@dragleave=${ ( e: DragEvent ) => {
			( e.currentTarget as HTMLElement ).classList.remove( 'os-settings__theme-upload--dragover' );
		} }
		@drop=${ ( e: DragEvent ) => {
			e.preventDefault();
			( e.currentTarget as HTMLElement ).classList.remove( 'os-settings__theme-upload--dragover' );
			const file = fileOf( e );
			if ( file ) {
				void doUpload( ctx, file );
			}
		} }
	>
		<label class="os-settings__theme-upload-label">
			<input
				type="file"
				accept=".zip,application/zip"
				class="os-settings__file-input"
				?disabled=${ ui.busy }
				@change=${ ( e: Event ) => {
					const input = e.currentTarget as HTMLInputElement;
					const file = input.files?.[ 0 ];
					if ( file ) {
						void doUpload( ctx, file );
					}
					// Clear so re-picking the same file fires `change` again.
					input.value = '';
				} }
			/>
			<span class="os-settings__theme-upload-plus" aria-hidden="true">+</span>
			<span class="os-settings__theme-upload-prompt">
				${ ui.busy ? __( 'Installing…' ) : __( 'Drop a theme .zip here, or click to upload' ) }
			</span>
		</label>
	</div>`;
};

/**
 * The "restore the author's arrangement" row. Shown only for the
 * theme the user is currently wearing, and only when it actually
 * recommends something this shell can apply — a recommendation
 * naming a dock rail renderer no plugin registered resolves to
 * nothing, and an unusable button is worse than no button. The
 * system default is in: a palette with an arrangement of its own.
 */
const recommendationRow = ( activeSlug: string, themes: DesktopThemeEntry[] ) => {
	if ( ! hasApplicableThemeRecommendations( activeSlug ) ) {
		return '';
	}
	const name =
		activeSlug === SYSTEM_DEFAULT
			? SYSTEM_DEFAULT_NAME
			: themes.find( ( theme ) => theme.slug === activeSlug )?.name;
	if ( name === undefined ) {
		return '';
	}
	return html`<div class="os-settings__theme-recommendation">
		<os-button variant="secondary" @click=${ () => applyThemeRecommendations( activeSlug ) }>
			${ sprintf(
				/* translators: %s: theme name. */
				__( 'Apply %s’s recommended layout and effects' ),
				name,
			) }
		</os-button>
	</div>`;
};

export const renderThemes: Section = ( s, ctx ) => {
	const themes = listDesktopThemes();
	const canManage = ctx.data.canManageDesktopThemes;
	const error = uiOf( ctx ).themes.error;
	// role="group", not radiogroup: the upload tile is the last cell
	// of this grid, and a radiogroup may contain nothing but radios.
	// The cards are toggle buttons carrying aria-pressed, which is
	// what the wallpaper swatches already do.
	return html`
		${ error !== '' ? html`<os-notice tone="error">${ error }</os-notice>` : '' }
		<os-section heading=${ __( 'Installed' ) }>
			<div class="os-settings__theme-grid" role="group" aria-label=${ __( 'Desktop theme' ) }>
				${ systemCard( s.desktopTheme === SYSTEM_DEFAULT ) }
				${ themes.map( ( theme ) => themeCard( ctx, theme, s.desktopTheme === theme.slug, canManage ) ) }
				${ canManage ? uploadTile( ctx ) : '' }
			</div>
			${ recommendationRow( s.desktopTheme, themes ) }
		</os-section>
	`;
};
