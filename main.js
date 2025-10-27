// // main.js - Refactored for Google Meet Clone Functionality

// // --- CONFIGURATION ---
// // IMPORTANT: REPLACE WITH YOUR DEPLOYED RENDER.COM URL
// const SIGNALING_SERVER_URL = 'wss://webrtc-meeting-server.onrender.com';
// const STUN_URL = 'stun:stun.l.google.com:19302';
// // IMPORTANT: Use a reliable TURN server provider for production (e.g., Twilio, Metered, Xirsys)
// // Using a free/test one here - may have limitations.
// const TURN_CONFIG = {
//     urls: 'turn:relay1.expressturn.com:3480',
//     username: '000000002076492763',
//     credential: 'c0gF9hE/qvrhetCJUVOMWrvbUa8='
// };
// const ICE_SERVERS = [{ urls: STUN_URL }, TURN_CONFIG];
// const pcConfig = { iceServers: ICE_SERVERS };

// // --- DOM ELEMENTS ---
// const landingPage = document.getElementById('landing-page');
// const meetingRoom = document.getElementById('meeting-room');
// const usernameInput = document.getElementById('usernameInput');
// const createRoomBtn = document.getElementById('createRoomBtn');
// const roomIdInput = document.getElementById('roomIdInput');
// const joinRoomBtn = document.getElementById('joinRoomBtn');
// const landingError = document.getElementById('landing-error');
// const roomIdDisplay = document.getElementById('roomIdDisplay');
// const copyRoomIdBtnTop = document.getElementById('copyRoomIdBtnTop');
// const videoGrid = document.getElementById('video-grid');
// const sidePanel = document.getElementById('side-panel');
// const closeSidePanelBtn = document.getElementById('closeSidePanelBtn');
// const showParticipantsTab = document.getElementById('showParticipantsTab');
// const showChatTab = document.getElementById('showChatTab');
// const participantsPanel = document.getElementById('participants-panel');
// const chatPanel = document.getElementById('chat-panel');
// const participantsList = document.getElementById('participants-list');
// const participantCount = document.getElementById('participant-count');
// const participantCountBadge = document.getElementById('participant-count-badge');
// const muteAllBtn = document.getElementById('muteAllBtn');
// const chatMessages = document.getElementById('chat-messages');
// const chatInput = document.getElementById('chat-input');
// const sendChatBtn = document.getElementById('sendChatBtn');
// const muteSelfBtn = document.getElementById('muteSelfBtn');
// const muteIcon = document.getElementById('muteIcon');
// const toggleVideoBtn = document.getElementById('toggleVideoBtn');
// const videoIcon = document.getElementById('videoIcon');
// const leaveMeetingBtn = document.getElementById('leaveMeetingBtn');
// const endMeetingBtn = document.getElementById('endMeetingBtn');
// const toggleParticipantsBtn = document.getElementById('toggleParticipantsBtn');
// const toggleChatBtn = document.getElementById('toggleChatBtn');
// const shareModal = document.getElementById('share-modal');
// const modalRoomId = document.getElementById('modalRoomId');
// const copyRoomIdBtnModal = document.getElementById('copyRoomIdBtnModal');
// const copyStatus = document.getElementById('copy-status');
// const closeModalBtn = document.getElementById('closeModalBtn');
// const loadingIndicator = document.getElementById('loading-indicator'); // Optional

// // --- APP STATE ---
// let localStream = null;
// let myClientId = null; // Unique ID from server
// let myUsername = '';
// let myRoomId = null;
// let adminToken = null; // Secret token only for the admin
// let isAdmin = false;
// let isSelfMuted = false;
// let isCameraOff = false;
// let ws = null; // WebSocket connection
// const peerConnections = new Map(); // Map<clientId, RTCPeerConnection>
// const participants = new Map(); // Map<clientId, { username: string, isMuted: boolean (by admin) }> - Tracks state

// // --- INITIALIZATION ---
// function init() {
//     console.log("Initializing application...");
//     addEventListeners();
//     // Auto-focus username input on load
//     usernameInput.focus();
// }

// function addEventListeners() {
//     createRoomBtn.onclick = handleCreateRoom;
//     joinRoomBtn.onclick = handleJoinRoom;
//     roomIdInput.onkeyup = (e) => { if (e.key === 'Enter') handleJoinRoom(); };
//     usernameInput.onkeyup = (e) => { if (e.key === 'Enter') createRoomBtn.focus(); }; // Move focus on enter

//     muteSelfBtn.onclick = toggleSelfMute;
//     toggleVideoBtn.onclick = toggleCamera;
//     leaveMeetingBtn.onclick = leaveMeeting;
//     endMeetingBtn.onclick = handleEndMeeting;

//     toggleParticipantsBtn.onclick = () => toggleSidePanel('participants');
//     toggleChatBtn.onclick = () => toggleSidePanel('chat');
//     showParticipantsTab.onclick = () => showTab('participants');
//     showChatTab.onclick = () => showTab('chat');
//     closeSidePanelBtn.onclick = closeSidePanel;

