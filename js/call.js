import { db, auth } from "./firebase-config.js";
import { collection, doc, setDoc, addDoc, onSnapshot, updateDoc, deleteDoc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { showToast, openModal, closeModal } from "./toast.js";
import { isGlobalMuted, updateUserActivity } from "./chat.js";

const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };

let pc = null;
let localStream = null;
let currentCallDocId = null;
let unsubscribeCall = null;
let unsubscribeIncoming = null;
let unsubscribeGlobalListener = null;
let timerInterval = null;
let isCaller = false;
let currentUser = null;

const callInterface = document.getElementById('callInterface');
const callStatusText = document.getElementById('callStatusText');
const callTimer = document.getElementById('callTimer');
const hangupBtn = document.getElementById('hangupBtn');
const muteBtn = document.getElementById('muteBtn');
const muteIcon = document.getElementById('muteIcon');
const remoteAudio = document.getElementById('remoteAudio');

const localCallAvatar = document.getElementById('localCallAvatar');
const remoteCallAvatar = document.getElementById('remoteCallAvatar');
const localAvatarWrapper = document.getElementById('localAvatarWrapper');
const remoteAvatarWrapper = document.getElementById('remoteAvatarWrapper');
const remoteAvatarLabel = document.getElementById('remoteAvatarLabel');

const incomingCallModal = document.getElementById('incomingCallModal');
const incomingCallerName = document.getElementById('incomingCallerName');
const incomingAvatarImg = document.getElementById('incomingAvatarImg');
const answerCallBtn = document.getElementById('answerCallBtn');
const rejectCallBtn = document.getElementById('rejectCallBtn');

const soundRingtone = document.getElementById('soundRingtone');
const soundConnecting = document.getElementById('soundConnecting');

function playSound(type) { stopSounds(); if (type === 'ringtone') soundRingtone.play().catch(()=>{}); if (type === 'connecting') soundConnecting.play().catch(()=>{}); }
function stopSounds() { soundRingtone.pause(); soundRingtone.currentTime = 0; soundConnecting.pause(); soundConnecting.currentTime = 0; }

onAuthStateChanged(auth, (user) => { if (user) { currentUser = user; initGlobalCallListener(); } else { if (unsubscribeGlobalListener) unsubscribeGlobalListener(); } });

function initGlobalCallListener() {
    if (unsubscribeGlobalListener) unsubscribeGlobalListener();
    const q = query(collection(db, "calls"), where("responderId", "==", currentUser.uid), where("status", "==", "offer"));
    unsubscribeGlobalListener = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const callData = change.doc.data();
                if (!currentCallDocId) { showIncomingCall(change.doc.id, callData); }
            }
        });
    });
}

function resetMuteState() {
    muteBtn.classList.remove('active');
    muteIcon.textContent = 'mic';
    localAvatarWrapper.classList.remove('muted');
}

export async function startCall(target, isGroup = false) {
    if (currentCallDocId) return showToast("Вы уже в звонке", "error");
    if (isGroup) return showToast("Групповые звонки пока в разработке", "info");

    isCaller = true; currentCallDocId = await createCallDoc(target);
    resetMuteState();
    
    callInterface.style.display = 'flex';
    localCallAvatar.src = currentUser.photoURL; remoteCallAvatar.src = target.photoURL; remoteAvatarLabel.textContent = target.displayName;
    callStatusText.textContent = "Соединение..."; callTimer.style.display = "none";
    updateUserActivity("Звонит..."); playSound('connecting');

    await initWebRTC();
}

export function checkCallVisibility(chatId) { if (currentCallDocId && callInterface.style.display !== 'flex') callInterface.style.display = 'flex'; }

async function createCallDoc(target) {
    const callDocRef = doc(collection(db, "calls"));
    await setDoc(callDocRef, { callerId: currentUser.uid, callerName: currentUser.displayName, callerPhoto: currentUser.photoURL, responderId: target.uid, status: 'offer' });
    return callDocRef.id;
}

async function initWebRTC() {
    pc = new RTCPeerConnection(servers);
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => { track.enabled = true; pc.addTrack(track, localStream); });
    
    setupVoiceActivity(localStream, localAvatarWrapper);

    pc.ontrack = (event) => { event.streams[0].getTracks().forEach(track => { remoteAudio.srcObject = event.streams[0]; setupVoiceActivity(event.streams[0], remoteAvatarWrapper); }); };
    pc.onicecandidate = (event) => { if (event.candidate && currentCallDocId) { const collectionName = isCaller ? 'offerCandidates' : 'answerCandidates'; addDoc(collection(db, "calls", currentCallDocId, collectionName), event.candidate.toJSON()); } };

    const callDocRef = doc(db, "calls", currentCallDocId);

    if (isCaller) {
        const offerDescription = await pc.createOffer();
        await pc.setLocalDescription(offerDescription);
        await updateDoc(callDocRef, { offer: { type: offerDescription.type, sdp: offerDescription.sdp } });

        unsubscribeCall = onSnapshot(callDocRef, (snapshot) => {
            const data = snapshot.data();
            if (!pc.currentRemoteDescription && data?.answer) {
                const answerDescription = new RTCSessionDescription(data.answer);
                pc.setRemoteDescription(answerDescription);
                callStatusText.textContent = "00:00"; startTimer(); stopSounds();
            }
            if (data?.status === 'hungup') endCall();
        });

        onSnapshot(collection(db, "calls", currentCallDocId, "answerCandidates"), (snapshot) => {
            snapshot.docChanges().forEach((change) => { if (change.type === "added") { const candidate = new RTCIceCandidate(change.doc.data()); pc.addIceCandidate(candidate); } });
        });
    }
}

