import { auth, provider, db } from "./firebase-config.js";
import { signInWithPopup, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, updateDoc, serverTimestamp, getDocs, getDoc, query, collection, where, deleteDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast, openModal, closeModal } from "./toast.js";

// Элементы UI
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

// Элементы регистрации
const regUsername = document.getElementById('regUsername');
const regEmail = document.getElementById('regEmail');
const regPassword = document.getElementById('regPassword');
const regPasswordConfirm = document.getElementById('regPasswordConfirm');
const regCodeInput = document.getElementById('regCodeInput');

let generatedLoginCode = null;
let generatedRegCode = null;
let currentUserUid = null;

// Переменные для временного хранения выбранной темы (до сохранения)
let currentSelectedTheme = 'default';
let currentSelectedBg = 'bg-flow';

// --- ФУНКЦИИ ПРИМЕНЕНИЯ ТЕМ ---
function applyBgPattern(pattern) { 
    // Удаляем старые классы фона
    document.body.className.split(' ').forEach(cls => {
        if (cls.startsWith('bg-')) {
            document.body.classList.remove(cls);
        }
    });
    // Применяем новый, если он не 'none'
    if (pattern && pattern !== 'none') {
        document.body.classList.add(pattern); 
    }
}

function applyTheme(themeName) { 
    if (themeName === 'default' || !themeName) {
        document.body.removeAttribute('data-theme'); 
    } else {
        document.body.setAttribute('data-theme', themeName); 
    }
    
    // Обновляем визуальное выделение карточек в настройках
    document.querySelectorAll('.theme-card').forEach(c => { 
        c.classList.remove('active'); 
        if(c.getAttribute('data-theme') === themeName) c.classList.add('active'); 
    }); 
}

// Сброс настроек на дефолтные (при выходе)
function resetVisualSettings() {
    applyTheme('default');
    applyBgPattern('bg-flow');
    if(bgAnimSelect) bgAnimSelect.value = 'bg-flow';
}

// Обработчик выбора фона (только предпросмотр, сохранение по кнопке)
if(bgAnimSelect) {
    bgAnimSelect.addEventListener('change', () => { 
        currentSelectedBg = bgAnimSelect.value;
        // Можно сразу применить для предпросмотра
        applyBgPattern(currentSelectedBg); 
    }); 
}

// Обработчик клика по карточкам тем (предпросмотр)
document.querySelectorAll('.theme-card').forEach(card => { 
    card.addEventListener('click', () => { 
        document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active')); 
        card.classList.add('active'); 
        
        const theme = card.getAttribute('data-theme'); 
        currentSelectedTheme = theme;
        applyTheme(theme); 
    }); 
});

// --- НАВИГАЦИЯ ПО ВКЛАДКАМ ---
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

// --- ОТКРЫТИЕ/ЗАКРЫТИЕ ОКОН ---
if(settingsBtn) settingsBtn.addEventListener('click', () => openModal('settingsModal'));
if(closeSettings) closeSettings.addEventListener('click', () => {
    // Если закрыли без сохранения - можно вернуть как было, но для простоты оставим как есть
    closeModal('settingsModal');
});

if(toRegisterLink) toRegisterLink.addEventListener('click', (e) => { e.preventDefault(); loginForm.style.display = 'none'; registerChoice.style.display = 'flex'; });
if(backToLoginFromChoice) backToLoginFromChoice.addEventListener('click', (e) => { e.preventDefault(); registerChoice.style.display = 'none'; loginForm.style.display = 'flex'; });
if(toEmailRegBtn) toEmailRegBtn.addEventListener('click', () => { registerChoice.style.display = 'none'; registerEmailForm.style.display = 'flex'; });
if(backToChoice) backToChoice.addEventListener('click', (e) => { e.preventDefault(); registerEmailForm.style.display = 'none'; registerChoice.style.display = 'flex'; });

// --- КОД ПОДТВЕРЖДЕНИЯ ---
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
    const btn = document.getElementById(btnId); 
    const input = document.getElementById(inputId); 
    const timerDisplay = document.getElementById(timerId); 
    const code = Math.floor(100000 + Math.random() * 900000).toString(); 
    
    showToast(`Ваш код подтверждения: ${code}`, "info", 10000); 
    console.log("Код отправлен:", code);

    if (type === 'login') generatedLoginCode = code; 
    else generatedRegCode = code; 
    
    input.disabled = false; 
    input.focus(); 
    btn.disabled = true; 
    
    let timeLeft = 30; 
    const timer = setInterval(() => { 
        if(timerDisplay) timerDisplay.textContent = `Новый код через ${timeLeft} сек`; 
        timeLeft--; 
        if (timeLeft < 0) { 
            clearInterval(timer); 
            btn.disabled = false; 
            btn.textContent = "Код"; 
            if(timerDisplay) timerDisplay.textContent = ""; 
        } 
    }, 1000); 
}

