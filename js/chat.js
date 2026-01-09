import { db, auth } from "./firebase-config.js";
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, where, doc, getDocs, setDoc, deleteDoc, updateDoc, arrayRemove, getDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast, openModal, closeModal } from "./toast.js";
import { initCallSystem, startCall } from "./call.js";

window.updateUserActivity = function(status) {
    const el = document.getElementById('activityStatusText');
    if(el) el.textContent = status;
};

// Переменные состояния
let currentChatUser = null; 
let currentChatGroup = null; 
let currentChatId = null;
let currentChatType = null;
let messagesUnsubscribe = null;

// DOM Элементы
const chatsList = document.getElementById('chatsList');
const chatRoom = document.getElementById('chatRoom');
const emptyState = document.getElementById('emptyState');
const chatTitle = document.getElementById('chatTitle');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messagesList = document.getElementById('messagesList');
const chatHeaderAvatar = document.getElementById('chatHeaderAvatar');
const chatHeaderStatus = document.getElementById('chatHeaderStatus');
const chatHeaderInfoArea = document.getElementById('chatHeaderInfoArea');
const backToChatsBtn = document.getElementById('backToChatsBtn');

// Кнопки боковой панели
const friendsBtn = document.getElementById('friendsBtn');
const createGroupBtn = document.getElementById('createGroupBtn');
const settingsBtn = document.getElementById('settingsBtn');

if(friendsBtn) friendsBtn.addEventListener('click', () => {
    openModal('friendsModal');
    loadFriendsList(); 
    loadFriendRequests(); 
});
if(createGroupBtn) createGroupBtn.addEventListener('click', () => {
    openModal('createGroupModal');
    loadUsersForGroupCreation(); 
});
if(settingsBtn) settingsBtn.addEventListener('click', () => openModal('settingsModal'));


