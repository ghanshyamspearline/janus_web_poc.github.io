var _config = null;
document.addEventListener('DOMContentLoaded', function() {
   console.log('document is ready. I can sleep now');
   _config = window.localStorage.getItem("_janusSIPConfig");
   if(isEmpty(_config)) {
   	// TODO : Login
   } else {
   	_config = JSON.parse(_config);
   	if(isEmpty(_config._sipUsername) || isEmpty(_config._sipServer)) {
   		alert('Wrong Credentials.');
   		window.localStorage.setItem('_janusSIPConfig', '');
   		window.location.reload();
   	}
   	const _configSection = document.getElementById('_config');
   	_configSection.style.display = "none";
   	const _phoneSection = document.getElementById('_phone');
   	_phoneSection.style.display = "block";
   	initJanus();
   }
});

const initPhone = () => {
	const _sipUsername = document.getElementById('_sipUsername').value;
	const _sipServer = document.getElementById('_sipServer').value;
	if(isEmpty(_sipUsername)) { alert('SIP Username is mandatory.'); return; }
	if(isEmpty(_sipServer)) { alert('SIP Password is mandatory.'); return; }
	const _config = {
		'_sipUsername' : _sipUsername,
		'_sipServer' : _sipServer
	}
	window.localStorage.setItem('_janusSIPConfig', JSON.stringify(_config));
	window.location.reload();
}

var janus = null;
var sipcall = null;
var opaqueId = "siptest-"+Janus.randomString(12);
var selectedApproach = "guest";
var registered = false;
var localTracks = {},
	remoteTracks = {};
const initJanus = () => {
	Janus.init({debug: "all", callback: function() {
			if(!Janus.isWebrtcSupported()) {
                bootbox.alert("No WebRTC support... ");
                return;
            }
            janus = new Janus(
							{
								server: server,
                                iceServers: iceServers,
                                success: function() {
                                	janus.attach({
                                    	plugin: "janus.plugin.sip",
                                        opaqueId: opaqueId,
                                        success: function(pluginHandle) {
                                        	sipcall = pluginHandle;
                                        	Janus.log("Plugin attached! (" + sipcall.getPlugin() + ", id=" + sipcall.getId() + ")");
                                        	registerPhone()
                                        },
                                        iceState: function(state) {
											Janus.log("ICE state changed to " + state);
										},
										mediaState: function(medium, on, mid) {
											Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium + " (mid=" + mid + ")");
										},
										webrtcState: function(on) {
											Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
											// $("#videoleft").parent().unblock();
										},
										slowLink: function(uplink, lost, mid) {
											Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
												" packets on mid " + mid + " (" + lost + " lost packets)");
										},
										onmessage: function(msg, jsep) {
											Janus.debug(" ::: Got a message :::", msg);
											var error = msg["error"];
											if(error) {
												if(registered) {
													sipcall.hangup();
												}
												alert(error);
												return;
											}
											var callId = msg["call_id"];
											var result = msg["result"];
											if(result && result["event"]) {
												var event = result["event"];
												if(event === 'registration_failed') {
													Janus.warn("Registration failed: " + result["code"] + " " + result["reason"]);
													$('.status').html('Registration failed')
													alert(result["code"] + " " + result["reason"]);
													return;
												}
												if(event === 'registered') {
													Janus.log("Successfully registered as " + result["username"] + "!");
													// TODO Enable buttons to call now
													$('.status').html('Registered!');
													if(!registered) {
														registered = true;
														masterId = result["master_id"];
													}
												} else if(event === 'calling') {
													Janus.log("Waiting for the peer to answer...");
													$('.status').html('Calling... Waiting for the peer to answer');

													$('.btn-call').removeClass('visible').addClass('invisible');
													$('.btn-hangup').removeClass('invisible').addClass('visible');
												} else if(event === 'accepting') {
													$('.status').html('Accepting the call!');
													console.log("Response to an offerless INVITE, let's wait for an 'accepted'")
												} else if(event === 'progress') {
													$('.status').html('In Progress..!');
													Janus.log("There's early media from " + result["username"] + ", wairing for the call!", jsep);
													// Call can start already: handle the remote answer
													if(jsep) {
														sipcall.handleRemoteJsep({ jsep: jsep, error: doHangup });
													}
													console.info("[toaster.info] : Early media...");
												} else if(event === 'accepted') {
													$('.status').html('In Call with '+result["username"]+'!');
													Janus.log(result["username"] + " accepted the call!", jsep);
													// Call can start, now: handle the remote answer
													if(jsep) {
														sipcall.handleRemoteJsep({ jsep: jsep, error: doHangup });
													}
													console.log("[toaster.success] : Call accepted!");
													sipcall.callId = callId;
													//sipcall.dtmf({dtmf: { tones: "B"}});
													console.log("Sending recording request");
													sipcall.send(
														{ 
															message: {
																"request" : "recording", 
																"action":"start", 
																"audio" : true, 
																"peer_audio": true,
																"filename": "/opt/janus/share/janus/"+sipcall.callId+"/demotestcall" // This is an recording file name, we can consider UUID for call request
															}
													});
												} else if(event === 'hangup') {
													Janus.log("Call hung up (" + result["code"] + " " + result["reason"] + ")!");
													$('.status').html(result["code"] + " " + result["reason"]);
													// Reset status
													sipcall.hangup();
													$('.btn-hangup').removeClass('visible').addClass('invisible');
													$('.btn-call').removeClass('invisible').addClass('visible');
												}
											}
										},
										onlocaltrack: function(track, on) {
											Janus.debug("Local track " + (on ? "added" : "removed") + ":", track);
											// We use the track ID as name of the element, but it may contain invalid characters
											var trackId = track.id.replace(/[{}]/g, "");
											if(!on) {
												// Track removed, get rid of the stream and the rendering
												var stream = localTracks[trackId];
												if(stream) {
													try {
														var tracks = stream.getTracks();
														for(var i in tracks) {
															var mst = tracks[i];
															if(mst)
																mst.stop();
														}
													} catch(e) {}
												}
												delete localTracks[trackId];
												return;
											}
											// If we're here, a new track was added
											var stream = localTracks[trackId];
											if(stream) {
												// We've been here already
												return;
											}
											if(sipcall.webrtcStuff.pc.iceConnectionState !== "completed" &&
													sipcall.webrtcStuff.pc.iceConnectionState !== "connected") {
												console.log("Connecting...");
											}
										},
										onremotetrack: function(track, mid, on) {
											Janus.debug("Remote track (mid=" + mid + ") " + (on ? "added" : "removed") + ":", track);
											if(!on) {
												// Track removed, get rid of the stream and the rendering
												delete remoteTracks[mid];
												return;
											}
											// If we're here, a new track was added
											if(track.kind === "audio") {
												// New audio track: create a stream out of it, and use a hidden <audio> element
												stream = new MediaStream([track]);
												remoteTracks[mid] = stream;
												Janus.log("Created remote audio stream:", stream);
												$('#videoright').append('<audio class="hide" id="peervideom' + mid + '" autoplay playsinline/>');
												Janus.attachMediaStream($('#peervideom' + mid).get(0), stream);
											}
										},
										oncleanup: function() {
											Janus.log(" ::: Got a cleanup notification :::");
											$('#videoright').empty();
											$('.status').html('');
											if(sipcall) {
												delete sipcall.callId;
												delete sipcall.doAudio;
											}
											localTracks = {};
											remoteTracks = {};
										}
									});
                                },
                                error: function(error) {
									Janus.error(error);
									alert(error);
									doLogout();
									window.location.reload();
								},
								destroyed: function() {
									window.location.reload();
								}
                    		});		
		}
	});
}

