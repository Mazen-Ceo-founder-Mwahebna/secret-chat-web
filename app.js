const $ = (selector) => document.querySelector(selector);

const authScreen = $("#authScreen");
const appShell = $("#appShell");
const authTitle = $("#authTitle");
const authMessage = $("#authMessage");
const signupForm = $("#signupForm");
const loginForm = $("#loginForm");
const showSignup = $("#showSignup");
const showLogin = $("#showLogin");
const themeToggle = $("#themeToggle");
const appThemeToggle = $("#appThemeToggle");
const currentUsername = $("#currentUsername");
const currentPhone = $("#currentPhone");
const userAvatar = $("#userAvatar");
const logoutButton = $("#logoutButton");
const messageFeed = $("#messageFeed");
const messageForm = $("#messageForm");
const messageInput = $("#messageInput");
const photoButton = $("#photoButton");
const photoInput = $("#photoInput");
const voiceButton = $("#voiceButton");
const mobileMenuButton = $("#mobileMenuButton");
const sidebar = $(".sidebar");
const connectionLabel = $("#connectionLabel");
const conversationList = $("#conversationList");
const friendSearchInput = $("#friendSearchInput");
const searchResults = $("#searchResults");
const chatTitle = $("#chatTitle");
const chatTitleButton = $("#chatTitleButton");
const chatKind = $("#chatKind");
const membersButton = $("#membersButton");
const membersDrawer = $("#membersDrawer");
const memberList = $("#memberList");
const closeMembersButton = $("#closeMembersButton");
const profileOpenButton = $("#profileOpenButton");
const profileDrawer = $("#profileDrawer");
const profileForm = $("#profileForm");
const profileUsernameInput = $("#profileUsernameInput");
const profilePhotoInput = $("#profilePhotoInput");
const profilePreview = $("#profilePreview");
const closeProfileButton = $("#closeProfileButton");
const newGroupButton = $("#newGroupButton");
const groupDrawer = $("#groupDrawer");
const groupForm = $("#groupForm");
const closeGroupButton = $("#closeGroupButton");
const groupNameInput = $("#groupNameInput");
const groupPhotoInput = $("#groupPhotoInput");
const groupUserSearchInput = $("#groupUserSearchInput");
const groupUserResults = $("#groupUserResults");
const selectedMembers = $("#selectedMembers");
const replyPreview = $("#replyPreview");
const recordingState = $("#recordingState");
const groupSettingsDrawer = $("#groupSettingsDrawer");
const groupSettingsForm = $("#groupSettingsForm");
const closeGroupSettingsButton = $("#closeGroupSettingsButton");
const groupSettingsNameInput = $("#groupSettingsNameInput");
const groupSettingsPhotoInput = $("#groupSettingsPhotoInput");
const groupSettingsPreview = $("#groupSettingsPreview");
const groupSettingsMembers = $("#groupSettingsMembers");
const saveGroupSettingsButton = $("#saveGroupSettingsButton");
const passwordToggles = document.querySelectorAll("[data-password-toggle]");

const TOKEN_KEY = "pulse-chat-token";
const THEME_KEY = "pulse-chat-theme";
const REACTIONS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}"];

let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;
let conversations = [];
let activeConversationId = "general";
let messages = [];
let selectedMessageId = "";
let replyingTo = null;
let selectedGroupUsers = [];
let pendingProfilePhoto = "";
let pendingGroupPhoto = "";
let pendingGroupSettingsPhoto = "";
let pendingVoice = null;
let globalAudio = new Audio();
let globalAudioSrc = "";
let lastTappedMessage = { id: "", time: 0 };
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
logoutButton.addEventListener("click", logout);
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
photoInput.addEventListener("change", sendPhotoMessage);
voiceButton.addEventListener("click", toggleVoiceRecording);
mobileMenuButton.addEventListener("click", () => sidebar.classList.toggle("open"));
membersButton.addEventListener("click", openMembers);
chatTitleButton.addEventListener("click", openGroupSettings);
closeMembersButton.addEventListener("click", () => membersDrawer.classList.add("hidden"));
profileOpenButton.addEventListener("click", openProfile);
closeProfileButton.addEventListener("click", closeProfile);
profilePhotoInput.addEventListener("change", loadProfilePhoto);
profileForm.addEventListener("submit", saveProfile);
newGroupButton.addEventListener("click", openGroupCreator);
closeGroupButton.addEventListener("click", closeGroupCreator);
groupPhotoInput.addEventListener("change", loadGroupPhoto);
groupForm.addEventListener("submit", createGroup);
closeGroupSettingsButton.addEventListener("click", closeGroupSettings);
groupSettingsPhotoInput.addEventListener("change", loadGroupSettingsPhoto);
groupSettingsForm.addEventListener("submit", saveGroupSettings);
globalAudio.addEventListener("ended", () => {
  globalAudioSrc = "";
  renderMessages(false);
});
friendSearchInput.addEventListener("input", debounce(searchFriends, 220));
groupUserSearchInput.addEventListener("input", debounce(searchGroupUsers, 220));

