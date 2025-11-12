import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";
import cors from "cors"; 
import { initializeSocketHandler } from "./subscribers/socket.handler.js"; 
import zaloManager from "./services/zalo.manager.js";
import router from "./apis/api.router.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "https://tool-zalo.vercel.app",
  "http://localhost:5173"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
}));

const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/api", router);

app.get("/api/qr-code/:tempId.png", (req, res) => {
  const { tempId } = req.params;
  const qrCodeData = zaloManager.getQrCodeForSession(tempId);

  if (qrCodeData) {
    const base64Image = qrCodeData.split(";base64,").pop();
    const imgBuffer = Buffer.from(base64Image, "base64");
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": imgBuffer.length
    });
    res.end(imgBuffer);
  } else {
    res.status(404).json({ message: "Không tìm thấy phiên đăng nhập hoặc QR code đã hết hạn." });
  }
});

initializeSocketHandler(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[SERVER] Đang lắng nghe cổng ${PORT}`);
  console.log(`[SERVER] Cho phép từ: ${allowedOrigins.join(", ")}`);
});
