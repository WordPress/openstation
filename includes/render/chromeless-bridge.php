<?php

defined( 'ABSPATH' ) || exit;

function openstation_chromeless_offset_neutralizer_script() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	$top_values = apply_filters(
		'openstation_chromeless_admin_bar_top_values',
		array( '32px', '46px' )
	);

	$config = wp_json_encode(
		array(
			'tops' => array_values( array_filter( array_map( 'strval', (array) $top_values ) ) ),
		)
	);
	if ( false === $config ) {
		return;
	}

	$js  = '(function(C){';
	$js .= 'var TOPS={};';
	$js .= 'for(var t=0;t<C.tops.length;t++){TOPS[C.tops[t]]=1;}';
	$js .= 'function fixOne(el){';
	$js .= 'if(!el||el.nodeType!==1)return;';
	$js .= 'var cs;';
	$js .= 'try{cs=getComputedStyle(el);}catch(_e){return;}';
	$js .= "if(cs.position==='static')return;";
	$js .= "if(TOPS[cs.top]){el.style.setProperty('top','0px','important');}";
	$js .= '}';
	$js .= 'function walkSubtree(root){';
	$js .= 'if(!root)return;';
	$js .= 'if(root.nodeType===1){fixOne(root);}';
	$js .= "var els=root.querySelectorAll?root.querySelectorAll('*'):[];";
	$js .= 'for(var i=0;i<els.length;i++){fixOne(els[i]);}';
	$js .= '}';

	$js .= 'var queue=[];';
	$js .= 'var scheduled=false;';
	$js .= 'function flush(){';
	$js .= 'scheduled=false;';
	$js .= 'var batch=queue;';
	$js .= 'queue=[];';
	$js .= 'for(var i=0;i<batch.length;i++){';

	$js .= 'if(batch[i].isConnected===false)continue;';
	$js .= 'walkSubtree(batch[i]);';
	$js .= '}';
	$js .= '}';
	$js .= 'function schedule(){';
	$js .= 'if(scheduled)return;';
	$js .= 'scheduled=true;';
	$js .= 'if(window.requestIdleCallback){window.requestIdleCallback(flush,{timeout:500});}';
	$js .= 'else{window.setTimeout(flush,200);}';
	$js .= '}';
	$js .= 'var started=false;';
	$js .= 'function start(){';
	$js .= 'if(started)return;';
	$js .= "if(!document.body||!document.body.classList.contains('os-chromeless'))return;";
	$js .= 'started=true;';
	$js .= 'var MO=window.MutationObserver;';
	$js .= 'if(MO){';
	$js .= 'var observer=new MO(function(records){';
	$js .= 'var found=false;';
	$js .= 'for(var r=0;r<records.length;r++){';
	$js .= 'var rec=records[r];';
	$js .= "if(rec.type!=='childList')continue;";
	$js .= 'var added=rec.addedNodes;';
	$js .= 'for(var n=0;n<added.length;n++){';

	$js .= 'if(added[n].nodeType===1){queue.push(added[n]);found=true;}';
	$js .= '}';
	$js .= '}';
	$js .= 'if(found){schedule();}';
	$js .= '});';
	$js .= 'observer.observe(document.body,{childList:true,subtree:true});';
	$js .= '}';
	$js .= 'walkSubtree(document.body);';

	$js .= 'if(!MO){';
	$js .= "window.addEventListener('load',function(){walkSubtree(document.body);},{once:true});";
	$js .= '}';
	$js .= '}';
	$js .= "if(document.readyState==='loading'){";
	$js .= "document.addEventListener('DOMContentLoaded',start,{once:true});";
	$js .= '}else{';
	$js .= 'start();';
	$js .= '}';
	$js .= '})(' . $config . ');';

	wp_print_inline_script_tag( $js );
}
add_action( 'admin_head', 'openstation_chromeless_offset_neutralizer_script', 1 );

function openstation_chromeless_navigation_ping_script() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	wp_print_inline_script_tag(
		"try{if(window.parent&&window.parent!==window){window.parent.postMessage({type:'os-iframe-navigated',url:window.location.href},window.location.origin);}}catch(e){}"
	);
}
add_action( 'admin_head', 'openstation_chromeless_navigation_ping_script', 1 );

function openstation_emit_menu_refresh_probe() {

	if ( empty( $_GET['openstation_menu_refresh'] ) ) {
		return;
	}
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	$pagenow = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	if ( 'admin.php' !== $pagenow ) {
		return;
	}

	$payload = openstation_menu_refresh_probe_payload();
	$encoded = wp_json_encode( $payload );
	if ( false === $encoded ) {
		return;
	}

	nocache_headers();
	header( 'Content-Type: text/html; charset=utf-8' );

	echo '<!doctype html><html><head><meta charset="utf-8"><title></title></head><body>';
	echo '<script>';
	echo '(function(){try{if(window.parent&&window.parent!==window){window.parent.postMessage({type:"os-plugins-changed",payload:';
	echo $encoded;
	echo '},window.location.origin);}}catch(e){}})();';
	echo '</script>';
	echo '</body></html>';
	exit;
}
add_action( 'admin_init', 'openstation_emit_menu_refresh_probe', 99 );