const registerPhone = () => {
	// We're registering as guests, no username/secret provided
	var register = {
		request: "register",
		type: "guest",
		authuser: _config._sipUsername,
		proxy: 'sip:'+_config._sipServer,
		username: 'sip:'+_config._sipUsername+'@'+_config._sipServer
	};
	
	console.log("register : ", register);
	sipcall.send({ message: register });
}

const doCall = () => {

	const _sipUri = document.getElementById('_sipUri').value;
	if(isEmpty(_sipUri)) { $('.status').html('<span class="text-danger">SIP Uri is mandatory!</span>'); $('#_sipUri').focus(); return; }
	Janus.log("This is a SIP audio call to "+_sipUri);
	actuallyDoCall(sipcall, _sipUri);
}

const actuallyDoCall = (handle, _sipUri) => {
	handle.doAudio = true;
	let tracks = [{ type: 'audio', capture: true, recv: true }];

	handle.createOffer(
		{
			tracks: tracks,
			success: function(jsep) {
				Janus.debug("Got SDP!", jsep);
				const _extraHeaderName = $('#_extraHeaderName').val();
				const _extraHeaderValue = $('#_extraHeaderValue').val();
				let _extraHeaders = null;
				if(!isEmpty(_extraHeaderName) && !isEmpty(_extraHeaderValue)) {
					_extraHeaders : {
						_extraHeaderName: _extraHeaderValue
					}
				}
				var body = { request: "call", uri: _sipUri , headers: _extraHeaders };
				body["autoaccept_reinvites"] = false;
				handle.send({ message: body, jsep: jsep });
			},
			error: function(error) {
				Janus.error("WebRTC error...", error);
				alert("WebRTC error... " + error.message);
			}
		});
}

const doHangup = () => {
		var hangup = { request: "hangup" };
		sipcall.send({ message: hangup });
		sipcall.hangup();
}

const doLogout = () => {
	if(confirm('Are you sure want to logout?')){
		window.localStorage.setItem('_janusSIPConfig', '');
   		window.location.reload();
	}
}

const isEmpty = (data) => {
	if(data == null || data == "" || data == undefined){
            return true;
    } else {
            return false;
    }
}
