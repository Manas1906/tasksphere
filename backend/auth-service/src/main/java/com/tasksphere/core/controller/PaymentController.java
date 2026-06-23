package com.tasksphere.core.controller;

import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.model.WorkspaceUpgradeSession;
import com.tasksphere.core.model.UserPledge;
import com.tasksphere.core.model.PaymentTransactionAudit;
import com.tasksphere.core.repository.UserSessionRepository;
import com.tasksphere.core.repository.WorkspaceUpgradeSessionRepository;
import com.tasksphere.core.repository.UserPledgeRepository;
import com.tasksphere.core.repository.PaymentTransactionAuditRepository;
import com.tasksphere.core.service.EmailService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/payments")
public class PaymentController {

    private static final Logger log = LoggerFactory.getLogger(PaymentController.class);

    @Value("${razorpay.key.id:rzp_test_mockKeyId123}")
    private String razorpayKeyId;

    @Value("${razorpay.key.secret:mockKeySecret456}")
    private String razorpayKeySecret;

    @Autowired
    private WorkspaceUpgradeSessionRepository sessionRepository;

    @Autowired
    private UserPledgeRepository pledgeRepository;

    @Autowired
    private PaymentTransactionAuditRepository auditRepository;

    @Autowired
    private UserSessionRepository userRepository;

    @Autowired
    private EmailService emailService;

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

