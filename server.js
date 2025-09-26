const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // allow all origins (Netlify frontend will connect here)
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// ❌ Removed: app.use(express.static("public"))

// MongoDB (require env var)
const mongoURI = process.env.MONGO_URI;

if (!mongoURI) {
  console.error("❌ No MONGO_URI found. Set it in Render environment variables.");
  process.exit(1);
}

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("❌ MongoDB error:", err);
    process.exit(1);
  });

const messageSchema = new mongoose.Schema({
  username: String,
  userId: String,
  message: String,
  fromAdmin: Boolean,
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model("Message", messageSchema);

const socketToUser = {};
const users = {};

function publicUsersList() {
  const out = {};
  for (const uid in users) {
    if (users[uid].role !== "admin") {
      out[uid] = {
        username: users[uid].username || "Anonymous",
        online: !!users[uid].online
      };
    }
  }
  return out;
}

io.on("connection", (socket) => {
  console.log("🔌 Connected:", socket.id);

  socket.on("join", (data) => {
    const { username = "Anonymous", role = "user", userId } = data || {};
    const finalUserId = userId || socket.id;

    socketToUser[socket.id] = finalUserId;
    users[finalUserId] = users[finalUserId] || {};
    users[finalUserId].username = username;
    users[finalUserId].role = role;
    users[finalUserId].socketId = socket.id;
    users[finalUserId].online = true;

    if (role === "admin") {
      socket.join("admins");
      socket.emit("online-users", publicUsersList());
    } else {
      socket.join(finalUserId);
      io.to("admins").emit("online-users", publicUsersList());
    }
  });

  socket.on("get-chat-history", async (data) => {
    try {
      const { userId } = data || {};
      if (!userId) return socket.emit("chat-history", []);
      const messages = await Message.find({ userId }).sort({ timestamp: 1 });
      socket.emit("chat-history", messages);
    } catch (err) {
      console.error("❌ Chat history error:", err);
    }
  });

  socket.on("send-message", async (data) => {
    try {
      const targetUserId = data.userId || socketToUser[socket.id] || socket.id;
      const newMessage = new Message({
        username: data.username || (users[targetUserId]?.username) || "Anonymous",
        userId: targetUserId,
        message: data.message,
        fromAdmin: !!data.fromAdmin
      });

      await newMessage.save();

      io.to("admins").emit("receive-message", newMessage);
      io.to(targetUserId).emit("receive-message", newMessage);
    } catch (err) {
      console.error("❌ Send message error:", err);
    }
  });

  socket.on("disconnect", () => {
    const userId = socketToUser[socket.id];
    if (userId && users[userId]) {
      users[userId].online = false;
      users[userId].socketId = null;
    }
    delete socketToUser[socket.id];
    io.to("admins").emit("online-users", publicUsersList());
    console.log("❌ Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));