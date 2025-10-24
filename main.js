

// main.js - V2: The complete client-side application

// --- CONFIGURATION ---
const SIGNALING_SERVER_URL = 'wss://webrtc-meeting-server.onrender.com'; // IMPORTANT: PASTE YOUR RENDER URL

const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// --- DOM ELEMENTS ---
const landingPage = document.getElementById('landing-page');
const meetingRoom = document.getElementById('meeting-room');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdInput = document.getElementById('roomIdInput');
const usernameInput = document.getElementById('usernameInput');
const videoGrid = document.getElementById('video-grid');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const participantsList = document.getElementById('participants-list');
const participantCount = document.getElementById('participant-count');
const muteSelfBtn = document.getElementById('muteSelfBtn');
const leaveMeetingBtn = document.getElementById('leaveMeetingBtn');
const endMeetingBtn = document.getElementById('endMeetingBtn');
const sidePanel = document.getElementById('side-panel');
const toggleParticipantsBtn = document.getElementById('toggleParticipantsBtn');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const participantsPanel = document.getElementById('participants-panel');
const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const shareModal = document.getElementById('share-modal');
const modalRoomId = document.getElementById('modalRoomId');
const copyRoomIdBtn = document.getElementById('copyRoomIdBtn');
const closeModalBtn = document.getElementById('closeModalBtn');


// --- APP STATE ---
let localStream, myClientId, myRoomId, myUsername, adminToken, isAdmin = false, isMuted = false;
const peerConnections = new Map();
const ws = new WebSocket(SIGNALING_SERVER_URL);

// --- WEBSOCKET EVENT HANDLERS ---
ws.onmessage = async (message) => {
    const data = JSON.parse(message.data);
    switch (data.type) {
        case 'room_created':
            myRoomId = data.roomId;
            myClientId = data.clientId;
            adminToken = data.adminToken;
            isAdmin = true;
            await setupMeetingRoom();
            showShareModal(myRoomId);
            break;
        case 'existing_participants':
            myRoomId = data.roomId;
            myClientId = data.clientId;
            isAdmin = data.isAdmin;
            await setupMeetingRoom();
            data.participants.forEach(clientId => createPeerConnection(clientId, true));
            break;
        case 'peer_joined':
            createPeerConnection(data.clientId, false);
            break;
        case 'offer':
            await handleOffer(data.fromId, data.sdp);
            break;
        case 'answer':
            await peerConnections.get(data.fromId)?.setRemoteDescription(new RTCSessionDescription(data.sdp));
            break;
        case 'ice_candidate':
            await peerConnections.get(data.fromId)?.addIceCandidate(new RTCIceCandidate(data.candidate));
            break;
        case 'peer_left':
            removePeer(data.clientId);
            break;
        case 'force_mute':
            handleAdminMute(data.targetId);
            break;
        case 'new_chat_message':
            displayChatMessage(data.from, data.message, data.timestamp);
            break;
        case 'meeting_ended':
            alert("The meeting has been ended by the host.");
            window.location.reload();
            break;
        case 'error':
            alert(data.message);
            break;
    }
};

// --- CORE FUNCTIONS ---
async function setupMeetingRoom() {
    landingPage.style.display = 'none';
    meetingRoom.style.display = 'block';
    roomIdDisplay.innerText = myRoomId;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        addVideoStream(myClientId, localStream, true, myUsername);
    } catch (err) {
        console.error("Error getting user media:", err);
        alert("Could not access camera or microphone. Please check permissions and try again.");
    }

    if (isAdmin) {
        endMeetingBtn.style.display = 'block';
    }
}

function createPeerConnection(targetId, isOfferer) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections.set(targetId, pc);

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => addVideoStream(targetId, event.streams[0], false, targetId);
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'ice_candidate', candidate: event.candidate, targetId }));
        }
    };
    
    if (isOfferer) {
        pc.createOffer().then(offer => pc.setLocalDescription(offer))
        .then(() => {
            ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription, targetId }));
        });
    }
    updateParticipantsList();
}

async function handleOffer(fromId, sdp) {
    const pc = createPeerConnection(fromId, false);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription, targetId: fromId }));
}

// --- UI & EVENT LISTENERS ---
function checkUsername() {
    myUsername = usernameInput.value.trim();
    if (!myUsername) {
        alert("Please enter your name.");
        return false;
    }
    return true;
}

