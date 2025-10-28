// frontend/main.js - Enhanced with Professional Meeting Features
// Features: Raise Hand, Unmute Requests, Selective Unmute, Admin Transfer
// frontend/main.js - Enhanced with robust WebRTC connectivity

// ======== Configuration ========
const WS_URL = "wss://webrtc-meeting-server.onrender.com";      // <--- update to your Render URL
const ICE_ENDPOINT = "https://webrtc-meeting-server.onrender.com/ice"; // <--- update to your Render URL
const GOOGLE_CLIENT_ID = "173379398027-i3h11rufg14tpde9rhutp0uvt3imos3k.apps.googleusercontent.com";// <--- set this


// ===== STATE =====
let googleUser = null;
let ws = null;
let localStream = null;
let clientId = null;
let roomId = null;
let isAdmin = false;
let adminToken = null;
let isMuted = false;
let isAdminMuted = false;
let isCameraOff = false;
let handRaised = false;
let peers = {};
let participantsState = new Map();
let pcConfig = { 
  iceServers: [],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let unreadMessages = 0;
let isInMeeting = false;

// ===== UTILITY FUNCTIONS =====

/**
 * Hides the initial page loading screen.
 * This is the new function added for the Monomode-style loader.
 */
function hideInitialLoadingScreen() {
    const loader = document.querySelector('.c-loading');
    if (loader) {
        loader.classList.add('hidden');
    }
}

function parseJwt(token) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
  return JSON.parse(jsonPayload);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  
  // Set animation to fade out after 2.7s (animation-duration is 0.3s)
  setTimeout(() => {
    toast.style.animation = 'slideInUp 0.3s ease-out, fadeOut 0.3s ease-out 2.7s forwards';
    setTimeout(() => toast.remove(), 3000); // Remove element after animation
  }, 10); // Start animation slightly after append
}


function showLoading(text = 'Connecting...') {
  const overlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  loadingText.textContent = text;
  overlay.classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

function updateConnectionStatus(connected) {
  const status = document.getElementById('connectionStatus');
  if (!status) return;
  const icon = status.querySelector('i');
  const text = status.querySelector('span');
  
  if (connected) {
    icon.style.color = 'var(--success-green)';
    text.textContent = 'Connected';
  } else {
    icon.style.color = 'var(--danger-red)';
    text.textContent = 'Reconnecting...';
  }
}

// ===== GOOGLE SIGN-IN =====
function initGoogleSignIn() {
  if (!window.google?.accounts?.id) {
    console.warn('Google Identity SDK not loaded');
    hideInitialLoadingScreen(); // <-- ADDED: Hide loader even if GSI fails
    return;
  }
  
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    auto_select: false
  });
  
  const signInDiv = document.getElementById('gSignInDiv');
  if (signInDiv) {
    google.accounts.id.renderButton(signInDiv, {
      theme: 'outline',
      size: 'large',
      width: '340' // Match card width
    });
  }
  
  hideInitialLoadingScreen(); // <-- ADDED: Hide loader when GSI is ready
}

function handleCredentialResponse(response) {
  try {
    const payload = parseJwt(response.credential);
    googleUser = {
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture
    };
    
    console.log('Google signed in:', googleUser);
    
    document.getElementById('authStatus').classList.add('hidden');
    document.getElementById('gSignInDiv').style.display = 'none';
    
    const afterAuth = document.getElementById('afterAuth');
    afterAuth.classList.remove('hidden');
    
    const avatar = document.getElementById('userAvatar');
    avatar.textContent = googleUser.name.charAt(0).toUpperCase();
    if (googleUser.picture) {
        avatar.style.backgroundImage = `url(${googleUser.picture})`;
        avatar.textContent = '';
    }

    document.getElementById('userName').textContent = googleUser.name;
    document.getElementById('userEmail').textContent = googleUser.email;
    
    showToast('Signed in successfully!', 'success');
  } catch (err) {
    console.error('Failed to parse Google credential', err);
    showToast('Sign in failed. Please try again.', 'error');
  }
}

function signOut() {
  if (isInMeeting) {
    if (!confirm('You are in a meeting. Are you sure you want to sign out?')) {
      return;
    }
    leaveMeeting(false); // Force leave without confirmation
  }
  
  googleUser = null;
  document.getElementById('afterAuth').classList.add('hidden');
  document.getElementById('authStatus').classList.remove('hidden');
  document.getElementById('gSignInDiv').style.display = 'block';

  // Reset avatar
  const avatar = document.getElementById('userAvatar');
  avatar.style.backgroundImage = 'none';
  avatar.textContent = ''; // Clear initial
  
  showToast('Signed out successfully', 'info');
}

// ===== ICE SERVER CONFIGURATION =====
async function loadIceServers() {
  try {
    console.log('🔧 Loading ICE server configuration...');
    const res = await fetch(ICE_ENDPOINT);
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    const data = await res.json();
    
    pcConfig.iceServers = data.iceServers || [];
    pcConfig.iceTransportPolicy = data.iceTransportPolicy || 'all';
    pcConfig.iceCandidatePoolSize = data.iceCandidatePoolSize || 10;
    
    console.log('✅ ICE servers loaded:', pcConfig.iceServers.length, 'servers');
    
    const turnServers = pcConfig.iceServers.filter(s => 
      s.urls && (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => u.startsWith('turn'))
    );
    console.log('🔄 TURN servers available:', turnServers.length);
    
  } catch (err) {
    console.error('❌ Failed to fetch ICE servers:', err);
    pcConfig.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // Add a fallback TURN server if you have one
    ];
    console.log('⚠️ Using fallback STUN-only ICE configuration');
  }
}

