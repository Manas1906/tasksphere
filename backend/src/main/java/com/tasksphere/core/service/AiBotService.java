package com.tasksphere.core.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.tasksphere.core.model.ChatMessage;
import com.tasksphere.core.model.Task;
import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.TaskRepository;
import com.tasksphere.core.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class AiBotService {

    @Value("${gemini.api.key}")
    private String geminiApiKey;

    @Autowired
    private ChatService chatService;

    @Autowired
    private TaskService taskService;

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private UserSessionRepository userSessionRepository;

    @Autowired
    private RedisCacheService redisCacheService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /**
     * Entrypoint for processing chat messages asynchronously.
     */
    @Async("taskExecutor")
    public void processAiRequest(String userWhoTalked, String userAvatar, String textMessage, boolean isDm) {
        System.out.println("[AI-BOT] Processing request asynchronously from " + userWhoTalked + ": " + textMessage);
        
        try {
            // Give the frontend a nice subtle visual hint that the bot is thinking/working
            // We can do this by sending a temporary user presence typing event or message if desired.
            
            // Clean the user message for processing: strip the @Agile_AI_Bot tag if public
            String cleanText = textMessage;
            if (!isDm) {
                cleanText = textMessage.replaceAll("(?i)@Agile_AI_Bot", "").trim();
            } else {
                // Strip the [DM:Agile_AI_Bot] prefix
                if (cleanText.startsWith("[DM:")) {
                    cleanText = cleanText.substring(cleanText.indexOf("]") + 1).trim();
                }
            }

            // Step 1: Call Gemini with Tool Use configuration
            String jsonPayload = buildGeminiPayload(cleanText, userWhoTalked);
            String responseBody = callGeminiApi(jsonPayload);
            
            // Step 2: Parse Gemini response for function calls or direct text
            JsonNode root = mapper.readTree(responseBody);
            JsonNode firstCandidate = root.path("candidates").get(0);
            JsonNode firstPart = firstCandidate.path("content").path("parts").get(0);
            
            String finalAgileReply = "";
            
            if (firstPart.has("functionCall")) {
                JsonNode functionCall = firstPart.get("functionCall");
                String functionName = functionCall.get("name").asText();
                JsonNode args = functionCall.get("args");
                
                System.out.println("[AI-BOT-TOOL] Gemini requested tool execution: " + functionName + " with args: " + args);
                
                // Step 3: Dynamic execution of the tool
                String executionResult = executeTool(functionName, args);
                System.out.println("[AI-BOT-TOOL] Tool execution completed. Result: " + executionResult);
                
                // Step 4: Ask Gemini to summarize the completed action
                finalAgileReply = requestGeminiConfirmation(cleanText, functionName, args, executionResult);
            } else if (firstPart.has("text")) {
                // Direct response without tools
                finalAgileReply = firstPart.get("text").asText();
            } else {
                finalAgileReply = "I processed your request, but I did not receive a clear response from my Scrum cognitive engine. Please verify your command format!";
            }

            // Step 5: Save AI reply to database and broadcast to WebSockets
            String replyPrefix = isDm ? "[DM:" + userWhoTalked + "] " : "";
            
            ChatMessage botMessage = ChatMessage.builder()
                    .username("Agile_AI_Bot")
                    .avatarUrl("https://api.dicebear.com/7.x/bottts/svg?seed=AgileAiBot")
                    .message(replyPrefix + finalAgileReply.trim())
                    .timestamp(Instant.now())
                    .build();
            
            // Save to database
            ChatMessage saved = chatService.saveMessage(botMessage);
            
            // Cache in Redis
            redisCacheService.cacheChatMessage(saved);
            
            // Broadcast over WebSocket channel
            messagingTemplate.convertAndSend("/topic/chat", saved);
            System.out.println("[AI-BOT] Dispatched reply successfully: " + saved.getMessage());
            
        } catch (Exception e) {
            System.err.println("[AI-BOT-ERROR] Encountered exception while orchestrating AI response: " + e.getMessage());
            e.printStackTrace();
            
            // Send graceful error message back to user so the UI is never hanging
            try {
                String errorMsg = "⚠️ **[Scrum AI Agent Error]**: " + e.getMessage() + 
                                  "\n\n*Local Recovery*: The task database has remained intact. Please retry in a few moments.";
                String replyPrefix = isDm ? "[DM:" + userWhoTalked + "] " : "";
                
                ChatMessage errBotMessage = ChatMessage.builder()
                        .username("Agile_AI_Bot")
                        .avatarUrl("https://api.dicebear.com/7.x/bottts/svg?seed=AgileAiBot")
                        .message(replyPrefix + errorMsg)
                        .timestamp(Instant.now())
                        .build();
                
                ChatMessage saved = chatService.saveMessage(errBotMessage);
                redisCacheService.cacheChatMessage(saved);
                messagingTemplate.convertAndSend("/topic/chat", saved);
            } catch (Exception ex) {
                System.err.println("[AI-BOT-FATAL] Failed to send error packet to user: " + ex.getMessage());
            }
        }
    }

    /**
     * Executes database operations corresponding to requested Gemini tools.
     */
    private String executeTool(String name, JsonNode args) throws Exception {
        switch (name) {
            case "listTasks": {
                List<Task> tasks = taskService.getAllTasks();
                if (tasks.isEmpty()) {
                    return "No tasks exist currently on the Kanban board.";
                }
                StringBuilder sb = new StringBuilder("Current Kanban tasks:\n");
                for (Task t : tasks) {
                    String assignee = t.getAssignee() != null ? t.getAssignee().getUsername() : "Unassigned";
                    sb.append(String.format("- ID: %d | Title: '%s' | Status: %s | Priority: %s | Assignee: %s | Points: %d\n",
                            t.getId(), t.getTitle(), t.getStatus(), t.getPriority(), assignee, t.getStoryPoints()));
                }
                return sb.toString();
            }
            case "createTask": {
                String title = args.path("title").asText();
                String description = args.path("description").asText("");
                String status = args.path("status").asText("TODO");
                String priority = args.path("priority").asText("MEDIUM");
                int storyPoints = args.path("storyPoints").asInt(1);
                String assigneeUsername = args.path("assigneeUsername").asText("");

                Task task = Task.builder()
                        .title(title)
                        .description(description)
                        .status(status.toUpperCase().trim())
                        .priority(priority.toUpperCase().trim())
                        .storyPoints(storyPoints)
                        .createdAt(Instant.now())
                        .updatedAt(Instant.now())
                        .build();

                if (!assigneeUsername.isEmpty()) {
                    Optional<UserSession> userOpt = userSessionRepository.findByUsername(assigneeUsername.trim());
                    userOpt.ifPresent(task::setAssignee);
                }

                Task saved = taskService.createTask(task);

                // Broadcast task creation payload to sync board views in real-time
                messagingTemplate.convertAndSend("/topic/board", Map.of(
                        "taskId", saved.getId(),
                        "title", saved.getTitle(),
                        "fromStatus", "",
                        "toStatus", saved.getStatus(),
                        "username", "Agile_AI_Bot"
                ));

                return "Task successfully created! ID: " + saved.getId() + ", Status: " + saved.getStatus();
            }
            case "updateTaskStatus": {
                long taskId = args.path("taskId").asLong();
                String status = args.path("status").asText().toUpperCase().trim();

                Task task = taskService.getTaskById(taskId);
                String oldStatus = task.getStatus();
                Task updated = taskService.updateTaskStatus(taskId, status);

                // Broadcast task move payload to update board visually
                messagingTemplate.convertAndSend("/topic/board", Map.of(
                        "taskId", updated.getId(),
                        "title", updated.getTitle(),
                        "fromStatus", oldStatus,
                        "toStatus", updated.getStatus(),
                        "username", "Agile_AI_Bot"
                ));

                return "Task ID " + taskId + " status updated from " + oldStatus + " to " + updated.getStatus();
            }
            case "reassignTask": {
                long taskId = args.path("taskId").asLong();
                String assigneeUsername = args.path("assigneeUsername").asText().trim();

                Task task = taskService.getTaskById(taskId);
                UserSession newAssignee = null;
                if (!assigneeUsername.isEmpty()) {
                    newAssignee = userSessionRepository.findByUsername(assigneeUsername)
                            .orElseThrow(() -> new IllegalArgumentException("Teammate with username '" + assigneeUsername + "' not found."));
                }

                task.setAssignee(newAssignee);
                task.setUpdatedAt(Instant.now());
                Task updated = taskRepository.save(task);

                // Broadcast reassign updates to refresh board visuals
                messagingTemplate.convertAndSend("/topic/board", Map.of(
                        "taskId", updated.getId(),
                        "title", updated.getTitle(),
                        "fromStatus", updated.getStatus(),
                        "toStatus", updated.getStatus(),
                        "username", "Agile_AI_Bot"
                ));

                String newAssigneeStr = newAssignee != null ? newAssignee.getUsername() : "Unassigned";
                return "Task ID " + taskId + " has been successfully reassigned to " + newAssigneeStr;
            }
            case "deleteTask": {
                long taskId = args.path("taskId").asLong();
                taskService.deleteTask(taskId);

                // Broadcast delete updates to pull card off board
                messagingTemplate.convertAndSend("/topic/board", Map.of(
                        "taskId", taskId,
                        "title", "Deleted Task",
                        "fromStatus", "",
                        "toStatus", "DELETED",
                        "username", "Agile_AI_Bot"
                ));

                return "Task ID " + taskId + " has been successfully deleted from the board.";
            }
            default:
                throw new UnsupportedOperationException("Requested tool '" + name + "' is not supported by Agile_AI_Bot.");
        }
    }

    /**
     * Calls Gemini with the tool action results to get a sleek Agile teammate reply.
     */
    private String requestGeminiConfirmation(String originalQuery, String toolName, JsonNode toolArgs, String executionResult) {
        try {
            System.out.println("[AI-BOT] Querying Gemini for tool confirmation response...");
            
            String prompt = String.format(
                    "System Context: The user asked: '%s'. You successfully executed the tool '%s' with parameters %s. " +
                    "The database operation returned the following result:\n\"%s\"\n\n" +
                    "Formulate a concise, highly professional Scrum-oriented confirmation message to the user informing them " +
                    "that the action has been completed. Keep your response strictly under 4 sentences.",
                    originalQuery, toolName, toolArgs.toString(), executionResult
            );

            ObjectNode root = mapper.createObjectNode();
            ArrayNode contents = root.putArray("contents");
            ObjectNode turn = contents.addObject();
            ArrayNode parts = turn.putArray("parts");
            parts.addObject().put("text", prompt);


            String responseBody = callGeminiApi(mapper.writeValueAsString(root));
            JsonNode resTree = mapper.readTree(responseBody);
            return resTree.path("candidates").get(0).path("content").path("parts").get(0).path("text").asText();
        } catch (Exception e) {
            System.err.println("[AI-BOT-WARNING] Failed to fetch tool confirmation, using default template: " + e.getMessage());
            return "✅ **Scrum Action Completed**:\n" + executionResult;
        }
    }

    /**
     * Makes standard POST connection to Gemini API.
     */
    private String callGeminiApi(String jsonPayload) throws Exception {
        String url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + geminiApiKey;
        
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))

                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
                .build();
        
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        
        if (response.statusCode() != 200) {
            throw new RuntimeException("Gemini API returned status " + response.statusCode() + ": " + response.body());
        }
        
        return response.body();
    }

    /**
     * Builds Jackson ObjectNode representing the Gemini content generation request with full Tools declarations.
     */
    private String buildGeminiPayload(String query, String userWhoTalked) throws Exception {
        ObjectNode root = mapper.createObjectNode();

        // Contents
        ArrayNode contents = root.putArray("contents");
        ObjectNode userTurn = contents.addObject();
        userTurn.put("role", "user");
        ArrayNode parts = userTurn.putArray("parts");
        parts.addObject().put("text", query);

        // System Instruction
        ObjectNode systemInstruction = root.putObject("systemInstruction");
        ArrayNode systemParts = systemInstruction.putArray("parts");
        systemParts.addObject().put("text",
                "You are Agile_AI_Bot, an active virtual teammate in the TaskSphere Scrum board web application. " +
                "You have administrative rights and can directly query or manipulate Kanban tasks in the database using the tools provided. " +
                "You are extremely technical, efficient, and direct. Keep your final answers helpful, professional, and under 4 sentences. " +
                "The active developer talking to you is: " + userWhoTalked + ". " +
                "Always run tools when the user requests actions like listing, creating, moving, reassigning, or deleting tasks!"
        );

        // Tools
        ArrayNode toolsArray = root.putArray("tools");
        ObjectNode toolsObject = toolsArray.addObject();
        ArrayNode functionDeclarations = toolsObject.putArray("functionDeclarations");

        // 1. listTasks
        ObjectNode listTasks = functionDeclarations.addObject();
        listTasks.put("name", "listTasks");
        listTasks.put("description", "List all Kanban tasks currently on the board with their details like ID, title, status, priority, assignee, and story points.");

        // 2. createTask
        ObjectNode createTask = functionDeclarations.addObject();
        createTask.put("name", "createTask");
        createTask.put("description", "Create a new Kanban task on the board.");
        ObjectNode createTaskParams = createTask.putObject("parameters");
        createTaskParams.put("type", "OBJECT");
        ObjectNode createTaskProps = createTaskParams.putObject("properties");
        createTaskProps.putObject("title").put("type", "STRING").put("description", "The title of the task (required).");
        createTaskProps.putObject("description").put("type", "STRING").put("description", "Detailed description of the task.");
        createTaskProps.putObject("status").put("type", "STRING").put("description", "Kanban column status: TODO, IN_PROGRESS, TESTING, DONE. Default is TODO.");
        createTaskProps.putObject("priority").put("type", "STRING").put("description", "Task priority: LOW, MEDIUM, HIGH, CRITICAL. Default is MEDIUM.");
        createTaskProps.putObject("storyPoints").put("type", "INTEGER").put("description", "Fibonacci story points (1, 2, 3, 5, 8, 13). Default is 1.");
        createTaskProps.putObject("assigneeUsername").put("type", "STRING").put("description", "Username of the team member to assign this task to.");
        ArrayNode createTaskReq = createTaskParams.putArray("required");
        createTaskReq.add("title");

        // 3. updateTaskStatus
        ObjectNode updateTaskStatus = functionDeclarations.addObject();
        updateTaskStatus.put("name", "updateTaskStatus");
        updateTaskStatus.put("description", "Move an existing task to a different Kanban column (status).");
        ObjectNode updateTaskStatusParams = updateTaskStatus.putObject("parameters");
        updateTaskStatusParams.put("type", "OBJECT");
        ObjectNode updateTaskStatusProps = updateTaskStatusParams.putObject("properties");
        updateTaskStatusProps.putObject("taskId").put("type", "INTEGER").put("description", "The unique numeric ID of the task.");
        updateTaskStatusProps.putObject("status").put("type", "STRING").put("description", "The new Kanban column status: TODO, IN_PROGRESS, TESTING, DONE.");
        ArrayNode updateTaskStatusReq = updateTaskStatusParams.putArray("required");
        updateTaskStatusReq.add("taskId");
        updateTaskStatusReq.add("status");

        // 4. reassignTask
        ObjectNode reassignTask = functionDeclarations.addObject();
        reassignTask.put("name", "reassignTask");
        reassignTask.put("description", "Assign or reassign a task to a different team member.");
        ObjectNode reassignTaskParams = reassignTask.putObject("parameters");
        reassignTaskParams.put("type", "OBJECT");
        ObjectNode reassignTaskProps = reassignTaskParams.putObject("properties");
        reassignTaskProps.putObject("taskId").put("type", "INTEGER").put("description", "The unique numeric ID of the task.");
        reassignTaskProps.putObject("assigneeUsername").put("type", "STRING").put("description", "The username of the team member to assign this task to.");
        ArrayNode reassignTaskReq = reassignTaskParams.putArray("required");
        reassignTaskReq.add("taskId");
        reassignTaskReq.add("assigneeUsername");

        // 5. deleteTask
        ObjectNode deleteTask = functionDeclarations.addObject();
        deleteTask.put("name", "deleteTask");
        deleteTask.put("description", "Delete a task from the board by its unique numeric ID.");
        ObjectNode deleteTaskParams = deleteTask.putObject("parameters");
        deleteTaskParams.put("type", "OBJECT");
        ObjectNode deleteTaskProps = deleteTaskParams.putObject("properties");
        deleteTaskProps.putObject("taskId").put("type", "INTEGER").put("description", "The unique numeric ID of the task to delete.");
        ArrayNode deleteTaskReq = deleteTaskParams.putArray("required");
        deleteTaskReq.add("taskId");

        return mapper.writeValueAsString(root);
    }
}
