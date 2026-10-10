/**
 * Authentication Module
 * Handles login, logout, and auth state observation
 */

import { signInWithEmailAndPassword, signOut, onAuthStateChanged as firebaseOnAuthStateChanged } from 'firebase/auth';
import { auth } from '../config/firebase.js';
import { findTechnicianByUsername, initializeTechnicians } from './technicians.js';

/**
 * Maps Firebase auth error codes to Bulgarian user-friendly messages
 */
const ERROR_MESSAGES = {
  'auth/invalid-credential': 'Невалидно потребителско име или парола.',
  'auth/user-not-found': 'Потребителят не съществува.',
  'auth/wrong-password': 'Грешна парола.',
  'auth/too-many-requests': 'Повече опити. Опитайте отново по-късно.',
  'auth/network-request-failed': 'Няма връзка с интернет.',
  'auth/invalid-email': 'Невалиден имейл адрес.',
  'auth/user-disabled': 'Акаунтът е деактивиран.',
  'auth/operation-not-allowed': 'Email/Password вход е деактивиран.',
  'auth/missing-password': 'Моля, въведете парола.',
  'auth/missing-email': 'Моля, въведете потребителско име.',
};

/**
 * Translates Firebase error to Bulgarian message
 * @param {Error} error - Firebase error
 * @returns {string} User-friendly message
 */
function getErrorMessage(error) {
  return ERROR_MESSAGES[error.code] || `Грешка: ${error.message}`;
}

/**
 * Sign in with username (becomes email) and password
 * Also initializes technicians and checks for technician match
 * @param {string} username - Username (will become username@gmail.com)
 * @param {string} password - Password
 * @returns {Promise<{user: User, error: null, matchedTechnician: Object|null} | {user: null, error: string, matchedTechnician: null}>}
 */
export async function login(username, password) {
  if (!username || !password) {
    return { user: null, error: 'Моля, попълнете всички полета.', matchedTechnician: null };
  }

  const email = `${username.trim().toLowerCase()}@gmail.com`;

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    
    // Initialize technicians service
    await initializeTechnicians();
    
    // Check if username matches a technician (case-insensitive)
    const matchedTechnician = findTechnicianByUsername(username);
    
    return { user: userCredential.user, error: null, matchedTechnician };
  } catch (error) {
    return { user: null, error: getErrorMessage(error), matchedTechnician: null };
  }
}

/**
 * Sign out current user
 * @returns {Promise<{error: string | null}>}
 */
export async function logout() {
  try {
    await signOut(auth);
    return { error: null };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
}

/**
 * Get currently signed-in user (synchronous)
 * @returns {User | null}
 */
export function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Subscribe to auth state changes
 * @param {Function} callback - Called with (user | null) on every auth change
 * @returns {Function} Unsubscribe function
 */
export function onAuthStateChanged(callback) {
  return firebaseOnAuthStateChanged(auth, callback);
}

/**
 * Get user display name (email prefix before @)
 * @param {User | null} user
 * @returns {string}
 */
export function getUserDisplayName(user) {
  if (!user?.email) return 'Потребител';
  return user.email.split('@')[0];
}

/**
 * Get username from user (email prefix before @)
 * @param {User | null} user
 * @returns {string}
 */
export function getUsername(user) {
  if (!user?.email) return '';
  return user.email.split('@')[0];
}