const assert = require( 'node:assert/strict' );
const crypto = require( 'node:crypto' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const test = require( 'node:test' );
const vm = require( 'node:vm' );

const base = require(
	'../games/popup-breaker/assets/popup-breaker-0.5.1.js'
);
const game = require(
	'../games/popup-breaker/assets/popup-breaker-0.6.0.js'
);
const root = path.resolve( __dirname, '..' );

function read( relativePath ) {
	return fs.readFileSync( path.join( root, relativePath ), 'utf8' );
}

function sha256( relativePath ) {
	return crypto
		.createHash( 'sha256' )
		.update( fs.readFileSync( path.join( root, relativePath ) ) )
		.digest( 'hex' );
}

test( 'OpenStation carries the byte-identical Studio 0.6.0 level system', () => {
	assert.equal(
		sha256( 'games/popup-breaker/assets/popup-breaker-0.6.0.js' ),
		'9b502c7a916c60a495e968f9b616a6d1444294445ade393900bf07672318f4f4'
	);
	assert.equal(
		sha256( 'standalone/popup-breaker-0.6.0.css' ),
		'9d8a4ab0c3387d7a3c163f0299cbb068a2a5e6ff39745be3c8c284cfd4877792'
	);
	assert.equal(
		sha256(
			'games/popup-breaker/assets/popup-siege-ui-system-0.6.0.json'
		),
		'd1f85d6de5199979adbb3696043639dfbf6a8d2cdc47431c98f1cf75c788b557'
	);
} );

test( '0.6.0 adds progression without changing the arcade rules', () => {
	assert.equal( game.ASSET_VERSION, '0.6.0' );
	assert.equal( game.RULES_VERSION, 2 );
	assert.equal( game.stepGame, base.stepGame );
	assert.equal( game.createGame, base.createGame );
	assert.equal( game.deriveMusicState, base.deriveMusicState );
	assert.equal( game.createPopupSiegeAudio, base.createPopupSiegeAudio );
	assert.equal( game.MUSIC_ID, 'skylog-midnight-mod' );
} );

test( 'four objective levels expose one continuous mastery ladder', () => {
	assert.deepEqual(
		game.LEVELS.map( ( level ) => level.id ),
		[
			'download-trap',
			'toolbar-swarm',
			'malware-boss',
			'archive-sweep',
		]
	);
	assert.equal( game.levelForState( { popupCloses: 0 } ).number, 1 );
	assert.equal( game.levelForState( { popupCloses: 1 } ).number, 2 );
	assert.equal( game.levelForState( { popupCloses: 2 } ).number, 2 );
	assert.equal( game.levelForState( { popupCloses: 3 } ).number, 3 );
	assert.equal( game.levelForState( { popupCloses: 4 } ).number, 4 );
	assert.match(
		game.replayTip( { result: 'rescued', popupCloses: 4 } ),
		/protect every life/
	);
	assert.match(
		game.replayTip( { result: 'overrun', popupCloses: 1 } ),
		/cache burst/
	);
} );

test( 'the OpenStation adapter publishes the deterministic 0.7.0 contract', () => {
	const source = read(
		'games/popup-breaker/assets/openstation-adapter.js'
	);
	const styles = read( 'standalone/popup-breaker.css' );
	const window = {
		desktopModeGames: {},
		document: {},
	};
	vm.runInNewContext( source, window, {
		filename: 'openstation-adapter.js',
	} );
	const definition = window.desktopModeGames[ 'popup-siege' ];

	assert.match( source, /const ASSET_VERSION = '0\.7\.0'/ );
	assert.match( source, /const RULES_VERSION = 3/ );
	assert.match(
		source,
		/const SCRIPT_FILES = Object\.freeze\( \[\s*\[ 'asset', 'popup-siege-runtime-0\.7\.0\.js' \],\s*\] \)/
	);
	assert.match( source, /rules_version: terminal\.rulesVersion/ );
	assert.doesNotMatch( source, /popup-breaker-0\.[0-9.]+\.js/ );
	assert.deepEqual(
		[ ...styles.matchAll( /@import url\("([^"]+)"\);/g ) ].map(
			( match ) => match[ 1 ]
		),
		[ './popup-breaker-0.2.0.css', './popup-breaker-0.7.0.css' ]
	);
	assert.equal( definition.window.width, 900 );
	assert.equal( definition.window.height, 620 );
	assert.equal( definition.window.minWidth, 520 );
	assert.equal( definition.window.minHeight, 480 );
	assert.doesNotMatch( source, /fetch\(|localStorage|sessionStorage/ );
} );

test( 'the 0.6.0 UI system owns progression, replay, and accessibility', () => {
	const styles = read( 'standalone/popup-breaker-0.6.0.css' );
	const manifest = JSON.parse(
		read(
			'games/popup-breaker/assets/popup-siege-ui-system-0.6.0.json'
		)
	);

	assert.equal( manifest.id, 'popup-siege-ui-system-0.6.0' );
	assert.equal( manifest.progression.levels.length, 4 );
	assert.equal( manifest.progression.replayFlow, 'one-click' );
	assert.match( styles, /\.siege-game--level-system-060/ );
	assert.match( styles, /\.siege-level-badge/ );
	assert.match( styles, /\.siege-level-journey/ );
	assert.match( styles, /\.siege-replay-pitch/ );
	assert.match(
		styles,
		/\[data-role="result-title"\]:focus\s*\{\s*outline:\s*none/
	);
	assert.match(
		styles,
		/\[data-role="result-copy"\]\s*\{\s*display:\s*none/
	);
	assert.match( styles, /@media \(prefers-reduced-motion: reduce\)/ );
	assert.match( styles, /@media \(forced-colors: active\)/ );
	assert.match( styles, /\.siege-level-toast[\s\S]*transition:\s*none/ );
	assert.match( styles, /\.siege-level-badge,[\s\S]*background:\s*Canvas/ );
	assert.ok(
		styles.lastIndexOf( '@media (forced-colors: active)' ) >
			styles.indexOf( '@container' )
	);
} );
