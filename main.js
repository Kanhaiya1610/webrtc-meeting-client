// frontend/main.js - Enhanced with Professional Meeting Features
// Features: Raise Hand, Unmute Requests, Selective Unmute, Admin Transfer
// frontend/main.js - Enhanced with robust WebRTC connectivity
// Enhanced main.js with Screen Sharing and Recording Support
// Enhanced main.js with Real-time Captions & Translation using Web Speech and Gemini
// ======== Configuration ========
const APP_CONFIG = window.APP_CONFIG || {};
const SERVER_ENDPOINTS = (APP_CONFIG.endpoints || []).map(endpoint => ({
  ...endpoint,
  baseUrl: String(endpoint.baseUrl || '').replace(/\/$/, ''),
  ws: endpoint.ws || `${String(endpoint.baseUrl || '').replace(/^http/, 'ws').replace(/\/$/, '')}/ws`,
  ice: endpoint.ice || `${String(endpoint.baseUrl || '').replace(/\/$/, '')}/ice`,
  translate: endpoint.translate || `${String(endpoint.baseUrl || '').replace(/\/$/, '')}/translate`,
  transcribe: endpoint.transcribe || `${String(endpoint.baseUrl || '').replace(/\/$/, '')}/captions/transcribe`
})).filter(endpoint => endpoint.baseUrl && endpoint.ws);
let currentServerIndex = 0; // Start with the Primary server

const GOOGLE_CLIENT_ID = APP_CONFIG.googleClientId || '';

// ===== STATE =====
let googleUser = null;
let googleCredential = null;
let sessionToken = null;
let ws = null;
let socketAuthenticated = false;
let signalingSocketEpoch = 0;
let localStream = null;
let screenStream = null;
let clientId = null;
let roomId = null;
let resumeToken = null;
let isAdmin = false;
let adminToken = null;
let roomAdminClientId = null;
let pendingRoomCode = null;
let isMuted = false;
let isAdminMuted = false;
let isCameraOff = false;
let handRaised = false;
let isScreenSharing = false;
let screenShareOwnerId = null;
let screenStageStream = null;
let screenPinned = true;
let presenterOverlayVisible = true;
let presenterOverlayPosition = { left: null, top: null, right: 16, bottom: 16 };
let presenterDrag = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingFrameId = null;
let peers = {};
let pendingIceCandidates = new Map();
let participantsState = new Map();
let pcConfig = {
  // Keep a usable baseline immediately. The authenticated /ice request can
  // replace this with TURN credentials, but peer creation must never see an
  // empty ICE configuration if the user joins while that request is pending.
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let unreadMessages = 0;
let isInMeeting = false;
let intentionalSocketClose = false;
let reconnectTimer = null;
let roomActionPending = null;
let pendingAdmissionRoomId = null;
let pendingAdmissionRequestId = null;
let pendingAdmissionToken = null;
let pendingAdmissionTimer = null;
let admissionRequests = new Map();
let notesRoomId = null;
let notesStorageKey = null;
let notesSaveTimer = null;
let backgroundEffect = 'none';
let backgroundPipeline = null;
let googleInitAttempts = 0;

// ===== NEW: CAPTIONS & TRANSLATION STATE =====
let captionsEnabled = false;
let recognition = null;
let captionLanguage = 'en-US'; // The language I *speak*
let myPreferredLanguage = 'en-US'; // The language I *want to read*
let captionHistory = [];
const MAX_CAPTION_HISTORY = 50;
const MAX_CHAT_LENGTH = 1000;
const MAX_CAPTION_LENGTH = 500;
let translationCache = new Map(); // Caches interim translations
let translationTimeouts = new Map(); // Debouncer for interim translations per speaker
let captionProvider = 'browser';
let groqRecorder = null;
let groqUploadQueue = [];
let groqUploadBusy = false;
const MAX_GROQ_UPLOAD_QUEUE = 3;
let groqChunkNumber = 0;
let browserRecognitionFailures = 0;
let groqFailureCount = 0;
let groqCaptureSessionId = null;
let browserCaptionId = null;
let summaryState = 'not_requested';
let summaryId = null;

// Available languages for captions
const CAPTION_LANGUAGES = {
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'es-ES': 'Spanish (Spain)',
  'es-MX': 'Spanish (Mexico)',
  'fr-FR': 'French',
  'de-DE': 'German',
  'it-IT': 'Italian',
  'pt-BR': 'Portuguese (Brazil)',
  'pt-PT': 'Portuguese (Portugal)',
  'ru-RU': 'Russian',
  'ja-JP': 'Japanese',
  'ko-KR': 'Korean',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  'hi-IN': 'Hindi',
  'ar-SA': 'Arabic',
  'nl-NL': 'Dutch',
  'pl-PL': 'Polish',
  'tr-TR': 'Turkish',
  'sv-SE': 'Swedish'
};

// ===== UTILITY FUNCTIONS =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = document.createElement('i');
  icon.className = `fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}`;
  const text = document.createElement('span');
  text.textContent = String(message ?? '');
  toast.append(icon, text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function isSafeClientId(value) {
  return value === 'local' || (typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value));
}

// One side must own initial negotiation for each pair. Using the same stable
// UUID ordering on both clients prevents offer glare when a room is resumed
// or both browsers process room state at the same time.
function shouldInitiatePeer(targetId) {
  return isSafeClientId(clientId) && isSafeClientId(targetId) && clientId < targetId;
}

function handleActionClick(event) {
  const actionElement = event.target.closest('[data-action]');
  if (!actionElement) return;

  switch (actionElement.dataset.action) {
    case 'create-room': createRoom(); break;
    case 'join-room': joinRoomPrompt(); break;
    case 'copy-room': copyRoomId(); break;
    case 'copy-link': copyMeetingLink(); break;
    case 'open-participants': toggleSidePanel('participants'); break;
    case 'open-chat': toggleSidePanel('chat'); break;
    case 'open-notes': toggleSidePanel('notes'); break;
    case 'sign-out': signOut(); break;
    case 'caption-settings': showCaptionSettings(); break;
    case 'stop-captions': stopCaptions(); break;
    case 'toggle-mic': toggleMic(); break;
    case 'toggle-camera': toggleCamera(); break;
    case 'background-settings': showBackgroundSettings(); break;
    case 'select-background':
      setBackgroundEffect(actionElement.dataset.effect);
      closeModal(actionElement);
      break;
    case 'leave-meeting': leaveMeeting(); break;
    case 'toggle-hand': toggleRaiseHand(); break;
    case 'toggle-screen': toggleScreenShare(); break;
    case 'toggle-screen-pin': toggleScreenPin(); break;
    case 'toggle-presenter-overlay': togglePresenterOverlay(); break;
    case 'toggle-recording': toggleRecording(); break;
    case 'toggle-captions': toggleCaptions(); break;
    case 'end-meeting': endMeeting(); break;
    case 'request-summary': requestMeetingSummary(); break;
    case 'show-participants': showPanelTab('participants'); break;
    case 'show-chat': showPanelTab('chat'); break;
    case 'show-notes': showPanelTab('notes'); break;
    case 'clear-notes': clearMeetingNotes(); break;
    case 'cancel-admission': cancelAdmissionRequest(); break;
    case 'admit-request': admitJoinRequest(actionElement.dataset.requestId); break;
    case 'reject-request': rejectJoinRequest(actionElement.dataset.requestId); break;
    case 'close-panel': closeSidePanel(); break;
    case 'mute-all': muteAll(); break;
    case 'send-chat': sendChatMessage(); break;
    case 'download-captions': downloadCaptionHistory(); break;
    case 'close-modal': closeModal(actionElement); break;
    case 'apply-caption-settings':
      applyCaptionSettings();
      closeModal(actionElement);
      break;
    case 'send-unmute-request':
      sendUnmuteRequest();
      closeModal(actionElement);
      break;
    default: break;
  }
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

function updateConnectionStatus(connected, message = null) {
  const status = document.getElementById('connectionStatus');
  if (!status) return;
  const icon = status.querySelector('i');
  const text = status.querySelector('span');
  if (!icon || !text) return;

  if (connected) {
    icon.style.color = 'var(--success-green)';
    text.textContent = `Connected (${SERVER_ENDPOINTS[currentServerIndex].name})`;
  } else {
    icon.style.color = 'var(--danger-red)';
    text.textContent = message || 'Reconnecting...';
  }
}

// ===== GOOGLE SIGN-IN =====
function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID) {
    showToast('Google sign-in is not configured for this deployment.', 'error');
    return;
  }
  if (!window.google?.accounts?.id) {
    console.warn('Google Identity SDK not loaded');
    if (googleInitAttempts < 10) {
      googleInitAttempts += 1;
      setTimeout(initGoogleSignIn, 500);
    }
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
      width: 400
    });
  }
}

function handleCredentialResponse(response) {
  if (!response?.credential) {
    showToast('Sign in failed. Please try again.', 'error');
    return;
  }

  googleCredential = response.credential;
  googleUser = null;
  const authStatus = document.getElementById('authStatus');
  if (authStatus) {
    authStatus.textContent = 'Verifying your Google account…';
    authStatus.classList.remove('hidden');
  }
  const signIn = document.getElementById('gSignInDiv');
  if (signIn) signIn.style.display = 'none';
  if (ws?.readyState === WebSocket.OPEN) {
    updateConnectionStatus(false, 'Authenticating...');
    authenticateSocket();
  } else {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      try { ws.close(1000, 'Replacing unauthenticated socket'); } catch (error) { /* already closing */ }
    }
    ws = null;
    initWebSocket();
  }
}

function renderAuthenticatedUser(user) {
  if (!user || typeof user.name !== 'string' || typeof user.email !== 'string') return;
  googleUser = {
    sub: typeof user.sub === 'string' ? user.sub.slice(0, 200) : null,
    name: user.name.slice(0, 80),
    email: user.email.slice(0, 320),
    picture: typeof user.picture === 'string' && /^https:\/\//i.test(user.picture) ? user.picture : null
  };
  document.getElementById('authStatus')?.classList.add('hidden');
  const afterAuth = document.getElementById('afterAuth');
  afterAuth?.classList.remove('hidden');
  const signIn = document.getElementById('gSignInDiv');
  if (signIn) signIn.style.display = 'none';
  const avatar = document.getElementById('userAvatar');
  if (avatar) {
    avatar.textContent = googleUser.name.charAt(0).toUpperCase();
    if (googleUser.picture) {
      avatar.style.backgroundImage = `url("${CSS.escape(googleUser.picture)}")`;
      avatar.classList.add('image-avatar');
    }
  }
  document.getElementById('userName')?.replaceChildren(document.createTextNode(googleUser.name));
  document.getElementById('userEmail')?.replaceChildren(document.createTextNode(googleUser.email));
}

function authenticateSocket() {
  if (!googleCredential || !ws || ws.readyState !== WebSocket.OPEN) return;
  sendSignalingMessage({ type: 'authenticate', credential: googleCredential });
}

function closeMeetingSocket() {
  intentionalSocketClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    if (ws.readyState === WebSocket.OPEN) sendSignalingMessage({ type: 'logout' });
    try {
      ws.close(1000, 'Signed out');
    } catch (error) {
      console.warn('Could not close meeting socket:', error.message);
    }
    ws = null;
  }
}

function signOut() {
  if (isInMeeting) {
    if (!confirm('You are in a meeting. Are you sure you want to sign out?')) {
      return;
    }
    leaveMeeting(true);
  }

  clearAdmissionState();
  pendingRoomCode = null;
  closeMeetingSocket();
  googleCredential = null;
  sessionToken = null;
  googleUser = null;
  isAdmin = false;
  adminToken = null;
  window.google?.accounts?.id?.disableAutoSelect?.();
  document.getElementById('afterAuth').classList.add('hidden');
  document.getElementById('authStatus').classList.remove('hidden');
  document.getElementById('authStatus').textContent = 'Sign in to continue';
  document.getElementById('gSignInDiv').style.display = 'block';

  showToast('Signed out successfully', 'info');
}