// ===== WEBSOCKET CONNECTION =====
function initWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    console.log('WebSocket already connected or connecting');
    return;
  }
  
  console.log('Attempting to connect to WebSocket...');
  ws = new WebSocket(WS_URL);
  
  ws.onopen = () => {
    console.log('✅ WebSocket connected');
    updateConnectionStatus(true);
    reconnectAttempts = 0;
    // If we were trying to join/create, do it now
    if (window.pendingRoomAction) {
        window.pendingRoomAction();
        delete window.pendingRoomAction;
    }
  };
  
  ws.onmessage = async (evt) => {
    try {
      const data = JSON.parse(evt.data);
      await handleSignalingMessage(data);
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  };
  
  ws.onerror = (err) => {
    console.error('❌ WebSocket error:', err);
    updateConnectionStatus(false);
  };
  
  ws.onclose = () => {
    console.log('⚠️ WebSocket closed');
    updateConnectionStatus(false);
    
    if (isInMeeting && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      showToast(`Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'info');
      setTimeout(() => initWebSocket(), 2000 * reconnectAttempts);
    } else if (isInMeeting) {
      showToast('Connection lost. Please refresh.', 'error');
      leaveMeeting(false); // Force leave without confirmation
    }
  };
}

// ===== SIGNALING MESSAGE HANDLER =====
async function handleSignalingMessage(data) {
  console.log('📩 Received:', data.type);
  
  switch (data.type) {
    case 'your_info':
      clientId = data.clientId;
      isAdmin = !!data.isAdmin;
      adminToken = data.adminToken || adminToken; // Persist token if we reconnect
      
      if (data.roomId) {
        roomId = data.roomId;
        updateRoomDisplay();
      }
      
      updateAdminUI();
      // Add self to participant list
      // Use googleUser, as it's set before joining/creating
      const selfName = googleUser ? googleUser.name : 'You';
      participantsState.set(clientId, {
          username: selfName,
          isMuted: isMuted, // Use current state
          isAdminMuted: isAdminMuted,
          handRaised: handRaised,
          identity: { picture: googleUser?.picture }
      });
      addParticipantToList(clientId, selfName, handRaised, isAdminMuted);
      // Add local video stream
      addVideoElement(clientId, localStream, true, selfName);
      break;
      
    case 'room_created':
      roomId = data.roomId;
      updateRoomDisplay();
      showToast(`Room created: ${roomId}`, 'success');
      showMeetingRoom();
      hideLoading();
      break;
      
    case 'room_state':
      console.log('📋 Room state received:', data.participants.length, 'participants');
      showMeetingRoom();
      hideLoading();
      for (const p of data.participants) {
        if (p.clientId !== clientId) {
          participantsState.set(p.clientId, {
            username: p.username,
            isMuted: p.isMuted,
            isAdminMuted: p.isAdminMuted,
            handRaised: p.handRaised,
            identity: p.identity
          });
          addParticipantToList(p.clientId, p.username, p.handRaised, p.isAdminMuted);
          await createOffer(p.clientId, p.username);
        }
      }
      break;
      
    case 'peer_joined':
      showToast(`${data.username} joined`, 'info');
      participantsState.set(data.clientId, {
        username: data.username,
        isMuted: false, // Default states
        isAdminMuted: false,
        handRaised: false,
        identity: data.identity
      });
      addParticipantToList(data.clientId, data.username, false, false);
      break;
      
    case 'offer':
      await handleOffer(data.from || data.fromId, data.fromUsername, data.sdp);
      break;
      
    case 'answer':
      await handleAnswer(data.from || data.fromId, data.sdp);
      break;
      
    case 'ice_candidate':
      await handleIceCandidate(data.from || data.fromId, data.candidate);
      break;
      
    case 'force_mute':
      if (data.targetClientId === clientId) {
        isMuted = !!data.muteState; // Update our own mute state
        isAdminMuted = !!data.isAdminMuted; // Update admin-mute lock
        
        if (localStream) {
            localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        }
        updateMicButton(); // Update UI
        
        if (isMuted && isAdminMuted) {
            showToast('You were muted by the host.', 'info');
        } else if (!isAdminMuted) {
            showToast('The host allowed you to unmute.', 'success');
        }
      }
      // Update state for participant (self or other)
      const pState = participantsState.get(data.targetClientId);
      if (pState) {
        pState.isMuted = !!data.muteState;
        pState.isAdminMuted = !!data.isAdminMuted;
        updateParticipantMuteStatus(data.targetClientId, pState.isMuted, pState.isAdminMuted);
      }
      break;
      
    case 'hand_status_changed':
      const pStateHand = participantsState.get(data.clientId);
      if (pStateHand) {
          pStateHand.handRaised = data.handRaised;
          updateParticipantHandStatus(data.clientId, data.handRaised);
      }
      
      if (data.clientId !== clientId && data.handRaised && isAdmin) {
        showToast(`✋ ${data.username} raised hand`, 'info');
      }
      break;
      
    case 'all_hands_lowered':
      participantsState.forEach((state, id) => {
        state.handRaised = false;
        updateParticipantHandStatus(id, false);
      });
      break;
      
    case 'unmute_request':
      if (isAdmin) {
        showUnmuteRequestModal(data.fromClientId, data.fromUsername);
      }
      break;
      
    case 'unmute_request_sent':
      showToast('Unmute request sent to host', 'info');
      break;
      
    case 'admin_changed':
      showToast(`${data.newAdminName} is now the host`, 'info');
      if (data.newAdminId === clientId) {
        isAdmin = true;
      } else if (data.oldAdminId === clientId) {
        isAdmin = false;
      }
      updateAdminUI();
      updateParticipantsListUI(); // Re-render list to show/hide admin controls
      break;
      
    case 'admin_transferred':
      showToast(`Admin transferred to ${data.newAdminName}`, 'info');
      isAdmin = false;
      adminToken = null; // Clear token
      updateAdminUI();
      updateParticipantsListUI();
      break;
      
    case 'promoted_to_admin':
      showToast(`You are now the host (promoted by ${data.byUsername})`, 'success');
      isAdmin = true;
      adminToken = data.adminToken; // Receive new token
      updateAdminUI();
      updateParticipantsListUI();
      break;
      
    case 'new_chat_message':
      displayChatMessage(data.fromUsername, data.message, data.timestamp, data.fromClientId === clientId);
      break;
      
    case 'peer_left':
      const pStateLeft = participantsState.get(data.clientId);
      if (pStateLeft) {
         showToast(`${pStateLeft.username} left`, 'info');
      }
      removePeer(data.clientId);
      break;
      
    case 'meeting_ended':
      showToast('Meeting ended by host', 'info');
      leaveMeeting(false); // Force leave
      break;
      
    case 'error':
      console.error('Server error:', data.message);
      showToast(data.message, 'error');
      hideLoading();
      // If error is "Room not found", go back to landing
      if (data.message.toLowerCase().includes('not found')) {
          showLandingPage();
          isInMeeting = false; // Ensure we're not marked as in-meeting
      }
      break;
      
    default:
      console.warn('Unknown message type:', data.type);
  }
}

// ===== ADMIN UI UPDATES =====
function updateAdminUI() {
  const endMeetingBtn = document.getElementById('endMeetingBtn');
  const muteAllBtn = document.getElementById('muteAllBtn');
  const raiseHandBtn = document.getElementById('raiseHandBtn');
  
  if (isAdmin) {
    endMeetingBtn?.classList.remove('hidden');
    muteAllBtn?.classList.remove('hidden');
    raiseHandBtn?.classList.add('hidden'); // Admins don't raise hands
  } else {
    endMeetingBtn?.classList.add('hidden');
    muteAllBtn?.classList.add('hidden');
    raiseHandBtn?.classList.remove('hidden');
  }
}

// ===== ROOM ACTIONS =====
function performRoomAction(actionFn) {
    if (!googleUser) {
        showToast('Please sign in first', 'error');
        return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Connecting to server...', 'info');
        window.pendingRoomAction = actionFn; // Store action
        initWebSocket(); // Ensure connection is attempted
        return;
    }
    
    actionFn(); // Execute immediately if connected
}

function createRoom() {
    performRoomAction(async () => {
        showLoading('Creating room...');
        try {
            await setupLocalStream();
            
            ws.send(JSON.stringify({
                type: 'create_room',
                username: googleUser.name,
                identity: { email: googleUser.email, picture: googleUser.picture }
            }));
            // Don't hide loading here, wait for 'room_created' or 'error'
        } catch (err) {
            console.error('Failed to get media for createRoom:', err);
            showToast('Failed to start camera/mic. Please check permissions.', 'error');
            hideLoading();
        }
    });
}

function joinRoomPrompt() {
    performRoomAction(async () => {
        const input = document.getElementById('roomIdInput');
        const id = input.value.trim().toUpperCase();
        
        if (!id) {
            showToast('Please enter a room code', 'error');
            return;
        }

        showLoading(`Joining room ${id}...`);
        
        try {
            await setupLocalStream();
            
            ws.send(JSON.stringify({
                type: 'join_room',
                roomId: id,
                username: googleUser.name,
                identity: { email: googleUser.email, picture: googleUser.picture }
            }));
            // Don't hide loading here, wait for 'room_state' or 'error'
        } catch (err) {
            console.error('Failed to get media for joinRoom:', err);
            showToast('Failed to start camera/mic. Please check permissions.', 'error');
            hideLoading();
        }
    });
}


function updateRoomDisplay() {
  const display = document.getElementById('roomDisplay');
  if (display) {
    display.textContent = `${roomId}`;
  }
}

function copyRoomId() {
  if (!roomId) return;
  
  navigator.clipboard.writeText(roomId).then(() => {
    const btn = document.getElementById('copyRoomBtn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => {
      btn.innerHTML = originalHTML;
    }, 2000);
    showToast('Room code copied to clipboard', 'success');
  }).catch(err => {
    console.error('Failed to copy:', err);
    showToast('Failed to copy room code', 'error');
  });
}

// ===== LOCAL STREAM SETUP =====
async function setupLocalStream() {
  if (localStream) {
    console.log('✅ Local stream already exists');
    return;
  }
  
  try {
    console.log('🎥 Requesting camera and microphone access...');
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        facingMode: 'user',
        frameRate: { ideal: 30, max: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000
      }
    });
    
    console.log('✅ Local stream obtained');
    // We add the local video element *after* we get our client ID
    // see 'your_info' message handler
  } catch (err) {
    console.error('❌ getUserMedia failed:', err);
    // Don't throw, allow joining without media (audio/video will be disabled)
    showToast('Could not access camera/microphone. You will join muted with camera off.', 'error');
    isMuted = true;
    isCameraOff = true;
  }
  // Update buttons to reflect state (even if stream failed)
  updateMicButton();
  updateCameraButton();
}

// ===== VIDEO ELEMENT MANAGEMENT =====
function addVideoElement(id, stream, isLocal = false, username = 'Participant') {
  let wrapper = document.getElementById(`video-wrapper-${id}`);
  
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = `video-wrapper-${id}`;
    wrapper.className = `video-wrapper ${isLocal ? 'local' : ''}`;
    
    const video = document.createElement('video');
    video.id = `video-${id}`;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    
    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    overlay.innerHTML = `
      <div class="participant-name">${isLocal ? 'You' : username}</div>
      <div class="video-indicators">
        <div class="indicator muted ${isLocal ? (isMuted ? '' : 'hidden') : 'hidden'}" id="muted-${id}" title="Muted">
          <i class="fas fa-microphone-slash"></i>
        </div>
        <div class="indicator hand-raised ${isLocal ? (handRaised ? '' : 'hidden') : 'hidden'}" id="hand-${id}" title="Hand Raised">
          <i class="fas fa-hand-paper"></i>
        </div>
      </div>
    `;
    
    wrapper.appendChild(video);
    wrapper.appendChild(overlay);
    
    document.getElementById('videoGrid').appendChild(wrapper);
    
    console.log(`✅ Added video element for ${id} (${username})`);
  } else {
      // Update username in case it changed (less likely)
      const nameTag = wrapper.querySelector('.participant-name');
      if (nameTag) nameTag.textContent = isLocal ? 'You' : username;
  }

  // Always set/update the srcObject
  const videoEl = wrapper.querySelector('video');
  if (stream) {
      videoEl.srcObject = stream;
  } else {
      // Handle case where stream might be null (e.g., user joined with no media)
      videoEl.srcObject = null;
      // Maybe show a "camera off" icon in the center?
  }
  
  updateVideoGrid();
}

function updateVideoGrid() {
  const grid = document.getElementById('videoGrid');
  const count = grid.children.length;
  grid.setAttribute('data-count', count);
  console.log(`📊 Video grid updated: ${count} participants`);
}

function removeVideoElement(id) {
  const wrapper = document.getElementById(`video-wrapper-${id}`);
  if (wrapper) {
    wrapper.remove();
    updateVideoGrid();
    console.log(`🗑️ Removed video element for ${id}`);
  }
}

// ===== WEBRTC PEER CONNECTION =====
function createPeerConnection(id, username) {
  if (peers[id]) {
    console.log(`♻️ Reusing existing peer connection for ${id}`);
    return peers[id].pc;
  }
  
  console.log(`🔧 Creating NEW peer connection for ${id} (${username})`);
  
  const pc = new RTCPeerConnection(pcConfig);
  
  peers[id] = { 
    pc, 
    username,
    iceCandidateQueue: [],
    remoteDescriptionSet: false
  };
  
  if (localStream) {
    for (const track of localStream.getTracks()) {
      try {
        pc.addTrack(track, localStream);
        console.log(`✅ Added ${track.kind} track to peer ${id}`);
      } catch (e) {
        console.error(`❌ Failed to add ${track.kind} track to ${id}:`, e);
      }
    }
  }
  
  pc.ontrack = (event) => {
    console.log(`🎥 Received ${event.track.kind} track from ${id}`);
    
    if (event.streams && event.streams[0]) {
      addVideoElement(id, event.streams[0], false, username);
    } else {
        // Handle tracks arriving separately
        let stream = document.getElementById(`video-${id}`)?.srcObject;
        if (!stream) {
            stream = new MediaStream();
            addVideoElement(id, stream, false, username);
        }
        stream.addTrack(event.track);
    }
  };
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingMessage({
        type: 'ice_candidate',
        candidate: event.candidate,
        targetClientId: id
      });
    }
  };
  
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log(`🔌 ICE connection state for ${id}: ${state}`);
    
    if (state === 'failed') {
      console.error(`❌ Connection FAILED for ${id}. Attempting ICE restart.`);
      pc.restartIce(); // Attempt to restart
    }
  };
  
  return pc;
}

async function createOffer(targetId, targetUsername) {
  console.log(`📤 Creating offer for ${targetId}`);
  
  const pc = createPeerConnection(targetId, targetUsername);
  
  try {
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    
    await pc.setLocalDescription(offer);
    
    sendSignalingMessage({
      type: 'offer',
      sdp: pc.localDescription,
      targetClientId: targetId
    });
    
    console.log(`📨 Offer sent to ${targetId}`);
  } catch (err) {
    console.error(`❌ Failed to create offer for ${targetId}:`, err);
  }
}

async function handleOffer(fromId, fromUsername, sdp) {
  console.log(`📥 Received offer from ${fromId}`);
  
  const pc = createPeerConnection(fromId, fromUsername);
  const peer = peers[fromId];
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    peer.remoteDescriptionSet = true;
    
    // Process any queued candidates
    while(peer.iceCandidateQueue.length > 0) {
        const candidate = peer.iceCandidateQueue.shift();
        console.log(`Processing queued ICE candidate from ${fromId}`);
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    sendSignalingMessage({
      type: 'answer',
      sdp: pc.localDescription,
      targetClientId: fromId
    });
    
    console.log(`📨 Answer sent to ${fromId}`);
  } catch (err) {
    console.error(`❌ Failed to handle offer from ${fromId}:`, err);
  }
}

async function handleAnswer(fromId, sdp) {
  console.log(`📥 Received answer from ${fromId}`);
  
  const peer = peers[fromId];
  if (!peer) return;
  
  try {
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    peer.remoteDescriptionSet = true;
    
    // Process any queued candidates
    while(peer.iceCandidateQueue.length > 0) {
        const candidate = peer.iceCandidateQueue.shift();
        console.log(`Processing queued ICE candidate from ${fromId}`);
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }

  } catch (err)
 {
    console.error(`❌ Failed to set remote description for ${fromId}:`, err);
  }
}

async function handleIceCandidate(fromId, candidate) {
  const peer = peers[fromId];
  if (!peer) {
      console.warn(`Received ICE candidate for unknown peer ${fromId}, creating...`);
      // This can happen if ICE arrives before offer/answer
      // We can't create PC here, but we could queue this candidate
      // For now, we rely on the peer object existing
      return;
  }
  
  try {
    if (peer.remoteDescriptionSet) {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      // Queue candidate if remote description isn't set yet
      peer.iceCandidateQueue.push(candidate);
      console.log(`Queued ICE candidate from ${fromId}`);
    }
  } catch (err) {
    console.error(`❌ Failed to add ICE candidate for ${fromId}:`, err);
  }
}

// ===== MEDIA CONTROLS =====
function toggleMic() {
  if (isAdminMuted) {
    showRequestUnmuteModal();
    return;
  }
  
  if (!localStream) {
      showToast('No microphone detected', 'error');
      return;
  }

  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });
  
  updateMicButton();
  // Send status update
  sendSignalingMessage({ type: 'mute_status', isMuted });
  updateParticipantMuteStatus(clientId, isMuted, isAdminMuted); // Update self in list

  showToast(isMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
}

function updateMicButton() {
  const btn = document.getElementById('toggleMicBtn');
  const icon = document.getElementById('micIcon');
  if (!btn || !icon) return;
  
  if (isMuted) {
    icon.className = 'fas fa-microphone-slash';
    btn.classList.add('active'); // Red background
    btn.title = isAdminMuted ? 'Request to unmute' : 'Unmute';
  } else {
    icon.className = 'fas fa-microphone';
    btn.classList.remove('active');
    btn.title = 'Mute';
  }
}

function toggleCamera() {
  if (!localStream) {
      showToast('No camera detected', 'error');
      return;
  }

  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach(track => {
    track.enabled = !isCameraOff;
  });
  
  updateCameraButton();
  // Send status update
  sendSignalingMessage({ type: 'camera_status', isCameraOff });
  
  // Show/hide placeholder for local video
  const localVideo = document.getElementById(`video-wrapper-${clientId}`);
  if (localVideo) {
      // We don't hide the wrapper, just the video track is disabled
      // The browser will show a black screen.
      // A more advanced implementation could show a placeholder avatar.
  }

  showToast(isCameraOff ? 'Camera off' : 'Camera on', 'info');
}

function updateCameraButton() {
  const btn = document.getElementById('toggleCamBtn');
  const icon = document.getElementById('camIcon');
  if (!btn || !icon) return;
  
  if (isCameraOff) {
    icon.className = 'fas fa-video-slash';
    btn.classList.add('active');
    btn.title = 'Camera On';
  } else {
    icon.className = 'fas fa-video';
    btn.classList.remove('active');
    btn.title = 'Camera Off';
  }
}

// ===== RAISE HAND FEATURE =====
function toggleRaiseHand() {
  if (isAdmin) return; // Admins don't raise hands

  handRaised = !handRaised;
  
  sendSignalingMessage({
    type: 'raise_hand',
    handRaised
  });
  
  updateRaiseHandButton();
  updateParticipantHandStatus(clientId, handRaised);
  
  showToast(handRaised ? '✋ Hand raised' : 'Hand lowered', 'info');
}

function updateRaiseHandButton() {
  const btn = document.getElementById('raiseHandBtn');
  if (!btn) return;
  
  const icon = btn.querySelector('i');
  
  if (handRaised) {
    icon.className = 'fas fa-hand-paper'; // Solid icon
    btn.classList.add('active'); // Use 'active' for blue bg
    btn.title = 'Lower hand';
  } else {
    icon.className = 'far fa-hand-paper'; // Outline icon
    btn.classList.remove('active');
    btn.title = 'Raise hand';
  }
}

// ===== UNMUTE REQUEST MODAL =====
function showRequestUnmuteModal() {
  // Check if a modal is already open
  if (document.querySelector('.modal-overlay')) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Request to Unmute</h3>
      <p>The host has muted you. Would you like to request permission to unmute?</p>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeModal(this)">Cancel</button>
        <button class="btn-primary" onclick="sendUnmuteRequest(); closeModal(this);">Send Request</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function sendUnmuteRequest() {
  sendSignalingMessage({
    type: 'request_unmute'
  });
}

function showUnmuteRequestModal(fromId, fromUsername) {
  // Check if a modal is already open
  if (document.querySelector('.modal-overlay')) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Unmute Request</h3>
      <p><strong>${fromUsername}</strong> is requesting permission to unmute.</p>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeModal(this)">Deny</button>
        <button class="btn-primary" onclick="approveUnmute('${fromId}'); closeModal(this);">Approve</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function approveUnmute(targetId) {
  sendSignalingMessage({
    type: 'admin_control',
    action: 'mute_toggle',
    targetClientId: targetId,
    muteState: false, // This means "unmute"
    isAdminMuted: false, // This means "unlock"
    adminToken
  });
  
  const pState = participantsState.get(targetId);
  if (pState) {
    showToast(`Approved unmute for ${pState.username}`, 'success');
  }
}

function closeModal(btn) {
  const modal = btn.closest('.modal-overlay');
  if (modal) {
    modal.remove();
  }
}

// ===== PARTICIPANTS PANEL =====
function addParticipantToList(id, username, handRaised = false, isAdminMuted = false) {
  const list = document.getElementById('participantsList');
  if (!list) return;

  let item = document.getElementById(`participant-${id}`);
  const isSelf = id === clientId;

  if (!item) {
    item = document.createElement('div');
    item.id = `participant-${id}`;
    item.className = 'participant-item';
    list.appendChild(item);
  }
  
  const initial = username.charAt(0).toUpperCase();
  const pState = participantsState.get(id) || {}; // Get state
  const picture = pState.identity?.picture;

  item.innerHTML = `
    <div class="participant-info">
      <div class="participant-avatar" style="${picture ? `background-image: url(${picture});` : ''}">
        ${!picture ? initial : ''}
      </div>
      <div class="participant-details">
        <p>${username} ${isSelf ? '(You)' : ''}</p>
        <span>${isSelf && isAdmin ? 'Host' : (isAdmin ? 'Participant' : '')}</span>
      </div>
      <div class="participant-status">
        <div class="hand-status ${handRaised ? '' : 'hidden'}" title="Hand raised">
          <i class="fas fa-hand-paper"></i>
        </div>
        <div class="mute-status ${pState.isMuted ? '' : 'hidden'}" title="Muted">
            <i class="fas fa-microphone-slash"></i>
        </div>
      </div>
    </div>
    <div class="participant-controls">
      ${isAdmin && !isSelf ? `
        <button class="btn-icon ${pState.isAdminMuted ? 'muted' : ''}" onclick="toggleParticipantMute('${id}')" title="${pState.isAdminMuted ? 'Allow Unmute' : 'Mute'}">
          <i class="fas fa-microphone${pState.isAdminMuted ? '-slash' : ''}"></i>
        </button>
        <button class="btn-icon" onclick="showTransferAdminModal('${id}', '${username}')" title="Transfer Host">
          <i class="fas fa-crown"></i>
        </button>
      ` : ''}
    </div>
  `;
  
  updateParticipantCount();
}

function removeParticipantFromList(id) {
  const item = document.getElementById(`participant-${id}`);
  if (item) {
    item.remove();
    updateParticipantCount();
  }
}

function updateParticipantCount() {
  const count = participantsState.size; // Map now holds all participants
  
  const countEl = document.getElementById('participantCount');
  const badgeEl = document.getElementById('participantCountBadge');

  if (countEl) countEl.textContent = count;
  if (badgeEl) badgeEl.textContent = count;
}

// Re-renders the entire participant list based on current state
function updateParticipantsListUI() {
    const list = document.getElementById('participantsList');
    if (!list) return;
    list.innerHTML = ''; // Clear all
    
    // Add all participants from state
    participantsState.forEach((state, id) => {
        addParticipantToList(id, state.username, state.handRaised, state.isAdminMuted);
    });
}


function updateParticipantMuteStatus(participantId, isMuted, isAdminMuted) {
  // Update video overlay indicator
  const mutedIndicator = document.getElementById(`muted-${participantId}`);
  if (mutedIndicator) {
    mutedIndicator.classList.toggle('hidden', !isMuted);
  }
  
  // Update participant list item
  const listItem = document.getElementById(`participant-${participantId}`);
  if (listItem) {
    const muteIcon = listItem.querySelector('.mute-status');
    if(muteIcon) muteIcon.classList.toggle('hidden', !isMuted);
    
    // Update admin controls if they exist
    if (isAdmin && participantId !== clientId) {
      const muteBtn = listItem.querySelector('.participant-controls .btn-icon:first-child');
      if (muteBtn) {
        const icon = muteBtn.querySelector('i');
        muteBtn.classList.toggle('muted', isAdminMuted); // Red if admin-muted
        icon.className = `fas fa-microphone${isAdminMuted ? '-slash' : ''}`;
        muteBtn.title = isAdminMuted ? 'Allow Unmute' : 'Mute';
      }
    }
  }
}

function updateParticipantHandStatus(participantId, raised) {
  const handIndicator = document.getElementById(`hand-${participantId}`);
  if (handIndicator) {
    handIndicator.classList.toggle('hidden', !raised);
  }
  
  const listItem = document.getElementById(`participant-${participantId}`);
  if (listItem) {
    const handIcon = listItem.querySelector('.hand-status');
    if (handIcon) {
      handIcon.classList.toggle('hidden', !raised);
    }
  }
}


// ===== ADMIN CONTROLS =====
function toggleParticipantMute(targetId) {
  if (!isAdmin) return;
  
  const pState = participantsState.get(targetId);
  if (!pState) return;
  
  // Admin toggle now *only* controls the admin-mute lock
  const newAdminMuteState = !pState.isAdminMuted;
  
  sendSignalingMessage({
    type: 'admin_control',
    action: 'mute_toggle',
    targetClientId: targetId,
    muteState: newAdminMuteState, // Also force them muted if we are locking
    isAdminMuted: newAdminMuteState,
    adminToken
  });
  
  // State is updated via 'force_mute' broadcast
  showToast(`${newAdminMuteState ? 'Muted' : 'Allowed unmute for'} ${pState.username}`, 'success');
}

function muteAll() {
  if (!isAdmin) return;
  
  if (confirm('Mute all participants? They will be locked and must request to unmute.')) {
    sendSignalingMessage({
      type: 'admin_control',
      action: 'mute_all',
      adminToken
    });
    showToast('All participants muted', 'success');
  }
}

function showTransferAdminModal(targetId, targetUsername) {
  // Check if a modal is already open
  if (document.querySelector('.modal-overlay')) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Transfer Host Privileges</h3>
      <p>Are you sure you want to transfer host privileges to <strong>${targetUsername}</strong>?</p>
      <p class="warning-text">You will no longer be the host after this action.</p>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeModal(this)">Cancel</button>
        <button class="btn-primary" onclick="transferAdmin('${targetId}'); closeModal(this);">Transfer</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function transferAdmin(targetId) {
  if (!isAdmin) return;
  
  sendSignalingMessage({
    type: 'admin_control',
    action: 'transfer_admin',
    targetClientId: targetId,
    adminToken
  });
}

function endMeeting() {
  if (!isAdmin) return;
  
  if (confirm('End meeting for everyone?')) {
    sendSignalingMessage({
      type: 'end_meeting',
      adminToken
    });
  }
}

// ===== CHAT =====
function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  
  if (!message) return;
  
  sendSignalingMessage({
    type: 'chat_message',
    message
  });
  
  input.value = '';
  input.style.height = 'auto'; // Reset height
}

function displayChatMessage(username, message, timestamp, isLocal) {
  const container = document.getElementById('chatMessages');
  
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${isLocal ? 'local' : 'remote'}`;
  
  msgDiv.innerHTML = `
    <div class="message-sender">${isLocal ? 'You' : username}</div>
    <div class="message-bubble">${escapeHtml(message)}</div>
    <div class="message-time">${timestamp || formatTime(new Date())}</div>
  `;
  
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight; // Scroll to bottom
  
  const panel = document.getElementById('sidePanel');
  const chatPanel = document.getElementById('chatPanel');
  
  if (!isLocal && (!panel.classList.contains('open') || chatPanel.classList.contains('hidden'))) {
    unreadMessages++;
    updateChatBadge();
  }
}

function updateChatBadge() {
  const badge = document.getElementById('chatNotificationBadge');
  if (unreadMessages > 0) {
    badge.textContent = unreadMessages;
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>'); // Also convert newlines
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ===== SIDE PANEL MANAGEMENT =====
function toggleSidePanel(tab) {
  const panel = document.getElementById('sidePanel');
  const isOpen = panel.classList.contains('open');
  
  if (isOpen) {
    const currentTab = document.querySelector('.tab-btn.active').id.replace('Tab', '');
    if (currentTab === tab) {
      closeSidePanel();
      return;
    }
  }
  
  showPanelTab(tab);
  panel.classList.add('open');
  
  if (tab === 'chat') {
    unreadMessages = 0;
    updateChatBadge();
  }
}

function closeSidePanel() {
  document.getElementById('sidePanel').classList.remove('open');
}

function showPanelTab(tab) {
  document.getElementById('participantsTab').classList.toggle('active', tab === 'participants');
  document.getElementById('chatTab').classList.toggle('active', tab === 'chat');
  
  document.getElementById('participantsPanel').classList.toggle('hidden', tab !== 'participants');
  document.getElementById('chatPanel').classList.toggle('hidden', tab !== 'chat');
  
  if (tab === 'chat') {
    unreadMessages = 0;
    updateChatBadge();
    
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// ===== UI TRANSITIONS =====
function showMeetingRoom() {
  document.getElementById('landingPage').classList.add('hidden');
  document.getElementById('meetingRoom').classList.remove('hidden');
  isInMeeting = true;
  
  updateAdminUI();
}

function showLandingPage() {
  document.getElementById('meetingRoom').classList.add('hidden');
  document.getElementById('landingPage').classList.remove('hidden');
  isInMeeting = false;
  
  // Clear landing page inputs
  const roomInput = document.getElementById('roomIdInput');
  if(roomInput) roomInput.value = '';
}

// ===== CLEANUP & LEAVE =====
function removePeer(id) {
  console.log(`🗑️ Removing peer: ${id}`);
  
  if (peers[id]) {
    try {
      peers[id].pc.close();
      console.log(`✅ Peer connection closed for ${id}`);
    } catch (e) {
      console.error('Error closing peer connection:', e);
    }
    delete peers[id];
  }
  
  removeVideoElement(id);
  removeParticipantFromList(id);
  participantsState.delete(id);
  updateParticipantCount();
}

function leaveMeeting(confirmLeave = true) {
  if (confirmLeave && !confirm('Leave the meeting?')) return;
  
  console.log('🚪 Leaving meeting...');
  
  Object.keys(peers).forEach(id => {
    try {
      peers[id].pc.close();
      console.log(`✅ Closed peer connection for ${id}`);
    } catch (e) {
      console.error('Error closing peer:', e);
    }
  });
  peers = {};
  
  if (localStream) {
    localStream.getTracks().forEach(track => {
      try {
        track.stop();
        console.log(`⏹️ Stopped ${track.kind} track`);
      } catch (e) {
        console.error('Error stopping track:', e);
      }
    });
    localStream = null;
  }
  
  const videoGrid = document.getElementById('videoGrid');
  if (videoGrid) {
    videoGrid.innerHTML = '';
  }
  
  const participantsList = document.getElementById('participantsList');
  if (participantsList) {
    participantsList.innerHTML = '';
  }
  
  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) {
    chatMessages.innerHTML = '';
  }
  
  clientId = null;
  roomId = null;
  isAdmin = false;
  adminToken = null;
  isMuted = false;
  isAdminMuted = false;
  isCameraOff = false;
  handRaised = false;
  unreadMessages = 0;
  isInMeeting = false;
  participantsState.clear();
  
  if (ws) {
    try {
      ws.close();
      console.log('✅ WebSocket closed');
    } catch (e) {
      console.error('Error closing WebSocket:', e);
    }
    ws = null;
  }
  
  showLandingPage();
  if (confirmLeave) { // Don't show toast if force-left
    showToast('Left the meeting', 'info');
  }
  
  // Re-init websocket for landing page
  setTimeout(() => {
    initWebSocket();
  }, 1000);
}

// ===== HELPER: SEND SIGNALING MESSAGE =====
function sendSignalingMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    console.error('❌ WebSocket not connected');
    showToast('Connection lost. Please refresh.', 'error');
  }
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Initializing app...');
  
  await loadIceServers();
  
  try {
    initGoogleSignIn();
  } catch (e) {
    console.warn('⚠️ Google Sign-In initialization failed:', e);
    hideInitialLoadingScreen(); // Ensure loader hides even on failure
  }
  
  initWebSocket();
  
  const roomInput = document.getElementById('roomIdInput');
  if (roomInput) {
    roomInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        joinRoomPrompt();
      }
    });
    
    roomInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
  }
  
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const panel = document.getElementById('sidePanel');
      if (panel.classList.contains('open')) {
        closeSidePanel();
      }
      
      const modals = document.querySelectorAll('.modal-overlay');
      modals.forEach(modal => modal.remove());
    }
  });
  
  window.addEventListener('beforeunload', (e) => {
    if (isInMeeting) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
  
  setInterval(() => {
    if (isInMeeting && Object.keys(peers).length > 0) {
      monitorConnectionQuality();
    }
  }, 5000);
  
  console.log('✅ App initialized successfully');
});

