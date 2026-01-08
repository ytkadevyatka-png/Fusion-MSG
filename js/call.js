import { db, auth } from "./firebase-config.js";
import { collection, addDoc, onSnapshot, doc, updateDoc, serverTimestamp, query, where, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast, openModal, closeModal } from "./toast.js";

// Серверы
const servers = {
    iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' } 
    ]
};

const rtcConfig = { offerToReceiveAudio: true, offerToReceiveVideo: false };

let pc = null;
let localStream = null;
let callDocId = null;
let unsubscribes = [];
let callTimerInterval = null;
let candidatesQueue = []; 

// Время и ID чата
let connectionStartTime = null;
let activeChatId = null;
let activeChatType = null;

// Audio
let audioContext = null;
let localAnalyser = null;
let remoteAnalyser = null;
let voiceLoop = null;

// UI
const remoteAudio = document.getElementById('remoteAudio');
const callStatusText = document.getElementById('callStatusText');
const callTimer = document.getElementById('callTimer');

// Buttons
const hangupBtn = document.getElementById('hangupBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const answerCallBtn = document.getElementById('answerCallBtn');
const declineCallBtn = document.getElementById('declineCallBtn');
const incomingCallControls = document.getElementById('incomingCallControls');
const callControls = document.querySelector('.call-controls');

// Avatars
const remoteAvatarImg = document.getElementById('remoteAvatarImg');
const remoteAvatarContainer = document.getElementById('remoteAvatarContainer');
const remoteName = document.getElementById('remoteName');
const remoteVoiceIndicator = document.getElementById('remoteVoiceIndicator');
const remoteMuteIcon = document.getElementById('remoteMuteIcon');

const localAvatarImg = document.getElementById('localAvatarImg');
const localVoiceIndicator = document.getElementById('localVoiceIndicator');
const localMuteIcon = document.getElementById('localMuteIcon');

const DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/847/847969.png";

// === 1. ИНИЦИАЛИЗАЦИЯ ===
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

// === 2. ИСХОДЯЩИЙ ЗВОНОК ===
export async function startCall(targetUserId, targetUserName, targetUserPhoto, chatId, chatType) {
    if (!targetUserId) return;
    resetCallState();
    
    activeChatId = chatId;
    activeChatType = chatType;

    openModal('callModal');
    updateUIState('dialing', { displayName: targetUserName, photoURL: targetUserPhoto });

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setupAudioAnalysis(localStream, 'local'); 
    } catch (e) {
        handleMediaError(e);
        return;
    }

    createPC();
    
    const callDocRef = await addDoc(collection(db, "calls"), {
        callerId: auth.currentUser.uid,
        callerName: auth.currentUser.displayName,
        callerPhoto: auth.currentUser.photoURL,
        calleeId: targetUserId,
        createdAt: serverTimestamp(),
        callerMuted: false,
        calleeMuted: false,
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

        if (!pc.currentRemoteDescription && data.answer) {
            updateUIState('connecting'); 
            const answerDescription = new RTCSessionDescription(data.answer);
            await pc.setRemoteDescription(answerDescription);
            processCandidateQueue();
        }
        
        if (data.calleeMuted !== undefined) updateRemoteMuteUI(data.calleeMuted);
        if (data.endedAt) endCallLocally("Звонок завершен");
    });
    unsubscribes.push(callUnsub);

    const candUnsub = onSnapshot(collection(db, "calls", callDocId, "answerCandidates"), (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === "added") {
                const candidate = new RTCIceCandidate(change.doc.data());
                handleIceCandidate(candidate);
            }
        });
    });
    unsubscribes.push(candUnsub);
}

// === 3. ВХОДЯЩИЙ ЗВОНОК ===
function showIncomingCall(id, data) {
    resetCallState();
    callDocId = id;
    
    activeChatId = data.chatId || null;
    activeChatType = data.chatType || 'direct';

    openModal('callModal');
    updateUIState('incoming', { displayName: data.callerName, photoURL: data.callerPhoto });

    answerCallBtn.onclick = () => acceptCall(id);
    
    declineCallBtn.onclick = async () => {
        await updateDoc(doc(db, "calls", id), { endedAt: serverTimestamp() });
        closeModal('callModal');
    };

    const callUnsub = onSnapshot(doc(db, "calls", id), (snap) => {
        const d = snap.data();
        if(d?.endedAt) endCallLocally("Звонок отменен");
        if (d?.callerMuted !== undefined) updateRemoteMuteUI(d.callerMuted);
    });
    unsubscribes.push(callUnsub);
}

