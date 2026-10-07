import { defineConfig, transformWithEsbuild } from 'vite';
import ts from 'typescript';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { visualizer } from 'rollup-plugin-visualizer';

function stripStaticHelpInProd( enabled ) {
	if ( ! enabled ) {
		return null;
	}
	return {
		name: 'openstation-strip-static-help',
		enforce: 'pre',
		apply: 'build',
		transform( code, id ) {
			if ( ! id.endsWith( '.ts' ) ) {
				return null;
			}
			if ( ! id.includes( '/src/ui/components/' ) ) {
				return null;
			}
			const marker = 'static help';
			let start = code.indexOf( marker );
			if ( start < 0 ) {
				return null;
			}
			const eq = code.indexOf( '=', start );
			const braceOpen = code.indexOf( '{', eq );
			if ( eq < 0 || braceOpen < 0 || braceOpen - start > 32 ) {
				return null;
			}
			let depth = 1;
			let i = braceOpen + 1;
			while ( i < code.length && depth > 0 ) {
				const ch = code[ i ];
				if ( ch === '{' ) {
					depth++;
					i++;
				} else if ( ch === '}' ) {
					depth--;
					i++;
				} else if ( ch === '"' || ch === "'" || ch === '`' ) {
					const q = ch;
					i++;
					while ( i < code.length && code[ i ] !== q ) {
						if ( code[ i ] === '\\' ) {
							i += 2;
						} else {
							i++;
						}
					}
					i++;
				} else if ( ch === '/' && code[ i + 1 ] === '/' ) {
					const nl = code.indexOf( '\n', i );
					i = nl < 0 ? code.length : nl + 1;
				} else if ( ch === '/' && code[ i + 1 ] === '*' ) {
					const end = code.indexOf( '*/', i + 2 );
					i = end < 0 ? code.length : end + 2;
				} else {
					i++;
				}
			}

			let blockEnd = i;
			while ( blockEnd < code.length && code[ blockEnd ] !== ';' && code[ blockEnd ] !== '\n' ) {
				blockEnd++;
			}
			if ( code[ blockEnd ] === ';' ) {
				blockEnd++;
			}
			const replacement = 'static help = void 0;';
			const out = code.slice( 0, start ) + replacement + code.slice( blockEnd );
			return { code: out, map: null };
		},
	};
}

function minifyCssTemplates() {

	const minifyCssChunk = ( text ) =>
		text
			.replace( /\/\*[\s\S]*?\*\//g, '' )
			.replace( /\s+/g, ' ' )
			.replace( /\s*([{}:;,>])\s*/g, '$1' )
			.replace( /;}/g, '}' );

	return {
		name: 'openstation-minify-css-templates',
		enforce: 'pre',
		apply: 'build',
		transform( code, id ) {
			if ( ! id.endsWith( '.ts' ) ) {
				return null;
			}
			if ( ! code.includes( 'css`' ) ) {
				return null;
			}

			let out = '';
			let i = 0;
			let changed = false;
			while ( i < code.length ) {

				const m = code.indexOf( 'css`', i );
				if ( m < 0 ) {
					out += code.slice( i );
					break;
				}
				const prev = m === 0 ? '' : code[ m - 1 ];
				if ( /[A-Za-z0-9_$.]/.test( prev ) ) {

					out += code.slice( i, m + 4 );
					i = m + 4;
					continue;
				}
				out += code.slice( i, m + 4 );
				let j = m + 4;
				let segStart = j;
				let interpStart = -1;
				let interpDepth = 0;
				let closed = false;
				while ( j < code.length ) {
					const ch = code[ j ];
					if ( interpDepth === 0 ) {
						if ( ch === '\\' ) {
							j += 2;
							continue;
						}
						if ( ch === '`' ) {
							out += minifyCssChunk( code.slice( segStart, j ) );
							out += '`';
							i = j + 1;
							changed = true;
							closed = true;
							break;
						}
						if ( ch === '$' && code[ j + 1 ] === '{' ) {
							out += minifyCssChunk( code.slice( segStart, j ) );
							interpStart = j;
							interpDepth = 1;
							j += 2;
							continue;
						}
						j++;
					} else {
						if ( ch === '{' ) {
							interpDepth++;
						} else if ( ch === '}' ) {
							interpDepth--;
							if ( interpDepth === 0 ) {
								out += code.slice( interpStart, j + 1 );
								segStart = j + 1;
								interpStart = -1;
							}
						}
						j++;
					}
				}
				if ( ! closed ) {

					out += code.slice( m + 4 );
					i = code.length;
				}
			}
			return changed ? { code: out, map: null } : null;
		},
	};
}

