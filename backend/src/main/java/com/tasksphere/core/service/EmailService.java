package com.tasksphere.core.service;

import jakarta.mail.internet.MimeMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

@Service
public class EmailService {

    @Autowired(required = false)
    private JavaMailSender mailSender;

    @Value("${spring.mail.username:tasksphere.developer@gmail.com}")
    private String fromEmail;

    @Value("${resend.api.key:}")
    private String resendApiKey;

    @Value("${mailjet.api.key:}")
    private String mailjetApiKey;

    @Value("${mailjet.secret.key:}")
    private String mailjetSecretKey;

    @Async
    public void sendOtpEmail(String toEmail, String otp) {
        String cleanEmail = toEmail.toLowerCase().trim();
        String htmlMessage = getOtpTemplate(otp);

        System.out.println("\n=======================================================");
        System.out.println("[SMTP-SIMULATOR] INCOMING OTP DELIVER SERVICE ACTION");
        System.out.println("Deliver OTP to: " + cleanEmail);
        System.out.println("VERIFICATION CODE: " + otp);
        System.out.println("=======================================================\n");

        // Try Mailjet API if API keys are supplied (HTTPS port 443 is never blocked by cloud firewalls)
        if (mailjetApiKey != null && !mailjetApiKey.trim().isEmpty() && mailjetSecretKey != null && !mailjetSecretKey.trim().isEmpty()) {
            System.out.println("[MAILJET-START] Attempting real-time email delivery via Mailjet API...");
            try {
                RestTemplate restTemplate = new RestTemplate();
                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.APPLICATION_JSON);
                headers.setBasicAuth(mailjetApiKey.trim(), mailjetSecretKey.trim());

                // Prepare Mailjet JSON payload matching v3.1 schema
                Map<String, Object> fromMap = new HashMap<>();
                fromMap.put("Email", fromEmail); // must be verified sender, e.g. acharyamanas1906@gmail.com
                fromMap.put("Name", "TaskSphere");

                Map<String, Object> toMap = new HashMap<>();
                toMap.put("Email", cleanEmail);
                toMap.put("Name", "Developer");

                java.util.List<Map<String, Object>> toList = new java.util.ArrayList<>();
                toList.add(toMap);

                Map<String, Object> messageMap = new HashMap<>();
                messageMap.put("From", fromMap);
                messageMap.put("To", toList);
                messageMap.put("Subject", "TaskSphere Security - Your 6-Digit Verification Code: " + otp);
                messageMap.put("HTMLPart", htmlMessage);

                java.util.List<Map<String, Object>> messagesList = new java.util.ArrayList<>();
                messagesList.add(messageMap);

                Map<String, Object> payload = new HashMap<>();
                payload.put("Messages", messagesList);

                HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);
                ResponseEntity<String> response = restTemplate.postForEntity("https://api.mailjet.com/v3.1/send", entity, String.class);
                
                System.out.println("[MAILJET-SUCCESS] Real-time mail dispatched via Mailjet API. Response: " + response.getBody());
                return; // Successfully sent, bypass SMTP/Resend fallback!
            } catch (Exception ex) {
                System.err.println("[MAILJET-FAILURE] Mailjet API failed: " + ex.getMessage());
                System.out.println("[MAILJET-INFO] Falling back to standard SMTP/Simulator...");
            }
        }

        // Try Resend API if API key is supplied (HTTPS port 443 is never blocked by cloud firewalls)
        if (resendApiKey != null && !resendApiKey.trim().isEmpty()) {
            System.out.println("[RESEND-START] Attempting real-time email delivery via Resend API...");
            try {
                RestTemplate restTemplate = new RestTemplate();
                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.APPLICATION_JSON);
                headers.set("Authorization", "Bearer " + resendApiKey.trim());

                Map<String, Object> body = new HashMap<>();
                body.put("from", "TaskSphere <onboarding@resend.dev>");
                body.put("to", cleanEmail);
                body.put("subject", "TaskSphere Security - Your 6-Digit Verification Code: " + otp);
                body.put("html", htmlMessage);

                HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
                ResponseEntity<String> response = restTemplate.postForEntity("https://api.resend.com/emails", entity, String.class);
                
                System.out.println("[RESEND-SUCCESS] Real-time mail dispatched via Resend API. Response: " + response.getBody());
                return; // Successfully sent, bypass SMTP fallback!
            } catch (Exception ex) {
                System.err.println("[RESEND-FAILURE] Resend API failed: " + ex.getMessage());
                System.out.println("[RESEND-INFO] Falling back to standard SMTP/Simulator...");
            }
        }

        if (mailSender == null) {
            System.out.println("[SMTP-WARN] JavaMailSender is not initialized or configured. Fallback Simulator successfully generated the code above.");
            return;
        }

        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

            helper.setFrom(fromEmail);
            helper.setTo(cleanEmail);
            helper.setSubject("TaskSphere Security - Your 6-Digit Verification Code: " + otp);
            helper.setText(htmlMessage, true);

            mailSender.send(message);
            System.out.println("[SMTP-SUCCESS] Real-time verification mail sent securely to " + cleanEmail);
        } catch (Exception ex) {
            System.err.println("[SMTP-FAILURE] Real SMTP delivery failed: " + ex.getMessage());
            System.out.println("[SMTP-INFO] Developer: Please verify your SMTP properties or App Password settings inside application.properties.");
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
}
