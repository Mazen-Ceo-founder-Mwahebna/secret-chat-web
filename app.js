const authScreen = document.querySelector("#authScreen");
const appShell = document.querySelector("#appShell");
const authTitle = document.querySelector("#authTitle");
const authMessage = document.querySelector("#authMessage");
const signupForm = document.querySelector("#signupForm");
const loginForm = document.querySelector("#loginForm");
const showSignup = document.querySelector("#showSignup");
const showLogin = document.querySelector("#showLogin");
const themeToggle = document.querySelector("#themeToggle");
const appThemeToggle = document.querySelector("#appThemeToggle");
const currentUsername = document.querySelector("#currentUsername");
const currentPhone = document.querySelector("#currentPhone");
const userAvatar = document.querySelector("#userAvatar");
const logoutButton = document.querySelector("#logoutButton");
const messageFeed = document.querySelector("#messageFeed");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const photoButton = document.querySelector("#photoButton");
const photoInput = document.querySelector("#photoInput");
const voiceButton = document.querySelector("#voiceButton");
const mobileMenuButton = document.querySelector("#mobileMenuButton");
const sidebar = document.querySelector(".sidebar");
const connectionLabel = document.querySelector("#connectionLabel");
const passwordToggles = document.querySelectorAll("[data-password-toggle]");

const TOKEN_KEY = "pulse-chat-token";
const THEME_KEY = "pulse-chat-theme";
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢"];

let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;
let messages = [];
let selectedMessageId = "";
let stream = null;
let mediaRecorder = null;
let audioChunks = [];
let recordingStartedAt = 0;

applyTheme(localStorage.getItem(THEME_KEY) || "light");
boot();

showSignup.addEventListener("click", () => setAuthMode("signup"));
showLogin.addEventListener("click", () => setAuthMode("login"));
themeToggle.addEventListener("click", toggleTheme);
appThemeToggle.addEventListener("click", toggleTheme);

passwordToggles.forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.passwordToggle}`);
    const shouldShow = input.type === "password";
    input.type = shouldShow ? "text" : "password";
    button.classList.toggle("active", shouldShow);
    button.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
  });
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    username: document.querySelector("#signupUsername").value,
    phone: document.querySelector("#signupPhone").value,
    password: document.querySelector("#signupPassword").value
  };
  await authenticate("/api/signup", payload);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    phone: document.querySelector("#loginPhone").value,
    password: document.querySelector("#loginPassword").value
  };
  await authenticate("/api/login", payload);
});

logoutButton.addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  token = "";
  currentUser = null;
  messages = [];
  stream?.close();
  stream = null;
  showAuth();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendTextMessage();
});

messageInput.addEventListener("input", resizeComposer);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendTextMessage();
  }
});

photoButton.addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  photoInput.value = "";

  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    showToast("Please choose a photo file.");
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  await sendMessage({
    type: "photo",
    text: messageInput.value.trim(),
    dataUrl,
    mimeType: file.type,
    fileName: file.name
  });

  messageInput.value = "";
  resizeComposer();
});

voiceButton.addEventListener("click", async () => {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  await startVoiceRecording();
});

mobileMenuButton.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

document.addEventListener("click", (event) => {
  if (!sidebar.contains(event.target) && !mobileMenuButton.contains(event.target)) {
    sidebar.classList.remove("open");
  }

  if (!event.target.closest(".message")) {
    selectedMessageId = "";
    renderMessages(false);
  }
});

async function boot() {
  if (location.protocol === "file:") {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
    setAuthMessage('Open this app from http://localhost:3000 after running "npm start". Accounts need the server to save to the database.');
    return;
  }

  if (!token) {
    showAuth();
    return;
  }

  try {
    const result = await api("/api/me");
    currentUser = result.user;
    showApp();
    await loadMessages();
    connectStream();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    token = "";
    showAuth();
  }
}

async function authenticate(path, payload) {
  setAuthMessage("");

  try {
    const result = await api(path, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    token = result.token;
    currentUser = result.user;
    localStorage.setItem(TOKEN_KEY, token);
    showApp();
    await loadMessages();
    connectStream();
  } catch (error) {
    setAuthMessage(error.message || "Something went wrong.");
  }
}

async function loadMessages() {
  messages = await api("/api/messages");
  renderMessages();
}

function connectStream() {
  stream?.close();
  stream = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);

  stream.addEventListener("ready", () => {
    connectionLabel.textContent = "Live";
  });

  stream.addEventListener("update", (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "message") {
      messages.push(payload.message);
      renderMessages();
    }

    if (payload.type === "message:update") {
      upsertMessage(payload.message);
      renderMessages(false);
    }
  });

  stream.onerror = () => {
    connectionLabel.textContent = "Reconnecting";
  };
}

async function sendTextMessage() {
  const text = messageInput.value.trim();

  if (!text) {
    return;
  }

  await sendMessage({ type: "text", text });
  messageInput.value = "";
  resizeComposer();
}

async function sendMessage(payload) {
  try {
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch (error) {
    showToast(error.message || "Message failed.");
  }
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Voice recording needs a browser that supports microphone access.");
    return;
  }

  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream);
    audioChunks = [];
    recordingStartedAt = Date.now();

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", async () => {
      audioStream.getTracks().forEach((track) => track.stop());
      voiceButton.classList.remove("recording");

      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const dataUrl = await fileToDataUrl(blob);
      const seconds = Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000));

      await sendMessage({
        type: "voice",
        text: `${seconds}s voice message`,
        dataUrl,
        mimeType: blob.type,
        fileName: "voice-message.webm"
      });
    });

    mediaRecorder.start();
    voiceButton.classList.add("recording");
  } catch {
    showToast("Microphone access was not allowed.");
  }
}

function renderMessages(shouldScroll = true) {
  messageFeed.innerHTML = "";

  if (messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <div>
        <strong>No messages yet.</strong>
        <span>Send the first text, photo, or voice message.</span>
      </div>
    `;
    messageFeed.append(empty);
    return;
  }

  messages.forEach((message) => {
    const article = document.createElement("article");
    article.className = `message ${message.userId === currentUser.id ? "mine" : "other"}`;
    article.dataset.messageId = message.id;

    const sender = document.createElement("div");
    sender.className = "sender";
    sender.textContent = message.sender;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.append(renderMessageBody(message));
    bubble.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedMessageId = selectedMessageId === message.id ? "" : message.id;
      renderMessages(false);
    });

    const reactions = renderReactions(message);

    const time = document.createElement("time");
    time.className = "meta";
    time.textContent = formatTime(message.createdAt);

    article.append(sender, bubble, reactions, time);

    if (selectedMessageId === message.id) {
      article.append(renderMessagePanel(message));
    }

    messageFeed.append(article);
  });

  if (shouldScroll) {
    messageFeed.scrollTop = messageFeed.scrollHeight;
  }
}