// ===== ICE SERVER CONFIGURATION =====
async function loadIceServers() {
  if (SERVER_ENDPOINTS.length === 0) {
    pcConfig.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    pcConfig.iceTransportPolicy = 'all';
    return;
  }

  for (let offset = 0; offset < SERVER_ENDPOINTS.length; offset += 1) {
    const index = (currentServerIndex + offset) % SERVER_ENDPOINTS.length;
    try {
      const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
      const response = await fetch(SERVER_ENDPOINTS[index].ice, {
        cache: 'no-store',
        headers
      });
      if (!response.ok) throw new Error(`ICE endpoint returned ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) throw new Error('No ICE servers returned');
      currentServerIndex = index;
      pcConfig.iceServers = data.iceServers;
      pcConfig.iceTransportPolicy = data.iceTransportPolicy || 'all';
      pcConfig.iceCandidatePoolSize = data.iceCandidatePoolSize || 10;
      return;
    } catch (error) {
      console.warn(`ICE endpoint ${SERVER_ENDPOINTS[index].name} unavailable:`, error.message);
    }
  }

  pcConfig.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  pcConfig.iceTransportPolicy = 'all';
}

// ===== WEBSOCKET CONNECTION =====
function initWebSocket() {
  if (ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(ws.readyState)) return;
  if (SERVER_ENDPOINTS.length === 0) {
    showToast('No meeting server is configured.', 'error');
    return;
  }

  const currentEndpoint = SERVER_ENDPOINTS[currentServerIndex];
  const socketEpoch = ++signalingSocketEpoch;
  intentionalSocketClose = false;
  const socket = new WebSocket(currentEndpoint.ws);
  ws = socket;
  socketAuthenticated = false;
  updateConnectionStatus(false, googleCredential ? 'Connecting...' : 'Sign in to connect');

  socket.onopen = () => {
    if (ws !== socket) return;
    if (googleCredential) {
      updateConnectionStatus(false, 'Authenticating...');
      authenticateSocket();
    } else {
      updateConnectionStatus(false, 'Sign in to connect');
    }
  };

  socket.onmessage = async (evt) => {
    if (ws !== socket) return;
    try {
      const data = JSON.parse(evt.data);
      await handleSignalingMessage(data, socketEpoch);
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  };

  socket.onerror = () => {
    if (ws === socket) updateConnectionStatus(false, 'Connection error. Reconnecting...');
  };

  socket.onclose = event => {
    const isCurrentSocket = ws === socket;
    console.warn('Meeting WebSocket closed:', {
      code: event.code,
      reason: event.reason || 'none',
      wasClean: event.wasClean,
      authenticated: socketAuthenticated,
      signedIn: Boolean(googleCredential),
      inMeeting: isInMeeting,
      server: currentEndpoint.name
    });
    if (!isCurrentSocket) return;

    ws = null;
    socketAuthenticated = false;
    if (isInMeeting) resetPeerConnections('signaling socket closed');
    if (intentionalSocketClose) return;
    if (!googleCredential) {
      updateConnectionStatus(false, 'Sign in to connect');
      return;
    }

    updateConnectionStatus(false);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectAttempts += 1;
    // Live rooms stay pinned to their original backend because room state is in memory.
    if (!isInMeeting && reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      currentServerIndex = (currentServerIndex + 1) % SERVER_ENDPOINTS.length;
      reconnectAttempts = 0;
      showToast(`Trying ${SERVER_ENDPOINTS[currentServerIndex].name}…`, 'info');
    }
    const delay = Math.min(15_000, 1_000 * Math.max(1, reconnectAttempts));
    reconnectTimer = setTimeout(initWebSocket, delay);
  };
}

// ===== SIGNALING MESSAGE HANDLER =====
async function handleSignalingMessage(data, socketEpoch = signalingSocketEpoch) {
  if (socketEpoch !== signalingSocketEpoch) return;
  console.log('📩 Received:', data.type);

  switch (data.type) {
    case 'authenticated':
      socketAuthenticated = true;
      reconnectAttempts = 0;
      updateConnectionStatus(true);
      sessionToken = data.sessionToken || null;
      renderAuthenticatedUser(data.user);
      await loadIceServers();
      if (socketEpoch !== signalingSocketEpoch || ws?.readyState !== WebSocket.OPEN) return;
      showToast('Signed in successfully!', 'success');
      if (isInMeeting && roomId && resumeToken) {
        sendSignalingMessage({ type: 'resume_room', roomId, resumeToken }, socketEpoch);
      } else if (pendingAdmissionRoomId && !isInMeeting) {
        roomActionPending = 'prepare_join';
        sendSignalingMessage({ type: 'prepare_room', action: 'join', roomId: pendingAdmissionRoomId }, socketEpoch);
      } else if (pendingRoomCode && !isInMeeting) {
        const autoCode = pendingRoomCode;
        pendingRoomCode = null;
        showToast(`Auto-joining meeting ${autoCode}...`, 'info');
        joinRoomById(autoCode);
      }
      break;

    case 'your_info':
      if (data.clientId) {
        const previousClientId = clientId;
        clientId = data.clientId;
        if (previousClientId !== clientId) syncLocalVideoIdentity(previousClientId, clientId);
      }
      if (data.user) renderAuthenticatedUser(data.user);
      if (data.roomId) {
        isAdmin = !!data.isAdmin;
        adminToken = isAdmin && typeof data.adminToken === 'string' ? data.adminToken : null;
      } else if (!isInMeeting) {
        isAdmin = false;
        adminToken = null;
      }

      if (data.roomId) {
        roomId = data.roomId;
        updateRoomDisplay();
      }

      updateAdminUI();
      break;

    case 'room_created':
      roomId = data.roomId;
      roomAdminClientId = clientId;
      isAdmin = true;
      summaryState = 'not_requested';
      summaryId = null;
      resumeToken = data.resumeToken || resumeToken;
      updateRoomDisplay();
      showToast(`Room created: ${roomId}`, 'success');
      roomActionPending = null;
      showMeetingRoom();
      hideLoading();
      updateVideoGrid();
      break;

    case 'room_joined':
    case 'room_resumed':
      roomId = data.roomId || roomId;
      resumeToken = data.resumeToken || resumeToken;
      if (data.adminClientId) roomAdminClientId = data.adminClientId;
      if (data.summaryState) summaryState = data.summaryState;
      clearAdmissionState();
      updateRoomDisplay();
      roomActionPending = null;
      showMeetingRoom();
      hideLoading();
      if (data.type === 'room_resumed') showToast('Meeting connection restored', 'success');
      updateVideoGrid();
      break;

    case 'room_state':
      if (data.adminClientId) roomAdminClientId = data.adminClientId;
      if (data.summaryState) summaryState = data.summaryState;
      updateSummaryButton();
      participantsState.clear();
      for (const p of Array.isArray(data.participants) ? data.participants : []) {
        if (p.clientId !== clientId) {
          participantsState.set(p.clientId, {
            username: p.username,
            picture: p.picture,
            isMuted: !!p.isMuted,
            isAdminMuted: !!p.isAdminMuted,
            handRaised: !!p.handRaised,
            isCameraOff: !!p.isCameraOff
          });
          addParticipantToList(p.clientId, p.username, p.handRaised, p.isAdminMuted);
          updateParticipantCameraStatus(p.clientId, p.isCameraOff, p.username);
          if (p.connected !== false && shouldInitiatePeer(p.clientId)) {
            await createOffer(p.clientId, p.username, socketEpoch);
          }
        }
      }
      updateParticipantsList();
      updateVideoGrid();
      break;

    case 'peer_joined':
      showToast(`${data.username} joined`, 'info');
      participantsState.set(data.clientId, {
        username: data.username,
        picture: data.picture,
        isMuted: !!data.isMuted,
        isAdminMuted: !!data.isAdminMuted,
        handRaised: !!data.handRaised,
        isCameraOff: !!data.isCameraOff
      });
      addParticipantToList(data.clientId, data.username, !!data.handRaised, !!data.isAdminMuted);
      updateParticipantCameraStatus(data.clientId, data.isCameraOff, data.username);
      if (data.connected !== false && shouldInitiatePeer(data.clientId)) {
        await createOffer(data.clientId, data.username, socketEpoch);
      }
      break;

    case 'peer_reconnected':
      removePeer(data.clientId);
      participantsState.set(data.clientId, {
        username: data.username,
        picture: data.picture,
        isMuted: !!data.isMuted,
        isAdminMuted: !!data.isAdminMuted,
        handRaised: !!data.handRaised,
        isCameraOff: !!data.isCameraOff
      });
      addParticipantToList(data.clientId, data.username, !!data.handRaised, !!data.isAdminMuted);
      updateParticipantCameraStatus(data.clientId, data.isCameraOff, data.username);
      if (shouldInitiatePeer(data.clientId)) {
        await createOffer(data.clientId, data.username, socketEpoch);
      }
      break;

    case 'peer_disconnected':
      removePeer(data.clientId);
      participantsState.delete(data.clientId);
      break;

    case 'media_state': {
      if (data.clientId === clientId) {
        isMuted = !!data.isMuted;
        isCameraOff = !!data.isCameraOff;
        handRaised = !!data.handRaised;
        updateMicButton();
        updateCameraButton();
        updateRaiseHandButton();
        updateParticipantMuteStatus(clientId, isMuted);
        updateParticipantCameraStatus(clientId, isCameraOff, googleUser?.name);
      } else {
        const participant = participantsState.get(data.clientId);
        if (participant) {
          participant.isMuted = !!data.isMuted;
          participant.isAdminMuted = !!data.isAdminMuted;
          participant.handRaised = !!data.handRaised;
          participant.isCameraOff = !!data.isCameraOff;
          updateParticipantMuteStatus(data.clientId, participant.isAdminMuted || participant.isMuted);
          updateParticipantHandStatus(data.clientId, participant.handRaised);
        }
      }
      break;
    }

    case 'recording_state':
      if (data.clientId !== clientId) {
        showToast(`${data.username || 'A participant'} ${data.active ? 'started' : 'stopped'} recording`, data.active ? 'info' : 'success');
      }
      break;

    case 'room_prepared':
      if (data.action === 'create') {
        try {
          await setupLocalStream();
          if (socketEpoch !== signalingSocketEpoch || ws?.readyState !== WebSocket.OPEN) return;
          roomActionPending = 'create';
          sendSignalingMessage({ type: 'create_room' }, socketEpoch);
        } catch (error) {
          roomActionPending = null;
          hideLoading();
        }
      } else if (data.action === 'join' && data.roomId) {
        pendingAdmissionRoomId = data.roomId;
        roomActionPending = 'request_join';
        sendSignalingMessage({ type: 'request_join', roomId: data.roomId }, socketEpoch);
      }
      break;

    case 'join_request_pending':
      pendingAdmissionRequestId = data.requestId || null;
      pendingAdmissionRoomId = data.roomId || pendingAdmissionRoomId;
      showAdmissionWaiting(data.expiresAt);
      roomActionPending = 'waiting_for_admission';
      hideLoading();
      break;

    case 'pending_join_requests':
      if (isAdmin && data.roomId === roomId) {
        admissionRequests = new Map((Array.isArray(data.requests) ? data.requests : []).map(request => [request.requestId, request]));
        renderAdmissionRequests();
      }
      break;

    case 'join_request_received':
      if (isAdmin && data.roomId === roomId && data.requestId) {
        admissionRequests.set(data.requestId, data);
        renderAdmissionRequests();
        showToast(`${data.username || 'Someone'} is waiting to join`, 'info');
      }
      break;

    case 'join_request_removed':
      admissionRequests.delete(data.requestId);
      renderAdmissionRequests();
      break;

    case 'join_admitted':
      clearAdmissionWaiting();
      pendingAdmissionRequestId = data.requestId || pendingAdmissionRequestId;
      pendingAdmissionToken = data.admissionToken || null;
      pendingAdmissionRoomId = data.roomId || pendingAdmissionRoomId;
      roomActionPending = 'admitted_join';
      showLoading('Host admitted you. Preparing your camera…');
      try {
        await setupLocalStream();
        if (socketEpoch !== signalingSocketEpoch || ws?.readyState !== WebSocket.OPEN) return;
        sendSignalingMessage({
          type: 'join_room',
          roomId: pendingAdmissionRoomId,
          admissionToken: pendingAdmissionToken
        }, socketEpoch);
      } catch (error) {
        sendSignalingMessage({ type: 'cancel_join_request', requestId: pendingAdmissionRequestId }, socketEpoch);
        clearAdmissionState();
        hideLoading();
      }
      break;

    case 'join_rejected':
      clearAdmissionState();
      hideLoading();
      showToast('The host did not admit you to this meeting.', 'error');
      break;

    case 'join_request_expired':
      clearAdmissionState();
      hideLoading();
      showToast(data.reason === 'ADMISSION_TIMEOUT' ? 'The admission window expired before you joined.' : 'Your request to join expired.', 'info');
      break;

    case 'join_request_cancelled':
      clearAdmissionState();
      hideLoading();
      break;

    case 'screen_share_state':
      if (data.active) {
        screenShareOwnerId = data.clientId || null;
        showToast(`${data.username || 'A participant'} started screen sharing`, 'info');
      } else if (!data.clientId || data.clientId === screenShareOwnerId) {
        clearScreenStage(data.clientId);
      }
      break;

    case 'offer':
      if (isSafeClientId(data.from || data.fromId)) await handleOffer(data.from || data.fromId, data.fromUsername, data.sdp, socketEpoch);
      break;

    case 'answer':
      if (isSafeClientId(data.from || data.fromId)) await handleAnswer(data.from || data.fromId, data.sdp, socketEpoch);
      break;

    case 'ice_candidate':
      if (isSafeClientId(data.from || data.fromId)) await handleIceCandidate(data.from || data.fromId, data.candidate, socketEpoch);
      break;

    case 'force_mute':
      if (data.targetClientId === clientId) {
        isAdminMuted = !!data.isAdminMuted;
        isMuted = !!data.muteState;
        if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
        updateMicButton();
        updateParticipantMuteStatus(clientId, isMuted);
        showToast(isMuted ? 'You were muted by the host. Request to unmute if needed.' : 'Host allowed you to unmute', isMuted ? 'info' : 'success');
      } else {
        const pState = participantsState.get(data.targetClientId);
        if (pState) {
          pState.isMuted = !!data.muteState;
          pState.isAdminMuted = !!data.isAdminMuted;
          updateParticipantMuteStatus(data.targetClientId, pState.isAdminMuted || pState.isMuted);
        }
      }
      break;

    case 'hand_status_changed':
      if (data.clientId !== clientId) {
        const pState = participantsState.get(data.clientId);
        if (pState) {
          pState.handRaised = data.handRaised;
          updateParticipantHandStatus(data.clientId, data.handRaised);
        }

        if (data.handRaised && isAdmin) {
          showToast(`✋ ${data.username} raised hand`, 'info');
        }
      }
      break;

    case 'all_hands_lowered':
      handRaised = false;
      updateRaiseHandButton();
      participantsState.forEach((state, id) => {
        state.handRaised = false;
        updateParticipantHandStatus(id, false);
      });
      break;

    case 'unmute_request':
      showUnmuteRequestModal(data.fromClientId, data.fromUsername);
      break;

    case 'unmute_request_sent':
      showToast('Unmute request sent to host', 'info');
      break;

    case 'admin_changed':
      showToast(`${data.newAdminName} is now the host`, 'info');
      roomAdminClientId = data.newAdminId;
      if (data.newAdminId === clientId) {
        isAdmin = true;
        updateAdminUI();
      } else if (data.oldAdminId === clientId) {
        isAdmin = false;
        updateAdminUI();
      }
      updateParticipantsList();
      updateVideoGrid();
      break;

    case 'admin_transferred':
      showToast(`Admin transferred to ${data.newAdminName}`, 'info');
      roomAdminClientId = data.newAdminId;
      isAdmin = false;
      updateAdminUI();
      updateVideoGrid();
      break;

    case 'promoted_to_admin':
      showToast(`You are now the host (promoted by ${data.byUsername})`, 'success');
      roomAdminClientId = clientId;
      isAdmin = true;
      updateAdminUI();
      updateVideoGrid();
      break;

    case 'new_chat_message':
      displayChatMessage(data.fromUsername, data.message, data.timestamp, data.fromClientId === clientId, data.messageKind);
      break;

    case 'summary_status':
      summaryState = data.state || summaryState;
      summaryId = data.summaryId || summaryId;
      updateSummaryButton();
      if (data.state === 'generating') showToast('Generating the meeting summary…', 'info');
      if (data.state === 'published') {
        roomActionPending = null;
        showToast('Meeting summary shared in chat by Meet Clone.', 'success');
      }
      if (data.state === 'failed') {
        roomActionPending = null;
        showToast('Meeting summary could not be generated.', 'error');
      }
      break;

    // NEW: Handle caption messages with translation
    case 'caption':
      if (captionsEnabled && data.fromClientId && data.fromClientId !== clientId) {
        displayCaption(data.fromUsername, data.text, data.isFinal, data.language, data.fromClientId);
      }
      break;

    case 'peer_left':
      removePeer(data.clientId);
      participantsState.delete(data.clientId);
      showToast(`Participant left`, 'info');
      break;

    case 'meeting_ended':
      showToast('Meeting ended by host', 'info');
      leaveMeeting(true);
      break;

    case 'room_left':
      roomId = null;
      resumeToken = null;
      break;

    case 'disconnected':
      resetPeerConnections('signaling connection lost');
      updateConnectionStatus(false);
      break;

    case 'error':
      console.error('Server error:', data.message);
      if (['SUMMARY_NO_TRANSCRIPT', 'SUMMARY_NOT_CONFIGURED'].includes(data.code) || (data.code === 'UNAUTHORIZED' && roomActionPending === 'summary')) {
        summaryState = 'not_requested';
        roomActionPending = null;
        updateSummaryButton();
      }
      if (['ADMISSION_REQUIRED', 'ADMISSION_BUSY', 'ROOM_FULL', 'ROOM_NOT_FOUND'].includes(data.code) && !isInMeeting) {
        clearAdmissionState();
      }
      if (data.code === 'AUTH_FAILED' || data.code === 'AUTH_REQUIRED') {
        if (isInMeeting) leaveMeeting(true);
        closeMeetingSocket();
        googleCredential = null;
        sessionToken = null;
        googleUser = null;
        resumeToken = null;
        roomId = null;
        clientId = null;
        adminToken = null;
        isAdmin = false;
        document.getElementById('gSignInDiv')?.style.setProperty('display', 'flex');
        const authStatus = document.getElementById('authStatus');
        if (authStatus) {
          authStatus.textContent = 'Sign in to continue';
          authStatus.classList.remove('hidden');
        }
      }
      roomActionPending = null;
      showToast(data.message, 'error');
      hideLoading();
      break;

    default:
      console.warn('Unknown message type:', data.type);
  }
}

// ===== NEW: CAPTIONS & TRANSLATION FUNCTIONALITY =====

const clientTranslationCache = new Map();

/**
 * Calls our backend proxy to translate text with caching and fast fallback.
 */
async function translateText(text, sourceLang, targetLang, callback) {
  const cleanText = String(text || '').trim();
  if (!cleanText || sourceLang === targetLang) {
    callback(cleanText);
    return;
  }

  const cacheKey = `${sourceLang}->${targetLang}:${cleanText.toLowerCase()}`;
  if (clientTranslationCache.has(cacheKey)) {
    callback(clientTranslationCache.get(cacheKey));
    return;
  }

  const apiUrl = SERVER_ENDPOINTS[currentServerIndex]?.translate;
  if (!apiUrl || !sessionToken) {
    callback(cleanText);
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        text: cleanText,
        sourceLang,
        targetLang
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (response.ok) {
      const result = await response.json();
      if (result?.translatedText) {
        if (clientTranslationCache.size >= 500) {
          const oldest = clientTranslationCache.keys().next().value;
          clientTranslationCache.delete(oldest);
        }
        clientTranslationCache.set(cacheKey, result.translatedText);
        callback(result.translatedText);
        return;
      }
    }
    callback(cleanText);
  } catch (error) {
    console.warn('Translation request error:', error.message);
    callback(cleanText);
  }
}

/**
 * Renders the caption text to the DOM.
 * This is the final step, whether translated or not.
 */
function captionSpeakerKey(username, speakerClientId = null) {
  return String(speakerClientId || username || 'participant');
}

function renderCaption(username, text, isFinal, speakerClientId = null) {
  const container = document.getElementById('captionsDisplay');
  if (!container || (speakerClientId && speakerClientId === clientId)) return;
  const speakerKey = captionSpeakerKey(username, speakerClientId);
  const captionId = `caption-${Array.from(speakerKey).map(char => char.codePointAt(0).toString(16)).join('-')}`;
  let captionElement = document.getElementById(captionId);
  if (!captionElement) {
    captionElement = document.createElement('div');
    captionElement.id = captionId;
    captionElement.className = 'caption-item';
    container.appendChild(captionElement);
  }

  captionElement.innerHTML = `
    <span class="caption-speaker">${escapeHtml(username)}:</span>
    <span class="caption-text ${isFinal ? 'final' : 'interim'}">${escapeHtml(text)}</span>
  `;

  if (isFinal) {
    captionHistory.push({
      username,
      speakerClientId,
      text,
      timestamp: Date.now()
    });
    if (captionHistory.length > MAX_CAPTION_HISTORY) captionHistory.shift();
    setTimeout(() => {
      if (captionElement && captionElement.querySelector('.caption-text.final')) {
        captionElement.style.opacity = '0';
        setTimeout(() => captionElement?.remove(), 500);
      }
    }, 3000);
  }

  container.scrollTop = container.scrollHeight;
}

function displayCaption(username, text, isFinal, sourceLanguage = 'en-US', speakerClientId = null) {
  if (speakerClientId && speakerClientId === clientId) return;
  const speakerKey = captionSpeakerKey(username, speakerClientId);
  const needsTranslation = sourceLanguage && sourceLanguage !== myPreferredLanguage;

  if (!needsTranslation) {
    renderCaption(username, text, isFinal, speakerClientId);
    return;
  }

  if (isFinal) {
    clearTimeout(translationTimeouts.get(speakerKey));
    translationTimeouts.delete(speakerKey);
    translationCache.delete(speakerKey);

    const cacheKey = `${sourceLanguage}->${myPreferredLanguage}:${text.trim().toLowerCase()}`;
    if (clientTranslationCache.has(cacheKey)) {
      renderCaption(username, clientTranslationCache.get(cacheKey), true, speakerClientId);
      return;
    }

    renderCaption(username, `${text} (Translating…)`, false, speakerClientId);
    translateText(text, sourceLanguage, myPreferredLanguage, translatedText => {
      renderCaption(username, translatedText, true, speakerClientId);
    });
  } else {
    translationCache.set(speakerKey, text);
    clearTimeout(translationTimeouts.get(speakerKey));
    renderCaption(username, text, false, speakerClientId);

    const timeout = setTimeout(() => {
      const cachedText = translationCache.get(speakerKey);
      if (cachedText) {
        translateText(cachedText, sourceLanguage, myPreferredLanguage, translatedText => {
          renderCaption(username, translatedText, false, speakerClientId);
        });
        translationCache.delete(speakerKey);
      }
      translationTimeouts.delete(speakerKey);
    }, 350);
    translationTimeouts.set(speakerKey, timeout);
  }
}

function initSpeechRecognition() {
  // Check browser support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.info('Browser speech recognition is unavailable; Groq fallback will be used.');
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = captionLanguage; // Use the language I'm speaking
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    browserRecognitionFailures = 0;
    console.log('🎤 Browser speech recognition started');
  };

  recognition.onresult = (event) => {
    if (!captionsEnabled || captionProvider !== 'browser') return;
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;

      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      browserRecognitionFailures = 0;
      browserCaptionId ||= createClientToken();
      sendCaption(finalTranscript.trim(), true, browserCaptionId);
      browserCaptionId = null;
    } else if (interimTranscript) {
      browserRecognitionFailures = 0;
      browserCaptionId ||= createClientToken();
      sendCaption(interimTranscript.trim(), false, browserCaptionId);
    }
  };

  recognition.onerror = (event) => {
    if (!captionsEnabled || captionProvider !== 'browser') return;
    console.error('Speech recognition error:', event.error);

    if (event.error === 'no-speech') {
      // Restart if no speech detected
      if (captionsEnabled) {
        setTimeout(() => {
          if (captionsEnabled && recognition) {
            recognition.start();
          }
        }, 1000);
      }
    } else if (['not-allowed', 'service-not-allowed', 'network', 'language-not-supported'].includes(event.error)) {
      browserRecognitionFailures += 1;
      if (browserRecognitionFailures >= 1) switchToGroqCaptions(`Browser captions unavailable (${event.error})`);
    }
  };

  recognition.onend = () => {
    console.log('🎤 Browser speech recognition ended');
    // Restart if captions still enabled
    if (captionsEnabled && captionProvider === 'browser') {
      setTimeout(() => {
        if (captionsEnabled && recognition) {
          try {
            recognition.start();
          } catch (err) {
            console.error('Failed to restart recognition:', err);
          }
        }
      }, 500);
    }
  };

  return true;
}

function toggleCaptions() {
  if (!captionsEnabled) {
    startCaptions();
  } else {
    stopCaptions();
  }
}

function startCaptions() {
  if (!localStream || localStream.getAudioTracks().length === 0) {
    showToast('Cannot start captions: microphone not available', 'error');
    return;
  }

  captionsEnabled = true;
  const container = document.getElementById('captionsContainer');
  if (container) {
    container.classList.remove('hidden');
    container.removeAttribute('aria-hidden');
  }

  if (!recognition && initSpeechRecognition()) {
    captionProvider = 'browser';
  } else if (!recognition) {
    switchToGroqCaptions('Browser speech recognition is unavailable');
    return;
  }

  try {
    captionProvider = 'browser';
    recognition.lang = captionLanguage;
    recognition.start();
    updateCaptionsButton();
    showToast(`Captions started with browser recognition (Speaking ${CAPTION_LANGUAGES[captionLanguage]})`, 'success');
  } catch (err) {
    console.error('Failed to start captions:', err);
    switchToGroqCaptions('Browser captions could not start');
  }
}

function getGroqTranscriptionEndpoint() {
  return SERVER_ENDPOINTS[currentServerIndex]?.transcribe || null;
}

function getSupportedAudioMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

function startGroqCaptionCapture() {
  const endpoint = getGroqTranscriptionEndpoint();
  const audioTracks = localStream?.getAudioTracks?.() || [];
  const mimeType = getSupportedAudioMimeType();
  if (!endpoint || !sessionToken || audioTracks.length === 0 || !window.MediaRecorder || !mimeType) {
    return false;
  }

  try {
    groqRecorder?.stop();
  } catch (error) {
    console.warn('Could not stop previous Groq recorder:', error.message);
  }

  try {
    groqUploadQueue = [];
    groqChunkNumber = 0;
    groqFailureCount = 0;
    groqCaptureSessionId = createClientToken();
    groqRecorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType });
    groqRecorder.ondataavailable = event => {
      if (event.data?.size > 0 && captionsEnabled && captionProvider === 'groq') {
        if (groqUploadQueue.length >= MAX_GROQ_UPLOAD_QUEUE) groqUploadQueue.shift();
        groqUploadQueue.push({ blob: event.data, chunkNumber: ++groqChunkNumber });
        flushGroqUploadQueue();
      }
    };
    groqRecorder.onerror = () => switchToBrowserCaptions('Groq audio capture failed');
    groqRecorder.start(4_000);
    return true;
  } catch (error) {
    console.warn('Could not start Groq audio capture:', error.message);
    groqRecorder = null;
    groqUploadQueue = [];
    return false;
  }
}

async function flushGroqUploadQueue() {
  if (groqUploadBusy || !captionsEnabled || captionProvider !== 'groq') return;
  const item = groqUploadQueue.shift();
  if (!item) return;
  const endpoint = getGroqTranscriptionEndpoint();
  if (!endpoint || !sessionToken) return;

  groqUploadBusy = true;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': item.blob.type || 'audio/webm',
        'X-Caption-Language': captionLanguage,
        'X-Caption-Session': groqCaptureSessionId || createClientToken(),
        'X-Caption-Chunk': String(item.chunkNumber)
      },
      body: item.blob
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Groq transcription failed (${response.status})`);
    groqFailureCount = 0;
    // The server broadcasts this caption to other participants only.

  } catch (error) {
    groqFailureCount += 1;
    console.warn('Groq transcription failed:', error.message);
    if (groqFailureCount >= 2) switchToBrowserCaptions('Groq captions are unavailable');
  } finally {
    groqUploadBusy = false;
    flushGroqUploadQueue();
  }
}

function switchToGroqCaptions(reason) {
  if (!captionsEnabled || captionProvider === 'groq') return;
  if (recognition) {
    try { recognition.stop(); } catch (error) { /* already stopped */ }
  }
  captionProvider = 'groq';
  if (!startGroqCaptionCapture()) {
    captionsEnabled = false;
    updateCaptionsButton();
    showToast('Neither browser captions nor Groq fallback is available.', 'error');
    return;
  }
  updateCaptionsButton();
  showToast(`${reason}. Switched to Groq captions.`, 'info');
}

function switchToBrowserCaptions(reason) {
  if (!captionsEnabled || captionProvider === 'browser') return;
  try { groqRecorder?.stop(); } catch (error) { /* already stopped */ }
  groqRecorder = null;
  groqUploadQueue = [];
  if (!recognition && !initSpeechRecognition()) {
    captionsEnabled = false;
    updateCaptionsButton();
    showToast('Browser captions are unavailable.', 'error');
    return;
  }
  captionProvider = 'browser';
  try {
    recognition.lang = captionLanguage;
    recognition.start();
    showToast(`${reason}. Switched to browser captions.`, 'info');
  } catch (error) {
    switchToGroqCaptions('Browser captions could not restart');
  }
}

function stopCaptions() {
  if (recognition) {
    try {
      recognition.stop();
    } catch (err) {
      console.error('Error stopping recognition:', err);
    }
  }
  try {
    groqRecorder?.stop();
  } catch (err) {
    console.error('Error stopping Groq caption capture:', err);
  }
  groqRecorder = null;
  groqUploadQueue = [];
  groqUploadBusy = false;
  groqCaptureSessionId = null;
  browserCaptionId = null;
  captionProvider = 'browser';

  captionsEnabled = false;
  translationTimeouts.forEach(timeout => clearTimeout(timeout));
  translationTimeouts.clear();
  translationCache.clear();
  updateCaptionsButton();

  // Hide captions container
  const container = document.getElementById('captionsContainer');
  if (container) {
    container.classList.add('hidden');
    container.setAttribute('aria-hidden', 'true');
  }

  // Clear caption display
  clearCaptions();

  showToast('Captions stopped', 'info');
}

function createClientToken() {
  return window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sendCaption(text, isFinal, captionId = null) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const safeText = String(text || '').trim().slice(0, MAX_CAPTION_LENGTH);
  if (!safeText) return;

  sendSignalingMessage({
    type: 'caption',
    captionId: captionId || undefined,
    text: safeText,
    isFinal: isFinal,
    language: captionLanguage
  });
}

function clearCaptions() {
  const container = document.getElementById('captionsDisplay');
  container.innerHTML = '';
}

function updateCaptionsButton() {
  const btn = document.getElementById('captionsBtn');
  if (!btn) return;

  const icon = btn.querySelector('i');

  if (captionsEnabled) {
    icon.className = 'fas fa-closed-captioning';
    btn.classList.add('active');
    btn.title = 'Turn off captions';
  } else {
    icon.className = 'far fa-closed-captioning';
    btn.classList.remove('active');
    btn.title = 'Turn on captions';
  }
}

function showCaptionSettings() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';

  let languageOptions = '';
  for (const [code, name] of Object.entries(CAPTION_LANGUAGES)) {
    languageOptions += `<option value="${code}" ${code === captionLanguage ? 'selected' : ''}>${name}</option>`;
  }

  // Create options for preferred language
  let preferredLanguageOptions = '';
  for (const [code, name] of Object.entries(CAPTION_LANGUAGES)) {
    preferredLanguageOptions += `<option value="${code}" ${code === myPreferredLanguage ? 'selected' : ''}>${name}</option>`;
  }

  modal.innerHTML = `
    <div class="modal-content">
      <h3>Caption Settings</h3>

      <div class="settings-group">
        <label for="captionLanguageSelect">Spoken Language (What I speak)</label>
        <select id="captionLanguageSelect" class="settings-select">
          ${languageOptions}
        </select>
      </div>

      <div class="settings-group">
        <label for="preferredLanguageSelect">Translation (What I read)</label>
        <select id="preferredLanguageSelect" class="settings-select">
          ${preferredLanguageOptions}
        </select>
      </div>

      <div class="settings-group">
        <button class="btn-secondary" data-action="download-captions">
          <i class="fas fa-download"></i>
          Download Caption History
        </button>
      </div>

      <div class="modal-actions">
        <button class="btn-secondary" data-action="close-modal">Cancel</button>
        <button class="btn-primary" data-action="apply-caption-settings">Apply</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function applyCaptionSettings() {
  const selectLang = document.getElementById('captionLanguageSelect');
  const newLang = selectLang.value;

  const selectPreferred = document.getElementById('preferredLanguageSelect');
  const newPreferredLang = selectPreferred.value;

  myPreferredLanguage = newPreferredLang;

  if (newLang !== captionLanguage) {
    captionLanguage = newLang;

    // Restart recognition with new language if active
    if (captionsEnabled && recognition) {
      recognition.stop();
      setTimeout(() => {
        recognition.lang = captionLanguage;
        recognition.start();
      }, 500);
    }
  }

  showToast(`Settings updated: Speaking ${CAPTION_LANGUAGES[captionLanguage]}, Reading ${CAPTION_LANGUAGES[myPreferredLanguage]}`, 'success');
}

function downloadCaptionHistory() {
  if (captionHistory.length === 0) {
    showToast('No captions to download', 'info');
    return;
  }

  let content = `Meeting Captions - Room ${roomId}\n`;
  content += `Generated: ${new Date().toLocaleString()}\n`;
  content += `(Captions shown in your preferred language: ${CAPTION_LANGUAGES[myPreferredLanguage]})\n\n`;
  content += '='.repeat(50) + '\n\n';

  captionHistory.forEach(item => {
    const time = new Date(item.timestamp).toLocaleTimeString();
    content += `[${time}] ${item.username}: ${item.text}\n\n`;
  });

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `captions-${roomId}-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Caption history downloaded', 'success');
}

