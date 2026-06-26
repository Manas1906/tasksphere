package com.tasksphere.core.config;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

@Component
public class JwtTokenProvider {

    private static final Logger log = LoggerFactory.getLogger(JwtTokenProvider.class);

    private final SecretKey key;
    private final long expirationMs;

    public JwtTokenProvider(
            @Value("${security.jwt.secret}") String secret,
            @Value("${security.jwt.expiration-ms}") long expirationMs) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationMs = expirationMs;
        log.info("[JWT-PROVIDER] Initialized — key algorithm: {}, expiration: {}ms ({} hours).",
                key.getAlgorithm(), expirationMs, expirationMs / 3_600_000);
    }

    public String generateToken(String subject) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + expirationMs);
        String token = Jwts.builder()
                .subject(subject)
                .issuedAt(now)
                .expiration(expiryDate)
                .signWith(key)
                .compact();
        log.debug("[JWT-PROVIDER] Token generated for subject '{}', expires at {}.", subject, expiryDate);
        return token;
    }

    public String getUsernameFromToken(String token) {
        Claims claims = Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
        return claims.getSubject();
    }

    public boolean validateToken(String token) {
        try {
            Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token);
            return true;
        } catch (ExpiredJwtException e) {
            log.warn("[JWT-PROVIDER] Token expired: {}", e.getMessage());
        } catch (MalformedJwtException e) {
            log.warn("[JWT-PROVIDER] Malformed token: {}", e.getMessage());
        } catch (io.jsonwebtoken.security.SignatureException e) {
            log.warn("[JWT-PROVIDER] Invalid signature — signing key mismatch or token tampered: {}", e.getMessage());
        } catch (JwtException e) {
            log.warn("[JWT-PROVIDER] JWT validation error: {}", e.getMessage());
        } catch (IllegalArgumentException e) {
            log.warn("[JWT-PROVIDER] Token is null/empty/whitespace-only: {}", e.getMessage());
        }
        return false;
    }
}
