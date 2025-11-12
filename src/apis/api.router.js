import express from "express";
import zaloManager from "../services/zalo.manager.js";
import multer from "multer";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
// router.get("/health", (req, res) => {
//   res.status(200).json({ status: "OK", message: "Server is running" });
// });

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

router.get("/accounts/:accountId/groups/:groupId", async (req, res) => {
  // BƯỚC 1: Lấy cả accountId và groupId trực tiếp từ req.params
  const { accountId, groupId } = req.params;

  // BƯỚC 2: Kiểm tra dữ liệu đầu vào (đã được Express đảm bảo là có)
  // Không cần kiểm tra vì nếu thiếu, route sẽ không khớp

  try {
    // BƯỚC 3: Gọi hàm service để lấy thông tin nhóm bằng ID
    const groupInfo = await zaloManager.getInfoMembersGroupId(accountId, groupId);

    // BƯỚC 4: Kiểm tra kết quả trả về
    if (!groupInfo) {
      return res.status(404).json({
        message: `Không tìm thấy thông tin cho nhóm có ID: ${groupId} hoặc tài khoản ${accountId} không có quyền truy cập.`,
      });
    }

    // BƯỚC 5: Trả về dữ liệu JSON thành công cho frontend
    res.status(200).json(groupInfo);

  } catch (error) {
    // BƯỚC 6: Bắt lỗi và gửi phản hồi
    console.error(`[API /accounts/:accountId/groups/:groupId] Lỗi:`, error);
    res.status(500).json({
      message: `Đã xảy ra lỗi phía máy chủ khi lấy thông tin nhóm: ${error.message}`,
    });
  }
});

router.get("/groups/export-members", async (req, res) => {
  // BƯỚC 1: Lấy accountId trực tiếp từ Query Params của URL
  const { accountId, groupLink, groupId } = req.query;

  // BƯỚC 2: Kiểm tra xem accountId có được gửi lên hay không
  if (!accountId) {
    return res
      .status(400)
      .json({ message: "Thiếu thông tin bắt buộc: accountId" });
  }
  if (!groupLink && !groupId) {
    return res
      .status(400)
      .json({ message: "Cần cung cấp groupLink hoặc groupId" });
  }

  try {
    let groupInfo;
    if (groupLink) {
      groupInfo = await zaloManager.getInfoMembersGroupLink(
        accountId,
        groupLink
      );
    } else {
      groupInfo = await zaloManager.getInfoMembersGroupId(accountId, groupId);
    }

    if (
      !groupInfo ||
      !groupInfo.currentMems ||
      groupInfo.currentMems.length === 0
    ) {
      return res
        .status(404)
        .json({
          message: "Không tìm thấy nhóm hoặc nhóm không có thành viên.",
        });
    }

    const uids = groupInfo.currentMems.map((member) => member.id);
    const fileContent = uids.join("\n");
    const fileName = `members_${groupInfo.groupId || "export"}.txt`;

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.send(fileContent);
  } catch (error) {
    console.error(`[Export] Lỗi khi xuất UID thành viên:`, error);
    res
      .status(500)
      .json({ message: `Lỗi khi xuất UID thành viên: ${error.message}` });
  }
});