function clearAdmissionWaiting() {
  if (pendingAdmissionTimer) {
    clearInterval(pendingAdmissionTimer);
    pendingAdmissionTimer = null;
  }
  document.getElementById('admissionWaitingModal')?.remove();
}

function clearAdmissionState() {
  clearAdmissionWaiting();
  pendingAdmissionRequestId = null;
  pendingAdmissionToken = null;
  pendingAdmissionRoomId = null;
}

function showAdmissionWaiting(expiresAt) {
  clearAdmissionWaiting();
  const modal = document.createElement('div');
  modal.id = 'admissionWaitingModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content admission-waiting-modal" role="dialog" aria-modal="true" aria-labelledby="admissionWaitingTitle">
      <h3 id="admissionWaitingTitle">Waiting for host approval</h3>
      <p>The host has been notified. Keep this window open while you wait.</p>
      <p id="admissionWaitingCountdown" class="admission-countdown" role="status" aria-live="polite"></p>
      <div class="modal-actions">
        <button class="btn-secondary" data-action="cancel-admission">Cancel request</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const updateCountdown = () => {
    const remaining = Math.max(0, Number(expiresAt) - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const countdown = document.getElementById('admissionWaitingCountdown');
    if (countdown) countdown.textContent = seconds > 0 ? `Request expires in ${Math.ceil(seconds / 60)} minute${seconds >= 120 ? 's' : ''}.` : 'Request expired.';
    if (remaining <= 0) clearAdmissionWaiting();
  };
  updateCountdown();
  pendingAdmissionTimer = setInterval(updateCountdown, 1000);
}

function cancelAdmissionRequest() {
  if (pendingAdmissionRequestId) {
    sendSignalingMessage({ type: 'cancel_join_request', requestId: pendingAdmissionRequestId });
  }
  clearAdmissionState();
  pendingRoomCode = null;
  roomActionPending = null;
  hideLoading();
  showToast('Join request cancelled', 'info');
}

function admitJoinRequest(requestId) {
  if (!isAdmin || !requestId) return;
  sendSignalingMessage({ type: 'admit_join_request', requestId, adminToken });
}

function rejectJoinRequest(requestId) {
  if (!isAdmin || !requestId) return;
  sendSignalingMessage({ type: 'reject_join_request', requestId, adminToken });
}

function renderAdmissionRequests() {
  const panel = document.getElementById('admissionRequestsPanel');
  const list = document.getElementById('admissionRequestList');
  const count = document.getElementById('admissionRequestCount');
  if (!panel || !list || !count) return;
  if (!isAdmin) {
    panel.classList.add('hidden');
    list.replaceChildren();
    count.textContent = '0';
    return;
  }
  panel.classList.remove('hidden');
  list.replaceChildren();
  count.textContent = String(admissionRequests.size);
  if (admissionRequests.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'admission-empty';
    empty.textContent = 'No one is waiting to join.';
    list.appendChild(empty);
    return;
  }

  admissionRequests.forEach(request => {
    const row = document.createElement('div');
    row.className = 'admission-request';
    row.dataset.requestId = request.requestId;

    const info = document.createElement('div');
    info.className = 'admission-request-info';
    const avatar = document.createElement('div');
    avatar.className = 'participant-avatar admission-avatar';
    avatar.textContent = String(request.username || 'Participant').charAt(0).toUpperCase();
    if (request.picture && /^https:\/\//i.test(request.picture)) {
      avatar.style.backgroundImage = `url("${CSS.escape(request.picture)}")`;
      avatar.classList.add('image-avatar');
    }
    const details = document.createElement('div');
    details.className = 'participant-details';
    const name = document.createElement('p');
    name.textContent = String(request.username || 'Participant').slice(0, 80);
    const expiry = document.createElement('span');
    expiry.textContent = request.expiresAt ? `Expires ${new Date(request.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting';
    details.append(name, expiry);
    info.append(avatar, details);

    const actions = document.createElement('div');
    actions.className = 'admission-actions';
    const admit = document.createElement('button');
    admit.className = 'btn-admission admit';
    admit.type = 'button';
    admit.dataset.action = 'admit-request';
    admit.dataset.requestId = request.requestId;
    admit.textContent = 'Admit';
    admit.setAttribute('aria-label', `Admit ${name.textContent}`);
    const reject = document.createElement('button');
    reject.className = 'btn-admission reject';
    reject.type = 'button';
    reject.dataset.action = 'reject-request';
    reject.dataset.requestId = request.requestId;
    reject.textContent = 'Reject';
    reject.setAttribute('aria-label', `Reject ${name.textContent}`);
    actions.append(admit, reject);

    row.append(info, actions);
    list.appendChild(row);
  });
}

// ===== ADMIN UI UPDATES =====
function updateAdminUI() {
  const endMeetingBtn = document.getElementById('endMeetingBtn');
  const muteAllBtn = document.getElementById('muteAllBtn');
  const raiseHandBtn = document.getElementById('raiseHandBtn');
  const summaryBtn = document.getElementById('summaryBtn');

  if (isAdmin) {
    endMeetingBtn?.classList.remove('hidden');
    muteAllBtn?.classList.remove('hidden');
    raiseHandBtn?.classList.add('hidden');
    summaryBtn?.classList.remove('hidden');
  } else {
    endMeetingBtn?.classList.add('hidden');
    muteAllBtn?.classList.add('hidden');
    raiseHandBtn?.classList.remove('hidden');
    summaryBtn?.classList.add('hidden');
  }
  updateSummaryButton();
  renderAdmissionRequests();
}

function updateSummaryButton() {
  const button = document.getElementById('summaryBtn');
  if (!button) return;
  const done = summaryState === 'published' || summaryState === 'failed';
  button.disabled = !isAdmin || summaryState === 'generating' || done;
  button.classList.toggle('active', summaryState === 'generating');
  button.title = summaryState === 'generating'
    ? 'Generating meeting summary…'
    : done
      ? 'Meeting summary already requested'
      : 'Get meeting summary';
  button.setAttribute('aria-label', button.title);
}

function requestMeetingSummary() {
  if (!isAdmin || !roomId || !adminToken || summaryState !== 'not_requested') return;
  sendSignalingMessage({ type: 'request_meeting_summary', adminToken });
  roomActionPending = 'summary';
  summaryState = 'generating';
  updateSummaryButton();
}

// ===== ROOM ACTIONS =====
async function createRoom() {
  if (!googleUser) {
    showToast('Please sign in first', 'error');
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('Not connected to server', 'error');
    return;
  }

  showLoading('Creating room...');

  try {
    roomActionPending = 'prepare_create';
    sendSignalingMessage({ type: 'prepare_room', action: 'create' });
  } catch (err) {
    console.error('Failed to create room:', err);
    showToast('Failed to create room', 'error');
    hideLoading();
  }
}

async function joinRoomById(targetRoomId) {
  const id = String(targetRoomId || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(id)) {
    showToast('Enter a valid six-character meeting code', 'error');
    return;
  }

  if (!googleUser) {
    pendingRoomCode = id;
    const input = document.getElementById('roomIdInput');
    if (input) input.value = id;
    showToast('Please sign in with Google to enter meeting', 'info');
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    pendingRoomCode = id;
    showToast('Connecting to server...', 'info');
    initWebSocket();
    return;
  }

  showLoading(`Joining room ${id}...`);

  try {
    pendingRoomCode = id;
    roomActionPending = 'prepare_join';
    sendSignalingMessage({ type: 'prepare_room', action: 'join', roomId: id });
  } catch (err) {
    console.error('Failed to join room:', err);
    showToast('Failed to join room: ' + (err.message || 'Stream error'), 'error');
    hideLoading();
  }
}

async function joinRoomPrompt() {
  const input = document.getElementById('roomIdInput');
  const id = input ? input.value.trim().toUpperCase() : '';
  await joinRoomById(id);
}

function updateRoomDisplay() {
  const display = document.getElementById('roomDisplay');
  if (display) {
    display.textContent = roomId ? `Room: ${roomId}` : 'Room: Not connected';
  }
}

function copyRoomId() {
  if (!roomId) return;

  navigator.clipboard.writeText(roomId).then(() => {
    const btn = document.getElementById('copyRoomBtn');
    if (btn) {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, 2000);
    }
    showToast('Room code copied to clipboard', 'success');
  }).catch(err => {
    console.error('Failed to copy:', err);
    copyTextFallback(roomId);
    showToast('Room code copied to clipboard', 'success');
  });
}

function copyTextFallback(text) {
  const tempInput = document.createElement('input');
  tempInput.value = text;
  tempInput.style.position = 'fixed';
  tempInput.style.opacity = '0';
  document.body.appendChild(tempInput);
  tempInput.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    console.error('Fallback execCommand copy failed:', e);
  }
  document.body.removeChild(tempInput);
}

function copyMeetingLink() {
  if (!roomId) {
    showToast('No active meeting room', 'error');
    return;
  }

  const url = new URL(window.location.href);
  url.search = '';
  url.hash = `room-code=${encodeURIComponent(roomId)}`;
  const inviteUrl = url.toString();

  const finishCopy = () => {
    const btn = document.getElementById('copyLinkBtn');
    if (btn) {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Link copied!';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, 2000);
    }
    showToast('Meeting link copied! Share this link to invite others.', 'success');
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inviteUrl).then(finishCopy).catch(() => {
      copyTextFallback(inviteUrl);
      finishCopy();
    });
  } else {
    copyTextFallback(inviteUrl);
    finishCopy();
  }
}

function checkUrlRoomCode() {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room-code') ||
                 params.get('room_code') ||
                 params.get('room') ||
                 params.get('roomId');

    let hashVal = '';
    if (window.location.hash) {
      const hash = window.location.hash.substring(1);
      if (hash.includes('=')) {
        const hashParams = new URLSearchParams(hash);
        hashVal = hashParams.get('room-code') || hashParams.get('room_code') || hashParams.get('room');
      } else if (/^[A-Za-z0-9]{6}$/.test(hash)) {
        hashVal = hash;
      }
    }

    const roomCode = (code || hashVal || '').trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(roomCode)) {
      pendingRoomCode = roomCode;
      const input = document.getElementById('roomIdInput');
      if (input) input.value = roomCode;

      const inviteNotice = document.getElementById('roomInviteNotice');
      const codeDisplay = document.getElementById('inviteCodeDisplay');
      if (inviteNotice && codeDisplay) {
        codeDisplay.textContent = roomCode;
        inviteNotice.classList.remove('hidden');
      }

      const authStatus = document.getElementById('authStatus');
      if (authStatus && !googleUser) {
        authStatus.textContent = `Sign in with Google to enter meeting ${roomCode}`;
      }

      // Remove the invitation code from browser history after reading it.
      const cleanUrl = new URL(window.location.href);
      ['room-code', 'room_code', 'room', 'roomId'].forEach(key => cleanUrl.searchParams.delete(key));
      cleanUrl.hash = '';
      window.history.replaceState({}, document.title, cleanUrl.toString());

      if (googleUser && ws && ws.readyState === WebSocket.OPEN && !isInMeeting) {
        const toJoin = pendingRoomCode;
        pendingRoomCode = null;
        joinRoomById(toJoin);
      }
    }
  } catch (e) {
    console.warn('Error reading URL room code:', e);
  }
}

// ===== LOCAL STREAM SETUP =====
async function setupLocalStream() {
  if (localStream) {
    console.log('✅ Local stream already exists');
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Camera and microphone access are not supported in this browser.', 'error');
    throw new Error('getUserMedia is unavailable');
  }

  try {
    console.log('🎥 Requesting camera and microphone access...');
    const fullConstraints = {
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
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia(fullConstraints);
    } catch (fullError) {
      console.warn('Combined camera/microphone permission failed:', fullError.name);
      const fallbackConstraints = [
        { video: fullConstraints.video, audio: false },
        { video: false, audio: fullConstraints.audio }
      ];
      for (const constraints of fallbackConstraints) {
        try {
          localStream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (fallbackError) {
          console.warn('Media fallback failed:', fallbackError.name);
        }
      }
      if (!localStream) throw fullError;
      showToast('Joined with limited media access. You can retry your camera or microphone later.', 'info');
    }

    console.log('✅ Local stream obtained');
    isCameraOff = localStream.getVideoTracks().length === 0;
    isMuted = localStream.getAudioTracks().length === 0;
    addVideoElement(clientId || 'local', localStream, true, googleUser.name);
    updateMicButton();
    updateCameraButton();
    updateBackgroundFilterButton();
    updateParticipantCameraStatus(clientId || 'local', isCameraOff, googleUser.name);
  } catch (err) {
    console.error('❌ getUserMedia failed:', err);
    showToast('Could not access camera/microphone', 'error');
    throw err;
  }
}

const BACKGROUND_EFFECTS = {
  none: { label: 'None', color: null },
  blur: { label: 'Blur', color: null },
  white: { label: 'Soft white', color: '#f3f6fb' },
  black: { label: 'Black', color: '#050505' },
  peach: { label: 'Soft peach', color: '#f4d5c5' },
  lavender: { label: 'Soft lavender', color: '#ddd7f5' },
  mint: { label: 'Soft mint', color: '#cfe8dd' },
  sky: { label: 'Soft sky', color: '#cfe2f4' },
  sand: { label: 'Soft sand', color: '#e9ddc5' }
};

function showBackgroundSettings() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content background-modal" role="dialog" aria-modal="true" aria-labelledby="backgroundSettingsTitle">
      <h3 id="backgroundSettingsTitle">Background filters</h3>
      <p>Choose a prebuilt camera background. Your microphone and screen share are not affected.</p>
      <div class="background-options" role="group" aria-label="Background filter choices">
        ${Object.entries(BACKGROUND_EFFECTS).map(([effect, option]) => `
          <button type="button" class="background-option ${backgroundEffect === effect ? 'selected' : ''}" data-action="select-background" data-effect="${effect}" aria-pressed="${backgroundEffect === effect}">
            <span class="background-swatch background-${effect}" aria-hidden="true"></span>
            <span>${option.label}</span>
          </button>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" data-action="close-modal">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function getRawCameraVideoTrack() {
  return localStream?.getVideoTracks?.()[0] || null;
}

function getPublishedCameraVideoTrack() {
  return (backgroundEffect !== 'none' && backgroundPipeline?.track) || getRawCameraVideoTrack();
}

function getPublishedScreenVideoTrack() {
  return isScreenSharing ? screenStream?.getVideoTracks?.()[0] || null : null;
}

async function replaceCameraTrack(track) {
  for (const [peerId, peer] of Object.entries(peers)) {
    const sender = peer.cameraTransceiver?.sender || peer.cameraSender;
    if (!sender) continue;
    try {
      await sender.replaceTrack(track || null);
    } catch (error) {
      console.warn(`Could not replace camera track for ${peerId}:`, error.message);
    }
  }
}

async function replaceScreenTrack(track) {
  for (const [peerId, peer] of Object.entries(peers)) {
    const sender = peer.screenTransceiver?.sender;
    if (!sender) continue;
    try {
      await sender.replaceTrack(track || null);
    } catch (error) {
      console.warn(`Could not replace screen track for ${peerId}:`, error.message);
    }
  }
}

function updateLocalVideoPreview() {
  if (isScreenSharing) return;
  const localVideo = document.querySelector(`#video-${clientId} video`) || document.querySelector('#video-local video');
  if (!localVideo) return;
  if (backgroundEffect !== 'none' && backgroundPipeline?.stream) {
    localVideo.srcObject = backgroundPipeline.stream;
  } else if (localStream) {
    localVideo.srcObject = localStream;
  }
  localVideo.style.transform = 'scaleX(-1)';
}

function drawBackgroundResults(results) {
  const pipeline = backgroundPipeline;
  if (!pipeline || !results?.image || !results.segmentationMask) return;
  const width = results.image.videoWidth || results.image.width || pipeline.width;
  const height = results.image.videoHeight || results.image.height || pipeline.height;
  if (width !== pipeline.width || height !== pipeline.height) {
    pipeline.width = width;
    pipeline.height = height;
    pipeline.canvas.width = width;
    pipeline.canvas.height = height;
    pipeline.backgroundCanvas.width = width;
    pipeline.backgroundCanvas.height = height;
    pipeline.personCanvas.width = width;
    pipeline.personCanvas.height = height;
  }

  const backgroundContext = pipeline.backgroundCanvas.getContext('2d');
  const personContext = pipeline.personCanvas.getContext('2d');
  const outputContext = pipeline.canvas.getContext('2d');
  backgroundContext.clearRect(0, 0, width, height);
  if (backgroundEffect === 'blur') {
    backgroundContext.save();
    backgroundContext.filter = 'blur(18px)';
    backgroundContext.drawImage(results.image, -18, -18, width + 36, height + 36);
    backgroundContext.restore();
  } else {
    backgroundContext.fillStyle = BACKGROUND_EFFECTS[backgroundEffect]?.color || '#111';
    backgroundContext.fillRect(0, 0, width, height);
  }

  personContext.clearRect(0, 0, width, height);
  personContext.globalCompositeOperation = 'source-over';
  personContext.drawImage(results.image, 0, 0, width, height);
  personContext.globalCompositeOperation = 'destination-in';
  personContext.drawImage(results.segmentationMask, 0, 0, width, height);
  personContext.globalCompositeOperation = 'source-over';

  outputContext.clearRect(0, 0, width, height);
  outputContext.drawImage(pipeline.backgroundCanvas, 0, 0, width, height);
  outputContext.drawImage(pipeline.personCanvas, 0, 0, width, height);
}

function stopBackgroundPipeline() {
  const pipeline = backgroundPipeline;
  if (!pipeline) return;
  pipeline.stopped = true;
  if (pipeline.frameId) cancelAnimationFrame(pipeline.frameId);
  try { pipeline.segmentation?.close?.(); } catch (error) { console.warn('Could not close background model:', error.message); }
  pipeline.sourceVideo.pause();
  pipeline.sourceVideo.srcObject = null;
  pipeline.processedStream?.getTracks?.().forEach(track => track.stop());
  pipeline.sourceVideo.remove();
  backgroundPipeline = null;
}

async function ensureBackgroundPipeline() {
  if (backgroundPipeline) return backgroundPipeline;
  const sourceTrack = getRawCameraVideoTrack();
  if (!sourceTrack || !window.SelfieSegmentation || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error('Background processing is not supported in this browser');
  }

  const sourceVideo = document.createElement('video');
  sourceVideo.muted = true;
  sourceVideo.autoplay = true;
  sourceVideo.playsInline = true;
  sourceVideo.setAttribute('aria-hidden', 'true');
  sourceVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px;';
  sourceVideo.srcObject = new MediaStream([sourceTrack]);
  document.body.appendChild(sourceVideo);
  await sourceVideo.play();
  await new Promise(resolve => {
    if (sourceVideo.videoWidth) return resolve();
    sourceVideo.addEventListener('loadedmetadata', resolve, { once: true });
  });

  const width = sourceVideo.videoWidth || sourceTrack.getSettings?.().width || 640;
  const height = sourceVideo.videoHeight || sourceTrack.getSettings?.().height || 360;
  const canvas = document.createElement('canvas');
  const backgroundCanvas = document.createElement('canvas');
  const personCanvas = document.createElement('canvas');
  [canvas, backgroundCanvas, personCanvas].forEach(item => {
    item.width = width;
    item.height = height;
  });
  const segmentation = new SelfieSegmentation({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
  });
  segmentation.setOptions({ modelSelection: 1 });

  const processedStream = canvas.captureStream(24);
  const pipeline = {
    sourceVideo,
    canvas,
    backgroundCanvas,
    personCanvas,
    segmentation,
    processedStream,
    track: processedStream.getVideoTracks()[0],
    stream: processedStream,
    width,
    height,
    frameId: null,
    processing: false,
    stopped: false
  };
  backgroundPipeline = pipeline;
  segmentation.onResults(drawBackgroundResults);

  const processFrame = async () => {
    if (pipeline.stopped) return;
    if (!pipeline.processing && !isCameraOff && sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      pipeline.processing = true;
      try {
        await segmentation.send({ image: sourceVideo });
      } catch (error) {
        console.warn('Background processing frame failed:', error.message);
      } finally {
        pipeline.processing = false;
      }
    }
    pipeline.frameId = requestAnimationFrame(processFrame);
  };
  pipeline.frameId = requestAnimationFrame(processFrame);
  return pipeline;
}

async function setBackgroundEffect(effect) {
  if (!BACKGROUND_EFFECTS[effect]) return;
  if (effect === backgroundEffect && (effect === 'none' || backgroundPipeline)) return;
  if (!localStream?.getVideoTracks?.().length) {
    showToast('Turn on your camera before choosing a background filter.', 'info');
    return;
  }
  if (isScreenSharing) {
    backgroundEffect = effect;
    if (effect === 'none') stopBackgroundPipeline();
    updateBackgroundFilterButton();
    showToast(`${BACKGROUND_EFFECTS[effect].label} will apply when screen sharing stops.`, 'info');
    return;
  }

  if (effect === 'none') {
    backgroundEffect = 'none';
    stopBackgroundPipeline();
    await replaceCameraTrack(getRawCameraVideoTrack());
    updateLocalVideoPreview();
    updatePresenterOverlay();
    updateBackgroundFilterButton();
    showToast('Background filter removed', 'info');
    return;
  }

  try {
    backgroundEffect = effect;
    await ensureBackgroundPipeline();
    await replaceCameraTrack(backgroundPipeline.track);
    updateLocalVideoPreview();
    updatePresenterOverlay();
    updateBackgroundFilterButton();
    showToast(`${BACKGROUND_EFFECTS[effect].label} background applied`, 'success');
  } catch (error) {
    console.error('Background filter failed:', error);
    backgroundEffect = 'none';
    stopBackgroundPipeline();
    updateBackgroundFilterButton();
    showToast('Background filters are not available in this browser.', 'error');
  }
}

function updateBackgroundFilterButton() {
  const button = document.getElementById('backgroundFilterBtn');
  if (!button) return;
  button.classList.toggle('active', backgroundEffect !== 'none');
  button.title = backgroundEffect === 'none' ? 'Background filters' : `Background: ${BACKGROUND_EFFECTS[backgroundEffect].label}`;
  button.setAttribute('aria-label', button.title);
}

// ===== SCREEN SHARING =====
async function toggleScreenShare() {
  if (!isScreenSharing) {
    try {
      console.log('🖥️ Starting screen share...');

      if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen sharing is not supported in this browser or context. Use HTTPS and a supported browser.');
      }
      const isMobileBrowser = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: isMobileBrowser ? true : {
          cursor: 'always',
          displaySurface: 'monitor'
        },
        audio: false
      });

      const screenTrack = screenStream.getVideoTracks()[0];

      screenTrack.onended = () => {
        stopScreenShare();
      };

      isScreenSharing = true;
      screenShareOwnerId = clientId;
      await replaceScreenTrack(screenTrack);
      showScreenStage(clientId, screenStream);
      sendSignalingMessage({ type: 'screen_share_state', active: true });
      updateScreenShareButton();
      showToast('Screen sharing started', 'success');

    } catch (err) {
      console.error('❌ Screen share failed:', err);
      if (err?.name === 'NotAllowedError') {
        showToast('Screen sharing was cancelled or blocked by the browser.', 'info');
      } else if (err?.name === 'NotSupportedError' || /not supported/i.test(err?.message || '')) {
        showToast('Screen sharing is not supported in this browser. Use HTTPS or a supported browser.', 'error');
      } else {
        showToast('Screen sharing could not start. Check browser permissions and try again.', 'error');
      }
    }
  } else {
    stopScreenShare();
  }
}

