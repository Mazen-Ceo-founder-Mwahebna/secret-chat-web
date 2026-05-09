const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const MAX_BODY_SIZE = 12 * 1024 * 1024;
const GENERAL_ID = "general";

const clients = new Set();

ensureDatabase();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/signup") {
      return sendJson(res, signUp(await readJsonBody(req)), 201);
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      return sendJson(res, logIn(await readJsonBody(req)));
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      return sendJson(res, { user: requireUser(req) });
    }

    if (req.method === "PATCH" && url.pathname === "/api/me") {
      return sendJson(res, updateProfile(req, await readJsonBody(req)));
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      const user = requireUser(req);
      return sendJson(res, searchUsers(url.searchParams.get("q") || "", user));
    }

    if (req.method === "GET" && url.pathname === "/api/conversations") {
      const user = requireUser(req);
      return sendJson(res, visibleConversations(user));
    }

    if (req.method === "POST" && url.pathname === "/api/conversations/private") {
      const user = requireUser(req);
      return sendJson(res, privateConversation(user, await readJsonBody(req)), 201);
    }

    if (req.method === "POST" && url.pathname === "/api/conversations/group") {
      const user = requireUser(req);
      return sendJson(res, groupConversation(user, await readJsonBody(req)), 201);
    }

    const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (req.method === "PATCH" && conversationMatch) {
      const user = requireUser(req);
      return sendJson(res, updateGroup(conversationMatch[1], user, await readJsonBody(req)));
    }

    const memberMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/members\/([^/]+)$/);
    if (req.method === "DELETE" && memberMatch) {
      const user = requireUser(req);
      return sendJson(res, removeGroupMember(memberMatch[1], memberMatch[2], user));
    }

    if (req.method === "GET" && url.pathname === "/api/messages") {
      const user = requireUser(req);
      const conversationId = url.searchParams.get("conversationId") || GENERAL_ID;
      const db = readDb();
      ensureConversationAccess(db, conversationId, user);
      const messages = db.messages.filter((message) => message.conversationId === conversationId);
      const changedMessages = markMessagesSeen(messages, user);
      writeDb(db);
      changedMessages.forEach((message) => broadcast({ type: "message:update", message }));
      return sendJson(res, messages);
    }

    if (req.method === "POST" && url.pathname === "/api/messages") {
      const user = requireUser(req);
      const message = createMessage(await readJsonBody(req), user);
      const db = readDb();
      ensureConversationAccess(db, message.conversationId, user);
      db.messages.push(message);
      touchConversation(db, message.conversationId);
      writeDb(db);
      broadcast({ type: "message", message });
      broadcast({ type: "conversations:update" });
      return sendJson(res, message, 201);
    }

    const reactionMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/reactions$/);
    if (req.method === "POST" && reactionMatch) {
      const user = requireUser(req);
      const message = toggleReaction(reactionMatch[1], (await readJsonBody(req)).emoji, user);
      broadcast({ type: "message:update", message });
      return sendJson(res, message);
    }

    if (req.method === "GET" && url.pathname === "/api/stream") {
      requireUser(req);
      return openStream(req, res);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, { error: error.message || "Server error" }, error.status || 500);
  }
});

server.listen(PORT, () => {
  console.log(`Secret Chat is running at http://localhost:${PORT}`);
});

function signUp(body) {
  const username = cleanText(body.username, 32);
  const phone = normalizePhone(body.phone);
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !phone || !password) throw badRequest("Username, phone number, and password are required.");
  if (username.length < 3) throw badRequest("Username must be at least 3 characters.");
  if (phone.length < 7) throw badRequest("Enter a valid phone number.");
  if (password.length < 6) throw badRequest("Password must be at least 6 characters.");

  const db = readDb();
  if (db.users.some((user) => user.phone === phone)) throw badRequest("An account with this phone number already exists.");

  const user = {
    id: crypto.randomUUID(),
    username,
    phone,
    photo: "",
    passwordHash: hashPassword(password),
    createdAt: Date.now()
  };

  db.users.push(user);
  const general = db.conversations.find((conversation) => conversation.id === GENERAL_ID);
  if (general && !general.memberIds.includes(user.id)) {
    general.memberIds.push(user.id);
  }
  const session = createSession(user.id);
  db.sessions.push(session);
  writeDb(db);
  return authPayload(user, session.token);
}