function openstation_menu_refresh_probe_payload() {
	if ( ! did_action( 'admin_enqueue_scripts' ) ) {

		if ( function_exists( 'set_current_screen' ) && function_exists( 'get_current_screen' ) && ! get_current_screen() ) {
			set_current_screen( openstation_menu_refresh_probe_screen_id() );
		}
		ob_start();

		do_action( 'admin_enqueue_scripts', 'admin.php' );
		ob_end_clean();
	}

	return openstation_build_menu_payload();
}

function openstation_menu_refresh_probe_screen_id() {
	if ( is_network_admin() ) {
		return 'admin-network';
	}
	if ( is_user_admin() ) {
		return 'admin-user';
	}
	return 'admin';
}

function openstation_chromeless_bridge_script() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	do_action( 'openstation_chromeless_after', isset( $GLOBALS['hook_suffix'] ) ? $GLOBALS['hook_suffix'] : '' );

	$menu_payload_json = 'null';
	$pagenow           = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	$is_refresh_probe  = ! empty( $_GET['openstation_menu_refresh'] );
	if (
		$is_refresh_probe
		|| in_array(
			$pagenow,
			array( 'plugins.php', 'plugin-install.php', 'update.php', 'themes.php' ),
			true
		)
	) {
		$encoded = wp_json_encode( openstation_build_menu_payload() );
		if ( false !== $encoded ) {
			$menu_payload_json = $encoded;
		}
	}

	$content_identity_json = wp_json_encode( openstation_build_content_identity() );
	if ( false === $content_identity_json ) {
		$content_identity_json = 'null';
	}

	$menu_sig_json = 'null';
	if ( 'null' === $menu_payload_json ) {
		$menu_sig = openstation_menu_signature();
		if ( '' !== $menu_sig ) {
			$encoded_sig = wp_json_encode( $menu_sig );
			if ( false !== $encoded_sig ) {
				$menu_sig_json = $encoded_sig;
			}
		}
	}

	$soft_reload_rules = array(
		array(
			'topic'       => 'os.shop_order.changed',
			'path'        => 'admin.php',
			'query'       => array( 'page' => 'wc-orders' ),
			'queryAbsent' => array( 'action' ),
		),
	);

	$soft_reload_rules = (array) apply_filters( 'openstation_soft_reload_rules', $soft_reload_rules );
	$soft_reload_json  = wp_json_encode( array_values( $soft_reload_rules ) );
	if ( ! $soft_reload_json ) {
		$soft_reload_json = '[]';
	}

	$data = sprintf(
		'window.__osChromelessData = { _menuPayload: %s, _menuSig: %s, _identity: %s, _softReload: %s };',
		$menu_payload_json,
		$menu_sig_json,
		$content_identity_json,
		$soft_reload_json
	);

	if ( ! wp_script_is( 'os-chromeless-bridge', 'registered' ) ) {
		openstation_register_assets();
	}

	wp_enqueue_script( 'os-chromeless-bridge' );
	wp_add_inline_script( 'os-chromeless-bridge', $data, 'before' );
}
add_action( 'admin_footer', 'openstation_chromeless_bridge_script' );

function openstation_plugins_handoff_key( $user_id ) {
	return 'openstation_plugins_handoff_' . (int) $user_id;
}

function openstation_chromeless_hand_off_plugins_redirect( $location ) {
	if ( empty( $location ) || 'plugins.php' !== ( $GLOBALS['pagenow'] ?? '' ) ) {
		return $location;
	}
	if ( ! openstation_is_chromeless_request() || ! openstation_is_admin_redirect_target( $location ) ) {
		return $location;
	}
	$destination = WP_Http::make_absolute_url( $location, self_admin_url() );
	if ( 'plugins.php' === basename( (string) wp_parse_url( $destination, PHP_URL_PATH ) ) ) {
		return $location;
	}
	$key = openstation_plugins_handoff_key( get_current_user_id() );
	if ( false !== get_transient( $key ) ) {
		delete_transient( $key );
		return $location;
	}
	set_transient( $key, $destination, MINUTE_IN_SECONDS );

	if ( empty( $_REQUEST['action'] ) && isset( $_SERVER['REQUEST_URI'] ) ) {
		return esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) );
	}
	return self_admin_url( 'plugins.php' );
}
add_filter( 'wp_redirect', 'openstation_chromeless_hand_off_plugins_redirect', 998 );

function openstation_chromeless_open_handed_off_redirect() {
	if ( 'plugins.php' !== ( $GLOBALS['pagenow'] ?? '' ) || ! openstation_is_chromeless_request() ) {
		return;
	}
	$key         = openstation_plugins_handoff_key( get_current_user_id() );
	$destination = get_transient( $key );
	if ( ! is_string( $destination ) || '' === $destination ) {
		return;
	}
	delete_transient( $key );

	$message = wp_json_encode(
		array(
			'type'       => 'os-iframe-admin-link',
			'url'        => $destination,
			'label'      => '',
			'newContext' => true,
		)
	);
	wp_print_inline_script_tag( 'try{window.parent.postMessage(' . $message . ',window.location.origin);}catch(e){}' );
}
add_action( 'admin_footer', 'openstation_chromeless_open_handed_off_redirect' );