async function stopScreenShare() {
  if (!screenStream) return;

  console.log('⏹️ Stopping screen share...');
  const previousOwnerId = screenShareOwnerId;
  screenStream.getTracks().forEach(track => track.stop());
  screenStream = null;
  isScreenSharing = false;

  await replaceScreenTrack(null);
  clearScreenStage(previousOwnerId);

  if (backgroundEffect !== 'none' && !backgroundPipeline) {
    try {
      await ensureBackgroundPipeline();
    } catch (error) {
      backgroundEffect = 'none';
      updateBackgroundFilterButton();
      showToast('Background filter could not be restored after screen sharing.', 'error');
    }
  }
  const videoTrack = getPublishedCameraVideoTrack();
  await replaceCameraTrack(videoTrack);
  const localVideo = document.querySelector(`#video-${clientId} video`);
  if (localVideo) {
    localVideo.srcObject = backgroundPipeline?.stream || localStream;
    localVideo.style.transform = 'scaleX(-1)';
  }

  sendSignalingMessage({ type: 'screen_share_state', active: false });
  updateScreenShareButton();
  showToast('Screen sharing stopped', 'info');
}

function updateScreenShareButton() {
  const btn = document.getElementById('screenShareBtn');
  if (!btn) return;

  const icon = btn.querySelector('i');

  if (isScreenSharing) {
    icon.className = 'fas fa-stop-circle';
    btn.classList.add('active');
    btn.title = 'Stop sharing';
  } else {
    icon.className = 'fas fa-desktop';
    btn.classList.remove('active');
    btn.title = 'Share screen';
  }
}

