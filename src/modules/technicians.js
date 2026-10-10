/**
 * Technicians Service
 * Manages the list of technicians from Firestore with real-time sync.
 * Handles matching logged-in users to technicians (case-insensitive).
 */

import { db } from '../config/firestore.js';
import { collection, getDocs, query, where, onSnapshot } from 'firebase/firestore';

const TECHNICIANS_COLLECTION = 'technicians';

/**
 * In-memory cache for technicians
 * @type {Array<{id: string, name: string, active: boolean, createdAt: Date}>}
 */
let techniciansCache = [];
let listeners = new Set();
let unsubscribeSnapshot = null;
let isInitialized = false;

/**
 * Normalize name for case-insensitive comparison
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return name.trim().toLowerCase();
}

/**
 * Check if a username matches a technician name (case-insensitive exact match)
 * @param {string} username - The username from login (e.g., 'alex')
 * @param {string} technicianName - The technician name (e.g., 'Alex')
 * @returns {boolean}
 */
export function matchTechnician(username, technicianName) {
  if (!username || !technicianName) return false;
  return normalizeName(username) === normalizeName(technicianName);
}

/**
 * Find a technician by username (case-insensitive)
 * @param {string} username
 * @returns {{id: string, name: string, active: boolean} | null}
 */
export function findTechnicianByUsername(username) {
  const normalized = normalizeName(username);
  return techniciansCache.find(t => normalizeName(t.name) === normalized) || null;
}

/**
 * Get all active technicians
 * @returns {Array<{id: string, name: string, active: boolean}>}
 */
export function getActiveTechnicians() {
  return techniciansCache.filter(t => t.active).map(t => ({
    id: t.id,
    name: t.name,
    active: t.active,
  }));
}

/**
 * Get all technicians (including inactive)
 * @returns {Array<{id: string, name: string, active: boolean}>}
 */
export function getAllTechnicians() {
  return techniciansCache.map(t => ({
    id: t.id,
    name: t.name,
    active: t.active,
  }));
}

/**
 * Subscribe to technician list changes
 * @param {Function} callback - Called with technician array on every change
 * @returns {Function} Unsubscribe function
 */
export function subscribeToTechnicians(callback) {
  listeners.add(callback);
  // Immediately call with current cache
  callback(getActiveTechnicians());
  
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Notify all listeners of changes
 */
function sortCache() {
  techniciansCache.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function notifyListeners() {
  const active = getActiveTechnicians();
  for (const listener of listeners) {
    try {
      listener(active);
    } catch (error) {
      console.error('[Technicians] Listener error:', error);
    }
  }
}

/**
 * Initialize the technicians service - sets up real-time listener
 * @returns {Promise<void>}
 */
export async function initializeTechnicians() {
  if (isInitialized) return;
  
  try {
    const techniciansRef = collection(db, TECHNICIANS_COLLECTION);
    // Single-field filter only (composite index not required); sorted in memory below.
    const q = query(techniciansRef, where('active', '==', true));
    
    // Set up real-time listener
    unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
      techniciansCache = [];
      snapshot.forEach(doc => {
        techniciansCache.push({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate?.() || null,
        });
      });
      sortCache();
      notifyListeners();
    }, (error) => {
      console.error('[Technicians] Real-time listener error:', error);
      // Fallback: try to fetch once
      fetchTechniciansOnce();
    });
    
    // Also do an initial fetch to populate cache immediately
    await fetchTechniciansOnce();
    
    isInitialized = true;
    console.log('[Technicians] Service initialized with real-time sync');
  } catch (error) {
    console.error('[Technicians] Failed to initialize:', error);
    // Try fallback fetch
    await fetchTechniciansOnce();
    isInitialized = true;
  }
}

/**
 * One-time fetch of technicians (fallback or initial load)
 * @returns {Promise<void>}
 */
async function fetchTechniciansOnce() {
  try {
    const techniciansRef = collection(db, TECHNICIANS_COLLECTION);
    const q = query(techniciansRef, where('active', '==', true));
    const snapshot = await getDocs(q);
    
    techniciansCache = [];
    snapshot.forEach(doc => {
      techniciansCache.push({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || null,
      });
    });
    sortCache();
    
    notifyListeners();
  } catch (error) {
    console.error('[Technicians] Fetch failed:', error);
  }
}

/**
 * Cleanup - call on app shutdown
 */
export function cleanup() {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }
  listeners.clear();
  techniciansCache = [];
  isInitialized = false;
}

/**
 * NOTE: Admin functions (addTechnician, deactivateTechnician) have been REMOVED.
 * This module is now READ-ONLY: it only fetches and caches technicians from Firestore.
 * Database structure/collection management must be done via Firebase Console or admin SDKs,
 * NOT from the client application.
 */