import { auth, provider, db } from "./firebase-config.js";
import { signInWithPopup, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, serverTimestamp, getDocs, getDoc, query, collection, where, deleteDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast, openModal, closeModal } from "./toast.js";

const authModal = document.getElementById('authModal');
const loginForm = document.getElementById('loginForm');
const registerChoice = document.getElementById('registerChoice');
const registerEmailForm = document.getElementById('registerEmailForm');
const toRegisterLink = document.getElementById('toRegisterLink');
const backToLoginFromChoice = document.getElementById('backToLoginFromChoice');
const toEmailRegBtn = document.getElementById('toEmailRegBtn');
const backToChoice = document.getElementById('backToChoice');
const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettings = document.getElementById('closeSettings');
const logoutBtn = document.getElementById('logoutBtn');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsProfileInfo = document.getElementById('settingsProfileInfo');
const statusSelect = document.getElementById('statusSelect');
const customStatusInput = document.getElementById('customStatusInput');
const bgAnimSelect = document.getElementById('bgAnimSelect');

// Профиль и Setup
const setupAvatarUrl = document.getElementById('setupAvatarUrl');
const setupAvatarPreview = document.getElementById('setupAvatarPreview');
const setupDisplayName = document.getElementById('setupDisplayName');
const setupUsername = document.getElementById('setupUsername');
const finishSetupBtn = document.getElementById('finishSetupBtn');

const openEditProfileBtn = document.getElementById('openEditProfileBtn');
const editProfileModal = document.getElementById('editProfileModal');
const closeEditProfile = document.getElementById('closeEditProfile');
const editAvatarUrl = document.getElementById('editAvatarUrl');
const editAvatarPreview = document.getElementById('editAvatarPreview');
const editDisplayName = document.getElementById('editDisplayName');
const editUsername = document.getElementById('editUsername');
const saveProfileChangesBtn = document.getElementById('saveProfileChangesBtn');

const regUsername = document.getElementById('regUsername');
const regEmail = document.getElementById('regEmail');
const regPassword = document.getElementById('regPassword');
const regPasswordConfirm = document.getElementById('regPasswordConfirm');
const regCodeInput = document.getElementById('regCodeInput');

let generatedLoginCode = null;
let generatedRegCode = null;
let currentUserUid = null;
let currentSelectedTheme = 'default';
let currentSelectedBg = 'bg-flow';

const savedTheme = localStorage.getItem('fusion-theme') || 'default';
applyTheme(savedTheme);
const savedBgPattern = localStorage.getItem('fusion-bg-pattern') || 'bg-flow';
applyBgPattern(savedBgPattern);

if(bgAnimSelect) {
    bgAnimSelect.value = savedBgPattern;
    bgAnimSelect.addEventListener('change', () => { 
        currentSelectedBg = bgAnimSelect.value;
        applyBgPattern(currentSelectedBg); 
    }); 
}

function applyBgPattern(pattern) { 
    document.body.className.split(' ').forEach(cls => { if (cls.startsWith('bg-')) document.body.classList.remove(cls); });
    if (pattern && pattern !== 'none') document.body.classList.add(pattern); 
}

function applyTheme(themeName) { 
    if (themeName === 'default' || !themeName) document.body.removeAttribute('data-theme'); 
    else document.body.setAttribute('data-theme', themeName); 
    document.querySelectorAll('.theme-card').forEach(c => { c.classList.remove('active'); if(c.getAttribute('data-theme') === themeName) c.classList.add('active'); }); 
}

document.querySelectorAll('.theme-card').forEach(card => { 
    card.addEventListener('click', () => { const theme = card.getAttribute('data-theme'); currentSelectedTheme = theme; applyTheme(theme); }); 
});

function resetVisualSettings() { applyTheme('default'); applyBgPattern('bg-flow'); if(bgAnimSelect) bgAnimSelect.value = 'bg-flow'; }

