import { db, auth } from "./firebase-config.js";
import { collection, doc, setDoc, addDoc, onSnapshot, updateDoc, deleteDoc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { showToast, openModal, closeModal } from "./toast.js";
import { isGlobalMuted, updateUserActivity } from "./chat.js";

const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };

let pc = null;
let localStream = null;
let currentCallDocId = null;
let activeCallTargetId = null; 
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
const remoteAvatarLabel = document.getElementById('remoteAvatarLabel');
const localAvatarWrapper = document.getElementById('localAvatarWrapper');
const remoteAvatarWrapper = document.getElementById('remoteAvatarWrapper');

const answerCallBtn = document.getElementById('answerCallBtn');
const rejectCallBtn = document.getElementById('rejectCallBtn');
const incomingCallerName = document.getElementById('incomingCallerName');
const incomingAvatarImg = document.getElementById('incomingAvatarImg');

const soundRingtone = document.getElementById('soundRingtone');
const soundConnecting = document.getElementById('soundConnecting');

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) { startGlobalCallListener(); } 
    else { if (unsubscribeGlobalListener) unsubscribeGlobalListener(); }
});

function startGlobalCallListener() {
    if (unsubscribeGlobalListener) unsubscribeGlobalListener();
    const q = query(collection(db, "calls"), where("status", "==", "calling"));
    unsubscribeGlobalListener = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added") {
                const callData = change.doc.data();
                if (currentCallDocId) return; 
                if (callData.callerId === currentUser.uid) return; 

                let isForMe = false;
                if (callData.receiverId === currentUser.uid) { isForMe = true; } 
                else if (callData.groupId) {
                    try {
                        const groupDoc = await getDoc(doc(db, "groups", callData.groupId));
                        if (groupDoc.exists() && groupDoc.data().members.includes(currentUser.uid)) { isForMe = true; }
                    } catch (e) { console.error(e); }
                }

                if (isForMe) { showIncomingCall(change.doc.id, callData); }
            }
        });
    });
}

export function checkCallVisibility(chatId) {
    if (currentCallDocId && activeCallTargetId === chatId) { callInterface.style.display = 'flex'; } 
    else { callInterface.style.display = 'none'; }
}

