// Firebase Cloud Messaging is optional: the app gets an FCM token, and with it end-to-end
// encrypted push from Godbot, only when the build has a google-services.json. Point
// GODBOT_GOOGLE_SERVICES_JSON at the file from your Firebase project. Without it the app
// builds with no Firebase configuration, and the computer simply cannot push to it.
const { existsSync } = require('node:fs')
const { resolve } = require('node:path')

function googleServicesFile(env = process.env) {
  const file = (env.GODBOT_GOOGLE_SERVICES_JSON ?? '').trim()
  if (file === '') return null
  const path = resolve(file)
  if (!existsSync(path)) throw new Error(`GODBOT_GOOGLE_SERVICES_JSON names ${path}, which does not exist`)
  return path
}

function withGodbotFcm(config) {
  const path = googleServicesFile()
  if (path === null) return config
  return { ...config, android: { ...config.android, googleServicesFile: path } }
}

module.exports = withGodbotFcm
module.exports.googleServicesFile = googleServicesFile
