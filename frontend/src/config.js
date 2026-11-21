// Địa chỉ Backend Gateway. Tự động ưu tiên cấu hình từ Desktop App nếu có.
const desktopConfig = typeof window !== 'undefined' ? window.desktopApp?.config : null;
export const API_BASE_URL = desktopConfig?.apiBaseUrl || import.meta.env.VITE_API_URL || 'http://localhost:3000';
