import nanoModel from "./models/g05_nano.js";
import miniModel from "./models/g05_mini.js";
import fullModel from "./models/g05.js";

const APP_VERSION = "0.26.2.0";
const CREDIT_REFILL_MS = 8 * 60 * 60 * 1000;
const USER_ROOT = "Account/GenAI/users";
const MODELS = {
  "g0.5-nano": nanoModel,
  "g0.5-mini": miniModel,
  "g0.5": fullModel
};
const FIREWORKS = {
  apiKey: globalThis.GENAI_FIREWORKS_API_KEY || "",
  baseUrl: "https://api.fireworks.ai/inference/v1",
  model: "accounts/fireworks/models/llama-v3p1-8b-instruct"
};
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

const page = document.body.dataset.page;
const state = {
  sessions: [],
  activeId: null,
  activeModel: localStorage.getItem("genai_default_model") || "g0.5-mini",
  currentUser: null,
  userProfile: null,
  guestCredits: 2,
  syncTimer: null,
  providerStatus: "checking",
  confirmAction: null,
  renameTarget: null
};

let firebaseReady = false;
let auth = null;
let db = null;
let googleProvider = null;
let ui = {};

initFirebase();
document.addEventListener("DOMContentLoaded", initApp);

function initFirebase() {
  if (!globalThis.firebase) return;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.database();
  googleProvider = new firebase.auth.GoogleAuthProvider();
  firebaseReady = true;
}

function initApp() {
  consumeRedirectToast();
  if (page === "home") initHomePage();
  if (page === "signin") initAuthPage("signin");
  if (page === "signup") initAuthPage("signup");
}

function initHomePage() {
  ui = {
    recentList: byId("hist-recent"),
    archivedList: byId("hist-archived"),
    chatArea: byId("chat-area"),
    emptyState: byId("empty-state"),
    promptInput: byId("prompt-input"),
    sendBtn: byId("send-btn"),
    chatTitle: byId("chat-title"),
    engineHint: byId("engine-hint"),
    dot: byId("dot"),
    dotLabel: byId("dot-label"),
    profileAvatar: byId("profile-avatar"),
    profileName: byId("profile-name"),
    profileSub: byId("profile-sub"),
    creditsPill: byId("credits-pill"),
    signInLink: byId("link-signin"),
    signUpLink: byId("link-signup"),
    signOutBtn: byId("btn-signout"),
    modelBtn: byId("model-btn"),
    modelDropdown: byId("model-dropdown"),
    modelBtnLabel: byId("model-btn-label"),
    modelDotColor: byId("model-dot-color"),
    composerModel: byId("composer-model"),
    composerStyle: byId("composer-style"),
    settingsOverlay: byId("settings-overlay"),
    manageOverlay: byId("manage-overlay"),
    renameOverlay: byId("rename-overlay"),
    confirmOverlay: byId("confirm-overlay"),
    renameInput: byId("rename-input"),
    manageList: byId("manage-list"),
    settingsModel: byId("settings-model"),
    defaultModelSelect: byId("default-model-select"),
    chatsCount: byId("s-chats"),
    providerChip: byId("s-provider"),
    backendChip: byId("s-backend"),
    toggleDark: byId("toggle-dark"),
    confirmTitle: byId("confirm-title"),
    confirmBody: byId("confirm-body")
  };

  wireHomeEvents();
  applyTheme(localStorage.getItem("genai_dark") !== "0");
  setModel(state.activeModel, { persistDefault: false, updateSession: false });
  newChat();
  refreshProviderStatus();
  if (firebaseReady) {
    auth.onAuthStateChanged(handleAuthStateChange);
  } else {
    renderAll();
    showToast("error", "Auth unavailable", "Firebase did not load, so account features are unavailable.");
  }
}

