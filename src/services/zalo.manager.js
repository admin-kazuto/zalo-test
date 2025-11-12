import { Zalo, ThreadType } from "zca-js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";
import { fileTypeFromBuffer } from "file-type";
import imageSize from "image-size";
import fs from "fs";
import path from "path";
import _default from "concurrently";

const metadataGetter = (filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const meta = imageSize(buffer);
    return {
      width: meta.width,
      height: meta.height,
      type: meta.type,
      totalSize: buffer.length,
    };
  } catch (error) {
    console.warn(
      `[metadataGetter] Không thể đọc metadata ảnh cho file: ${filePath}. Có thể đây không phải là file ảnh.`
    );
    // Nếu không phải ảnh, chỉ trả về kích thước
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      return { width: 0, height: 0, totalSize: stats.size };
    }
    return { width: 0, height: 0, totalSize: 0 };
  }
};

class ZaloManager extends EventEmitter {
  constructor() {
    super();
    this.accounts = new Map();
    this.loginSessions = new Map();
    console.log("[ZaloManager] Đã được khởi tạo.");
  }

  async initiateLogin(socketId, io) {
    const tempId = uuidv4();

    // 🪄 Patch console.log toàn cục để bắt QR hết hạn
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      const msg = args.join(" ");
      // Nếu phát hiện QR expired từ zca-js
      if (msg.includes("QR expired!")) {
        originalConsoleLog(
          `[Hook] Phát hiện QR hết hạn cho client ${socketId}`
        );
        global.__qrExpired = true; // Gắn cờ toàn cục
      }
      originalConsoleLog(...args);
    };

    const zalo = new Zalo({
      imageMetadataGetter: metadataGetter,
    });

    //  Lưu lại phiên login
    this.loginSessions.set(tempId, { socketId });
    console.log(
      `[ZaloManager] Bắt đầu phiên đăng nhập ${tempId} cho client ${socketId}`
    );

