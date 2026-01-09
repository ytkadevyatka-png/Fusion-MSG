import { db, auth } from "./firebase-config.js";
import { collection, addDoc, onSnapshot, doc, updateDoc, serverTimestamp, query, where, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast } from "./toast.js"; 

const servers = {
    iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};
// Включаем видео
const rtcConfig = { offerToReceiveAudio: true, offerToReceiveVideo: true };

let pc = null;
let localStream = null;
let callDocId = null;
let unsubscribes = [];
let callTimerInterval = null;
let candidatesQueue = []; 

let activeChatId = null;
let activeChatType = null;
let connectionStartTime = null;
let isCaller = false; 

// Элементы
const callOverlay = document.getElementById('callOverlay');
const remoteAudio = document.getElementById('remoteAudio');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const callStatusText = document.getElementById('callStatusText');
const callTimer = document.getElementById('callTimer');
const soundRing = document.getElementById('soundRing');

// Аватары/Индикаторы
const remoteAvatarContainer = document.getElementById('remoteAvatarContainer');
const remoteAvatarImg = document.getElementById('remoteAvatarImg');
const remoteName = document.getElementById('remoteName');
const localAvatarImg = document.getElementById('localAvatarImg');

// Кнопки
const hangupBtn = document.getElementById('hangupBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn'); // Новая кнопка
const answerCallBtn = document.getElementById('answerCallBtn');
const declineCallBtn = document.getElementById('declineCallBtn');
const incomingCallControls = document.getElementById('incomingCallControls');
const callControlsRow = document.querySelector('.call-controls-row');

const DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/847/847969.png";

export function initCallSystem() {
    auth.onAuthStateChanged((user) => {
        if (!user) return;
        unsubscribes.forEach(u => u());
        unsubscribes = [];
        
        const q = query(collection(db, "calls"), where("calleeId", "==", user.uid));
        const unsub = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    const now = Date.now();
                    const created = data.createdAt ? data.createdAt.toMillis() : now;
                    if (!data.answer && !data.endedAt && (now - created < 300000)) {
                        showIncomingCall(change.doc.id, data);
                    }
                }
            });
        });
        unsubscribes.push(unsub);
    });
}

export async function startCall(targetUserId, targetUserName, targetUserPhoto, chatId, chatType) {
    if (!targetUserId) return;
    resetCallState();
    isCaller = true; 
    
    activeChatId = chatId; activeChatType = chatType;

    if(callOverlay) {
        callOverlay.classList.remove('hidden');
        callOverlay.classList.remove('minimized');
    }
    
    updateUIState('dialing', { displayName: targetUserName, photoURL: targetUserPhoto });

    try {
        // Запрашиваем Видео
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if(localVideo) {
            localVideo.srcObject = localStream;
            localVideo.classList.remove('hidden');
        }
    } catch (e) {
        // Если камеры нет или отказ - пробуем только аудио
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        } catch(err) {
            handleMediaError(err);
            return;
        }
    }

    createPC();
    
    const callDocRef = await addDoc(collection(db, "calls"), {
        callerId: auth.currentUser.uid,
        callerName: auth.currentUser.displayName,
        callerPhoto: auth.currentUser.photoURL,
        calleeId: targetUserId,
        createdAt: serverTimestamp(),
        chatId: chatId,
        chatType: chatType
    });
    callDocId = callDocRef.id;

    pc.onicecandidate = (event) => {
        if (event.candidate) addDoc(collection(db, "calls", callDocId, "offerCandidates"), event.candidate.toJSON());
    };

    const offerDescription = await pc.createOffer(rtcConfig);
    await pc.setLocalDescription(offerDescription);
    await updateDoc(callDocRef, { offer: { sdp: offerDescription.sdp, type: offerDescription.type } });

    const callUnsub = onSnapshot(callDocRef, async (snapshot) => {
        const data = snapshot.data();
        if (!pc || !data) return;

        // Синхронизация мьюта
        if (data.calleeMuted !== undefined) toggleRemoteMuteIcon(data.calleeMuted);

        if (!pc.currentRemoteDescription && data.answer) {
            updateUIState('connecting'); 
            const answerDescription = new RTCSessionDescription(data.answer);
            await pc.setRemoteDescription(answerDescription);
            processCandidateQueue();
        }
        
        if (data.endedAt) endCallLocally("Звонок завершен собеседником");
    });
    unsubscribes.push(callUnsub);

    const candUnsub = onSnapshot(collection(db, "calls", callDocId, "answerCandidates"), (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === "added") {
                const candidate = new RTCIceCandidate(change.doc.data());
                if (pc) pc.addIceCandidate(candidate).catch(e => console.warn(e));
                else candidatesQueue.push(candidate);
            }
        });
    });
    unsubscribes.push(candUnsub);
}