// ===== RECORDING FUNCTIONALITY =====
async function toggleRecording() {
  if (!isRecording) {
    await startRecording();
  } else {
    stopRecording();
  }
}

async function startRecording() {
  try {
    console.log('🔴 Starting recording...');
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      showToast('Recording is not supported in this browser.', 'error');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    const canvasStream = canvas.captureStream(30);

    let audioContext;
    let destination;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      const audioStreams = Array.from(document.querySelectorAll('#videoGrid video'))
        .map(videoElement => videoElement.srcObject)
        .filter(stream => stream?.getAudioTracks?.().length > 0);
      if (audioStreams.length > 0) {
        audioContext = new AudioContextClass();
        destination = audioContext.createMediaStreamDestination();
        audioStreams.forEach(stream => {
          try {
            audioContext.createMediaStreamSource(stream).connect(destination);
          } catch (error) {
            console.warn('Could not mix one participant audio stream:', error.message);
          }
        });
        destination.stream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
      }
    }

    const captureFrame = () => {
      if (!isRecording) return;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const videoGrid = document.getElementById('videoGrid');
      const videos = videoGrid.querySelectorAll('video');

      const cols = Math.max(1, Math.ceil(Math.sqrt(videos.length)));
      const rows = Math.max(1, Math.ceil(videos.length / cols));
      const videoWidth = canvas.width / cols;
      const videoHeight = canvas.height / rows;

      videos.forEach((video, index) => {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          const col = index % cols;
          const row = Math.floor(index / cols);
          const x = col * videoWidth;
          const y = row * videoHeight;

          ctx.drawImage(video, x, y, videoWidth, videoHeight);
        }
      });

      recordingFrameId = requestAnimationFrame(captureFrame);
    };

    const options = {
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: 2500000
    };

    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm;codecs=vp8,opus';
    }

    mediaRecorder = new MediaRecorder(canvasStream, options);
    recordedChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (recordingFrameId) cancelAnimationFrame(recordingFrameId);
      recordingFrameId = null;
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `meeting-${roomId}-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      showToast('Recording saved!', 'success');

      if (audioContext) {
        audioContext.close();
      }
    };

    isRecording = true;
    mediaRecorder.start(1000);
    captureFrame();
    sendSignalingMessage({ type: 'recording_state', active: true });
    updateRecordingButton();
    showToast('Recording started', 'success');

  } catch (err) {
    console.error('❌ Recording failed:', err);
    showToast('Failed to start recording', 'error');
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    isRecording = false;
    return;
  }

  console.log('⏹️ Stopping recording...');
  mediaRecorder.stop();
  isRecording = false;
  sendSignalingMessage({ type: 'recording_state', active: false });
  updateRecordingButton();
  showToast('Recording stopped', 'info');
}

function updateRecordingButton() {
  const btn = document.getElementById('recordBtn');
  if (!btn) return;

  const icon = btn.querySelector('i');

  if (isRecording) {
    icon.className = 'fas fa-stop';
    btn.classList.add('active', 'recording');
    btn.title = 'Stop recording';
  } else {
    icon.className = 'fas fa-record-vinyl';
    btn.classList.remove('active', 'recording');
    btn.title = 'Start recording';
  }
}

function getScreenStageElement() {
  return document.getElementById('screenStage');
}

function getParticipantVideoStream(participantId) {
  if (participantId === clientId) {
    return backgroundEffect !== 'none' && backgroundPipeline?.stream ? backgroundPipeline.stream : localStream;
  }
  return document.querySelector(`#video-${participantId} video`)?.srcObject || null;
}

