import { db, auth } from "./firebase-config.js";
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, where, doc, getDocs, setDoc, deleteDoc, updateDoc, arrayRemove, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { startCall, checkCallVisibility } from "./call.js";
import { showToast, openModal, closeModal } from "./toast.js";

export let isGlobalMuted = false;

let currentChatUser = null; 
let currentChatGroup = null; 
let currentChatId = null;
let currentChatType = null;
let messagesUnsubscribe = null;

// Элементы
const chatsList = document.getElementById('chatsList');
const chatRoom = document.getElementById('chatRoom');
const emptyState = document.getElementById('emptyState');
const chatTitle = document.getElementById('chatTitle');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messagesList = document.getElementById('messagesList');
const chatHeaderAvatar = document.getElementById('chatHeaderAvatar');
const chatHeaderStatus = document.getElementById('chatHeaderStatus');
const startCallBtn = document.getElementById('startCallBtn');
const chatHeaderInfoArea = document.getElementById('chatHeaderInfoArea');

const createGroupBtn = document.getElementById('createGroupBtn');
const confirmCreateGroupBtn = document.getElementById('confirmCreateGroupBtn');
const usersForGroupList = document.getElementById('usersForGroupList');
const newGroupName = document.getElementById('newGroupName');
const closeCreateGroup = document.getElementById('closeCreateGroup');

const infoGroupName = document.getElementById('infoGroupName');
const infoGroupCount = document.getElementById('infoGroupCount');
const deleteGroupBtn = document.getElementById('deleteGroupBtn');
const leaveGroupBtn = document.getElementById('leaveGroupBtn');
const notifyLeaveCheck = document.getElementById('notifyLeaveCheck');
const groupCreatorActions = document.getElementById('groupCreatorActions');
const groupMemberActions = document.getElementById('groupMemberActions');
const closeGroupInfo = document.getElementById('closeGroupInfo');

const friendsBtn = document.getElementById('friendsBtn');
const closeFriends = document.getElementById('closeFriends');
const requestsBadge = document.getElementById('requestsBadge');
const sidebarRequestsBadge = document.getElementById('sidebarRequestsBadge');
const modalRequestsBadge = document.getElementById('modalRequestsBadge');
const myFriendsList = document.getElementById('myFriendsList');
const searchResultsList = document.getElementById('searchResultsList');
const friendRequestsList = document.getElementById('friendRequestsList');
const userSearchInput = document.getElementById('userSearchInput');
const userSearchBtn = document.getElementById('userSearchBtn');

const miniProfileAvatar = document.getElementById('miniProfileAvatar');
const miniProfileName = document.getElementById('miniProfileName');
const miniProfileStatus = document.getElementById('miniProfileStatus');
const sidebarUserProfile = document.getElementById('sidebarUserProfile');
const globalMuteBtn = document.getElementById('globalMuteBtn');
const globalMuteIcon = document.getElementById('globalMuteIcon');
const activityStatusText = document.getElementById('activityStatusText');

const fullProfileAvatar = document.getElementById('fullProfileAvatar');
const fullProfileName = document.getElementById('fullProfileName');
const fullProfileEmail = document.getElementById('fullProfileEmail');
const fullProfileStatusText = document.getElementById('fullProfileStatusText');
const fullProfileStatusIndicator = document.getElementById('fullProfileStatusIndicator');
const fullProfileId = document.getElementById('fullProfileId');
const fullProfileUsername = document.getElementById('fullProfileUsername');
const closeUserProfile = document.getElementById('closeUserProfile');

let myFriendsData = [];
let allGroupsData = [];
let friendListenersUnsubscribers = [];