//     sendChatBtn.onclick = sendChatMessage;
//     chatInput.onkeydown = handleChatInputKeydown;

//     copyRoomIdBtnTop.onclick = copyRoomId;
//     copyRoomIdBtnModal.onclick = copyRoomIdFromModal;
//     closeModalBtn.onclick = () => shareModal.classList.add('hidden');
//     muteAllBtn.onclick = handleMuteAll;
// }

// // --- WEBSOCKET CONNECTION & HANDLING ---
// function connectWebSocket() {
//     if (ws && ws.readyState === WebSocket.OPEN) {
//         console.log("WebSocket already open.");
//         return;
//     }

//     console.log("Connecting to Signaling Server:", SIGNALING_SERVER_URL);
//     showLoading("Connecting...");
//     ws = new WebSocket(SIGNALING_SERVER_URL);

//     ws.onopen = () => {
//         console.log("WebSocket connection established.");
//         hideLoading();
//     };

//     ws.onmessage = async (message) => {
//         hideLoading(); // Hide loading on any message received after initial connect
//         try {
//             const data = JSON.parse(message.data);
//             console.log("Received message:", data); // Log all messages
//             switch (data.type) {
//                 case 'your_info':
//                     myClientId = data.clientId;
//                     participants.set(myClientId, { username: myUsername, isMuted: false }); // Add self to participant map
//                     console.log(`Received my info: ClientID=${myClientId}`);
//                     await setupMeetingRoom(); // Setup room only after getting ID
//                     if (data.isAdmin) {
//                         isAdmin = true;
//                         adminToken = data.adminToken; // Store admin token securely
//                         endMeetingBtn.classList.remove('hidden');
//                         muteAllBtn.classList.remove('hidden');
//                         console.log("I am the admin.");
//                     }
//                     if(data.roomId) { // If joining, server sends roomId
//                         myRoomId = data.roomId;
//                         roomIdDisplay.innerText = myRoomId.toUpperCase();
//                     }
//                     updateParticipantsList(); // Initial update with self
//                     break;
//                 case 'room_created': // Initial confirmation for creator
//                     myRoomId = data.roomId;
//                     roomIdDisplay.innerText = myRoomId.toUpperCase();
//                     showShareModal(myRoomId);
//                     // Server will follow up with 'your_info' containing clientId, adminToken etc.
//                     break;
//                 case 'room_state': // Sent when joining an existing room
//                     console.log("Received room state:", data.participants);
//                     data.participants.forEach(p => {
//                         if (p.clientId !== myClientId) {
//                             participants.set(p.clientId, { username: p.username, isMuted: p.isMuted });
//                             // Don't create PC yet, wait for offers or create offers below
//                         }
//                     });
//                     updateParticipantsList();
//                     // Now, create offers FOR all existing participants
//                     console.log("Creating offers for existing participants...");
//                     participants.forEach((details, clientId) => {
//                         if (clientId !== myClientId) {
//                              console.log(`Creating offer for ${clientId} (${details.username})`);
//                              createPeerConnection(clientId, details.username, true); // Initiate connection by sending offer
//                         }
//                     });
//                     break;
//                 case 'peer_joined':
//                     console.log(`Peer joined: ${data.username} (ID: ${data.clientId})`);
//                     if (!participants.has(data.clientId)) {
//                         participants.set(data.clientId, { username: data.username, isMuted: false });
//                         updateParticipantsList();
//                         // Don't create PC here, the new peer will send an offer
//                     }
//                     break;
//                 case 'peer_left':
//                     console.log(`Peer left: ${participants.get(data.clientId)?.username} (ID: ${data.clientId})`);
//                     removePeer(data.clientId);
//                     break;
//                 case 'offer':
//                     await handleOffer(data.fromId, data.username, data.sdp);
//                     break;
//                 case 'answer':
//                     await handleAnswer(data.fromId, data.sdp);
//                     break;
//                 case 'ice_candidate':
//                     await handleIceCandidate(data.fromId, data.candidate);
//                     break;
//                 case 'force_mute': // Admin muted someone
//                      handleAdminMuteToggle(data.targetClientId, data.muteState);
//                     break;
//                 case 'new_chat_message':
//                     displayChatMessage(data.fromUsername, data.message, data.timestamp, data.fromClientId === myClientId);
//                     break;
//                 case 'meeting_ended':
//                     alert("The meeting has been ended by the host.");
//                     leaveMeeting(false); // Don't notify server again
//                     break;
//                 case 'error':
//                     console.error("Server error:", data.message);
//                     landingError.innerText = data.message;
//                     hideLoading();
//                     // Consider closing WS or allowing retry?
//                     if(ws) ws.close();
//                     showLandingPage();
//                     break;
//                 default:
//                     console.warn("Unknown message type:", data.type);
//             }
//         } catch (error) {
//             console.error("Failed to parse message or handle:", error);
//             hideLoading();
//         }
//     };