        log.info("[PAYMENTS] POST /api/payments/co-fund/order hit with payload: {}", payload);
        if (idempotencyKey == null || idempotencyKey.trim().isEmpty()) {
            log.warn("[PAYMENTS] Rejecting request: Idempotency-Key header is missing.");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Collections.singletonMap("error", "Idempotency-Key header is required."));
        }

        String username = (String) payload.get("username");
        String paymentMethod = (String) payload.get("paymentMethod");
        if (username == null || paymentMethod == null) {
            log.warn("[PAYMENTS] Rejecting request: Missing username or paymentMethod. Username: {}, Method: {}", username, paymentMethod);
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Collections.singletonMap("error", "Missing username or paymentMethod in body."));
        }

        String redisLockKey = "idempotency:pledge:" + idempotencyKey;

        // Verify key status in Redis or in-memory map
        String cachedResponse = getCache(redisLockKey);
        if (cachedResponse != null) {
            if ("PROCESSING".equals(cachedResponse)) {
                log.warn("[PAYMENTS] Conflict: Idempotency key {} is currently processing.", idempotencyKey);
                return ResponseEntity.status(HttpStatus.CONFLICT)
                        .body(Collections.singletonMap("error", "A duplicate pledge is currently in progress."));
            }
            log.info("[PAYMENTS] Idempotency key {} matched cached order ID: {}", idempotencyKey, cachedResponse);
            return ResponseEntity.ok(Collections.singletonMap("cachedOrderId", cachedResponse));
        }

        setCache(redisLockKey, "PROCESSING", 60);

        try {
            WorkspaceUpgradeSession session = sessionRepository
                    .findFirstByStatusOrderByCreatedAtDesc("ACTIVE")
                    .orElseGet(() -> {
                        log.info("[PAYMENTS] No active co-funding session found. Automatically creating one.");
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

            // Parse payment amount from payload (amount in paise, e.g. 49900)
            Object amountObj = payload.get("amount");
            BigDecimal amountInRupees;
            if (amountObj != null) {
                double paise = 0;
                if (amountObj instanceof Number) {
                    paise = ((Number) amountObj).doubleValue();
                } else {
                    paise = Double.parseDouble(amountObj.toString());
                }
                amountInRupees = BigDecimal.valueOf(paise).divide(BigDecimal.valueOf(100));
                log.info("[PAYMENTS] Received amount in paise: {}. Converted to rupees: {}", paise, amountInRupees);
            } else {
                amountInRupees = new BigDecimal("999.00"); // Fallback
                log.info("[PAYMENTS] Missing amount in payload. Using fallback: {} rupees", amountInRupees);
            }

            // Create gateway representation
            String finalOrderId = "order_mock_" + UUID.randomUUID().toString().substring(0, 8);
            boolean isRealGateway = razorpayKeyId != null && !razorpayKeyId.equals("rzp_test_mockKeyId123") && !razorpayKeyId.startsWith("rzp_test_mock");

            log.info("[PAYMENTS] isRealGateway flag resolved to: {}. razorpayKeyId is: {}", isRealGateway, razorpayKeyId);

            if (isRealGateway) {
                try {
                    finalOrderId = createRealRazorpayOrder(amountInRupees);
                    log.info("[PAYMENTS] Real Razorpay Order successfully created with ID: {}", finalOrderId);
                } catch (Exception e) {
                    log.error("[PAYMENTS] Failed to create real Razorpay Order, falling back to mock: {}", e.getMessage(), e);
                }
            }

            UserPledge pledge = UserPledge.builder()
                    .sessionId(session.getId())
                    .username(username)
                    .orderId(finalOrderId)
                    .preAuthAmount(amountInRupees)
                    .paymentMethod(paymentMethod.toUpperCase())
                    .status("PENDING")
                    .createdAt(Instant.now())
                    .build();

            pledgeRepository.save(pledge);
            log.info("[PAYMENTS] Pledge entry saved to DB: {}", pledge);

            setCache(redisLockKey, finalOrderId, 86400); // cache for 24h

            Map<String, Object> response = new HashMap<>();
            response.put("orderId", finalOrderId);
            response.put("amount", amountInRupees);
            response.put("sessionId", session.getId());
            
            log.info("[PAYMENTS] Returning createOrder response: {}", response);
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("[PAYMENTS] Exception in createPledgeOrder: {}", e.getMessage(), e);
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
                            .filter(p -> "AUTHORIZED".equals(p.getStatus()) || "CAPTURED".equals(p.getStatus()))
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
                                        wallpapers += ",wallpaper_neon,wallpaper_sunset,wallpaper_cosmic,chatbox";
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

    /**
     * Retrieve client payment configs dynamically.
     */
    @GetMapping("/config")
    public ResponseEntity<?> getPaymentConfig() {
        log.info("[PAYMENTS] GET /api/payments/config hit.");
        Map<String, String> config = new HashMap<>();
        config.put("razorpayKeyId", razorpayKeyId);
        log.info("[PAYMENTS] Returning key: {}", (razorpayKeyId != null ? (razorpayKeyId.substring(0, Math.min(razorpayKeyId.length(), 12)) + "...") : "null"));
        return ResponseEntity.ok(config);
    }

    /**
     * Cryptographically verifies Razorpay standard payment signature.
     */
    @PostMapping("/verify")
    public ResponseEntity<?> verifyPayment(@RequestBody Map<String, String> payload) {
        log.info("[PAYMENTS] POST /api/payments/verify hit with payload: {}", payload);
        String paymentId = payload.get("razorpay_payment_id");
        String orderId = payload.get("razorpay_order_id");
        String signature = payload.get("razorpay_signature");

        if (paymentId == null) {
            log.warn("[PAYMENTS] Rejecting verification: missing razorpay_payment_id in payload.");
            return ResponseEntity.badRequest().body(Collections.singletonMap("error", "Missing razorpay_payment_id."));
        }

        try {
            boolean isRealGateway = razorpayKeyId != null && !razorpayKeyId.equals("rzp_test_mockKeyId123") && !razorpayKeyId.startsWith("rzp_test_mock");

            // Case A: Full order signature verification
            if (orderId != null && signature != null) {
                Mac mac = Mac.getInstance("HmacSHA256");
                SecretKeySpec secretKey = new SecretKeySpec(razorpayKeySecret.getBytes("UTF-8"), "HmacSHA256");
                mac.init(secretKey);

                String signaturePayload = orderId + "|" + paymentId;
                byte[] calculatedHash = mac.doFinal(signaturePayload.getBytes("UTF-8"));

                StringBuilder hexString = new StringBuilder();
                for (byte b : calculatedHash) {
                    String hex = Integer.toHexString(0xff & b);
                    if (hex.length() == 1) hexString.append('0');
                    hexString.append(hex);
                }
                String calculatedSignature = hexString.toString();

                boolean isValid = MessageDigest.isEqual(
                    calculatedSignature.getBytes("UTF-8"),
                    signature.getBytes("UTF-8")
                );

                log.info("[PAYMENTS] Cryptographic verification complete. isValid: {}", isValid);

                if (!isValid) {
                    log.warn("[PAYMENTS] Signature verification failed! Calculated: {}, Received: {}", calculatedSignature, signature);
                    return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                            .body(Collections.singletonMap("error", "Signature verification failed."));
                }

                log.info("[PAYMENTS] Signature valid. Updating pledge in database for order: {}", orderId);
                
                String username = payload.getOrDefault("username", "MANAS ACHARYA");
                String planId = payload.getOrDefault("planId", "pro_monthly");
                Optional<UserPledge> pledgeOpt = pledgeRepository.findByOrderId(orderId);
                if (pledgeOpt.isPresent()) {
                    UserPledge pledge = pledgeOpt.get();
                    username = pledge.getUsername();
                    planId = pledge.getPaymentMethod();
                }
                
                processPaymentCaptureAndUnlock(paymentId, username, planId, isRealGateway);

                return ResponseEntity.ok(Collections.singletonMap("success", true));
            }
            
            // Case B: Direct payment verification fallback (when order ID / signature are not provided)
            log.info("[PAYMENTS] Missing order ID / signature. Falling back to direct payment details check.");
            
            String username = payload.getOrDefault("username", "MANAS ACHARYA");
            String planId = payload.getOrDefault("planId", "pro_monthly");
            
            processPaymentCaptureAndUnlock(paymentId, username, planId, isRealGateway);
            return ResponseEntity.ok(Collections.singletonMap("success", true));
            
        } catch (Exception e) {
            log.error("[PAYMENTS] Exception in verifyPayment: {}", e.getMessage(), e);
            return ResponseEntity.status(500).body(Collections.singletonMap("error", e.getMessage()));
        }
    }

    private Map<?, ?> fetchRazorpayPaymentDetails(String paymentId) throws Exception {
        String url = "https://api.razorpay.com/v1/payments/" + paymentId;
        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Authorization", "Basic " + Base64.getEncoder().encodeToString((razorpayKeyId + ":" + razorpayKeySecret).getBytes("UTF-8")))
                .GET()
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() == 200) {
            return objectMapper.readValue(response.body(), Map.class);
        } else {
            throw new RuntimeException("Failed to fetch payment details from Razorpay: HTTP " + response.statusCode() + " - " + response.body());
        }
    }

    private String createRealRazorpayOrder(BigDecimal amount) throws Exception {
        String url = "https://api.razorpay.com/v1/orders";
        int amountInPaise = amount.multiply(new BigDecimal("100")).intValue();
        log.info("[PAYMENTS] Creating real Razorpay Order for amount (paise): {}", amountInPaise);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("amount", amountInPaise);
        requestBody.put("currency", "INR");
        requestBody.put("receipt", "rcpt_" + UUID.randomUUID().toString().substring(0, 8));

        String json = objectMapper.writeValueAsString(requestBody);

        String authHeader = "Basic " + Base64.getEncoder().encodeToString((razorpayKeyId + ":" + razorpayKeySecret).getBytes("UTF-8"));

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .header("Authorization", authHeader)
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        log.info("[PAYMENTS] Sending POST to Razorpay API: {} with body: {}", url, json);
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        log.info("[PAYMENTS] Razorpay API Response Status: {}", response.statusCode());
        log.info("[PAYMENTS] Razorpay API Response Body: {}", response.body());

        if (response.statusCode() >= 200 && response.statusCode() < 300) {
            Map<?, ?> responseMap = objectMapper.readValue(response.body(), Map.class);
            String orderId = (String) responseMap.get("id");
            log.info("[PAYMENTS] Razorpay Order ID created successfully: {}", orderId);
            return orderId;
        } else {
            throw new RuntimeException("Razorpay API HTTP " + response.statusCode() + ": " + response.body());
        }
    }

    private void updateSessionAndUnlock(String sessionId) {
        Optional<WorkspaceUpgradeSession> sessionOpt = sessionRepository.findById(sessionId);
        if (sessionOpt.isPresent() && "ACTIVE".equals(sessionOpt.get().getStatus())) {
            WorkspaceUpgradeSession session = sessionOpt.get();
            List<UserPledge> activePledges = pledgeRepository.findBySessionId(session.getId());
            
            int authorizedCount = (int) activePledges.stream()
                    .filter(p -> "AUTHORIZED".equals(p.getStatus()) || "CAPTURED".equals(p.getStatus()))
                    .count();
            
            session.setPledgesCount(authorizedCount);
            sessionRepository.save(session);

            if (authorizedCount >= session.getTargetPledges()) {
                session.setStatus("SUCCESS");
                sessionRepository.save(session);

                BigDecimal finalUnitRate = calculateDiscount(authorizedCount);

                List<UserPledge> pledgesToCapture = pledgeRepository.findBySessionId(session.getId());
                for (UserPledge p : pledgesToCapture) {
                    if ("AUTHORIZED".equals(p.getStatus())) {
                        p.setStatus("CAPTURED");
                        p.setFinalCapturedAmount(finalUnitRate);
                        pledgeRepository.save(p);

                        Optional<UserSession> userOpt = userRepository.findByUsername(p.getUsername());
                        if (userOpt.isPresent()) {
                            UserSession user = userOpt.get();
                            
                            String wallpapers = user.getUnlockedWallpapers();
                            if (wallpapers == null || wallpapers.isEmpty()) {
                                wallpapers = "grid";
                            }
                            if (!wallpapers.contains("wallpaper_neon")) {
                                wallpapers += ",wallpaper_neon,wallpaper_sunset,wallpaper_cosmic,chatbox";
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
    }

    private Map<?, ?> captureRazorpayPayment(String paymentId, int amountInPaise, String currency) throws Exception {
        String url = "https://api.razorpay.com/v1/payments/" + paymentId + "/capture";
        log.info("[PAYMENTS] Programmatically capturing payment: {} with amount (paise): {} {}", paymentId, amountInPaise, currency);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("amount", amountInPaise);
        requestBody.put("currency", currency != null ? currency : "INR");

        String json = objectMapper.writeValueAsString(requestBody);
        String authHeader = "Basic " + Base64.getEncoder().encodeToString((razorpayKeyId + ":" + razorpayKeySecret).getBytes("UTF-8"));

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .header("Authorization", authHeader)
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        log.info("[PAYMENTS] Razorpay Capture API Response Status: {}", response.statusCode());
        log.info("[PAYMENTS] Razorpay Capture API Response Body: {}", response.body());

        if (response.statusCode() >= 200 && response.statusCode() < 300) {
            return objectMapper.readValue(response.body(), Map.class);
        } else {
            throw new RuntimeException("Razorpay Capture API HTTP " + response.statusCode() + ": " + response.body());
        }
    }

    private void processPaymentCaptureAndUnlock(String paymentId, String username, String planId, boolean isRealGateway) {
        log.info("[PAYMENTS] Processing capture/unlock for paymentId: {}, username: {}, plan: {}", paymentId, username, planId);
        
        try {
            String status = "captured";
            int amountInPaise = 100;
            String currency = "INR";
            String resolvedUsername = username;
            String resolvedPlanId = planId;
            
            if (isRealGateway) {
                Map<?, ?> paymentDetails = fetchRazorpayPaymentDetails(paymentId);
                status = (String) paymentDetails.get("status");
                
                Object amtObj = paymentDetails.get("amount");
                if (amtObj instanceof Number) {
                    amountInPaise = ((Number) amtObj).intValue();
                } else if (amtObj != null) {
                    amountInPaise = Integer.parseInt(amtObj.toString());
                }
                currency = (String) paymentDetails.get("currency");
                
                @SuppressWarnings("unchecked")
                Map<String, String> notes = (Map<String, String>) paymentDetails.get("notes");
                if (notes != null) {
                    if (notes.containsKey("username")) resolvedUsername = notes.get("username");
                    if (notes.containsKey("planId")) resolvedPlanId = notes.get("planId");
                }
                
                log.info("[PAYMENTS] Real payment fetched: status={}, amount={}, currency={}", status, amountInPaise, currency);
                
                if ("authorized".equals(status)) {
                    log.info("[PAYMENTS] Payment {} is authorized. Capturing now...", paymentId);
                    Map<?, ?> captureResponse = captureRazorpayPayment(paymentId, amountInPaise, currency);
                    status = (String) captureResponse.get("status");
                    log.info("[PAYMENTS] Capture response status: {}", status);
                }
            } else {
                log.info("[PAYMENTS] Mock mode. Skipping real Razorpay capture.");
            }
            
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

            String finalUsername = resolvedUsername;
            String finalPlanId = resolvedPlanId;
            String finalStatus = status;
            int finalAmountInPaise = amountInPaise;
            
            Optional<UserPledge> pledgeOpt = pledgeRepository.findByOrderId(paymentId);
            if (pledgeOpt.isEmpty()) {
                List<UserPledge> usernamePledges = pledgeRepository.findByUsername(finalUsername);
                pledgeOpt = usernamePledges.stream()
                        .filter(p -> paymentId.equals(p.getPaymentId()) || paymentId.equals(p.getOrderId()))
                        .findFirst();
            }
            
            UserPledge pledge = pledgeOpt.orElseGet(() -> {
                return UserPledge.builder()
                        .sessionId(session.getId())
                        .username(finalUsername)
                        .orderId(paymentId)
                        .paymentId(paymentId)
                        .preAuthAmount(BigDecimal.valueOf(finalAmountInPaise).divide(BigDecimal.valueOf(100)))
                        .paymentMethod(finalPlanId.toUpperCase())
                        .status("PENDING")
                        .createdAt(Instant.now())
                        .build();
            });
            
            pledge.setStatus("captured".equals(finalStatus) ? "CAPTURED" : "AUTHORIZED");
            pledge.setPaymentId(paymentId);
            pledge.setFinalCapturedAmount(BigDecimal.valueOf(finalAmountInPaise).divide(BigDecimal.valueOf(100)));
            pledgeRepository.save(pledge);
            log.info("[PAYMENTS] Saved pledge: {}", pledge);
            
            Optional<UserSession> userOpt = userRepository.findByUsername(finalUsername);
            if (userOpt.isPresent()) {
                UserSession user = userOpt.get();
                log.info("[PAYMENTS] Unlocking features for user: {}", finalUsername);
                
                if ("pro_monthly".equalsIgnoreCase(finalPlanId) || "theme_pack".equalsIgnoreCase(finalPlanId)) {
                    String wallpapers = user.getUnlockedWallpapers();
                    if (wallpapers == null || wallpapers.isEmpty()) {
                        wallpapers = "grid";
                    }
                    if (!wallpapers.contains("wallpaper_neon")) {
                        wallpapers += ",wallpaper_neon,wallpaper_sunset,wallpaper_cosmic,chatbox";
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
                }
                
                user.packMetadata(
                    user.getPureAvatarUrl(),
                    user.getExtractedEmail(),
                    user.getPasswordHash(),
                    user.isMfaEnabled()
                );
                userRepository.save(user);
                
                String userEmail = user.getExtractedEmail();
                if (userEmail != null && !userEmail.trim().isEmpty()) {
                    try {
                        emailService.sendPurchaseSuccessEmail(userEmail, finalUsername, finalPlanId);
                        log.info("[PAYMENTS] Sent purchase success email to: {}", userEmail);
                    } catch (Exception ex) {
                        log.error("[PAYMENTS] Failed to send purchase success email: {}", ex.getMessage(), ex);
                    }
                } else {
                    log.warn("[PAYMENTS] User has no registered email. Email notification skipped.");
                }
            } else {
                log.warn("[PAYMENTS] UserSession not found for username: {}. Features not unlocked, email skipped.", finalUsername);
            }
            
            updateSessionMetrics(session.getId());
            
        } catch (Exception e) {
            log.error("[PAYMENTS] Error in processPaymentCaptureAndUnlock: {}", e.getMessage(), e);
            throw new RuntimeException(e);
        }
    }

    private void updateSessionMetrics(String sessionId) {
        Optional<WorkspaceUpgradeSession> sessionOpt = sessionRepository.findById(sessionId);
        if (sessionOpt.isPresent() && "ACTIVE".equals(sessionOpt.get().getStatus())) {
            WorkspaceUpgradeSession session = sessionOpt.get();
            List<UserPledge> activePledges = pledgeRepository.findBySessionId(session.getId());
            
            int authorizedCount = (int) activePledges.stream()
                    .filter(p -> "AUTHORIZED".equals(p.getStatus()) || "CAPTURED".equals(p.getStatus()))
                    .count();
            
            session.setPledgesCount(authorizedCount);
            sessionRepository.save(session);

            if (authorizedCount >= session.getTargetPledges()) {
                session.setStatus("SUCCESS");
                sessionRepository.save(session);
            }
        }
    }
}
