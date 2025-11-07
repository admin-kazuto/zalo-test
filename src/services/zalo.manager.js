import { Zalo, ThreadType } from "zca-js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";
import { fileTypeFromBuffer } from "file-type"; // <-- Sẽ sử dụng thư viện này
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

  async initiateLogin(socketId) {
    const tempId = uuidv4();

    const zalo = new Zalo({
      imageMetadataGetter: metadataGetter,
    });
    // const zalo = new Zalo();
    this.loginSessions.set(tempId, { socketId: socketId });
    console.log(
      `[ZaloManager] Bắt đầu phiên đăng nhập ${tempId} cho client ${socketId}`
    );
    try {
      // const api = await zalo.loginQR({
      //   qr: (qrCodeData) => {
      //     this.emit("qr-code", { tempId, socketId, qrCodeImage: qrCodeData });
      //   },
      // });

      const api = await zalo.loginQR(null, (qrData) => {
        console.log("[ZaloManager] Callback QR được gọi!"); // Log để xác nhận

        // Kiểm tra cấu trúc dữ liệu trả về theo đúng API mẫu
        if (qrData && qrData.data && qrData.data.image) {
          // qrData.data.image là chuỗi base64 của ảnh QR
          const qrCodeDataBase64 = qrData.data.image;
          console.log(
            `[ZaloManager] Đã nhận được dữ liệu QR code, độ dài base64: ${qrCodeDataBase64.length}`
          );

          const session = this.loginSessions.get(tempId);
          if (session) {
            // Thêm 'data:image/png;base64,' để FE có thể hiển thị trực tiếp
            session.qrCodeImage = "data:image/png;base64," + qrCodeDataBase64;
            this.loginSessions.set(tempId, session);
          }

          // Bắn sự kiện 'qr-code' về cho client
          this.emit("qr-code", { tempId, socketId });
        } else {
          console.error(
            "[ZaloManager] Lỗi: Dữ liệu QR trả về không có cấu trúc qrData.data.image"
          );
          // Có thể emit một sự kiện lỗi về client nếu muốn
          this.emit("login-failure", {
            tempId,
            socketId,
            error: "Không thể lấy dữ liệu QR code.",
          });
        }
      });

      if (!api || !api.listener || !api.listener.ctx)
        throw new Error(
          "Đối tượng API hoặc context không hợp lệ sau khi đăng nhập."
        );

      const selfId = api.listener.ctx.uid;
      if (!selfId)
        throw new Error("Không thể tìm thấy User ID sau khi đăng nhập.");

      const selfInfoResponse = await api.getUserInfo(selfId);
      if (!selfInfoResponse?.changed_profiles?.[selfId])
        throw new Error(
          "Cấu trúc dữ liệu trả về từ getUserInfo không như mong đợi."
        );

      const userProfile = selfInfoResponse.changed_profiles[selfId];
      const selfName = userProfile.zaloName;
      const accountInfo = { id: selfId, name: selfName, api: api };
      this.accounts.set(accountInfo.id, accountInfo);
      console.log(
        `[ZaloManager] Đăng nhập thành công cho: ${accountInfo.name} (${accountInfo.id})`
      );
      this.emit("login-success", { tempId, socketId, accountInfo });
      this._setupListeners(accountInfo);
    } catch (error) {
      console.error(`[ZaloManager] Lỗi đăng nhập với tempId ${tempId}:`, error);
      this.emit("login-failure", { tempId, socketId, error: error.message });
    } finally {
      this.loginSessions.delete(tempId);
      console.log(`[ZaloManager] Đã dọn dẹp phiên đăng nhập ${tempId}`);
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

  async sendMessageWithAttachments(
    accountId,
    recipientId,
    recipientType,
    messageText = "",
    filePaths = []
  ) {
    const account = this.accounts.get(accountId);
    if (!account || !account.api) {
      throw new Error(
        `Không tìm thấy tài khoản hoặc tài khoản chưa sẵn sàng: ${accountId}`
      );
    }
    const api = account.api;
    console.log(
      `[ZaloManager] Tài khoản '${account.name}' đang gửi tin nhắn/file đến ${recipientId}...`
    );

    try {
      const threadType =
        recipientType === "GROUP" || recipientType === 1
          ? ThreadType.Group
          : ThreadType.User;

      const messagePayload = { msg: messageText || "" };

      if (filePaths && filePaths.length > 0) {
        // <-- THAY ĐỔI: Sử dụng Promise.all để xử lý bất đồng bộ
        const attachments = await Promise.all(
          filePaths.map(async (filePath) => {
            if (!fs.existsSync(filePath)) {
              console.error(
                `[ZaloManager] Lỗi: File không tồn tại tại đường dẫn: ${filePath}`
              );
              return null;
            }
            const buffer = fs.readFileSync(filePath);
            const fileType = await fileTypeFromBuffer(buffer); // <-- Xác định loại file

            const metadata = {
              totalSize: buffer.length, // <-- Metadata cơ bản cho mọi loại file
            };

            if (fileType?.mime.startsWith("image/")) {
              // <-- XỬ LÝ ẢNH
              try {
                const imageMeta = imageSize(buffer);
                metadata.width = imageMeta.width;
                metadata.height = imageMeta.height;
                console.log(
                  `[ZaloManager] Đã xử lý file ảnh: ${path.basename(filePath)}`
                );
              } catch (e) {
                console.warn(
                  `[ZaloManager] Không thể đọc kích thước ảnh cho file: ${path.basename(
                    filePath
                  )}`
                );
              }
            } else if (fileType?.mime.startsWith("video/")) {
              // <-- XỬ LÝ VIDEO (cung cấp giá trị mặc định)
              metadata.width = 1280; // Giá trị giả lập
              metadata.height = 720; // Giá trị giả lập
              console.log(
                `[ZaloManager] Đã xử lý file video: ${path.basename(filePath)}`
              );
            } else {
              // <-- XỬ LÝ CÁC LOẠI FILE KHÁC (PDF, DOCX, ZIP...)
              console.log(
                `[ZaloManager] Đã xử lý file thông thường: ${path.basename(
                  filePath
                )}`
              );
              // Không cần metadata đặc biệt
            }

            return {
              data: buffer,
              filename: path.basename(filePath),
              metadata: metadata,
            };
          })
        );

        const validAttachments = attachments.filter((att) => att !== null);
        if (validAttachments.length > 0) {
          messagePayload.attachments = validAttachments;
        }
      }

      if (
        !messagePayload.msg &&
        (!messagePayload.attachments || messagePayload.attachments.length === 0)
      ) {
        console.warn(
          "[ZaloManager] Không có nội dung văn bản hoặc file hợp lệ để gửi."
        );
        return { message: "Không có nội dung để gửi." };
      }

      const result = await api.sendMessage(
        messagePayload,
        recipientId,
        threadType
      );

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
        `[ZaloManager] Lỗi khi thực thi lệnh gửi tin nhắn/file từ tài khoản ${accountId}:`,
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
      // Bước 1: Lấy trang đầu tiên
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

      // Xử lý 2 dạng cấu trúc khác nhau
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

      // Bước 2: Nếu có thêm thành viên, lấy tiếp các trang
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

              // Kiểm tra còn trang tiếp theo không
              hasMore = pageData.hasMoreMember === 1;
              currentPage++;

              // Delay nhẹ tránh rate limit
              if (hasMore) {
                await new Promise((resolve) => setTimeout(resolve, 300));
              }
            } else {
              console.log(
                `[getInfoMembersGroupLink] ⚠️  Trang ${
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
        `\n[getInfoMembersGroupLink] 📊 Tổng cộng: ${allMembers.length}/${groupData.totalMember} thành viên`
      );

      // Bước 3: Chuyển array thành object để dễ tra cứu
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

      // Trả về kết quả đầy đủ
      return {
        groupId: groupId,
        groupName: groupData.name,
        totalMember: groupData.totalMember,
        avatar: groupData.avatar,
        creatorId: groupData.creatorId,
        currentMems: allMembers,
        members: membersInfo,
        membersCount: allMembers.length,
        hasMoreMember: 0, // Đã lấy hết
        rawData: groupData, // Giữ lại data gốc
      };
    } catch (error) {
      console.error(`\n[getInfoMembersGroupLink]  LỖI:`, error.message);
      console.error(`[getInfoMembersGroupLink] Stack:`, error.stack);
      throw new Error(`Lỗi khi lấy thông tin group từ link: ${error.message}`);
    }
  }

  // ==========================================
  // HÀM 2: LẤY THÔNG TIN GROUP + MEMBERS TỪ GROUP ID
  // ==========================================

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
      // Bước 1: Lấy thông tin group cơ bản
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

      // Bước 2: Lấy danh sách members
      console.log(`\n[getInfoMembersGroupId] 👥 Đang lấy danh sách members...`);

      let allMembers = [];
      let membersList = null;

      // Thử lấy members từ groupInfo trước
      if (groupInfo.members) {
        membersList = groupInfo.members;
      } else if (groupInfo.gridInfoMap) {
        const firstKey = Object.keys(groupInfo.gridInfoMap)[0];
        if (firstKey && groupInfo.gridInfoMap[firstKey]?.members) {
          membersList = groupInfo.gridInfoMap[firstKey].members;
        }
      }

      // Nếu có members object, convert thành array
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

      // Bước 3: Chuyển thành object để dễ tra cứu
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

      // Trả về kết quả
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

      // --- BƯỚC 1: XÁC ĐỊNH UID CỦA NGƯỜI NHẬN ---
      const sanitizedIdentifier = targetIdentifier.replace(/\s+/g, "");
      const isPhoneNumber = /^(0|\+84|84)\d{9}$/.test(sanitizedIdentifier);

      if (isPhoneNumber) {
        console.log(`[ZaloManager] 🔍 Nhận diện là SĐT, đang tìm UID...`);
        try {
          // Dùng lại hàm findUserByPhone đã có, nó đã chuẩn hóa SĐT rồi
          const user = await this.findUserByPhone(
            accountId,
            sanitizedIdentifier
          );
          if (user && user.userId) {
            targetUid = user.userId;
            targetName = user.name;
            console.log(
              `[ZaloManager] ✅ Tìm thấy: ${targetName} (UID: ${targetUid})`
            );
          } else {
            throw new Error(
              `Không tìm thấy người dùng với SĐT ${sanitizedIdentifier}.`
            );
          }
        } catch (findError) {
          console.error(`[ZaloManager] ❌ Lỗi khi tìm SĐT:`, findError.message);
          throw findError;
        }
      } else {
        // Nếu không phải SĐT, coi như là UID
        targetUid = sanitizedIdentifier;
        targetName = `UID ${targetUid.substring(0, 8)}...`; // Tạm đặt tên
        console.log(`[ZaloManager] ✅ Nhận diện là UID: ${targetUid}`);
      }

      if (!targetUid) {
        throw new Error("Không thể xác định được UID của người nhận.");
      }

      // --- BƯỚC 2: GỌI ĐÚNG API `sendFriendRequest` ---
      console.log(
        `\n[ZaloManager] 🚀 Đang gọi api.sendFriendRequest("${message}", "${targetUid}")...`
      );

      // Sử dụng API chính xác theo tài liệu bạn cung cấp
      const result = await api.sendFriendRequest(message, targetUid);

      console.log(`\n[ZaloManager] ✅ GỬI LỜI MỜI KẾT BẠN THÀNH CÔNG!`);
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
      console.error(`\n[ZaloManager] ❌ LỖI KHI GỬI LỜI MỜI KẾT BẠN!`);
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
    console.log(`[ZaloManager] 🧪 TEST joinGroupLink`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`[ZaloManager] Link: ${groupLink}`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(`[ZaloManager]  Đang gọi api.joinGroupLink(${groupLink})...`);

      const result = await api.joinGroupLink(groupLink);

      //  THÀNH CÔNG - Join ngay lập tức (nhóm không kiểm duyệt)
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
      console.error(`[ZaloManager] ⚠️  API Response: ${error.message}`);

      if (
        error.message.includes("Waiting for approve") ||
        error.message.includes("waiting for approve") ||
        error.message.includes("240")
      ) {
        console.log(`\n[ZaloManager] ⏳ YÊU CẦU THAM GIA ĐÃ ĐƯỢC GỬI!`);
        console.log(`[ZaloManager] 📋 Nhóm yêu cầu KIỂM DUYỆT thành viên.`);
        console.log(`[ZaloManager] ⏰ Đang chờ admin phê duyệt...`);
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

      //  LỖI THẬT SỰ
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
    console.log(`[ZaloManager] 🚪 BẮT ĐẦU THAM GIA NHÓM`);
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
      camonquykhach;

      return {
        success: true,
        status: "joined",
        message: "Bot đã tham gia nhóm thành công!",
        data: result,
      };
    } catch (error) {
      // Xử lý "Waiting for approve"
      if (
        error.message.includes("Waiting for approve") ||
        error.message.includes("240")
      ) {
        console.log(`\n[ZaloManager] ⏳ YÊU CẦU THAM GIA ĐÃ GỬI!`);
        console.log(`[ZaloManager] Đang chờ admin phê duyệt...`);
        console.log(`${"=".repeat(70)}\n`);

        return {
          success: true,
          status: "pending",
          message: "Yêu cầu tham gia đã được gửi! Đang chờ admin duyệt.",
          data: null,
        };
      }

      // Xử lý "Already member"
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

      // Lỗi thật sự
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
    console.log(`[ZaloManager] 📋 LẤY DANH SÁCH BẠN BÈ`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      console.log(`[ZaloManager]  Đang gọi api.getFriendList()...`);

      const friendList = await api.getAllFriends();

      console.log(`\n[ZaloManager]  LẤY DANH SÁCH THÀNH CÔNG!`);

      // Parse data
      let friends = [];

      if (friendList && typeof friendList === "object") {
        // Case 1: friendList là object với key là userId
        if (!Array.isArray(friendList) && friendList.data) {
          friends = Object.values(friendList.data);
        }
        // Case 2: friendList.data là array
        else if (friendList.data && Array.isArray(friendList.data)) {
          friends = friendList.data;
        }
        // Case 3: friendList là object trực tiếp
        else if (!Array.isArray(friendList)) {
          friends = Object.values(friendList);
        }
        // Case 4: friendList đã là array
        else {
          friends = friendList;
        }
      }

      console.log(`[ZaloManager] 📊 Tổng số bạn bè: ${friends.length}`);

      // Format data
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
    console.log(`[ZaloManager] 📋 LẤY DANH SÁCH NHÓM`);
    console.log(`[ZaloManager] Account: ${account.name} (${accountId})`);
    console.log(`${"=".repeat(70)}\n`);

    const api = account.api;

    try {
      // BƯỚC 1: Lấy danh sách ID của tất cả các nhóm
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

      // BƯỚC 2: Lấy thông tin chi tiết cho từng nhóm bằng ID
      console.log(
        `\n[ZaloManager]  Bước 2: Đang lấy thông tin chi tiết cho ${groupIds.length} nhóm...`
      );

      // Sử dụng Promise.all để tăng tốc độ, lấy thông tin nhiều nhóm cùng lúc
      const groupDetailsPromises = groupIds.map((id) => api.getGroupInfo(id));
      const groupDetailsList = await Promise.all(groupDetailsPromises);

      console.log(`[ZaloManager]  Đã lấy thành công thông tin chi tiết.`);

      // BƯỚC 3: Format lại dữ liệu theo ý muốn
      const formattedGroups = groupDetailsList.map((group) => {
        // groupInfo có thể nằm trong một key khác tùy vào phiên bản API
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
      // THAY ĐỔI Ở DÒNG NÀY: Thêm tham số thứ hai là `0`
      console.log(`[ZaloManager]  Đang gọi api.removeFriend(${userId}, 0)...`);
      const result = await api.removeFriend(userId, 0); // <-- SỬA Ở ĐÂY

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
    socket = null // Thêm socket để gửi cập nhật tiến trình
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

    // --- BƯỚC 1: CHUẨN HÓA DANH SÁCH THÀNH VIÊN ---
    if (socket)
      socket.emit("scenario_update", {
        message: `🔍 Đang chuẩn hóa ${memberIdentifiers.length} thành viên (SĐT -> UID)...`,
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
      `[ZaloManager] 📊 Đã xử lý xong: ${finalMemberIds.length} UID hợp lệ.`
    );
    if (failedIdentifiers.length > 0)
      console.warn(
        `[ZaloManager] ⚠️ Thất bại: ${failedIdentifiers.length} thành viên.`
      );
    if (finalMemberIds.length === 0)
      throw new Error("Không có thành viên hợp lệ nào để tạo nhóm.");

    // --- BƯỚC 2: KIỂM TRA SỐ LƯỢNG VÀ CHỌN CHIẾN LƯỢC ---
    const SAFE_CREATE_LIMIT = 50; // Giới hạn an toàn để tạo nhóm 1 lần

    // --- CHIẾN LƯỢC 1: SỐ LƯỢNG NHỎ, TẠO NHÓM TRỰC TIẾP ---
    if (finalMemberIds.length <= SAFE_CREATE_LIMIT) {
      console.log(
        `[ZaloManager] Số lượng (${finalMemberIds.length}) <= ${SAFE_CREATE_LIMIT}, tạo nhóm trực tiếp...`
      );
      if (socket)
        socket.emit("scenario_update", {
          message: `🚀 Đang tạo nhóm với ${finalMemberIds.length} thành viên...`,
        });

      try {
        const result = await api.createGroup({
          name: groupName,
          members: finalMemberIds,
        });
        console.log(
          `\n[ZaloManager] ✅ TẠO NHÓM THÀNH CÔNG! ID: ${result.groupId}`
        );
        return {
          success: true,
          message: "Tạo nhóm thành công!",
          data: result,
          failedIdentifiers,
        };
      } catch (error) {
        console.error(`\n[ZaloManager] ❌ LỖI KHI TẠO NHÓM TRỰC TIẾP!`, error);
        throw new Error(`Tạo nhóm thất bại: ${error.message}`);
      }
    }
    // --- CHIẾN LƯỢC 2: SỐ LƯỢNG LỚN, TẠO VÀ THÊM THEO ĐỢT ---
    else {
      console.log(
        `[ZaloManager] Số lượng (${finalMemberIds.length}) > ${SAFE_CREATE_LIMIT}, chuyển sang chế độ chia nhỏ.`
      );

      // 2.1. Tạo nhóm chỉ với 2 thành viên đầu tiên để lấy Group ID
      const initialMembers = finalMemberIds.slice(0, 2);
      const remainingMembers = finalMemberIds.slice(2);

      console.log(
        `[ZaloManager] ↳ Bước 2.1: Tạo nhóm "${groupName}" với 2 thành viên đầu...`
      );
      if (socket)
        socket.emit("scenario_update", {
          message: `🚀 Đang tạo nhóm "${groupName}" với 2 thành viên đầu...`,
        });

      let groupId;
      try {
        const createResponse = await api.createGroup({
          name: groupName,
          members: initialMembers,
        });
        groupId = createResponse.groupId;
        if (!groupId) throw new Error("Không nhận được Group ID sau khi tạo.");
        console.log(`[ZaloManager]   ✅ Tạo nhóm thành công! ID: ${groupId}`);
      } catch (error) {
        console.error(`\n[ZaloManager] ❌ LỖI KHI TẠO NHÓM BAN ĐẦU!`, error);
        throw new Error(`Lỗi tạo nhóm ban đầu: ${error.message}`);
      }

      // 2.2. Thêm các thành viên còn lại theo từng đợt
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
            message: `➕ Đang thêm thành viên (Đợt ${currentBatchNum}/${totalBatches})...`,
          });

        try {
          // SỬ DỤNG API CHÍNH XÁC BẠN CUNG CẤP: api.addUserToGroup(memberIds, groupId)
          await api.addUserToGroup(batch, groupId);
          console.log(`[ZaloManager]     ✅ Thêm thành công.`);
        } catch (error) {
          console.error(
            `[ZaloManager]     ❌ Lỗi khi thêm đợt ${currentBatchNum}:`,
            error.message
          );
        }

        // Nghỉ một chút giữa các lần gọi để tránh bị block
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
        data: { groupId }, // Trả về groupId để client biết
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
    console.log(`[ZaloManager] ✅ CHẤP NHẬN LỜI MỜI KẾT BẠN`);
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
      console.log(`[ZaloManager] Response:`, result); // Thường là chuỗi rỗng
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
}
const zaloManager = new ZaloManager();
export default zaloManager;
