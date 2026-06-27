package com.tasksphere.core.service;

import com.tasksphere.core.exception.ResourceNotFoundException;
import com.tasksphere.core.model.Task;
import com.tasksphere.core.model.TaskActivity;
import com.tasksphere.core.model.TaskChecklistItem;
import com.tasksphere.core.repository.TaskActivityRepository;
import com.tasksphere.core.repository.TaskRepository;
import com.tasksphere.core.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.List;

@Service
@Transactional
public class TaskService {

    private static final Logger log = LoggerFactory.getLogger(TaskService.class);

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private UserSessionRepository userSessionRepository;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    private TaskActivityRepository taskActivityRepository;

    @Autowired
    private WebPushService webPushService;

    public List<Task> getAllTasks() {
        return taskRepository.findAll();
    }

    public Task getTaskById(Long id) {
        return taskRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Task not found with ID: " + id));
    }

    public Task createTask(Task task) {
        // Link checklist items back to the parent task before saving
        if (task.getChecklist() != null) {
            task.getChecklist().forEach(item -> item.setTask(task));
        }
        
        // Resolve assignee if username is present in the sent object
        if (task.getAssignee() != null && task.getAssignee().getId() != null) {
            task.setAssignee(userSessionRepository.findById(task.getAssignee().getId()).orElse(null));
        }
        
        Task savedTask = taskRepository.save(task);

        // Log creation activity
        String actorUsername = savedTask.getAssignee() != null ? savedTask.getAssignee().getUsername() : "system";
        logActivity(savedTask.getId(), actorUsername, "CREATED", "Task \"" + savedTask.getTitle() + "\" created");

        // Alert assignee on new creation
        if (savedTask.getAssignee() != null) {
            sendAssignmentAlert(savedTask.getAssignee().getUsername(), savedTask, "ASSIGNMENT", "You have been assigned to task: \"" + savedTask.getTitle() + "\"");
        }
        
        return savedTask;
    }

    public Task updateTask(Long id, Task taskDetails) {
        Task task = getTaskById(id);

        com.tasksphere.core.model.UserSession oldAssignee = task.getAssignee();

        task.setTitle(taskDetails.getTitle());
        task.setDescription(taskDetails.getDescription());
        task.setStatus(taskDetails.getStatus());
        task.setPriority(taskDetails.getPriority());
        task.setStoryPoints(taskDetails.getStoryPoints());
        task.setDueDate(taskDetails.getDueDate());

        // Resolve new assignee
        com.tasksphere.core.model.UserSession newAssignee = null;
        if (taskDetails.getAssignee() != null && taskDetails.getAssignee().getId() != null) {
            newAssignee = userSessionRepository.findById(taskDetails.getAssignee().getId()).orElse(null);
        }
        task.setAssignee(newAssignee);

        // Merge checklist items
        task.getChecklist().clear();
        if (taskDetails.getChecklist() != null) {
            taskDetails.getChecklist().forEach(item -> {
                TaskChecklistItem newItem = TaskChecklistItem.builder()
                        .content(item.getContent())
                        .completed(item.isCompleted())
                        .task(task)
                        .build();
                task.getChecklist().add(newItem);
            });
        }
        
        Task savedTask = taskRepository.save(task);

        // Log update activity
        String actorName = newAssignee != null ? newAssignee.getUsername() : "system";
        logActivity(savedTask.getId(), actorName, "UPDATED", "Task details updated");

        // Trigger STOMP user queue alerts on ticket assignee update/assignment
        String oldUsername = oldAssignee != null ? oldAssignee.getUsername() : null;
        String newUsername = newAssignee != null ? newAssignee.getUsername() : null;

        if (oldUsername == null && newUsername != null) {
            sendAssignmentAlert(newUsername, savedTask, "ASSIGNMENT", "You have been assigned to task: \"" + savedTask.getTitle() + "\"");
        } else if (oldUsername != null && newUsername == null) {
            sendAssignmentAlert(oldUsername, savedTask, "UNASSIGNMENT", "You have been unassigned from task: \"" + savedTask.getTitle() + "\"");
        } else if (oldUsername != null && newUsername != null && !oldUsername.equals(newUsername)) {
            sendAssignmentAlert(oldUsername, savedTask, "UNASSIGNMENT", "You have been unassigned from task: \"" + savedTask.getTitle() + "\"");
            sendAssignmentAlert(newUsername, savedTask, "ASSIGNMENT", "You have been assigned to task: \"" + savedTask.getTitle() + "\"");
        } else if (newUsername != null) {
            sendAssignmentAlert(newUsername, savedTask, "UPDATE", "Details updated for task: \"" + savedTask.getTitle() + "\"");
        }

        return savedTask;
    }

    public Task updateTaskStatus(Long id, String status) {
        Task task = getTaskById(id);
        String oldStatus = task.getStatus();
        task.setStatus(status);
        Task savedTask = taskRepository.save(task);

        String actor = savedTask.getAssignee() != null ? savedTask.getAssignee().getUsername() : "system";
        logActivity(savedTask.getId(), actor, "STATUS_CHANGED",
                "Status changed from " + oldStatus + " to " + status);
        
        if (savedTask.getAssignee() != null && oldStatus != null && !oldStatus.equals(status)) {
            sendAssignmentAlert(savedTask.getAssignee().getUsername(), savedTask, "UPDATE", 
                "Task \"" + savedTask.getTitle() + "\" moved from " + oldStatus + " to " + status);
        }
        
        return savedTask;
    }

    public void deleteTask(Long id) {
        Task task = getTaskById(id);
        logActivity(task.getId(), "system", "DELETED", "Task \"" + task.getTitle() + "\" deleted");
        taskRepository.delete(task);
    }

    public List<TaskActivity> getActivities(Long taskId) {
        return taskActivityRepository.findByTaskIdOrderByCreatedAtDesc(taskId);
    }

    public void logActivity(Long taskId, String actor, String action, String detail) {
        try {
            taskActivityRepository.save(TaskActivity.builder()
                    .taskId(taskId)
                    .actor(actor)
                    .action(action)
                    .detail(detail)
                    .build());
        } catch (Exception e) {
            log.warn("[ACTIVITY-LOG] Failed to log activity for task {}: {}", taskId, e.getMessage());
        }
    }

    private void sendAssignmentAlert(String username, Task task, String type, String message) {
        try {
            java.util.Map<String, Object> alert = new java.util.HashMap<>();
            alert.put("id", task.getId());
            alert.put("title", task.getTitle());
            alert.put("type", type);
            alert.put("message", message);
            alert.put("timestamp", java.time.Instant.now().toString());

            messagingTemplate.convertAndSendToUser(username, "/queue/notifications", alert);
            log.info("[WS-ALERT] Successfully dispatched STOMP {} alert to {}", type, username);

            // Trigger background Web Push notification via Phase 13
            String pushTitle = "⚡ Task Update";
            if ("ASSIGNMENT".equals(type)) {
                pushTitle = "📋 New Task Assigned";
            } else if ("UNASSIGNMENT".equals(type)) {
                pushTitle = "👤 Task Unassigned";
            }

            String pushBody = message;
            if ("ASSIGNMENT".equals(type) && task.getStoryPoints() > 0) {
                pushBody += " (" + task.getStoryPoints() + " SP)";
            }

            webPushService.sendNotification(username, pushTitle, pushBody, "/");
        } catch (Exception e) {
            log.error("[WS-ALERT-ERROR] Failed to dispatch alert/push to {}: {}", username, e.getMessage(), e);
        }
    }
}
