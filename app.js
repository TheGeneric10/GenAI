const API = "http://127.0.0.1:5000";
const CREDIT_REFILL_MS = 8 * 60 * 60 * 1000;
const USER_ROOT = "Account/GenAI/users";

const firebaseConfig = {
  apiKey: "AIzaSyA375t6p_Zc9Ztfi-RUniqAmjttsjPyy1k",
  authDomain: "thegeneric-685b0.firebaseapp.com",
  databaseURL: "https://thegeneric-685b0-default-rtdb.firebaseio.com",
  projectId: "thegeneric-685b0",
  storageBucket: "thegeneric-685b0.firebasestorage.app",
  messagingSenderId: "272113167212",
  appId: "1:272113167212:web:edc531b45246ae1a292149",
  measurementId: "G-YPHPPZZM0K"
};

firebase.initializeApp(firebaseConfig);
try { firebase.analytics(); } catch (_) {}
const auth = firebase.auth();
const db = firebase.database();
const googleProvider = new firebase.auth.GoogleAuthProvider();

let sessions = [];
let activeId = null;
let activeModel = localStorage.getItem("genai_default_model") || "g0.5-mini";
let confirmCb = null;
let renameTarget = null;
let trashMode = null;
let currentUser = null;
let userProfile = null;
let guestCredits = 2.0;
let syncTimer = null;

const chatArea = document.getElementById("chat-area");
const promptInput = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");
const dot = document.getElementById("dot");
const dotLabel = document.getElementById("dot-label");
const chatTitle = document.getElementById("chat-title");
const histList = document.getElementById("hist-list");
const emptyState = document.getElementById("empty-state");
const engineHint = document.getElementById("engine-hint");
const profileAvatar = document.getElementById("profile-avatar");
const profileName = document.getElementById("profile-name");
const profileSub = document.getElementById("profile-sub");
const creditsPill = document.getElementById("credits-pill");
const btnAuthOpen = document.getElementById("btn-auth-open");
const btnAuthLogout = document.getElementById("btn-auth-logout");

function save() {
  if (isSignedIn()) queueCloudSync();
}
function isSignedIn() { return !!currentUser; }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function getActive() { return sessions.find(s => s.id === activeId) || null; }
function titleFrom(t) { return t.length > 32 ? t.slice(0, 32) + "..." : t; }
function escHtml(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function buildApiMessages(messages) {
  return (messages || []).map(m => ({
    role: m.role === "ai" ? "assistant" : m.role,
    content: m.text || ""
  })).filter(m => m.content.trim());
}
function sessionsToObject() {
  const out = {};
  sessions.forEach(s => { out[s.id] = s; });
  return out;
}
function objectToSessions(obj) {
  return Object.values(obj || {}).sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
}
function userBasePath(uid) { return `${USER_ROOT}/${uid}`; }
function userProfilePath(uid) { return `${userBasePath(uid)}/profile`; }
function userSessionsPath(uid) { return `${userBasePath(uid)}/sessions`; }
function getCredits() { return isSignedIn() ? Number(userProfile?.credits || 0) : guestCredits; }
function setCredits(value) {
  const fixed = Number(value.toFixed(2));
  if (isSignedIn()) {
    userProfile.credits = fixed;
    userProfile.updatedAt = Date.now();
    queueCloudSync();
  } else {
    guestCredits = fixed;
  }
  renderProfile();
}
function calculateUsageCost(prompt, response) {
  const tokens = Math.max(1, Math.ceil((prompt.length + response.length) / 4));
  return Number((0.02 + (tokens * 0.0025)).toFixed(2));
}
function applyUsageDeduction(prompt, response) {
  const cost = calculateUsageCost(prompt, response);
  setCredits(getCredits() - cost);
}
function canSendRequest() {
  if (getCredits() > 0) return true;
  const msg = isSignedIn() ? "Come back for more responses." : "Sign in to continue responses.";
  appendBubble("ai", msg, "rule", false);
  return false;
}
function setDot(state, label) { dot.className = "dot " + state; dotLabel.textContent = label; }

function applyCreditRefill(profile) {
  if (!profile.lastCreditAt) {
    profile.lastCreditAt = Date.now();
    return false;
  }
  const now = Date.now();
  const elapsed = now - profile.lastCreditAt;
  const steps = Math.floor(elapsed / CREDIT_REFILL_MS);
  if (steps <= 0) return false;
  profile.credits = Number((Number(profile.credits || 0) + steps).toFixed(2));
  profile.lastCreditAt += steps * CREDIT_REFILL_MS;
  profile.updatedAt = now;
  return true;
}

function queueCloudSync() {
  if (!isSignedIn()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const uid = currentUser.uid;
      await db.ref(userProfilePath(uid)).set(userProfile || {});
      await db.ref(userSessionsPath(uid)).set(sessionsToObject());
    } catch (_) {}
  }, 400);
}

