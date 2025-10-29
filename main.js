// frontend/main.js - Enhanced with Professional Meeting Features
// Features: Raise Hand, Unmute Requests, Selective Unmute, Admin Transfer
// frontend/main.js - Enhanced with robust WebRTC connectivity
// Enhanced main.js with Screen Sharing and Recording Support
// Enhanced main.js with Real-time Captions & Translation using Web Speech and Gemini
// ======== Configuration ========
//const WS_URL = "wss://webrtc-meeting-server.onrender.com";      // <--- update to your Render URL
const WS_URL = "https://just-holly-kanhaiya1610-b072918c.koyeb.app/";
//const ICE_ENDPOINT = "https://webrtc-meeting-server.onrender.com/ice"; // <--- update to your Render URL
const ICE_ENDPOINT = "https://just-holly-kanhaiya1610-b072918c.koyeb.app/ice";
const GOOGLE_CLIENT_ID = "173379398027-i3h11rufg14tpde9rhutp0uvt3imos3k.apps.googleusercontent.com";// <--- set this

// ===== STATE =====
let googleUser = null;
let ws = null;
let localStream = null;
let screenStream = null;
let clientId = null;
let roomId = null;
let isAdmin = false;
let adminToken = null;
let isMuted = false;
let isAdminMuted = false;
let isCameraOff = false;
let handRaised = false;
let isScreenSharing = false;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
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

// ===== NEW: CAPTIONS & TRANSLATION STATE =====
let captionsEnabled = false;
let recognition = null;
let captionLanguage = 'en-US'; // The language I *speak*
let myPreferredLanguage = 'en-US'; // The language I *want to read*
let captionHistory = [];
const MAX_CAPTION_HISTORY = 50;
let translationCache = new Map(); // Caches interim translations
let translationTimeout = null; // Debouncer for interim translations

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
  
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
    leaveMeeting();
  }
  
  googleUser = null;
  document.getElementById('afterAuth').classList.add('hidden');
  document.getElementById('authStatus').classList.remove('hidden');
  document.getElementById('gSignInDiv').style.display = 'block';
  
  showToast('Signed out successfully', 'info');
}

// ===== ICE SERVER CONFIGURATION =====
async function loadIceServers() {
  try {
    console.log('🔧 Loading ICE server configuration...');
    const res = await fetch(ICE_ENDPOINT);
    const data = await res.json();
    
    pcConfig.iceServers = data.iceServers || [];
    pcConfig.iceTransportPolicy = data.iceTransportPolicy || 'all';
    pcConfig.iceCandidatePoolSize = data.iceCandidatePoolSize || 10;
    
    console.log('✅ ICE servers loaded:', pcConfig.iceServers.length, 'servers');
  } catch (err) {
    console.error('❌ Failed to fetch ICE servers:', err);
    pcConfig.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' }
    ];
  }
}

