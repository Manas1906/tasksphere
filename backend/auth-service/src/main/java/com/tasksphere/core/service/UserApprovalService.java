package com.tasksphere.core.service;

import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class UserApprovalService {

    private static final Logger log = LoggerFactory.getLogger(UserApprovalService.class);

    @Autowired
    private UserSessionRepository userRepository;

    @Autowired
    private RedisCacheService redisCacheService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    private EmailService emailService;

    @Autowired
    private WebPushService webPushService;

    public void notifyAdminsForApproval(UserSession newUser) {
        log.info("[APPROVAL-SERVICE] Processing registration approval notifications for new user: {} ({})", 
                newUser.getUsername(), newUser.getRole());
        
        List<UserSession> admins = userRepository.findAll().stream()
                .filter(u -> "PRODUCT_OWNER".equalsIgnoreCase(u.getRole()) || "MANAGER".equalsIgnoreCase(u.getRole()))
                .toList();

        if (admins.isEmpty()) {
            log.warn("[APPROVAL-SERVICE] No administrators found in database to notify for user: {}", newUser.getUsername());
            return;
        }

        for (UserSession admin : admins) {
            String adminUsername = admin.getUsername();
            boolean isOnline = redisCacheService.isUserOnline(adminUsername);
            
            if (isOnline) {
                try {
                    // Send real-time WebSocket alert
                    Map<String, Object> alert = new HashMap<>();
                    alert.put("type", "REGISTRATION_APPROVAL");
                    alert.put("username", newUser.getUsername());
                    alert.put("role", newUser.getRole());
                    alert.put("email", newUser.getExtractedEmail());
                    alert.put("message", "A new user registration (" + newUser.getUsername() + " as " + newUser.getRole() + ") requires your approval.");
                    alert.put("timestamp", java.time.Instant.now().toString());

                    messagingTemplate.convertAndSendToUser(adminUsername, "/queue/notifications", alert);
                    log.info("[APPROVAL-SERVICE] Dispatched real-time WS notification to online admin: {}", adminUsername);

                    // Web Push notification fallback (Phase 13 WebPush capability)
                    webPushService.sendNotification(
                        adminUsername, 
                        "👤 Registration Approval Needed", 
                        newUser.getUsername() + " has requested access to the workspace.", 
                        "/"
                    );
                } catch (Exception e) {
                    log.error("[APPROVAL-SERVICE-ERROR] Failed to send WS/Push alert to admin {}: {}", adminUsername, e.getMessage());
                }
            }

            // Always send email notification to the admin
            String adminEmail = admin.getExtractedEmail();
            if (adminEmail != null && !adminEmail.trim().isEmpty()) {
                try {
                    String subject = "[TaskSphere] Action Required: Approve Registration for " + newUser.getUsername();
                    String htmlContent = "<h3>New User Access Request</h3>" +
                            "<p>A new user has registered on TaskSphere and requires administrator approval before they can access the workspace.</p>" +
                            "<ul>" +
                            "<li><strong>Username:</strong> " + newUser.getUsername() + "</li>" +
                            "<li><strong>Email:</strong> " + (newUser.getExtractedEmail() != null ? newUser.getExtractedEmail() : "N/A") + "</li>" +
                            "<li><strong>Role Requested:</strong> " + newUser.getRole() + "</li>" +
                            "</ul>" +
                            "<p>Please log in to your TaskSphere Administrator Panel to approve or reject this request.</p>";

                    emailService.executeDirectEmailDispatch("APPROVAL_REQUEST", adminEmail, subject, htmlContent);
                    log.info("[APPROVAL-SERVICE] Dispatched notification email to admin: {} ({})", adminUsername, adminEmail);
                } catch (Exception ex) {
                    log.error("[APPROVAL-SERVICE-ERROR] Failed to send approval email to admin {}: {}", adminUsername, ex.getMessage());
                }
            } else {
                log.warn("[APPROVAL-SERVICE] Admin {} has no registered email. Skipping email dispatch.", adminUsername);
            }
        }
    }
}
