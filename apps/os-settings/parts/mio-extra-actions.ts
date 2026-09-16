/** Capability-gated server actions and non-destructive Preferences utilities. */
import type { MioAbility } from '../../../src/mio/assistant/types';
import type { OsSettingsState } from '../../../src/settings/types';
import { SNOW_LIMITS } from '../../../src/plugins/snow-wallpaper/settings';
import { all as listWallpapers } from '../../../src/wallpapers/registry';
import { publishWallpaperSettings } from '../../../src/wallpapers/settings-store';
import { pageRows } from './pages';
import { searchSettings } from './search';
import { getDefaultWallpaperId } from '../../../src/settings/constants';
import { exactKeys, objectSchema } from './mio-actions';
import { settings, shellConfig } from './store';
import { extraOf, uiOf, type Ctx, type ExtendedOptions } from './types';
import { syncShellMirrors } from './features';
import { openWallpaperConfigDialog } from './wallpaper';
import { collectEntries } from './components';

const EXTENDED = [
	'window_prewarm',
	'admin_asset_cache',
	'media_library_enhanced',
	'games',
	'agents',
	'network',
] as const;

export function extraMioActions(
	ctx: Ctx,
	patch: ( value: Partial<OsSettingsState>, signal: AbortSignal ) => Promise<unknown>,
): MioAbility[] {
	const bool = objectSchema( { enabled: { type: 'boolean' } } );
	const validBool = ( args: Record<string, unknown> ) =>
		exactKeys( args, [ 'enabled' ] ) && typeof args.enabled === 'boolean';
	const dispatch = async ( action: string, args: Record<string, unknown> ) => {
		if ( ! ( await ctx.dispatch( action, args ) ) ) {
			throw new Error( 'Preferences did not save this action.' );
		}
		syncShellMirrors( ctx );
		return {
			saved: true,
			extendedOptions: ctx.data.extendedOptions,
		};
	};
	return [
		...EXTENDED.map(
			( key ): MioAbility => ( {
				name: `set_extended_${ key }`,
				description: `Set site-wide ${ key }. Administrator only. Affects all users; window prewarm and asset cache need shell reload.`,
				parameters: bool,
				validate: validBool,
				allowed: () => ctx.data.isAdmin && !! ctx.data.extendedOptions,
				run: ( args ) =>
					dispatch( 'extended', {
						options: {
							...ctx.data.extendedOptions,
							[ key ]: args.enabled,
						} as ExtendedOptions,
					} ),
			} ),
		),
		{
			name: 'set_ai_assistant',
			description:
				'Enable or disable the assistant for this account. Disabling ends future MIO requests.',
			parameters: bool,
			validate: validBool,
			allowed: () => !! ctx.data.aiAssistant?.assistantProviderConfigured,
			run: ( args, signal ) => patch( { ai: { enabled: args.enabled as boolean } }, signal ),
		},
		{
			name: 'show_introductions_again',
			description:
				'Show welcome introductions again on their next open. Does not delete settings or content.',
			parameters: objectSchema( {} ),
			validate: ( args ) => exactKeys( args, [] ),
			run: () => dispatch( 'reset-intros', {} ),
		},
		{
			name: 'open_section',
			effect: 'none',
			description:
				'Open a Preferences section. Use appearance, themes, windows, navigation, mobile, features, about, or help (Components; admin only).',
			parameters: objectSchema( {
				id: { type: 'string', enum: pageRows( ctx ).map( ( row ) => row.id ) },
			} ),
			validate: ( args ) =>
				exactKeys( args, [ 'id' ] ) && pageRows( ctx ).some( ( row ) => row.id === args.id ),
			run: ( args ) => {
				ctx.local( 'tab', { value: args.id } );
				return { opened: args.id };
			},
		},
		{
			name: 'search_settings',
			effect: 'none',
			description: 'Search Preferences and highlight the single best matching control.',
			parameters: objectSchema( { query: { type: 'string' } } ),
			validate: ( args ) =>
				exactKeys( args, [ 'query' ] ) &&
				typeof args.query === 'string' &&
				args.query.length <= 200,
			run: ( args ) => {
				searchSettings( ctx, args.query as string );
				return { filtered: args.query };
			},
		},
		{
			name: 'open_image_picker',
			effect: 'none',
			description:
				'Show the wallpaper image picker. Upload requires the user to select a local file; library offers existing images.',
			parameters: objectSchema( { source: { type: 'string', enum: [ 'library', 'upload' ] } } ),
			validate: ( args ) =>
				exactKeys( args, [ 'source' ] ) &&
				( args.source === 'library' || ( args.source === 'upload' && ctx.data.canUpload ) ),
			run: ( args ) => {
				const ui = uiOf( ctx );
				ui.imagePickerOpen = true;
				ui.imageSource = args.source as 'library' | 'upload';
				ctx.local( 'tab', { value: 'appearance' } );
				ctx.repaint();
				return { opened: args.source, needsUserFile: args.source === 'upload' };
			},
		},
		{
			name: 'search_wallpaper_images',
			effect: 'read',
			description:
				'Search image attachments in the media library. Returns verified ids and dimensions for select_wallpaper_image.',
			parameters: objectSchema( {
				query: { type: 'string' },
				page: { type: 'integer', minimum: 1, maximum: 100 },
			} ),
			validate: ( args ) =>
				exactKeys( args, [ 'query', 'page' ] ) &&
				typeof args.query === 'string' &&
				args.query.length <= 200 &&
				Number.isInteger( args.page ) &&
				( args.page as number ) >= 1 &&
				( args.page as number ) <= 100,
			run: async ( args, signal ) => {
				const url = new URL( extraOf( ctx ).mediaUrl );
				url.searchParams.set( 'media_type', 'image' );
				url.searchParams.set( 'search', args.query as string );
				url.searchParams.set( 'page', String( args.page ) );
				url.searchParams.set( 'per_page', '12' );
				url.searchParams.set( '_fields', 'id,title,media_details,source_url,mime_type' );
				const response = await ctx.fetch( url.href, { signal } );
				if ( ! response.ok ) {
					throw new Error( 'Could not search the media library.' );
				}
				return response.json();
			},
		},
		{
			name: 'select_wallpaper_image',
			description:
				'Use an existing image attachment as wallpaper. Verifies the attachment on the server; never accepts a model-supplied URL.',
			parameters: objectSchema( { id: { type: 'integer', minimum: 1 } } ),
			validate: ( args ) =>
				exactKeys( args, [ 'id' ] ) && Number.isSafeInteger( args.id ) && ( args.id as number ) > 0,
			run: async ( args, signal ) => {
				const response = await ctx.fetch( `${ extraOf( ctx ).mediaUrl }/${ args.id }`, { signal } );
				if ( ! response.ok ) {
					throw new Error( 'This image is unavailable.' );
				}
				const media = await response.json();
				if (
					typeof media.mime_type !== 'string' ||
					! media.mime_type.startsWith( 'image/' ) ||
					typeof media.source_url !== 'string' ||
					! /^https?:\/\//.test( media.source_url )
				) {
					throw new Error( 'The attachment is not a usable image.' );
				}
				return patch(
					{
						customImage: { id: media.id, url: media.source_url },
						wallpaper: 'custom-image',
					},
					signal,
				);
			},
		},
		{
			name: 'clear_wallpaper_image',
			description: 'Clear the selected wallpaper image without deleting its media attachment. Active image wallpaper returns to the default wallpaper.',
			parameters: objectSchema( {} ),
			validate: ( args ) => exactKeys( args, [] ),
			run: ( _args, signal ) => patch( {
				customImage: null,
				...( settings().wallpaper === 'custom-image' ? { wallpaper: getDefaultWallpaperId() } : {} ),
			}, signal ),
		},
		{
			name: 'open_theme_upload',
			effect: 'none',
			description:
				'Show the desktop theme upload tile. The user must choose the ZIP from their device.',
			parameters: objectSchema( {} ),
			validate: ( args ) => exactKeys( args, [] ),
			allowed: () => ctx.data.canManageDesktopThemes,
			run: () => {
				ctx.local( 'tab', { value: 'themes' } );
				return { opened: 'themes', needsUserFile: true };
			},
		},
		{
			name: 'open_wallpaper_settings',
			effect: 'none',
			description: 'Open the active wallpaper’s custom settings dialog, when available.',
			parameters: objectSchema( {} ),
			validate: ( args ) => exactKeys( args, [] ),
			run: () => {
				const def = listWallpapers().find( ( item ) => item.id === settings().wallpaper );
				if ( ! def?.renderConfig ) {
					throw new Error( 'This wallpaper has no settings dialog.' );
				}
				openWallpaperConfigDialog( def );
				return { opened: def.id };
			},
		},
		{
			name: 'set_snow_settings',
			description:
				'Configure Snow wallpaper: wind 0–80, particleCount 100–2000, flakeSize 6–40, background #rrggbb. Does not switch wallpaper.',
			parameters: objectSchema( {
				wind: { type: 'number', minimum: 0, maximum: 80 },
				particleCount: { type: 'integer', minimum: 100, maximum: 2000 },
				flakeSize: { type: 'number', minimum: 6, maximum: 40 },
				background: { type: 'string' },
			} ),
			allowed: () => listWallpapers().some( ( item ) => item.id === 'wp-snow' ),
			validate: ( args ) =>
				exactKeys( args, [ 'wind', 'particleCount', 'flakeSize', 'background' ] ) &&
				Object.entries( SNOW_LIMITS ).every(
					( [ key, limit ] ) =>
						typeof args[ key ] === 'number' &&
						Number.isFinite( args[ key ] ) &&
						( args[ key ] as number ) >= limit.min &&
						( args[ key ] as number ) <= limit.max,
				) &&
				Number.isInteger( args.particleCount ) &&
				typeof args.background === 'string' &&
				/^#[0-9a-f]{6}$/i.test( args.background ),
			run: async ( args, signal ) => {
				const bag = args as Record<string, string | number | boolean>;
				const result = await patch(
					{ wallpaperSettings: { ...settings().wallpaperSettings, 'wp-snow': bag } },
					signal,
				);
				publishWallpaperSettings( 'wp-snow', bag );
				return result;
			},
		},
		{
			name: 'open_component_reference',
			effect: 'none',
			description:
				'Inspect a kit component’s documentation and interactive example. Administrator only.',
			parameters: objectSchema( { tag: { type: 'string' } } ),
			allowed: () => ctx.data.isAdmin,
			validate: ( args ) =>
				exactKeys( args, [ 'tag' ] ) &&
				collectEntries().some( ( entry ) => entry.tag === args.tag ),
			run: ( args ) => {
				uiOf( ctx ).components.activeTag = args.tag as string;
				ctx.local( 'tab', { value: 'help' } );
				ctx.repaint();
				return { opened: args.tag };
			},
		},
		{
			name: 'list_components',
			effect: 'read',
			description: 'List available component references.',
			parameters: objectSchema( {} ),
			validate: ( args ) => exactKeys( args, [] ),
			allowed: () => ctx.data.isAdmin,
			run: () => collectEntries().map( ( entry ) => ( { tag: entry.tag, title: entry.title } ) ),
		},
		{
			name: 'show_connectors_location',
			effect: 'read',
			description:
				'Explain where to connect the AI provider. Credentials must be entered by the user in WordPress Connectors.',
			parameters: objectSchema( {} ),
			validate: ( args ) => exactKeys( args, [] ),
			run: () => ( {
				url: shellConfig().aiAssistant?.connectorsUrl,
				instructions:
					'Open WordPress Settings → Connectors to manage provider credentials.',
			} ),
		},
	];
}