createRoomBtn.onclick = () => {
    if (checkUsername()) {
        ws.send(JSON.stringify({ type: 'create_room', username: myUsername }));
    }
};

joinRoomBtn.onclick = () => {
    if (checkUsername()) {
        const roomId = roomIdInput.value.toUpperCase();
        if (roomId) {
            ws.send(JSON.stringify({ type: 'join_room', roomId, username: myUsername }));
        }
    }
};

muteSelfBtn.onclick = () => {
    isMuted = !isMuted;
    localStream.getAudioTracks()[0].enabled = !isMuted;
    muteSelfBtn.innerText = isMuted ? 'Unmute' : 'Mute';
    muteSelfBtn.classList.toggle('bg-red-600', isMuted);
    muteSelfBtn.classList.toggle('bg-yellow-600', !isMuted);
};

leaveMeetingBtn.onclick = () => window.location.reload();
endMeetingBtn.onclick = () => {
    if (isAdmin) {
        ws.send(JSON.stringify({ type: 'end_meeting', roomId: myRoomId, adminToken }));
    }
};

toggleParticipantsBtn.onclick = () => {
    chatPanel.style.display = 'none';
    participantsPanel.style.display = 'flex';
    sidePanel.classList.toggle('translate-x-full');
};

toggleChatBtn.onclick = () => {
    participantsPanel.style.display = 'none';
    chatPanel.style.display = 'flex';
    sidePanel.classList.toggle('translate-x-full');
};

chatInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message) {
            ws.send(JSON.stringify({ type: 'chat_message', message }));
            chatInput.value = '';
        }
    }
};

copyRoomIdBtn.onclick = () => {
    navigator.clipboard.writeText(myRoomId).then(() => {
        copyRoomIdBtn.innerText = 'Copied!';
        setTimeout(() => { copyRoomIdBtn.innerText = 'Copy'; }, 2000);
    });
};

closeModalBtn.onclick = () => {
    shareModal.style.display = 'none';
};

// --- HELPER FUNCTIONS ---
function addVideoStream(clientId, stream, isLocal = false, username) {
    if (document.getElementById(`video-container-${clientId}`)) return;

    const container = document.createElement('div');
    container.id = `video-container-${clientId}`;
    container.className = 'video-container';

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;

    const nameTag = document.createElement('div');
    nameTag.className = 'video-name-tag';
    nameTag.innerText = isLocal ? `You (${username})` : username;
    
    container.appendChild(video);
    container.appendChild(nameTag);
    videoGrid.appendChild(container);

    updateParticipantsList();
}

function removePeer(clientId) {
    const videoContainer = document.getElementById(`video-container-${clientId}`);
    if (videoContainer) {
        videoContainer.remove();
    }
    peerConnections.get(clientId)?.close();
    peerConnections.delete(clientId);
    updateParticipantsList();
}

function updateParticipantsList() {
    participantsList.innerHTML = '';
    
    const displayedClients = Array.from(videoGrid.children).map(container => {
        return container.id.substring('video-container-'.length);
    });

    participantCount.innerText = displayedClients.length;
    
    displayedClients.forEach(id => {
        const pDiv = document.createElement('div');
        pDiv.className = 'flex items-center justify-between bg-gray-700 p-2 rounded';
        
        const nameTag = document.querySelector(`#video-container-${id} .video-name-tag`);
        pDiv.innerText = nameTag ? nameTag.innerText : id;
        
        participantsList.appendChild(pDiv);
    });
}

function displayChatMessage(from, message, timestamp) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'mb-2';
    const senderName = from === myUsername ? 'You' : from;
    msgDiv.innerHTML = `<p class="text-gray-400 text-xs">${senderName} - ${timestamp}</p><p class="bg-gray-700 p-2 rounded-lg inline-block">${message}</p>`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function handleAdminMute(targetId) {
    if (targetId === myUsername) {
        isMuted = true;
        localStream.getAudioTracks()[0].enabled = false;
        muteSelfBtn.innerText = 'Unmute';
        muteSelfBtn.classList.add('bg-red-600');
        muteSelfBtn.classList.remove('bg-yellow-600');
        alert("The host has muted you.");
    }
}

function showShareModal(roomId) {
    modalRoomId.innerText = roomId;
    shareModal.style.display = 'flex';
}