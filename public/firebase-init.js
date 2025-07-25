// firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCosaEc1xMspmr9Z0ykfI3_6Ksrp-3r5WM",
  authDomain: "gomega-65e3f.firebaseapp.com",
  projectId: "gomega-65e3f",
  storageBucket: "gomega-65e3f.appspot.com",
  messagingSenderId: "212961835634",
  appId: "1:212961835634:web:12330a07ff79668ea060eb"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export { app, db, auth, provider };
