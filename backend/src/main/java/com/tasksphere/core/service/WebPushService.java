package com.tasksphere.core.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.apache.http.HttpResponse;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.security.Security;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class WebPushService {

    @Value("${vapid.public.key}")
    private String publicKey;

    @Value("${vapid.private.key}")
    private String privateKey;

    @Value("${vapid.subject}")
    private String subject;

    @Autowired(required = false)
    private StringRedisTemplate redisTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    private PushService pushService;
    private boolean isRedisOffline = false;

    // Thread-safe in-memory fallback for local dev when Redis is inactive
    private final ConcurrentHashMap<String, String> fallbackSubscriptions = new ConcurrentHashMap<>();

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class WebPushSubscription {
        private String endpoint;
        private Keys keys;

        @Data
        @NoArgsConstructor
        @AllArgsConstructor
        public static class Keys {
            private String p256dh;
            private String auth;
        }


    }

    @PostConstruct
    public void init() {
        System.out.println("[WEBPUSH-INIT] Registering BouncyCastle security provider...");
        try {
            if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
                Security.addProvider(new BouncyCastleProvider());
            }

            pushService = new PushService(publicKey, privateKey, subject);
            System.out.println("[WEBPUSH-INIT] PushService successfully configured with VAPID credentials.");
        } catch (Exception e) {
            System.err.println("[WEBPUSH-INIT-ERROR] Failed to configure PushService: " + e.getMessage());
        }

        // Test Redis availability for subscription storage
        if (redisTemplate == null) {
            System.out.println("[WEBPUSH-REDIS-WARNING] Redis template not initialized. Using local memory subscription storage.");
            isRedisOffline = true;
        } else {
            try {
                Objects.requireNonNull(redisTemplate.getConnectionFactory()).getConnection().ping();
                System.out.println("[WEBPUSH-REDIS] Connected to Redis subscription broker successfully!");
            } catch (Exception e) {
                System.out.println("[WEBPUSH-REDIS-WARNING] Redis connection failed: " + e.getMessage() + ". Defaulting to local memory subscription fallback.");
                isRedisOffline = true;
            }
        }
    }

    /**
     * Registers or updates a user's browser push subscription.
     */
    public void subscribe(String username, WebPushSubscription subscription) {
        if (username == null || subscription == null) return;

        try {
            String serialized = objectMapper.writeValueAsString(subscription);
            String redisKey = "webpush:subscription:" + username.trim();

            if (!isRedisOffline) {
                try {
                    redisTemplate.opsForValue().set(redisKey, serialized);
                    System.out.println("[WEBPUSH-SUBSCRIBE] Registered subscription for '" + username + "' in Redis.");
                    return;
                } catch (Exception e) {
                    System.err.println("[WEBPUSH-REDIS-ERROR] Failed to save subscription to Redis. Diverting to local fallback: " + e.getMessage());
                    isRedisOffline = true;
                }
            }

            fallbackSubscriptions.put(username.trim(), serialized);
            System.out.println("[WEBPUSH-SUBSCRIBE] Registered subscription for '" + username + "' in local memory.");
        } catch (Exception e) {
            System.err.println("[WEBPUSH-SUBSCRIBE-ERROR] Failed to serialize subscription payload: " + e.getMessage());
        }
    }

    /**
     * Unregisters a user's browser push subscription.
     */
    public void unsubscribe(String username) {
        if (username == null) return;

        String redisKey = "webpush:subscription:" + username.trim();
        if (!isRedisOffline) {
            try {
                redisTemplate.delete(redisKey);
                System.out.println("[WEBPUSH-UNSUBSCRIBE] Removed subscription for '" + username + "' from Redis.");
                return;
            } catch (Exception e) {
                System.err.println("[WEBPUSH-REDIS-ERROR] Failed to delete subscription from Redis: " + e.getMessage());
                isRedisOffline = true;
            }
        }

        fallbackSubscriptions.remove(username.trim());
        System.out.println("[WEBPUSH-UNSUBSCRIBE] Removed subscription for '" + username + "' from local memory.");
    }

    /**
     * Fetches a user's active push subscription.
     */
    public WebPushSubscription getSubscription(String username) {
        if (username == null) return null;

        String redisKey = "webpush:subscription:" + username.trim();
        String rawJson = null;

        if (!isRedisOffline) {
            try {
                rawJson = redisTemplate.opsForValue().get(redisKey);
            } catch (Exception e) {
                System.err.println("[WEBPUSH-REDIS-ERROR] Failed to read subscription from Redis. Querying local fallback: " + e.getMessage());
                isRedisOffline = true;
            }
        }

        if (rawJson == null) {
            rawJson = fallbackSubscriptions.get(username.trim());
        }

        if (rawJson == null) {
            return null; // No subscription registered
        }

        try {
            return objectMapper.readValue(rawJson, WebPushSubscription.class);
        } catch (Exception e) {
            System.err.println("[WEBPUSH-FETCH-ERROR] Failed to deserialize subscription payload: " + e.getMessage());
            return null;
        }
    }

    /**
     * Dispatches an encrypted web push notification asynchronously.
     */
    @Async
    public void sendNotification(String username, String title, String body, String actionUrl) {
        WebPushSubscription subscription = getSubscription(username);
        if (subscription == null) {
            // Silence if user has not registered push subscription
            return;
        }

        System.out.println("[WEBPUSH-DISPATCH] Dispatching background push notification to user '" + username + "'...");

        try {
            // Build raw JSON payload expected by the service worker
            ObjectMapper payloadMapper = new ObjectMapper();
            var payloadNode = payloadMapper.createObjectNode();
            payloadNode.put("title", title);
            payloadNode.put("body", body);
            payloadNode.put("url", actionUrl != null ? actionUrl : "/");

            String payloadJson = payloadMapper.writeValueAsString(payloadNode);

            // Construct standard W3C encrypted push envelope
            Notification notification = new Notification(
                subscription.getEndpoint(),
                subscription.getKeys().getP256dh(),
                subscription.getKeys().getAuth(),
                payloadJson.getBytes(StandardCharsets.UTF_8)
            );

            HttpResponse response = pushService.send(notification);
            int statusCode = response.getStatusLine().getStatusCode();

            if (statusCode == 201) {
                System.out.println("[WEBPUSH-SUCCESS] Background notification successfully delivered to '" + username + "'.");
            } else if (statusCode == 410 || statusCode == 404) {
                // Subscription has expired or was revoked by browser
                System.out.println("[WEBPUSH-EXPIRED] Subscription for '" + username + "' is stale (Status: " + statusCode + "). Purging entry.");
                unsubscribe(username);
            } else {
                System.err.println("[WEBPUSH-WARNING] Push service responded with unexpected status code: " + statusCode);
            }
        } catch (Exception e) {
            System.err.println("[WEBPUSH-DISPATCH-ERROR] Failed to encrypt/send push notification to '" + username + "': " + e.getMessage());
        }
    }
}
