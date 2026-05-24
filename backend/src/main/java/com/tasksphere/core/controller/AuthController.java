package com.tasksphere.core.controller;

import com.tasksphere.core.config.JwtTokenProvider;
import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;
import com.tasksphere.core.service.EmailService;
import com.tasksphere.core.service.OtpService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final OtpService otpService;
    private final EmailService emailService;
    private final JwtTokenProvider tokenProvider;
    private final UserSessionRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;

    public AuthController(OtpService otpService,
                          EmailService emailService,
                          JwtTokenProvider tokenProvider,
                          UserSessionRepository userRepository,
                          BCryptPasswordEncoder passwordEncoder) {
        this.otpService = otpService;
        this.emailService = emailService;
        this.tokenProvider = tokenProvider;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
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

    /**
     * Password Logins with optional Multi-Factor Authentication (MFA)
     */
    @PostMapping("/password/login")
    public ResponseEntity<?> loginWithPassword(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        String password = request.get("password");

        if (email == null || password == null || email.trim().isEmpty() || password.trim().isEmpty()) {
            Map<String, String> err = new HashMap<>();
            err.put("error", "Email and Password are required.");
            return ResponseEntity.badRequest().body(err);
        }

        String normalizedEmail = email.toLowerCase().trim();

        // Scan database for registered profile matching this email metadata
        Optional<UserSession> userOpt = userRepository.findAll().stream()
                .filter(u -> normalizedEmail.equalsIgnoreCase(u.getEmail()))
                .findFirst();

        if (userOpt.isEmpty()) {
            Map<String, String> err = new HashMap<>();
            err.put("error", "Account not registered. Please complete first-time registration.");
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(err);
        }

        UserSession user = userOpt.get();
        String passwordHash = user.getPasswordHash();

        if (passwordHash == null || !passwordEncoder.matches(password, passwordHash)) {
            Map<String, String> err = new HashMap<>();
            err.put("error", "Invalid password credentials.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(err);
        }

        // Credentials correct! Check if MFA is active
        if (user.isMfaEnabled()) {
            // Generate and send dynamic OTP Code
            String otp = otpService.generateOtp(normalizedEmail);
            emailService.sendOtpEmail(normalizedEmail, otp);

            Map<String, Object> response = new HashMap<>();
            response.put("mfaRequired", true);
            response.put("email", normalizedEmail);
            response.put("message", "MFA verification code dispatched to email.");
            return ResponseEntity.ok(response);
        }

        // MFA is disabled, bypass OTP and log in immediately!
        String token = tokenProvider.generateToken(normalizedEmail);
        
        // Put user session ONLINE status
        user.setStatus("ONLINE");
        userRepository.save(user);

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("token", token);
        response.put("username", user.getUsername());
        response.put("role", user.getRole());
        response.put("avatarUrl", user.getPureAvatarUrl());
        response.put("email", normalizedEmail);

        return ResponseEntity.ok(response);
    }
}