//     ws.onerror = (error) => {
//         console.error("WebSocket error:", error);
//         landingError.innerText = "Connection failed. Server might be down or unreachable.";
//         hideLoading();
//         showLandingPage();
//     };

//     ws.onclose = () => {
//         console.log("WebSocket connection closed.");
//         hideLoading();
//         // If not intentionally leaving, show landing page
//         if(meetingRoom.style.display !== 'none') {
//             alert("Connection lost to the server.");
//             showLandingPage();
//         }
//     };
// }

// // --- LANDING PAGE ACTIONS ---
// function handleCreateRoom() {
//     myUsername = usernameInput.value.trim();
//     if (!myUsername) {
//         landingError.innerText = "Please enter your name.";
//         return;
//     }
//     landingError.innerText = "";
//     connectWebSocket();
//     // Send create message ONCE websocket is open
//     waitForSocketOpen(() => {
//         showLoading("Creating room...");
//         ws.send(JSON.stringify({ type: 'create_room', username: myUsername }));
//     });
// }

// function handleJoinRoom() {
//     myUsername = usernameInput.value.trim();
//     const roomId = roomIdInput.value.trim().toUpperCase();
//     if (!myUsername) {
//         landingError.innerText = "Please enter your name.";
//         return;
//     }
//     if (!roomId) {
//         landingError.innerText = "Please enter a Room ID.";
//         return;
//     }
//     landingError.innerText = "";
//     connectWebSocket();
//     // Send join message ONCE websocket is open
//     waitForSocketOpen(() => {
//         showLoading(`Joining room ${roomId}...`);
//         ws.send(JSON.stringify({ type: 'join_room', roomId, username: myUsername }));
//     });
// }

// // Helper to wait for WebSocket to be open before sending
// function waitForSocketOpen(callback) {
//     if (ws && ws.readyState === WebSocket.OPEN) {
//         callback();
//     } else {
//         // Wait a bit and retry, or add listener
//         setTimeout(() => waitForSocketOpen(callback), 100); // Simple retry
//         // Or ws.addEventListener('open', callback, { once: true }); // More robust
//     }
// }


// // --- MEETING ROOM SETUP ---
// async function setupMeetingRoom() {
//     landingPage.style.display = 'none';
//     meetingRoom.classList.remove('hidden');
//     meetingRoom.classList.add('flex'); // Use flex for layout

//     try {
//         console.log("Requesting user media...");
//         localStream = await navigator.mediaDevices.getUserMedia({
//             video: { facingMode: "user" }, // Default to front camera
//             audio: { echoCancellation: true, noiseSuppression: true } // Enable processing
//          });
//         console.log("User media obtained.");
//         addVideoStream(myClientId, localStream, true, myUsername); // Add self video
//     } catch (err) {
//         console.error("Error getting user media:", err);
//         alert("Could not access camera or microphone. Please check permissions and ensure no other app is using them. You can join without media, but won't be able to send video/audio.");
//         // Allow joining without media? For now, we proceed but localStream will be null
//     }

//     // Ensure buttons reflect initial state AFTER stream is attempted
//      updateMuteButton();
//      updateVideoButton();

//     // Now safe to set up peer connections that might need the local stream
// }

// // --- WebRTC PEER CONNECTION LOGIC ---

// function createPeerConnection(targetClientId, targetUsername, isOfferer) {
//     if (peerConnections.has(targetClientId)) {
//         console.log(`Peer connection already exists for ${targetClientId}, reusing.`);
//         return peerConnections.get(targetClientId); // Avoid duplicates
//     }

//     console.log(`Creating PeerConnection for ${targetClientId} (${targetUsername}), isOfferer: ${isOfferer}`);
//     const pc = new RTCPeerConnection(pcConfig);
//     peerConnections.set(targetClientId, pc);

//     // Add local tracks IF the stream exists
//     if (localStream) {
//         localStream.getTracks().forEach(track => {
//             try {
//                  pc.addTrack(track, localStream);
//                  console.log(`Added local ${track.kind} track for ${targetClientId}`);
//             } catch (error) {
//                  console.error(`Error adding track for ${targetClientId}:`, error);
//             }
//         });
//     } else {
//         console.warn(`No local stream available when creating PC for ${targetClientId}`);
//     }


//     // Handle incoming tracks from the peer
//     pc.ontrack = (event) => {
//         console.log(`Received remote track (${event.track.kind}) from ${targetClientId}`);
//         if (event.streams && event.streams[0]) {
//              addVideoStream(targetClientId, event.streams[0], false, targetUsername);
//         } else {
//              // Handle cases where stream might not be immediately available
//              // This might require adding tracks individually to a MediaStream
//              console.warn(`Track received from ${targetClientId} without a stream object.`);
//              // Example: Create stream manually if needed
//              let remoteStream = document.getElementById(`video-${targetClientId}`)?.srcObject;
//              if (!remoteStream) {
//                  remoteStream = new MediaStream();
//                  addVideoStream(targetClientId, remoteStream, false, targetUsername);
//              }
//              remoteStream.addTrack(event.track);
//         }
//     };

