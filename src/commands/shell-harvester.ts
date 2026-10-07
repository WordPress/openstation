import {
	registerCommand,
	unregisterByOwner,
	type DesktopCommand,
} from './../commands';
import { __, sprintf } from './../i18n';
import { tryNativeUrlRemap } from './../native-url-remap';
import type { WindowManager } from './../window-manager';
import { deriveWindowId, sanitizeIconSvg } from './../utils';

const OWNER = 'global';

const NAV_HREF_LITERAL_RE =
	/(?:document\.location\.href|window\.location\.href|location\.href)\s*=\s*['"]([^'"$]+?)['"]/;
const NAV_ASSIGN_LITERAL_RE =
	/(?:document\.location|window\.location|location)\s*=\s*['"]([^'"$]+?)['"]/;
const NAV_CALL_LITERAL_RE =
	/location\.(?:assign|replace)\s*\(\s*['"]([^'"$]+?)['"]\s*\)/;

const NAV_INTENT_RE =
	/(?:document\.location|window\.location|location)\s*(?:\.href\s*)?=|location\.(?:assign|replace)\s*\(/;

const SITE_EDITOR_INTENT_RE = /getSiteEditorPage\s*\(|site-editor\.php/;
const SITE_EDITOR_NAME_RE = /^(wp_template_part|wp_template|wp_navigation|wp_block)-(.+)$/;

function siteEditorDescription( name: string ): string | undefined {
	const type = name.match( SITE_EDITOR_NAME_RE )?.[ 1 ];
	return {
		wp_template: __( 'Edit template' ),
		wp_template_part: __( 'Edit template part' ),
		wp_navigation: __( 'Edit navigation menu' ),
		wp_block: __( 'Edit pattern' ),
	}[ type ?? '' ];
}

function lookupMenuCommand(
	name: string,
): { label: string; url: string } | null {
	const list = ( window as any ).__openStationMenuCommands;
	if ( ! Array.isArray( list ) ) {
		return null;
	}
	for ( const entry of list ) {
		if (
			entry &&
			typeof entry === 'object' &&
			entry.name === name &&
			typeof entry.url === 'string' &&
			entry.url !== ''
		) {
			return {
				label: typeof entry.label === 'string' ? entry.label : '',
				url: entry.url,
			};
		}
	}
	return null;
}

interface RawCommand {
	name: string;
	label: string;
	icon?: unknown;
	context?: string;
	disabled?: boolean;
	callback?: ( ...args: unknown[] ) => void;
}

interface Classified {
	name: string;
	label: string;
	icon?: string;
	iconSvg?: string;

	kind: 'navigate' | 'action' | 'skip';
	url?: string;

	windowTitle?: string;
	callback?: ( ...args: unknown[] ) => void;
}

export interface ShellCommandHarvesterOptions {
	manager: WindowManager;
	adminUrl: string;

	titleForUrl?: ( url: string ) => string | undefined;
}

export class ShellCommandHarvester {
	private readonly manager: WindowManager;
	private readonly adminUrl: string;
	private readonly titleForUrl?: ( url: string ) => string | undefined;

	private mounted = false;
	private host: HTMLDivElement | null = null;

	private root: any = null;
	private kindCache: Record< string, { kind: 'navigate' | 'action' | 'skip'; url?: string; iconSvg?: string; windowTitle?: string } > =
		Object.create( null );
	private callbackCache: Record< string, ( ...args: unknown[] ) => void > =
		Object.create( null );
	private lastFingerprint = '';

	constructor( opts: ShellCommandHarvesterOptions ) {
		this.manager = opts.manager;
		this.adminUrl = opts.adminUrl;
		this.titleForUrl = opts.titleForUrl;
	}

	public install(): void {
		this.tryMount( 0 );
	}

	private tryMount( attempt: number ): void {
		if ( this.mounted ) {
			return;
		}

		const wp = ( window as any ).wp;
		if ( ! wp || ! wp.data || ! wp.element || typeof wp.data.subscribe !== 'function' ) {
			if ( attempt < 40 ) {
				window.setTimeout( () => this.tryMount( attempt + 1 ), 150 );
			}
			return;
		}
		this.mount();
	}

	private mount(): void {
		const wp = ( window as any ).wp;
		const el = wp.element;
		const data = wp.data;
		const createEl = el.createElement;
		const useEffect = el.useEffect;
		const useRef = el.useRef;
		const useMemo = el.useMemo;
		const useSelect = data.useSelect;
		if (
			typeof createEl !== 'function' ||
			typeof useEffect !== 'function' ||
			typeof useRef !== 'function' ||
			typeof useMemo !== 'function' ||
			typeof useSelect !== 'function' ||
			typeof el.createRoot !== 'function'
		) {
			return;
		}
		this.mounted = true;

		const host = document.createElement( 'div' );
		host.setAttribute( 'aria-hidden', 'true' );
		host.style.cssText =
			'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;left:-9999px;top:-9999px;';
		( document.body || document.documentElement ).appendChild( host );
		this.host = host;

		const bucket: {
			perLoader: Record< string, RawCommand[] >;
			statics: RawCommand[];
			loadersList: string[];
		} = {
			perLoader: {},
			statics: [],
			loadersList: [],
		};

		const fingerprint = ( cmds: RawCommand[] ): string => {
			if ( ! Array.isArray( cmds ) || cmds.length === 0 ) {
				return '';
			}
			const keys = new Array( cmds.length );
			for ( let i = 0; i < cmds.length; i++ ) {
				const c = cmds[ i ];
				keys[ i ] = c && c.name ? c.name : '';
			}
			return keys.join( '|' );
		};

		const mergeAndPublish = (): void => {
			let merged: RawCommand[] = [];
			for ( const name of bucket.loadersList ) {
				const slice = bucket.perLoader[ name ];
				if ( Array.isArray( slice ) ) {
					merged = merged.concat( slice );
				}
			}
			if ( Array.isArray( bucket.statics ) ) {
				merged = merged.concat( bucket.statics );
			}

			this.callbackCache = Object.create( null );
			for ( const cc of merged ) {
				if ( cc && cc.name && typeof cc.callback === 'function' ) {
					this.callbackCache[ cc.name ] = cc.callback;
				}
			}
			this.publish( merged );
		};

		const LoaderSlot = ( props: { loader: { name: string; hook: ( a: { search: string } ) => { commands?: RawCommand[] } } } ) => {
			const loader = props.loader;
			let result: { commands?: RawCommand[] } | null = null;
			try {
				result = loader.hook( { search: '' } );
			} catch {

			}
			const cmds: RawCommand[] =
				result && Array.isArray( result.commands ) ? result.commands : [];
			const key = useMemo( () => fingerprint( cmds ), [ cmds ] );

			useEffect( () => {
				bucket.perLoader[ loader.name ] = cmds;
				mergeAndPublish();
			}, [ key ] );

			useEffect( () => {
				return () => {
					delete bucket.perLoader[ loader.name ];
					mergeAndPublish();
				};
			}, [] );

			return null;
		};

		const Harvester = () => {
			const loaders = useSelect( ( s: ( store: string ) => unknown ) => {
				const ss = s( 'core/commands' ) as any;
				if ( ! ss || typeof ss.getCommandLoaders !== 'function' ) {
					return [];
				}
				return [
					...( ss.getCommandLoaders( false ) || [] ),
					...( ss.getCommandLoaders( true ) || [] ),
				];
			}, [] );
			const staticCmds = useSelect( ( s: ( store: string ) => unknown ) => {
				const ss = s( 'core/commands' ) as any;
				if ( ! ss || typeof ss.getCommands !== 'function' ) {
					return [];
				}
				return [
					...( ss.getCommands( false ) || [] ),
					...( ss.getCommands( true ) || [] ),
				];
			}, [] );

			const loadersNames = useMemo( () => {
				return Array.isArray( loaders )
					? loaders.map( ( l: { name?: string } ) => ( l ? l.name || '' : '' ) )
					: [];
			}, [ loaders ] );
			const loadersKey = loadersNames.join( '|' );
			useEffect( () => {
				bucket.loadersList = loadersNames;
				mergeAndPublish();
			}, [ loadersKey ] );

			const staticKey = useMemo(
				() => fingerprint( Array.isArray( staticCmds ) ? staticCmds : [] ),
				[ staticCmds ],
			);
			useEffect( () => {
				bucket.statics = Array.isArray( staticCmds ) ? staticCmds : [];
				mergeAndPublish();
			}, [ staticKey ] );

			if ( ! Array.isArray( loaders ) || loaders.length === 0 ) {
				return null;
			}
			const children: unknown[] = [];
			for ( const loader of loaders ) {
				if ( ! loader || typeof loader.hook !== 'function' ) {
					continue;
				}
				children.push(
					createEl( LoaderSlot, { key: loader.name, loader } ),
				);
			}
			return createEl( el.Fragment || 'div', null, children );
		};

		try {
			this.root = el.createRoot( host );
			this.root.render( createEl( Harvester ) );
		} catch {
			this.mounted = false;
			this.root = null;
			if ( this.host && this.host.parentNode ) {
				this.host.parentNode.removeChild( this.host );
			}
			this.host = null;
		}
	}

	private publish( raw: RawCommand[] ): void {
		const seen: Record< string, boolean > = Object.create( null );
		const classified: Classified[] = [];
		for ( const cmd of raw ) {
			if ( ! cmd || ! cmd.name || ! cmd.label ) {
				continue;
			}
			if ( cmd.disabled ) {
				continue;
			}
			if ( seen[ cmd.name ] ) {
				continue;
			}
			seen[ cmd.name ] = true;
			classified.push( this.classify( cmd ) );
		}

		let key = '';
		for ( const c of classified ) {
			key += `${ c.name }|${ c.kind }|${ c.url || '' }\n`;
		}
		if ( key === this.lastFingerprint ) {
			return;
		}
		this.lastFingerprint = key;

		unregisterByOwner( OWNER );

		for ( const c of classified ) {
			if ( c.kind === 'skip' ) {
				continue;
			}
			const slug = `global-${ c.name.toLowerCase().replace( /[^a-z0-9_-]+/g, '-' ) }`;
			const icon = this.iconFor( c );
			const def: DesktopCommand = {
				slug,
				label: c.label,
				description: c.kind === 'navigate' ? siteEditorDescription( c.name ) : undefined,
				icon,
				iconSvg: c.iconSvg && c.iconSvg !== '' ? sanitizeIconSvg( c.iconSvg ) : undefined,
				owner: OWNER,

				run: c.kind === 'navigate' && c.url
					? this.runNavigate( c.url, c.windowTitle || c.label, icon )
					: this.runInvoke( c.name ),
			};
			try {
				registerCommand( def );
			} catch ( err ) {
				console.error(
					'[openstation] shell-harvester: dropping bad command',
					def,
					err,
				);
			}
		}
	}

	private classify( cmd: RawCommand ): Classified {
		const out: Classified = {
			name: String( cmd.name ),
			label: String( cmd.label ),
			icon: typeof cmd.icon === 'string' ? cmd.icon : undefined,
			iconSvg: undefined,
			kind: 'action',
			url: undefined,
			callback: typeof cmd.callback === 'function' ? cmd.callback : undefined,
		};

		const cached = this.kindCache[ out.name ];
		if ( cached ) {
			out.kind = cached.kind;
			out.url = cached.url;
			out.iconSvg = cached.iconSvg;
			out.windowTitle = cached.windowTitle;
			return out;
		}

		if ( cmd.icon && typeof cmd.icon !== 'string' ) {
			out.iconSvg = this.renderIcon( cmd.icon );
		}

		const menuEntry = lookupMenuCommand( out.name );
		if ( menuEntry ) {
			try {
				out.url = new URL( menuEntry.url, this.adminUrl ).toString();
				out.kind = 'navigate';
				if ( menuEntry.label !== '' ) {
					out.windowTitle = menuEntry.label;
				}
			} catch {
				out.kind = 'skip';
			}
			this.kindCache[ out.name ] = {
				kind: out.kind,
				url: out.url,
				iconSvg: out.iconSvg,
				windowTitle: out.windowTitle,
			};
			return out;
		}

		if ( typeof cmd.callback === 'function' ) {
			let src = '';
			try {
				src = Function.prototype.toString.call( cmd.callback );
			} catch {
				src = '';
			}

			const literal =
				src.match( NAV_HREF_LITERAL_RE ) ||
				src.match( NAV_ASSIGN_LITERAL_RE ) ||
				src.match( NAV_CALL_LITERAL_RE );
			if ( literal && literal[ 1 ] ) {
				try {
					out.url = new URL( literal[ 1 ], window.location.href ).toString();
					out.kind = 'navigate';
				} catch {
					out.kind = 'action';
				}
			} else if ( NAV_INTENT_RE.test( src ) ) {
				const isSiteEditorIntent = SITE_EDITOR_INTENT_RE.test( src );
				const nameMatch = isSiteEditorIntent
					? out.name.match( SITE_EDITOR_NAME_RE )
					: null;
				if ( nameMatch ) {
					const entityType = nameMatch[ 1 ];
					const entityId = nameMatch[ 2 ];
					const p = `/${ entityType }/${ entityId }`;
					try {
						const siteEditor = new URL( 'site-editor.php', this.adminUrl );
						siteEditor.searchParams.set( 'p', p );
						siteEditor.searchParams.set( 'canvas', 'edit' );
						out.url = siteEditor.toString();
						out.kind = 'navigate';
					} catch {
						out.kind = 'skip';
					}
				} else {
					out.kind = 'skip';
				}
			}
		}

		this.kindCache[ out.name ] = {
			kind: out.kind,
			url: out.url,
			iconSvg: out.iconSvg,
		};
		return out;
	}

	private renderIcon( icon: unknown ): string {
		const wp = ( window as any ).wp;
		if ( ! wp || ! wp.element || typeof wp.element.renderToString !== 'function' ) {
			return '';
		}
		try {
			const rendered = wp.element.renderToString( icon );
			if (
				typeof rendered === 'string' &&
				rendered.toLowerCase().startsWith( '<svg' )
			) {
				return rendered;
			}
		} catch {

		}
		return '';
	}

	private iconFor( c: Classified ): string {
		if ( c.icon && c.icon.startsWith( 'dashicons-' ) ) {
			return c.icon;
		}
		return c.kind === 'navigate' ? 'dashicons-external' : 'dashicons-arrow-right-alt';
	}

	private runNavigate(
		url: string,
		title: string,
		icon: string,
	): DesktopCommand[ 'run' ] {
		return ( _args, ctx ) => {
			ctx.close();

			if ( tryNativeUrlRemap( url ) ) {
				return;
			}
			const id = deriveWindowId( url, this.adminUrl );
			this.manager.open( { id, baseId: id, url, title: this.titleForUrl?.( url ) || title, icon } );
		};
	}

	private runInvoke( name: string ): DesktopCommand[ 'run' ] {
		return ( _args, ctx ) => {
			const cb = this.callbackCache[ name ];
			if ( typeof cb !== 'function' ) {
				throw new Error(
					sprintf(

						__( 'No live callback for command “%s” — the palette and the command registry are out of step. Reload the page.' ),
						name,
					),
				);
			}
			cb( { close: () => ctx.close() } );
		};
	}
}
