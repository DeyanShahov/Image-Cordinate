/**
 * Bootstrap entry point.
 *
 * Loads global styles, then starts the auth listener that decides whether to show
 * the login screen ("InfraLink technicians") or the main application.
 *
 * The main application (src/main.js) is imported by the app shell and boots only
 * after a successful login.
 */

import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

import { initAuthListener } from './modules/app-shell.js';

initAuthListener();