import loader from '@monaco-editor/loader';

import { registerPhpProviders } from './providers/php';

import type * as Monaco from 'monaco-editor';

export interface CodeEditorConfig {
	monacoVendorUrl: string;
	pluginUrl: string;
	restNonce: string;
	treeUrl: string;
	fileUrl: string;
	phpSymbolsUrl: string;
	phpSymbolUrl: string;
}

declare global {
	interface Window {
		openStationCodeEditorConfig?: CodeEditorConfig;
	}
}

let cached: typeof Monaco | null = null;
let pending: Promise< typeof Monaco > | null = null;

function installWorkerEnvironment( monacoVendorUrl: string ): void {

	const workerMainUrl = `${ monacoVendorUrl }/base/worker/workerMain.js`;

	const baseUrl = monacoVendorUrl.replace( /\/vs$/, '' );

	const proxy = `
		self.MonacoEnvironment = { baseUrl: '${ baseUrl }' };
		importScripts('${ workerMainUrl }');
	`;

	( self as unknown as {
		MonacoEnvironment?: { getWorkerUrl: ( m: string, l: string ) => string };
	} ).MonacoEnvironment = {
		getWorkerUrl: () =>
			URL.createObjectURL(
				new Blob( [ proxy ], { type: 'text/javascript' } ),
			),
	};
}

export async function loadMonaco(): Promise< typeof Monaco > {
	if ( cached ) {
		return cached;
	}
	if ( pending ) {
		return pending;
	}

	const config = window.openStationCodeEditorConfig;
	if ( ! config?.monacoVendorUrl ) {
		throw new Error(
			'os-code-editor: monacoVendorUrl missing from openStationCodeEditorConfig — is window.php enqueued?',
		);
	}

	installWorkerEnvironment( config.monacoVendorUrl );

	loader.config( {
		paths: { vs: config.monacoVendorUrl },
	} );

	pending = loader.init().then( ( monaco ) => {
		cached = monaco as unknown as typeof Monaco;
		configureLanguageServices( cached );
		registerPhpProviders( cached );
		return cached;
	} );

	return pending;
}

function configureLanguageServices( monaco: typeof Monaco ): void {
	const ts = monaco.languages.typescript;

	const compilerOptions = {
		target: ts.ScriptTarget.ES2020,
		module: ts.ModuleKind.ESNext,
		jsx: ts.JsxEmit.React,
		jsxFactory: 'React.createElement',
		jsxFragmentFactory: 'React.Fragment',
		moduleResolution: ts.ModuleResolutionKind.NodeJs,
		allowJs: true,
		allowNonTsExtensions: true,
		esModuleInterop: true,
		isolatedModules: true,
		resolveJsonModule: true,
		strict: false,
	};

	ts.typescriptDefaults.setCompilerOptions( compilerOptions );
	ts.javascriptDefaults.setCompilerOptions( compilerOptions );

	ts.typescriptDefaults.setDiagnosticsOptions( {
		noSemanticValidation: false,
		noSyntaxValidation: false,

		diagnosticCodesToIgnore: [ 2307, 2304 ],
	} );
	ts.javascriptDefaults.setDiagnosticsOptions( {
		noSemanticValidation: false,
		noSyntaxValidation: false,
		diagnosticCodesToIgnore: [ 2307, 2304 ],
	} );
}