function setupFriendListeners(friendUids) {
    friendListenersUnsubscribers.forEach(unsub => unsub());
    friendListenersUnsubscribers = [];
    myFriendsData = [];

    if (friendUids.length === 0) {
        renderChatList();
        renderMyFriendsList();
        return;
    }

    friendUids.forEach(uid => {
        const unsub = onSnapshot(doc(db, "users", uid), (docSnap) => {
            if (docSnap.exists()) {
                const userData = docSnap.data();
                const index = myFriendsData.findIndex(u => u.uid === uid);
                if (index !== -1) { myFriendsData[index] = userData; } 
                else { myFriendsData.push(userData); }
            } else {
                const index = myFriendsData.findIndex(u => u.uid === uid);
                if (index !== -1) {
                    myFriendsData[index] = {
                        uid: uid,
                        displayName: "Аккаунт удален",
                        username: "deleted",
                        photoURL: "https://cdn-icons-png.flaticon.com/512/847/847969.png", 
                        status: "deleted"
                    };
                }
            }
            renderChatList();
            renderMyFriendsList();
            if (currentChatType === 'direct' && currentChatUser && currentChatUser.uid === uid) {
                const user = myFriendsData.find(u => u.uid === uid);
                updateChatHeader(user.displayName, user.photoURL, user.status);
            }
        });
        friendListenersUnsubscribers.push(unsub);
    });
}

function showCustomConfirm(msg) {
    return new Promise((resolve) => {
        const text = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmOkBtn');
        const noBtn = document.getElementById('confirmCancelBtn');
        text.textContent = msg;
        openModal('customConfirmModal');
        yesBtn.onclick = () => { closeModal('customConfirmModal'); resolve(true); };
        noBtn.onclick = () => { closeModal('customConfirmModal'); resolve(false); };
    });
}

export function updateUserActivity(status) {
    if(activityStatusText) activityStatusText.textContent = status;
}

export function initChat() {
    auth.onAuthStateChanged(async (user) => {
        if (!user) return;
        
        try { await updateDoc(doc(db, "users", user.uid), { status: 'online' }); } catch(e) {}

        if(miniProfileAvatar) miniProfileAvatar.src = user.photoURL;
        if(miniProfileName) miniProfileName.textContent = user.displayName;
        if(miniProfileStatus) miniProfileStatus.textContent = "В сети";

        if(sidebarUserProfile) {
            sidebarUserProfile.addEventListener('click', () => {
                openModal('currentUserProfileModal');
                if(fullProfileAvatar) fullProfileAvatar.src = user.photoURL;
                if(fullProfileName) fullProfileName.textContent = user.displayName;
                if(fullProfileEmail) fullProfileEmail.textContent = user.email;
                if(fullProfileId) fullProfileId.textContent = user.uid;
                
                getDoc(doc(db, "users", user.uid)).then(d => {
                    if(d.exists()) {
                        const data = d.data();
                        if(fullProfileUsername) fullProfileUsername.textContent = data.username ? `@${data.username}` : '';
                        const st = data.status;
                        let stText = st === 'online' ? 'В сети' : (st === 'busy' ? 'Не беспокоить' : 'Невидимка');
                        let stClass = st === 'online' ? 'online' : (st === 'busy' ? 'busy' : 'offline');
                        fullProfileStatusText.textContent = stText;
                        fullProfileStatusIndicator.className = `status-indicator ${stClass}`;
                    }
                });
            });
        }
        if(closeUserProfile) closeUserProfile.addEventListener('click', () => closeModal('currentUserProfileModal'));

        const friendsRef = collection(db, "users", user.uid, "friends");
        onSnapshot(friendsRef, (snapshot) => {
            const friendUids = snapshot.docs.map(d => d.id);
            setupFriendListeners(friendUids);
        });

        const qGroups = query(collection(db, "groups"), where("members", "array-contains", user.uid));
        onSnapshot(qGroups, (snapshot) => { allGroupsData = []; snapshot.forEach(doc => allGroupsData.push({ id: doc.id, ...doc.data() })); renderChatList(); });
        
        // Слушатель заявок в друзья
        const qRequests = query(collection(db, "friend_requests"), where("to", "==", user.uid), where("status", "==", "pending"));
        onSnapshot(qRequests, (snapshot) => {
            const count = snapshot.docs.length;
            if (count > 0) { 
                if(sidebarRequestsBadge) sidebarRequestsBadge.style.display = 'block'; 
                if(modalRequestsBadge) { modalRequestsBadge.style.display = 'inline-flex'; modalRequestsBadge.textContent = count; }
            } else { 
                if(sidebarRequestsBadge) sidebarRequestsBadge.style.display = 'none'; 
                if(modalRequestsBadge) modalRequestsBadge.style.display = 'none'; 
            }
            renderFriendRequests(snapshot.docs);
        });
    });
}