function wireHomeEvents() {
  ui.promptInput.addEventListener("input", autoResizePrompt);
  ui.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });
  ui.sendBtn.addEventListener("click", sendPrompt);
  byId("btn-new").addEventListener("click", newChat);
  byId("btn-settings").addEventListener("click", () => openOverlay(ui.settingsOverlay));
  byId("btn-manage").addEventListener("click", () => {
    renderManageList();
    openOverlay(ui.manageOverlay);
  });
  byId("settings-close").addEventListener("click", () => closeOverlay(ui.settingsOverlay));
  byId("manage-close").addEventListener("click", () => closeOverlay(ui.manageOverlay));
  byId("rename-cancel").addEventListener("click", () => closeOverlay(ui.renameOverlay));
  byId("rename-save").addEventListener("click", saveRename);
  byId("confirm-cancel").addEventListener("click", () => closeOverlay(ui.confirmOverlay));
  byId("confirm-ok").addEventListener("click", () => {
    closeOverlay(ui.confirmOverlay);
    if (typeof state.confirmAction === "function") state.confirmAction();
  });
  byId("btn-rename-active").addEventListener("click", () => {
    if (!state.activeId) return showToast("error", "No active chat", "Open or create a chat before renaming it.");
    openRenameModal(state.activeId);
  });
  byId("btn-export").addEventListener("click", () => confirmAction(
    "Export chats",
    "Download all current chats as a JSON archive.",
    exportChats
  ));
  byId("btn-clear-all").addEventListener("click", () => confirmAction(
    "Clear all chats",
    "This removes every recent and archived chat from the current account or guest session.",
    clearAllChats
  ));
  ui.defaultModelSelect.addEventListener("change", () => setModel(ui.defaultModelSelect.value));
  ui.toggleDark.addEventListener("change", () => applyTheme(ui.toggleDark.checked));
  ui.modelBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    ui.modelDropdown.classList.toggle("open");
  });
  document.addEventListener("click", () => ui.modelDropdown.classList.remove("open"));
  document.querySelectorAll(".model-option").forEach((button) => {
    button.addEventListener("click", () => setModel(button.dataset.model));
  });
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      ui.promptInput.value = chip.dataset.prompt || "";
      autoResizePrompt();
      ui.promptInput.focus();
    });
  });
  ui.signOutBtn.addEventListener("click", () => confirmAction(
    "Sign out",
    "You will return to guest mode and cloud-synced history will close until you sign in again.",
    async () => {
      await auth.signOut();
      showToast("success", "Signed out", "You are back in guest mode.");
    }
  ));
  [
    ui.settingsOverlay,
    ui.manageOverlay,
    ui.renameOverlay,
    ui.confirmOverlay
  ].forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeOverlay(overlay);
    });
  });
}

async function handleAuthStateChange(user) {
  if (user) {
    state.currentUser = user;
    await loadUserCloudData(user);
  } else {
    state.currentUser = null;
    state.userProfile = null;
    state.sessions = [];
    state.activeId = null;
    state.guestCredits = 2;
  }
  if (!state.sessions.length) newChat();
  renderAll();
}

function initAuthPage(mode) {
  if (!firebaseReady) {
    showToast("error", "Auth unavailable", "Firebase did not load, so this page cannot complete sign-in.");
    return;
  }

  const form = byId("auth-form");
  const googleButton = byId("auth-google");
  const emailInput = byId("auth-email");
  const passwordInput = byId("auth-password");
  const nameInput = byId("auth-name");

  auth.onAuthStateChanged((user) => {
    if (user) window.location.href = "index.html";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    try {
      if (mode === "signin") {
        await auth.signInWithEmailAndPassword(email, password);
        pushRedirectToast("success", "Signed in", "Your cloud session is ready.");
      } else {
        const displayName = nameInput.value.trim();
        const credential = await auth.createUserWithEmailAndPassword(email, password);
        if (credential.user) await credential.user.updateProfile({ displayName });
        pushRedirectToast("success", "Account created", "Your profile and credits are ready.");
      }
      window.location.href = "index.html";
    } catch (error) {
      showToast("error", mode === "signin" ? "Sign-in failed" : "Sign-up failed", cleanFirebaseError(error));
    }
  });

  googleButton.addEventListener("click", async () => {
    try {
      await auth.signInWithPopup(googleProvider);
      pushRedirectToast("success", "Google sign-in complete", "Cloud sync is now enabled.");
      window.location.href = "index.html";
    } catch (error) {
      showToast("error", "Google sign-in failed", cleanFirebaseError(error));
    }
  });
}

function renderAll() {
  renderProfile();
  renderHistory();
  renderChat();
  renderManageList();
  renderSettings();
}

