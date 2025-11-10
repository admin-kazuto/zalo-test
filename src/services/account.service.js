// // File: src/services/account.service.js (BẠN CẦN TỰ TẠO VÀ VIẾT)

// // import { db } from '../config/database'; // Ví dụ: import kết nối DB

// export async function findOrCreateAccount(accountData) {
//   const { accountId, zaloName } = accountData;

//   // // Ví dụ với PostgreSQL (thư viện pg)
//   // let account = await db.query('SELECT * FROM "Accounts" WHERE "accountId" = $1', [accountId]);

//   // if (account.rows.length > 0) {
//   //   // Nếu tìm thấy, trả về tài khoản
//   //   return account.rows[0];
//   // } else {
//   //   // Nếu không, tạo mới với role mặc định là 'free'
//   //   const newAccount = await db.query(
//   //     'INSERT INTO "Accounts" ("accountId", "zaloName", role) VALUES ($1, $2, $3) RETURNING *',
//   //     [accountId, zaloName, 'free']
//   //   );
//   //   return newAccount.rows[0];
//   // }
  
//   // --- CODE GIẢ LẬP ĐỂ BẠN TEST NGAY ---
//   console.log(`[DB Service] Tìm hoặc tạo tài khoản cho: ${zaloName} (${accountId})`);
//   return {
//       accountId: accountId,
//       zaloName: zaloName,
//       role: 'free', // Mặc định là free khi tạo mới
//       createdAt: new Date(),
//       updatedAt: new Date(),
//   };
//   // --- HẾT CODE GIẢ LẬP ---
// }