// === ОСНОВНАЯ ЛОГИКА ===
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        chatRoom.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }

    initCallSystem();

    // ЗАГРУЗКА ЧАТОВ
    const q = query(collection(db, "users", user.uid, "chats"), orderBy("lastMessageTime", "desc"));
    
    onSnapshot(q, async (snapshot) => {
        chatsList.innerHTML = '';
        
        if (snapshot.empty) {
            chatsList.innerHTML = '<div style="text-align:center; padding:20px; color:#888; font-size: 14px;">Нет чатов</div>';
            return;
        }

        for (const d of snapshot.docs) {
            const chatData = d.data();
            const chatId = d.id;
            
            if (chatData.type === 'direct') {
                const partnerId = chatData.partnerId;
                onSnapshot(doc(db, "users", partnerId), (userSnap) => {
                    const userData = userSnap.data();
                    if (!userData) return;
                    
                    let chatItem = document.getElementById(`chat-item-${chatId}`);
                    if (!chatItem) {
                        chatItem = document.createElement('div');
                        chatItem.id = `chat-item-${chatId}`;
                        chatItem.className = 'chat-user-item';
                        chatItem.onclick = () => openChat(chatId, 'direct', userData);
                        chatsList.appendChild(chatItem); 
                    }
                    
                    let statusColor = '#666'; 
                    let statusText = 'Не в сети';
                    if(userData.status === 'online') { statusColor = '#00b34a'; statusText = 'В сети'; }
                    else if(userData.status === 'busy') { statusColor = '#ff9800'; statusText = 'Занят'; }

                    chatItem.innerHTML = `
                        <div class="avatar-wrapper">
                            <img src="${userData.photoURL || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'}" class="user-avatar-small">
                            <div class="status-dot" style="background:${statusColor}"></div>
                        </div>
                        <div class="user-info-col">
                            <div class="user-name">${userData.displayName}</div>
                            <div class="user-status-text">${statusText}</div>
                        </div>
                    `;
                });
            } 
            else if (chatData.type === 'group') {
                const groupId = chatData.groupId;
                onSnapshot(doc(db, "groups", groupId), (groupSnap) => {
                    const groupData = groupSnap.data();
                    if (!groupData) return;

                    let chatItem = document.getElementById(`chat-item-${chatId}`);
                    if (!chatItem) {
                        chatItem = document.createElement('div');
                        chatItem.id = `chat-item-${chatId}`;
                        chatItem.className = 'chat-user-item';
                        chatItem.onclick = () => openChat(chatId, 'group', groupData);
                        chatsList.appendChild(chatItem);
                    }

                    chatItem.innerHTML = `
                        <div class="avatar-wrapper">
                            <div class="user-avatar-small" style="background:#007bff; display:flex; justify-content:center; align-items:center; color:white;">
                                <span class="material-symbols-outlined">groups</span>
                            </div>
                        </div>
                        <div class="user-info-col">
                            <div class="user-name">${groupData.name}</div>
                            <div class="user-status-text">${groupData.members ? groupData.members.length : 0} участников</div>
                        </div>
                    `;
                });
            }
        }
    });

    const miniProfileAvatar = document.getElementById('miniProfileAvatar');
    const miniProfileName = document.getElementById('miniProfileName');
    const miniProfileStatus = document.getElementById('miniProfileStatus'); 
    
    if(miniProfileAvatar) miniProfileAvatar.src = user.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png";
    if(miniProfileName) miniProfileName.textContent = user.displayName;
    if(miniProfileStatus) { miniProfileStatus.textContent = "В сети"; miniProfileStatus.style.color = "#00b34a"; }

    const sidebarUserProfile = document.getElementById('sidebarUserProfile');
    if(sidebarUserProfile) {
        sidebarUserProfile.addEventListener('click', () => {
             openModal('currentUserProfileModal');
             const fpName = document.getElementById('fullProfileName');
             const fpEmail = document.getElementById('fullProfileEmail');
             const fpId = document.getElementById('fullProfileId');
             const fpAvatar = document.getElementById('fullProfileAvatar');
             const fpUsername = document.getElementById('fullProfileUsername');

             if(fpName) fpName.textContent = user.displayName;
             if(fpEmail) fpEmail.textContent = user.email;
             if(fpId) fpId.textContent = user.uid;
             if(fpAvatar) fpAvatar.src = user.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png";
             
             getDoc(doc(db, "users", user.uid)).then(snap => {
                 if(snap.exists() && fpUsername) {
                     fpUsername.textContent = "@" + (snap.data().username || "user");
                 }
             });
        });
    }
});

async function openChat(chatId, type, data) {
    currentChatId = chatId;
    currentChatType = type;
    
    document.body.classList.add('mobile-chat-open');
    emptyState.style.display = 'none';
    chatRoom.style.display = 'flex';
    
    messagesList.innerHTML = '';
    if (messagesUnsubscribe) messagesUnsubscribe();

    // ИСПРАВЛЕНИЕ: Ищем контейнер в шапке
    const headerRight = document.querySelector('.chat-header .header-right');
    const oldCall = document.getElementById('headerCallBtn');
    if(oldCall) oldCall.remove(); 

    if (type === 'direct') {
        currentChatUser = data;
        currentChatGroup = null;
        chatTitle.textContent = data.displayName;
        chatHeaderAvatar.innerHTML = `<img src="${data.photoURL || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'}">`;
        
        const callBtn = document.createElement('button');
        callBtn.id = 'headerCallBtn';
        callBtn.className = 'icon-btn';
        callBtn.innerHTML = '<span class="material-symbols-outlined">call</span>';
        callBtn.title = "Позвонить";
        callBtn.onclick = () => startCall(data.uid, data.displayName, data.photoURL, chatId, 'direct');
        
        // Вставляем кнопку звонка
        if(headerRight) headerRight.appendChild(callBtn);

        onSnapshot(doc(db, "users", data.uid), (snap) => {
            const d = snap.data();
            if(d) {
                chatHeaderStatus.textContent = d.status === 'online' ? 'В сети' : (d.status === 'busy' ? 'Занят' : 'Не в сети');
            }
        });

    } else {
        currentChatGroup = data;
        currentChatUser = null;
        chatTitle.textContent = data.name;
        chatHeaderAvatar.innerHTML = `<div style="width:40px;height:40px;background:#007bff;border-radius:50%;display:flex;justify-content:center;align-items:center;color:white;"><span class="material-symbols-outlined">groups</span></div>`;
        chatHeaderStatus.textContent = `${data.members ? data.members.length : 0} участников`;
    }

    const collectionName = type === 'direct' ? 'chats' : 'groups';
    const q = query(collection(db, collectionName, chatId, "messages"), orderBy("timestamp", "asc"));
    
    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        messagesList.innerHTML = '';
        snapshot.forEach((doc) => {
            renderMessage(doc.data(), doc.id);
        });
        scrollToBottom();
    });
}

