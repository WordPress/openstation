import { __, html, sprintf } from '@openstation/app';
import {
	listDesktopThemes,
	removeDesktopTheme,
	upsertDesktopTheme,
} from '../../../src/desktop-themes/registry';
import type { DesktopThemeEntry } from '../../../src/desktop-themes/types';
import type { DesktopThemeServerEntry, DesktopWallpaperServerEntry } from '../../../src/types';
import { restErrorFromResponse } from '../../../src/core/api-client';
import { describeRestFailure } from '../../../src/core/rest-failure';
import { doAction, HOOKS } from '../../../src/hooks';
import { hasApplicableThemeRecommendations } from '../../../src/settings/theme-recommendations';
import { applyThemeRecommendations, settings, update } from './store';
import { extraOf, uiOf, type Ctx, type Section } from './types';

const SYSTEM_DEFAULT = '';

const SYSTEM_DEFAULT_NAME = 'OpenStation';

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

function announceWallpapers( payload: unknown ): void {
	const list = ( payload as { serverWallpapers?: unknown } )?.serverWallpapers;
	if ( Array.isArray( list ) ) {
		doAction( HOOKS.WALLPAPERS_SERVER_CHANGED, {
			wallpapers: list as DesktopWallpaperServerEntry[],
		} );
	}
}

async function uploadTheme( ctx: Ctx, file: File ): Promise< DesktopThemeServerEntry > {
	const form = new FormData();
	form.append( 'file', file, file.name );
	const response = await ctx.fetch( extraOf( ctx ).desktopThemesUrl, { method: 'POST', body: form } );
	if ( ! response.ok ) {
		throw await restErrorFromResponse( response );
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
		throw await restErrorFromResponse( response );
	}
	try {
		announceWallpapers( await response.json() );
	} catch {

	}
}

async function doUpload( ctx: Ctx, file: File ): Promise< void > {
	const ui = uiOf( ctx ).themes;
	if ( ui.busy ) {
		return;
	}
	ui.busy = true;
	ui.error = '';
	ctx.repaint();
	try {
		upsertDesktopTheme( await uploadTheme( ctx, file ) );
	} catch ( err ) {
		ui.error = describeRestFailure( err, { fallback: __( 'That theme could not be installed.' ) } ).message;
	} finally {
		ui.busy = false;
		ctx.repaint();
	}
}

async function doDelete( ctx: Ctx, theme: DesktopThemeEntry ): Promise< void > {
	const ok = await ctx.host.confirm?.( {
		title: __( 'Delete this theme?' ),
		message: sprintf(

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

		if ( settings().desktopTheme === theme.slug ) {
			update( { desktopTheme: SYSTEM_DEFAULT } );
		}
	} catch ( err ) {
		ui.error = describeRestFailure( err, { fallback: __( 'That theme could not be deleted.' ) } ).message;
	}
	ctx.repaint();
}

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
