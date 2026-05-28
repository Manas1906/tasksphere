package com.tasksphere.core.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@Service
public class GitHubOAuthService {

    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${security.github.client-id:}")
    private String clientId;

    @Value("${security.github.client-secret:}")
    private String clientSecret;

    /**
     * Swaps temporary authorization code for a secure GitHub access token.
     */
    public String exchangeCodeForToken(String code) {
        if (code == null || code.trim().isEmpty()) {
            throw new IllegalArgumentException("Authorization code from GitHub is missing.");
        }

        String url = "https://github.com/login/oauth/access_token";

        Map<String, String> requestPayload = new HashMap<>();
        requestPayload.put("client_id", clientId != null ? clientId.trim() : "");
        requestPayload.put("client_secret", clientSecret != null ? clientSecret.trim() : "");
        requestPayload.put("code", code.trim());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));

        HttpEntity<Map<String, String>> request = new HttpEntity<>(requestPayload, headers);

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(url, request, Map.class);
            Map<String, Object> body = response.getBody();
            if (body == null || !body.containsKey("access_token")) {
                throw new SecurityException("GitHub OAuth token exchange failed: No access token returned.");
            }
            return (String) body.get("access_token");
        } catch (Exception e) {
            throw new SecurityException("Failed to exchange authorization code with GitHub: " + e.getMessage(), e);
        }
    }

    /**
     * Retrieves basic profile metadata (username, avatar, numeric id) from GitHub.
     */
    public Map<String, Object> getGitHubProfile(String accessToken) {
        String url = "https://api.github.com/user";

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));

        HttpEntity<Void> entity = new HttpEntity<>(headers);

        try {
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, entity, Map.class);
            Map<String, Object> body = response.getBody();
            if (body == null || !body.containsKey("id")) {
                throw new SecurityException("Invalid profile payload returned from GitHub.");
            }
            return body;
        } catch (Exception e) {
            throw new SecurityException("Failed to query GitHub user profile: " + e.getMessage(), e);
        }
    }

    /**
     * Retrieves all registered emails and parses to find the primary, verified email.
     * Prevents hijacking vulnerabilities via unverified emails.
     */
    public String getPrimaryVerifiedEmail(String accessToken) {
        String url = "https://api.github.com/user/emails";

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));

        HttpEntity<Void> entity = new HttpEntity<>(headers);

        try {
            ResponseEntity<List> response = restTemplate.exchange(url, HttpMethod.GET, entity, List.class);
            List<Map<String, Object>> emailsList = response.getBody();
            
            if (emailsList == null || emailsList.isEmpty()) {
                throw new SecurityException("No emails associated with this GitHub account.");
            }

            // Iterate to find primary and verified email
            for (Map<String, Object> emailObj : emailsList) {
                Boolean verified = (Boolean) emailObj.get("verified");
                Boolean primary = (Boolean) emailObj.get("primary");
                
                if (verified != null && verified && primary != null && primary) {
                    return (String) emailObj.get("email");
                }
            }

            // Fallback: Return any verified email if primary is not flagged
            for (Map<String, Object> emailObj : emailsList) {
                Boolean verified = (Boolean) emailObj.get("verified");
                if (verified != null && verified) {
                    return (String) emailObj.get("email");
                }
            }

            throw new SecurityException("GitHub sign-in rejected: Your GitHub primary email address is unverified.");
        } catch (SecurityException se) {
            throw se;
        } catch (Exception e) {
            throw new SecurityException("Failed to query GitHub email registry: " + e.getMessage(), e);
        }
    }
}
