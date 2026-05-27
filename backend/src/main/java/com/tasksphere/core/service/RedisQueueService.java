package com.tasksphere.core.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tasksphere.core.model.RedisEvents.AiBotEvent;
import com.tasksphere.core.model.RedisEvents.EmailEvent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.atomic.AtomicLong;

/**
 * RedisQueueService - Enqueues email and AI chatbot commands asynchronously onto Redis Lists.
 * Acts as the event producer for the TaskSphere decoupled architectures.
 */
@Service
public class RedisQueueService {

    private static final Logger log = LoggerFactory.getLogger(RedisQueueService.class);

    public static final String EMAIL_QUEUE = "queue:email";
    public static final String AI_QUEUE = "queue:ai";

    @Autowired(required = false)
    private StringRedisTemplate redisTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    // Local diagnostic tracking counters for CTO showcase
    private final AtomicLong emailEnqueuedCount = new AtomicLong(0);
    private final AtomicLong aiEnqueuedCount = new AtomicLong(0);

    /**
     * Enqueue a transactional email task onto Redis.
     * Returns true if successfully enqueued, false if Redis is offline (triggers direct fallback).
     */
    public boolean enqueueEmail(String type, String toEmail, String subject, String htmlContent) {
        EmailEvent event = EmailEvent.builder()
                .type(type)
                .toEmail(toEmail)
                .subject(subject)
                .htmlContent(htmlContent)
                .build();

        try {
            if (redisTemplate != null && Boolean.TRUE.equals(redisTemplate.hasKey("presence:Agile_AI_Bot") || true)) {
                String payload = objectMapper.writeValueAsString(event);
                redisTemplate.opsForList().leftPush(EMAIL_QUEUE, payload);
                emailEnqueuedCount.incrementAndGet();
                log.info("[REDIS-PRODUCER] Enqueued EmailEvent ({}) for {} successfully.", type, toEmail);
                return true;
            }
        } catch (Exception ex) {
            log.error("[REDIS-PRODUCER-WARNING] Redis is unavailable to enqueue EmailEvent. Triggering instant direct execution: {}", ex.getMessage());
        }
        return false;
    }

    /**
     * Enqueue an AI Agile Scrum Coach command onto Redis.
     * Returns true if successfully enqueued, false if Redis is offline (triggers direct fallback).
     */
    public boolean enqueueAiRequest(String username, String avatarUrl, String message, boolean isDm) {
        AiBotEvent event = AiBotEvent.builder()
                .username(username)
                .avatarUrl(avatarUrl)
                .message(message)
                .isDm(isDm)
                .build();

        try {
            if (redisTemplate != null) {
                String payload = objectMapper.writeValueAsString(event);
                redisTemplate.opsForList().leftPush(AI_QUEUE, payload);
                aiEnqueuedCount.incrementAndGet();
                log.info("[REDIS-PRODUCER] Enqueued AiBotEvent from {} successfully.", username);
                return true;
            }
        } catch (Exception ex) {
            log.error("[REDIS-PRODUCER-WARNING] Redis is unavailable to enqueue AiBotEvent. Triggering instant direct execution: {}", ex.getMessage());
        }
        return false;
    }

    /**
     * Diagnostic stats for the CTO showcase gauges.
     */
    public long getQueueSize(String queueName) {
        try {
            if (redisTemplate != null) {
                Long size = redisTemplate.opsForList().size(queueName);
                return size != null ? size : 0;
            }
        } catch (Exception e) {
            // Ignore offline
        }
        return 0;
    }

    public long getEmailEnqueuedCount() {
        return emailEnqueuedCount.get();
    }

    public long getAiEnqueuedCount() {
        return aiEnqueuedCount.get();
    }
}