if(globalMuteBtn) {
    globalMuteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isGlobalMuted = !isGlobalMuted;
        if(isGlobalMuted) { globalMuteBtn.classList.add('active'); globalMuteIcon.textContent = 'mic_off'; showToast("Микрофон выключен (для новых звонков)", "info"); } 
        else { globalMuteBtn.classList.remove('active'); globalMuteIcon.textContent = 'mic'; showToast("Микрофон включен", "info"); }
    });
}

function renderChatList() {
    chatsList.innerHTML = '';
    allGroupsData.forEach(group => {
        const item = document.createElement('div'); item.className = 'chat-user-item';
        item.innerHTML = `<div class="avatar-wrapper"><img src="https://cdn-icons-png.flaticon.com/512/681/681494.png" class="user-avatar-small"></div><div class="user-info-col"><div class="user-name">${group.name}</div><div class="user-status-text">Группа • ${group.members.length} уч.</div></div>`;
        item.addEventListener('click', () => openChat(group, 'group')); chatsList.appendChild(item);
    });
    myFriendsData.forEach(user => {
        let statusClass = 'status-offline';
        if (user.status === 'online') statusClass = 'status-online';
        else if (user.status === 'busy') statusClass = 'status-busy';
        else if (user.status === 'deleted') statusClass = 'status-deleted';
        
        let statusText = user.customStatusText || (user.status === 'online' ? 'В сети' : (user.status === 'busy' ? 'Не беспокоить' : 'Не в сети'));
        if (user.status === 'deleted') statusText = "Аккаунт удален";

        const item = document.createElement('div'); item.className = 'chat-user-item';
        item.innerHTML = `<div class="avatar-wrapper"><img src="${user.photoURL}" class="user-avatar-small"><div class="status-dot ${statusClass}"></div></div><div class="user-info-col"><div class="user-name">${user.displayName}</div><div class="user-status-text">${statusText}</div></div>`;
        item.addEventListener('click', () => {
             if(user.status !== 'deleted') openChat(user, 'direct');
             else showToast("Этот аккаунт удален", "error");
        }); 
        chatsList.appendChild(item);
    });
    
    if (allGroupsData.length === 0 && myFriendsData.length === 0) {
        chatsList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-sub); font-size:14px;">Нет чатов.<br>Добавьте друзей!</div>';
    }
}

// Сброс UI чата (когда юзер удалился)
function resetChatUI() {
    chatRoom.style.display = 'none';
    emptyState.style.display = 'flex';
    currentChatId = null;
    currentChatUser = null;
    currentChatGroup = null;
    updateUserActivity("В меню");
}

let activeChatUserUnsubscribe = null; 

function openChat(target, type) {
    if (activeChatUserUnsubscribe) {
        activeChatUserUnsubscribe();
        activeChatUserUnsubscribe = null;
    }

    currentChatType = type; 
    if(startCallBtn) startCallBtn.style.display = 'flex';
    updateUserActivity(`В чате: ${type === 'direct' ? target.displayName : target.name}`);
    
    if (type === 'direct') {
        currentChatUser = target; currentChatGroup = null; const ids = [auth.currentUser.uid, target.uid].sort(); currentChatId = ids[0] + "_" + ids[1];
        updateChatHeader(target.displayName, target.photoURL, target.status);

        const userDocRef = doc(db, "users", target.uid);
        activeChatUserUnsubscribe = onSnapshot(userDocRef, (docSnap) => {
            if (!docSnap.exists()) {
                showToast("Пользователь удалил свой аккаунт", "info");
                resetChatUI();
                if (activeChatUserUnsubscribe) activeChatUserUnsubscribe();
            }
        });

    } else {
        currentChatGroup = target; currentChatUser = null; currentChatId = target.id;
        updateChatHeader(target.name, "https://cdn-icons-png.flaticon.com/512/681/681494.png", 'group');
        
        const groupDocRef = doc(db, "groups", target.id);
        activeChatUserUnsubscribe = onSnapshot(groupDocRef, (docSnap) => {
             if (!docSnap.exists()) {
                showToast("Эта группа была удалена", "info");
                resetChatUI();
             }
        });
    }

    checkCallVisibility(currentChatId);
    emptyState.style.display = 'none'; chatRoom.style.display = 'flex'; messagesList.innerHTML = ''; loadMessages();
}

