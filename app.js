import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";

import { initializeSocket } from "./subscribers/socket.handler.js";
import zaloManager from "./services/zalo.manager.js";

dotenv.config();

const app = express();

app.use(express.json());

const server = http.createServer(app);

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const io = new SocketIOServer(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "Server is running" });
});

app.get("/api/accounts", (req, res) => {
  try {
    const accounts = zaloManager.getActiveAccounts();
    res.status(200).json(accounts);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Lỗi khi lấy danh sách tài khoản",
        error: error.message,
      });
  }
});

initializeSocket(io);

server.listen(PORT, () => {
  console.log(
    `[SERVER] Đang chạy ở môi trường: ${process.env.NODE_ENV || "development"}`
  );
  console.log(`[SERVER] Máy chủ đang lắng nghe trên cổng ${PORT}`);
  console.log(`[SERVER] Cho phép client kết nối từ: ${CLIENT_ORIGIN}`);
});