const TARGETS = {
	desktop: {
		entry:    'src/desktop.ts',
		fileBase: 'desktop',

		iifeName: 'openStation',
	},
	'iframe-bridge': {
		entry:    'src/iframe-bridge-standalone.ts',
		fileBase: 'iframe-bridge',
		iifeName: 'openStationIframeBridge',
	},

	'chromeless-bridge': {
		entry:    'src/chromeless-bridge.js',
		fileBase: 'chromeless-bridge',
		iifeName: 'openStationChromelessBridge',
	},

	'gutenberg-drop-receiver': {
		entry:    'src/gutenberg-drop-receiver.ts',
		fileBase: 'gutenberg-drop-receiver',
		iifeName: 'openStationGutenbergDropReceiver',
	},

	'my-wordpress-woocommerce': {
		entry:    'src/plugins/my-wordpress-woocommerce/index.ts',
		fileBase: 'my-wordpress-woocommerce',
		iifeName: 'openStationMyWordpressWoo',
	},

	'content-graph': {
		entry:    'src/content-graph/index.ts',
		fileBase: 'content-graph',
		iifeName: 'openStationContentGraph',
	},

	'app-runtime': {
		entry:    'src/app-runtime/index.ts',
		fileBase: 'app-runtime',
		iifeName: 'openStationAppRuntime',
	},

	'user-profile': {
		entry:    'apps/users/profile/index.ts',
		fileBase: 'apps/user-profile',
		iifeName: 'openStationUserProfile',
	},

	games: {
		entry:    'src/games/entry.ts',
		fileBase: 'games',
		iifeName: 'openStationGames',
	},

	'game-inkfall': {
		entry:    'src/games/inkfall/index.ts',
		fileBase: 'game-inkfall',
		iifeName: 'openStationGameInkfall',
	},

	'game-alphabet-soup': {
		entry:    'src/games/alphabet-soup/index.ts',
		fileBase: 'game-alphabet-soup',
		iifeName: 'openStationGameAlphabetSoup',
	},

	'pwa-sw': {
		entry:    'src/pwa/sw.ts',
		fileBase: 'sw',
		iifeName: 'openStationServiceWorker',
	},

	'ai-assistant': {
		entry:    'src/ai-assistant/entry.ts',
		fileBase: 'ai-assistant',
		iifeName: 'openStationAiAssistant',
	},

	'animated-logo-wallpaper': {
		entry:    'src/plugins/animated-logo-wallpaper/index.ts',
		fileBase: 'animated-logo-wallpaper',
		iifeName: 'openStationAnimatedLogoWallpaper',
	},

	'living-tree-wallpaper': {
		entry:    'src/plugins/living-tree-wallpaper/index.ts',
		fileBase: 'living-tree-wallpaper',
		iifeName: 'openStationLivingTreeWallpaper',
	},

	'snow-wallpaper': {
		entry:    'src/plugins/snow-wallpaper/index.ts',
		fileBase: 'snow-wallpaper',
		iifeName: 'openStationSnowWallpaper',
	},

	mio: {
		entry:    'src/mio/entry.ts',
		fileBase: 'mio',
		iifeName: 'openStationMio',
	},

	'item-visibility-menu': {
		entry:    'src/item-visibility-menu-entry.ts',
		fileBase: 'item-visibility-menu',
		iifeName: 'openStationItemVisibilityMenu',
	},

	'workspace-wizard': {
		entry:    'src/workspaces/wizard-entry.ts',
		fileBase: 'workspace-wizard',
		iifeName: 'openStationWorkspaceWizardBundle',
	},

	'release-card': {
		entry:    'src/release-card-entry.ts',
		fileBase: 'release-card',
		iifeName: 'openStationReleaseCardBundle',
	},

	'shell-tour': {
		entry:    'src/shell-tour/entry.ts',
		fileBase: 'shell-tour',
		iifeName: 'openStationShellTourBundle',
	},

	'deactivation-feedback': {
		entry:    'src/deactivation-feedback/entry.ts',
		fileBase: 'deactivation-feedback',
		iifeName: 'openStationDeactivationFeedbackBundle',
	},

	'usage-feedback': {
		entry:    'src/usage-feedback/entry.ts',
		fileBase: 'usage-feedback',
		iifeName: 'openStationUsageFeedbackBundle',
	},

	'shell-overlays': {
		entry:    'src/shell-overlays/entry.ts',
		fileBase: 'shell-overlays',
		iifeName: 'openStationShellOverlays',
	},

	'file-drop': {
		entry:    'src/os-file-drop/entry.ts',
		fileBase: 'file-drop',
		iifeName: 'openStationFileDrop',
	},

	'files-overlays': {
		entry:    'src/desktop-files/overlays-entry.ts',
		fileBase: 'files-overlays',
		iifeName: 'openStationFilesOverlays',
	},

	'notes': {
		entry:    'src/notes/entry.ts',
		fileBase: 'notes',
		iifeName: 'openStationNotes',
	},

	'dock-constellation': {
		entry:    'src/dock-constellation/entry.ts',
		fileBase: 'dock-constellation',
		iifeName: 'openStationDockConstellation',
	},

	'window-link-visuals': {
		entry:    'src/window-links/visuals-entry.ts',
		fileBase: 'window-link-visuals',
		iifeName: 'openStationWindowLinkVisuals',
	},

	components: {
		entry:    'src/ui/components/entry.ts',
		fileBase: 'os-components',
		iifeName: 'openStationComponentKit',
	},

	'window-system': {
		entry:    'src/window-system/entry.ts',
		fileBase: 'window-system',
		iifeName: 'openStationWindowSystemBundle',
	},

	mobile: {
		entry:    'src/mobile/entry.ts',
		fileBase: 'mobile',
		iifeName: 'openStationMobileBundle',
	},

	'widget-heartbeat': {
		entry:    'src/plugins/heartbeat-widget/index.ts',
		fileBase: 'widget-heartbeat',
		iifeName: 'openStationHeartbeatWidget',
	},
	'widget-recent-comments': {
		entry:    'src/plugins/recent-comments-widget/index.ts',
		fileBase: 'widget-recent-comments',
		iifeName: 'openStationRecentCommentsWidget',
	},
	'widget-drafts': {
		entry:    'src/plugins/drafts-widget/index.ts',
		fileBase: 'widget-drafts',
		iifeName: 'openStationDraftsWidget',
	},
	'widget-post-stats': {
		entry:    'src/plugins/post-stats-widget/index.ts',
		fileBase: 'widget-post-stats',
		iifeName: 'openStationPostStatsWidget',
	},
	'widget-site-views': {
		entry:    'src/plugins/site-views-widget/index.ts',
		fileBase: 'widget-site-views',
		iifeName: 'openStationSiteViewsWidget',
	},

	'widget-jazz-quote': {
		entry:    'src/plugins/jazz-quote-widget/index.ts',
		fileBase: 'widget-jazz-quote',
		iifeName: 'openStationJazzQuoteWidget',
	},
	'widget-starter': {
		entry:    'src/plugins/starter-widget/index.ts',
		fileBase: 'widget-starter',
		iifeName: 'openStationStarterWidget',
	},

	'widget-notes': {
		entry:    'src/plugins/notes-widget/index.ts',
		fileBase: 'widget-notes',
		iifeName: 'openStationNotesWidget',
	},

	'widget-focus-timer': {
		entry:    'src/plugins/focus-timer-widget/index.ts',
		fileBase: 'widget-focus-timer',
		iifeName: 'openStationFocusTimerWidget',
	},

	'agent-run-window': {
		entry:    'src/agent-run-window.ts',
		fileBase: 'agent-run-window',
		iifeName: 'openStationAgentRunWindow',
	},

};

