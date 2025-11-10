// export const checkRole = (allowedRoles) => {
//   return (req, res, next) => {
//     // Middleware này phải chạy SAU authMiddleware, nên req.user đã tồn tại
//     if (!req.user || !req.user.role) {
//       return res.status(403).json({ message: "Forbidden: Không có thông tin quyền" });
//     }

//     const userRole = req.user.role;

//     // Kiểm tra xem role của user có nằm trong danh sách được phép không
//     if (allowedRoles.includes(userRole)) {
//       next(); // Được phép, đi tiếp
//     } else {
//       return res.status(403).json({ message: "Forbidden: Bạn không có quyền truy cập chức năng này" });
//     }
//   };
// };