async function loadUserCloudData(user) {
  const uid = user.uid;
  const profileSnap = await db.ref(userProfilePath(uid)).once("value");
  let profile = profileSnap.val();
  const now = Date.now();
  if (!profile) {
    profile = {
      uid,
      displayName: user.displayName || "User",
      email: user.email || "",
      photoURL: user.photoURL || "",
      credits: 2.0,
      lastCreditAt: now,
      createdAt: now,
      updatedAt: now
    };
  }
  if (applyCreditRefill(profile)) {
    await db.ref(userProfilePath(uid)).set(profile);
  }
  userProfile = profile;
  const sessionSnap = await db.ref(userSessionsPath(uid)).once("value");
  sessions = objectToSessions(sessionSnap.val());
  activeId = sessions.length ? sessions[sessions.length - 1].id : null;
}

function resetGuestState() {
  userProfile = null;
  sessions = [];
  activeId = null;
  guestCredits = 2.0;
  renderProfile();
  renderHist();
  renderManageList();
  renderChat();
  chatTitle.textContent = "GenAI";
  updateSettingsCounts();
}

function renderProfile() {
  if (isSignedIn()) {
    const name = userProfile?.displayName || currentUser.email || "User";
    profileName.textContent = name;
    profileSub.textContent = currentUser.email || "Signed in";
    profileAvatar.textContent = (name[0] || "U").toUpperCase();
    btnAuthOpen.style.display = "none";
    btnAuthLogout.style.display = "flex";
  } else {
    profileName.textContent = "Guest";
    profileSub.textContent = "Not signed in";
    profileAvatar.textContent = "G";
    btnAuthOpen.style.display = "flex";
    btnAuthLogout.style.display = "none";
  }
  creditsPill.textContent = `Credits: ${getCredits().toFixed(2)}`;
}

