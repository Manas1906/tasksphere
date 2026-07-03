package com.tasksphere.core.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * PokerController — in-memory Planning Poker via STOMP WebSocket.
 *
 * Flow:
 *  1. /app/poker.start   → session opens, all participants see STARTED event
 *  2. /app/poker.vote    → server stores vote; broadcasts VOTED (no value revealed)
 *  3. /app/poker.reveal  → server broadcasts all votes + average; session cleared
 *
 * All events are broadcast on /topic/poker.
 */
@Controller
public class PokerController {

    private static final Logger log = LoggerFactory.getLogger(PokerController.class);

    /** taskId → {username → points} */
    private final ConcurrentHashMap<Long, ConcurrentHashMap<String, Integer>> sessions =
            new ConcurrentHashMap<>();

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @MessageMapping("/poker.start")
    public void startSession(Map<String, Object> payload) {
        Long taskId = Long.valueOf(payload.get("taskId").toString());
        sessions.put(taskId, new ConcurrentHashMap<>());

        Map<String, Object> response = new HashMap<>();
        response.put("event", "STARTED");
        response.put("taskId", taskId);
        response.put("taskTitle", payload.get("taskTitle"));
        response.put("startedBy", payload.get("username"));
        log.info("[POKER] Session started for task #{} by {}", taskId, payload.get("username"));
        messagingTemplate.convertAndSend("/topic/poker", response);
    }

    @MessageMapping("/poker.vote")
    public void submitVote(Map<String, Object> payload) {
        Long taskId = Long.valueOf(payload.get("taskId").toString());
        String username = (String) payload.get("username");
        int points = Integer.parseInt(payload.get("points").toString());

        sessions.computeIfAbsent(taskId, k -> new ConcurrentHashMap<>()).put(username, points);
        int voterCount = sessions.get(taskId).size();

        Map<String, Object> response = new HashMap<>();
        response.put("event", "VOTED");
        response.put("taskId", taskId);
        response.put("username", username);
        response.put("voterCount", voterCount);
        log.info("[POKER] {} voted on task #{}. Total votes: {}", username, taskId, voterCount);
        messagingTemplate.convertAndSend("/topic/poker", response);
    }

    @MessageMapping("/poker.reveal")
    public void revealVotes(Map<String, Object> payload) {
        Long taskId = Long.valueOf(payload.get("taskId").toString());
        Map<String, Integer> votes = sessions.getOrDefault(taskId, new ConcurrentHashMap<>());

        double avg = votes.values().stream().mapToInt(Integer::intValue).average().orElse(0);
        double roundedAvg = Math.round(avg * 10.0) / 10.0;

        Map<String, Object> response = new HashMap<>();
        response.put("event", "REVEALED");
        response.put("taskId", taskId);
        response.put("votes", new HashMap<>(votes));
        response.put("average", roundedAvg);
        log.info("[POKER] Votes revealed for task #{}. Average: {}", taskId, roundedAvg);
        messagingTemplate.convertAndSend("/topic/poker", response);
        sessions.remove(taskId);
    }
}
