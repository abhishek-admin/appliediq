/**
 * uuid.js — UUID v4 generator
 * Self-contained, no external dependencies.
 * Works in service workers, content scripts, and extension pages.
 */

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Export for module contexts (options/popup pages)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateUUID };
}
