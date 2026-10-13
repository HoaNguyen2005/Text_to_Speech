import { createRouter, createWebHistory } from 'vue-router';
import { session } from '../services/auth';

const routes = [
  {
    path: '/',
    name: 'LectureCreator',
    component: () => import('../views/user/LectureCreator.vue'),
    meta: { title: 'Tạo bài giảng' }
  },
  {
    path: '/book',
    name: 'BookSummarizer',
    component: () => import('../views/user/BookSummarizer.vue'),
    meta: { title: 'Sách nói AI' }
  },
  {
    path: '/history',
    name: 'History',
    component: () => import('../views/user/HistoryView.vue'),
    meta: { title: 'Lịch sử' }
  },
  {
    path: '/admin',
    name: 'AdminPanel',
    component: () => import('../views/admin/AdminPanel.vue'),
    meta: { requiresAdmin: true, title: 'Tổng quan' }
  },
  { path: '/:pathMatch(.*)*', component: () => import('../views/NotFound.vue'), meta: { title: 'Không tìm thấy trang' } }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

// Navigation Guard - Bảo vệ route
router.beforeEach((to, from, next) => {
  const user = session.value?.user;
  const isAdmin = user?.role === 'admin';

  // Nếu route yêu cầu Admin mà không phải Admin → về trang chủ
  if (to.meta.requiresAdmin && !isAdmin) {
    return next('/');
  }

  // Nếu đã đăng nhập là Admin mà cố vào trang user → về /admin
  if (!to.meta.requiresAdmin && isAdmin && to.path !== '/admin') {
    return next('/admin');
  }

  next();
});

export default router;