passwordToggles.forEach((button) => {
  button.addEventListener("click", () => {
    const input = $(`#${button.dataset.passwordToggle}`);
    const shouldShow = input.type === "password";
    input.type = shouldShow ? "text" : "password";
    button.classList.toggle("active", shouldShow);
    button.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
  });
});

document.addEventListener("click", (event) => {
  if (!sidebar.contains(event.target) && !mobileMenuButton.contains(event.target)) sidebar.classList.remove("open");
  if (!event.target.closest(".message")) {
    selectedMessageId = "";
    renderMessages(false);
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await authenticate("/api/signup", {
    username: $("#signupUsername").value,
    phone: $("#signupPhone").value,
    password: $("#signupPassword").value
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await authenticate("/api/login", {
    phone: $("#loginPhone").value,
    password: $("#loginPassword").value
  });
});

async function boot() {
  if (location.protocol === "file:") {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
    setAuthMessage('Open this app from http://localhost:3000 after running "npm start".');
    return;
  }

  if (!token) return showAuth();

  try {
    currentUser = (await api("/api/me")).user;
    await enterApp();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    token = "";
    showAuth();
  }
}

async function authenticate(path, payload) {
  setAuthMessage("");
  try {
    const result = await api(path, { method: "POST", body: JSON.stringify(payload) });
    token = result.token;
    currentUser = result.user;
    localStorage.setItem(TOKEN_KEY, token);
    await enterApp();
  } catch (error) {
    setAuthMessage(error.message || "Something went wrong.");
  }
}

async function enterApp() {
  showApp();
  await loadConversations();
  await selectConversation(activeConversationId);
  connectStream();
}

async function loadConversations() {
  conversations = await api("/api/conversations");
  if (!conversations.some((conversation) => conversation.id === activeConversationId)) activeConversationId = "general";
  renderConversations();
}

async function selectConversation(id) {
  activeConversationId = id;
  selectedMessageId = "";
  const active = activeConversation();
  chatTitle.textContent = displayConversationName(active);
  chatKind.textContent = active?.type === "private" ? "Private chat" : "Group";
  membersButton.classList.toggle("hidden", active?.type !== "group");
  chatTitleButton.disabled = active?.type !== "group" || active?.id === "general";
  replyingTo = null;
  renderReplyPreview();
  messages = await api(`/api/messages?conversationId=${encodeURIComponent(activeConversationId)}`);
  renderConversations();
  renderMessages();
}

function connectStream() {
  stream?.close();
  stream = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
  stream.addEventListener("ready", () => connectionLabel.textContent = "Live");
  stream.addEventListener("update", async (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "message" && payload.message.conversationId === activeConversationId) {
      messages.push(payload.message);
      renderMessages();
    }
    if (payload.type === "message:update" && payload.message.conversationId === activeConversationId) {
      upsertMessage(payload.message);
      renderMessages(false);
    }
    if (payload.type === "conversations:update" || payload.type === "profile:update") {
      await loadConversations();
      const active = activeConversation();
      chatTitle.textContent = displayConversationName(active);
    }
  });
  stream.onerror = () => connectionLabel.textContent = "Reconnecting";
}

function renderConversations() {
  conversationList.innerHTML = "";
  conversations.forEach((conversation) => {
    const button = document.createElement("button");
    button.className = `room-button ${conversation.id === activeConversationId ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="list-avatar">${avatarMarkup(conversationPhoto(conversation), displayConversationName(conversation))}</span>
      <span class="list-text"><strong>${escapeHtml(displayConversationName(conversation))}</strong><small>${escapeHtml(conversation.lastMessage || memberSummary(conversation))}</small></span>
    `;
    button.addEventListener("click", () => {
      sidebar.classList.remove("open");
      selectConversation(conversation.id);
    });
    conversationList.append(button);
  });
}

function renderMessages(shouldScroll = true) {
  messageFeed.innerHTML = "";
  if (messages.length === 0) {
    messageFeed.innerHTML = `<div class="empty-state"><div><strong>No messages yet.</strong><span>Send the first text, photo, or voice message.</span></div></div>`;
    return;
  }

  messages.forEach((message) => {
    const article = document.createElement("article");
    article.className = `message ${message.userId === currentUser.id ? "mine" : "other"}`;
    const sender = document.createElement("div");
    sender.className = "sender";
    sender.innerHTML = `${avatarMarkup(message.senderPhoto, message.sender)}<span>${escapeHtml(message.sender)}</span>`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.append(renderMessageBody(message));
    bubble.addEventListener("click", (event) => {
      event.stopPropagation();
      const now = Date.now();
      if (lastTappedMessage.id === message.id && now - lastTappedMessage.time < 320) {
        startReply(message);
        lastTappedMessage = { id: "", time: 0 };
        return;
      }
      lastTappedMessage = { id: message.id, time: now };
      selectedMessageId = selectedMessageId === message.id ? "" : message.id;
      renderMessages(false);
    });
    bubble.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      startReply(message);
    });

    const time = document.createElement("time");
    time.className = "meta";
    time.textContent = formatTime(message.createdAt);

    article.append(sender, bubble, renderReactions(message), time);
    if (selectedMessageId === message.id) article.append(renderMessagePanel(message));
    messageFeed.append(article);
  });

  if (shouldScroll) {
    requestAnimationFrame(() => {
      messageFeed.scrollTop = messageFeed.scrollHeight;
    });
  }
}

