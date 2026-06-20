package com.tasksphere.core.controller;

import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.model.WorkspaceUpgradeSession;
import com.tasksphere.core.model.UserPledge;
import com.tasksphere.core.model.PaymentTransactionAudit;
import com.tasksphere.core.repository.UserSessionRepository;
import com.tasksphere.core.repository.WorkspaceUpgradeSessionRepository;
import com.tasksphere.core.repository.UserPledgeRepository;
import com.tasksphere.core.repository.PaymentTransactionAuditRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/payments")
public class PaymentController {

    @Autowired
    private WorkspaceUpgradeSessionRepository sessionRepository;

    @Autowired
    private UserPledgeRepository pledgeRepository;

    @Autowired
    private PaymentTransactionAuditRepository auditRepository;

    @Autowired
    private UserSessionRepository userRepository;

    @Autowired(required = false)
    private StringRedisTemplate redisTemplate;

    @Autowired
    private com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    // Secret key for webhook validation
    private static final String WEBHOOK_SECRET = "tasksphere_secure_webhook_secret_key_2026_xyz";
    private static final long MAX_TIME_DRIFT_SECONDS = 300;

    // Thread-safe in-memory fallbacks when Redis is offline
    private static final ConcurrentHashMap<String, String> idempotencyFallbackMap = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, String> processedWebhooksMap = new ConcurrentHashMap<>();

    /**
     * Retrieves the current active co-funding session.
     * Creates one if not present to ensure standard dev environment operates out-of-the-box.
     */
    @GetMapping("/co-fund/active")
    public ResponseEntity<?> getActiveSession() {
        WorkspaceUpgradeSession session = sessionRepository
                .findFirstByStatusOrderByCreatedAtDesc("ACTIVE")
                .orElseGet(() -> {
                    WorkspaceUpgradeSession newSession = WorkspaceUpgradeSession.builder()
                            .workspaceName("Workspace Alpha")
                            .targetPledges(5)
                            .pledgesCount(0)
                            .status("ACTIVE")
                            .expiryTime(Instant.now().plus(Duration.ofDays(1)))
                            .createdAt(Instant.now())
                            .build();
                    return sessionRepository.save(newSession);
                });

        List<UserPledge> pledges = pledgeRepository.findBySessionId(session.getId());

        Map<String, Object> response = new HashMap<>();
        response.put("session", session);
        response.put("pledges", pledges);
        return ResponseEntity.ok(response);
    }

    /**
     * Resets the co-funding session back to clean status.
     */
    @PostMapping("/co-fund/reset")
    public ResponseEntity<?> resetSession() {
        // Void any existing active/success sessions
        List<WorkspaceUpgradeSession> activeSessions = sessionRepository.findByStatus("ACTIVE");
        for (WorkspaceUpgradeSession s : activeSessions) {
            s.setStatus("VOIDED");
            sessionRepository.save(s);
            List<UserPledge> pledges = pledgeRepository.findBySessionId(s.getId());
            for (UserPledge p : pledges) {
                p.setStatus("VOIDED");
                pledgeRepository.save(p);
            }
        }
        
        List<WorkspaceUpgradeSession> successSessions = sessionRepository.findByStatus("SUCCESS");
        for (WorkspaceUpgradeSession s : successSessions) {
            s.setStatus("VOIDED");
            sessionRepository.save(s);
            List<UserPledge> pledges = pledgeRepository.findBySessionId(s.getId());
            for (UserPledge p : pledges) {
                p.setStatus("VOIDED");
                pledgeRepository.save(p);
            }
        }

        // Create a brand new clean active session
        WorkspaceUpgradeSession newSession = WorkspaceUpgradeSession.builder()
                .workspaceName("Workspace Alpha")
                .targetPledges(5)
                .pledgesCount(0)
                .status("ACTIVE")
                .expiryTime(Instant.now().plus(Duration.ofDays(1)))
                .createdAt(Instant.now())
                .build();
        sessionRepository.save(newSession);

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("session", newSession);
        return ResponseEntity.ok(response);
    }