//     // Handle ICE candidates
//     pc.onicecandidate = (event) => {
//         if (event.candidate) {
//             console.log(`Sending ICE candidate to ${targetClientId}`);
//             sendMessage({
//                 type: 'ice_candidate',
//                 candidate: event.candidate,
//                 targetClientId: targetClientId
//             });
//         } else {
//             console.log(`ICE gathering complete for ${targetClientId}.`);
//         }
//     };

//     // Handle connection state changes (for debugging)
//     pc.oniceconnectionstatechange = () => {
//         console.log(`ICE connection state change for ${targetClientId}: ${pc.iceConnectionState}`);
//         if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
//             console.error(`Connection to ${targetClientId} failed or closed.`);
//             // Optionally attempt to restart ICE or remove the peer visually
//             // removePeer(targetClientId); // Example: remove on failure
//         }
//     };
//      pc.onconnectionstatechange = () => {
//          console.log(`Peer connection state change for ${targetClientId}: ${pc.connectionState}`);
//          if (pc.connectionState === 'failed') {
//              console.error(`Connection to ${targetClientId} failed.`);
//              // Attempt ICE restart or notify user
//          }
//      };

//     // If this peer is initiating, create and send offer
//     if (isOfferer && localStream) { // Only offer if we have media to send
//         pc.createOffer()
//             .then(offer => {
//                 console.log(`Created offer for ${targetClientId}`);
//                 return pc.setLocalDescription(offer);
//             })
//             .then(() => {
//                 console.log(`Set local description, sending offer to ${targetClientId}`);
//                 sendMessage({
//                     type: 'offer',
//                     sdp: pc.localDescription,
//                     targetClientId: targetClientId
//                 });
//             })
//             .catch(error => console.error(`Error creating offer for ${targetClientId}:`, error));
//     } else if (isOfferer && !localStream) {
//         console.warn(`Cannot create offer for ${targetClientId} without local media stream.`);
//     }

//     return pc;
// }

// async function handleOffer(fromId, fromUsername, sdp) {
//      console.log(`Received offer from ${fromId} (${fromUsername})`);
//      const pc = createPeerConnection(fromId, fromUsername, false); // Get/Create PC

//      try {
//          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
//          console.log(`Set remote description (offer) from ${fromId}`);

//          if(localStream) { // Only create answer if we have media
//              const answer = await pc.createAnswer();
//              console.log(`Created answer for ${fromId}`);
//              await pc.setLocalDescription(answer);
//              console.log(`Set local description (answer), sending answer to ${fromId}`);
//              sendMessage({
//                  type: 'answer',
//                  sdp: pc.localDescription,
//                  targetClientId: fromId
//              });
//          } else {
//              console.warn(`Cannot create answer for ${fromId} without local media stream.`);
//              // Consider sending a "no media" message or just doing nothing
//          }
//      } catch (error) {
//          console.error(`Error handling offer from ${fromId}:`, error);
//      }
// }

// async function handleAnswer(fromId, sdp) {
//     console.log(`Received answer from ${fromId}`);
//     const pc = peerConnections.get(fromId);
//     if (pc) {
//         try {
//             await pc.setRemoteDescription(new RTCSessionDescription(sdp));
//             console.log(`Set remote description (answer) from ${fromId}`);
//         } catch (error) {
//             console.error(`Error setting remote description (answer) from ${fromId}:`, error);
//         }
//     } else {
//         console.warn(`Received answer from unknown peer: ${fromId}`);
//     }
// }

// async function handleIceCandidate(fromId, candidate) {
//     // console.log(`Received ICE candidate from ${fromId}`); // Can be very verbose
//     const pc = peerConnections.get(fromId);
//     if (pc) {
//         try {
//             // Add candidate only if remote description is set
//             if (pc.remoteDescription) {
//                 await pc.addIceCandidate(new RTCIceCandidate(candidate));
//                  // console.log(`Added ICE candidate from ${fromId}`); // Verbose
//             } else {
//                 console.warn(`Remote description not set for ${fromId}, queuing ICE candidate.`);
//                 // Basic queuing (more robust solution might be needed)
//                  if (!pc.queuedCandidates) pc.queuedCandidates = [];
//                  pc.queuedCandidates.push(candidate);
//             }
//         } catch (error) {
//             console.error(`Error adding ICE candidate from ${fromId}:`, error);
//         }
//     } else {
//         console.warn(`Received ICE candidate from unknown peer: ${fromId}`);
//     }
//      // Process queued candidates if remote description was just set
//      if (pc && pc.remoteDescription && pc.queuedCandidates) {
//          console.log(`Processing ${pc.queuedCandidates.length} queued ICE candidates for ${fromId}`);
//          while (pc.queuedCandidates.length > 0) {
//              const queued = pc.queuedCandidates.shift();
//              try {
//                  await pc.addIceCandidate(new RTCIceCandidate(queued));
//              } catch (error) {
//                  console.error(`Error adding queued ICE candidate from ${fromId}:`, error);
//              }
//          }
//      }
// }