function renderProfile() {
  if (!ui.profileName) return;
  if (state.currentUser) {
    const displayName = state.userProfile?.displayName || state.currentUser.displayName || state.currentUser.email || "User";
    ui.profileName.textContent = displayName;
    ui.profileSub.textContent = state.currentUser.email || "Signed in";
    ui.profileAvatar.textContent = (displayName[0] || "U").toUpperCase();
    ui.signOutBtn.classList.remove("hidden");
    ui.signInLink.classList.add("hidden");
    ui.signUpLink.classList.add("hidden");
  } else {
    ui.profileName.textContent = "Guest";
    ui.profileSub.textContent = "Temporary session";
    ui.profileAvatar.textContent = "G";
    ui.signOutBtn.classList.add("hidden");
    ui.signInLink.classList.remove("hidden");
    ui.signUpLink.classList.remove("hidden");
  }
  ui.creditsPill.textContent = `Credits: ${getCredits().toFixed(2)}`;
}

function renderHistory() {
  renderHistorySection(ui.recentList, false);
  renderHistorySection(ui.archivedList, true);
}

function renderHistorySection(container, archived) {
  const sessions = state.sessions
    .filter((session) => Boolean(session.archived) === archived)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  container.innerHTML = "";
  if (!sessions.length) {
    container.innerHTML = `<div class="history-empty">${archived ? "No archived chats." : "No recent chats."}</div>`;
    return;
  }

  sessions.forEach((session) => {
    const item = document.createElement("div");
    item.className = `history-item${session.id === state.activeId ? " active" : ""}`;
    item.innerHTML = `
      <div class="history-copy">
        <div class="history-title">${escapeHtml(session.title)}</div>
        <div class="history-model">${session.model || "g0.5-mini"}</div>
      </div>
      <div class="history-actions">
        <button class="history-icon edit" type="button" title="Rename">&#9998;</button>
        <button class="history-icon archive" type="button" title="${archived ? "Unarchive" : "Archive"}">&#9681;</button>
        <button class="history-icon delete" type="button" title="Delete">&#128465;</button>
      </div>
    `;
    item.addEventListener("click", () => openSession(session.id));
    item.querySelector(".history-icon.edit").addEventListener("click", (event) => {
      event.stopPropagation();
      openRenameModal(session.id);
    });
    item.querySelector(".history-icon.archive").addEventListener("click", (event) => {
      event.stopPropagation();
      confirmAction(
        archived ? "Unarchive chat" : "Archive chat",
        archived ? "Move this chat back into the recent list." : "Move this chat out of the recent list without deleting it.",
        () => toggleArchive(session.id)
      );
    });
    item.querySelector(".history-icon.delete").addEventListener("click", (event) => {
      event.stopPropagation();
      confirmAction("Delete chat", "This permanently removes the selected chat.", () => deleteSession(session.id));
    });
    container.appendChild(item);
  });
}

function renderChat() {
  ui.chatArea.innerHTML = "";
  const session = getActiveSession();
  if (!session || !session.messages.length) {
    ui.chatArea.appendChild(ui.emptyState);
    ui.chatTitle.textContent = "GenAI";
    return;
  }

  ui.chatTitle.textContent = session.title || "GenAI";
  session.messages.forEach((message) => appendMessage(message, false));
  ui.chatArea.scrollTop = ui.chatArea.scrollHeight;
}

function appendMessage(message, animate = true) {
  if (ui.emptyState.parentNode === ui.chatArea) ui.emptyState.remove();
  const row = document.createElement("div");
  row.className = "message-row";
  if (!animate) row.style.animation = "none";
  const user = message.role === "user";
  row.innerHTML = `
    <div class="message-avatar ${user ? "user" : "ai"}">${user ? "Y" : "G"}</div>
    <div class="message-body">
      <div class="message-name">
        <span>${user ? "You" : "GenAI"}</span>
        ${!user && message.thinking ? `<span class="thinking-badge">thinking</span>` : ""}
      </div>
      <div class="message-text ${user ? "user-copy" : ""}">${escapeHtml(message.text)}</div>
      ${!user ? `<div class="message-engine">${message.engine || "cloud"}</div>` : ""}
    </div>
  `;
  ui.chatArea.appendChild(row);
  ui.chatArea.scrollTop = ui.chatArea.scrollHeight;
}

function addTypingRow() {
  const row = document.createElement("div");
  row.className = "message-row";
  row.id = "typing-row";
  row.innerHTML = `
    <div class="message-avatar ai">G</div>
    <div class="message-body">
      <div class="message-name">GenAI</div>
      <div class="typing"><span></span><span></span><span></span></div>
    </div>
  `;
  ui.chatArea.appendChild(row);
  ui.chatArea.scrollTop = ui.chatArea.scrollHeight;
}

