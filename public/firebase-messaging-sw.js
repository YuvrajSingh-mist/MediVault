/* eslint-disable no-undef */
/**
 * MediVault service worker - Firebase Cloud Messaging (web push).
 *
 * Firebase Hosting automatically serves the project's web config at the
 * reserved URL /__/firebase/init.json, so no keys are hard-coded here. On a
 * non-Hosting origin the fetch fails harmlessly and the raw `push` handler
 * below still displays a notification.
 */

importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

var messagingReady = false

fetch('/__/firebase/init.json')
  .then(function (response) {
    if (!response.ok) throw new Error('Firebase config not available')
    return response.json()
  })
  .then(function (config) {
    var app = firebase.initializeApp(config)
    var messaging = firebase.messaging(app)
    messagingReady = true

    messaging.onBackgroundMessage(function (payload) {
      var notification = payload.notification || {}
      var data = payload.data || {}
      var title = notification.title || 'MediVault reminder'
      var options = {
        body: notification.body || 'You have a new reminder.',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: data.tag || 'medivault',
        data: { link: data.link || '/' },
      }
      self.registration.showNotification(title, options)
    })
  })
  .catch(function () {
    /* Not running on Firebase Hosting - fall back to the raw push handler. */
  })

self.addEventListener('push', function (event) {
  if (messagingReady) return
  var payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (err) {
    payload = {}
  }
  var notification = payload.notification || {}
  var data = payload.data || {}
  event.waitUntil(
    self.registration.showNotification(notification.title || 'MediVault', {
      body: notification.body || 'You have a new reminder.',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { link: data.link || '/' },
    }),
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var link = (event.notification.data && event.notification.data.link) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i += 1) {
        var client = clients[i]
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(link)
          return client.focus()
        }
      }
      return self.clients.openWindow(link)
    }),
  )
})