document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.modal-nav-item');
    if (!tabBtn) return;
    const modal = tabBtn.closest('.modal');
    if (!modal) return;
    const allTabs = modal.querySelectorAll('.modal-nav-item');
    allTabs.forEach(btn => btn.classList.remove('active'));
    tabBtn.classList.add('active');
    const targetId = tabBtn.getAttribute('data-target');
    const allPanes = modal.querySelectorAll('.tab-pane');
    allPanes.forEach(pane => pane.classList.remove('active'));
    const targetPane = document.getElementById(targetId);
    if(targetPane) targetPane.classList.add('active');
});

if(settingsBtn) settingsBtn.addEventListener('click', () => openModal('settingsModal'));
if(closeSettings) closeSettings.addEventListener('click', () => closeModal('settingsModal'));
if(toRegisterLink) toRegisterLink.addEventListener('click', (e) => { e.preventDefault(); loginForm.style.display = 'none'; registerChoice.style.display = 'flex'; });
if(backToLoginFromChoice) backToLoginFromChoice.addEventListener('click', (e) => { e.preventDefault(); registerChoice.style.display = 'none'; loginForm.style.display = 'flex'; });
if(toEmailRegBtn) toEmailRegBtn.addEventListener('click', () => { registerChoice.style.display = 'none'; registerEmailForm.style.display = 'flex'; });
if(backToChoice) backToChoice.addEventListener('click', (e) => { e.preventDefault(); registerEmailForm.style.display = 'none'; registerChoice.style.display = 'flex'; });

function showAuthConfirm(msg) {
    return new Promise((resolve) => {
        const text = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmOkBtn');
        const noBtn = document.getElementById('confirmCancelBtn');
        text.textContent = msg;
        openModal('customConfirmModal');
        yesBtn.onclick = null; noBtn.onclick = null;
        yesBtn.onclick = () => { closeModal('customConfirmModal'); resolve(true); };
        noBtn.onclick = () => { closeModal('customConfirmModal'); resolve(false); };
    });
}

function sendCodeSimulate(type, btnId, inputId, timerId) { 
    const btn = document.getElementById(btnId); const input = document.getElementById(inputId); const timerDisplay = document.getElementById(timerId); 
    const code = Math.floor(100000 + Math.random() * 900000).toString(); 
    showToast(`Ваш код подтверждения: ${code}`, "info", 10000); console.log("Code:", code);
    if (type === 'login') generatedLoginCode = code; else generatedRegCode = code; 
    input.disabled = false; input.focus(); btn.disabled = true; 
    let timeLeft = 30; const timer = setInterval(() => { if(timerDisplay) timerDisplay.textContent = `Новый код через ${timeLeft} сек`; timeLeft--; if (timeLeft < 0) { clearInterval(timer); btn.disabled = false; btn.textContent = "Код"; if(timerDisplay) timerDisplay.textContent = ""; } }, 1000); 
}
if(document.getElementById('loginSendCodeBtn')) { document.getElementById('loginSendCodeBtn').addEventListener('click', () => { if(!document.getElementById('loginEmail').value) return showToast("Введите Email", "error"); sendCodeSimulate('login', 'loginSendCodeBtn', 'loginCodeInput', 'loginTimer'); }); }
if(document.getElementById('regSendCodeBtn')) { document.getElementById('regSendCodeBtn').addEventListener('click', () => { if(!document.getElementById('regEmail').value) return showToast("Введите Email", "error"); sendCodeSimulate('register', 'regSendCodeBtn', 'regCodeInput', 'regTimer'); }); }

const loginBtn = document.getElementById('loginBtn');
if(loginBtn) { 
    loginBtn.addEventListener('click', async () => { 
        const email = document.getElementById('loginEmail').value; 
        const pass = document.getElementById('loginPassword').value; 
        const code = document.getElementById('loginCodeInput').value; 
        if (!email || !pass) return showToast("Заполните почту и пароль", "error"); 
        if (code !== generatedLoginCode) return showToast("Неверный код подтверждения", "error"); 
        try { await signInWithEmailAndPassword(auth, email, pass); showToast("Вход выполнен успешно!", "success"); } 
        catch (e) { showToast("Ошибка входа: " + e.message, "error"); } 
    }); 
}