function removeTypingRow() {
  byId("typing-row")?.remove();
}

function renderSettings() {
  const activeModel = MODELS[state.activeModel];
  ui.settingsModel.textContent = activeModel.label;
  ui.defaultModelSelect.value = state.activeModel;
  ui.chatsCount.textContent = `${state.sessions.length} ${state.sessions.length === 1 ? "chat" : "chats"}`;
  ui.providerChip.textContent = state.providerStatus;
  ui.backendChip.textContent = FIREWORKS.baseUrl.replace("https://", "");
}

function renderManageList() {
  if (!ui.manageList) return;
  const sessions = [...state.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  ui.manageList.innerHTML = "";
  if (!sessions.length) {
    ui.manageList.innerHTML = `<div class="history-empty">No chat history.</div>`;
    return;
  }
  sessions.forEach((session) => {
    const item = document.createElement("div");
    item.className = "manage-item";
    item.innerHTML = `
      <div class="manage-copy">
        <strong>${escapeHtml(session.title)}</strong>
        <span>${session.model} &middot; ${session.archived ? "archived" : "recent"}</span>
      </div>
      <div class="manage-actions">
        <button class="icon-action edit" type="button" title="Rename">&#9998;</button>
        <button class="icon-action archive" type="button" title="Archive">&#9681;</button>
        <button class="icon-action danger" type="button" title="Delete">&#128465;</button>
      </div>
    `;
    item.querySelector(".edit").addEventListener("click", () => openRenameModal(session.id));
    item.querySelector(".archive").addEventListener("click", () => confirmAction(
      session.archived ? "Unarchive chat" : "Archive chat",
      session.archived ? "Move this chat back into the recent list." : "Move this chat into the archived list.",
      () => toggleArchive(session.id)
    ));
    item.querySelector(".danger").addEventListener("click", () => confirmAction(
      "Delete chat",
      "This permanently removes the selected chat.",
      () => deleteSession(session.id)
    ));
    ui.manageList.appendChild(item);
  });
}

function newChat() {
  const session = {
    id: genId(),
    title: "New Chat",
    model: state.activeModel,
    archived: false,
    messages: [],
    updatedAt: Date.now()
  };
  state.sessions.unshift(session);
  state.activeId = session.id;
  saveState();
  renderAll();
}

function openSession(id) {
  state.activeId = id;
  const session = getActiveSession();
  if (session?.model) setModel(session.model, { persistDefault: false, updateSession: false });
  renderAll();
}

function openRenameModal(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  state.renameTarget = sessionId;
  ui.renameInput.value = session.title || "";
  openOverlay(ui.renameOverlay);
  ui.renameInput.focus();
}

function saveRename() {
  const session = state.sessions.find((item) => item.id === state.renameTarget);
  const title = ui.renameInput.value.trim();
  if (!session || !title) {
    showToast("error", "Rename failed", "Enter a title before saving.");
    return;
  }
  session.title = title.slice(0, 80);
  session.updatedAt = Date.now();
  saveState();
  closeOverlay(ui.renameOverlay);
  renderAll();
  showToast("success", "Chat renamed", "The new title has been applied.");
}

function deleteSession(sessionId) {
  state.sessions = state.sessions.filter((session) => session.id !== sessionId);
  if (state.activeId === sessionId) state.activeId = state.sessions[0]?.id || null;
  if (!state.sessions.length) newChat();
  saveState();
  renderAll();
  showToast("success", "Chat deleted", "The selected chat was removed.");
}

function toggleArchive(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  session.archived = !session.archived;
  session.updatedAt = Date.now();
  saveState();
  renderAll();
  showToast("success", session.archived ? "Chat archived" : "Chat restored", session.archived ? "The chat moved to archived history." : "The chat moved back to recent history.");
}

function clearAllChats() {
  state.sessions = [];
  state.activeId = null;
  newChat();
  saveState();
  renderAll();
  showToast("success", "History cleared", "All chats were removed.");
}

async function sendPrompt() {
  const prompt = ui.promptInput.value.trim();
  if (!prompt) return;
  if (!canSendRequest()) return;
  if (!FIREWORKS.apiKey) {
    showToast("error", "Cloud key missing", "Set window.GENAI_FIREWORKS_API_KEY before using direct Fireworks chat.");
    return;
  }

  const session = getActiveSession() || createSessionForPrompt();
  session.messages.push({ role: "user", text: prompt });
  session.model = state.activeModel;
  session.updatedAt = Date.now();
  if (session.title === "New Chat") session.title = titleFrom(prompt);
  ui.promptInput.value = "";
  autoResizePrompt();
  setStatus("yellow", "thinking");
  appendMessage({ role: "user", text: prompt }, true);
  addTypingRow();
  saveState();
  renderHistory();
  renderManageList();

  const model = MODELS[state.activeModel];
  try {
    const response = await requestFireworks(model, prompt, session.messages.slice(0, -1));
    removeTypingRow();
    const normalized = model.normalizeReply(response);
    session.messages.push({
      role: "ai",
      text: normalized,
      engine: "cloud",
      thinking: model.thinking
    });
    session.updatedAt = Date.now();
    updateCredits(getCredits() - model.calculateCreditCost(prompt, normalized));
    saveState();
    appendMessage(session.messages.at(-1), true);
    setStatus("green", "online");
    renderSettings();
    renderHistory();
    renderManageList();
  } catch (error) {
    removeTypingRow();
    setStatus("red", "offline");
    appendMessage({
      role: "ai",
      text: cleanProviderError(error),
      engine: "cloud error",
      thinking: false
    }, true);
    showToast("error", "Cloud request failed", cleanProviderError(error));
  }
}

async function requestFireworks(model, prompt, history) {
  const response = await fetch(`${FIREWORKS.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${FIREWORKS.apiKey}`
    },
    body: JSON.stringify({
      model: FIREWORKS.model,
      max_tokens: model.maxTokens,
      temperature: model.temperature,
      top_p: model.topP,
      stream: false,
      messages: model.buildMessages(history, prompt)
    })
  });

  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const payload = await response.json();
      detail = payload.error?.message || payload.message || detail;
    } catch (_) {}
    throw new Error(detail);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The provider returned an empty response.");
  return text;
}