function updateChatHeader(name, photo, status) {
    chatTitle.textContent = name; chatHeaderAvatar.innerHTML = `<img src="${photo}">`;
    if (status === 'group') { chatHeaderStatus.textContent = 'Групповой чат (Нажмите для инфо)'; chatHeaderStatus.style.color = 'var(--text-sub)'; } 
    else { 
        if (status === 'online') { chatHeaderStatus.textContent = 'В сети'; chatHeaderStatus.style.color = '#2cc069'; }
        else if (status === 'busy') { chatHeaderStatus.textContent = 'Не беспокоить'; chatHeaderStatus.style.color = '#ff4444'; }
        else if (status === 'deleted') { chatHeaderStatus.textContent = 'Аккаунт удален'; chatHeaderStatus.style.color = '#333'; }
        else { chatHeaderStatus.textContent = 'Не в сети'; chatHeaderStatus.style.color = 'var(--text-sub)'; }
    }
}

async function sendMessage() {
    const text = messageInput.value; if (text.trim() === '' || !currentChatId) return;
    let collectionRef = currentChatType === 'direct' ? collection(db, "chats", currentChatId, "messages") : collection(db, "groups", currentChatId, "messages");
    try { await addDoc(collectionRef, { text: text, senderId: auth.currentUser.uid, senderName: auth.currentUser.displayName, timestamp: serverTimestamp() }); messageInput.value = ''; } catch (error) { console.error(error); }
}

function loadMessages() {
    if (messagesUnsubscribe) messagesUnsubscribe();
    let collectionRef = currentChatType === 'direct' ? collection(db, "chats", currentChatId, "messages") : collection(db, "groups", currentChatId, "messages");
    const q = query(collectionRef, orderBy("timestamp", "asc"));
    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        messagesList.innerHTML = ''; 
        snapshot.forEach((doc) => {
            const msg = doc.data(); const isMe = msg.senderId === auth.currentUser.uid;
            if (msg.type === 'system') { const sysDiv = document.createElement('div'); sysDiv.style.textAlign = 'center'; sysDiv.style.fontSize = '12px'; sysDiv.style.color = 'var(--text-sub)'; sysDiv.style.margin = '10px 0'; sysDiv.textContent = msg.text; messagesList.appendChild(sysDiv); return; }
            const msgDiv = document.createElement('div'); msgDiv.className = `message-bubble ${isMe ? 'my-message' : 'friend-message'}`;
            if (currentChatType === 'group' && !isMe) { const nameLabel = document.createElement('div'); nameLabel.style.fontSize = '11px'; nameLabel.style.color = '#888'; nameLabel.style.marginBottom = '2px'; nameLabel.textContent = msg.senderName; msgDiv.appendChild(nameLabel); }
            const textNode = document.createElement('div'); textNode.textContent = msg.text; msgDiv.appendChild(textNode); messagesList.appendChild(msgDiv);
        });
        messagesList.scrollTop = messagesList.scrollHeight;
    });
}

if(friendsBtn) friendsBtn.addEventListener('click', () => { openModal('friendsModal'); renderMyFriendsList(); });
if(closeFriends) closeFriends.addEventListener('click', () => closeModal('friendsModal'));