    /**
     * Initializes a pledge order.
     * Enforces API idempotency using the Idempotency-Key header.
     */
    @PostMapping("/co-fund/order")
    public ResponseEntity<?> createPledgeOrder(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody Map<String, Object> payload) {

        if (idempotencyKey == null || idempotencyKey.trim().isEmpty()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Collections.singletonMap("error", "Idempotency-Key header is required."));
        }

        String username = (String) payload.get("username");
        String paymentMethod = (String) payload.get("paymentMethod");
        if (username == null || paymentMethod == null) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Collections.singletonMap("error", "Missing username or paymentMethod in body."));
        }

        String redisLockKey = "idempotency:pledge:" + idempotencyKey;

        // Verify key status in Redis or in-memory map
        String cachedResponse = getCache(redisLockKey);
        if (cachedResponse != null) {
            if ("PROCESSING".equals(cachedResponse)) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                        .body(Collections.singletonMap("error", "A duplicate pledge is currently in progress."));
            }
            return ResponseEntity.ok(Collections.singletonMap("cachedOrderId", cachedResponse));
        }

        setCache(redisLockKey, "PROCESSING", 60);

        try {
            WorkspaceUpgradeSession session = sessionRepository
                    .findFirstByStatusOrderByCreatedAtDesc("ACTIVE")
                    .orElseThrow(() -> new IllegalStateException("No active co-funding session exists."));

            // Check if user already pledged in this active session
            Optional<UserPledge> existingPledge = pledgeRepository.findBySessionIdAndUsername(session.getId(), username);
            if (existingPledge.isPresent()) {
                deleteCache(redisLockKey);
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                        .body(Collections.singletonMap("error", "You have already pledged in this active session."));
            }

            // Create gateway representation
            String mockOrderId = "order_mock_" + UUID.randomUUID().toString().substring(0, 8);

            UserPledge pledge = UserPledge.builder()
                    .sessionId(session.getId())
                    .username(username)
                    .orderId(mockOrderId)
                    .preAuthAmount(new BigDecimal("999.00")) // Base max price held
                    .paymentMethod(paymentMethod.toUpperCase())
                    .status("PENDING")
                    .createdAt(Instant.now())
                    .build();

            pledgeRepository.save(pledge);

            setCache(redisLockKey, mockOrderId, 86400); // cache for 24h

            Map<String, Object> response = new HashMap<>();
            response.put("orderId", mockOrderId);
            response.put("amount", 999.00);
            response.put("sessionId", session.getId());
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            deleteCache(redisLockKey);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Collections.singletonMap("error", "Failed to create order: " + e.getMessage()));
        }
    }

    /**
     * Authoritative endpoint for gateway webhooks.
     * Validates HMAC-SHA256 signature, prevents replay attacks, checks deduplication.
     */
    @PostMapping("/webhook")
    public ResponseEntity<?> handleWebhook(
            @RequestHeader(value = "X-Razorpay-Signature", required = false) String signatureHeader,
            @RequestHeader(value = "X-Razorpay-Event-Id", required = false) String eventId,
            @RequestHeader(value = "X-Razorpay-Timestamp", required = false) String timestampHeader,
            @RequestBody String rawPayload) {

        if (signatureHeader == null || rawPayload == null || timestampHeader == null) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body("Missing secure verification headers.");
        }

        // 1. Replay attack validation: Validate timestamp drift
        try {
            long receivedTime = Long.parseLong(timestampHeader);
            long currentTime = Instant.now().getEpochSecond();
            if (Math.abs(currentTime - receivedTime) > MAX_TIME_DRIFT_SECONDS) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                        .body("Webhook rejected: Timestamp drift exceeds limit (replay warning).");
            }
        } catch (NumberFormatException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("Invalid timestamp header format.");
        }

        // 2. Cryptographic signature check
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKey = new SecretKeySpec(WEBHOOK_SECRET.getBytes("UTF-8"), "HmacSHA256");
            mac.init(secretKey);

            // Razorpay standard payload: Timestamp + "." + Raw Body
            String signaturePayload = timestampHeader + "." + rawPayload;
            byte[] calculatedHash = mac.doFinal(signaturePayload.getBytes("UTF-8"));

            StringBuilder hexString = new StringBuilder();
            for (byte b : calculatedHash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            String calculatedSignature = hexString.toString();

            // Constant-time validation to block side-channel attacks
            boolean signatureValid = MessageDigest.isEqual(
                    calculatedSignature.getBytes("UTF-8"),
                    signatureHeader.getBytes("UTF-8")
            );

            if (!signatureValid) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Cryptographic signature check failed.");
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Crypto initialization failure.");
        }

        // 3. Webhook event deduplication check
        if (eventId != null) {
            String deduplicationKey = "webhook:processed:" + eventId;
            if (getCache(deduplicationKey) != null) {
                return ResponseEntity.ok("Duplicate event acknowledged.");
            }
            setCache(deduplicationKey, "PROCESSED", 172800); // 48h deduplication
        }

        // Process webhook body
        try {
            // Parse standard payload format using Jackson ObjectMapper
            @SuppressWarnings("unchecked")
            Map<String, Object> payloadMap = objectMapper.readValue(rawPayload, Map.class);
            String event = (String) payloadMap.get("event");
            
            @SuppressWarnings("unchecked")
            Map<String, Object> data = (Map<String, Object>) payloadMap.get("data");
            String orderId = (String) data.get("order_id");
            String paymentId = data.containsKey("payment_id") && data.get("payment_id") != null
                    ? (String) data.get("payment_id")
                    : "pay_mock_" + UUID.randomUUID().toString().substring(0, 6);

            Optional<UserPledge> pledgeOpt = pledgeRepository.findByOrderId(orderId);
            if (pledgeOpt.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Pledge Order " + orderId + " not found.");
            }

            UserPledge pledge = pledgeOpt.get();

            // Log ledger audit
            PaymentTransactionAudit audit = PaymentTransactionAudit.builder()
                    .orderId(orderId)
                    .paymentId(paymentId)
                    .paymentMethod(pledge.getPaymentMethod())
                    .amount(pledge.getPreAuthAmount())
                    .status(event.replace("payment.", "").toUpperCase())
                    .gatewayRef(eventId)
                    .signature(signatureHeader)
                    .timestamp(Instant.now())
                    .build();
            auditRepository.save(audit);

            if ("payment.authorized".equals(event)) {
                pledge.setStatus("AUTHORIZED");
                pledge.setPaymentId(paymentId);
                pledgeRepository.save(pledge);

                // Update active co-funding session count
                Optional<WorkspaceUpgradeSession> sessionOpt = sessionRepository.findById(pledge.getSessionId());
                if (sessionOpt.isPresent() && "ACTIVE".equals(sessionOpt.get().getStatus())) {
                    WorkspaceUpgradeSession session = sessionOpt.get();
                    List<UserPledge> activePledges = pledgeRepository.findBySessionId(session.getId());
                    
                    int authorizedCount = (int) activePledges.stream()
                            .filter(p -> "AUTHORIZED".equals(p.getStatus()))
                            .count();
                    
                    session.setPledgesCount(authorizedCount);
                    sessionRepository.save(session);

                    // Check if milestone achieved
                    if (authorizedCount >= session.getTargetPledges()) {
                        session.setStatus("SUCCESS");
                        sessionRepository.save(session);

                        // Trigger dynamic exponential calculation and execute CAPTURE logic
                        BigDecimal finalUnitRate = calculateDiscount(authorizedCount);

                        List<UserPledge> pledgesToCapture = pledgeRepository.findBySessionId(session.getId());
                        for (UserPledge p : pledgesToCapture) {
                            if ("AUTHORIZED".equals(p.getStatus())) {
                                p.setStatus("CAPTURED");
                                p.setFinalCapturedAmount(finalUnitRate);
                                pledgeRepository.save(p);

                                // Auto unlock premium assets for co-funding participants
                                Optional<UserSession> userOpt = userRepository.findByUsername(p.getUsername());
                                if (userOpt.isPresent()) {
                                    UserSession user = userOpt.get();
                                    
                                    // Unlock wallpapers & sound themes
                                    String wallpapers = user.getUnlockedWallpapers();
                                    if (wallpapers == null || wallpapers.isEmpty()) {
                                        wallpapers = "grid";
                                    }
                                    if (!wallpapers.contains("wallpaper_neon")) {
                                        wallpapers += ",wallpaper_neon,wallpaper_sunset,wallpaper_cosmic";
                                    }
                                    user.setUnlockedWallpapers(wallpapers);

                                    String sounds = user.getUnlockedSounds();
                                    if (sounds == null || sounds.isEmpty()) {
                                        sounds = "minimal";
                                    }
                                    if (!sounds.contains("sound_cyber")) {
                                        sounds += ",sound_cyber,sound_bubble";
                                    }
                                    user.setUnlockedSounds(sounds);
                                    
                                    // Save changes
                                    user.packMetadata(
                                        user.getPureAvatarUrl(),
                                        user.getExtractedEmail(),
                                        user.getPasswordHash(),
                                        user.isMfaEnabled()
                                    );
                                    userRepository.save(user);
                                }
                            }
                        }
                    }
                }
            } else if ("payment.failed".equals(event)) {
                pledge.setStatus("FAILED");
                pledgeRepository.save(pledge);
            }

            return ResponseEntity.ok("Processed successfully.");
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Webhook processing error: " + e.getMessage());
        }
    }

    /**
     * Recruiter Sandbox Tool: Generates signed webhook payloads.
     * Lets recruiters test signature security rules, time-drift protection, or normal triggers.
     */
    @PostMapping("/dev/simulate-webhook")
    public ResponseEntity<?> simulateWebhook(@RequestBody Map<String, Object> config) {
        try {
            String event = (String) config.getOrDefault("event", "payment.authorized");
            String orderId = (String) config.get("orderId");
            String customSecret = (String) config.getOrDefault("webhookSecret", WEBHOOK_SECRET);
            boolean causeTimeDrift = (boolean) config.getOrDefault("causeTimeDrift", false);

            if (orderId == null) {
                return ResponseEntity.badRequest().body(Collections.singletonMap("error", "orderId is required."));
            }

            String eventId = "evt_sim_" + UUID.randomUUID().toString().substring(0, 8);
            
            // Build raw JSON payload using standard maps and ObjectMapper
            Map<String, Object> payload = new HashMap<>();
            payload.put("event", event);
            payload.put("created_at", Instant.now().getEpochSecond());

            Map<String, Object> data = new HashMap<>();
            data.put("order_id", orderId);
            data.put("payment_id", "pay_sim_" + UUID.randomUUID().toString().substring(0, 8));
            payload.put("data", data);

            String rawBody = objectMapper.writeValueAsString(payload);

            // Set timestamp header (normal or 10 minutes offset to trigger replay block)
            long timestamp = Instant.now().getEpochSecond();
            if (causeTimeDrift) {
                timestamp -= 600; // 10 minutes ago
            }
            String timestampHeader = String.valueOf(timestamp);

            // Compute signature using configured key
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKey = new SecretKeySpec(customSecret.getBytes("UTF-8"), "HmacSHA256");
            mac.init(secretKey);

            String signaturePayload = timestampHeader + "." + rawBody;
            byte[] calculatedHash = mac.doFinal(signaturePayload.getBytes("UTF-8"));

            StringBuilder hexString = new StringBuilder();
            for (byte b : calculatedHash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            String calculatedSignature = hexString.toString();

            // Forward directly to local webhook handler
            return handleWebhook(calculatedSignature, eventId, timestampHeader, rawBody);

        } catch (Exception e) {
            return ResponseEntity.status(500).body(Collections.singletonMap("error", e.getMessage()));
        }
    }

    /**
     * Recruiter Sandbox Tool: Populates mock workspace participants.
     * Lets recruiters test the dynamic pricing curve and auto-capture execution in 1 click.
     */
    @PostMapping("/dev/fill-mock-pledges")
    public ResponseEntity<?> fillMockPledges() {
        try {
            WorkspaceUpgradeSession session = sessionRepository
                    .findFirstByStatusOrderByCreatedAtDesc("ACTIVE")
                    .orElseThrow(() -> new IllegalStateException("No active co-funding session. Reset or query first."));

            String[] mockUsers = {"Dev_Alice", "Dev_Bob", "Dev_Charlie", "Dev_David"};

            for (String user : mockUsers) {
                // Ensure they don't have active pledges
                Optional<UserPledge> existingPledge = pledgeRepository.findBySessionIdAndUsername(session.getId(), user);
                if (existingPledge.isPresent()) {
                    continue;
                }

                String mockOrderId = "order_dev_" + UUID.randomUUID().toString().substring(0, 8);
                String mockPaymentId = "pay_dev_" + UUID.randomUUID().toString().substring(0, 8);

                // Add pledge directly as AUTHORIZED
                UserPledge pledge = UserPledge.builder()
                        .sessionId(session.getId())
                        .username(user)
                        .orderId(mockOrderId)
                        .paymentId(mockPaymentId)
                        .preAuthAmount(new BigDecimal("999.00"))
                        .paymentMethod("CARD")
                        .status("AUTHORIZED")
                        .createdAt(Instant.now())
                        .build();

                pledgeRepository.save(pledge);

                // Register users if they don't exist
                if (userRepository.findByUsername(user).isEmpty()) {
                    UserSession mockUser = UserSession.builder()
                            .username(user)
                            .role("DEVELOPER")
                            .status("OFFLINE")
                            .build();
                    mockUser.packMetadata("https://api.dicebear.com/7.x/bottts/svg?seed=" + user, user + "@tasksphere.com", null, false);
                    userRepository.save(mockUser);
                }
            }

            // Trigger session update count
            List<UserPledge> activePledges = pledgeRepository.findBySessionId(session.getId());
            int authorizedCount = (int) activePledges.stream()
                    .filter(p -> "AUTHORIZED".equals(p.getStatus()))
                    .count();

            session.setPledgesCount(authorizedCount);
            sessionRepository.save(session);

            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("message", "Filled 4 mock pledges successfully.");
            response.put("session", session);
            response.put("pledges", activePledges);
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            return ResponseEntity.status(500).body(Collections.singletonMap("error", e.getMessage()));
        }
    }

    /**
     * Calculates the exponential pricing scale:
     * P(N) = P_min + (P_max - P_min) * e^(-lambda * (N - 1))
     */
    private BigDecimal calculateDiscount(int pledges) {
        double maxPrice = 999.00;
        double minPrice = 499.00;
        double lambda = 0.3;
        
        double exponent = -lambda * (pledges - 1);
        double finalPrice = minPrice + (maxPrice - minPrice) * Math.exp(exponent);
        
        return new BigDecimal(finalPrice).setScale(2, BigDecimal.ROUND_HALF_UP);
    }

    // Helper functions for Redis operations with localized fallback maps
    private String getCache(String key) {
        if (redisTemplate != null) {
            try {
                return redisTemplate.opsForValue().get(key);
            } catch (Exception e) {
                // fall through
            }
        }
        return idempotencyFallbackMap.get(key);
    }

    private void setCache(String key, String value, long seconds) {
        if (redisTemplate != null) {
            try {
                redisTemplate.opsForValue().set(key, value, seconds, TimeUnit.SECONDS);
                return;
            } catch (Exception e) {
                // fall through
            }
        }
        idempotencyFallbackMap.put(key, value);
    }

    private void deleteCache(String key) {
        if (redisTemplate != null) {
            try {
                redisTemplate.delete(key);
                return;
            } catch (Exception e) {
                // fall through
            }
        }
        idempotencyFallbackMap.remove(key);
    }
}
