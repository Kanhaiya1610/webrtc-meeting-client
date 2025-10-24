// main.js

// --- CONFIGURATION ---
// IMPORTANT: Replace this with your actual Render server URL
const SIGNALING_SERVER_URL = 'wss://webrtc-meeting-server.onrender.com';

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // For production, you MUST add a TURN server here for reliability
        // {
        //     urls: 'turn:your-turn-server.com:3478',
        //     username: 'user',
        //     credential: 'password'
        // }
    ]
};

// --- DOM ELEMENTS ---
const landingPage = document.getElementById('landing-page');
const meetingRoom = document.getElementById('meeting-room');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdInput = document.getElementById('roomIdInput');
const videoGrid = document.getElementById('video-grid');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const participantsList = document.getElementById('participants-list');
const muteSelfBtn = document.getElementById('muteSelfBtn');
const leaveMeetingBtn = document.getElementById('leaveMeetingBtn');
const endMeetingBtn = document.getElementById('endMeetingBtn');

// --- APP STATE ---
let localStream;
let myClientId;
let myRoomId;
let isAdmin = false;
let isMuted = false;
const peerConnections = new Map();
const ws = new WebSocket(SIGNALING_SERVER_URL);

// --- WEBSOCKET EVENT HANDLERS ---
ws.onmessage = async (message) => {
    const data = JSON.parse(message.data);
    switch (data.type) {
        case 'room_created':
            myRoomId = data.roomId;
            myClientId = data.clientId;
            isAdmin = true;
            await setupMeetingRoom();
            break;
        case 'existing_participants':
            myRoomId = data.roomId;
            myClientId = data.clientId;
            await setupMeetingRoom();
            data.participants.forEach(clientId => createPeerConnection(clientId, true));
            break;
        case 'peer_joined':
            createPeerConnection(data.clientId, false);
            break;
        case 'offer':
            const pcOffer = peerConnections.get(data.fromId);
            if (pcOffer) {
                await pcOffer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await pcOffer.createAnswer();
                await pcOffer.setLocalDescription(answer);
                ws.send(JSON.stringify({ type: 'answer', sdp: pcOffer.localDescription, targetId: data.fromId }));
            }
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

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    addVideoStream(myClientId, localStream, true);

    if (isAdmin) {
        endMeetingBtn.style.display = 'block';
    }
    updateParticipantsList();
}

function createPeerConnection(targetId, isOfferer) {
    const pc = new RTCPeerConnection(configuration);
    peerConnections.set(targetId, pc);

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => addVideoStream(targetId, event.streams[0]);
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

// --- UI & EVENT LISTENERS ---
createRoomBtn.onclick = () => ws.send(JSON.stringify({ type: 'create_room' }));
joinRoomBtn.onclick = () => {
    const roomId = roomIdInput.value.toUpperCase();
    if (roomId) {
        ws.send(JSON.stringify({ type: 'join_room', roomId }));
    }
};

muteSelfBtn.onclick = () => {
    isMuted = !isMuted;
    localStream.getAudioTracks()[0].enabled = !isMuted;
    muteSelfBtn.innerText = isMuted ? 'Unmute Self' : 'Mute Self';
};

leaveMeetingBtn.onclick = () => window.location.reload();
endMeetingBtn.onclick = () => ws.close();

// --- HELPER FUNCTIONS ---
function addVideoStream(clientId, stream, isLocal = false) {
    if (document.getElementById(`video-container-${clientId}`)) return;

    const container = document.createElement('div');
    container.id = `video-container-${clientId}`;
    container.className = 'relative';

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;

    const nameTag = document.createElement('div');
    nameTag.className = 'absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm';
    nameTag.innerText = clientId === myClientId ? `You (${clientId})` : clientId;

    container.appendChild(video);
    container.appendChild(nameTag);
    videoGrid.appendChild(container);
}

function removePeer(clientId) {
    peerConnections.get(clientId)?.close();
    peerConnections.delete(clientId);
    document.getElementById(`video-container-${clientId}`)?.remove();
    updateParticipantsList();
}

function updateParticipantsList() {
    participantsList.innerHTML = '';
    const participants = [myClientId, ...Array.from(peerConnections.keys())];
    participants.forEach(id => {
        const p = document.createElement('div');
        p.className = 'bg-gray-700 p-2 rounded';
        p.innerText = id;
        participantsList.appendChild(p);
    });
}