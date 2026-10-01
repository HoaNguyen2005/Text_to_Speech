import { createRouter, createWebHistory } from 'vue-router';
import LectureCreator from '../views/LectureCreator.vue';
import BookSummarizer from '../views/BookSummarizer.vue';

const routes = [
  {
    path: '/',
    name: 'LectureCreator',
    component: LectureCreator
  },
  {
    path: '/book',
    name: 'BookSummarizer',
    component: BookSummarizer
  },
  {
    path: '/history',
    name: 'History',
    component: () => import('../views/HistoryView.vue')
  },
  {
    path: '/admin',
    name: 'AdminPanel',
    component: () => import('../views/AdminPanel.vue'),
    meta: { requiresAdmin: true }  // Đánh dấu trang này chỉ dành cho Admin
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

// Navigation Guard - Bảo vệ route
router.beforeEach((to, from, next) => {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
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
