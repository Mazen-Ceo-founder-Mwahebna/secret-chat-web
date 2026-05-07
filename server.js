const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const MAX_BODY_SIZE = 12 * 1024 * 1024;

const clients = new Set();

ensureDatabase();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/signup") {
      const body = await readJsonBody(req);
      return sendJson(res, signUp(body), 201);
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readJsonBody(req);
      return sendJson(res, logIn(body));
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      return sendJson(res, { user: requireUser(req) });
    }

    if (req.method === "GET" && url.pathname === "/api/messages") {
      const user = requireUser(req);
      const db = readDb();
      const changedMessages = markMessagesSeen(db, user);
      writeDb(db);
      changedMessages.forEach((message) => broadcast({ type: "message:update", message }));
      return sendJson(res, db.messages);
    }

    if (req.method === "POST" && url.pathname === "/api/messages") {
      const user = requireUser(req);
      const body = await readJsonBody(req);
      const message = createMessage(body, user);
      const db = readDb();
      db.messages.push(message);
      writeDb(db);
      broadcast({ type: "message", message });
      return sendJson(res, message, 201);
    }

    const reactionMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/reactions$/);
    if (req.method === "POST" && reactionMatch) {
      const user = requireUser(req);
      const body = await readJsonBody(req);
      const message = toggleReaction(reactionMatch[1], body.emoji, user);
      broadcast({ type: "message:update", message });
      return sendJson(res, message);
    }

    if (req.method === "GET" && url.pathname === "/api/stream") {
      requireUser(req);
      return openStream(req, res);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, { error: error.message || "Server error" }, status);
  }
});

server.listen(PORT, () => {
  console.log(`Secret Chat is running at http://localhost:${PORT}`);
});

function signUp(body) {
  const username = cleanText(body.username, 32);
  const phone = normalizePhone(body.phone);
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !phone || !password) {
    throw badRequest("Username, phone number, and password are required.");
  }

  if (username.length < 3) {
    throw badRequest("Username must be at least 3 characters.");
  }

  if (phone.length < 7) {
    throw badRequest("Enter a valid phone number.");
  }

  if (password.length < 6) {
    throw badRequest("Password must be at least 6 characters.");
  }

  const db = readDb();
  if (db.users.some((user) => user.phone === phone)) {
    throw badRequest("An account with this phone number already exists.");
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    phone,
    passwordHash: hashPassword(password),
    createdAt: Date.now()
  };

  db.users.push(user);
  const session = createSession(user.id);
  db.sessions.push(session);
  writeDb(db);

  return authPayload(user, session.token);
}

function logIn(body) {
  const phone = normalizePhone(body.phone);
  const password = typeof body.password === "string" ? body.password : "";

  if (!phone || !password) {
    throw badRequest("Phone number and password are required.");
  }

  const db = readDb();
  const user = db.users.find((item) => item.phone === phone);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw unauthorized("Phone number or password is incorrect.");
  }

  const session = createSession(user.id);
  db.sessions.push(session);
  writeDb(db);

  return authPayload(user, session.token);
}

function requireUser(req) {
  const token = bearerToken(req);
  const db = readDb();
  const session = db.sessions.find((item) => item.token === token);

  if (!session) {
    throw unauthorized("Please log in first.");
  }

  const user = db.users.find((item) => item.id === session.userId);
  if (!user) {
    throw unauthorized("Account not found.");
  }

  return publicUser(user);
}

function createMessage(body, user) {
  const type = ["text", "photo", "voice"].includes(body.type) ? body.type : "text";
  const text = cleanText(body.text, 2000);
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.slice(0, 80) : "";
  const fileName = cleanText(body.fileName, 120);

  if (type === "text" && !text) {
    throw badRequest("Text messages cannot be empty.");
  }

  if ((type === "photo" || type === "voice") && !dataUrl.startsWith("data:")) {
    throw badRequest("Media messages need a valid data URL.");
  }

  return {
    id: crypto.randomUUID(),
    userId: user.id,
    sender: user.username,
    phone: user.phone,
    type,
    text,
    dataUrl,
    mimeType,
    fileName,
    reactions: [],
    seenBy: [seenUser(user)],
    createdAt: Date.now()
  };
}

function toggleReaction(messageId, emoji, user) {
  const allowed = ["👍", "❤️", "😂", "😮", "😢"];
  if (!allowed.includes(emoji)) {
    throw badRequest("Choose one of the available reactions.");
  }

  const db = readDb();
  const message = findMessage(db, messageId);
  message.reactions = Array.isArray(message.reactions) ? message.reactions : [];

  const existingIndex = message.reactions.findIndex((reaction) => {
    return reaction.userId === user.id && reaction.emoji === emoji;
  });

  if (existingIndex >= 0) {
    message.reactions.splice(existingIndex, 1);
  } else {
    message.reactions = message.reactions.filter((reaction) => reaction.userId !== user.id);
    message.reactions.push({
      emoji,
      userId: user.id,
      username: user.username,
      createdAt: Date.now()
    });
  }

  writeDb(db);
  return message;
}

function markMessagesSeen(db, user) {
  const changedMessages = [];

  db.messages.forEach((message) => {
    message.reactions = Array.isArray(message.reactions) ? message.reactions : [];
    message.seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];

    if (!message.seenBy.some((viewer) => viewer.userId === user.id)) {
      message.seenBy.push(seenUser(user));
      changedMessages.push(message);
    }
  });

  return changedMessages;
}

function findMessage(db, messageId) {
  const message = db.messages.find((item) => item.id === messageId);
  if (!message) {
    throw badRequest("Message was not found.");
  }

  return message;
}

function seenUser(user) {
  return {
    userId: user.id,
    username: user.username,
    seenAt: Date.now()
  };
}

function openStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  clients.add(res);

  req.on("close", () => {
    clients.delete(res);
  });
}

function broadcast(payload) {
  const packet = `event: update\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of clients) {
    client.write(packet);
  }
}

function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    return sendJson(res, { error: "Not found" }, 404);
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      return sendJson(res, { error: "Not found" }, 404);
    }

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

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    writeDb({ users: [], sessions: [], messages: [] });
    return;
  }

  const db = readDb();
  db.users = Array.isArray(db.users) ? db.users : [];
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.messages = Array.isArray(db.messages) ? db.messages : [];
  writeDb(db);
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
  if (!salt || !hash) {
    return false;
  }

  const testHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(testHash, "hex"));
}

function createSession(userId) {
  return {
    token: crypto.randomBytes(32).toString("hex"),
    userId,
    createdAt: Date.now()
  };
}

function authPayload(user, token) {
  return {
    token,
    user: publicUser(user)
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    phone: user.phone
  };
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7);
  }

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
  const ext = path.extname(filePath).toLowerCase();
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

  return types[ext] || "application/octet-stream";
}