function playSound(type) { if (type === 'ringtone') { soundRingtone.currentTime = 0; soundRingtone.play().catch(e => {}); } else if (type === 'connecting') { soundConnecting.currentTime = 0; soundConnecting.play().catch(e => {}); } }
function stopSounds() { soundRingtone.pause(); soundRingtone.currentTime = 0; soundConnecting.pause(); soundConnecting.currentTime = 0; }
function startTimer() { let seconds = 0; callTimer.style.display = 'block'; callStatusText.style.display = 'none'; timerInterval = setInterval(() => { seconds++; const mins = Math.floor(seconds / 60); const secs = seconds % 60; callTimer.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`; }, 1000); }
function stopTimer() { clearInterval(timerInterval); callTimer.style.display = 'none'; callStatusText.style.display = 'block'; callTimer.textContent = "0:00"; }

function monitorAudioLevel(stream, avatarWrapperElement) {
    if (!stream) return;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);
    analyser.smoothingTimeConstant = 0.5; analyser.fftSize = 1024;
    microphone.connect(analyser); analyser.connect(javascriptNode); javascriptNode.connect(audioContext.destination);
    javascriptNode.onaudioprocess = function() {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        let values = 0; const length = array.length;
        for (let i = 0; i < length; i++) values += array[i];
        const average = values / length;
        if (average > 15) avatarWrapperElement.classList.add('speaking'); else avatarWrapperElement.classList.remove('speaking');
    }
}

function initResizableCall() {
    const handle = document.getElementById('resizeHandle');
    const container = document.getElementById('callInterface');
    let startY, startHeight;
    handle.addEventListener('mousedown', initDrag);
    function initDrag(e) { startY = e.clientY; startHeight = parseInt(document.defaultView.getComputedStyle(container).height, 10); document.documentElement.addEventListener('mousemove', doDrag); document.documentElement.addEventListener('mouseup', stopDrag); document.body.style.cursor = 'row-resize'; e.preventDefault(); }
    function doDrag(e) { const newHeight = startHeight + (e.clientY - startY); if (newHeight > 250 && newHeight < 600) { container.style.height = newHeight + 'px'; } }
    function stopDrag() { document.documentElement.removeEventListener('mousemove', doDrag); document.documentElement.removeEventListener('mouseup', stopDrag); document.body.style.cursor = ''; }
}
initResizableCall();

muteBtn.onclick = async () => {
    if (localStream && currentCallDocId) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        const isMuted = !audioTrack.enabled;
        if (isMuted) { muteBtn.classList.add('active'); muteIcon.textContent = 'mic_off'; localAvatarWrapper.classList.add('muted'); } 
        else { muteBtn.classList.remove('active'); muteIcon.textContent = 'mic'; localAvatarWrapper.classList.remove('muted'); }
        const callDocRef = doc(db, "calls", currentCallDocId);
        try { await updateDoc(callDocRef, { [isCaller ? 'callerMuted' : 'receiverMuted']: isMuted }); } catch(e) {}
    }
};

export async function startCall(target, isGroupCall = false) {
    if (!currentUser) return showToast("Вы не авторизованы", "error");
    currentCallDocId = null; isCaller = true;
    if (isGroupCall) activeCallTargetId = target.id; else { const ids = [currentUser.uid, target.uid].sort(); activeCallTargetId = ids[0] + "_" + ids[1]; }

    callInterface.classList.add('ringing'); callInterface.style.display = 'flex';
    localCallAvatar.src = currentUser.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png";
    if (isGroupCall) { remoteCallAvatar.src = "https://cdn-icons-png.flaticon.com/512/681/681494.png"; remoteAvatarLabel.textContent = target.name; } 
    else { remoteCallAvatar.src = target.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png"; remoteAvatarLabel.textContent = target.displayName; }
    
    callStatusText.textContent = "Набор номера...";
    if(isGlobalMuted) { muteBtn.classList.add('active'); muteIcon.textContent = 'mic_off'; localAvatarWrapper.classList.add('muted'); } else { muteBtn.classList.remove('active'); muteIcon.textContent = 'mic'; localAvatarWrapper.classList.remove('muted'); }
    updateUserActivity("В звонке");

    try { 
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); 
        if(isGlobalMuted) localStream.getAudioTracks()[0].enabled = false;
    } catch (e) { callInterface.style.display = 'none'; updateUserActivity("В меню"); return showToast("Нет доступа к микрофону", "error"); }

    monitorAudioLevel(localStream, localAvatarWrapper);
    playSound('connecting');

    pc = new RTCPeerConnection(servers);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.ontrack = (event) => { remoteAudio.srcObject = event.streams[0]; monitorAudioLevel(event.streams[0], remoteAvatarWrapper); };

    const callDocRef = doc(collection(db, "calls"));
    const offerCandidates = collection(callDocRef, "offerCandidates");
    const answerCandidates = collection(callDocRef, "answerCandidates");
    currentCallDocId = callDocRef.id;

    pc.onicecandidate = (event) => { if (event.candidate) addDoc(offerCandidates, event.candidate.toJSON()); };
    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const callData = {
        callerId: currentUser.uid, callerName: currentUser.displayName, callerPhoto: currentUser.photoURL,
        offer: { sdp: offerDescription.sdp, type: offerDescription.type }, status: 'calling',
        callerMuted: isGlobalMuted, receiverMuted: false
    };
    if (isGroupCall) { callData.groupId = target.id; callData.groupName = target.name; } else { callData.receiverId = target.uid; }

    await setDoc(callDocRef, callData);

    unsubscribeCall = onSnapshot(callDocRef, (snapshot) => {
        const data = snapshot.data();
        if (!pc || !data) { endCall(); return; } 
        if (data.receiverMuted) remoteAvatarWrapper.classList.add('muted'); else remoteAvatarWrapper.classList.remove('muted');
        if (pc.signalingState !== "stable" && data.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(answerDescription);
            callInterface.classList.remove('ringing'); stopSounds(); startTimer();
            if (isGroupCall && data.responderName) { remoteAvatarLabel.textContent = data.responderName; if(data.responderPhoto) remoteCallAvatar.src = data.responderPhoto; }
        }
        if (data.status === 'hungup') { endCall(); showToast("Звонок завершен", "info"); }
    });
    onSnapshot(answerCandidates, (snapshot) => { snapshot.docChanges().forEach((change) => { if (change.type === "added") pc.addIceCandidate(new RTCIceCandidate(change.doc.data())); }); });
}

async function answerCall(callId, callData) {
    if(unsubscribeIncoming) unsubscribeIncoming();
    stopSounds();
    closeModal('incomingCallModal'); 
    isCaller = false;
    currentCallDocId = callId;

    if (callData.groupId) activeCallTargetId = callData.groupId;
    else { const ids = [currentUser.uid, callData.callerId].sort(); activeCallTargetId = ids[0] + "_" + ids[1]; }
    
    checkCallVisibility(activeCallTargetId);

    callInterface.classList.remove('ringing');
    localCallAvatar.src = currentUser.photoURL;
    remoteCallAvatar.src = callData.callerPhoto;
    remoteAvatarLabel.textContent = callData.callerName;
    callStatusText.textContent = "Подключение...";
    
    updateUserActivity("В звонке");
    if(isGlobalMuted) { muteBtn.classList.add('active'); muteIcon.textContent = 'mic_off'; localAvatarWrapper.classList.add('muted'); } else { muteBtn.classList.remove('active'); muteIcon.textContent = 'mic'; localAvatarWrapper.classList.remove('muted'); }

    try { 
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); 
        if(isGlobalMuted) localStream.getAudioTracks()[0].enabled = false;
    } catch (e) { updateUserActivity("В меню"); return; }
    
    monitorAudioLevel(localStream, localAvatarWrapper);

    pc = new RTCPeerConnection(servers);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.ontrack = (event) => { remoteAudio.srcObject = event.streams[0]; monitorAudioLevel(event.streams[0], remoteAvatarWrapper); };

    const callDocRef = doc(db, "calls", callId);
    const answerCandidates = collection(callDocRef, "answerCandidates");
    const offerCandidates = collection(callDocRef, "offerCandidates");

    pc.onicecandidate = (event) => { if (event.candidate) addDoc(answerCandidates, event.candidate.toJSON()); };
    await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    await updateDoc(callDocRef, { 
        answer: { type: answerDescription.type, sdp: answerDescription.sdp }, 
        status: 'connected', receiverMuted: isGlobalMuted,
        responderId: currentUser.uid, responderName: currentUser.displayName, responderPhoto: currentUser.photoURL
    });

    startTimer();
    onSnapshot(offerCandidates, (snapshot) => { snapshot.docChanges().forEach((change) => { if (change.type === "added") pc.addIceCandidate(new RTCIceCandidate(change.doc.data())); }); });
    unsubscribeCall = onSnapshot(callDocRef, (snapshot) => {
        const data = snapshot.data();
        if(!pc || !data) { endCall(); return; }
        if (data.callerMuted) remoteAvatarWrapper.classList.add('muted'); else remoteAvatarWrapper.classList.remove('muted');
        if (data.status === 'hungup') { endCall(); showToast("Звонок завершен", "info"); }
    });
}

export async function endCall() {
    stopSounds(); stopTimer();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (pc) { pc.close(); pc = null; }
    if (unsubscribeCall) unsubscribeCall();
    if (unsubscribeIncoming) unsubscribeIncoming();
    
    callInterface.style.display = 'none'; 
    closeModal('incomingCallModal'); 
    callInterface.classList.remove('ringing');
    updateUserActivity("В меню");

    if (currentCallDocId) { 
        try { 
            const callDocRef = doc(db, "calls", currentCallDocId); 
            await updateDoc(callDocRef, { status: 'hungup' }); 
        } catch(e) {} 
        currentCallDocId = null; 
    }
}

function showIncomingCall(callId, callData) {
    playSound('ringtone');
    incomingCallerName.textContent = callData.groupName ? `Группа: ${callData.groupName}\nОт: ${callData.callerName}` : `Звонок от: ${callData.callerName}`;
    incomingAvatarImg.src = callData.callerPhoto;
    
    openModal('incomingCallModal'); 
    
    unsubscribeIncoming = onSnapshot(doc(db, "calls", callId), (snapshot) => {
        const data = snapshot.data();
        if (!data || data.status === 'hungup' || (data.status === 'connected' && data.responderId !== currentUser.uid && data.callerId !== currentUser.uid)) {
            stopSounds();
            closeModal('incomingCallModal');
            if (unsubscribeIncoming) unsubscribeIncoming();
            if (data && data.status === 'hungup') showToast("Звонок отменен", "info");
            else if (data) showToast("На звонок уже ответили", "info");
        }
    });
    
    answerCallBtn.onclick = () => { if (unsubscribeIncoming) unsubscribeIncoming(); answerCall(callId, callData); };
    rejectCallBtn.onclick = () => {
        if (unsubscribeIncoming) unsubscribeIncoming(); stopSounds(); 
        closeModal('incomingCallModal');
        if (!callData.groupId) { const callDocRef = doc(db, "calls", callId); updateDoc(callDocRef, { status: 'hungup' }); }
    };
}

hangupBtn.addEventListener('click', endCall);