router.post(
  "/messages/bulk-from-file",
  // Middleware của Multer để xử lý file upload có tên form-data là 'uidFile'
  upload.single('uidFile'),
  async (req, res) => {
    try {
      // 1. Lấy dữ liệu từ body (form-data)
      const { accountId, messageText } = req.body;

      // 2. Kiểm tra các thông tin bắt buộc
      if (!accountId) {
        return res.status(400).json({ message: "Thiếu thông tin bắt buộc: accountId" });
      }
      if (!messageText) {
        return res.status(400).json({ message: "Vui lòng nhập nội dung tin nhắn (messageText)." });
      }
      if (!req.file) {
        return res.status(400).json({ message: "Vui lòng tải lên một file .txt (uidFile)." });
      }

      // 3. Đọc và xử lý file để lấy danh sách UIDs
      const fileContent = req.file.buffer.toString('utf-8');
      const uids = fileContent.split(/\r?\n/).map(uid => uid.trim()).filter(uid => uid);

      if (uids.length === 0) {
        return res.status(400).json({ message: "File không chứa UID hợp lệ nào." });
      }

      // 4. Gọi hàm xử lý chạy nền trong ZaloManager
      const result = await zaloManager.bulkSendMessageToUids(accountId, uids, messageText);

      // 5. Trả về phản hồi ngay lập tức cho client
      // Status 202 Accepted: "Yêu cầu đã được chấp nhận để xử lý, nhưng chưa hoàn thành"
      console.log(`[API] Bắt đầu chiến dịch gửi tin hàng loạt tới ${uids.length} người dùng.`);
      res.status(202).json(result);

    } catch (error) {
      console.error(`[API /messages/bulk-from-file] Lỗi:`, error);
      res.status(500).json({ message: `Lỗi khi bắt đầu chiến dịch gửi tin: ${error.message}` });
    }
  }
);


// router.post("/messages/bulk-send-from-file",
//   checkRole(['pro', 'superadmin']),
//   upload.single('uidFile'), // Middleware của Multer để xử lý file upload có tên là 'uidFile'
//   async (req, res) => {
//     const accountId = req.user.accountId;
//     const { messageText } = req.body;

//     if (!req.file) {
//       return res.status(400).json({ message: "Vui lòng tải lên một file .txt chứa UIDs." });
//     }
//     if (!messageText) {
//       return res.status(400).json({ message: "Vui lòng nhập nội dung tin nhắn." });
//     }

//     try {
//       // 1. Đọc nội dung file từ buffer
//       const fileContent = req.file.buffer.toString('utf-8');

//       // 2. Tách nội dung thành một mảng các UIDs
//       // - .split(/\r?\n/) để tách các dòng (hoạt động trên cả Windows và Linux)
//       // - .map(uid => uid.trim()) để xóa khoảng trắng thừa
//       // - .filter(uid => uid) để loại bỏ các dòng trống
//       const uids = fileContent.split(/\r?\n/).map(uid => uid.trim()).filter(uid => uid);

//       if (uids.length === 0) {
//         return res.status(400).json({ message: "File không chứa UID hợp lệ nào." });
//       }

//       // 3. Gọi hàm xử lý chạy nền trong ZaloManager
//       const result = await zaloManager.bulkSendMessageToUids(accountId, uids, messageText);

//       // 4. Trả về phản hồi ngay lập tức cho client
//       // Status 202 Accepted có nghĩa là "Yêu cầu đã được chấp nhận để xử lý, nhưng chưa hoàn thành"
//       res.status(202).json(result);

//     } catch (error) {
//       console.error(`[Bulk Send API] Lỗi khi bắt đầu chiến dịch:`, error);
//       res.status(500).json({ message: `Lỗi khi bắt đầu chiến dịch: ${error.message}` });
//     }
//   }
// );
export default router;

//phân quyền nnma để sau

// import express from "express";
// import multer from "multer";
// import zaloManager from "../services/zalo.manager.js";

// // BƯỚC 1: Import các middleware cần thiết
// import { authMiddleware } from "../middlewares/auth.middleware.js";
// import { checkRole } from "../middlewares/checkRole.middleware.js";

// const router = express.Router();
// const upload = multer({ storage: multer.memoryStorage() });

// // =================================================================
// // SECTION 1: CÁC API CÔNG KHAI (PUBLIC)
// // Bất kỳ ai cũng có thể truy cập mà không cần token.
// // =================================================================

// router.get("/health", (req, res) => {
//   res.status(200).json({ status: "OK", message: "Server is running" });
// });