function renderMessage(msg, id) {
    const div = document.createElement('div');
    const isMe = msg.senderId === auth.currentUser.uid;
    
    if (msg.type === 'system') {
        div.className = 'message-bubble system-message';
        div.style.alignSelf = 'center';
        div.style.background = 'rgba(127,127,127,0.2)';
        div.style.fontSize = '12px';
        div.style.color = 'var(--text-sub)';
        div.style.borderRadius = '10px';
        div.style.padding = '5px 10px';
        div.style.boxShadow = 'none';
        div.textContent = msg.text;
    } else {
        div.className = `message-bubble ${isMe ? 'my-message' : 'friend-message'}`;
        div.textContent = msg.text;
    }
    messagesList.appendChild(div);
}

function scrollToBottom() {
    messagesList.scrollTop = messagesList.scrollHeight;
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') sendMessage(); });

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChatId) return;
    
    messageInput.value = ''; 
    const collectionName = currentChatType === 'direct' ? 'chats' : 'groups';
    
    try {
        await addDoc(collection(db, collectionName, currentChatId, "messages"), {
            text: text,
            senderId: auth.currentUser.uid,
            timestamp: serverTimestamp(),
            type: 'text'
        });
        
        if (currentChatType === 'direct') {
            await updateDoc(doc(db, "users", auth.currentUser.uid, "chats", currentChatId), { lastMessageTime: serverTimestamp() });
        }
    } catch (e) {
        showToast("Ошибка отправки: " + e.message, "error");
    }
}

if(backToChatsBtn) {
    backToChatsBtn.addEventListener('click', () => {
        document.body.classList.remove('mobile-chat-open');
    });
}

chatHeaderInfoArea.addEventListener('click', () => {
    if(currentChatType === 'group' && currentChatGroup) {
        openModal('groupInfoModal');
        const infoGroupName = document.getElementById('infoGroupName');
        const infoGroupCount = document.getElementById('infoGroupCount');
        
        if(infoGroupName) infoGroupName.textContent = currentChatGroup.name;
        if(infoGroupCount) infoGroupCount.textContent = `${currentChatGroup.members ? currentChatGroup.members.length : 0} участников`;
        
        const deleteGroupBtn = document.getElementById('deleteGroupBtn');
        const leaveGroupBtn = document.getElementById('leaveGroupBtn');
        const groupCreatorActions = document.getElementById('groupCreatorActions');
        const groupMemberActions = document.getElementById('groupMemberActions');
        
        if(currentChatGroup.owner === auth.currentUser.uid) {
            groupCreatorActions.style.display = 'block';
            groupMemberActions.style.display = 'none';
        } else {
            groupCreatorActions.style.display = 'none';
            groupMemberActions.style.display = 'block';
        }

        deleteGroupBtn.onclick = async () => {
            if(confirm("Удалить группу?")) {
                await deleteDoc(doc(db, "groups", currentChatId));
                closeModal('groupInfoModal');
                chatRoom.style.display = 'none'; emptyState.style.display = 'flex';
                showToast("Группа удалена", "info");
            }
        };
        leaveGroupBtn.onclick = async () => {
            if(confirm("Выйти из группы?")) {
                await updateDoc(doc(db, "groups", currentChatId), { members: arrayRemove(auth.currentUser.uid) });
                await deleteDoc(doc(db, "users", auth.currentUser.uid, "chats", currentChatId));
                closeModal('groupInfoModal');
                chatRoom.style.display = 'none'; emptyState.style.display = 'flex';
                showToast("Вы вышли", "info");
            }
        };
    }
});