function updatePresenterOverlay() {
  const overlay = document.getElementById('presenterOverlay');
  const video = document.getElementById('presenterOverlayVideo');
  if (!overlay || !video) return;
  const visible = presenterOverlayVisible && Boolean(screenShareOwnerId) && Boolean(screenStageStream);
  overlay.classList.toggle('hidden', !visible);
  if (visible) {
    const stream = getParticipantVideoStream(screenShareOwnerId);
    if (stream && video.srcObject !== stream) video.srcObject = stream;
  } else {
    video.srcObject = null;
  }
  if (presenterOverlayPosition.left !== null) {
    overlay.style.left = `${presenterOverlayPosition.left}px`;
    overlay.style.top = `${presenterOverlayPosition.top}px`;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
  } else {
    overlay.style.left = 'auto';
    overlay.style.top = 'auto';
    overlay.style.right = `${presenterOverlayPosition.right}px`;
    overlay.style.bottom = `${presenterOverlayPosition.bottom}px`;
  }
}

function updateScreenStageControls() {
  const stage = getScreenStageElement();
  const pinButton = document.getElementById('screenPinBtn');
  const overlayButton = document.getElementById('presenterOverlayBtn');
  const label = document.getElementById('screenStageLabel');
  if (!stage || !pinButton || !overlayButton) return;
  stage.classList.toggle('screen-pinned', screenPinned);
  pinButton.setAttribute('aria-pressed', String(screenPinned));
  pinButton.title = screenPinned ? 'Unpin screen' : 'Pin screen full view';
  pinButton.setAttribute('aria-label', pinButton.title);
  pinButton.querySelector('i')?.classList.toggle('fa-thumbtack', screenPinned);
  pinButton.querySelector('i')?.classList.toggle('fa-up-right-and-down-left-from-center', !screenPinned);
  overlayButton.setAttribute('aria-pressed', String(presenterOverlayVisible));
  overlayButton.title = presenterOverlayVisible ? 'Hide presenter camera' : 'Show presenter camera';
  overlayButton.setAttribute('aria-label', overlayButton.title);
  overlayButton.querySelector('i')?.classList.toggle('fa-user', presenterOverlayVisible);
  overlayButton.querySelector('i')?.classList.toggle('fa-user-slash', !presenterOverlayVisible);
  if (label) label.textContent = screenShareOwnerId === clientId ? 'You are sharing your screen' : 'Screen sharing';
  document.getElementById('videoGrid')?.classList.toggle('screen-focused', screenPinned && Boolean(screenStageStream));
  updatePresenterOverlay();
}

function showScreenStage(ownerId, stream) {
  if (!stream) return;
  screenShareOwnerId = ownerId || screenShareOwnerId;
  screenStageStream = stream;
  screenPinned = true;
  const stage = getScreenStageElement();
  const video = document.getElementById('screenStageVideo');
  if (!stage || !video) return;
  video.srcObject = stream;
  stage.classList.remove('hidden');
  requestVideoPlayback(video, false);
  updateScreenStageControls();
}

function clearScreenStage(ownerId = null) {
  if (ownerId && screenShareOwnerId && ownerId !== screenShareOwnerId) return;
  screenShareOwnerId = null;
  screenStageStream = null;
  const stage = getScreenStageElement();
  const video = document.getElementById('screenStageVideo');
  const presenterVideo = document.getElementById('presenterOverlayVideo');
  stage?.classList.add('hidden');
  if (video) video.srcObject = null;
  if (presenterVideo) presenterVideo.srcObject = null;
  document.getElementById('videoGrid')?.classList.remove('screen-focused');
}

function toggleScreenPin() {
  if (!screenStageStream) return;
  screenPinned = !screenPinned;
  updateScreenStageControls();
}

function togglePresenterOverlay() {
  if (!screenStageStream) return;
  presenterOverlayVisible = !presenterOverlayVisible;
  updateScreenStageControls();
}

function clampPresenterOverlay() {
  const stage = getScreenStageElement();
  const overlay = document.getElementById('presenterOverlay');
  if (!stage || !overlay || presenterOverlayPosition.left === null) return;
  const stageRect = stage.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  presenterOverlayPosition.left = Math.max(0, Math.min(presenterOverlayPosition.left, stageRect.width - overlayRect.width));
  presenterOverlayPosition.top = Math.max(0, Math.min(presenterOverlayPosition.top, stageRect.height - overlayRect.height));
  updatePresenterOverlay();
}

function initPresenterOverlayDrag() {
  const overlay = document.getElementById('presenterOverlay');
  if (!overlay) return;
  overlay.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    const rect = overlay.getBoundingClientRect();
    presenterDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    overlay.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  overlay.addEventListener('pointermove', event => {
    if (!presenterDrag || presenterDrag.pointerId !== event.pointerId) return;
    const stage = getScreenStageElement();
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    presenterOverlayPosition.left = Math.max(0, Math.min(event.clientX - stageRect.left - presenterDrag.offsetX, stageRect.width - overlayRect.width));
    presenterOverlayPosition.top = Math.max(0, Math.min(event.clientY - stageRect.top - presenterDrag.offsetY, stageRect.height - overlayRect.height));
    updatePresenterOverlay();
  });
  const release = event => {
    if (presenterDrag?.pointerId === event.pointerId) presenterDrag = null;
  };
  overlay.addEventListener('pointerup', release);
  overlay.addEventListener('pointercancel', release);
}

function resumeRemotePlayback() {
  document.querySelectorAll('#videoGrid video, #screenStageVideo').forEach(video => {
    if (!video.srcObject || video.muted) return;
    video.play().catch(() => {
      // The browser may still require another gesture; retry on the next one.
    });
  });
}

function requestVideoPlayback(video, isLocal = false) {
  if (!video || isLocal) return;
  const play = () => {
    video.play().catch(error => {
      console.warn('Remote media playback is waiting for a browser gesture:', error.message);
    });
  };
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) play();
  else video.addEventListener('loadedmetadata', play, { once: true });
}

