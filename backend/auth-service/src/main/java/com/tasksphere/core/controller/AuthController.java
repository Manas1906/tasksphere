package com.tasksphere.core.controller;

import com.tasksphere.core.config.JwtTokenProvider;
import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;
import com.tasksphere.core.service.EmailService;
import com.tasksphere.core.service.OtpService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

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
            log.warn("[AUTH-OTP-SEND] Invalid email supplied for OTP dispatch: '{}'", email);
            Map<String, String> err = new HashMap<>();
            err.put("error", "Please supply a valid email address.");
            return ResponseEntity.badRequest().body(err);
        }

        log.info("[AUTH-OTP-SEND] Dispatching OTP to: {}", email);
        String otp = otpService.generateOtp(email);
        emailService.sendOtpEmail(email, otp);
        log.info("[AUTH-OTP-SEND] OTP successfully dispatched to: {}", email);

        Map<String, String> res = new HashMap<>();
        res.put("message", "Verification code dispatched successfully.");
        return ResponseEntity.ok(res);
    }

    @PostMapping("/otp/verify")
    public ResponseEntity<?> verifyOtp(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        String code = request.get("otp");

        if (email == null || code == null || email.trim().isEmpty() || code.trim().isEmpty()) {
            log.warn("[AUTH-OTP-VERIFY] OTP verification request missing email or code.");
            Map<String, String> err = new HashMap<>();
            err.put("error", "Email and Verification Code are required.");
            return ResponseEntity.badRequest().body(err);
        }

        log.info("[AUTH-OTP-VERIFY] Verifying OTP for email: {}", email);
        boolean isValid = otpService.verifyOtp(email, code);

        if (!isValid) {
            log.warn("[AUTH-OTP-VERIFY] Invalid or expired OTP for email: {}", email);
            Map<String, String> err = new HashMap<>();
            err.put("error", "Invalid or expired verification code.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(err);
        }

        log.info("[AUTH-OTP-VERIFY] OTP verified successfully for email: {}", email);
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
            log.warn("[AUTH-PASSWORD-LOGIN] Missing email or password in login request.");
            Map<String, String> err = new HashMap<>();
            err.put("error", "Email and Password are required.");
            return ResponseEntity.badRequest().body(err);
        }

        String normalizedEmail = email.toLowerCase().trim();
        log.info("[AUTH-PASSWORD-LOGIN] Password login attempt for email: {}", normalizedEmail);

        // Scan database for registered profile matching this email metadata
        Optional<UserSession> userOpt = userRepository.findAll().stream()
                .filter(u -> normalizedEmail.equalsIgnoreCase(u.getExtractedEmail()))
                .findFirst();

        if (userOpt.isEmpty()) {
            log.warn("[AUTH-PASSWORD-LOGIN] No account found for email: {}", normalizedEmail);
            Map<String, String> err = new HashMap<>();
            err.put("error", "Account not registered. Please complete first-time registration.");
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(err);
        }

        UserSession user = userOpt.get();
        String passwordHash = user.getPasswordHash();

        if (passwordHash == null || !passwordEncoder.matches(password, passwordHash)) {
            log.warn("[AUTH-PASSWORD-LOGIN] Invalid credentials for email: {}", normalizedEmail);
            Map<String, String> err = new HashMap<>();
            err.put("error", "Invalid password credentials.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(err);
        }

        // Credentials correct! Check if MFA is active
        if (user.isMfaEnabled()) {
            // Generate and send dynamic OTP Code
            log.info("[AUTH-PASSWORD-LOGIN] MFA required for email: {}. Dispatching OTP.", normalizedEmail);
            String otp = otpService.generateOtp(normalizedEmail);
            emailService.sendOtpEmail(normalizedEmail, otp);

            Map<String, Object> response = new HashMap<>();
            response.put("mfaRequired", true);
            response.put("email", normalizedEmail);
            response.put("message", "MFA verification code dispatched to email.");
            return ResponseEntity.ok(response);
        }

        // MFA is disabled, bypass OTP and log in immediately!
        log.info("[AUTH-PASSWORD-LOGIN] Credentials valid, MFA not required. Issuing JWT for email: {}", normalizedEmail);
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

    @GetMapping("/check-email")
    public ResponseEntity<?> checkEmail(@RequestParam String email) {
        if (email == null || email.trim().isEmpty()) {
            Map<String, String> err = new HashMap<>();
            err.put("error", "Email is required.");
            return ResponseEntity.badRequest().body(err);
        }
        String normalizedEmail = email.toLowerCase().trim();
        boolean exists = userRepository.findAll().stream()
                .anyMatch(u -> normalizedEmail.equalsIgnoreCase(u.getExtractedEmail()));
        
        Map<String, Object> res = new HashMap<>();
        res.put("registered", exists);
        return ResponseEntity.ok(res);
    }

    @PostMapping("/password/reset")
    public ResponseEntity<?> resetPassword(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        String otp = request.get("otp");
        String newPassword = request.get("newPassword");

        if (email == null || otp == null || newPassword == null || 
                email.trim().isEmpty() || otp.trim().isEmpty() || newPassword.trim().isEmpty()) {
            log.warn("[AUTH-PASSWORD-RESET] Missing required fields in password reset request.");
            Map<String, String> err = new HashMap<>();
            err.put("error", "Email, OTP Code, and New Password are required.");
            return ResponseEntity.badRequest().body(err);
        }

        String normalizedEmail = email.toLowerCase().trim();
        log.info("[AUTH-PASSWORD-RESET] Password reset request for email: {}", normalizedEmail);

        // 1. Verify OTP code
        boolean isOtpValid = otpService.verifyOtp(normalizedEmail, otp.trim());
        if (!isOtpValid) {
            log.warn("[AUTH-PASSWORD-RESET] Invalid or expired OTP for email: {}", normalizedEmail);
            Map<String, String> err = new HashMap<>();
            err.put("error", "Invalid or expired verification code.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(err);
        }

        // 2. Scan repository for existing user with this email
        Optional<UserSession> userOpt = userRepository.findAll().stream()
                .filter(u -> normalizedEmail.equalsIgnoreCase(u.getExtractedEmail()))
                .findFirst();

        if (userOpt.isEmpty()) {
            log.warn("[AUTH-PASSWORD-RESET] No account found for email: {}", normalizedEmail);
            Map<String, String> err = new HashMap<>();
            err.put("error", "Account not found for this email address.");
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(err);
        }

        UserSession user = userOpt.get();

        // 3. Encrypt and save new password
        String hashedPwd = passwordEncoder.encode(newPassword);
        user.packMetadata(user.getPureAvatarUrl(), user.getExtractedEmail(), hashedPwd, user.isMfaEnabled());
        userRepository.save(user);
        log.info("[AUTH-PASSWORD-RESET] Password successfully reset for email: {}", normalizedEmail);

        Map<String, String> res = new HashMap<>();
        res.put("message", "Password updated successfully. Please log in using your new credentials.");
        return ResponseEntity.ok(res);
    }
}
