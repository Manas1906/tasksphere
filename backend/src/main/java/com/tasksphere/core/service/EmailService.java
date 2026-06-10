package com.tasksphere.core.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * EmailService - Asynchronous production email dispatching.
 * Bypasses Render SMTP port blocks completely via Google REST APIs over HTTPS (Port 443).
 * Supports:
 * - Decoupled high-performance Redis Event Queueing
 * - Method 2: Official Google Gmail REST API (up to 500 emails/day, zero cost, secure OAuth2)
 * - Method 1: Google Apps Script Web App Proxy (fallback, up to 100 emails/day)
 * - Simulator: local/console logging fallback when no remote credentials are configured.
 */
@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    @Autowired
    private RedisQueueService redisQueueService;

    @Value("${google.script.url:}")
    private String googleScriptUrl;

    @Value("${google.oauth.client.id:}")
    private String oauthClientId;

    @Value("${google.oauth.client.secret:}")
    private String oauthClientSecret;

    @Value("${google.oauth.refresh.token:}")
    private String oauthRefreshToken;

    @Value("${google.oauth.email:}")
    private String oauthEmail;

    /**
     * Check if the official Gmail REST API (Method 2) credentials are fully populated.
     */
    private boolean isOauthConfigured() {
        return oauthClientId != null && !oauthClientId.trim().isEmpty() && !oauthClientId.contains("${") &&
               oauthClientSecret != null && !oauthClientSecret.trim().isEmpty() && !oauthClientSecret.contains("${") &&
               oauthRefreshToken != null && !oauthRefreshToken.trim().isEmpty() && !oauthRefreshToken.contains("${") &&
               oauthEmail != null && !oauthEmail.trim().isEmpty() && !oauthEmail.contains("${");
    }

    /**
     * Dispatch multi-factor security code (OTP) asynchronously.
     */
    @Async
    public void sendOtpEmail(String toEmail, String otp) {
        String cleanEmail = toEmail.toLowerCase().trim();
        String htmlMessage = getOtpTemplate(otp);
        String subject = "TaskSphere Security - Your 6-Digit Verification Code: " + otp;

        log.info("[EMAIL-SERVICE] INCOMING OTP DELIVER SERVICE ACTION - Deliver to: {}, CODE: {}", cleanEmail, otp);

        // Try enqueuing onto Redis first
        boolean enqueued = redisQueueService.enqueueEmail("OTP", cleanEmail, subject, htmlMessage);
        if (enqueued) {
            log.info("[EMAIL-SERVICE] OTP EmailEvent successfully enqueued onto Redis. Core thread returning instantly.");
            return;
        }

        // Fallback: Direct execution if Redis is offline
        executeDirectEmailDispatch("OTP", cleanEmail, subject, htmlMessage);
    }

    /**
     * Dispatch welcome onboarding newsletter asynchronously.
     */
    @Async
    public void sendWelcomeEmail(String toEmail, String username, String role) {
        String cleanEmail = toEmail.toLowerCase().trim();
        String htmlMessage = getWelcomeTemplate(username, role);
        String subject = "Welcome to TaskSphere, " + username + "! Your workspace is active.";

        log.info("[EMAIL-SERVICE] INCOMING WELCOME NEWSLETTER SERVICE ACTION - Deliver to: {}, USERNAME: {}, ROLE: {}", cleanEmail, username, role);

        // Try enqueuing onto Redis first
        boolean enqueued = redisQueueService.enqueueEmail("WELCOME", cleanEmail, subject, htmlMessage);
        if (enqueued) {
            log.info("[EMAIL-SERVICE] Welcome Onboarding EmailEvent enqueued onto Redis. Core thread returning instantly.");
            return;
        }

        // Fallback: Direct execution if Redis is offline
        executeDirectEmailDispatch("WELCOME", cleanEmail, subject, htmlMessage);
    }

    /**
     * Direct synchronous dispatch of transactional emails.
     * Bypasses the event queue (used by background consumers or offline fallback).
     */
    public void executeDirectEmailDispatch(String type, String toEmail, String subject, String htmlContent) {
        // Route 1: Try Gmail REST API (Method 2)
        if (isOauthConfigured()) {
            boolean success = sendViaGmailRestApi(toEmail, subject, htmlContent);
            if (success) {
                return;
            }
            log.warn("[EMAIL-WARN] Method 2 (Gmail REST API) failed. Attempting Route 2 fallback...");
        }

        // Route 2: Try Google Apps Script Proxy (Method 1)
        if (googleScriptUrl != null && !googleScriptUrl.trim().isEmpty() && !googleScriptUrl.contains("${GOOGLE_SCRIPT_URL}")) {
            sendViaGoogleScript(toEmail, subject, htmlContent);
        } else {
            log.warn("[EMAIL-WARN] Google APIs are not configured. Standard mock simulation succeeded.");
        }
    }


    /**
     * Dispatch email via Google Apps Script HTTPS Web App Proxy (Method 1)
     */
    private void sendViaGoogleScript(String toEmail, String subject, String htmlContent) {
        try {
            RestTemplate restTemplate = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, Object> payload = new HashMap<>();
            payload.put("to", toEmail);
            payload.put("subject", subject);
            payload.put("htmlBody", htmlContent);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);
            ResponseEntity<String> response = restTemplate.postForEntity(googleScriptUrl.trim(), entity, String.class);
            log.info("[GMAIL-PROXY-SUCCESS] Email dispatched via Google Apps Script. Response: {}", response.getBody());
        } catch (Exception ex) {
            log.error("[GMAIL-PROXY-FAILURE] Google Apps Script REST call failed: {}", ex.getMessage());
        }
    }

    /**
     * Dispatch email via Google Gmail REST API (Method 2)
     */
    private boolean sendViaGmailRestApi(String toEmail, String subject, String htmlContent) {
        try {
            // 1. Exchange OAuth2 Refresh Token for a fresh Access Token
            String accessToken = getGmailAccessToken();
            if (accessToken == null || accessToken.trim().isEmpty()) {
                log.error("[GMAIL-REST-FAILURE] Failed to retrieve a valid OAuth2 Access Token.");
                return false;
            }

            // 2. Construct RFC 822 MIME-formatted email message
            String mimeMessage = 
                "From: TaskSphere <" + oauthEmail.trim() + ">\r\n" +
                "To: " + toEmail.trim() + "\r\n" +
                "Subject: " + subject.trim() + "\r\n" +
                "MIME-Version: 1.0\r\n" +
                "Content-Type: text/html; charset=utf-8\r\n\r\n" +
                htmlContent;

            // 3. Base64url-encode MIME message natively using Java's Base64
            byte[] rawBytes = mimeMessage.getBytes(StandardCharsets.UTF_8);
            String rawEncoded = Base64.getUrlEncoder().withoutPadding().encodeToString(rawBytes);

            // 4. POST the payload to Google's Gmail REST endpoint
            RestTemplate restTemplate = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(accessToken);

            Map<String, String> payload = new HashMap<>();
            payload.put("raw", rawEncoded);

            HttpEntity<Map<String, String>> entity = new HttpEntity<>(payload, headers);
            ResponseEntity<Map> response = restTemplate.postForEntity(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", 
                entity, 
                Map.class
            );

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                log.info("[GMAIL-REST-SUCCESS] Email dispatched successfully via Gmail REST API. Message ID: {}", response.getBody().get("id"));
                return true;
            } else {
                log.error("[GMAIL-REST-FAILURE] Google API responded with code: {}", response.getStatusCode());
                return false;
            }
        } catch (Exception ex) {
            log.error("[GMAIL-REST-FAILURE] Gmail REST API execution failed: {}", ex.getMessage());
            return false;
        }
    }

    /**
     * Exchange Google OAuth2 Refresh Token for a fresh Access Token
     */
    private String getGmailAccessToken() {
        try {
            RestTemplate restTemplate = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            String body = "client_id=" + URLEncoder.encode(oauthClientId.trim(), StandardCharsets.UTF_8.name()) +
                          "&client_secret=" + URLEncoder.encode(oauthClientSecret.trim(), StandardCharsets.UTF_8.name()) +
                          "&refresh_token=" + URLEncoder.encode(oauthRefreshToken.trim(), StandardCharsets.UTF_8.name()) +
                          "&grant_type=refresh_token";

            HttpEntity<String> request = new HttpEntity<>(body, headers);
            ResponseEntity<Map> response = restTemplate.postForEntity(
                "https://oauth2.googleapis.com/token", 
                request, 
                Map.class
            );

            if (response.getBody() != null && response.getBody().containsKey("access_token")) {
                return (String) response.getBody().get("access_token");
            }
        } catch (Exception ex) {
            log.error("[OAUTH-TOKEN-FAILURE] Failed to exchange refresh token for access token: {}", ex.getMessage());
            if (ex.getMessage() != null && (ex.getMessage().contains("invalid_grant") || ex.getMessage().contains("400"))) {
                log.error("[OAUTH-TOKEN-FAILURE-TIP] Google returned 'invalid_grant'. This usually means the refresh token is expired or revoked. " +
                          "Note: If your Google Cloud OAuth Consent Screen is in 'Testing' mode, refresh tokens expire automatically after 7 days. " +
                          "Please switch it to 'In Production' (Publish App) in the Google Cloud Console and generate a new refresh token.");
            }
        }
        return null;
    }


    private String getOtpTemplate(String otp) {
        return "<div style=\"font-family: 'Segoe UI', Arial, sans-serif; background: #0b0f19; padding: 40px; color: #f3f4f6; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #1f2937;\">"
             + "  <div style=\"text-align: center; margin-bottom: 30px;\">"
             + "    <h1 style=\"color: #a855f7; font-size: 28px; font-weight: 700; margin: 0; letter-spacing: 1px;\">TASKSPHERE</h1>"
             + "    <p style=\"color: #6b7280; font-size: 14px; margin: 5px 0 0 0;\">Enterprise Agile Workspace</p>"
             + "  </div>"
             + "  <div style=\"background: #111827; padding: 30px; border-radius: 8px; border: 1px solid #374151; text-align: center;\">"
             + "    <h2 style=\"margin-top: 0; color: #e5e7eb; font-size: 20px; font-weight: 600;\">Your Security Code</h2>"
             + "    <p style=\"color: #9ca3af; font-size: 14px; line-height: 1.6; margin-bottom: 25px;\">"
             + "      Please verify your identity inside TaskSphere. Use the 6-digit verification code below. "
             + "      This code is valid for <b>5 minutes</b> and can only be used once."
             + "    </p>"
             + "    <div style=\"font-size: 36px; font-weight: 700; color: #3b82f6; letter-spacing: 8px; padding: 15px; background: #1f2937; border-radius: 6px; display: inline-block; border: 1px dashed #60a5fa; margin: 10px auto;\">"
             + "      " + otp
             + "    </div>"
             + "  </div>"
             + "  <div style=\"text-align: center; margin-top: 35px; border-top: 1px solid #1f2937; padding-top: 20px;\">"
             + "    <p style=\"color: #4b5563; font-size: 11px; margin: 0; line-height: 1.5;\">"
             + "      This is an automated operational transmission. If you did not request this verification, "
             + "      please ignore this message. Do not share this security code with anyone."
             + "    </p>"
             + "  </div>"
             + "</div>";
    }

    private String getWelcomeTemplate(String username, String role) {
        return "<div style=\"font-family: 'Segoe UI', Arial, sans-serif; background: #0c0f1d; padding: 40px; color: #f3f4f6; border-radius: 16px; max-width: 600px; margin: 0 auto; border: 1px solid #1e293b; box-shadow: 0 10px 30px rgba(0,0,0,0.5);\">"
             + "  <div style=\"text-align: center; margin-bottom: 35px;\">"
             + "    <div style=\"display: inline-block; padding: 8px 16px; background: rgba(168, 85, 247, 0.1); border-radius: 20px; margin-bottom: 12px; border: 1px solid rgba(168, 85, 247, 0.3);\">"
             + "      <span style=\"color: #c084fc; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;\">Deploy Complete</span>"
             + "    </div>"
             + "    <h1 style=\"color: #ffffff; font-size: 32px; font-weight: 800; margin: 0; letter-spacing: 2px; background: linear-gradient(135deg, #a855f7 0%, #3b82f6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;\">TASKSPHERE</h1>"
             + "    <p style=\"color: #94a3b8; font-size: 14px; margin: 5px 0 0 0;\">Your Portal to the Agile Metaverse</p>"
             + "  </div>"
             + "  "
             + "  <div style=\"background: linear-gradient(135deg, #121832 0%, #080b19 100%); padding: 30px; border-radius: 12px; border: 1px solid #1e293b; margin-bottom: 25px;\">"
             + "    <h2 style=\"margin-top: 0; color: #ffffff; font-size: 22px; font-weight: 700; border-bottom: 1px solid #1e293b; padding-bottom: 15px;\">Hello, " + username + "! 👋</h2>"
             + "    <p style=\"color: #cbd5e1; font-size: 15px; line-height: 1.6; margin-bottom: 20px;\">"
             + "      Excellent news! Your session has been officially reviewed and **approved** by a workspace administrator. "
             + "      You now have complete access to the TaskSphere collaborative workspace."
             + "    </p>"
             + "    "
             + "    <div style=\"display: inline-block; background: rgba(0, 240, 255, 0.05); padding: 12px 20px; border-radius: 8px; border: 1px solid rgba(0, 240, 255, 0.15); margin: 15px 0;\">"
             + "      <div style=\"color: #00f0ff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;\">Assigned Project Role</div>"
             + "      <div style=\"color: #ffffff; font-size: 16px; font-weight: 600; margin-top: 4px;\">👑 " + role + "</div>"
             + "    </div>"
             + "  </div>"
             + "  "
             + "  <h3 style=\"color: #f8fafc; font-size: 16px; font-weight: 600; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 1px;\">Active Platform Capabilities</h3>"
             + "  <div style=\"display: grid; gap: 15px; margin-bottom: 30px;\">"
             + "    <div style=\"padding: 15px; background: #111827; border-radius: 8px; border: 1px solid #1f2937;\">"
             + "      <h4 style=\"margin: 0 0 5px 0; color: #a855f7; font-size: 14px;\">💬 Real-Time Dynamic Collaboration</h4>"
             + "      <p style=\"margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5;\">Engage in public discussion feeds or toggle instant private DMs with colleagues by clicking user avatars.</p>"
             + "    </div>"
             + "    <div style=\"padding: 15px; background: #111827; border-radius: 8px; border: 1px solid #1f2937;\">"
             + "      <h4 style=\"margin: 0 0 5px 0; color: #3b82f6; font-size: 14px;\">✏️ Inline Message Editing</h4>"
             + "      <p style=\"margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5;\">Hover over your messages to edit in-place with instant, zero-refresh synchronization across all active sockets.</p>"
             + "    </div>"
             + "    <div style=\"padding: 15px; background: #111827; border-radius: 8px; border: 1px solid #1f2937;\">"
             + "      <h4 style=\"margin: 0 0 5px 0; color: #10b981; font-size: 14px;\">🔒 Advanced Security Config</h4>"
             + "      <p style=\"margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5;\">Manage your passwords safely under the security cog, check strength checkers, and toggle Multi-Factor Authentication (MFA).</p>"
             + "    </div>"
             + "  </div>"
             + "  "
             + "  <div style=\"text-align: center; margin-top: 35px; border-top: 1px solid #1e293b; padding-top: 25px;\">"
             + "    <p style=\"color: #64748b; font-size: 11px; margin: 0; line-height: 1.6;\">"
             + "      This welcome transmission was securely generated and routed by TaskSphere. "
             + "      To connect, launch your web browser and access the active cluster environment."
             + "    </p>"
             + "  </div>"
             + "</div>";
    }
}