// ===== VIDEO ELEMENT MANAGEMENT =====
function addVideoElement(id, stream, isLocal = false, username = 'Participant') {
  const elementId = id || 'local';
  if (!isSafeClientId(elementId)) return;
  let wrapper = document.getElementById(`video-${id}`);
  if (!wrapper) wrapper = document.getElementById(`video-${elementId}`);

  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = `video-${elementId}`;
    wrapper.className = `video-wrapper ${isLocal ? 'local' : ''}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    video.srcObject = stream;
    requestVideoPlayback(video, isLocal);

    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    const cameraOffState = document.createElement('div');
    cameraOffState.id = `camera-off-${elementId}`;
    cameraOffState.className = 'video-off-state hidden';
    cameraOffState.innerHTML = `
      <div class="video-off-avatar">${escapeHtml((isLocal ? 'You' : username).charAt(0).toUpperCase())}</div>
      <span>Camera off</span>
    `;

    overlay.innerHTML = `
      <div class="participant-name">${isLocal ? 'You' : escapeHtml(username)}</div>
      <div class="video-indicators">
        <div class="indicator muted hidden" id="muted-${elementId}">
          <i class="fas fa-microphone-slash"></i>
        </div>
        <div class="indicator hand-raised hidden" id="hand-${elementId}">
          <i class="fas fa-hand-paper"></i>
        </div>
      </div>
    `;

    wrapper.appendChild(video);
    wrapper.appendChild(cameraOffState);
    wrapper.appendChild(overlay);

    document.getElementById('videoGrid').appendChild(wrapper);
    updateParticipantCameraStatus(elementId, isLocal ? isCameraOff : participantsState.get(elementId)?.isCameraOff, username);

    console.log(`✅ Added video element for ${id} (${username})`);
  } else {
    const video = wrapper.querySelector('video');
    video.srcObject = stream;
    requestVideoPlayback(video, isLocal);
    updateParticipantCameraStatus(elementId, isLocal ? isCameraOff : participantsState.get(elementId)?.isCameraOff, username);
    console.log(`🔄 Updated video stream for ${id}`);
  }

  updateVideoGrid();
  if (screenShareOwnerId === elementId) updatePresenterOverlay();
}

function updateParticipantCameraStatus(participantId, isOff, username = 'Participant') {
  const elementId = participantId || 'local';
  const indicator = document.getElementById(`camera-off-${elementId}`);
  if (!indicator) return;
  const avatar = indicator.querySelector('.video-off-avatar');
  if (avatar) avatar.textContent = String(username || 'Participant').charAt(0).toUpperCase();
  indicator.classList.toggle('hidden', !isOff);
}

function syncLocalVideoIdentity(previousId, nextId) {
  const oldId = previousId || 'local';
  const previousWrapper = document.getElementById(`video-${oldId}`);
  if (!previousWrapper || !nextId) return;
  previousWrapper.id = `video-${nextId}`;
  previousWrapper.querySelectorAll('[id]').forEach(element => {
    if (element.id.endsWith(`-${oldId}`)) element.id = element.id.replace(`-${oldId}`, `-${nextId}`);
  });
}

function detectOrientation() {
  if (window.matchMedia && window.matchMedia('(orientation: portrait)').matches) {
    return 'portrait';
  }
  if (window.innerHeight > window.innerWidth) {
    return 'portrait';
  }
  return 'landscape';
}

function updateVideoGrid() {
  const grid = document.getElementById('videoGrid');
  if (!grid) return;
  const count = grid.children.length;
  const orientation = detectOrientation();
  grid.setAttribute('data-count', count);
  grid.setAttribute('data-orientation', orientation);

  // Identify the host wrapper element
  let hostEl = null;
  if (roomAdminClientId) {
    hostEl = document.getElementById(`video-${roomAdminClientId}`);
  }
  if (!hostEl && isAdmin) {
    hostEl = (clientId ? document.getElementById(`video-${clientId}`) : null) || document.getElementById('video-local');
  }

  // Prepend host element to guarantee it stays in position 1 (:first-child)
  if (hostEl && grid.firstElementChild !== hostEl) {
    grid.prepend(hostEl);
  }

  // Update .is-host styling and badges on all participant video wrappers
  Array.from(grid.children).forEach(child => {
    const isThisHost = child === hostEl;
    child.classList.toggle('is-host', isThisHost);

    let hostBadge = child.querySelector('.host-badge');
    if (isThisHost) {
      if (!hostBadge) {
        const overlay = child.querySelector('.video-overlay');
        if (overlay) {
          hostBadge = document.createElement('span');
          hostBadge.className = 'host-badge';
          hostBadge.innerHTML = '<i class="fas fa-crown"></i> Host';
          overlay.insertBefore(hostBadge, overlay.firstChild);
        }
      }
    } else if (hostBadge) {
      hostBadge.remove();
    }
  });

  console.log(`📊 Video grid updated: ${count} participants, orientation: ${orientation}, host: ${hostEl ? hostEl.id : 'unknown'}`);
}

function removeVideoElement(id) {
  if (!isSafeClientId(id)) return;
  const wrapper = document.getElementById(`video-${id}`);
  if (wrapper) {
    wrapper.remove();
    updateVideoGrid();
    console.log(`🗑️ Removed video element for ${id}`);
  }
}

// ===== WEBRTC PEER CONNECTION =====
function getRemoteTrackRole(peer, transceiver) {
  if (!peer || !transceiver) return null;

  const mid = transceiver.mid;
  const roleByMid = [
    ['camera', peer.cameraTransceiver],
    ['audio', peer.audioTransceiver],
    ['screen', peer.screenTransceiver]
  ];
  if (mid !== null && mid !== undefined) {
    const role = roleByMid.find(([, candidate]) => candidate?.mid === mid);
    if (role) return role[0];
  }

  // Keep identity as a fallback for browsers that do not expose a mid on the
  // ontrack transceiver yet.
  const roleByIdentity = roleByMid.find(([, candidate]) => candidate === transceiver);
  return roleByIdentity?.[0] || null;
}

function attachRemoteTrack(id, username, peer, event) {
  if (!peer || !event?.track) return;

  let role = getRemoteTrackRole(peer, event.transceiver);
  if (!role && event.track.kind === 'video') {
    // A few WebRTC implementations have delivered ontrack without a usable
    // transceiver/mid. The fixed m-line order still gives us a safe fallback:
    // the first remote video is camera, the second is screen.
    role = peer.remoteMediaStream.getVideoTracks().length > 0 ? 'screen' : 'camera';
  }
  if (role === 'screen') {
    if (!peer.remoteScreenStream.getTracks().includes(event.track)) {
      peer.remoteScreenStream.addTrack(event.track);
    }
    const revealScreen = () => {
      if (event.track.readyState === 'live') showScreenStage(id, peer.remoteScreenStream);
    };
    event.track.onunmute = revealScreen;
    event.track.onended = () => clearScreenStage(id);
    if (!event.track.muted) revealScreen();
    return;
  }

  // Camera and microphone are the default remote media path. Do not drop a
  // valid track just because a browser has not exposed its transceiver/mid at
  // the moment the ontrack event is delivered. Only a positively identified
  // screen transceiver belongs in the presentation stage.
  if (!peer.remoteMediaStream.getTracks().includes(event.track)) {
    peer.remoteMediaStream.addTrack(event.track);
  }
  addVideoElement(id, peer.remoteMediaStream, false, username);
}

function flushPendingRemoteTracks(id, username, peer) {
  const pending = peer?.pendingRemoteTracks?.splice(0) || [];
  pending.forEach(event => attachRemoteTrack(id, username, peer, event));
}

function createPeerConnection(id, username) {
  if (!isSafeClientId(id)) return null;
  if (peers[id]) {
    console.log(`♻️ Reusing existing peer connection for ${id}`);
    return peers[id].pc;
  }

  console.log(`🔧 Creating NEW peer connection for ${id} (${username})`);
  const pc = new RTCPeerConnection(pcConfig);
  const peer = {
    pc,
    username,
    signalingEpoch: signalingSocketEpoch,
    cameraTransceiver: null,
    audioTransceiver: null,
    cameraSender: null,
    audioSender: null,
    screenTransceiver: null,
    screenSender: null,
    remoteMediaStream: new MediaStream(),
    remoteScreenStream: new MediaStream(),
    pendingRemoteTracks: [],
    mediaReady: Promise.resolve(),
    iceCandidateQueue: [],
    remoteDescriptionSet: false
  };
  peers[id] = peer;
  const earlyCandidates = pendingIceCandidates.get(id);
  if (earlyCandidates?.length) {
    peer.iceCandidateQueue.push(...earlyCandidates);
    pendingIceCandidates.delete(id);
    console.log(`📦 Queued ${earlyCandidates.length} early ICE candidate(s) for ${id}`);
  }

  const videoTrack = getPublishedCameraVideoTrack();
  const audioTrack = localStream?.getAudioTracks?.()[0] || null;
  const screenTrack = getPublishedScreenVideoTrack();
  if (typeof pc.addTransceiver === 'function') {
    // Create the three m-lines in the same order for every peer. The order is
    // the media-role contract used by both sides, so a remote camera can
    // never be mistaken for the screen track during offer/answer mapping.
    peer.cameraTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    peer.audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    peer.screenTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    peer.cameraSender = peer.cameraTransceiver.sender;
    peer.audioSender = peer.audioTransceiver.sender;
    peer.screenSender = peer.screenTransceiver.sender;
    peer.mediaReady = Promise.all([
      peer.cameraSender.replaceTrack(videoTrack || null),
      peer.audioSender.replaceTrack(audioTrack || null),
      peer.screenSender.replaceTrack(screenTrack || null)
    ]).catch(error => {
      console.warn(`Could not attach initial media to peer ${id}:`, error.message);
    });
  } else {
    const publicationStream = new MediaStream();
    if (videoTrack) {
      publicationStream.addTrack(videoTrack);
      peer.cameraSender = pc.addTrack(videoTrack, publicationStream);
    }
    if (audioTrack) {
      publicationStream.addTrack(audioTrack);
      peer.audioSender = pc.addTrack(audioTrack, publicationStream);
    }
  }

  pc.ontrack = event => {
    console.log(`🎥 Received ${event.track.kind} track from ${id}`);
    const currentPeer = peers[id];
    if (!currentPeer) return;
    if (!currentPeer.remoteDescriptionSet) {
      currentPeer.pendingRemoteTracks.push(event);
      return;
    }
    attachRemoteTrack(id, username, currentPeer, event);
  };

  pc.onicecandidate = event => {
    if (event.candidate) {
      sendSignalingMessage({
        type: 'ice_candidate',
        candidate: event.candidate,
        targetClientId: id
      }, peer.signalingEpoch);
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log(`🔌 ICE connection state for ${id}: ${state}`);
    if (state === 'connected' || state === 'completed') {
      showToast(`Connected to ${username}`, 'success');
    } else if (state === 'failed') {
      console.error(`❌ Connection FAILED for ${id}`);
      setTimeout(async () => {
        try {
          if (!shouldInitiatePeer(id) || pc.signalingState !== 'stable' || peer.signalingEpoch !== signalingSocketEpoch) return;
          if (pc.restartIce) pc.restartIce();
          peer.remoteDescriptionSet = false;
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          sendSignalingMessage({
            type: 'offer',
            sdp: pc.localDescription,
            targetClientId: id
          }, peer.signalingEpoch);
        } catch (err) {
          console.error(`❌ ICE restart failed for ${id}:`, err);
        }
      }, 2000);
    }
  };

  return pc;
}

async function createOffer(targetId, targetUsername, socketEpoch = signalingSocketEpoch) {
  if (!isSafeClientId(targetId)) return;
  if (socketEpoch !== signalingSocketEpoch) return;
  console.log(`📤 Creating offer for ${targetId}`);

  const pc = createPeerConnection(targetId, targetUsername);
  const peer = peers[targetId];

  try {
    if (socketEpoch !== signalingSocketEpoch || !peer || pc.signalingState !== 'stable') {
      console.warn(`⏭️ Skipping offer for ${targetId}; signaling state is ${pc.signalingState}`);
      return;
    }
    // Candidates emitted for this offer must wait until its answer becomes
    // the current remote description, including ICE-restart offers.
    peer.remoteDescriptionSet = false;
    await peer.mediaReady;
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });

    await pc.setLocalDescription(offer);

    sendSignalingMessage({
      type: 'offer',
      sdp: pc.localDescription,
      targetClientId: targetId
    }, socketEpoch);

    console.log(`📨 Offer sent to ${targetId}`);
  } catch (err) {
    console.error(`❌ Failed to create offer for ${targetId}:`, err);
  }
}

async function handleOffer(fromId, fromUsername, sdp, socketEpoch = signalingSocketEpoch) {
  if (socketEpoch !== signalingSocketEpoch) return;
  console.log(`📥 Received offer from ${fromId}`);

  const pc = createPeerConnection(fromId, fromUsername);
  const peer = peers[fromId];

  try {
    if (pc.signalingState === 'have-local-offer') {
      if (shouldInitiatePeer(fromId)) {
        console.warn(`⏭️ Ignoring colliding offer from ${fromId}`);
        return;
      }
      await pc.setLocalDescription({ type: 'rollback' });
    }
    if (pc.signalingState !== 'stable') {
      console.warn(`⏭️ Ignoring offer from ${fromId} in state ${pc.signalingState}`);
      return;
    }
    peer.remoteDescriptionSet = false;
    await peer.mediaReady;
    if (socketEpoch !== signalingSocketEpoch) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    peer.remoteDescriptionSet = true;
    flushPendingRemoteTracks(fromId, fromUsername, peer);

    if (peer.iceCandidateQueue.length > 0) {
      for (const candidate of peer.iceCandidateQueue) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      peer.iceCandidateQueue = [];
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    sendSignalingMessage({
      type: 'answer',
      sdp: pc.localDescription,
      targetClientId: fromId
    }, socketEpoch);

    console.log(`📨 Answer sent to ${fromId}`);
  } catch (err) {
    console.error(`❌ Failed to handle offer from ${fromId}:`, err);
  }
}

async function handleAnswer(fromId, sdp, socketEpoch = signalingSocketEpoch) {
  if (socketEpoch !== signalingSocketEpoch) return;
  console.log(`📥 Received answer from ${fromId}`);

  const peer = peers[fromId];
  if (!peer) return;

  try {
    if (peer.pc.signalingState !== 'have-local-offer') {
      console.warn(`⏭️ Ignoring stale answer from ${fromId} in state ${peer.pc.signalingState}`);
      return;
    }
    peer.remoteDescriptionSet = false;
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    if (socketEpoch !== signalingSocketEpoch) return;
    peer.remoteDescriptionSet = true;
    flushPendingRemoteTracks(fromId, peer.username, peer);

    if (peer.iceCandidateQueue.length > 0) {
      for (const candidate of peer.iceCandidateQueue) {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      peer.iceCandidateQueue = [];
    }
  } catch (err) {
    console.error(`❌ Failed to set remote description for ${fromId}:`, err);
  }
}

async function handleIceCandidate(fromId, candidate, socketEpoch = signalingSocketEpoch) {
  if (socketEpoch !== signalingSocketEpoch) return;
  const peer = peers[fromId];
  if (!peer) {
    const queued = pendingIceCandidates.get(fromId) || [];
    queued.push(candidate);
    pendingIceCandidates.set(fromId, queued);
    console.log(`📦 Queued ICE candidate until peer ${fromId} exists`);
    return;
  }

  try {
    if (peer.remoteDescriptionSet) {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      peer.iceCandidateQueue.push(candidate);
    }
  } catch (err) {
    console.error(`❌ Failed to add ICE candidate for ${fromId}:`, err);
  }
}

// ===== MEDIA CONTROLS =====
function toggleMic() {
  if (!localStream) return;

  if (isAdminMuted && isMuted) {
    showRequestUnmuteModal();
    return;
  }

  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });

  sendSignalingMessage({ type: 'media_state', isMuted, isCameraOff, handRaised });
  updateMicButton();
  updateParticipantMuteStatus(clientId, isMuted);
  showToast(isMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
}

function updateMicButton() {
  const btn = document.getElementById('toggleMicBtn');
  const icon = document.getElementById('micIcon');
  if (!btn || !icon) return;

  if (isMuted) {
    icon.className = 'fas fa-microphone-slash';
    btn.classList.add('active');

    if (isAdminMuted) {
      btn.title = 'Request to unmute';
    }
  } else {
    icon.className = 'fas fa-microphone';
    btn.classList.remove('active');
    btn.title = 'Mute/Unmute';
  }
}

function toggleCamera() {
  if (!localStream) return;

  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach(track => {
    track.enabled = !isCameraOff;
  });
  if (backgroundPipeline?.track) backgroundPipeline.track.enabled = !isCameraOff;

  sendSignalingMessage({ type: 'media_state', isMuted, isCameraOff, handRaised });
  updateCameraButton();
  updateParticipantCameraStatus(clientId, isCameraOff, googleUser?.name);
  showToast(isCameraOff ? 'Camera off' : 'Camera on', 'info');
}

function updateCameraButton() {
  const btn = document.getElementById('toggleCamBtn');
  const icon = document.getElementById('camIcon');
  if (!btn || !icon) return;

  if (isCameraOff) {
    icon.className = 'fas fa-video-slash';
    btn.classList.add('active');
  } else {
    icon.className = 'fas fa-video';
    btn.classList.remove('active');
  }
}

// Continue with remaining functions...
function toggleRaiseHand() {
  handRaised = !handRaised;
  sendSignalingMessage({ type: 'raise_hand', handRaised });
  sendSignalingMessage({ type: 'media_state', isMuted, isCameraOff, handRaised });
  updateRaiseHandButton();
  updateParticipantHandStatus(clientId, handRaised);
  showToast(handRaised ? '✋ Hand raised' : 'Hand lowered', 'info');
}

function updateRaiseHandButton() {
  const btn = document.getElementById('raiseHandBtn');
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (handRaised) {
    icon.className = 'fas fa-hand-paper';
    btn.classList.add('active');
    btn.title = 'Lower hand';
  } else {
    icon.className = 'far fa-hand-paper';
    btn.classList.remove('active');
    btn.title = 'Raise hand';
  }
}

function updateParticipantHandStatus(participantId, raised) {
  if (!isSafeClientId(participantId)) return;
  const handIndicator = document.getElementById(`hand-${participantId}`);
  if (handIndicator) {
    if (raised) {
      handIndicator.classList.remove('hidden');
    } else {
      handIndicator.classList.add('hidden');
    }
  }
}

function showRequestUnmuteModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Request to Unmute</h3>
      <p>The host has muted you. Would you like to request permission to unmute?</p>
      <div class="modal-actions">
        <button class="btn-secondary" data-action="close-modal">Cancel</button>
        <button class="btn-primary" data-action="send-unmute-request">Send Request</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function sendUnmuteRequest() {
  sendSignalingMessage({ type: 'request_unmute' });
  showToast('Request sent to host', 'info');
}

function showUnmuteRequestModal(fromId, fromUsername) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Unmute Request</h3>
      <p><strong>${escapeHtml(fromUsername)}</strong> is requesting permission to unmute.</p>
      <div class="modal-actions">
        <button class="btn-secondary modal-deny">Deny</button>
        <button class="btn-primary modal-approve">Approve</button>
      </div>
    </div>
  `;
  modal.querySelector('.modal-deny').addEventListener('click', () => modal.remove());
  modal.querySelector('.modal-approve').addEventListener('click', () => {
    approveUnmute(fromId);
    modal.remove();
  });
  document.body.appendChild(modal);
}

function approveUnmute(targetId) {
  sendSignalingMessage({
    type: 'admin_control',
    action: 'mute_toggle',
    targetClientId: targetId,
    muteState: false,
    adminToken
  });
}

function closeModal(btn) {
  const modal = btn.closest('.modal-overlay');
  if (modal) modal.remove();
}

// Participant management functions
function addParticipantToList(id, username, handRaised = false, isAdminMuted = false) {
  const list = document.getElementById('participantsList');
  if (!list || !isSafeClientId(id)) return;
  username = String(username || 'Participant').slice(0, 80);
  let item = document.getElementById(`participant-${id}`);
  if (!item) {
    item = document.createElement('div');
    item.id = `participant-${id}`;
    item.className = 'participant-item';
    const initial = username.charAt(0).toUpperCase();
    item.innerHTML = `
      <div class="participant-info">
        <div class="participant-avatar">${escapeHtml(initial)}</div>
        <div class="participant-details">
          <p>${escapeHtml(username)}</p>
          <span>${id === clientId ? 'You' : 'Participant'}</span>
        </div>
        <div class="participant-status">
          <div class="hand-status ${handRaised ? '' : 'hidden'}" title="Hand raised">
            <i class="fas fa-hand-paper"></i>
          </div>
        </div>
      </div>
      ${isAdmin && id !== clientId ? `
        <div class="participant-controls">
          <button class="btn-icon participant-mute-button ${isAdminMuted ? 'muted' : ''}" title="${isAdminMuted ? 'Unmute' : 'Mute'}" aria-label="${isAdminMuted ? 'Unmute' : 'Mute'} ${escapeHtml(username)}">
            <i class="fas fa-microphone${isAdminMuted ? '-slash' : ''}"></i>
          </button>
          <button class="btn-icon participant-transfer-button" title="Transfer Admin" aria-label="Transfer host to ${escapeHtml(username)}">
            <i class="fas fa-crown"></i>
          </button>
        </div>
      ` : ''}
    `;
    item.querySelector('.participant-mute-button')?.addEventListener('click', () => toggleParticipantMute(id));
    item.querySelector('.participant-transfer-button')?.addEventListener('click', () => showTransferAdminModal(id, username));
    list.appendChild(item);
  }
  updateParticipantCount();
}