const userSearchInput = document.getElementById('userSearchInput');
const userSearchBtn = document.getElementById('userSearchBtn');
const searchResultsList = document.getElementById('searchResultsList');
const myFriendsList = document.getElementById('myFriendsList');
const friendRequestsList = document.getElementById('friendRequestsList');

if(userSearchBtn) {
    userSearchBtn.addEventListener('click', async () => {
        const queryText = userSearchInput.value.trim();
        if(!queryText) return;
        
        searchResultsList.innerHTML = '<div style="color:#888;">Поиск...</div>';
        
        try {
            let searchText = queryText.startsWith('@') ? queryText.substring(1) : queryText;
            const q = query(collection(db, "users"), where("username", "==", searchText));
            const snap = await getDocs(q);
            
            searchResultsList.innerHTML = '';
            if(snap.empty) {
                searchResultsList.innerHTML = '<div style="color:#888;">Не найдено</div>';
                return;
            }
            
            snap.forEach(d => {
                if(d.id === auth.currentUser.uid) return; 
                const u = d.data();
                const card = document.createElement('div');
                card.className = 'friend-card';
                card.innerHTML = `
                    <img src="${u.photoURL}">
                    <div class="friend-name">${u.displayName}<br><span style="font-size:11px;color:#888;">@${u.username}</span></div>
                    <button class="btn-add-friend" onclick="sendFriendRequest('${d.id}')">Добавить</button>
                `;
                searchResultsList.appendChild(card);
            });
        } catch(e) { console.error(e); }
    });
}

window.sendFriendRequest = async (targetId) => {
    try {
        await addDoc(collection(db, "friend_requests"), {
            from: auth.currentUser.uid,
            to: targetId,
            status: "pending",
            timestamp: serverTimestamp()
        });
        showToast("Заявка отправлена!", "success");
    } catch(e) { showToast("Ошибка: " + e.message, "error"); }
};

function loadFriendsList() {
    const q = query(collection(db, "users", auth.currentUser.uid, "friends"));
    onSnapshot(q, (snap) => {
        myFriendsList.innerHTML = '';
        if(snap.empty) { myFriendsList.innerHTML = '<div style="color:#888;">Нет друзей</div>'; return; }
        
        snap.forEach(async (friendDoc) => {
            const friendId = friendDoc.id;
            const uSnap = await getDoc(doc(db, "users", friendId));
            if(!uSnap.exists()) return;
            const u = uSnap.data();
            
            const card = document.createElement('div');
            card.className = 'friend-card';
            card.innerHTML = `
                <img src="${u.photoURL}">
                <div class="friend-name">${u.displayName}</div>
                <button class="icon-btn" style="color:#007bff;" onclick="startDirectChat('${friendId}')"><span class="material-symbols-outlined">chat</span></button>
            `;
            myFriendsList.appendChild(card);
        });
    });
}

window.startDirectChat = async (friendId) => {
    closeModal('friendsModal');
    const chatId = [auth.currentUser.uid, friendId].sort().join('_');
    
    await setDoc(doc(db, "users", auth.currentUser.uid, "chats", chatId), {
        type: 'direct',
        partnerId: friendId,
        lastMessageTime: serverTimestamp()
    }, { merge: true });
    
    await setDoc(doc(db, "users", friendId, "chats", chatId), {
        type: 'direct',
        partnerId: auth.currentUser.uid,
        lastMessageTime: serverTimestamp()
    }, { merge: true });
    
    const uSnap = await getDoc(doc(db, "users", friendId));
    if(uSnap.exists()) openChat(chatId, 'direct', uSnap.data());
};

