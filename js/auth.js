import { auth, provider, db } from "./firebase-config.js";
import { signInWithPopup, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, deleteUser } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, serverTimestamp, getDocs, getDoc, query, collection, where, deleteDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast, openModal, closeModal } from "./toast.js";

// DOM Elements (Стандартные)
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
const appLoader = document.getElementById('appLoader');

// Setup & Edit Profile Elements
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

// Auth Input Elements
const regEmail = document.getElementById('regEmail');
const regPassword = document.getElementById('regPassword');
const regPasswordConfirm = document.getElementById('regPasswordConfirm');
const regCodeInput = document.getElementById('regCodeInput');

let generatedLoginCode = null;
let generatedRegCode = null;
let currentUserUid = null;
let currentSelectedTheme = localStorage.getItem('fusion-theme') || 'default';
let currentSelectedBg = localStorage.getItem('fusion-bg-pattern') || 'bg-flow';

// === НОВАЯ ЛОГИКА СТАТУСА (SMART STATUS) ===
// Функция для быстрой установки статуса
const setSmartStatus = (status) => {
    if (!currentUserUid) return;
    // Используем updateDoc (или setDoc с merge для надежности)
    const userRef = doc(db, "users", currentUserUid);
    updateDoc(userRef, { 
        status: status,
        lastSeen: serverTimestamp() 
    }).catch(console.error);
};

// 1. При переключении вкладки (свернул/развернул)
document.addEventListener("visibilitychange", () => {
    if (!currentUserUid) return;
    if (document.visibilityState === 'visible') {
        setSmartStatus('online');
    } else {
        // Когда вкладка не активна, ставим 'busy' (занят/отошел)
        setSmartStatus('busy');
    }
});

// 2. При закрытии страницы (Полный выход)
window.addEventListener("beforeunload", () => {
    if (currentUserUid) {
        // Пытаемся синхронно отправить статус offline
        setSmartStatus('offline');
    }
});
// ===============================================

// === ИНИЦИАЛИЗАЦИЯ ТЕМЫ ===
applyTheme(currentSelectedTheme);
applyBgPattern(currentSelectedBg);

// Авто-сохранение фона
if(bgAnimSelect) {
    bgAnimSelect.value = currentSelectedBg;
    bgAnimSelect.addEventListener('change', () => { 
        const newPattern = bgAnimSelect.value;
        currentSelectedBg = newPattern;
        applyBgPattern(newPattern); 
        localStorage.setItem('fusion-bg-pattern', newPattern);
        if (currentUserUid) {
            updateDoc(doc(db, "users", currentUserUid), { bgPattern: newPattern }).catch(console.error);
        }
    }); 
}

function applyBgPattern(pattern) { 
    document.body.className.split(' ').forEach(cls => { if (cls.startsWith('bg-')) document.body.classList.remove(cls); });
    if (pattern && pattern !== 'none') document.body.classList.add(pattern); 
}

function applyTheme(themeName) { 
    if (themeName === 'default' || !themeName) document.body.removeAttribute('data-theme'); 
    else document.body.setAttribute('data-theme', themeName); 
    
    document.querySelectorAll('.theme-card').forEach(c => { 
        c.classList.remove('active'); 
        if(c.getAttribute('data-theme') === themeName) c.classList.add('active'); 
    }); 
}

// Авто-сохранение темы
document.querySelectorAll('.theme-card').forEach(card => { 
    card.addEventListener('click', () => { 
        const theme = card.getAttribute('data-theme'); 
        currentSelectedTheme = theme; 
        applyTheme(theme); 
        localStorage.setItem('fusion-theme', theme);
        if (currentUserUid) {
            updateDoc(doc(db, "users", currentUserUid), { theme: theme }).catch(console.error);
        }
    }); 
});

// Функция сброса настроек при выходе
function resetVisualSettings() { 
    localStorage.removeItem('fusion-theme');
    localStorage.removeItem('fusion-bg-pattern');
    currentSelectedTheme = 'default';
    currentSelectedBg = 'bg-flow';
    applyTheme('default'); 
    applyBgPattern('bg-flow'); 
    if(bgAnimSelect) bgAnimSelect.value = 'bg-flow'; 
}

// === UI ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК (В МОДАЛКАХ) ===
document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.modal-nav-item');
    if (!tabBtn) return;
    const modal = tabBtn.closest('.modal'); 
    if (!modal) return;
    
    const allTabs = modal.querySelectorAll('.modal-nav-item');
    allTabs.forEach(btn => btn.classList.remove('active'));
    tabBtn.classList.add('active'); 

    const targetId = tabBtn.getAttribute('data-target');
    if (targetId) {
        const allPanes = modal.querySelectorAll('.tab-pane');
        allPanes.forEach(pane => pane.classList.remove('active')); 
        const targetPane = modal.querySelector(`#${targetId}`); 
        if (targetPane) targetPane.classList.add('active'); 
    }
});