function renderMessageBody(message) {
  const fragment = document.createDocumentFragment();
  if (message.replyTo) {
    const reply = document.createElement("div");
    reply.className = "reply-quote";
    reply.textContent = `${message.replyTo.sender}: ${message.replyTo.text || message.replyTo.type}`;
    fragment.append(reply);
  }
  if (message.type === "photo") {
    const img = document.createElement("img");
    img.className = "chat-photo";
    img.src = message.dataUrl;
    img.alt = message.fileName || "Shared photo";
    fragment.append(img);
  }
  if (message.type === "voice") {
    fragment.append(voiceBubble(message));
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
  Object.entries(groupReactions(message.reactions || [])).forEach(([emoji, users]) => {
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
    const hasReacted = (message.reactions || []).some((reaction) => reaction.userId === currentUser.id && reaction.emoji === emoji);
    button.className = `emoji-button${hasReacted ? " active" : ""}`;
    button.type = "button";
    button.textContent = emoji;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleReaction(message.id, emoji);
    });
    reactionPicker.append(button);
  });

  panel.append(reactionPicker, infoBlock("Reacted by", reactionSummary(message.reactions || [])), infoBlock("Seen by", seenSummary(message.seenBy || [])));
  const replyButton = document.createElement("button");
  replyButton.className = "secondary-button reply-button";
  replyButton.type = "button";
  replyButton.textContent = "Reply";
  replyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    startReply(message);
  });
  panel.append(replyButton);
  return panel;
}

function infoBlock(title, body) {
  const wrap = document.createElement("div");
  wrap.className = "message-info-block";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const content = document.createElement("div");
  content.className = "seen-list";
  content.textContent = body;
  wrap.append(heading, content);
  return wrap;
}

async function sendTextMessage() {
  if (pendingVoice) {
    await sendPendingVoice();
    return;
  }
  const text = messageInput.value.trim();
  if (!text) return;
  await sendMessage({ type: "text", text });
  messageInput.value = "";
  resizeComposer();
}

async function sendPhotoMessage() {
  const file = photoInput.files?.[0];
  photoInput.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("Please choose a photo file.");
  await sendMessage({ type: "photo", text: messageInput.value.trim(), dataUrl: await fileToDataUrl(file), mimeType: file.type, fileName: file.name });
  messageInput.value = "";
  resizeComposer();
}

async function sendMessage(payload) {
  try {
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({
        conversationId: activeConversationId,
        replyTo: replyingTo,
        ...payload
      })
    });
    replyingTo = null;
    renderReplyPreview();
  } catch (error) {
    showToast(error.message || "Message failed.");
  }
}