// // --- MEDIA CONTROLS ---
// function toggleSelfMute() {
//     if (!localStream) return;
//     isSelfMuted = !isSelfMuted;
//     localStream.getAudioTracks().forEach(track => track.enabled = !isSelfMuted);
//     updateMuteButton();
//     // Notify server/peers about your mute status change (optional, useful for UI indicators)
//     // sendMessage({ type: 'mute_status', muted: isSelfMuted });
// }

// function updateMuteButton() {
//     if (isSelfMuted) {
//         muteIcon.classList.replace('fa-microphone', 'fa-microphone-slash');
//         muteSelfBtn.classList.add('active'); // Use active class for red background
//         muteSelfBtn.title = "Unmute Microphone";
//     } else {
//         muteIcon.classList.replace('fa-microphone-slash', 'fa-microphone');
//         muteSelfBtn.classList.remove('active');
//         muteSelfBtn.title = "Mute Microphone";
//     }
// }

// function toggleCamera() {
//     if (!localStream) return;
//     isCameraOff = !isCameraOff;
//     localStream.getVideoTracks().forEach(track => track.enabled = !isCameraOff);
//     updateVideoButton();
//     // Notify server/peers (optional)
//     // sendMessage({ type: 'video_status', videoOff: isCameraOff });
// }

// function updateVideoButton() {
//      if (isCameraOff) {
//          videoIcon.classList.replace('fa-video', 'fa-video-slash');
//          toggleVideoBtn.classList.add('active');
//          toggleVideoBtn.title = "Turn Camera On";
//      } else {
//          videoIcon.classList.replace('fa-video-slash', 'fa-video');
//          toggleVideoBtn.classList.remove('active');
//          toggleVideoBtn.title = "Turn Camera Off";
//      }
// }

// // --- ADMIN ACTIONS ---
// function handleAdminMuteToggle(targetClientId, muteState) {
//     console.log(`Admin action: Set mute=${muteState} for ${targetClientId}`);
//      participants.set(targetClientId, { ...participants.get(targetClientId), isMuted: muteState });

//     if (targetClientId === myClientId) {
//         // Force mute/unmute self if targeted by admin
//         isSelfMuted = muteState;
//         localStream?.getAudioTracks().forEach(track => track.enabled = !isSelfMuted);
//         updateMuteButton();
//         if(isSelfMuted) alert("The host muted you.");
//         // We don't alert on unmute
//     }
//     // Update the UI in the participants list
//     updateParticipantsList();
// }

// function requestAdminMuteToggle(targetClientId, targetUsername) {
//     if (!isAdmin) return;
//     const participant = participants.get(targetClientId);
//     if (!participant) return;

//     const currentMuteState = participant.isMuted;
//     const newState = !currentMuteState; // Toggle the state
//     console.log(`Admin requesting toggle mute (${newState}) for ${targetClientId} (${targetUsername})`);

//     sendMessage({
//         type: 'admin_control',
//         action: 'mute_toggle',
//         targetClientId: targetClientId,
//         muteState: newState, // Send the desired *new* state
//         adminToken: adminToken // Authenticate admin action
//     });
//     // Optimistically update UI? Server confirmation is better.
//     // participants.set(targetClientId, { ...participant, isMuted: newState });
//     // updateParticipantsList();
// }


// function handleMuteAll() {
//     if (!isAdmin) return;
//     if (confirm("Mute all participants except yourself?")) {
//         console.log("Admin requesting Mute All");
//         sendMessage({
//             type: 'admin_control',
//             action: 'mute_all',
//             adminToken: adminToken
//         });
//     }
// }

// function handleEndMeeting() {
//     if (!isAdmin) return;
//     if (confirm("Are you sure you want to end the meeting for everyone?")) {
//         console.log("Admin ending meeting");
//         sendMessage({
//             type: 'end_meeting',
//             roomId: myRoomId,
//             adminToken: adminToken
//         });
//         // Client side will get 'meeting_ended' message from server broadcast
//     }
// }

// // --- MEETING LIFECYCLE ---
// function leaveMeeting(notifyServer = true) {
//     console.log("Leaving meeting...");
//     // 1. Close all peer connections
//     peerConnections.forEach(pc => pc.close());
//     peerConnections.clear();

//     // 2. Stop local media tracks
//     localStream?.getTracks().forEach(track => track.stop());
//     localStream = null;