if(document.getElementById('loginSendCodeBtn')) { document.getElementById('loginSendCodeBtn').addEventListener('click', () => { if(!document.getElementById('loginEmail').value) return showToast("Введите Email", "error"); sendCodeSimulate('login', 'loginSendCodeBtn', 'loginCodeInput', 'loginTimer'); }); }
if(document.getElementById('regSendCodeBtn')) { document.getElementById('regSendCodeBtn').addEventListener('click', () => { if(!document.getElementById('regEmail').value) return showToast("Введите Email", "error"); sendCodeSimulate('register', 'regSendCodeBtn', 'regCodeInput', 'regTimer'); }); }

// --- ВХОД (LOGIN) ---
const loginBtn = document.getElementById('loginBtn');
if(loginBtn) { 
    loginBtn.addEventListener('click', async () => { 
        const email = document.getElementById('loginEmail').value; 
        const pass = document.getElementById('loginPassword').value; 
        const code = document.getElementById('loginCodeInput').value; 
        
        if (!email || !pass) return showToast("Заполните почту и пароль", "error"); 
        if (!generatedLoginCode || code !== generatedLoginCode) return showToast("Неверный код подтверждения", "error"); 
        
        try { 
            await signInWithEmailAndPassword(auth, email, pass); 
            showToast("Вход выполнен успешно!", "success"); 
        } catch (e) { showToast("Ошибка входа: " + e.message, "error"); } 
    }); 
}

// --- РЕГИСТРАЦИЯ (REGISTER) ---
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
        if (pass !== confirm) return showToast("Пароли не совпадают", "error");
        if (!generatedRegCode || code !== generatedRegCode) return showToast("Неверный код", "error");

        try {
            const q = query(collection(db, "users"), where("username", "==", username));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) return showToast("Этот username уже занят", "error");

            const cred = await createUserWithEmailAndPassword(auth, email, pass);
            await updateProfile(cred.user, { displayName: username, photoURL: "https://cdn-icons-png.flaticon.com/512/847/847969.png" });
            await saveUserToDb(cred.user, 'online'); // Создаст запись с дефолтными настройками
            
            showToast("Регистрация успешна!", "success");
        } catch (e) { showToast("Ошибка: " + e.message, "error"); } 
    }); 
}

// --- GOOGLE LOGIN ---
const handleGoogle = async () => { 
    try { await signInWithPopup(auth, provider); showToast("Вход через Google успешен", "success"); } 
    catch (e) { if (e.code === 'auth/popup-closed-by-user') showToast("Вход отменен", "info"); else showToast("Ошибка: " + e.message, "error"); } 
};
if(document.getElementById('googleLoginBtn')) document.getElementById('googleLoginBtn').addEventListener('click', handleGoogle);
if(document.getElementById('googleRegBtn')) document.getElementById('googleRegBtn').addEventListener('click', handleGoogle);

// --- СЛУШАТЕЛЬ АВТОРИЗАЦИИ (ЗАГРУЗКА НАСТРОЕК) ---
onAuthStateChanged(auth, async (user) => {
    if (user) { 
        currentUserUid = user.uid; 
        closeModal('authModal'); 
        
        if(settingsProfileInfo) { 
            settingsProfileInfo.innerHTML = `<img src="${user.photoURL || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'}"><h2>${user.displayName || 'User'}</h2><p>${user.email}</p>`; 
        } 
        
        try {
            // 1. Обновляем статус
            await saveUserToDb(user, 'online');
            
            // 2. [НОВОЕ] Загружаем настройки пользователя из БД
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const data = userDoc.data();
                
                // Применяем тему из БД или дефолт
                const savedTheme = data.theme || 'default';
                const savedBg = data.bgPattern || 'bg-flow';
                
                applyTheme(savedTheme);
                applyBgPattern(savedBg);
                
                // Синхронизируем переменные выбора
                currentSelectedTheme = savedTheme;
                currentSelectedBg = savedBg;
                if(bgAnimSelect) bgAnimSelect.value = savedBg;
                if(statusSelect && data.status) statusSelect.value = data.status;
                if(customStatusInput && data.customStatusText) customStatusInput.value = data.customStatusText;
            }

        } catch(e) { console.error("Ошибка при входе:", e); }

    } else { 
        // Если вышли - сбрасываем всё
        currentUserUid = null; 
        resetVisualSettings(); // Сброс визуальных настроек
        openModal('authModal'); 
        loginForm.style.display = 'flex'; 
        registerChoice.style.display = 'none'; 
        registerEmailForm.style.display = 'none'; 
    }
});

