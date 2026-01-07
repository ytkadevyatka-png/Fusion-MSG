// Импортируем библиотеки (используем версии для браузера через URL)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ТВОИ КЛЮЧИ (Вставь их сюда из прошлого файла)
const firebaseConfig = {
    apiKey: "AIzaSyActHO-UxEmTbjZ7So_bKeJeJy-MkEixik",
    authDomain: "fusion-ba14b.firebaseapp.com",
    projectId: "fusion-ba14b",
    storageBucket: "fusion-ba14b.firebasestorage.app",
    messagingSenderId: "647162448020",
    appId: "1:647162448020:web:497ca72499c8e659a48c81",
    measurementId: "G-4KJNJN4B5K"
};

// Инициализация
const app = initializeApp(firebaseConfig);

// Экспортируем инструменты, чтобы использовать их в других файлах
export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider(); // Это для входа через Google

console.log("Firebase Config загружен корректно");