userSearchBtn.addEventListener('click', async () => {
    const queryText = userSearchInput.value.trim(); 
    if (!queryText) return;
    
    searchResultsList.innerHTML = '<div style="padding:10px;">Поиск...</div>';
    
    let q;
    if (queryText.startsWith('@')) {
        const username = queryText.substring(1);
        q = query(collection(db, "users"), where("username", "==", username));
    } else {
        q = query(collection(db, "users"), where("displayName", ">=", queryText), where("displayName", "<=", queryText + "\uf8ff"));
    }

    const snapshot = await getDocs(q);
    searchResultsList.innerHTML = '';
    if (snapshot.empty) { searchResultsList.innerHTML = '<div style="padding:10px;">Никого не найдено</div>'; return; }
    
    snapshot.forEach(docSnap => {
        // [ИСПРАВЛЕНИЕ] Гарантированно получаем UID из ID документа
        const userData = docSnap.data();
        const user = { ...userData, uid: docSnap.id }; 
        
        if (user.uid === auth.currentUser.uid) return;
        
        const isFriend = myFriendsData.some(f => f.uid === user.uid);
        
        const card = document.createElement('div'); card.className = 'friend-card';
        card.innerHTML = `<img src="${user.photoURL}"><div class="friend-name">${user.displayName} <span style='font-size:11px;color:#888'>@${user.username||''}</span></div>${!isFriend ? `<button class="btn-add-friend" data-uid="${user.uid}">Добавить</button>` : '<span style="font-size:12px;color:green;">Друзья</span>'}`;
        
        if (!isFriend) {
            card.querySelector('.btn-add-friend').addEventListener('click', () => sendFriendRequest(user));
        }
        searchResultsList.appendChild(card);
    });
});

async function sendFriendRequest(targetUser) {
    if (!targetUser || !targetUser.uid) return showToast("Ошибка: пользователь не найден", "error");

    try { 
        // Проверяем, не отправляли ли уже
        const checkQ = query(collection(db, "friend_requests"), 
            where("from", "==", auth.currentUser.uid), 
            where("to", "==", targetUser.uid));
        
        const checkSnap = await getDocs(checkQ);
        if (!checkSnap.empty) {
            return showToast("Заявка уже отправлена", "info");
        }

        await addDoc(collection(db, "friend_requests"), { 
            from: auth.currentUser.uid, 
            to: targetUser.uid, 
            fromName: auth.currentUser.displayName, 
            fromPhoto: auth.currentUser.photoURL, 
            status: 'pending', 
            timestamp: serverTimestamp() 
        }); 
        showToast("Заявка отправлена", "success"); 
    } catch (e) { 
        console.error(e);
        showToast("Ошибка: " + e.message, "error"); 
    }
}

function renderFriendRequests(docs) {
    friendRequestsList.innerHTML = '';
    if (docs.length === 0) { friendRequestsList.innerHTML = '<div style="padding:10px; color:var(--text-sub);">Нет новых заявок</div>'; return; }
    docs.forEach(d => {
        const req = d.data(); const card = document.createElement('div'); card.className = 'request-card';
        card.innerHTML = `<div class="req-info"><img src="${req.fromPhoto}"><span><b>${req.fromName}</b> хочет добавить вас</span></div><div class="req-actions"><button class="btn-accept"><span class="material-symbols-outlined">check</span></button><button class="btn-reject"><span class="material-symbols-outlined">close</span></button></div>`;
        card.querySelector('.btn-accept').addEventListener('click', () => acceptFriend(d.id, req)); card.querySelector('.btn-reject').addEventListener('click', () => rejectFriend(d.id));
        friendRequestsList.appendChild(card);
    });
}

async function acceptFriend(reqId, reqData) {
    try { await setDoc(doc(db, "users", auth.currentUser.uid, "friends", reqData.from), { uid: reqData.from }); await setDoc(doc(db, "users", reqData.from, "friends", auth.currentUser.uid), { uid: auth.currentUser.uid }); await deleteDoc(doc(db, "friend_requests", reqId)); showToast("Друг добавлен!", "success"); } catch(e) { showToast(e.message, "error"); }
}
async function rejectFriend(reqId) { try { await deleteDoc(doc(db, "friend_requests", reqId)); } catch(e){} }

function renderMyFriendsList() {
    myFriendsList.innerHTML = '';
    myFriendsData.forEach(user => {
        if(user.status === 'deleted') return; 
        const card = document.createElement('div'); card.className = 'friend-card';
        card.innerHTML = `<img src="${user.photoURL}"><div class="friend-name">${user.displayName}</div><button class="btn-remove-friend">Удалить</button>`;
        card.querySelector('.btn-remove-friend').addEventListener('click', () => removeFriend(user.uid));
        myFriendsList.appendChild(card);
    });
}

