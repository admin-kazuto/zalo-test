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


// import jwt from "jsonwebtoken";
// import zaloManager from "../services/zalo.manager.js";
// // Giả định bạn sẽ tạo một file service để xử lý logic với database
// import { findOrCreateAccount }- from "../services/account.service.js"; 

// export function initializeSocketHandler(io) {
//   // Lắng nghe sự kiện 'qr-code' từ ZaloManager
//   zaloManager.on("qr-code", ({ tempId, socketId }) => {
//     console.log(`[Socket Handler] Gửi 'qr_code_ready' đến client: ${socketId}`);
//     io.to(socketId).emit("qr_code_ready", { tempId });
//   });

//   // Lắng nghe sự kiện 'login-failure' từ ZaloManager
//   zaloManager.on("login-failure", ({ socketId, error }) => {
//     io.to(socketId).emit("login_failed", { error });
//   });

//   // Lắng nghe sự kiện 'account-disconnected' từ ZaloManager
//   zaloManager.on("account-disconnected", () => {
//     io.emit("update_accounts_list", zaloManager.getActiveAccounts());
//   });

//   // =================================================================
//   // == THAY ĐỔI QUAN TRỌNG NHẤT NẰM Ở ĐÂY ==
//   // =================================================================
//   // Lắng nghe sự kiện 'login-success' từ ZaloManager
//   zaloManager.on("login-success", async ({ socketId, accountInfo }) => {
//     try {
//       // BƯỚC 1: Tìm hoặc tạo mới tài khoản trong Database để lấy quyền (role)
//       // Hàm 'findOrCreateAccount' này bạn cần tự viết trong file account.service.js
//       const accountInDb = await findOrCreateAccount({
//         accountId: accountInfo.id,
//         zaloName: accountInfo.name,
//       });

//       if (!accountInDb) {
//         throw new Error("Không thể tạo hoặc tìm thấy tài khoản trong hệ thống.");
//       }

//       // BƯỚC 2: Tạo Payload cho Token, chứa cả ID và quyền
//       const payload = {
//         accountId: accountInfo.id,
//         role: accountInDb.role, // Lấy quyền từ database
//       };

//       // BƯỚC 3: Ký và tạo Token
//       const token = jwt.sign(payload, process.env.JWT_SECRET, {
//         expiresIn: "7d", // Ví dụ: Token hết hạn sau 7 ngày
//       });

//       console.log(`[Auth] Đã tạo token cho ${accountInfo.name} với quyền ${accountInDb.role}`);

//       // BƯỚC 4: Gửi thông tin đăng nhập thành công KÈM THEO TOKEN về client
//       io.to(socketId).emit("login_successful", {
//         id: accountInfo.id,
//         name: accountInfo.name,
//         role: accountInDb.role, // Gửi cả role về để FE tiện xử lý giao diện
//         token: token,           // Gửi token - thứ quan trọng nhất
//       });
      
//       // Cập nhật danh sách tài khoản cho tất cả client
//       io.emit("update_accounts_list", zaloManager.getActiveAccounts());

//     } catch (dbError) {
//       console.error("[Auth] Lỗi database trong quá trình xử lý đăng nhập:", dbError);
//       io.to(socketId).emit("login_failed", { error: "Lỗi hệ thống, không thể xác thực tài khoản." });
//     }
//   });

//   // Xử lý khi có client mới kết nối
//   io.on("connection", (socket) => {
//     console.log(`[Socket] Client đã kết nối: ${socket.id}`);
//     socket.emit("update_accounts_list", zaloManager.getActiveAccounts());

//     socket.on("request_new_login", () => {
//       zaloManager.initiateLogin(socket.id, io);
//     });

//     socket.on("disconnect", () => {
//       console.log(`[Socket] Client đã ngắt kết nối: ${socket.id}`);
//     });
//   });
// }