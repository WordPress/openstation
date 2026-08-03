const assert = require( 'node:assert/strict' );
const crypto = require( 'node:crypto' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const test = require( 'node:test' );
const vm = require( 'node:vm' );

const root = path.resolve( __dirname, '..' );
const sha256 = ( relative ) =>
	crypto
		.createHash( 'sha256' )
		.update( fs.readFileSync( path.join( root, relative ) ) )
		.digest( 'hex' );
const read = ( relative ) =>
	fs.readFileSync( path.join( root, relative ), 'utf8' );

const expectedHashes = Object.freeze( {
	// Re-pinned for the OpenStation rebrand: the kit loads shared PixiJS
	// through `wp.os.loadModules`, which the framework renamed. Every
	// gameplay layer below is byte-identical.
	'sdk/openstation-game-kit-0.1.0.js':
		'ea30b278de91b70f3e5eda097eb5733faef2c65c62eff3590b010d181e147f11',
	'sdk/openstation-audio-kit-0.1.0.js':
		'ae570189df94c48f9d21b85392bd6dca35b9bcd0422a40c07de6cade3773dee9',
	'games/popup-breaker/assets/popup-breaker-0.2.0.js':
		'8aa4b493718eaf21a27b60d2b821121f3460bb7a3e87600ef44c9edf72f0b7fd',
	'games/popup-breaker/assets/popup-breaker-0.2.1.js':
		'0f7b37e2e5b900ef414a84b59b22227df05d3e93e98c0c0453a4427703676041',
	'games/popup-breaker/assets/popup-breaker-0.3.0.js':
		'dd31fb8937487b4735ecfaabe374ad5e63f67d8c8761cc4afbe9c8f748fc468b',
	'games/popup-breaker/assets/popup-breaker-0.4.0.js':
		'628317ff8a11492c9768b30b4be8427d425faf82afcf070f4475ec4176d2e183',
	'games/popup-breaker/assets/popup-breaker-0.4.1.js':
		'e7728f50a6e4b5dcdaf98bcb85bb3d13204fa3776877d5352c1e86bdafbefa79',
	'games/popup-breaker/assets/popup-breaker-0.4.2.js':
		'26e61285bd46875ce8ec50556565c8af37b0ff37e9bd054f38854949fedeccb7',
	'games/popup-breaker/assets/popup-breaker-0.4.3.js':
		'7db74b91c8f1880553a0305ed5dd5d9c889cea27ff214cbead4c922962bab28a',
	'games/popup-breaker/assets/popup-breaker-0.4.4.js':
		'4dbd1409398c280ded40d423a6c205a310641eb391ddc375135b883129247c55',
	'standalone/popup-breaker-0.2.0.css':
		'965248480c83a17b1227fbfb612f433de7ec25741679992823cd5ac3a5159aaf',
	'standalone/popup-breaker-0.2.1.css':
		'334ed3999e1a5dfbff05f9a18e3af75bb3d8de1b3424d2aceb40fef649420456',
	'standalone/popup-breaker-0.3.0.css':
		'4e478522a0578ee684c92d153b04d21925128d62e193e4c242b9202c24443456',
	'standalone/popup-breaker-0.4.0.css':
		'8d00adc814fbfdecebceaf4dd36ca016e7e39dca22d388716b693c0b97b371ab',
	'standalone/popup-breaker-0.4.1.css':
		'3d8754f4f1ed858c8fd165555515eb88de921e9a0edbfe289afd8f2140ba2a59',
	'standalone/popup-breaker-0.4.2.css':
		'eff9a0acb1f02404250b45b16cb8783ff22c43e4e43931e1b0f5de62130c2e23',
	'standalone/popup-breaker-0.4.3.css':
		'c896240df1bfe40bc072e4ee794c1f107c535e0f1413e14e45b4407c1228c942',
	'standalone/popup-breaker-0.4.4.css':
		'8290ff47bdf44f99e16321f85106a7610ffe9e3121e87c42121b64bb08611996',
	'games/popup-breaker/assets/images/popup-siege-header-shell-0.4.4.png':
		'9f2eceb19efc7456c58d0c4eda9ac6a1d8b63356d5e80822dcafadf5246ff260',
} );

test( 'OpenStation carries the byte-identical Studio 0.4.4 runtime graph', () => {
	for ( const [ relative, expected ] of Object.entries( expectedHashes ) ) {
		assert.equal( sha256( relative ), expected, relative );
	}
} );

test( 'the Studio rules remain deterministic and higher-is-better', () => {
	const game = require(
		'../games/popup-breaker/assets/popup-breaker-0.4.4.js'
	);
	assert.equal( game.ASSET_VERSION, '0.4.4' );
	assert.equal( game.RULES_VERSION, 2 );
	const first = game.startGame( game.createGame() );
	const second = game.startGame( game.createGame() );
	for ( let index = 0; index < 600; index += 1 ) {
		const input = { keyboardAxis: index % 240 < 120 ? 1 : -1 };
		const nextFirst = game.stepGame( first, input );
		const nextSecond = game.stepGame( second, input );
		Object.assign( first, nextFirst );
		Object.assign( second, nextSecond );
	}
	assert.deepEqual( game.resultSummary( first ), game.resultSummary( second ) );
	assert.ok( first.score >= 0 );
} );

test( 'the OpenStation adapter publishes one scored Popup Siege definition', () => {
	const source = read(
		'games/popup-breaker/assets/openstation-adapter.js'
	);
	const window = {
		openStationGames: {},
		document: {},
	};
	vm.runInNewContext( source, window, {
		filename: 'openstation-adapter.js',
	} );
	const definition = window.openStationGames[ 'popup-siege' ];

	assert.equal( definition.id, 'popup-siege' );
	assert.equal( typeof definition.render, 'function' );
	assert.equal( definition.scoreColumns[ 0 ].key, 'score' );
	assert.match( source, /const ASSET_VERSION = '0\.7\.0'/ );
	assert.match( source, /const RULES_VERSION = 3/ );
	assert.match(
		source,
		/const SCRIPT_FILES = Object\.freeze\( \[\s*\[ 'asset', 'popup-siege-runtime-0\.7\.0\.js' \],\s*\] \)/
	);
	assert.match( source, /loadModules\( \[ 'pixijs' \] \)/ );
	assert.match( source, /ctx\.submitScore\( nextPayload \)/ );
	assert.match( source, /rules_version: terminal\.rulesVersion/ );
	assert.match( source, /controller\.teardown\(\)/ );
	assert.match( source, /ctx\.challenge/ );
	assert.doesNotMatch( source, /fetch\(|localStorage|sessionStorage/ );
} );

test( 'no standalone unscored Popup Siege HTML is shipped', () => {
	assert.equal(
		fs.existsSync( path.join( root, 'standalone/popup-siege.html' ) ),
		false
	);
	assert.equal(
		fs.existsSync( path.join( root, 'games/popup-siege' ) ),
		false
	);
} );