//     // 3. Close WebSocket connection (conditionally)
//     if (ws) {
//         if(notifyServer) {
//             // Optionally send a 'leave' message if server needs explicit notification
//             // sendMessage({ type: 'leave_room' });
//         }
//         ws.close(); // Close the connection
//         ws = null;
//     }

//     // 4. Reset state variables
//     participants.clear();
//     myClientId = null;
//     myRoomId = null;
//     adminToken = null;
//     isAdmin = false;
//     isSelfMuted = false;
//     isCameraOff = false;

//     // 5. Reset UI
//     showLandingPage();
// }

// function removePeer(clientId) {
//     console.log(`Removing peer ${clientId}`);
//     // Remove video element
//     const videoContainer = document.getElementById(`video-container-${clientId}`);
//     if (videoContainer) videoContainer.remove();

//     // Close PeerConnection
//     const pc = peerConnections.get(clientId);
//     if (pc) {
//         pc.close();
//         peerConnections.delete(clientId);
//     }

//     // Remove from participant list state
//     participants.delete(clientId);

//     // Update UI
//     updateParticipantsList();
//     adjustVideoGridLayout();
// }

// // --- UI UPDATES & HELPERS ---

// function addVideoStream(clientId, stream, isLocal = false, username = 'Participant') {
//     if (!stream) {
//         console.error(`Attempted to add video for ${clientId} but stream is null.`);
//         return;
//     }
//      // Check if video element already exists
//      let videoContainer = document.getElementById(`video-container-${clientId}`);
//      let videoElement = document.getElementById(`video-${clientId}`);

//      if (!videoContainer) {
//         videoContainer = document.createElement('div');
//         videoContainer.id = `video-container-${clientId}`;
//         videoContainer.className = 'video-container relative group'; // Added group for hover effects
//         if (isLocal) {
//             videoContainer.classList.add('local'); // Add class to mirror local video via CSS
//         }

//         videoElement = document.createElement('video');
//         videoElement.id = `video-${clientId}`;
//         videoElement.autoplay = true;
//         videoElement.playsInline = true; // Important for mobile
//         videoElement.muted = isLocal; // Mute local video to prevent echo

//         const nameTag = document.createElement('div');
//         nameTag.className = 'video-name-tag';
//         nameTag.innerText = isLocal ? `You (${username})` : username;

//         const mutedIndicator = document.createElement('div');
//         mutedIndicator.id = `muted-indicator-${clientId}`;
//         mutedIndicator.className = 'muted-indicator hidden'; // Initially hidden
//         mutedIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>';

//         videoContainer.appendChild(videoElement);
//         videoContainer.appendChild(nameTag);
//         videoContainer.appendChild(mutedIndicator); // Add indicator
//         videoGrid.appendChild(videoContainer);

//      }

//      // Always update the srcObject in case the stream changes (e.g., track added later)
//      if (videoElement.srcObject !== stream) {
//          videoElement.srcObject = stream;
//      }

//      adjustVideoGridLayout();
//      updateParticipantsList(); // Update list whenever video is added/updated
// }


// function adjustVideoGridLayout() {
//     const count = videoGrid.children.length;
//     let cols = Math.ceil(Math.sqrt(count));
//     // Avoid single column unless only 1 participant
//     if (count > 1 && cols === 1) cols = 2;
//     // Limit max columns for better layout
//     cols = Math.min(cols, 4); // Example: max 4 columns

//     videoGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
// }

// function updateParticipantsList() {
//     participantsList.innerHTML = ''; // Clear existing list
//     const count = participants.size;
//     participantCount.innerText = count;
//     participantCountBadge.innerText = count; // Update badge on main button

//     participants.forEach((details, clientId) => {
//         const isSelf = clientId === myClientId;
//         const participantItem = document.createElement('div');
//         participantItem.className = 'participant-item';

//         const nameSpan = document.createElement('span');
//         nameSpan.className = 'participant-name';
//         nameSpan.innerText = isSelf ? `You (${details.username})` : details.username;

//         const controlsDiv = document.createElement('div');
//         controlsDiv.className = 'participant-controls';

//         // Muted by Admin Indicator/Button
//         const muteIndicatorIcon = document.createElement('i');
//          muteIndicatorIcon.className = `fas fa-microphone${details.isMuted ? '-slash' : ''}`;
//          muteIndicatorIcon.classList.toggle('text-red-500', details.isMuted); // Red if muted
//          muteIndicatorIcon.classList.toggle('text-gray-400', !details.isMuted);
//          muteIndicatorIcon.title = details.isMuted ? "Muted by Admin" : "Mic On";