function loadFriendRequests() {
    const q = query(collection(db, "friend_requests"), where("to", "==", auth.currentUser.uid));
    onSnapshot(q, (snap) => {
        friendRequestsList.innerHTML = '';
        const badge = document.getElementById('sidebarRequestsBadge');
        const modalBadge = document.getElementById('modalRequestsBadge');
        
        if(snap.empty) {
            friendRequestsList.innerHTML = '<div style="color:#888;">Нет заявок</div>';
            if(badge) badge.style.display = 'none';
            if(modalBadge) modalBadge.style.display = 'none';
            return;
        }
        
        if(badge) badge.style.display = 'block';
        if(modalBadge) { modalBadge.style.display = 'flex'; modalBadge.textContent = snap.size; }

        snap.forEach(async (reqDoc) => {
            const data = reqDoc.data();
            const uSnap = await getDoc(doc(db, "users", data.from));
            if(!uSnap.exists()) return;
            const u = uSnap.data();
            
            const card = document.createElement('div');
            card.className = 'friend-card';
            card.innerHTML = `
                <img src="${u.photoURL}">
                <div class="friend-name">${u.displayName}<br><span style="font-size:10px;">хочет дружить</span></div>
                <button class="btn-add-friend" onclick="acceptRequest('${reqDoc.id}', '${data.from}')">V</button>
                <button class="btn-remove-friend" style="margin-left:5px;" onclick="rejectRequest('${reqDoc.id}')">X</button>
            `;
            friendRequestsList.appendChild(card);
        });
    });
}

window.acceptRequest = async (reqId, fromId) => {
    await setDoc(doc(db, "users", auth.currentUser.uid, "friends", fromId), { since: serverTimestamp() });
    await setDoc(doc(db, "users", fromId, "friends", auth.currentUser.uid), { since: serverTimestamp() });
    await deleteDoc(doc(db, "friend_requests", reqId));
    showToast("Друг добавлен", "success");
};

window.rejectRequest = async (reqId) => {
    await deleteDoc(doc(db, "friend_requests", reqId));
};

window.loadUsersForGroupCreation = async () => {
    const list = document.getElementById('usersForGroupList');
    list.innerHTML = 'Загрузка...';
    const q = query(collection(db, "users", auth.currentUser.uid, "friends"));
    const snap = await getDocs(q);
    list.innerHTML = '';
    
    if(snap.empty) { list.innerHTML = 'Нет друзей для добавления'; return; }
    
    for(const d of snap.docs) {
        const uSnap = await getDoc(doc(db, "users", d.id));
        const u = uSnap.data();
        const div = document.createElement('div');
        div.className = 'grid-user-card';
        div.onclick = () => {
            div.classList.toggle('selected');
            const cb = div.querySelector('input');
            cb.checked = !cb.checked;
        };
        div.innerHTML = `
            <img src="${u.photoURL}" class="grid-avatar">
            <div class="grid-name">${u.displayName}</div>
            <div class="grid-check"><span class="material-symbols-outlined" style="font-size:12px;">check</span></div>
            <input type="checkbox" class="hidden-checkbox" value="${d.id}">
        `;
        list.appendChild(div);
    }
};

document.getElementById('confirmCreateGroupBtn').addEventListener('click', async () => {
    const name = document.getElementById('newGroupName').value.trim();
    if(!name) return showToast("Введите название", "error");
    
    const checkboxes = document.querySelectorAll('#usersForGroupList input:checked');
    const members = [auth.currentUser.uid];
    checkboxes.forEach(cb => members.push(cb.value));
    
    try {
        const groupRef = await addDoc(collection(db, "groups"), {
            name: name,
            owner: auth.currentUser.uid,
            members: members,
            createdAt: serverTimestamp()
        });
        
        const promises = members.map(uid => 
            setDoc(doc(db, "users", uid, "chats", groupRef.id), {
                type: 'group',
                groupId: groupRef.id,
                lastMessageTime: serverTimestamp()
            })
        );
        await Promise.all(promises);
        
        closeModal('createGroupModal');
        showToast("Группа создана", "success");
    } catch(e) { showToast("Ошибка: " + e.message, "error"); }
});