// === UI СЛУШАТЕЛИ КНОПОК ===
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
        if(text) text.textContent = msg;
        openModal('customConfirmModal');
        
        const newYesBtn = yesBtn.cloneNode(true);
        const newNoBtn = noBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
        noBtn.parentNode.replaceChild(newNoBtn, noBtn);

        newYesBtn.onclick = () => { closeModal('customConfirmModal'); resolve(true); };
        newNoBtn.onclick = () => { closeModal('customConfirmModal'); resolve(false); };
    });
}

// Симуляция кода подтверждения
function sendCodeSimulate(type, btnId, inputId, timerId) { 
    const btn = document.getElementById(btnId); const input = document.getElementById(inputId); const timerDisplay = document.getElementById(timerId); 
    const code = Math.floor(100000 + Math.random() * 900000).toString(); 
    showToast(`Ваш код подтверждения: ${code}`, "info", 10000); 
    if (type === 'login') generatedLoginCode = code; else generatedRegCode = code; 
    input.disabled = false; input.focus(); btn.disabled = true; 
    let timeLeft = 30; const timer = setInterval(() => { if(timerDisplay) timerDisplay.textContent = `через ${timeLeft} сек`; timeLeft--; if (timeLeft < 0) { clearInterval(timer); btn.disabled = false; btn.textContent = "Код"; if(timerDisplay) timerDisplay.textContent = ""; } }, 1000); 
}
if(document.getElementById('loginSendCodeBtn')) { document.getElementById('loginSendCodeBtn').addEventListener('click', () => { if(!document.getElementById('loginEmail').value) return showToast("Введите Email", "error"); sendCodeSimulate('login', 'loginSendCodeBtn', 'loginCodeInput', 'loginTimer'); }); }
if(document.getElementById('regSendCodeBtn')) { document.getElementById('regSendCodeBtn').addEventListener('click', () => { if(!document.getElementById('regEmail').value) return showToast("Введите Email", "error"); sendCodeSimulate('register', 'regSendCodeBtn', 'regCodeInput', 'regTimer'); }); }

// === ЛОГИКА АВТОРИЗАЦИИ ===
const loginBtn = document.getElementById('loginBtn');
if(loginBtn) { 
    loginBtn.addEventListener('click', async () => { 
        const email = document.getElementById('loginEmail').value; 
        const pass = document.getElementById('loginPassword').value; 
        const code = document.getElementById('loginCodeInput').value; 
        if (!email || !pass) return showToast("Заполните почту и пароль", "error"); 
        if (code !== generatedLoginCode) return showToast("Неверный код подтверждения", "error"); 
        try { await signInWithEmailAndPassword(auth, email, pass); } 
        catch (e) { showToast("Ошибка входа: " + e.message, "error"); } 
    }); 
}

const regBtn = document.getElementById('regBtn');
if(regBtn) { 
    regBtn.addEventListener('click', async () => { 
        const email = regEmail.value.trim(); const pass = regPassword.value; const confirm = regPasswordConfirm.value; const code = regCodeInput.value;
        if (!email || !pass) return showToast("Заполните все поля", "error");
        if (pass !== confirm) return showToast("Пароли не совпадают", "error");
        if (code !== generatedRegCode) return showToast("Неверный код", "error");

        try {
            const cred = await createUserWithEmailAndPassword(auth, email, pass);
            await saveUserToDb(cred.user, 'online', { 
                theme: 'default', 
                bgPattern: 'bg-flow', 
                isProfileSetup: false 
            });
            showToast("Регистрация успешна!", "success");
        } catch (e) { showToast("Ошибка: " + e.message, "error"); } 
    }); 
}

const handleGoogle = async () => { try { await signInWithPopup(auth, provider); } catch (e) { if (e.code !== 'auth/popup-closed-by-user') showToast("Ошибка Google: " + e.message, "error"); } };
if(document.getElementById('googleLoginBtn')) document.getElementById('googleLoginBtn').addEventListener('click', handleGoogle);
if(document.getElementById('googleRegBtn')) document.getElementById('googleRegBtn').addEventListener('click', handleGoogle);