//         if (isAdmin && !isSelf) {
//              // Admin sees a button to toggle mute for others
//             const muteButton = document.createElement('button');
//              muteButton.title = details.isMuted ? `Request Unmute ${details.username}` : `Mute ${details.username}`;
//              muteButton.innerHTML = `<i class="fas fa-microphone${details.isMuted ? '-slash' : ''}"></i>`;
//              muteButton.classList.toggle('muted', details.isMuted); // Add class if muted
//             muteButton.onclick = () => requestAdminMuteToggle(clientId, details.username);
//             controlsDiv.appendChild(muteButton);
//         } else {
//              // Non-admins (or self) just see the indicator icon
//              controlsDiv.appendChild(muteIndicatorIcon);
//         }


//         participantItem.appendChild(nameSpan);
//         participantItem.appendChild(controlsDiv);
//         participantsList.appendChild(participantItem);
//     });
// }


// function toggleSidePanel(panelToShow = 'participants') {
//     if (sidePanel.classList.contains('open') &&
//        ((panelToShow === 'participants' && participantsPanel.style.display !== 'none') ||
//         (panelToShow === 'chat' && chatPanel.style.display !== 'none'))) {
//         // If clicking the same button that opened the current panel, close it
//         closeSidePanel();
//     } else {
//         // Open the panel or switch tabs
//         showTab(panelToShow);
//         sidePanel.classList.add('open');
//         sidePanel.classList.remove('translate-x-full'); // Tailwind class to slide in
//     }
// }


// function closeSidePanel() {
//     sidePanel.classList.remove('open');
//     sidePanel.classList.add('translate-x-full'); // Tailwind class to slide out
// }

// function showTab(tabName) {
//     if (tabName === 'participants') {
//         participantsPanel.style.display = 'flex';
//         chatPanel.style.display = 'none';
//         showParticipantsTab.classList.add('border-indigo-500', 'text-white');
//         showParticipantsTab.classList.remove('border-transparent', 'text-gray-400');
//         showChatTab.classList.add('border-transparent', 'text-gray-400');
//         showChatTab.classList.remove('border-indigo-500', 'text-white');
//     } else { // chat
//         participantsPanel.style.display = 'none';
//         chatPanel.style.display = 'flex';
//         showChatTab.classList.add('border-indigo-500', 'text-white');
//         showChatTab.classList.remove('border-transparent', 'text-gray-400');
//         showParticipantsTab.classList.add('border-transparent', 'text-gray-400');
//         showParticipantsTab.classList.remove('border-indigo-500', 'text-white');
//         // Scroll chat to bottom when opened
//         chatMessages.scrollTop = chatMessages.scrollHeight;
//     }
// }

// // --- CHAT ---
// function handleChatInputKeydown(e) {
//     if (e.key === 'Enter' && !e.shiftKey) {
//         e.preventDefault(); // Prevent newline
//         sendChatMessage();
//     }
// }

// function sendChatMessage() {
//     const message = chatInput.value.trim();
//     if (message && ws && ws.readyState === WebSocket.OPEN) {
//         sendMessage({ type: 'chat_message', message });
//         chatInput.value = ''; // Clear input after sending
//     }
// }

// function displayChatMessage(username, message, timestamp, isLocal) {
//     const messageDiv = document.createElement('div');
//     messageDiv.classList.add('chat-message', isLocal ? 'local' : 'remote', 'flex', 'flex-col', isLocal ? 'items-end' : 'items-start');

//     const senderInfo = document.createElement('div');
//     senderInfo.className = 'sender-info';
//     senderInfo.innerText = `${isLocal ? 'You' : username} - ${timestamp}`;

//     const messageBubble = document.createElement('div');
//     messageBubble.className = 'message-bubble';
//     messageBubble.innerText = message; // Use innerText to prevent HTML injection

//     messageDiv.appendChild(senderInfo);
//     messageDiv.appendChild(messageBubble);

//     chatMessages.appendChild(messageDiv);
//     // Scroll to the bottom to show the latest message
//     chatMessages.scrollTop = chatMessages.scrollHeight;

//     // Optional: Show notification badge if chat panel is closed
//     if(sidePanel.classList.contains('translate-x-full')) {
//         // Add a visual indicator to the chat button
//     }
// }


// // --- UTILITY FUNCTIONS ---
// function sendMessage(message) {
//     if (ws && ws.readyState === WebSocket.OPEN) {
//         ws.send(JSON.stringify(message));
//     } else {
//         console.error("Cannot send message, WebSocket is not open.");
//         // Handle error, maybe try reconnecting or alert user
//     }
// }

// function showShareModal(roomId) {
//     modalRoomId.innerText = roomId.toUpperCase();
//     copyStatus.innerText = ''; // Clear previous copy status
//     shareModal.classList.remove('hidden');
// }

// function copyRoomId() {
//     if (!myRoomId) return;
//     navigator.clipboard.writeText(myRoomId).then(() => {
//          // Maybe show a temporary confirmation near the button
//         const originalText = copyRoomIdBtnTop.innerHTML;
//         copyRoomIdBtnTop.innerHTML = '<i class="fas fa-check text-green-400"></i> Copied';
//         setTimeout(() => { copyRoomIdBtnTop.innerHTML = originalText; }, 2000);
//     }).catch(err => console.error('Failed to copy Room ID:', err));
// }