// === ИСПРАВЛЕННАЯ РЕГИСТРАЦИЯ (СНАЧАЛА ВХОД, ПОТОМ ПРОВЕРКА БД) ===
const regBtn = document.getElementById('regBtn');
if(regBtn) { 
    regBtn.addEventListener('click', async () => { 
        const username = regUsername.value.trim();
        const email = regEmail.value.trim();
        const pass = regPassword.value;
        const confirm = regPasswordConfirm.value;
        const code = regCodeInput.value;

        if (!username) return showToast("Введите username", "error");
        if (username.length < 3) return showToast("Username слишком короткий", "error");
        if (!email) return showToast("Введите Email", "error");
        if (!pass) return showToast("Введите пароль", "error");
        if (pass !== confirm) return showToast("Пароли не совпадают", "error");
        
        // Проверка кода
        if (code !== generatedRegCode) {
            return showToast("Неверный код (нажмите 'Код')", "error");
        }

        try {
            // 1. Создаем пользователя в Auth (получаем права доступа)
            let cred;
            try {
                cred = await createUserWithEmailAndPassword(auth, email, pass);
            } catch(e) {
                if (e.code === 'auth/email-already-in-use') throw new Error("Этот Email уже занят");
                throw new Error(e.message);
            }

            // 2. Теперь, когда мы авторизованы, проверяем никнейм в БД
            const q = query(collection(db, "users"), where("username", "==", username));
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                // Если занято - удаляем аккаунт и сообщаем ошибку
                await cred.user.delete();
                return showToast("Этот username уже занят", "error");
            }

            // 3. Обновляем профиль Firebase Auth
            await updateProfile(cred.user, { 
                displayName: username, 
                photoURL: "https://cdn-icons-png.flaticon.com/512/847/847969.png" 
            });
            
            // 4. Сохраняем пользователя в Firestore
            // Ставим isProfileSetup: false, чтобы запустить процесс настройки профиля
            await saveUserToDb(cred.user, 'online', { 
                username: username, 
                theme: 'default', 
                bgPattern: 'bg-flow', 
                isProfileSetup: false 
            });
            
            showToast("Регистрация успешна!", "success");

        } catch (e) { 
            console.error("Registration error:", e);
            if (e.message.includes("Missing or insufficient permissions")) {
                showToast("Ошибка доступа к базе. Проверьте правила Firestore.", "error");
            } else {
                showToast("Ошибка: " + e.message, "error"); 
            }
        } 
    }); 
}

const handleGoogle = async () => { try { await signInWithPopup(auth, provider); showToast("Вход через Google успешен", "success"); } catch (e) { if (e.code === 'auth/popup-closed-by-user') showToast("Вход отменен", "info"); else showToast("Ошибка Google: " + e.message, "error"); } };
if(document.getElementById('googleLoginBtn')) document.getElementById('googleLoginBtn').addEventListener('click', handleGoogle);
if(document.getElementById('googleRegBtn')) document.getElementById('googleRegBtn').addEventListener('click', handleGoogle);

onAuthStateChanged(auth, async (user) => {
    if (user) { 
        currentUserUid = user.uid; 
        closeModal('authModal'); 
        if(settingsProfileInfo) { settingsProfileInfo.innerHTML = `<img src="${user.photoURL || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'}"><h2>${user.displayName || 'User'}</h2><p>${user.email}</p>`; } 
        await saveUserToDb(user, 'online');
        
        // --- ПРОВЕРКА НАСТРОЙКИ ПРОФИЛЯ ---
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            applyTheme(data.theme || 'default');
            applyBgPattern(data.bgPattern || 'bg-flow');
            currentSelectedTheme = data.theme || 'default';
            currentSelectedBg = data.bgPattern || 'bg-flow';
            if(bgAnimSelect) bgAnimSelect.value = data.bgPattern || 'bg-flow';
            if(statusSelect && data.status) statusSelect.value = data.status;
            if(customStatusInput && data.customStatusText) customStatusInput.value = data.customStatusText;

            // Если профиль не настроен - открываем модалку setup
            if (!data.isProfileSetup) {
                openModal('initialSetupModal');
                setupUsername.value = data.username || '';
                setupDisplayName.value = user.displayName || '';
                setupAvatarUrl.value = user.photoURL || '';
                setupAvatarPreview.src = user.photoURL || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';
            }
        }
    } 
    else { currentUserUid = null; resetVisualSettings(); openModal('authModal'); loginForm.style.display = 'flex'; registerChoice.style.display = 'none'; registerEmailForm.style.display = 'none'; }
});

