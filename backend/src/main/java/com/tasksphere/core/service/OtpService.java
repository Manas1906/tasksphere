package com.tasksphere.core.service;

import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class OtpService {

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
        otpMap.put(email.toLowerCase().trim(), new OtpData(code, expiry));

        return code;
    }

    public boolean verifyOtp(String email, String code) {
        if (email == null || code == null) {
            return false;
        }
        String cleanEmail = email.toLowerCase().trim();
        OtpData data = otpMap.get(cleanEmail);

        if (data == null) {
            return false;
        }

        if (Instant.now().isAfter(data.expiry)) {
            otpMap.remove(cleanEmail);
            return false;
        }

        if (data.code.equals(code.trim())) {
            otpMap.remove(cleanEmail);
            return true;
        }

        return false;
    }
}