// === ГЛАВНЫЙ СЛУШАТЕЛЬ СОСТОЯНИЯ ===
onAuthStateChanged(auth, async (user) => {
    try {
        if (user) { 
            // ВХОД ВЫПОЛНЕН
            currentUserUid = user.uid; 
            closeModal('authModal'); 
            if(settingsProfileInfo) settingsProfileInfo.innerHTML = `<img src="${user.photoURL || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'}"><h2>${user.displayName || 'User'}</h2><p>${user.email}</p>`; 

            // Обновляем данные входа
            await saveUserToDb(user, 'online');
            
            // Загружаем настройки пользователя из БД
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const data = userDoc.data();
                if (data.theme) {
                    currentSelectedTheme = data.theme;
                    localStorage.setItem('fusion-theme', data.theme); 
                    applyTheme(data.theme);
                }
                if (data.bgPattern) {
                    currentSelectedBg = data.bgPattern;
                    localStorage.setItem('fusion-bg-pattern', data.bgPattern);
                    applyBgPattern(data.bgPattern);
                }
                // Если профиль не настроен - открываем окно настройки
                if (!data.isProfileSetup) {
                    openModal('initialSetupModal');
                    if(setupDisplayName) setupDisplayName.value = user.displayName || '';
                    if(setupAvatarUrl) setupAvatarUrl.value = user.photoURL || '';
                    if(setupAvatarPreview) setupAvatarPreview.src = user.photoURL || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';
                }
                // UI синхронизация
                if(bgAnimSelect) bgAnimSelect.value = currentSelectedBg;
                if(statusSelect && data.status) statusSelect.value = data.status;
                if(customStatusInput && data.customStatusText) customStatusInput.value = data.customStatusText;
            }
        } else {
            // ВЫХОД ВЫПОЛНЕН
            currentUserUid = null; 
            resetVisualSettings(); 
            openModal('authModal'); 
            if(loginForm) loginForm.style.display = 'flex'; 
            if(registerChoice) registerChoice.style.display = 'none'; 
            if(registerEmailForm) registerEmailForm.style.display = 'none';
        }
    } catch (e) {
        console.error("Auth Error:", e);
    } finally {
        if(appLoader) appLoader.classList.add('hidden');
    }
});

// Функция сохранения в БД
async function saveUserToDb(user, statusOverride = null, extraData = {}) {
    const userRef = doc(db, "users", user.uid); 
    const snap = await getDoc(userRef);
    
    let userData = {
        uid: user.uid, 
        email: user.email, 
        lastLogin: serverTimestamp(),
        ...extraData
    };

    if (snap.exists()) {
        const d = snap.data();
        if (!userData.displayName) userData.displayName = d.displayName || user.displayName || "User";
        if (!userData.photoURL) userData.photoURL = d.photoURL || user.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png";
        if (d.username) userData.username = d.username;
        if (d.theme && !extraData.theme) userData.theme = d.theme;
        if (d.bgPattern && !extraData.bgPattern) userData.bgPattern = d.bgPattern;
    } else {
        if (!userData.username) userData.username = "user";
    }

    if (statusOverride) userData.status = statusOverride; 
    await setDoc(userRef, userData, { merge: true });
}

// === СОХРАНЕНИЕ НАСТРОЕК ===
if(saveSettingsBtn) { 
    saveSettingsBtn.addEventListener('click', async () => { 
        if (!currentUserUid) return; 
        try { 
            localStorage.setItem('fusion-theme', currentSelectedTheme);
            localStorage.setItem('fusion-bg-pattern', currentSelectedBg);
            const userRef = doc(db, "users", currentUserUid); 
            await updateDoc(userRef, { 
                status: statusSelect.value, 
                customStatusText: customStatusInput.value, 
                theme: currentSelectedTheme, 
                bgPattern: currentSelectedBg 
            }); 
            showToast("Настройки сохранены", "success"); 
        } catch (e) { showToast(e.message, "error"); } 
    }); 
}