async function removeFriend(friendUid) {
    const confirmed = await showCustomConfirm("Удалить пользователя из друзей?");
    if(!confirmed) return;
    try { await deleteDoc(doc(db, "users", auth.currentUser.uid, "friends", friendUid)); await deleteDoc(doc(db, "users", friendUid, "friends", auth.currentUser.uid)); showToast("Пользователь удален из друзей", "info"); } catch (e) { showToast(e.message, "error"); }
}

if(createGroupBtn) createGroupBtn.addEventListener('click', () => { openModal('createGroupModal'); loadUsersForGroup(); });
if(closeCreateGroup) closeCreateGroup.addEventListener('click', () => closeModal('createGroupModal'));

function loadUsersForGroup() {
    usersForGroupList.innerHTML = '';
    myFriendsData.forEach(user => {
        if(user.status === 'deleted') return;
        const card = document.createElement('div'); card.className = 'grid-user-card'; const checkboxId = `user_cb_${user.uid}`;
        card.innerHTML = `<input type="checkbox" value="${user.uid}" id="${checkboxId}" class="hidden-checkbox"><img src="${user.photoURL}" class="grid-avatar"><div class="grid-name">${user.displayName}</div><div class="grid-check"><span class="material-symbols-outlined">check</span></div>`;
        card.addEventListener('click', () => { const cb = card.querySelector('.hidden-checkbox'); cb.checked = !cb.checked; if (cb.checked) card.classList.add('selected'); else card.classList.remove('selected'); });
        usersForGroupList.appendChild(card);
    });
}

confirmCreateGroupBtn.addEventListener('click', async () => {
    const name = newGroupName.value; const checkboxes = document.querySelectorAll('.hidden-checkbox:checked'); const members = [auth.currentUser.uid];
    checkboxes.forEach(cb => members.push(cb.value));
    if (!name) return showToast("Введите название группы", "error"); if (members.length < 2) return showToast("Выберите участников", "error");
    try { await addDoc(collection(db, "groups"), { name: name, members: members, createdBy: auth.currentUser.uid, createdAt: serverTimestamp() }); showToast("Группа создана!", "success"); closeModal('createGroupModal'); newGroupName.value = ''; } catch (e) { showToast("Ошибка: " + e.message, "error"); }
});

chatHeaderInfoArea.addEventListener('click', () => {
    if (currentChatType === 'group' && currentChatGroup) {
        openModal('groupInfoModal'); infoGroupName.textContent = currentChatGroup.name; infoGroupCount.textContent = `${currentChatGroup.members.length} участников`;
        if (currentChatGroup.createdBy === auth.currentUser.uid) { groupCreatorActions.style.display = 'block'; groupMemberActions.style.display = 'none'; } 
        else { groupCreatorActions.style.display = 'none'; groupMemberActions.style.display = 'block'; }
    }
});
if(closeGroupInfo) closeGroupInfo.addEventListener('click', () => closeModal('groupInfoModal'));

deleteGroupBtn.addEventListener('click', async () => {
    const confirmed = await showCustomConfirm("Удалить группу навсегда?");
    if(!confirmed) return;
    try { await deleteDoc(doc(db, "groups", currentChatGroup.id)); closeModal('groupInfoModal'); chatRoom.style.display = 'none'; emptyState.style.display = 'flex'; showToast("Группа удалена", "info"); } catch(e) { showToast(e.message, "error"); }
});

leaveGroupBtn.addEventListener('click', async () => {
    const confirmed = await showCustomConfirm("Выйти из группы?");
    if(!confirmed) return;
    try {
        const groupRef = doc(db, "groups", currentChatGroup.id); await updateDoc(groupRef, { members: arrayRemove(auth.currentUser.uid) });
        if (notifyLeaveCheck.checked) { await addDoc(collection(db, "groups", currentChatGroup.id, "messages"), { text: `${auth.currentUser.displayName} покинул группу`, type: 'system', timestamp: serverTimestamp() }); }
        closeModal('groupInfoModal'); chatRoom.style.display = 'none'; emptyState.style.display = 'flex'; showToast("Вы покинули группу", "info");
    } catch(e) { showToast(e.message, "error"); }
});

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

if (startCallBtn) { startCallBtn.addEventListener('click', () => { if (currentChatType === 'direct') startCall(currentChatUser, false); else if (currentChatType === 'group') startCall(currentChatGroup, true); }); }

initChat();