async function toggleVoiceRecording() {
  if (mediaRecorder?.state === "recording") return mediaRecorder.stop();
  if (!navigator.mediaDevices?.getUserMedia) return showToast("Voice recording needs microphone access.");
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream);
    audioChunks = [];
    recordingStartedAt = Date.now();
    mediaRecorder.addEventListener("dataavailable", (event) => event.data.size > 0 && audioChunks.push(event.data));
    mediaRecorder.addEventListener("stop", async () => {
      audioStream.getTracks().forEach((track) => track.stop());
      voiceButton.classList.remove("recording");
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const seconds = Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000));
      pendingVoice = {
        type: "voice",
        text: `${seconds}s voice message`,
        dataUrl: await fileToDataUrl(blob),
        mimeType: blob.type,
        fileName: "voice-message.webm"
      };
      renderRecordingState();
    });
    mediaRecorder.start();
    voiceButton.classList.add("recording");
    pendingVoice = null;
    renderRecordingState(true);
  } catch {
    showToast("Microphone access was not allowed.");
  }
}

async function sendPendingVoice() {
  const voice = pendingVoice;
  pendingVoice = null;
  renderRecordingState();
  await sendMessage(voice);
}

function renderRecordingState(isRecording = mediaRecorder?.state === "recording") {
  const hasVoice = Boolean(pendingVoice);
  messageInput.closest(".message-input-wrap").classList.toggle("hidden", isRecording || hasVoice);
  recordingState.classList.toggle("hidden", !isRecording && !hasVoice);
  recordingState.textContent = isRecording ? "Recording voice message..." : "Voice message ready. Tap send.";
}

function startReply(message) {
  replyingTo = {
    id: message.id,
    sender: message.sender,
    text: message.text || `${message.type} message`,
    type: message.type
  };
  selectedMessageId = "";
  renderReplyPreview();
  renderMessages(false);
  messageInput.focus();
}

function renderReplyPreview() {
  replyPreview.classList.toggle("hidden", !replyingTo);
  replyPreview.innerHTML = replyingTo
    ? `<strong>Replying to ${escapeHtml(replyingTo.sender)}</strong><span>${escapeHtml(replyingTo.text)}</span><button type="button" aria-label="Cancel reply">x</button>`
    : "";
  replyPreview.querySelector("button")?.addEventListener("click", () => {
    replyingTo = null;
    renderReplyPreview();
  });
}

function voiceBubble(message) {
  const wrap = document.createElement("button");
  wrap.className = "voice-bubble";
  wrap.type = "button";
  wrap.innerHTML = `
    <span class="voice-avatar">${avatarMarkup(message.senderPhoto, message.sender)}</span>
    <span class="voice-play">${globalAudioSrc === message.dataUrl && !globalAudio.paused ? "❚❚" : "▶"}</span>
    <span class="voice-wave">${waveBars()}</span>
    <span class="voice-duration">${escapeHtml(message.text.replace(" voice message", ""))}</span>
  `;
  wrap.addEventListener("click", (event) => {
    event.stopPropagation();
    playGlobalVoice(message.dataUrl);
  });
  return wrap;
}

function playGlobalVoice(src) {
  if (globalAudioSrc !== src) {
    globalAudioSrc = src;
    globalAudio.src = src;
    globalAudio.load();
  }
  if (globalAudio.paused) globalAudio.play();
  else globalAudio.pause();
  renderMessages(false);
}

function waveBars() {
  return Array.from({ length: 24 }, (_, index) => `<i style="height:${8 + (index % 5) * 4}px"></i>`).join("");
}

async function searchFriends() {
  const users = await searchUsers(friendSearchInput.value);
  renderUserResults(searchResults, users, async (user) => {
    const conversation = await api("/api/conversations/private", { method: "POST", body: JSON.stringify({ userId: user.id }) });
    await loadConversations();
    friendSearchInput.value = "";
    searchResults.innerHTML = "";
    await selectConversation(conversation.id);
  });
}

async function searchGroupUsers() {
  const users = await searchUsers(groupUserSearchInput.value);
  renderUserResults(groupUserResults, users, (user) => {
    if (!selectedGroupUsers.some((item) => item.id === user.id)) selectedGroupUsers.push(user);
    groupUserSearchInput.value = "";
    groupUserResults.innerHTML = "";
    renderSelectedMembers();
  });
}

