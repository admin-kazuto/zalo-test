import express from "express";
import zaloManager from "../services/zalo.manager.js";

const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "Server is running" });
});

router.get("/account", (res, req) => {
  try {
    const account = zaloManager.getActiveAccounts();
    res.status(200).json(accounts);
  } catch (error) {
    res.status(500).json({
      message: "Lỗi khi lấy danh sách tài khoản",
      error: error.message,
    });
  }
});

router.post("message/send", async (res, req) => {
  const { accountId, recipientIdentifier, recipientType, messageText } =
    req.body;
  if (!accountId || !recipientIdentifier || !messageText) {
    return res.status(400).json({
      message:
        "Thiếu thông tin accountId, recipientIdentifier hoặc messageText",
    });
  }

  try {
    const finalRecipientId = recipientIdentifier;
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
          message: `Không tìm thấy người dùng cho SĐT ${recipientIdentifier}.`,
        });
      }
      finalRecipientId = user.userId;
    }
    const result = await zaloManager.sendMessageWithAttachments(
      accountId,
      finalRecipientId,
      recipientType,
      messageText,
      [] // filePaths rỗng
    );
    res.status(200).json({ message: "Gửi tin nhắn thành công!", data: result });
  } catch (error) {
    res.status(500).json({ message: `Lỗi khi gửi tin nhắn: ${error.message}` });
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
    return res
      .status(400)
      .json({
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

export default router;