async function refreshProviderStatus() {
  if (!ui.providerChip) return;
  if (!FIREWORKS.apiKey) {
    state.providerStatus = "key missing";
    setStatus("red", "needs key");
    renderSettings();
    return;
  }

  try {
    const response = await fetch(`${FIREWORKS.baseUrl}/models`, {
      headers: { "Authorization": `Bearer ${FIREWORKS.apiKey}` }
    });
    state.providerStatus = response.ok ? "connected" : "unreachable";
    setStatus(response.ok ? "green" : "yellow", response.ok ? "online" : "degraded");
  } catch (_) {
    state.providerStatus = "offline";
    setStatus("red", "offline");
  }
  renderSettings();
}

function setModel(modelId, { persistDefault = true, updateSession = true } = {}) {
  const model = MODELS[modelId] || MODELS["g0.5-mini"];
  state.activeModel = model.id;
  ui.modelBtnLabel.textContent = model.label;
  ui.modelDotColor.className = `model-dot ${model.indicatorClass}`;
  ui.composerModel.textContent = model.label;
  ui.composerStyle.textContent = model.styleLabel;
  document.querySelectorAll(".model-option").forEach((button) => {
    button.classList.toggle("selected", button.dataset.model === model.id);
  });
  if (persistDefault) localStorage.setItem("genai_default_model", model.id);
  if (updateSession) {
    const session = getActiveSession();
    if (session) {
      session.model = model.id;
      session.updatedAt = Date.now();
      saveState();
    }
  }
  ui.engineHint.textContent = model.styleLabel;
  ui.modelDropdown.classList.remove("open");
  renderSettings();
}

function canSendRequest() {
  if (getCredits() > 0) return true;
  const guest = !state.currentUser;
  const message = guest ? "Sign in to continue responses." : "Come back for more responses.";
  appendMessage({ role: "ai", text: message, engine: "system", thinking: false }, true);
  return false;
}

function getCredits() {
  return state.currentUser ? Number(state.userProfile?.credits || 0) : state.guestCredits;
}

function updateCredits(value) {
  const nextValue = Number(value.toFixed(2));
  if (state.currentUser) {
    state.userProfile.credits = nextValue;
    state.userProfile.updatedAt = Date.now();
  } else {
    state.guestCredits = nextValue;
  }
  renderProfile();
}

