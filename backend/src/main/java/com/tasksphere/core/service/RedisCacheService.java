package com.tasksphere.core.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tasksphere.core.model.ChatMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RedisCacheService {

    @Autowired(required = false)
    private StringRedisTemplate redisTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    private boolean isRedisOffline = false;

    // Thread-safe in-memory fallback cache containers
    private final ConcurrentHashMap<String, Instant> fallbackPresence = new ConcurrentHashMap<>();
    private final List<ChatMessage> fallbackChatHistory = Collections.synchronizedList(new ArrayList<>());

    @PostConstruct
    public void testConnection() {
        if (redisTemplate == null) {
            System.out.println("[REDIS-CACHE-WARNING] StringRedisTemplate not initialized. Running in Offline Caching Fallback mode.");
            isRedisOffline = true;
            return;
        }

        try {
            // Test connection factory connectivity
            Objects.requireNonNull(redisTemplate.getConnectionFactory()).getConnection().ping();
            System.out.println("[REDIS-CACHE] Connected to serverless Redis broker successfully. Active caching enabled!");
        } catch (Exception e) {
            System.out.println("[REDIS-CACHE-WARNING] Redis connection failed: " + e.getMessage() + ". Gracefully falling back to thread-safe in-memory cache.");
            isRedisOffline = true;
        }
    }

    public void cachePresence(String username) {
        if (username == null || username.trim().isEmpty()) return;

        if (!isRedisOffline) {
            try {
                redisTemplate.opsForValue().set("presence:" + username.trim(), "ONLINE", Duration.ofSeconds(30));
                return;
            } catch (Exception e) {
                System.err.println("[REDIS-PRESENCE-ERROR] Failed to save to Redis. Diverting to local fallback: " + e.getMessage());
                isRedisOffline = true;
            }
        }

        // Local fallback
        fallbackPresence.put(username.trim(), Instant.now());
    }

    public boolean isUserOnline(String username) {
        if (username == null || username.trim().isEmpty()) return false;

        if (!isRedisOffline) {
            try {
                return Boolean.TRUE.equals(redisTemplate.hasKey("presence:" + username.trim()));
            } catch (Exception e) {
                System.err.println("[REDIS-PRESENCE-ERROR] Failed to read from Redis. Querying local fallback: " + e.getMessage());
                isRedisOffline = true;
            }
        }

        // Local fallback
        Instant lastActive = fallbackPresence.get(username.trim());
        return lastActive != null && Instant.now().isBefore(lastActive.plusSeconds(30));
    }

    public void cacheChatMessage(ChatMessage message) {
        if (message == null) return;

        if (!isRedisOffline) {
            try {
                String serialized = objectMapper.writeValueAsString(message);
                redisTemplate.opsForList().rightPush("chat:history", serialized); // push to tail
                redisTemplate.opsForList().trim("chat:history", -50, -1); // keep last 50
                return;
            } catch (Exception e) {
                System.err.println("[REDIS-CHAT-ERROR] Failed to save message to Redis. Diverting to local fallback: " + e.getMessage());
                isRedisOffline = true;
            }
        }

        // Local fallback
        synchronized (fallbackChatHistory) {
            fallbackChatHistory.add(message);
            while (fallbackChatHistory.size() > 50) {
                fallbackChatHistory.remove(0); // remove oldest from head
            }
        }
    }

    public List<ChatMessage> getCachedChatHistory() {
        if (!isRedisOffline) {
            try {
                List<String> list = redisTemplate.opsForList().range("chat:history", 0, -1);
                if (list == null || list.isEmpty()) {
                    return null; // cache-miss
                }
                
                List<ChatMessage> deserialized = new ArrayList<>();
                for (String rawJson : list) {
                    deserialized.add(objectMapper.readValue(rawJson, ChatMessage.class));
                }
                return deserialized;
            } catch (Exception e) {
                System.err.println("[REDIS-CHAT-ERROR] Failed to fetch message history from Redis. Diverting to local fallback: " + e.getMessage());
                isRedisOffline = true;
            }
        }

        // Local fallback
        synchronized (fallbackChatHistory) {
            if (fallbackChatHistory.isEmpty()) {
                return null; // cache-miss
            }
            return new ArrayList<>(fallbackChatHistory);
        }
    }

    public void invalidateChatHistory() {
        if (!isRedisOffline) {
            try {
                redisTemplate.delete("chat:history");
            } catch (Exception e) {
                System.err.println("[REDIS-CHAT-ERROR] Failed to invalidate Redis cache: " + e.getMessage());
                isRedisOffline = true;
            }
        }
        
        fallbackChatHistory.clear();
    }
}