// function copyRoomIdFromModal() {
//      if (!myRoomId) return;
//      navigator.clipboard.writeText(myRoomId).then(() => {
//          copyStatus.innerText = 'Room ID copied to clipboard!';
//          setTimeout(() => { copyStatus.innerText = ''; }, 2500); // Clear message after a delay
//      }).catch(err => {
//           copyStatus.innerText = 'Failed to copy!';
//           console.error('Failed to copy Room ID from modal:', err)
//      });
// }

// function showLoading(message = "Loading...") {
//     if(loadingIndicator) {
//         loadingIndicator.querySelector('p').innerText = message;
//         loadingIndicator.classList.remove('hidden');
//     }
//      console.log("Loading:", message); // Also log to console
// }

// function hideLoading() {
//      if(loadingIndicator) {
//         loadingIndicator.classList.add('hidden');
//     }
//      console.log("Loading finished.");
// }

// function showLandingPage() {
//      meetingRoom.classList.add('hidden');
//      meetingRoom.classList.remove('flex');
//      landingPage.style.display = 'flex'; // Use flex for centering
//      // Clear input fields maybe?
//      roomIdInput.value = '';
//      // usernameInput.value = ''; // Keep username?
//      landingError.innerText = ''; // Clear errors
// }


// // --- START ---
// document.addEventListener('DOMContentLoaded', init);



// frontend/main.js
const ws = new WebSocket("wss://webrtc-meeting-server.onrender.com"); // change this URL
let localStream;
let peers = {};
let clientId, roomId, isAdmin, adminToken;
let pcConfig = { iceServers: [] };

async function getIceServers() {
  try {
    const res = await fetch("wss://webrtc-meeting-server.onrender.com");
    const data = await res.json();
    pcConfig.iceServers = data.iceServers;
    console.log("ICE servers:", pcConfig.iceServers);
  } catch (err) {
    console.error("Failed to load ICE servers", err);
    pcConfig.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

async function init() {
  await getIceServers();
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  document.getElementById("localVideo").srcObject = localStream;
}

ws.onmessage = async (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "your_info":
      clientId = data.clientId;
      isAdmin = data.isAdmin || false;
      adminToken = data.adminToken;
      if (isAdmin) console.log("You are admin:", adminToken);
      break;

    case "room_created":
      roomId = data.roomId;
      isAdmin = true;
      adminToken = data.adminToken;
      document.getElementById("roomDisplay").innerText = `Room: ${roomId}`;
      alert(`Room created! Share this code: ${roomId}`);
      break;

    case "joined_room":
      roomId = data.roomId;
      document.getElementById("roomDisplay").innerText = `Joined Room: ${roomId}`;
      break;

    case "peer_joined":
      createOffer(data.clientId);
      break;

    case "offer":
      handleOffer(data);
      break;

    case "answer":
      handleAnswer(data);
      break;

    case "candidate":
      if (peers[data.from]) {
        peers[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
      }
      break;

    case "meeting_ended":
      alert("Meeting ended by admin");
      location.reload();
      break;

    case "peer_left":
      if (peers[data.clientId]) {
        peers[data.clientId].close();
        delete peers[data.clientId];
      }
      break;
  }
};

function createRoom() {
  ws.send(JSON.stringify({ type: "create_room" }));
}

function joinRoom() {
  const id = prompt("Enter room ID:");
  ws.send(JSON.stringify({ type: "join_room", roomId: id }));
}

function endMeeting() {
  if (isAdmin) {
    ws.send(JSON.stringify({ type: "end_meeting", adminToken }));
  } else {
    alert("Only admin can end the meeting.");
  }
}

async function createOffer(targetId) {
  const pc = new RTCPeerConnection(pcConfig);
  peers[targetId] = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(
        JSON.stringify({
          type: "candidate",
          target: targetId,
          candidate: e.candidate
        })
      );
    }
  };

  pc.ontrack = (e) => {
    const remoteVideo = document.createElement("video");
    remoteVideo.srcObject = e.streams[0];
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    document.getElementById("remoteVideos").appendChild(remoteVideo);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: "offer", target: targetId, offer }));
}

async function handleOffer(data) {
  const pc = new RTCPeerConnection(pcConfig);
  peers[data.from] = pc;

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(
        JSON.stringify({
          type: "candidate",
          target: data.from,
          candidate: e.candidate
        })
      );
    }
  };

  pc.ontrack = (e) => {
    const remoteVideo = document.createElement("video");
    remoteVideo.srcObject = e.streams[0];
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    document.getElementById("remoteVideos").appendChild(remoteVideo);
  };

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  ws.send(JSON.stringify({ type: "answer", target: data.from, answer }));
}

async function handleAnswer(data) {
  await peers[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
}

window.onload = init;
