import { db, auth } from "./firebase-config.js"; // Убрали storage из импорта
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, where, doc, getDocs, setDoc, deleteDoc, updateDoc, arrayRemove, getDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast, openModal, closeModal } from "./toast.js";
import { initCallSystem, startCall } from "./call.js";

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

// Элементы новых функций
const typingIndicator = document.getElementById('typingIndicator');
const typingName = document.getElementById('typingName');
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
const msgContextMenu = document.getElementById('msgContextMenu');
const ctxEdit = document.getElementById('ctxEdit');
const ctxDelete = document.getElementById('ctxDelete');
const soundMsg = document.getElementById('soundMsg');

// Списки (для друзей и групп)
const userSearchInput = document.getElementById('userSearchInput');
const userSearchBtn = document.getElementById('userSearchBtn');
const searchResultsList = document.getElementById('searchResultsList');
const myFriendsList = document.getElementById('myFriendsList');
const friendRequestsList = document.getElementById('friendRequestsList');

// Переменные состояния
let currentChatUser = null; 
let currentChatGroup = null; 
let currentChatId = null;
let currentChatType = null;
let messagesUnsubscribe = null;
let typingTimeout = null;
let contextMenuMsgId = null;
let contextMenuMsgText = null;

// === ИНИЦИАЛИЗАЦИЯ ===
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        chatRoom.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }

    initCallSystem();

    // ЗАГРУЗКА СПИСКА ЧАТОВ
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
            
            const unreadCount = chatData.unreadCount || 0;
            const unreadBadgeHtml = unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : '';

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
                        ${unreadBadgeHtml}
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
                        ${unreadBadgeHtml}
                    `;
                });
            }
        }
    });

    // Профиль в сайдбаре
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

// === ОТКРЫТИЕ ЧАТА ===
async function openChat(chatId, type, data) {
    currentChatId = chatId;
    currentChatType = type;
    
    document.body.classList.add('mobile-chat-open');
    emptyState.style.display = 'none';
    chatRoom.style.display = 'flex';
    
    messagesList.innerHTML = '';
    if (messagesUnsubscribe) messagesUnsubscribe();

    updateDoc(doc(db, "users", auth.currentUser.uid, "chats", chatId), { unreadCount: 0 }).catch(console.error);

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
        callBtn.onclick = () => startCall(data.uid, data.displayName, data.photoURL, chatId, 'direct');
        if(headerRight) headerRight.appendChild(callBtn);

        onSnapshot(doc(db, "users", data.uid), (snap) => {
            const d = snap.data();
            if(d) chatHeaderStatus.textContent = d.status === 'online' ? 'В сети' : (d.status === 'busy' ? 'Занят' : 'Не в сети');
        });

    } else {
        currentChatGroup = data;
        currentChatUser = null;
        chatTitle.textContent = data.name;
        chatHeaderAvatar.innerHTML = `<div style="width:40px;height:40px;background:#007bff;border-radius:50%;display:flex;justify-content:center;align-items:center;color:white;"><span class="material-symbols-outlined">groups</span></div>`;
        chatHeaderStatus.textContent = `${data.members ? data.members.length : 0} участников`;
    }

    // Слушатель сообщений
    const collectionName = type === 'direct' ? 'chats' : 'groups';
    const q = query(collection(db, collectionName, chatId, "messages"), orderBy("timestamp", "asc"));
    
    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        messagesList.innerHTML = '';
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const msg = change.doc.data();
                if (msg.senderId !== auth.currentUser.uid && Date.now() - msg.timestamp?.toMillis() < 2000) {
                    if(soundMsg) soundMsg.play().catch(()=>{});
                }
            }
        });

        snapshot.forEach((doc) => {
            renderMessage(doc.data(), doc.id);
        });
        scrollToBottom();
    });

    // Слушатель "Печатает..."
    onSnapshot(doc(db, collectionName, chatId), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const typingUsers = d.typing || {};
        const myUid = auth.currentUser.uid;
        let isTyping = false;
        
        for (const uid in typingUsers) {
            if (uid !== myUid && typingUsers[uid] === true) {
                isTyping = true;
                if(type === 'direct') typingName.textContent = "Собеседник";
                else typingName.textContent = "Кто-то";
                break;
            }
        }
        typingIndicator.style.display = isTyping ? 'block' : 'none';
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
        div.textContent = msg.text;
    } else {
        div.className = `message-bubble ${isMe ? 'my-message' : 'friend-message'}`;
        
        if (msg.type === 'image') {
            // Картинка теперь это Base64 строка, браузер ее понимает так же, как URL
            div.innerHTML = `<img src="${msg.imageUrl}" class="msg-image">`;
            if (msg.text) div.innerHTML += `<div>${msg.text}</div>`;
        } else {
            div.textContent = msg.text;
        }

        if (isMe && msg.type === 'text') {
            div.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                openContextMenu(e.clientX, e.clientY, id, msg.text);
            });
            let timer;
            div.addEventListener('touchstart', (e) => {
                timer = setTimeout(() => openContextMenu(e.touches[0].clientX, e.touches[0].clientY, id, msg.text), 800);
            });
            div.addEventListener('touchend', () => clearTimeout(timer));
        }
    }
    messagesList.appendChild(div);
}

function scrollToBottom() {
    messagesList.scrollTop = messagesList.scrollHeight;
}

// === ОТПРАВКА СООБЩЕНИЙ ===
sendBtn.addEventListener('click', () => sendMessage()); // Фикс: передаем вызов функции
messageInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') sendMessage(); });

async function sendMessage(imageUrl = null) {
    const text = messageInput.value.trim();
    if (!text && !imageUrl) return;
    
    messageInput.value = ''; 
    const collectionName = currentChatType === 'direct' ? 'chats' : 'groups';
    
    try {
        const msgData = {
            text: text,
            senderId: auth.currentUser.uid,
            timestamp: serverTimestamp(),
            type: imageUrl ? 'image' : 'text'
        };
        // Если есть картинка (Base64), добавляем ее в документ
        if (imageUrl) msgData.imageUrl = imageUrl;

        await addDoc(collection(db, collectionName, currentChatId, "messages"), msgData);
        
        if (currentChatType === 'direct' && currentChatUser) {
            updateDoc(doc(db, "users", auth.currentUser.uid, "chats", currentChatId), { lastMessageTime: serverTimestamp() });
            updateDoc(doc(db, "users", currentChatUser.uid, "chats", currentChatId), { 
                lastMessageTime: serverTimestamp(),
                unreadCount: increment(1)
            });
        } 
        else if (currentChatType === 'group' && currentChatGroup) {
            currentChatGroup.members.forEach(uid => {
                const updateData = { lastMessageTime: serverTimestamp() };
                if (uid !== auth.currentUser.uid) updateData.unreadCount = increment(1);
                updateDoc(doc(db, "users", uid, "chats", currentChatId), updateData).catch(()=>{});
            });
        }
    } catch (e) {
        showToast("Ошибка отправки", "error");
        console.error(e); // Для отладки
    }
}

// === СЖАТИЕ ИЗОБРАЖЕНИЙ (ВМЕСТО STORAGE) ===
// Функция превращает файл в сжатую Base64 строку
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800; // Максимальная ширина
                const MAX_HEIGHT = 800; // Максимальная высота
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                
                // Сжимаем в JPEG с качеством 0.7 (70%)
                const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
            img.src = event.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

// === ОТПРАВКА ФАЙЛОВ ===
if(attachBtn) attachBtn.addEventListener('click', () => fileInput.click());

if(fileInput) fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Проверка размера файла (например, не больше 5МБ до сжатия)
    if (file.size > 5 * 1024 * 1024) {
        return showToast("Файл слишком большой (>5MB)", "error");
    }

    showToast("Обработка фото...", "info");
    
    try {
        // Сжимаем картинку
        const base64Image = await compressImage(file);
        
        // Проверяем, не превышает ли строка 1МБ (лимит Firestore)
        if (base64Image.length > 1000000) {
            return showToast("Сжатое фото слишком большое для Firestore", "error");
        }

        // Отправляем как текст
        await sendMessage(base64Image);
    } catch (err) {
        showToast("Ошибка обработки: " + err.message, "error");
    }
    fileInput.value = '';
});

// === ИНДИКАТОР ПЕЧАТИ ===
messageInput.addEventListener('input', () => {
    if (!currentChatId) return;
    const collectionName = currentChatType === 'direct' ? 'chats' : 'groups';
    
    const updateField = {};
    updateField[`typing.${auth.currentUser.uid}`] = true;
    updateDoc(doc(db, collectionName, currentChatId), updateField).catch(()=>{});

    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        const resetField = {};
        resetField[`typing.${auth.currentUser.uid}`] = false;
        updateDoc(doc(db, collectionName, currentChatId), resetField).catch(()=>{});
    }, 2000);
});

// === КОНТЕКСТНОЕ МЕНЮ ===
function openContextMenu(x, y, msgId, text) {
    contextMenuMsgId = msgId;
    contextMenuMsgText = text;
    msgContextMenu.style.display = 'flex';
    msgContextMenu.style.left = `${Math.min(x, window.innerWidth - 150)}px`;
    msgContextMenu.style.top = `${y}px`;
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#msgContextMenu')) msgContextMenu.style.display = 'none';
});

if(ctxDelete) ctxDelete.addEventListener('click', async () => {
    if (!contextMenuMsgId || !currentChatId) return;
    if (confirm("Удалить сообщение?")) {
        const collectionName = currentChatType === 'direct' ? 'chats' : 'groups';
        await deleteDoc(doc(db, collectionName, currentChatId, "messages", contextMenuMsgId));
        showToast("Сообщение удалено", "info");
    }
    msgContextMenu.style.display = 'none';
});

if(ctxEdit) ctxEdit.addEventListener('click', async () => {
    if (!contextMenuMsgId || !currentChatId) return;
    const newText = prompt("Измените сообщение:", contextMenuMsgText);
    if (newText !== null && newText !== contextMenuMsgText) {
        const collectionName = currentChatType === 'direct' ? 'chats' : 'groups';
        await updateDoc(doc(db, collectionName, currentChatId, "messages", contextMenuMsgId), { text: newText });
        showToast("Изменено", "success");
    }
    msgContextMenu.style.display = 'none';
});

// === УПРАВЛЕНИЕ ДРУЗЬЯМИ И ГРУППАМИ ===

if(backToChatsBtn) backToChatsBtn.addEventListener('click', () => document.body.classList.remove('mobile-chat-open'));

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

// Поиск юзеров
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

// Функции для глобального доступа
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

const confirmCreateGroupBtn = document.getElementById('confirmCreateGroupBtn');
if(confirmCreateGroupBtn) {
    confirmCreateGroupBtn.addEventListener('click', async () => {
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
}

// Инфо о группе
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

        if(deleteGroupBtn) deleteGroupBtn.onclick = async () => {
            if(confirm("Удалить группу?")) {
                await deleteDoc(doc(db, "groups", currentChatId));
                closeModal('groupInfoModal');
                chatRoom.style.display = 'none'; emptyState.style.display = 'flex';
                showToast("Группа удалена", "info");
            }
        };
        if(leaveGroupBtn) leaveGroupBtn.onclick = async () => {
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