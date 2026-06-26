package com.tasksphere.core.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthenticationFilter.class);

    private final JwtTokenProvider tokenProvider;

    public JwtAuthenticationFilter(JwtTokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String requestUri = request.getRequestURI();
        try {
            String jwt = getJwtFromRequest(request);

            if (!StringUtils.hasText(jwt)) {
                log.debug("[JWT-FILTER] No Bearer token on request: {} {} — proceeding unauthenticated.",
                        request.getMethod(), requestUri);
            } else if (tokenProvider.validateToken(jwt)) {
                String principal = tokenProvider.getUsernameFromToken(jwt);
                log.debug("[JWT-FILTER] Valid token for principal '{}' on {} {}.", principal, request.getMethod(), requestUri);

                UserDetails userDetails = new User(principal, "", Collections.emptyList());
                UsernamePasswordAuthenticationToken authentication =
                        new UsernamePasswordAuthenticationToken(userDetails, null, userDetails.getAuthorities());
                authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            } else {
                // Token present but failed validation — log enough detail to diagnose without exposing the raw token
                String tokenPrefix = jwt.length() > 20 ? jwt.substring(0, 20) + "..." : jwt;
                log.warn("[JWT-FILTER] ⚠️ Token validation FAILED for {} {} — token prefix: '{}'." +
                                " Possible causes: wrong signing key, expired token, or malformed JWT.",
                        request.getMethod(), requestUri, tokenPrefix);
            }
        } catch (Exception ex) {
            log.error("[JWT-FILTER] ❌ Unexpected exception during JWT processing for {} {}: {} — clearing security context.",
                    request.getMethod(), requestUri, ex.getMessage(), ex);
            SecurityContextHolder.clearContext();
        }

        filterChain.doFilter(request, response);
    }

    private String getJwtFromRequest(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");
        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7).trim(); // trim to guard against accidental whitespace
        }
        return null;
    }
}
