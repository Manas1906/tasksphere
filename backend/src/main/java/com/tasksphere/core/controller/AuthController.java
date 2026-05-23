package com.tasksphere.core.controller;

import com.tasksphere.core.config.JwtTokenProvider;
import com.tasksphere.core.service.EmailService;
import com.tasksphere.core.service.OtpService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final OtpService otpService;
    private final EmailService emailService;
    private final JwtTokenProvider tokenProvider;

    public AuthController(OtpService otpService,
                          EmailService emailService,
                          JwtTokenProvider tokenProvider) {
        this.otpService = otpService;
        this.emailService = emailService;
        this.tokenProvider = tokenProvider;
    }

    @PostMapping("/otp/send")
    public ResponseEntity<?> sendOtp(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        if (email == null || email.trim().isEmpty() || !email.contains("@")) {
            Map<String, String> err = new HashMap<>();
            err.put("error", "Please supply a valid email address.");
            return ResponseEntity.badRequest().body(err);
        }

        String otp = otpService.generateOtp(email);
        emailService.sendOtpEmail(email, otp);

        Map<String, String> res = new HashMap<>();
        res.put("message", "Verification code dispatched successfully.");
        return ResponseEntity.ok(res);
    }

    @PostMapping("/otp/verify")
    public ResponseEntity<?> verifyOtp(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        String code = request.get("otp");

        if (email == null || code == null || email.trim().isEmpty() || code.trim().isEmpty()) {
            Map<String, String> err = new HashMap<>();
            err.put("error", "Email and Verification Code are required.");
            return ResponseEntity.badRequest().body(err);
        }

        boolean isValid = otpService.verifyOtp(email, code);

        if (!isValid) {
            Map<String, String> err = new HashMap<>();
            err.put("error", "Invalid or expired verification code.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(err);
        }

        String token = tokenProvider.generateToken(email.toLowerCase().trim());

        Map<String, Object> res = new HashMap<>();
        res.put("success", true);
        res.put("token", token);
        res.put("username", email.toLowerCase().trim().split("@")[0]);
        res.put("email", email.toLowerCase().trim());

        return ResponseEntity.ok(res);
    }
}
