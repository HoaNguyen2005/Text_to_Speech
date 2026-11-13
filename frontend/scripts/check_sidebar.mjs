import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: Sidebar } = await server.ssrLoadModule('/src/components/ShellSidebar.vue');
  async function render(role, collapsed = false) {
    const router = createRouter({ history: createMemoryHistory(), routes: ['/', '/book', '/history', '/voices', '/profile', '/admin'].map(path => ({ path, component: { render: () => null } })) });
    await router.push(role === 'admin' ? '/admin' : '/book');
    const app = createSSRApp({ render: () => h(Sidebar, { user: { role, fullName: 'Người dùng <test>', email: 'test@example.invalid' }, collapsed }) });
    app.config.globalProperties.$t = value => value;
    app.use(router);
    return renderToString(app);
  }
  const user = await render('user');
  assert.equal((user.match(/sidebar-link[ "]/g) || []).length, 5);
  assert.match(user, /<a(?=[^>]*href="\/book")(?=[^>]*aria-current="page")[^>]*>/);
  assert.doesNotMatch(user, /href="\/admin"/);
  assert.match(user, /Người dùng &lt;test&gt;/);
  assert.match(user, /popover="auto"/);
  assert.match(user, /Đăng xuất/);
  const admin = await render('admin');
  assert.equal((admin.match(/sidebar-link[ "]/g) || []).length, 2);
  assert.match(admin, /<a(?=[^>]*href="\/admin")(?=[^>]*aria-current="page")[^>]*>/);
  assert.doesNotMatch(admin, /href="\/book"/);
  const compact = await render('user', true);
  assert.match(compact, /class="sidebar-label" aria-hidden="true"/);
  assert.match(compact, /aria-label="Mở rộng menu"/);
  assert.match(compact, /class="sidebar-wordmark" aria-hidden="true"/);
  console.log('PASS: user/admin navigation, active route, compact accessible labels, account popover and escaped user name');
} finally { await server.close(); }
