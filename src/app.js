import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";

import { initializeSocket } from "./subscribers/socket.handler.js";
import zaloManager from "./services/zalo.manager.js";

dotenv.config();

const app = express();
// Tăng giới hạn payload cho Express
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const server = http.createServer(app);

const PORT = process.env.PORT || 3001;
const allowedOrigins = [
    process.env.CLIENT_ORIGIN || "http://localhost:5173",
    "http://127.0.0.1:5500",
    "null"
];

// --- CẤU HÌNH SOCKET.IO ĐẦY ĐỦ NHẤT ---
const io = new SocketIOServer(server, {
    // Giới hạn ở lớp Socket.IO
    maxHttpBufferSize: 1e8, // 100MB
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    },
    // Truyền trực tiếp tùy chọn xuống lớp Engine.IO và WS
    // Đây là bước quan trọng nhất
    engine: {
        maxHttpBufferSize: 1e8, // 100MB cho Engine.IO
        wsOptions: {
            maxPayload: 1e8 // 100MB cho lớp WS cấp thấp
        }
    }
});
// --- KẾT THÚC CẤU HÌNH ---


app.get("/api/health", (req, res) => {
    res.status(200).json({ status: "OK", message: "Server is running" });
});

app.get("/api/accounts", (req, res) => {
    try {
        const accounts = zaloManager.getActiveAccounts();
        res.status(200).json(accounts);
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi lấy danh sách tài khoản", error: error.message });
    }
});

initializeSocket(io);

server.listen(PORT, () => {
    console.log(`[SERVER] Đang chạy ở môi trường: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[SERVER] Máy chủ đang lắng nghe trên cổng ${PORT}`);
    console.log(`[SERVER] Cho phép kết nối từ các nguồn: ${allowedOrigins.join(', ')}`);
});