function renderMessageBody(message) {
  const fragment = document.createDocumentFragment();

  if (message.type === "photo") {
    const img = document.createElement("img");
    img.className = "chat-photo";
    img.src = message.dataUrl;
    img.alt = message.fileName || "Shared photo";
    fragment.append(img);
  }

  if (message.type === "voice") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = message.dataUrl;
    fragment.append(audio);
  }

  if (message.text) {
    const text = document.createElement("span");
    text.textContent = message.text;
    fragment.append(text);
  }

  return fragment;
}

function renderReactions(message) {
  const wrap = document.createElement("div");
  wrap.className = "reaction-row";
  const grouped = groupReactions(message.reactions || []);

  Object.entries(grouped).forEach(([emoji, users]) => {
    const badge = document.createElement("button");
    badge.className = "reaction-badge";
    badge.type = "button";
    badge.textContent = `${emoji} ${users.length}`;
    badge.title = users.map((user) => user.username).join(", ");
    badge.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleReaction(message.id, emoji);
    });
    wrap.append(badge);
  });

  return wrap;
}

function renderMessagePanel(message) {
  const panel = document.createElement("div");
  panel.className = "message-panel";

  const reactionPicker = document.createElement("div");
  reactionPicker.className = "reaction-picker";

  REACTIONS.forEach((emoji) => {
    const button = document.createElement("button");
    const hasReacted = (message.reactions || []).some((reaction) => {
      return reaction.userId === currentUser.id && reaction.emoji === emoji;
    });
    button.className = `emoji-button${hasReacted ? " active" : ""}`;
    button.type = "button";
    button.textContent = emoji;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleReaction(message.id, emoji);
    });
    reactionPicker.append(button);
  });

  const seenTitle = document.createElement("strong");
  seenTitle.textContent = "Seen by";

  const seenList = document.createElement("div");
  seenList.className = "seen-list";
  const seenUsers = message.seenBy || [];
  seenList.textContent = seenUsers.length
    ? seenUsers.map((viewer) => viewer.userId === currentUser.id ? "You" : viewer.username).join(", ")
    : "No one yet";

  panel.append(reactionPicker, seenTitle, seenList);
  return panel;
}

async function toggleReaction(messageId, emoji) {
  try {
    const message = await api(`/api/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji })
    });
    upsertMessage(message);
    renderMessages(false);
  } catch (error) {
    showToast(error.message || "Reaction failed.");
  }
}

function upsertMessage(message) {
  const index = messages.findIndex((item) => item.id === message.id);

  if (index >= 0) {
    messages[index] = message;
  } else {
    messages.push(message);
  }
}

function groupReactions(reactions) {
  return reactions.reduce((groups, reaction) => {
    groups[reaction.emoji] = groups[reaction.emoji] || [];
    groups[reaction.emoji].push(reaction);
    return groups;
  }, {});
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(path, {
      ...options,
      headers
    });
  } catch {
    throw new Error('Cannot reach the chat server. Run "npm start" and open http://localhost:3000.');
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Request failed.");
  }

  return result;
}

function showAuth() {
  authScreen.classList.remove("hidden");
  appShell.classList.add("hidden");
  setAuthMode("signup");
}

function showApp() {
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  currentUsername.textContent = currentUser.username;
  currentPhone.textContent = currentUser.phone;
  userAvatar.textContent = currentUser.username.slice(0, 1).toUpperCase();
}

function setAuthMode(mode) {
  const isSignup = mode === "signup";
  signupForm.classList.toggle("hidden", !isSignup);
  loginForm.classList.toggle("hidden", isSignup);
  showSignup.classList.toggle("active", isSignup);
  showLogin.classList.toggle("active", !isSignup);
  authTitle.textContent = isSignup ? "Create account" : "Welcome back";
  setAuthMessage("");
}

function toggleTheme() {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

function setAuthMessage(message) {
  authMessage.textContent = message;
}

function showToast(message) {
  alert(message);
}

function resizeComposer() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${messageInput.scrollHeight}px`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp);
}
