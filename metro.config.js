// Modified for Godbot. See NOTICE.
const { getDefaultConfig } = require('expo/metro-config')

// The code shared with Godbot is copied into godbot/ (scripts/sync-godbot.mjs), inside the
// project, so Metro needs no extra watch folders.
module.exports = getDefaultConfig(__dirname)