// ===== CONNECTION QUALITY MONITORING =====
async function monitorConnectionQuality() {
  for (const [peerId, peer] of Object.entries(peers)) {
    if (!peer.pc) continue;
    
    try {
      const stats = await peer.pc.getStats();
      
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const transport = report.transportType || 'unknown';
          if (transport === 'relay') {
            console.log(`🔄 ${peerId} using TURN relay connection`);
          }
        }
        
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          const packetsLost = report.packetsLost || 0;
          const packetsReceived = report.packetsReceived || 0;
          
          if (packetsReceived > 0) {
            const lossRate = (packetsLost / (packetsLost + packetsReceived)) * 100;
            if (lossRate > 5) {
              console.warn(`⚠️ High packet loss for ${peerId}: ${lossRate.toFixed(2)}%`);
            }
          }
        }
      });
    } catch (err) {
      console.error(`❌ Failed to get stats for ${peerId}:`, err);
    }
  }
}

// ===== EXPOSE FUNCTIONS TO WINDOW =====
window.createRoom = createRoom;
window.joinRoomPrompt = joinRoomPrompt;
window.copyRoomId = copyRoomId;
window.toggleMic = toggleMic;
window.toggleCamera = toggleCamera;
window.toggleRaiseHand = toggleRaiseHand;
window.leaveMeeting = leaveMeeting;
window.endMeeting = endMeeting;
window.toggleSidePanel = toggleSidePanel;
window.closeSidePanel = closeSidePanel;
window.showPanelTab = showPanelTab;
window.sendChatMessage = sendChatMessage;
window.toggleParticipantMute = toggleParticipantMute;
window.muteAll = muteAll;
window.signOut = signOut;
window.sendUnmuteRequest = sendUnmuteRequest;
window.approveUnmute = approveUnmute;
window.closeModal = closeModal;
window.transferAdmin = transferAdmin;
window.showTransferAdminModal = showTransferAdminModal;
