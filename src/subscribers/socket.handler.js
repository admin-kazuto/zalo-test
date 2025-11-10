import zaloManager from "../services/zalo.manager.js";

export function initializeSocketHandler(io) {
  zaloManager.on("qr-code", ({ tempId, socketId }) => {
    console.log(
      `[Socket Handler] Đang gửi 'qr_code_ready' đến client: ${socketId}`
    );

    io.to(socketId).emit("qr_code_ready", { tempId });
  });

  zaloManager.on("login-success", ({ socketId, accountInfo }) => {
    io.to(socketId).emit("login_successful", {
      id: accountInfo.id,
      name: accountInfo.name,
    });
    io.emit("update_accounts_list", zaloManager.getActiveAccounts());
  });

  zaloManager.on("login-failure", ({ socketId, error }) =>
    io.to(socketId).emit("login_failed", { error })
  );

  zaloManager.on("account-disconnected", () =>
    io.emit("update_accounts_list", zaloManager.getActiveAccounts())
  );

  // Xử lý khi có client mới kết nối
  io.on("connection", (socket) => {
    console.log(`[Socket] Client đã kết nối: ${socket.id}`);
    socket.emit("update_accounts_list", zaloManager.getActiveAccounts());

    // API duy nhất client gọi qua socket: Yêu cầu đăng nhập mới
    socket.on("request_new_login", () => {
      zaloManager.initiateLogin(socket.id, io);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Client đã ngắt kết nối: ${socket.id}`);
    });
  });
}
