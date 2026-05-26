package com.tasksphere.core.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.tasksphere.core.model.Task;
import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;
import lombok.Builder;
import lombok.Data;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class SprintSimulationService {

    @Value("${gemini.api.key}")
    private String geminiApiKey;

    @Autowired
    private TaskService taskService;

    @Autowired
    private UserSessionRepository userSessionRepository;

    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    @Data
    @Builder
    public static class SprintForecastResponse {
        private int completionLikelihood; // 0 to 100
        private String riskTier;           // LOW, MEDIUM, HIGH
        private int daysRemaining;
        private List<String> bottlenecks;  // Identified SLA exceptions & overloads
        private List<String> recommendations; // Gemini AI recommendations
    }

    /**
     * Executes the predictive sprint simulation using Monte Carlo calculations and Gemini analysis.
     */
    public SprintForecastResponse runSprintSimulation() {
        System.out.println("[SPRINT-SIMULATOR] Querying sprint backlog and workload states...");

        List<Task> allTasks = taskService.getAllTasks();
        List<UserSession> allUsers = userSessionRepository.findAll();

        // 1. Calculate Sprint Boundaries and Days Remaining
        LocalDate today = LocalDate.now();
        LocalDate sprintEndDate = today.plusDays(6); // default 6 days remaining fallback

        // Find the latest due date among all tasks to establish the sprint deadline
        LocalDate latestDue = null;
        for (Task t : allTasks) {
            if (t.getDueDate() != null) {
                LocalDate due = LocalDate.parse(t.getDueDate().toString());
                if (latestDue == null || due.isAfter(latestDue)) {
                    latestDue = due;
                }
            }
        }
        if (latestDue != null && latestDue.isAfter(today)) {
            sprintEndDate = latestDue;
        }
        int daysRemaining = (int) Math.max(1, ChronoUnit.DAYS.between(today, sprintEndDate));

        // 2. Aggregate Developer Workloads
        Map<String, Integer> userBacklogs = new HashMap<>();
        List<String> bottlenecks = new ArrayList<>();
        int totalOutstandingPoints = 0;
        int overdueTasksCount = 0;
        int unassignedHighPriorityCount = 0;

        String todayStr = today.format(DateTimeFormatter.ISO_LOCAL_DATE);

        for (Task t : allTasks) {
            if ("DONE".equalsIgnoreCase(t.getStatus())) {
                continue; // skip completed tasks
            }

            int points = t.getStoryPoints();
            totalOutstandingPoints += points;


            // Check for overdue SLA tasks
            if (t.getDueDate() != null && t.getDueDate().toString().compareTo(todayStr) < 0) {
                overdueTasksCount++;
                bottlenecks.add("🚨 **Critical Path Blockage**: Task #" + t.getId() + " ('" + t.getTitle() + "') is OVERDUE.");
            }

            // Check for unassigned high-priority tasks
            if (t.getAssignee() == null && ("HIGH".equalsIgnoreCase(t.getPriority()) || "CRITICAL".equalsIgnoreCase(t.getPriority()))) {
                unassignedHighPriorityCount++;
                bottlenecks.add("⚠️ **Unassigned Risk**: High-priority Task #" + t.getId() + " ('" + t.getTitle() + "') has no assignee.");
            }

            // Collate backlogs per active user
            if (t.getAssignee() != null) {
                String username = t.getAssignee().getUsername();
                userBacklogs.put(username, userBacklogs.getOrDefault(username, 0) + points);
            }
        }

        // Check for overloaded developers (> 13 SP outstanding)
        for (Map.Entry<String, Integer> entry : userBacklogs.entrySet()) {
            if (entry.getValue() > 13) {
                bottlenecks.add("👤 **Resource Bottleneck**: Teammate '" + entry.getKey() + "' is overloaded with " + entry.getValue() + " Story Points.");
            }
        }

        // 3. Mathematical Monte Carlo Simulation (1,000 Iterations)
        int successfulRuns = 0;
        int totalIterations = 1000;
        Random random = new Random();

        for (int i = 0; i < totalIterations; i++) {
            boolean allFinished = true;

            for (Map.Entry<String, Integer> entry : userBacklogs.entrySet()) {
                int pointsNeeded = entry.getValue();
                double simulatedCapacity = 0.0;

                // Simulate daily capacity over the remaining days with random Gaussian noise
                // Average developer daily velocity is centered around 2.0 story points with a standard deviation of 0.8
                for (int d = 0; d < daysRemaining; d++) {
                    double dailyVelocity = Math.max(0.0, 2.0 + random.nextGaussian() * 0.8);
                    simulatedCapacity += dailyVelocity;
                }

                if (simulatedCapacity < pointsNeeded) {
                    allFinished = false;
                    break; // this path failed
                }
            }

            if (allFinished) {
                successfulRuns++;
            }
        }

        // If no tasks exist or no workloads are mapped, the simulation is always 100% successful
        int completionLikelihood = userBacklogs.isEmpty() ? 100 : (int) Math.round((double) successfulRuns / 10.0);
        
        // Define Risk Tier based on Completion Likelihood
        String riskTier = "LOW";
        if (completionLikelihood < 50) {
            riskTier = "HIGH";
        } else if (completionLikelihood < 80) {
            riskTier = "MEDIUM";
        }

        System.out.println("[SPRINT-SIMULATOR] Monte Carlo simulation complete. Success likelihood: " + completionLikelihood + "%, Risk Tier: " + riskTier);

        // 4. Query Google Gemini API for advanced Sprint Rebalancing Advice
        List<String> recommendations = fetchAiRecommendations(
                completionLikelihood, riskTier, daysRemaining, totalOutstandingPoints,
                overdueTasksCount, unassignedHighPriorityCount, userBacklogs, bottlenecks
        );

        return SprintForecastResponse.builder()
                .completionLikelihood(completionLikelihood)
                .riskTier(riskTier)
                .daysRemaining(daysRemaining)
                .bottlenecks(bottlenecks)
                .recommendations(recommendations)
                .build();
    }

    /**
     * Sends calculated metrics to Gemini to parse intelligent recommendations.
     */
    private List<String> fetchAiRecommendations(
            int likelihood, String risk, int daysLeft, int pointsLeft,
            int overdueCount, int unassignedCount, Map<String, Integer> backlogs, List<String> bottlenecks
    ) {
        System.out.println("[SPRINT-SIMULATOR] Fetching AI Agile Sprint advice from Gemini...");

        try {
            // Build the analytical prompt representing the sprint context
            StringBuilder promptBuilder = new StringBuilder();
            promptBuilder.append("System Context: You are the Lead Agile Scrum Master Co-Pilot in TaskSphere.\n");
            promptBuilder.append("You must analyze the following sprint diagnostic metrics and provide exactly 3 or 4 short, highly focused, actionable rebalancing recommendations to the team to reduce risk and deliver the sprint backlog.\n\n");
            
            promptBuilder.append(String.format("Sprint Diagnostic Metrics:\n"));
            promptBuilder.append(String.format("- Simulated Success Likelihood: %d%%\n", likelihood));
            promptBuilder.append(String.format("- Calculated Risk Level: %s\n", risk));
            promptBuilder.append(String.format("- Days Remaining in Sprint: %d days\n", daysLeft));
            promptBuilder.append(String.format("- Backlog Story Points Outstanding: %d SP\n", pointsLeft));
            promptBuilder.append(String.format("- Overdue Tasks Count: %d\n", overdueCount));
            promptBuilder.append(String.format("- Unassigned High/Critical Priority Tasks: %d\n\n", unassignedCount));
            
            promptBuilder.append("Current Developer Story Point Workloads:\n");
            if (backlogs.isEmpty()) {
                promptBuilder.append("- No active developer workloads are mapped.\n");
            } else {
                for (Map.Entry<String, Integer> entry : backlogs.entrySet()) {
                    promptBuilder.append(String.format("- '%s': %d SP outstanding\n", entry.getKey(), entry.getValue()));
                }
            }
            
            promptBuilder.append("\nIdentified Bottlenecks & SLA Blockages:\n");
            if (bottlenecks.isEmpty()) {
                promptBuilder.append("- No critical blockages identified.\n");
            } else {
                for (String b : bottlenecks) {
                    promptBuilder.append("- ").append(b.replaceAll("\\*\\*", "")).append("\n");
                }
            }

            promptBuilder.append("\nRequirements: Return a JSON array of strings containing exactly 3 or 4 actionable recommendations. Keep each recommendation under 15 words and make them very specific, direct, and practical (e.g. 'Reassign high-priority ticket from overloaded user X to Y'). Do not return markdown, blocks, or explanation text. Just return the JSON array of strings.");

            ObjectNode root = mapper.createObjectNode();
            ArrayNode contents = root.putArray("contents");
            ObjectNode turn = contents.addObject();
            turn.put("role", "user");
            ArrayNode parts = turn.putArray("parts");
            parts.addObject().put("text", promptBuilder.toString());

            // Build system instruction
            ObjectNode systemInstruction = root.putObject("systemInstruction");
            ArrayNode systemParts = systemInstruction.putArray("parts");
            systemParts.addObject().put("text", "You are the Lead Agile Scrum Master assistant. You output ONLY a JSON array of strings containing Scrum rebalancing recommendations.");

            // Configure JSON response requirement
            ObjectNode config = root.putObject("generationConfig");
            config.put("responseMimeType", "application/json");

            String responseBody = callGeminiApiWithRetry(mapper.writeValueAsString(root));
            JsonNode resTree = mapper.readTree(responseBody);
            String rawJsonArray = resTree.path("candidates").get(0).path("content").path("parts").get(0).path("text").asText();
            
            // Clean the string in case Gemini included markdown fence wraps
            rawJsonArray = rawJsonArray.replaceAll("```json", "").replaceAll("```", "").trim();
            
            JsonNode recommendationsNode = mapper.readTree(rawJsonArray);
            List<String> list = new ArrayList<>();
            if (recommendationsNode.isArray()) {
                for (JsonNode node : recommendationsNode) {
                    list.add(node.asText());
                }
            }
            
            if (!list.isEmpty()) {
                return list;
            }
        } catch (Exception e) {
            System.err.println("[SPRINT-SIMULATOR-WARNING] Gemini recommendations failed: " + e.getMessage() + ". Diverting to local fallback templates.");
        }

        // Return a highly relevant localized fallback template if the API is down
        return getLocalRecommendations(risk, overdueCount, unassignedCount, backlogs);
    }

    /**
     * Highly resilient API REST caller with retries and exponential backoff.
     */
    private String callGeminiApiWithRetry(String jsonPayload) throws Exception {
        String url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + geminiApiKey;
        
        int retries = 3;
        long delayMs = 300;
        
        for (int i = 0; i <= retries; i++) {
            try {
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
                        .build();
                
                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                
                int status = response.statusCode();
                if (status == 200) {
                    return response.body();
                }
                
                if ((status == 503 || status == 429 || status == 500) && i < retries) {
                    System.out.println("[AI-BOT-RETRY] Received transient status " + status + " from Gemini. Retrying in " + delayMs + "ms... (Attempt " + (i + 1) + ")");
                    Thread.sleep(delayMs);
                    delayMs *= 2;
                } else {
                    throw new RuntimeException("Gemini API returned status " + status + ": " + response.body());
                }
            } catch (Exception e) {
                if (i == retries) {
                    throw e;
                }
                System.out.println("[AI-BOT-RETRY-ERROR] Failed request to Gemini: " + e.getMessage() + ". Retrying in " + delayMs + "ms... (Attempt " + (i + 1) + ")");
                Thread.sleep(delayMs);
                delayMs *= 2;
            }
        }
        throw new RuntimeException("Failed to call Gemini API.");
    }

    /**
     * Localized advice generator used during API offline/degraded states.
     */
    private List<String> getLocalRecommendations(String risk, int overdueCount, int unassignedCount, Map<String, Integer> backlogs) {
        List<String> list = new ArrayList<>();
        
        if (overdueCount > 0) {
            list.add("Move overdue active blockages to IN_PROGRESS or split them into smaller, deliverable subtasks.");
        }
        if (unassignedCount > 0) {
            list.add("Immediately assign the outstanding high-priority unassigned cards to active developers.");
        }
        
        // Overload checking
        String overloadedUser = null;
        String underloadedUser = null;
        int maxPoints = 0;
        int minPoints = Integer.MAX_VALUE;
        
        for (Map.Entry<String, Integer> entry : backlogs.entrySet()) {
            if (entry.getValue() > maxPoints) {
                maxPoints = entry.getValue();
                overloadedUser = entry.getKey();
            }
            if (entry.getValue() < minPoints) {
                minPoints = entry.getValue();
                underloadedUser = entry.getKey();
            }
        }
        
        if (overloadedUser != null && maxPoints > 13) {
            if (underloadedUser != null && !overloadedUser.equals(underloadedUser)) {
                list.add("Shift active story tickets from overloaded '" + overloadedUser + "' (" + maxPoints + " SP) to '" + underloadedUser + "' (" + minPoints + " SP).");
            } else {
                list.add("Reduce the backlog capacity for '" + overloadedUser + "' and defer lower-priority cards to the next sprint.");
            }
        }
        
        list.add("Encourage daily standalone syncs to map critical path blockers early and protect the sprint goal.");
        
        if (list.size() < 3) {
            list.add("Groom active backlog items to ensure clear given-when-then acceptance criteria are defined.");
        }
        
        return list;
    }
}