async function pollStatus() {
  try {
    const r = await fetch(`${API}/status`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const d = await r.json();
      setDot("green", "online");
      document.getElementById("s-backend").textContent = (API || window.location.origin).replace(/^https?:\/\//, "");
      document.getElementById("s-uptime").textContent = d.uptime_seconds + "s";
      const cloudUp = (typeof d.cloud === "boolean") ? d.cloud : !!d.ollama;
      document.getElementById("s-ollama").textContent = cloudUp ? "running" : "offline";
      document.getElementById("s-ollama").style.color = cloudUp ? "var(--dot-green)" : "var(--dot-red)";
      try {
        const hr = await fetch(`${API}/health/models`, { signal: AbortSignal.timeout(4000) });
        if (hr.ok) {
          const hd = await hr.json();
          const m = hd.models && hd.models[activeModel];
          const usable = !!(m && m.usable);
          engineHint.textContent = usable ? `${activeModel} · cloud` : `${activeModel} · rule`;
          engineHint.style.color = usable ? "var(--dot-green)" : "var(--dot-yellow)";
        } else {
          engineHint.textContent = cloudUp ? `${activeModel} · cloud` : `${activeModel} · rule`;
          engineHint.style.color = cloudUp ? "var(--dot-green)" : "var(--dot-yellow)";
        }
      } catch (_) {
        engineHint.textContent = cloudUp ? `${activeModel} · cloud` : `${activeModel} · rule`;
        engineHint.style.color = cloudUp ? "var(--dot-green)" : "var(--dot-yellow)";
      }
    } else {
      setDot("yellow", "degraded");
    }
  } catch (_) {
    setDot("red", "offline");
    engineHint.textContent = "offline";
  }
}
pollStatus();
setInterval(pollStatus, 7000);

const toggleDark = document.getElementById("toggle-dark");
function applyTheme(dark) {
  document.body.classList.toggle("light", !dark);
  toggleDark.checked = dark;
  localStorage.setItem("genai_dark", dark ? "1" : "0");
}
toggleDark.addEventListener("change", () => applyTheme(toggleDark.checked));
const savedDark = localStorage.getItem("genai_dark");
applyTheme(savedDark === null ? true : savedDark === "1");

const modelBtn = document.getElementById("model-btn");
const modelDropdown = document.getElementById("model-dropdown");
const modelBtnLabel = document.getElementById("model-btn-label");
const modelDotColor = document.getElementById("model-dot-color");
const settingsModel = document.getElementById("settings-model");
const defModelSelect = document.getElementById("default-model-select");
const modelDotClass = {"g0.5-nano":"md-nano","g0.5-mini":"md-mini","g0.5":"md-pro"};

function setModel(mid, { persistDefault = true, syncSession = true } = {}) {
  activeModel = mid;
  modelBtnLabel.textContent = mid;
  modelDotColor.className = "model-dot " + (modelDotClass[mid] || "md-mini");
  settingsModel.textContent = mid;
  defModelSelect.value = mid;
  document.querySelectorAll(".model-option").forEach(el => {
    el.classList.toggle("selected", el.dataset.model === mid);
  });
  if (persistDefault) localStorage.setItem("genai_default_model", mid);
  if (syncSession) {
    const s = getActive();
    if (s) {
      s.model = mid;
      s.updatedAt = Date.now();
      save();
      renderHist();
      renderManageList();
    }
  }
  modelDropdown.classList.remove("open");
  engineHint.textContent = mid + " · ...";
  pollStatus();
}

modelBtn.addEventListener("click", e => { e.stopPropagation(); modelDropdown.classList.toggle("open"); });
document.querySelectorAll(".model-option").forEach(el => el.addEventListener("click", () => setModel(el.dataset.model)));
document.addEventListener("click", () => modelDropdown.classList.remove("open"));
modelDropdown.addEventListener("click", e => e.stopPropagation());
defModelSelect.value = activeModel;
defModelSelect.addEventListener("change", () => setModel(defModelSelect.value));
setModel(activeModel);

const authOverlay = document.getElementById("auth-overlay");
const authTabSignIn = document.getElementById("auth-tab-signin");
const authTabSignUp = document.getElementById("auth-tab-signup");
const authPanelSignIn = document.getElementById("auth-panel-signin");
const authPanelSignUp = document.getElementById("auth-panel-signup");
function openAuth(mode = "signin") {
  authOverlay.classList.add("open");
  const signIn = mode === "signin";
  authTabSignIn.classList.toggle("active", signIn);
  authTabSignUp.classList.toggle("active", !signIn);
  authPanelSignIn.classList.toggle("open", signIn);
  authPanelSignUp.classList.toggle("open", !signIn);
}
function closeAuth() { authOverlay.classList.remove("open"); }
authOverlay.addEventListener("click", e => { if (e.target === authOverlay) closeAuth(); });
authTabSignIn.addEventListener("click", () => openAuth("signin"));
authTabSignUp.addEventListener("click", () => openAuth("signup"));
document.getElementById("auth-cancel").addEventListener("click", closeAuth);

document.getElementById("auth-signin").addEventListener("click", async () => {
  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;
  if (!email || !password) return alert("Enter email and password.");
  try { await auth.signInWithEmailAndPassword(email, password); closeAuth(); } catch (e) { alert(e.message); }
});
document.getElementById("auth-signup").addEventListener("click", async () => {
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  if (!name || !email || !password) return alert("Fill all sign up fields.");
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    if (cred.user) await cred.user.updateProfile({ displayName: name });
    closeAuth();
  } catch (e) { alert(e.message); }
});
document.getElementById("auth-google").addEventListener("click", async () => {
  try { await auth.signInWithPopup(googleProvider); closeAuth(); } catch (e) { alert(e.message); }
});

