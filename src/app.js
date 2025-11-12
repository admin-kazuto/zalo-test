import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";
import cors from 'cors'; 
import { initializeSocketHandler } from "./subscribers/socket.handler.js"; 
import zaloManager from './services/zalo.manager.js';
import router from "./apis/api.router.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

// --- CẤU HÌNH CORS ---
const allowedOrigins = [
    "http://localhost:3000", // Địa chỉ của React FE
    // "http://127.0.0.1:5500",
    // "null", 
    "*",
    "https://tool-zalo.vercel.app"
];

// BƯỚC 1: Cấu hình CORS cho các HTTP Request (quan trọng cho handshake ban đầu của Socket.IO)
app.use(cors({ origin: allowedOrigins }));

// BƯỚC 2: Khởi tạo Socket.IO Server với cấu hình CORS
const io = new SocketIOServer(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});
// --- KẾT THÚC CẤU HÌNH CORS ---


// Middleware để xử lý JSON body
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Server is running properly 🚀"
  });
});

// Tích hợp RESTful API (nếu có)
app.use("/api", router);

app.get('/api/qr-code/:tempId.png', (req, res) => {
    const { tempId } = req.params;
    // Lấy dữ liệu ảnh base64 đã được lưu trong zaloManager
    const qrCodeData = zaloManager.getQrCodeForSession(tempId);

    if (qrCodeData) {
        // Tách phần tiền tố 'data:image/png;base64,'
        const base64Image = qrCodeData.split(';base64,').pop();
        // Chuyển đổi base64 thành buffer ảnh
        const imgBuffer = Buffer.from(base64Image, 'base64');

        // Trả về ảnh cho trình duyệt
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': imgBuffer.length
        });
        res.end(imgBuffer);
    } else {
        res.status(404).json({ message: "Không tìm thấy phiên đăng nhập hoặc QR code đã hết hạn." });
    }
});


initializeSocketHandler(io);


// const PORT = process.env.PORT || 3001;
const PORT = process.env.PORT
server.listen(PORT, () => {
    console.log(`[SERVER] Máy chủ đang lắng nghe trên cổng ${PORT}`);
    console.log(`[SERVER] Cho phép kết nối từ các nguồn: ${allowedOrigins.join(', ')}`);
});


