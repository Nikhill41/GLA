import "dotenv/config";
import express from "express";
import http from "http";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { randomUUID as id } from "crypto";
import { Server } from "socket.io";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { COURSES, validYear } from "./courses.js";
const {
  JWT_SECRET: JWT,
  JWT_EXPIRES_IN = "7d",
  AWS_REGION: region,
  AWS_S3_BUCKET: B,
  CLIENT_URL = "http://localhost:5173",
  PORT = 4000,
} = process.env;
if (!JWT) throw new Error("JWT_SECRET required");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({ region });
const iso = () => new Date().toISOString(),
  bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
const h = (f) => (q, s, n) =>
  Promise.resolve()
    .then(() => f(q, s, n))
    .catch(n);
const get = async (T, Key) =>
  (await ddb.send(new GetCommand({ TableName: T, Key }))).Item;
const put = (T, Item) => ddb.send(new PutCommand({ TableName: T, Item }));
const upd = (T, Key, e, V, N, C) =>
  ddb.send(
    new UpdateCommand({
      TableName: T,
      Key,
      UpdateExpression: e,
      ExpressionAttributeValues: V,
      ExpressionAttributeNames: N,
      ConditionExpression: C,
    }),
  );
const scan = async (T, F, V, N) => {
  let items = [],
    k;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: T,
        FilterExpression: F,
        ExpressionAttributeValues: V,
        ExpressionAttributeNames: N,
        ExclusiveStartKey: k,
      }),
    );
    items.push(...r.Items);
    k = r.LastEvaluatedKey;
  } while (k);
  return items;
};
const U = (i) => get("Users", { userId: i });
const byEmail = async (e) =>
  (
    await ddb.send(
      new QueryCommand({
        TableName: "Users",
        IndexName: "emailIndex",
        KeyConditionExpression: "email=:e",
        ExpressionAttributeValues: { ":e": e },
      }),
    )
  ).Items[0];
const sign = (uid) => jwt.sign({ uid }, JWT, { expiresIn: JWT_EXPIRES_IN });
const url = (k) =>
  k
    ? getSignedUrl(s3, new GetObjectCommand({ Bucket: B, Key: k }), {
        expiresIn: 3600,
      })
    : null;
const pub = async (u) =>
  u && {
    userId: u.userId,
    name: u.name,
    course: u.course,
    year: u.year,
    age: u.age,
    bio: u.bio || "",
    isActive: u.isActive,
    photoUrl: await url(u.photoKey),
  };
const own = async (u) => ({
  ...(await pub(u)),
  email: u.email,
  mobile: u.mobile,
  gender: u.gender,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});
const note = (r, type, message) => ({
  Put: {
    TableName: "Notifications",
    Item: {
      recipientId: r,
      notificationId: iso() + "_" + id(),
      type,
      message,
      read: false,
      createdAt: iso(),
    },
  },
});
const notify = async (...a) => put("Notifications", note(...a).Put.Item);
const STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const val = (b, full) => {
  if (full) {
    if (!/^\S+@\S+\.\S+$/.test(b.email || "")) throw bad("Invalid email");
    if (!["Male", "Female"].includes(b.gender)) throw bad("Gender required");
    if (!STRONG.test(b.password || ""))
      throw bad("Weak password: 8+ chars with upper, lower and a digit");
    if (b.password !== b.confirmPassword) throw bad("Passwords do not match");
  }
  if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(b.name || ""))
    throw bad("Invalid name");
  if (!validYear(b.course, +b.year))
    throw bad("Invalid course or year for that course");
  const a = +b.age;
  if (!Number.isInteger(a) || a < 16 || a >= 40) throw bad("Age must be between 16 and 39");
  if (!/^[6-9]\d{9}$/.test(b.mobile || "")) throw bad("Invalid mobile number");
  if ((b.bio || "").length > 200) throw bad("Bio too long");
};
const up = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (q, f, cb) =>
    ["image/jpeg", "image/png", "image/webp"].includes(f.mimetype)
      ? cb(null, true)
      : cb(bad("Only JPG, PNG or WEBP images")),
});
const putPhoto = async (uid, f) => {
  const Key = `photos/${uid}-${id()}`;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: B,
        Key,
        Body: f.buffer,
        ContentType: f.mimetype,
      }),
    );
  } catch {
    throw bad("Photo upload failed", 502);
  }
  return Key;
};
const auth = h((q, s, n) => {
  try {
    q.uid = jwt.verify((q.headers.authorization || "").slice(7), JWT).uid;
  } catch {
    throw bad("Unauthorized", 401);
  }
  n();
});
const app = express(),
  srv = http.createServer(app),
  io = new Server(srv, { cors: { origin: CLIENT_URL } });