function discoverAppTargets() {
	const out = {};
	const appsDir = resolve( __dirname, 'apps' );
	if ( ! existsSync( appsDir ) ) {
		return out;
	}
	for ( const dir of readdirSync( appsDir ) ) {
		const full = resolve( appsDir, dir );
		if ( ! statSync( full ).isDirectory() ) {
			continue;
		}
		for ( const file of readdirSync( full ) ) {
			if ( ! file.endsWith( '.os.ts' ) ) {
				continue;
			}
			const name = file.slice( 0, -'.os.ts'.length );
			out[ `app:${ name }` ] = {
				entry:    `apps/${ dir }/${ file }`,
				fileBase: `apps/${ name }`,
				iifeName: 'openStationApp_' + name.replace( /[^a-zA-Z0-9]+(.)?/g, ( _m, c ) => ( c ? c.toUpperCase() : '' ) ),
			};
		}
	}
	return out;
}

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';
	const targetKey = process.env.OPENSTATION_TARGET || 'desktop';
	const target = TARGETS[ targetKey ] || discoverAppTargets()[ targetKey ];
	if ( ! target ) {
		throw new Error(
			`vite.config.js: unknown OPENSTATION_TARGET="${ targetKey }". ` +
				`Expected one of: ${ Object.keys( TARGETS ).join( ', ' ) }.`,
		);
	}

	const wantReport = process.env.BUNDLE_REPORT === '1' && isProd;
	const reportPlugins = wantReport
		? [
			visualizer( {
				filename: `assets/js/${ target.fileBase }.report.html`,
				template: 'treemap',
				gzipSize: true,
				brotliSize: false,
				sourcemap: false,
				emitFile: false,
				open: false,
			} ),
		]
		: [];

	return {
		plugins: [
			{
				name: 'openstation-remove-bundle-comments',
				async generateBundle( _options, bundle ) {
					const printer = ts.createPrinter( { removeComments: true } );
					for ( const output of Object.values( bundle ) ) {
						if ( output.type === 'chunk' ) {
							const code = printer.printFile( ts.createSourceFile(
								output.fileName, output.code, ts.ScriptTarget.Latest,
								true, ts.ScriptKind.JS
							) );
							output.code = isProd ? ( await transformWithEsbuild( code, output.fileName, {
								minify: true, legalComments: 'none', target: 'es2020',
							} ) ).code : code;
						}
					}
				},
			},
			minifyCssTemplates(),
			stripStaticHelpInProd( isProd ),
			...reportPlugins,
		].filter( Boolean ),
		resolve: {
			alias: {
				'@/':              resolve( __dirname, 'src/' ) + '/',
				'@api/':           resolve( __dirname, 'src/api/' ) + '/',
				'@boot/':          resolve( __dirname, 'src/boot/' ) + '/',
				'@core/':          resolve( __dirname, 'src/core/' ) + '/',
				'@features/':      resolve( __dirname, 'src/features/' ) + '/',
				'@layout/':        resolve( __dirname, 'src/layout/' ) + '/',
				'@protocol/':      resolve( __dirname, 'src/protocol/' ) + '/',
				'@ui/':            resolve( __dirname, 'src/ui/' ) + '/',
				'@window-system/': resolve( __dirname, 'src/window-system/' ) + '/',

				'@openstation/app': resolve( __dirname, 'src/app-runtime/client.ts' ),
			},
		},
		build: {
			outDir: 'assets/js',

			emptyOutDir: false,
			target: 'es2020',

			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( __dirname, target.entry ),

				formats: [ 'iife' ],
				name: target.iifeName,
				fileName: () =>
					isProd
						? `${ target.fileBase }.min.js`
						: `${ target.fileBase }.js`,
			},
			rollupOptions: {
				output: {

					exports: 'named',

					assetFileNames: ( asset ) => {
						if ( asset.name && asset.name.endsWith( '.css' ) ) {
							return isProd
								? `${ target.fileBase }.min.css`
								: `${ target.fileBase }.css`;
						}
						return '[name].[hash][extname]';
					},
				},
			},
		},
	};
} );
