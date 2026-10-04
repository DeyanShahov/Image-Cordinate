/**
 * App Shell
 *
 * Owns the top-level view switching between the login screen and the main app.
 * Renders the user menu (top-right) with the signed-in user name and a logout action.
 */

import { onAuthStateChanged, logout as authLogout, getUserDisplayName } from './auth.js';
import { renderLoginForm, showToast } from './login-ui.js';
import { initializeApp } from '../main.js';

let currentUser = null;
let appInitialized = false;
let loginCleanup = null;
let menuBound = false;

const loginRoot = () => document.getElementById('login-root');
const appRoot = () => document.getElementById('app-root');
const bootRoot = () => document.getElementById('boot-root');
const userMenuHost = () => document.getElementById('user-menu');

/** Hides the boot/loading placeholder. */
function hideBoot() {
  const boot = bootRoot();
  if (boot) boot.hidden = true;
}

/** Shows the login screen and hides the main app. */
export function showLogin() {
  const login = loginRoot();
  const root = appRoot();
  const menu = userMenuHost();

  if (root) root.hidden = true;
  if (menu) menu.hidden = true;
  if (login) {
    login.hidden = false;
    if (!loginCleanup) {
      loginCleanup = renderLoginForm(login, {
        onLoginSuccess: () => {
          // onAuthStateChanged drives the actual view switch.
          showToast('Успешно влизане!', 'success', 2500);
        },
        onLoginError: () => {},
      });
    }
  }
  hideBoot();
}

/** Shows the main app and hides the login screen. */
export function showApp() {
  const login = loginRoot();
  const root = appRoot();
  const menu = userMenuHost();

  if (login) {
    login.hidden = true;
    // Tear down the login form so the next logout re-renders it fresh.
    if (loginCleanup) {
      try {
        loginCleanup();
      } catch {
        /* ignore */
      }
      loginCleanup = null;
      login.innerHTML = '';
    }
  }

  if (root) root.hidden = false;
  if (menu) {
    menu.hidden = false;
    renderUserMenu(currentUser);
  }

  if (!appInitialized) {
    appInitialized = true;
    // Boot the heavy main application (camera, GPS, gallery…) after login.
    try {
      initializeApp();
    } catch (err) {
      console.error('Failed to initialize app:', err);
    }
  }

  hideBoot();
}

/**
 * Renders the user menu (top-right).
 * @param {import('firebase/auth').User | null} user
 */
function renderUserMenu(user) {
  const host = userMenuHost();
  if (!host) return;

  const displayName = getUserDisplayName(user);

  host.innerHTML = `
    <div class="user-menu">
      <button
        id="user-menu-btn"
        class="user-menu__btn"
        type="button"
        aria-expanded="false"
        aria-haspopup="true"
      >
        <span class="user-menu__avatar" aria-hidden="true">👤</span>
        <span class="user-menu__name">${escapeHtml(displayName)}</span>
        <span class="user-menu__arrow" aria-hidden="true">▾</span>
      </button>
      <div id="user-menu-dropdown" class="user-menu__dropdown" hidden>
        <div class="user-menu__head">
          <span class="user-menu__avatar" aria-hidden="true">👤</span>
          <div class="user-menu__meta">
            <span class="user-menu__label">Влязъл като</span>
            <span class="user-menu__name">${escapeHtml(displayName)}</span>
          </div>
        </div>
        <hr class="user-menu__divider" />
        <button id="btn-logout" class="user-menu__item" type="button">
          <span aria-hidden="true">🚪</span> Изход
        </button>
      </div>
    </div>
  `;

  const menuBtn = host.querySelector('#user-menu-btn');
  const dropdown = host.querySelector('#user-menu-dropdown');
  const logoutBtn = host.querySelector('#btn-logout');

  const closeDropdown = () => {
    dropdown.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown.hidden;
    dropdown.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  if (!menuBound) {
    document.addEventListener('click', () => {
      const openMenu = document.getElementById('user-menu-dropdown');
      const btn = document.getElementById('user-menu-btn');
      if (openMenu && !openMenu.hidden) {
        openMenu.hidden = true;
        btn?.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openMenu = document.getElementById('user-menu-dropdown');
        const btn = document.getElementById('user-menu-btn');
        if (openMenu && !openMenu.hidden) {
          openMenu.hidden = true;
          btn?.setAttribute('aria-expanded', 'false');
        }
      }
    });
    menuBound = true;
  }

  logoutBtn.addEventListener('click', async () => {
    closeDropdown();
    const { error } = await authLogout();
    if (error) {
      showToast(error, 'error');
    }
    // onAuthStateChanged handles the view switch back to login.
  });
}

/**
 * Subscribes to Firebase auth state. Call once at startup.
 */
export function initAuthListener() {
  onAuthStateChanged((user) => {
    currentUser = user;
    if (user) {
      showApp();
    } else {
      showLogin();
    }
  });
}

/**
 * Minimal HTML escaping for interpolated text.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}