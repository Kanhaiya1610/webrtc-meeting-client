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


// frontend/main.js - revised and synced with your backend

// ======== Configuration ========
const WS_URL = "wss://webrtc-meeting-server.onrender.com";      // <--- update to your Render URL
const ICE_ENDPOINT = "https://webrtc-meeting-server.onrender.com/ice"; // <--- update to your Render URL
const GOOGLE_CLIENT_ID = "173379398027-i3h11rufg14tpde9rhutp0uvt3imos3k.apps.googleusercontent.com";// <--- set this
// ===== CONFIGURATION =====
// ===== STATE =====
let googleUser = null;
let ws = null;
let localStream = null;
let clientId = null;
let roomId = null;
let isAdmin = false;
let adminToken = null;
let isMuted = false;
let isCameraOff = false;
let peers = {}; // { clientId: { pc, username } }
let pcConfig = { iceServers: [] };
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let unreadMessages = 0;
let isInMeeting = false;

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
    
    // Update UI
    document.getElementById('authStatus').classList.add('hidden');
    document.getElementById('gSignInDiv').style.display = 'none';
    
    const afterAuth = document.getElementById('afterAuth');
    afterAuth.classList.remove('hidden');
    
    // Set user info
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

// ===== ICE SERVER CONFIGURATION =====
async function loadIceServers() {
  try {
    const res = await fetch(ICE_ENDPOINT);
    const data = await res.json();
    pcConfig.iceServers = data.iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
    console.log('Loaded ICE servers:', pcConfig.iceServers);
  } catch (err) {
    console.warn('Failed to fetch ICE servers, using defaults', err);
    pcConfig.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
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
    console.log('WebSocket connected');
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
    console.error('WebSocket error:', err);
    updateConnectionStatus(false);
  };
  
  ws.onclose = () => {
    console.log('WebSocket closed');
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
  console.log('Received:', data.type);
  
  switch (data.type) {
    case 'your_info':
      clientId = data.clientId;
      isAdmin = !!data.isAdmin;
      adminToken = data.adminToken || adminToken;
      
      if (data.roomId) {
        roomId = data.roomId;
        updateRoomDisplay();
      }
      
      if (isAdmin) {
        document.getElementById('endMeetingBtn').classList.remove('hidden');
        document.getElementById('muteAllBtn').classList.remove('hidden');
      }
      break;
      
    case 'room_created':
      roomId = data.roomId;
      updateRoomDisplay();
      showToast(`Room created: ${roomId}`, 'success');
      break;
      
    case 'room_state':
      // Existing participants in the room
      for (const p of data.participants) {
        if (p.clientId !== clientId) {
          addParticipantToList(p.clientId, p.username);
          await createOffer(p.clientId, p.username);
        }
      }
      break;
      
    case 'peer_joined':
      showToast(`${data.username} joined`, 'info');
      addParticipantToList(data.clientId, data.username);
      if (roomId) {
        await createOffer(data.clientId, data.username);
      }
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
      if (data.targetClientId === clientId && data.muteState) {
        isMuted = true;
        if (localStream) {
          localStream.getAudioTracks().forEach(t => t.enabled = false);
        }
        updateMicButton();
        showToast('You were muted by the host', 'info');
      }
      break;
      
    case 'new_chat_message':
      displayChatMessage(data.fromUsername, data.message, data.timestamp, data.fromClientId === clientId);
      break;
      
    case 'peer_left':
      removePeer(data.clientId);
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
  if (localStream) return;
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    addVideoElement(clientId, localStream, true, googleUser.name);
    console.log('Local stream setup complete');
  } catch (err) {
    console.error('getUserMedia failed:', err);
    showToast('Could not access camera/microphone', 'error');
    throw err;
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
      </div>
    `;
    
    wrapper.appendChild(video);
    wrapper.appendChild(overlay);
    
    document.getElementById('videoGrid').appendChild(wrapper);
  } else {
    const video = wrapper.querySelector('video');
    video.srcObject = stream;
  }
  
  updateVideoGrid();
}

function updateVideoGrid() {
  const grid = document.getElementById('videoGrid');
  const count = grid.children.length;
  grid.setAttribute('data-count', count);
}

function removeVideoElement(id) {
  const wrapper = document.getElementById(`video-${id}`);
  if (wrapper) {
    wrapper.remove();
    updateVideoGrid();
  }
}

// ===== WEBRTC PEER CONNECTION =====
function createPeerConnection(id, username) {
  if (peers[id]) {
    return peers[id].pc;
  }
  
  const pc = new RTCPeerConnection(pcConfig);
  peers[id] = { pc, username };
  
  // Add local tracks
  if (localStream) {
    for (const track of localStream.getTracks()) {
      try {
        pc.addTrack(track, localStream);
      } catch (e) {
        console.warn('Failed to add track:', e);
      }
    }
  }
  
  // Handle incoming tracks
  pc.ontrack = (event) => {
    console.log('Received track from', id);
    if (event.streams && event.streams[0]) {
      addVideoElement(id, event.streams[0], false, username);
    }
  };
  
  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingMessage({
        type: 'ice_candidate',
        candidate: event.candidate,
        targetClientId: id
      });
    }
  };
  
  // Handle connection state
  pc.oniceconnectionstatechange = () => {
    console.log(`ICE connection state for ${id}:`, pc.iceConnectionState);
    
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      showToast(`Connected to ${username}`, 'success');
    } else if (pc.iceConnectionState === 'failed') {
      console.error('Connection failed for', id);
      // Attempt ICE restart
      if (pc.restartIce) {
        pc.restartIce();
      }
    }
  };
  
  pc.onconnectionstatechange = () => {
    console.log(`Connection state for ${id}:`, pc.connectionState);
  };
  
  return pc;
}

async function createOffer(targetId, targetUsername) {
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
    
    console.log('Sent offer to', targetId);
  } catch (err) {
    console.error('Failed to create offer:', err);
  }
}

async function handleOffer(fromId, fromUsername, sdp) {
  const pc = createPeerConnection(fromId, fromUsername);
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    sendSignalingMessage({
      type: 'answer',
      sdp: pc.localDescription,
      targetClientId: fromId
    });
    
    console.log('Sent answer to', fromId);
  } catch (err) {
    console.error('Failed to handle offer:', err);
  }
}

async function handleAnswer(fromId, sdp) {
  const peer = peers[fromId];
  if (!peer) {
    console.warn('Received answer from unknown peer:', fromId);
    return;
  }
  
  try {
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    console.log('Set remote description for', fromId);
  } catch (err) {
    console.error('Failed to set remote description:', err);
  }
}

async function handleIceCandidate(fromId, candidate) {
  const peer = peers[fromId];
  if (!peer) {
    console.warn('Received ICE candidate from unknown peer:', fromId);
    return;
  }
  
  try {
    await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('Failed to add ICE candidate:', err);
  }
}

// ===== MEDIA CONTROLS =====
function toggleMic() {
  if (!localStream) return;
  
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
  } else {
    icon.className = 'fas fa-microphone';
    btn.classList.remove('active');
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

// ===== PARTICIPANTS PANEL =====
function addParticipantToList(id, username) {
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
      </div>
      ${isAdmin && id !== clientId ? `
        <div class="participant-controls">
          <button class="btn-icon" onclick="toggleParticipantMute('${id}')" title="Mute/Unmute">
            <i class="fas fa-microphone"></i>
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

// ===== ADMIN CONTROLS =====
function toggleParticipantMute(targetId) {
  if (!isAdmin) return;
  
  sendSignalingMessage({
    type: 'admin_control',
    action: 'mute_toggle',
    targetClientId: targetId,
    muteState: true,
    adminToken
  });
}

function muteAll() {
  if (!isAdmin) return;
  
  if (confirm('Mute all participants?')) {
    sendSignalingMessage({
      type: 'admin_control',
      action: 'mute_all',
      adminToken
    });
    showToast('All participants muted', 'success');
  }
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
  
  // Update unread badge if chat is closed
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

// Auto-resize chat input
document.addEventListener('DOMContentLoaded', () => {
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
});

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
  // Update tabs
  document.getElementById('participantsTab').classList.toggle('active', tab === 'participants');
  document.getElementById('chatTab').classList.toggle('active', tab === 'chat');
  
  // Update panels
  document.getElementById('participantsPanel').classList.toggle('hidden', tab !== 'participants');
  document.getElementById('chatPanel').classList.toggle('hidden', tab !== 'chat');
  
  if (tab === 'chat') {
    unreadMessages = 0;
    updateChatBadge();
    
    // Scroll to bottom of chat
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// ===== UI TRANSITIONS =====
function showMeetingRoom() {
  document.getElementById('landingPage').classList.add('hidden');
  document.getElementById('meetingRoom').classList.remove('hidden');
  isInMeeting = true;
  
  // Add self to participants list
  if (clientId && googleUser) {
    addParticipantToList(clientId, googleUser.name);
  }
}

function showLandingPage() {
  document.getElementById('meetingRoom').classList.add('hidden');
  document.getElementById('landingPage').classList.remove('hidden');
  isInMeeting = false;
}

// ===== CLEANUP & LEAVE =====
function removePeer(id) {
  console.log('Removing peer:', id);
  
  // Close peer connection
  if (peers[id]) {
    try {
      peers[id].pc.close();
    } catch (e) {
      console.error('Error closing peer connection:', e);
    }
    delete peers[id];
  }
  
  // Remove video element
  removeVideoElement(id);
  
  // Remove from participants list
  removeParticipantFromList(id);
}

function leaveMeeting() {
  if (!confirm('Leave the meeting?')) return;
  
  // Close all peer connections
  Object.keys(peers).forEach(id => {
    try {
      peers[id].pc.close();
    } catch (e) {
      console.error('Error closing peer:', e);
    }
  });
  peers = {};
  
  // Stop local media tracks
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
  
  // Clear video grid
  const videoGrid = document.getElementById('videoGrid');
  if (videoGrid) {
    videoGrid.innerHTML = '';
  }
  
  // Clear participants list
  const participantsList = document.getElementById('participantsList');
  if (participantsList) {
    participantsList.innerHTML = '';
  }
  
  // Clear chat
  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) {
    chatMessages.innerHTML = '';
  }
  
  // Reset state
  clientId = null;
  roomId = null;
  isAdmin = false;
  adminToken = null;
  isMuted = false;
  isCameraOff = false;
  unreadMessages = 0;
  isInMeeting = false;
  
  // Close WebSocket
  if (ws) {
    try {
      ws.close();
    } catch (e) {
      console.error('Error closing WebSocket:', e);
    }
    ws = null;
  }
  
  // Return to landing page
  showLandingPage();
  showToast('Left the meeting', 'info');
  
  // Reconnect WebSocket for next meeting
  setTimeout(() => {
    initWebSocket();
  }, 1000);
}

// ===== HELPER: SEND SIGNALING MESSAGE =====
function sendSignalingMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    console.error('WebSocket not connected');
    showToast('Connection lost. Please refresh.', 'error');
  }
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Initializing app...');
  
  // Load ICE servers
  await loadIceServers();
  
  // Initialize Google Sign-In
  try {
    initGoogleSignIn();
  } catch (e) {
    console.warn('Google Sign-In initialization failed:', e);
  }
  
  // Connect to signaling server
  initWebSocket();
  
  // Handle Enter key on room input
  const roomInput = document.getElementById('roomIdInput');
  if (roomInput) {
    roomInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        joinRoomPrompt();
      }
    });
    
    // Auto-uppercase room code
    roomInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
  }
  
  // Close side panel on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const panel = document.getElementById('sidePanel');
      if (panel.classList.contains('open')) {
        closeSidePanel();
      }
    }
  });
  
  // Prevent accidental page reload
  window.addEventListener('beforeunload', (e) => {
    if (isInMeeting) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
  
  // Handle visibility change for quality optimization
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('Page hidden - could reduce quality');
    } else {
      console.log('Page visible - restore quality');
    }
  });
  
  console.log('App initialized successfully');
});

// ===== EXPOSE FUNCTIONS TO WINDOW =====
window.createRoom = createRoom;
window.joinRoomPrompt = joinRoomPrompt;
window.copyRoomId = copyRoomId;
window.toggleMic = toggleMic;
window.toggleCamera = toggleCamera;
window.leaveMeeting = leaveMeeting;
window.endMeeting = endMeeting;
window.toggleSidePanel = toggleSidePanel;
window.closeSidePanel = closeSidePanel;
window.showPanelTab = showPanelTab;
window.sendChatMessage = sendChatMessage;
window.toggleParticipantMute = toggleParticipantMute;
window.muteAll = muteAll;