btnAuthOpen.addEventListener("click", () => openAuth("signin"));
btnAuthLogout.addEventListener("click", async () => {
  try { await auth.signOut(); } catch (_) {}
});

const confirmOverlay = document.getElementById("confirm-overlay");
function showConfirm(title, body, cb) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-body").textContent = body;
  confirmCb = cb;
  confirmOverlay.classList.add("open");
}
document.getElementById("confirm-cancel").addEventListener("click", () => confirmOverlay.classList.remove("open"));
document.getElementById("confirm-ok").addEventListener("click", () => { confirmOverlay.classList.remove("open"); if (confirmCb) confirmCb(); });
confirmOverlay.addEventListener("click", e => { if (e.target === confirmOverlay) confirmOverlay.classList.remove("open"); });

const renameOverlay = document.getElementById("rename-overlay");
const renameInput = document.getElementById("rename-input");
function openRenamePopup(sessionId) {
  const s = sessions.find(x => x.id === sessionId);
  if (!s) return;
  renameTarget = sessionId;
  renameInput.value = s.title || "";
  renameOverlay.classList.add("open");
  setTimeout(() => renameInput.focus(), 0);
}
function closeRenamePopup() { renameOverlay.classList.remove("open"); renameTarget = null; }
document.getElementById("rename-cancel").addEventListener("click", closeRenamePopup);
document.getElementById("rename-save").addEventListener("click", () => {
  const s = sessions.find(x => x.id === renameTarget);
  const title = renameInput.value.trim().slice(0, 80);
  if (!s || !title) return;
  s.title = title;
  s.updatedAt = Date.now();
  save();
  if (activeId === s.id) chatTitle.textContent = s.title;
  renderHist();
  renderManageList();
  closeRenamePopup();
});
renameOverlay.addEventListener("click", e => { if (e.target === renameOverlay) closeRenamePopup(); });

const archiveOverlay = document.getElementById("archive-overlay");
function openArchivePopup() {
  document.getElementById("archive-body").textContent = `Download ${sessions.length} chat(s) as a JSON archive.`;
  archiveOverlay.classList.add("open");
}
function closeArchivePopup() { archiveOverlay.classList.remove("open"); }
document.getElementById("archive-cancel").addEventListener("click", closeArchivePopup);
document.getElementById("archive-save").addEventListener("click", () => { archiveChats(); closeArchivePopup(); });
archiveOverlay.addEventListener("click", e => { if (e.target === archiveOverlay) closeArchivePopup(); });

const trashOverlay = document.getElementById("trash-overlay");
function openTrashPopup(mode, id = null) {
  trashMode = { mode, id };
  const body = document.getElementById("trash-body");
  body.textContent = mode === "one" ? "Delete this chat permanently. This cannot be undone." : "Delete all chats permanently. This cannot be undone.";
  trashOverlay.classList.add("open");
}
function closeTrashPopup() { trashOverlay.classList.remove("open"); trashMode = null; }
document.getElementById("trash-cancel").addEventListener("click", closeTrashPopup);
document.getElementById("trash-confirm").addEventListener("click", () => {
  if (!trashMode) return;
  if (trashMode.mode === "one" && trashMode.id) {
    deleteSession(trashMode.id);
  } else {
    clearAll();
    settingsOverlay.classList.remove("open");
    manageOverlay.classList.remove("open");
  }
  closeTrashPopup();
});
trashOverlay.addEventListener("click", e => { if (e.target === trashOverlay) closeTrashPopup(); });

function renderHist() {
  histList.innerHTML = "";
  if (!sessions.length) {
    histList.innerHTML = `<div style="font-size:11.5px;color:var(--text-dim);padding:6px 9px;">No chats yet</div>`;
    return;
  }
  [...sessions].reverse().forEach(s => {
    const el = document.createElement("div");
    el.className = "hi" + (s.id === activeId ? " active" : "");
    el.innerHTML = `<span class="hi-title">${escHtml(s.title)}</span>
      <button class="hi-del" title="Delete" data-id="${s.id}">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>`;
    el.addEventListener("click", e => { if (e.target.closest(".hi-del")) return; loadSession(s.id); });
    el.querySelector(".hi-del").addEventListener("click", e => { e.stopPropagation(); openTrashPopup("one", s.id); });
    histList.appendChild(el);
  });
}