    try {
      //  Gọi loginQR để lấy mã QR
      const api = await zalo.loginQR(null, (qrData) => {
        console.log("[ZaloManager] Callback QR được gọi!");

        // Kiểm tra dữ liệu trả về hợp lệ
        if (qrData && qrData.data && qrData.data.image) {
          const qrCodeDataBase64 = qrData.data.image;
          console.log(
            `[ZaloManager] Nhận QR code cho phiên ${tempId}, độ dài base64: ${qrCodeDataBase64.length}`
          );

          const session = this.loginSessions.get(tempId);
          if (session) {
            session.qrCodeImage = "data:image/png;base64," + qrCodeDataBase64;
            this.loginSessions.set(tempId, session);
          }

          // Gửi QR về cho FE hiển thị
          this.emit("qr-code", { tempId, socketId });
        } else {
          console.error(
            `[ZaloManager] Dữ liệu QR không hợp lệ cho phiên ${tempId}`
          );
          this.emit("login-failure", {
            tempId,
            socketId,
            error: "Không thể lấy dữ liệu QR code.",
          });
        }
      });

      // Check xem login có context không
      if (!api || !api.listener || !api.listener.ctx)
        throw new Error(
          "Đối tượng API hoặc context không hợp lệ sau khi đăng nhập."
        );

      const selfId = api.listener.ctx.uid;
      if (!selfId)
        throw new Error("Không thể tìm thấy User ID sau khi đăng nhập.");

      // 📦 Lấy thông tin tài khoản
      const selfInfoResponse = await api.getUserInfo(selfId);
      if (!selfInfoResponse?.changed_profiles?.[selfId])
        throw new Error(
          "Cấu trúc dữ liệu trả về từ getUserInfo không như mong đợi."
        );

      const userProfile = selfInfoResponse.changed_profiles[selfId];
      const selfName = userProfile.zaloName;
      const accountInfo = { id: selfId, name: selfName, api };

      this.accounts.set(accountInfo.id, accountInfo);
      console.log(
        `[ZaloManager] Đăng nhập thành công cho: ${accountInfo.name} (${accountInfo.id})`
      );

      this.emit("login-success", { tempId, socketId, accountInfo });
    } catch (error) {
      console.error(`[ZaloManager] Lỗi đăng nhập với tempId ${tempId}:`, error);

      // Nếu QR vừa expired thì báo FE
      if (global.__qrExpired) {
        console.log(
          `[ZaloManager] Phát hiện QR expired qua hook console, gửi event client ${socketId}`
        );
        io.to(socketId).emit("qr_expired", { tempId });
        this.cleanupSession?.(tempId);
        global.__qrExpired = false;
      }

      this.emit("login-failure", { tempId, socketId, error: error.message });
    } finally {
      // 🧹 Dọn dẹp phiên login (dù thành công hay fail)
      this.loginSessions.delete(tempId);
      console.log(`[ZaloManager] Đã dọn dẹp phiên đăng nhập ${tempId}`);

      // 🔄 Khôi phục console.log về bình thường
      console.log = originalConsoleLog;
    }
  }

  getQrCodeForSession(tempId) {
    const session = this.loginSessions.get(tempId);
    if (session && session.qrCodeImage) {
      return session.qrCodeImage;
    }
    return null;
  }
  _setupListeners(accountInfo) {
    const { id, name, api } = accountInfo;
    api.listener.on("message", (message) => {
      if (message.isSelf) return;
      const messageData = message.data;
      const senderId = messageData?.uidFrom;
      const senderName = messageData?.dName;
      const content = messageData?.content;
      if (senderId && senderName && typeof content === "string") {
        console.log("-----------------------------------------");
        console.log(
          `[ZaloManager] Tài khoản '${name}' nhận được tin nhắn mới:`
        );
        console.log(`   - TỪ: ${senderName} (ID: ${senderId})`);
        console.log(`   - NỘI DUNG: "${content}"`);
        if (message.type === ThreadType.User) {
          console.log(`   - LOẠI: Tin nhắn cá nhân`);
        } else if (message.type === ThreadType.Group) {
          console.log(
            `   - LOẠI: Tin nhắn trong nhóm (ID nhóm: ${message.threadId})`
          );
        }
        console.log("-----------------------------------------");
      }
      this.emit("new-message", { accountId: id, messageData: message });
    });
    api.listener.on("logout", () => {
      console.warn(`[ZaloManager] TÀI KHOẢN BỊ ĐĂNG XUẤT: ${name} (${id})`);
      this.accounts.delete(id);
      this.emit("account-disconnected", { accountId: id, accountName: name });
    });
    api.listener.start();
    console.log(
      `[ZaloManager] Đã kích hoạt listener cho tài khoản '${name}' (${id}).`
    );
  }

  // async sendMessageWithAttachments(
  //   accountId,
  //   recipientId,
  //   recipientType,
  //   messageText = "",
  //   files = [] // <-- Nhận vào một mảng object file, không phải mảng đường dẫn
  // ) {
  //   const account = this.accounts.get(accountId);
  //   if (!account || !account.api) {
  //     throw new Error(
  //       `Không tìm thấy tài khoản hoặc tài khoản chưa sẵn sàng: ${accountId}`
  //     );
  //   }
  //   const api = account.api;
  //   console.log(
  //     `[ZaloManager] Tài khoản '${account.name}' đang chuẩn bị gửi tin/file đến ${recipientId}...`
  //   );

  //   try {
  //     const threadType =
  //       recipientType === "GROUP" || recipientType === 1
  //         ? ThreadType.Group
  //         : ThreadType.User;

  //     // Chuẩn bị payload cơ bản
  //     const messagePayload = { msg: messageText || "" };

  //     // Xử lý các file đính kèm nếu có
  //     if (files && files.length > 0) {
  //       console.log(
  //         `[ZaloManager] Đang xử lý ${files.length} file đính kèm...`
  //       );

  //       // Sử dụng Promise.all để xử lý bất đồng bộ
  //       const attachments = await Promise.all(
  //         // <-- Lặp qua mảng `files` từ multer
  //         files.map(async (file) => {
  //           // Lấy dữ liệu nhị phân trực tiếp từ buffer của file
  //           const buffer = file.buffer;
  //           const fileType = await fileTypeFromBuffer(buffer);

  //           // Xây dựng metadata theo yêu cầu của zca-js
  //           const metadata = {
  //             totalSize: buffer.length,
  //           };

  //           if (fileType?.mime.startsWith("image/")) {
  //             try {
  //               const imageMeta = imageSize(buffer);
  //               metadata.width = imageMeta.width;
  //               metadata.height = imageMeta.height;
  //               console.log(
  //                 `[ZaloManager] Đã xử lý file ảnh: ${file.originalname}`
  //               );
  //             } catch (e) {
  //               console.warn(
  //                 `[ZaloManager] Không thể đọc kích thước ảnh cho file: ${file.originalname}`
  //               );
  //             }
  //           } else if (fileType?.mime.startsWith("video/")) {
  //             metadata.width = 1280; // Giá trị giả lập
  //             metadata.height = 720; // Giá trị giả lập
  //             console.log(
  //               `[ZaloManager] Đã xử lý file video: ${file.originalname}`
  //             );
  //           } else {
  //             metadata.width = 0;
  //             metadata.height = 0;
  //             console.log(
  //               `[ZaloManager] Đã xử lý file thông thường: ${file.originalname}`
  //             );
  //           }

  //           // Trả về object đúng với cấu trúc `AttachmentSource` của zca-js
  //           return {
  //             data: buffer,
  //             filename: file.originalname,
  //             metadata: metadata,
  //           };
  //         })
  //       );

  //       // Thêm các file đính kèm hợp lệ vào payload
  //       const validAttachments = attachments.filter((att) => att !== null);
  //       if (validAttachments.length > 0) {
  //         messagePayload.attachments = validAttachments;
  //       }
  //     }

  //     // Kiểm tra lại lần cuối xem có gì để gửi không
  //     if (
  //       !messagePayload.msg &&
  //       (!messagePayload.attachments || messagePayload.attachments.length === 0)
  //     ) {
  //       console.warn(
  //         "[ZaloManager] Không có nội dung để gửi (không có văn bản hoặc file hợp lệ)."
  //       );
  //       return { message: "Không có nội dung để gửi." };
  //     }

  //     // Gửi tin nhắn bằng zca-js
  //     const result = await api.sendMessage(
  //       messagePayload,
  //       recipientId,
  //       threadType
  //     );

  //     // Xử lý kết quả trả về
  //     if (
  //       result &&
  //       (result.message || (result.attachment && result.attachment.length > 0))
  //     ) {
  //       console.log(`[ZaloManager] Gửi tin nhắn/file thành công!`);
  //       return result;
  //     } else {
  //       console.error(
  //         "[ZaloManager] Phản hồi không hợp lệ từ Zalo:",
  //         JSON.stringify(result, null, 2)
  //       );
  //       throw new Error(
  //         "Phản hồi từ Zalo không xác định được trạng thái thành công."
  //       );
  //     }
  //   } catch (error) {
  //     console.error(
  //       `[ZaloManager] Lỗi khi gửi tin nhắn từ tài khoản ${accountId}:`,
  //       error
  //     );
  //     throw error;
  //   }
  // }

  async sendMessageWithAttachments(
    accountId,
    recipientId,
    recipientType,
    messageText = "",
    files = [] // <-- Nhận vào một mảng object file, không phải mảng đường dẫn
  ) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(
        `Không tìm thấy tài khoản hoặc tài khoản chưa sẵn sàng: ${accountId}`
      );
    }
    const api = account.api;
    console.log(
      `[ZaloManager] Tài khoản '${account.name}' đang chuẩn bị gửi tin/file đến ${recipientId}...`
    );

    try {
      const threadType =
        recipientType === "GROUP" || recipientType === 1
          ? ThreadType.Group
          : ThreadType.User;

      // Chuẩn bị payload cơ bản
      const messagePayload = { msg: messageText || "" };

      // Xử lý các file đính kèm nếu có
      if (files && files.length > 0) {
        console.log(
          `[ZaloManager] Đang xử lý ${files.length} file đính kèm...`
        );

        // Sử dụng Promise.all để xử lý bất đồng bộ
        const attachments = await Promise.all(
          // <-- Lặp qua mảng `files` từ multer
          files.map(async (file) => {
            // Lấy dữ liệu nhị phân trực tiếp từ buffer của file
            const buffer = file.buffer;
            const fileType = await fileTypeFromBuffer(buffer);

            // Xây dựng metadata theo yêu cầu của zca-js
            const metadata = {
              totalSize: buffer.length,
            };

            if (fileType?.mime.startsWith("image/")) {
              try {
                const imageMeta = imageSize(buffer);
                metadata.width = imageMeta.width;
                metadata.height = imageMeta.height;
                console.log(
                  `[ZaloManager] Đã xử lý file ảnh: ${file.originalname}`
                );
              } catch (e) {
                console.warn(
                  `[ZaloManager] Không thể đọc kích thước ảnh cho file: ${file.originalname}, sẽ dùng giá trị mặc định.`
                );
                // Cung cấp giá trị mặc định nếu đọc metadata ảnh thất bại
                metadata.width = 0;
                metadata.height = 0;
              }
            } else if (fileType?.mime.startsWith("video/")) {
              metadata.width = 1280; // Giá trị giả lập
              metadata.height = 720; // Giá trị giả lập
              console.log(
                `[ZaloManager] Đã xử lý file video: ${file.originalname}`
              );
            } else {
              // ======================= PHẦN SỬA LỖI =======================
              // Luôn cung cấp width và height cho các loại file khác (doc, txt, pdf, zip...)
              // Đây là nguyên nhân gây treo server của bạn
              metadata.width = 0;
              metadata.height = 0;
              // =============================================================
              console.log(
                `[ZaloManager] Đã xử lý file thông thường: ${file.originalname}`
              );
            }

            // Trả về object đúng với cấu trúc `AttachmentSource` của zca-js
            return {
              data: buffer,
              filename: file.originalname,
              metadata: metadata,
            };
          })
        );

        // Thêm các file đính kèm hợp lệ vào payload
        const validAttachments = attachments.filter((att) => att !== null);
        if (validAttachments.length > 0) {
          messagePayload.attachments = validAttachments;
        }
      }

      // Kiểm tra lại lần cuối xem có gì để gửi không
      if (
        !messagePayload.msg &&
        (!messagePayload.attachments || messagePayload.attachments.length === 0)
      ) {
        console.warn(
          "[ZaloManager] Không có nội dung để gửi (không có văn bản hoặc file hợp lệ)."
        );
        return { message: "Không có nội dung để gửi." };
      }

      // Gửi tin nhắn bằng zca-js
      const result = await api.sendMessage(
        messagePayload,
        recipientId,
        threadType
      );

      // Xử lý kết quả trả về
      if (
        result &&
        (result.message || (result.attachment && result.attachment.length > 0))
      ) {
        console.log(`[ZaloManager] Gửi tin nhắn/file thành công!`);
        return result;
      } else {
        console.error(
          "[ZaloManager] Phản hồi không hợp lệ từ Zalo:",
          JSON.stringify(result, null, 2)
        );
        throw new Error(
          "Phản hồi từ Zalo không xác định được trạng thái thành công."
        );
      }
    } catch (error) {
      console.error(
        `[ZaloManager] Lỗi khi gửi tin nhắn từ tài khoản ${accountId}:`,
        error
      );
      throw error;
    }
  }

  async executeSendMessage(accountId, recipientId, recipientType, content) {
    return this.sendMessageWithAttachments(
      accountId,
      recipientId,
      recipientType,
      content.messageText || "",
      []
    );
  }

  async sendFileFromPath(
    accountId,
    recipientId,
    recipientType,
    filePath,
    messageText = ""
  ) {
    return this.sendMessageWithAttachments(
      accountId,
      recipientId,
      recipientType,
      messageText,
      [filePath]
    );
  }

  async findUserByPhone(accountId, phoneNumber) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(`Không tìm thấy tài khoản: ${accountId}`);
    }
    const api = account.api;
    try {
      const result = await api.findUser(phoneNumber);
      if (result && result.uid) {
        return {
          userId: result.uid,
          name: result.zalo_name || result.display_name,
          avatar: result.avatar,
        };
      } else {
        return null;
      }
    } catch (error) {
      throw error;
    }
  }

  getActiveAccounts() {
    const accountList = [];
    for (const account of this.accounts.values()) {
      accountList.push({
        id: account.id,
        name: account.name,
        status: "Online",
      });
    }
    return accountList;
  }

  async getInfoMembersGroupLink(accountId, groupLink) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(
        `Không tìm thấy tài khoản hoặc tài khoản chưa sẵn sàng: ${accountId}`
      );
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[getInfoMembersGroupLink]  BẮT ĐẦU QUÉT GROUP`);
    console.log(`[getInfoMembersGroupLink] Link: ${groupLink}`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(`[getInfoMembersGroupLink] 📥 Đang lấy trang đầu tiên...`);

      const firstResult = await api.getGroupLinkInfo({
        link: groupLink,
        _t: Date.now(),
        _rand: Math.random(),
      });

      if (!firstResult) {
        throw new Error(`Không nhận được kết quả từ link: ${groupLink}`);
      }

      let groupId = null;
      let groupData = null;

      if (firstResult.groupId) {
        groupId = firstResult.groupId;
        groupData = firstResult;
      } else if (firstResult.gridInfoMap) {
        const firstKey = Object.keys(firstResult.gridInfoMap)[0];
        if (firstKey && firstResult.gridInfoMap[firstKey]) {
          groupData = firstResult.gridInfoMap[firstKey];
          groupId = groupData.groupId;
        }
      }

      if (!groupId || !groupData) {
        throw new Error(`Không tìm thấy groupId từ link: ${groupLink}`);
      }

      console.log(`[getInfoMembersGroupLink]  Group ID: ${groupId}`);
      console.log(
        `[getInfoMembersGroupLink]  Tên nhóm: ${groupData.name || "N/A"}`
      );
      console.log(
        `[getInfoMembersGroupLink]  Tổng thành viên: ${groupData.totalMember}`
      );
      console.log(
        `[getInfoMembersGroupLink]  Members trang đầu: ${
          groupData.currentMems?.length || 0
        }`
      );
      console.log(
        `[getInfoMembersGroupLink]  Còn trang khác: ${
          groupData.hasMoreMember === 1 ? "Có" : "Không"
        }`
      );

      let allMembers = [...(groupData.currentMems || [])];

      if (groupData.hasMoreMember === 1) {
        console.log(
          `\n[getInfoMembersGroupLink] 📖 Nhóm lớn, bắt đầu quét các trang tiếp theo...`
        );

        let currentPage = 1;
        let hasMore = true;

        while (hasMore) {
          console.log(
            `[getInfoMembersGroupLink] 📄 Đang lấy trang ${currentPage + 1}...`
          );

          try {
            const pageResult = await api.getGroupLinkInfo({
              link: groupLink,
              memberPage: currentPage,
              _t: Date.now(),
              _rand: Math.random(),
            });

            let pageData = null;

            if (pageResult && pageResult.gridInfoMap) {
              const firstKey = Object.keys(pageResult.gridInfoMap)[0];
              if (firstKey && pageResult.gridInfoMap[firstKey]) {
                pageData = pageResult.gridInfoMap[firstKey];
              }
            } else if (pageResult && pageResult.currentMems) {
              pageData = pageResult;
            }

            if (
              pageData &&
              pageData.currentMems &&
              pageData.currentMems.length > 0
            ) {
              console.log(
                `[getInfoMembersGroupLink]  Trang ${currentPage + 1}: ${
                  pageData.currentMems.length
                } thành viên`
              );
              allMembers.push(...pageData.currentMems);

              hasMore = pageData.hasMoreMember === 1;
              currentPage++;

              if (hasMore) {
                await new Promise((resolve) => setTimeout(resolve, 300));
              }
            } else {
              console.log(
                `[getInfoMembersGroupLink]  Trang ${
                  currentPage + 1
                }: Không có thêm thành viên`
              );
              hasMore = false;
            }
          } catch (pageError) {
            console.warn(
              `[getInfoMembersGroupLink]  Lỗi khi lấy trang ${
                currentPage + 1
              }:`,
              pageError.message
            );
            hasMore = false;
          }
        }
      } else {
        console.log(
          `[getInfoMembersGroupLink]  Nhóm nhỏ, đã có đầy đủ thành viên`
        );
      }

      console.log(
        `\n[getInfoMembersGroupLink] Tổng cộng: ${allMembers.length}/${groupData.totalMember} thành viên`
      );

      const membersInfo = {};
      allMembers.forEach((member) => {
        membersInfo[member.id] = {
          uid: member.id,
          dName: member.dName,
          zaloName: member.zaloName,
          avatar: member.avatar,
          avatar_25: member.avatar_25,
          accountStatus: member.accountStatus,
          type: member.type,
        };
      });

      console.log(`\n${"=".repeat(70)}`);
      console.log(`[getInfoMembersGroupLink]  HOÀN TẤT QUÉT GROUP`);
      console.log(`[getInfoMembersGroupLink] Nhóm: ${groupData.name || "N/A"}`);
      console.log(
        `[getInfoMembersGroupLink] Tổng thành viên: ${groupData.totalMember}`
      );
      console.log(
        `[getInfoMembersGroupLink] Đã lấy được: ${allMembers.length} thành viên`
      );
      console.log(`${"=".repeat(70)}\n`);

      return {
        groupId: groupId,
        groupName: groupData.name,
        totalMember: groupData.totalMember,
        avatar: groupData.avatar,
        creatorId: groupData.creatorId,
        currentMems: allMembers,
        members: membersInfo,
        membersCount: allMembers.length,
        hasMoreMember: 0,
        rawData: groupData,
      };
    } catch (error) {
      console.error(`\n[getInfoMembersGroupLink]  LỖI:`, error.message);
      console.error(`[getInfoMembersGroupLink] Stack:`, error.stack);
      throw new Error(`Lỗi khi lấy thông tin group từ link: ${error.message}`);
    }
  }

  async getInfoMembersGroupId(accountId, groupId) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(
        `Không tìm thấy tài khoản hoặc tài khoản chưa sẵn sàng: ${accountId}`
      );
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[getInfoMembersGroupId]  BẮT ĐẦU QUÉT GROUP`);
    console.log(`[getInfoMembersGroupId] Group ID: ${groupId}`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(`[getInfoMembersGroupId] 📥 Đang lấy thông tin group...`);

      const groupInfo = await api.getGroupInfo(groupId);

      if (!groupInfo) {
        throw new Error(`Không lấy được thông tin group với ID: ${groupId}`);
      }

      console.log(
        `[getInfoMembersGroupId]  Tên nhóm: ${groupInfo.name || "N/A"}`
      );
      console.log(
        `[getInfoMembersGroupId]  Tổng thành viên: ${
          groupInfo.totalMember || "N/A"
        }`
      );

      console.log(`\n[getInfoMembersGroupId] 👥 Đang lấy danh sách members...`);

      let allMembers = [];
      let membersList = null;

      if (groupInfo.members) {
        membersList = groupInfo.members;
      } else if (groupInfo.gridInfoMap) {
        const firstKey = Object.keys(groupInfo.gridInfoMap)[0];
        if (firstKey && groupInfo.gridInfoMap[firstKey]?.members) {
          membersList = groupInfo.gridInfoMap[firstKey].members;
        }
      }

      if (membersList && typeof membersList === "object") {
        allMembers = Object.keys(membersList).map((uid) => ({
          id: uid,
          uid: uid,
          ...membersList[uid],
        }));
      }

      console.log(
        `[getInfoMembersGroupId]  Đã lấy được: ${allMembers.length} thành viên`
      );

      const membersInfo = {};
      allMembers.forEach((member) => {
        membersInfo[member.uid] = {
          uid: member.uid,
          dName: member.dName || member.displayName,
          zaloName: member.zaloName || member.name,
          avatar: member.avatar,
          avatar_25: member.avatar_25,
          accountStatus: member.accountStatus,
          type: member.type,
        };
      });

      console.log(`\n${"=".repeat(70)}`);
      console.log(`[getInfoMembersGroupId]  HOÀN TẤT QUÉT GROUP`);
      console.log(`[getInfoMembersGroupId] Nhóm: ${groupInfo.name || "N/A"}`);
      console.log(
        `[getInfoMembersGroupId] Tổng thành viên: ${
          groupInfo.totalMember || allMembers.length
        }`
      );
      console.log(
        `[getInfoMembersGroupId] Đã lấy được: ${allMembers.length} thành viên`
      );
      console.log(`${"=".repeat(70)}\n`);

      return {
        groupId: groupId,
        groupName: groupInfo.name,
        totalMember: groupInfo.totalMember || allMembers.length,
        avatar: groupInfo.avatar,
        creatorId: groupInfo.creatorId,
        currentMems: allMembers,
        members: membersInfo,
        membersCount: allMembers.length,
        rawData: groupInfo,
      };
    } catch (error) {
      console.error(`\n[getInfoMembersGroupId]  LỖI:`, error.message);
      console.error(`[getInfoMembersGroupId] Stack:`, error.stack);
      throw new Error(`Lỗi khi lấy thông tin group từ ID: ${error.message}`);
    }
  }

  async sendFriendRequest(
    accountId,
    targetIdentifier,
    message = "Chào bạn, mình kết bạn nhé!"
  ) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(`Tài khoản không sẵn sàng: ${accountId}`);
    }
    const api = account.api;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[ZaloManager] 🤝 GỬI LỜI MỜI KẾT BẠN`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`[ZaloManager] Target: ${targetIdentifier}`);
    console.log(`[ZaloManager] Lời nhắn: "${message}"`);
    console.log(`${"=".repeat(70)}\n`);

    try {
      let targetUid = null;
      let targetName = "người dùng";

      const sanitizedIdentifier = targetIdentifier.replace(/\s+/g, "");
      const isPhoneNumber = /^(0|\+84|84)\d{9}$/.test(sanitizedIdentifier);

      if (isPhoneNumber) {
        console.log(`[ZaloManager] Nhận diện là SĐT, đang tìm UID...`);
        try {
          const user = await this.findUserByPhone(
            accountId,
            sanitizedIdentifier
          );
          if (user && user.userId) {
            targetUid = user.userId;
            targetName = user.name;
            console.log(
              `[ZaloManager] Tìm thấy: ${targetName} (UID: ${targetUid})`
            );
          } else {
            throw new Error(
              `Không tìm thấy người dùng với SĐT ${sanitizedIdentifier}.`
            );
          }
        } catch (findError) {
          console.error(`[ZaloManager] Lỗi khi tìm SĐT:`, findError.message);
          throw findError;
        }
      } else {
        targetUid = sanitizedIdentifier;
        targetName = `UID ${targetUid.substring(0, 8)}...`;
        console.log(`[ZaloManager] Nhận diện là UID: ${targetUid}`);
      }

      if (!targetUid) {
        throw new Error("Không thể xác định được UID của người nhận.");
      }

      console.log(
        `\n[ZaloManager] Đang gọi api.sendFriendRequest("${message}", "${targetUid}")...`
      );

      const result = await api.sendFriendRequest(message, targetUid);

      console.log(`\n[ZaloManager] GỬI LỜI MỜI KẾT BẠN THÀNH CÔNG!`);
      console.log(
        `[ZaloManager] Đã gửi đến: ${targetName} (UID: ${targetUid})`
      );
      console.log(`[ZaloManager] [DEBUG] Response: ${JSON.stringify(result)}`);
      console.log(`${"=".repeat(70)}\n`);

      return {
        success: true,
        method: "sendFriendRequest",
        targetUid,
        targetName,
        message,
        result,
      };
    } catch (error) {
      console.error(`\n[ZaloManager] LỖI KHI GỬI LỜI MỜI KẾT BẠN!`);
      console.error(`[ZaloManager] Target: ${targetIdentifier}`);
      console.error(`[ZaloManager] Error: ${error.message}`);
      console.error(`${"=".repeat(70)}\n`);
      throw new Error(`Gửi lời mời kết bạn thất bại: ${error.message}`);
    }
  }

  async testJoinGroupLink(accountId, groupLink) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(`Không tìm thấy tài khoản: ${accountId}`);
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[ZaloManager] TEST joinGroupLink`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`[ZaloManager] Link: ${groupLink}`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(`[ZaloManager]  Đang gọi api.joinGroupLink(${groupLink})...`);

      const result = await api.joinGroupLink(groupLink);

      console.log(`\n[ZaloManager]  JOIN NHÓM THÀNH CÔNG!`);
      console.log(`[ZaloManager] Bot đã tham gia nhóm ngay lập tức!`);
      console.log(`[ZaloManager] Response:`);
      console.log(JSON.stringify(result, null, 2));
      console.log(`${"=".repeat(70)}\n`);

      return {
        success: true,
        status: "joined",
        groupLink: groupLink,
        response: result,
        message: "Bot đã JOIN nhóm thành công!",
      };
    } catch (error) {
      console.error(`[ZaloManager]  API Response: ${error.message}`);

      if (
        error.message.includes("Waiting for approve") ||
        error.message.includes("waiting for approve") ||
        error.message.includes("240")
      ) {
        console.log(`\n[ZaloManager] YÊU CẦU THAM GIA ĐÃ ĐƯỢỢC GỬI!`);
        console.log(`[ZaloManager] Nhóm yêu cầu KIỂM DUYỆT thành viên.`);
        console.log(`[ZaloManager] Đang chờ admin phê duyệt...`);
        console.log(
          `[ZaloManager] 💡 Bot sẽ tự động tham gia khi admin chấp nhận.`
        );
        console.log(`${"=".repeat(70)}\n`);

        return {
          success: true,
          status: "pending",
          groupLink: groupLink,
          response: null,
          message: "Yêu cầu tham gia đã được gửi! Đang chờ admin phê duyệt.",
          note: "Nhóm có kiểm duyệt thành viên. Bot sẽ tự động join khi admin chấp nhận.",
        };
      }

      if (
        error.message.includes("178") ||
        error.message.includes("already a member") ||
        error.message.includes("đã là thành viên")
      ) {
        console.log(`\n[ZaloManager]  BOT ĐÃ LÀ THÀNH VIÊN!`);
        console.log(`[ZaloManager] Bot đã ở trong nhóm này rồi.`);
        console.log(`${"=".repeat(70)}\n`);

        return {
          success: true,
          status: "already_member",
          groupLink: groupLink,
          response: null,
          message: "Bot đã là thành viên nhóm này rồi!",
        };
      }

      console.error(`\n[ZaloManager]  LỖI THẬT SỰ!`);
      console.error(`[ZaloManager] Error: ${error.message}`);
      console.error(`[ZaloManager] Stack:`, error.stack);
      console.error(`${"=".repeat(70)}\n`);

      throw new Error(`Join nhóm thất bại: ${error.message}`);
    }
  }

  async joinGroup(accountId, groupLink) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(`Không tìm thấy tài khoản: ${accountId}`);
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[ZaloManager] BẮT ĐẦU THAM GIA NHÓM`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`[ZaloManager] Link: ${groupLink}`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(`[ZaloManager]  Đang gọi api.joinGroupLink()...`);
      const result = await api.joinGroupLink(groupLink);

      console.log(`\n[ZaloManager]  THAM GIA NHÓM THÀNH CÔNG!`);
      console.log(`[ZaloManager] Response:`);
      console.log(JSON.stringify(result, null, 2));
      console.log(`${"=".repeat(70)}\n`);
      // camonquykhach; // <-- LỖI CÚ PHÁP ĐÃ ĐƯỢC XÓA Ở ĐÂY

      return {
        success: true,
        status: "joined",
        message: "Bot đã tham gia nhóm thành công!",
        data: result,
      };
    } catch (error) {
      if (
        error.message.includes("Waiting for approve") ||
        error.message.includes("240")
      ) {
        console.log(`\n[ZaloManager] YÊU CẦU THAM GIA ĐÃ GỬI!`);
        console.log(`[ZaloManager] Đang chờ admin phê duyệt...`);
        console.log(`${"=".repeat(70)}\n`);

        return {
          success: true,
          status: "pending",
          message: "Yêu cầu tham gia đã được gửi! Đang chờ admin duyệt.",
          data: null,
        };
      }

      if (error.message.includes("178")) {
        console.log(`\n[ZaloManager]  ĐÃ LÀ THÀNH VIÊN!`);
        console.log(`${"=".repeat(70)}\n`);

        return {
          success: true,
          status: "already_member",
          message: "Bot đã là thành viên nhóm này rồi!",
          data: null,
        };
      }

      console.error(`\n[ZaloManager]  LỖI!`);
      console.error(`[ZaloManager] Error: ${error.message}`);
      console.error(`${"=".repeat(70)}\n`);

      throw new Error(`Tham gia nhóm thất bại: ${error.message}`);
    }
  }

  async getFriendList(accountId) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(`Không tìm thấy tài khoản: ${accountId}`);
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[ZaloManager] LẤY DANH SÁCH BẠN BÈ`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(`[ZaloManager]  Đang gọi api.getFriendList()...`);

      const friendList = await api.getAllFriends();

      console.log(`\n[ZaloManager]  LẤY DANH SÁCH THÀNH CÔNG!`);

      let friends = [];

      if (friendList && typeof friendList === "object") {
        if (!Array.isArray(friendList) && friendList.data) {
          friends = Object.values(friendList.data);
        } else if (friendList.data && Array.isArray(friendList.data)) {
          friends = friendList.data;
        } else if (!Array.isArray(friendList)) {
          friends = Object.values(friendList);
        } else {
          friends = friendList;
        }
      }

      console.log(`[ZaloManager] Tổng số bạn bè: ${friends.length}`);

      const formattedFriends = friends.map((friend) => ({
        userId: friend.userId || friend.uid || friend.id,
        displayName: friend.displayName || friend.dName || friend.name,
        zaloName: friend.zaloName || friend.name,
        avatar: friend.avatar,
        phoneNumber: friend.phoneNumber || friend.phone,
        gender: friend.gender,
        status: friend.status || friend.accountStatus,
      }));

      console.log(`[ZaloManager]  Đã format ${formattedFriends.length} bạn bè`);
      console.log(`${"=".repeat(70)}\n`);

      return {
        success: true,
        totalFriends: formattedFriends.length,
        friends: formattedFriends,
        message: `Đã lấy ${formattedFriends.length} bạn bè`,
      };
    } catch (error) {
      console.error(`\n[ZaloManager]  LỖI KHI LẤY DANH SÁCH BẠN BÈ!`);
      console.error(`[ZaloManager] Error: ${error.message}`);
      console.error(`[ZaloManager] Stack:`, error.stack);
      console.error(`${"=".repeat(70)}\n`);

      throw new Error(`Lấy danh sách bạn bè thất bại: ${error.message}`);
    }
  }

  async getGroupList(accountId) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(`Không tìm thấy tài khoản: ${accountId}`);
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[ZaloManager] LẤY DANH SÁCH NHÓM`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(
        `[ZaloManager]  Bước 1: Đang gọi api.getAllGroups() để lấy ID các nhóm...`
      );
      const groupsIdResponse = await api.getAllGroups();

      if (!groupsIdResponse || !groupsIdResponse.gridVerMap) {
        throw new Error(
          "Cấu trúc dữ liệu trả về từ getAllGroups không hợp lệ."
        );
      }

      const groupIds = Object.keys(groupsIdResponse.gridVerMap);
      console.log(`[ZaloManager]  Đã tìm thấy ${groupIds.length} ID nhóm.`);

      if (groupIds.length === 0) {
        console.log(`[ZaloManager]  Tài khoản này không tham gia nhóm nào.`);
        console.log(`${"=".repeat(70)}\n`);
        return {
          success: true,
          totalGroups: 0,
          groups: [],
          message: "Tài khoản không tham gia nhóm nào.",
        };
      }

      console.log(
        `\n[ZaloManager]  Bước 2: Đang lấy thông tin chi tiết cho ${groupIds.length} nhóm...`
      );

      const groupDetailsPromises = groupIds.map((id) => api.getGroupInfo(id));
      const groupDetailsList = await Promise.all(groupDetailsPromises);

      console.log(`[ZaloManager]  Đã lấy thành công thông tin chi tiết.`);

      const formattedGroups = groupDetailsList.map((group) => {
        const groupInfo = group.gridInfoMap
          ? Object.values(group.gridInfoMap)[0]
          : group;
        return {
          groupId: groupInfo.groupId || groupInfo.id,
          groupName: groupInfo.name || groupInfo.gridName || "Không có tên",
          avatar: groupInfo.avatar,
          totalMembers: groupInfo.totalMember || 0,
          creatorId: groupInfo.creatorId,
        };
      });

      console.log(
        `\n[ZaloManager]  HOÀN TẤT: Đã format ${formattedGroups.length} nhóm.`
      );
      console.log(`${"=".repeat(70)}\n`);

      return {
        success: true,
        totalGroups: formattedGroups.length,
        groups: formattedGroups,
        message: `Đã lấy thành công ${formattedGroups.length} nhóm`,
      };
    } catch (error) {
      console.error(`\n[ZaloManager]  LỖI KHI LẤY DANH SÁCH NHÓM!`);
      console.error(`[ZaloManager] Error: ${error.message}`);
      console.error(`[ZaloManager] Stack:`, error.stack);
      console.error(`${"=".repeat(70)}\n`);

      throw new Error(`Lấy danh sách nhóm thất bại: ${error.message}`);
    }
  }
  async unfriend(accountId, userId) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(`Không tìm thấy tài khoản: ${accountId}`);
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[ZaloManager]  HỦY KẾT BẠN`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`[ZaloManager] User ID: ${userId}`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(`[ZaloManager]  Đang gọi api.removeFriend(${userId}, 0)...`);
      const result = await api.removeFriend(userId, 0);

      console.log(`\n[ZaloManager]  HỦY KẾT BẠN THÀNH CÔNG!`);
      console.log(`[ZaloManager] Response:`);
      console.log(JSON.stringify(result, null, 2));
      console.log(`${"=".repeat(70)}\n`);

      return {
        success: true,
        userId: userId,
        response: result,
        message: "Đã hủy kết bạn thành công!",
      };
    } catch (error) {
      console.error(`\n[ZaloManager]  LỖI KHI HỦY KẾT BẠN!`);
      console.error(`[ZaloManager] User ID: ${userId}`);
      console.error(`[ZaloManager] Error: ${error.message}`);
      console.error(`[ZaloManager] Stack:`, error.stack);
      console.error(`${"=".repeat(70)}\n`);

      throw new Error(`Hủy kết bạn thất bại: ${error.message}`);
    }
  }

  async createGroup(
    accountId,
    groupName,
    memberIdentifiers = [],
    socket = null
  ) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(`Tài khoản không sẵn sàng: ${accountId}`);
    }
    const api = account.api;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[ZaloManager]  BẮT ĐẦU TẠO NHÓM MỚI`);
    console.log(`[ZaloManager] Tên nhóm: ${groupName}`);
    console.log(
      `[ZaloManager] Thành viên đầu vào: ${memberIdentifiers.length}`
    );
    console.log(`${"=".repeat(70)}\n`);

    if (socket)
      socket.emit("scenario_update", {
        message: `Đang chuẩn hóa ${memberIdentifiers.length} thành viên (SĐT -> UID)...`,
      });

    const finalMemberIds = [];
    const failedIdentifiers = [];
    await Promise.all(
      memberIdentifiers.map(async (identifier) => {
        const sanitized = identifier.replace(/\s+/g, "");
        if (/^(0|\+84|84)\d{9}$/.test(sanitized)) {
          try {
            const user = await this.findUserByPhone(accountId, sanitized);
            if (user && user.userId) {
              finalMemberIds.push(user.userId);
            } else {
              failedIdentifiers.push({
                id: sanitized,
                reason: "Không tìm thấy",
              });
            }
          } catch (e) {
            failedIdentifiers.push({ id: sanitized, reason: e.message });
          }
        } else {
          finalMemberIds.push(sanitized);
        }
      })
    );

    console.log(
      `[ZaloManager] Đã xử lý xong: ${finalMemberIds.length} UID hợp lệ.`
    );
    if (failedIdentifiers.length > 0)
      console.warn(
        `[ZaloManager] Thất bại: ${failedIdentifiers.length} thành viên.`
      );
    if (finalMemberIds.length === 0)
      throw new Error("Không có thành viên hợp lệ nào để tạo nhóm.");

    const SAFE_CREATE_LIMIT = 50;

    if (finalMemberIds.length <= SAFE_CREATE_LIMIT) {
      console.log(
        `[ZaloManager] Số lượng (${finalMemberIds.length}) <= ${SAFE_CREATE_LIMIT}, tạo nhóm trực tiếp...`
      );
      if (socket)
        socket.emit("scenario_update", {
          message: `Đang tạo nhóm với ${finalMemberIds.length} thành viên...`,
        });

      try {
        const result = await api.createGroup({
          name: groupName,
          members: finalMemberIds,
        });
        console.log(
          `\n[ZaloManager] TẠO NHÓM THÀNH CÔNG! ID: ${result.groupId}`
        );
        return {
          success: true,
          message: "Tạo nhóm thành công!",
          data: result,
          failedIdentifiers,
        };
      } catch (error) {
        console.error(`\n[ZaloManager] LỖI KHI TẠO NHÓM TRỰC TIẾP!`, error);
        throw new Error(`Tạo nhóm thất bại: ${error.message}`);
      }
    } else {
      console.log(
        `[ZaloManager] Số lượng (${finalMemberIds.length}) > ${SAFE_CREATE_LIMIT}, chuyển sang chế độ chia nhỏ.`
      );

      const initialMembers = finalMemberIds.slice(0, 2);
      const remainingMembers = finalMemberIds.slice(2);

      console.log(
        `[ZaloManager] ↳ Bước 2.1: Tạo nhóm "${groupName}" với 2 thành viên đầu...`
      );
      if (socket)
        socket.emit("scenario_update", {
          message: `Đang tạo nhóm "${groupName}" với 2 thành viên đầu...`,
        });

      let groupId;
      try {
        const createResponse = await api.createGroup({
          name: groupName,
          members: initialMembers,
        });
        groupId = createResponse.groupId;
        if (!groupId) throw new Error("Không nhận được Group ID sau khi tạo.");
        console.log(`[ZaloManager] ] Tạo nhóm thành công! ID: ${groupId}`);
      } catch (error) {
        console.error(`\n[ZaloManager] LỖI KHI TẠO NHÓM BAN ĐẦU!`, error);
        throw new Error(`Lỗi tạo nhóm ban đầu: ${error.message}`);
      }

      console.log(
        `[ZaloManager] ↳ Bước 2.2: Chuẩn bị thêm ${remainingMembers.length} thành viên còn lại...`
      );
      const BATCH_SIZE = 20;
      const totalBatches = Math.ceil(remainingMembers.length / BATCH_SIZE);

      for (let i = 0; i < remainingMembers.length; i += BATCH_SIZE) {
        const batch = remainingMembers.slice(i, i + BATCH_SIZE);
        const currentBatchNum = i / BATCH_SIZE + 1;

        console.log(
          `[ZaloManager]   - Đang thêm đợt ${currentBatchNum}/${totalBatches}: ${batch.length} thành viên...`
        );
        if (socket)
          socket.emit("scenario_update", {
            message: `Đang thêm thành viên (Đợt ${currentBatchNum}/${totalBatches})...`,
          });

        try {
          await api.addUserToGroup(batch, groupId);
          console.log(`[ZaloManager]   ] Thêm thành công.`);
        } catch (error) {
          console.error(
            `[ZaloManager]     Lỗi khi thêm đợt ${currentBatchNum}:`,
            error.message
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      console.log(
        `\n[ZaloManager] ✨ HOÀN TẤT! Đã thêm tất cả thành viên vào nhóm.`
      );
      if (socket)
        socket.emit("scenario_update", {
          message: `✨ Hoàn tất! Đã thêm thành viên vào nhóm.`,
        });

      return {
        success: true,
        message: "Tạo nhóm và thêm thành viên theo đợt thành công!",
        data: { groupId },
        failedIdentifiers,
      };
    }
  }

  async acceptFriendRequest(accountId, userId) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(
        `Không tìm thấy tài khoản hoặc tài khoản chưa sẵn sàng: ${accountId}`
      );
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[ZaloManager] CHẤP NHẬN LỜI MỜI KẾT BẠN`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`[ZaloManager] Từ User ID: ${userId}`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(
        `[ZaloManager]  Đang gọi api.acceptFriendRequest(${userId})...`
      );
      const result = await api.acceptFriendRequest(userId);

      console.log(`\n[ZaloManager]  CHẤP NHẬN THÀNH CÔNG!`);
      console.log(`[ZaloManager] Response:`, result);
      console.log(`${"=".repeat(70)}\n`);

      return {
        success: true,
        userId: userId,
        response: result,
        message: `Đã chấp nhận lời mời kết bạn từ ${userId}!`,
      };
    } catch (error) {
      console.error(`\n[ZaloManager]  LỖI KHI CHẤP NHẬN LỜI MỜI KẾT BẠN!`);
      console.error(`[ZaloManager] User ID: ${userId}`);
      console.error(`[ZaloManager] Error: ${error.message}`);
      console.error(`${"=".repeat(70)}\n`);

      throw new Error(`Chấp nhận lời mời kết bạn thất bại: ${error.message}`);
    }
  }

  async getAllFriendSuggestionsAndRequests(accountId) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(
        `Không tìm thấy tài khoản đang hoạt động với ID: ${accountId}`
      );
    }

    const allSuggestions = [];
    const allIncomingRequests = [];
    let start = 0;
    const countPerPage = 50;
    let hasMoreData = true;
    let page = 1;

    const MAX_PAGES = 20;
    let lastUserIdFromPreviousPage = null;

    console.log(
      `[ZaloManager] Bắt đầu quá trình lấy TẤT CẢ gợi ý/lời mời cho tài khoản ${accountId}...`
    );

    while (hasMoreData && page <= MAX_PAGES) {
      console.log(
        `[ZaloManager] -> Đang lấy trang ${page} (vị trí bắt đầu: ${start})...`
      );

      try {
        const response = await account.api.getFriendRecommendations(
          start,
          countPerPage
        );

        if (
          !response ||
          !response.recommItems ||
          response.recommItems.length === 0
        ) {
          console.log(
            `[ZaloManager] -> Trang ${page} không có dữ liệu. Kết thúc.`
          );
          hasMoreData = false;
          continue;
        }

        const firstUserIdOfCurrentPage =
          response.recommItems[0].dataInfo?.userId;
        if (
          firstUserIdOfCurrentPage &&
          firstUserIdOfCurrentPage === lastUserIdFromPreviousPage
        ) {
          console.log(
            `[ZaloManager] -> Dữ liệu trang ${page} bị lặp lại. Kết thúc.`
          );
          hasMoreData = false;
          continue;
        }

        // Cập nhật ID người dùng cuối cùng của trang này để so sánh ở lần lặp sau
        const lastItemIndex = response.recommItems.length - 1;
        lastUserIdFromPreviousPage =
          response.recommItems[lastItemIndex].dataInfo?.userId;

        // --- PHÂN LOẠI DỮ LIỆU ---
        for (const item of response.recommItems) {
          const data = item.dataInfo;
          if (!data) continue;

          // Thêm kiểm tra để tránh thêm trùng lặp người dùng
          const isAlreadyAdded =
            allSuggestions.some((u) => u.userId === data.userId) ||
            allIncomingRequests.some((u) => u.userId === data.userId);
          if (isAlreadyAdded) {
            continue; // Bỏ qua nếu người này đã có trong danh sách
          }

          const formattedUser = {
            userId: data.userId,
            displayName: data.displayName,
            zaloName: data.zaloName,
            avatar: data.avatar,
            message: data.recommInfo?.message || "",
          };

          if (data.recommType === 1) {
            allSuggestions.push(formattedUser);
          } else if (data.recommType === 2) {
            allIncomingRequests.push(formattedUser);
          }
        }

        // Cập nhật cho lần lặp tiếp theo
        start += countPerPage;
        page++;
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (loopError) {
        console.error(
          `[ZaloManager] Lỗi khi đang lấy trang ${page}. Dừng quá trình.`,
          loopError
        );
        hasMoreData = false;
      }
    }

    if (page > MAX_PAGES) {
      console.warn(
        `[ZaloManager] Đã đạt giới hạn ${MAX_PAGES} trang. Tự động dừng để đảm bảo an toàn.`
      );
    }

    console.log(
      `[ZaloManager] Hoàn tất! Tổng cộng đã lấy được: ${allSuggestions.length} gợi ý và ${allIncomingRequests.length} lời mời.`
    );

    return {
      success: true,
      suggestions: allSuggestions,
      incomingRequests: allIncomingRequests,
    };
  }

  async getUserProfile(accountId, targetIdentifier) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(
        `Không tìm thấy tài khoản hoặc tài khoản chưa sẵn sàng: ${accountId}`
      );
    }
    const api = account.api;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[ZaloManager] LẤY THÔNG TIN NGƯỜI DÙNG`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`[ZaloManager] Target Identifier: ${targetIdentifier}`);
    console.log(`${"=".repeat(70)}\n`);

    try {
      let userProfile = null;
      const sanitizedIdentifier = targetIdentifier.replace(/\s+/g, "");
      // Sử dụng regex để kiểm tra xem có phải là SĐT hay không
      const isPhoneNumber = /^(0|\+84|84)\d{9}$/.test(sanitizedIdentifier);

      if (isPhoneNumber) {
        console.log(
          `[ZaloManager]  Nhận diện là SĐT. Đang dùng api.findUser...`
        );
        // Nếu là SĐT, dùng api.findUser
        const response = await api.findUser(sanitizedIdentifier);
        if (response && response.uid) {
          userProfile = response;
        }
      } else {
        console.log(
          `[ZaloManager]  Nhận diện là UID. Đang dùng api.getUserInfo...`
        );
        // Nếu không phải SĐT, mặc định là UID và dùng api.getUserInfo
        const response = await api.getUserInfo(sanitizedIdentifier);
        if (
          response &&
          response.changed_profiles &&
          response.changed_profiles[sanitizedIdentifier]
        ) {
          userProfile = response.changed_profiles[sanitizedIdentifier];
        }
      }

      // Sau khi có dữ liệu thô từ 1 trong 2 API, kiểm tra và format lại
      if (!userProfile) {
        throw new Error(
          `Không tìm thấy thông tin cho người dùng với định danh: ${targetIdentifier}`
        );
      }

      // Chuẩn hóa dữ liệu trả về để có chung một cấu trúc
      const formattedProfile = {
        userId: userProfile.uid,
        zaloName: userProfile.zaloName || userProfile.zalo_name,
        displayName:
          userProfile.dName ||
          userProfile.displayName ||
          userProfile.display_name,
        avatar: userProfile.avatar,
        cover: userProfile.cover,
        gender: userProfile.gender,
        dob: userProfile.dob,
        // Lưu ý: Cả 2 API đều không trả về số điện thoại vì lý do bảo mật
      };

      console.log(
        `[ZaloManager]  Lấy thông tin thành công cho: ${formattedProfile.zaloName}`
      );
      console.log(`${"=".repeat(70)}\n`);

      return {
        success: true,
        profile: formattedProfile,
        message: "Lấy thông tin người dùng thành công.",
      };
    } catch (error) {
      console.error(`\n[ZaloManager]  LỖI KHI LẤY THÔNG TIN NGƯỜI DÙNG!`);
      console.error(`[ZaloManager] Target Identifier: ${targetIdentifier}`);
      console.error(`[ZaloManager] Error: ${error.message}`);
      console.error(`${"=".repeat(70)}\n`);
      throw new Error(`Lấy thông tin người dùng thất bại: ${error.message}`);
    }
  }

  async bulkSendMessageToUids(accountId, uids, messageText) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(`Tài khoản không sẵn sàng: ${accountId}`);
    }
    const api = account.api;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`[Bulk Send] BẮT ĐẦU CHIẾN DỊCH GỬI TIN NHẮN`);
    console.log(`[Bulk Send] Account: ${account.name} (${accountId})`);
    console.log(`[Bulk Send] Tổng số người nhận: ${uids.length}`);
    console.log(`${"=".repeat(70)}\n`);

    // Hàm này sẽ tự chạy trong nền, không cần "await" ở nơi gọi
    // Điều này giúp API có thể trả về phản hồi ngay lập tức
    const run = async () => {
      for (let i = 0; i < uids.length; i++) {
        const targetUid = uids[i];
        console.log(
          `[Bulk Send] Đang gửi tới UID ${i + 1}/${uids.length}: ${targetUid}`
        );

        try {
          // Sử dụng lại hàm gửi tin nhắn đã có
          await this.sendMessageWithAttachments(
            accountId,
            targetUid,
            "User", // Luôn là tin nhắn cá nhân
            messageText,
            [] // Không có file đính kèm trong trường hợp này
          );
          console.log(`  -> Thành công!`);
        } catch (error) {
          console.error(`  -> Thất bại: ${error.message}`);
        }

        // !! QUAN TRỌNG: Thêm độ trễ giữa các lần gửi để tránh bị Zalo khóa !!
        // Gửi 1 tin nhắn mỗi 1.5 giây
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      console.log(
        `\n[Bulk Send] HOÀN TẤT CHIẾN DỊCH! Đã gửi tới ${uids.length} người.\n`
      );
    };

    run(); // Gọi hàm chạy nền

    // Trả về một Promise giải quyết ngay lập tức
    return Promise.resolve({
      message: `Đã bắt đầu chiến dịch gửi tin nhắn tới ${uids.length} người dùng.`,
      totalRecipients: uids.length,
    });
  }
}

const zaloManager = new ZaloManager();
export default zaloManager;