async function saveUserToDb(user, statusOverride = null) {
    const userRef = doc(db, "users", user.uid); 
    const snap = await getDoc(userRef);
    let username = user.displayName;
    if (snap.exists() && snap.data().username) { username = snap.data().username; }

    const data = { 
        uid: user.uid, 
        displayName: user.displayName || "User", 
        username: username || "user",
        email: user.email, 
        photoURL: user.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png", 
        lastLogin: serverTimestamp() 
    }; 
    if (statusOverride) { data.status = statusOverride; }
    
    // Используем set с merge, чтобы не затереть существующие настройки (theme, bgPattern)
    await setDoc(userRef, data, { merge: true });
}

// --- СОХРАНЕНИЕ НАСТРОЕК (В БД) ---
if(saveSettingsBtn) { 
    saveSettingsBtn.addEventListener('click', async () => { 
        if (!currentUserUid) return; 
        try { 
            const userRef = doc(db, "users", currentUserUid); 
            
            // Сохраняем все настройки: статус, текст, тему и фон
            await updateDoc(userRef, { 
                status: statusSelect.value, 
                customStatusText: customStatusInput.value,
                theme: currentSelectedTheme,
                bgPattern: currentSelectedBg
            }); 
            
            showToast("Настройки сохранены в аккаунте", "success"); 
        } catch (e) { showToast(e.message, "error"); } 
    }); 
}

// --- ВЫХОД ---
if(logoutBtn) { 
    logoutBtn.addEventListener('click', async () => { 
        if (currentUserUid) { 
            const userRef = doc(db, "users", currentUserUid); 
            await updateDoc(userRef, { status: 'offline' }); 
        } 
        await signOut(auth); 
        resetVisualSettings(); // Сбрасываем тему при выходе
        closeModal('settingsModal'); 
        showToast("Вы вышли из аккаунта", "info"); 
    }); 
}

// --- УДАЛЕНИЕ АККАУНТА ---
if(deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
        const confirmed = await showAuthConfirm("ВНИМАНИЕ! Удаление навсегда.\n1. Данные сотрутся.\n2. Вы исчезнете у друзей.\n\nУдалить?");
        if(!confirmed) return;
        
        if (currentUserUid) {
            document.body.style.cursor = 'wait';
            
            try {
                // Очистка данных
                const groupsQ = query(collection(db, "groups"), where("members", "array-contains", currentUserUid));
                const groupsSnap = await getDocs(groupsQ);
                groupsSnap.forEach(async (gDoc) => { try { await updateDoc(doc(db, "groups", gDoc.id), { members: arrayRemove(currentUserUid) }); } catch(e) {} });

                const myFriendsSnap = await getDocs(collection(db, "users", currentUserUid, "friends"));
                const removeFriendPromises = myFriendsSnap.docs.map(friendDoc => {
                    const friendId = friendDoc.id; 
                    return deleteDoc(doc(db, "users", friendId, "friends", currentUserUid));
                });
                await Promise.all(removeFriendPromises);

                const sentReqQ = query(collection(db, "friend_requests"), where("from", "==", currentUserUid));
                const sentSnap = await getDocs(sentReqQ);
                sentSnap.forEach(async (d) => await deleteDoc(d.ref));

                const recReqQ = query(collection(db, "friend_requests"), where("to", "==", currentUserUid));
                const recSnap = await getDocs(recReqQ);
                recSnap.forEach(async (d) => await deleteDoc(d.ref));

                await deleteDoc(doc(db, "users", currentUserUid));
                
            } catch(e) { console.warn("Частичная ошибка очистки:", e); }

            try {
                const user = auth.currentUser;
                await user.delete();
                
                document.body.style.cursor = 'default';
                closeModal('settingsModal');
                resetVisualSettings(); // Сброс темы
                alert("Аккаунт удален.");
                window.location.reload();
            } catch(e) {
                document.body.style.cursor = 'default';
                if (e.code === 'auth/requires-recent-login') {
                    alert("Для удаления требуется недавний вход. Войдите заново и повторите попытку.");
                    await signOut(auth);
                    window.location.reload();
                } else {
                    alert("Ошибка: " + e.message);
                }
            }
        }
    });
}

window.addEventListener("beforeunload", () => { if (currentUserUid) { const userRef = doc(db, "users", currentUserUid); updateDoc(userRef, { status: 'offline' }); } });