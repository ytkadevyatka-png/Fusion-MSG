import { db, auth } from "./firebase-config.js";
import { collection, addDoc, onSnapshot, doc, updateDoc, serverTimestamp, query, where, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast } from "./toast.js"; 

const servers = {
    iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};
const rtcConfig = { offerToReceiveAudio: true, offerToReceiveVideo: false };

let pc = null;
let localStream = null;
let callDocId = null;
let unsubscribes = [];
let callTimerInterval = null;
let candidatesQueue = []; 

let activeChatId = null;
let activeChatType = null;
let connectionStartTime = null;
let isCaller = false; // Добавлено для логики мьюта

let audioContext = null;
let localAnalyser = null;
let remoteAnalyser = null;
let voiceLoop = null;

// UI Elements
const callOverlay = document.getElementById('callOverlay');
const remoteAudio = document.getElementById('remoteAudio');
const callStatusText = document.getElementById('callStatusText');
const callTimer = document.getElementById('callTimer');

// Avatars
const remoteAvatarContainer = document.getElementById('remoteAvatarContainer');
const remoteAvatarImg = document.getElementById('remoteAvatarImg');
const remoteName = document.getElementById('remoteName');
const remoteVoiceIndicator = document.getElementById('remoteVoiceIndicator');
const localAvatarImg = document.getElementById('localAvatarImg');
const localVoiceIndicator = document.getElementById('localVoiceIndicator');

// Buttons
const hangupBtn = document.getElementById('hangupBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const answerCallBtn = document.getElementById('answerCallBtn');
const declineCallBtn = document.getElementById('declineCallBtn');
const incomingCallControls = document.getElementById('incomingCallControls');
const callControlsRow = document.querySelector('.call-controls-row');

const DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/847/847969.png";

// === DRAG & DROP ===
function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = element.querySelector('.call-overlay-header');
    
    if (header) {
        header.onmousedown = dragMouseDown;
        // Добавляем поддержку тача для мобильных
        header.ontouchstart = dragMouseDown;
    }

    function dragMouseDown(e) {
        e = e || window.event;
        // e.preventDefault(); 
        
        // Определяем координаты (мышь или тач)
        if(e.type === 'touchstart') {
            pos3 = e.touches[0].clientX;
            pos4 = e.touches[0].clientY;
        } else {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
        }

        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
        document.ontouchend = closeDragElement;
        document.ontouchmove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        
        let clientX, clientY;
        if(e.type === 'touchmove') {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            e.preventDefault();
            clientX = e.clientX;
            clientY = e.clientY;
        }

        pos1 = pos3 - clientX;
        pos2 = pos4 - clientY;
        pos3 = clientX;
        pos4 = clientY;

        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
        element.style.right = 'auto';
        element.style.bottom = 'auto';
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        document.ontouchend = null;
        document.ontouchmove = null;
    }
}
if(callOverlay) makeDraggable(callOverlay);


// === INIT ===
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

// === START CALL ===
export async function startCall(targetUserId, targetUserName, targetUserPhoto, chatId, chatType) {
    if (!targetUserId) return;
    resetCallState();
    isCaller = true; // Мы звоним
    
    activeChatId = chatId; activeChatType = chatType;

    if(callOverlay) {
        callOverlay.classList.remove('hidden');
        callOverlay.classList.remove('minimized');
        callOverlay.style.top = ''; callOverlay.style.left = ''; callOverlay.style.right = '30px'; callOverlay.style.bottom = '30px';
    }
    
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
        callerMuted: false, // Изначально включен
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

        // Следим за состоянием мьюта собеседника (мы caller, значит смотрим calleeMuted)
        if (data.calleeMuted !== undefined) {
             toggleRemoteMuteIcon(data.calleeMuted);
        }

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
                handleIceCandidate(candidate);
            }
        });
    });
    unsubscribes.push(candUnsub);
}

// === INCOMING CALL ===
function showIncomingCall(id, data) {
    resetCallState();
    callDocId = id;
    isCaller = false; // Нам звонят
    
    activeChatId = data.chatId || null;
    activeChatType = data.chatType || 'direct';

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

// === ACCEPT CALL ===
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
            if(callOverlay) callOverlay.classList.add('hidden');
            return;
        }
        
        const freshData = callDocSnap.data();
        await pc.setRemoteDescription(new RTCSessionDescription(freshData.offer));
        
        const answerDescription = await pc.createAnswer(rtcConfig);
        await pc.setLocalDescription(answerDescription);

        await updateDoc(doc(db, "calls", id), { 
            answer: { type: answerDescription.type, sdp: answerDescription.sdp },
            calleeMuted: false // Изначально включен
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

        // Слушаем изменения звонка (мьют собеседника)
        const muteUnsub = onSnapshot(doc(db, "calls", id), (snap) => {
            const d = snap.data();
            if (d && d.callerMuted !== undefined) {
                toggleRemoteMuteIcon(d.callerMuted);
            }
        });
        unsubscribes.push(muteUnsub);

        processCandidateQueue();

    } catch (err) {
        showToast("Ошибка: " + err.message, "error");
    }
}