// === НАСТРОЙКА ПРОФИЛЯ ===
if(setupAvatarUrl) { setupAvatarUrl.addEventListener('input', () => { setupAvatarPreview.src = setupAvatarUrl.value || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'; }); }

if(finishSetupBtn) {
    finishSetupBtn.addEventListener('click', async () => {
        const dName = setupDisplayName.value.trim(); const uName = setupUsername.value.trim(); const ava = setupAvatarUrl.value.trim() || "https://cdn-icons-png.flaticon.com/512/847/847969.png";
        if(dName.length < 1 || uName.length < 3) return showToast("Заполните поля", "error");
        
        try {
            const q = query(collection(db, "users"), where("username", "==", uName));
            const check = await getDocs(q);
            if(!check.empty && check.docs[0].id !== currentUserUid) return showToast("Username занят", "error");

            await updateProfile(auth.currentUser, { displayName: dName, photoURL: ava });
            await saveUserToDb(auth.currentUser, 'online', { displayName: dName, username: uName, photoURL: ava, isProfileSetup: true });
            
            closeModal('initialSetupModal'); showToast("Профиль готов!", "success"); window.location.reload(); 
        } catch(e) { showToast("Ошибка: " + e.message, "error"); }
    });
}

// === РЕДАКТИРОВАНИЕ ПРОФИЛЯ ===
if(openEditProfileBtn) {
    openEditProfileBtn.addEventListener('click', async () => {
        closeModal('settingsModal'); openModal('editProfileModal');
        const snap = await getDoc(doc(db, "users", currentUserUid));
        if(snap.exists()) { const d = snap.data(); editDisplayName.value = d.displayName; editUsername.value = d.username; editAvatarUrl.value = d.photoURL; editAvatarPreview.src = d.photoURL; }
    });
}
if(closeEditProfile) closeEditProfile.addEventListener('click', () => { closeModal('editProfileModal'); openModal('settingsModal'); }); 
if(editAvatarUrl) editAvatarUrl.addEventListener('input', () => { editAvatarPreview.src = editAvatarUrl.value || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'; });

if(saveProfileChangesBtn) {
    saveProfileChangesBtn.addEventListener('click', async () => {
        const dName = editDisplayName.value.trim(); const uName = editUsername.value.trim(); const ava = editAvatarUrl.value.trim() || "https://cdn-icons-png.flaticon.com/512/847/847969.png";
        if(dName.length < 1) return showToast("Имя пустое", "error");
        try {
            const userRef = doc(db, "users", currentUserUid);
            const snap = await getDoc(userRef);
            const data = snap.data();

            if(data.username !== uName) {
                const q = query(collection(db, "users"), where("username", "==", uName)); const check = await getDocs(q);
                if(!check.empty) return showToast("Username занят", "error");
                const now = Date.now();
                const lastChange = data.lastUsernameChange ? data.lastUsernameChange.toMillis() : 0;
                if (now - lastChange < 60000) return showToast("Менять username можно раз в минуту", "error");
            }

            await updateProfile(auth.currentUser, { displayName: dName, photoURL: ava });
            let updates = { displayName: dName, photoURL: ava };
            if(data.username !== uName) { updates.username = uName; updates.lastUsernameChange = serverTimestamp(); }
            
            await updateDoc(userRef, updates);
            closeModal('editProfileModal'); showToast("Сохранено", "success");
            if(settingsProfileInfo) settingsProfileInfo.innerHTML = `<img src="${ava}"><h2>${dName}</h2><p>${auth.currentUser.email}</p>`;
        } catch(e) { showToast("Ошибка: " + e.message, "error"); }
    });
}

// === ВЫХОД ===
if(logoutBtn) { 
    logoutBtn.addEventListener('click', async () => { 
        if (currentUserUid) { 
            await updateDoc(doc(db, "users", currentUserUid), { status: 'offline' }); 
        } 
        await signOut(auth); 
        resetVisualSettings(); 
        closeModal('settingsModal'); 
        showToast("Выход выполнен", "info"); 
    }); 
}

// === УДАЛЕНИЕ АККАУНТА ===
if(deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
        const confirmed = await showAuthConfirm("Удалить аккаунт навсегда?");
        if(!confirmed) return;
        
        if (currentUserUid) {
            document.body.style.cursor = 'wait';
            try {
                // Чистим данные
                const myFriendsSnap = await getDocs(collection(db, "users", currentUserUid, "friends"));
                const removeFriendPromises = myFriendsSnap.docs.map(friendDoc => deleteDoc(doc(db, "users", friendDoc.id, "friends", currentUserUid)));
                await Promise.all(removeFriendPromises);
                
                const groupsQ = query(collection(db, "groups"), where("members", "array-contains", currentUserUid));
                const groupsSnap = await getDocs(groupsQ);
                groupsSnap.forEach(async (gDoc) => { try { await updateDoc(doc(db, "groups", gDoc.id), { members: arrayRemove(currentUserUid) }); } catch(e){} });

                // Удаляем документ юзера
                await deleteDoc(doc(db, "users", currentUserUid));

                // Удаляем юзера из Firebase Auth
                const user = auth.currentUser;
                await deleteUser(user);
                
                document.body.style.cursor = 'default';
                closeModal('settingsModal');
                resetVisualSettings();
                alert("Аккаунт удален.");
                window.location.reload();

            } catch(e) {
                if (e.code === 'auth/requires-recent-login') {
                    await signOut(auth);
                    resetVisualSettings();
                    alert("Требуется повторный вход для удаления.");
                    window.location.reload();
                } else {
                    document.body.style.cursor = 'default';
                    alert("Ошибка: " + e.message);
                }
            }
        }
    });
}