async function answerCall(callId, callData) {
    if (currentCallDocId) return; 
    currentCallDocId = callId; isCaller = false; resetMuteState();
    
    callInterface.style.display = 'flex';
    localCallAvatar.src = currentUser.photoURL; remoteCallAvatar.src = callData.callerPhoto; remoteAvatarLabel.textContent = callData.callerName;
    callStatusText.textContent = "Соединение..."; callTimer.style.display = "none"; updateUserActivity("В звонке"); stopSounds();

    pc = new RTCPeerConnection(servers);
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => { track.enabled = true; pc.addTrack(track, localStream); });
    setupVoiceActivity(localStream, localAvatarWrapper);

    pc.ontrack = (event) => { event.streams[0].getTracks().forEach(track => { remoteAudio.srcObject = event.streams[0]; setupVoiceActivity(event.streams[0], remoteAvatarWrapper); }); };
    pc.onicecandidate = (event) => { if (event.candidate) { addDoc(collection(db, "calls", currentCallDocId, "answerCandidates"), event.candidate.toJSON()); } };

    const callDocRef = doc(db, "calls", currentCallDocId);
    const callSnap = await getDoc(callDocRef);
    const callDataDB = callSnap.data();

    await pc.setRemoteDescription(new RTCSessionDescription(callDataDB.offer));
    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    await updateDoc(callDocRef, { answer: { type: answerDescription.type, sdp: answerDescription.sdp }, status: 'connected' });
    callStatusText.textContent = "00:00"; startTimer();

    onSnapshot(collection(db, "calls", currentCallDocId, "offerCandidates"), (snapshot) => {
        snapshot.docChanges().forEach((change) => { if (change.type === "added") { const candidate = new RTCIceCandidate(change.doc.data()); pc.addIceCandidate(candidate); } });
    });
    
    unsubscribeCall = onSnapshot(callDocRef, (snapshot) => { const data = snapshot.data(); if (data?.status === 'hungup') endCall(); });
}

function endCall() {
    stopSounds();
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
    if (unsubscribeCall) { unsubscribeCall(); unsubscribeCall = null; }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    
    callInterface.style.display = 'none'; callStatusText.textContent = ""; updateUserActivity("В сети");

    if (currentCallDocId) { try { const callDocRef = doc(db, "calls", currentCallDocId); updateDoc(callDocRef, { status: 'hungup' }); } catch(e) {} currentCallDocId = null; }
}

function showIncomingCall(callId, callData) {
    playSound('ringtone');
    incomingCallerName.textContent = callData.groupName ? `Группа: ${callData.groupName}\nОт: ${callData.callerName}` : `Звонок от: ${callData.callerName}`;
    incomingAvatarImg.src = callData.callerPhoto;
    openModal('incomingCallModal'); 
    
    unsubscribeIncoming = onSnapshot(doc(db, "calls", callId), (snapshot) => {
        const data = snapshot.data();
        if (!data || data.status === 'hungup' || (data.status === 'connected' && data.responderId !== currentUser.uid && data.callerId !== currentUser.uid)) {
            stopSounds(); closeModal('incomingCallModal'); if (unsubscribeIncoming) unsubscribeIncoming();
            if (data && data.status === 'hungup') showToast("Звонок отменен", "info"); else if (data) showToast("На звонок уже ответили", "info");
        }
    });
    
    answerCallBtn.onclick = () => { if (unsubscribeIncoming) unsubscribeIncoming(); answerCall(callId, callData); closeModal('incomingCallModal'); };
    rejectCallBtn.onclick = () => { if (unsubscribeIncoming) unsubscribeIncoming(); stopSounds(); closeModal('incomingCallModal'); updateDoc(doc(db, "calls", callId), { status: 'hungup' }); };
}

hangupBtn.onclick = endCall;

muteBtn.onclick = () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        muteBtn.classList.toggle('active');
        if (audioTrack.enabled) { muteIcon.textContent = 'mic'; localAvatarWrapper.classList.remove('muted'); } 
        else { muteIcon.textContent = 'mic_off'; localAvatarWrapper.classList.add('muted'); }
    }
};

let seconds = 0;
function startTimer() {
    callTimer.style.display = "block"; seconds = 0; callTimer.textContent = "00:00";
    timerInterval = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
}

function setupVoiceActivity(stream, wrapperElement) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);

    let isSpeaking = false;
    let silenceTimer = null;

    javascriptNode.onaudioprocess = () => {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        let values = 0;
        const length = array.length;
        for (let i = 0; i < length; i++) { values += array[i]; }
        const average = values / length;

        if (average > 15) { 
            if (!isSpeaking) {
                isSpeaking = true;
                wrapperElement.classList.add('speaking');
                if(silenceTimer) clearTimeout(silenceTimer);
            }
        } else {
            if (isSpeaking) {
                if(!silenceTimer) {
                    silenceTimer = setTimeout(() => {
                        wrapperElement.classList.remove('speaking');
                        isSpeaking = false;
                        silenceTimer = null;
                    }, 300); 
                }
            }
        }
    };
}