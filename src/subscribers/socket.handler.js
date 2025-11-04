import zaloManager from "../services/zalo.manager.js";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "..", "..", "upload", "tmp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function isPhoneNumber(str) {
  const normalized = str.replace(/\D/g, "");
  return /^(84|0)\d{9}$/.test(normalized);
}

export function initializeSocket(io) {
  // Phần 1: Lắng nghe sự kiện từ ZaloManager
  zaloManager.on("qr-code", ({ tempId, socketId }) =>
    io.to(socketId).emit("qr_code_ready", { tempId })
  );
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

  // BẮT ĐẦU KHỐI KẾT NỐI TỪ CLIENT
  io.on("connection", (socket) => {
    console.log(`[Socket] Client đã kết nối: ${socket.id}`);
    socket.emit("update_accounts_list", zaloManager.getActiveAccounts());

    socket.on("request_new_login", () => zaloManager.initiateLogin(socket.id));

    socket.on("test_find_user_by_phone", async (data, callback) => {
      const { accountId, phoneNumber } = data;
      if (!accountId || !phoneNumber) {
        return callback({
          status: "error",
          message: "Cần có tài khoản thực thi và SĐT.",
        });
      }
      let normalizedPhone = phoneNumber.replace(/\D/g, "");
      if (normalizedPhone.startsWith("0")) {
        normalizedPhone = "84" + normalizedPhone.substring(1);
      }
      try {
        const user = await zaloManager.findUserByPhone(
          accountId,
          normalizedPhone
        );
        if (user) {
          callback({ status: "ok", data: user });
        } else {
          callback({
            status: "not_found",
            message: "Không tìm thấy người dùng.",
          });
        }
      } catch (error) {
        callback({ status: "error", message: error.message });
      }
    });

    socket.on("send_friend_request", async (data, callback) => {
      const { accountId, targetIdentifier, message } = data;

      if (!accountId || !targetIdentifier) {
        return callback({
          status: "error",
          message: "Cần có tài khoản và thông tin người nhận.",
        });
      }

      try {
        socket.emit("scenario_update", {
          message: `🚀 Bắt đầu gửi lời mời kết bạn đến: ${targetIdentifier}...`,
        });

        const result = await zaloManager.sendFriendRequest(
          accountId,
          targetIdentifier,
          message || "Chào bạn, mình kết bạn nhé!"
        );

        socket.emit("scenario_update", {
          message: `✅ Đã gửi lời mời kết bạn thành công!`,
        });

        callback({
          status: "ok",
          message: "Gửi lời mời kết bạn thành công!",
          data: result,
        });
      } catch (error) {
        const errorMessage = error.message || "Lỗi không xác định.";
        socket.emit("scenario_update", {
          message: `❌ Lỗi: ${errorMessage}`,
        });
        callback({ status: "error", message: errorMessage });
      }
    });

    socket.on("send_message", async (data, callback) => {
      const {
        accountId,
        recipientIdentifier,
        recipientType,
        messageText,
        files,
      } = data;
      if (
        !accountId ||
        !recipientIdentifier ||
        (!messageText && (!files || files.length === 0))
      ) {
        return callback({ status: "error", message: "Dữ liệu không hợp lệ." });
      }

      const tempFilePaths = [];
      let finalRecipientId = "";

      try {
        if (isPhoneNumber(recipientIdentifier)) {
          socket.emit("scenario_update", {
            message: `Đang tìm kiếm SĐT: ${recipientIdentifier}...`,
          });
          let normalizedPhone = recipientIdentifier.replace(/\D/g, "");
          if (normalizedPhone.startsWith("0")) {
            normalizedPhone = "84" + normalizedPhone.substring(1);
          }
          const user = await zaloManager.findUserByPhone(
            accountId,
            normalizedPhone
          );
          if (!user || !user.userId) {
            const errorMessage = `Không tìm thấy người dùng cho SĐT ${recipientIdentifier}.`;
            socket.emit("scenario_update", { message: `❌ ${errorMessage}` });
            return callback({ status: "not_found", message: errorMessage });
          }
          finalRecipientId = user.userId;
          socket.emit("scenario_update", {
            message: `✅ Tìm thấy: ${user.name} (${finalRecipientId}).`,
          });
        } else {
          finalRecipientId = recipientIdentifier;
          socket.emit("scenario_update", {
            message: `Đang gửi trực tiếp đến UID: ${finalRecipientId}...`,
          });
        }

        if (files && files.length > 0) {
          for (const file of files) {
            const base64Data = file.fileData.split(",")[1];
            const fileBuffer = Buffer.from(base64Data, "base64");
            const uniqueFileName = `${uuidv4()}-${file.fileName}`;
            const tempFilePath = path.join(TEMP_DIR, uniqueFileName);
            fs.writeFileSync(tempFilePath, fileBuffer);
            tempFilePaths.push(tempFilePath);
          }
        }

        await zaloManager.sendMessageWithAttachments(
          accountId,
          finalRecipientId,
          recipientType,
          messageText,
          tempFilePaths
        );

        socket.emit("scenario_update", {
          message: `🎉 Gửi thành công đến ${finalRecipientId}!`,
        });
        callback({
          status: "ok",
          message: "Yêu cầu đã được thực thi thành công!",
        });
      } catch (error) {
        const errorMessage = error.message || "Lỗi không xác định.";
        socket.emit("scenario_update", { message: `⚠️ Lỗi: ${errorMessage}` });
        callback({ status: "error", message: errorMessage });
      } finally {
        for (const filePath of tempFilePaths) {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
    });

    socket.on("get_group_info_by_id", async (data, callback) => {
      const { accountId, groupId } = data;
      if (!accountId || !groupId) {
        return callback({
          status: "error",
          message: "Cần có tài khoản và Group ID.",
        });
      }
      try {
        const result = await zaloManager.getInfoMembersGroupId(
          accountId,
          groupId
        );
        callback({ status: "ok", data: result });
      } catch (error) {
        callback({ status: "error", message: error.message });
      }
    });

    socket.on("get_group_info_by_link", async (data, callback) => {
      const { accountId, groupLink } = data;
      if (!accountId || !groupLink) {
        return callback({
          status: "error",
          message: "Cần có tài khoản và Group Link.",
        });
      }
      try {
        const result = await zaloManager.getInfoMembersGroupLink(
          accountId,
          groupLink
        );
        callback({ status: "ok", data: result });
      } catch (error) {
        callback({ status: "error", message: error.message });
      }
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Client đã ngắt kết nối: ${socket.id}`);
    });

    socket.on("test_join_group_link", async (data, callback) => {
      const { accountId, groupLink } = data;

      if (!accountId || !groupLink) {
        return callback({
          status: "error",
          message: "Cần có tài khoản và Group Link.",
        });
      }

      try {
        socket.emit("scenario_update", {
          message: `🧪 Test API: joinGroupLink(${groupLink})...`,
        });

        const result = await zaloManager.testJoinGroupLink(
          accountId,
          groupLink
        );

        socket.emit("scenario_update", {
          message: `✅ Bot đã join nhóm qua link!`,
        });

        callback({
          status: "ok",
          message: result.message,
          data: result,
        });
      } catch (error) {
        const errorMessage = error.message || "Lỗi không xác định.";
        socket.emit("scenario_update", {
          message: `❌ Lỗi: ${errorMessage}`,
        });
        callback({ status: "error", message: errorMessage });
      }
    });

    socket.on("get_friend_list", async (data, callback) => {
      const { accountId } = data;

      if (!accountId) {
        return callback({
          status: "error",
          message: "Cần có tài khoản.",
        });
      }

      try {
        socket.emit("scenario_update", {
          message: `📋 Đang lấy danh sách bạn bè...`,
        });

        const result = await zaloManager.getFriendList(accountId);

        socket.emit("scenario_update", {
          message: `✅ Đã lấy ${result.totalFriends} bạn bè!`,
        });

        callback({
          status: "ok",
          message: result.message,
          data: result,
        });
      } catch (error) {
        const errorMessage = error.message || "Lỗi không xác định.";
        socket.emit("scenario_update", {
          message: `❌ Lỗi: ${errorMessage}`,
        });
        callback({ status: "error", message: errorMessage });
      }
    });

    socket.on("get_group_list", async (data, callback) => {
      const { accountId } = data;

      if (!accountId) {
        return callback({
          status: "error",
          message: "Cần có tài khoản.",
        });
      }

      try {
        socket.emit("scenario_update", {
          message: `📋 Đang lấy danh sách nhóm...`,
        });

        const result = await zaloManager.getGroupList(accountId);

        socket.emit("scenario_update", {
          message: `✅ Đã lấy ${result.totalGroups} nhóm!`,
        });

        callback({
          status: "ok",
          message: result.message,
          data: result,
        });
      } catch (error) {
        const errorMessage = error.message || "Lỗi không xác định.";
        socket.emit("scenario_update", {
          message: `❌ Lỗi: ${errorMessage}`,
        });
        callback({ status: "error", message: errorMessage });
      }
    });

    socket.on("unfriend", async (data, callback) => {
      const { accountId, userId } = data;

      if (!accountId || !userId) {
        return callback({
          status: "error",
          message: "Cần có tài khoản và User ID.",
        });
      }

      try {
        socket.emit("scenario_update", {
          message: `💔 Đang hủy kết bạn với User ID: ${userId}...`,
        });

        const result = await zaloManager.unfriend(accountId, userId);

        socket.emit("scenario_update", {
          message: `✅ Đã hủy kết bạn thành công!`,
        });

        callback({
          status: "ok",
          message: result.message,
          data: result,
        });
      } catch (error) {
        const errorMessage = error.message || "Lỗi không xác định.";
        socket.emit("scenario_update", {
          message: `❌ Lỗi: ${errorMessage}`,
        });
        callback({ status: "error", message: errorMessage });
      }
    });

    // ... bên trong hàm io.on("connection", ...) ...

    // ==========================================
    // SOCKET: Tạo nhóm mới
    // ==========================================
    socket.on("create_group", async (data, callback) => {
      const { accountId, groupName, members } = data; // members là mảng [UID, SĐT, ...]

      if (
        !accountId ||
        !members ||
        !Array.isArray(members) ||
        members.length === 0
      ) {
        return callback({
          status: "error",
          message: "Cần có tài khoản thực thi và danh sách thành viên.",
        });
      }

      try {
        socket.emit("scenario_update", {
          message: `🚀 Bắt đầu tạo nhóm "${groupName}"...`,
        });

        const result = await zaloManager.createGroup(
          accountId,
          groupName,
          members
        );

        let successMessage = `✅ Đã tạo nhóm thành công với ID: ${result.data.groupId}`;
        if (result.failedIdentifiers && result.failedIdentifiers.length > 0) {
          successMessage += `. Không thể thêm ${result.failedIdentifiers.length} thành viên.`;
        }

        socket.emit("scenario_update", {
          message: successMessage,
        });

        callback({
          status: "ok",
          message: "Tạo nhóm thành công!",
          data: result,
        });
      } catch (error) {
        const errorMessage = error.message || "Lỗi không xác định.";
        socket.emit("scenario_update", {
          message: `❌ Lỗi khi tạo nhóm: ${errorMessage}`,
        });
        callback({ status: "error", message: errorMessage });
      }
    });

   
  });
}
