/**
 * Cache Service - Giảm delay bằng cách cache kết quả API
 * TTL (Time To Live) có thể cấu hình cho từng loại dữ liệu
 */

class CacheService {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 phút mặc định
  }

  /**
   * Lấy dữ liệu từ cache
   * @param {string} key - Key của cache
   * @returns {any|null} - Dữ liệu hoặc null nếu không có/đã hết hạn
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    // Kiểm tra xem đã hết hạn chưa
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  /**
   * Lưu dữ liệu vào cache
   * @param {string} key - Key của cache
   * @param {any} data - Dữ liệu cần cache
   * @param {number} ttl - Thời gian sống (ms), mặc định 5 phút
   */
  set(key, data, ttl = null) {
    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, { data, expiresAt });
  }

  /**
   * Xóa một key khỏi cache
   * @param {string} key - Key cần xóa
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Xóa tất cả cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Xóa các cache đã hết hạn
   */
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Lấy hoặc set cache với callback
   * Nếu có cache thì trả về cache, nếu không thì gọi callback và cache kết quả
   * @param {string} key - Key của cache
   * @param {Function} callback - Hàm async để lấy dữ liệu nếu không có cache
   * @param {number} ttl - Thời gian sống (ms)
   * @returns {Promise<any>} - Dữ liệu từ cache hoặc từ callback
   */
  async getOrSet(key, callback, ttl = null) {
    const cached = this.get(key);
    if (cached !== null) {
      console.log(`[Cache] Hit: ${key}`);
      return cached;
    }

    console.log(`[Cache] Miss: ${key}, fetching...`);
    const data = await callback();
    this.set(key, data, ttl);
    return data;
  }

  /**
   * Tạo key cache cho user profile
   */
  keyUserProfile(accountId, identifier) {
    return `user_profile:${accountId}:${identifier}`;
  }

  /**
   * Tạo key cache cho group info
   */
  keyGroupInfo(accountId, groupId) {
    return `group_info:${accountId}:${groupId}`;
  }

  /**
   * Tạo key cache cho group link info
   */
  keyGroupLinkInfo(accountId, groupLink) {
    return `group_link_info:${accountId}:${groupLink}`;
  }

  /**
   * Tạo key cache cho friend list
   */
  keyFriendList(accountId) {
    return `friend_list:${accountId}`;
  }

  /**
   * Tạo key cache cho group list
   */
  keyGroupList(accountId) {
    return `group_list:${accountId}`;
  }
}

// Export singleton instance
const cacheService = new CacheService();

// Tự động cleanup cache mỗi 10 phút
setInterval(() => {
  cacheService.cleanup();
}, 10 * 60 * 1000);

export default cacheService;