function newChat() {
  const id = genId();
  sessions.push({ id, title: "New Chat", model: activeModel, messages: [], updatedAt: Date.now() });
  activeId = id;
  save();
  renderHist();
  renderChat();
  chatTitle.textContent = "New Chat";
}

function loadSession(id) {
  activeId = id;
  const s = getActive();
  if (s && s.model) setModel(s.model, { persistDefault: false, syncSession: false });
  chatTitle.textContent = s ? s.title : "GenAI";
  renderHist();
  renderChat();
}

function deleteSession(id) {
  sessions = sessions.filter(s => s.id !== id);
  if (activeId === id) activeId = sessions.length ? sessions[sessions.length - 1].id : null;
  save();
  renderHist();
  if (activeId) loadSession(activeId);
  else { renderChat(); chatTitle.textContent = "GenAI"; }
  renderManageList();
  updateSettingsCounts();
}

function clearAll() {
  sessions = [];
  activeId = null;
  save();
  renderHist();
  renderManageList();
  renderChat();
  chatTitle.textContent = "GenAI";
  updateSettingsCounts();
}

function renderChat() {
  chatArea.innerHTML = "";
  const s = getActive();
  if (!s || !s.messages.length) { chatArea.appendChild(emptyState); return; }
  s.messages.forEach(m => appendBubble(m.role, m.text, m.engine, m.thinking, false));
  chatArea.scrollTop = chatArea.scrollHeight;
}

