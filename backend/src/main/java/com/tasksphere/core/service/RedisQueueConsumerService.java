package com.tasksphere.core.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tasksphere.core.model.RedisEvents.AiBotEvent;
import com.tasksphere.core.model.RedisEvents.EmailEvent;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

/**
 * RedisQueueConsumerService - Background Daemon listener popping events from Redis lists.
 * Ensures real-time event-driven execution with full fault tolerance and graceful shutdowns.
 */
@Service
public class RedisQueueConsumerService implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(RedisQueueConsumerService.class);

    @Autowired(required = false)
    private StringRedisTemplate redisTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private EmailService emailService;

    @Autowired
    private AiBotService aiBotService;

    private volatile boolean running = true;

    @Override
    public void run(String... args) throws Exception {
        if (redisTemplate == null) {
            log.warn("[REDIS-CONSUMER-WARNING] StringRedisTemplate not initialized. Running in Offline Caching mode. Background queue consumers disabled.");
            return;
        }

        log.info("[REDIS-CONSUMER] Initializing Event Queue background listeners...");

        // Spawn Email Queue Daemon Thread
        Thread emailThread = new Thread(this::consumeEmails, "Redis-Email-Consumer");
        emailThread.setDaemon(true);
        emailThread.start();

        // Spawn AI Bot Queue Daemon Thread
        Thread aiThread = new Thread(this::consumeAiRequests, "Redis-AI-Consumer");
        aiThread.setDaemon(true);
        aiThread.start();
    }

    private void consumeEmails() {
        log.info("[REDIS-CONSUMER] Email Queue listener online. Monitoring list 'queue:email'...");
        while (running) {
            try {
                String payload = redisTemplate.opsForList().rightPop(RedisQueueService.EMAIL_QUEUE, 2, TimeUnit.SECONDS);
                if (payload != null && !payload.trim().isEmpty()) {
                    EmailEvent event = objectMapper.readValue(payload, EmailEvent.class);
                    log.info("[REDIS-CONSUMER] Dequeued EmailEvent ({}) for {}. Processing dispatch...", event.getType(), event.getToEmail());
                    emailService.executeDirectEmailDispatch(event.getType(), event.getToEmail(), event.getSubject(), event.getHtmlContent());
                }
            } catch (Exception ex) {
                if (running) {
                    log.error("[REDIS-CONSUMER-ERROR] Email queue listener encountered exception: {}", ex.getMessage());
                } else {
                    log.info("[REDIS-CONSUMER] Email queue listener shutting down gracefully.");
                }
                try { 
                    TimeUnit.MILLISECONDS.sleep(500); 
                } catch (InterruptedException ie) { 
                    Thread.currentThread().interrupt(); 
                }
            }
        }
    }

    private void consumeAiRequests() {
        log.info("[REDIS-CONSUMER] AI Bot Queue listener online. Monitoring list 'queue:ai'...");
        while (running) {
            try {
                String payload = redisTemplate.opsForList().rightPop(RedisQueueService.AI_QUEUE, 2, TimeUnit.SECONDS);
                if (payload != null && !payload.trim().isEmpty()) {
                    AiBotEvent event = objectMapper.readValue(payload, AiBotEvent.class);
                    log.info("[REDIS-CONSUMER] Dequeued AiBotEvent from {}. Invoking Gemini orchestrator...", event.getUsername());
                    aiBotService.processAiRequest(event.getUsername(), event.getAvatarUrl(), event.getMessage(), event.isDm());
                }
            } catch (Exception ex) {
                if (running) {
                    log.error("[REDIS-CONSUMER-ERROR] AI bot queue listener encountered exception: {}", ex.getMessage());
                } else {
                    log.info("[REDIS-CONSUMER] AI bot queue listener shutting down gracefully.");
                }
                try { 
                    TimeUnit.MILLISECONDS.sleep(500); 
                } catch (InterruptedException ie) { 
                    Thread.currentThread().interrupt(); 
                }
            }
        }
    }

    public void stopConsumers() {
        this.running = false;
        log.info("[REDIS-CONSUMER] Event Queue listeners stopping...");
    }

    @PreDestroy
    public void onDestroy() {
        stopConsumers();
    }
}
