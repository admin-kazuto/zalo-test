import express from "express";
import zaloManager from "../services/zalo.manager.js";
import multer from "multer";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
router.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "Server is running" });
});

router.get("/account", (req, res) => {
  try {
    const account = zaloManager.getActiveAccounts();
    res.status(200).json(account);
  } catch (error) {
    res.status(500).json({
      message: "Lỗi khi lấy danh sách tài khoản",
      error: error.message,
    });
  }
});

router.post("/message/send", upload.array("files", 10), async (req, res) => {
  // Bắt đầu khối try để "bẫy" bất kỳ lỗi nào có thể xảy ra
  try {
    // 1. Trích xuất dữ liệu từ request
    const { accountId, recipientIdentifier, recipientType, messageText } =
      req.body;

    // 2. Kiểm tra dữ liệu đầu vào cơ bản
    if (!accountId || !recipientIdentifier) {
      // Dùng return để kết thúc hàm ngay lập tức
      return res.status(400).json({
        message: "Thiếu thông tin bắt buộc: accountId hoặc recipientIdentifier",
      });
    }

    // 3. Xử lý logic nghiệp vụ (có thể phát sinh lỗi ở đây)
    let finalRecipientId = recipientIdentifier;

    // Kiểm tra và tìm kiếm người dùng nếu recipientIdentifier là số điện thoại
    if (/^(84|0)\d{9}$/.test(recipientIdentifier.replace(/\D/g, ""))) {
      let normalizedPhone = recipientIdentifier.replace(/\D/g, "");
      if (normalizedPhone.startsWith("0")) {
        normalizedPhone = "84" + normalizedPhone.substring(1);
      }
      const user = await zaloManager.findUserByPhone(
        accountId,
        normalizedPhone
      );
      if (!user || !user.userId) {
        return res.status(404).json({
          message: `Không tìm thấy người dùng Zalo với SĐT ${recipientIdentifier}.`,
        });
      }
      finalRecipientId = user.userId;
    }

    // Lấy danh sách file đã upload (nếu có)
    const attachments = req.files ? req.files : [];

    // Gọi hàm gửi tin nhắn (hàm này cũng có thể phát sinh lỗi)
    const result = await zaloManager.sendMessageWithAttachments(
      accountId,
      finalRecipientId,
      recipientType,
      messageText || "",
      attachments
    );

    // 4. Trả về kết quả thành công nếu mọi thứ suôn sẻ
    res
      .status(200)
      .json({ message: "Gửi tin nhắn và file thành công!", data: result });
  } catch (error) {
    // Khối catch sẽ được thực thi NẾU có bất kỳ lỗi nào xảy ra trong khối try

    // 1. Ghi lại lỗi ra console của server để debug
    console.error("!!! LỖI TẠI ROUTE /message/send:", error);

    // 2. Gửi một phản hồi lỗi chuẩn về cho client (Postman)
    res.status(500).json({
      message: `Đã xảy ra lỗi phía máy chủ: ${error.message}`,

    });
  }
});

router.post("/friends/request", async (req, res) => {
  const { accountId, targetIdentifier, message } = req.body;

  if (!accountId || !targetIdentifier) {
    return res
      .status(400)
      .json({ message: "Thiếu thông tin accountId hoặc targetIdentifier" });
  }

  try {
    const result = await zaloManager.sendFriendRequest(
      accountId,
      targetIdentifier,
      message
    );
    res
      .status(200)
      .json({ message: "Gửi lời mời kết bạn thành công!", data: result });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Lỗi khi gửi lời mời kết bạn: ${error.message}` });
  }
});

router.post("/friends/accept", async (req, res) => {
  const { accountId, userId } = req.body;
  if (!accountId || !userId) {
    return res
      .status(400)
      .json({ message: "Thiếu thông tin accountId hoặc userId" });
  }
  try {
    const result = await zaloManager.acceptFriendRequest(accountId, userId);
    res
      .status(200)
      .json({ message: "Chấp nhận lời mời kết bạn thành công!", data: result });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Lỗi khi chấp nhận kết bạn: ${error.message}` });
  }
});

router.delete("/friends", async (req, res) => {
  const { accountId, userId } = req.body;
  if (!accountId || !userId) {
    return res
      .status(400)
      .json({ message: "Thiếu thông tin accountId hoặc userId" });
  }
  try {
    const result = await zaloManager.unfriend(accountId, userId);
    res.status(200).json({ message: "Hủy kết bạn thành công!", data: result });
  } catch (error) {
    res.status(500).json({ message: `Lỗi khi hủy kết bạn: ${error.message}` });
  }
});

router.get("/accounts/:accountId/friends", async (req, res) => {
  const { accountId } = req.params;
  try {
    const result = await zaloManager.getFriendList(accountId);
    res.status(200).json(result);
  } catch (error) {
    res
      .status(500)
      .json({ message: `Lỗi khi lấy danh sách bạn bè: ${error.message}` });
  }
});
router.post("/groups", async (req, res) => {
  const { accountId, groupName, members } = req.body;
  if (!accountId || !groupName || !members) {
    return res
      .status(400)
      .json({ message: "Thiếu thông tin accountId, groupName hoặc members" });
  }
  try {
    const result = await zaloManager.createGroup(accountId, groupName, members);
    res.status(201).json({ message: "Tạo nhóm thành công!", data: result });
  } catch (error) {
    res.status(500).json({ message: `Lỗi khi tạo nhóm: ${error.message}` });
  }
});

router.get("/accounts/:accountId/groups", async (req, res) => {
  const { accountId } = req.params;
  try {
    const result = await zaloManager.getGroupList(accountId);
    res.status(200).json(result);
  } catch (error) {
    res
      .status(500)
      .json({ message: `Lỗi khi lấy danh sách nhóm: ${error.message}` });
  }
});

router.get("/groups/info-by-link", async (req, res) => {
  const { accountId, groupLink } = req.query;
  if (!accountId || !groupLink) {
    return res.status(400).json({
      message: "Cần cung cấp accountId và groupLink trong query params",
    });
  }
  try {
    const result = await zaloManager.getInfoMembersGroupLink(
      accountId,
      groupLink
    );
    res.status(200).json(result);
  } catch (error) {
    res
      .status(500)
      .json({ message: `Lỗi khi lấy thông tin nhóm: ${error.message}` });
  }
});

router.get("/accounts/:accountId/friend-requests/all", async (req, res) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res
        .status(400)
        .json({ message: "Thiếu thông tin accountId trong URL" });
    }

    // Chỉ cần gọi một hàm duy nhất để lấy tất cả và phân loại
    const result = await zaloManager.getAllFriendSuggestionsAndRequests(
      accountId
    );

    res.status(200).json(result);
  } catch (error) {
    console.error("!!! LỖI TẠI ROUTE .../friend-requests/all:", error);
    res.status(500).json({
      message: `Đã xảy ra lỗi khi lấy toàn bộ danh sách: ${error.message}`,
    });
  }
});

router.get("/accounts/:accountId/users/:targetIdentifier", async (req, res) => {
  const { accountId, targetIdentifier } = req.params;

  if (!accountId || !targetIdentifier) {
    return res.status(400).json({
      message: "Thiếu thông tin bắt buộc: accountId hoặc targetIdentifier",
    });
  }

  try {
    const result = await zaloManager.getUserProfile(
      accountId,
      targetIdentifier
    );
    res.status(200).json(result);
  } catch (error) {
    console.error("!!! LỖI TẠI ROUTE /users/:targetIdentifier:", error);
    res
      .status(500)
      .json({ message: `Lỗi khi lấy thông tin người dùng: ${error.message}` });
  }
});
export default router;