async function searchUsers(query) {
  if (!query.trim()) return [];
  return api(`/api/users?q=${encodeURIComponent(query)}`);
}

function renderUserResults(container, users, onSelect) {
  container.innerHTML = "";
  users.forEach((user) => {
    const button = document.createElement("button");
    button.className = "user-result";
    button.type = "button";
    button.innerHTML = `${avatarMarkup(user.photo, user.username)}<span><strong>${escapeHtml(user.username)}</strong><small>${escapeHtml(user.phone)}</small></span>`;
    button.addEventListener("click", () => onSelect(user));
    container.append(button);
  });
}

function openMembers() {
  const active = activeConversation();
  memberList.innerHTML = "";
  (active?.members || []).forEach((member) => {
    const button = document.createElement("button");
    button.className = "user-result";
    button.type = "button";
    button.innerHTML = `${avatarMarkup(member.photo, member.username)}<span><strong>${escapeHtml(member.username)}</strong><small>${escapeHtml(member.phone)}</small></span>`;
    button.addEventListener("click", async () => {
      membersDrawer.classList.add("hidden");
      if (member.id === currentUser.id) return;
      const conversation = await api("/api/conversations/private", { method: "POST", body: JSON.stringify({ userId: member.id }) });
      await loadConversations();
      await selectConversation(conversation.id);
    });
    memberList.append(button);
  });
  membersDrawer.classList.remove("hidden");
}

function openGroupSettings() {
  const active = activeConversation();
  if (!active || active.type !== "group" || active.id === "general") return;
  const isAdmin = active.createdBy === currentUser.id;
  pendingGroupSettingsPhoto = active.photo || "";
  groupSettingsNameInput.value = active.name;
  groupSettingsNameInput.disabled = !isAdmin;
  groupSettingsPhotoInput.disabled = !isAdmin;
  saveGroupSettingsButton.classList.toggle("hidden", !isAdmin);
  renderGroupSettingsPreview();
  renderGroupSettingsMembers();
  groupSettingsDrawer.classList.remove("hidden");
}

function closeGroupSettings(event) {
  event?.preventDefault();
  groupSettingsDrawer.classList.add("hidden");
}

async function loadGroupSettingsPhoto() {
  const file = groupSettingsPhotoInput.files?.[0];
  if (file) pendingGroupSettingsPhoto = await fileToDataUrl(file);
  renderGroupSettingsPreview();
}

function renderGroupSettingsPreview() {
  groupSettingsPreview.innerHTML = avatarMarkup(pendingGroupSettingsPhoto, groupSettingsNameInput.value || "Group");
}

function renderGroupSettingsMembers() {
  const active = activeConversation();
  const isAdmin = active?.createdBy === currentUser.id;
  groupSettingsMembers.innerHTML = "";
  (active?.members || []).forEach((member) => {
    const row = document.createElement("div");
    row.className = "member-admin-row";
    row.innerHTML = `${avatarMarkup(member.photo, member.username)}<span><strong>${escapeHtml(member.username)}</strong><small>${member.id === active.createdBy ? "Admin" : escapeHtml(member.phone)}</small></span>`;
    if (isAdmin && member.id !== currentUser.id) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => removeGroupMember(member.id));
      row.append(remove);
    }
    groupSettingsMembers.append(row);
  });
}