function logIn(body) {
  const phone = normalizePhone(body.phone);
  const password = typeof body.password === "string" ? body.password : "";
  if (!phone || !password) throw badRequest("Phone number and password are required.");

  const db = readDb();
  const user = db.users.find((item) => item.phone === phone);
  if (!user || !verifyPassword(password, user.passwordHash)) throw unauthorized("Phone number or password is incorrect.");

  const session = createSession(user.id);
  db.sessions.push(session);
  writeDb(db);
  return authPayload(user, session.token);
}

function updateProfile(req, body) {
  const current = requireUser(req);
  const username = cleanText(body.username, 32);
  const photo = typeof body.photo === "string" && body.photo.startsWith("data:image/") ? body.photo : "";
  if (!username || username.length < 3) throw badRequest("Username must be at least 3 characters.");

  const db = readDb();
  const user = db.users.find((item) => item.id === current.id);
  user.username = username;
  if (photo || body.photo === "") user.photo = photo;

  db.messages.forEach((message) => {
    if (message.userId === user.id) {
      message.sender = user.username;
      message.senderPhoto = user.photo || "";
    }
    message.reactions = (message.reactions || []).map((reaction) => {
      return reaction.userId === user.id ? { ...reaction, username: user.username } : reaction;
    });
    message.seenBy = (message.seenBy || []).map((viewer) => {
      return viewer.userId === user.id ? { ...viewer, username: user.username } : viewer;
    });
  });

  writeDb(db);
  broadcast({ type: "profile:update" });
  return { user: publicUser(user) };
}

function searchUsers(query, currentUser) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return readDb().users
    .filter((user) => user.id !== currentUser.id)
    .filter((user) => user.username.toLowerCase().includes(q) || user.phone.toLowerCase().includes(q))
    .slice(0, 12)
    .map(publicUser);
}