function removeParticipantFromList(id) {
  if (!isSafeClientId(id)) return;
  const item = document.getElementById(`participant-${id}`);
  if (item) {
    item.remove();
    updateParticipantCount();
  }
}

function updateParticipantCount() {
  const list = document.getElementById('participantsList');
  if (!list) return;
  const count = list.children.length;
  document.getElementById('participantCount')?.replaceChildren(document.createTextNode(String(count)));
  document.getElementById('participantCountBadge')?.replaceChildren(document.createTextNode(String(count)));
}

function updateParticipantMuteStatus(participantId, isAdminMuted) {
  if (!isSafeClientId(participantId)) return;
  const listItem = document.getElementById(`participant-${participantId}`);
  const mutedIndicator = document.getElementById(`muted-${participantId}`);
  mutedIndicator?.classList.toggle('hidden', !isAdminMuted);
  if (listItem && isAdmin) {
    const muteBtn = listItem.querySelector('.participant-controls button:first-child');
    if (muteBtn) {
      const icon = muteBtn.querySelector('i');
      if (isAdminMuted) {
        muteBtn.classList.add('muted');
        icon.className = 'fas fa-microphone-slash';
        muteBtn.title = 'Unmute';
      } else {
        muteBtn.classList.remove('muted');
        icon.className = 'fas fa-microphone';
        muteBtn.title = 'Mute';
      }
    }
  }
}

function updateParticipantsList() {
  const list = document.getElementById('participantsList');
  if (!list) return;
  list.innerHTML = '';
  if (clientId && googleUser) {
    addParticipantToList(clientId, googleUser.name, handRaised, false);
  }
  participantsState.forEach((state, id) => {
    addParticipantToList(id, state.username, state.handRaised, state.isAdminMuted);
  });
}

function toggleParticipantMute(targetId) {
  if (!isAdmin) return;
  const pState = participantsState.get(targetId);
  if (!pState) return;
  const newMuteState = !pState.isAdminMuted;
  sendSignalingMessage({
    type: 'admin_control',
    action: 'mute_toggle',
    targetClientId: targetId,
    muteState: newMuteState,
    adminToken
  });
  pState.isAdminMuted = newMuteState;
  updateParticipantMuteStatus(targetId, newMuteState);
  showToast(`${newMuteState ? 'Muted' : 'Unmuted'} ${pState.username}`, 'success');
}

function muteAll() {
  if (!isAdmin) return;
  if (confirm('Mute all participants?')) {
    sendSignalingMessage({ type: 'admin_control', action: 'mute_all', adminToken });
    participantsState.forEach((state, id) => {
      state.isAdminMuted = true;
      state.handRaised = false;
      updateParticipantMuteStatus(id, true);
      updateParticipantHandStatus(id, false);
    });
    showToast('All participants muted', 'success');
  }
}

function showTransferAdminModal(targetId, targetUsername) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Transfer Host Privileges</h3>
      <p>Transfer host to <strong>${escapeHtml(targetUsername)}</strong>?</p>
      <p class="warning-text">You will no longer be the host.</p>
      <div class="modal-actions">
        <button class="btn-secondary modal-cancel">Cancel</button>
        <button class="btn-primary modal-confirm">Transfer</button>
      </div>
    </div>
  `;
  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('.modal-confirm').addEventListener('click', () => {
    transferAdmin(targetId);
    modal.remove();
  });
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
    sendSignalingMessage({ type: 'end_meeting', adminToken });
  }
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim().slice(0, MAX_CHAT_LENGTH);
  if (!message) return;
  sendSignalingMessage({ type: 'chat_message', message });
  input.value = '';
  input.style.height = 'auto';
}

function displayChatMessage(username, message, timestamp, isLocal, messageKind = null) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${isLocal ? 'local' : 'remote'}${messageKind === 'meeting_summary' ? ' meeting-summary-message' : ''}`;
  msgDiv.innerHTML = `
    <div class="message-sender">${isLocal ? 'You' : escapeHtml(username)}</div>
    <div class="message-bubble">${escapeHtml(message)}</div>
    <div class="message-time">${escapeHtml(timestamp || formatTime(new Date()))}</div>
  `;
  container.appendChild(msgDiv);
  while (container.children.length > 200) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
  const panel = document.getElementById('sidePanel');
  const chatPanel = document.getElementById('chatPanel');
  if (!panel.classList.contains('open') || chatPanel.classList.contains('hidden')) {
    if (!isLocal) {
      unreadMessages++;
      updateChatBadge();
    }
  }
}

function updateChatBadge() {
  const badge = document.getElementById('chatNotificationBadge');
  if (unreadMessages > 0) {
    badge.textContent = unreadMessages;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getNotesStorageKey() {
  const accountKey = googleUser?.sub || googleUser?.email;
  if (!accountKey || !roomId) return null;
  return `meet-clone:meeting-notes:v1:${encodeURIComponent(accountKey)}:${roomId}`;
}

function setNotesSaveStatus(message, isError = false) {
  const status = document.getElementById('notesSaveStatus');
  if (status) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }
}

function loadMeetingNotes() {
  if (notesRoomId === roomId && notesStorageKey) return;
  notesRoomId = roomId;
  notesStorageKey = getNotesStorageKey();
  const input = document.getElementById('notesInput');
  if (!input) return;
  input.value = '';
  if (!notesStorageKey) {
    setNotesSaveStatus('Notes are available after sign-in', true);
    return;
  }
  try {
    const raw = localStorage.getItem(notesStorageKey);
    const record = raw ? JSON.parse(raw) : null;
    input.value = record?.version === 1 && record.roomId === roomId && typeof record.text === 'string'
      ? record.text.slice(0, 10000)
      : '';
    setNotesSaveStatus('Saved locally');
  } catch (error) {
    console.warn('Could not load meeting notes:', error.message);
    setNotesSaveStatus('Unable to load local notes', true);
  }
}

function saveMeetingNotes() {
  if (!notesStorageKey || notesRoomId !== roomId) return;
  const input = document.getElementById('notesInput');
  if (!input) return;
  try {
    localStorage.setItem(notesStorageKey, JSON.stringify({
      version: 1,
      roomId,
      text: input.value.slice(0, 10000),
      updatedAt: Date.now()
    }));
    setNotesSaveStatus('Saved locally');
  } catch (error) {
    console.warn('Could not save meeting notes:', error.message);
    setNotesSaveStatus('Unable to save locally', true);
  }
}

function scheduleNotesSave() {
  setNotesSaveStatus('Saving…');
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(() => {
    notesSaveTimer = null;
    saveMeetingNotes();
  }, 400);
}

function flushMeetingNotes() {
  clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  saveMeetingNotes();
}

function clearMeetingNotes() {
  const input = document.getElementById('notesInput');
  if (input) input.value = '';
  clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  if (notesStorageKey) {
    try {
      localStorage.removeItem(notesStorageKey);
      setNotesSaveStatus('Notes cleared');
    } catch (error) {
      setNotesSaveStatus('Unable to clear local notes', true);
    }
  }
}

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
  if (tab === 'notes') {
    setTimeout(() => document.getElementById('notesInput')?.focus(), 0);
  }
}

function closeSidePanel() {
  document.getElementById('sidePanel').classList.remove('open');
}

function showPanelTab(tab) {
  document.getElementById('participantsTab').classList.toggle('active', tab === 'participants');
  document.getElementById('chatTab').classList.toggle('active', tab === 'chat');
  document.getElementById('notesTab').classList.toggle('active', tab === 'notes');
  document.getElementById('participantsTab').setAttribute('aria-selected', String(tab === 'participants'));
  document.getElementById('chatTab').setAttribute('aria-selected', String(tab === 'chat'));
  document.getElementById('notesTab').setAttribute('aria-selected', String(tab === 'notes'));
  document.getElementById('participantsPanel').classList.toggle('hidden', tab !== 'participants');
  document.getElementById('chatPanel').classList.toggle('hidden', tab !== 'chat');
  document.getElementById('notesPanel').classList.toggle('hidden', tab !== 'notes');
  if (tab === 'notes') {
    setTimeout(() => document.getElementById('notesInput')?.focus(), 0);
  }
  if (tab === 'chat') {
    unreadMessages = 0;
    updateChatBadge();
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function showMeetingRoom() {
  document.getElementById('landingPage').classList.add('hidden');
  document.getElementById('meetingRoom').classList.remove('hidden');
  isInMeeting = true;
  loadMeetingNotes();
  if (clientId && googleUser) {
    addParticipantToList(clientId, googleUser.name, false, false);
  }
  updateAdminUI();
}

function showLandingPage() {
  document.getElementById('meetingRoom').classList.add('hidden');
  document.getElementById('landingPage').classList.remove('hidden');
  isInMeeting = false;
  closeSidePanel();
}

function resetPeerConnections(reason = 'reset') {
  // Invalidate async offer/answer work from the connection that is being
  // discarded before any replacement peer can be created.
  signalingSocketEpoch += 1;
  const peerIds = Object.keys(peers);
  if (peerIds.length > 0) {
    console.log(`♻️ Resetting ${peerIds.length} peer connection(s): ${reason}`);
  }
  peerIds.forEach(id => {
    try {
      peers[id].pc.close();
    } catch (error) {
      console.warn(`Could not close peer ${id}:`, error.message);
    }
    removeVideoElement(id);
  });
  peers = {};
  pendingIceCandidates.clear();

  if (screenShareOwnerId && screenShareOwnerId !== clientId) {
    clearScreenStage(screenShareOwnerId);
  }
}

function removePeer(id) {
  if (!isSafeClientId(id)) return;
  console.log(`🗑️ Removing peer: ${id}`);
  pendingIceCandidates.delete(id);
  if (peers[id]) {
    try {
      peers[id].pc.close();
    } catch (e) {
      console.error('Error closing peer:', e);
    }
    delete peers[id];
  }
  removeVideoElement(id);
  if (screenShareOwnerId === id) clearScreenStage(id);
  removeParticipantFromList(id);
}

function leaveMeeting(force = false) {
  if (!force && !confirm('Leave the meeting?')) return false;
  console.log('🚪 Leaving meeting...');

  if (isRecording) stopRecording();
  if (isScreenSharing) stopScreenShare();
  clearScreenStage();
  if (captionsEnabled) stopCaptions();
  flushMeetingNotes();
  if (pendingAdmissionRequestId) sendSignalingMessage({ type: 'cancel_join_request', requestId: pendingAdmissionRequestId });
  clearAdmissionState();
  admissionRequests.clear();

  if (ws?.readyState === WebSocket.OPEN && roomId) {
    sendSignalingMessage({ type: 'leave_room' });
  }

  Object.keys(peers).forEach(id => {
    try {
      peers[id].pc.close();
    } catch (e) {
      console.error('Error closing peer:', e);
    }
  });
  peers = {};
  pendingIceCandidates.clear();

  stopBackgroundPipeline();
  backgroundEffect = 'none';
  updateBackgroundFilterButton();
  if (localStream) {
    localStream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch (e) {
        console.error('Error stopping track:', e);
      }
    });
    localStream = null;
  }

  const videoGrid = document.getElementById('videoGrid');
  if (videoGrid) videoGrid.innerHTML = '';

  const participantsList = document.getElementById('participantsList');
  if (participantsList) participantsList.innerHTML = '';

  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) chatMessages.innerHTML = '';

  clientId = null;
  roomId = null;
  notesRoomId = null;
  notesStorageKey = null;
  resumeToken = null;
  isAdmin = false;
  adminToken = null;
  isMuted = false;
  isAdminMuted = false;
  isCameraOff = false;
  handRaised = false;
  unreadMessages = 0;
  isInMeeting = false;
  summaryState = 'not_requested';
  summaryId = null;
  screenShareOwnerId = null;
  screenStageStream = null;
  participantsState.clear();

  showLandingPage();
  showToast('Left the meeting', 'info');
  if (!ws) setTimeout(initWebSocket, 300);
  return true;
}

function sendSignalingMessage(message, socketEpoch = null) {
  if (socketEpoch !== null && socketEpoch !== signalingSocketEpoch) return false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  } else {
    if (message.type !== 'authenticate') showToast('Connection lost. Reconnecting…', 'error');
    return false;
  }
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Initializing app...');

  document.addEventListener('click', handleActionClick);
  document.addEventListener('pointerdown', resumeRemotePlayback, { passive: true });
  document.addEventListener('keydown', resumeRemotePlayback, { passive: true });
  initPresenterOverlayDrag();

  await loadIceServers();

  try {
    initGoogleSignIn();
  } catch (e) {
    console.warn('⚠️ Google Sign-In initialization failed:', e);
  }

  updateConnectionStatus(false, 'Sign in to connect');

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

  const notesInput = document.getElementById('notesInput');
  notesInput?.addEventListener('input', scheduleNotesSave);

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

  window.addEventListener('pagehide', flushMeetingNotes);
  window.addEventListener('beforeunload', (e) => {
    flushMeetingNotes();
    if (isInMeeting) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // Check URL query parameters for meeting invitation link (?room-code=XYZ)
  checkUrlRoomCode();

  // Automatic layout adaptation on window resize and mobile device rotation
  window.addEventListener('resize', () => {
    updateVideoGrid();
    clampPresenterOverlay();
    updateScreenStageControls();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(updateVideoGrid, 100);
  });
  if (window.screen && window.screen.orientation) {
    window.screen.orientation.addEventListener('change', () => {
      setTimeout(() => {
        updateVideoGrid();
        clampPresenterOverlay();
        updateScreenStageControls();
      }, 100);
    });
  }

  console.log('✅ App initialized successfully');
});

// ===== EXPOSE FUNCTIONS TO WINDOW =====
window.createRoom = createRoom;
window.joinRoomPrompt = joinRoomPrompt;
window.joinRoomById = joinRoomById;
window.copyRoomId = copyRoomId;
window.copyMeetingLink = copyMeetingLink;
window.toggleMic = toggleMic;
window.toggleCamera = toggleCamera;
window.toggleRaiseHand = toggleRaiseHand;
window.toggleScreenShare = toggleScreenShare;
window.toggleRecording = toggleRecording;
window.toggleCaptions = toggleCaptions;
window.showCaptionSettings = showCaptionSettings;
window.applyCaptionSettings = applyCaptionSettings;
window.downloadCaptionHistory = downloadCaptionHistory;
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