function showIncomingCall(id, data) {
    resetCallState();
    callDocId = id;
    isCaller = false; 
    activeChatId = data.chatId || null;
    activeChatType = data.chatType || 'direct';

    // Играем рингтон
    if(soundRing) soundRing.play().catch(()=>{});

    if(callOverlay) {
        callOverlay.classList.remove('hidden');
        callOverlay.classList.remove('minimized');
    }
    
    updateUIState('incoming', { displayName: data.callerName, photoURL: data.callerPhoto });

    if(answerCallBtn) answerCallBtn.onclick = () => acceptCall(id);
    if(declineCallBtn) declineCallBtn.onclick = async () => {
        await updateDoc(doc(db, "calls", id), { endedAt: serverTimestamp() });
        endCallLocally("Вы отклонили звонок");
    };

    const callUnsub = onSnapshot(doc(db, "calls", id), (snap) => {
        const d = snap.data();
        if(d?.endedAt) endCallLocally("Звонок отменен");
    });
    unsubscribes.push(callUnsub);
}

async function acceptCall(id) {
    if(soundRing) { soundRing.pause(); soundRing.currentTime = 0; }
    updateUIState('connecting');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if(localVideo) {
            localVideo.srcObject = localStream;
            localVideo.classList.remove('hidden');
        }
    } catch (e) {
        try { localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); } 
        catch(err) { handleMediaError(err); return; }
    }

    createPC();

    pc.onicecandidate = (event) => {
        if (event.candidate) addDoc(collection(db, "calls", id, "answerCandidates"), event.candidate.toJSON());
    };

    try {
        const callDocSnap = await getDoc(doc(db, "calls", id));
        if (!callDocSnap.exists()) {
            showToast("Звонок не найден", "error");
            if(callOverlay) callOverlay.classList.add('hidden');
            return;
        }
        
        const freshData = callDocSnap.data();
        await pc.setRemoteDescription(new RTCSessionDescription(freshData.offer));
        
        const answerDescription = await pc.createAnswer(rtcConfig);
        await pc.setLocalDescription(answerDescription);

        await updateDoc(doc(db, "calls", id), { 
            answer: { type: answerDescription.type, sdp: answerDescription.sdp }
        });

        const candUnsub = onSnapshot(collection(db, "calls", id, "offerCandidates"), (snap) => {
            snap.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    if(pc) pc.addIceCandidate(candidate).catch(console.warn);
                    else candidatesQueue.push(candidate);
                }
            });
        });
        unsubscribes.push(candUnsub);

        const muteUnsub = onSnapshot(doc(db, "calls", id), (snap) => {
            const d = snap.data();
            if (d && d.callerMuted !== undefined) toggleRemoteMuteIcon(d.callerMuted);
        });
        unsubscribes.push(muteUnsub);

        processCandidateQueue();

    } catch (err) {
        showToast("Ошибка: " + err.message, "error");
    }
}

function createPC() {
    pc = new RTCPeerConnection(servers);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
            updateUIState('connected');
            connectionStartTime = Date.now(); 
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            endCallLocally("Связь прервалась");
        }
    };

    pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream) {
            // Аудио
            if(remoteAudio) {
                remoteAudio.srcObject = stream;
                remoteAudio.play().catch(console.log);
            }
            // Видео
            if(remoteVideo) {
                remoteVideo.srcObject = stream;
                // Проверяем, есть ли видео-трек
                if(stream.getVideoTracks().length > 0) {
                    remoteVideo.classList.remove('hidden');
                    remoteAvatarImg.style.display = 'none'; // Скрываем аватарку
                } else {
                    remoteVideo.classList.add('hidden');
                    remoteAvatarImg.style.display = 'block';
                }
            }
        }
    };
}

function processCandidateQueue() {
    if (!pc || !pc.remoteDescription) return;
    while (candidatesQueue.length > 0) {
        const c = candidatesQueue.shift();
        pc.addIceCandidate(c).catch(console.warn);
    }
}

function updateUIState(state, userData = {}) {
    if(remoteAvatarContainer) remoteAvatarContainer.classList.remove('ringing');
    
    if (userData.photoURL && remoteAvatarImg) remoteAvatarImg.src = userData.photoURL;
    else if (remoteAvatarImg && !remoteAvatarImg.src) remoteAvatarImg.src = DEFAULT_AVATAR;

    if(auth.currentUser && localAvatarImg) localAvatarImg.src = auth.currentUser.photoURL || DEFAULT_AVATAR;
    if(remoteName) remoteName.textContent = userData.displayName || "Собеседник";

    if (state === 'dialing') {
        if(callStatusText) callStatusText.textContent = "Вызов...";
        if(remoteAvatarContainer) remoteAvatarContainer.classList.add('ringing'); 
        if(incomingCallControls) incomingCallControls.style.display = 'none';
        if(callControlsRow) callControlsRow.style.display = 'flex';
    } 
    else if (state === 'incoming') {
        if(callStatusText) callStatusText.textContent = "Входящий...";
        if(remoteAvatarContainer) remoteAvatarContainer.classList.add('ringing'); 
        if(incomingCallControls) incomingCallControls.style.display = 'flex';
        if(callControlsRow) callControlsRow.style.display = 'none'; 
    }
    else if (state === 'connecting') {
        if(callStatusText) callStatusText.textContent = "Соединение...";
        if(incomingCallControls) incomingCallControls.style.display = 'none';
        if(callControlsRow) callControlsRow.style.display = 'flex';
    }
    else if (state === 'connected') {
        if(callStatusText) callStatusText.textContent = "В разговоре";
        startTimer();
    }
}