app.use(
  helmet(),
  cors({ origin: CLIENT_URL }),
  express.json({ limit: "100kb" }),
  rateLimit({ windowMs: 6e4, limit: 300 }),
);
app.use("/api/auth", rateLimit({ windowMs: 9e5, limit: 60 }));
app.get("/api/config/courses", (q, s) => s.json(COURSES));
// AUTH
app.post(
  "/api/auth/register",
  up.single("photo"),
  h(async (q, s) => {
    const b = q.body,
      email = (b.email || "").trim().toLowerCase();
    val({ ...b, email }, true);
    if (!q.file) throw bad("Profile photo required");
    if (await byEmail(email)) throw bad("Email already registered", 409);
    const userId = id(),
      now = iso(),
      photoKey = await putPhoto(userId, q.file);
    await put("Users", {
      userId,
      email,
      name: b.name.trim(),
      course: b.course,
      year: +b.year,
      age: +b.age,
      mobile: b.mobile,
      gender: b.gender,
      bio: b.bio || "",
      passwordHash: await bcrypt.hash(b.password, 10),
      photoKey,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    s.status(201).json({ token: sign(userId) });
  }),
);
app.post(
  "/api/auth/login",
  h(async (q, s) => {
    const u = await byEmail((q.body.email || "").trim().toLowerCase());
    if (!u || !(await bcrypt.compare(q.body.password || "", u.passwordHash)))
      throw bad("Invalid email or password", 401);
    s.json({ token: sign(u.userId) });
  }),
);
app.get(
  "/api/auth/me",
  auth,
  h(async (q, s) => {
    const u = await U(q.uid);
    if (!u) throw bad("Unauthorized", 401);
    s.json(await own(u));
  }),
);
// PROFILE
app.get(
  "/api/profile",
  auth,
  h(async (q, s) => s.json(await own(await U(q.uid)))),
);
app.put(
  "/api/profile",
  auth,
  h(async (q, s) => {
    val(q.body);
    const b = q.body;
    await upd(
      "Users",
      { userId: q.uid },
      "SET #n=:n,course=:c,#y=:y,age=:a,mobile=:m,bio=:b,updatedAt=:t",
      {
        ":n": b.name.trim(),
        ":c": b.course,
        ":y": +b.year,
        ":a": +b.age,
        ":m": b.mobile,
        ":b": b.bio || "",
        ":t": iso(),
      },
      { "#n": "name", "#y": "year" },
    );
    s.json(await own(await U(q.uid)));
  }),
);
app.put(
  "/api/profile/visibility",
  auth,
  h(async (q, s) => {
    if (typeof q.body.isActive !== "boolean")
      throw bad("isActive boolean required");
    await upd("Users", { userId: q.uid }, "SET isActive=:a,updatedAt=:t", {
      ":a": q.body.isActive,
      ":t": iso(),
    });
    s.json(await own(await U(q.uid)));
  }),
);
app.post(
  "/api/profile/photo",
  auth,
  up.single("photo"),
  h(async (q, s) => {
    if (!q.file) throw bad("Photo required");
    await upd("Users", { userId: q.uid }, "SET photoKey=:k,updatedAt=:t", {
      ":k": await putPhoto(q.uid, q.file),
      ":t": iso(),
    });
    s.json(await own(await U(q.uid)));
  }),
);
// DISCOVERY (gender/active enforced here)
const discover = h(async (q, s) => {
  const me = await U(q.uid),
    { q: term = "", course = "", year = "" } = q.query,
    t = term.trim().toLowerCase();
  let l = await scan("Users", "gender=:g AND isActive=:t", {
    ":g": me.gender === "Male" ? "Female" : "Male",
    ":t": true,
  });
  l = l.filter(
    (u) =>
      u.userId !== q.uid &&
      (!t || u.name.toLowerCase().includes(t)) &&
      (!course || u.course === course) &&
      (!year || u.year === +year),
  );
  s.json(await Promise.all(l.map(pub)));
});
app.get("/api/users/suggestions", auth, discover);
app.get("/api/users/search", auth, discover);
app.get(
  "/api/users/:id",
  auth,
  h(async (q, s) => {
    const me = await U(q.uid),
      u = await U(q.params.id);
    if (!u || !u.isActive || u.gender === me.gender || u.userId === q.uid)
      throw bad("User not found", 404);
    s.json(await pub(u));
  }),
);
// REQUESTS
const pk = (a, b) => [a, b].sort().join("#"),
  mid = (p) => "MATCH_" + p.replace("#", "_");
app.post(
  "/api/requests",
  auth,
  h(async (q, s) => {
    const to = q.body.receiverId;
    if (to === q.uid) throw bad("Cannot request yourself");
    const [me, u] = await Promise.all([U(q.uid), U(to)]);
    if (!u) throw bad("User not found", 404);
    if (!u.isActive) throw bad("User is inactive");
    if (u.gender === me.gender)
      throw bad("Same-gender requests are not allowed");
    const m = await get("Matches", { matchId: mid(pk(q.uid, to)) });
    if (m?.status === "ACTIVE") throw bad("Already matched", 409);
    const d = await scan(
      "Requests",
      "#s=:p AND ((senderId=:a AND receiverId=:b) OR (senderId=:b AND receiverId=:a))",
      { ":p": "PENDING", ":a": q.uid, ":b": to },
      { "#s": "status" },
    );
    if (d.length) throw bad("A pending request already exists", 409);
    const r = {
      requestId: id(),
      senderId: q.uid,
      receiverId: to,
      status: "PENDING",
      createdAt: iso(),
      updatedAt: iso(),
    };
    await put("Requests", r);
    await notify(to, "NEW_REQUEST", `${me.name} sent you a partner request`);
    s.status(201).json(r);
  }),
);
const list = (f, o) =>
  h(async (q, s) => {
    const rs = (await scan("Requests", `${f}=:u`, { ":u": q.uid })).sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    );
    s.json(
      await Promise.all(
        rs.map(async (r) => ({ ...r, user: await pub(await U(r[o])) })),
      ),
    );
  });
app.get("/api/requests/received", auth, list("receiverId", "senderId"));
app.get("/api/requests/sent", auth, list("senderId", "receiverId"));
app.put(
  "/api/requests/:id/accept",
  auth,
  h(async (q, s) => {
    const r = await get("Requests", { requestId: q.params.id });
    if (!r || r.receiverId !== q.uid) throw bad("Request not found", 404);
    if (r.status !== "PENDING") throw bad("Request is no longer pending", 409);
    const [a, b] = await Promise.all([U(r.senderId), U(r.receiverId)]);
    if (!a || !b || !a.isActive || !b.isActive || a.gender === b.gender)
      throw bad("Users are not eligible to match", 409);
    const p = pk(a.userId, b.userId),
      now = iso(),
      N = { "#s": "status" };
    const m = {
      matchId: mid(p),
      pairKey: p,
      user1Id: a.userId,
      user2Id: b.userId,
      user1Gender: a.gender,
      user2Gender: b.gender,
      requestId: r.requestId,
      status: "ACTIVE",
      matchedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: "Requests",
                Key: { requestId: r.requestId },
                UpdateExpression: "SET #s=:a,updatedAt=:n",
                ConditionExpression: "#s=:p",
                ExpressionAttributeNames: N,
                ExpressionAttributeValues: {
                  ":a": "ACCEPTED",
                  ":p": "PENDING",
                  ":n": now,
                },
              },
            },
            {
              Put: {
                TableName: "Matches",
                Item: m,
                ConditionExpression: "attribute_not_exists(matchId) OR #s=:u",
                ExpressionAttributeNames: N,
                ExpressionAttributeValues: { ":u": "UNMATCHED" },
              },
            },
            note(
              a.userId,
              "REQUEST_ACCEPTED",
              `${b.name} accepted your request`,
            ),
            note(a.userId, "MATCH_CREATED", `You matched with ${b.name}`),
            note(b.userId, "MATCH_CREATED", `You matched with ${a.name}`),
          ],
        }),
      );
    } catch (e) {
      if (e.name === "TransactionCanceledException")
        throw bad("Already matched or request changed", 409);
      throw e;
    }
    s.json({ request: { ...r, status: "ACCEPTED" }, match: m });
  }),
);
const close = (status, own_, type) =>
  h(async (q, s) => {
    const r = await get("Requests", { requestId: q.params.id });
    if (!r || r[own_] !== q.uid) throw bad("Request not found", 404);
    if (r.status !== "PENDING") throw bad("Request is no longer pending", 409);
    await upd(
      "Requests",
      { requestId: r.requestId },
      "SET #s=:s,updatedAt=:t",
      { ":s": status, ":t": iso() },
      { "#s": "status" },
    );
    if (type)
      await notify(
        r.senderId,
        type,
        `${(await U(r.receiverId)).name} declined your request`,
      );
    s.json({ ...r, status });
  });