// === 4. ПРИНЯТИЕ ===
async function acceptCall(id) {
    updateUIState('connecting');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setupAudioAnalysis(localStream, 'local');
    } catch (e) {
        handleMediaError(e);
        return;
    }

    createPC();

    pc.onicecandidate = (event) => {
        if (event.candidate) addDoc(collection(db, "calls", id, "answerCandidates"), event.candidate.toJSON());
    };

    try {
        const callDocSnap = await getDoc(doc(db, "calls", id));
        if (!callDocSnap.exists()) {
            showToast("Звонок не найден", "error");
            closeModal('callModal');
            return;
        }
        
        const freshData = callDocSnap.data();
        if (!freshData.offer) {
            showToast("Ошибка данных звонка", "error");
            return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(freshData.offer));
        
        const answerDescription = await pc.createAnswer(rtcConfig);
        await pc.setLocalDescription(answerDescription);

        await updateDoc(doc(db, "calls", id), { 
            answer: { type: answerDescription.type, sdp: answerDescription.sdp },
            calleeMuted: false
        });

        const candUnsub = onSnapshot(collection(db, "calls", id, "offerCandidates"), (snap) => {
            snap.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    handleIceCandidate(candidate);
                }
            });
        });
        unsubscribes.push(candUnsub);
        
        processCandidateQueue();

    } catch (err) {
        console.error("Accept Error:", err);
        showToast("Ошибка: " + err.message, "error");
    }
}

// === 5. WEBRTC CORE ===

function createPC() {
    pc = new RTCPeerConnection(servers);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.onconnectionstatechange = () => {
        console.log("WebRTC State:", pc.connectionState);
        if (pc.connectionState === 'connected') {
            updateUIState('connected');
            connectionStartTime = Date.now();
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            endCallLocally("Связь прервалась");
        }
    };

    pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play().catch(e => console.log("Autoplay:", e));
            setupAudioAnalysis(event.streams[0], 'remote');
        }
    };
}

function handleIceCandidate(candidate) {
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        pc.addIceCandidate(candidate).catch(e => console.warn("ICE add error:", e));
    } else {
        candidatesQueue.push(candidate);
    }
}

function processCandidateQueue() {
    if (!pc || !pc.remoteDescription) return;
    while (candidatesQueue.length > 0) {
        const c = candidatesQueue.shift();
        pc.addIceCandidate(c).catch(e => console.warn("Queue ICE error:", e));
    }
}

// === AUDIO VISUALIZER ===
function setupAudioAnalysis(stream, source) {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();

    const src = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);

    if (source === 'local') localAnalyser = analyser;
    else remoteAnalyser = analyser;

    if (!voiceLoop) voiceLoop = requestAnimationFrame(visualizeVoice);
}

function visualizeVoice() {
    const dataArray = new Uint8Array(128);
    const threshold = 12; 

    if (localAnalyser) {
        localAnalyser.getByteFrequencyData(dataArray);
        const vol = dataArray.reduce((a, b) => a + b) / dataArray.length;
        if (vol > threshold) localVoiceIndicator.classList.add('speaking');
        else localVoiceIndicator.classList.remove('speaking');
    }

    if (remoteAnalyser) {
        remoteAnalyser.getByteFrequencyData(dataArray);
        const vol = dataArray.reduce((a, b) => a + b) / dataArray.length;
        if (vol > threshold) remoteVoiceIndicator.classList.add('speaking');
        else remoteVoiceIndicator.classList.remove('speaking');
    }

    voiceLoop = requestAnimationFrame(visualizeVoice);
}

