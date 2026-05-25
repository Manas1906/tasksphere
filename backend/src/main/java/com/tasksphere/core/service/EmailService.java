package com.tasksphere.core.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

/**
 * EmailService - Asynchronous production email dispatching.
 * Uses Mailersend REST API exclusively for zero-port block, zero-spam delivery.
 * Features a simulator fallback mode if Mailersend credentials are not configured.
 */
@Service
public class EmailService {

    @Value("${maileroo.api.key:}")
    private String mailerooApiKey;

    @Value("${maileroo.sender:}")
    private String mailerooSender;

    /**
     * Dispatch multi-factor security code (OTP) asynchronously.
     */
    @Async
    public void sendOtpEmail(String toEmail, String otp) {
        String cleanEmail = toEmail.toLowerCase().trim();
        String htmlMessage = getOtpTemplate(otp);

        System.out.println("\n=======================================================");
        System.out.println("[MAILEROO-SIMULATOR] INCOMING OTP DELIVER SERVICE ACTION");
        System.out.println("Deliver OTP to: " + cleanEmail);
        System.out.println("VERIFICATION CODE: " + otp);
        System.out.println("=======================================================\n");

        if (mailerooApiKey == null || mailerooApiKey.trim().isEmpty() || mailerooSender == null || mailerooSender.trim().isEmpty()) {
            System.out.println("[MAILEROO-WARN] Maileroo API credentials are not configured. Fallback Simulator output above.");
            return;
        }

        try {
            RestTemplate restTemplate = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("X-API-Key", mailerooApiKey.trim());

            Map<String, Object> fromMap = new HashMap<>();
            fromMap.put("email", mailerooSender.trim());
            fromMap.put("name", "TaskSphere");

            Map<String, Object> toMap = new HashMap<>();
            toMap.put("email", cleanEmail);
            toMap.put("name", "Developer");

            java.util.List<Map<String, Object>> toList = new java.util.ArrayList<>();
            toList.add(toMap);

            Map<String, Object> payload = new HashMap<>();
            payload.put("from", fromMap);
            payload.put("to", toList);
            payload.put("subject", "TaskSphere Security - Your 6-Digit Verification Code: " + otp);
            payload.put("html", htmlMessage);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);
            ResponseEntity<String> response = restTemplate.postForEntity("https://smtp.maileroo.com/api/v2/emails", entity, String.class);
            
            System.out.println("[MAILEROO-SUCCESS] Real-time mail dispatched via Maileroo API. Response: " + response.getBody());
        } catch (Exception ex) {
            System.err.println("[MAILEROO-FAILURE] Maileroo API failed: " + ex.getMessage());
        }
    }

    /**
     * Dispatch welcome onboarding newsletter asynchronously.
     */
    @Async
    public void sendWelcomeEmail(String toEmail, String username, String role) {
        String cleanEmail = toEmail.toLowerCase().trim();
        String htmlMessage = getWelcomeTemplate(username, role);

        System.out.println("\n=======================================================");
        System.out.println("[MAILEROO-SIMULATOR] INCOMING WELCOME NEWSLETTER SERVICE ACTION");
        System.out.println("Deliver Welcome Email to: " + cleanEmail);
        System.out.println("USERNAME: " + username);
        System.out.println("ROLE: " + role);
        System.out.println("=======================================================\n");

        if (mailerooApiKey == null || mailerooApiKey.trim().isEmpty() || mailerooSender == null || mailerooSender.trim().isEmpty()) {
            System.out.println("[MAILEROO-WARN] Maileroo API credentials are not configured. Fallback Welcome simulation succeeded.");
            return;
        }

        try {
            RestTemplate restTemplate = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("X-API-Key", mailerooApiKey.trim());

            Map<String, Object> fromMap = new HashMap<>();
            fromMap.put("email", mailerooSender.trim());
            fromMap.put("name", "TaskSphere");

            Map<String, Object> toMap = new HashMap<>();
            toMap.put("email", cleanEmail);
            toMap.put("name", username);

            java.util.List<Map<String, Object>> toList = new java.util.ArrayList<>();
            toList.add(toMap);

            Map<String, Object> payload = new HashMap<>();
            payload.put("from", fromMap);
            payload.put("to", toList);
            payload.put("subject", "Welcome to TaskSphere, " + username + "! Your workspace is active.");
            payload.put("html", htmlMessage);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);
            ResponseEntity<String> response = restTemplate.postForEntity("https://smtp.maileroo.com/api/v2/emails", entity, String.class);
            
            System.out.println("[MAILEROO-SUCCESS] Welcome email dispatched via Maileroo. Response: " + response.getBody());
        } catch (Exception ex) {
            System.err.println("[MAILEROO-FAILURE] Maileroo Welcome API failed: " + ex.getMessage());
        }
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
