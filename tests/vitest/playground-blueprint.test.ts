/**
 * The public Playground Blueprint is a stock OpenStation install.
 *
 * Keep demo extensions, feature mutations, and must-use-plugin staging out of
 * this file. The public link should always resolve fresh WordPress plus the
 * latest released OpenStation package, with no hidden demo behaviour.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

interface BlueprintStep {
	step: string;
	pluginData?: {
		resource?: string;
		url?: string;
	};
	options?: {
		activate?: boolean;
	};
	path?: string;
}

interface Blueprint {
	$schema: string;
	landingPage: string;
	preferredVersions: {
		php: string;
		wp: string;
	};
	features: {
		networking: boolean;
	};
	siteOptions: {
		blogname: string;
	};
	steps: BlueprintStep[];
}

const ROOT = resolve( __dirname, '../..' );
const BLUEPRINT = JSON.parse(
	readFileSync(
		resolve( ROOT, '.wordpress-org/blueprints/blueprint.json' ),
		'utf8',
	),
) as Blueprint;
const RELEASE_ARTIFACT_FILES = [
	'.github/workflows/ci.yml',
	'.github/workflows/pr-preview-build.yml',
	'.github/workflows/pr-preview-publish.yml',
	'.github/workflows/release.yml',
	'bin/package.sh',
];

describe( 'public Playground Blueprint', () => {
	test( 'uses current stock WordPress with the OpenStation identity', () => {
		expect( BLUEPRINT.$schema ).toBe(
			'https://playground.wordpress.net/blueprint-schema.json',
		);
		expect( BLUEPRINT.preferredVersions.wp ).toBe( 'latest' );
		expect( BLUEPRINT.siteOptions.blogname ).toBe( 'OpenStation' );
		expect( BLUEPRINT.landingPage ).toBe( '/openstation/' );
		expect( BLUEPRINT.features.networking ).toBe( true );
	} );

	test( 'installs and activates only the latest released OpenStation', () => {
		expect( BLUEPRINT.steps.map( ( step ) => step.step ) ).toEqual( [
			'login',
			'installPlugin',
		] );

		const install = BLUEPRINT.steps[ 1 ];
		expect( install.pluginData ).toEqual( {
			resource: 'url',
			url: 'https://github.com/WordPress/openstation/releases/latest/download/openstation.zip',
		} );
		expect( install.options ).toEqual( { activate: true } );
	} );

	test( 'does not stage extensions or must-use plugins', () => {
		expect( BLUEPRINT.steps ).toHaveLength( 2 );
		expect(
			BLUEPRINT.steps.some(
				( step ) =>
					step.step === 'writeFile' ||
					step.step === 'runPHP' ||
					step.path?.includes( '/mu-plugins/' ),
			),
		).toBe( false );
	} );

	test( 'publishes the branded artifact used by the Blueprint URL', () => {
		for ( const file of RELEASE_ARTIFACT_FILES ) {
			const source = readFileSync( resolve( ROOT, file ), 'utf8' );
			expect( source, file ).toContain( 'openstation.zip' );
			expect( source, file ).not.toContain( 'desktop-mode.zip' );
		}
	} );
} );