function appendBubble(role, text, engine, thinking, anim = true) {
  if (emptyState.parentNode === chatArea) chatArea.removeChild(emptyState);
  const row = document.createElement("div");
  row.className = "msg-row";
  if (!anim) row.style.animation = "none";
  const isUser = role === "user";
  const thinkTag = (!isUser && thinking) ? `<span class="thinking-tag">ThinkingMini V0.3</span>` : "";
  const engBadge = !isUser && engine ? `<div class="eng-badge">${engine === "cloud" ? "cloud" : "rule"}</div>` : "";
  row.innerHTML = `
    <div class="msg-av ${isUser ? "user" : "ai"}">${isUser ? "Y" : "G"}</div>
    <div class="msg-body">
      <div class="msg-name">${isUser ? "You" : "GenAI"} ${thinkTag}</div>
      <div class="msg-text${isUser ? " u" : ""}">${escHtml(text)}</div>
      ${engBadge}
    </div>`;
  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function addTyping() {
  if (emptyState.parentNode === chatArea) chatArea.removeChild(emptyState);
  const row = document.createElement("div");
  row.className = "msg-row";
  row.id = "typing-row";
  row.innerHTML = `<div class="msg-av ai">G</div><div class="msg-body"><div class="msg-name">GenAI</div><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
}
function removeTyping() { const el = document.getElementById("typing-row"); if (el) el.remove(); }

async function send() {
  const text = promptInput.value.trim();
  if (!text) return;
  if (!canSendRequest()) return;
  if (!activeId) newChat();
  const s = getActive();
  promptInput.value = "";
  autoResize();
  sendBtn.disabled = true;
  setDot("yellow", "thinking...");

  s.messages.push({ role: "user", text });
  if (s.title === "New Chat" || !s.title) { s.title = titleFrom(text); chatTitle.textContent = s.title; }
  s.model = activeModel;
  s.updatedAt = Date.now();
  save();
  renderHist();
  appendBubble("user", text);
  addTyping();

  try {
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        prompt: text,
        model: activeModel,
        messages: buildApiMessages(s.messages)
      }),
      signal: AbortSignal.timeout(90000)
    });
    removeTyping();
    if (!res.ok) throw new Error("Server " + res.status);
    const d = await res.json();
    s.messages.push({ role:"ai", text:d.response, engine:d.engine || "rule", thinking:!!d.thinking });
    s.updatedAt = Date.now();
    save();
    appendBubble("ai", d.response, d.engine || "rule", !!d.thinking);
    if ((d.engine || "rule") !== "rule") applyUsageDeduction(text, d.response || "");
    setDot("green", "online");
  } catch (_) {
    removeTyping();
    appendBubble("ai", "Connection failed - is server.py running", "error", false);
    setDot("red", "offline");
  }
  sendBtn.disabled = false;
  promptInput.focus();
}

function fillPrompt(t) { promptInput.value = t; autoResize(); promptInput.focus(); send(); }
window.fillPrompt = fillPrompt;
function autoResize() { promptInput.style.height = "auto"; promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + "px"; }
promptInput.addEventListener("input", autoResize);
promptInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
sendBtn.addEventListener("click", send);

document.getElementById("btn-new").addEventListener("click", newChat);

function archiveChats() {
  if (!sessions.length) { alert("No chat history to archive."); return; }
  const data = JSON.stringify({ exported: new Date().toISOString(), sessions }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `genai-history-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function updateSettingsCounts() {
  document.getElementById("s-chats").textContent = sessions.length + " chat" + (sessions.length !== 1 ? "s" : "");
  settingsModel.textContent = activeModel;
}

const settingsOverlay = document.getElementById("settings-overlay");
document.getElementById("btn-settings").addEventListener("click", () => { pollStatus(); updateSettingsCounts(); settingsOverlay.classList.add("open"); });
document.getElementById("settings-x").addEventListener("click", () => settingsOverlay.classList.remove("open"));
document.getElementById("settings-close-btn").addEventListener("click", () => settingsOverlay.classList.remove("open"));
settingsOverlay.addEventListener("click", e => { if (e.target === settingsOverlay) settingsOverlay.classList.remove("open"); });
document.getElementById("btn-edit-active").addEventListener("click", () => { if (!activeId) { alert("No active chat selected."); return; } openRenamePopup(activeId); });
document.getElementById("btn-archive").addEventListener("click", openArchivePopup);
document.getElementById("btn-clear-settings").addEventListener("click", () => openTrashPopup("all"));

const manageOverlay = document.getElementById("manage-overlay");
const manageList = document.getElementById("manage-list");
function renderManageList() {
  manageList.innerHTML = "";
  if (!sessions.length) { manageList.innerHTML = `<div style="font-size:12.5px;color:var(--text-dim);padding:6px 4px;">No chat history.</div>`; return; }
  [...sessions].reverse().forEach(s => {
    const el = document.createElement("div");
    el.className = "mi";
    el.innerHTML = `<span class="mi-title">${escHtml(s.title)}</span>
      <span class="mi-model">${s.model || "g0.5-mini"}</span>
      <div class="mi-actions">
        <button class="icon-btn edit" title="Rename chat" data-action="edit"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <button class="icon-btn archive" title="Archive all chats" data-action="archive"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8h14v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M10 12h4"/></svg></button>
        <button class="icon-btn trash" title="Delete chat" data-action="trash"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
      </div>`;
    el.querySelector('[data-action="edit"]').addEventListener("click", () => openRenamePopup(s.id));
    el.querySelector('[data-action="archive"]').addEventListener("click", openArchivePopup);
    el.querySelector('[data-action="trash"]').addEventListener("click", () => openTrashPopup("one", s.id));
    manageList.appendChild(el);
  });
}
document.getElementById("btn-manage").addEventListener("click", () => { renderManageList(); manageOverlay.classList.add("open"); });
document.getElementById("manage-x").addEventListener("click", () => manageOverlay.classList.remove("open"));
document.getElementById("manage-done").addEventListener("click", () => manageOverlay.classList.remove("open"));
manageOverlay.addEventListener("click", e => { if (e.target === manageOverlay) manageOverlay.classList.remove("open"); });
document.getElementById("manage-clear-all").addEventListener("click", () => openTrashPopup("all"));

auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    await loadUserCloudData(user);
  } else {
    currentUser = null;
    resetGuestState();
  }
  renderProfile();
  renderHist();
  renderManageList();
  renderChat();
  if (activeId) loadSession(activeId);
  updateSettingsCounts();
});

renderProfile();
renderHist();
renderManageList();
renderChat();
if (sessions.length) loadSession(sessions[sessions.length - 1].id);
else chatArea.appendChild(emptyState);