async function saveUserToDb(user, statusOverride = null, extraData = {}) {
    const userRef = doc(db, "users", user.uid); 
    const snap = await getDoc(userRef);
    let username = user.displayName;
    if (snap.exists() && snap.data().username) username = snap.data().username;
    if (extraData.username) username = extraData.username;

    const data = { 
        uid: user.uid, displayName: user.displayName || "User", username: username || "user", email: user.email, 
        photoURL: user.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png", 
        lastLogin: serverTimestamp(), ...extraData 
    }; 
    if (statusOverride) data.status = statusOverride; 
    await setDoc(userRef, data, { merge: true });
}

// --- ЛОГИКА SETUP ПРОФИЛЯ ---
if(setupAvatarUrl) {
    setupAvatarUrl.addEventListener('input', () => { setupAvatarPreview.src = setupAvatarUrl.value || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'; });
}
if(finishSetupBtn) {
    finishSetupBtn.addEventListener('click', async () => {
        const dName = setupDisplayName.value.trim();
        const uName = setupUsername.value.trim();
        const ava = setupAvatarUrl.value.trim() || "https://cdn-icons-png.flaticon.com/512/847/847969.png";

        if(dName.length < 1 || uName.length < 3) return showToast("Заполните имя и username (мин 3 символа)", "error");

        try {
            const userRef = doc(db, "users", currentUserUid);
            const snap = await getDoc(userRef);
            if(snap.data().username !== uName) {
                const q = query(collection(db, "users"), where("username", "==", uName));
                const check = await getDocs(q);
                if(!check.empty) return showToast("Username занят", "error");
            }

            await updateProfile(auth.currentUser, { displayName: dName, photoURL: ava });
            await updateDoc(userRef, {
                displayName: dName, username: uName, photoURL: ava, isProfileSetup: true,
                lastUsernameChange: serverTimestamp()
            });
            
            closeModal('initialSetupModal');
            showToast("Профиль настроен!", "success");
            window.location.reload(); 
        } catch(e) { showToast("Ошибка: " + e.message, "error"); }
    });
}

// --- ЛОГИКА РЕДАКТИРОВАНИЯ ПРОФИЛЯ ---
if(openEditProfileBtn) {
    openEditProfileBtn.addEventListener('click', async () => {
        closeModal('settingsModal');
        openModal('editProfileModal');
        const userRef = doc(db, "users", currentUserUid);
        const snap = await getDoc(userRef);
        if(snap.exists()) {
            const d = snap.data();
            editDisplayName.value = d.displayName;
            editUsername.value = d.username;
            editAvatarUrl.value = d.photoURL;
            editAvatarPreview.src = d.photoURL;
        }
    });
}
if(closeEditProfile) closeEditProfile.addEventListener('click', () => { closeModal('editProfileModal'); openModal('settingsModal'); }); // Возврат в настройки
if(editAvatarUrl) editAvatarUrl.addEventListener('input', () => { editAvatarPreview.src = editAvatarUrl.value || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'; });

if(saveProfileChangesBtn) {
    saveProfileChangesBtn.addEventListener('click', async () => {
        const dName = editDisplayName.value.trim();
        const uName = editUsername.value.trim();
        const ava = editAvatarUrl.value.trim() || "https://cdn-icons-png.flaticon.com/512/847/847969.png";

        if(dName.length < 1) return showToast("Имя не может быть пустым", "error");

        try {
            const userRef = doc(db, "users", currentUserUid);
            const snap = await getDoc(userRef);
            const data = snap.data();

            if(data.username !== uName) {
                const now = Date.now();
                const lastChange = data.lastUsernameChange ? data.lastUsernameChange.toMillis() : 0;
                if (now - lastChange < 60000) {
                    return showToast("Менять username можно раз в 1 минуту", "error");
                }
                
                const q = query(collection(db, "users"), where("username", "==", uName));
                const check = await getDocs(q);
                if(!check.empty) return showToast("Username занят", "error");
            }

            await updateProfile(auth.currentUser, { displayName: dName, photoURL: ava });
            
            const updates = { displayName: dName, photoURL: ava };
            if(data.username !== uName) {
                updates.username = uName;
                updates.lastUsernameChange = serverTimestamp();
            }

            await updateDoc(userRef, updates);
            
            closeModal('editProfileModal');
            showToast("Профиль обновлен", "success");
            if(settingsProfileInfo) settingsProfileInfo.innerHTML = `<img src="${ava}"><h2>${dName}</h2><p>${auth.currentUser.email}</p>`;
        } catch(e) { showToast("Ошибка: " + e.message, "error"); }
    });
}

if(saveSettingsBtn) { 
    saveSettingsBtn.addEventListener('click', async () => { 
        if (!currentUserUid) return; 
        try { 
            const userRef = doc(db, "users", currentUserUid); 
            await updateDoc(userRef, { status: statusSelect.value, customStatusText: customStatusInput.value, theme: currentSelectedTheme, bgPattern: currentSelectedBg }); 
            showToast("Настройки сохранены", "success"); 
        } catch (e) { showToast(e.message, "error"); } 
    }); 
}

if(logoutBtn) { logoutBtn.addEventListener('click', async () => { if (currentUserUid) { const userRef = doc(db, "users", currentUserUid); await updateDoc(userRef, { status: 'offline' }); } await signOut(auth); closeModal('settingsModal'); showToast("Вы вышли из аккаунта", "info"); }); }

if(deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
        const confirmed = await showAuthConfirm("ВНИМАНИЕ! Удаление навсегда.\nВсе данные будут стерты.\nПродолжить?");
        if(!confirmed) return;
        if (currentUserUid) {
            document.body.style.cursor = 'wait';
            try {
                const groupsQ = query(collection(db, "groups"), where("members", "array-contains", currentUserUid));
                const groupsSnap = await getDocs(groupsQ);
                groupsSnap.forEach(async (gDoc) => { try { await updateDoc(doc(db, "groups", gDoc.id), { members: arrayRemove(currentUserUid) }); } catch(e){} });
                const myFriendsSnap = await getDocs(collection(db, "users", currentUserUid, "friends"));
                const removeFriendPromises = myFriendsSnap.docs.map(friendDoc => { const friendId = friendDoc.id; return deleteDoc(doc(db, "users", friendId, "friends", currentUserUid)); });
                await Promise.all(removeFriendPromises);
                const sentReqQ = query(collection(db, "friend_requests"), where("from", "==", currentUserUid));
                const sentSnap = await getDocs(sentReqQ);
                sentSnap.forEach(async (d) => await deleteDoc(d.ref));
                const recReqQ = query(collection(db, "friend_requests"), where("to", "==", currentUserUid));
                const recSnap = await getDocs(recReqQ);
                recSnap.forEach(async (d) => await deleteDoc(d.ref));
                await deleteDoc(doc(db, "users", currentUserUid));
            } catch(e) { console.warn("Partial clean error:", e); }
            try { const user = auth.currentUser; await user.delete(); document.body.style.cursor = 'default'; closeModal('settingsModal'); resetVisualSettings(); alert("Аккаунт удален."); window.location.reload(); } 
            catch(e) { document.body.style.cursor = 'default'; if (e.code === 'auth/requires-recent-login') { alert("Требуется свежий вход. Войдите заново и сразу удалите аккаунт."); await signOut(auth); window.location.reload(); } else { alert("Ошибка: " + e.message); } }
        }
    });
}

window.addEventListener("beforeunload", () => { if (currentUserUid) { const userRef = doc(db, "users", currentUserUid); updateDoc(userRef, { status: 'offline' }); } });