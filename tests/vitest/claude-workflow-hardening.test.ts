import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve( __dirname, '../..' );
const WORKFLOW = readFileSync(
	resolve( ROOT, '.github/workflows/claude.yml' ),
	'utf8'
);

function tracked( prefix: string ): Array< [ string, string ] > {
	const out = execFileSync(
		'git',
		[ 'ls-files', '--stage', '--', prefix ],
		{ cwd: ROOT, encoding: 'utf8' }
	);
	return out
		.split( '\n' )
		.filter( Boolean )
		.map( ( line ) => {

			const [ meta, path ] = line.split( '\t' );
			return [ meta.split( ' ' )[ 0 ], path ];
		} );
}

function withInput( key: string ): string {
	const match = WORKFLOW.match( new RegExp( `^\\s+${ key }:(.*)$`, 'm' ) );
	expect( match, `claude.yml passes \`${ key }\` to the action` ).not.toBeNull();
	return ( match as RegExpMatchArray )[ 1 ].trim();
}

describe( 'trusted Claude configuration is made of regular files', () => {
	test( 'nothing tracked under .claude/ is a symlink', () => {
		const links = tracked( '.claude' ).filter( ( [ mode ] ) => '120000' === mode );
		expect( links, 'symlinks tracked under .claude/' ).toEqual( [] );
	} );

	test( 'the project skills live under .claude/skills/ themselves', () => {
		const files = tracked( '.claude/skills' ).map( ( [ , path ] ) => path );
		expect( files ).toContain( '.claude/skills/pixijs/SKILL.md' );

		expect( tracked( '.agents' ) ).toEqual( [] );
	} );
} );

describe( 'claude.yml keeps a fork checkout from executing anything', () => {
	test( 'skill shell expansion is disabled by policy for every source', () => {

		const match = WORKFLOW.match( /^\s+settings:\s*\|\n((?:[ \t]+\S.*\n?)+)/m );
		expect( match, 'claude.yml passes a `settings` block' ).not.toBeNull();
		const settings = JSON.parse( ( match as RegExpMatchArray )[ 1 ] ) as Record< string, unknown >;
		expect( settings.disableSkillShellExecution ).toBe( true );
	} );

	test( 'skills, slash commands and project memory are off on a fork pull request', () => {

		const args = withInput( 'claude_args' );
		const onFork = args.match( /steps\.origin\.outputs\.fork == 'true' && (.*) \|\|/ );
		expect( onFork, 'claude_args is gated on the fork test' ).not.toBeNull();
		const flags = ( onFork as RegExpMatchArray )[ 1 ];
		expect( flags ).toContain( '--disable-slash-commands' );

		expect( flags ).toMatch( /--setting-sources user\b/ );
		expect( flags ).not.toMatch( /--setting-sources [^ ']*project/ );

		expect( flags ).toContain( '--append-system-prompt-file' );
		expect( flags ).toContain( 'steps.guide.outputs.path' );
	} );

	test( 'the guide a fork run gets is built from the default branch', () => {
		const step = WORKFLOW.match( /- name: Collect the trusted agent guide\n([\s\S]*?)\n\n\s+- name:/ );
		expect( step, 'claude.yml has the guide step' ).not.toBeNull();
		const body = ( step as RegExpMatchArray )[ 1 ];
		expect( body ).toMatch( /^\s+id: guide$/m );
		expect( body ).toMatch( /^\s+if: steps\.origin\.outputs\.fork == 'true'$/m );

		expect( body ).toContain( 'git fetch --depth 1 --no-recurse-submodules origin "$DEFAULT_BRANCH"' );
		expect( body ).toContain( 'git show "FETCH_HEAD:CLAUDE.md"' );

		expect( body ).toContain( 'git show "FETCH_HEAD:${line#@}"' );
		expect( body ).toContain( 'set -euo pipefail' );
		expect( body ).toMatch( /echo "path=\$out" >> "\$GITHUB_OUTPUT"/ );

		const includes = readFileSync( resolve( ROOT, 'CLAUDE.md' ), 'utf8' )
			.split( '\n' )
			.filter( ( l ) => l.startsWith( '@' ) );
		expect( includes.length ).toBeGreaterThan( 0 );
		for ( const inc of includes ) {
			expect( inc ).toMatch( /^@[\w./-]+$/ );
		}
	} );

	test( 'a fork pull request never sees a write-capable GitHub token', () => {

		expect( WORKFLOW ).toMatch( /^\s+contents: read\s*$/m );
		expect( WORKFLOW ).not.toMatch( /^\s+contents: write/m );
		const token = withInput( 'github_token' );
		expect( token ).toMatch(
			/steps\.origin\.outputs\.fork == 'true' && github\.token/
		);

		expect( WORKFLOW ).toContain( 'set -euo pipefail' );
	} );
} );