// === UI & ACTIONS ===
toggleMicBtn.addEventListener('click', async () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const isMuted = !audioTrack.enabled;
        
        toggleMicBtn.classList.toggle('active');
        toggleMicBtn.innerHTML = isMuted ? '<span class="material-symbols-outlined">mic_off</span>' : '<span class="material-symbols-outlined">mic</span>';
        
        if (isMuted) localMuteIcon.classList.remove('hidden');
        else localMuteIcon.classList.add('hidden');

        if (callDocId) {
            const snap = await getDoc(doc(db, "calls", callDocId));
            if (snap.exists()) {
                const data = snap.data();
                if (data.callerId === auth.currentUser.uid) updateDoc(doc(db, "calls", callDocId), { callerMuted: isMuted });
                else updateDoc(doc(db, "calls", callDocId), { calleeMuted: isMuted });
            }
        }
    }
});

function updateRemoteMuteUI(isMuted) {
    if (isMuted) remoteMuteIcon.classList.remove('hidden');
    else remoteMuteIcon.classList.add('hidden');
}

function updateUIState(state, userData = {}) {
    remoteAvatarContainer.classList.remove('ringing');
    
    if (userData.photoURL) remoteAvatarImg.src = userData.photoURL;
    else if (!remoteAvatarImg.src) remoteAvatarImg.src = DEFAULT_AVATAR;
    
    localAvatarImg.src = auth.currentUser.photoURL || DEFAULT_AVATAR;

    if (state === 'dialing') {
        callStatusText.textContent = "Вызов...";
        remoteAvatarContainer.classList.add('ringing'); 
        incomingCallControls.style.display = 'none';
        callControls.style.display = 'flex';
        remoteName.textContent = userData.displayName || "Пользователь";
    } 
    else if (state === 'incoming') {
        callStatusText.textContent = "Входящий звонок";
        remoteAvatarContainer.classList.add('ringing'); 
        incomingCallControls.style.display = 'flex';
        callControls.style.display = 'none';
        remoteName.textContent = userData.displayName || "Неизвестный";
    }
    else if (state === 'connecting') {
        callStatusText.textContent = "Соединение...";
        incomingCallControls.style.display = 'none';
        callControls.style.display = 'flex';
    }
    else if (state === 'connected') {
        callStatusText.textContent = "Разговор идет";
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
        callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
}

function handleMediaError(e) {
    console.error(e);
    showToast("Ошибка микрофона. Проверьте HTTPS.", "error");
    closeModal('callModal');
}

function resetCallState() {
    callDocId = null;
    candidatesQueue = [];
    connectionStartTime = null; 
    
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (pc) { pc.close(); pc = null; }
    
    toggleMicBtn.classList.remove('active');
    toggleMicBtn.innerHTML = '<span class="material-symbols-outlined">mic</span>';
    localMuteIcon.classList.add('hidden');
    remoteMuteIcon.classList.add('hidden');
    localVoiceIndicator.classList.remove('speaking');
    remoteVoiceIndicator.classList.remove('speaking');
    
    if (voiceLoop) {
        cancelAnimationFrame(voiceLoop);
        voiceLoop = null; // [ИСПРАВЛЕНИЕ] Обнуляем ID анимации
    }
    if (audioContext) { audioContext.close(); audioContext = null; }
}

hangupBtn.addEventListener('click', async () => {
    await sendCallEndMessage();
    if (callDocId) await updateDoc(doc(db, "calls", callDocId), { endedAt: serverTimestamp() });
    endCallLocally();
});

// Отправка сообщения о завершении
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

    // [НОВОЕ] Форматирование времени окончания
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const collectionName = activeChatType === 'direct' ? 'chats' : 'groups';
    const text = `Звонок завершен в ${timeString}. Длительность: ${durationText}`;

    try {
        await addDoc(collection(db, collectionName, activeChatId, "messages"), {
            text: text,
            type: 'system',
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error("Msg error:", e);
    }
}

function endCallLocally(msg) {
    if (msg) showToast(msg, "info");
    resetCallState();
    
    if (unsubscribes.length > 1) {
        for (let i = 1; i < unsubscribes.length; i++) unsubscribes[i]();
        unsubscribes.splice(1);
    }
    
    if (callTimerInterval) clearInterval(callTimerInterval);
    remoteAudio.srcObject = null;
    remoteAvatarContainer.classList.remove('ringing');
    closeModal('callModal');
}