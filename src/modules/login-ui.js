/**
 * Login UI Module
 * Renders the login page and handles form interactions.
 */

import { login } from './auth.js';

/** Reference to the shared toast element from index.html. */
let toastEl = null;
let toastTimer = null;

/**
 * Shows a toast notification using the shared #toast element.
 * @param {string} message
 * @param {'error' | 'success' | 'info'} type
 * @param {number} timeout - Auto-dismiss after ms
 */
export function showToast(message, type = 'info', timeout = 4000) {
  if (!message) return;
  if (!toastEl) toastEl = document.getElementById('toast');
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.classList.remove('toast--error', 'toast--success', 'toast--info');
  toastEl.classList.add(`toast--${type}`);
  toastEl.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, timeout);
}

/**
 * Renders the login form into a container.
 * @param {HTMLElement} container - Root element to render into
 * @param {Object} callbacks
 * @param {Function} [callbacks.onLoginSuccess]
 * @param {Function} [callbacks.onLoginError]
 * @returns {Function} cleanup function
 */
export function renderLoginForm(container, { onLoginSuccess, onLoginError } = {}) {
  if (!container) return () => {};

  container.innerHTML = `
    <div class="login-page">
      <main class="login-main">
        <div class="login-card">
          <header class="login-header">
            <span class="login-logo" aria-hidden="true"></span>
            <h1 class="login-title">InfraLink Technicians</h1>
            <p class="login-subtitle">Влизане в системата</p>
          </header>

          <form id="login-form" class="login-form" novalidate>
            <div class="form-group">
              <label for="login-username" class="form-label">Потребител</label>
              <input
                type="text"
                id="login-username"
                name="username"
                class="form-input"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                required
                placeholder="иван.петров"
              >
            </div>

            <div class="form-group">
              <label for="login-password" class="form-label">Парола</label>
              <input
                type="password"
                id="login-password"
                name="password"
                class="form-input"
                autocomplete="current-password"
                required
                placeholder="••••••••"
              >
            </div>

            <p id="login-error" class="login-error" role="alert" hidden></p>

            <button type="submit" id="login-btn" class="btn btn--primary btn--block login-submit">
              <span class="btn-text">Влез</span>
              <span class="btn-loader" hidden aria-hidden="true"></span>
            </button>
          </form>

          <p class="login-note">
            Акаунтите се създават от администратор. Ако нямате достъп, обърнете се към
            своя мениджър.
          </p>
        </div>
      </main>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const submitBtn = container.querySelector('#login-btn');
  const btnText = submitBtn.querySelector('.btn-text');
  const errorEl = container.querySelector('#login-error');
  const usernameInput = container.querySelector('#login-username');
  const passwordInput = container.querySelector('#login-password');

  let isSubmitting = false;

  function setError(message) {
    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    setError('');

    if (!username || !password) {
      setError('Моля, попълнете всички полета.');
      return;
    }

    isSubmitting = true;
    submitBtn.disabled = true;
    btnText.textContent = 'Влизане…';

    try {
      const { user, error } = await login(username, password);

      if (error) {
        setError(error);
        onLoginError?.(error);
      } else {
        onLoginSuccess?.(user);
      }
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      btnText.textContent = 'Влез';
    }
  }

  form.addEventListener('submit', handleSubmit);
  usernameInput.focus({ preventScroll: true });

  return () => {
    form.removeEventListener('submit', handleSubmit);
  };
}