// router.get("/accounts", (req, res) => {
//   try {
//     const accounts = zaloManager.getActiveAccounts();
//     res.status(200).json(accounts);
//   } catch (error) {
//     res.status(500).json({ message: "Lỗi khi lấy danh sách tài khoản", error: error.message });
//   }
// });

// // =================================================================
// // !! BỨC TƯỜNG BẢO VỆ !!
// // Áp dụng middleware xác thực. MỌI API ĐỊNH NGHĨA BÊN DƯỚI DÒNG NÀY
// // ĐỀU YÊU CẦU MỘT TOKEN HỢP LỆ TRONG HEADER `Authorization`.
// // =================================================================
// router.use(authMiddleware);

// // =================================================================
// // SECTION 2: API DÀNH CHO TẤT CẢ USER ĐÃ LOGIN (free, plus, pro, superadmin)
// // Các chức năng cơ bản nhất mà mọi tài khoản đều có thể sử dụng.
// // =================================================================

// // Lấy thông tin chi tiết của một người dùng khác bằng SĐT hoặc UID
// router.get("/users/:targetIdentifier", async (req, res) => {
//   const { targetIdentifier } = req.params;
//   const accountId = req.user.accountId; // Lấy từ token, an toàn
//   try {
//     const result = await zaloManager.getUserProfile(accountId, targetIdentifier);
//     res.status(200).json(result);
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi khi lấy thông tin người dùng: ${error.message}` });
//   }
// });

// // Lấy danh sách bạn bè của chính mình
// router.get("/friends/my-list", async (req, res) => {
//   const accountId = req.user.accountId; // Lấy từ token, an toàn
//   try {
//     const result = await zaloManager.getFriendList(accountId);
//     res.status(200).json(result);
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi khi lấy danh sách bạn bè: ${error.message}` });
//   }
// });

// // Lấy danh sách nhóm của chính mình
// router.get("/groups/my-list", async (req, res) => {
//   const accountId = req.user.accountId; // Lấy từ token, an toàn
//   try {
//     const result = await zaloManager.getGroupList(accountId);
//     res.status(200).json(result);
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi khi lấy danh sách nhóm: ${error.message}` });
//   }
// });

// // =================================================================
// // SECTION 3: API DÀNH CHO QUYỀN "PLUS" TRỞ LÊN (plus, pro, superadmin)
// // Các chức năng nâng cao hơn.
// // =================================================================

// // Gửi tin nhắn (có thể kèm file)
// router.post("/message/send",
//   checkRole(['plus', 'pro', 'superadmin']), // CHỈ CÁC ROLE NÀY ĐƯỢC PHÉP
//   upload.array("files", 10),
//   async (req, res) => {
//     try {
//       const { recipientIdentifier, recipientType, messageText } = req.body;
//       const accountId = req.user.accountId; // Lấy từ token, an toàn
//       const attachments = req.files ? req.files : [];

//       const user = await zaloManager.findUserByPhone(accountId, recipientIdentifier);
//       const finalRecipientId = user?.userId || recipientIdentifier;

//       const result = await zaloManager.sendMessageWithAttachments(accountId, finalRecipientId, recipientType, messageText || "", attachments);
//       res.status(200).json({ message: "Gửi tin nhắn và file thành công!", data: result });
//     } catch (error) {
//       res.status(500).json({ message: `Đã xảy ra lỗi phía máy chủ: ${error.message}`});
//     }
//   }
// );

// // Gửi lời mời kết bạn
// router.post("/friends/request", checkRole(['plus', 'pro', 'superadmin']), async (req, res) => {
//   const { targetIdentifier, message } = req.body;
//   const accountId = req.user.accountId; // Lấy từ token, an toàn
//   try {
//     const result = await zaloManager.sendFriendRequest(accountId, targetIdentifier, message);
//     res.status(200).json({ message: "Gửi lời mời kết bạn thành công!", data: result });
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi khi gửi lời mời kết bạn: ${error.message}` });
//   }
// });