async function loadUserCloudData(user) {
  const profileSnapshot = await db.ref(`${USER_ROOT}/${user.uid}/profile`).once("value");
  const now = Date.now();
  let profile = profileSnapshot.val();
  if (!profile) {
    profile = {
      uid: user.uid,
      displayName: user.displayName || "User",
      email: user.email || "",
      photoURL: user.photoURL || "",
      credits: 2,
      lastCreditAt: now,
      createdAt: now,
      updatedAt: now
    };
  }
  applyCreditRefill(profile);
  state.userProfile = profile;
  const sessionsSnapshot = await db.ref(`${USER_ROOT}/${user.uid}/sessions`).once("value");
  state.sessions = objectToSessions(sessionsSnapshot.val());
  state.activeId = state.sessions[0]?.id || null;
  queueCloudSync();
}

function applyCreditRefill(profile) {
  const now = Date.now();
  if (!profile.lastCreditAt) {
    profile.lastCreditAt = now;
    return;
  }
  const increments = Math.floor((now - profile.lastCreditAt) / CREDIT_REFILL_MS);
  if (increments <= 0) return;
  profile.credits = Number((Number(profile.credits || 0) + increments).toFixed(2));
  profile.lastCreditAt += increments * CREDIT_REFILL_MS;
  profile.updatedAt = now;
}

function saveState() {
  if (state.currentUser) queueCloudSync();
}

function queueCloudSync() {
  if (!state.currentUser) return;
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(async () => {
    try {
      await db.ref(`${USER_ROOT}/${state.currentUser.uid}/profile`).set(state.userProfile || {});
      await db.ref(`${USER_ROOT}/${state.currentUser.uid}/sessions`).set(sessionsToObject(state.sessions));
    } catch (error) {
      showToast("error", "Cloud sync failed", cleanFirebaseError(error));
    }
  }, 400);
}

function createSessionForPrompt() {
  const session = {
    id: genId(),
    title: "New Chat",
    model: state.activeModel,
    archived: false,
    messages: [],
    updatedAt: Date.now()
  };
  state.sessions.unshift(session);
  state.activeId = session.id;
  return session;
}

function getActiveSession() {
  return state.sessions.find((session) => session.id === state.activeId) || null;
}

function exportChats() {
  const blob = new Blob([JSON.stringify({
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    sessions: state.sessions
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `genai-history-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("success", "History exported", "A JSON archive has been downloaded.");
}

function openOverlay(overlay) {
  overlay.classList.add("open");
}

function closeOverlay(overlay) {
  overlay.classList.remove("open");
}

function confirmAction(title, body, handler) {
  state.confirmAction = handler;
  ui.confirmTitle.textContent = title;
  ui.confirmBody.textContent = body;
  openOverlay(ui.confirmOverlay);
}

function setStatus(color, label) {
  ui.dot.className = `dot ${color}`;
  ui.dotLabel.textContent = label;
}

function autoResizePrompt() {
  ui.promptInput.style.height = "auto";
  ui.promptInput.style.height = `${Math.min(ui.promptInput.scrollHeight, 160)}px`;
}

function applyTheme(dark) {
  document.body.classList.toggle("light", !dark);
  ui.toggleDark.checked = dark;
  localStorage.setItem("genai_dark", dark ? "1" : "0");
}

function pushRedirectToast(type, title, copy) {
  sessionStorage.setItem("genai_toast", JSON.stringify({ type, title, copy }));
}

function consumeRedirectToast() {
  const raw = sessionStorage.getItem("genai_toast");
  if (!raw) return;
  sessionStorage.removeItem("genai_toast");
  try {
    const toast = JSON.parse(raw);
    showToast(toast.type, toast.title, toast.copy);
  } catch (_) {}
}

function showToast(type, title, copy) {
  const stack = byId("toast-stack");
  if (!stack) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div><div class="toast-copy">${escapeHtml(copy)}</div>`;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 3600);
}

function sessionsToObject(sessions) {
  return sessions.reduce((accumulator, session) => {
    accumulator[session.id] = session;
    return accumulator;
  }, {});
}

function objectToSessions(value) {
  return Object.values(value || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function byId(id) {
  return document.getElementById(id);
}

function genId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function titleFrom(text) {
  return text.trim().slice(0, 42) || "New Chat";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cleanFirebaseError(error) {
  return String(error?.message || "Request failed.").replace(/^Firebase:\s*/i, "");
}

function cleanProviderError(error) {
  const text = String(error?.message || "Cloud request failed.");
  if (text.includes("401")) return "Fireworks rejected the browser request. Check the cloud API key.";
  if (text.includes("429")) return "The cloud provider rate-limited this request. Try again shortly.";
  return text;
}