// ===== WEBSOCKET CONNECTION =====
function initWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('WebSocket already connected');
    return;
  }
  
  ws = new WebSocket(WS_URL);
  
  ws.onopen = () => {
    console.log('✅ WebSocket connected');
    updateConnectionStatus(true);
    reconnectAttempts = 0;
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
      adminToken = data.adminToken || adminToken;
      
      if (data.roomId) {
        roomId = data.roomId;
        updateRoomDisplay();
      }
      
      updateAdminUI();
      break;
      
    case 'room_created':
      roomId = data.roomId;
      updateRoomDisplay();
      showToast(`Room created: ${roomId}`, 'success');
      break;
      
    case 'room_state':
      console.log('📋 Room state received:', data.participants.length, 'participants');
      for (const p of data.participants) {
        if (p.clientId !== clientId) {
          participantsState.set(p.clientId, {
            username: p.username,
            isMuted: p.isMuted,
            isAdminMuted: p.isAdminMuted,
            handRaised: p.handRaised
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
        isMuted: false,
        isAdminMuted: false,
        handRaised: false
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
        isAdminMuted = !!data.isAdminMuted;
        if (data.muteState) {
          isMuted = true;
          if (localStream) {
            localStream.getAudioTracks().forEach(t => t.enabled = false);
          }
          updateMicButton();
          if (isAdminMuted) {
            showToast('You were muted by the host. Request to unmute if needed.', 'info');
          }
        } else {
          isAdminMuted = false;
          showToast('Host allowed you to unmute', 'success');
        }
      } else {
        const pState = participantsState.get(data.targetClientId);
        if (pState) {
          pState.isAdminMuted = !!data.isAdminMuted;
          updateParticipantMuteStatus(data.targetClientId, data.isAdminMuted);
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
      if (data.newAdminId === clientId) {
        isAdmin = true;
        updateAdminUI();
      } else if (data.oldAdminId === clientId) {
        isAdmin = false;
        updateAdminUI();
      }
      updateParticipantsList();
      break;
      
    case 'admin_transferred':
      showToast(`Admin transferred to ${data.newAdminName}`, 'info');
      isAdmin = false;
      updateAdminUI();
      break;
      
    case 'promoted_to_admin':
      showToast(`You are now the host (promoted by ${data.byUsername})`, 'success');
      break;
      
    case 'new_chat_message':
      displayChatMessage(data.fromUsername, data.message, data.timestamp, data.fromClientId === clientId);
      break;
      
    // NEW: Handle caption messages with translation
    case 'caption':
      if (captionsEnabled) {
        // Pass to displayCaption, which now handles translation logic
        displayCaption(data.fromUsername, data.text, data.isFinal, data.language);
      }
      break;
      
    case 'peer_left':
      removePeer(data.clientId);
      participantsState.delete(data.clientId);
      showToast(`Participant left`, 'info');
      break;
      
    case 'meeting_ended':
      showToast('Meeting ended by host', 'info');
      leaveMeeting();
      break;
      
    case 'error':
      console.error('Server error:', data.message);
      showToast(data.message, 'error');
      hideLoading();
      break;
      
    default:
      console.warn('Unknown message type:', data.type);
  }
}

// ===== NEW: CAPTIONS & TRANSLATION FUNCTIONALITY =====

/**
 * Calls the Gemini API to translate text.
 */
async function translateText(text, sourceLang, targetLang, callback) {
  // Use API key provided by the environment
  const apiKey = ""; 
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  
  // Get full language names for a better prompt
  const sourceLangName = CAPTION_LANGUAGES[sourceLang] || sourceLang;
  const targetLangName = CAPTION_LANGUAGES[targetLang] || targetLang;

  const prompt = `Translate the following text from ${sourceLangName} to ${targetLangName}. Respond with *only* the translated text, no other commentary, labels, or quotation marks: "${text}"`;

  try {
    // Use exponential backoff for retries
    let response;
    let delay = 1000;
    for (let i = 0; i < 3; i++) { // Retry up to 3 times
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        })
      });

      if (response.ok) {
        break; // Success
      } else if (response.status === 429) { // Throttling
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
    }

    if (!response.ok) {
      throw new Error('Translation failed after retries');
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];
    let translatedText = candidate?.content?.parts?.[0]?.text;

    if (translatedText) {
      // Clean the response (model might add quotes or labels despite prompt)
      translatedText = translatedText.trim().replace(/^"|"$/g, '');
      callback(translatedText);
    } else {
      throw new Error('Invalid API response structure');
    }
  } catch (error) {
    console.error('Translation failed:', error);
    callback(`${text} (Translation failed)`); // Fallback to original text
  }
}

/**
 * Renders the caption text to the DOM.
 * This is the final step, whether translated or not.
 */
function renderCaption(username, text, isFinal) {
  const container = document.getElementById('captionsDisplay');
  // Use a consistent ID for the speaker
  const captionId = `caption-${username.replace(/\s+/g, '-')}`;
  let captionElement = document.getElementById(captionId);

  // Create new element if one for this speaker doesn't exist
  if (!captionElement) {
    captionElement = document.createElement('div');
    captionElement.id = captionId;
    captionElement.className = 'caption-item';
    container.appendChild(captionElement);
  }

  const isOwnCaption = username === googleUser?.name;

  // Update the content
  captionElement.innerHTML = `
    <span class="caption-speaker ${isOwnCaption ? 'own' : ''}">${username}:</span>
    <span class="caption-text ${isFinal ? 'final' : 'interim'}">${escapeHtml(text)}</span>
  `;

  if (isFinal) {
    // Add to history
    captionHistory.push({
      username,
      text, // Store the final (possibly translated) text
      timestamp: Date.now()
    });
    
    // Limit history size
    if (captionHistory.length > MAX_CAPTION_HISTORY) {
      captionHistory.shift();
    }
    
    // Remove final caption after a delay
    setTimeout(() => {
      if (captionElement && captionElement.querySelector('.caption-text.final')) {
        captionElement.style.opacity = '0';
        setTimeout(() => {
          if (captionElement) captionElement.remove();
        }, 500);
      }
    }, 3000); // Fade out after 3 seconds
  }

  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

/**
 * Main logic to display captions.
 * Decides if translation is needed and handles interim/final results.
 */
function displayCaption(username, text, isFinal, sourceLanguage = 'en-US') {
  const isOwnCaption = username === googleUser?.name;
  const needsTranslation = !isOwnCaption && sourceLanguage && sourceLanguage !== myPreferredLanguage;

  if (!needsTranslation) {
    // No translation needed, just render it
    renderCaption(username, text, isFinal);
    return;
  }

  // --- Translation is Needed ---

  if (isFinal) {
    // Final text: Clear any pending interim translations and translate this.
    clearTimeout(translationTimeout);
    translationTimeout = null;
    translationCache.delete(username); // Clear cache for this user

    // Show a placeholder with the *original* text while translating
    renderCaption(username, `${text} (Translating...)`, false); 

    translateText(text, sourceLanguage, myPreferredLanguage, (translatedText) => {
      renderCaption(username, translatedText, true); // Show final translation
    });

  } else {
    // Interim text: Cache it and set a debounce timer.
    // This prevents hammering the API for every single interim word.
    translationCache.set(username, text);

    if (translationTimeout) {
      clearTimeout(translationTimeout);
    }

    // Show interim in original language (faded)
    renderCaption(username, text, false);

    translationTimeout = setTimeout(() => {
      const cachedText = translationCache.get(username);
      if (cachedText) {
        translateText(cachedText, sourceLanguage, myPreferredLanguage, (translatedText) => {
          // Render this interim translation, but mark it as interim (faded)
          renderCaption(username, translatedText, false);
        });
        translationCache.delete(username);
      }
    }, 1000); // Wait 1 second after last interim result before translating
  }
}


function initSpeechRecognition() {
  // Check browser support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.error('Speech recognition not supported');
    showToast('Captions not supported in this browser', 'error');
    return false;
  }
  
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = captionLanguage; // Use the language I'm speaking
  recognition.maxAlternatives = 1;
  
  recognition.onstart = () => {
    console.log('🎤 Speech recognition started');
  };
  
  recognition.onresult = (event) => {
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
      // Send final caption to all participants
      sendCaption(finalTranscript.trim(), true);
      // Display my own caption
      renderCaption(googleUser.name, finalTranscript.trim(), true);
    } else if (interimTranscript) {
      // Send interim caption (real-time)
      sendCaption(interimTranscript.trim(), false);
      // Display my own interim caption
      renderCaption(googleUser.name, interimTranscript.trim(), false);
    }
  };
  
  recognition.onerror = (event) => {
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
    } else if (event.error === 'not-allowed') {
      showToast('Microphone permission denied for captions', 'error');
      captionsEnabled = false;
      updateCaptionsButton();
    }
  };
  
  recognition.onend = () => {
    console.log('🎤 Speech recognition ended');
    // Restart if captions still enabled
    if (captionsEnabled) {
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
  if (!recognition) {
    if (!initSpeechRecognition()) {
      return;
    }
  }
  
  if (!localStream || localStream.getAudioTracks().length === 0) {
    showToast('Cannot start captions: microphone not available', 'error');
    return;
  }
  
  try {
    recognition.lang = captionLanguage;
    recognition.start();
    captionsEnabled = true;
    updateCaptionsButton();
    
    // Show captions container
    document.getElementById('captionsContainer').classList.remove('hidden');
    
    showToast(`Captions started (Speaking ${CAPTION_LANGUAGES[captionLanguage]})`, 'success');
  } catch (err) {
    console.error('Failed to start captions:', err);
    showToast('Failed to start captions', 'error');
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
  
  captionsEnabled = false;
  updateCaptionsButton();
  
  // Clear caption display
  clearCaptions();
  
  showToast('Captions stopped', 'info');
}

function sendCaption(text, isFinal) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  sendSignalingMessage({
    type: 'caption',
    text: text,
    isFinal: isFinal,
    language: captionLanguage // Send the language I'm speaking
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
        <button class="btn-secondary" onclick="downloadCaptionHistory()">
          <i class="fas fa-download"></i>
          Download Caption History
        </button>
      </div>
      
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeModal(this)">Cancel</button>
        <button class="btn-primary" onclick="applyCaptionSettings(); closeModal(this);">Apply</button>
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

// ===== ADMIN UI UPDATES =====
function updateAdminUI() {
  const endMeetingBtn = document.getElementById('endMeetingBtn');
  const muteAllBtn = document.getElementById('muteAllBtn');
  const raiseHandBtn = document.getElementById('raiseHandBtn');
  
  if (isAdmin) {
    endMeetingBtn?.classList.remove('hidden');
    muteAllBtn?.classList.remove('hidden');
    raiseHandBtn?.classList.add('hidden');
  } else {
    endMeetingBtn?.classList.add('hidden');
    muteAllBtn?.classList.add('hidden');
    raiseHandBtn?.classList.remove('hidden');
  }
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
    await setupLocalStream();
    
    ws.send(JSON.stringify({
      type: 'create_room',
      username: googleUser.name,
      identity: { email: googleUser.email }
    }));
    
    setTimeout(() => {
      if (roomId) {
        showMeetingRoom();
        hideLoading();
      }
    }, 1000);
  } catch (err) {
    console.error('Failed to create room:', err);
    showToast('Failed to create room', 'error');
    hideLoading();
  }
}

async function joinRoomPrompt() {
  if (!googleUser) {
    showToast('Please sign in first', 'error');
    return;
  }
  
  const input = document.getElementById('roomIdInput');
  const id = input.value.trim().toUpperCase();
  
  if (!id) {
    showToast('Please enter a room code', 'error');
    return;
  }
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('Not connected to server', 'error');
    return;
  }
  
  showLoading(`Joining room ${id}...`);
  
  try {
    await setupLocalStream();
    
    ws.send(JSON.stringify({
      type: 'join_room',
      roomId: id,
      username: googleUser.name,
      identity: { email: googleUser.email }
    }));
    
    setTimeout(() => {
      if (roomId) {
        showMeetingRoom();
        hideLoading();
      }
    }, 1000);
  } catch (err) {
    console.error('Failed to join room:', err);
    showToast('Failed to join room', 'error');
    hideLoading();
  }
}

function updateRoomDisplay() {
  const display = document.getElementById('roomDisplay');
  if (display) {
    display.innerHTML = `<i class="fas fa-video"></i> Room: ${roomId}`;
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
    addVideoElement(clientId, localStream, true, googleUser.name);
  } catch (err) {
    console.error('❌ getUserMedia failed:', err);
    showToast('Could not access camera/microphone', 'error');
    throw err;
  }
}

// ===== SCREEN SHARING =====
async function toggleScreenShare() {
  if (!isScreenSharing) {
    try {
      console.log('🖥️ Starting screen share...');
      
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor'
        },
        audio: false
      });
      
      const screenTrack = screenStream.getVideoTracks()[0];
      
      screenTrack.onended = () => {
        stopScreenShare();
      };
      
      for (const [peerId, peer] of Object.entries(peers)) {
        if (!peer.pc) continue;
        
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
          console.log(`📤 Replaced video track with screen for ${peerId}`);
        }
      }
      
      const localVideo = document.querySelector(`#video-${clientId} video`);
      if (localVideo) {
        localVideo.srcObject = screenStream;
        localVideo.style.transform = 'none';
      }
      
      isScreenSharing = true;
      updateScreenShareButton();
      showToast('Screen sharing started', 'success');
      
    } catch (err) {
      console.error('❌ Screen share failed:', err);
      showToast('Failed to start screen sharing', 'error');
    }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  if (!screenStream) return;
  
  console.log('⏹️ Stopping screen share...');
  
  screenStream.getTracks().forEach(track => track.stop());
  
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    
    for (const [peerId, peer] of Object.entries(peers)) {
      if (!peer.pc) continue;
      
      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender && videoTrack) {
        sender.replaceTrack(videoTrack);
        console.log(`📤 Restored camera track for ${peerId}`);
      }
    }
    
    const localVideo = document.querySelector(`#video-${clientId} video`);
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.style.transform = 'scaleX(-1)';
    }
  }
  
  screenStream = null;
  isScreenSharing = false;
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
    
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    
    const canvasStream = canvas.captureStream(30);
    
    let audioContext;
    let destination;
    
    if (localStream && localStream.getAudioTracks().length > 0) {
      audioContext = new AudioContext();
      destination = audioContext.createMediaStreamDestination();
      
      const localAudioSource = audioContext.createMediaStreamSource(
        new MediaStream(localStream.getAudioTracks())
      );
      localAudioSource.connect(destination);
      
      destination.stream.getAudioTracks().forEach(track => {
        canvasStream.addTrack(track);
      });
    }
    
    const captureFrame = () => {
      if (!isRecording) return;
      
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const videoGrid = document.getElementById('videoGrid');
      const videos = videoGrid.querySelectorAll('video');
      
      const cols = Math.ceil(Math.sqrt(videos.length));
      const rows = Math.ceil(videos.length / cols);
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
      
      requestAnimationFrame(captureFrame);
    };
    
    captureFrame();
    
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
    
    mediaRecorder.start(1000);
    isRecording = true;
    updateRecordingButton();
    showToast('Recording started', 'success');
    
  } catch (err) {
    console.error('❌ Recording failed:', err);
    showToast('Failed to start recording', 'error');
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  
  console.log('⏹️ Stopping recording...');
  mediaRecorder.stop();
  isRecording = false;
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

// ===== VIDEO ELEMENT MANAGEMENT =====
function addVideoElement(id, stream, isLocal = false, username = 'Participant') {
  let wrapper = document.getElementById(`video-${id}`);
  
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = `video-${id}`;
    wrapper.className = `video-wrapper ${isLocal ? 'local' : ''}`;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    video.srcObject = stream;
    
    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    overlay.innerHTML = `
      <div class="participant-name">${isLocal ? 'You' : username}</div>
      <div class="video-indicators">
        <div class="indicator muted hidden" id="muted-${id}">
          <i class="fas fa-microphone-slash"></i>
        </div>
        <div class="indicator hand-raised hidden" id="hand-${id}">
          <i class="fas fa-hand-paper"></i>
        </div>
      </div>
    `;
    
    wrapper.appendChild(video);
    wrapper.appendChild(overlay);
    
    document.getElementById('videoGrid').appendChild(wrapper);
    
    console.log(`✅ Added video element for ${id} (${username})`);
  } else {
    const video = wrapper.querySelector('video');
    video.srcObject = stream;
    console.log(`🔄 Updated video stream for ${id}`);
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
  const wrapper = document.getElementById(`video-${id}`);
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
  
  const streamToSend = isScreenSharing ? screenStream : localStream;
  
  if (streamToSend) {
    for (const track of streamToSend.getTracks()) {
      try {
        pc.addTrack(track, streamToSend);
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
    
    if (state === 'connected' || state === 'completed') {
      showToast(`Connected to ${username}`, 'success');
    } else if (state === 'failed') {
      console.error(`❌ Connection FAILED for ${id}`);
      setTimeout(async () => {
        try {
          if (pc.restartIce) pc.restartIce();
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          sendSignalingMessage({
            type: 'offer',
            sdp: pc.localDescription,
            targetClientId: id
          });
        } catch (err) {
          console.error(`❌ ICE restart failed for ${id}:`, err);
        }
      }, 2000);
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

async function handleIceCandidate(fromId, candidate) {
  const peer = peers[fromId];
  if (!peer) return;
  
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
  
  updateMicButton();
  showToast(isMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
}

function updateMicButton() {
  const btn = document.getElementById('toggleMicBtn');
  const icon = document.getElementById('micIcon');
  
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
  
  updateCameraButton();
  showToast(isCameraOff ? 'Camera off' : 'Camera on', 'info');
}

function updateCameraButton() {
  const btn = document.getElementById('toggleCamBtn');
  const icon = document.getElementById('camIcon');
  
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
        <button class="btn-secondary" onclick="closeModal(this)">Cancel</button>
        <button class="btn-primary" onclick="sendUnmuteRequest(); closeModal(this);">Send Request</button>
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
  let item = document.getElementById(`participant-${id}`);
  if (!item) {
    item = document.createElement('div');
    item.id = `participant-${id}`;
    item.className = 'participant-item';
    const initial = username.charAt(0).toUpperCase();
    item.innerHTML = `
      <div class="participant-info">
        <div class="participant-avatar">${initial}</div>
        <div class="participant-details">
          <p>${username}</p>
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
          <button class="btn-icon ${isAdminMuted ? 'muted' : ''}" onclick="toggleParticipantMute('${id}')" title="${isAdminMuted ? 'Unmute' : 'Mute'}">
            <i class="fas fa-microphone${isAdminMuted ? '-slash' : ''}"></i>
          </button>
          <button class="btn-icon" onclick="showTransferAdminModal('${id}', '${username}')" title="Transfer Admin">
            <i class="fas fa-crown"></i>
          </button>
        </div>
      ` : ''}
    `;
    list.appendChild(item);
  }
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
  const list = document.getElementById('participantsList');
  const count = list.children.length;
  document.getElementById('participantCount').textContent = count;
  document.getElementById('participantCountBadge').textContent = count;
}

function updateParticipantMuteStatus(participantId, isAdminMuted) {
  const listItem = document.getElementById(`participant-${participantId}`);
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
      <p>Transfer host to <strong>${targetUsername}</strong>?</p>
      <p class="warning-text">You will no longer be the host.</p>
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
    sendSignalingMessage({ type: 'end_meeting', adminToken });
  }
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  sendSignalingMessage({ type: 'chat_message', message });
  input.value = '';
  input.style.height = 'auto';
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

function showMeetingRoom() {
  document.getElementById('landingPage').classList.add('hidden');
  document.getElementById('meetingRoom').classList.remove('hidden');
  isInMeeting = true;
  if (clientId && googleUser) {
    addParticipantToList(clientId, googleUser.name, false, false);
  }
  updateAdminUI();
}

function showLandingPage() {
  document.getElementById('meetingRoom').classList.add('hidden');
  document.getElementById('landingPage').classList.remove('hidden');
  isInMeeting = false;
}

function removePeer(id) {
  console.log(`🗑️ Removing peer: ${id}`);
  if (peers[id]) {
    try {
      peers[id].pc.close();
    } catch (e) {
      console.error('Error closing peer:', e);
    }
    delete peers[id];
  }
  removeVideoElement(id);
  removeParticipantFromList(id);
}

function leaveMeeting() {
  if (!confirm('Leave the meeting?')) return;
  console.log('🚪 Leaving meeting...');
  
  if (isRecording) stopRecording();
  if (isScreenSharing) stopScreenShare();
  if (captionsEnabled) stopCaptions();
  
  Object.keys(peers).forEach(id => {
    try {
      peers[id].pc.close();
    } catch (e) {
      console.error('Error closing peer:', e);
    }
  });
  peers = {};
  
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
    } catch (e) {
      console.error('Error closing WebSocket:', e);
    }
    ws = null;
  }
  
  showLandingPage();
  showToast('Left the meeting', 'info');
  
  setTimeout(() => {
    initWebSocket();
  }, 1000);
}

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
  
  console.log('✅ App initialized successfully');
});

// ===== EXPOSE FUNCTIONS TO WINDOW =====
window.createRoom = createRoom;
window.joinRoomPrompt = joinRoomPrompt;
window.copyRoomId = copyRoomId;
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
