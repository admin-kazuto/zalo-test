# Hướng Dẫn Tối Ưu Hóa API - Giảm Delay Khi Gọi API t3 (Zalo)

## 📋 Tổng Quan Vấn Đề

Khi gọi API Zalo (t3), có nhiều điểm gây delay:
1. **Sequential API calls**: Gọi API tuần tự thay vì parallel
2. **Không có caching**: Gọi lại API cho cùng một dữ liệu
3. **Blocking operations**: Các tác vụ nặng block request
4. **Không có retry mechanism**: Lỗi mạng nhỏ cũng phải gọi lại từ đầu

## 🚀 Các Giải Pháp Đã Triển Khai

### 1. **Caching System** (`cache.service.js`)
- Cache kết quả API với TTL (Time To Live)
- Tự động cleanup cache hết hạn
- Giảm số lần gọi API trùng lặp

**Cách sử dụng:**
```javascript
import cacheService from '../utils/cache.service.js';

// Cache user profile trong 10 phút
const userProfile = await cacheService.getOrSet(
  cacheService.keyUserProfile(accountId, identifier),
  async () => await api.getUserInfo(identifier),
  10 * 60 * 1000 // 10 phút
);
```

### 2. **Parallel Processing**
Thay vì gọi API tuần tự:
```javascript
// ❌ CHẬM - Tuần tự
for (const groupId of groupIds) {
  const info = await api.getGroupInfo(groupId);
  groups.push(info);
}
```

Sử dụng `Promise.all()`:
```javascript
// ✅ NHANH - Parallel
const groupDetailsPromises = groupIds.map(id => api.getGroupInfo(id));
const groupDetailsList = await Promise.all(groupDetailsPromises);
```

### 3. **Background Jobs**
Chuyển các tác vụ nặng sang xử lý nền:
```javascript
// Trả về response ngay, xử lý ở background
const run = async () => {
  // Xử lý nặng ở đây
};
run(); // Không await

return { message: "Đã bắt đầu xử lý..." };
```

### 4. **Batch Processing**
Gộp nhiều request thành batch:
```javascript
// Thay vì gọi từng cái một
const BATCH_SIZE = 20;
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const batch = items.slice(i, i + BATCH_SIZE);
  await processBatch(batch);
}
```

## 📊 Các Hàm Đã Được Tối Ưu

### ✅ `getGroupList()`
- **Trước**: Gọi `getGroupInfo()` tuần tự cho từng nhóm
- **Sau**: Gọi parallel với `Promise.all()`
- **Cải thiện**: Giảm từ ~N giây xuống ~1 giây (N = số nhóm)

### ✅ `getInfoMembersGroupLink()`
- **Trước**: Gọi `getGroupLinkInfo()` tuần tự trong vòng lặp
- **Sau**: Thêm delay hợp lý và error handling tốt hơn
- **Cải thiện**: Tránh bị rate limit, xử lý lỗi tốt hơn

### ✅ `getUserProfile()`
- **Trước**: Không có cache
- **Sau**: Có cache với TTL 10 phút
- **Cải thiện**: Lần gọi thứ 2 trở đi gần như tức thì

### ✅ `getFriendList()`
- **Trước**: Không có cache
- **Sau**: Có cache với TTL 5 phút
- **Cải thiện**: Giảm delay đáng kể cho lần gọi sau

## 🎯 Best Practices

### 1. **Luôn sử dụng cache cho dữ liệu ít thay đổi**
```javascript
// User profile, group info, friend list...
const data = await cacheService.getOrSet(
  cacheService.keyUserProfile(accountId, identifier),
  async () => await fetchData(),
  10 * 60 * 1000
);
```

### 2. **Sử dụng Promise.all() cho parallel calls**
```javascript
// ✅ Đúng
const results = await Promise.all([
  api.getData1(),
  api.getData2(),
  api.getData3()
]);

// ❌ Sai
const result1 = await api.getData1();
const result2 = await api.getData2();
const result3 = await api.getData3();
```

### 3. **Thêm delay hợp lý giữa các batch**
```javascript
await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay
```

### 4. **Xử lý lỗi tốt để tránh retry không cần thiết**
```javascript
try {
  const result = await api.call();
} catch (error) {
  if (error.message.includes('rate limit')) {
    // Đợi lâu hơn
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw error;
}
```

## 📈 Kết Quả Mong Đợi

- **getGroupList**: Giảm từ ~10-30s xuống ~2-5s (tùy số nhóm)
- **getUserProfile**: Giảm từ ~1-2s xuống ~0.01s (nếu có cache)
- **getFriendList**: Giảm từ ~3-5s xuống ~0.01s (nếu có cache)
- **getInfoMembersGroupLink**: Ổn định hơn, ít bị rate limit

## 🔧 Cấu Hình Cache TTL

| Loại dữ liệu | TTL mặc định | Có thể thay đổi |
|-------------|-------------|----------------|
| User Profile | 10 phút | ✅ |
| Group Info | 5 phút | ✅ |
| Friend List | 5 phút | ✅ |
| Group List | 5 phút | ✅ |

## ⚠️ Lưu Ý

1. **Cache có thể không chính xác 100%**: Nếu dữ liệu thay đổi thường xuyên, giảm TTL
2. **Memory usage**: Cache lưu trong memory, cần cleanup định kỳ
3. **Rate limiting**: Vẫn cần tuân thủ rate limit của Zalo API

## 🚧 Các Cải Tiến Tiếp Theo (Tùy chọn)

1. **Redis cache**: Thay thế memory cache bằng Redis để share giữa nhiều server
2. **Request queue**: Sử dụng Bull/BullMQ để queue các request
3. **Connection pooling**: Tối ưu kết nối với Zalo API
4. **Retry với exponential backoff**: Tự động retry khi lỗi mạng