async function saveGroupSettings(event) {
  event.preventDefault();
  const active = activeConversation();
  const updated = await api(`/api/conversations/${active.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: groupSettingsNameInput.value, photo: pendingGroupSettingsPhoto })
  });
  await loadConversations();
  activeConversationId = updated.id;
  chatTitle.textContent = displayConversationName(activeConversation());
  closeGroupSettings();
}

async function removeGroupMember(memberId) {
  const active = activeConversation();
  await api(`/api/conversations/${active.id}/members/${memberId}`, { method: "DELETE" });
  await loadConversations();
  renderGroupSettingsMembers();
}

function openProfile() {
  profileUsernameInput.value = currentUser.username;
  pendingProfilePhoto = currentUser.photo || "";
  renderProfilePreview();
  profileDrawer.classList.remove("hidden");
}

function closeProfile(event) {
  event?.preventDefault();
  profileDrawer.classList.add("hidden");
}

async function loadProfilePhoto() {
  const file = profilePhotoInput.files?.[0];
  if (file) pendingProfilePhoto = await fileToDataUrl(file);
  renderProfilePreview();
}

function renderProfilePreview() {
  profilePreview.innerHTML = avatarMarkup(pendingProfilePhoto, profileUsernameInput.value || currentUser.username);
}

async function saveProfile(event) {
  event.preventDefault();
  const result = await api("/api/me", { method: "PATCH", body: JSON.stringify({ username: profileUsernameInput.value, photo: pendingProfilePhoto }) });
  currentUser = result.user;
  showApp();
  closeProfile();
  await loadConversations();
  renderMessages(false);
}

function openGroupCreator() {
  selectedGroupUsers = [];
  pendingGroupPhoto = "";
  groupForm.reset();
  renderSelectedMembers();
  groupDrawer.classList.remove("hidden");
}

function closeGroupCreator(event) {
  event?.preventDefault();
  groupDrawer.classList.add("hidden");
}

async function loadGroupPhoto() {
  const file = groupPhotoInput.files?.[0];
  pendingGroupPhoto = file ? await fileToDataUrl(file) : "";
}

function renderSelectedMembers() {
  selectedMembers.innerHTML = "";
  selectedGroupUsers.forEach((user) => {
    const chip = document.createElement("button");
    chip.className = "member-chip";
    chip.type = "button";
    chip.textContent = user.username;
    chip.addEventListener("click", () => {
      selectedGroupUsers = selectedGroupUsers.filter((item) => item.id !== user.id);
      renderSelectedMembers();
    });
    selectedMembers.append(chip);
  });
}

async function createGroup(event) {
  event.preventDefault();
  const conversation = await api("/api/conversations/group", {
    method: "POST",
    body: JSON.stringify({ name: groupNameInput.value, photo: pendingGroupPhoto, memberIds: selectedGroupUsers.map((user) => user.id) })
  });
  closeGroupCreator();
  await loadConversations();
  await selectConversation(conversation.id);
}

async function toggleReaction(messageId, emoji) {
  const message = await api(`/api/messages/${messageId}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) });
  upsertMessage(message);
  renderMessages(false);
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
  userAvatar.innerHTML = avatarMarkup(currentUser.photo, currentUser.username);
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  token = "";
  currentUser = null;
  messages = [];
  conversations = [];
  stream?.close();
  showAuth();
}

function activeConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0];
}

function displayConversationName(conversation) {
  if (!conversation) return "General";
  if (conversation.type === "private") return conversation.members.find((member) => member.id !== currentUser.id)?.username || "Private chat";
  return conversation.name;
}

function conversationPhoto(conversation) {
  if (!conversation) return "";
  if (conversation.type === "private") return conversation.members.find((member) => member.id !== currentUser.id)?.photo || "";
  return conversation.photo || "";
}

function memberSummary(conversation) {
  return `${conversation.members?.length || 0} members`;
}

function reactionSummary(reactions) {
  if (!reactions.length) return "No reactions yet";
  return Object.entries(groupReactions(reactions))
    .map(([emoji, users]) => `${emoji} ${users.map((user) => user.userId === currentUser.id ? "You" : user.username).join(", ")}`)
    .join(" | ");
}

function seenSummary(seenBy) {
  if (!seenBy.length) return "No one yet";
  return seenBy.map((viewer) => viewer.userId === currentUser.id ? "You" : viewer.username).join(", ");
}

function upsertMessage(message) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index >= 0) messages[index] = message;
  else messages.push(message);
}

function groupReactions(reactions) {
  return reactions.reduce((groups, reaction) => {
    groups[reaction.emoji] = groups[reaction.emoji] || [];
    groups[reaction.emoji].push(reaction);
    return groups;
  }, {});
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error('Cannot reach the chat server. Run "npm start" and open http://localhost:3000.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
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
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
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

function avatarMarkup(photo, name) {
  return photo
    ? `<img class="avatar-img" src="${photo}" alt="">`
    : `<span class="avatar-fallback">${escapeHtml((name || "?").slice(0, 1).toUpperCase())}</span>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatDuration(seconds) {
  const rounded = Math.floor(seconds || 0);
  const mins = Math.floor(rounded / 60);
  const secs = String(rounded % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function debounce(callback, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), wait);
  };
}