app.put(
  "/api/requests/:id/reject",
  auth,
  close("REJECTED", "receiverId", "REQUEST_REJECTED"),
);
app.delete("/api/requests/:id", auth, close("CANCELLED", "senderId"));
// MATCHES
const mine = async (m, uid) => {
  if (!m || (m.user1Id !== uid && m.user2Id !== uid))
    throw bad("Match not found", 404);
  return m;
};
app.get(
  "/api/matches",
  auth,
  h(async (q, s) => {
    const ms = await scan(
      "Matches",
      "#s=:a AND (user1Id=:u OR user2Id=:u)",
      { ":a": "ACTIVE", ":u": q.uid },
      { "#s": "status" },
    );
    s.json(
      await Promise.all(
        ms.map(async (m) => ({
          ...m,
          user: await pub(await U(m.user1Id === q.uid ? m.user2Id : m.user1Id)),
        })),
      ),
    );
  }),
);
app.get(
  "/api/matches/:id",
  auth,
  h(async (q, s) =>
    s.json(await mine(await get("Matches", { matchId: q.params.id }), q.uid)),
  ),
);
app.put(
  "/api/matches/:id/unmatch",
  auth,
  h(async (q, s) => {
    const m = await mine(await get("Matches", { matchId: q.params.id }), q.uid);
    if (m.status !== "ACTIVE") throw bad("Match is not active", 409);
    await upd(
      "Matches",
      { matchId: m.matchId },
      "SET #s=:s,updatedAt=:t,unmatchedBy=:u",
      { ":s": "UNMATCHED", ":t": iso(), ":u": q.uid },
      { "#s": "status" },
    );
    io.to(m.matchId).emit("unmatched");
    s.json({ ...m, status: "UNMATCHED" });
  }),
);
// MESSAGES
const activeMatch = async (matchId, uid) => {
  const m = await mine(await get("Matches", { matchId }), uid);
  if (m.status !== "ACTIVE")
    throw bad("Chat unavailable: match is not active", 403);
  return m;
};
const sendMsg = async (uid, matchId, text) => {
  const m = await activeMatch(matchId, uid),
    t = (text || "").trim();
  if (!t || t.length > 1000) throw bad("Message must be 1-1000 characters");
  const to = m.user1Id === uid ? m.user2Id : m.user1Id,
    now = iso(),
    msg = {
      matchId,
      messageId: now + "_" + id(),
      senderId: uid,
      receiverId: to,
      message: t,
      createdAt: now,
    };
  await put("Messages", msg);
  io.to(matchId).emit("message", msg);
  try {
    await notify(to, "NEW_MESSAGE", `New message from ${(await U(uid)).name}`);
  } catch (e) {
    console.error("Message notification failed after message was saved", e);
  }
  return msg;
};
app.get(
  "/api/messages/:matchId",
  auth,
  h(async (q, s) => {
    await activeMatch(q.params.matchId, q.uid);
    s.json(
      (
        await ddb.send(
          new QueryCommand({
            TableName: "Messages",
            KeyConditionExpression: "matchId=:m",
            ExpressionAttributeValues: { ":m": q.params.matchId },
            Limit: 500,
          }),
        )
      ).Items,
    );
  }),
);
app.post(
  "/api/messages",
  auth,
  h(async (q, s) =>
    s.status(201).json(await sendMsg(q.uid, q.body.matchId, q.body.message)),
  ),
);
// NOTIFICATIONS
app.get(
  "/api/notifications",
  auth,
  h(async (q, s) =>
    s.json(
      (
        await ddb.send(
          new QueryCommand({
            TableName: "Notifications",
            KeyConditionExpression: "recipientId=:r",
            ExpressionAttributeValues: { ":r": q.uid },
            ScanIndexForward: false,
            Limit: 50,
          }),
        )
      ).Items,
    ),
  ),
);
app.put(
  "/api/notifications/:id/read",
  auth,
  h(async (q, s) => {
    try {
      await upd(
        "Notifications",
        { recipientId: q.uid, notificationId: q.params.id },
        "SET #r=:t",
        { ":t": true },
        { "#r": "read" },
        "attribute_exists(recipientId)",
      );
    } catch {
      throw bad("Notification not found", 404);
    }
    s.json({ ok: true });
  }),
);
app.use((q, s) => s.status(404).json({ message: "Not found" }));
app.use((e, q, s, n) => {
  const c = e.code === "LIMIT_FILE_SIZE" ? 400 : e.status || 500;
  if (c === 500) console.error(e);
  s.status(c).json({
    message:
      e.code === "LIMIT_FILE_SIZE"
        ? "Image must be under 3MB"
        : c === 500
          ? "Server error"
          : e.message,
  });
});
// SOCKET.IO: every join/send re-verifies match membership + ACTIVE status
io.use((sock, n) => {
  try {
    sock.uid = jwt.verify(sock.handshake.auth.token, JWT).uid;
    n();
  } catch {
    n(new Error("Unauthorized"));
  }
});
io.on("connection", (sock) => {
  sock.on("join", async (m, ack) => {
    try {
      await activeMatch(m, sock.uid);
      sock.join(m);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ error: e.message });
    }
  });
  sock.on("message", async ({ matchId, message }, ack) => {
    try {
      await sendMsg(sock.uid, matchId, message);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ error: e.message });
    }
  });
});
srv.listen(PORT, () => console.log("API on", PORT));
