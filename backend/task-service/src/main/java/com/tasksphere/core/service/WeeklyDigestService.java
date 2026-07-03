package com.tasksphere.core.service;

import com.tasksphere.core.model.Task;
import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.TaskRepository;
import com.tasksphere.core.repository.UserSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * WeeklyDigestService — sends a Monday morning email digest to every user
 * summarising their pending, in-progress, and overdue tasks for the week.
 *
 * Schedule: every Monday at 08:00 server time.
 */
@Service
public class WeeklyDigestService {

    private static final Logger log = LoggerFactory.getLogger(WeeklyDigestService.class);
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("dd MMM yyyy");

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private UserSessionRepository userSessionRepository;

    @Autowired
    private EmailService emailService;

    @Scheduled(cron = "0 0 8 * * MON")
    @Transactional(readOnly = true)
    public void sendWeeklyDigests() {
        log.info("[DIGEST] Starting weekly digest dispatch...");

        List<Task> allTasks = taskRepository.findAll();
        LocalDate today = LocalDate.now();
        LocalDate weekEnd = today.plusDays(7);

        // Group active (non-DONE) tasks by assignee username
        Map<String, List<Task>> byUser = allTasks.stream()
                .filter(t -> t.getAssignee() != null && !"DONE".equals(t.getStatus()))
                .collect(Collectors.groupingBy(t -> t.getAssignee().getUsername()));

        if (byUser.isEmpty()) {
            log.info("[DIGEST] No active assigned tasks found, skipping dispatch.");
            return;
        }

        int dispatched = 0;
        for (Map.Entry<String, List<Task>> entry : byUser.entrySet()) {
            String username = entry.getKey();
            List<Task> userTasks = entry.getValue();

            Optional<UserSession> userOpt = userSessionRepository.findByUsername(username);
            if (userOpt.isEmpty()) continue;

            String email = userOpt.get().getExtractedEmail();
            if (email == null || email.isBlank()) continue;

            List<Task> overdue     = userTasks.stream().filter(t -> t.getDueDate() != null && t.getDueDate().isBefore(today)).collect(Collectors.toList());
            List<Task> dueThisWeek = userTasks.stream().filter(t -> t.getDueDate() != null && !t.getDueDate().isBefore(today) && !t.getDueDate().isAfter(weekEnd)).collect(Collectors.toList());
            List<Task> inProgress  = userTasks.stream().filter(t -> "IN_PROGRESS".equals(t.getStatus())).collect(Collectors.toList());
            List<Task> todo        = userTasks.stream().filter(t -> "TODO".equals(t.getStatus())).collect(Collectors.toList());

            String html = buildDigestHtml(username, overdue, dueThisWeek, inProgress, todo, today);
            String subject = "📋 Your TaskSphere Weekly Digest — " + today.format(FMT);

            emailService.executeDirectEmailDispatch("DIGEST", email, subject, html);
            log.info("[DIGEST] Dispatched digest to {} ({}) — {} tasks total", username, email, userTasks.size());
            dispatched++;
        }

        log.info("[DIGEST] Weekly digest complete. Dispatched to {} users.", dispatched);
    }

    private String buildDigestHtml(String username, List<Task> overdue, List<Task> dueThisWeek,
                                    List<Task> inProgress, List<Task> todo, LocalDate today) {
        StringBuilder sb = new StringBuilder();
        sb.append("<!DOCTYPE html><html><body style='font-family:Arial,sans-serif;background:#0f0f1a;color:#e2e8f0;padding:24px;max-width:600px;margin:auto;'>");
        sb.append("<div style='background:#1a1a2e;border-radius:12px;padding:28px;border:1px solid #2d2d4e;'>");
        sb.append("<h1 style='color:#67e8f9;margin-top:0;font-size:22px;'>📋 Weekly Task Digest</h1>");
        sb.append("<p style='color:#94a3b8;margin-top:-8px;'>Hey <strong style='color:#e2e8f0;'>").append(escapeHtml(username)).append("</strong>, here's your summary for the week of <strong>").append(today.format(FMT)).append("</strong>.</p>");

        if (!overdue.isEmpty()) {
            sb.append("<h2 style='color:#f43f5e;font-size:16px;border-bottom:1px solid #2d2d4e;padding-bottom:6px;'>🚨 Overdue (").append(overdue.size()).append(")</h2>");
            sb.append(buildTaskTable(overdue, "#f43f5e"));
        }

        if (!dueThisWeek.isEmpty()) {
            sb.append("<h2 style='color:#fb923c;font-size:16px;border-bottom:1px solid #2d2d4e;padding-bottom:6px;'>⏰ Due This Week (").append(dueThisWeek.size()).append(")</h2>");
            sb.append(buildTaskTable(dueThisWeek, "#fb923c"));
        }

        if (!inProgress.isEmpty()) {
            sb.append("<h2 style='color:#34d399;font-size:16px;border-bottom:1px solid #2d2d4e;padding-bottom:6px;'>🔧 In Progress (").append(inProgress.size()).append(")</h2>");
            sb.append(buildTaskTable(inProgress, "#34d399"));
        }

        if (!todo.isEmpty()) {
            sb.append("<h2 style='color:#818cf8;font-size:16px;border-bottom:1px solid #2d2d4e;padding-bottom:6px;'>📌 Backlog (").append(todo.size()).append(")</h2>");
            sb.append(buildTaskTable(todo, "#818cf8"));
        }

        sb.append("<hr style='border-color:#2d2d4e;margin-top:24px;'/>");
        sb.append("<p style='font-size:12px;color:#475569;text-align:center;margin-bottom:0;'>TaskSphere · Automated Weekly Digest · Do not reply to this email</p>");
        sb.append("</div></body></html>");
        return sb.toString();
    }

    private String buildTaskTable(List<Task> tasks, String accentColor) {
        StringBuilder sb = new StringBuilder();
        sb.append("<table style='width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;'>");
        for (Task t : tasks) {
            String due = t.getDueDate() != null ? t.getDueDate().format(FMT) : "—";
            sb.append("<tr style='border-bottom:1px solid #2d2d4e;'>")
              .append("<td style='padding:7px 6px;color:").append(accentColor).append(";font-weight:bold;width:32px;'>#").append(t.getId()).append("</td>")
              .append("<td style='padding:7px 6px;flex:1;'>").append(escapeHtml(t.getTitle())).append("</td>")
              .append("<td style='padding:7px 6px;color:#64748b;white-space:nowrap;'>").append(due).append("</td>")
              .append("<td style='padding:7px 6px;'><span style='font-size:11px;background:#0f172a;border-radius:4px;padding:2px 6px;color:").append(priorityColor(t.getPriority())).append(";'>").append(t.getPriority()).append("</span></td>")
              .append("</tr>");
        }
        sb.append("</table>");
        return sb.toString();
    }

    private String priorityColor(String p) {
        if (p == null) return "#94a3b8";
        return switch (p.toUpperCase()) {
            case "URGENT" -> "#f43f5e";
            case "HIGH"   -> "#fb923c";
            case "MEDIUM" -> "#fbbf24";
            default       -> "#94a3b8";
        };
    }

    private String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
