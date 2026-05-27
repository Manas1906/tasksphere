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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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

    private static final Logger log = LoggerFactory.getLogger(AiBotService.class);

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
        log.info("[AI-BOT] Processing request asynchronously from {}: {}", userWhoTalked, textMessage);
        
        String cleanText = textMessage;
        try {
            // Give the frontend a nice subtle visual hint that the bot is thinking/working
            // We can do this by sending a temporary user presence typing event or message if desired.
            
            // Clean the user message for processing: strip the @Agile_AI_Bot tag if public
            if (!isDm) {
                cleanText = textMessage.replaceAll("(?i)@Agile_AI_Bot", "").trim();
            } else {
                // Strip the [DM:Agile_AI_Bot] prefix
                if (cleanText.startsWith("[DM:")) {
                    cleanText = cleanText.substring(cleanText.indexOf("]") + 1).trim();
                }
            }

            // Robust Fast-fail check for empty, unconfigured, or default placeholder keys
            if (geminiApiKey == null || geminiApiKey.trim().isEmpty() || geminiApiKey.contains("${GEMINI_API_KEY}")) {
                throw new IllegalArgumentException("Google Gemini API Key is missing or unconfigured.");
            }

            // Step 1: Call Gemini with Tool Use configuration
            String jsonPayload = buildGeminiPayload(textMessage, userWhoTalked, isDm);
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
                
                log.info("[AI-BOT-TOOL] Gemini requested tool execution: {} with args: {}", functionName, args);
                
                // Step 3: Dynamic execution of the tool
                String executionResult = executeTool(functionName, args);
                log.info("[AI-BOT-TOOL] Tool execution completed. Result: {}", executionResult);
                
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
            log.info("[AI-BOT] Dispatched reply successfully: {}", saved.getMessage());
            
        } catch (Exception e) {
            log.error("[AI-BOT-ERROR] Encountered exception while orchestrating AI response: {}", e.getMessage(), e);
            
            // Check if it is a credential, quota, or rate limit error
            boolean isQuotaOrKeyError = e.getMessage() != null && (
                    e.getMessage().contains("403") || 
                    e.getMessage().contains("429") || 
                    e.getMessage().contains("400") ||
                    e.getMessage().toLowerCase().contains("missing") ||
                    e.getMessage().toLowerCase().contains("unconfigured") ||
                    e.getMessage().toLowerCase().contains("leaked") || 
                    e.getMessage().toLowerCase().contains("quota") ||
                    e.getMessage().toLowerCase().contains("resource_exhausted") ||
                    e.getMessage().toLowerCase().contains("permission_denied")
            );
            
            try {
                String recoveryReply;
                if (isQuotaOrKeyError) {
                    recoveryReply = "🤖 *[Offline Recovery Mode: Gemini Key Leaked/Exhausted/Unconfigured]*\n\n" + 
                                    getLocalAgileReply(cleanText) + 
                                    "\n\n*(Scrum Master Tip: Your Google Gemini API Key was reported as leaked/revoked, unconfigured, or your daily free-tier quota was exhausted. Please verify that your active GEMINI_API_KEY environment variable contains a valid key from Google AI Studio.)*";
                } else {
                    recoveryReply = "⚠️ **[Scrum AI Agent Error]**: " + e.getMessage() + 
                                      "\n\n*Local Recovery*: The task database has remained intact. Please retry in a few moments.";
                }
                
                String replyPrefix = isDm ? "[DM:" + userWhoTalked + "] " : "";
                
                ChatMessage errBotMessage = ChatMessage.builder()
                        .username("Agile_AI_Bot")
                        .avatarUrl("https://api.dicebear.com/7.x/bottts/svg?seed=AgileAiBot")
                        .message(replyPrefix + recoveryReply)
                        .timestamp(Instant.now())
                        .build();
                
                ChatMessage saved = chatService.saveMessage(errBotMessage);
                redisCacheService.cacheChatMessage(saved);
                messagingTemplate.convertAndSend("/topic/chat", saved);
            } catch (Exception ex) {
                log.error("[AI-BOT-FATAL] Failed to send error packet to user: {}", ex.getMessage());
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
            log.info("[AI-BOT] Querying Gemini for tool confirmation response...");
            
            String prompt;
            if ("listTasks".equals(toolName)) {
                prompt = String.format(
                        "System Context: The user asked: '%s'. You successfully executed the tool 'listTasks'. " +
                        "The database operation returned the following tasks raw list:\n\"%s\"\n\n" +
                        "Format these tasks into a clean, beautiful Markdown table with columns: ID, Title, Status, Priority, Assignee, and Story Points. " +
                        "Include a very brief, professional Scrum-oriented intro and/or outro sentence. Do NOT truncate, omit, or summarize any rows.",
                        originalQuery, executionResult
                );
            } else {
                prompt = String.format(
                        "System Context: The user asked: '%s'. You successfully executed the tool '%s' with parameters %s. " +
                        "The database operation returned the following result:\n\"%s\"\n\n" +
                        "Formulate a concise, highly professional Scrum-oriented confirmation message to the user informing them " +
                        "that the action has been completed. Keep your response strictly under 4 sentences.",
                        originalQuery, toolName, toolArgs.toString(), executionResult
                );
            }

            ObjectNode root = mapper.createObjectNode();
            ArrayNode contents = root.putArray("contents");
            ObjectNode turn = contents.addObject();
            ArrayNode parts = turn.putArray("parts");
            parts.addObject().put("text", prompt);

            String responseBody = callGeminiApi(mapper.writeValueAsString(root));
            JsonNode resTree = mapper.readTree(responseBody);
            return resTree.path("candidates").get(0).path("content").path("parts").get(0).path("text").asText();
        } catch (Exception e) {
            log.error("[AI-BOT-WARNING] Failed to fetch tool confirmation, using default template: {}", e.getMessage());
            return "✅ **Scrum Action Completed**:\n" + executionResult;
        }
    }

    /**
     * Serves the floating AI Copilot chatbot queries securely using server-side keys.
     */
    public String getChatbotReply(String userMessage) throws Exception {
        if (geminiApiKey == null || geminiApiKey.trim().isEmpty() || geminiApiKey.contains("${GEMINI_API_KEY}")) {
            throw new IllegalArgumentException("Google Gemini API Key is missing or unconfigured.");
        }

        log.info("[AI-BOT] Serving secure floating chatbot query...");

        String systemInstruction = "You are an expert Scrum Master assistant in the TaskSphere Agile tool. Respond concisely (under 3 sentences) to the user's query.";

        ObjectNode root = mapper.createObjectNode();
        ArrayNode contents = root.putArray("contents");
        ObjectNode turn = contents.addObject();
        turn.put("role", "user");
        ArrayNode parts = turn.putArray("parts");
        parts.addObject().put("text", systemInstruction + "\nUser Query: " + userMessage);

        String payload = mapper.writeValueAsString(root);
        String responseBody = callGeminiApi(payload);

        JsonNode resTree = mapper.readTree(responseBody);
        return resTree.path("candidates").get(0).path("content").path("parts").get(0).path("text").asText();
    }

    /**
     * Makes resilient POST connection to Gemini API with exponential backoff retries.
     */
    private String callGeminiApi(String jsonPayload) throws Exception {
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
                
                // Retry only on transient errors (503 Service Unavailable, 429 Rate Limit, 500 Internal Server Error)
                if ((status == 503 || status == 429 || status == 500) && i < retries) {
                    log.warn("[AI-BOT-RETRY] Received transient status {} from Gemini. Retrying in {}ms... (Attempt {})", status, delayMs, i + 1);
                    Thread.sleep(delayMs);
                    delayMs *= 2; // exponential backoff
                } else {
                    throw new RuntimeException("Gemini API returned status " + status + ": " + response.body());
                }
            } catch (Exception e) {
                if (i == retries) {
                    throw e;
                }
                log.error("[AI-BOT-RETRY-ERROR] Failed connection/request to Gemini: {}. Retrying in {}ms... (Attempt {})", e.getMessage(), delayMs, i + 1);
                Thread.sleep(delayMs);
                delayMs *= 2;
            }
        }
        throw new RuntimeException("Failed to contact Google Gemini API after " + retries + " attempts.");
    }


    /**
     * Builds Jackson ObjectNode representing the Gemini content generation request with full Tools declarations.
     */
    private String buildGeminiPayload(String query, String userWhoTalked, boolean isDm) throws Exception {
        ObjectNode root = mapper.createObjectNode();

        // Contents (Stateful Multi-Turn Conversational History with Sliding Window Truncation)
        ArrayNode contents = root.putArray("contents");
        appendConversationalHistory(contents, userWhoTalked, isDm, query);

        // System Instruction (XML-style Prompt Optimization for Gemini 3 Alignment)
        ObjectNode systemInstruction = root.putObject("systemInstruction");
        ArrayNode systemParts = systemInstruction.putArray("parts");
        systemParts.addObject().put("text",
                "<role>\n" +
                "You are Agile_AI_Bot, an active virtual teammate in the TaskSphere Scrum board web application.\n" +
                "</role>\n\n" +
                "<capabilities>\n" +
                "- You have administrative rights to directly query or manipulate Kanban tasks in the database using the tools provided.\n" +
                "- You are extremely technical, efficient, and direct.\n" +
                "</capabilities>\n\n" +
                "<constraints>\n" +
                "- Keep your final answers helpful, professional, and under 4 sentences.\n" +
                "- The active developer talking to you is: " + userWhoTalked + ".\n" +
                "- Always run tools when the user requests actions like listing, creating, moving, reassigning, or deleting tasks!\n" +
                "</constraints>"
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

    private List<ChatMessage> getRelevantHistory(String userWhoTalked, boolean isDm) {
        List<ChatMessage> recent = chatService.getRecentMessages();
        List<ChatMessage> filtered = new java.util.ArrayList<>();
        
        for (ChatMessage msg : recent) {
            String txt = msg.getMessage();
            if (txt == null) continue;
            
            if (isDm) {
                boolean userToBot = msg.getUsername().equalsIgnoreCase(userWhoTalked) && txt.startsWith("[DM:Agile_AI_Bot]");
                boolean botToUser = msg.getUsername().equalsIgnoreCase("Agile_AI_Bot") && txt.startsWith("[DM:" + userWhoTalked + "]");
                if (userToBot || botToUser) {
                    filtered.add(msg);
                }
            } else {
                if (!txt.startsWith("[DM:")) {
                    filtered.add(msg);
                }
            }
        }
        return filtered;
    }

    private String cleanMessageContent(String username, String content) {
        if (content == null) return "";
        String clean = content;
        
        if (clean.startsWith("[DM:")) {
            int closeBracket = clean.indexOf("]");
            if (closeBracket != -1) {
                clean = clean.substring(closeBracket + 1).trim();
            }
        }
        
        clean = clean.replaceAll("(?i)@Agile_AI_Bot", "").trim();
        return clean;
    }

    private void appendConversationalHistory(ArrayNode contents, String userWhoTalked, boolean isDm, String currentQuery) {
        List<ChatMessage> history = getRelevantHistory(userWhoTalked, isDm);
        
        int limit = 12;
        if (history.size() > limit) {
            history = history.subList(history.size() - limit, history.size());
        }
        
        class Turn {
            String role;
            StringBuilder text = new StringBuilder();
            Turn(String role, String text) {
                this.role = role;
                this.text.append(text);
            }
        }
        
        List<Turn> turns = new java.util.ArrayList<>();
        
        for (ChatMessage msg : history) {
            String role = "Agile_AI_Bot".equalsIgnoreCase(msg.getUsername()) ? "model" : "user";
            String text = cleanMessageContent(msg.getUsername(), msg.getMessage());
            if (text.isEmpty()) continue;
            
            if (!turns.isEmpty() && turns.get(turns.size() - 1).role.equals(role)) {
                turns.get(turns.size() - 1).text.append("\n").append(text);
            } else {
                turns.add(new Turn(role, text));
            }
        }
        
        String currentClean = cleanMessageContent(userWhoTalked, currentQuery);
        if (!turns.isEmpty() && turns.get(turns.size() - 1).role.equals("user")) {
            turns.get(turns.size() - 1).text.append("\n").append(currentClean);
        } else {
            turns.add(new Turn("user", currentClean));
        }
        
        int startIndex = 0;
        while (startIndex < turns.size() && !"user".equals(turns.get(startIndex).role)) {
            startIndex++;
        }
        
        for (int i = startIndex; i < turns.size(); i++) {
            Turn t = turns.get(i);
            ObjectNode turnNode = contents.addObject();
            turnNode.put("role", t.role);
            ArrayNode partsNode = turnNode.putArray("parts");
            partsNode.addObject().put("text", t.text.toString());
        }
    }

    /**
     * Resilient fallback method returning rich Scrum advice and live task breakdowns offline.
     */
    private String getLocalAgileReply(String query) {
        String q = query != null ? query.toLowerCase() : "";
        
        if (q.contains("list") || q.contains("task") || q.contains("ticket") || q.contains("show")) {
            try {
                List<Task> tasks = taskService.getAllTasks();
                if (tasks.isEmpty()) {
                    return "I've checked our active sprint board and it is currently empty! All columns are clean. Let me know if you would like me to outline a standard Scrum template for a new feature.";
                }
                
                StringBuilder sb = new StringBuilder("Here is a summary of our active Kanban sprint deliverables (Offline Mode):\n\n");
                for (Task t : tasks) {
                    String assignee = t.getAssignee() != null ? t.getAssignee().getUsername() : "Unassigned";
                    sb.append(String.format("• **Task #%d**: `%s` (Status: *%s*, Assignee: *%s*, Story Points: **%d**)\n",
                            t.getId(), t.getTitle(), t.getStatus(), assignee, t.getStoryPoints()));
                }
                return sb.toString();
            } catch (Exception ex) {
                return "I tried to fetch our active sprint board, but encountered an error. Please verify your local task database configuration!";
            }
        }
        
        if (q.contains("create") || q.contains("add") || q.contains("new")) {
            return "To create a task in Offline Recovery Mode, please use the Kanban board directly by clicking the **+ Add Task** button at the top of the columns. Once your new Google Gemini API key is configured, you can use active commands like: `@Agile_AI_Bot create task...` to build cards instantly!";
        }
        
        if (q.contains("move") || q.contains("status") || q.contains("kanban")) {
            return "In Offline Recovery Mode, you can move cards across columns by dragging and dropping them directly on the board. This updates all collaborative clients instantly over WebSockets!";
        }
        
        if (q.contains("points") || q.contains("estimation") || q.contains("fibonacci")) {
            return "Fibonacci story points (1, 2, 3, 5, 8, 13) represent relative complexity and uncertainty rather than absolute hours. Use planning poker sessions with your team to align velocity estimates!";
        }
        
        if (q.contains("hello") || q.contains("hi") || q.contains("hey")) {
            return "Hello! I am your Agile Scrum Assistant. Even though our live Gemini model is currently in offline recovery mode, I can still help you with Scrum guidelines or list active tasks. Ask me anything about sprint velocity, estimations, or task listings!";
        }
        
        return "That is an excellent Scrum question! To maintain high velocity, ensure that ticket dependencies are resolved early in the grooming phase, and that you follow clean, clear definition-of-done criteria.";
    }
}