function startTimer() {
    let seconds = 0;
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        if(callTimer) callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
}

function handleMediaError(e) {
    showToast("Ошибка устройств: " + e.message, "error");
    if(callOverlay) callOverlay.classList.add('hidden');
}

function resetCallState() {
    callDocId = null; candidatesQueue = [];
    connectionStartTime = null; 
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (pc) { pc.close(); pc = null; }
    
    if(localVideo) { localVideo.srcObject = null; localVideo.classList.add('hidden'); }
    if(remoteVideo) { remoteVideo.srcObject = null; remoteVideo.classList.add('hidden'); }
    if(remoteAvatarImg) remoteAvatarImg.style.display = 'block';

    if (toggleMicBtn) toggleMicBtn.classList.remove('btn-red');
    if (toggleCamBtn) toggleCamBtn.classList.remove('btn-red'); // Сброс камеры
    if (remoteAvatarContainer) remoteAvatarContainer.classList.remove('muted');
    
    if(soundRing) { soundRing.pause(); soundRing.currentTime = 0; }
}

if(hangupBtn) {
    hangupBtn.addEventListener('click', async () => {
        await sendCallEndMessage();
        if (callDocId) await updateDoc(doc(db, "calls", callDocId), { endedAt: serverTimestamp() });
        endCallLocally();
    });
}

// УПРАВЛЕНИЕ МИКРОФОНОМ
if(toggleMicBtn) {
    toggleMicBtn.onclick = async () => {
        if (!localStream) return;
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const isMuted = !audioTrack.enabled;
            
            toggleMicBtn.classList.toggle('btn-red', isMuted);
            toggleMicBtn.innerHTML = isMuted ? '<span class="material-symbols-outlined">mic_off</span>' : '<span class="material-symbols-outlined">mic</span>';

            if (callDocId) {
                const updateField = isCaller ? { callerMuted: isMuted } : { calleeMuted: isMuted };
                updateDoc(doc(db, "calls", callDocId), updateField).catch(console.error);
            }
        }
    };
}

// УПРАВЛЕНИЕ КАМЕРОЙ (НОВОЕ)
if(toggleCamBtn) {
    toggleCamBtn.onclick = () => {
        if (!localStream) return;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const isOff = !videoTrack.enabled;
            
            toggleCamBtn.classList.toggle('btn-red', isOff);
            toggleCamBtn.innerHTML = isOff ? '<span class="material-symbols-outlined">videocam_off</span>' : '<span class="material-symbols-outlined">videocam</span>';
            
            // Локально скрываем видео, если выключили
            if(isOff) localVideo.classList.add('hidden');
            else localVideo.classList.remove('hidden');
        }
    };
}

function toggleRemoteMuteIcon(isMuted) {
    if (remoteAvatarContainer) {
        if (isMuted) remoteAvatarContainer.classList.add('muted');
        else remoteAvatarContainer.classList.remove('muted');
    }
}

async function sendCallEndMessage() {
    if (!activeChatId || !auth.currentUser) return;
    
    let durationText = "00:00";
    if (connectionStartTime) {
        const diff = Date.now() - connectionStartTime;
        const totalSeconds = Math.floor(diff / 1000);
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        durationText = `${m}:${s}`;
    }

    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const collectionName = activeChatType === 'direct' ? 'chats' : 'groups';
    
    try {
        await addDoc(collection(db, collectionName, activeChatId, "messages"), {
            text: `Звонок завершен (${durationText})`,
            type: 'system',
            timestamp: serverTimestamp()
        });
    } catch (e) { console.error("Msg error:", e); }
}

function endCallLocally(msg) {
    if (msg) showToast(msg, "info");
    resetCallState();
    
    if (unsubscribes.length > 1) {
        for (let i = 1; i < unsubscribes.length; i++) unsubscribes[i]();
        unsubscribes.splice(1);
    }
    
    if (callTimerInterval) clearInterval(callTimerInterval);
    if(remoteAudio) remoteAudio.srcObject = null;
    if(remoteAvatarContainer) remoteAvatarContainer.classList.remove('ringing');
    
    if(callOverlay) {
        callOverlay.classList.add('hidden');
        callOverlay.classList.remove('minimized');
    }
    
    activeChatId = null;
    activeChatType = null;
}