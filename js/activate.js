// Firebase init already loaded externally
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "/signin"; // redirect if not signed in
    return;
  }

  const uid = user.uid;
  const email = user.email;

  // Generate user-specific key that changes every 12 hours
  function generateUserKey(uid) {
    const now = Math.floor(Date.now() / (1000 * 60 * 60 * 12)); // 12h window
    const raw = uid + "-" + now;
    return sha256(raw).slice(0, 12); // Cut to 12 characters
  }

  const key = generateUserKey(uid);
  document.getElementById("key-display").innerText = key;

  // Store key in localStorage so browser/extension can read it later
  localStorage.setItem("gomegaKey", key);
});

// SHA256 hash function
function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  return crypto.subtle.digest("SHA-256", data).then(buf => {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  });
}
