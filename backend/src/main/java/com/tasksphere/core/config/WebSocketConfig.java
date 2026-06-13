package com.tasksphere.core.config;

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
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Handshake endpoint for WebSocket clients
        registry.addEndpoint("/ws-tasksphere")
                .setAllowedOriginPatterns("*")
                .withSockJS(); // Enable SockJS support for browsers without native WebSockets
    }

    /**
     * Intercept STOMP CONNECT frames to extract the JWT username and set it
     * as the user principal. This enables convertAndSendToUser() to route
     * private messages to specific users for voice call signaling.
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

                if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
                    List<String> authHeaders = accessor.getNativeHeader("Authorization");
                    if (authHeaders != null && !authHeaders.isEmpty()) {
                        String bearerToken = authHeaders.get(0);
                        if (bearerToken != null && bearerToken.startsWith("Bearer ")) {
                            String token = bearerToken.substring(7);
                            try {
                                if (jwtTokenProvider.validateToken(token)) {
                                    String username = jwtTokenProvider.getUsernameFromToken(token);
                                    accessor.setUser(new Principal() {
                                        @Override
                                        public String getName() {
                                            return username;
                                        }
                                    });
                                    System.out.println("[WS-AUTH] STOMP principal set for user: " + username);
                                }
                            } catch (Exception e) {
                                System.err.println("[WS-AUTH] Failed to authenticate STOMP connection: " + e.getMessage());
                            }
                        }
                    }
                }
                return message;
            }
        });
    }
}
