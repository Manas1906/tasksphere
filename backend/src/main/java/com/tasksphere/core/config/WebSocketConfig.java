package com.tasksphere.core.config;

import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

import java.security.Principal;
import java.util.List;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private UserSessionRepository userSessionRepository;

    @Autowired
    @org.springframework.context.annotation.Lazy
    private com.tasksphere.core.service.GroupChatService groupChatService;

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // Broadcast prefix for outgoing messages from server to clients
        config.enableSimpleBroker("/topic", "/queue");
        // Route prefix for incoming messages from clients to @MessageMapping controllers
        config.setApplicationDestinationPrefixes("/app");
        // User destination prefix for private queue routing
        config.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureWebSocketTransport(org.springframework.web.socket.config.annotation.WebSocketTransportRegistration registration) {
        // Increase limits to accommodate base64-encoded file attachments in chat messages.
        // Default inbound limit is 64KB which is too small for inline image embeds.
        registration.setMessageSizeLimit(10 * 1024 * 1024);      // 10 MB inbound per STOMP frame
        registration.setSendBufferSizeLimit(10 * 1024 * 1024);    // 10 MB outbound send buffer
        registration.setSendTimeLimit(30 * 1000);                  // 30s send timeout
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Handshake endpoint for WebSocket clients
        registry.addEndpoint("/ws-tasksphere")
                .setAllowedOriginPatterns("*")
                .withSockJS(); // Enable SockJS support for browsers without native WebSockets
    }

    /**
     * Intercept STOMP CONNECT frames to extract the JWT username (email) and set the actual
     * database username as the user principal. This enables convertAndSendToUser() to route
     * private messages to specific users for voice call signaling and alerts.
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

                if (accessor != null) {
                    if (StompCommand.CONNECT.equals(accessor.getCommand())) {
                        List<String> usernameHeaders = accessor.getNativeHeader("username");
                        String clientUsername = (usernameHeaders != null && !usernameHeaders.isEmpty()) ? usernameHeaders.get(0) : null;

                        List<String> authHeaders = accessor.getNativeHeader("Authorization");
                        if (authHeaders != null && !authHeaders.isEmpty()) {
                            String bearerToken = authHeaders.get(0);
                            if (bearerToken != null && bearerToken.startsWith("Bearer ")) {
                                String token = bearerToken.substring(7);
                                try {
                                    if (jwtTokenProvider.validateToken(token)) {
                                        String email = jwtTokenProvider.getUsernameFromToken(token);
                                        
                                        String username = clientUsername;
                                        if (username == null || username.trim().isEmpty()) {
                                            // Retrieve the database username using the email
                                            username = userSessionRepository.findByEmail(email)
                                                    .map(UserSession::getUsername)
                                                    .orElse(email); // Fallback to email if not found in db
                                        }
                                                
                                        final String finalUsername = username;
                                        accessor.setUser(new Principal() {
                                            @Override
                                            public String getName() {
                                                return finalUsername;
                                            }
                                        });
                                        System.out.println("[WS-AUTH] STOMP principal set for user: " + finalUsername + " (resolved from email: " + email + ")");
                                    }
                                } catch (Exception e) {
                                    System.err.println("[WS-AUTH] Failed to authenticate STOMP connection: " + e.getMessage());
                                }
                            }
                        }
                    } else if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
                        String destination = accessor.getDestination();
                        if (destination != null && destination.startsWith("/topic/group.")) {
                            String groupIdStr = destination.substring("/topic/group.".length());
                            try {
                                Long groupId = Long.parseLong(groupIdStr);
                                Principal principal = accessor.getUser();
                                String username = (principal != null) ? principal.getName() : null;
                                if (username == null || !groupChatService.isMember(groupId, username)) {
                                    throw new java.lang.IllegalArgumentException("Unauthorized subscription to group chat topic");
                                }
                                System.out.println("[WS-AUTH] Authorized subscription for: " + username + " on group destination: " + destination);
                            } catch (Exception e) {
                                throw new java.lang.IllegalArgumentException("Unauthorized subscription to group chat topic");
                            }
                        }
                    }
                }
                return message;
            }
        });
    }
}

