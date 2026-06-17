package com.tasksphere.core.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class OtpService {

    private static final Logger log = LoggerFactory.getLogger(OtpService.class);
    private final SecureRandom random = new SecureRandom();
    
    private static class OtpData {
        final String code;
        final Instant expiry;

        OtpData(String code, Instant expiry) {
            this.code = code;
            this.expiry = expiry;
        }
    }

    private final ConcurrentHashMap<String, OtpData> otpMap = new ConcurrentHashMap<>();

    public String generateOtp(String email) {
        int codeInt = 100000 + random.nextInt(900000);
        String code = String.valueOf(codeInt);

        Instant expiry = Instant.now().plusSeconds(300);
        String cleanEmail = email.toLowerCase().trim();
        otpMap.put(cleanEmail, new OtpData(code, expiry));

        log.info("[OTP-SERVICE] Generated OTP {} for email: {}. Expiration: {}", code, cleanEmail, expiry);
        return code;
    }

    public boolean verifyOtp(String email, String code) {
        if (email == null || code == null) {
            log.warn("[OTP-SERVICE] Verification aborted: email or code was null. Email: {}, Code: {}", email, code);
            return false;
        }
        String cleanEmail = email.toLowerCase().trim();
        String cleanCode = code.trim();
        
        log.info("[OTP-SERVICE] Verifying OTP request for email: {} with code: {}", cleanEmail, cleanCode);
        OtpData data = otpMap.get(cleanEmail);

        if (data == null) {
            log.warn("[OTP-SERVICE] Verification failed: No OTP record found in memory for email: {}", cleanEmail);
            return false;
        }

        if (Instant.now().isAfter(data.expiry)) {
            log.warn("[OTP-SERVICE] Verification failed: OTP has expired for email: {}. Registered Expiration: {}, Current Time: {}", cleanEmail, data.expiry, Instant.now());
            otpMap.remove(cleanEmail);
            return false;
        }

        if (data.code.equals(cleanCode)) {
            log.info("[OTP-SERVICE] Verification SUCCESS for email: {}", cleanEmail);
            otpMap.remove(cleanEmail);
            return true;
        }

        log.warn("[OTP-SERVICE] Verification failed: Code mismatch for email: {}. Expected: {}, Provided: {}", cleanEmail, data.code, cleanCode);
        return false;
    }
}
