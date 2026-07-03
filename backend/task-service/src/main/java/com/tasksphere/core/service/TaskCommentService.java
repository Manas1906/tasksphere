package com.tasksphere.core.service;

import com.tasksphere.core.exception.ResourceNotFoundException;
import com.tasksphere.core.model.TaskComment;
import com.tasksphere.core.repository.TaskCommentRepository;
import com.tasksphere.core.repository.TaskRepository;
import com.tasksphere.core.repository.UserSessionRepository;
import com.tasksphere.core.service.WebPushService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@Transactional
public class TaskCommentService {

    private static final Logger log = LoggerFactory.getLogger(TaskCommentService.class);

    @Autowired
    private TaskCommentRepository taskCommentRepository;

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private TaskService taskService;

    @Autowired
    private WebPushService webPushService;

    @Autowired
    private UserSessionRepository userSessionRepository;

    private static final Pattern MENTION_PATTERN = Pattern.compile("@([\\w._-]+)");

    public List<TaskComment> getComments(Long taskId) {
        return taskCommentRepository.findByTaskIdOrderByCreatedAtAsc(taskId);
    }

    public TaskComment addComment(Long taskId, String author, String avatarUrl, String content) {
        if (!taskRepository.existsById(taskId)) {
            throw new ResourceNotFoundException("Task not found with ID: " + taskId);
        }
        TaskComment comment = TaskComment.builder()
                .taskId(taskId)
                .author(author)
                .avatarUrl(avatarUrl)
                .content(content)
                .build();
        TaskComment saved = taskCommentRepository.save(comment);
        taskService.logActivity(taskId, author, "COMMENT_ADDED", author + " commented: \"" + truncate(content, 80) + "\"");

        // Detect @mentions and push-notify each mentioned user (skip the comment author)
        Matcher matcher = MENTION_PATTERN.matcher(content);
        while (matcher.find()) {
            String mentionedUsername = matcher.group(1);
            if (mentionedUsername.equalsIgnoreCase(author)) continue;
            userSessionRepository.findByUsername(mentionedUsername).ifPresent(user -> {
                log.info("[COMMENT-MENTION] Notifying @{} about mention in task #{}", mentionedUsername, taskId);
                webPushService.sendNotification(
                        mentionedUsername,
                        "💬 You were mentioned",
                        author + " mentioned you in a comment on task #" + taskId,
                        "/");
            });
        }

        return saved;
    }

    public TaskComment updateComment(Long commentId, String requestingUser, String newContent) {
        TaskComment comment = taskCommentRepository.findById(commentId)
                .orElseThrow(() -> new ResourceNotFoundException("Comment not found with ID: " + commentId));
        if (!comment.getAuthor().equals(requestingUser)) {
            throw new SecurityException("Not allowed to edit another user's comment");
        }
        comment.setContent(newContent);
        return taskCommentRepository.save(comment);
    }

    public void deleteComment(Long commentId, String requestingUser) {
        TaskComment comment = taskCommentRepository.findById(commentId)
                .orElseThrow(() -> new ResourceNotFoundException("Comment not found with ID: " + commentId));
        if (!comment.getAuthor().equals(requestingUser)) {
            throw new SecurityException("Not allowed to delete another user's comment");
        }
        taskCommentRepository.delete(comment);
    }

    private String truncate(String s, int maxLen) {
        if (s == null) return "";
        return s.length() > maxLen ? s.substring(0, maxLen) + "..." : s;
    }
}
