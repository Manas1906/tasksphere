/**
 * TaskSphere Background Service Worker - W3C Web Push Protocol
 * Listens for background notifications even when the dashboard tab is completely closed.
 */

self.addEventListener('install', function(event) {
  console.log('[Service Worker] Installed.');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[Service Worker] Activated.');
  event.waitUntil(clients.claim());
});

/**
 * Push event listener - triggers when Spring Boot pushes encrypted ECE payload
 */
self.addEventListener('push', function(event) {
  console.log('[Service Worker] Received push event.');
  
  let payload = {
    title: 'TaskSphere Update',
    body: 'You have a new background update.',
    url: '/'
  };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      // In case payload was sent as plain text
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: '/favicon.svg', // Fallback to root or custom logo asset
    badge: '/favicon.svg',
    vibrate: [100, 50, 100],
    data: {
      url: payload.url || '/'
    },
    actions: [
      { action: 'open', title: 'Open TaskSphere' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

/**
 * Click notification event listener - redirects user to target action url
 */
self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Notification clicked.');
  event.notification.close();

  const targetUrl = event.notification.data.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // If a tab is already open, focus it and redirect
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          return client.focus();
        }
      }
      
      // If no tab open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