// === WEBRTC ===
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
        if (event.streams && event.streams[0]) {
            if(remoteAudio) {
                remoteAudio.srcObject = event.streams[0];
                remoteAudio.play().catch(e => console.log("Autoplay:", e));
            }
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
    const threshold = 20; 

    // Локальный
    if (localAnalyser && localVoiceIndicator) {
        localAnalyser.getByteFrequencyData(dataArray);
        const vol = dataArray.reduce((a, b) => a + b) / dataArray.length;
        if (vol > threshold) localVoiceIndicator.classList.add('speaking');
        else localVoiceIndicator.classList.remove('speaking');
    }

    // Удаленный
    if (remoteAnalyser && remoteVoiceIndicator) {
        remoteAnalyser.getByteFrequencyData(dataArray);
        const vol = dataArray.reduce((a, b) => a + b) / dataArray.length;
        if (vol > threshold) remoteVoiceIndicator.classList.add('speaking');
        else remoteVoiceIndicator.classList.remove('speaking');
    }

    voiceLoop = requestAnimationFrame(visualizeVoice);
}

// === UI UPDATES ===
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
    showToast("Ошибка микрофона. Проверьте HTTPS.", "error");
    if(callOverlay) callOverlay.classList.add('hidden');
}

function resetCallState() {
    callDocId = null; candidatesQueue = [];
    connectionStartTime = null; 
    
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (pc) { pc.close(); pc = null; }
    
    if (toggleMicBtn) {
        toggleMicBtn.classList.remove('btn-red');
        toggleMicBtn.innerHTML = '<span class="material-symbols-outlined">mic</span>';
    }

    // Сброс иконки мьюта
    if (remoteAvatarContainer) remoteAvatarContainer.classList.remove('muted');
    
    if (voiceLoop) { cancelAnimationFrame(voiceLoop); voiceLoop = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
}

if(hangupBtn) {
    hangupBtn.addEventListener('click', async () => {
        await sendCallEndMessage();
        if (callDocId) await updateDoc(doc(db, "calls", callDocId), { endedAt: serverTimestamp() });
        endCallLocally();
    });
}

// === ИСПРАВЛЕНИЕ: Логика микрофона и синхронизация ===
if(toggleMicBtn) {
    toggleMicBtn.onclick = async () => {
        // Если стрима нет, пробуем найти его
        let streamToMute = localStream;
        if (!streamToMute && pc) {
            const senders = pc.getSenders();
            const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
            if (audioSender) streamToMute = new MediaStream([audioSender.track]);
        }

        if (!streamToMute) return;

        const audioTrack = streamToMute.getAudioTracks()[0];
        if (audioTrack) {
            // Переключаем локально
            audioTrack.enabled = !audioTrack.enabled;
            const isMuted = !audioTrack.enabled;
            
            // UI
            if (isMuted) {
                toggleMicBtn.classList.add('btn-red');
                toggleMicBtn.innerHTML = '<span class="material-symbols-outlined">mic_off</span>';
            } else {
                toggleMicBtn.classList.remove('btn-red');
                toggleMicBtn.innerHTML = '<span class="material-symbols-outlined">mic</span>';
            }

            // Отправляем состояние собеседнику
            if (callDocId) {
                const updateField = isCaller ? { callerMuted: isMuted } : { calleeMuted: isMuted };
                try {
                    await updateDoc(doc(db, "calls", callDocId), updateField);
                } catch(e) { console.error("Error syncing mute:", e); }
            }
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
            text: `Звонок был завершен в ${timeString}. Длительность звонка: ${durationText}`,
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
    if(remoteAudio) remoteAudio.srcObject = null;
    if(remoteAvatarContainer) remoteAvatarContainer.classList.remove('ringing');
    
    if(callOverlay) {
        callOverlay.classList.add('hidden');
        callOverlay.classList.remove('minimized');
    }
    
    activeChatId = null;
    activeChatType = null;
}