// // Chấp nhận lời mời kết bạn
// router.post("/friends/accept", checkRole(['plus', 'pro', 'superadmin']), async (req, res) => {
//   const { userId } = req.body;
//   const accountId = req.user.accountId; // Lấy từ token, an toàn
//   try {
//     const result = await zaloManager.acceptFriendRequest(accountId, userId);
//     res.status(200).json({ message: "Chấp nhận lời mời kết bạn thành công!", data: result });
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi khi chấp nhận kết bạn: ${error.message}` });
//   }
// });

// // Hủy kết bạn
// router.delete("/friends", checkRole(['plus', 'pro', 'superadmin']), async (req, res) => {
//   const { userId } = req.body;
//   const accountId = req.user.accountId; // Lấy từ token, an toàn
//   try {
//     const result = await zaloManager.unfriend(accountId, userId);
//     res.status(200).json({ message: "Hủy kết bạn thành công!", data: result });
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi khi hủy kết bạn: ${error.message}` });
//   }
// });

// // =================================================================
// // SECTION 4: API DÀNH CHO QUYỀN "PRO" TRỞ LÊN (pro, superadmin)
// // Các chức năng tự động hóa, quy mô lớn.
// // =================================================================

// router.get("/friends/requests/all", checkRole(['pro', 'superadmin']), async (req, res) => {
//   const accountId = req.user.accountId; // Lấy từ token, an toàn
//   try {
//     const result = await zaloManager.getAllFriendSuggestionsAndRequests(accountId);
//     res.status(200).json(result);
//   } catch (error) {
//     res.status(500).json({ message: `Đã xảy ra lỗi khi lấy toàn bộ danh sách: ${error.message}` });
//   }
// });

// router.post("/groups", checkRole(['pro', 'superadmin']), async (req, res) => {
//   const { groupName, members } = req.body;
//   const accountId = req.user.accountId; // Lấy từ token, an toàn
//   try {
//     const result = await zaloManager.createGroup(accountId, groupName, members);
//     res.status(201).json({ message: "Tạo nhóm thành công!", data: result });
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi khi tạo nhóm: ${error.message}` });
//   }
// });

// router.get("/groups/info-by-link", checkRole(['pro', 'superadmin']), async (req, res) => {
//   const { groupLink } = req.query;
//   const accountId = req.user.accountId; // Lấy từ token, an toàn
//   if (!groupLink) {
//     return res.status(400).json({ message: "Cần cung cấp groupLink trong query params" });
//   }
//   try {
//     const result = await zaloManager.getInfoMembersGroupLink(accountId, groupLink);
//     res.status(200).json(result);
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi khi lấy thông tin nhóm: ${error.message}` });
//   }
// });

// // =================================================================
// // SECTION 5: API CHỈ DÀNH CHO "SUPERADMIN"
// // Các chức năng quản trị hệ thống.
// // =================================================================

// // Ví dụ: Lấy danh sách tất cả các tài khoản Zalo trong Database của bạn
// router.get("/admin/system/accounts", checkRole(['superadmin']), async (req, res) => {
//   try {
//     // const allAccounts = await accountService.getAllAccounts(); // Logic lấy tài khoản từ DB
//     res.status(200).json({ message: "API này chỉ dành cho Super Admin", data: [] });
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi quản trị: ${error.message}` });
//   }
// });

// // Ví dụ: Cập nhật quyền cho một tài khoản khác
// router.patch("/admin/system/accounts/:targetAccountId/role", checkRole(['superadmin']), async (req, res) => {
//   try {
//     const { targetAccountId } = req.params;
//     const { newRole } = req.body;
//     // await accountService.updateRole(targetAccountId, newRole); // Logic cập nhật DB
//     res.status(200).json({ message: `Đã cập nhật role cho ${targetAccountId} thành ${newRole}`});
//   } catch (error) {
//     res.status(500).json({ message: `Lỗi quản trị: ${error.message}` });
//   }
// });

// export default router;