function visibleConversations(user) {
  const db = readDb();
  return db.conversations
    .filter((conversation) => conversation.id === GENERAL_ID || conversation.memberIds.includes(user.id))
    .map((conversation) => serializeConversation(db, conversation))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function privateConversation(user, body) {
  const friendId = cleanText(body.userId, 80);
  if (!friendId || friendId === user.id) throw badRequest("Choose a valid person.");

  const db = readDb();
  const friend = db.users.find((item) => item.id === friendId);
  if (!friend) throw badRequest("User was not found.");

  let conversation = db.conversations.find((item) => {
    return item.type === "private" && item.memberIds.includes(user.id) && item.memberIds.includes(friendId);
  });

  if (!conversation) {
    conversation = {
      id: crypto.randomUUID(),
      type: "private",
      name: "",
      photo: "",
      memberIds: [user.id, friendId],
      createdBy: user.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.conversations.push(conversation);
    writeDb(db);
    broadcast({ type: "conversations:update" });
  }

  return serializeConversation(db, conversation);
}

function groupConversation(user, body) {
  const name = cleanText(body.name, 40);
  const photo = typeof body.photo === "string" && body.photo.startsWith("data:image/") ? body.photo : "";
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter(Boolean) : [];
  if (!name) throw badRequest("Group name is required.");

  const db = readDb();
  const validIds = new Set(db.users.map((item) => item.id));
  const uniqueMemberIds = [...new Set([user.id, ...memberIds])].filter((id) => validIds.has(id));

  const conversation = {
    id: crypto.randomUUID(),
    type: "group",
    name,
    photo,
    memberIds: uniqueMemberIds,
    createdBy: user.id,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  db.conversations.push(conversation);
  writeDb(db);
  broadcast({ type: "conversations:update" });
  return serializeConversation(db, conversation);
}

function updateGroup(conversationId, user, body) {
  const db = readDb();
  const conversation = groupForAdmin(db, conversationId, user);
  const name = cleanText(body.name, 40);
  const photo = typeof body.photo === "string" && body.photo.startsWith("data:image/") ? body.photo : "";

  if (!name) throw badRequest("Group name is required.");
  conversation.name = name;
  if (photo || body.photo === "") conversation.photo = photo;
  conversation.updatedAt = Date.now();

  writeDb(db);
  broadcast({ type: "conversations:update" });
  return serializeConversation(db, conversation);
}

function removeGroupMember(conversationId, memberId, user) {
  const db = readDb();
  const conversation = groupForAdmin(db, conversationId, user);
  if (memberId === user.id) throw badRequest("The admin cannot remove themself.");
  conversation.memberIds = conversation.memberIds.filter((id) => id !== memberId);
  conversation.updatedAt = Date.now();
  writeDb(db);
  broadcast({ type: "conversations:update" });
  return serializeConversation(db, conversation);
}

function createMessage(body, user) {
  const conversationId = cleanText(body.conversationId, 80) || GENERAL_ID;
  const type = ["text", "photo", "voice"].includes(body.type) ? body.type : "text";
  const text = cleanText(body.text, 2000);
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.slice(0, 80) : "";
  const fileName = cleanText(body.fileName, 120);
  const replyTo = body.replyTo && typeof body.replyTo === "object" ? {
    id: cleanText(body.replyTo.id, 80),
    sender: cleanText(body.replyTo.sender, 32),
    text: cleanText(body.replyTo.text, 180),
    type: cleanText(body.replyTo.type, 20)
  } : null;

  if (type === "text" && !text) throw badRequest("Text messages cannot be empty.");
  if ((type === "photo" || type === "voice") && !dataUrl.startsWith("data:")) throw badRequest("Media messages need a valid data URL.");

  return {
    id: crypto.randomUUID(),
    conversationId,
    userId: user.id,
    sender: user.username,
    senderPhoto: user.photo || "",
    phone: user.phone,
    type,
    text,
    dataUrl,
    mimeType,
    fileName,
    replyTo,
    reactions: [],
    seenBy: [seenUser(user)],
    createdAt: Date.now()
  };
}

function toggleReaction(messageId, emoji, user) {
  const allowed = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}"];
  if (!allowed.includes(emoji)) throw badRequest("Choose one of the available reactions.");

  const db = readDb();
  const message = findMessage(db, messageId);
  ensureConversationAccess(db, message.conversationId, user);
  message.reactions = Array.isArray(message.reactions) ? message.reactions : [];

  const existingIndex = message.reactions.findIndex((reaction) => reaction.userId === user.id && reaction.emoji === emoji);
  if (existingIndex >= 0) {
    message.reactions.splice(existingIndex, 1);
  } else {
    message.reactions = message.reactions.filter((reaction) => reaction.userId !== user.id);
    message.reactions.push({ emoji, userId: user.id, username: user.username, createdAt: Date.now() });
  }

  writeDb(db);
  return message;
}

function serializeConversation(db, conversation) {
  const members = conversation.memberIds
    .map((id) => db.users.find((user) => user.id === id))
    .filter(Boolean)
    .map(publicUser);
  const lastMessage = db.messages.filter((message) => message.conversationId === conversation.id).at(-1);

  return {
    ...conversation,
    members,
    lastMessage: lastMessage?.text || (lastMessage?.type ? `${lastMessage.type} message` : "")
  };
}

function ensureConversationAccess(db, conversationId, user) {
  const conversation = db.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw badRequest("Conversation was not found.");
  if (conversation.type === "private" && !conversation.memberIds.includes(user.id)) throw unauthorized("You are not in this chat.");
  if (conversation.type === "group" && conversation.id !== GENERAL_ID && !conversation.memberIds.includes(user.id)) throw unauthorized("You are not in this group.");
}

function groupForAdmin(db, conversationId, user) {
  const conversation = db.conversations.find((item) => item.id === conversationId);
  if (!conversation || conversation.type !== "group" || conversation.id === GENERAL_ID) throw badRequest("Group was not found.");
  if (conversation.createdBy !== user.id) throw unauthorized("Only the group admin can do that.");
  return conversation;
}

function markMessagesSeen(messages, user) {
  const changedMessages = [];
  messages.forEach((message) => {
    message.reactions = Array.isArray(message.reactions) ? message.reactions : [];
    message.seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
    if (!message.seenBy.some((viewer) => viewer.userId === user.id)) {
      message.seenBy.push(seenUser(user));
      changedMessages.push(message);
    }
  });
  return changedMessages;
}

function touchConversation(db, conversationId) {
  const conversation = db.conversations.find((item) => item.id === conversationId);
  if (conversation) conversation.updatedAt = Date.now();
}

function findMessage(db, messageId) {
  const message = db.messages.find((item) => item.id === messageId);
  if (!message) throw badRequest("Message was not found.");
  return message;
}

function requireUser(req) {
  const db = readDb();
  const session = db.sessions.find((item) => item.token === bearerToken(req));
  if (!session) throw unauthorized("Please log in first.");
  const user = db.users.find((item) => item.id === session.userId);
  if (!user) throw unauthorized("Account not found.");
  return publicUser(user);
}

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) writeDb({ users: [], sessions: [], conversations: [], messages: [] });

  const db = readDb();
  db.users = Array.isArray(db.users) ? db.users : [];
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.conversations = Array.isArray(db.conversations) ? db.conversations : [];
  db.messages = Array.isArray(db.messages) ? db.messages : [];
  db.users.forEach((user) => {
    user.photo = user.photo || "";
  });
  if (!db.conversations.some((item) => item.id === GENERAL_ID)) {
    db.conversations.unshift({
      id: GENERAL_ID,
      type: "group",
      name: "General",
      photo: "",
      memberIds: db.users.map((user) => user.id),
      createdBy: "system",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  const general = db.conversations.find((item) => item.id === GENERAL_ID);
  general.memberIds = db.users.map((user) => user.id);
  db.messages.forEach((message) => {
    message.conversationId = message.conversationId || GENERAL_ID;
    message.senderPhoto = message.senderPhoto || db.users.find((user) => user.id === message.userId)?.photo || "";
    message.reactions = Array.isArray(message.reactions) ? message.reactions : [];
    message.seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
  });
  writeDb(db);
}

function openStream(req, res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

function broadcast(payload) {
  const packet = `event: update\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((client) => client.write(packet));
}

function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) return sendJson(res, { error: "Not found" }, 404);
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(res, { error: "Not found" }, 404);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY_SIZE) {
        reject(badRequest("Message is too large. Try a smaller photo or voice note."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(badRequest("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) return false;
  const testHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(testHash, "hex"));
}

function createSession(userId) {
  return { token: crypto.randomBytes(32).toString("hex"), userId, createdAt: Date.now() };
}

function authPayload(user, token) {
  return { token, user: publicUser(user) };
}

function publicUser(user) {
  return { id: user.id, username: user.username, phone: user.phone, photo: user.photo || "" };
}

function seenUser(user) {
  return { userId: user.id, username: user.username, seenAt: Date.now() };
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("token") || "";
}

function normalizePhone(value) {
  return typeof value === "string" ? value.replace(/[^\d+]/g, "").slice(0, 24) : "";
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function unauthorized(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}

function contentType(filePath) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml"
  };
  return types[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}
